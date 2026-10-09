/**
 * Comment autosave (`docs/reference/comment-autosave.md`): every comment
 * box in the app saves as the reviewer types, has no Save and no Cancel, and
 * keeps its text through every way of leaving it.
 *
 * A *comment box* is any of the four places a reviewer types review text: the
 * new-comment popover (which **Answer…** opens too, on a document and on a
 * planning card), the inline edit and reply boxes in the document, and the
 * review panel's edit and reply boxes. They are built three ways — a React
 * popover, hand-built DOM, and the panel's own React — so what they share is
 * here, in a controller with no view: {@link CommentBox}. Each surface draws a
 * textarea and a foot, and hands the controller what was typed.
 *
 * The controller outlives its surface. A box closed with text not yet saved,
 * by Esc, a click outside, a file switch or a navigation, goes on retrying
 * from here, and the app shell lists it ({@link boxesToReport}) with a way to
 * reopen it, so nothing typed is dropped without the reader being told.
 *
 * This module knows nothing of the review store or the server: a box is given
 * the requests that save it ({@link BoxOps}), which reject on failure.
 */
import type { CommentReaction, ReviewComment } from "../types";
import { copyText } from "./clipboard";

/** A save is sent this long after the last keystroke. */
export const SAVE_PAUSE_MS = 1000;
/** …or this long after the first keystroke not yet saved, if typing has not paused. */
export const SAVE_MAX_WAIT_MS = 5000;
/** A failed save is first retried after this long… */
export const RETRY_FIRST_MS = 1000;
/** …then after twice as long each time, up to this. */
export const RETRY_MAX_MS = 30_000;

/**
 * Where a box saves: the repository's API base and the document's path. One
 * object a box keeps for its life, so a document followed to a new path
 * (`followDocument`) takes its open boxes with it ({@link retargetBoxes}).
 */
export interface ReviewTarget {
  base: string;
  path: string;
}

/**
 * What a box writes.
 *
 * - `comment`: a new comment. Its first save creates the comment, later ones
 *   edit its text; `draft` is the comment as it will be created.
 * - `edit`: the text of a comment that exists.
 * - `reply`: a reply on a comment. Its first save creates the reply, under
 *   `replyId`, later ones edit it in place.
 */
export type BoxKind = "comment" | "edit" | "reply";

export interface BoxSubject {
  kind: BoxKind;
  target: ReviewTarget;
  commentId: string;
  /** The reply's id, for a reply box. */
  replyId?: string;
  /** The comment a new-comment box creates, without its text. */
  draft?: ReviewComment;
  /** What the box is about, in a few words, for the shell's list. */
  label: string;
}

/** The requests that save a box. Each resolves on success and rejects on failure. */
export interface BoxOps {
  /** The first save, which creates the comment or the reply. Absent for an edit box. */
  create?: (text: string) => Promise<unknown>;
  /** Every later save. */
  update: (text: string) => Promise<unknown>;
  /** Closing a box that created its comment and is now empty deletes the comment. */
  remove?: () => Promise<unknown>;
  /**
   * The comment *Post as a new comment* files once the box's own comment is
   * gone: a new comment, without its text, and the requests that save it,
   * which the box saves through from then on.
   */
  asNew?: () => { draft: ReviewComment; ops: BoxOps };
}

/**
 * `idle`: nothing has been saved by this box yet. `saving`: a save is on its
 * way. `saved`: the last save landed. `retrying`: the last save failed and is
 * retried on a growing delay. `gone`: the comment the box saves to was
 * deleted, so nothing is sent; the reader can copy the text or post it as a
 * new comment.
 */
export type BoxStatus = "idle" | "saving" | "saved" | "retrying" | "gone";

