import type { Root } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import GithubSlugger from "github-slugger";
import { visit } from "unist-util-visit";
import { oqAnchors } from "./openQuestions.js";

/**
 * The set of fragment ids a document actually exposes.
 *
 * Section anchors are not reasonable to guess: an em dash inside a heading
 * leaves *two* hyphens in the slug, a trailing colon leaves none, and a
 * repeated heading gets a `-1` suffix. So we do not guess — we run the same
 * slugger the renderer runs (`github-slugger`, via `rehype-slug`), over the
 * same text, in the same order.
 *
 * `mdast-util-to-string` is configured to match what `hast-util-to-string`
 * sees after the markdown is turned into HTML: image alt text and raw HTML
 * tags are not part of a heading's text content.
 */
export function headingSlugs(mdast: Root): string[] {
  const slugger = new GithubSlugger();
  const slugs: string[] = [];

  visit(mdast, "heading", (node) => {
    const text = mdastToString(node, {
      includeImageAlt: false,
      includeHtml: false,
    });
    slugs.push(slugger.slug(text));
  });

  return slugs;
}

const ID_ATTRIBUTE = /\s(?:id|name)\s*=\s*["']([^"']+)["']/gi;

/**
 * Ids written by hand in raw HTML, e.g. `<a id="notes"></a>`.
 *
 * Collected on purpose even though the sanitizer has the last word on which of
 * them survive into the DOM: counting one as a valid target can only ever make
 * us miss a dead anchor, while *not* counting it would invent a finding for a
 * link that works. Given the choice, the checker errs quiet.
 */
export function htmlAnchors(mdast: Root): string[] {
  const ids: string[] = [];

  visit(mdast, "html", (node) => {
    for (const match of node.value.matchAll(ID_ATTRIBUTE)) {
      const id = match[1];
      if (id) ids.push(id);
    }
  });

  return ids;
}

/**
 * Every fragment a link can legitimately target in this document.
 *
 * Three sources, and Open Question ids are the one that is not HTML at all:
 * `<!-- vantage: oq id=OQ-4 -->` becomes `id="OQ-4"` on the block it marks
 * (`rehypeVantageAnchors`), so `#OQ-4` navigates and a reference of the form
 * `[OQ-4](#OQ-4)` is checkable. Only well-formed ids count — the sanitiser
 * refuses the rest, so counting one would accept a fragment that goes nowhere.
 */
export function documentAnchors(mdast: Root): Set<string> {
  return new Set([
    ...headingSlugs(mdast),
    ...htmlAnchors(mdast),
    ...oqAnchors(mdast),
  ]);
}

/**
 * Section number → the slug of the heading carrying it, for every heading whose
 * text opens with a dotted number: `## 4.1 The id grammar` yields
 * `"4.1" -> "41-the-id-grammar"`.
 *
 * This is what lets `ref/unlinked-section` check that `§4.1` links to §4.1 and
 * not merely to *something*. Built from the same slugger pass as the anchors,
 * because a number resolved against one slugging and linked against another is
 * a mismatch the rule would report as the author's mistake.
 *
 * An empty map means the document never adopted numbered headings, which the
 * rule reads as "nothing to resolve against" rather than "every reference is
 * wrong".
 */
export function numberedHeadings(mdast: Root): Map<string, string> {
  const slugger = new GithubSlugger();
  const numbers = new Map<string, string>();

  visit(mdast, "heading", (node) => {
    const text = mdastToString(node, {
      includeImageAlt: false,
      includeHtml: false,
    });
    const slug = slugger.slug(text);
    const number = /^([0-9]+(?:\.[0-9]+)*)[.)\s]/.exec(text.trim())?.[1];
    // First one wins: a repeated number is already a document bug, and the
    // reference should resolve to the section that claimed it first.
    if (number !== undefined && !numbers.has(number)) numbers.set(number, slug);
  });

  return numbers;
}

/**
 * The closest anchor to what someone wrote, when there is an obvious one.
 *
 * A dead-anchor finding an agent can fix in one shot is worth more than a
 * correct one it has to go investigate, so we suggest — but only when the
 * candidate is close enough that being wrong is unlikely.
 */
export function nearestAnchor(
  target: string,
  anchors: Iterable<string>,
): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;

  for (const anchor of anchors) {
    const distance = editDistance(target, anchor);
    if (distance < bestDistance) {
      best = anchor;
      bestDistance = distance;
    }
  }

  const budget = Math.max(2, Math.floor(target.length / 4));
  return best !== undefined && bestDistance <= budget ? best : undefined;
}

/** Plain Levenshtein distance, two rows at a time. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution =
        (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = (current[j - 1] as number) + 1;
      const deletion = (previous[j] as number) + 1;
      current.push(Math.min(substitution, insertion, deletion));
    }
    previous = current;
  }

  return previous[b.length] as number;
}
