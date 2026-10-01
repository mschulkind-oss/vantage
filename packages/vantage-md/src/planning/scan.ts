/**
 * One candidate file, read into what it contributes to the planning index
 * (`docs/reference/planning-index.md` §3.1–§3.4).
 *
 * The parse is the viewer's own remark half (`buildRemarkPlugins`), so a link
 * or a directive means here what it means on the page. Where the viewer
 * decides something only after rendering — which question directive (`oq` or
 * `question`) lands on a block that could host a button, what a question's
 * status marker says — this file predicts it from mdast with the rules
 * `vantage/orphan` uses (`directiveTargets.ts`) and the contents column's own
 * reading of a question (`questionLabel` in the app's
 * `useDocumentOutline.ts`). `planningAgreement.test.tsx` holds the prediction
 * to the rendered page over every document in `docs/`.
 */

import type {
  FootnoteDefinition,
  List,
  ListItem,
  Nodes,
  Parents,
  Root,
  RootContent,
  Strong,
} from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import {
  BLOCK_PARENTS,
  isCommentOnly,
  isFallbackTarget,
  isRawFallbackTarget,
  listIsLoose,
  rawElementEnd,
  rawOpeningTag,
  targetTag,
} from "../directiveTargets.js";
import { parseFrontmatter, type ParsedFrontmatter } from "../frontmatter.js";
import { scanComments } from "../htmlComments.js";
import { buildRemarkPlugins } from "../remarkPlugins.js";
import {
  ALERT_MARKER,
  ALERT_TITLES,
  type VantageAlert,
} from "../rehypeVantageAlerts.js";
import {
  VANTAGE_OQ_HOST_TARGETS,
  VANTAGE_OQ_ID,
  VANTAGE_OQ_PREFERENCE,
  VANTAGE_SENTINEL,
  isQuestionDirective,
  mergeQuestionRun,
  normalizeLeaning,
  parseVantageDirective,
  vantageOqStatus,
  type ParsedDirective,
  type VantageQuestionName,
} from "../vantageDirectives.js";
import { isDocStatus, type DocStatus } from "../vantageFrontmatter.js";
import { cutCardBlocks, outlineOf } from "./cardSource.js";
import { resolveRepoLink } from "./links.js";

/** A question's state. `answered` is ✅: ruled, awaiting compaction. */
export type QuestionState = "open" | "blocked" | "answered";

/**
 * One question: a `question` or `oq` directive on a block that could host a
 * button (§3.3).
 */
export interface PlanningQuestion {
  path: string;
  /**
   * The name that declared it: `question`, or `oq`, the deprecated name every
   * viewer before 0.8 offers Take this leaning on whatever the question's
   * state (`VANTAGE_QUESTION_NAMES`). A run holding both is an `oq`, as it is
   * to a viewer that predates `question`. Whether review mode offers Take this
   * leaning is the state's to say (`questionOffersTake`), never the name's.
   */
  directive: VantageQuestionName;
  /**
   * The directive's `id=`, when it is well-formed and the first question in
   * this document to carry it; otherwise `null`, and no `#OQ-…` link can name
   * the question (Plan Q5).
   */
  id: string | null;
  /** The status marker's meaning; a question with no marker is open. */
  state: QuestionState;
  /** `💬 🤷`: open, and flagged as a matter of preference. */
  preference: boolean;
  /** The emoji run written before the bold title, as written; `""` when none. */
  marker: string;
  /** The bold `OQ-…` title, flattened; else the flattened text of its scope. */
  title: string;
  /**
   * `normalizeLeaning(leaning=)`, from either name; `null` when absent or
   * empty. A 🔒 or ✅ question may carry one, which nothing offers to take.
   */
  leaning: string | null;
  /** File line of the block the in-page button anchors on. */
  line: number;
  /**
   * File line of the enclosing `<li>` — a list item, or the footnote a
   * question is written in — and `line` when there is none.
   */
  unitLine: number;
  /**
   * File line of the unit's last line: where that `<li>` ends; outside one,
   * the last line of the blocks the question runs over (`unitEnd`). With
   * `unitLine` it spans the question's unit, which is how a comment is placed
   * on a question whose card has not been rendered
   * (`docs/reference/planning-index.md` §6.7).
   */
  unitEndLine: number;
  /**
   * The root-level block holding it, in file lines. A root-level directive's
   * block starts at its run's first comment, so the slice keeps the directive.
   */
  block: { startLine: number; endLine: number };
  /**
   * The length of the Markdown its card renders (`CardBlock.markdown`), as
   * JavaScript counts a string's length. The planning page pages by it before
   * any block is fetched (`docs/reference/planning-index.md` §6.4).
   */
  cardChars: number;
}

/**
 * The Markdown a question's card renders, for one distinct `block` of its
 * document: every question in that block shares it
 * (`docs/reference/planning-index.md` §10.4).
 *
 * Not a fact of the index. A scan returns a document's blocks beside its
 * document, for whoever keeps them to hand them to the planning page.
 */
export interface CardBlock {
  /** The block's first file line, `PlanningQuestion.block.startLine`. */
  startLine: number;
  /** The block's last file line, `PlanningQuestion.block.endLine`. */
  endLine: number;
  /** What the card renders: the block and the document's link definitions. */
  markdown: string;
  /**
   * The file lines before `markdown`'s first line: the viewer's source-line
   * offset, so every `data-source-line` in the card is the document's own.
   */
  lineOffset: number;
}

