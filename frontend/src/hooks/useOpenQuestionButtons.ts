/**
 * The one-click Open Question answer — `docs/reference/inline-markup.md`,
 * "The one-click Open Question answer".
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
import { VANTAGE_OQ_HOST_TARGETS } from "vantage-md";
import {
  NEIGHBOR_RADIUS,
  anchorBlockWithin,
  buildWholeBlockAnchor,
} from "../lib/reviewAnchor";
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

/** The way back out, beside the chip. Deletes the comment the click created. */
export const OQ_UNDO_LABEL = "Undo";

/**
 * Why an undone leaning cannot be undone from here.
 *
 * A taken leaning with a reply on it is a live thread, and Undo deletes the
 * comment — which would take the reply with it. So the chip renders alone and
 * says where the thread is instead. D4: a control that would destroy something
 * the reviewer cannot get back must not be the one offered.
 */
export const OQ_ANSWERED_TITLE =
  "This leaning was filed as a review comment and has a reply. Open the comment to act on it.";

/**
 * Blocks the affordance may live inside.
 *
 * `pre` and `table` are anchorable, and the plugin will stamp them, but neither
 * can host a button: inside a `<pre>` it renders as part of the code, and a
 * `<button>` child of `<table>` is not even valid HTML — the parser hoists it
 * out of the table. A directive on one of those yields no button at all, which
 * is D6 (degrade to plain, never to broken), not an optimisation.
 *
 * Derived from `VANTAGE_OQ_HOST_TARGETS`, not re-typed: this list and the
 * checker's `oq` branch of `vantage/orphan` are the same question asked twice,
 * and while they were two hand-written copies they disagreed — the checker
 * called an `oq` above a fence fine, this hook rendered nothing, and neither
 * said a word (D5).
 */
const OQ_HOST_TAGS = new Set(
  VANTAGE_OQ_HOST_TARGETS.map((tag) => tag.toUpperCase()),
);

export type TakeLeaning = (
  anchor: CommentAnchor,
  comment: string,
  fallbackText: string,
) => void;

/** Undo a take: delete the comment it created, which re-arms the button. */
export type UndoLeaning = (commentId: string) => void;

function sweep(el: HTMLElement): void {
  el.querySelectorAll(`[${OQ_BUTTON_ATTR}]`).forEach((n) => n.remove());
}

/**
 * The comment a previous take created on this block, if there is one.
 *
 * Returns the comment rather than a boolean because the chip needs its id: Undo
 * deletes it, and a chip that cannot name what it would delete cannot offer the
 * way out.
 *
 * Three clauses identify it, and each is load-bearing:
 *
 * - **the body**, because the comment carries no marker saying a button made it
 *   — its identity *is* the leaning text. Matching the anchor alone would retire
 *   the button because the reviewer typed something else on the same paragraph,
 *   which is the D4(b) failure: the button must never remove the typing path,
 *   and typing must never remove the button.
 * - **the block hash**, because matching the text alone would retire it for an
 *   identical leaning taken on a different question.
 * - **a whole-block selection**, because a take never anchors to a sub-range.
 *
 * The line is a **tolerance, not an equality** — `NEIGHBOR_RADIUS`, the same
 * radius `useReviewHighlights` re-anchors within. Exact equality here is what
 * put a chip and a live button on one paragraph: insert a line above an `oq`
 * block and the highlighter's neighbour walk still found the comment while this
 * function decided the leaning had never been taken. It stays a tolerance rather
 * than being dropped entirely so that two identical questions carrying identical
 * leanings, far apart in one document, keep separate buttons.
 *
 * `resolved` is ignored on purpose: dismissing a taken leaning must not re-arm
 * the button, or the reviewer gets a fresh duplicate for a thread they closed.
 * Undo is what re-arms it, and unlike the delete this used to point at, Undo is
 * beside the chip rather than at the top of the document.
 */
function findTaken(
  comments: ReviewComment[],
  anchor: CommentAnchor,
  text: string,
): ReviewComment | undefined {
  return comments.find(
    (c) =>
      c.comment === text &&
      c.anchor?.block_text_hash === anchor.block_text_hash &&
      c.anchor?.selection_length === 0 &&
      Math.abs(c.anchor.source_line - anchor.source_line) <= NEIGHBOR_RADIUS,
  );
}