export interface BoxState {
  /** The text in the box, as typed. */
  text: string;
  open: boolean;
  status: BoxStatus;
  /** When the last save landed, as `Date.now()`. */
  savedAt: number | null;
  /** How many saves have landed, so a view can pulse once per landing. */
  saves: number;
  /** Empty, with something already saved that the emptiness does not touch. */
  empty: boolean;
  /**
   * Text in the box that the server does not hold yet, and, once the box's
   * comment is gone, text neither copied nor posted.
   */
  unsaved: boolean;
  /** The text was copied, after its comment was gone. */
  copied: boolean;
  /** *Post as a new comment* is offered. */
  canPost: boolean;
}

type Want = "save" | "remove" | null;

/**
 * Whether a failed request failed because what it named is gone: the server
 * answers an edit of a comment, or a reply, it does not hold with 404
 * (`internal/api/review_command_handlers.go`). Anything else — no answer, a
 * 5xx — may succeed on a retry.
 */
export function isGone(e: unknown): boolean {
  return (
    (e as { response?: { status?: unknown } } | null)?.response?.status === 404
  );
}

/**
 * One comment box's save controller: one writer, one request in flight at a
 * time, the newest text in each request, and an edit never before the create
 * it edits has landed (`comment-autosave.md` §1.2).
 */
export class CommentBox {
  readonly subject: BoxSubject;
  private ops: BoxOps;
  /** The comment or reply exists on the server. */
  private created: boolean;
  /**
   * A create was sent, whether or not its answer arrived: one whose answer was
   * lost may have landed, so closing the box empty still deletes.
   */
  private createTried = false;
  /** The trimmed text the server holds, once anything is held. */
  private saved: string | null;
  private text: string;
  private opened = false;
  private inFlight: Want = null;
  private firstUnsavedAt: number | null = null;
  private lastInputAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private status: BoxStatus = "idle";
  private savedAt: number | null = null;
  private saves = 0;
  private copied = false;
  /** Handed over to another box (`retire`): nothing more is sent or adopted. */
  private retired = false;
  private readonly listeners = new Set<() => void>();
  private state: BoxState;

  /**
   * `text` is what the box opens holding: an edit box's comment text, which
   * the server already holds (`created`), or nothing; `saved` is what the
   * server holds when that differs from `text`. A box is made closed, and
   * joins the registry when its surface opens it ({@link CommentBox.open}):
   * React may make a box it then throws away, and such a box must never count
   * as one the reader has open.
   */
  constructor(
    subject: BoxSubject,
    ops: BoxOps,
    initial: { text?: string; created?: boolean; saved?: string } = {},
  ) {
    this.subject = subject;
    this.ops = ops;
    this.text = initial.text ?? "";
    this.created = initial.created ?? false;
    this.saved = this.created ? (initial.saved ?? this.text).trim() : null;
    this.state = this.snapshot();
  }

  /** The box's state, the same object until it changes. */
  getState = (): BoxState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** What was typed: the whole text in the box now. */
  input(text: string): void {
    if (text === this.text) return;
    this.text = text;
    if (this.want() === "save") {
      const now = Date.now();
      this.lastInputAt = now;
      if (this.firstUnsavedAt === null) this.firstUnsavedAt = now;
    } else {
      this.firstUnsavedAt = null;
    }
    this.pump();
    this.changed();
  }

