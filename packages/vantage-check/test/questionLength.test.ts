import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../../vantage-md/src/frontmatter.js";
import {
  scanPlanningDocument,
  type PlanningQuestion,
} from "../../vantage-md/src/planning/index.js";
import { parseMarkdown } from "../src/core/document.js";
import {
  QUESTION_WORDS_DEFAULT,
  questionWords,
} from "../src/rules/questionLength.js";

/**
 * The measure `planning/question-length` applies: the words of a question's
 * text as its card shows them, leaning and Answer aside. Each question comes
 * from the planning scan, as the rule's do, so these also hold the lookup of
 * a question's unit to the lines the scan gives it.
 */

/** Every question the scan finds in `source`, each with its word count. */
function measured(
  source: string,
): { id: string | null; words: number | null }[] {
  const result = scanPlanningDocument("docs/q.md", source, false);
  if (result.kind !== "planning") throw new Error("not a planning document");
  const { body, bodyLineOffset } = parseFrontmatter(source);
  const root = parseMarkdown(body);
  return result.document.questions.map((question: PlanningQuestion) => ({
    id: question.id,
    words: questionWords(root, question, bodyLineOffset),
  }));
}

/** The one question in `source`'s word count. */
function wordsOf(source: string): number | null {
  const all = measured(source);
  expect(all).toHaveLength(1);
  return all[0]?.words ?? null;
}

/**
 * A leaning paragraph for the directive above it to land on: a directive with
 * no block after it is an orphan, and no question at all.
 */
const LEANING = "   _Leaning:_ the last.\n";

/** The convention's empty Answer, as a list item writes it. */
const ANSWER = "   **Answer:**\n\n   > _(empty — fill in when decided)_\n";

