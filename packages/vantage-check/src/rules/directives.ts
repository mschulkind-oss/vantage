import { dirname, resolve } from "node:path";
import type { Html, List, ListItem, Parents, Root, RootContent } from "mdast";
import { visit } from "unist-util-visit";
// The viewer's own grammar, vocabulary and target-tag lists, imported from
// source. A checker with its own copy of any of the four disagrees with the
// renderer sooner or later, and the disagreement is invisible: both sides stay
// silent by design (D5).
import type { ParsedDirective } from "../../../vantage-md/src/vantageDirectives.js";
import { LEANING_MARKER } from "../../../vantage-md/src/planning/leaning.js";
import {
  DIRECTIVE_VOCABULARY,
  hasVantageSentinel,
  isQuestionDirective,
  parseVantageDirective,
  VANTAGE_OQ_HOST_TARGETS,
  VANTAGE_OQ_STATUS,
  VANTAGE_FALLBACK_TARGETS,
  VANTAGE_SENTINEL,
  VANTAGE_STYLE_TARGETS,
  vantageOqStatus,
} from "../../../vantage-md/src/vantageDirectives.js";
import type { VantageQuestionName } from "../../../vantage-md/src/vantageDirectives.js";
import { scanPlanningDocument } from "../../../vantage-md/src/planning/scan.js";
import type {
  PlanningQuestion,
  QuestionState,
} from "../../../vantage-md/src/planning/scan.js";
// Where a directive lands, predicted from mdast. Shared with the planning
// index's scan, which has to reach the same answer about which question
// directive lands where a button can sit (D5).
import {
  BLOCK_PARENTS,
  PHRASING_PARENTS,
  isCommentOnly,
  isFallbackTarget,
  listIsLoose,
  nextBlock,
  nextContentInNode,
  targetTag,
} from "../../../vantage-md/src/directiveTargets.js";
import { scanComments } from "../core/comments.js";
import { collectOqIds } from "../core/openQuestions.js";
import type { DeclaredOq } from "../core/openQuestions.js";
import type { CommentSegment, Segment } from "../core/comments.js";
import type { Collector, FilePosition } from "../core/collector.js";
import { fileLine, parseMarkdown } from "../core/document.js";
import { readsOnlyOq } from "../core/target.js";
import { repositoryRoot } from "../core/projectRoot.js";
import type { Target } from "../core/config.js";
import type { Finding } from "../core/types.js";
import { RELEASE, viewerName } from "../version.js";

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
  /**
   * The *with-the-directive* shape of a slice, per slice.
   *
   * Every run inside one enclosing top-level block re-parses the identical
   * slice to the identical shape, so N nested directives in one list paid 2N
   * parses of that list where N + 1 will do. The other side of each comparison
   * genuinely differs — each run cuts different lines — so only this half is
   * shared.
   */
  const shapes = new Map<string, string>();

  visit(root, "html", (node, index, parent) => {
    // The cheap gate, before any scanning: it is what keeps this rule off
    // `<!-- TODO: rewrite this -->` and off every `<div>` in the tree.
    if (!node.value.includes(VANTAGE_SENTINEL)) return;

    const segments = scanComments(node.value);
    const at = (offset: number): FilePosition =>
      positionOf(collector, node, offset);

    /**
     * The keys this run has set already, per merge family.
     *
     * Duplicate detection is scoped to the *run*, because the run is what
     * merges: `stampRun` folds every directive up to the target into one key map
     * with last-key-wins, whether the keys were written in one comment or in
     * several. `section` and `block` share that map; `oq` and `question` share
     * theirs, since one run declares one question whichever names it. Scoping
     * per comment reported `tone=note tone=warning` and stayed silent on the
     * same two values one line apart — the same lost value, harder to see.
     */
    const seenStyle = new Set<string>();
    const seenOq = new Set<string>();
    if (parent !== undefined && index !== undefined)
      seedRunKeys(parent.children, index, seenStyle, seenOq);

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
          unknownNameMessage(parsed.name),
          typoOrNewer(parsed.name),
        );
        continue;
      }

      const seen = isQuestionDirective(parsed.name) ? seenOq : seenStyle;
      /** Keys set by *this* directive, which is all the message differs on. */
      const here = new Set<string>();
      for (const pair of parsed.pairs) {
        const keyAt = innerAt(pair.keyOffset);

        if (seen.has(pair.key)) {
          collector.report(
            "vantage/duplicate-key",
            keyAt,
            here.has(pair.key)
              ? `\`${pair.key}\` is set twice in this directive. The last one wins silently, so one of the two values is doing nothing.`
              : `\`${pair.key}\` is set twice in this run of directives. Consecutive directives merge onto one block and the last one wins silently — a blank line between them changes nothing — so one of the two values is doing nothing.`,
          );
        }
        seen.add(pair.key);
        here.add(pair.key);

        const values = keys[pair.key];
        if (values === undefined) {
          collector.report(
            "vantage/unknown-key",
            keyAt,
            unknownKeyMessage(parsed.name, pair.key, Object.keys(keys)),
            typoOrNewer(pair.key),
          );
          continue;
        }
        // A free-text value — a question's `id` or `leaning`. No closed set
        // can cover a sentence, so there is nothing to check.
        if (values === null) continue;

        if (!values.includes(pair.value)) {
          collector.report(
            "vantage/unknown-value",
            innerAt(pair.valueOffset),
            unknownValueMessage(pair.key, pair.value, values),
            typoOrNewer(pair.value),
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
    //
    // Gated on the rule, unlike every other check here: this is the only one
    // that costs real time, so switching it off has to actually buy the time
    // back rather than run the experiment and drop the answer.
    if (collector.enabled("vantage/block-split")) {
      const restructured = blockSplit(collector, root, parent, index, shapes);
      if (restructured !== undefined) {
        collector.report("vantage/block-split", at(firstOffset), restructured);
      }
    }
  });
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

/**
 * `VANTAGE_STYLE_TARGETS` plus `span`, which is display math and nothing else —
 * `targetTag` maps only `math` onto it.
 *
 * A `$$…$$` block is a `<pre>` when the plugin runs, so it is a real style
 * target and is stamped; `rehype-katex` then replaces that `<pre>` with a
 * `<span class="katex-display">`, and `rehypeVantageMathStamps` copies the stamp
 * onto the span that took its place. Measured through the real chain: the
 * rendered span carries `data-vantage-tone` and `data-vantage-run`, so a style
 * directive above a formula styles something and must not be reported.
 *
 * Deliberately *not* added to `OQ_HOST_TARGETS`: a `<button>` inside a KaTeX span
 * is still no affordance, so a question directive above a formula is still a
 * finding, under either name.
 */
const STYLE_TARGETS = new Set<string>([...VANTAGE_STYLE_TARGETS, "span"]);
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
  // What a misplaced run fails to do: a styling directive styles nothing, and
  // a `fallback` withholds nothing, which leaves its stand-in on the page
  // beside what it stands in for.
  const fallbackOnly =
    names.length > 0 && names.every((name) => name === "fallback");
  const nothing = fallbackOnly
    ? "the fallback withholds nothing, so Vantage shows the block it was meant to withhold"
    : "nothing is styled";

  // (a) Something else in this same html node comes after the directive.
  const inNode = nextContentInNode(segments, lastDirective);
  if (inNode === "markup") {
    return names.includes("fallback")
      ? rawFallbackReason(segments, lastDirective, names)
      : undefined;
  }
  if (inNode === "text") {
    return `Text follows this directive inside the same HTML block, so the next thing Vantage sees is that text rather than a block, and ${nothing}. Put the directive on a line of its own, with a blank line after it.`;
  }

  // (b) The directive is inline — inside a paragraph, a heading, a table cell.
  // The plugin does reach it (it walks the whole tree), but everything after it
  // there is inline content, and no inline tag is a stampable target.
  if (!BLOCK_PARENTS.has(parent.type)) {
    if (!PHRASING_PARENTS.has(parent.type)) return undefined;
    return `This directive is inline, inside a ${parent.type}, rather than on a line of its own, so the only thing after it is inline content and ${nothing}. Put it on its own line, with a blank line before and after it.`;
  }

  // (c) Nothing follows it that becomes an element.
  const target = nextBlock(parent.children, index);
  if (target === "unknown") {
    if (!names.includes("fallback")) return undefined;
    const raw = nextHtml(parent.children, index);
    return raw === undefined
      ? undefined
      : rawFallbackReason(scanComments(raw.value), -1, names);
  }
  if (target === undefined) {
    return `Nothing follows this directive, so there is no block for it to attach to and ${fallbackOnly ? nothing : "it styles nothing"}. A directive applies to the block *after* it.`;
  }

  // (d) The target is a paragraph in a tight list item, which never becomes a
  // `<p>` at all — measured: `- one\n  <!-- vantage: block tone=note -->\n  two`
  // renders as `<li>one\n\ntwo</li>` with nothing stamped.
  if (target.type === "paragraph" && parent.type === "listItem") {
    const list = listHolding(parent);
    if (list !== undefined && !listIsLoose(list)) {
      return `This list item has no blank lines in it, so Markdown renders its paragraphs as bare text with no block for the directive to attach to${fallbackOnly ? `, and ${nothing}` : ""}. Put a blank line before and after the directive — that makes the item's paragraphs real blocks, and the directive lands on the one after it.`;
    }
  }

  const tag = targetTag(target);
  if (tag === undefined) return undefined;
  const name = TARGET_NAMES[tag] ?? tag;

  // A `fallback` withholds its block before anything else is stamped, and
  // takes the rest of its run with it — so it is answered first, and either
  // way the run's other names are answered by it.
  if (names.includes("fallback")) {
    const fallback = fallbackReason(tag, name, names);
    if (fallback !== undefined || isFallbackTarget(tag)) return fallback;
  }

  // (e) The target is a block, but not one this name can stamp. The two lists
  // differ: a question needs a tag that can *host the button*, so a question
  // directive above a list attaches to the `<ul>` and no button ever appears —
  // and one above a fence or a table does stamp, which makes the silence worse
  // rather than better: the author has an attribute and no affordance. Neither
  // name declares a question there, so the planning index and the contents
  // column miss it too, in every state.
  if (names.some(isQuestionDirective) && !OQ_HOST_TARGETS.has(tag)) {
    let fix = "";
    if (tag === "ul" || tag === "ol") {
      fix =
        " Indent it inside the list item instead, on its own line, directly before the question's `_Leaning:_` paragraph, or another of its paragraphs when it states none.";
    } else if (tag === "pre" || tag === "table") {
      // Both are anchorable, so the directive stamps; what fails is the button.
      fix =
        " A button cannot live inside a code block or a table — inside a `<pre>` it would render as part of the code, and a `<button>` child of `<table>` is not valid HTML — so put the directive above the paragraph that introduces it.";
    }
    return `A question can only be declared on a ${OQ_HOST_NAMES}, and the block after this directive is a ${name}, so neither the contents column nor the planning index counts it, and review mode offers no one-click answer for it.${fix}`;
  }
  if (names.some((n) => !isQuestionDirective(n)) && !STYLE_TARGETS.has(tag)) {
    return `The block after this directive is a ${name}, which Vantage does not stamp, so this directive styles nothing.`;
  }

  return undefined;
}

