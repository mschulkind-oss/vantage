import { describe, expect, it } from "vitest";
import { indexOf } from "../test/planning";
import { buildWorkHistory, type PlanningSnapshots } from "./workTransitions";

const source = (stage: string, extra = "") =>
  `---\nstage: ${stage}\n${extra}---\n`;
const pair = (
  path: string,
  before: string,
  after: string,
  commit: string,
  commitDate: string,
  exists = true,
): PlanningSnapshots["snapshots"][number] => ({
  path,
  commit_hexsha: commit,
  commit_date: commitDate,
  before,
  after,
  before_exists: true,
  after_exists: exists,
});
const snapshots = (
  entries: PlanningSnapshots["snapshots"],
): PlanningSnapshots => ({
  status: "complete",
  commits_examined: 4,
  truncated: false,
  snapshots: entries,
});

describe("buildWorkHistory", () => {
  it("uses current metadata as stage-entered evidence without inventing a prior stage", () => {
    const index = indexOf({
      "docs/current.md": source("DECIDED", "stage-since: 2026-03-01\n"),
    });
    const history = buildWorkHistory(
      index,
      snapshots([]),
      new Date("2026-03-02T00:00:00Z"),
    );
    expect(history.events).toMatchObject([
      {
        path: "docs/current.md",
        from: null,
        to: "DECIDED",
        source: "document-metadata",
        evidenceAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
  });

  it("does not emit malformed metadata or infer a prior stage", () => {
    const index = indexOf({
      "docs/invalid.md": source("DECIDED", "stage-since: 2026-02-30\n"),
      "docs/legacy.md": source("SKETCH"),
    });
    const history = buildWorkHistory(
      index,
      snapshots([]),
      new Date("2026-03-02T00:00:00Z"),
    );
    expect(history.events).toEqual([]);
  });

  it("compares exact stages, ignores ordinary edits and keeps one newest event per path", () => {
    const index = indexOf({ "docs/current.md": source("DECIDED") });
    const history = buildWorkHistory(
      index,
      snapshots([
        pair(
          "docs/current.md",
          source("SKETCH"),
          source("DECIDED"),
          "new",
          "2026-03-01T00:00:00Z",
        ),
        pair(
          "docs/current.md",
          source("SKETCH"),
          source("SKETCH", "next: changed\n"),
          "edit",
          "2026-02-28T00:00:00Z",
        ),
        pair(
          "docs/current.md",
          source("DRAFT"),
          source("SKETCH"),
          "old",
          "2026-02-27T00:00:00Z",
        ),
      ]),
      new Date("2026-03-02T00:00:00Z"),
    );
    expect(history.events).toHaveLength(1);
    expect(history.events[0]).toMatchObject({
      from: "SKETCH",
      to: "DECIDED",
      commit: "new",
    });
  });

  it("detects an explicit stage claim appearing or disappearing on a planning document", () => {
    const noStage = "---\nstatus: draft\n---\n";
    const index = indexOf({
      "docs/added.md": source("DECIDED"),
      "docs/removed.md": noStage,
    });
    const history = buildWorkHistory(
      index,
      snapshots([
        pair(
          "docs/added.md",
          noStage,
          source("DECIDED"),
          "added-stage",
          "2026-03-01T00:00:00Z",
        ),
        pair(
          "docs/removed.md",
          source("SKETCH"),
          noStage,
          "removed-stage",
          "2026-02-28T00:00:00Z",
        ),
      ]),
      new Date("2026-03-02T00:00:00Z"),
    );
    expect(history.events).toMatchObject([
      { from: null, to: "DECIDED", commit: "added-stage" },
      { from: "SKETCH", to: "No saved stage", commit: "removed-stage" },
    ]);
  });

  it("ignores Git snapshots for paths excluded by the current planning config", () => {
    const index = indexOf({}, { exclude: ["docs/excluded.md"] });
    const history = buildWorkHistory(
      index,
      snapshots([
        pair(
          "docs/excluded.md",
          source("SKETCH"),
          source("DECIDED"),
          "excluded",
          "2026-03-01T00:00:00Z",
        ),
        pair(
          "docs/included.md",
          source("SKETCH"),
          source("DECIDED"),
          "included",
          "2026-03-01T00:00:00Z",
        ),
      ]),
      new Date("2026-03-02T00:00:00Z"),
    );
    expect(history.events.map(({ path }) => path)).toEqual([
      "docs/included.md",
    ]);
  });

  it("reports a proven deletion without treating it as success", () => {
    const history = buildWorkHistory(
      indexOf({}),
      snapshots([
        pair(
          "docs/gone.md",
          source("DESIGN"),
          "",
          "delete",
          "2026-03-01T00:00:00Z",
          false,
        ),
      ]),
      new Date("2026-03-02T00:00:00Z"),
    );
    expect(history.events[0]).toMatchObject({
      from: "DESIGN",
      to: "Deleted",
      source: "git",
    });
  });

  it("keeps current metadata authoritative and discloses a conflicting Git stage", () => {
    const index = indexOf({
      "docs/current.md": source("DECIDED", "stage-since: 2026-03-01\n"),
    });
    const history = buildWorkHistory(
      index,
      snapshots([
        pair(
          "docs/current.md",
          source("SKETCH"),
          source("BUILT"),
          "conflict",
          "2026-03-01T01:00:00Z",
        ),
      ]),
      new Date("2026-03-02T00:00:00Z"),
    );
    expect(history.events).toMatchObject([
      { to: "BUILT", source: "git", conflict: true },
      { from: null, to: "DECIDED", source: "document-metadata" },
    ]);
  });

  it("uses one rolling 168-hour interval with inclusive endpoints and excludes future evidence", () => {
    const now = new Date("2026-03-08T12:00:00Z");
    const index = indexOf({
      "docs/at-start.md": source(
        "DECIDED",
        "stage-since: 2026-03-01T12:00:00Z\n",
      ),
      "docs/at-end.md": source(
        "DECIDED",
        "stage-since: 2026-03-08T12:00:00Z\n",
      ),
      "docs/future.md": source(
        "DECIDED",
        "stage-since: 2026-03-08T12:00:01Z\n",
      ),
      "docs/outside.md": source(
        "DECIDED",
        "stage-since: 2026-03-01T11:59:59Z\n",
      ),
      "docs/offset.md": source(
        "DECIDED",
        'stage-since: "2026-03-08T17:30:00+05:30"\n',
      ),
    });
    const history = buildWorkHistory(index, snapshots([]), now);
    expect(history.events.map(({ path }) => path)).toEqual([
      "docs/at-end.md",
      "docs/offset.md",
      "docs/at-start.md",
    ]);
  });

  it("sorts same-instant events by path and source deterministically", () => {
    const index = indexOf({
      "z/doc.md": source("DECIDED", "stage-since: 2026-03-01T00:00:00Z\n"),
      "a/doc.md": source("DECIDED", "stage-since: 2026-03-01T00:00:00Z\n"),
    });
    const history = buildWorkHistory(
      index,
      snapshots([]),
      new Date("2026-03-02T00:00:00Z"),
    );
    expect(history.events.map(({ path }) => path)).toEqual([
      "a/doc.md",
      "z/doc.md",
    ]);
  });
});