describe("questionWords", () => {
  it("counts the title and the text below it, and not the marker", () => {
    // 💬 is no word; "OQ-1: Which one wins?" is four, and the rest six.
    const source = [
      "1. \u{1F4AC} **OQ-1: Which one wins?** The first or the last one.",
      "",
      '   <!-- vantage: oq id=OQ-1 leaning="The last." -->',
      "",
      LEANING,
    ].join("\n");

    expect(wordsOf(source)).toBe(10);
  });

  it("leaves out the leaning paragraph, in each way it is written", () => {
    for (const marker of [
      "_Leaning:_",
      "**Leaning:**",
      "Leaning:",
      // A note before the colon, and a dash in its place, as real documents
      // write them; the card reads both as its leaning block too.
      "_Leaning (revised 2026-09-04, as filed):_",
      "**Leaning (as filed):**",
      "_Leaning_ —",
      "Leaning \u2013",
    ]) {
      const source = [
        "1. \u{1F4AC} **OQ-1: Which one wins?**",
        "",
        '   <!-- vantage: oq id=OQ-1 leaning="The last." -->',
        "",
        `   ${marker} the last, because it was written last and nothing else says so.`,
        "",
      ].join("\n");

      expect(wordsOf(source)).toBe(4);
    }
  });

  it("leaves out the Answer placeholder, and a ruling written in its place", () => {
    const question = [
      "1. \u{1F4AC} **OQ-1: Which one wins?**",
      "",
      '   <!-- vantage: oq id=OQ-1 leaning="The last." -->',
      "",
      "   _Leaning:_ the last.",
      "",
      "",
    ].join("\n");

    expect(wordsOf(`${question}${ANSWER}`)).toBe(4);
    expect(
      wordsOf(
        `${question}   **Answer:**\n\n   > The last, ruled 2026-09-30, for the reasons the leaning gives and two more.\n\n   Written after the ruling, and part of it.\n`,
      ),
    ).toBe(4);
  });

  it("counts the context between the title and the leaning, in every block", () => {
    const source = [
      "1. \u{1F4AC} **OQ-1: Which one wins?**",
      "",
      "   One two three.",
      "",
      "   - Four five.",
      "   - Six.",
      "",
      '   <!-- vantage: oq id=OQ-1 leaning="The last." -->',
      "",
      "   _Leaning:_ the last.",
      "",
      ANSWER,
    ].join("\n");

    expect(wordsOf(source)).toBe(10);
  });

  it("counts a link by its label and a code span as one word", () => {
    const source = [
      "1. \u{1F4AC} **OQ-1: Which one wins?** See",
      "   [the long section on precedence](https://example.com/a/very/long/path#and-an-anchor)",
      "   and `packages/vantage-check/src/rules/questionLength.ts` — twice.",
      "",
      '   <!-- vantage: oq id=OQ-1 leaning="The last." -->',
      "",
      LEANING,
    ].join("\n");

    // 4 + See + 5 + and + 1 + twice; the dash is no word.
    expect(wordsOf(source)).toBe(13);
  });

  it("measures each question in a list by its own item", () => {
    const item = (n: number, text: string) =>
      [
        `${n}. \u{1F4AC} **OQ-${n}: Question ${n}?** ${text}`,
        "",
        `   <!-- vantage: oq id=OQ-${n} leaning="Yes." -->`,
        "",
        "   _Leaning:_ yes.",
        "",
      ].join("\n");
    const source = [item(1, "a b c"), item(2, "a"), item(3, "")].join("\n");

    expect(measured(source)).toEqual([
      { id: "OQ-1", words: 6 },
      { id: "OQ-2", words: 4 },
      { id: "OQ-3", words: 3 },
    ]);
  });

  it("measures a question on a bare paragraph by that paragraph alone", () => {
    const source = [
      "---",
      "status: draft",
      "---",
      "",
      "# Title",
      "",
      '<!-- vantage: oq id=OQ-4 leaning="A paragraph." -->',
      "",
      "A question written as a plain paragraph, five more words here.",
      "",
      "A second paragraph, which is not part of the question.",
      "",
    ].join("\n");

    expect(wordsOf(source)).toBe(11);
  });

  it("measures a question in a blockquote by the quote, leaning aside", () => {
    const source = [
      '<!-- vantage: oq id=OQ-5 leaning="The quote." -->',
      "",
      "> A question written as a blockquote.",
      ">",
      "> _Leaning:_ the quote, which is the plainest host after a paragraph.",
      "",
    ].join("\n");

    expect(wordsOf(source)).toBe(6);
  });

  it("finds a question's unit below frontmatter of any length", () => {
    const header = [
      "---",
      "status: draft",
      "stage: DESIGN",
      "tags: [a, b]",
      "---",
      "",
    ];
    const source = [
      ...header,
      "# Title",
      "",
      "1. \u{1F4AC} **OQ-1: Which one wins?** One two.",
      "",
      '   <!-- vantage: oq id=OQ-1 leaning="The last." -->',
      "",
      LEANING,
    ].join("\n");

    expect(wordsOf(source)).toBe(6);
  });

  it("does not take prose that mentions a leaning for one", () => {
    const source = [
      "1. \u{1F4AC} **OQ-1: Which one wins?**",
      "",
      "   Leaning towards the last would be premature, five words.",
      "",
      '   <!-- vantage: oq id=OQ-1 leaning="The last." -->',
      "",
      LEANING,
    ].join("\n");

    expect(wordsOf(source)).toBe(13);
  });

  it("is null for lines no unit spans", () => {
    const root = parseMarkdown("# Title\n\nText.\n");

    expect(questionWords(root, { unitLine: 40, unitEndLine: 41 }, 0)).toBe(
      null,
    );
  });

  it("defaults to the calibrated limit", () => {
    expect(QUESTION_WORDS_DEFAULT).toBe(120);
  });
});

