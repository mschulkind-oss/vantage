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
 * Badges appear once the index is ready and never delay the first render
 * (§5.3): until then, and whenever the index is not ready, the pass only
 * sweeps. That is also the whole of §3.6's failure case — a failed batch leaves
 * the document exactly as it renders today.
 */
import { useEffect, type RefObject } from "react";
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

/**
 * Badge every stamped link in `containerRef` against `index`, or only sweep
 * when `index` is `null`.
 *
 * `currentContent` and `renderedWith` are unused in the body and load-bearing
 * in the dep array. A new body re-renders `<ReactMarkdown>`, which may discard
 * these foreign nodes, as it does for the button pass. And a new `components`
 * object remounts every link with the document unchanged: React inserts each
 * new `<a>` before the next node it owns, which is after the old badge, so the
 * badge would sit before its link until something else re-ran this pass.
 */
export function usePlanningLinkBadges(
  containerRef: RefObject<HTMLElement | null>,
  index: PlanningIndex | null,
  currentPath: string,
  currentContent: string,
  renderedWith?: unknown,
): void {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    sweep(el);
    if (index === null) return;

    for (const link of el.querySelectorAll<HTMLElement>(
      `a[${LINK_TARGET_ATTR}]`,
    )) {
      // Inline SVG admits `<a href>`. It is raw HTML, so the `a` component
      // does not stamp it, and a badge is an HTML `<span>` besides: inside an
      // `<svg>` it draws nothing and would be a stray node in the drawing.
      if (link.closest("svg")) continue;
      const path = link.getAttribute(LINK_TARGET_ATTR);
      if (!path) continue;
      const badge = badgeFor(index, currentPath, {
        path,
        fragment: link.getAttribute(LINK_FRAGMENT_ATTR),
      });
      // A sibling, never a child: the badge is not part of the link's text,
      // and a click on it must not follow the link (§5.3).
      if (badge !== null) link.after(planningBadgeElement(badge));
    }

    return () => sweep(el);
  }, [containerRef, index, currentPath, currentContent, renderedWith]);
}
