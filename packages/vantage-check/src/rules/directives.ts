import type { Html, List, ListItem, Parents, Root, RootContent } from "mdast";
import { visit } from "unist-util-visit";
// The viewer's own grammar, vocabulary and target-tag lists, imported from
// source. A checker with its own copy of any of the four disagrees with the
// renderer sooner or later, and the disagreement is invisible: both sides stay
// silent by design (D5).
import {
  DIRECTIVE_VOCABULARY,
  hasVantageSentinel,
  parseVantageDirective,
  VANTAGE_OQ_HOST_TARGETS,
  VANTAGE_SENTINEL,
  VANTAGE_STYLE_TARGETS,
} from "../../../vantage-md/src/vantageDirectives.js";
import type { Collector, FilePosition } from "../core/collector.js";
import { fileLine, parseMarkdown } from "../core/document.js";

/**
 * Vantage's own `<!-- vantage: … -->` directives, checked with the viewer's
 * parser.
 *
 * A directive is an HTML comment carrying a `vantage:` sentinel, compiled into
 * `data-vantage-*` attributes on the block that follows it, between
 * `rehype-raw` and `rehype-sanitize`. **Every failure mode is silent by
 * design** (P3/D2: unknown is inert, never fatal), so a typo produces a
 * document that renders bare with no signal anywhere — in the app, in an
 * exported site, and in every other rule of this tool. This family is the only
 * thing that breaks that silence, which is the whole reason it exists.
 *
 * Positions come from the *parsed tree*, never a text search. That is what
 * makes a directive inside a fenced block a code sample rather than a finding:
 * a fence is a `code` node and this rule only ever visits `html` nodes. It is
 * the same property `link/*` relies on, and it is why the design doc's own
 * examples do not fail the gate.
 */
export function checkDirectives(collector: Collector): void {
  const root = collector.doc.mdast;
  // Built on first use only: the overwhelming majority of documents carry no
  // directive at all, and this exists solely to answer "is the list holding
  // this item loose?".
  let listOwners: Map<ListItem, List> | undefined;
  const listHolding = (item: ListItem): List | undefined => {
    if (listOwners === undefined) {
      listOwners = new Map();
      visit(root, "list", (list) => {
        for (const child of list.children) listOwners?.set(child, list);
      });
    }
    return listOwners.get(item);
  };

  visit(root, "html", (node, index, parent) => {
    // The cheap gate, before any scanning: it is what keeps this rule off
    // `<!-- TODO: rewrite this -->` and off every `<div>` in the tree.
    if (!node.value.includes(VANTAGE_SENTINEL)) return;

    const segments = scanComments(node.value);
    const at = (offset: number): FilePosition =>
      positionOf(collector, node, offset);

    /** Names that survived the grammar and the vocabulary, in written order. */
    const names: string[] = [];
    /** The segment index of the last directive, where its run continues from. */
    let lastDirective = -1;
    /** Where a placement finding points: the first directive in the node. */
    let firstOffset = 0;
    let wrecked = false;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment === undefined || segment.kind !== "comment") continue;
      if (!hasVantageSentinel(segment.value)) continue;

      const swallow = swallowedTail(node.value, segment);
      if (swallow !== undefined) {
        // Everything below is inside the comment, so nothing else this node
        // says about targets or vocabulary is worth reporting.
        wrecked = true;
        collector.report("vantage/unterminated", at(segment.offset), swallow);
        continue;
      }

      const parsed = parseVantageDirective(segment.value);
      // `null` cannot happen after `hasVantageSentinel`, and if it ever does,
      // the comment is not ours.
      if (parsed === null) continue;

      const innerAt = (offset: number) => at(segment.innerOffset + offset);

      if (parsed.kind === "malformed") {
        collector.report(
          "vantage/malformed",
          innerAt(parsed.offset),
          `This comment carries a \`vantage:\` sentinel but does not parse as a directive, so Vantage ignores it and nothing is styled: ${parsed.reason}.`,
        );
        continue;
      }

      const keys = DIRECTIVE_VOCABULARY[parsed.name];
      if (keys === undefined) {
        collector.report(
          "vantage/unknown-name",
          innerAt(parsed.nameOffset),
          `\`${parsed.name}\` is not a directive name, so the whole directive is dropped and nothing is styled. Vantage knows ${orList(Object.keys(DIRECTIVE_VOCABULARY))}.`,
        );
        continue;
      }

      const seen = new Set<string>();
      for (const pair of parsed.pairs) {
        const keyAt = innerAt(pair.keyOffset);

        if (seen.has(pair.key)) {
          collector.report(
            "vantage/duplicate-key",
            keyAt,
            `\`${pair.key}\` is set twice in this directive. The last one wins silently, so one of the two values is doing nothing.`,
          );
        }
        seen.add(pair.key);

        const values = keys[pair.key];
        if (values === undefined) {
          collector.report(
            "vantage/unknown-key",
            keyAt,
            `\`${pair.key}\` is not a key \`${parsed.name}\` accepts, so that pair is dropped while the directive's other keys still apply. \`${parsed.name}\` accepts ${orList(Object.keys(keys))}.`,
          );
          continue;
        }
        // A free-text value — `oq`'s `id` and `leaning`. No closed set can
        // cover a sentence, so there is nothing to check.
        if (values === null) continue;

        if (!values.includes(pair.value)) {
          collector.report(
            "vantage/unknown-value",
            innerAt(pair.valueOffset),
            `\`${pair.value}\` is not a value \`${pair.key}\` accepts, so that pair is dropped and nothing is styled. \`${pair.key}\` accepts ${orList(values)}. The vocabulary is closed on purpose: a document names what a section *is*, never what it should look like.`,
          );
        }
      }

      if (names.length === 0) firstOffset = segment.offset;
      names.push(parsed.name);
      lastDirective = i;
    }

    if (wrecked || names.length === 0) return;
    if (parent === undefined || index === undefined) return;

    // Placement is a question about the *run*, not about each comment in it:
    // consecutive directives merge onto one target, so the first node of the run
    // answers for all of them, with every name in the run in hand. Otherwise two
    // directives above one missing block are two findings about one mistake, and
    // the second one would not know the first one's names.
    if (!startsRun(parent.children, index)) return;
    const runNames = [...names, ...namesAfter(parent.children, index)];

    // A directive that split a list has already changed the document, and the
    // fix ("indent it inside the item") is also the fix for whatever it failed
    // to attach to, so one finding is enough there too.
    const split = splitList(collector, parent, index);
    if (split !== undefined) {
      collector.report("vantage/list-split", at(firstOffset), split);
      return;
    }

    const orphan = orphanReason(
      segments,
      lastDirective,
      parent,
      index,
      runNames,
      listHolding,
    );
    if (orphan !== undefined) {
      collector.report("vantage/orphan", at(firstOffset), orphan);
      return;
    }

    // Last, because it is the general form of the other two: it answers "does
    // deleting this comment change the document?" for *any* construct, so a
    // directive that also split a list or attached to nothing would be reported
    // twice. Those two say more about the same mistake, so they go first.
    const restructured = blockSplit(collector, root, parent, index);
    if (restructured !== undefined) {
      collector.report("vantage/block-split", at(firstOffset), restructured);
    }
  });
}