/**
 * Why a run holding `fallback` misfires, or `undefined` when it withholds its
 * block as written.
 *
 * Two ways, and both leave something on the page the author did not mean:
 *
 * - **On a heading,** which a fallback never withholds — it is the document's
 *   structure, not a stand-in (`VANTAGE_FALLBACK_TARGETS`). Vantage shows the
 *   heading, and the rest of the run stamps it as usual.
 * - **Merged with another directive,** which goes with the block. A `block
 *   tone=…` or an `oq` written in the same run reaches nothing, because the
 *   only block it could reach is one Vantage never shows.
 */
function fallbackReason(
  tag: string,
  name: string,
  names: string[],
): string | undefined {
  if (!isFallbackTarget(tag)) {
    return `A fallback block is never a ${name}, so Vantage shows this ${name} and the fallback withholds nothing. Put the directive above the paragraph, list, quote or code block that stands in for what Vantage shows, beneath the heading.`;
  }
  const others = [...new Set(names.filter((n) => n !== "fallback"))];
  if (others.length === 0) return undefined;
  return `This run of directives carries \`fallback\`, so Vantage never renders the block after it, and ${orList(others)} in the same run goes with it and does nothing. A fallback block is only for readers whose renderer is not Vantage, so it needs nothing else; put the other directive above a block Vantage shows.`;
}

