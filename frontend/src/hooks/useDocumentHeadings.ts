import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { COLLAPSED_ATTR } from "../lib/collapseSections";

/** One entry in the table of contents. */
export interface Heading {
  /** The heading's DOM id, which is also the `#slug` that addresses it. */
  id: string;
  /** The heading's visible text, without the trailing `#` anchor link. */
  text: string;
  /** 1–6, as in h1–h6. */
  level: number;
}

/**
 * How far below the top of the scroll container a heading has to be before it
 * stops counting as "the section being read". Generous on purpose: a heading
 * scrolled just past the top edge is still the one the reader is inside.
 */
const ACTIVE_BAND = 96;

/**
 * Read the headings out of a rendered container.
 *
 * The table of contents is built from the DOM rather than from the Markdown
 * source, and that is the load-bearing decision here. The ids it links to are
 * minted late — `rehypeSlug` runs after the sanitiser, `rehypeVantageAnchors`
 * overrides them from `<!-- vantage: anchor -->` directives, and the sanitiser
 * prefixes hand-written ones with `user-content-`. A second slugger over the
 * source would have to reproduce all of that and would drift the moment any of
 * it changed; reading `el.id` cannot disagree with the document by construction.
 * It also gets the rest for free: no headings invented out of `#` inside a
 * fenced code block, and directive-only headings appear exactly as rendered.
 *
 * Headings with no id are skipped — there is nothing to link to.
 */
export function collectHeadings(container: HTMLElement): Heading[] {
  const out: Heading[] = [];
  for (const el of container.querySelectorAll<HTMLElement>(
    "h1, h2, h3, h4, h5, h6",
  )) {
    if (!el.id) continue;
    out.push({
      id: el.id,
      text: headingText(el),
      level: Number(el.tagName[1]),
    });
  }
  return out;
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

/**
 * Which heading the reader is currently under, given each heading's position in
 * the scroll container. Returns the id of the last heading at or above the
 * active band, or the first heading when the reader is above all of them.
 *
 * Exported for the tests: the real thing measures a live layout, which jsdom
 * does not have, so the arithmetic is separated from the measuring.
 */
export function activeHeadingId(
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
 * Each heading's vertical offset from the top of `container`, for the
 * headings that are actually rendered right now.
 *
 * Two things this deliberately does not do, both load-bearing:
 *
 * It resolves each id with `container.querySelector`, not
 * `document.getElementById`. A heading literally titled "Root" slugs to
 * id="root", which collides with the app's own `<div id="root">` mount
 * point; a global lookup would silently resolve to that ancestor of
 * everything, whose position tells this arithmetic nothing useful about
 * where the reader is.
 *
 * It skips a heading whose `offsetParent` is null — the standard "is this
 * actually rendered" check. A heading inside a `<!-- vantage: section
 * collapsed=true -->` block is `display: none` while closed, and
 * `getBoundingClientRect()` on a display:none element reports an all-zero
 * rect: a `top` that always satisfies "at or above the active band". Left
 * in, a single collapsed section anywhere in the document would
 * permanently win every later comparison in `activeHeadingId` and the
 * active entry would never update past it again.
 *
 * Exported for the tests: real visibility and layout are not something
 * jsdom computes, so this is the seam a test can stand in for both by
 * overriding `offsetParent` and `getBoundingClientRect` on plain DOM nodes.
 */
export function measureHeadingOffsets(
  container: HTMLElement,
  headings: Heading[],
): { id: string; top: number }[] {
  const containerTop = container.getBoundingClientRect().top;
  const offsets: { id: string; top: number }[] = [];
  for (const h of headings) {
    const node = container.querySelector<HTMLElement>(`#${CSS.escape(h.id)}`);
    if (node && node.offsetParent !== null) {
      offsets.push({
        id: h.id,
        top: node.getBoundingClientRect().top - containerTop,
      });
    }
  }
  return offsets;
}

/**
 * The headings inside `containerRef`, and which one is currently in view.
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
export function useDocumentHeadings(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): { headings: Heading[]; activeId: string | null } {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const frameRef = useRef<number | null>(null);

  const rescan = useCallback(() => {
    const el = containerRef.current;
    setHeadings(el ? collectHeadings(el) : []);
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
    observer.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", COLLAPSED_ATTR, "id"],
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
    if (!enabled || !el || headings.length === 0) return;

    let ticking = false;
    const measure = () => {
      ticking = false;
      setActiveId(activeHeadingId(measureHeadingOffsets(el, headings)));
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
  }, [containerRef, enabled, headings]);

  // Gated on the way out rather than reset on the way in: a disabled hook that
  // cleared its state in an effect would render one frame of the old list
  // first, and the effects above would then have to race to undo it. Nothing is
  // stale here because nothing is trusted — the active id has to still name a
  // heading that is in the current list.
  if (!enabled) return { headings: [], activeId: null };
  return {
    headings,
    activeId: headings.some((h) => h.id === activeId) ? activeId : null,
  };
}
