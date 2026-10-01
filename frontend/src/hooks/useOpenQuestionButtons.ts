/**
 * The one-click Open Question answer — `docs/reference/inline-markup.md`,
 * "The one-click Open Question answer".
 *
 * `rehypeVantageDirectives` compiles `<!-- vantage: question leaning="…" -->`,
 * and the deprecated `oq` it replaces, into `data-vantage-question` and
 * `data-vantage-leaning` on the block that follows it. This post-render pass
 * finds every question that is open and gives it one row of controls, at the
 * end of the question: **Take this leaning**, whose click calls the
 * `addComment` the comment popover already calls, and **Answer…**, which opens
 * that popover on the same block. A 🔒 or ✅ question gets no row, whichever
 * name declared it. Nothing downstream is new: the comment rides `runCommand`
 * to `POST /review/comments`, appears in the panel, and reaches the agent
 * through the ordinary clipboard payload.
 *
 * **A comment on a question is its answer.** Once the question has a comment
 * still pending for the agent anywhere in its unit — a take, an Answer…, or a
 * comment typed on any of its blocks — the row says it is answered instead of
 * offering the take (the user's ruling of 2026-10-01: picking any spot in the
 * question to comment on is the human's answer, which goes to the agent). What
 * a question offers is one rule, `questionOffer`, which the planning card reads
 * too, and which shows a chip exactly while a comment on the question is
 * pending: the rule the planning page's need-you counts apply.
 *
 * A SIBLING of `useReviewHighlights` rather than part of it. That effect returns
 * early when there are no comments, and again when none are unresolved — the
 * normal state of a fresh review, and exactly when a one-click answer matters
 * most. Code added inside it would be dead on the documents this feature exists
 * for.
 */

import { useLayoutEffect, type RefObject } from "react";
import {
  VANTAGE_LEANING_ATTRIBUTE,
  VANTAGE_OQ_HOST_TARGETS,
  questionOffersTake,
  vantageOqStatus,
} from "vantage-md";
import {
  NEIGHBOR_RADIUS,
  anchorBlockWithin,
  buildWholeBlockAnchor,
  indexBlocks,
  resolveCommentBlock,
  type BlockIndex,
  REVIEW_UI_SELECTOR,
} from "../lib/reviewAnchor";
import { isStaticMode } from "../lib/staticMode";
import { isPendingForAgent } from "../stores/useReviewStore";
import type { CommentAnchor, ReviewComment } from "../types";
// A cycle, and an inert one: the outline imports `documentQuestions` from
// here, and both modules export only functions, which neither calls at load.
// The column's reading of a question's state is the one this pass must share,
// so it is imported rather than written a second time.
import { questionLabel } from "./useDocumentOutline";

/**
 * Marks every node this hook injects. Two jobs: the sweep at the top of each
 * pass finds them, and `REVIEW_UI_SELECTOR` in `reviewAnchor.ts` excludes them
 * from block hashes — without which the button would change the hash of the
 * block it sits in and make every comment anchored there read as drifted.
 *
 * A document cannot forge it: `data-*` is not on the sanitizer's `*` allowlist
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
 * Shown in place of the button once the agent has replied to a take, while
 * the question is still open: the take is no longer the answer waiting on the
 * agent, so the question needs the human again, and offers Answer… beside it.
 */
export const OQ_TAKEN_REPLIED_LABEL = "Leaning taken — the agent replied";

/** The same, once the reviewer dismissed the take without a reply. */
export const OQ_TAKEN_DISMISSED_LABEL = "Leaning taken — dismissed";

/** The tooltip of a dismissed take's chip. */
export const OQ_TAKEN_DISMISSED_HINT =
  "You dismissed this take, so it no longer answers the question. Answer it, or Undo the take to offer it again.";

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

/** The control that opens the comment popover on the question, as the card's does. */
export const OQ_ANSWER_LABEL = "Answer…";

/**
 * Shown in place of the controls once a comment other than a take answers the
 * question: the human has answered, and the agent has not yet.
 */
export const OQ_ANSWERED_LABEL = "Answered — waiting on the agent";

