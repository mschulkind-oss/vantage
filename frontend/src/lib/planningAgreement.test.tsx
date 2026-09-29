/**
 * Design §3.3: the planning index and the contents column agree on every
 * question and its state.
 *
 * They read the same questions two ways. The column reads the rendered page —
 * which blocks `rehypeVantageDirectives` stamped, which of those host a button
 * (`answerableOpenQuestions`), and each one's marker (`questionLabel`). The index
 * reads the source, with no renderer, so it can run over a whole repository
 * without rendering it. This test renders each document through the app's own
 * `MarkdownViewer`, runs the column's `collectOutline` over the result, scans the
 * same source, and asserts the same questions in the same order, each with the
 * same id, the same state, the same marker, and the same lines — `line` is the
 * block the in-page button anchors on and `unitLine` the list item it belongs
 * to, both of which the planning page uses to find a question inside its card.
 *
 * The corpus is every Markdown file under `docs/`, read from disk so a new
 * document is covered the day it lands, plus inline fixtures for the shapes the
 * corpus may not hold. One divergence is allowed, and it is pinned rather than
 * tolerated: a directive written inside a raw HTML block (Plan Q17).
 *
 * The column's `id` is normalized the way the index defines one: `""` for no
 * usable id, and a repeated id only on its first question, because both
 * elements carry a repeated id but `#OQ-4` can only ever name the first
 * (Plan Q5).
 */
import { render, cleanup } from "@testing-library/react";
import { readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { scanPlanningDocument } from "vantage-md/planning";
import { MarkdownViewer } from "../components/MarkdownViewer";
import { collectOutline } from "../hooks/useDocumentOutline";
import { answerableOpenQuestions } from "../hooks/useOpenQuestionButtons";
import { readRepoFile, repoPath } from "../test/planning";

// Store writes fire command requests through axios; the viewer pulls the store in.
vi.mock("axios");
// The planning index is its own suites' subject (usePlanningStore.test.ts,
// usePlanningLinkBadges.test.tsx). Here it stays idle, so rendering the viewer
// issues no planning request and draws no badge.
vi.mock("../stores/usePlanningStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../stores/usePlanningStore")>()),
  usePlanningIndex: () => ({ status: "idle" }),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});
// A Mermaid diagram stays a placeholder here. Drawn for real it can only fail
// in jsdom, which has no getBBox to measure text with, and it fails after the
// synchronous case that rendered it has ended: work left running past its
// case, loading all of Mermaid for a render nobody reads. It used to log that
// failure after the file's last case, too, which can fail the whole run with
// EnvironmentTeardownError; a diagram no longer logs once it is gone
// (mermaidDiagram.test.ts). No question can live inside a diagram, so the
// column reads the same without one; e2e/mermaid.spec.ts draws them in a real
// browser.
vi.mock("vantage-md/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vantage-md/react")>()),
  MermaidDiagram: () => <div data-testid="mermaid-container" />,
}));

afterEach(cleanup);

interface Seen {
  id: string | null;
  state: "open" | "blocked" | "answered";
  line: number;
  unitLine: number;
  marker: string;
}

const lineOf = (el: Element | null | undefined): number =>
  Number(el?.getAttribute("data-source-line"));

/** What the contents column lists for `content`, rendered as the app renders it. */
function column(path: string, content: string): Seen[] {
  const { container } = render(
    <BrowserRouter>
      <MarkdownViewer content={content} currentPath={path} />
    </BrowserRouter>,
  );
  // The column's entries and the button pass's hosts are the same set in the
  // same document order, so the second gives each entry its anchor block.
  const hosts = answerableOpenQuestions(container);
  const entries = collectOutline(container).filter(
    (entry) => entry.kind === "question",
  );
  expect(entries).toHaveLength(hosts.length);

  const ids = new Set<string>();
  return entries.map((entry, index) => {
    const id = entry.id !== "" && !ids.has(entry.id) ? entry.id : null;
    if (id !== null) ids.add(id);
    const status = entry.status ?? "open";
    return {
      id,
      state: status === "settled" ? "answered" : status,
      line: lineOf(hosts[index]?.block),
      unitLine: lineOf(entry.element),
      marker: entry.marker,
    };
  });
}

/** What the planning index holds for the same source. */
function index(path: string, content: string): Seen[] {
  const result = scanPlanningDocument(path, content, false);
  if (result.kind !== "planning") return [];
  return result.document.questions.map(
    ({ id, state, line, unitLine, marker }) => ({
      id,
      state,
      line,
      unitLine,
      marker,
    }),
  );
}

const corpus = (
  readdirSync(repoPath("docs"), {
    recursive: true,
    encoding: "utf8",
  }) as string[]
)
  .filter((file) => file.endsWith(".md"))
  .map((file) => `docs/${file}`)
  .sort();

