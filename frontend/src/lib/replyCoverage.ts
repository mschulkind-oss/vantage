import type { ReviewComment } from "../types";

/**
 * Plain wording for whether a reply was written about the comment's current
 * text (`reply_coverage`, derived by the server). A fact about the wording the
 * reply read, not an outcome: `unknown` stays "coverage unknown" and is never
 * promoted to either side (planning-question-state.md §7).
 */
export function replyCoverageLabel(
  comment: ReviewComment,
  reactionIndex: number,
): string {
  const covers = (comment.reply_coverage ?? []).find(
    (c) => c.reaction_index === reactionIndex,
  )?.covers;
  if (covers === "current") return "reply to the current wording";
  if (covers === "other") return "reply to earlier wording";
  return "coverage unknown";
}

/**
 * The small factual note on a comment the server could not tie to its
 * question's text (`ownership: "unknown"`); null for every other state. It
 * says why, in the words of the reason: a moved anchor is not a missing
 * checker, and neither says the comment has no question (a bound id stays
 * proven by id).
 */
export function ownershipCue(comment: ReviewComment): string | null {
  if (comment.ownership !== "unknown") return null;
  switch (comment.ownership_reason) {
    case "question_not_at_anchor":
      return "anchor moved";
    case "scanner_unavailable":
      return "checker not installed";
    case "scan_refused":
      return "scan refused";
    case "scanner_failed":
      return "checker failed";
    case "scan_raced":
      return "document changed during scan";
    default:
      return "ownership unknown";
  }
}