/** The answered chip's tooltip: what made it answered, and where to change it. */
export const OQ_ANSWERED_HINT =
  "A review comment on this question is your answer, and it is waiting on the agent. Edit or delete the comment to change it.";

/**
 * Blocks the affordance may live inside.
 *
 * `pre` and `table` are anchorable, and the plugin will stamp them, but neither
 * can host a button: inside a `<pre>` it renders as part of the code, and a
 * `<button>` child of `<table>` is not even valid HTML — the parser hoists it
 * out of the table. A directive on one of those yields no button at all, which
 * is D6 (degrade to plain, never to broken), not an optimization.
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

/**
 * Open the comment popover on a question's host block, near `rect`: the
 * anchor and the fallback text a take would file, so an answer typed there is
 * the comment the planning card's Answer… files.
 */
export type AnswerQuestion = (
  anchor: CommentAnchor,
  fallbackText: string,
  rect: DOMRect,
) => void;

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
 *   — its identity *is* the leaning text. Matching the anchor alone would call
 *   any comment on the paragraph a take, and only a take gets Undo: Undo on a
 *   comment the reviewer typed would delete words they cannot get back.
 * - **the block hash**, because matching the text alone would retire it for an
 *   identical leaning taken on a different question.
 * - **a whole-block selection**, because a take never anchors to a sub-range.
 *
 * The line is a **tolerance, not an equality** — `NEIGHBOR_RADIUS`, the same
 * radius `useReviewHighlights` re-anchors within. Exact equality here is what
 * put a chip and a live button on one paragraph: insert a line above an `oq`
 * block and the highlighter's neighbor walk still found the comment while this
 * function decided the leaning had never been taken. It stays a tolerance rather
 * than being dropped entirely so that two identical questions carrying identical
 * leanings, far apart in one document, keep separate buttons.
 *
 * `resolved` is ignored on purpose: dismissing a taken leaning must not re-arm
 * the button, or the reviewer gets a fresh duplicate for a thread they closed.
 * Undo is what re-arms it, and unlike the delete this used to point at, Undo is
 * beside the chip rather than at the top of the document.
 */