/** A Markdown link to a path inside the repository. */
export interface PlanningLink {
  /** Repo-relative and normalized. */
  target: string;
  /** Decoded, without the `#`. */
  fragment: string | null;
  /** The nearest heading above the link, flattened; `null` before any. */
  heading: string | null;
  /** File line. */
  line: number;
  /** Offset in the source just past the link, for `vantage-check index`. */
  endOffset: number;
}

/** One `depends-on` entry (§3.4). */
export interface DependsOn {
  /** The entry as written. */
  raw: string;
  /** Resolved like a link; `null` when it resolves outside the repository. */
  target: string | null;
  fragment: string | null;
  /** File line of the entry; 1 when it cannot be placed. */
  line: number;
}

/** A header value that is ignored, and why (§3.4, Plan Q20). */
export interface HeaderProblem {
  key: "stage" | "next" | "depends-on";
  line: number;
  message: string;
}

/** A planning document: what one file contributes to the index. */
export interface PlanningDocument {
  path: string;
  /** Only the four statuses; the key's presence still makes it planning. */
  status: DocStatus | null;
  /** A trimmed, non-empty string, as written; else `null` plus a problem. */
  stage: string | null;
  stageLine: number | null;
  /** A one-line string, trimmed; else `null` plus a problem. */
  next: string | null;
  /** A single path is a one-entry list; a non-string entry is dropped. */
  dependsOn: DependsOn[];
  headerProblems: HeaderProblem[];
  /** Document order. */
  questions: PlanningQuestion[];
  /** Document order; every repo-relative link, links to itself included. */
  links: PlanningLink[];
  /** Unique `OQ-…`-shaped tokens anywhere in the text, first-seen order. */
  ids: string[];
  /**
   * The ids a well-formed question directive (`oq` or `question`) carries,
   * unique, in document order, whether or not the directive became a
   * question: an orphan's, and one in raw HTML (Plan Q17), are here too. A
   * link to such an id is to no question and to nothing compacted either
   * (§5.2).
   */
  directiveIds: string[];
}

/**
 * What one candidate contributes. A planning document comes with `cards`: one
 * card block per distinct block its questions sit in, in file order, whatever
 * its size.
 */
export type ScanResult =
  | { kind: "planning"; document: PlanningDocument; cards: CardBlock[] }
  | { kind: "not-planning" }
  | { kind: "unreadable"; reason: string };

/**
 * The same processor the viewer and the checker parse with: the remark half of
 * `buildPipeline`, so GFM and `$$` math are on exactly as they are there.
 */
const parser = unified().use(remarkParse).use(buildRemarkPlugins());

/** A document body as the viewer parses it. */
export function parseBody(body: string): Root {
  return parser.parse(body) as Root;
}

/** The contents column's title test: a bold run opening with the stable id. */
const OQ_TITLE = /^OQ-[A-Za-z0-9]*\d/;

/**
 * An `OQ-…` token in prose, shaped as `VANTAGE_OQ_ID` shapes an id. Bounded by
 * what may not touch it rather than by `\b`, so `_OQ-4_` (an id in italics)
 * still counts. The leading bound is a group rather than a lookbehind, which
 * Safari parses only since 16.4 and which nothing else in the viewer needs.
 */
const OQ_TOKEN =
  /(?:^|[^A-Za-z0-9])(OQ-(?:[A-Z][A-Z0-9]{0,5})?[0-9]+)(?![A-Za-z0-9])/g;

const OQ_HOST_TAGS = new Set<string>(VANTAGE_OQ_HOST_TARGETS);

/**
 * The title `rehypeVantageAlerts` puts at the top of each GFM alert, by
 * blockquote. Read by `textOf`, which is how an alert's text starts with
 * "Warning" here as it does on the page.
 */
const alertTitles = new WeakMap<Nodes, string>();

/**
 * `rehypeVantageAlerts`, done to the mdast the scan reads: a blockquote whose
 * first paragraph opens with `[!WARNING]` loses the marker, loses that
 * paragraph if nothing else was in it, and gains the alert's title. The
 * contents column reads the rendered alert, so a question in one is read here
 * from the same text.
 */
function readAlerts(node: Nodes): void {
  if (node.type === "blockquote") {
    // The plugin reads the first element, past comments and whitespace.
    const first = node.children.find(
      (child) =>
        child.type !== "definition" &&
        !(child.type === "html" && isCommentOnly(child.value)),
    );
    const lead = first?.type === "paragraph" ? first.children[0] : undefined;
    const match = lead?.type === "text" ? ALERT_MARKER.exec(lead.value) : null;
    if (
      first?.type === "paragraph" &&
      lead?.type === "text" &&
      match !== null
    ) {
      lead.value = lead.value.slice(match[0].length);
      if (lead.value === "" && first.children.length === 1) {
        node.children = node.children.filter((child) => child !== first);
      }
      const kind = (match[1] ?? "").toLowerCase() as VantageAlert;
      alertTitles.set(node, ALERT_TITLES[kind]);
    }
  }
  if ("children" in node) (node.children as Nodes[]).forEach(readAlerts);
}

/** One line of text from something written across several. */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A node's text as the DOM's `textContent` would read it once rendered: inline
 * text and code verbatim, a hard break as a newline, and blocks joined by the
 * newline text node the renderer puts between them. Raw HTML tags and image
 * alt text contribute nothing, as they contribute nothing to `textContent`.
 */