/* ------------------------------------------------------------------ *
 * Comments inside one mdast html node
 * ------------------------------------------------------------------ */

const COMMENT_OPEN = "<!--";
/**
 * The terminators parse5 honours. `--!>` really does close a comment for the
 * HTML parser — measured through `rehype-raw` — which is why a scanner that
 * looks only for `-->` both misses the directive after one and calls a closed
 * comment unterminated.
 */
const COMMENT_CLOSE = /--!?>/;

interface CommentSegment {
  kind: "comment";
  /** Inner text: `<!--` and the terminator stripped, verbatim otherwise. */
  value: string;
  /** Offset of `<!--` within the html node's value. */
  offset: number;
  /** Offset of the first character after `<!--`. */
  innerOffset: number;
  /** Offset of the first character after the terminator. */
  endOffset: number;
  terminator: "-->" | "--!>" | null;
}

interface TextSegment {
  kind: "text";
  value: string;
  offset: number;
}

type Segment = CommentSegment | TextSegment;

/**
 * Split an mdast `html` node's raw text into comments and the text between
 * them.
 *
 * mdast keeps raw HTML as opaque text, so one node is not one comment:
 * `<!-- a --><!-- vantage: b -->` is a single node, and so is a whole
 * `<div>…</div>` with a directive inside it. hast, after `rehype-raw`, has
 * already split those into separate `comment` nodes with their own positions —
 * so this is the one place the checker does by hand what parse5 does for the
 * viewer, and it is kept deliberately narrow.
 */
