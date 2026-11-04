/**
 * The client half of a server-held editing session
 * (`docs/design/planning-question-state.md` §7). A box that edits an answer
 * opens a session with the server, which snapshots what the box opened on;
 * every text write names the session; Save closes it (`finish`), and
 * Escape/× undoes everything the session did (`restore`).
 *
 * This module has no view and no HTTP client: it is given the requests
 * ({@link SessionApi}), which reject with an `axios`-shaped error
 * (`response.status`) on failure. Rules it keeps:
 *
 * - **No write before the begin acknowledgement.** {@link CommentSession.write}
 *   waits for it; typing meanwhile is only buffered.
 * - **A closed session sends nothing.** After finish or restore, a write is
 *   refused as a 404 would be.
 * - **A restore outlives its box.** It runs from the registry here, retries
 *   without end (1 s growing to 30 s) until the server answers, and the page
 *   guard stays up while one is pending.
 */
import type { ReviewComment, ReviewData } from "../types";

/** A begin or a restore failed first-time after this long, then doubling, up to… */
export const SESSION_RETRY_FIRST_MS = 1000;
/** …this long between attempts. */
export const SESSION_RETRY_MAX_MS = 30_000;

export interface SessionBaseline {
  text?: string;
  captured_block?: string;
  root_text_version?: string;
  did_not_exist?: boolean;
}

/** The server's answer to a session command (`internal/review/sessions.go`). */
export interface SessionAck {
  session_id: string;
  comment_id: string;
  state: "open" | "closed";
  outcome?: "kept" | "restored" | "discarded";
  baseline?: SessionBaseline;
  root_text_version: string;
  stale?: boolean;
  comment?: ReviewComment;
}

export interface SessionReply {
  session: SessionAck;
  review: ReviewData | null;
}

export interface SessionApi {
  begin(
    sessionId: string,
    shownVersion: string,
    signal?: unknown,
  ): Promise<SessionReply>;
  finish(sessionId: string): Promise<SessionReply>;
  restore(sessionId: string): Promise<SessionReply>;
  /** The comment as the server holds it now, or null when it is gone. */
  readComment(): Promise<ReviewComment | null>;
  /** A session text write, for "Replace with mine". */
  writeText(sessionId: string, text: string): Promise<ReviewData | null>;
  /** A new id for a session. */
  newId(): string;
}

export type SessionPhase =
  | "idle" // not begun
  | "beginning" // begin sent or waiting to be retried; nothing may be written
  | "open"
  | "finishing"
  | "closed"
  | "restoring" // a restore request is on its way
  | "restore-retrying" // it failed in a way that may pass; retry is scheduled
  | "conflict" // 409 external_text_edit: the user decides
  | "gone"; // 404: the root or session is not there; the text is kept

