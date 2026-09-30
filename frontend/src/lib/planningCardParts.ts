/**
 * How a question's card on the planning page lays out the question it
 * rendered (`docs/design/planning-index.md` §6.3).
 *
 * A card renders its question through the viewer's own pipeline, so it holds
 * exactly the DOM its document holds, and a question written by the
 * convention is dense there: a bold title opening a paragraph of background,
 * a `_Leaning:_` paragraph, and a fill-in `**Answer:**` over
 * `> _(empty — fill in when decided)_`. This pass sorts the question's unit
 * into parts, each named on the element by `CARD_PART_ATTR`, and the
 * stylesheet does the rest:
 *
 * - **`title`**: the bold title, which the card shows as its headline instead
 *   and hides here. **`lede`**: the block the title opens, hidden too when the
 *   title was all it held.
 * - **`leaning`**: the question's `Leaning:` block, drawn as a block of its own
 *   and never folded away.
 * - **`answer`**: a filled-in `Answer:` and what it says, never folded away.
 *   **`placeholder`**: an empty one, which is not shown at all.
 * - **`clamp`**: the first block of what is left, cut to `CARD_CLAMP_LINES`
 *   lines while the card is folded. **`more`**: every later one, hidden while
 *   the card is folded. The card's Show full question unfolds both.
 *
 * Attributes only, and one text node, so nothing here moves a node React
 * owns. The one text node is the status marker before the title (`💬 `),
 * which the headline shows instead: it is emptied, and put back by
 * `unmarkCardParts` before the card reads its question again. It is never
 * touched inside the question's host block, whose text is what an answer's
 * anchor hashes (`buildWholeBlockAnchor`): a card whose marker sits there
 * keeps its title in place and gets no headline. Every other part is a
 * stylesheet rule, and an element hidden by the stylesheet keeps its text, so
 * no anchor, hash or placement reads the card differently from its document.
 */
import { flushSync } from "react-dom";
import { REVIEW_UI_SELECTOR, blockVisibleText } from "./reviewAnchor";
import { LEANING_MARKER } from "vantage-md/planning";

/** Names the part of the question an element is (see the module comment). */
export const CARD_PART_ATTR = "data-planning-card-part";

/** Every value `CARD_PART_ATTR` takes. */
export const CARD_PARTS = [
  "title",
  "lede",
  "leaning",
  "answer",
  "placeholder",
  "clamp",
  "more",
] as const;
export type CardPart = (typeof CARD_PARTS)[number];

/** Marks the `clamp` block while its content runs past the clamp. */
export const CARD_OVERFLOW_ATTR = "data-planning-card-overflow";

/** How many lines of the `clamp` block a folded card shows. */
export const CARD_CLAMP_LINES = 3;

/** What the pass found, for the card to draw around it. */
export interface CardParts {
  /** The title was found and hidden, so the card shows it as its headline. */
  titled: boolean;
  /** The unit has a leaning block of its own, marked `leaning`. */
  leaning: boolean;
  /** The block cut short while folded, if the unit has anything left. */
  clamp: HTMLElement | null;
  /** Some block is hidden while folded (`more`). */
  more: boolean;
}

/** A fill-in answer's label, alone in its block. */
const ANSWER_LABEL = /^answer\s*:?$/i;

/** The convention's empty answer: `_(empty — fill in when decided)_`. */
const EMPTY_ANSWER = /^\(\s*empty\b[^)]*\)$/i;

/** The label and the empty answer in one block. */
const EMPTY_ANSWER_INLINE = /^answer\s*:\s*\(\s*empty\b[^)]*\)$/i;

/** A status marker: emoji and spaces, and no letter or digit (`💬 🤷`). */
const STATUS_MARKER = /^[^\p{L}\p{N}]+$/u;

/** One line of an element's text as its document reads it, badges aside. */
const flatText = (el: HTMLElement): string =>
  blockVisibleText(el).replace(/\s+/g, " ").trim();

/** The marker a headline shows: a status marker, else nothing. */
export function headlineMarker(marker: string): string {
  return STATUS_MARKER.test(marker) ? marker : "";
}

/** The text nodes the pass emptied, by card body, with what they held. */
const emptied = new WeakMap<HTMLElement, { node: Text; text: string }[]>();

/**
 * Undo `markCardParts`: every part, the overflow mark, and every text node it
 * emptied. A node React has since written to is React's again, and left alone.
 */
