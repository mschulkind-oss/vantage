import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  VANTAGE_OQ_STATUS,
  VANTAGE_OQ_STATUS_LABEL,
  vantageOqStatus,
  type VantageOqStatus,
} from "vantage-md";

import { COLLAPSED_ATTR } from "../lib/collapseSections";
import { answerableOpenQuestions } from "./useOpenQuestionButtons";

/**
 * One entry in the table of contents: a heading, or an Open Question awaiting a
 * ruling.
 *
 * Both kinds live in one list because they are one outline. A reader opening a
 * design document asks two questions — what is in here, and is there anything
 * for me to do — and answering the second in a separate panel would mean
 * discovering it separately too.
 */
export interface OutlineEntry {
  /** Which kind of entry this is. `question` entries carry a `status`. */
  kind: "heading" | "question";
  /**
   * The `#slug` that addresses this entry, or `""` for a question whose
   * directive carried no `id=`.
   *
   * Empty is a real state rather than a defect: `id` is optional on an `oq`
   * directive, and a question nobody cross-references never needs one. Such an
   * entry still appears — see [collectOutline] on why dropping it would be
   * worse — it just renders without a link.
   */
  id: string;
  /** What the entry reads as: a heading's text, or a question's title. */
  text: string;
  /** The status emoji exactly as the document wrote it, e.g. `💬` or `💬 🤷`. */
  marker: string;
  /** The state that marker names, or `null` when the question carries none. */
  status: VantageOqStatus | null;
  /** 1–6 for a heading, as in h1–h6; one step deeper for a question. */
  level: number;
  /**
   * The element this entry *is*: what scrolling goes to, and what the active
   * highlight measures. For a heading that is the heading; for a question it is
   * the enclosing list item, **not** the element the directive stamped.
   *
   * One element for both jobs on purpose. The stamped element is the leaning
   * paragraph (see [questionLabel]), so measuring it while scrolling to the item
   * put the two ~90px apart: clicking a question scrolled it into view and then
   * highlighted the *previous* entry, because the leaning had not yet crossed
   * the active band.
   *
   * Held rather than re-resolved, because a question may have no id to
   * re-resolve by, and because the list is rebuilt on every mutation anyway — a
   * reference that has gone stale fails the `offsetParent` test in
   * [measureEntryOffsets] exactly as a missing id would.
   */
  element: HTMLElement;
}

/**
 * How far below the top of the scroll container a heading has to be before it
 * stops counting as "the section being read". Generous on purpose: a heading
 * scrolled just past the top edge is still the one the reader is inside.
 */
const ACTIVE_BAND = 96;

/**
 * The convention's declaration site for a question: a bold run whose text opens
 * with the stable id.
 *
 * Looser than `VANTAGE_OQ_ID`, deliberately. That grammar decides what becomes
 * an anchor; this one only has to *recognize a title in prose*, which a document
 * may have written with a lowercase prefix or a typo. Failing to recognize it
 * costs a readable label, so the loose form is the safer error.
 */
const OQ_TITLE = /^OQ-[A-Za-z0-9]*\d/;