function scanComments(raw: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (;;) {
    const open = raw.indexOf(COMMENT_OPEN, cursor);
    if (open === -1) {
      if (cursor < raw.length) {
        segments.push({
          kind: "text",
          value: raw.slice(cursor),
          offset: cursor,
        });
      }
      return segments;
    }
    if (open > cursor) {
      segments.push({
        kind: "text",
        value: raw.slice(cursor, open),
        offset: cursor,
      });
    }

    const innerOffset = open + COMMENT_OPEN.length;
    const close = COMMENT_CLOSE.exec(raw.slice(innerOffset));
    if (close === null) {
      segments.push({
        kind: "comment",
        value: raw.slice(innerOffset),
        offset: open,
        innerOffset,
        endOffset: raw.length,
        terminator: null,
      });
      return segments;
    }

    const terminator = close[0] as "-->" | "--!>";
    const endOffset = innerOffset + close.index + terminator.length;
    segments.push({
      kind: "comment",
      value: raw.slice(innerOffset, innerOffset + close.index),
      offset: open,
      innerOffset,
      endOffset,
      terminator,
    });
    cursor = endOffset;
  }
}

/**
 * Does this comment swallow the rest of the document? The message if so.
 *
 * The two ways it can, both measured end to end:
 *
 * - **No terminator at all.** CommonMark's HTML block (type 2) runs to the
 *   first line containing `-->`, so an unclosed `<!--` pulls every following
 *   block into one `html` node and `rehype-raw` renders the lot as one
 *   invisible comment. `# Title` plus an unclosed directive plus prose renders
 *   as the `<h1>` and nothing else.
 * - **`--!>`.** parse5 accepts it as a terminator; CommonMark's block scanner
 *   does not. So the comment closes but the *block* does not, and everything
 *   below arrives as raw text: `## Head` renders as the literal characters
 *   `## Head`. Only when no `-->` follows in the same node — with one later,
 *   the block ended there and the `--!>` was harmless (also measured).
 *
 * Nothing else in this tool notices either: `render/pipeline` does not throw
 * and `markdown/hygiene` is off by default, so a document can lose every word
 * below line 3 and check clean. That is what makes this the family's most
 * valuable rule.
 */
function swallowedTail(
  raw: string,
  comment: CommentSegment,
): string | undefined {
  if (comment.terminator === null) {
    return "This `<!--` is never closed with `-->`, so Markdown reads the whole rest of the file as part of the comment and the renderer drops it: every heading and paragraph below this line disappears from the page.";
  }
  if (comment.terminator === "-->") return undefined;
  if (raw.slice(comment.endOffset).includes("-->")) return undefined;

  return "This directive ends with `--!>`. HTML accepts that as the end of a comment but Markdown does not, so the rest of the file is swallowed into this HTML block and rendered as raw, unformatted text — headings, lists and links all arrive as the literal characters you typed. Close it with `-->`.";
}

/* ------------------------------------------------------------------ *
 * Placement: R3's orphan, and A6's split list
 * ------------------------------------------------------------------ */

/** mdast parents whose children become sibling *blocks* in hast. */
const BLOCK_PARENTS = new Set([
  "root",
  "blockquote",
  "listItem",
  "footnoteDefinition",
]);

/** mdast parents whose children are inline, where nothing is ever stamped. */
const PHRASING_PARENTS = new Set([
  "paragraph",
  "heading",
  "tableCell",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
]);

const STYLE_TARGETS = new Set<string>(VANTAGE_STYLE_TARGETS);
/**
 * Not `VANTAGE_ANCHOR_TARGETS`: the question this rule answers is "does a button
 * appear?", and `pre`/`table` are anchorable but cannot host one. Read from the
 * shared module so the app's `OQ_HOST_TAGS` and this cannot drift (D5).
 */
const OQ_HOST_TARGETS = new Set<string>(VANTAGE_OQ_HOST_TARGETS);

/** How to name a target in a message. `undefined` means "do not guess". */
const TARGET_NAMES: Record<string, string> = {
  p: "paragraph",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  li: "list item",
  blockquote: "block quote",
  pre: "code block",
  table: "table",
  ul: "bulleted list",
  ol: "numbered list",
  hr: "horizontal rule",
  span: "`$$` math block",
};

/**
 * "a paragraph, heading, list item or block quote" — read off the host list
 * itself rather than typed out, because the enumeration in this message was
 * wrong in the most misleading possible way: it offered `code block, table` as
 * legal hosts while the button refused both, so the finding told the author to
 * move the directive onto a shape that does not work either.
 */
const OQ_HOST_NAMES = prose(
  [...OQ_HOST_TARGETS].reduce<string[]>((names, tag) => {
    const name = TARGET_NAMES[tag] ?? tag;
    if (!names.includes(name)) names.push(name);
    return names;
  }, []),
);

