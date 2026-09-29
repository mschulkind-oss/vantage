/**
 * The slice a question's card renders (`docs/design/planning-index.md` §6.3,
 * and `questionCardSource` in the plan's shared contracts).
 *
 * The card must render the question as the document renders it, so each case
 * renders the slice through the viewer's own pipeline, with the offset the
 * slice comes back with, and compares it with the whole document rendered the
 * same way: the question's host must be there, on the same line, with the same
 * text.
 */
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "vantage-md";
import {
  questionCardSource,
  scanPlanningDocument,
  type PlanningQuestion,
} from "vantage-md/planning";
import { readRepoFile } from "../test/planning";

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

function questionsOf(path: string, source: string): PlanningQuestion[] {
  const result = scanPlanningDocument(path, source, false);
  if (result.kind !== "planning") throw new Error(`${path} is not planning`);
  return result.document.questions;
}

/** Render the card and the document, and hold the card to the document. */
async function expectCardMatches(
  source: string,
  question: PlanningQuestion,
): Promise<void> {
  const card = questionCardSource(source, question);
  const inCard =
    card.lineOffset === 0 && card.markdown === source
      ? await renderDocument(source)
      : await renderAt(card.markdown, card.lineOffset);
  const inDocument = await renderDocument(source);
  const expected = hostAt(inDocument, question.line);
  expect(expected).toBeDefined();
  expect(hostAt(inCard, question.line)).toBe(expected);
}

describe("questionCardSource", () => {
  it.each([
    ["docs/gallery/open-questions.md"],
    ["docs/gallery/status.md"],
    ["docs/design/agent-bootstrap.md"],
  ])("renders every question in %s as its document does", async (path) => {
    const source = readRepoFile(path);
    const questions = questionsOf(path, source);
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      await expectCardMatches(source, question);
    }
  });

  it("slices the root-level block, so its lines round-trip", () => {
    const path = "docs/design/agent-bootstrap.md";
    const source = readRepoFile(path);
    const lines = source.split("\n");
    for (const question of questionsOf(path, source)) {
      const { markdown, lineOffset } = questionCardSource(source, question);
      const { startLine, endLine } = question.block;
      expect(lineOffset).toBe(startLine - 1);
      expect(markdown.split("\n").slice(0, endLine - startLine + 1)).toEqual(
        lines.slice(startLine - 1, endLine),
      );
    }
  });

  it("starts a root-level directive's slice at its comment", () => {
    const source = [
      "# X", // 1
      "", // 2
      "Before.", // 3
      "", // 4
      '<!-- vantage: oq id=OQ-4 leaning="A paragraph." -->', // 5
      "", // 6
      "A question as a plain paragraph.", // 7
      "", // 8
      "After.", // 9
      "",
    ].join("\n");
    const [question] = questionsOf("docs/x.md", source);
    if (question === undefined) throw new Error("no question");
    expect(questionCardSource(source, question)).toEqual({
      markdown: [
        '<!-- vantage: oq id=OQ-4 leaning="A paragraph." -->',
        "",
        "A question as a plain paragraph.",
        "",
      ].join("\n"),
      lineOffset: 4,
    });
  });

  it("brings the document's link definitions after one blank line", async () => {
    const source = [
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
    const [question] = questionsOf("docs/x.md", source);
    if (question === undefined) throw new Error("no question");
    const card = questionCardSource(source, question);
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
    await expectCardMatches(source, question);
  });

  it("hands over the whole document when the block holds a footnote", async () => {
    const source = [
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
    const [question] = questionsOf("docs/x.md", source);
    if (question === undefined) throw new Error("no question");
    expect(questionCardSource(source, question)).toEqual({
      markdown: source,
      lineOffset: 0,
    });
    await expectCardMatches(source, question);
  });
});