function textOf(node: Nodes): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
      return node.value;
    case "break":
      return "\n";
    case "html":
    case "image":
    case "imageReference":
    case "definition":
    case "footnoteReference":
      return "";
    case "code":
    case "math":
    case "inlineMath":
      return node.value;
  }
  if (!("children" in node)) return "";
  const phrasing =
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "tableCell" ||
    node.type === "emphasis" ||
    node.type === "strong" ||
    node.type === "delete" ||
    node.type === "link" ||
    node.type === "linkReference";
  const parts = (node.children as Nodes[]).map(textOf);
  const title = alertTitles.get(node);
  if (title !== undefined) parts.unshift(title);
  return parts.join(phrasing ? "" : "\n");
}

/** The first `strong` in `node`, pre-order, whose text opens with an id. */
function titleStrong(
  node: Nodes,
  parent: Parents | undefined,
): { strong: Strong; parent: Parents } | undefined {
  if (node.type === "strong" && parent !== undefined) {
    if (OQ_TITLE.test(flatten(textOf(node)))) return { strong: node, parent };
  }
  if (!("children" in node)) return undefined;
  for (const child of node.children as Nodes[]) {
    const found = titleStrong(child, node as Parents);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** `leadingMarker`: whatever the text opens with, up to a letter or digit. */
function leadingMarker(text: string): string {
  return /^[^\p{L}\p{N}]*/u.exec(text)?.[0].trim() ?? "";
}

function stateOf(marker: string, title: string): QuestionState {
  switch (vantageOqStatus(marker) ?? vantageOqStatus(title)) {
    case "settled":
      return "answered";
    case "blocked":
      return "blocked";
    default:
      return "open";
  }
}

/** Where a block sits: the parent it is a child of, and what encloses that. */
interface Context {
  parent: Parents;
  /** The list holding `parent`, when `parent` is a list item. */
  list: List | undefined;
  /** The nearest list item at or above `parent`. */
  listItem: ListItem | undefined;
  /** The list holding `listItem`. */
  itemList: List | undefined;
  /**
   * The nearest block that renders as an `<li>`: a list item, or a footnote
   * definition, which the footnotes section renders as one. A question's unit.
   */
  unit: ListItem | FootnoteDefinition | undefined;
  /** The root-level block this all sits in; `undefined` at the root itself. */
  rootChild: RootContent | undefined;
}

/**
 * One child of a block parent as the plugin will meet it in hast: an element,
 * a comment, blocking text, or whitespace it skips. Raw HTML is split into its
 * comments and the text between them, as `rehype-raw` splits it.
 */
type Token = { child: number } & (
  | { kind: "element"; node: RootContent }
  | {
      kind: "raw";
      /** The element it opens (`rawOpeningTag`), and where in its node. */
      tag: string | undefined;
      offset: number;
    }
  | { kind: "text" }
  | {
      kind: "comment";
      directive: ParsedDirective | undefined;
      line: number;
      key: string;
    }
);

/** One comment's identity in the tree: its node's offset, then its own. */
const commentKey = (node: RootContent, offset: number): string =>
  `${node.position?.start.offset ?? 0}:${offset}`;

function tokensOf(children: RootContent[]): Token[] {
  const tokens: Token[] = [];
  for (const [index, child] of children.entries()) {
    // Neither renders where it is written: a definition renders nothing, and a
    // footnote definition is hoisted to the end of the document.
    if (child.type === "definition" || child.type === "footnoteDefinition") {
      continue;
    }
    if (child.type !== "html") {
      tokens.push({ kind: "element", node: child, child: index });
      continue;
    }
    const start = child.position?.start.line ?? 1;
    // Newlines are counted from the previous comment on, not from the node's
    // start, so a node of many comments costs its length and not its square.
    let counted = 0;
    let newlines = 0;
    for (const segment of scanComments(child.value)) {
      if (segment.kind === "text") {
        const rest = segment.value.trim();
        if (rest === "") continue;
        // A tag is an element `rehype-raw` will build, which mdast cannot
        // see into (Plan Q17); anything else is text that ends a run.
        tokens.push(
          rest.startsWith("<")
            ? {
                kind: "raw",
                tag: rawOpeningTag(rest),
                offset: segment.offset,
                child: index,
              }
            : { kind: "text", child: index },
        );
        continue;
      }
      for (let k = counted; k < segment.offset; k++) {
        if (child.value.charCodeAt(k) === 10) newlines++;
      }
      counted = segment.offset;
      const line = start + newlines;
      const parsed =
        segment.terminator === null
          ? undefined
          : parseVantageDirective(segment.value);
      tokens.push({
        kind: "comment",
        directive: parsed?.kind === "directive" ? parsed : undefined,
        line,
        key: commentKey(child, segment.offset),
        child: index,
      });
    }
  }
  return tokens;
}

/** Tags `ANCHORABLE_BLOCK_SELECTOR` names, from the mdast that will become them. */
function anchorableTag(
  node: Nodes,
  inTightItem: boolean,
): string | "unknown" | undefined {
  switch (node.type) {
    case "paragraph":
      return inTightItem ? undefined : "p";
    case "heading":
    case "blockquote":
    case "code":
    case "table":
      return targetTag(node);
    case "listItem":
      return "li";
    case "tableCell":
      return "td";
    case "html":
      return "unknown";
    default:
      return undefined;
  }
}

/**
 * `anchorBlockWithin`, predicted: of the anchorable blocks inside `target` that
 * start on its first line, the last in document order — the one the review
 * highlighter indexes that line to. `"unknown"` when raw HTML starts there.
 *
 * `where` says what holds a node: an item of a tight list, a block directly in
 * such an item (a paragraph there is unwrapped and is no `<p>`), or neither.
 */
function anchorTagWithin(target: RootContent): string | "unknown" | undefined {
  const line = target.position?.start.line;
  let last: string | "unknown" | undefined;
  type Where = "tight-item" | "in-tight-item" | "other";
  const walk = (node: Nodes, where: Where): void => {
    if (node.position?.start.line !== line) return;
    const tag = anchorableTag(node, where === "in-tight-item");
    if (tag !== undefined) last = tag;
    if (!("children" in node)) return;
    let inner: Where = "other";
    if (node.type === "list")
      inner = listIsLoose(node) ? "other" : "tight-item";
    if (node.type === "listItem" && where === "tight-item") {
      inner = "in-tight-item";
    }
    for (const child of node.children as Nodes[]) walk(child, inner);
  };
  walk(target, "other");
  return last;
}

interface ScanState {
  bodyLineOffset: number;
  questions: Omit<PlanningQuestion, "path" | "id" | "cardChars">[];
  /** The merged `id=` of each question, before duplicates are resolved. */
  rawIds: (string | undefined)[];
  /** The comment whose `id=` that merged id is, by `commentKey`. */
  idKeys: (string | undefined)[];
  /** Every comment of each question's run, by `commentKey`. */
  runKeys: string[][];
  /** Each question's host block, and where it sits. */
  hosts: { target: RootContent; context: Context }[];
  /** Footnote definitions, walked last because they render last. */
  footnotes: Context[];
  /**
   * The blocks a `fallback` run withholds, which the page never shows: no
   * question and no link is read from one (`withholds`).
   */
  withheld: Set<Nodes>;
}

/**
 * The plugin's `processChildren`, over one block parent's children: find each
 * run of directives, the element it lands on, and — for a run holding a
 * question directive — whether that element could host a button.
 */
function walkBlocks(context: Context, state: ScanState): void {
  const tokens = tokensOf(context.parent.children as RootContent[]);
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === undefined) break;
    if (token.kind === "element") {
      if (!state.withheld.has(token.node)) descend(token.node, context, state);
      i++;
      continue;
    }
    if (token.kind !== "comment" || token.directive === undefined) {
      i++;
      continue;
    }

    const run: KeyedDirective[] = [
      { directive: token.directive, key: token.key },
    ];
    const firstLine = token.line;
    let j = i + 1;
    let target: RootContent | undefined;
    for (; j < tokens.length; j++) {
      const next = tokens[j];
      if (next === undefined || next.kind === "text") break;
      if (next.kind === "raw") {
        // A run that lands on raw HTML withholds the element it opens, and
        // with blank lines inside it that element spans siblings.
        const end = withheldRaw(next, run, context, state);
        if (end === next.child) {
          // Closed in its own node, which may go on past it.
          j++;
        } else if (end !== undefined) {
          while (j < tokens.length && (tokens[j]?.child ?? 0) <= end) j++;
        }
        break;
      }
      if (next.kind === "element") {
        target = next.node;
        break;
      }
      if (next.directive !== undefined) {
        run.push({ directive: next.directive, key: next.key });
      }
    }
    if (target !== undefined) {
      if (withholds(target, run, context)) state.withheld.add(target);
      else question(target, run, firstLine, context, state);
    }
    i = j;
  }
  // A footnote definition is skipped above, for it is not where it is written.
  for (const child of context.parent.children as RootContent[]) {
    if (child.type === "footnoteDefinition") {
      // Hoisted into the footnotes section, so no list item encloses it; the
      // section renders the definition itself as an `<li>`.
      state.footnotes.push({
        parent: child,
        list: undefined,
        listItem: undefined,
        itemList: undefined,
        unit: child,
        rootChild: context.rootChild ?? child,
      });
    }
  }
}