  /**
   * Close the box: what is not yet saved is sent at once, and a box that
   * created its comment and is now empty deletes it. Nothing is discarded; a
   * save that fails goes on being retried, and the shell lists it.
   */
  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.pump();
    this.changed();
  }

  /**
   * Open the box on a surface: when it is first drawn, and again when the
   * reader reopens one they closed, which holds the text it was closed with.
   */
  open(): void {
    if (this.opened || this.retired) return;
    this.opened = true;
    register(this);
    this.changed();
  }

  /** Send what is not yet saved now, without waiting for the pause. */
  flush(): void {
    if (this.retryTimer !== null) return;
    this.pump(true);
  }

  /**
   * Copy the text, once the box's comment is gone; resolves false if the
   * clipboard refused. A copied text no longer holds the tab open.
   */
  async copyText(): Promise<boolean> {
    const ok = await copyText(this.typed);
    if (ok) {
      this.copied = true;
      this.pump();
      this.changed();
    }
    return ok;
  }

  /**
   * File the text as a new comment, once the box's comment is gone: the box
   * becomes that comment's box, and saves it as it saves any new comment.
   */
  postAsNew(): void {
    if (this.status !== "gone" || !this.ops.asNew || this.typed === "") return;
    const { draft, ops } = this.ops.asNew();
    this.ops = ops;
    this.subject.kind = "comment";
    this.subject.commentId = draft.id;
    this.subject.replyId = undefined;
    this.subject.draft = draft;
    this.subject.label = "New comment";
    this.created = false;
    this.createTried = false;
    this.saved = null;
    this.failures = 0;
    this.status = "idle";
    this.pump(true);
    this.changed();
  }

  /**
   * Hand this closed box's text over to another box on the same comment,
   * which writes it from now on: this one stops sending, ignores what its
   * last request answers, and leaves the registry. Two writers on one comment
   * would let this one's retry land after the other's newer save.
   */
  retire(): void {
    this.retired = true;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
    this.opened = false;
    unregister(this);
    this.changed();
  }

  /** The text the server holds for this box, or null before anything is. */
  get savedText(): string | null {
    return this.saved;
  }

  /** Whether the box is open on a surface. */
  get isOpen(): boolean {
    return this.opened;
  }

  /** The text as last typed, trimmed: what a save of it now would send. */
  get typed(): string {
    return this.text.trim();
  }

  /** Whether this box's comment or reply exists on the server. */
  get exists(): boolean {
    return this.created;
  }

  private want(): Want {
    if (this.retired || this.status === "gone") return null;
    const typed = this.text.trim();
    if (typed === "") {
      return !this.opened && this.createTried && this.ops.remove
        ? "remove"
        : null;
    }
    if (!this.created || typed !== this.saved) return "save";
    return null;
  }

  /** Send what the box wants sent, once its pause is over or at once. */
  private pump(now = false): void {
    if (this.inFlight !== null || this.retryTimer !== null) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const want = this.want();
    if (want === null) {
      this.firstUnsavedAt = null;
      this.settle();
      return;
    }
    if (want === "save" && this.opened && !now) {
      const first = this.firstUnsavedAt ?? this.lastInputAt;
      const due = Math.min(
        this.lastInputAt + SAVE_PAUSE_MS,
        first + SAVE_MAX_WAIT_MS,
      );
      const wait = due - Date.now();
      if (wait > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          // Due: every keystroke since cleared this timer and set a new one.
          this.pump(true);
        }, wait);
        return;
      }
    }
    this.send(want);
  }

  private send(want: "save" | "remove"): void {
    const typed = this.text.trim();
    this.inFlight = want;
    this.firstUnsavedAt = null;
    if (this.status !== "retrying") this.status = "saving";
    const creating = want === "save" && !this.created && !!this.ops.create;
    if (creating) this.createTried = true;
    this.changed();
    let request: Promise<unknown>;
    try {
      request =
        want === "remove"
          ? this.ops.remove!()
          : creating
            ? this.ops.create!(typed)
            : this.ops.update(typed);
    } catch (e) {
      request = Promise.reject(e);
    }
    const removed = () => {
      this.created = false;
      this.createTried = false;
      this.saved = null;
      this.status = "idle";
    };
    request.then(
      () => {
        if (this.retired) return;
        this.inFlight = null;
        this.failures = 0;
        if (want === "remove") {
          removed();
        } else {
          this.created = true;
          this.saved = typed;
          this.savedAt = Date.now();
          this.saves += 1;
          this.status = "saved";
        }
        this.pump();
        this.changed();
      },
      (e: unknown) => {
        if (this.retired) return;
        this.inFlight = null;
        if (isGone(e)) {
          // Deleting what is already gone is done. Saving to it is not, and
          // no retry will change that: the reader decides what becomes of
          // the text.
          this.failures = 0;
          if (want === "remove") removed();
          else this.status = "gone";
          this.pump();
          this.changed();
          return;
        }
        this.failures += 1;
        this.status = "retrying";
        const delay = Math.min(
          RETRY_FIRST_MS * 2 ** (this.failures - 1),
          RETRY_MAX_MS,
        );
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (this.want() === null) {
            this.status = this.saved === null ? "idle" : "saved";
          }
          this.pump(true);
          this.changed();
        }, delay);
        this.changed();
      },
    );
  }

  /**
   * A closed box with nothing left to send leaves the registry, unless its
   * comment is gone and its text has been neither copied nor posted.
   */
  private settle(): void {
    if (this.opened) return;
    if (this.status === "gone" && !this.copied && this.typed !== "") return;
    unregister(this);
  }

  private snapshot(): BoxState {
    const want = this.want();
    const gone = this.status === "gone";
    return {
      text: this.text,
      open: this.opened,
      status: this.status,
      savedAt: this.savedAt,
      saves: this.saves,
      empty: this.text.trim() === "" && this.saved !== null,
      unsaved:
        want === "save" ||
        this.inFlight === "save" ||
        (gone && !this.copied && this.typed !== ""),
      copied: this.copied,
      canPost: gone && !!this.ops.asNew && this.typed !== "",
    };
  }

  private changed(): void {
    this.state = this.snapshot();
    for (const listener of [...this.listeners]) listener();
    notifyRegistry();
  }
}

