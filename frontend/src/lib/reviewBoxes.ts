/**
 * The comment boxes a review makes (`lib/commentAutosave.ts`): a new comment,
 * an edit of one, and a reply on one, each saving through the review store's
 * requests to the document it was opened on (`ReviewTarget`), whatever the
 * page or the repository on screen is by the time a save is sent. The
 * popover, the document's inline boxes, the review panel and the planning
 * card all make theirs here, so a box behaves the same wherever it is drawn.
 */
import {
  CommentBox,
  liveBoxFor,
  type BoxOps,
  type ReviewTarget,
} from "./commentAutosave";
import { CommentSession } from "./commentSession";
import {
  newReviewId,
  sessionApiFor,
  removeComment,
  saveCommentText,
  saveNewComment,
  saveNewReply,
  saveReplyText,
} from "../stores/useReviewStore";
import type { CommentAnchor, ReviewComment, ReviewData } from "../types";

/**
 * Told of every save's answer, with the target it was sent to: the planning
 * page keeps the reviews it shows itself, and adopts each answer there.
 */
export type OnSaved = (target: ReviewTarget, data: ReviewData | null) => void;

/**
 * Reports an answer to `onSaved` unless `retired()` says the box that sent it
 * has been retired since: a retired box adopts nothing, and an answer that
 * predates a delete must not put the deleted comment back on screen.
 */
const told =
  (
    target: ReviewTarget,
    onSaved: OnSaved | undefined,
    retired: () => boolean = () => false,
  ) =>
  (data: ReviewData | null) => {
    if (!retired()) onSaved?.(target, data);
    return data;
  };

/** What saves a new comment, `draft` without its text, to `target`. */
function newCommentOps(
  target: ReviewTarget,
  draft: ReviewComment,
  onSaved?: OnSaved,
  retired?: () => boolean,
  session?: () => CommentSession | null,
): BoxOps {
  const tell = told(target, onSaved, retired);
  // Inside a session every text write waits for the begin ack and names it.
  const inSession = <T>(
    send: (sessionId?: string) => Promise<T>,
  ): Promise<T> => {
    const s = session?.() ?? null;
    return s === null ? send() : s.write(send);
  };
  return {
    create: (text) =>
      inSession((sid) =>
        saveNewComment(target, { ...draft, comment: text }, sid),
      ).then(tell),
    update: (text) =>
      inSession((sid) => saveCommentText(target, draft.id, text, sid)).then(
        tell,
      ),
    remove: () => removeComment(target, draft.id).then(tell),
  };
}

/**
 * Whether a comment anchored at `anchor` can still be placed in the page: a
 * block on screen still holds the text it was written on. The comment layer
 * marks every block with its text's hash as it draws.
 */
function placeable(anchor: CommentAnchor): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.querySelector(
      `[data-block-hash="${CSS.escape(anchor.block_text_hash)}"]`,
    ) !== null
  );
}

/**
 * *Post as a new comment*, for a box whose comment was deleted: a new comment
 * on the deleted one's anchor where it can still be placed, else on the
 * document as a whole.
 */
function asNewComment(
  target: ReviewTarget,
  from: Pick<ReviewComment, "anchor" | "fallback_text">,
  onSaved?: OnSaved,
): BoxOps["asNew"] {
  return () => {
    const anchor =
      from.anchor && placeable(from.anchor) ? from.anchor : undefined;
    const draft: ReviewComment = {
      id: newReviewId(),
      anchor,
      fallback_text: anchor ? from.fallback_text : undefined,
      reactions: [],
      comment: "",
      created_at: Date.now() / 1000,
    };
    return { draft, ops: newCommentOps(target, draft, onSaved) };
  };
}

/**
 * The box for a new comment, `draft` without its text: its first save creates
 * the comment, later ones edit it, and closing it empty deletes it again.
 */
export function newCommentBox(
  target: ReviewTarget,
  draft: ReviewComment,
  options: { label?: string; onSaved?: OnSaved } = {},
): CommentBox {
  const known: Known = { version: "", replies: 0 };
  const onSaved = watching(options.onSaved, known, draft.id);
  const box: CommentBox = new CommentBox(
    {
      kind: "comment",
      target,
      commentId: draft.id,
      draft,
      label: options.label ?? "New comment",
    },
    {
      ...newCommentOps(
        target,
        draft,
        onSaved,
        () => box.isRetired,
        () => box.editingSession,
      ),
      asNew: asNewComment(target, draft, onSaved),
    },
  );
  attachEditingSession(box, target, onSaved, known, () => ({
    isNew: !box.exists,
    openingText: box.savedText ?? "",
  }));
  return box;
}