describe("the planning index and the contents column (§3.3)", () => {
  // This scans every document under docs/ in one test, and as the file's
  // first it also pays for warming the scanner up: about 0.6 s on an idle
  // machine, 1.5 to 2.2 s on CI's runners, and once 6.3 s on a loaded one,
  // where vitest's default 5 s timed it out with nothing wrong. Its cost grows
  // with docs/, so it has room of its own.
  it("has a corpus with questions in it to agree on", () => {
    // An empty corpus would agree trivially. The gallery alone holds ten, in
    // every host shape it demonstrates.
    const total = corpus.reduce(
      (sum, path) => sum + index(path, readRepoFile(path)).length,
      0,
    );
    expect(corpus.length).toBeGreaterThan(20);
    expect(total).toBeGreaterThan(10);
  }, 30_000);

  it.each(corpus)("agree on %s", (path) => {
    const content = readRepoFile(path);
    expect(index(path, content)).toEqual(column(path, content));
  });

  const fixtures: Record<string, string> = {
    "✅ in the body, 💬 on the title": [
      "1. \u{1F4AC} **OQ-1: Open, whatever the body says?**",
      "",
      '   <!-- vantage: oq id=OQ-1 leaning="Open." -->',
      "",
      "   _Leaning:_ open. An earlier draft was ✅, and that is history.",
      "",
      "1. ✅ **OQ-2: Answered?**",
      "",
      '   <!-- vantage: oq id=OQ-2 leaning="Yes." -->',
      "",
      "   _Leaning:_ yes.",
      "",
    ].join("\n"),
    "a bare paragraph": [
      "# Questions",
      "",
      '<!-- vantage: oq id=OQ-4 leaning="Plain." -->',
      "",
      "\u{1F512} A question written as a plain paragraph,",
      "on two lines.",
      "",
    ].join("\n"),
    "blockquote and heading hosts": [
      '<!-- vantage: oq id=OQ-5 leaning="Quote." -->',
      "",
      "> \u{1F4AC} A question in a quote.",
      ">",
      "> With a second paragraph.",
      "",
      '<!-- vantage: oq id=OQ-6 leaning="Heading." -->',
      "",
      "### ✅ A question as a heading",
      "",
      "Its body.",
      "",
      '<!-- vantage: oq id=OQ-9 leaning="Alert." -->',
      "",
      "> [!WARNING]",
      "> \u{1F512} A question in an alert.",
      "",
    ].join("\n"),
    "a nested list": [
      "- Outer item.",
      "",
      "  1. \u{1F4AC} 🤷 **OQ-N1: Nested one level?**",
      "",
      '     <!-- vantage: oq id=OQ-N1 leaning="Yes." -->',
      "",
      "     _Leaning:_ yes.",
      "",
      "     - \u{1F512} **OQ-N2: Nested two levels?**",
      "",
      '       <!-- vantage: oq id=OQ-N2 leaning="Still." -->',
      "",
      "       _Leaning:_ still.",
      "",
    ].join("\n"),
    "a title containing a link": [
      "1. \u{1F4AC} **OQ-L1: Does [the plan](../plans/x.md#OQ-9) settle it?**",
      "",
      '   <!-- vantage: oq id=OQ-L1 leaning="It does." -->',
      "",
      "   _Leaning:_ it does.",
      "",
    ].join("\n"),
    "a duplicate id, a malformed one and none": [
      "<!-- vantage: oq id=OQ-4 -->",
      "",
      "First.",
      "",
      "<!-- vantage: oq id=OQ-4 -->",
      "",
      "Repeated.",
      "",
      "<!-- vantage: oq id=OQ-nope -->",
      "",
      "Malformed.",
      "",
      "<!-- vantage: oq -->",
      "",
      "No id at all.",
      "",
    ].join("\n"),
    "a question in a footnote, whose unit is the footnote's <li>": [
      "Text with a note.[^1]",
      "",
      "[^1]: The note.",
      "",
      '    <!-- vantage: oq id=OQ-FN1 leaning="Later." -->',
      "",
      "    \u{1F512} **OQ-FN1: Written in a footnote?**",
      "",
    ].join("\n"),
    "a bold title on a heading": [
      '<!-- vantage: oq id=OQ-H2 leaning="Heading." -->',
      "",
      "### \u{1F4AC} **OQ-H2: A question as a bold heading?**",
      "",
    ].join("\n"),
    "frontmatter shifting every line": [
      "---",
      "status: in-review",
      "stage: DESIGN",
      "---",
      "",
      "1. \u{1F4AC} **OQ-F1: Lines are file lines?**",
      "",
      '   <!-- vantage: oq id=OQ-F1 leaning="Yes." -->',
      "",
      "   _Leaning:_ yes.",
      "",
    ].join("\n"),
  };

  it.each(Object.entries(fixtures))("agree on %s", (_, content) => {
    const questions = index("docs/fixture.md", content);
    expect(questions.length).toBeGreaterThan(0);
    expect(questions).toEqual(column("docs/fixture.md", content));
  });

  it("disagree only on a directive written inside a raw HTML block (Plan Q17)", () => {
    // Markdown sees the `<div>` and everything in it as one opaque html node,
    // so the index cannot see the paragraph the directive lands on, while
    // `rehype-raw` builds that paragraph and the plugin stamps it. The index
    // does not count it; the column shows what the page renders. Pinned here so
    // that a change on either side is a decision rather than a drift.
    const content = [
      "# Raw HTML",
      "",
      "<div>",
      '<!-- vantage: oq id=OQ-H1 leaning="Inside." -->',
      "<p>\u{1F4AC} <strong>OQ-H1: Written in HTML?</strong></p>",
      "</div>",
      "",
    ].join("\n");
    expect(index("docs/fixture.md", content)).toEqual([]);
    expect(column("docs/fixture.md", content)).toEqual(RAW_HTML_COLUMN);
  });
});

/**
 * What the column shows for the raw-HTML fixture, as measured: the question
 * `rehype-raw` built, with the line it gave the paragraph.
 */
const RAW_HTML_COLUMN: Seen[] = [
  { id: "OQ-H1", state: "open", line: 5, unitLine: 5, marker: "\u{1F4AC}" },
];
