import { dirname, resolve } from "node:path";
import type { Link, Root, RootContent, Table } from "mdast";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import type { Collector, FilePosition } from "../core/collector.js";
import { fileLine } from "../core/document.js";
import { numberedHeadings } from "../core/slugs.js";
import { isMarkdown } from "../core/workspace.js";

/**
 * `ref/*` — a reference written as text instead of a link.
 *
 * The rest of the checker asks *"does this link work?"*. This family asks the
 * question underneath it: **should this have been a link at all?** A reference
 * written as prose cannot be dead, so nothing can ever notice it went stale —
 * `OQ-TP4` outlives the question, `§4.1` outlives the renumbering, and a
 * filename outlives the move, all without a single failing check.
 *
 * Three markers, chosen because they are unambiguous: `OQ-` ids, the `§` sign,
 * and a token that resolves to a file next to the document. Everything else in
 * prose is prose.
 *
 * The safety property is the one the link rules already hold: report only what
 * the parsed tree has settled. Fenced code and inline code that is plainly a
 * command are structurally out of reach, and a reference already inside a link
 * is the state the rules want.
 */

/** `OQ-` then an optional short uppercase prefix then digits. */
const OQ_REFERENCE = /OQ-(?:[A-Z][A-Z0-9]{0,5})?[0-9]+/g;

/** The same, anchored — for asking whether a whole cell *is* an id. */
const OQ_EXACT = /^OQ-(?:[A-Z][A-Z0-9]{0,5})?[0-9]+$/;

/** `§` then a dotted section number: `§4`, `§4.1`, `§10.2.3`. */
const SECTION_REFERENCE = /§[0-9]+(?:\.[0-9]+)*/g;

/**
 * Path-shaped: no whitespace, at least one dot, a short extension.
 *
 * The whitespace exclusion is what keeps `` `npm ci` `` and
 * `` `git config core.hooksPath` `` out of this rule without a command
 * allowlist — an inline-code span holding a command is not one token.
 */
const PATH_SHAPED = /^[\w./-]+\.[A-Za-z0-9]{1,6}$/;

