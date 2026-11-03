/**
 * Deleting an answer from a planning card: an explicit whole-thread delete,
 * which unlike a comment box's close is an intent that must reach the server.
 *
 * The deletion first retires every box still writing to the comment and waits
 * for the request each already has on its way, so no save can land after the
 * delete. It then sends the delete, retrying a transient failure on the same
 * growing delay a box's save uses until it lands. A 404 is done: the comment
 * is gone, which is what was asked. A refusal (400, 401, 403) will not change
 * by retrying, so it stops and shows its reason until the reader retries.
 * Until it finishes the deletion holds the leave guard, as unsaved text does.
 */
import {
  pendingDeletions,
  RETRY_FIRST_MS,
  RETRY_MAX_MS,
  retireBoxesFor,
  type ReviewTarget,
} from "./commentAutosave";
import { removeComment } from "../stores/useReviewStore";
import type { ReviewData } from "../types";

export type DeletionState =
  | { phase: "deleting" }
  | { phase: "retrying"; nextAt: number }
  | { phase: "failed"; reason: string }
  | { phase: "done" };

export interface DeletionOptions {
  /** The delete request; resolves to the review the server persisted, if it sent one. */
  remove?: (target: ReviewTarget, id: string) => Promise<ReviewData | null>;
  /** Called once, with the persisted review when the server answered with one. */
  onDone: (data: ReviewData | null) => void;
}

const PERMANENT = new Set([400, 401, 403]);

function statusOf(e: unknown): number | undefined {
  const status = (e as { response?: { status?: unknown } } | null)?.response
    ?.status;
  return typeof status === "number" ? status : undefined;
}

function reasonOf(e: unknown, status: number): string {
  const data = (e as { response?: { data?: unknown } }).response?.data;
  if (typeof data === "string" && data !== "") return data;
  const error = (data as { error?: unknown } | null)?.error;
  return typeof error === "string" ? error : `the server refused (${status})`;
}

export class AnswerDeletion {
  private state: DeletionState = { phase: "deleting" };
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;
  private readonly listeners = new Set<() => void>();

  private readonly target: ReviewTarget;
  private readonly id: string;
  private readonly options: DeletionOptions;

  constructor(target: ReviewTarget, id: string, options: DeletionOptions) {
    this.target = target;
    this.id = id;
    this.options = options;
    pendingDeletions.add(this);
    void retireBoxesFor(target, id).then(() => this.send());
  }

  getState(): DeletionState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Send now: after a refusal, or without waiting out a retry delay. */
  retryNow(): void {
    if (this.state.phase === "done" || this.sending) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    pendingDeletions.add(this);
    this.set({ phase: "deleting" });
    this.send();
  }

  private set(state: DeletionState): void {
    this.state = state;
    for (const l of [...this.listeners]) l();
  }

  private send(): void {
    this.sending = true;
    const remove = this.options.remove ?? removeComment;
    let request: Promise<ReviewData | null>;
    try {
      request = remove(this.target, this.id);
    } catch (e) {
      request = Promise.reject(e);
    }
    request.then(
      (data) => this.finish(data),
      (e: unknown) => {
        this.sending = false;
        const status = statusOf(e);
        if (status === 404) {
          this.finish(null);
        } else if (status !== undefined && PERMANENT.has(status)) {
          pendingDeletions.delete(this);
          this.set({ phase: "failed", reason: reasonOf(e, status) });
        } else {
          this.failures += 1;
          const delay = Math.min(
            RETRY_FIRST_MS * 2 ** (this.failures - 1),
            RETRY_MAX_MS,
          );
          this.set({ phase: "retrying", nextAt: Date.now() + delay });
          this.timer = setTimeout(() => {
            this.timer = null;
            this.set({ phase: "deleting" });
            this.send();
          }, delay);
        }
      },
    );
  }

  private finish(data: ReviewData | null): void {
    this.sending = false;
    pendingDeletions.delete(this);
    this.set({ phase: "done" });
    this.options.onDone(data);
  }
}

/** Start deleting answer `id` from the document `target` names. */
export function deleteAnswer(
  target: ReviewTarget,
  id: string,
  options: DeletionOptions,
): AnswerDeletion {
  return new AnswerDeletion(target, id, options);
}