export function findTaken(
  comments: readonly ReviewComment[],
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
 * Where a question's **unit** starts: the list item holding it, or, outside a
 * list, the block its directive stamped — the line the planning index names
 * `unitLine` (`planningAgreement.test.tsx` holds the two equal). A list item
 * outside `root`, which a card's embedded viewer can sit in, is not the
 * question's. `questionUnitBlocks` gives the whole unit.
 */
export function questionUnit(
  stamped: HTMLElement,
  root?: HTMLElement,
): HTMLElement {
  const item = stamped.closest<HTMLElement>("li");
  return item !== null && (root === undefined || root.contains(item))
    ? item
    : stamped;
}

const HEADING = /^H([1-6])$/;

/**
 * A question's whole **unit**, as blocks of the page: the list item holding
 * it, or, outside a list, the block its directive stamped and the blocks after
 * it in the same parent — its context, its options, its leaning, its Answer —
 * up to the first heading (when the host is a heading, the first of the same
 * or a higher level, so it runs to the end of its section), thematic break,
 * or block that is or holds another question's host. The planning index's
 * `unitLine` to `unitEndLine` span the same blocks (`unitEnd` in the scan;
 * `planningAgreement.test.tsx` holds the two equal).
 *
 * What the review UI and the card put among the blocks is skipped, as the
 * footnotes section at the end of the page is: it is hoisted there, and the
 * scan does not read it as a sibling. `questions` is every question in
 * `root` (`documentQuestions`), which one is passed when the caller already
 * holds it.
 */
export function questionUnitBlocks(
  stamped: HTMLElement,
  root: HTMLElement,
  questions: readonly DocumentQuestion[] = documentQuestions(root),
): HTMLElement[] {
  const head = questionUnit(stamped, root);
  if (head !== stamped) return [head];
  const others = questions
    .map((q) => q.stamped)
    .filter((other) => other !== stamped);
  const holdsHost = (el: Element): boolean =>
    others.some((other) => other === el || el.contains(other));
  const depth = HEADING.exec(stamped.tagName)?.[1];
  const blocks = [stamped];
  for (
    let el = stamped.nextElementSibling;
    el !== null;
    el = el.nextElementSibling
  ) {
    if (!(el instanceof HTMLElement) || el.matches(REVIEW_UI_SELECTOR)) {
      continue;
    }
    if (el.matches("section[data-footnotes], .footnotes")) break;
    const level = HEADING.exec(el.tagName)?.[1];
    if (
      level !== undefined &&
      (depth === undefined || Number(level) <= Number(depth))
    ) {
      break;
    }
    if (el.tagName === "HR" || holdsHost(el)) break;
    blocks.push(el);
  }
  return blocks;
}

/**
 * Which question each comment is on: the innermost question unit holding the
 * block its anchor resolves to (`resolveCommentBlock`), so a comment in a
 * question nested inside another question's list item is the nested one's. A
 * comment no unit holds is on no question.
 *
 * `questions` is every question in `root`, in every state: a comment inside a
 * ✅ question nested under an open one is the ✅ one's, though only the open
 * one has a row. The planning card asks the same of its own rendered block,
 * and hands over the `index` it has already built.
 */
export function commentsOnQuestions(
  root: HTMLElement,
  questions: readonly DocumentQuestion[],
  comments: readonly ReviewComment[],
  index?: BlockIndex,
): Map<DocumentQuestion, ReviewComment[]> {
  const out = new Map<DocumentQuestion, ReviewComment[]>();
  if (questions.length === 0 || comments.length === 0) return out;
  const byUnit = new Map<HTMLElement, DocumentQuestion>();
  for (const question of questions) {
    // Two questions in one list item share it; the first owns it, as the
    // planning page's placement keeps the first of two equal units.
    for (const block of questionUnitBlocks(question.stamped, root, questions)) {
      if (!byUnit.has(block)) byUnit.set(block, question);
    }
  }
  const blocks = index ?? indexBlocks(root);
  for (const comment of comments) {
    const block = resolveCommentBlock(blocks, comment.anchor);
    for (let n = block; n !== null && n !== root; n = n.parentElement) {
      const question = byUnit.get(n);
      if (question === undefined) continue;
      const list = out.get(question);
      if (list === undefined) out.set(question, [comment]);
      else list.push(comment);
      break;
    }
  }
  return out;
}

/**
 * Where a question's row goes: at the end of its unit, so the controls come
 * after everything the question says — its options, its leaning, its
 * `**Answer:**` — rather than between the leaning and the answer, where the
 * directive's block usually is. In a list item, or a quote whose first
 * paragraph is the host and which is the whole question, the row is the
 * unit's last child, so it keeps the item's indent and stays inside the
 * quote; a question outside a list gets the row as the next sibling of its
 * last block (`questionUnitBlocks`), however many blocks it runs over.
 */
function rowPlace(
  question: DocumentQuestion,
  root: HTMLElement,
  questions: readonly DocumentQuestion[],
): { inside: HTMLElement } | { after: HTMLElement } {
  const blocks = questionUnitBlocks(question.stamped, root, questions);
  const last = blocks[blocks.length - 1] ?? question.block;
  return blocks.length === 1 &&
    last !== question.block &&
    last.contains(question.block)
    ? { inside: last }
    : { after: last };
}

/**
 * The row every OQ affordance lives in.
 *
 * A row rather than a trailing inline node, and outside the host block, for
 * four measured reasons:
 *
 * - **it stops interrupting the sentence.** Appended to the block, the control
 *   landed after the question's last word — and inside a blockquote it landed
 *   before typography's generated closing quotation mark (`content: close-quote`
 *   on the paragraph's `::after`), so it read as part of the quote.
 * - **it has room for more than one control.** Take this leaning and Answer…,
 *   or the taken chip and Undo; inline nodes trailing a paragraph wrap
 *   independently of each other.
 * - **it leaves the host block's subtree alone**, so no injected node can
 *   perturb the block text a hash is taken over. It still carries
 *   `OQ_BUTTON_ATTR`, which `REVIEW_UI_SELECTOR` names — a list item's hash
 *   reads past it — and the container's click handler bails on.
 * - **as the host's sibling, it is the shape the inline comment card already
 *   uses** (`insertInlineCommentAfter`), including `joinToneRun` — without
 *   which a row inserted between two members of a toned section punches a
 *   hole in the section's rule.
 *
 * Where it goes is `rowPlace`. Not the gutter. A per-block gutter control was
 * built and deleted (`7652eb7`, `docs/design/review-mode.md`): its hit zone
 * broke on tall blocks, and the principle adopted in its place is to pick the
 * natural unit rather than a sub-region. There is also no room — the prose
 * column carries 16-32px of left padding, the tone rule already claims 12px of
 * it, and the scroller's computed `overflow-x: auto` clips anything further
 * left instead of scrolling to it.
 */
function makeRow(
  question: DocumentQuestion,
  root: HTMLElement,
  questions: readonly DocumentQuestion[],
): HTMLElement {
  const row = document.createElement("div");
  row.setAttribute(OQ_BUTTON_ATTR, "row");
  row.className = "review-oq-row";
  const place = rowPlace(question, root, questions);
  if ("inside" in place) {
    // The last child of its unit. A comment card the highlighter inserts
    // after the unit's last block goes before it, so the row stays last.
    row.classList.add("review-oq-row-end");
    place.inside.appendChild(row);
    return row;
  }
  const block = place.after;
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

/** Lucide's `message-square-plus`, which the card's Answer… carries too. */
const ANSWER_ICON_PATHS = [
  "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
  "M12 8v6",
  "M9 11h6",
];

function answerIcon(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [name, value] of [
    ["width", "12"],
    ["height", "12"],
    ["viewBox", "0 0 24 24"],
    ["fill", "none"],
    ["stroke", "currentColor"],
    ["stroke-width", "2"],
    ["stroke-linecap", "round"],
    ["stroke-linejoin", "round"],
    ["aria-hidden", "true"],
  ]) {
    svg.setAttribute(name, value);
  }
  for (const d of ANSWER_ICON_PATHS) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * The two attributes a question directive stamps: `question`'s, on every
 * question whichever name declared it, and `oq`'s, which only the deprecated
 * name adds (`docs/reference/inline-markup.md`). Both, so a page rendered by a
 * pipeline that stamps only `oq` still lists its questions.
 */
const QUESTION_SELECTOR = "[data-vantage-oq], [data-vantage-question]";

/** A stamped directive and the block that will host its affordance. */
export interface DocumentQuestion {
  /** The element the directive stamped — where `data-vantage-leaning` lives. */
  stamped: HTMLElement;
  /** The block the affordance hangs off, and a review anchor resolves to. */
  block: HTMLElement;
}

/**
 * Every Open Question in `el`, whichever directive declared it, on a block that
 * could host a button: each `question` or `oq` directive on a host the button
 * can live in, one per block, in every state.
 *
 * Exported and shared, because three callers ask this question and they must
 * not answer it differently. The contents column lists every result, in every
 * state; the pass below renders a row for each result that `offersTake` (Plan
 * Q5), and counts the takes it offers for the Review toggle; and the planning
 * page finds a question's host inside its card with it. A count that disagrees
 * with the number of buttons is worse than no count — it sends the reader
 * looking for a control that was never there — which is why the count is taken
 * after the `offersTake` filter and the column's list before it.
 *
 * Deliberately free of the review-mode and static gates, and of state. The gates decide
 * whether the *affordance* renders (D4); this decides what exists in the
 * document, which is true either way and is exactly what a reader with review
 * mode off needs told.
 */
export function documentQuestions(el: HTMLElement): DocumentQuestion[] {
  const found: DocumentQuestion[] = [];
  const hosted = new Set<HTMLElement>();
  for (const stamped of el.querySelectorAll<HTMLElement>(QUESTION_SELECTOR)) {
    // Not `stamped` itself. A stamped `blockquote` or `li` shares its
    // `data-source-line` with its own first paragraph, and the highlighter
    // indexes blocks by line with last-write-wins — so it resolves the inner
    // block. Anchoring on the outer one stores a hash of different text and the
    // comment renders divergent the moment it is created.
    const block = anchorBlockWithin(stamped);
    if (!block || !OQ_HOST_TAGS.has(block.tagName)) continue;
    // Two directives can resolve to one block (a stamped `li` and a stamped `p`
    // inside it). One question, one button.
    if (hosted.has(block)) continue;
    hosted.add(block);
    found.push({ stamped, block });
  }
  return found;
}

/**
 * The comment body a take files for a question: the directive's `leaning=`,
 * read off the element it stamped, or `OQ_DEFAULT_LEANING` without one.
 *
 * Exported because a second surface files the same comment. The planning page
 * takes a leaning from a card that renders the question through this same
 * pipeline, and the comment it files must be indistinguishable from this
 * pass's (`docs/reference/planning-index.md` §6.7), so both read the text here,
 * from the rendered element, and neither from the planning index.
 */
export function leaningComment(stamped: HTMLElement): string {
  // Off the STAMPED element, not off the resolved block: they are different
  // elements whenever the directive attached to a container. `?.trim()` plus
  // `||` makes an absent and a whitespace-only attribute behave identically —
  // a comment body of `""` is the "broken" D6 forbids.
  const leaning = stamped.getAttribute(VANTAGE_LEANING_ATTRIBUTE)?.trim();
  return leaning || OQ_DEFAULT_LEANING;
}

/**
 * Whether a question offers Take this leaning: it is open, or carries no
 * marker, which counts as open (Plan Q5, `questionOffersTake`). A 🔒 question
 * cannot be answered yet and a ✅ one has been ruled, so neither has a leaning
 * left to take — whichever name declared it. The state is the marker's alone
 * (`docs/reference/inline-markup.md`), so a question that changes state
 * changes what it offers by its marker and nothing else, and an `oq` on a 🔒
 * question, which `vantage-check` reports (`vantage/question-name`) but a
 * document can carry, offers nothing here, though every viewer before 0.8
 * offers it the button.
 *
 * The state is read exactly as the contents column reads it (`questionLabel`,
 * then the marker before the text), so the column's glyph and the button can
 * never disagree about which state a question is in.
 */
export function offersTake(stamped: HTMLElement): boolean {
  const { marker, text } = questionLabel(stamped);
  return questionOffersTake(vantageOqStatus(marker) ?? vantageOqStatus(text));
}

/**
 * What one open question offers, from its comments: one rule for the
 * document's row and the planning card, so the two never offer different
 * controls for the same question. It shows a chip (`taken`, `answered`)
 * exactly while a comment on the question is pending for the agent, which is
 * when the planning page's need-you counts leave the question out
 * (`lib/planningAnswers.ts`).
 *
 * - **`take`**: nothing answers it. Take this leaning and Answer….
 * - **`taken`**: its own take (`findTaken`) is still pending for the agent:
 *   the *Leaning taken* chip, and Undo while the take is the whole thread.
 * - **`answered`**: another comment on it is pending for the agent — an
 *   Answer…, or any comment typed on one of its blocks: the *Answered —
 *   waiting on the agent* chip, alone. A comment the reviewer typed is not
 *   this control's to delete, and the answer is filed.
 * - **`retake`**: its take is no longer pending — the agent replied, or the
 *   reviewer dismissed it — and nothing else is: the question needs the human
 *   again, so it offers Answer… beside a chip saying what became of the take,
 *   and Undo while the take is still the whole thread. Take this leaning is
 *   not offered again: a second take would be a duplicate of the first.
 */
export type QuestionOffer =
  | { kind: "take" }
  | { kind: "taken"; comment: ReviewComment }
  | { kind: "answered" }
  | { kind: "retake"; comment: ReviewComment; replied: boolean };

/**
 * What an open question offers (`QuestionOffer`). `take` is the comment
 * Take this leaning files and `anchor` its host's whole-block anchor, which
 * identify its take (`findTaken`); `onIt` is every comment on the question
 * (`commentsOnQuestions`).
 */
export function questionOffer(
  anchor: CommentAnchor | null,
  take: string,
  onIt: readonly ReviewComment[],
): QuestionOffer {
  const taken = anchor === null ? undefined : findTaken(onIt, anchor, take);
  if (taken !== undefined && isPendingForAgent(taken)) {
    return { kind: "taken", comment: taken };
  }
  if (onIt.some(isPendingForAgent)) return { kind: "answered" };
  if (taken !== undefined) {
    return {
      kind: "retake",
      comment: taken,
      replied: (taken.reactions ?? []).some((r) => r.actor === "agent"),
    };
  }
  return { kind: "take" };
}

/** Whether Undo may delete a take: only while it is the whole thread. */
export const takeUndoable = (take: ReviewComment): boolean =>
  (take.reactions?.length ?? 0) === 0;

/**
 * Render the row of controls at the end of every open question in the prose
 * container.
 *
 * Idempotent by construction: the pass removes its own previous output before
 * adding any, so a store write (which re-runs it) replaces the rows rather
 * than stacking a second set. `useReviewHighlights`' teardown removes only its
 * own marks and inline cards, so nothing else will do it for us.
 *
 * A layout effect, so a row is in the document's first paint rather than
 * pushing the question's next block down a frame later: late data never moves
 * painted content (`docs/reference/planning-index.md` §12). The comments that
 * arrive after the document only change what the row holds, and every state
 * of it is one line of the same height.
 *
 * `currentContent` is unused in the body and load-bearing in the dep array: a
 * `body` change re-renders `<ReactMarkdown>`, which may discard these foreign
 * nodes, and this is what re-runs the pass to put them back. The highlighter
 * takes the same parameter for the same reason.
 */
export function useOpenQuestionButtons(
  containerRef: RefObject<HTMLDivElement | null>,
  comments: readonly ReviewComment[],
  enabled: boolean,
  currentContent: string | null,
  onTake: TakeLeaning,
  onUndo: UndoLeaning,
  onCount?: (count: number) => void,
  onAnswer?: AnswerQuestion,
): void {
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Before the gates, so flipping review mode off clears what the last pass
    // left behind (D4(a): no button and no trace of one).
    sweep(el);
    // A card's embedded viewer neither renders rows nor reports a count.
    if (!enabled && onCount === undefined) return;

    // Every open question, and none of the 🔒 or ✅ ones (Plan Q5). Filtered
    // here and never inside `documentQuestions`, which the contents column
    // lists from: the column keeps every state, and only the row is withheld.
    // A skipped question gets no row at all — no button, no chip, no Undo.
    const all = documentQuestions(el);
    const on = commentsOnQuestions(el, all, comments);
    const rows = all
      .filter(({ stamped }) => offersTake(stamped))
      .flatMap((question) => {
        const built = buildWholeBlockAnchor(question.block);
        if (built === null) return [];
        const text = leaningComment(question.stamped);
        const state = questionOffer(built.anchor, text, on.get(question) ?? []);
        return [{ question, built, text, state }];
      });
    // The takes on offer: the Review toggle says how many questions here can
    // be answered in one click, and a question already answered is not one.
    //
    // Reported BEFORE the gates, and that is the point: with review mode off
    // there is no button and — until this existed — nothing anywhere saying a
    // one-click answer was on offer at all. A reader looked at three Open
    // Questions carrying leanings and saw three ordinary paragraphs. The count
    // is what makes the affordance discoverable without rendering a control
    // that cannot work (D4).
    onCount?.(rows.filter(({ state }) => state.kind === "take").length);

    // D4. Review mode only — and never where the click cannot be persisted: a
    // static export runs review mode with every write coerced by the axios
    // interceptor into a GET of a file that does not exist, so an ungated button
    // would look live and do nothing. That is worse than no button, because the
    // reviewer believes they answered.
    if (!enabled || isStaticMode()) return;

    for (const { question, built, text, state } of rows) {
      const row = makeRow(question, el, all);

      if (state.kind === "answered") {
        // The answer is filed, and its card holds it: no Undo, because a
        // comment the reviewer typed is not this pass's to delete, and no
        // Answer….
        const chip = document.createElement("span");
        chip.setAttribute(OQ_BUTTON_ATTR, "answered");
        chip.className = "review-oq-answered";
        chip.textContent = OQ_ANSWERED_LABEL;
        chip.title = OQ_ANSWERED_HINT;
        row.appendChild(chip);
        continue;
      }

      if (state.kind === "taken" || state.kind === "retake") {
        const taken = state.comment;
        // A chip, not a disabled button: this stylesheet has no `:disabled`
        // treatment at all, so a disabled button would keep the live look and
        // read as clickable.
        const chip = document.createElement("span");
        chip.setAttribute(OQ_BUTTON_ATTR, "taken");
        chip.className =
          state.kind === "taken"
            ? "review-oq-taken"
            : "review-oq-taken review-oq-taken--past";
        chip.textContent =
          state.kind === "taken"
            ? OQ_TAKEN_LABEL
            : state.replied
              ? OQ_TAKEN_REPLIED_LABEL
              : OQ_TAKEN_DISMISSED_LABEL;
        row.appendChild(chip);

        // Undo is offered only while the take is still the whole thread. Once
        // anyone has replied, deleting the comment would discard the reply with
        // it, and nothing brings a deleted comment back — so the chip says
        // where the thread is rather than offering to destroy it.
        if (!takeUndoable(taken)) {
          chip.title = OQ_ANSWERED_TITLE;
        } else {
          if (state.kind === "retake") chip.title = OQ_TAKEN_DISMISSED_HINT;
          const undo = document.createElement("button");
          undo.setAttribute(OQ_BUTTON_ATTR, "undo");
          undo.type = "button";
          undo.className = "review-oq-undo";
          undo.textContent = OQ_UNDO_LABEL;
          undo.title = "Delete the review comment this button filed";
          undo.addEventListener("click", (e) => {
            claimClick(e);
            // Same one-gesture guard as the take: the store write is
            // synchronous and the next pass replaces this row, so this covers
            // only the window before that commit.
            if (undo.disabled) return;
            undo.disabled = true;
            onUndo(taken.id);
          });
          row.appendChild(undo);
        }
        // A take still waiting on the agent is the answer; one that is not
        // leaves the question to answer again.
        if (state.kind === "taken") continue;
      } else {
        const btn = document.createElement("button");
        btn.setAttribute(OQ_BUTTON_ATTR, "take");
        btn.type = "button";
        btn.className = "review-oq-take";
        btn.textContent = OQ_LABEL;
        btn.title = "Add a review comment taking the leaning stated here";
        btn.addEventListener("click", (e) => {
          // The container's own click handler opens the comment popover, and
          // this click is not a request for that — the same reason
          // `wireCommentButtons` stops propagation on every inline action.
          claimClick(e);
          // The store write is synchronous, so the next pass replaces this
          // button with the taken chip. This guard covers only the window
          // before that commit — a physical double-click delivering two clicks
          // in one gesture.
          if (btn.disabled) return;
          btn.disabled = true;
          onTake(built.anchor, text, built.fallbackText);
        });
        row.appendChild(btn);
      }

      // Last in the row, so the row's other states, which drop it, move
      // nothing that was painted after it.
      if (onAnswer !== undefined) {
        const answer = document.createElement("button");
        answer.setAttribute(OQ_BUTTON_ATTR, "answer");
        answer.type = "button";
        answer.className = "review-oq-answer";
        answer.title = "Write your answer as a review comment on this question";
        answer.append(answerIcon(), OQ_ANSWER_LABEL);
        answer.addEventListener("click", (e) => {
          claimClick(e);
          onAnswer(
            built.anchor,
            built.fallbackText,
            answer.getBoundingClientRect(),
          );
        });
        row.appendChild(answer);
      }
    }

    // Unmount, review mode off, or a file switch: leave no trace. The listeners
    // go with the nodes they were attached to.
    return () => sweep(el);
  }, [
    containerRef,
    comments,
    enabled,
    currentContent,
    onTake,
    onUndo,
    onCount,
    onAnswer,
  ]);
}
