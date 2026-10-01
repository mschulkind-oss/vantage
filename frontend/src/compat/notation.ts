/**
 * What an older Vantage makes of the notation this tree teaches.
 *
 * P0 of `docs/design/checker-version-skew.md`: a release never gives existing
 * notation a new meaning. A new meaning gets a new directive name, key or value,
 * which an older viewer drops without harm. This module is that rule as a check
 * rather than a review habit. It renders a document through two releases of
 * `vantage-md`, an older one and this tree, and reports every **misreading**
 * *(coined here)*: a place where the older release's viewer would show the
 * reader something other than what this tree means by the same bytes.
 *
 * It knows six kinds:
 *
 * - **`affordance`**: the older viewer offers a control the notation no longer
 *   asks for. The case that made this module: 0.8.0's guide put an `oq`
 *   directive on blocked and answered questions, and every 0.7 viewer offers
 *   "Take this leaning" on every `oq` it meets.
 * - **`spill`**: the guide promises that a viewer which does not know a
 *   directive drops it, so the page reads the same without it. Here the older
 *   viewer's page reads differently with the directives it does not apply
 *   than without them: a `-->` inside a value has spilled the rest of the
 *   comment onto the page, or a comment that never closes has swallowed it.
 * - **`text`**: the older page shows text this tree's page does not, such as
 *   new syntax an older parser shows literally. A block this tree withholds by
 *   a directive is the exception: a `fallback` block is there for exactly the
 *   readers who see it.
 * - **`meaning`**: the older renderer stamps a block with a `data-vantage-*`
 *   attribute or an `id` that this tree does not give it. An older viewer may do
 *   less with a document, never something different. Doing less includes
 *   keeping what this tree stamps once the directives the older release drops
 *   are deleted: a heading keeps its own slug where this tree gives it a
 *   `question`'s id, which is that directive dropped, not read another way.
 * - **`capability`**: this tree renders something the older release cannot,
 *   such as inline SVG, and the example does not pair it with a fallback block
 *   the older viewer shows, or does not say which release it needs.
 * - **`frontmatter`**: the older release parses the frontmatter to different
 *   values, cannot parse it, or shows a different status chip.
 *
 * What it does not cover: anything the npm package does not contain. The
 * server's handling of `.vantage.toml` and the app's controls other than the
 * one modeled below are proved by running a released binary, and nothing here
 * does that.
 *
 * Pure: the releases arrive as values. `src/test/compat/` fetches the previous
 * published one from npm and runs this over the style guide, and
 * `notation.test.ts` runs it offline against doctored copies of this tree.
 */

import {
  DIRECTIVE_NAMES,
  DIRECTIVE_VOCABULARY,
  DOC_STATUSES,
  STYLE_GUIDE,
  VANTAGE_FRONTMATTER_KEYS,
  VANTAGE_OQ_HOST_TARGETS,
  VANTAGE_OQ_STATUS,
  parseFrontmatter,
  parseVantageDirective,
  readVantageFrontmatter,
  renderMarkdown,
  type DirectiveVocabulary,
} from "vantage-md";
import {
  scanPlanningDocument,
  type PlanningQuestion,
} from "vantage-md/planning";
import { diffWords } from "diff";

/** What the check needs from one release's `vantage-md`. */
export interface Release {
  /** How messages name it: `vantage-md@0.7.1`, or `this tree`. */
  name: string;
  renderMarkdown(content: string): Promise<{ html: string }>;
  parseFrontmatter(content: string): {
    frontmatter: Record<string, unknown>;
    problem?: { kind: string };
  };
  readVantageFrontmatter(frontmatter: Record<string, unknown>): {
    statusChip?: string;
  };
  /**
   * `VANTAGE_OQ_HOST_TARGETS`: the tags the app may hang an answer button on.
   * Absent for a release that predates the export, which then gets the list
   * every release so far has used.
   */
  oqHostTargets?: readonly string[];
  /**
   * Whether this release applies the directive whose comment text is `inner`
   * (the text between `<!--` and the terminator): its own parser accepts it and
   * knows its name. Absent, every directive counts as one it drops.
   */
  appliesDirective?(inner: string): boolean;
}