/** Punctuation a reference in prose picks up from the sentence around it. */
const TRIM_PUNCTUATION = /^[("'`[]+|[)"'`\].,;:!?]+$/g;

/** One reference found in the document, with the link enclosing it, if any. */
interface Reference {
  /** The matched text, `§` or `OQ-` prefix included. */
  text: string;
  at: FilePosition;
  /** The link this reference sits inside, or undefined when it is bare. */
  link: Link | undefined;
  /** Whether the reference is a question's own bold title — `**OQ-4: …**`. */
  isTitle: boolean;
}

/**
 * Every text and inline-code node in the tree, paired with the link enclosing
 * it.
 *
 * A manual walk rather than `unist-util-visit`, because what matters here is
 * the *ancestor* — a reference inside emphasis inside a link is inside a link,
 * and a visitor that only sees the immediate parent would call it bare.
 */
function walkText(
  root: Root,
  inLink: Link | undefined,
  visitor: (node: RootContent, link: Link | undefined, bold: boolean) => void,
  skipSubtrees: ReadonlySet<unknown> = new Set(),
): void {
  const descend = (
    node: RootContent | Root,
    link: Link | undefined,
    bold: boolean,
  ): void => {
    if (skipSubtrees.has(node)) return;
    if (node.type === "text" || node.type === "inlineCode") {
      visitor(node as RootContent, link, bold);
      return;
    }
    // `code` (fenced) is deliberately absent: a fenced block is a specimen, not
    // a claim, and a rule that edited one would break the thing it shows.
    if (node.type === "code" || node.type === "html") return;

    const enclosing = node.type === "link" ? (node as Link) : link;
    const emphasised = bold || node.type === "strong";
    const children = (node as { children?: RootContent[] }).children;
    if (!children) return;
    for (const child of children) descend(child, enclosing, emphasised);
  };

  descend(root, inLink, false);
}

/**
 * The ID cells of every Decision Ledger in the document.
 *
 * A ledger row is where a *compacted* question lives: `| OQ-1 | ruling | … |`
 * is the durable record of the decision, so the id in that first cell is the
 * declaration, not a reference to one. Requiring it to link to itself is the
 * same noise as requiring an in-flight question's title to.
 *
 * Recognised structurally rather than by heading text: a table whose header's
 * first column is exactly `ID`, and within it any first cell that is exactly an
 * id. Both halves matter — the header alone would swallow the `Settled in`
 * column's `§` references, which are real references and do need links.
 */
function ledgerIdCells(root: Root): Set<unknown> {
  const cells = new Set<unknown>();

  visit(root, "table", (table: Table) => {
    const [header, ...body] = table.children;
    const heading = header?.children[0];
    if (!heading || toString(heading).trim().toUpperCase() !== "ID") return;

    for (const row of body) {
      const first = row.children[0];
      if (first && OQ_EXACT.test(toString(first).trim())) cells.add(first);
    }
  });

  return cells;
}

/** The file position of an offset inside a node's own text. */
function positionIn(
  collector: Collector,
  node: RootContent,
  value: string,
  offset: number,
): FilePosition {
  const start = node.position?.start;
  const before = value.slice(0, offset);
  const newlines = before.split("\n").length - 1;
  const column =
    newlines === 0
      ? (start?.column ?? 1) + offset + (node.type === "inlineCode" ? 1 : 0)
      : before.length - before.lastIndexOf("\n");
  return {
    line: fileLine(collector.doc, (start?.line ?? 1) + newlines),
    column,
  };
}

/** Collect every match of `pattern` outside a link, and inside one. */
function collectReferences(
  collector: Collector,
  pattern: RegExp,
  skipSubtrees: ReadonlySet<unknown> = new Set(),
): Reference[] {
  const found: Reference[] = [];

  const collect = (
    node: RootContent,
    link: Link | undefined,
    bold: boolean,
  ) => {
    const value = (node as { value?: string }).value;
    if (typeof value !== "string") return;

    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const offset = match.index ?? 0;
      found.push({
        text: match[0],
        at: positionIn(collector, node, value, offset),
        link,
        // The convention's title form: a bold `OQ-4:` opening the question.
        isTitle: bold && value[offset + match[0].length] === ":",
      });
    }
  };

  walkText(collector.doc.mdast, undefined, collect, skipSubtrees);

  return found;
}

/** The fragment of a link url, or undefined when it carries none. */
function fragmentOf(url: string): string | undefined {
  const hash = url.indexOf("#");
  if (hash === -1) return undefined;
  const fragment = url.slice(hash + 1);
  return fragment === "" ? undefined : fragment;
}

/** The path half of a link url, fragment stripped. */
function pathOf(url: string): string {
  const hash = url.indexOf("#");
  return hash === -1 ? url : url.slice(0, hash);
}

/**
 * `ref/unlinked-oq` — an Open Question id in prose with no link on it.
 *
 * Two lifecycle phases, and the rule has to accept both. While the question is
 * in flight it is an `oq` directive and `#OQ-4` is a live anchor, so the
 * reference names it directly. Once it is compacted into a Decision Ledger the
 * directive is gone and no anchor declares that id any more — so the rule
 * requires a *fragment*, not the id, and leaves proving the fragment resolves
 * to `link/dead-section-anchor`, which already does exactly that.
 *
 * The question's own definition site is not a reference to itself: every id
 * this document declares is excluded, because the text naming it is the thing
 * being named.
 */
export function checkOqReferences(collector: Collector): void {
  if (!collector.enabled("ref/unlinked-oq")) return;

  for (const ref of collectReferences(
    collector,
    OQ_REFERENCE,
    ledgerIdCells(collector.doc.mdast),
  )) {
    // A question's own title is not a reference to itself. Recognised by the
    // convention's shape — a bold id followed by a colon — rather than by
    // whether the document declares that id, because a document that declares
    // `OQ-4` may also *refer* to it further down, and that reference needs a
    // link like any other.
    if (ref.link === undefined && ref.isTitle) continue;

    if (ref.link === undefined) {
      collector.report(
        "ref/unlinked-oq",
        ref.at,
        `\`${ref.text}\` names an open question but is not a link, so nobody ` +
          "can follow it and nothing can notice when it goes stale. Write " +
          `[\`${ref.text}\`](#${ref.text}) for a question in this document, or ` +
          `[\`${ref.text}\`](./other.md#${ref.text}) for one in another. Once ` +
          "the question is compacted into a Decision Ledger it has no `#id` " +
          "any more — link the ledger instead.",
      );
      continue;
    }

    if (fragmentOf(ref.link.url) === undefined) {
      collector.report(
        "ref/unlinked-oq",
        ref.at,
        `\`${ref.text}\` links to \`${ref.link.url}\` but names no fragment, ` +
          "so it lands at the top of the document and the reader still has to " +
          `hunt for the question. Point it at \`#${ref.text}\`, or at the ` +
          "Decision Ledger if the question has been compacted.",
      );
    }
  }
}

/**
 * `ref/unlinked-section` — a `§N` cross-reference in prose with no link on it,
 * or one pointing at a different section than the number names.
 *
 * The target check is what keeps the rule from being satisfied by any link at
 * all. It resolves `§4.1` against the target document's numbered headings — a
 * heading whose text begins `4.1` — and reports a link that goes somewhere
 * else. A target with no numbered headings has nothing to resolve against, so
 * the rule requires the link and says nothing about where it points; guessing
 * would invent findings on every document that never adopted the convention.
 */
export function checkSectionReferences(collector: Collector): void {
  if (!collector.enabled("ref/unlinked-section")) return;
  const documentDir = dirname(collector.doc.path);

  for (const ref of collectReferences(collector, SECTION_REFERENCE)) {
    const number = ref.text.slice(1);

    if (ref.link === undefined) {
      collector.report(
        "ref/unlinked-section",
        ref.at,
        `\`${ref.text}\` points at a section but is not a link, so nobody can ` +
          "follow it and nothing notices when the section is renumbered. Link " +
          "it to the heading it names.",
      );
      continue;
    }

    const fragment = fragmentOf(ref.link.url);
    if (fragment === undefined) continue;

    const targetPath = pathOf(ref.link.url);
    const target =
      targetPath === ""
        ? collector.doc.path
        : resolve(documentDir, decodeURIComponent(targetPath));
    if (!isMarkdown(target)) continue;

    const headings =
      target === collector.doc.path
        ? numberedHeadings(collector.doc.mdast)
        : collector.workspace.numberedHeadings(target);
    // Nothing to resolve against, or the target could not be read.
    if (!headings || headings.size === 0) continue;

    const expected = headings.get(number);
    if (expected === undefined || expected === fragment) continue;

    collector.report(
      "ref/unlinked-section",
      ref.at,
      `\`${ref.text}\` links to \`#${fragment}\`, but §${number} in that ` +
        `document is \`#${expected}\`. One of the two is wrong — either the ` +
        "link points at the wrong section or the number does.",
    );
  }
}

/**
 * `ref/unlinked-file` — a filename in prose that names a real file and does not
 * link to it, or links to a different one.
 *
 * Resolution is **relative to the document's own directory only**. Repo-root
 * resolution was measured and rejected: it turns every passing mention of
 * `package.json` in a document five directories down into a demand to link one
 * specific manifest out of the several in the tree. A token that does not
 * resolve beside the document is left alone — it is a file in another repo, a
 * config key, or a name in passing, and the checker cannot tell which.
 */
export function checkFileReferences(collector: Collector): void {
  if (!collector.enabled("ref/unlinked-file")) return;
  const documentDir = dirname(collector.doc.path);

  walkText(collector.doc.mdast, undefined, (node, link) => {
    const value = (node as { value?: string }).value;
    if (typeof value !== "string") return;

    // Inline code is one token or it is not a path. Prose is split on
    // whitespace and stripped of the punctuation the sentence put there.
    const tokens =
      node.type === "inlineCode"
        ? [{ text: value.trim(), offset: 0 }]
        : [...value.matchAll(/\S+/g)].map((m) => ({
            text: m[0].replace(TRIM_PUNCTUATION, ""),
            offset: m.index ?? 0,
          }));

    for (const { text, offset } of tokens) {
      if (!PATH_SHAPED.test(text)) continue;

      const target = resolve(documentDir, text);
      // Never a reference to itself, and never a directory.
      if (target === collector.doc.path) continue;
      if (collector.workspace.kind(target) !== "file") continue;

      const at = positionIn(collector, node, value, offset);

      if (link === undefined) {
        collector.report(
          "ref/unlinked-file",
          at,
          `\`${text}\` names a file that exists beside this document but is ` +
            `not a link. Write [\`${text}\`](${text.startsWith(".") ? text : `./${text}`}) ` +
            "so a reader can open it and a move cannot go unnoticed.",
        );
        continue;
      }

      const linked = resolve(documentDir, decodeURIComponent(pathOf(link.url)));
      if (linked === target) continue;

      collector.report(
        "ref/unlinked-file",
        at,
        `\`${text}\` is linked to \`${link.url}\`, which is a different file. ` +
          "A reference that names one file and opens another is worse than no " +
          "link at all.",
      );
    }
  });
}

/** Every `ref/*` rule, in the order their findings read best. */
export function checkReferences(collector: Collector): void {
  checkOqReferences(collector);
  checkSectionReferences(collector);
  checkFileReferences(collector);
}