function statusOf(e: unknown): number | undefined {
  const s = (e as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof s === "number" ? s : undefined;
}

/** What a refused write looks like to a box: a 404, so it reads the comment as gone. */
function closedError(): Error {
  return Object.assign(new Error("editing session is closed"), {
    response: { status: 404 },
  });
}

export interface ConflictView {
  /** The root as the server holds it now (null when it could not be read). */
  theirs: ReviewComment | null;
  yours: string;
  opened: string;
}

export interface SessionInit {
  api: SessionApi;
  commentId: string;
  /** The box creates the root: nothing exists on the server yet. */
  isNew: boolean;
  /** The text and version the box showed when it opened. */
  openingText: string;
  shownVersion: string;
  /** Told of every review a session command returns. */
  onReview?: (review: ReviewData | null) => void;
  /** Told of the begin ack, for the box to adopt the server text if stale. */
  onAck?: (ack: SessionAck) => void;
  /** The number of replies on the root now, for the discard dialog. */
  replyCount?: () => number;
}

export class CommentSession {
  readonly id: string;
  readonly commentId: string;
  readonly isNew: boolean;
  private readonly api: SessionApi;
  private readonly init: SessionInit;
  private phaseValue: SessionPhase = "idle";
  private ack: SessionAck | null = null;
  private beginTimer: ReturnType<typeof setTimeout> | null = null;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private retryAt: number | null = null;
  private waiting: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  private mutatedValue = false;
  private typedChanged = false;
  /** The text the user holds, kept for every outcome that must not lose it. */
  private held = "";
  private conflictView: ConflictView | null = null;
  private outcomeValue: SessionAck["outcome"];
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(init: SessionInit) {
    this.init = init;
    this.api = init.api;
    this.commentId = init.commentId;
    this.isNew = init.isNew;
    this.id = init.api.newId();
  }

  get phase(): SessionPhase {
    return this.phaseValue;
  }
  /** A text write was sent in this session (it may have landed). */
  get mutated(): boolean {
    return this.mutatedValue;
  }
  /** "Unchanged" per §7: no buffered change and no earlier text mutation. */
  get unchanged(): boolean {
    return !this.mutatedValue && !this.typedChanged;
  }
  get acknowledged(): Readonly<SessionAck> | null {
    return this.ack;
  }
  get heldText(): string {
    return this.held;
  }
  get conflict(): ConflictView | null {
    return this.conflictView;
  }
  get outcome(): SessionAck["outcome"] {
    return this.outcomeValue;
  }
  get retryInMs(): number | null {
    return this.retryAt === null
      ? null
      : Math.max(0, this.retryAt - Date.now());
  }
  get replies(): number {
    return this.init.replyCount?.() ?? 0;
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  snapshotVersion = (): number => this.version;
  private changed(): void {
    this.version += 1;
    for (const l of [...this.listeners]) l();
    notifyRegistry();
  }
  private set(phase: SessionPhase): void {
    this.phaseValue = phase;
    if (phase === "closed") live.delete(this);
    else live.add(this);
    this.changed();
  }

  /** What the box foot says instead of its own status while the session decides. */
  get note(): string | null {
    switch (this.phaseValue) {
      case "beginning":
        return "Not saving yet — retrying";
      case "finishing":
        return "Saving…";
      case "restoring":
        return "Restoring…";
      case "restore-retrying":
        return "Restore failed — retrying";
      default:
        return null;
    }
  }

  /** Text typed in the box, so the session knows whether anything changed. */
  noteTyped(text: string): void {
    // Once a restore has the text, the box emptying itself must not erase it.
    if (this.phaseValue !== "beginning" && this.phaseValue !== "open") return;
    this.held = text;
    const was = this.typedChanged;
    this.typedChanged = text.trim() !== this.init.openingText.trim();
    if (was !== this.typedChanged) this.changed();
  }

  // --- begin ---

  /** Open the session on the server. Safe to call again: the same id is replayed. */
  begin(): void {
    if (this.phaseValue !== "idle" && this.phaseValue !== "beginning") return;
    this.set("beginning");
    void this.attemptBegin();
  }

  private async attemptBegin(): Promise<void> {
    try {
      const reply = await this.api.begin(this.id, this.init.shownVersion);
      if (this.phaseValue !== "beginning") return;
      this.ack = reply.session;
      this.failures = 0;
      // The review a begin returns is not adopted: opening a session changes
      // no text, and the answer must never roll back a later save's review.
      if (reply.session.state === "closed") {
        this.set("closed");
        this.rejectWaiting(closedError());
        return;
      }
      this.set("open");
      this.init.onAck?.(reply.session);
      for (const w of this.waiting.splice(0)) w.resolve();
    } catch (e) {
      if (this.phaseValue !== "beginning") return;
      const status = statusOf(e);
      if (status === 404 || status === 409) {
        this.set("gone");
        this.rejectWaiting(e);
        return;
      }
      this.failures += 1;
      const delay = Math.min(
        SESSION_RETRY_FIRST_MS * 2 ** (this.failures - 1),
        SESSION_RETRY_MAX_MS,
      );
      this.beginTimer = setTimeout(() => {
        this.beginTimer = null;
        void this.attemptBegin();
      }, delay);
      this.changed();
    }
  }

  /** Retry the begin now (the box's Retry button). */
  retryBegin(): void {
    if (this.phaseValue !== "beginning") return;
    if (this.beginTimer !== null) {
      clearTimeout(this.beginTimer);
      this.beginTimer = null;
      void this.attemptBegin();
    }
  }

  private rejectWaiting(e: unknown): void {
    for (const w of this.waiting.splice(0)) w.reject(e);
  }

  /**
   * Run a text write inside the session: it waits for the begin
   * acknowledgement, is refused once the session is no longer open, and marks
   * the session mutated the moment it is sent.
   */
  async write<T>(send: (sessionId: string) => Promise<T>): Promise<T> {
    if (this.phaseValue === "idle") this.begin();
    if (this.phaseValue === "beginning") {
      await new Promise<void>((resolve, reject) =>
        this.waiting.push({ resolve, reject }),
      );
    }
    if (this.phaseValue !== "open") throw closedError();
    this.mutatedValue = true;
    this.changed();
    return send(this.id);
  }

  // --- finish ---

  /**
   * Close the session keeping what it wrote. The caller has quiesced the box
   * first. Retried without end on transient failure; a 404 means there is
   * nothing left to close.
   */
  async finish(): Promise<void> {
    if (this.phaseValue === "beginning") {
      await new Promise<void>((resolve) =>
        this.waiting.push({ resolve, reject: () => resolve() }),
      );
    }
    if (this.phaseValue !== "open") return;
    this.set("finishing");
    for (let failures = 0; ; failures += 1) {
      try {
        const reply = await this.api.finish(this.id);
        // Finish changes no text, so its review is not adopted either: the
        // saves before it already carried every text the session wrote.
        this.outcomeValue = reply.session.outcome;
        break;
      } catch (e) {
        const status = statusOf(e);
        if (status === 404 || status === 409) break;
        await sleep(
          Math.min(
            SESSION_RETRY_FIRST_MS * 2 ** failures,
            SESSION_RETRY_MAX_MS,
          ),
        );
      }
    }
    this.set("closed");
  }

  // --- restore ---

  /**
   * Undo what the session did. The box must already have stopped sending
   * (`retireAndSettle`). `text` is what the user holds, kept for every
   * outcome that cannot restore it. Runs from the registry, so the caller
   * unmounting changes nothing.
   */
  restore(text: string): void {
    if (
      this.phaseValue !== "open" &&
      this.phaseValue !== "beginning" &&
      this.phaseValue !== "conflict"
    )
      return;
    this.held = text;
    this.failures = 0;
    const beginning = this.phaseValue === "beginning";
    this.set("restoring");
    if (beginning) {
      // Never acknowledged: the server may or may not hold the session, so
      // the restore goes out regardless (a 404 means there was nothing), and
      // writes waiting for the acknowledgement are refused.
      if (this.beginTimer !== null) clearTimeout(this.beginTimer);
      this.beginTimer = null;
      this.rejectWaiting(closedError());
    }
    void this.attemptRestore();
  }

  private async attemptRestore(): Promise<void> {
    this.retryAt = null;
    try {
      const reply = await this.api.restore(this.id);
      this.outcomeValue = reply.session.outcome;
      this.init.onReview?.(reply.review);
      this.set("closed");
    } catch (e) {
      const status = statusOf(e);
      if (status === 404) {
        this.set("gone");
        return;
      }
      if (status === 409) {
        const theirs = await this.api.readComment().catch(() => null);
        this.conflictView = {
          theirs,
          yours: this.held,
          opened: this.ack?.baseline?.text ?? this.init.openingText,
        };
        this.set("conflict");
        return;
      }
      this.failures += 1;
      const delay = Math.min(
        SESSION_RETRY_FIRST_MS * 2 ** (this.failures - 1),
        SESSION_RETRY_MAX_MS,
      );
      this.retryAt = Date.now() + delay;
      this.set("restore-retrying");
      this.restoreTimer = setTimeout(() => {
        this.restoreTimer = null;
        this.set("restoring");
        void this.attemptRestore();
      }, delay);
    }
  }

  /** Retry a failed restore now. */
  retryRestoreNow(): void {
    if (this.phaseValue !== "restore-retrying") return;
    if (this.restoreTimer !== null) clearTimeout(this.restoreTimer);
    this.restoreTimer = null;
    this.set("restoring");
    void this.attemptRestore();
  }

  /** Stop showing a permanent outcome (404): the user closed it. */
  dismiss(): void {
    if (this.phaseValue === "gone" || this.phaseValue === "conflict") {
      this.conflictView = null;
      this.set("closed");
    }
  }

  /**
   * "Replace with mine": a new session on the version the comparison showed,
   * then the held text, then finish. Never a blind override: if the root moved
   * again since the comparison, the new begin reports it stale and nothing is
   * written; the comparison is refreshed instead.
   * Resolves true when the text was written.
   */
  async replaceWithMine(): Promise<boolean> {
    const view = this.conflictView;
    if (this.phaseValue !== "conflict" || view === null) return false;
    const fresh = new CommentSession({
      ...this.init,
      shownVersion: view.theirs?.root_text_version ?? "",
      openingText: view.theirs?.comment ?? "",
    });
    fresh.begin();
    try {
      await fresh.write(() => Promise.resolve());
    } catch {
      return false;
    }
    if (fresh.ack?.stale) {
      // Moved again: show the newer comparison, write nothing.
      const theirs = await this.api.readComment().catch(() => null);
      this.conflictView = { ...view, theirs };
      void fresh.finish();
      this.changed();
      return false;
    }
    try {
      await this.api.writeText(fresh.id, this.held);
    } catch {
      void fresh.finish();
      return false;
    }
    await fresh.finish();
    this.conflictView = null;
    this.set("closed");
    return true;
  }

  /** The page needs the browser's leave prompt while this session can still lose text. */
  get needsGuard(): boolean {
    switch (this.phaseValue) {
      case "restoring":
      case "restore-retrying":
      case "conflict":
      case "gone":
      case "finishing":
        return true;
      case "beginning":
      case "open":
        return this.mutatedValue || this.typedChanged;
      default:
        return false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- The registry: every session not closed, surviving unmount. ---

const live = new Set<CommentSession>();
const registryListeners = new Set<() => void>();
let registryVersion = 0;

function notifyRegistry(): void {
  registryVersion += 1;
  for (const l of [...registryListeners]) l();
}

export function subscribeSessions(l: () => void): () => void {
  registryListeners.add(l);
  return () => {
    registryListeners.delete(l);
  };
}
export function sessionsVersion(): number {
  return registryVersion;
}

/** Sessions the user must still hear about: a restore pending, failed or conflicted. */
export function sessionsToReport(): CommentSession[] {
  return [...live].filter((s) =>
    ["restoring", "restore-retrying", "conflict", "gone"].includes(s.phase),
  );
}

/** Whether leaving the page now could lose text a session holds. */
export function sessionsNeedGuard(): boolean {
  for (const s of live) if (s.needsGuard) return true;
  return false;
}

/** For tests: forget every session. */
export function resetSessionsForTest(): void {
  live.clear();
  notifyRegistry();
}

/** The words of the question Escape and × ask before undoing `session`. */
export function cancelWords(session: CommentSession): {
  label: string;
  question: string;
  confirm: string;
} {
  if (!session.isNew) {
    return {
      label: "Restore answer",
      question: "Restore what you opened?",
      confirm: "Restore",
    };
  }
  const n = session.replies;
  return {
    label: "Discard new answer",
    question: `Discard this new answer?${n > 0 ? ` (including ${n} ${n === 1 ? "reply" : "replies"})` : ""}`,
    confirm: "Discard",
  };
}
