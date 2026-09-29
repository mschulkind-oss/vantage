/**
 * The Markdown a question's card renders (`docs/design/planning-index.md`
 * §6.3), now cut by the scan from its own parse
 * (`docs/design/planning-index-at-scale.md` §7.4).
 *
 * The cards used to be cut by parsing each document a second time. That
 * parse-based cut is kept here, verbatim, as the oracle: for every question in
 * `docs/` (the gallery included), the end-to-end fixtures and the inline
 * shapes below, the scan's block must equal the oracle's, byte for byte. The
 * cut itself was held to the rendered document, and still is: a few cases
 * render the block through the viewer's own pipeline, at the offset it comes
 * with, and compare the question's host with the whole document rendered the
 * same way.
 */
import { readdirSync } from "node:fs";
import type { Nodes, Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import {
  buildRemarkPlugins,
  parseFrontmatter,
  renderMarkdown,
} from "vantage-md";
import {
  cardBlockFor,
  questionCardSource,
  scanPlanningDocument,
  type CardBlock,
  type PlanningQuestion,
} from "vantage-md/planning";
import { readRepoFile, repoPath } from "../test/planning";

/* ------------------------------------------------------------------ *
 * The oracle: the parse-based cut the scan's blocks replace
 * ------------------------------------------------------------------ */

const oracleParser = unified().use(remarkParse).use(buildRemarkPlugins());

function escape(text: string, specials: RegExp): string {
  return text.replace(specials, (ch) => `\\${ch}`);
}

function definitionText(node: Extract<Nodes, { type: "definition" }>): string {
  const label = node.label ?? node.identifier;
  const url = `<${escape(node.url, /[<>\\&]/g)}>`;
  const title =
    node.title === null || node.title === undefined
      ? ""
      : ` "${escape(node.title, /["\\&]/g)}"`;
  return `[${label}]: ${url}${title}`;
}

function holdsFootnote(node: Nodes): boolean {
  if (node.type === "footnoteReference" || node.type === "footnoteDefinition") {
    return true;
  }
  return "children" in node && (node.children as Nodes[]).some(holdsFootnote);
}

interface Span {
  from: number;
  to: number;
}

interface Outline {
  blocks: (Span & { footnote: boolean })[];
  definitions: (Span & { text: string })[];
}

function oracleOutline(source: string): Outline {
  const parsed = parseFrontmatter(source);
  const root = oracleParser.parse(parsed.body) as Root;
  const offset = parsed.bodyLineOffset;
  const span = (node: Nodes): Span => ({
    from: (node.position?.start.line ?? 0) + offset,
    to: (node.position?.end.line ?? 0) + offset,
  });
  const definitions: Outline["definitions"] = [];
  const collect = (node: Nodes): void => {
    if (node.type === "definition") {
      definitions.push({ ...span(node), text: definitionText(node) });
      return;
    }
    if ("children" in node) (node.children as Nodes[]).forEach(collect);
  };
  collect(root);
  return {
    blocks: root.children.map((child) => ({
      ...span(child),
      footnote: holdsFootnote(child),
    })),
    definitions,
  };
}

function oracleCard(
  source: string,
  outline: Outline,
  question: PlanningQuestion,
): { markdown: string; lineOffset: number } {
  const { blocks, definitions } = outline;
  const { startLine, endLine } = question.block;
  const inSlice = (span: Span): boolean =>
    span.from <= endLine && span.to >= startLine;

  if (blocks.some((block) => inSlice(block) && block.footnote)) {
    return { markdown: source, lineOffset: 0 };
  }

  const outside = definitions
    .filter((definition) => !inSlice(definition))
    .map((definition) => definition.text);
  const slice = source
    .split("\n")
    .slice(startLine - 1, endLine)
    .join("\n");
  const markdown =
    outside.length === 0 ? `${slice}\n` : `${slice}\n\n${outside.join("\n")}\n`;
  return { markdown, lineOffset: startLine - 1 };
}

/* ------------------------------------------------------------------ *
 * The corpus
 * ------------------------------------------------------------------ */

function markdownUnder(dir: string): string[] {
  return (
    readdirSync(repoPath(dir), {
      recursive: true,
      encoding: "utf8",
    }) as string[]
  )
    .filter((file) => file.endsWith(".md"))
    .map((file) => `${dir}/${file}`)
    .sort();
}

/** Every document on disk, read once: `docs/` and the end-to-end fixtures. */
const ON_DISK: Record<string, string> = Object.fromEntries(
  [...markdownUnder("docs"), ...markdownUnder("frontend/e2e/fixtures")].map(
    (path) => [path, readRepoFile(path)],
  ),
);

/** A block holding a footnote: its card is the whole document. */
const FOOTNOTE = [
  "---",
  "status: in-review",
  "---",
  "",
  "Earlier, a first note.[^a]",
  "",
  '<!-- vantage: oq id=OQ-F1 leaning="Yes." -->',
  "",
  "\u{1F4AC} A question that cites a second note.[^b]",
  "",
  "[^a]: The first.",
  "[^b]: The second.",
  "",
].join("\n");

/** A question found while walking a footnote: its block is that footnote. */
const IN_A_FOOTNOTE = [
  "---",
  "status: in-review",
  "---",
  "",
  "Prose with a note.[^q]",
  "",
  "[^q]: The note.",
  "",
  '    <!-- vantage: oq id=OQ-F2 leaning="Yes." -->',
  "",
  "    \u{1F4AC} A question written in the note.",
  "",
].join("\n");

/** Reference-style links, whose definitions sit outside the block. */
const REFERENCE_LINK = [
  "---",
  "status: in-review",
  "---",
  "",
  "1. \u{1F4AC} **OQ-R1: Does [the plan][plan] settle it?**",
  "",
  '   <!-- vantage: oq id=OQ-R1 leaning="It does." -->',
  "",
  "   _Leaning:_ it does, per [the notes].",
  "",
  "Later prose.",
  "",
  '[plan]: ./plan.md "The <plan> & \\"more\\""',
  "[the notes]: <./my notes.md>",
  "",
].join("\n");

/** A root-level run of directives across two comments, then its host. */
const DIRECTIVE_RUN = [
  "# X", // 1
  "", // 2
  "Before.", // 3
  "", // 4
  "<!-- vantage: oq id=OQ-4 -->", // 5
  "", // 6
  '<!-- vantage: oq leaning="A paragraph." -->', // 7
  "", // 8
  "A question as a plain paragraph.", // 9
  "", // 10
  "After.", // 11
  "",
].join("\n");

const INLINE: Record<string, string> = {
  "inline/footnote.md": FOOTNOTE,
  "inline/in-a-footnote.md": IN_A_FOOTNOTE,
  "inline/reference-link.md": REFERENCE_LINK,
  "inline/directive-run.md": DIRECTIVE_RUN,
};

const CORPUS: Record<string, string> = { ...ON_DISK, ...INLINE };

function scanned(
  path: string,
  source: string,
): { questions: PlanningQuestion[]; cards: CardBlock[] } {
  const result = scanPlanningDocument(path, source, false);
  if (result.kind !== "planning") return { questions: [], cards: [] };
  return { questions: result.document.questions, cards: result.cards };
}

function questionsOf(path: string, source: string): PlanningQuestion[] {
  const { questions } = scanned(path, source);
  if (questions.length === 0) throw new Error(`${path} has no questions`);
  return questions;
}

/** The scan's block for the only question of `source`. */
function onlyCard(
  path: string,
  source: string,
): { question: PlanningQuestion; card: CardBlock } {
  const { questions, cards } = scanned(path, source);
  const [question] = questions;
  const card =
    question === undefined ? undefined : cardBlockFor(cards, question);
  if (question === undefined || card === undefined) {
    throw new Error(`${path} has no card`);
  }
  return { question, card };
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

/**
 * Render a card's Markdown with every source line shifted by `offset`, as the
 * viewer's source-line offset will: blank lines in front move every line down
 * and change nothing else a Markdown parser sees.
 */
async function renderAt(
  markdown: string,
  offset: number,
): Promise<HTMLElement> {
  const host = document.createElement("div");
  host.innerHTML = (await renderMarkdown("\n".repeat(offset) + markdown)).html;
  return host;
}

async function renderDocument(source: string): Promise<HTMLElement> {
  const host = document.createElement("div");
  host.innerHTML = (await renderMarkdown(source)).html;
  return host;
}

/** The stamped host whose block starts on `line`, and its text. */
function hostAt(root: HTMLElement, line: number): string | undefined {
  for (const stamped of root.querySelectorAll("[data-vantage-oq]")) {
    if (Number(stamped.getAttribute("data-source-line")) === line) {
      return (stamped.textContent ?? "").replace(/\s+/g, " ").trim();
    }
  }
  return undefined;
}

/** Render the card and the document, and hold the card to the document. */
async function expectCardMatches(
  source: string,
  question: PlanningQuestion,
  card: { markdown: string; lineOffset: number },
): Promise<void> {
  const inCard =
    card.lineOffset === 0 && card.markdown === source
      ? await renderDocument(source)
      : await renderAt(card.markdown, card.lineOffset);
  const inDocument = await renderDocument(source);
  const expected = hostAt(inDocument, question.line);
  expect(expected).toBeDefined();
  expect(hostAt(inCard, question.line)).toBe(expected);
}

/* ------------------------------------------------------------------ *
 * The agreement
 * ------------------------------------------------------------------ */

describe("the scan's card blocks and the parse-based cut", () => {
  it("has a corpus with questions in it to agree on", () => {
    // An empty corpus would agree trivially.
    const total = Object.entries(ON_DISK).reduce(
      (sum, [path, source]) => sum + scanned(path, source).questions.length,
      0,
    );
    expect(Object.keys(ON_DISK).length).toBeGreaterThan(40);
    expect(total).toBeGreaterThan(30);
  });

  it.each(Object.keys(CORPUS))(
    "cuts every card of %s as the second parse did",
    (path) => {
      const source = CORPUS[path] ?? "";
      const { questions, cards } = scanned(path, source);
      const outline = oracleOutline(source);
      for (const question of questions) {
        const card = cardBlockFor(cards, question);
        expect(card, `the card of line ${question.line}`).toBeDefined();
        expect({
          markdown: card?.markdown,
          lineOffset: card?.lineOffset,
        }).toEqual(oracleCard(source, outline, question));
        expect(question.cardChars).toBe(card?.markdown.length);
      }
    },
  );

  it.each(Object.keys(CORPUS))(
    "cuts one block per distinct question block of %s, in file order",
    (path) => {
      const { questions, cards } = scanned(path, CORPUS[path] ?? "");
      const distinct = [
        ...new Map(
          questions.map((q) => [`${q.block.startLine}:${q.block.endLine}`, q]),
        ).values(),
      ]
        .map((q) => q.block)
        .sort((a, b) => a.startLine - b.startLine);
      expect(
        cards.map(({ startLine, endLine }) => ({ startLine, endLine })),
      ).toEqual(distinct);
      // A card request names its block by its first line alone.
      const starts = cards.map((card) => card.startLine);
      expect(new Set(starts).size).toBe(starts.length);
    },
  );

  it("cuts one block for agent-bootstrap.md's five questions, which share one list", () => {
    const path = "docs/design/agent-bootstrap.md";
    const { questions, cards } = scanned(path, CORPUS[path] ?? "");
    expect(questions).toHaveLength(5);
    expect(cards).toHaveLength(1);
    for (const question of questions) {
      expect(cardBlockFor(cards, question)).toBe(cards[0]);
      expect(question.cardChars).toBe(cards[0]?.markdown.length);
    }
  });

  it("cuts nothing for a planning document without questions", () => {
    const result = scanPlanningDocument(
      "docs/x.md",
      "---\nstatus: draft\n---\n\n# X\n",
      false,
    );
    expect(result).toMatchObject({ kind: "planning", cards: [] });
  });

  it("hands over the whole document, at offset 0, when the block holds a footnote", async () => {
    for (const path of ["inline/footnote.md", "inline/in-a-footnote.md"]) {
      const source = CORPUS[path] ?? "";
      const { question, card } = onlyCard(path, source);
      expect(card).toMatchObject({ markdown: source, lineOffset: 0 });
      expect(question.cardChars).toBe(source.length);
      await expectCardMatches(source, question, card);
    }
  });

  it("starts a root-level directive run's slice at its first comment", () => {
    const { question, card } = onlyCard(
      "inline/directive-run.md",
      DIRECTIVE_RUN,
    );
    expect(question.block).toEqual({ startLine: 5, endLine: 9 });
    expect(card).toEqual({
      startLine: 5,
      endLine: 9,
      markdown: [
        "<!-- vantage: oq id=OQ-4 -->",
        "",
        '<!-- vantage: oq leaning="A paragraph." -->',
        "",
        "A question as a plain paragraph.",
        "",
      ].join("\n"),
      lineOffset: 4,
    });
  });

  it("brings the document's link definitions after one blank line", async () => {
    const { question, card } = onlyCard(
      "inline/reference-link.md",
      REFERENCE_LINK,
    );
    expect(card.markdown).toMatch(
      /_Leaning:_ it does, per \[the notes\]\.\n\n\[plan\]: /,
    );
    expect(card.markdown.endsWith("[the notes]: <./my notes.md>\n")).toBe(true);

    const rendered = await renderAt(card.markdown, card.lineOffset);
    const links = [...rendered.querySelectorAll("a")].map((a) => [
      a.getAttribute("href"),
      a.getAttribute("title"),
    ]);
    expect(links).toEqual([
      ["./plan.md", 'The <plan> & "more"'],
      ["./my%20notes.md", null],
    ]);
    await expectCardMatches(REFERENCE_LINK, question, card);
  });

  it("slices the root-level block, so its lines round-trip", () => {
    const path = "docs/design/agent-bootstrap.md";
    const source = CORPUS[path] ?? "";
    const lines = source.split("\n");
    const { cards } = scanned(path, source);
    for (const question of questionsOf(path, source)) {
      const card = cardBlockFor(cards, question);
      const { startLine, endLine } = question.block;
      expect(card?.lineOffset).toBe(startLine - 1);
      expect(
        card?.markdown.split("\n").slice(0, endLine - startLine + 1),
      ).toEqual(lines.slice(startLine - 1, endLine));
    }
  });

  it.each([
    ["docs/gallery/open-questions.md"],
    ["docs/gallery/status.md"],
    ["docs/design/agent-bootstrap.md"],
  ])("renders every question in %s as its document does", async (path) => {
    const source = CORPUS[path] ?? "";
    const { questions, cards } = scanned(path, source);
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      const card = cardBlockFor(cards, question);
      if (card === undefined) throw new Error(`no card for ${question.line}`);
      await expectCardMatches(source, question, card);
    }
  });
});

describe("questionCardSource", () => {
  it("answers the scan's own block", () => {
    const path = "docs/gallery/open-questions.md";
    const source = CORPUS[path] ?? "";
    const { cards } = scanned(path, source);
    for (const question of questionsOf(path, source)) {
      const card = cardBlockFor(cards, question);
      expect(questionCardSource(source, question)).toEqual({
        markdown: card?.markdown,
        lineOffset: card?.lineOffset,
      });
    }
  });

  it("still cuts a question's lines from a text it was not read from", () => {
    const { question } = onlyCard("inline/directive-run.md", DIRECTIVE_RUN);
    // Two lines in front, so the question's block is no block of this text.
    const edited = `# Moved\n\n${DIRECTIVE_RUN}`;
    expect(questionCardSource(edited, question)).toEqual(
      oracleCard(edited, oracleOutline(edited), question),
    );
    // Its frontmatter no longer parses, so the scan gives it no cards at all.
    const broken = `---\nstatus: [x\n---\n${DIRECTIVE_RUN}`;
    expect(questionCardSource(broken, question)).toEqual(
      oracleCard(broken, oracleOutline(broken), question),
    );
  });
});