/** `a, b or c`, unquoted — `orList` for prose that already reads as English. */
function prose(values: string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

/**
 * Why this directive stamps nothing, or `undefined` if it stamps something.
 *
 * This is R3, and it has to reproduce the plugin's answer exactly: the plugin
 * resolves a directive **within its own parent's children**, skipping
 * whitespace and comments, stopping at the first element — and then stamps only
 * if that element's tag is in the name's target list. Every branch below is a
 * measured way for that to come out empty.
 *
 * When the tree cannot settle the question the answer is `undefined`: a
 * directive buried in a larger raw-HTML block really does have hast siblings
 * this rule cannot see (measured: `<div>\n<!-- vantage: … -->\n<p>x</p>\n</div>`
 * stamps the `<p>`), so guessing there would invent findings. Only report what
 * the tree has already settled.
 */
function orphanReason(
  segments: Segment[],
  lastDirective: number,
  parent: Parents,
  index: number,
  names: string[],
  listHolding: (item: ListItem) => List | undefined,
): string | undefined {
  // (a) Something else in this same html node comes after the directive.
  const inNode = nextContentInNode(segments, lastDirective);
  if (inNode === "markup") return undefined;
  if (inNode === "text") {
    return "Text follows this directive inside the same HTML block, so the next thing Vantage sees is that text rather than a block, and nothing is styled. Put the directive on a line of its own, with a blank line after it.";
  }

  // (b) The directive is inline — inside a paragraph, a heading, a table cell.
  // The plugin does reach it (it walks the whole tree), but everything after it
  // there is inline content, and no inline tag is a stampable target.
  if (!BLOCK_PARENTS.has(parent.type)) {
    if (!PHRASING_PARENTS.has(parent.type)) return undefined;
    return `This directive is inline, inside a ${parent.type}, rather than on a line of its own, so the only thing after it is inline content and nothing is styled. Put it on its own line, with a blank line before and after it.`;
  }

  // (c) Nothing follows it that becomes an element.
  const target = nextBlock(parent.children, index);
  if (target === "unknown") return undefined;
  if (target === undefined) {
    return "Nothing follows this directive, so there is no block for it to attach to and it styles nothing. A directive applies to the block *after* it.";
  }

  // (d) The target is a paragraph in a tight list item, which never becomes a
  // `<p>` at all — measured: `- one\n  <!-- vantage: block tone=note -->\n  two`
  // renders as `<li>one\n\ntwo</li>` with nothing stamped.
  if (target.type === "paragraph" && parent.type === "listItem") {
    const list = listHolding(parent);
    if (list !== undefined && !listIsLoose(list)) {
      return "This list item has no blank lines in it, so Markdown renders its paragraphs as bare text with no block for the directive to attach to. Put a blank line before and after the directive — that makes the item's paragraphs real blocks, and the directive lands on the one after it.";
    }
  }

  const tag = targetTag(target);
  if (tag === undefined) return undefined;
  const name = TARGET_NAMES[tag] ?? tag;

  // (e) The target is a block, but not one this name can stamp. The two lists
  // differ: `oq` needs a tag that can *host the button*, so an `oq` above a
  // list attaches to the `<ul>` and no button ever appears — and an `oq` above a
  // fence or a table does stamp, which makes the silence worse rather than
  // better: the author has an attribute and no affordance.
  if (names.includes("oq") && !OQ_HOST_TARGETS.has(tag)) {
    let fix = "";
    if (tag === "ul" || tag === "ol") {
      fix =
        " Indent it inside the list item instead, on its own line, directly before the paragraph that holds the leaning.";
    } else if (tag === "pre" || tag === "table") {
      // Both are anchorable, so the directive stamps; what fails is the button.
      fix =
        " A button cannot live inside a code block or a table — inside a `<pre>` it would render as part of the code, and a `<button>` child of `<table>` is not valid HTML — so put the directive above the paragraph that introduces it.";
    }
    return `An Open Question button can only be attached to a ${OQ_HOST_NAMES}, and the block after this directive is a ${name}, so no button is rendered.${fix}`;
  }
  if (names.some((n) => n !== "oq") && !STYLE_TARGETS.has(tag)) {
    return `The block after this directive is a ${name}, which Vantage does not stamp, so this directive styles nothing.`;
  }

  return undefined;
}

/**
 * What comes after the last directive *inside its own html node*.
 *
 * `"end"` — nothing but whitespace and other comments, so the run continues
 * into the node's mdast siblings. `"text"` — literal text, which the plugin
 * stops at (measured: `<!-- vantage: block tone=note --> trailing` stamps
 * nothing). `"markup"` — a tag we cannot resolve from mdast; say nothing.
 */
function nextContentInNode(
  segments: Segment[],
  lastDirective: number,
): "end" | "text" | "markup" {
  for (let i = lastDirective + 1; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === undefined || segment.kind === "comment") continue;
    const rest = segment.value.trim();
    if (rest === "") continue;
    return rest.startsWith("<") ? "markup" : "text";
  }
  return "end";
}