export function unmarkCardParts(root: HTMLElement): void {
  for (const el of root.querySelectorAll(`[${CARD_PART_ATTR}]`)) {
    el.removeAttribute(CARD_PART_ATTR);
  }
  for (const el of root.querySelectorAll(`[${CARD_OVERFLOW_ATTR}]`)) {
    el.removeAttribute(CARD_OVERFLOW_ATTR);
  }
  for (const { node, text } of emptied.get(root) ?? []) {
    if (node.nodeValue === "") node.nodeValue = text;
  }
  emptied.delete(root);
}

/**
 * The question's bold title in `unit`: the first `strong` whose text is the
 * title the planning index read, which is what the headline says, so the
 * headline and the hidden title can never disagree.
 */
function titleIn(unit: HTMLElement, title: string): HTMLElement | null {
  if (title === "") return null;
  for (const strong of unit.querySelectorAll<HTMLElement>("strong")) {
    if (strong.closest(REVIEW_UI_SELECTOR)) continue;
    if (flatText(strong) === title) return strong;
  }
  return null;
}

/** Whether `node` holds nothing a reader would see: blank text, a badge, a break. */
function blank(node: ChildNode): boolean {
  if (node.nodeType === Node.TEXT_NODE) return !/\S/.test(node.nodeValue ?? "");
  if (!(node instanceof HTMLElement)) return true;
  return node.tagName === "BR" || node.matches(REVIEW_UI_SELECTOR);
}

/** Elements that hold a question's blocks, rather than being one. */
const CONTAINER_TAGS = new Set([
  "LI",
  "BLOCKQUOTE",
  "DIV",
  "DETAILS",
  "SECTION",
  "FIGURE",
]);

const BLOCK_TAGS = new Set([
  ...CONTAINER_TAGS,
  "P",
  "UL",
  "OL",
  "PRE",
  "TABLE",
  "HR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

/** A block of a unit: display math is a `span` beside the unit's paragraphs. */
const isBlock = (el: Element): boolean =>
  BLOCK_TAGS.has(el.tagName) || el.classList.contains("katex-display");

/**
 * Whether `unit` is one block rather than a holder of blocks: a paragraph, a
 * heading, or a list item of a tight list, whose text is its own.
 */
function isLeaf(unit: HTMLElement): boolean {
  if (!CONTAINER_TAGS.has(unit.tagName)) return true;
  for (const node of unit.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (/\S/.test(node.nodeValue ?? "")) return true;
    } else if (node instanceof HTMLElement) {
      if (node.matches(REVIEW_UI_SELECTOR)) continue;
      if (!isBlock(node)) return true;
    }
  }
  return false;
}

/** The child of `unit` holding `el`, or `unit` when `el` is not in a child. */
function childHolding(unit: HTMLElement, el: HTMLElement): HTMLElement {
  let at = el;
  while (at.parentElement !== null && at.parentElement !== unit) {
    at = at.parentElement;
  }
  return at.parentElement === unit ? at : unit;
}

const mark = (el: Element, part: CardPart) =>
  el.setAttribute(CARD_PART_ATTR, part);

/**
 * Sort the question's `unit` into its parts, after the card has isolated it.
 * `host` is the block an answer's anchor is built from, which keeps every one
 * of its text nodes; `title` and `marker` are the planning index's.
 */
export function markCardParts(
  root: HTMLElement,
  unit: HTMLElement,
  host: HTMLElement,
  title: string,
  marker: string,
): CardParts {
  unmarkCardParts(root);
  const leaf = isLeaf(unit);

  // The title, and the block it opens.
  let titled = false;
  let lede: HTMLElement | null = null;
  let ledeLeaning = false;
  const strong = titleIn(unit, title);
  if (strong !== null) {
    const holder = leaf ? unit : childHolding(unit, strong);
    const parent = strong.parentElement!;
    const before = strong.previousSibling;
    // The marker is the text before the title, alone at the start of the
    // title's block, and holding nothing but the marker.
    const markerNode =
      before !== null &&
      before.nodeType === Node.TEXT_NODE &&
      before.previousSibling === null &&
      parent === holder &&
      STATUS_MARKER.test((before.nodeValue ?? "").trim())
        ? (before as Text)
        : null;
    const canEmpty = markerNode !== null && !host.contains(markerNode);
    const rest = Array.from(holder.childNodes).filter(
      (node) => node !== strong && node !== markerNode,
    );
    const nothingLeft = parent === holder && rest.every((node) => blank(node));
    // Hidden, the title must not strand its marker in the body, nor leave a
    // question with nothing to show.
    if ((marker === "" || canEmpty) && !(nothingLeft && holder === unit)) {
      titled = true;
      mark(strong, "title");
      if (canEmpty) {
        const text = markerNode.nodeValue ?? "";
        markerNode.nodeValue = "";
        emptied.set(root, [{ node: markerNode, text }]);
      }
      if (holder !== unit) {
        if (nothingLeft) {
          mark(holder, "lede");
        } else {
          lede = holder;
          // `**OQ-1: …?** _Leaning:_ yes.` is a leaning under a title.
          ledeLeaning = LEANING_MARKER.test(
            flatText(holder).slice(flatText(strong).length).trim(),
          );
        }
      }
    }
  }

  // A question that is one block: it is the body, unless it is a leaning.
  if (leaf) {
    const isLeaning = !titled && LEANING_MARKER.test(flatText(unit));
    if (isLeaning) mark(unit, "leaning");
    else mark(unit, "clamp");
    return {
      titled,
      leaning: isLeaning,
      clamp: isLeaning ? null : unit,
      more: false,
    };
  }

  let leaning = false;
  const body: HTMLElement[] = [];
  const children = Array.from(unit.children).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      !el.matches(REVIEW_UI_SELECTOR) &&
      el.getAttribute(CARD_PART_ATTR) !== "lede",
  );
  for (let i = 0; i < children.length; i++) {
    const el = children[i]!;
    const text =
      el === lede
        ? flatText(el).slice(flatText(strong!).length).trim()
        : flatText(el);
    if (!leaning && (el === lede ? ledeLeaning : LEANING_MARKER.test(text))) {
      leaning = true;
      mark(el, "leaning");
      continue;
    }
    if (el !== lede && EMPTY_ANSWER_INLINE.test(text)) {
      mark(el, "placeholder");
      continue;
    }
    if (el !== lede && EMPTY_ANSWER.test(text)) {
      mark(el, "placeholder");
      continue;
    }
    if (el !== lede && ANSWER_LABEL.test(text)) {
      const next = children[i + 1];
      if (next === undefined || EMPTY_ANSWER.test(flatText(next))) {
        mark(el, "placeholder");
        if (next !== undefined) mark(next, "placeholder");
      } else {
        mark(el, "answer");
        mark(next, "answer");
      }
      i++;
      continue;
    }
    if (el !== lede && /^answer\s*:/i.test(text)) {
      mark(el, "answer");
      continue;
    }
    body.push(el);
  }
  const [first, ...later] = body;
  if (first !== undefined) mark(first, "clamp");
  for (const el of later) mark(el, "more");
  return { titled, leaning, clamp: first ?? null, more: later.length > 0 };
}