/** This tree's `vantage-md`, read from source through the frontend's alias. */
export const THIS_TREE: Release = {
  name: "this tree",
  renderMarkdown: (content) => renderMarkdown(content),
  parseFrontmatter,
  readVantageFrontmatter,
  oqHostTargets: VANTAGE_OQ_HOST_TARGETS,
  appliesDirective: (inner) => {
    const parsed = parseVantageDirective(inner);
    return (
      parsed?.kind === "directive" &&
      (DIRECTIVE_NAMES as readonly string[]).includes(parsed.name)
    );
  },
};

/** One document to render through both releases. */
export interface NotationExample {
  /** Where it comes from, in the words a reader of a failure searches for. */
  origin: string;
  source: string;
  /**
   * The heading the guide shows it under, which is where the guide may say
   * which release a capability needs.
   */
  heading?: string;
}

export interface Misreading {
  kind:
    "affordance" | "spill" | "text" | "meaning" | "capability" | "frontmatter";
  message: string;
}

/**
 * What a release added that an older renderer cannot draw, and the release it
 * needs. An example using one passes only when it says so and pairs it with a
 * block this tree withholds by a directive, which the older viewer shows
 * instead. A release that adds a capability adds it here.
 */
export const CAPABILITIES: readonly {
  name: string;
  since: string;
  /** The elements of this tree's page that use it. */
  uses(doc: Document): Element[];
}[] = [
  {
    name: "inline <svg>",
    since: "0.8",
    // KaTeX draws a few glyphs as SVG, and that is math, not a drawing.
    uses: (doc) =>
      [...doc.querySelectorAll("svg")].filter((el) => !el.closest(".katex")),
  },
];

// ── The examples ──────────────────────────────────────────────────────────

interface Fence {
  char: string;
  length: number;
}

const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\s`]*)/;

function opensFence(line: string): (Fence & { info: string }) | null {
  const match = FENCE_OPEN.exec(line);
  if (match === null) return null;
  const marker = match[2] ?? "";
  // A backtick fence's info string cannot hold a backtick; one that does is
  // inline code at the start of a line, not a fence.
  if (marker.startsWith("`") && line.slice(match[0].length).includes("`")) {
    return null;
  }
  return {
    char: marker[0] ?? "`",
    length: marker.length,
    info: match[3] ?? "",
  };
}

function closesFence(line: string, fence: Fence): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length >= fence.length &&
    [...trimmed].every((c) => c === fence.char)
  );
}

/** A code span holding a whole directive, as the guide quotes one in prose. */
const QUOTED_DIRECTIVE = /`(<!--[ \t]*vantage:[^`]*?-->)`/g;

/**
 * Every piece of notation `guide` shows, as a document of its own:
 *
 * - the guide itself, whose callouts are written as the real thing;
 * - each ` ```markdown ` example, as written;
 * - each ` ```yaml ` example that is a frontmatter block, above a heading;
 * - each directive the prose quotes in a code span, above a heading and a
 *   paragraph for it to apply to.
 *
 * A fence inside a list item is read at its own indentation, and its lines are
 * taken with that indentation removed, as CommonMark reads them.
 */
export function guideExamples(guide: string = STYLE_GUIDE): NotationExample[] {
  const examples: NotationExample[] = [
    { origin: "the style guide, read as a document", source: guide },
  ];
  const quoted = new Set<string>();
  const lines = guide.split("\n");
  let heading = "the top of the guide";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = opensFence(line);
    if (fence === null) {
      const title = /^#{2,4}[ \t]+(.+)$/.exec(line);
      if (title !== null) heading = `"${title[1]}"`;
      for (const match of line.matchAll(QUOTED_DIRECTIVE)) {
        const directive = match[1] ?? "";
        if (quoted.has(directive)) continue;
        quoted.add(directive);
        examples.push({
          origin: `${directive}, as the style guide quotes it at line ${i + 1}`,
          source: `${directive}\n\n## A heading\n\nA paragraph.\n`,
        });
      }
      continue;
    }

    const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0;
    const body: string[] = [];
    let end = i + 1;
    while (end < lines.length && !closesFence(lines[end] ?? "", fence)) {
      body.push((lines[end] ?? "").slice(indent));
      end++;
    }
    const content = body.join("\n");
    const where = `\`\`\`${fence.info} example at line ${i + 1} of the style guide, under ${heading}`;
    if (fence.info === "markdown" || fence.info === "md") {
      examples.push({
        origin: `the ${where}`,
        source: `${content}\n`,
        heading,
      });
    } else if (
      (fence.info === "yaml" && body[0] === "---") ||
      (fence.info === "toml" && body[0] === "+++")
    ) {
      examples.push({
        origin: `the frontmatter in the ${where}`,
        source: `${content}\n\n# A document\n\nA paragraph.\n`,
      });
    }
    i = end;
  }
  return examples;
}

