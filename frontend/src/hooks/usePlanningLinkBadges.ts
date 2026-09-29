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
      // Inline SVG admits `<a href>`, and the `a` component stamps it as it
      // stamps any link. A badge is an HTML `<span>`: inside an `<svg>` it
      // draws nothing and would be a stray node in the drawing.
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