/**
 * Whether the `clamp` block runs past `CARD_CLAMP_LINES` lines: measured
 * against the clamp while it is on, and against its line height while the card
 * is unfolded. Where there is no layout (a test's DOM), it does not.
 */
export function overflowsClamp(el: HTMLElement, folded: boolean): boolean {
  if (folded) return el.scrollHeight > el.clientHeight + 1;
  const line = Number.parseFloat(getComputedStyle(el).lineHeight);
  return Number.isFinite(line) && el.scrollHeight > line * CARD_CLAMP_LINES + 1;
}

/** One card's measurement: what it reads of the layout, and what it writes. */
export interface ClampMeasure {
  read: () => boolean;
  write: (overflows: boolean) => void;
}

const pendingMeasures: ClampMeasure[] = [];

/**
 * Measure a card's clamp at the end of the task, with every other card's
 * measured in the same commit: every read, then every write.
 *
 * A page's cards each lay their question out (`markCardParts`, a write) and
 * measure it (`overflowsClamp`, a read) as they commit. Done card by card,
 * each read after another card's writes forced a layout of the page of its
 * own, ten for a page of ten cards. Gathered, the first read lays the page out
 * once and the rest find it laid out. The writes are flushed synchronously,
 * so the answer is still on the page before it paints.
 */
export function measureClampSoon(job: ClampMeasure): void {
  pendingMeasures.push(job);
  if (pendingMeasures.length === 1) queueMicrotask(flushClampMeasures);
}

/** Run every pending measurement now: what the microtask does, and a test. */
export function flushClampMeasures(): void {
  const jobs = pendingMeasures.splice(0);
  if (jobs.length === 0) return;
  const answers = jobs.map((job) => job.read());
  flushSync(() => {
    jobs.forEach((job, i) => job.write(answers[i]!));
  });
}