/** Every heading and tagged question in `container`, in document order. */
export function collectOutline(container: HTMLElement): OutlineEntry[] {
  // One pass over one selector, because the DOM returns document order for free.
  // Two collectors merged afterwards would have to reconstruct that order, and
  // would reconstruct it from positions the browser had already computed.
  const questions = new Set<HTMLElement>();
  for (const { stamped } of answerableOpenQuestions(container)) {
    questions.add(stamped);
  }

  const out: OutlineEntry[] = [];
  let lastHeadingLevel = 0;
  for (const el of container.querySelectorAll<HTMLElement>(
    "h1, h2, h3, h4, h5, h6, [data-vantage-oq]",
  )) {
    const depth = HEADING_LEVELS[el.tagName];
    if (depth !== undefined) {
      // Headings with no id are skipped — there is nothing to link to. A
      // question with no id is not, because unlike a heading it is *the thing
      // the reader is looking for*: the contents column and the review buttons
      // are the same set by construction (see `answerableOpenQuestions`), and a
      // column listing four questions against five buttons is the disagreement
      // that shared function exists to prevent.
      if (!el.id) continue;
      lastHeadingLevel = depth;
      out.push({
        kind: "heading",
        id: el.id,
        text: headingText(el),
        marker: "",
        status: null,
        level: depth,
        element: el,
      });
      continue;
    }

    // A stamped element the button pass would skip — a `pre` or a `table`, or
    // the outer one of two directives resolving to a single block. Listing it
    // would promise an action that is not on offer.
    if (!questions.has(el)) continue;

    const { marker, text } = questionLabel(el);
    out.push({
      kind: "question",
      id: el.id,
      text,
      marker,
      status: vantageOqStatus(marker) ?? vantageOqStatus(text),
      // One step under the heading it falls beneath, so the outline stays
      // truthful about where in the document the question lives. A question
      // before any heading sits at the top level, because it is under nothing.
      level: lastHeadingLevel + 1,
      element: el.closest("li") ?? el,
    });
  }
  return out;
}

/** Tag name → depth, so the collector's hot loop does no string arithmetic. */
const HEADING_LEVELS: Record<string, number | undefined> = {
  H1: 1,
  H2: 2,
  H3: 3,
  H4: 4,
  H5: 5,
  H6: 6,
};

/**
 * A question's status emoji and title, read from the *title* paragraph.
 *
 * Not from the element passed in, which is the one the directive stamped — and in
 * the layout the convention prescribes that is the **leaning**, because the
 * directive sits between the title and the leaning:
 *
 * ```html
 * <li>
 *   <p>💬 <strong>OQ-B1: The generator's command surface.</strong> …</p>
 *   <p data-vantage-oq="true" id="OQ-B1"><em>Leaning:</em> …</p>
 * </li>
 * ```
 *
 * Reading the label off `stamped` yields "Leaning: back of the queue" for every
 * entry in the column — plausible-looking and uniformly useless. So the search
 * is scoped to the enclosing list item and looks for the bold run that opens
 * with the id, which is the same declaration site `linked-references.md` names.
 *
 * A question written as a bare paragraph has no title to find; it falls back to
 * its own text, which the column clamps.
 */
export function questionLabel(stamped: HTMLElement): {
  marker: string;
  text: string;
} {
  const scope = stamped.closest("li") ?? stamped;
  for (const strong of scope.querySelectorAll("strong")) {
    const text = flatten(strong.textContent);
    if (!OQ_TITLE.test(text)) continue;
    return { marker: markerBefore(strong), text };
  }
  const text = flatten(scope.textContent);
  return { marker: leadingMarker(text), text };
}

/**
 * One line of text from something the author wrapped across several.
 *
 * A title written over two source lines keeps the newline in `textContent`, and
 * that newline reaches the `title` tooltip and the accessible name — both of
 * which are single-line surfaces, so it renders as a stray break or a literal
 * gap depending on the platform.
 */
function flatten(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The text between the start of the title's line and the bold run — which is
 * where the convention puts the emoji, and may be more than one of them: a
 * deferred question is written `💬 🤷`.
 */
function markerBefore(strong: Element): string {
  let out = "";
  for (const node of strong.parentElement?.childNodes ?? []) {
    if (node === strong) break;
    out += node.textContent ?? "";
  }
  return out.trim();
}

/**
 * The marker from a question with no bold title: whatever the text opens with,
 * up to the first word character. Lets the bare-paragraph case still show a
 * status rather than silently dropping one the author wrote.
 */
function leadingMarker(text: string): string {
  return /^[^\p{L}\p{N}]*/u.exec(text)?.[0].trim() ?? "";
}

/**
 * A heading's text without its hover anchor. `MarkdownViewer` renders a literal
 * `#` link inside every heading, so plain `textContent` yields "#Overview".
 */
function headingText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  for (const a of clone.querySelectorAll(".heading-anchor")) a.remove();
  return (clone.textContent ?? "").trim();
}

