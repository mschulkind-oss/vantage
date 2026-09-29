/**
 * Link badges: a post-render pass that hangs a planning badge after every
 * rendered link whose target has something to show
 * (`docs/design/planning-index.md` §5).
 *
 * The same shape as `useOpenQuestionButtons`: sweep this pass's own nodes
 * first, re-run on the document and on each new index, and leave no trace on
 * unmount. A sweep first is what makes it idempotent, and it is also what turns
 * a badge whose target stopped being a planning document back into nothing.
 *
 * When they appear is `docs/design/planning-index-at-scale.md` §11 (L1), since
 * a badge widens its line and can wrap it:
 *
 * - **Index ready at the document's first paint:** every badge is in that
 *   paint. The pass is a layout effect, so it runs before the browser paints,
 *   and the hold (§11.3) makes this the usual case on a warm load.
 * - **Index later:** badges are drawn only in blocks that have not been on
 *   screen, and that lie below it, where a wider line moves nothing the reader
 *   can see. A link in a block the reader has already seen waits for the next
 *   render the reader causes, which for a document is the next visit.
 * - **Index changing afterwards** (a push): a change of data, not late data
 *   (L2). Whatever badges the visit draws follow it in place.
 *
 * Until the index is ready, and whenever it is not, the pass only sweeps. That
 * is also the whole of §3.6's failure case — a failed build leaves the
 * document exactly as it renders today.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { badgeFor, resolveRepoLink } from "vantage-md/planning";
import type { PlanningIndex } from "vantage-md/planning";
import {
  PLANNING_BADGE_ATTR,
  planningBadgeElement,
} from "../components/PlanningBadge";

/**
 * The repo-relative path a rendered link names, stamped by `MarkdownViewer`'s
 * `a` from `resolveRepoLink(currentPath, href)`. Read instead of the rendered
 * `href`, which carries `/{repo}/` in daemon mode and an unnormalized `..`.
 */
export const LINK_TARGET_ATTR = "data-vantage-link-target";

/** The link's fragment, decoded, when it has one. */
export const LINK_FRAGMENT_ATTR = "data-vantage-link-fragment";

/**
 * The attributes `MarkdownViewer` puts on a link from `fromPath` to `href`:
 * none for a link that leaves the repository (a scheme, `//host`, a leading
 * `/`, or a `..` that climbs out), which is what keeps a link into another
 * repository from ever being badged.
 */
export function linkTargetAttributes(
  fromPath: string,
  href: string | undefined,
): Record<string, string> {
  if (!href) return {};
  const target = resolveRepoLink(fromPath, href);
  if (target === null) return {};
  return target.fragment === null
    ? { [LINK_TARGET_ATTR]: target.path }
    : {
        [LINK_TARGET_ATTR]: target.path,
        [LINK_FRAGMENT_ATTR]: target.fragment,
      };
}

/**
 * Set by `rehypeMarkMarkdownLinks` on a link written in Markdown, and taken
 * off again by `MarkdownViewer`'s `a`, which stamps only such a link. A raw
 * HTML `<a href>` renders as the same element, but §5.1 badges a rendered
 * Markdown link, and the index counts only those (§3.2): a raw anchor is in no
 * Referenced by list and gets no bracketed badge from `vantage-check index`,
 * so a badge on it would be the page alone saying something.
 */
export const MARKDOWN_LINK_ATTR = "data-vantage-markdown-link";

interface HastLike {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
  children?: HastLike[];
}

function eachAnchor(tree: HastLike, visit: (anchor: HastLike) => void): void {
  const walk = (node: HastLike): void => {
    if (node.type === "element" && node.tagName === "a") visit(node);
    node.children?.forEach(walk);
  };
  walk(tree);
}

const spanOf = (node: HastLike): string | null => {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  return from === undefined || to === undefined ? null : `${from}:${to}`;
};

const SPANS = "vantageMarkdownLinkSpans";