/** Into the block parents an element holds, the way the plugin recurses. */
function descend(node: RootContent, context: Context, state: ScanState): void {
  const rootChild = context.rootChild ?? node;
  if (node.type === "blockquote") {
    walkBlocks({ ...context, parent: node, list: undefined, rootChild }, state);
  } else if (node.type === "list") {
    for (const item of node.children) {
      walkBlocks(
        {
          parent: item,
          list: node,
          listItem: item,
          itemList: node,
          unit: item,
          rootChild,
        },
        state,
      );
    }
  }
}

/** A directive of a run, with the comment it was read from. */
interface KeyedDirective {
  directive: ParsedDirective;
  key: string;
}

/**
 * Does this run withhold `target`? The plugin's `withholdFallbacks`, predicted:
 * any `fallback` in the run, a target on its list, and not a paragraph that a
 * tight list item unwraps into bare text. A withheld block takes the rest of
 * its run with it, so a question directive merged onto it declares nothing.
 */
function withholds(
  target: RootContent,
  run: KeyedDirective[],
  context: Context,
): boolean {
  if (!run.some(({ directive }) => directive.name === "fallback")) return false;
  if (!BLOCK_PARENTS.has(context.parent.type)) return false;
  if (!isFallbackTarget(targetTag(target))) return false;
  return !(
    target.type === "paragraph" &&
    context.parent.type === "listItem" &&
    context.list !== undefined &&
    !listIsLoose(context.list)
  );
}