/**
 * The sibling a directive attaches to, `undefined` for none, `"unknown"` when
 * the tree does not settle it.
 *
 * Two node types are skipped because `remark-rehype` does not leave them where
 * they were, both verified by running the real chain: a `definition`
 * (`[ref]: ./x.md`) produces no HTML at all, and a `footnoteDefinition` is
 * hoisted into a `<section>` at the end of the document. A comment-only `html`
 * sibling is skipped too — consecutive directives merge onto one target, and an
 * editorial `<!-- TODO -->` between a directive and its block must not change
 * what the directive means, because no reader can see it.
 */
function nextBlock(
  children: RootContent[],
  index: number,
): RootContent | undefined | "unknown" {
  for (let i = index + 1; i < children.length; i++) {
    const sibling = children[i];
    if (sibling === undefined) return undefined;
    if (sibling.type === "definition") continue;
    if (sibling.type === "footnoteDefinition") continue;
    if (sibling.type === "html") {
      if (isCommentOnly(sibling.value)) continue;
      return "unknown";
    }
    return sibling;
  }
  return undefined;
}

/**
 * Is this html node the first of its run — the one that reports placement?
 *
 * A directive merges with the directives before it, so a node preceded by
 * another directive-carrying comment node is in the middle of a run and stays
 * quiet. A node preceded by a comment that carries no *valid* directive still
 * reports: that neighbour has its own finding, but not this one.
 */
function startsRun(children: RootContent[], index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const sibling = children[i];
    if (sibling === undefined) return true;
    if (sibling.type === "definition") continue;
    if (sibling.type === "footnoteDefinition") continue;
    if (sibling.type !== "html") return true;
    if (!isCommentOnly(sibling.value)) return true;
    return directiveNames(sibling.value).length === 0;
  }
  return true;
}

/** The names of every directive in the rest of this run. */
function namesAfter(children: RootContent[], index: number): string[] {
  const names: string[] = [];
  for (let i = index + 1; i < children.length; i++) {
    const sibling = children[i];
    if (sibling === undefined) break;
    if (sibling.type === "definition") continue;
    if (sibling.type === "footnoteDefinition") continue;
    if (sibling.type !== "html" || !isCommentOnly(sibling.value)) break;
    names.push(...directiveNames(sibling.value));
  }
  return names;
}

/** The directive names one raw html node carries, unknown ones dropped. */
function directiveNames(raw: string): string[] {
  const names: string[] = [];
  for (const segment of scanComments(raw)) {
    if (segment.kind !== "comment" || segment.terminator !== "-->") continue;
    const parsed = parseVantageDirective(segment.value);
    if (parsed === null || parsed.kind !== "directive") continue;
    if (DIRECTIVE_VOCABULARY[parsed.name] === undefined) continue;
    names.push(parsed.name);
  }
  return names;
}

/** Nothing but comments and whitespace, so hast sees no element here. */
function isCommentOnly(raw: string): boolean {
  const segments = scanComments(raw);
  let comments = 0;
  for (const segment of segments) {
    if (segment.kind === "comment") {
      comments++;
      continue;
    }
    if (segment.value.trim() !== "") return false;
  }
  return comments > 0;
}

/**
 * The hast tag an mdast block becomes, or `undefined` when it is not worth
 * predicting.
 *
 * `math` is the interesting one: with math enabled — which is what both viewers
 * and this checker's own parser do — a `$$…$$` block renders as
 * `<span class="katex-display">`, so it is a block in Markdown and no kind of
 * stampable target in hast. Measured, not assumed.
 */
function targetTag(node: RootContent): string | undefined {
  switch (node.type) {
    case "paragraph":
      return "p";
    case "heading":
      return `h${Math.min(Math.max(node.depth, 1), 6)}`;
    case "blockquote":
      return "blockquote";
    case "code":
      return "pre";
    case "list":
      return node.ordered === true ? "ol" : "ul";
    case "table":
      return "table";
    case "thematicBreak":
      return "hr";
    case "math":
      return "span";
    default:
      return undefined;
  }
}