/**
 * First in the rehype chain, before `rehypeRaw`: every `<a>` there came from
 * a Markdown link, since raw HTML is still unparsed. Records where each one
 * sits in the source, for `rehypeMarkMarkdownLinks`.
 */
export function rehypeCollectMarkdownLinks() {
  return (tree: HastLike, file: { data: Record<string, unknown> }): void => {
    const spans = new Set<string>();
    eachAnchor(tree, (anchor) => {
      const span = spanOf(anchor);
      if (span !== null) spans.add(span);
    });
    file.data[SPANS] = spans;
  };
}

/**
 * Last in the rehype chain, after the sanitizer, so nothing a document writes
 * can set the mark: marks each `<a>` that sits where a Markdown link did.
 */
export function rehypeMarkMarkdownLinks() {
  return (tree: HastLike, file: { data: Record<string, unknown> }): void => {
    const spans = file.data[SPANS];
    if (!(spans instanceof Set)) return;
    eachAnchor(tree, (anchor) => {
      const span = spanOf(anchor);
      if (span !== null && spans.has(span)) {
        anchor.properties = {
          ...anchor.properties,
          dataVantageMarkdownLink: "",
        };
      }
    });
  };
}

function sweep(el: HTMLElement): void {
  el.querySelectorAll(`[${PLANNING_BADGE_ATTR}]`).forEach((n) => n.remove());
}

/** Every link the pass may badge, in document order. */
function stampedLinks(el: HTMLElement): HTMLElement[] {
  return Array.from(
    el.querySelectorAll<HTMLElement>(`a[${LINK_TARGET_ATTR}]`),
  ).filter(
    // Inline SVG admits `<a href>`. It is raw HTML, so the `a` component
    // does not stamp it, and a badge is an HTML `<span>` besides: inside an
    // `<svg>` it draws nothing and would be a stray node in the drawing.
    (link) => link.closest("svg") === null,
  );
}

/**
 * What a badge after `link` can move: the block the link sits in, whose line
 * it may wrap. A table's cells share its columns, so a cell's badge can widen
 * a column and move every row, and the table is the block.
 */
function blockOf(link: HTMLElement, container: HTMLElement): Element {
  const block =
    link.closest("table") ?? link.closest("[data-source-line]") ?? link;
  return container.contains(block) ? block : link;
}

/** A span of the document, top and bottom, from the scroller's content top. */
type Span = [top: number, bottom: number];

/**
 * One visit's link badges: a document at its path, with this content. A live
 * reload is a change of data (L2), so it starts a visit of its own, laid out
 * afresh either way.
 *
 * A visit whose first paint came before the index keeps track, until the index
 * lands, of which spans of the document have been on screen. "On screen" is the
 * document's scroll container, not the window, which never scrolls in the
 * viewer; with no such container, as in an embedded viewer's page or a test,
 * it is the window.
 */
class Visit {
  readonly path: string;
  readonly content: string;
  /** The links, by their place in the document, that this visit badges. */
  private drawable: ReadonlySet<number> | "all" | null;
  private readonly seen: Span[] = [];
  private readonly scroller: HTMLElement | null;
  private readonly container: HTMLElement;
  private readonly onScroll = () => this.observe();

  constructor(
    container: HTMLElement,
    path: string,
    content: string,
    indexed: boolean,
  ) {
    this.path = path;
    this.content = content;
    this.container = container;
    this.scroller = container.closest<HTMLElement>("[data-content-scroll]");
    this.drawable = indexed ? "all" : null;
    // What the first paint will show; `track` adds every scroll after it.
    if (!indexed) this.observe();
  }

  /** Follow the scroller until the index lands. Idempotent. */
  track(): void {
    if (this.drawable !== null) return;
    (this.scroller ?? window).addEventListener("scroll", this.onScroll, {
      passive: true,
    });
  }

  /** The scroller's viewport, in client coordinates, and how far it scrolled. */
  private viewport(): { top: number; height: number; offset: number } {
    if (this.scroller === null) {
      return { top: 0, height: window.innerHeight, offset: window.scrollY };
    }
    return {
      top: this.scroller.getBoundingClientRect().top,
      height: this.scroller.clientHeight,
      offset: this.scroller.scrollTop,
    };
  }