/**
 * Two of this repository's own questions, verbatim, either side of the limit
 * (the calibration in `rules/questionLength.ts` measured both): `OQ-CT6` in
 * `docs/design/color-themes.md`, a paragraph of background and a trust
 * argument before its leaning, and `inline-markup.md`'s `OQ-6` as last
 * written, before it was ruled, which is as dense but shorter.
 */
describe("questionWords on real questions", () => {
  const OQ_CT6 = [
    "1. \u{1F4AC} **OQ-CT6: May a repository ship theme _files_, not just name one?**",
    "   [§2.5](#25-a-repository-may-offer-a-default) lets a repository name a theme,",
    "   which means the palette it wants must already be in the reader's themes folder",
    "   or in the bundle — so the case that motivates the key at all, a project whose",
    "   diagrams and screenshots are drawn in its own palette, is the one it cannot",
    "   serve. Serving a stylesheet committed in the repository would close that — from",
    "   a folder the key names, since `.vantage/` is transient state a repository is",
    "   told to gitignore — and it moves the trust boundary: every stylesheet Vantage",
    "   serves today is one the reader wrote in their own config directory, which is",
    "   the whole of why [§8](#8-risks) notes that hazard rather than mitigating it. A",
    "   CSS file can fetch remote fonts and images, so a themed `git clone` would reach",
    "   the network on first paint, from the reader's address, with nothing on the page",
    "   that looks like a request. What this decides is whether a repository's palette",
    "   is a suggestion the reader already holds or a file of the repository's that the",
    "   reader's browser fetches on its behalf.",
    "",
    '   <!-- vantage: oq id=OQ-CT6 leaning="Read and list a repository\'s theme files, but do not apply one until the reader has accepted it once for that repository." -->',
    "",
    "   _Leaning:_ the mechanism yes, unasked no. List a repository's theme files and",
    "   apply one only once the reader has accepted it for that repository — the shape",
    "   `allowed_read_roots` already uses, where what a repository's files may reach is",
    "   something the reader granted rather than something the repository declared.",
    "",
    "   **Answer:**",
    "",
  ].join("\n");

  const OQ_6 = [
    "1. \u{1F4AC} **OQ-6: `packages/vantage-md` is outside the quality gate, and the",
    "   frontend's type-check is a no-op.** The package this feature's core lives in",
    "   is never prettier-checked and never eslint-checked: `just format` covers",
    "   `frontend` and `packages/vantage-check` only, and `check-ci`",
    "   ([`Justfile:74-75`](../../Justfile#L74-L75)) runs `format:check` and `lint` in",
    "   those two packages, neither of which `packages/vantage-md/package.json`",
    "   defines — four files there fail prettier today. Worse, the frontend's",
    "   `npx tsc --noEmit` resolves",
    "   [`frontend/tsconfig.json`](../../frontend/tsconfig.json), which is a solution",
    '   file (`"files": []` plus project references) — measured with `--listFiles`, it',
    "   type-checks **zero files**. The package's own `npm run typecheck` is never",
    "   invoked by the gate either.",
    "",
    '   <!-- vantage: oq id=OQ-6 leaning="Fix both, in one change." -->',
    "",
    "   _Leaning:_ Fix both, in one change: give `vantage-md` `format`/`format:check`/`lint`",
    "   scripts and add it to the three loops it is missing from, and point the",
    "   frontend's gate at `tsconfig.app.json` (or use `tsc --build`).",
    "",
    "   **Answer:**",
    "   > _(empty — fill in when decided)_",
    "",
  ].join("\n");

  it("measures OQ-CT6 past the limit, as the calibration did", () => {
    const words = wordsOf(OQ_CT6);
    expect(words).toBe(189);
    expect(words!).toBeGreaterThan(QUESTION_WORDS_DEFAULT);
  });

  it("measures inline-markup's OQ-6 inside it, as the calibration did", () => {
    const words = wordsOf(OQ_6);
    expect(words).toBe(93);
    expect(words!).toBeLessThanOrEqual(QUESTION_WORDS_DEFAULT);
  });
});