/** One state, and how many of the document's questions are in it. */
export interface QuestionTally {
  /** `null` for questions carrying no marker at all. */
  status: VantageOqStatus | null;
  /** The glyph to show, or `"•"` when the document wrote none. */
  glyph: string;
  count: number;
}

/**
 * How many questions are in each state, in the convention's own order.
 *
 * A single total over one 💬 would be a claim the document does not make. Every
 * listed question is answerable in one click — that is what being tagged means —
 * but a document may have *answered* one and kept its directive, and heading a
 * count of three with the open marker says all three are awaiting a ruling. The
 * breakdown is also the more useful answer to the question a reader is actually
 * asking: one open and two settled is a different document from three open.
 *
 * States with no questions are omitted, so the common case — every question
 * open — renders as one group and looks like the simple count it is.
 */
export function tallyQuestions(entries: OutlineEntry[]): QuestionTally[] {
  const order: (VantageOqStatus | null)[] = [
    "open",
    "settled",
    "blocked",
    null,
  ];
  const counts = new Map<VantageOqStatus | null, number>();
  for (const entry of entries) {
    if (entry.kind !== "question") continue;
    counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
  }
  return order
    .filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => ({
      status,
      glyph: status === null ? "•" : VANTAGE_OQ_STATUS[status],
      count: counts.get(status) ?? 0,
    }));
}

/**
 * The tally in words, for the header's tooltip and its accessible name.
 *
 * It leads with what every listed question has in common, because that is the
 * part a reader cannot see: the entries below are not merely questions, they are
 * the ones the reviewer can answer without typing.
 */
export function tallySentence(tallies: QuestionTally[]): string {
  const total = tallies.reduce((sum, t) => sum + t.count, 0);
  const parts = tallies.map(
    (t) =>
      `${t.count} ${
        t.status === null
          ? "unmarked"
          : VANTAGE_OQ_STATUS_LABEL[t.status]
              .replace(" question", "")
              .toLowerCase()
      }`,
  );
  const head = `${total} question${total === 1 ? "" : "s"} here can be answered in one click`;
  // A single group already says its own state in the glyph beside the number.
  return tallies.length > 1 ? `${head} — ${parts.join(", ")}` : head;
}

/**
 * What an entry is called out loud, for a control whose visible label may be a
 * single emoji. A screen reader announcing "speech bubble, OQ-B1" is worse than
 * one announcing nothing.
 */
export function entryAccessibleName(entry: OutlineEntry): string {
  if (entry.kind === "heading" || entry.status === null) return entry.text;
  return `${VANTAGE_OQ_STATUS_LABEL[entry.status]}: ${entry.text}`;
}

/**
 * Which entry the reader is currently under, given each one's position in the
 * scroll container. Returns the id of the last entry at or above the active
 * band, or the first entry when the reader is above all of them.
 *
 * Exported for the tests: the real thing measures a live layout, which jsdom
 * does not have, so the arithmetic is separated from the measuring.
 */
export function activeEntryId(
  offsets: { id: string; top: number }[],
): string | null {
  if (offsets.length === 0) return null;
  let active = offsets[0].id;
  for (const { id, top } of offsets) {
    if (top > ACTIVE_BAND) break;
    active = id;
  }
  return active;
}

/**
 * Each entry's vertical offset from the top of `container`, for the entries that
 * are actually rendered right now.
 *
 * It skips an entry whose `offsetParent` is null — the standard "is this actually
 * rendered" check — and that is load-bearing rather than defensive. An entry
 * inside a `<!-- vantage: section collapsed=true -->` block is `display: none`
 * while closed, and `getBoundingClientRect()` on a display:none element reports
 * an all-zero rect: a `top` that always satisfies "at or above the active band".
 * Left in, a single collapsed section anywhere in the document would permanently
 * win every later comparison in [activeEntryId] and the active entry would never
 * update past it again.
 *
 * Entries with no id are skipped too — the caller tracks the active entry by id,
 * so an entry that has none cannot be it.
 *
 * Exported for the tests: real visibility and layout are not something jsdom
 * computes, so this is the seam a test can stand in for both by overriding
 * `offsetParent` and `getBoundingClientRect` on plain DOM nodes.
 */