/**
 * Is this list loose? `mdast-util-to-hast`'s own rule, copied deliberately.
 *
 * In a *tight* list the `<p>` wrapper around every item's paragraphs is
 * removed, so a directive inside a tight item has no paragraph to stamp. One
 * loose item makes the whole list loose, which is why this cannot be answered
 * from the item alone.
 */
function listIsLoose(list: List): boolean {
  if (list.spread === true) return true;
  return list.children.some((item) =>
    item.spread === null || item.spread === undefined
      ? item.children.length > 1
      : item.spread,
  );
}

/**
 * The A6 placement bug: a directive at the start of a line between two items
 * of one list ends that list and starts another.
 *
 * Measured: `9. Question nine` / blank / `<!-- vantage: oq -->` / blank /
 * `10. Question ten` renders as `<ol start="9">` plus `<ol start="10">` where
 * deleting the comment renders one list. So the comment *changes the document*,
 * in Vantage and on GitHub alike, which is the one thing **D1** forbids — and
 * the author cannot see it, because the thing that caused it is invisible.
 *
 * The marker characters are read from the source before reporting: `1. a`
 * followed by `1) b` is two lists in CommonMark whatever sits between them, and
 * so is `- a` followed by `* b`. Without that check those would be false
 * findings.
 */
function splitList(
  collector: Collector,
  parent: Parents,
  index: number,
): string | undefined {
  if (!BLOCK_PARENTS.has(parent.type)) return undefined;

  const before = neighbourList(parent.children, index, -1);
  const after = neighbourList(parent.children, index, 1);
  if (before === undefined || after === undefined) return undefined;
  if (before.ordered !== after.ordered) return undefined;

  const beforeMarker = listMarker(collector, before);
  const afterMarker = listMarker(collector, after);
  if (beforeMarker === undefined || afterMarker === undefined) return undefined;
  if (beforeMarker !== afterMarker) return undefined;

  const ordered = before.ordered === true;
  const renumbered = ordered
    ? ", the second half renumbered with a `start` attribute"
    : "";
  return `This directive sits between two items of a ${ordered ? "numbered" : "bulleted"} list, at the start of the line, so Markdown ends the list here and starts a second one. The halves render as two lists — different item spacing${renumbered} — which means this invisible comment changes the document, in Vantage and on GitHub alike. Indent it inside the list item instead, on its own line, directly before the block it describes.`;
}