/**
 * Does this run withhold the raw-HTML element `raw` opens? The plugin's
 * `withholdFallbacks` again, for the element `rehype-raw` builds there: when
 * it does, every sibling from the opening node to the one that closes the
 * element is withheld, and the index of the last is returned, so that nothing
 * inside it — a link, or a question — is read.
 */
function withheldRaw(
  raw: Extract<Token, { kind: "raw" }>,
  run: KeyedDirective[],
  context: Context,
  state: ScanState,
): number | undefined {
  if (!run.some(({ directive }) => directive.name === "fallback")) return;
  if (!BLOCK_PARENTS.has(context.parent.type)) return;
  if (!isRawFallbackTarget(raw.tag) || raw.tag === undefined) return;
  const children = context.parent.children as RootContent[];
  const end = rawElementEnd(children, raw.child, raw.tag, raw.offset);
  for (let k = raw.child; k <= end; k++) {
    const child = children[k];
    if (child !== undefined) state.withheld.add(child);
  }
  return end;
}

/**
 * Record `target` as a question when the run holds a question directive and
 * the target could host a button. Both names declare a question in exactly the
 * same places, in every state, so a question that changes state is found where
 * it was.
 */
function question(
  target: RootContent,
  run: KeyedDirective[],
  firstLine: number,
  context: Context,
  state: ScanState,
): void {
  // Merged per run as `stampRun` merges it, by the one function both call.
  const merged = mergeQuestionRun(run.map(({ directive }) => directive));
  if (merged === undefined) return;
  const { name, keys } = merged;
  const idSource = merged.sources.get("id");
  const idKey = idSource === undefined ? undefined : run[idSource]?.key;
  if (!BLOCK_PARENTS.has(context.parent.type)) return;

  const tag = targetTag(target);
  if (tag === undefined || !OQ_HOST_TAGS.has(tag)) return;
  // A paragraph in a tight list item is never a `<p>`; the run meets bare
  // text and stamps nothing.
  if (
    target.type === "paragraph" &&
    context.parent.type === "listItem" &&
    context.list !== undefined &&
    !listIsLoose(context.list)
  ) {
    return;
  }
  const anchor = anchorTagWithin(target);
  if (
    anchor === undefined ||
    anchor === "unknown" ||
    !OQ_HOST_TAGS.has(anchor)
  ) {
    return;
  }

  const offset = state.bodyLineOffset;
  const line = (target.position?.start.line ?? 1) + offset;
  const unitLine =
    context.unit === undefined
      ? line
      : (context.unit.position?.start.line ?? 1) + offset;
  const unitEndLine =
    (context.unit === undefined
      ? (target.position?.end.line ?? 1)
      : (context.unit.position?.end.line ?? 1)) + offset;
  const root = context.rootChild;
  const block =
    root === undefined
      ? {
          startLine: firstLine + offset,
          endLine: (target.position?.end.line ?? 1) + offset,
        }
      : {
          startLine: (root.position?.start.line ?? 1) + offset,
          endLine: (root.position?.end.line ?? 1) + offset,
        };

  // The contents column's reading: the nearest `<li>`, else the target.
  const scope: Nodes = context.unit ?? target;
  const found = titleStrong(scope, undefined);
  let marker: string;
  let title: string;
  if (found !== undefined) {
    title = flatten(textOf(found.strong));
    marker = markerBefore(found, context).trim();
  } else {
    title = flatten(textOf(scope));
    marker = leadingMarker(title);
  }

  const leaning = normalizeLeaning(keys.get("leaning") ?? "");
  state.questions.push({
    directive: name,
    state: stateOf(marker, title),
    preference: marker.includes(VANTAGE_OQ_PREFERENCE),
    marker,
    title,
    leaning: leaning === "" ? null : leaning,
    line,
    unitLine,
    unitEndLine,
    block,
  });
  state.rawIds.push(keys.get("id"));
  state.idKeys.push(idKey);
  state.runKeys.push(run.map(({ key }) => key));
  state.hosts.push({ target, context });
}

/**
 * Where a question that is not in a list item ends: the last line of the
 * blocks it runs over. Such a question is its host block and the blocks after
 * it in the same parent — its context, its options, its leaning, its Answer —
 * up to the first of these, which it does not include:
 *
 * - a heading: any heading, or, when the host is a heading itself, one of the
 *   same or a higher level, so a question written as a heading runs to the
 *   end of its section;
 * - a thematic break;
 * - a block that is, or holds, another question's host.
 *
 * The app's `questionUnitBlocks` finds the same blocks in the rendered page
 * (`planningAgreement.test.tsx` holds the two equal). Comments, link
 * definitions, footnote definitions and what a `fallback` withholds render
 * nowhere here, so they neither end a question nor belong to one.
 */
function unitEnd(
  target: RootContent,
  parent: Parents,
  hosts: ReadonlySet<Nodes>,
  withheld: ReadonlySet<Nodes>,
): number {
  const holdsHost = (node: Nodes): boolean =>
    hosts.has(node) ||
    ("children" in node && (node.children as Nodes[]).some(holdsHost));
  const children = parent.children as RootContent[];
  const depth = target.type === "heading" ? target.depth : undefined;
  let end = target.position?.end.line ?? 1;
  for (let k = children.indexOf(target) + 1; k < children.length; k++) {
    const node = children[k];
    if (node === undefined) break;
    if (node.type === "definition" || node.type === "footnoteDefinition") {
      continue;
    }
    if (withheld.has(node)) continue;
    if (node.type === "html" && isCommentOnly(node.value)) continue;
    if (
      node.type === "heading" &&
      (depth === undefined || node.depth <= depth)
    ) {
      break;
    }
    if (node.type === "thematicBreak" || holdsHost(node)) break;
    end = node.position?.end.line ?? end;
  }
  return end;
}