/** A value for a key with no closed set: `id` takes an id, the rest prose. */
function sampleValue(key: string): string {
  return key === "id" ? "OQ-1" : '"A sentence of text."';
}

/**
 * Every directive form `vocabulary` accepts: each name bare, and each name with
 * each of its keys set to each of its values. Each sits once above a heading,
 * where `section` reaches, and once above a paragraph, where `block` does.
 */
export function vocabularyExamples(
  vocabulary: DirectiveVocabulary = DIRECTIVE_VOCABULARY,
): NotationExample[] {
  const examples: NotationExample[] = [];
  for (const [name, keys] of Object.entries(vocabulary)) {
    const forms = [`<!-- vantage: ${name} -->`];
    for (const [key, values] of Object.entries(keys ?? {})) {
      for (const value of values ?? [sampleValue(key)]) {
        forms.push(`<!-- vantage: ${name} ${key}=${value} -->`);
      }
    }
    for (const form of forms) {
      examples.push(
        {
          origin: `${form} above a heading`,
          source: `${form}\n\n## A heading\n\nA paragraph.\n`,
        },
        {
          origin: `${form} above a paragraph`,
          source: `A paragraph.\n\n${form}\n\nAnother paragraph.\n`,
        },
      );
    }
  }
  return examples;
}

/** Every value of every `vantage:` frontmatter key this tree reads. */
export function frontmatterExamples(): NotationExample[] {
  const examples: NotationExample[] = [];
  for (const key of VANTAGE_FRONTMATTER_KEYS) {
    const values =
      key === "status-chip" ? ["true", "false", ...DOC_STATUSES] : ["true"];
    for (const value of values) {
      examples.push({
        origin: `the frontmatter \`vantage: { ${key}: ${value} }\``,
        source: `---\nstatus: draft\nvantage:\n  ${key}: ${value}\n---\n\n# A document\n`,
      });
    }
  }
  return examples;
}

// ── Without its directives ────────────────────────────────────────────────

/** A line that opens a directive: the sentinel first thing in a comment. */
const DIRECTIVE_LINE = /^[ \t]*<!--[ \t]*vantage:/;
/** What ends a comment for the HTML parser: `-->`, and `--!>` too. */
const COMMENT_CLOSE = /--!?>/;
/** A line that ends the comment, as the author wrote it. */
const COMMENT_END_LINE = /--!?>[ \t]*$/;

/**
 * `source` as a viewer would show it if it dropped every directive it does not
 * apply, which is what the guide promises a viewer that does not know one does.
 * Each such directive's lines are blanked, so the blocks around it keep their
 * line numbers. A directive `applies` is kept, because what it does to the page
 * is its meaning, not a leak: a viewer that knows `fallback` hides the block
 * after it, and it is meant to.
 *
 * A directive here is one on lines of its own, which is the only way the guide
 * teaches one. Whether it applies is asked of the comment as HTML reads it,
 * which ends at the first terminator. What is blanked is the comment as the
 * author meant it, which runs to the first line that *ends* with one. The gap
 * between the two is the point: a `-->` inside a value cuts the comment short,
 * the cut comment no longer parses, and the rest of it lands on the page where
 * the page without the directive has nothing. An unclosed directive is blanked
 * on its first line only, so what it swallows shows up the same way. Fenced
 * code is left alone; a directive there is a specimen.
 */
