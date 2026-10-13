import { describe, expect, it } from "vitest";
import { deriveWorkBoard, filterWorkDocuments } from "vantage-md/planning";
import { indexOf } from "../test/planning";

const staged = (stage?: string, next?: string) =>
  `---\n${stage === undefined ? "status: draft\n" : `stage: ${stage}\n`}${next === undefined ? "" : `next: ${JSON.stringify(next)}\n`}---\n`;

const configured = {
  stages: {
    SKETCH: "open",
    DESIGN: "open",
    DECIDED: "ready",
    BUILT: "built",
    SUPERSEDED: "done",
  } as const,
};

describe("deriveWorkBoard", () => {
  it("groups every document by role, exact stage and path deterministically", () => {
    const index = indexOf(
      {
        "z/design.md": staged("DESIGN"),
        "a/design.md": staged("DESIGN"),
        "sketch.md": staged("SKETCH"),
        "built.md": staged("BUILT"),
        "ready.md": staged("DECIDED"),
        "terminal.md": staged("SUPERSEDED"),
        "missing.md": staged(),
        "unknown.md": staged("MYSTERY"),
      },
      configured,
    );
    const board = deriveWorkBoard(index);
    expect(board.roles.map((group) => group.role)).toEqual([
      "open",
      "ready",
      "built",
    ]);
    expect(board.roles[0]?.stages.map(({ stage }) => stage)).toEqual([
      "DESIGN",
      "SKETCH",
    ]);
    expect(
      board.roles[0]?.stages[0]?.documents.map(({ path }) => path),
    ).toEqual(["a/design.md", "z/design.md"]);
    expect(board.roles[1]?.stages.map(({ stage }) => stage)).toEqual([
      "DECIDED",
    ]);
    expect(board.roles[2]?.stages.map(({ stage }) => stage)).toEqual(["BUILT"]);
    expect(board.terminal.map(({ path }) => path)).toEqual(["terminal.md"]);
    expect(board.missingStage.map(({ path }) => path)).toEqual(["missing.md"]);
    expect(board.unmapped).toMatchObject([
      { stage: "MYSTERY", documents: [{ path: "unknown.md" }] },
    ]);
    const visible = [
      ...board.roles.flatMap((group) =>
        group.stages.flatMap((stage) => stage.documents),
      ),
      ...board.terminal,
      ...board.missingStage,
      ...board.unmapped.flatMap((stage) => stage.documents),
    ];
    expect(visible.map(({ path }) => path).sort()).toEqual(
      index.documents.map(({ path }) => path).sort(),
    );
    expect(new Set(visible.map(({ path }) => path)).size).toBe(
      index.documents.length,
    );
  });

  it("keeps saved stages visible as unmapped without a configured vocabulary", () => {
    const board = deriveWorkBoard(
      indexOf({ "one.md": staged("CUSTOM"), "missing.md": staged() }),
    );
    expect(board.stagesDeclared).toBe(false);
    expect(board.unmapped).toMatchObject([
      { stage: "CUSTOM", documents: [{ path: "one.md" }] },
    ]);
    expect(board.missingStage.map(({ path }) => path)).toEqual(["missing.md"]);
    expect(board.roles).toEqual([]);
  });

  it("filters only paths, stages and next-step text", () => {
    const docs = indexOf({
      "docs/alpha.md": staged("DESIGN", "Review the parser"),
      "docs/beta.md": staged("BUILT", "No related step"),
    }).documents;
    expect(filterWorkDocuments(docs, "parser").map(({ path }) => path)).toEqual(
      ["docs/alpha.md"],
    );
    expect(filterWorkDocuments(docs, "built").map(({ path }) => path)).toEqual([
      "docs/beta.md",
    ]);
    expect(filterWorkDocuments(docs, "question title")).toEqual([]);
  });
});
