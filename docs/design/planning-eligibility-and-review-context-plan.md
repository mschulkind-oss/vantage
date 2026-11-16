---
title: "Planning actions opt-out and 0.12.0 release notes — implementation plan"
date: 2026-11-16
status: accepted
stage: DECIDED
next: "Build Task 1 (scan, eligibility gates, cache schema), then Tasks 2–4, then prepare 0.12.0 in Task 5; never run the release"
tags: [planning, plan, scanner, vantage-check, release]
depends-on:
  - planning-eligibility-and-review-context.md
---

# Planning actions opt-out and 0.12.0 release notes — implementation plan

**Status:** 2026-11-16. Completed against the tree, written against `545c88b5`. Seeded by the design work; no seed existed, so nothing here is inherited.
**Design:** [`planning-eligibility-and-review-context.md`](planning-eligibility-and-review-context.md), rulings [OQ-ER1 and OQ-ER2](planning-eligibility-and-review-context.md#decision-ledger) (both ruled, not reopened).
**Findings:** [`docs/research/planning-action-eligibility.md`](../research/planning-action-eligibility.md) holds the tree reading this plan stands on, and the reproduction of the gap.

Precedence: the design wins on behavior, the tree wins on fact (cosmetic drift only), and this file is advice and the first thing to be wrong. Never twist the code to match the plan. **Stop and report, and do not commit,** when: a red test does not fail the way its task says; a file a task names is dirty with someone else's work; a symbol it names is gone; the fix needs a file outside the task's fence; or a gate fails outside the task's scope.

## Settled behavior — do not re-open

Quoted from the design so the implementer need not read it.

- **Key:** top-level frontmatter `planning-actions`, values `all` (the default) or `none`. Words, not booleans.
- **`none` removes a document from exactly three things:** the Ready list, the graduation list and the offer to compact answered questions. Nothing else changes: questions, counts, handoff routing, badges, stage, the Stage conflict list, dependency waiting, routing and `planning/unrouted`.
- **Missing or `all`:** identical to today. **Any other value, or a non-string:** treated as `all`, with a diagnostic, so the document stays listed. **Malformed frontmatter:** unreadable, as today.
- **The key alone does not make a contributor.** A document with no `status`, no `stage` and no question stays out of the index.
- **On a done-role stage the value is inert, and redundant, with no diagnostic.** **On the configured roadmap the key is inert, with a diagnostic.** A roadmap that links an opted-out document cannot override its key.
- **No genre inference and no UI toggle.** Filters cannot bring an opted-out document back.
- **Older viewers and checkers ignore the key** and show today's lists; defaults, schema and invocations stay compatible.
- **Why it is missing is shown on existing surfaces only,** and never by moving anything: status updates are immediate at fixed height, moving cards wait for explicit Apply.
- **Retained policy, [OQ-ER2](planning-eligibility-and-review-context.md#decision-ledger):** no live CLI, export or receipts. `index` keeps printing its existing "open in Markdown" note and the style guide keeps its rule. This build touches none of it.
- **Unchanged and out of scope:** `CapturedBlock` recapture, Title glide and reduced motion, immediate fixed-height live status against explicit list movement, and `planning/question-length` off by default.

## Map

| Path | Change |
| :--- | :--- |
| `packages/vantage-md/src/planning/scan.ts` | `PlanningDocument.planningActions?: "none"`; `HeaderProblem` key and `HEADER_KEYS` gain `planning-actions`; `readHeader` reads it; `scanPlanningDocument` passes `isRoadmap` (~`:1291`, `:1453`) |
| `packages/vantage-md/src/planning/sections.ts` | `derivePlanningSections` leaves opted-out documents out of `ready` and `graduate` (~`:993-998`) |
| `packages/vantage-md/src/planning/guide.ts` | `answeredQuestions` skips opted-out documents (~`:241`) |
| `frontend/src/planningScan/cache.ts` | `SCAN_CACHE_SCHEMA` 3 → 4, with its comment line (~`:45`) |
| `packages/vantage-check/src/rules/planning.ts` | `PLANNING_RULES`, the rule's method, `mayFire`, the "six rules" comment (~`:73`, `:279`, `:338`, `:345`) |
| `packages/vantage-check/src/rules/registry.ts` | register `planning/actions-value` (~`:295`) |
| `frontend/src/pages/WorkPage.tsx` | one line in a card's disclosure (~`:291`, inside `renderCard`) |
| `packages/vantage-md/src/styleGuide.ts` | one bullet in the planning frontmatter section (~`:111`) |
| `docs/reference/planning-index.md`, `userguide/guides/planning.md`, `userguide/guides/vantage-check.md`, `docs/reference/work-overview.md` | the behavior, see Task 4 |
| `CHANGELOG.md` | Task 5 |
| `roadmap.md`, the design and this plan | state and routing, see Task 4 |
| `frontend/src/lib/planningActions.test.ts`, `packages/vantage-check/test/planningActions.test.ts`, `packages/vantage-check/test/planningActionsRule.test.ts` | new, pasted from this plan |
| `frontend/src/pages/PlanningPage.test.tsx`, `frontend/src/pages/WorkPage.test.tsx` | one new `describe` each, appended |
| `frontend/src/planningScan/cache.test.ts`, `packages/vantage-check/test/planning.test.ts` | one assertion rewritten each |

No file under `internal/`, `web/`, `frontend/e2e/` or any manifest changes. The Go stream hashes and serves text; it never reads frontmatter.

## Reuse before you write

- **Do not write a Ready predicate anywhere else.** Every consumer reads `derivePlanningSections` (page via `sectionsOf` in `frontend/src/lib/planningPages.ts`, `index` text and JSON, `--request`, the filter, which only narrows its arrays) or `answeredQuestions` (the page's `compactEntries` and `listedQuestions`, `planningRequestCount`, the request's `compact` block). One gate in each reaches every path. A second copy would let the page and the gate disagree (P7).
- **Mirror `stageSince`** (`scan.ts:244`) for the field: optional, present only when set. It is also why no existing fixture needs the field.
- **Mirror `dependsOnMissing` and `stageVocabulary`** (`rules/planning.ts`) for the rule: they report `doc.headerProblems` filtered by `key`, through the `report` closure, and are called from the same loop (~`:279`).
- **`describe(value)`** in `scan.ts` (~`:1155`) words a non-string value for the message.
- **Test helpers:** `indexOf`, `questionDirective` in `frontend/src/test/planning.ts`; `makeTree` in `packages/vantage-check/test/helpers.ts`; `doc`, `questions`, `STAGES_TOML`, `ANSWERED`, `OPEN` in `packages/vantage-check/test/planningTree.ts`; `seed`, `renderPage`, `documentsIn`, `listedIn`, `cardsIn` in `PlanningPage.test.tsx`, which serves its tree through the real inline scanner client; `seedIndex`, `renderWork`, `frontmatter` in `WorkPage.test.tsx`.

## House style that isn't obvious

- **Formatting is prettier per package;** run `just format` before every commit. The pre-commit hook runs `just check-fast`, which picks checks from the staged paths; it is not the gate, and `just done` is.
- **Markdown edits run the checker over `docs/`, `userguide/` and the READMEs.** Run `just cli`, then `packages/vantage-check/dist/vantage-check <file>` per edited document before committing, and read `packages/vantage-check/dist/vantage-check style-guide` once before writing.
- **A bare `OQ-` id in prose must be a link,** or `check` fails the document. Link ruled ones to the design's `#decision-ledger`.

## Traps

- **`isLive` is not the place.** It also gates routing, the unrouted check, dependency waiting and the filter's recounts (`sections.ts:656` and its seven callers). Gating there would hide the opt-out document's questions. **Constraint.**
- **Omit the property; do not set it to `undefined`.** The scan result is `structuredClone`d into the browser cache and printed as JSON; a present-but-undefined key fails `not.toHaveProperty` and breaks byte-for-byte compatibility with unkeyed trees.
- **`mayFire` (`rules/planning.ts:345`) decides before parsing** whether any rule could report. Without a `has("planning-actions")` clause for the new rule, a document whose only planning key is the bad one is never read, and the diagnostic silently never fires.
- **The roadmap is known to `scanPlanningDocument`, not to `readHeader`.** The scan result is the same in the checker's narrow index, the CLI and the browser worker, so deciding it there keeps all three equal. The browser cache never stores a roadmap.
- **The scan cache already invalidates on its own:** the scanner id hashes every file under `packages/vantage-md/src/` ([findings §4](../research/planning-action-eligibility.md#4-persisted-shapes)). The schema bump is for the documented contract, not the only line of defense. A test pins the old number and must be rewritten.
- **A test hit on the whole page output** (`stdout.not.toContain("opted-ready.md")`) breaks if the fixture's file names collide. Fixture names here are distinct on purpose; keep them.
- **Do not add a document to `frontend/e2e/fixtures/test_repo/`.** Many specs count its documents by name.
- **The style guide is the printed contract.** A viewer that predates a notation reads it differently, which `just compat-previous` checks against the previous release; it needs the network.

## Tasks

Order: **1 → 2 → 3 → 4 → 5.** Each is one commit on the current branch, and each leaves the gate it names green. Tasks 2 and 3 touch disjoint files from each other and could land in either order, but both need Task 1. Task 5 needs 4, because its notes describe what Task 4 documents. Land late, Task 5 costs a rewrite of the notes; land early it describes a feature that is not built.

### Task 1 — scan, eligibility gates, cache schema (after nothing)

- **Settled:** see the section above. Exact reading rules, which are cheap choices already made here: the value is trimmed, then compared exactly and case-sensitively, so `None` is invalid; an empty value (`planning-actions:`) and any non-string are invalid; only `none` sets the field; `all` and invalid values leave it off; on the roadmap the field is never set and one problem is reported whatever the value; the message for an invalid value reads like `` `planning-actions` must be `all` or `none`, and this one is `maybe`, so it is read as `all` and the document stays in the action lists. `` and the roadmap's names the roadmap and says the key does nothing there.
- **Preconditions:** `git status --short` shows only the files this plan's commit left (nothing dirty); `git rev-parse --short HEAD` is at or after `545c88b5`; `rg -n "planning-actions" packages frontend/src` finds only tests you are about to add. Otherwise stop.
- **Tests first** (paste, run, see red, then change). Format with the package's prettier, so run `npx prettier --write` on each new file. Use the three new files and the two excerpts below.
  1. `frontend/src/lib/planningActions.test.ts` (new):

```ts
/**
 * `planning-actions` (`docs/design/planning-eligibility-and-review-context.md`
 * §2.2, §2.4): the scan reads it, and the shared derivations the page, the CLI
 * and the checker all read leave an opted-out document out of Ready, graduation
 * and the compaction offer, and out of nothing else.
 */
import { describe, expect, it } from "vitest";
import {
  answeredQuestions,
  derivePlanningSections,
  planningRequestCount,
  scanPlanningDocument,
  waitingDependsOn,
  type PlanningConfig,
} from "vantage-md/planning";
import { compactEntries, sectionsOf } from "./planningPages";
import { indexOf, questionDirective } from "../test/planning";

const STAGES: PlanningConfig["stages"] = {
  DESIGN: "open",
  DECIDED: "ready",
  BUILT: "built",
  GONE: "done",
};
const OPEN = "\u{1F4AC}";
const ANSWERED = "✅";

const question = (id: string, marker: string) =>
  [
    `1. ${marker} **${id}: Question ${id}?**`,
    "",
    `   ${questionDirective(marker, id, "Yes.")}`,
    "",
    "   _Leaning:_ yes.",
    "",
  ].join("\n");

const doc = (header: string, body = "") =>
  `---\n${header}\n---\n\n# Title\n\n${body}\n`;

const scan = (source: string, isRoadmap = false) =>
  scanPlanningDocument("docs/x.md", source, isRoadmap);

describe("reading planning-actions", () => {
  it("reads none as an opt-out and says nothing", () => {
    const result = scan(doc("stage: DECIDED\nplanning-actions: none"));
    expect(result).toMatchObject({
      kind: "planning",
      document: { planningActions: "none", headerProblems: [] },
    });
  });

  it.each([
    ["is missing", "stage: DECIDED"],
    ["is all", "stage: DECIDED\nplanning-actions: all"],
  ])("leaves the field off when the key %s", (_, header) => {
    const result = scan(doc(header));
    expect(result.kind === "planning" && result.document).not.toHaveProperty(
      "planningActions",
    );
    expect(result).toMatchObject({ document: { headerProblems: [] } });
  });

  it.each([
    ["a word that is neither", "planning-actions: maybe"],
    ["the wrong case", "planning-actions: None"],
    ["a boolean", "planning-actions: false"],
    ["a number", "planning-actions: 0"],
    ["a list", "planning-actions: [none]"],
    ["empty", "planning-actions:"],
  ])("treats %s as all and reports it at the key", (_, line) => {
    const result = scan(doc(`stage: DECIDED\n${line}`));
    expect(result.kind === "planning" && result.document).not.toHaveProperty(
      "planningActions",
    );
    expect(result).toMatchObject({
      document: {
        headerProblems: [
          expect.objectContaining({ key: "planning-actions", line: 3 }),
        ],
      },
    });
  });

  it("reads a TOML header the same way", () => {
    const result = scan(
      '+++\nstage = "DECIDED"\nplanning-actions = "none"\n+++\n',
    );
    expect(result).toMatchObject({
      document: { planningActions: "none", headerProblems: [] },
    });
  });

  it("does not let the key alone make a document a contributor", () => {
    expect(
      scan("---\nplanning-actions: none\n---\n\n# Only the key\n"),
    ).toEqual({
      kind: "not-planning",
    });
  });

  it("leaves a malformed header unreadable, key or no key", () => {
    expect(scan("---\nplanning-actions: none\nstage: [\n---\n").kind).toBe(
      "unreadable",
    );
  });

  it("is inert on the roadmap, and says so at the key", () => {
    const result = scan(doc("stage: DECIDED\nplanning-actions: none"), true);
    expect(result.kind === "planning" && result.document).not.toHaveProperty(
      "planningActions",
    );
    expect(result).toMatchObject({
      document: {
        headerProblems: [
          expect.objectContaining({ key: "planning-actions", line: 3 }),
        ],
      },
    });
  });
});

describe("what planning-actions: none leaves out", () => {
  const NONE = "planning-actions: none";
  const tree: Record<string, string> = {
    "listed-ready.md": doc("stage: DECIDED"),
    "opted-ready.md": doc(`stage: DECIDED\n${NONE}`),
    "listed-built.md": doc("stage: BUILT"),
    "opted-built.md": doc(`stage: BUILT\n${NONE}`),
    "listed-answered.md": doc("stage: DESIGN", question("OQ-L1", ANSWERED)),
    "opted-answered.md": doc(
      `stage: DESIGN\n${NONE}`,
      question("OQ-O1", ANSWERED),
    ),
    "opted-open.md": doc(`stage: DECIDED\n${NONE}`, question("OQ-Z1", OPEN)),
    "waits.md": doc("stage: DECIDED\ndepends-on:\n  - opted-open.md"),
  };
  const index = indexOf(tree, { stages: STAGES });

  it("keeps Ready and graduation to the documents that did not opt out", () => {
    const sections = derivePlanningSections(index);
    expect(sections.ready).toEqual(["listed-ready.md", "waits.md"]);
    expect(sections.graduate).toEqual(["listed-built.md"]);
  });

  it("keeps the opted-out document's open question, its conflict and its dependents' wait", () => {
    const sections = derivePlanningSections(index);
    expect(sections.disagrees).toEqual(["opted-open.md"]);
    expect(sections.needsYou.map((ref) => ref.id)).toContain("OQ-Z1");
    const waits = index.documents.find((d) => d.path === "waits.md")!;
    expect(waitingDependsOn(index, waits).map((e) => e.target)).toEqual([
      "opted-open.md",
    ]);
    expect(
      index.documents.find((d) => d.path === "opted-ready.md"),
    ).toMatchObject({ stage: "DECIDED" });
  });

  it("offers compaction for the questions of documents that did not opt out", () => {
    const sections = derivePlanningSections(index);
    expect(answeredQuestions(index).map((ref) => ref.id)).toEqual(["OQ-L1"]);
    expect(planningRequestCount(index, sections, "compact")).toBe(1);
    expect(compactEntries(index, "").map((entry) => entry.ref.id)).toEqual([
      "OQ-L1",
    ]);
  });

  it("does not let a filter bring it back", () => {
    const sections = sectionsOf(index, null, "path:opted");
    expect(sections.ready).toEqual([]);
    expect(sections.graduate).toEqual([]);
    expect(compactEntries(index, "path:opted")).toEqual([]);
  });
});
```

  2. `packages/vantage-check/test/planningActions.test.ts` (new):

```ts
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { EXIT_OK } from "../src/exit.js";
import { bufferIo } from "../src/io.js";
import { makeTree } from "./helpers.js";
import { ANSWERED, OPEN, STAGES_TOML, doc, questions } from "./planningTree.js";

/**
 * `planning-actions` (docs/design/planning-eligibility-and-review-context.md
 * §2.2, §2.4): `none` keeps a document out of Ready, graduation and the
 * compaction offer, and out of nothing else. Driven through the real CLI, as an
 * agent runs it.
 */

async function cli(cwd: string, ...args: string[]) {
  const io = bufferIo(cwd);
  const code = await run(args, io);
  return { code, stdout: io.stdout, stderr: io.stderr };
}

async function indexJson(cwd: string, ...args: string[]) {
  const result = await cli(cwd, "index", "--format", "json", ...args);
  return { ...result, payload: JSON.parse(result.stdout) };
}

const NONE = "planning-actions: none";

function repo(files: Record<string, string>): string {
  return makeTree({
    ".git/HEAD": "ref: refs/heads/main\n",
    ".vantage.toml": STAGES_TOML,
    ...files,
  });
}

describe("planning-actions: none, through the index command", () => {
  const tree = {
    "listed-ready.md": doc("stage: DECIDED"),
    "opted-ready.md": doc(`stage: DECIDED\n${NONE}`),
    "listed-built.md": doc("stage: BUILT"),
    "opted-built.md": doc(`stage: BUILT\n${NONE}`),
    "listed-answered.md": doc("stage: DESIGN", questions("L", ANSWERED)),
    "opted-answered.md": doc(
      `stage: DESIGN\n${NONE}`,
      questions("O", ANSWERED),
    ),
  };

  it("leaves an opted-out document out of Ready, graduation and compaction, and no other", async () => {
    const { code, stdout } = await cli(
      repo(tree),
      "index",
      "--request",
      "ready",
      "graduate",
      "compact",
    );
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain("- listed-ready.md  (stage DECIDED)");
    expect(stdout).toContain("- listed-built.md  (stage BUILT)");
    expect(stdout).toContain("listed-answered.md:");
    expect(stdout).not.toContain("opted-ready.md");
    expect(stdout).not.toContain("opted-built.md");
    expect(stdout).not.toContain("opted-answered.md");
  });

  it("keeps the opted-out document's stage in the index, and says it is opted out, additively", async () => {
    const { payload } = await indexJson(repo(tree));
    const byPath = Object.fromEntries(
      payload.index.documents.map((d: { path: string }) => [d.path, d]),
    );
    expect(payload.version).toBe(3);
    expect(byPath["opted-ready.md"]).toMatchObject({
      stage: "DECIDED",
      planningActions: "none",
    });
    expect(byPath["listed-ready.md"]).not.toHaveProperty("planningActions");
    expect(payload.sections.ready).toEqual(["listed-ready.md"]);
    expect(payload.sections.graduate).toEqual(["listed-built.md"]);
  });

  it("keeps its questions, counts, routing and Stage conflict", async () => {
    const root = repo({
      "opted-open.md": doc(`stage: DECIDED\n${NONE}`, questions("Z", OPEN)),
    });
    const { payload } = await indexJson(root);
    expect(payload.sections.ready).toEqual([]);
    expect(payload.sections.disagrees).toEqual(["opted-open.md"]);
    expect(payload.sections.needsYou).toHaveLength(1);
    const conflict = await cli(root, "index", "--request", "disagrees");
    expect(conflict.stdout).toContain("opted-open.md");
  });

  it("does not let a filter bring an opted-out document back", async () => {
    const { stdout } = await cli(
      repo(tree),
      "index",
      "--filter",
      "path:opted-ready.md",
      "--request",
    );
    expect(stdout).not.toContain("Ready to build");
  });

  it("reads any value but none as all", async () => {
    const root = repo({
      "bad.md": doc("stage: DECIDED\nplanning-actions: maybe"),
      "loud.md": doc("stage: DECIDED\nplanning-actions: true"),
      "fine.md": doc("stage: DECIDED\nplanning-actions: all"),
    });
    const { payload } = await indexJson(root);
    expect(payload.sections.ready).toEqual(["bad.md", "fine.md", "loud.md"]);
  });

  it("does not let the key alone make a document a contributor, and ignores it on a done-role stage", async () => {
    const root = repo({
      "keyonly.md": `---\n${NONE}\n---\n\n# Only the key\n`,
      "retired.md": doc(`stage: RETIRED\n${NONE}`),
    });
    const { payload } = await indexJson(root);
    expect(
      payload.index.documents.map((d: { path: string }) => d.path),
    ).toEqual(["retired.md"]);
  });

  it("is inert on a roadmap, and a roadmap link cannot override the key", async () => {
    const root = repo({
      "roadmap.md": `---\nstage: DECIDED\n${NONE}\n---\n\n# Roadmap\n\n- [Opted](opted-ready.md) first.\n`,
      "opted-ready.md": doc(`stage: DECIDED\n${NONE}`),
    });
    const { payload } = await indexJson(root);
    const roadmap = payload.index.documents.find(
      (d: { path: string }) => d.path === "roadmap.md",
    );
    expect(roadmap).not.toHaveProperty("planningActions");
    expect(payload.sections.ready).toEqual(["roadmap.md"]);
  });
});
```

  3. Append to `frontend/src/pages/PlanningPage.test.tsx`:

```tsx
describe("planning-actions: none (planning-eligibility-and-review-context.md §2.2)", () => {
  const NONE = "planning-actions: none";

  it("keeps an opted-out document out of Ready, graduation and the compaction offer, and leaves its questions and conflict on the page", async () => {
    seed({
      ...TREE,
      "plans/opted-ready.md": doc(`stage: DECIDED\n${NONE}`, "A record."),
      "plans/opted-built.md": doc(`stage: BUILT\n${NONE}`, "A record."),
      "plans/opted-answered.md": doc(
        `stage: DESIGN\n${NONE}`,
        q("OQ-N1", ANSWERED),
      ),
      "plans/opted-open.md": doc(`stage: DECIDED\n${NONE}`, q("OQ-N2", OPEN)),
    });
    await renderPage();
    expect(documentsIn("Ready to build")).toEqual(["plans/ready.md"]);
    expect(documentsIn("Ready to graduate")).toEqual(["plans/built.md"]);
    expect(listedIn("To fold into the ledger")).toEqual([
      "OQ-A1: Question OQ-A1?",
    ]);
    expect(documentsIn("Stage conflict").sort()).toEqual([
      "plans/disagrees.md",
      "plans/opted-open.md",
    ]);
    expect(cardsIn("Needs you")).toContain("OQ-N2: Question OQ-N2?");
  });

  it("keeps it out under a filter that names it", async () => {
    seed({
      ...TREE,
      "plans/opted-ready.md": doc(`stage: DECIDED\n${NONE}`, "A record."),
    });
    await renderPage("/.vantage/planning?filter=path:plans/opted-ready.md");
    expect(
      document.querySelector(
        '[data-planning-document="plans/opted-ready.md"]',
      ),
    ).toBeNull();
  });
});
```

  4. Rewrite `frontend/src/planningScan/cache.test.ts` (~`:74`): `"3:abc:Mozilla/5.0 (X11)"` becomes `"4:abc:Mozilla/5.0 (X11)"`. It is a rewrite to the new schema number, not a repair.
- **Red commands and expected failures** (observed at `545c88b5`):
  - `cd frontend && npx vitest run src/lib/planningActions.test.ts` → 12 failed, 5 passed (the five guards: key-only, malformed, `all`/missing fields, and the question/conflict/dependency-wait case, must stay green).
  - `cd frontend && npx vitest run src/pages/PlanningPage.test.tsx -t "planning-actions"` → 2 failed; the first on `expected [ 'plans/opted-ready.md', … ] to deeply equal [ 'plans/ready.md' ]`.
  - `cd packages/vantage-check && npx vitest run test/planningActions.test.ts` → 4 failed, 3 passed (the question/conflict case, the invalid-value case and the key-only case are guards).
  - `cd frontend && npx vitest run src/planningScan/cache.test.ts` → red after the rewrite, until the schema is bumped.
- **Change:** `scan.ts` (add `"planning-actions"` to `HeaderProblem["key"]` and `HEADER_KEYS`; `readHeader` takes `isRoadmap` and sets `planningActions: "none"` only for a valid `none` off the roadmap, otherwise pushes a problem for an invalid value, or one for the roadmap; JSDoc on the field says absent means eligible). `sections.ts`: in `derivePlanningSections`, `ready` and `graduate` also require `doc.planningActions !== "none"`; leave `disagrees`, `isLive` and everything else. `guide.ts`: `answeredQuestions` filters the same way, beside `isLive`. `cache.ts`: schema 4, and the sentence `4: a planning document may carry planningActions.` after the existing `3:` line.
- **Gates:** the red commands above, now green; `cd frontend && npx vitest run src/lib src/pages/PlanningPage.test.tsx src/planningScan` (planning suites, none may be edited to pass); `cd packages/vantage-check && npx vitest run test/index.test.ts test/planning.test.ts test/planningActions.test.ts`; `cd frontend && npx tsc --build`; `just check-fast --plan` over the staged paths, then commit through the hook.
- **Fences:** do not touch `isLive`, `filter.ts`, `work.ts`, `internal/`, `web/`, any manifest or lockfile, the e2e fixture, or `INDEX_FORMAT_VERSION` (stays 3). Do not add a classifier, a UI toggle or a config key. No rule or diagnostics code yet (Task 2). These are tier-3 fences, held by review: no tool refuses them.
- **Commit:** `feat(planning): let a document opt out of Ready, graduation and compaction`
- **Report:** the red runs and their counts, the green gates, whether any planning suite needed editing (it must not), and any difference between the tree and this plan.

### Task 2 — the diagnostic (after 1)

- **Settled:** an invalid value, and the key on the roadmap, are reported; a valid `none` on a done-role stage or a document the key alone would not make a contributor is silent. Rule name `planning/actions-value`, default `warning`, so the document stays listed and `--strict` fails the run. Cheap and already chosen.
- **Preconditions:** Task 1 landed; `rg -n "planning-actions" packages/vantage-md/src/planning/scan.ts` finds the key.
- **Tests first:** `packages/vantage-check/test/planningActionsRule.test.ts` (new, prettier-formatted):

```ts
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { EXIT_FINDINGS, EXIT_OK } from "../src/exit.js";
import { bufferIo } from "../src/io.js";
import { makeTree } from "./helpers.js";
import { STAGES_TOML, doc } from "./planningTree.js";

/**
 * `planning/actions-value`: the diagnostic for a `planning-actions` the scan
 * cannot honor (docs/design/planning-eligibility-and-review-context.md §2.4).
 * Run through `check`, as the gate runs it.
 */

async function check(cwd: string, ...args: string[]) {
  const io = bufferIo(cwd);
  const code = await run(["check", "--format", "json", ...args], io);
  const findings = (
    JSON.parse(io.stdout).findings as {
      rule: string;
      file: string;
      line: number;
      severity: string;
      message: string;
    }[]
  ).filter((f) => f.rule === "planning/actions-value");
  return { code, findings };
}

const NONE = "planning-actions: none";

function repo(files: Record<string, string>): string {
  return makeTree({
    ".git/HEAD": "ref: refs/heads/main\n",
    ".vantage.toml": STAGES_TOML,
    ...files,
  });
}

describe("planning/actions-value", () => {
  it("reports a value that is not all or none, at its line, as a warning", async () => {
    const root = repo({
      "bad.md": doc("stage: DECIDED\nplanning-actions: maybe"),
      "loud.md": doc("stage: DECIDED\nplanning-actions: true"),
      "fine.md": doc("stage: DECIDED\nplanning-actions: all"),
      "none.md": doc(`stage: DECIDED\n${NONE}`),
    });
    const { code, findings } = await check(
      root,
      "bad.md",
      "loud.md",
      "fine.md",
      "none.md",
    );
    expect(code).toBe(EXIT_OK);
    expect(findings.map((f) => [f.file, f.line, f.severity])).toEqual([
      ["bad.md", 3, "warning"],
      ["loud.md", 3, "warning"],
    ]);
    expect(findings[0]?.message).toContain(
      "`planning-actions` must be `all` or `none`",
    );
  });

  it("fails a --strict run, since it is a warning", async () => {
    const root = repo({
      "bad.md": doc("stage: DECIDED\nplanning-actions: maybe"),
    });
    expect((await check(root, "--strict", "bad.md")).code).toBe(EXIT_FINDINGS);
  });

  it("says nothing of the key on a document it cannot make a planning document, or on a done-role stage", async () => {
    const root = repo({
      "keyonly.md": `---\n${NONE}\n---\n\n# Only the key\n`,
      "retired.md": doc(`stage: RETIRED\n${NONE}`),
    });
    expect((await check(root, "keyonly.md", "retired.md")).findings).toEqual(
      [],
    );
  });

  it("reports the key on the roadmap, where it does nothing", async () => {
    const root = repo({
      "roadmap.md": `---\nstage: DECIDED\n${NONE}\n---\n\n# Roadmap\n`,
    });
    const { findings } = await check(root, "roadmap.md");
    expect(findings.map((f) => [f.file, f.line])).toEqual([["roadmap.md", 3]]);
    expect(findings[0]?.message).toContain("roadmap");
  });
});
```

  Rewrite, do not repair, `packages/vantage-check/test/planning.test.ts`: the `the registry` test (`registers the six rules with their defaults`, ~`:66`) becomes seven rules with `["planning/actions-value", "warning"]` appended after `planning/question-length`, and `toHaveLength(7)`.
- **Red:** `cd packages/vantage-check && npx vitest run test/planningActionsRule.test.ts test/planning.test.ts` → three of the four rule tests fail (the silent case passes at the old tree and must stay green), and the registry test fails after its rewrite. Observed at `545c88b5`: with no rule, `check` reports nothing and exits 0.
- **Change:** `rules/planning.ts`: add the id to `PLANNING_RULES` (append, so existing order is untouched), a method beside `dependsOnMissing` that reports `doc.headerProblems` whose `key` is `planning-actions`, its call in the loop (~`:279`), a `has("planning-actions") && enabled("planning/actions-value")` clause in `mayFire`, and "seven rules" in the comment above it. `rules/registry.ts`: the entry, summary `A planning-actions value that is not all or none, or the key on a roadmap`.
- **Gates:** the red commands, now green; `cd packages/vantage-check && npx vitest run && npx tsc --noEmit && npx eslint . --max-warnings 0`; `just cli` then `packages/vantage-check/dist/vantage-check help | rg actions-value`.
- **Fences:** no change under `packages/vantage-md/`, `frontend/` or `userguide/` in this commit. Do not set the rule to `error`, and do not add an option to it. `planning/question-length` stays off by default (a design non-goal).
- **Commit:** `feat(check): report a planning-actions value the scan cannot honor`
- **Report:** the red and green runs and the `help` line.

### Task 3 — say why in the Work card (after 1)

- **Settled:** the reason a document is not in a list is shown only on an existing surface and never moves anything. The card's *Full details* disclosure is closed by default, so a line in it moves no layout. The document's own frontmatter display already shows the key and needs nothing. The planning page gets no new chip: an absent document has no row to put one on.
- **Tests first:** append to `frontend/src/pages/WorkPage.test.tsx`:

```tsx
describe("WorkPage and planning-actions: none", () => {
  it("says in the card's own details why the document is not in Ready, graduation or compaction, and nowhere else", async () => {
    seedIndex(
      {
        "docs/opted.md": frontmatter("DECIDED", "planning-actions: none\n"),
        "docs/plain.md": frontmatter("DECIDED"),
      },
      1,
      { stages: { DECIDED: "ready" } },
    );
    renderWork();
    await screen.findByRole("heading", { name: "Work overview" });
    const opted = document.querySelector(
      '[data-work-document="docs/opted.md"]',
    ) as HTMLElement;
    const plain = document.querySelector(
      '[data-work-document="docs/plain.md"]',
    ) as HTMLElement;
    const line = within(opted).getByText(
      "Planning actions: none — not offered as ready to build, ready to graduate or to fold into the ledger.",
    );
    // Inside the closed disclosure: the card's height does not move.
    expect(line.closest("details")).not.toBeNull();
    expect(within(plain).queryByText(/Planning actions:/)).toBeNull();
    // The stage stays where it was.
    expect(opted).toHaveTextContent("DECIDED");
  });
});
```

- **Red:** `cd frontend && npx vitest run src/pages/WorkPage.test.tsx -t "planning-actions"` → fails with `Unable to find an element with the text: Planning actions: none — …` (observed at `545c88b5`).
- **Change:** `WorkPage.tsx`, `renderCard`: after the Stage paragraph in the disclosure, `{document.planningActions === "none" && <p className="mt-2 …">Planning actions: none — not offered as ready to build, ready to graduate or to fold into the ledger.</p>}`. Copy neighbouring paragraph classes. The text is pinned by the test, so it is not a choice.
- **Gates:** `cd frontend && npx vitest run src/pages/WorkPage.test.tsx && npx tsc --build && npx eslint . --max-warnings 0`.
- **Fences:** `frontend/e2e/`, the planning page components and `deriveWorkBoard` are out. Do not add a badge, chip or column. Do not render the line outside the disclosure.
- **Commit:** `feat(work): say in a card's details that planning actions are off`
- **Report:** the red message and the green run.

### Task 4 — documentation, style guide, state (after 2 and 3)

- **Settled:** the docs describe the built behavior in the tense of the code. The design's "unsupported until implementation" wording becomes true wording.
- **Docs that now describe the old thing** (read each for behavioral claims, not links):
  - `userguide/guides/planning.md` ~`:61-85`: the paragraph *Opting records out without claiming they are done* says there is no per-document switch and that a `ready` stage makes any document eligible. Rewrite it around `planning-actions: none` first, path exclusion for removing a document from planning entirely, and a done-role stage only when truthful. Keep the sentence that `planning: false` does not exist. Add the three effects, the three non-effects, and that an invalid value is read as `all` with a warning. The Ready, Graduate and fold rows at ~`:488-494` gain "unless the document opts out".
  - `docs/reference/planning-index.md`: [§3.4](../reference/planning-index.md#34-the-header-of-record-stage-next-depends-on) key table gains a `planning-actions` row; [§6.2](../reference/planning-index.md#62-sections-top-to-bottom)'s Ready, Graduate and fold rows and `derivePlanningSections` text; [§11.2](../reference/planning-index.md#112-the-scanner-id-and-the-owner)'s schema number (3 → 4, with the reason); [§13.2](../reference/planning-index.md#132-vantage-check-index)'s JSON paragraph (optional `planningActions` on each document, version unchanged, why); [§13.3](../reference/planning-index.md#133-the-planning-rules) ("seven planning rules", a table row for `planning/actions-value`, and "the first five are the same derivations" prose, which now needs a sentence for the new one); the "Current values" table (~`:4830`) is the index version row and stays 3.
  - `userguide/guides/vantage-check.md` ~`:468-477`: the planning-rules table gains the row, . The sentence before it still reads correctly.
  - `docs/reference/work-overview.md`: the card details list gains the line.
  - `packages/vantage-md/src/styleGuide.ts` ~`:111`: one bullet after `stage-since`: `planning-actions: none` keeps a record out of Ready, graduation and the compaction offer without hiding its questions; the default is `all`; use it for a live record, never a done-role stage that is not true. It is the single source of the printed guide.
  - The design [`planning-eligibility-and-review-context.md`](planning-eligibility-and-review-context.md): the ledger's `Built` column for [OQ-ER1](planning-eligibility-and-review-context.md#decision-ledger) becomes `Built`; the recommendations table's status, the approved-policy section's "unsupported until implementation", the intro paragraph and the costs section lose their "not built" and "unverified" wording (the unknown-key point is now verified, see the findings). `status` stays `accepted`; set `stage: BUILT`.
  - This plan: `stage: BUILT`, `next` names graduating the design into `planning-index.md`'s reference and deleting this plan. Keep the plan and design links while graduation is owed.
  - `roadmap.md`: the entry moves out of *Candidate work* (it is no longer a candidate) to the top of *Up Next*, linking this plan, with a reason that names nothing copied from the plan. Renumber what remains.
- **Check:** `just cli`; then `packages/vantage-check/dist/vantage-check` over each edited `.md`; `packages/vantage-check/dist/vantage-check index` and read that the design appears under *Ready to graduate* and nothing is *Not on a roadmap* that was not before; then `CI=true just compat-previous` if the network is up (a local run with no network skips and says so; report that it skipped).
- **Gates:** `just check-fast --plan` over the staged paths; the hook on commit.
- **Fences:** no code change in this commit except the one `styleGuide.ts` bullet. Do not edit `CHANGELOG.md` (Task 5). Do not delete the plan or the design; graduation is a later, separate step.
- **Commit:** `docs(planning): document planning-actions and mark the opt-out built`
- **Report:** the checker's output over the edited documents, `index`'s *Ready to graduate* line, and whether `compat-previous` ran.

### Task 5 — prepare 0.12.0 (after 4; preparation only)

- **Settled:** the latest local tag is `v0.11.0` (verified `git tag --sort=-v:refname | head -1`), so the next minor is **0.12.0**. The notes are written before any tag and are published verbatim. **Never run `just release`, never tag, push, publish, install, restart or deploy,** and never hand-bump a manifest: CI stamps the tag into both package manifests.
- **Preconditions:** Task 4 landed; a clean tree; `git tag --sort=-v:refname | head -1` prints `v0.11.0`. If a newer tag exists, stop and report.
- **What `v0.11.0..545c88b5` holds** (read at the stamped commit; verify each against the tree before writing its line, with the command shown):

| Commit | Earns a line | Evidence it is user-visible and in a published version |
| :--- | :--- | :--- |
| `b94a85ea` | Yes, Fixed | Typed answers render before the save response; answered rows opened into cards gain **Hide**. `rg -n "Hide" frontend/src/components/PlanningQuestionCard.tsx`. The opened rows shipped in 0.11.0 |
| `000a3611` | Yes, Fixed | Inbox deliveries are consumed by a worker that wakes on inbox events and retries every five seconds; a queued result reports "consumption is unconfirmed" rather than claiming Vantage is stopped. `userguide/guides/review-inbox.md` |
| `3e31845b` | Yes, Fixed | `--request compact` and **To fold into the ledger** listed questions in done-stage documents. `compact` shipped in 0.10.0 |
| `098407c6` | Yes, Fixed | Scoping the page to one document from the outline cleared the previous view; Back now restores the filter and query, and the marker survives URL rewrites |
| `0f411149` | Yes, Changed | The toolbar shows **Apply updates** as a label and keeps planning labels with the primary controls; unresolved ownership has a tooltip; the menu and copied request tell a ledger-recorded ID from a delivered reply. Do not repeat the existing paragraph about toolbar controls staying put; this one is about labels |
| `ff595633` | Yes, Changed | `vantage/question-name` also reports a directive below its own heading, and a directive ID that disagrees with the question title it attaches to |
| `9e6bbaaa` | One sentence in the checker paragraph | A bare question ID that is not a link stays an error; the message no longer calls a ledger-recorded one "open" |
| `cef0d19c` | Yes, Fixed | Links to a question kept working only until it was compacted into a Decision Ledger row; the row now keeps the question's `#OQ-…` anchor (first row for a duplicate id, tables under a heading named Decision Ledger only) |
| `18d43ab6` | Yes, Fixed | Live updates disconnected (code 1009) when diagnostic logs exceeded the server's 32 KiB frame limit; reconnect backlogs are now split |
| `0bcac740`, `64df9bc7` | Yes, Added and Changed | `vantage-md/planning` is a published subpath; `vantage-md` ships ES modules only because its CommonJS entry threw on import (`require("vantage-md")`), and `MarkdownViewer` gains `hideFrontmatter` |
| `0fb55d92`, `ea15b8b3`, `c983c35a` | Already in **Unreleased** | Preserve those paragraphs byte for byte |
| `47fa62e0`, `4dc7d7a6`, `545c88b5`, `ec71d246` | No | Test and design commits; no reader notices |
| Task 1–3 | Yes, Added | `planning-actions: none` |

- **Change:** `CHANGELOG.md`. Leave `## Unreleased` as an empty heading above, as 0.11.0 was prepared, and add `## [0.12.0] - <the day the commit is made, YYYY-MM-DD>` holding an opening sentence and then `### Added`, `### Changed`, `### Fixed`, each with its existing **Unreleased** paragraphs kept first and unchanged. New paragraphs are prose, address "you", use no commit subjects, hashes or file paths, and name no fix to a feature first introduced this cycle (so none for the title glide or the inspector). This is the complete draft, written from the commit messages and the user guides at `545c88b5`. Verify each paragraph against the tree with the table's evidence column, and cut any that the tree does not support. Replace the two parenthesized placeholders with the existing paragraphs byte for byte and `YYYY-MM-DD` with the date:

```markdown
## [0.12.0] - YYYY-MM-DD

Keep records out of Ready lists, and fixes to answering, compaction and delivery.

### Added

**Keep a record out of Ready, graduation and compaction.** Add
`planning-actions: none` to a document's frontmatter and it is never offered as
ready to build or ready to graduate, and its answered questions are not offered
for compaction. Its questions, badges, stage and dependencies stay as they were.
A value other than `all` or `none` is read as `all` and reported as a warning
(`planning/actions-value`). A Work card says so in its details. See
[planning documents](userguide/guides/planning.md).

(the existing "Compare five text transitions" paragraph, unchanged)

**Build planning views from `vantage-md/planning`.** The planning index, filter
and agent requests the viewer uses are published as `vantage-md/planning`, so
your own tool can build a question card or a planning board from the same
documents the viewer renders.

### Changed

(the existing "Answered cards glide their title" paragraph, unchanged)

**`vantage-md` ships ES modules only.** Its CommonJS entry threw on import, so
`require("vantage-md")` never worked; import it instead. `MarkdownViewer` also
takes `hideFrontmatter`.

**The Questions toolbar keeps its planning labels.** **Apply updates** reads as
a label rather than shorthand, and the planning controls keep their words when
space is tight. A question whose ownership is unresolved explains itself in a
tooltip. The menu and the copied request now tell a question recorded in a
ledger from one whose reply was delivered.

**The checker catches two more misplaced questions.** `vantage/question-name`
reports a question directive placed below its own heading, and a directive whose
ID disagrees with the title of the question it attaches to. Either would attach
answers and links to the wrong question. A bare question ID that is not a link
is still an error, and the message no longer calls a question recorded in a
ledger "open".

### Fixed

(the existing three Unreleased paragraphs, unchanged)

**Answers you type appear at once, and opened rows can be hidden.** A card shows
your answer before the server confirms the save. An answered row you opened into
a card has **Hide**, which returns it to its row and leaves an answer box that
holds changes open.

**Agent responses land even when file watching stalls.** Vantage drains the
review inbox with a worker of its own: at startup, on inbox activity and every
five seconds. A delivery that is still waiting is reported as unconfirmed rather
than as Vantage not running. See [the review inbox](userguide/guides/review-inbox.md).

**Retired documents no longer appear in compaction requests.**
`vantage-check index --request compact` and **To fold into the ledger** skip
documents whose stage has the done role, as the other planning lists do.

**Back returns from a scoped document view.** Scoping the Planning page to one
document from the outline adds a history entry, and **Back** beside the filter
box restores the filter and query you had, including a filter you had typed but
not yet applied.

**Links to a compacted question keep working.** A question folded into a
Decision Ledger row keeps its `#OQ-…` anchor on that row. Only tables under a
heading named Decision Ledger get anchors, and a duplicated ID anchors its first
row.

**Live updates stay connected during heavy logging.** A burst of browser
diagnostic logs no longer pushes a message past the server's frame limit, which
closed the connection. Large messages are trimmed and reconnect backlogs are
split.
```

  Do not claim more than the commit says: for example the inbox worker's cause for the earlier stall is explicitly unknown, so say what now happens, not what went wrong.
- **Gates (all must pass; run in this order):**
  1. `sh scripts/changelog-section.sh 0.12.0 >/dev/null` exits 0, and `sh scripts/changelog-section.sh 0.12.0 | head` reads like release notes.
  2. `sh scripts/test-changelog-section.sh`.
  3. `just cli`, then `packages/vantage-check/dist/vantage-check CHANGELOG.md`.
  4. `CI=true just compat-previous` (needs the network; the style guide and the viewer's notation changed this cycle, so it must run before a tag). If the network is down, report it as an external blocker. Do not skip it silently.
  5. `just format`, commit, then `just done` on the clean tree.
- **Fences:** `CHANGELOG.md` and nothing else. Not `package.json`, not `package-lock.json`, not `internal/`. No tag, no `just release`, no push. The tag, the `web/dist` bundle commit and publication belong to the owner; `just release 0.12.0` stops on a dirty tree, an existing tag, an invalid section, or a failed `compat-previous`, and it pushes only the tag.
- **Commit:** `docs(changelog): prepare 0.12.0 release notes`
- **Report:** the section as extracted, each gate's exit status, whether `compat-previous` ran, and the blockers below.

## Ships with

- **Tests by level.** Unit and scan: `frontend/src/lib/planningActions.test.ts` (values, TOML, roadmap, key-only, malformed, and the derivations). Consumer: `packages/vantage-check/test/planningActions.test.ts` through `run(["index", …])` as an agent runs it, and `planningActionsRule.test.ts` through `run(["check", …])`. Page: the two cases appended to `PlanningPage.test.tsx` render the real page over the real inline scanner client, which is the browser path; the WorkPage case renders the card. These are the integration tests that catch a copied predicate: all three consumers read one scan, so a regression in any gate fails the page, the CLI or both.
- **Tests that break and should:** `cache.test.ts` pins schema 3 and `planning.test.ts` pins six rules. Rewrite both to the new facts. Do not relax an assertion until it passes.
- **Surfaces that are neither code nor docs:** the printed style guide (`vantage-check style-guide`), `vantage-check help` (the new rule's summary comes from the registry), and the persisted browser scan cache (schema 4: one cold build per browser after the upgrade, and nothing to do by hand).
- **Docs:** listed per path in Task 4. `docs/research/planning-action-eligibility.md` is this change's findings and stays.
- **CLI output:** `INDEX_FORMAT_VERSION` stays 3 and an unkeyed tree prints byte for byte what it printed; the new property exists only for an opted-out document. The "open in Markdown" note is untouched.

## Blockers and external stops

None for building. For the release, report and do not work around:

- `CI=true just compat-previous` needs the network to install the previous release's `vantage-md`.
- Tagging, the `web/dist` bundle commit, `git push origin v0.12.0`, PyPI, npm and Homebrew publication run only from the owner's `just release 0.12.0` and `publish.yml`'s trusted publishing. This plan prepares them and starts none.
- If a Cloudflare or registry setting looks stale, say so in the report; the dashboard and registry bindings are not in the tree.

## Don't

- Don't "just add" the Ready condition in `PlanningPage` or `planningPages.ts`: the CLI and the checker would disagree with the page.
- Don't gate `disagrees`: an opted-out document with an open question must still show there ([design §2.2](planning-eligibility-and-review-context.md#22-approved-policy)).
- Don't bump `INDEX_FORMAT_VERSION`: the property is additive, as `sectionGuide` was.
- Don't add `planning-actions` to a document in this repository to quiet its own Ready list in the same commits; that is a separate owner decision.