export function withoutDirectives(
  source: string,
  applies: (inner: string) => boolean = () => false,
): string {
  const lines = source.split("\n");
  let fence: Fence | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    fence = opensFence(line);
    if (fence !== null || !DIRECTIVE_LINE.test(line)) continue;

    const rest = lines.slice(i).join("\n");
    const opened = rest.indexOf("<!--") + "<!--".length;
    const close = COMMENT_CLOSE.exec(rest.slice(opened));
    const inner = rest.slice(
      opened,
      close === null ? undefined : opened + close.index,
    );

    let end = i;
    while (end < lines.length && !COMMENT_END_LINE.test(lines[end] ?? "")) {
      end++;
    }
    if (end === lines.length) end = i;
    if (!applies(inner)) {
      for (let j = i; j <= end; j++) lines[j] = "";
    }
    i = end;
  }
  return lines.join("\n");
}

// ── Reading a render ──────────────────────────────────────────────────────

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function visibleText(doc: Document): string {
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

function lineOf(el: Element): number {
  return Number(el.getAttribute("data-source-line"));
}

/** What a review anchor can rest on: `ANCHORABLE_BLOCK_SELECTOR`, v0.7.1. */
const ANCHORABLE = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "table",
  "td",
  "th",
]
  .map((tag) => `${tag}[data-source-line]`)
  .join(", ");

/** `VANTAGE_OQ_HOST_TARGETS` as it has stood since the export was added. */
const OQ_HOSTS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote"];

/**
 * The file lines a review-mode reader is offered "Take this leaning" on.
 *
 * A model of the released app, which the npm package does not contain:
 * `answerableOpenQuestions` in `frontend/src/hooks/useOpenQuestionButtons.ts`
 * at v0.7.1, with `anchorBlockWithin` from `frontend/src/lib/reviewAnchor.ts`.
 * It offers the button on every `[data-vantage-oq]` block, whatever the
 * question's marker says, anchored on the first anchorable block inside it, if
 * that block is one a button can sit in. A release whose app answers that
 * differently needs this model changed with it.
 */
function answerableLines(doc: Document, hosts: readonly string[]): number[] {
  const lines: number[] = [];
  const hosted = new Set<Element>();
  for (const stamped of doc.querySelectorAll("[data-vantage-oq]")) {
    const candidates = [
      ...(stamped.matches(ANCHORABLE) ? [stamped] : []),
      ...stamped.querySelectorAll(ANCHORABLE),
    ];
    if (candidates.length === 0) continue;
    const first = Math.min(...candidates.map(lineOf));
    const block = candidates.filter((el) => lineOf(el) === first).at(-1);
    if (block === undefined || hosted.has(block)) continue;
    if (!hosts.includes(block.tagName.toLowerCase())) continue;
    hosted.add(block);
    lines.push(first);
  }
  return lines;
}

const STATE_WORDS: Record<PlanningQuestion["state"], string> = {
  open: `open (${VANTAGE_OQ_STATUS.open})`,
  blocked: `blocked (${VANTAGE_OQ_STATUS.blocked}), which cannot be answered yet`,
  answered: `answered (${VANTAGE_OQ_STATUS.settled}), which has already been ruled`,
};

/** Where a block sits, so the same block can be found in the other render. */
function placeOf(el: Element): string {
  const tag = `<${el.tagName.toLowerCase()}>`;
  if (el.hasAttribute("data-source-line")) {
    return `${tag} at line ${el.getAttribute("data-source-line")}`;
  }
  const lined = el.parentElement?.closest("[data-source-line]");
  return lined
    ? `${tag} inside line ${lined.getAttribute("data-source-line")}`
    : tag;
}

/**
 * Every `data-vantage-*` attribute and every `id`, by element.
 *
 * Elements are keyed by their place and their order among elements in the same
 * place, which survives a release that changes how the page is nested where a
 * path from the root would not.
 */
function stampsOf(doc: Document): Map<string, Map<string, string>> {
  const stamps = new Map<string, Map<string, string>>();
  const seen = new Map<string, number>();
  for (const el of doc.body.querySelectorAll("*")) {
    const place = placeOf(el);
    const nth = seen.get(place) ?? 0;
    seen.set(place, nth + 1);
    const attributes = [...el.attributes].filter(
      (a) => a.name.startsWith("data-vantage-") || a.name === "id",
    );
    // Every element gets an entry, so "no stamp" and "no such element" differ.
    const key = nth === 0 ? place : `${place}, number ${nth + 1}`;
    stamps.set(key, new Map(attributes.map((a) => [a.name, a.value])));
  }
  return stamps;
}

