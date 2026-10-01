/**
 * What a link shows about its target (`docs/reference/planning-index.md` §5.1 and
 * §5.2): one case per row of the badge table, and every way a link gets none.
 */
import { describe, expect, it } from "vitest";
import {
  badgeFor,
  badgeSpeech,
  badgeText,
  type PlanningBadge,
} from "vantage-md/planning";
import { indexOf } from "../test/planning";

/** A loose list of questions, one per marker, ids `OQ-1`, `OQ-2`, … */
function questions(...markers: string[]): string {
  return markers
    .map((marker, i) =>
      [
        `1. ${marker} **OQ-${i + 1}: Question ${i + 1}?**`,
        "",
        `   <!-- vantage: oq id=OQ-${i + 1} leaning="Yes." -->`,
        "",
        "   _Leaning:_ yes.",
        "",
      ].join("\n"),
    )
    .join("\n");
}

const TREE = {
  "roadmap.md": "# Roadmap\n",
  "docs/design/bootstrap.md": [
    "---",
    "status: in-review",
    "stage: DESIGN",
    "---",
    "",
    "# Bootstrap",
    "",
    questions("\u{1F4AC}", "\u{1F4AC}", "\u{1F512}", "✅"),
    "## Decision Ledger",
    "",
    "| OQ-B9 | Ruled long ago |",
    "",
  ].join("\n"),
  "docs/design/current.md": "---\nstatus: current\n---\n\n# Reference\n",
  "docs/design/orphan.md":
    '# Orphan\n\n<!-- vantage: oq id=OQ-1 leaning="x" -->\n\n- A list, not a host.\n',
  "docs/design/raw.md":
    "# Raw\n\n<div>\n<!-- vantage: oq id=OQ-8 -->\n<p>💬 <strong>OQ-8: Raw?</strong></p>\n</div>\n",
  "docs/design/answered.md": `# Settled\n\n${questions("✅", "✅")}`,
  "docs/design/typo.md": "---\nstatus: accepted\nstage: DECIEDD\n---\n",
  "docs/design/graduated.md": `---\nstatus: accepted\nstage: GRADUATED\n---\n\n${questions("\u{1F4AC}")}`,
  "docs/plain.md": "# Not planning at all\n",
};

const STAGES = {
  stages: {
    DESIGN: "open",
    DECIDED: "ready",
    GRADUATED: "done",
  } as const,
};

const badge = (
  path: string,
  fragment: string | null = null,
  from = "roadmap.md",
  config: Parameters<typeof indexOf>[1] = STAGES,
): PlanningBadge | null =>
  badgeFor(indexOf(TREE, config), from, { path, fragment });

describe("which links get a badge (§5.1)", () => {
  it("gives none to a link within a document", () => {
    expect(
      badge("docs/design/bootstrap.md", "OQ-1", "docs/design/bootstrap.md"),
    ).toBeNull();
  });

  it("gives none to a link to a document that is not a planning document", () => {
    expect(badge("docs/plain.md")).toBeNull();
    expect(badge("docs/missing.md")).toBeNull();
  });

  it.each([
    ["a status outside the four, and nothing else", "docs/design/current.md"],
    ["only an orphaned directive", "docs/design/orphan.md"],
    ["only answered questions", "docs/design/answered.md"],
  ])("gives none to a document with %s", (_, path) => {
    expect(badge(path)).toBeNull();
  });
});

describe("what a badge says (§5.2)", () => {
  it("shows a document's status, stage and open and blocked counts", () => {
    const b = badge("docs/design/bootstrap.md");
    expect(b).toEqual({
      kind: "document",
      path: "docs/design/bootstrap.md",
      status: "in-review",
      stage: "DESIGN",
      stageInVocabulary: true,
      open: 2,
      blocked: 1,
    });
    expect(b && badgeText(b)).toBe("in-review · DESIGN · 💬 2 · 🔒 1");
    expect(b && badgeSpeech(b)).toBe(
      "in review, design, 2 open questions, 1 blocked question",
    );
  });

  it("gives a heading link the document's badge", () => {
    expect(badge("docs/design/bootstrap.md", "decision-ledger")).toEqual(
      badge("docs/design/bootstrap.md"),
    );
  });

  it.each([
    ["OQ-1", "open", "💬 open", "open question"],
    ["OQ-3", "blocked", "🔒 blocked", "blocked question"],
    ["OQ-4", "answered", "✅ answered", "answered question"],
  ])("shows %s's state: %s", (id, state, text, speech) => {
    const b = badge("docs/design/bootstrap.md", id);
    expect(b).toEqual({
      kind: "question",
      path: "docs/design/bootstrap.md",
      id,
      state,
    });
    expect(b && badgeText(b)).toBe(text);
    expect(b && badgeSpeech(b)).toBe(speech);
  });

  it("calls an id with no directive, still in the text, ruled", () => {
    const b = badge("docs/design/bootstrap.md", "OQ-B9");
    expect(b).toEqual({
      kind: "ruled",
      path: "docs/design/bootstrap.md",
      id: "OQ-B9",
    });
    expect(b && badgeText(b)).toBe("✅ ruled");
  });

  // The directive is still there, so nothing compacted the question, but the
  // index holds no question for it (§3.3, Plan Q17). `✅ ruled` would tell the
  // reconciler (§3.5) to compact a question nobody ruled.
  it.each([
    ["an orphaned directive", "docs/design/orphan.md", "OQ-1"],
    ["a directive inside raw HTML", "docs/design/raw.md", "OQ-8"],
  ])(
    "calls an id whose directive is no question's not a question: %s",
    (_, path, id) => {
      const b = badge(path, id);
      expect(b).toEqual({ kind: "not-a-question", path, id });
      expect(b && badgeText(b)).toBe("⚠ not a question");
      expect(b && badgeSpeech(b)).toBe("not a question");
    },
  );

  it("calls an id found nowhere not found", () => {
    const b = badge("docs/design/bootstrap.md", "OQ-77");
    expect(b).toEqual({
      kind: "not-found",
      path: "docs/design/bootstrap.md",
      id: "OQ-77",
    });
    expect(b && badgeText(b)).toBe("⚠ not found");
  });

  it("leaves zero counts out", () => {
    const b = badge("docs/design/typo.md");
    expect(b).toMatchObject({ open: 0, blocked: 0 });
    expect(b && badgeText(b)).toBe("accepted · DECIEDD");
  });

  it("flags a stage outside the declared ones, and not without stages", () => {
    const flagged = badge("docs/design/typo.md");
    expect(flagged).toMatchObject({ stageInVocabulary: false });
    expect(flagged && badgeSpeech(flagged)).toBe(
      "accepted, deciedd, not a declared stage",
    );
    const undeclared = badge("docs/design/typo.md", null, "roadmap.md", {});
    expect(undeclared).toMatchObject({ stageInVocabulary: true });
  });

  it("still badges a document whose stage has the done role", () => {
    expect(badge("docs/design/graduated.md")).toMatchObject({
      kind: "document",
      stage: "GRADUATED",
      open: 1,
    });
    expect(badge("docs/design/graduated.md", "OQ-1")).toMatchObject({
      kind: "question",
      state: "open",
    });
  });

  it("reads a lone count in the singular", () => {
    const b = badge("docs/design/graduated.md");
    expect(b && badgeSpeech(b)).toBe("accepted, graduated, 1 open question");
  });
});