/**
 * `markerBefore`: the text of the title's earlier siblings in its element. In a
 * tight list item the paragraph is unwrapped, so the element is the `<li>` and
 * the siblings include the item's earlier blocks.
 */
function markerBefore(
  found: { strong: Strong; parent: Parents },
  context: Context,
): string {
  const { strong, parent } = found;
  let out = "";
  const item = context.listItem;
  if (
    parent.type === "paragraph" &&
    item !== undefined &&
    context.itemList !== undefined &&
    item.children.includes(parent) &&
    !listIsLoose(context.itemList)
  ) {
    for (const child of item.children) {
      if (child === parent) break;
      out += `${textOf(child)}\n`;
    }
  }
  for (const child of parent.children as Nodes[]) {
    if (child === strong) break;
    out += textOf(child);
  }
  return out;
}

/**
 * Each well-formed id's first question directive, `oq` or `question`, by
 * `commentKey`, in document order and counting every directive in raw HTML —
 * orphans, inline ones and those inside a raw block too — as
 * `vantage/oq-id-duplicate` counts them. Only the question read from that
 * directive keeps the id (§3.3).
 */
function firstOqIds(root: Root): Map<string, string> {
  const first = new Map<string, string>();
  const walk = (node: Nodes): void => {
    if (node.type === "html") {
      if (!node.value.includes(VANTAGE_SENTINEL)) return;
      for (const segment of scanComments(node.value)) {
        if (segment.kind !== "comment" || segment.terminator === null) continue;
        const parsed = parseVantageDirective(segment.value);
        if (parsed?.kind !== "directive" || !isQuestionDirective(parsed.name)) {
          continue;
        }
        let id: string | undefined;
        for (const pair of parsed.pairs) if (pair.key === "id") id = pair.value;
        if (id === undefined || !VANTAGE_OQ_ID.test(id) || first.has(id)) {
          continue;
        }
        first.set(id, commentKey(node, segment.offset));
      }
      return;
    }
    if ("children" in node) {
      for (const child of node.children as Nodes[]) walk(child);
    }
  };
  walk(root);
  return first;
}

/**
 * Whether any question directive, `oq` or `question`, is anywhere in raw HTML,
 * inline or not — orphans too.
 */
function hasQuestionDirective(root: Root): boolean {
  let found = false;
  const walk = (node: Nodes): void => {
    if (found) return;
    if (node.type === "html") {
      if (!node.value.includes(VANTAGE_SENTINEL)) return;
      for (const segment of scanComments(node.value)) {
        if (segment.kind !== "comment" || segment.terminator === null) continue;
        const parsed = parseVantageDirective(segment.value);
        if (parsed?.kind === "directive" && isQuestionDirective(parsed.name)) {
          found = true;
          return;
        }
      }
      return;
    }
    if ("children" in node) {
      for (const child of node.children as Nodes[]) walk(child);
    }
  };
  walk(root);
  return found;
}

/**
 * Every rendered Markdown link that names a path in the repository. A link in
 * a block a `fallback` withholds is not rendered, so it routes nothing and
 * badges nothing.
 */
function linksOf(
  root: Root,
  path: string,
  bodyLineOffset: number,
  bodyOffset: number,
  withheld: ReadonlySet<Nodes>,
): PlanningLink[] {
  const definitions = new Map<string, string>();
  const collect = (node: Nodes): void => {
    if (node.type === "definition") {
      // The first definition of a label wins, as CommonMark resolves it.
      if (!definitions.has(node.identifier)) {
        definitions.set(node.identifier, node.url);
      }
      return;
    }
    if ("children" in node) {
      for (const child of node.children as Nodes[]) collect(child);
    }
  };
  collect(root);

  const links: PlanningLink[] = [];
  let heading: string | null = null;
  const walk = (node: Nodes): void => {
    if (withheld.has(node)) return;
    if (node.type === "heading") heading = flatten(textOf(node));
    let url: string | undefined;
    if (node.type === "link") url = node.url;
    if (node.type === "linkReference") url = definitions.get(node.identifier);
    if (url !== undefined && node.position !== undefined) {
      const resolved = resolveRepoLink(path, url);
      if (resolved !== null) {
        links.push({
          target: resolved.path,
          fragment: resolved.fragment,
          heading,
          line: node.position.start.line + bodyLineOffset,
          endOffset: (node.position.end.offset ?? 0) + bodyOffset,
        });
      }
    }
    if ("children" in node) {
      for (const child of node.children as Nodes[]) walk(child);
    }
  };
  walk(root);
  return links;
}

/**
 * Every `OQ-…`-shaped token in `source`, unique, in first-seen order: what a
 * planning document's `ids` holds. Exported for the checker's
 * `planning/depends-on-missing`, which asks whether an id appears anywhere in
 * a target that need not be a planning document at all.
 */
export function idsOf(source: string): string[] {
  const seen = new Set<string>();
  for (const match of source.matchAll(OQ_TOKEN)) {
    if (match[1] !== undefined) seen.add(match[1]);
  }
  return [...seen];
}

/* ------------------------------------------------------------------ *
 * The header of record: `stage`, `next`, `depends-on`
 * ------------------------------------------------------------------ */