/**
 * The box that edits `comment`'s text. One box writes a comment at a time:
 * an edit box closed with its text still on its way is opened again, and one
 * still open elsewhere, or the new-comment box that filed the comment, hands
 * this box its newer text, so the first save here never puts back the
 * comment's older wording.
 */
export function editCommentBox(
  target: ReviewTarget,
  comment: ReviewComment,
  options: { onSaved?: OnSaved } = {},
): CommentBox {
  const live = liveBoxFor(target, comment.id, ["edit", "comment"]);
  if (live && !live.isOpen && live.subject.kind === "edit") return live;
  const text = live ? live.getState().text : comment.comment;
  if (live && !live.isOpen) live.retire();
  const known: Known = {
    version: comment.root_text_version ?? "",
    replies: comment.reactions?.length ?? 0,
  };
  const onSaved = watching(options.onSaved, known, comment.id);
  const tell = told(target, onSaved, () => box.isRetired);
  const box: CommentBox = new CommentBox(
    { kind: "edit", target, commentId: comment.id, label: "Edited comment" },
    {
      update: (t) =>
        (box.editingSession
          ? box.editingSession.write((sid) =>
              saveCommentText(target, comment.id, t, sid),
            )
          : saveCommentText(target, comment.id, t)
        ).then(tell),
      asNew: asNewComment(target, comment, onSaved),
    },
    { text, created: true, saved: comment.comment },
  );
  attachEditingSession(box, target, onSaved, known, () => ({
    isNew: false,
    openingText: box.savedText ?? comment.comment,
  }));
  return box;
}

/**
 * The box for a reply on `comment`. A reply box on that comment closed with
 * its reply still on its way is opened again, rather than starting a second
 * reply. A reply on a dismissed comment reopens it with its first save, as
 * **Reopen & Reply** always has.
 */
export function replyBox(
  target: ReviewTarget,
  comment: ReviewComment,
): CommentBox {
  const live = liveBoxFor(target, comment.id, ["reply"]);
  if (live && !live.isOpen) return live;
  const replyId = newReviewId();
  const reopen = !!comment.resolved;
  return new CommentBox(
    {
      kind: "reply",
      target,
      commentId: comment.id,
      replyId,
      label: "Reply",
    },
    {
      create: (text) => saveNewReply(target, comment.id, replyId, text, reopen),
      update: (text) => saveReplyText(target, comment.id, replyId, text),
      asNew: asNewComment(target, comment),
    },
  );
}

/**
 * Make `box` write inside a server-held editing session
 * (`lib/commentSession.ts`): the session is begun when the box opens, every
 * text save waits for its acknowledgement and names it, and it finishes once
 * the closed box is quiet. A stale acknowledgement (the root changed since it
 * was shown) puts the server's text in the box and keeps what was typed apart.
 */
function attachEditingSession(
  box: CommentBox,
  target: ReviewTarget,
  onSaved: OnSaved | undefined,
  known: Known,
  opening: () => { isNew: boolean; openingText: string },
): void {
  const build = (): CommentSession => {
    const { isNew, openingText } = opening();
    const shownVersion = known.version;
    return new CommentSession({
      api: sessionApiFor(target, box.subject.commentId),
      commentId: box.subject.commentId,
      isNew,
      openingText,
      shownVersion,
      onReview: (data) => {
        if (data) onSaved?.(target, data);
      },
      onAck: (ack) => {
        if (ack.stale && ack.comment) box.adoptServerText(ack.comment.comment);
      },
      replyCount: () => known.replies,
    });
  };
  box.attachSession(build(), build);
}

/** What the box last saw of its comment on the server. */
interface Known {
  version: string;
  replies: number;
}

/** `onSaved`, also noting the comment's wording version and reply count. */
function watching(
  onSaved: OnSaved | undefined,
  known: Known,
  commentId: string,
): OnSaved {
  return (target, data) => {
    const c = data?.comments.find((x) => x.id === commentId);
    if (c) {
      known.version = c.root_text_version ?? "";
      known.replies = c.reactions?.length ?? 0;
    }
    onSaved?.(target, data);
  };
}