/** Key order is the parser's business; the values are what must agree. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

/** Where two texts first part, with a little of each around it. */
function firstDifference(a: string, b: string): string {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  const from = Math.max(0, at - 30);
  const quote = (s: string) =>
    JSON.stringify(
      `${from > 0 ? "…" : ""}${s.slice(from, at + 50)}${s.length > at + 50 ? "…" : ""}`,
    );
  return `with them it reads ${quote(a)}, without them ${quote(b)}`;
}

/** The places of every block that has a source line. */
function blockPlaces(doc: Document): Set<string> {
  return new Set(
    [...doc.querySelectorAll("[data-source-line]")].map((el) => placeOf(el)),
  );
}

/**
 * The blocks `withDirectives` lacks and `without` has: what a release
 * withholds because a directive says so, which is what a `fallback` does.
 */
function withheldPlaces(
  withDirectives: Document,
  without: Document,
): Set<string> {
  const kept = blockPlaces(withDirectives);
  return new Set([...blockPlaces(without)].filter((place) => !kept.has(place)));
}

/** `doc`'s text with every block at one of `places` taken out. */
function textWithout(doc: Document, places: Set<string>): string {
  const copy = doc.cloneNode(true) as Document;
  for (const el of copy.querySelectorAll("[data-source-line]")) {
    if (places.has(placeOf(el))) el.remove();
  }
  return visibleText(copy);
}

/** The runs of words `older` has and `newer` does not, in order. */
function wordsOnlyIn(older: string, newer: string): string[] {
  return diffWords(older, newer)
    .filter((part) => part.removed && part.value.trim() !== "")
    .map((part) => part.value.trim());
}

// ── The check ─────────────────────────────────────────────────────────────