/** The tags a `fallback` withholds, as raw HTML names them (no math here). */
const RAW_FALLBACK_TARGETS = new Set<string>(VANTAGE_FALLBACK_TARGETS);

/**
 * The next sibling `html` node that holds more than comments, when the run
 * lands on raw HTML rather than on a Markdown block.
 */
function nextHtml(children: RootContent[], index: number): Html | undefined {
  for (let i = index + 1; i < children.length; i++) {
    const sibling = children[i];
    if (sibling === undefined) return undefined;
    if (sibling.type === "definition") continue;
    if (sibling.type === "footnoteDefinition") continue;
    if (sibling.type !== "html") return undefined;
    if (isCommentOnly(sibling.value)) continue;
    return sibling;
  }
  return undefined;
}

/**
 * Why a run holding `fallback` that lands on raw HTML misfires, or
 * `undefined` when it withholds its block or the tree cannot say.
 *
 * Raw HTML is read by its first tag, the element `rehype-raw` builds: a
 * fallback withholds it when that tag is on `VANTAGE_FALLBACK_TARGETS`, as
 * the renderer decides, and leaves it on the page otherwise. A raw `<img>`,
 * `<figure>` or `<details>` is the likely case: written as a picture of the
 * drawing, it is shown beside the drawing it stands in for. Anything that is
 * not an opening tag — a closing tag ending the raw block the directive sits
 * in — settles nothing, and says nothing.
 */
function rawFallbackReason(
  segments: Segment[],
  after: number,
  names: string[],
): string | undefined {
  let tag: string | undefined;
  for (let i = after + 1; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === undefined || segment.kind === "comment") continue;
    const rest = segment.value.trim();
    if (rest === "") continue;
    tag = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(rest)?.[1]?.toLowerCase();
    break;
  }
  if (tag === undefined) return undefined;
  if (/^h[1-6]$/.test(tag)) return fallbackReason(tag, "heading", names);
  if (RAW_FALLBACK_TARGETS.has(tag))
    return fallbackReason(tag, `<${tag}>`, names);
  return `A fallback block is a paragraph, a list, a quote, a code block, a table, a rule or a \`<div>\`, and the block after this directive is a raw \`<${tag}>\`, so the fallback withholds nothing and Vantage shows it beside what it stands in for. Wrap it in a \`<div>\` on lines of its own, or write it in Markdown, such as a paragraph holding \`![the drawing](drawing.svg)\`.`;
}

/**
 * Is this html node the first of its run — the one that reports placement?
 *
 * A directive merges with the directives before it, so a node preceded by
 * another directive-carrying comment node is in the middle of a run and stays
 * quiet. A node preceded by a comment that carries no *valid* directive still
 * reports: that neighbor has its own finding, but not this one.
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

/**
 * The keys the directives *earlier* in this run have already set, per family.
 *
 * The walk is `startsRun`'s in reverse, and it deliberately does not stop at a
 * foreign comment: `stampRun` skips comments and whitespace alike on its way to
 * the target, so `<!-- TODO -->` between two directives does not break the merge
 * and must not break the check of it either.
 */
function seedRunKeys(
  children: RootContent[],
  index: number,
  style: Set<string>,
  oq: Set<string>,
): void {
  for (let i = index - 1; i >= 0; i--) {
    const sibling = children[i];
    if (sibling === undefined) return;
    if (sibling.type === "definition") continue;
    if (sibling.type === "footnoteDefinition") continue;
    if (sibling.type !== "html" || !isCommentOnly(sibling.value)) return;
    for (const directive of directivesIn(sibling.value)) {
      const seen = isQuestionDirective(directive.name) ? oq : style;
      for (const pair of directive.pairs) seen.add(pair.key);
    }
  }
}

/** The directive names one raw html node carries, unknown ones dropped. */
function directiveNames(raw: string): string[] {
  return directivesIn(raw).map((directive) => directive.name);
}