type HeaderKey = HeaderProblem["key"];
const HEADER_KEYS: readonly HeaderKey[] = ["stage", "next", "depends-on"];

/** Where each header key, and each of a list's entries, sits in the file. */
interface HeaderLines {
  key: Partial<Record<HeaderKey, number>>;
  items: Partial<Record<HeaderKey, number[]>>;
}

/** Line of `offset` in `source`, 1-based. */
function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/**
 * The file lines of the header keys. YAML is re-read as a document for its
 * node ranges; TOML is placed by its `key =` lines, entries and all, since the
 * TOML parser gives no positions.
 */
function headerLines(
  source: string,
  frontmatter: ParsedFrontmatter,
): HeaderLines {
  const lines: HeaderLines = { key: {}, items: {} };
  if (frontmatter.format === "toml") {
    source.split("\n").forEach((text, index) => {
      for (const key of HEADER_KEYS) {
        const pattern = new RegExp(`^\\s*["']?${key}["']?\\s*=`);
        if (lines.key[key] === undefined && pattern.test(text)) {
          lines.key[key] = index + 1;
        }
      }
    });
    return lines;
  }
  // `parseFrontmatter` parses the block between the delimiters, trimmed.
  const end = source.indexOf("\n---", 3);
  if (end === -1) return lines;
  const inner = source.slice(4, end);
  const start = 4 + (inner.length - inner.trimStart().length);
  const doc = parseDocument(inner.trim());
  if (!isMap(doc.contents)) return lines;
  for (const pair of doc.contents.items) {
    if (!isScalar(pair.key)) continue;
    const key = String(pair.key.value) as HeaderKey;
    if (!HEADER_KEYS.includes(key) || lines.key[key] !== undefined) continue;
    const at = pair.key.range?.[0];
    if (at !== undefined) lines.key[key] = lineAt(source, start + at);
    if (isSeq(pair.value)) {
      lines.items[key] = pair.value.items.map((item) => {
        const range = (item as { range?: [number, number, number] }).range;
        return range === undefined
          ? (lines.key[key] ?? 1)
          : lineAt(source, start + range[0]);
      });
    }
  }
  return lines;
}

/** What a value that is not a string is, for a message. */
function describe(value: unknown): string {
  if (value === null || value === undefined) return "empty";
  if (value instanceof Date) return "a date";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "number") return `the number ${value}`;
  if (typeof value === "boolean") return `\`${String(value)}\``;
  if (typeof value === "object") return "a table";
  return "not text";
}

interface Header {
  stage: string | null;
  stageLine: number | null;
  next: string | null;
  dependsOn: DependsOn[];
  headerProblems: HeaderProblem[];
}

function readHeader(
  path: string,
  source: string,
  parsed: ParsedFrontmatter,
): Header {
  const fm = parsed.frontmatter;
  const has = (key: HeaderKey) => Object.hasOwn(fm, key);
  const header: Header = {
    stage: null,
    stageLine: null,
    next: null,
    dependsOn: [],
    headerProblems: [],
  };
  if (!HEADER_KEYS.some(has)) return header;

  const lines = headerLines(source, parsed);
  const keyLine = (key: HeaderKey) => lines.key[key] ?? 1;
  const problem = (key: HeaderKey, message: string, line = keyLine(key)) =>
    header.headerProblems.push({ key, line, message });

  if (has("stage")) {
    const value = fm["stage"];
    if (typeof value === "string" && value.trim() !== "") {
      header.stage = value.trim();
      header.stageLine = keyLine("stage");
    } else if (typeof value === "string") {
      problem("stage", "`stage` is empty, so this document has no stage.");
    } else {
      problem(
        "stage",
        `\`stage\` must be one word written as text, and this one is ${describe(value)}, so this document has no stage.`,
      );
    }
  }

  if (has("next")) {
    const value = fm["next"];
    const text = typeof value === "string" ? value.trim() : undefined;
    if (text === undefined) {
      problem(
        "next",
        `\`next\` must be one line of text, and this one is ${describe(value)}, so it is not shown.`,
      );
    } else if (text === "") {
      problem("next", "`next` is empty, so it is not shown.");
    } else if (/[\r\n]/.test(text)) {
      problem(
        "next",
        "`next` must fit on one line, and this one runs over several, so it is not shown.",
      );
    } else {
      header.next = text;
    }
  }

  if (has("depends-on")) {
    const value = fm["depends-on"];
    const entries: unknown[] | undefined =
      typeof value === "string"
        ? [value]
        : Array.isArray(value)
          ? value
          : undefined;
    if (entries === undefined) {
      problem(
        "depends-on",
        `\`depends-on\` must be a list of relative paths, and this one is ${describe(value)}, so it names nothing.`,
      );
    }
    const itemLines = lines.items["depends-on"];
    (entries ?? []).forEach((entry, index) => {
      const line = itemLines?.[index] ?? keyLine("depends-on");
      const ordinal = `Entry ${index + 1} of \`depends-on\``;
      if (typeof entry !== "string") {
        problem(
          "depends-on",
          `${ordinal} is ${describe(entry)}, not a relative path, so it is dropped.`,
          line,
        );
        return;
      }
      if (entry.trim() === "") {
        problem("depends-on", `${ordinal} is empty, so it is dropped.`, line);
        return;
      }
      const written = entry.trim();
      const resolved = resolveRepoLink(path, written);
      // Out of the repository there is no target, but the fragment is still
      // what the author wrote, for the checker to quote.
      const hash = written.indexOf("#");
      const fragment =
        resolved !== null
          ? resolved.fragment
          : hash === -1 || hash === written.length - 1
            ? null
            : written.slice(hash + 1);
      header.dependsOn.push({
        raw: entry,
        target: resolved?.path ?? null,
        fragment,
        line,
      });
    });
  }
  return header;
}

