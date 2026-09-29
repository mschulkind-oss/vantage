/**
 * One candidate file, read into what it contributes to the planning index
 * (design §3.1–§3.3, §4).
 *
 * The parse is the viewer's own remark half (`buildRemarkPlugins`), so a link
 * or a directive means here what it means on the page. Where the viewer
 * decides something only after rendering — which `oq` directive yields a
 * button, what a question's status marker says — this file predicts it from
 * mdast with the rules `vantage/orphan` uses (`directiveTargets.ts`) and the
 * contents column's own reading of a question (`questionLabel` in the app's
 * `useDocumentOutline.ts`). `planningAgreement.test.tsx` holds the prediction
 * to the rendered page over every document in `docs/`.
 */

import type {
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
import { BLOCK_PARENTS, listIsLoose, targetTag } from "../directiveTargets.js";
import { parseFrontmatter, type ParsedFrontmatter } from "../frontmatter.js";
import { scanComments } from "../htmlComments.js";
import { buildRemarkPlugins } from "../pipeline.js";
import {
  VANTAGE_OQ_HOST_TARGETS,
  VANTAGE_OQ_ID,
  VANTAGE_OQ_PREFERENCE,
  VANTAGE_SENTINEL,
  normalizeLeaning,
  parseVantageDirective,
  vantageOqStatus,
  type ParsedDirective,
} from "../vantageDirectives.js";
import { isDocStatus, type DocStatus } from "../vantageFrontmatter.js";
import { resolveRepoLink } from "./links.js";

/** A question's state. `answered` is ✅: ruled, awaiting compaction. */
export type QuestionState = "open" | "blocked" | "answered";

/** One question: an `oq` directive that yields a button (design §3.3). */
export interface PlanningQuestion {
  path: string;
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
  /** `normalizeLeaning(leaning=)`; `null` when absent or empty. */
  leaning: string | null;
  /** File line of the block the in-page button anchors on. */
  line: number;
  /** File line of the enclosing `<li>`; `line` when it is not in a list item. */
  unitLine: number;
  /**
   * The root-level block holding it, in file lines. A root-level directive's
   * block starts at its run's first comment, so the slice keeps the directive.
   */
  block: { startLine: number; endLine: number };
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

/** One `depends-on` entry (design §4). */
export interface DependsOn {
  /** The entry as written. */
  raw: string;
  /** Resolved like a link; `null` when it resolves outside the repository. */
  target: string | null;
  fragment: string | null;
  /** File line of the entry; 1 when it cannot be placed. */
  line: number;
}

/** A header value that is ignored, and why (design §4, Plan Q20). */
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
}

export type ScanResult =
  | { kind: "planning"; document: PlanningDocument }
  | { kind: "not-planning" }
  | { kind: "unreadable"; reason: string };

/**
 * The same processor the viewer and the checker parse with: the remark half of
 * `buildPipeline`, so GFM and `$$` math are on exactly as they are there.
 */
const parser = unified().use(remarkParse).use(buildRemarkPlugins());

/** A document body as the viewer parses it. Shared with `cardSource.ts`. */
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
  /** The root-level block this all sits in; `undefined` at the root itself. */
  rootChild: RootContent | undefined;
}

/**
 * One child of a block parent as the plugin will meet it in hast: an element,
 * a comment, blocking text, or whitespace it skips. Raw HTML is split into its
 * comments and the text between them, as `rehype-raw` splits it.
 */
type Token =
  | { kind: "element"; node: RootContent }
  | { kind: "raw" }
  | { kind: "text" }
  | { kind: "comment"; directive: ParsedDirective | undefined; line: number };