/** The directives one raw html node carries, unknown names dropped. */
function directivesIn(raw: string): ParsedDirective[] {
  const directives: ParsedDirective[] = [];
  for (const segment of scanComments(raw)) {
    if (segment.kind !== "comment" || segment.terminator !== "-->") continue;
    const parsed = parseVantageDirective(segment.value);
    if (parsed === null || parsed.kind !== "directive") continue;
    if (DIRECTIVE_VOCABULARY[parsed.name] === undefined) continue;
    directives.push(parsed);
  }
  return directives;
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

  const before = neighborList(parent.children, index, -1);
  const after = neighborList(parent.children, index, 1);
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

/**
 * The list immediately before or after `index`, other directives skipped.
 *
 * Only *directive* comments are transparent here. A foreign comment-only node
 * is the author's own markup — and `<!-- -->` is CommonMark's documented
 * separator between two lists, so it is the one comment that is *load-bearing*
 * between them. Skipping it would report a split this directive did not cause.
 */
function neighborList(
  children: RootContent[],
  index: number,
  step: -1 | 1,
): List | undefined {
  for (let i = index + step; i >= 0 && i < children.length; i += step) {
    const sibling = children[i];
    if (sibling === undefined) return undefined;
    if (
      sibling.type === "html" &&
      isCommentOnly(sibling.value) &&
      directiveNames(sibling.value).length > 0
    )
      continue;
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
 * shape of it generalizes. A comment at the start of a line ends whatever block
 * it lands inside, and *every* multi-line construct suffers: a GFM table drops
 * its remaining rows onto the page as literal `| … |` text, one paragraph
 * becomes two, one block quote becomes two, a setext heading's `===` underline
 * stops being an underline, and an indented code block splits in half — even with
 * blank lines on both sides, because a blank line inside indented code belongs to
 * the code. Enumerating those five would leave the sixth for a later reviewer, so
 * this asks the question directly instead: parse the source with the directive,
 * parse it without, and compare the block structure.
 *
 * Cost is bounded by *slicing*: the comparison re-parses only the span the
 * deletion can affect — the two neighboring siblings when the directive sits at
 * the top level, or the enclosing top-level block when it sits inside a list
 * item, a quote or a footnote definition. Both slices start at a top-level block
 * boundary, so they parse the same way in isolation as in place.
 *
 * **The cost model is O(directives × enclosing top-level block), and for the
 * nested placement that is not "a few lines".** A6 makes nesting the only legal
 * `oq` form, so an Open Questions document is one long list in which every
 * question re-parses the whole list. Measured on a 40-question list (283 lines,
 * one `oq` per item, the shape A6 mandates): 171 ms, down from 328 ms before the
 * `shapes` cache below, against 0.3 ms for the same document with the rule off.
 * It grows as the square of the question count — 80 questions is 710 ms and 160
 * is 3.0 s — which is why `checkDirectives` gates the call on the rule being
 * enabled: a pathological document has to have a way out. The `without`
 * side cannot be shared, because each run cuts different lines, so the cache is
 * a factor of two rather than a change of model. Validated for false positives
 * over 1056 documents built by
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
  shapes: Map<string, string>,
): string | undefined {
  if (!BLOCK_PARENTS.has(parent.type)) return undefined;

  const node = parent.children[index];
  // Only a comment that owns its whole lines: an inline one (in a table cell, or
  // mid-paragraph) is not on a line this may delete, and a comment buried in a
  // larger raw-HTML block is not a line either.
  if (node?.type !== "html" || !isCommentOnly(node.value)) return undefined;

  const before = neighborBlock(parent.children, index, -1);
  const after = neighborBlock(parent.children, index, 1);
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

  // Every *directive* line between the two neighbors goes, not just this
  // node's: consecutive directives are one run, they merge onto one target, and
  // P1 asks what the document looks like with the whole run absent. Cutting only
  // the head of a run would leave the rest of it splitting the block and report
  // nothing.
  //
  // A foreign comment-only node — `<!-- -->`, `<!-- prettier-ignore -->` — is
  // *not* cut. It is the author's own markup, and `<!-- -->` is CommonMark's
  // documented separator between two lists and between two indented code
  // blocks, so deleting it would answer a question about *it* and hand this
  // directive the blame for the answer.
  const cut = new Set<number>();
  for (let i = before.index + 1; i < after.index; i++) {
    const sibling = parent.children[i];
    if (sibling?.type !== "html" || !isCommentOnly(sibling.value)) continue;
    if (sibling !== node && directiveNames(sibling.value).length === 0)
      continue;
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

  // The with-it side depends on the slice alone, so every run inside one
  // top-level block computes it once.
  const key = `${span.start}:${span.end}`;
  let withIt = shapes.get(key);
  if (withIt === undefined) {
    withIt = blockShape(parseMarkdown(lines.join("\n")));
    shapes.set(key, withIt);
  }
  const withoutIt = blockShape(parseMarkdown(without.join("\n")));
  if (withIt === withoutIt) return undefined;

  return splitMessage(before.node, withIt, withoutIt);
}

/** The sibling before or after `index`, other directive comments skipped. */
function neighborBlock(
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
  // A setext heading is the one case the neighbor's own type cannot name: both
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
  const article = /^[aeiou]/.test(name) ? "an" : "a";
  return `This directive sits at the start of a line in the middle of ${article} ${name}, so Markdown ends the ${name} there and ${consequence}. Deleting the comment renders a different document, which means this invisible comment changes the page — in Vantage and on GitHub alike. A directive cannot go inside a block: put the directive above the whole ${name}, where the thing after it is already a block of its own.`;
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

/*
 * The three `vantage/unknown-*` messages, and the advice under them
 * (`docs/design/checker-version-skew.md` §6.2).
 *
 * A name, key or value this checker does not know is usually a typo, which is
 * why each is an error. But it can also be markup from a newer Vantage than
 * this checker — a pinned install, or an agent whose checker is a release
 * behind its readers' viewer — and there, deleting it to make the finding go
 * away removes something the readers' viewer renders. So each message says what
 * a viewer at *this checker's* version does with the markup, which is the only
 * viewer it can speak for, and the advice under it names both cases.
 *
 * None of them gives an upgrade command. Most hits are typos, and "upgrade" is
 * the wrong fix for a document: a newer checker silences the finding whether or
 * not the reader's viewer renders the markup. These strings are frozen into
 * every pinned install of a release, so they have to stay right for as long as
 * one runs.
 */

export function unknownNameMessage(
  name: string,
  release: string | undefined = RELEASE,
): string {
  return `\`${name}\` is not a directive name, so ${viewerName(release)} drops the whole directive and nothing is styled. It knows ${orList(Object.keys(DIRECTIVE_VOCABULARY))}.`;
}

export function unknownKeyMessage(
  name: string,
  key: string,
  accepted: readonly string[],
  release: string | undefined = RELEASE,
): string {
  // `fallback` accepts none, and "accepts ." is not a sentence.
  const keys =
    accepted.length === 0
      ? `\`${name}\` takes no keys.`
      : `\`${name}\` accepts ${orList(accepted)}.`;
  return `\`${key}\` is not a key \`${name}\` accepts, so ${viewerName(release)} drops that pair while the directive's other keys still apply. ${keys}`;
}

export function unknownValueMessage(
  key: string,
  value: string,
  accepted: readonly string[],
  release: string | undefined = RELEASE,
): string {
  return `\`${value}\` is not a value \`${key}\` accepts, so ${viewerName(release)} drops that pair and nothing is styled. \`${key}\` accepts ${orList(accepted)}. The vocabulary is closed on purpose: a document names what a section *is*, never what it should look like.`;
}

/** The advice under each of the three: fix a typo, keep what is newer. */
export function typoOrNewer(token: string): string {
  return `If \`${token}\` is a typo, fix it. If it comes from a newer Vantage, don't remove it: this repository's readers need that version, and a newer vantage-check checks it.`;
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

/**
 * Why this rule keys on the convention's status emoji at all.
 *
 * The vocabulary itself is `VANTAGE_OQ_STATUS`, imported above and shared with
 * the viewer — only the measurement behind the choice is local. 💬 means "active
 * decision awaiting a ruling", and that is the only state wanting a one-click
 * answer: keying on it is the difference between a useful rule and a nag, because
 * measured over this repo's own docs the unkeyed version fired on eight
 * *settled* questions in `docs/design/review-mode.md` — each with a filled-in
 * `**Answer:**` — where a button would be an invitation to re-answer something
 * already ruled on.
 *
 * 🔒 is the one this rule must never demand a directive for: the whole point of
 * the marker is that the question cannot be answered yet, so a control offering
 * to answer it in one click would be a lie. That matters more now the rule is an
 * error, because a false positive fails a build rather than printing a line —
 * and it is why `vantageOqStatus` resolves a non-open marker ahead of 💬 rather
 * than leaving the precedence to each caller.
 */

/**
 * The convention's stable ID — `OQ-1`, `OQ-C3`, `OQ-HS5`.
 *
 * Required, and it is the tightening that makes an error severity defensible.
 * Without it the trigger was two prose signals (an emoji and the word
 * "Leaning:"), which is thin evidence on which to fail somebody's build: a
 * document *about* the convention, or one that happens to pair a 💬 with a
 * sentence starting "Leaning:", would have failed it. With the ID the rule fires
 * only on something that is unambiguously an Open Question written to the
 * convention — four independent markers of it — which is what the house rule
 * means by a question the parsed tree has settled.
 */
const OQ_ID = /\bOQ-[A-Za-z]*\d+\b/;

/** Flatten a node's text the way a reader sees it, phrasing included. */
function nodeText(node: RootContent | ListItem): string {
  let out = "";
  visit(node, (child) => {
    if (child.type === "text" || child.type === "inlineCode")
      out += child.value;
  });
  return out;
}

/**
 * An Open Question written in the convention but carrying no question
 * directive.
 *
 * The convention — a status emoji, a stable `OQ-N` id, a `_Leaning:_` line and
 * a fill-in `**Answer:**` — is *prose*. The one-click answer is a *directive*.
 * Nothing connected them, so a document could carry a dozen questions, each
 * with a stated leaning, and offer no button on any of them; and because every
 * directive failure in this family is silent by design, the author's only clue
 * was the absence of something they may never have seen present.
 *
 * That is not hypothetical — it is the report this rule was written for. A
 * design doc with two fully-formed Open Questions rendered with no affordance,
 * review mode on, and the diagnosis was that the directives had simply never
 * been written. The agent that produced the doc followed the convention in
 * `styleGuide.ts` and stopped there. This repo's own
 * `docs/design/agent-bootstrap.md` had the same gap in five places.
 *
 * Four conditions, and each one exists to keep the rule quiet:
 *
 * - **A `_Leaning:_` paragraph.** The precise marker, and the exact thing
 *   `leaning=` mirrors — not a guess from a heading or a question mark.
 * - **Inside a list item.** Where the convention puts a question and where the
 *   directive has to be indented to reach it. A leaning in running prose has no
 *   well-defined scope to search, and searching the document would call a doc
 *   with one directive and nine questions fully covered.
 * - **Carrying the convention's stable ID.** See `OQ_ID` — this is the signal
 *   that makes the finding an error rather than a guess.
 * - **Marked 💬, and not ✅ or 🔒.** See `VANTAGE_OQ_STATUS` and the note above
 *   `OQ_ID` on why the distinction is what keeps this rule honest.
 *
 * **An error**, because with all four markers present the parsed tree has
 * settled it: this is an Open Question, written to the convention, awaiting a
 * ruling, with a stated leaning and no way for the reviewer to file it. That is
 * the house rule's error criterion, not a judgment about taste. A document that
 * wants the question without the button says so with its marker — 🔒 if it is
 * blocked, ✅ once it is decided — and keeps the directive, which is the only
 * thing the planning index reads a question from
 * (`docs/reference/planning-index.md` §3.3). A list item holding either
 * question name is not this rule's. A repo that wants the whole rule advisory
 * sets `"vantage/oq-missing" = "warning"` under `[check.rules]`; the id keeps
 * the name the rule shipped with in 0.7.
 */
export function checkOpenQuestions(collector: Collector): void {
  if (!collector.enabled("vantage/oq-missing")) return;
  const root = collector.doc.mdast;

  /** Every question directive's owning scope, `oq` or `question`, once. */
  const scopesWithOq = new Set<Parents | Root>();
  visit(root, "html", (node: Html, _index, parent) => {
    // The cheap prefix test first, as the render pass does: the overwhelming
    // majority of html nodes in a document carry no directive at all.
    if (!node.value.includes(VANTAGE_SENTINEL) || !parent) return;
    for (const segment of scanComments(node.value)) {
      if (segment.kind !== "comment") continue;
      if (!hasVantageSentinel(segment.value)) continue;
      const parsed = parseVantageDirective(segment.value);
      if (parsed?.kind === "directive" && isQuestionDirective(parsed.name)) {
        scopesWithOq.add(parent);
      }
    }
  });

  visit(root, "listItem", (item: ListItem) => {
    if (scopesWithOq.has(item)) return;
    const text = nodeText(item);
    if (vantageOqStatus(text) !== "open") return;
    if (!OQ_ID.test(text)) return;

    const leaning = item.children.find(
      (child) =>
        child.type === "paragraph" && LEANING_MARKER.test(nodeText(child)),
    );
    if (leaning === undefined) return;

    collector.report(
      "vantage/oq-missing",
      {
        line: fileLine(collector.doc, leaning.position?.start.line ?? 1),
        column: leaning.position?.start.column ?? 1,
      },
      OQ_MISSING_MESSAGE,
    );
  });
}

/** `vantage/oq-missing`, for a repository whose readers are all on 0.8 or later. */
export const OQ_MISSING_MESSAGE =
  "This is an open question (\u{1F4AC}) with a stated leaning and no " +
  "`question` directive, so review mode renders no one-click answer for " +
  "it and the reviewer has no way to file the leaning. Add " +
  '`<!-- vantage: question id=\u2026 leaning="\u2026" -->` directly above ' +
  "the `_Leaning:_` paragraph, indented into the same list item, " +
  "restating the leaning as the comment the agent will receive. Keep it " +
  "when the question is marked \u{1F512} blocked or \u2705 answered, " +
  "which changes only the marker: Vantage's planning index reads a " +
  "question only from its directive, so without one nothing counts it, " +
  "badges it or lists it.";

/**
 * `vantage/oq-missing` under a target before 0.8, whose readers' viewer drops
 * `question` and offers the one-click answer only on an `oq`: the same fix,
 * with the name those readers can answer, and the rename the marker then owes.
 */
export const OQ_MISSING_FOR_OLDER_READERS_MESSAGE =
  "This is an open question (\u{1F4AC}) with a stated leaning and no " +
  "question directive, so review mode renders no one-click answer for it " +
  "and the reviewer has no way to file the leaning. This repository's " +
  "target is before Vantage 0.8, whose viewer offers that answer only on " +
  'an `oq`, so add `<!-- vantage: oq id=\u2026 leaning="\u2026" -->` directly ' +
  "above the `_Leaning:_` paragraph, indented into the same list item, " +
  "restating the leaning as the comment the agent will receive. When the " +
  "question is marked \u{1F512} blocked or \u2705 answered, rename it to " +
  "`question`, keys unchanged, since every viewer before 0.8 offers to " +
  "answer an `oq` whatever its marker says (vantage/question-name), and " +
  "keep it: Vantage's planning index reads a question only from its " +
  "directive, so without one nothing counts it, badges it or lists it.";

/**
 * The question rules' findings, held to each document's target (OQ-VS7). Under
 * a target before 0.8 the readers' viewer drops `question` and offers its
 * one-click answer only on an `oq`, so there:
 *
 * - `vantage/oq-deprecated` has nothing to say, since the `question` it asks
 *   for would take that answer away from them;
 * - `vantage/oq-missing` asks for an `oq`, for the same reason.
 *
 * `vantage/question-name` is untouched: an `oq` on a 🔒 or ✅ question is
 * wrong for every reader.
 *
 * Done once, on the run's joined report, rather than in the rules: they run
 * in the shards, which are handed the run's settings and no project's target,
 * and one pass over the joined report keeps `--jobs 1` and `--jobs 4`
 * byte-identical. A finding's `file` is its document's display path, which
 * resolves back to the path the run found it at.
 */
export function holdToOlderReaders(
  findings: readonly Finding[],
  cwd: string,
  targetFor: (root: string | null) => Target | null,
): Finding[] {
  const older = new Map<string | null, boolean>();
  const readersOnOq = (file: string) => {
    const root = repositoryRoot(dirname(resolve(cwd, file))) ?? null;
    let found = older.get(root);
    if (found === undefined) {
      found = readsOnlyOq(targetFor(root));
      older.set(root, found);
    }
    return found;
  };
  const held: Finding[] = [];
  for (const finding of findings) {
    if (finding.rule === OQ_DEPRECATED_RULE && readersOnOq(finding.file)) {
      continue;
    }
    held.push(
      finding.rule === "vantage/oq-missing" && readersOnOq(finding.file)
        ? { ...finding, message: OQ_MISSING_FOR_OLDER_READERS_MESSAGE }
        : finding,
    );
  }
  return held;
}

/* ------------------------------------------------------------------ *
 * The id an Open Question is anchored by
 * ------------------------------------------------------------------ */

/**
 * `vantage/oq-id-format` and `vantage/oq-id-duplicate` — the two ways a
 * question directive's `id` fails to become the anchor a reference needs.
 *
 * Both are errors because the parsed tree settles them, and both are silent
 * without a checker. A malformed id is stamped by the plugin and then refused
 * by the sanitizer's value allowlist, so the page renders correctly and simply
 * has no anchor. A duplicate is worse: both elements carry the id, `#OQ-4`
 * resolves to the first, and every reference to the second lands on the wrong
 * question with nothing anywhere reporting a problem. That is the one failure
 * a reader cannot detect by clicking, because the link works.
 */
export function checkOpenQuestionIds(collector: Collector): void {
  const declared = collectOqIds(collector.doc.mdast);
  if (declared.length === 0) return;

  const seen = new Map<string, DeclaredOq>();

  for (const oq of declared) {
    if (!oq.wellFormed) {
      collector.report(
        "vantage/oq-id-format",
        collector.at(oq.node),
        `\`${oq.id}\` is not a usable question id, so the block gets no ` +
          "anchor and `#" +
          oq.id +
          "` links to nothing. Write `OQ-` then an " +
          "optional short uppercase prefix then digits — `OQ-9`, `OQ-TP6`, " +
          "`OQ-A03`. The prefix is what keeps ids distinct once another " +
          "document references this one's questions.",
      );
      continue;
    }

    const first = seen.get(oq.id);
    if (first === undefined) {
      seen.set(oq.id, oq);
      continue;
    }
    // One run is one question, whichever names declare it, so an id its
    // directives repeat is still one anchor. `vantage/duplicate-key` reports
    // the repetition.
    if (first.run === oq.run) continue;

    collector.report(
      "vantage/oq-id-duplicate",
      collector.at(oq.node),
      `\`${oq.id}\` is already used by the question on line ` +
        `${fileLine(collector.doc, first.node.position?.start.line ?? 1)}. ` +
        "Both blocks carry the id, `#" +
        oq.id +
        "` resolves to the first, and every " +
        "reference to this one lands on the other question — a link that works " +
        "and goes to the wrong place. Give this question its own id.",
    );
  }
}

/* ------------------------------------------------------------------ *
 * The name a question is declared with
 * ------------------------------------------------------------------ */

/**
 * `vantage/question-name` and `vantage/oq-deprecated` — the name a question
 * directive is written with, held to what every viewer makes of it.
 *
 * `question` declares a question in any state, and the marker says which
 * (`VANTAGE_QUESTION_NAMES`). `oq` is the name it replaces, deprecated and
 * never removed: every viewer since 0.7 reads it, and every viewer before 0.8
 * offers Take this leaning on every `oq` it meets, whatever the marker says.
 * So each `oq` gets exactly one finding:
 *
 * - **On a 🔒 or ✅ question, an error** (`vantage/question-name`). A viewer
 *   from 0.8 on withholds the button by the marker, so it looks fine there,
 *   but every viewer before 0.8 offers it, and with no leaning set it files the
 *   literal "Take the stated leaning." — a control that does the wrong thing,
 *   which D4 forbids. `question` is the name those viewers drop harmlessly.
 * - **Anywhere else, a warning** (`vantage/oq-deprecated`) that quotes the
 *   `question` to write, keys unchanged. The `oq` still works in every
 *   viewer, so nothing is wrong yet; a repository whose readers are still on
 *   0.7, which drops `question`, keeps it until they upgrade, and says so with
 *   a `target` before 0.8, under which `check` drops this warning
 *   (`holdToOlderReaders`).
 *
 * The state is the planning index's own reading of the question
 * (`scanPlanningDocument`), so this rule, the index, the contents column and the
 * button can never disagree about it. Each directive comment is matched to its
 * question through the block it lands on, and judged on its own name. In a run
 * holding both names the run is one question, so the fix for the `oq` in it is
 * to delete it rather than to rename it into a second declaration.
 *
 * One layout reads a different state than its author wrote, under either name.
 * Outside a list item, the question is the block the directive lands on, so a
 * bold title *above* the directive — `✅ **OQ-3: …**`, then the directive, then
 * the answer — is not part of it, and every viewer reads the unmarked block
 * below as an open question: every Vantage offers to answer it in one click.
 * So when the block the directive lands on carries no title and the block just
 * above it carries one marked otherwise, the finding is the placement, an
 * error under `vantage/question-name`.
 */
export function checkQuestionNames(collector: Collector): void {
  const naming = collector.enabled("vantage/question-name");
  const deprecating = collector.enabled("vantage/oq-deprecated");
  if (!naming && !deprecating) return;
  const doc = collector.doc;
  if (!doc.text.includes(VANTAGE_SENTINEL)) return;

  /** Every question directive, the file line of its target, and where it is. */
  const written: {
    name: VantageQuestionName;
    directive: ParsedDirective;
    /** The file line of the block its run lands on, when the tree says. */
    targetLine: number | undefined;
    at: FilePosition;
    /** The title just above the directive, outside the block it lands on. */
    above: TitleAbove | undefined;
  }[] = [];
  visit(doc.mdast, "html", (node: Html, index, parent) => {
    if (!node.value.includes(VANTAGE_SENTINEL)) return;
    let targetLine: number | undefined;
    let above: TitleAbove | undefined;
    let placed = false;
    for (const segment of scanComments(node.value)) {
      if (segment.kind !== "comment" || segment.terminator !== "-->") continue;
      const parsed = parseVantageDirective(segment.value);
      if (parsed?.kind !== "directive" || !isQuestionDirective(parsed.name)) {
        continue;
      }
      if (!placed) {
        placed = true;
        const target =
          parent !== undefined &&
          index !== undefined &&
          BLOCK_PARENTS.has(parent.type)
            ? nextBlock(parent.children, index)
            : undefined;
        const line =
          target === undefined || target === "unknown"
            ? undefined
            : target.position?.start.line;
        if (
          target !== undefined &&
          target !== "unknown" &&
          line !== undefined
        ) {
          targetLine = fileLine(doc, line);
          const unit =
            parent?.type === "listItem" || parent?.type === "footnoteDefinition"
              ? parent
              : target;
          if (unit === target && parent !== undefined && index !== undefined) {
            above = titleAbove(collector, parent, index);
          }
        }
      }
      written.push({
        name: parsed.name,
        directive: parsed,
        targetLine,
        at: positionOf(collector, node, segment.offset),
        above,
      });
    }
  });
  if (written.length === 0) return;

  // The scan parses the file again: its reading of a question's marker walks a
  // tree it rewrites as it goes, so it cannot be handed this one. Only a file
  // whose question directives land on a block pays for it, and only for the
  // error, which is the one finding that turns on a question's state.
  const questionAt = new Map<number, PlanningQuestion>();
  if (naming && written.some((d) => d.targetLine !== undefined)) {
    const scanned = scanPlanningDocument(doc.display, doc.text, false);
    if (scanned.kind === "planning") {
      for (const question of scanned.document.questions) {
        questionAt.set(question.line, question);
      }
    }
  }
  /** The names each run holds, by the line of the block it lands on. */
  const namesAt = new Map<number, Set<VantageQuestionName>>();
  for (const { name, targetLine } of written) {
    if (targetLine === undefined) continue;
    const names = namesAt.get(targetLine) ?? new Set();
    names.add(name);
    namesAt.set(targetLine, names);
  }
  /** Runs already reported for their placement: one finding for the run. */
  const misplaced = new Set<number>();

  for (const { name, directive, targetLine, at, above } of written) {
    const question =
      targetLine === undefined ? undefined : questionAt.get(targetLine);

    if (question !== undefined && targetLine !== undefined && naming) {
      // The title is outside the question, and marks it 🔒 or ✅.
      if (
        above !== undefined &&
        above.state !== "open" &&
        question.state === "open" &&
        !OQ_TITLE_TEXT.test(question.title)
      ) {
        if (misplaced.has(targetLine)) continue;
        misplaced.add(targetLine);
        collector.report(
          "vantage/question-name",
          at,
          titleAboveMessage(above, targetLine, directive),
        );
        continue;
      }

      if (name === "oq" && question.state !== "open") {
        collector.report(
          "vantage/question-name",
          at,
          namesAt.get(targetLine)?.has("question")
            ? redundantOqMessage(question.state)
            : oqOnClosedMessage(question.state, directive),
        );
        continue;
      }
    }

    if (name !== "oq") continue;
    collector.report(
      "vantage/oq-deprecated",
      at,
      targetLine !== undefined && namesAt.get(targetLine)?.has("question")
        ? redundantOqMessage(null)
        : oqDeprecatedMessage(directive),
    );
  }
}

/** A title as the scan reads one: a `strong` whose text opens with an id. */
const OQ_TITLE_TEXT = /^OQ-[A-Za-z0-9]*\d/;

/** A question's title in the block just above its directive. */
interface TitleAbove {
  state: QuestionState;
  /** The file line of the block holding the title. */
  line: number;
}

/**
 * The title in the block just above the directive at `index`, past any other
 * comments of its run, read as the scan reads a title: the first `strong`
 * whose text opens with an `OQ-` id, its marker the text before it in its
 * paragraph or heading. A heading with no `strong` is its own title.
 */
function titleAbove(
  collector: Collector,
  parent: Parents | Root,
  index: number,
): TitleAbove | undefined {
  let i = index - 1;
  for (; i >= 0; i--) {
    const sibling = parent.children[i];
    if (sibling === undefined) return undefined;
    if (sibling.type === "definition") continue;
    if (sibling.type === "html" && isCommentOnly(sibling.value)) continue;
    break;
  }
  const block = parent.children[i];
  if (block === undefined) return undefined;
  if (block.type !== "paragraph" && block.type !== "heading") return undefined;

  let marker = "";
  let title: string | undefined;
  for (const child of block.children) {
    if (child.type === "strong" && OQ_TITLE_TEXT.test(nodeText(child))) {
      title = nodeText(child);
      break;
    }
    marker += nodeText(child as RootContent);
  }
  if (title === undefined) {
    if (block.type !== "heading") return undefined;
    const text = nodeText(block);
    const lead = /^[^\p{L}\p{N}]*/u.exec(text)?.[0] ?? "";
    if (!OQ_TITLE_TEXT.test(text.slice(lead.length))) return undefined;
    marker = lead;
    title = text.slice(lead.length);
  }
  const status = vantageOqStatus(marker) ?? vantageOqStatus(title);
  return {
    state:
      status === "settled"
        ? "answered"
        : status === "blocked"
          ? "blocked"
          : "open",
    line: fileLine(collector.doc, block.position?.start.line ?? 1),
  };
}

/**
 * The `question` directive to write in place of `directive`, keys unchanged:
 * each pair as it was written, quoted where it was quoted.
 */
export function asQuestion(directive: ParsedDirective): string {
  const pairs = directive.pairs
    .map(({ key, value, quoted }) =>
      quoted ? ` ${key}="${value}"` : ` ${key}=${value}`,
    )
    .join("");
  return `\`<!-- vantage: question${pairs} -->\``;
}

/** `oq` on a 🔒 or ✅ question. */
export function oqOnClosedMessage(
  state: QuestionState,
  directive: ParsedDirective,
): string {
  return `This question is marked ${markedWords(state)}, and every Vantage before 0.8 offers Take this leaning on every \`oq\` whatever its marker says, which with no leaning set files the literal text "Take the stated leaning." Vantage from 0.8 on withholds the button there, because of the marker. Write ${asQuestion(directive)} instead, keys unchanged: it declares the same question with the same anchor, Vantage before 0.8 drops it, and no Vantage offers to answer it while it is ${state === "blocked" ? VANTAGE_OQ_STATUS.blocked : VANTAGE_OQ_STATUS.settled}.`;
}

/** `vantage/oq-deprecated`'s id, which its own message names. */
const OQ_DEPRECATED_RULE = "vantage/oq-deprecated";

/**
 * An `oq` anywhere a question is not 🔒 or ✅: on an open question, or one
 * the tree cannot place.
 */
export function oqDeprecatedMessage(directive: ParsedDirective): string {
  return `\`oq\` is deprecated: write ${asQuestion(directive)} instead, keys unchanged, once every reader of this repository is on Vantage 0.8 or later. \`question\` declares the same question with the same keys, in every state, and Vantage 0.8 and later offer Take this leaning on it while the question is open. Vantage before 0.8 drops it, so a reader still on 0.7 gets no one-click answer and no anchor there, and misreads nothing: keep the \`oq\` while any reader is on 0.7, and unless you know they all upgraded. A repository with readers on 0.7 says so at the top of .vantage.toml with target = "0.7", a line for a human to write, and ${OQ_DEPRECATED_RULE} then stays quiet there.`;
}

/**
 * An `oq` in a run that holds a `question` too, which is one question: on a
 * 🔒 or ✅ one (`state`) or an open one (`null`).
 */
export function redundantOqMessage(state: QuestionState | null): string {
  const already =
    "Delete this `oq`: the `question` in the same run already declares the question, and while the `oq` is there only the `oq`'s keys apply, in every Vantage, so move any key you want kept onto the `question` first.";
  return state === null || state === "open"
    ? `${already} \`oq\` is deprecated, and a reader still on 0.7, which drops the \`question\`, is the one reason to keep it.`
    : `${already} Every Vantage before 0.8 reads the \`oq\` alone, and offers Take this leaning on a question its marker says ${state === "blocked" ? "cannot be answered yet" : "has been answered"}.`;
}

/**
 * A directive below the block that carries the question's title, which marks
 * it 🔒 or ✅, landing on a block that carries no marker.
 */
export function titleAboveMessage(
  above: TitleAbove,
  targetLine: number,
  directive: ParsedDirective,
): string {
  return `The title on line ${above.line} marks this question ${markedWords(above.state)}, but the directive lands on line ${targetLine}, the block after the title, and outside a list item every viewer reads a question's marker from the block its directive lands on. That block carries no marker, so every viewer reads the question as open, and every Vantage offers to answer it in one click. Put the directive above the title, so that it lands on it, or write the question as a list item with the directive indented inside it; then declare it with ${asQuestion(directive)}.`;
}

function markedWords(state: QuestionState): string {
  return state === "blocked"
    ? `${VANTAGE_OQ_STATUS.blocked} blocked`
    : `${VANTAGE_OQ_STATUS.settled} answered`;
}