export function measureEntryOffsets(
  container: HTMLElement,
  entries: OutlineEntry[],
): { id: string; top: number }[] {
  const containerTop = container.getBoundingClientRect().top;
  const offsets: { id: string; top: number }[] = [];
  for (const entry of entries) {
    if (!entry.id) continue;
    if (entry.element.offsetParent === null) continue;
    offsets.push({
      id: entry.id,
      top: entry.element.getBoundingClientRect().top - containerTop,
    });
  }
  return offsets;
}

/**
 * The outline of the document inside `containerRef`, and which entry is in view.
 *
 * `enabled` gates the DOM work: when the panel is closed there is nothing to
 * keep in sync, and neither the observer nor the scroll listener is installed.
 *
 * Re-scans on a `MutationObserver`, not just when the document changes. Half of
 * what ends up in the container arrives after the first paint — Mermaid
 * diagrams swap in asynchronously, and live reload replaces the body under a
 * reader who never navigated — so a list built once is a list that goes stale
 * while it is being looked at.
 */
export function useDocumentOutline(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): { entries: OutlineEntry[]; activeId: string | null } {
  const [entries, setEntries] = useState<OutlineEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const frameRef = useRef<number | null>(null);

  const rescan = useCallback(() => {
    const el = containerRef.current;
    setEntries(el ? collectOutline(el) : []);
  }, [containerRef]);

  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    rescan();

    // Coalesced through a frame: a single Mermaid render or a live-reload swap
    // fires many mutations, and re-querying the document for each one is work
    // nobody asked for.
    const observer = new MutationObserver(() => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        rescan();
      });
    });
    // Not just childList. `class` and the collapse flag are what make a
    // rescan run after something reflows the text without touching the DOM
    // tree — the full-width toggle, whose only effect inside this subtree
    // is a `class` change on the content band, and opening or closing a
    // `<!-- vantage: section collapsed=true -->` block, which flips
    // `data-vantage-collapsed` without inserting or removing anything.
    //
    // `id` and `characterData` are what make a rescan run when live reload
    // patches a heading's text in place. React reconciles a heading whose
    // position and tag are unchanged by mutating the existing node rather
    // than replacing it: editing a heading's words changes its rehypeSlug
    // id too, and measured against real React output that update is an
    // `attributes` record on `id` plus a `characterData` record on the text
    // node — neither a childList mutation, so without these two a stale
    // label pointing at a slug the document no longer has would sit in the
    // list until something else happened to trigger a rescan.
    //
    // `data-vantage-oq` is the same case one step further on: adding a
    // directive above a paragraph that is already there stamps the attribute
    // onto the existing element, so a question would not appear in the column
    // until something unrelated happened to trigger a rescan.
    observer.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", COLLAPSED_ATTR, "id", "data-vantage-oq"],
      characterData: true,
    });

    return () => {
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [containerRef, enabled, rescan]);

  useEffect(() => {
    const el = containerRef.current;
    if (!enabled || !el || entries.length === 0) return;

    let ticking = false;
    const measure = () => {
      ticking = false;
      setActiveId(activeEntryId(measureEntryOffsets(el, entries)));
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(measure);
    };

    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    // A window resize reflows the same text without any DOM mutation for the
    // observer above to see — nothing is inserted, removed, or reattributed,
    // just laid out differently. It shares the scroll handler's own
    // debounce, since a resize event fires in the same rapid bursts.
    window.addEventListener("resize", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [containerRef, enabled, entries]);

  // Gated on the way out rather than reset on the way in: a disabled hook that
  // cleared its state in an effect would render one frame of the old list
  // first, and the effects above would then have to race to undo it. Nothing is
  // stale here because nothing is trusted — the active id has to still name an
  // entry that is in the current list.
  if (!enabled) return { entries: [], activeId: null };
  return {
    entries,
    activeId: entries.some((e) => e.id === activeId) ? activeId : null,
  };
}