/** Why a frontmatter block made its file unreadable, in words. */
function problemReason(parsed: ParsedFrontmatter): string | undefined {
  const problem = parsed.problem;
  if (problem === undefined) return undefined;
  switch (problem.kind) {
    case "unterminated":
      return `the frontmatter opened with ${problem.delimiter} is never closed`;
    case "not-a-mapping":
      return "the frontmatter is not a table of fields";
    case "invalid":
      return `the frontmatter does not parse${problem.message ? `: ${problem.message.split("\n")[0]}` : ""}`;
  }
}

/**
 * Read one candidate. `isRoadmap` is decided from the config by
 * `scanCandidate`, which is how the index scans a file and how anything
 * scanning for it should; no other caller passes it.
 *
 * Only a planning document contributes: one whose frontmatter has `status` or
 * `stage`, or that holds a question directive (`oq` or `question`), or a
 * roadmap (§3.1). A file whose frontmatter does not parse is unreadable, since
 * what it would have said is unknown (§15). Anything else is dropped before
 * its body is parsed, which is what keeps a full scan cheap (§3.1).
 *
 * A planning document comes with its questions' card blocks, cut from the same
 * parse, so nothing has to parse a document a second time for its cards.
 */
export function scanPlanningDocument(
  path: string,
  source: string,
  isRoadmap: boolean,
): ScanResult {
  const parsed = parseFrontmatter(source);
  const reason = problemReason(parsed);
  if (reason !== undefined) return { kind: "unreadable", reason };

  const fm = parsed.frontmatter;
  const keyed = Object.hasOwn(fm, "status") || Object.hasOwn(fm, "stage");
  if (!isRoadmap && !keyed && !parsed.body.includes(VANTAGE_SENTINEL)) {
    return { kind: "not-planning" };
  }

  const root = parseBody(parsed.body);
  if (!isRoadmap && !keyed && !hasQuestionDirective(root)) {
    return { kind: "not-planning" };
  }
  // Before `readAlerts`, which rewrites blockquotes in place: the cards are
  // cut from the tree as it was parsed.
  const outline = outlineOf(root, parsed.bodyLineOffset);
  readAlerts(root);

  const state: ScanState = {
    bodyLineOffset: parsed.bodyLineOffset,
    questions: [],
    rawIds: [],
    idKeys: [],
    runKeys: [],
    hosts: [],
    footnotes: [],
    withheld: new Set(),
  };
  walkBlocks(
    {
      parent: root,
      list: undefined,
      listItem: undefined,
      itemList: undefined,
      unit: undefined,
      rootChild: undefined,
    },
    state,
  );
  // Walking a footnote can find another inside it, so the list may grow.
  for (let i = 0; i < state.footnotes.length; i++) {
    const footnote = state.footnotes[i];
    if (footnote !== undefined) walkBlocks(footnote, state);
  }
  // Once every host is known, a question outside a list item runs over the
  // blocks after its host, up to the next question among them (`unitEnd`).
  // Its card block, at the root, runs as far, so the card holds the whole of
  // it.
  const hostBlocks = new Set<Nodes>(state.hosts.map(({ target }) => target));
  state.questions.forEach((question, index) => {
    const host = state.hosts[index];
    if (host === undefined || host.context.unit !== undefined) return;
    const end =
      unitEnd(host.target, host.context.parent, hostBlocks, state.withheld) +
      state.bodyLineOffset;
    question.unitEndLine = end;
    if (host.context.rootChild === undefined) {
      question.block = {
        startLine: question.block.startLine,
        endLine: Math.max(question.block.endLine, end),
      };
    }
  });

  const cards = cutCardBlocks(
    source,
    outline,
    state.questions.map((q) => q.block),
  );
  const chars = new Map(
    cards.map((card) => [
      `${card.startLine}:${card.endLine}`,
      card.markdown.length,
    ]),
  );

  const first = firstOqIds(root);
  const questions: PlanningQuestion[] = state.questions.map((q, index) => {
    const raw = state.rawIds[index];
    const key = state.idKeys[index];
    // A run is one declaration: its id stands when the first comment in the
    // document to declare it is one of the run's own, whichever of the run's
    // comments that is (a `question` and the `oq` beside it may both carry it).
    const declaredBy = raw === undefined ? undefined : first.get(raw);
    const id =
      raw !== undefined &&
      key !== undefined &&
      declaredBy !== undefined &&
      (state.runKeys[index] ?? []).includes(declaredBy)
        ? raw
        : null;
    const cardChars = chars.get(`${q.block.startLine}:${q.block.endLine}`) ?? 0;
    return { path, id, ...q, cardChars };
  });

  const status = fm["status"];
  const bodyOffset = source.length - parsed.body.length;
  return {
    kind: "planning",
    document: {
      path,
      status: isDocStatus(status) ? status : null,
      ...readHeader(path, source, parsed),
      questions,
      links: linksOf(
        root,
        path,
        parsed.bodyLineOffset,
        bodyOffset,
        state.withheld,
      ),
      ids: idsOf(source),
      directiveIds: [...first.keys()],
    },
    cards,
  };
}
