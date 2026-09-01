/**
 * The one-click Open Question answer — `docs/design/inline-markup.md` §5.2.
 *
 * `rehypeVantageDirectives` compiles `<!-- vantage: oq leaning="…" -->` into
 * `data-vantage-oq` / `data-vantage-leaning` on the block that follows it. This
 * post-render pass finds those blocks and hangs one button off each, whose click
 * calls the `addComment` the comment popover already calls. Nothing downstream
 * is new: the comment rides `runCommand` to `POST /review/comments`, appears in
 * the panel, and reaches the agent through the ordinary clipboard payload.
 *
 * A SIBLING of `useReviewHighlights` rather than part of it. That effect returns
 * early when there are no comments, and again when none are unresolved — the
 * normal state of a fresh review, and exactly when a one-click answer matters
 * most. Code added inside it would be dead on the documents this feature exists
 * for.
 */

import { useEffect, type RefObject } from "react";
import { anchorBlockWithin, buildWholeBlockAnchor } from "../lib/reviewAnchor";
import { isStaticMode } from "../lib/staticMode";
import type { CommentAnchor, ReviewComment } from "../types";

/**
 * Marks every node this hook injects. Two jobs: the sweep at the top of each
 * pass finds them, and `REVIEW_UI_SELECTOR` in `reviewAnchor.ts` excludes them
 * from block hashes — without which the button would change the hash of the
 * block it sits in and make every comment anchored there read as drifted.
 *
 * A document cannot forge it: `data-*` is not on the sanitiser's `*` allowlist
 * and `button` is not an allowed tag name.
 */
const OQ_BUTTON_ATTR = "data-vantage-oq-button";

/** The label, and the directive key it deliberately rhymes with (`leaning=`). */
export const OQ_LABEL = "Take this leaning";

/** Used verbatim as the comment body when the directive carries no `leaning`. */
export const OQ_DEFAULT_LEANING = "Take the stated leaning.";

/** Shown in place of the button once this leaning has been taken. */
export const OQ_TAKEN_LABEL = "Leaning taken";

/**
 * Blocks the affordance may live inside.
 *
 * `pre` and `table` are anchorable, and the plugin will stamp them, but neither
 * can host a button: inside a `<pre>` it renders as part of the code, and a
 * `<button>` child of `<table>` is not even valid HTML — the parser hoists it
 * out of the table. A directive on one of those yields no button at all, which
 * is D6 (degrade to plain, never to broken), not an optimisation.
 */
const OQ_HOST_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "BLOCKQUOTE",
]);

export type TakeLeaning = (
  anchor: CommentAnchor,
  comment: string,
  fallbackText: string,
) => void;

function sweep(el: HTMLElement): void {
  el.querySelectorAll(`[${OQ_BUTTON_ATTR}]`).forEach((n) => n.remove());
}

/**
 * Whether this exact leaning has already been taken on this exact block.
 *
 * Both halves matter. Matching the anchor alone would retire the button because
 * the reviewer typed something *else* on the same paragraph, which is the D4(b)
 * failure — the button must never remove the typing path, and typing must never
 * remove the button. Matching the text alone would retire it because an
 * identical leaning was taken on a different question.
 *
 * `resolved` is ignored on purpose: dismissing a taken leaning must not re-arm
 * the button, or the reviewer gets a fresh duplicate for a thread they closed.
 * Deleting the comment does re-arm it, which is the same escape hatch the rest
 * of the review UI offers.
 */
function alreadyTaken(
  comments: ReviewComment[],
  anchor: CommentAnchor,
  text: string,
): boolean {
  return comments.some(
    (c) =>
      c.comment === text &&
      c.anchor?.source_line === anchor.source_line &&
      c.anchor?.block_text_hash === anchor.block_text_hash &&
      c.anchor?.selection_length === 0,
  );
}