/**
 * The row every OQ affordance lives in, inserted as the block's next sibling.
 *
 * A row rather than a trailing inline node, and a sibling rather than a child,
 * for four measured reasons:
 *
 * - **it stops interrupting the sentence.** Appended to the block, the control
 *   landed after the question's last word — and inside a blockquote it landed
 *   before typography's generated closing quotation mark (`content: close-quote`
 *   on the paragraph's `::after`), so it read as part of the quote.
 * - **it has room for more than one control.** The taken state is a chip *and*
 *   an Undo button; two inline nodes trailing a paragraph wrap independently of
 *   each other.
 * - **it leaves the block's subtree alone**, so no injected node can perturb the
 *   block text a hash is taken over. It still carries `OQ_BUTTON_ATTR`, which
 *   `REVIEW_UI_SELECTOR` names and the container's click handler bails on.
 * - **it is the shape the inline comment card already uses**
 *   (`insertInlineCommentAfter`), including `joinToneRun` — without which a row
 *   inserted between two members of a toned section punches a hole in the
 *   section's rule.
 *
 * Not the gutter. A per-block gutter control was built and deleted (`7652eb7`,
 * `docs/design/review-mode.md`): its hit zone broke on tall blocks, and the
 * principle adopted in its place is to pick the natural unit rather than a
 * sub-region. There is also no room — the prose column carries 16-32px of left
 * padding, the tone rule already claims 12px of it, and the scroller's computed
 * `overflow-x: auto` clips anything further left instead of scrolling to it.
 */
function makeRow(block: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.setAttribute(OQ_BUTTON_ATTR, "row");
  row.className = "review-oq-row";
  // Copied off the block, not computed: a row between two stamped members of a
  // section is an unstamped sibling, and the rule's upward bleed cannot span it.
  const tone = block.getAttribute("data-vantage-tone");
  const run = block.getAttribute("data-vantage-run");
  if (tone !== null && (run === "start" || run === "middle")) {
    row.setAttribute("data-vantage-tone", tone);
    row.setAttribute("data-vantage-run", "middle");
  }
  if (block.nextSibling) {
    block.parentNode!.insertBefore(row, block.nextSibling);
  } else {
    block.parentNode!.appendChild(row);
  }
  return row;
}

/** Stop a click on an injected control reaching the popover handler. */
function claimClick(e: Event): void {
  e.stopPropagation();
  e.preventDefault();
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
  onUndo: UndoLeaning,
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

      const taken = findTaken(comments, built.anchor, text);
      const row = makeRow(block);

      if (taken !== undefined) {
        // A chip, not a disabled button: this stylesheet has no `:disabled`
        // treatment at all, so a disabled button would keep the live look and
        // read as clickable.
        const chip = document.createElement("span");
        chip.setAttribute(OQ_BUTTON_ATTR, "taken");
        chip.className = "review-oq-taken";
        chip.textContent = OQ_TAKEN_LABEL;
        row.appendChild(chip);

        // Undo is offered only while the take is still the whole thread. Once
        // anyone has replied, deleting the comment would discard the reply with
        // it, and nothing brings a deleted comment back — so the chip says
        // where the thread is rather than offering to destroy it.
        if ((taken.reactions?.length ?? 0) > 0) {
          chip.title = OQ_ANSWERED_TITLE;
          continue;
        }

        const undo = document.createElement("button");
        undo.setAttribute(OQ_BUTTON_ATTR, "undo");
        undo.type = "button";
        undo.className = "review-oq-undo";
        undo.textContent = OQ_UNDO_LABEL;
        undo.title = "Delete the review comment this button filed";
        undo.addEventListener("click", (e) => {
          claimClick(e);
          // Same one-gesture guard as the take: the store write is synchronous
          // and the next pass replaces this row, so this covers only the window
          // before that commit.
          if (undo.disabled) return;
          undo.disabled = true;
          onUndo(taken.id);
        });
        row.appendChild(undo);
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
        claimClick(e);
        // The store write is synchronous, so the next pass replaces this button
        // with the taken chip. This guard covers only the window before that
        // commit — a physical double-click delivering two clicks in one gesture.
        if (btn.disabled) return;
        btn.disabled = true;
        onTake(built.anchor, text, built.fallbackText);
      });
      row.appendChild(btn);
    }

    // Unmount, review mode off, or a file switch: leave no trace. The listeners
    // go with the nodes they were attached to.
    return () => sweep(el);
  }, [containerRef, comments, enabled, currentContent, onTake, onUndo]);
}