function tokensOf(children: RootContent[]): Token[] {
  const tokens: Token[] = [];
  for (const child of children) {
    // Neither renders where it is written: a definition renders nothing, and a
    // footnote definition is hoisted to the end of the document.
    if (child.type === "definition" || child.type === "footnoteDefinition") {
      continue;
    }
    if (child.type !== "html") {
      tokens.push({ kind: "element", node: child });
      continue;
    }
    const start = child.position?.start.line ?? 1;
    for (const segment of scanComments(child.value)) {
      if (segment.kind === "text") {
        const rest = segment.value.trim();
        if (rest === "") continue;
        // A tag is an element `rehype-raw` will build, which mdast cannot
        // see into (Plan Q17); anything else is text that ends a run.
        tokens.push({ kind: rest.startsWith("<") ? "raw" : "text" });
        continue;
      }
      const line =
        start +
        (child.value.slice(0, segment.offset).match(/\n/g)?.length ?? 0);
      const parsed =
        segment.terminator === null
          ? undefined
          : parseVantageDirective(segment.value);
      tokens.push({
        kind: "comment",
        directive: parsed?.kind === "directive" ? parsed : undefined,
        line,
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
  questions: Omit<PlanningQuestion, "path" | "id">[];
  /** The merged `id=` of each question, before duplicates are resolved. */
  rawIds: (string | undefined)[];
  /** Footnote definitions, walked last because they render last. */
  footnotes: { node: Parents; context: Context }[];
}

/**
 * The plugin's `processChildren`, over one block parent's children: find each
 * run of directives, the element it lands on, and — for a run holding `oq` —
 * whether that element yields a button.
 */
function walkBlocks(context: Context, state: ScanState): void {
  const tokens = tokensOf(context.parent.children as RootContent[]);
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === undefined) break;
    if (token.kind === "element") {
      descend(token.node, context, state);
      i++;
      continue;
    }
    if (token.kind !== "comment" || token.directive === undefined) {
      i++;
      continue;
    }

    const run: ParsedDirective[] = [token.directive];
    const firstLine = token.line;
    let j = i + 1;
    let target: RootContent | undefined;
    for (; j < tokens.length; j++) {
      const next = tokens[j];
      if (next === undefined || next.kind === "raw" || next.kind === "text") {
        break;
      }
      if (next.kind === "element") {
        target = next.node;
        break;
      }
      if (next.directive !== undefined) run.push(next.directive);
    }
    if (target !== undefined) question(target, run, firstLine, context, state);
    i = j;
  }
  // A footnote definition is skipped above, for it is not where it is written.
  for (const child of context.parent.children as RootContent[]) {
    if (child.type === "footnoteDefinition") {
      state.footnotes.push({
        node: child,
        // Hoisted into the footnotes section, so no list item encloses it.
        context: {
          parent: child,
          list: undefined,
          listItem: undefined,
          itemList: undefined,
          rootChild: context.rootChild ?? child,
        },
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
        { parent: item, list: node, listItem: item, itemList: node, rootChild },
        state,
      );
    }
  }
}

/** Record `target` as a question when the run holds `oq` and it hosts a button. */
function question(
  target: RootContent,
  run: ParsedDirective[],
  firstLine: number,
  context: Context,
  state: ScanState,
): void {
  // Merged per run, last key wins, as `stampRun` merges them.
  let hasOq = false;
  const keys = new Map<string, string>();
  for (const directive of run) {
    if (directive.name !== "oq") continue;
    hasOq = true;
    for (const pair of directive.pairs) keys.set(pair.key, pair.value);
  }
  if (!hasOq) return;
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
    context.listItem === undefined
      ? line
      : (context.listItem.position?.start.line ?? 1) + offset;
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

  // The contents column's reading: the nearest list item, else the target.
  const scope: Nodes = context.listItem ?? target;
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
    state: stateOf(marker, title),
    preference: marker.includes(VANTAGE_OQ_PREFERENCE),
    marker,
    title,
    leaning: leaning === "" ? null : leaning,
    line,
    unitLine,
    block,
  });
  state.rawIds.push(keys.get("id"));
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

/** Every `oq` directive anywhere in raw HTML, inline or not — orphans too. */
function hasOqDirective(root: Root): boolean {
  let found = false;
  const walk = (node: Nodes): void => {
    if (found) return;
    if (node.type === "html") {
      if (!node.value.includes(VANTAGE_SENTINEL)) return;
      for (const segment of scanComments(node.value)) {
        if (segment.kind !== "comment" || segment.terminator === null) continue;
        const parsed = parseVantageDirective(segment.value);
        if (parsed?.kind === "directive" && parsed.name === "oq") {
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

/** Every rendered Markdown link that names a path in the repository. */
function linksOf(
  root: Root,
  path: string,
  bodyLineOffset: number,
  bodyOffset: number,
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

function idsOf(source: string): string[] {
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
 * Read one candidate. `isRoadmap` is decided by the index, from the config
 * (`buildPlanningIndex`, `applySource`); no other caller passes it.
 *
 * Only a planning document contributes: one whose frontmatter has `status` or
 * `stage`, or that holds an `oq` directive, or the roadmap (design §3.1). A
 * file whose frontmatter does not parse is unreadable, since what it would
 * have said is unknown (§3.6). Anything else is dropped before its body is
 * parsed, which is what keeps a full scan cheap (§13, §15).
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
  if (!isRoadmap && !keyed && !hasOqDirective(root)) {
    return { kind: "not-planning" };
  }

  const state: ScanState = {
    bodyLineOffset: parsed.bodyLineOffset,
    questions: [],
    rawIds: [],
    footnotes: [],
  };
  walkBlocks(
    {
      parent: root,
      list: undefined,
      listItem: undefined,
      itemList: undefined,
      rootChild: undefined,
    },
    state,
  );
  for (let i = 0; i < state.footnotes.length; i++) {
    const footnote = state.footnotes[i];
    if (footnote !== undefined) walkBlocks(footnote.context, state);
  }

  const seen = new Set<string>();
  const questions: PlanningQuestion[] = state.questions.map((q, index) => {
    const raw = state.rawIds[index];
    let id: string | null = null;
    if (raw !== undefined && VANTAGE_OQ_ID.test(raw) && !seen.has(raw)) {
      id = raw;
      seen.add(raw);
    }
    return { path, id, ...q };
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
      links: linksOf(root, path, parsed.bodyLineOffset, bodyOffset),
      ids: idsOf(source),
    },
  };
}
