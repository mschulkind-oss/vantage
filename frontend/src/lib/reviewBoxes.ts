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
import {
  newReviewId,
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

const told =
  (target: ReviewTarget, onSaved: OnSaved | undefined) =>
  (data: ReviewData | null) => {
    onSaved?.(target, data);
    return data;
  };

/** What saves a new comment, `draft` without its text, to `target`. */
function newCommentOps(
  target: ReviewTarget,
  draft: ReviewComment,
  onSaved?: OnSaved,
): BoxOps {
  const tell = told(target, onSaved);
  return {
    create: (text) =>
      saveNewComment(target, { ...draft, comment: text }).then(tell),
    update: (text) => saveCommentText(target, draft.id, text).then(tell),
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
  return new CommentBox(
    {
      kind: "comment",
      target,
      commentId: draft.id,
      draft,
      label: options.label ?? "New comment",
    },
    {
      ...newCommentOps(target, draft, options.onSaved),
      asNew: asNewComment(target, draft, options.onSaved),
    },
  );
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
): CommentBox {
  const live = liveBoxFor(target, comment.id, ["edit", "comment"]);
  if (live && !live.isOpen && live.subject.kind === "edit") return live;
  const text = live ? live.getState().text : comment.comment;
  if (live && !live.isOpen) live.retire();
  return new CommentBox(
    { kind: "edit", target, commentId: comment.id, label: "Edited comment" },
    {
      update: (t) => saveCommentText(target, comment.id, t),
      asNew: asNewComment(target, comment),
    },
    { text, created: true, saved: comment.comment },
  );
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