  /** Note the span on screen now. */
  private observe(): void {
    const { height, offset } = this.viewport();
    if (height <= 0) return;
    const next: Span = [offset, offset + height];
    // Kept merged, so a long read down the document stays one span.
    for (let i = this.seen.length - 1; i >= 0; i--) {
      const [top, bottom] = this.seen[i]!;
      if (top <= next[1] && next[0] <= bottom) {
        next[0] = Math.min(next[0], top);
        next[1] = Math.max(next[1], bottom);
        this.seen.splice(i, 1);
      }
    }
    this.seen.push(next);
  }

  /**
   * The links to badge, deciding them the first time the index is here: all
   * of them, or for a late index those whose block has never been on screen
   * and starts below it now. A block with no box at all, inside a collapsed
   * section, has never been drawn, so it qualifies wherever it sits.
   */
  badged(links: readonly HTMLElement[]): (i: number) => boolean {
    if (this.drawable === null) {
      this.observe();
      this.stop();
      const { top: clientTop, height, offset } = this.viewport();
      const below = offset + height;
      const drawable = new Set<number>();
      links.forEach((link, i) => {
        const box = blockOf(link, this.container).getBoundingClientRect();
        if (box.width === 0 && box.height === 0) {
          drawable.add(i);
          return;
        }
        const top = box.top - clientTop + offset;
        const bottom = box.bottom - clientTop + offset;
        const seen = this.seen.some(([a, b]) => top < b && bottom > a);
        if (!seen && top >= below) drawable.add(i);
      });
      this.drawable = drawable;
    }
    const drawable = this.drawable;
    return drawable === "all" ? () => true : (i) => drawable.has(i);
  }

  stop(): void {
    (this.scroller ?? window).removeEventListener("scroll", this.onScroll);
  }
}

/**
 * Badge every stamped link in `containerRef` against `index`, or only sweep
 * when `index` is `null`, under the rules at the top of this file.
 *
 * `currentContent` and `renderedWith` are load-bearing in the dep array. A new
 * body re-renders `<ReactMarkdown>`, which may discard these foreign nodes, as
 * it does for the button pass. And a new `components` object remounts every
 * link with the document unchanged: React inserts each new `<a>` before the
 * next node it owns, which is after the old badge, so the badge would sit
 * before its link until something else re-ran this pass. A remount keeps the
 * links' order, which is how a visit names them across one.
 */
export function usePlanningLinkBadges(
  containerRef: RefObject<HTMLElement | null>,
  index: PlanningIndex | null,
  currentPath: string,
  currentContent: string,
  renderedWith?: unknown,
): void {
  const visitRef = useRef<Visit | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let visit = visitRef.current;
    if (
      visit === null ||
      visit.path !== currentPath ||
      visit.content !== currentContent
    ) {
      visit = new Visit(el, currentPath, currentContent, index !== null);
      visitRef.current = visit;
    }
    // Re-attached on every run, since every cleanup detaches it: one run's
    // cleanup is how an unmount, or StrictMode's rehearsal of one, stops it.
    const tracking = visit;
    tracking.track();
    const cleanup = () => {
      sweep(el);
      tracking.stop();
    };
    sweep(el);
    if (index === null) return cleanup;

    const links = stampedLinks(el);
    const badged = tracking.badged(links);
    links.forEach((link, i) => {
      if (!badged(i)) return;
      const path = link.getAttribute(LINK_TARGET_ATTR);
      if (!path) return;
      const badge = badgeFor(index, currentPath, {
        path,
        fragment: link.getAttribute(LINK_FRAGMENT_ATTR),
      });
      // A sibling, never a child: the badge is not part of the link's text,
      // and a click on it must not follow the link (§5.3).
      if (badge !== null) link.after(planningBadgeElement(badge));
    });

    return cleanup;
  }, [containerRef, index, currentPath, currentContent, renderedWith]);
}