/**
 * Render the "Take this leaning" affordance for every `[data-vantage-oq]` block
 * in the prose container.
 *
 * Idempotent by construction: the pass removes its own previous output before
 * adding any, so a store write (which re-runs it) replaces the buttons rather
 * than stacking a second set. `useReviewHighlights`' teardown removes only its
 * own marks and inline cards, so nothing else will do it for us.
 *
 * `currentContent` is unused in the body and load-bearing in the dep array: a
 * `body` change re-renders `<ReactMarkdown>`, which may discard these foreign
 * nodes, and this is what re-runs the pass to put them back. The highlighter
 * takes the same parameter for the same reason.
 */
export function useOpenQuestionButtons(
  containerRef: RefObject<HTMLDivElement | null>,
  comments: ReviewComment[],
  enabled: boolean,
  currentContent: string | null,
  onTake: TakeLeaning,
): void {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Before the gates, so flipping review mode off clears what the last pass
    // left behind (D4(a): no button and no trace of one).
    sweep(el);

    // D4. Review mode only — and never where the click cannot be persisted: a
    // static export runs review mode with every write coerced by the axios
    // interceptor into a GET of a file that does not exist, so an ungated button
    // would look live and do nothing. That is worse than no button, because the
    // reviewer believes they answered.
    if (!enabled || isStaticMode()) return;

    const hosted = new Set<HTMLElement>();
    for (const stamped of el.querySelectorAll<HTMLElement>(
      "[data-vantage-oq]",
    )) {
      // Not `stamped` itself. A stamped `blockquote` or `li` shares its
      // `data-source-line` with its own first paragraph, and the highlighter
      // indexes blocks by line with last-write-wins — so it resolves the inner
      // block. Anchoring on the outer one stores a hash of different text and
      // the comment renders divergent the moment it is created.
      const block = anchorBlockWithin(stamped);
      if (!block || !OQ_HOST_TAGS.has(block.tagName)) continue;
      // Two directives can resolve to one block (a stamped `li` and a stamped
      // `p` inside it). One question, one button.
      if (hosted.has(block)) continue;
      hosted.add(block);

      const built = buildWholeBlockAnchor(block);
      if (!built) continue;

      // Off the STAMPED element, not off the resolved block: they are different
      // elements whenever the directive attached to a container.
      const leaning = stamped.getAttribute("data-vantage-leaning")?.trim();
      // `?.trim()` plus `||` makes an absent and a whitespace-only attribute
      // behave identically — a comment body of `""` is the "broken" D6 forbids.
      const text = leaning || OQ_DEFAULT_LEANING;

      if (alreadyTaken(comments, built.anchor, text)) {
        // A chip, not a disabled button: this stylesheet has no `:disabled`
        // treatment at all, so a disabled button would keep the live look and
        // read as clickable.
        const taken = document.createElement("span");
        taken.setAttribute(OQ_BUTTON_ATTR, "taken");
        taken.className = "review-oq-taken";
        taken.textContent = OQ_TAKEN_LABEL;
        block.appendChild(taken);
        continue;
      }

      const btn = document.createElement("button");
      btn.setAttribute(OQ_BUTTON_ATTR, "take");
      btn.type = "button";
      btn.className = "review-oq-take";
      btn.textContent = OQ_LABEL;
      btn.title = "Add a review comment taking the leaning stated here";
      btn.addEventListener("click", (e) => {
        // The container's own click handler opens the comment popover, and this
        // click is not a request for that — the same reason
        // `wireCommentButtons` stops propagation on every inline action.
        e.stopPropagation();
        e.preventDefault();
        // The store write is synchronous, so the next pass replaces this button
        // with the taken chip. This guard covers only the window before that
        // commit — a physical double-click delivering two clicks in one gesture.
        if (btn.disabled) return;
        btn.disabled = true;
        onTake(built.anchor, text, built.fallbackText);
      });
      block.appendChild(btn);
    }

    // Unmount, review mode off, or a file switch: leave no trace. The listeners
    // go with the nodes they were attached to.
    return () => sweep(el);
  }, [containerRef, comments, enabled, currentContent, onTake]);
}