/** The list immediately before or after `index`, comment nodes skipped. */
function neighbourList(
  children: RootContent[],
  index: number,
  step: -1 | 1,
): List | undefined {
  for (let i = index + step; i >= 0 && i < children.length; i += step) {
    const sibling = children[i];
    if (sibling === undefined) return undefined;
    if (sibling.type === "html" && isCommentOnly(sibling.value)) continue;
    return sibling.type === "list" ? sibling : undefined;
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * The general placement check: delete it and re-parse
 * ------------------------------------------------------------------ */

/**
 * **D1**, measured the way **P1** states it: take the markup away and compare.
 *
 * `splitList` is one instance of this — the one we happened to measure — and the
 * shape of it generalises. A comment at the start of a line ends whatever block
 * it lands inside, and *every* multi-line construct suffers: a GFM table drops
 * its remaining rows onto the page as literal `| … |` text, one paragraph
 * becomes two, one block quote becomes two, a setext heading's `===` underline
 * stops being an underline, and an indented code block splits in half — even with
 * blank lines on both sides, because a blank line inside indented code belongs to
 * the code. Enumerating those five would leave the sixth for a later reviewer, so
 * this asks the question directly instead: parse the source with the directive,
 * parse it without, and compare the block structure.
 *
 * Cost is bounded by *slicing*, which is what makes the general test cheaper
 * than the enumeration it replaces. The comparison never re-parses the document:
 * it re-parses only the span the deletion can affect — the two neighbouring
 * siblings when the directive sits at the top level, or the enclosing top-level
 * block when it sits inside a list item or a quote. Both slices start at a
 * top-level block boundary, so they parse the same way in isolation as in place.
 * Measured: a whole-document re-parse of this repo's largest doc is 70 ms, a
 * top-level slice is unmeasurable against run-to-run noise, and the worst shape —
 * 40 directives inside one 200-line top-level list, so 40 re-parses of that list
 * — costs 0.8 ms each. Validated for false positives over 1056 documents built by
 * embedding every legal placement this suite and the style guide use in eight
 * preceding contexts, four trailing ones and three nestings: zero findings. And
 * for false negatives over the same matrix of the six defect shapes: all six
 * reported in every context.
 *
 * `undefined` when the structures agree, which is the overwhelmingly common case
 * and the one every legal placement lands in.
 */
function blockSplit(
  collector: Collector,
  root: Root,
  parent: Parents,
  index: number,
): string | undefined {
  if (!BLOCK_PARENTS.has(parent.type)) return undefined;

  const node = parent.children[index];
  // Only a comment that owns its whole lines: an inline one (in a table cell, or
  // mid-paragraph) is not on a line this may delete, and a comment buried in a
  // larger raw-HTML block is not a line either.
  if (node?.type !== "html" || !isCommentOnly(node.value)) return undefined;

  const before = neighbourBlock(parent.children, index, -1);
  const after = neighbourBlock(parent.children, index, 1);
  if (before === undefined || after === undefined) return undefined;

  // The slice, in *body* lines — which is what the tree's positions are in, and
  // what `parseMarkdown` wants back.
  const span =
    parent.type === "root"
      ? {
          start: before.node.position?.start.line,
          end: after.node.position?.end.line,
        }
      : topLevelSpan(root, node);
  if (span?.start === undefined || span.end === undefined) return undefined;

  // Every comment-only directive line between the two neighbours goes, not just
  // this node's: consecutive directives are one run, and P1 asks what the
  // document looks like with the whole run absent.
  const cut = new Set<number>();
  for (let i = before.index + 1; i < after.index; i++) {
    const sibling = parent.children[i];
    if (sibling?.type !== "html" || !isCommentOnly(sibling.value)) continue;
    const from = sibling.position?.start.line;
    const to = sibling.position?.end.line;
    if (from === undefined || to === undefined) return undefined;
    for (let line = from; line <= to; line++) cut.add(line);
  }
  if (cut.size === 0) return undefined;

  const lines: string[] = [];
  const without: string[] = [];
  for (let line = span.start; line <= span.end; line++) {
    const text = collector.doc.lines[fileLine(collector.doc, line) - 1];
    if (text === undefined) return undefined;
    lines.push(text);
    if (!cut.has(line)) without.push(text);
  }

  const withIt = blockShape(parseMarkdown(lines.join("\n")));
  const withoutIt = blockShape(parseMarkdown(without.join("\n")));
  if (withIt === withoutIt) return undefined;

  return splitMessage(before.node, withIt, withoutIt);
}

/** The sibling before or after `index`, other directive comments skipped. */
function neighbourBlock(
  children: RootContent[],
  index: number,
  step: -1 | 1,
): { node: RootContent; index: number } | undefined {
  for (let i = index + step; i >= 0 && i < children.length; i += step) {
    const sibling = children[i];
    if (sibling === undefined) return undefined;
    if (sibling.type === "html" && isCommentOnly(sibling.value)) continue;
    return { node: sibling, index: i };
  }
  return undefined;
}

/** The line span of the top-level block that contains `node`. */
function topLevelSpan(
  root: Root,
  node: RootContent,
): { start: number | undefined; end: number | undefined } | undefined {
  const start = node.position?.start.line;
  const end = node.position?.end.line;
  if (start === undefined || end === undefined) return undefined;
  for (const child of root.children) {
    const from = child.position?.start.line;
    const to = child.position?.end.line;
    if (from === undefined || to === undefined) continue;
    if (from <= start && to >= end) {
      return { start: from, end: to };
    }
  }
  return undefined;
}

/** mdast node types that carry block structure. Phrasing is not compared. */
const SHAPE_TYPES = new Set([
  "root",
  "paragraph",
  "heading",
  "blockquote",
  "list",
  "listItem",
  "code",
  "table",
  "tableRow",
  "tableCell",
  "thematicBreak",
  "definition",
  "footnoteDefinition",
  "math",
]);

/**
 * A tree's block structure as one comparable string.
 *
 * Positions are deliberately absent — deleting a line moves every line after it,
 * and that is not a change to the document. Inline content is absent for the same
 * reason a reader would not call it a restructuring. What *is* included beyond
 * the node types is everything that changes the rendered block: a heading's
 * depth, a list's marker kind, its `start` and its looseness (one loose item is
 * 16px of margin per item, which is what makes a split list visible at all).
 *
 * Directive comments are skipped, so the two sides can be compared with the
 * comment present on one of them.
 */
function blockShape(tree: Root): string {
  const out: string[] = [];
  const walk = (node: RootContent | Root): void => {
    if (node.type === "html") {
      if (!isCommentOnly(node.value)) out.push("html");
      return;
    }
    if (!SHAPE_TYPES.has(node.type)) return;
    let token: string = node.type;
    if (node.type === "heading") token += `:${node.depth}`;
    if (node.type === "code") token += `:${node.lang ?? ""}`;
    if (node.type === "list") {
      token += `:${node.ordered === true ? `ol:${node.start ?? ""}` : "ul"}:${
        listIsLoose(node) ? "loose" : "tight"
      }`;
    }
    out.push(token);
    if ("children" in node) {
      for (const child of node.children) walk(child as RootContent);
    }
  };
  walk(tree);
  return out.join(" ");
}

/**
 * What the author needs to know: the construct that got cut, the measured
 * consequence, and the one fix that actually works.
 *
 * The *detection* above is general; only the naming here is per-construct, with a
 * fallback for anything not enumerated — so a construct nobody thought of is
 * still reported, just in plainer words.
 *
 * The fix is always "above the whole construct", never "add blank lines": blank
 * lines around the comment still leave two block quotes, two lists and two
 * paragraphs. The block after a directive has to be a block in its own right.
 */
function splitMessage(
  before: RootContent,
  withIt: string,
  withoutIt: string,
): string {
  // A setext heading is the one case the neighbour's own type cannot name: both
  // halves are paragraphs, and the heading only exists in the *absence* of the
  // comment.
  const setext =
    before.type === "paragraph" &&
    !withIt.includes("heading:") &&
    withoutIt.includes("heading:");
  if (setext) {
    return "This directive sits between a heading and its `===` or `---` underline, so the underline stops being an underline: the heading renders as two paragraphs and the row of `=` or `-` lands on the page as text the document does not contain. An invisible comment that changes what the page says is the one thing a directive must never do, in Vantage and on GitHub alike. Put the directive above the heading instead.";
  }

  const name = SPLIT_NAMES[before.type] ?? "block";
  const consequence = SPLIT_CONSEQUENCES[before.type] ?? "it renders as two";
  return `This directive sits at the start of a line in the middle of a ${name}, so Markdown ends the ${name} there and ${consequence}. Deleting the comment renders a different document, which means this invisible comment changes the page — in Vantage and on GitHub alike. A directive cannot go inside a block: put the directive above the whole ${name}, where the thing after it is already a block of its own.`;
}

const SPLIT_NAMES: Record<string, string> = {
  paragraph: "paragraph",
  blockquote: "block quote",
  table: "table",
  code: "indented code block",
  list: "list",
  heading: "heading",
};

const SPLIT_CONSEQUENCES: Record<string, string> = {
  paragraph: "the one paragraph renders as two",
  blockquote: "the one quote renders as two",
  table:
    "every row after it stops being a row and renders as literal `| … |` text",
  code: "the one code block renders as two",
  list: "the one list renders as two",
};

/** `-`, `*`, `+`, `.` or `)` — the character that decides list identity. */
function listMarker(collector: Collector, list: List): string | undefined {
  const line = list.position?.start.line;
  if (line === undefined) return undefined;
  const text = collector.doc.lines[fileLine(collector.doc, line) - 1];
  if (text === undefined) return undefined;
  const match = /^\s*(?:([-*+])|\d{1,9}([.)]))/.exec(text);
  return match?.[1] ?? match?.[2];
}

/* ------------------------------------------------------------------ *
 * Positions and prose
 * ------------------------------------------------------------------ */

/**
 * The file position of a character offset inside an html node's raw text.
 *
 * The line is exact — newlines survive verbatim in the node's value. The column
 * is trusted only on the node's first line: inside a blockquote or a list item
 * mdast has already stripped the `> ` or the indent from later lines, so an
 * offset-derived column there would be short by the prefix. Column 1 is honest;
 * a wrong column inside an otherwise correct finding costs the same trust a
 * wrong finding does.
 */
function positionOf(
  collector: Collector,
  node: Html,
  offset: number,
): FilePosition {
  const start = node.position?.start;
  const newlines = node.value.slice(0, offset).split("\n").length - 1;
  return {
    line: fileLine(collector.doc, (start?.line ?? 1) + newlines),
    column: newlines === 0 ? (start?.column ?? 1) + offset : 1,
  };
}

/**
 * `` `a`, `b` or `c` `` — for naming a closed set in a message.
 *
 * Exported for the `vantage:` frontmatter rules, which name closed sets for the
 * same reason and should phrase them identically.
 */
export function orList(values: readonly string[]): string {
  const quoted = values.map((value) => `\`${value}\``);
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
}