// --- The registry: every box open, or closed with text still to save. ---

const boxes = new Set<CommentBox>();
const registryListeners = new Set<() => void>();
let registryVersion = 0;

function register(box: CommentBox): void {
  if (boxes.has(box)) return;
  boxes.add(box);
  notifyRegistry();
}

function unregister(box: CommentBox): void {
  if (boxes.delete(box)) notifyRegistry();
}

function notifyRegistry(): void {
  registryVersion += 1;
  for (const listener of [...registryListeners]) listener();
}

/** Subscribe to any change in any box; for `useSyncExternalStore`. */
export function subscribeBoxes(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

/** A number that changes whenever any box does; for `useSyncExternalStore`. */
export function boxesVersion(): number {
  return registryVersion;
}

/** Every box that is open, or closed with something still to send. */
export function liveBoxes(): CommentBox[] {
  return [...boxes];
}

/** Whether any box is open, optionally only those `which` accepts. */
export function hasOpenBox(which?: (box: CommentBox) => boolean): boolean {
  for (const box of boxes) {
    if (box.isOpen && (which === undefined || which(box))) return true;
  }
  return false;
}

/** Whether any text typed in any box is not saved yet. */
export function hasUnsavedText(): boolean {
  for (const box of boxes) if (box.getState().unsaved) return true;
  return false;
}

/**
 * The boxes the app shell tells the reader about: those whose last save
 * failed and is being retried, open or closed. A box closed with text sends
 * it at once and is listed only if that save fails, since listing every close
 * while its save is on its way would flash the notice at each one. An open box
 * waiting for its pause says so at its own foot. Also listed, apart from
 * those: boxes whose comment was deleted, while their text has been neither
 * copied nor posted.
 */
export function boxesToReport(): CommentBox[] {
  return [...boxes].filter((box) => {
    const { status, unsaved } = box.getState();
    return status === "retrying" || (status === "gone" && unsaved);
  });
}

/**
 * The live box on comment `commentId` of the document `target` names whose
 * kind is one of `kinds`, if any: the one to reuse, or take text from, rather
 * than open a second writer on the same comment.
 */
export function liveBoxFor(
  target: ReviewTarget,
  commentId: string,
  kinds: readonly BoxKind[],
): CommentBox | undefined {
  for (const box of boxes) {
    const { subject } = box;
    if (
      subject.commentId === commentId &&
      kinds.includes(subject.kind) &&
      subject.target.base === target.base &&
      subject.target.path === target.path &&
      box.getState().status !== "gone"
    ) {
      return box;
    }
  }
  return undefined;
}

/** Send every box's unsaved text now, as the tab is about to go. */
export function flushAllBoxes(): void {
  for (const box of boxes) box.flush();
}

/** Close every open box `which` accepts, saving what each holds. */
export function closeBoxes(which: (box: CommentBox) => boolean): void {
  for (const box of [...boxes]) if (box.isOpen && which(box)) box.close();
}

/**
 * The document at `from` is at `to` now, so every box saving to it saves
 * there instead.
 */
export function retargetBoxes(base: string, from: string, to: string): void {
  const targets = new Set<ReviewTarget>();
  for (const box of boxes) {
    const t = box.subject.target;
    if (t.base === base && t.path === from) targets.add(t);
  }
  for (const t of targets) t.path = to;
}

/**
 * `comments` with the text typed in this tab's boxes in place of what is
 * saved, for the document at `path` in `base`: Copy answers copies the text as
 * last typed in the tab that holds the box (`comment-autosave.md` §7),
 * not the text the last save carried. A box whose comment or reply is not
 * created yet adds it; an empty box changes nothing, since empty text is never
 * saved.
 */
export function withTypedText(
  base: string | null,
  path: string,
  comments: readonly ReviewComment[],
): ReviewComment[] {
  let out = [...comments];
  for (const box of boxes) {
    const { subject } = box;
    if (subject.target.path !== path) continue;
    if (base !== null && subject.target.base !== base) continue;
    const typed = box.typed;
    if (typed === "") continue;
    const at = out.findIndex((c) => c.id === subject.commentId);
    if (subject.kind === "reply") {
      if (at < 0) continue;
      const c = out[at];
      const reactions = c.reactions ?? [];
      const held = reactions.findIndex((r) => r.id === subject.replyId);
      const reply: CommentReaction =
        held >= 0
          ? { ...reactions[held], summary: typed }
          : {
              id: subject.replyId,
              actor: "reviewer",
              kind: "needs_clarification",
              summary: typed,
              before_text: "",
              after_text: "",
              timestamp: Date.now() / 1000,
            };
      const next =
        held >= 0
          ? reactions.map((r, i) => (i === held ? reply : r))
          : [...reactions, reply];
      out = out.map((x, i) =>
        i === at ? { ...x, resolved: false, reactions: next } : x,
      );
      continue;
    }
    if (at >= 0) {
      out = out.map((x, i) => (i === at ? { ...x, comment: typed } : x));
    } else if (subject.kind === "comment" && subject.draft) {
      out = [...out, { ...subject.draft, comment: typed }];
    }
  }
  return out;
}

/** Whether a key closes a box: Ctrl+Enter or ⌘+Enter, or Esc. */
export function closesBox(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return (e.key === "Enter" && (e.metaKey || e.ctrlKey)) || e.key === "Escape";
}

/** The modifier key the hint names: ⌘ on Apple systems, Ctrl elsewhere. */
export function closeHint(): string {
  const apple =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent);
  return `${apple ? "⌘" : "Ctrl"}+Enter or Esc closes`;
}

/**
 * The words at a box's foot for `state` at `now`: *Saving…*, *Saved just
 * now*, *Saved 1 min ago*, *Not saved, retrying*, or *Empty text is not
 * saved*; "" before anything has been saved.
 */
export function statusText(state: BoxState, now: number): string {
  if (state.status === "gone") return "This comment was deleted";
  if (state.status === "retrying") return "Not saved, retrying";
  if (state.status === "saving") return "Saving…";
  if (state.empty) return "Empty text is not saved";
  if (state.status === "saved" && state.savedAt !== null) {
    return savedAgo(now - state.savedAt);
  }
  return "";
}

/** *Saved just now* under a minute, then whole minutes, then whole hours. */
export function savedAgo(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Saved just now";
  if (minutes < 60) return `Saved ${minutes} min ago`;
  return `Saved ${Math.floor(minutes / 60)} h ago`;
}

/** How often a foot reads the clock again, for *Saved N min ago*. */
export const STATUS_TICK_MS = 15_000;

/** For tests: forget every box. */
export function resetBoxesForTest(): void {
  boxes.clear();
  notifyRegistry();
}