/** Every way `previous`'s viewer would misread `example`, in a fixed order. */
export async function misreadings(
  example: NotationExample,
  previous: Release,
  current: Release = THIS_TREE,
): Promise<Misreading[]> {
  const { source } = example;
  const render = (release: Release, markdown: string) =>
    release.renderMarkdown(markdown).then((r) => parse(r.html));
  const knownToPrevious = withoutDirectives(
    source,
    (inner) => previous.appliesDirective?.(inner) ?? false,
  );
  const [then, now, thenBare, nowBare, nowKnown] = await Promise.all([
    render(previous, source),
    render(current, source),
    render(previous, knownToPrevious),
    render(current, withoutDirectives(source)),
    // This tree, reading only the directives the older release applies.
    render(current, knownToPrevious),
  ]);
  const found: Misreading[] = [];
  const prev = previous.name;

  // A control the notation does not ask for.
  const scan = scanPlanningDocument("example.md", source, false);
  const questions = scan.kind === "planning" ? scan.document.questions : [];
  for (const line of answerableLines(
    then,
    previous.oqHostTargets ?? OQ_HOSTS,
  )) {
    const question =
      questions.find((q) => q.line === line) ??
      questions.find((q) => q.unitLine <= line && line <= q.unitEndLine);
    if (question === undefined) {
      found.push({
        kind: "affordance",
        message: `${prev} offers "Take this leaning" on line ${line}, where ${current.name} reads no question at all.`,
      });
    } else if (question.state !== "open") {
      const which = question.id ?? `the question on line ${question.line}`;
      found.push({
        kind: "affordance",
        message:
          `${prev} offers "Take this leaning" on ${which}, which ${current.name} reads as ` +
          `${STATE_WORDS[question.state]}. Its directive has to be a name ${prev} does not know, ` +
          `so that release drops it (docs/design/checker-version-skew.md, P0).`,
      });
    }
  }

  // Text the page shows, or loses, only because of a directive it drops.
  const withThem = visibleText(then);
  const withoutThem = visibleText(thenBare);
  if (withThem !== withoutThem) {
    found.push({
      kind: "spill",
      message: `${prev} shows a different page with the directives it drops than without them: ${firstDifference(withThem, withoutThem)}.`,
    });
  }

  // Text only the older page shows, apart from what this tree withholds.
  const withheld = withheldPlaces(now, nowBare);
  const extra = wordsOnlyIn(textWithout(then, withheld), visibleText(now));
  if (extra.length > 0) {
    found.push({
      kind: "text",
      message: `${prev} shows text ${current.name} does not: ${extra
        .slice(0, 3)
        .map((run) =>
          JSON.stringify(run.length > 80 ? `${run.slice(0, 80)}…` : run),
        )
        .join(
          ", ",
        )}${extra.length > 3 ? ` and ${extra.length - 3} more` : ""}.`,
    });
  }

  // A stamp the older renderer puts where this tree puts another, or none,
  // unless this tree puts that very stamp there once the directives the older
  // release drops are gone: then the older release has dropped them, which is
  // the harmless reading P0 asks for, and has misread nothing it applies.
  const ours = stampsOf(now);
  const oursKnown = stampsOf(nowKnown);
  for (const [place, theirs] of stampsOf(then)) {
    const mine = ours.get(place);
    for (const [name, value] of theirs) {
      const got = mine?.get(name);
      if (got === value) continue;
      if (oursKnown.get(place)?.get(name) === value) continue;
      const instead =
        mine === undefined
          ? `has no ${place} at all`
          : got === undefined
            ? `does not stamp it`
            : `stamps ${name}="${got}"`;
      found.push({
        kind: "meaning",
        message: `${prev} stamps ${name}="${value}" on the ${place}, and ${current.name} ${instead}.`,
      });
    }
  }

  // Something this tree draws and the older release cannot. Once the release
  // that added a capability is itself the previous release, it draws it too,
  // and the pairing is between readers older than both, which this pair of
  // releases cannot see: right after 0.8.0 is published, inline SVG is no
  // longer a gap between 0.8.0 and this tree.
  for (const capability of CAPABILITIES) {
    if (capability.uses(now).length === 0) continue;
    if (capability.uses(then).length > 0) continue;
    // The fallback is shown when the older page has text where it stood.
    const thenBlocks = [...then.querySelectorAll("[data-source-line]")];
    const shown = [...withheld].filter((place) =>
      thenBlocks.some(
        (el) => placeOf(el) === place && (el.textContent ?? "").trim() !== "",
      ),
    );
    const wanting: string[] = [];
    if (withheld.size === 0) {
      wanting.push("pairs it with no fallback block");
    } else if (shown.length === 0) {
      wanting.push(`has a fallback block ${prev} does not show`);
    }
    if (
      !`${example.heading ?? ""}\n${source}`.includes(
        `Vantage ${capability.since}`,
      )
    ) {
      wanting.push(`never says it needs Vantage ${capability.since}`);
    }
    if (wanting.length > 0) {
      found.push({
        kind: "capability",
        message: `${current.name} draws ${capability.name} here, which needs Vantage ${capability.since}, and the example ${wanting.join(" and ")}.`,
      });
    }
  }

  // The metadata card and the status chip.
  const fmThen = previous.parseFrontmatter(source);
  const fmNow = current.parseFrontmatter(source);
  if (fmThen.problem !== undefined && fmNow.problem === undefined) {
    found.push({
      kind: "frontmatter",
      message: `${prev} cannot read this frontmatter (${fmThen.problem.kind}), so its viewer shows the block as body text.`,
    });
  } else if (stableJson(fmThen.frontmatter) !== stableJson(fmNow.frontmatter)) {
    found.push({
      kind: "frontmatter",
      message: `${prev} reads this frontmatter as ${stableJson(fmThen.frontmatter)}, and ${current.name} as ${stableJson(fmNow.frontmatter)}.`,
    });
  }
  const chipThen = previous.readVantageFrontmatter(
    fmThen.frontmatter,
  ).statusChip;
  const chipNow = current.readVantageFrontmatter(fmNow.frontmatter).statusChip;
  if (chipThen !== undefined && chipThen !== chipNow) {
    found.push({
      kind: "frontmatter",
      message: `${prev} shows the status chip "${chipThen}", and ${current.name} ${chipNow === undefined ? "shows none" : `shows "${chipNow}"`}.`,
    });
  }

  return found;
}
