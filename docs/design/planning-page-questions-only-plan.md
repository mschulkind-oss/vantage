---
title: "Plan: the planning page is its questions"
date: 2026-10-10
status: accepted
stage: DECIDED
next: "Build T1, then T2 onward; stop at the targeted grit for each task and run the whole gate once at the end"
depends-on: [planning-page-questions-only.md]
tags: [planning, implementation-plan, notation]
summary: "The build hand-off for the blocked-on key, the derivation that makes Blocked questions-only, the page's card list, the checker rule, and this repository's own bare blocked questions."
---

# Plan: the planning page is its questions

**Status:** 2026-10-10. Completed against the tree, written against `ce762ba5`.
**Design:** [`planning-page-questions-only.md`](planning-page-questions-only.md).

**Precedence.** The design wins on behavior. The tree wins on fact (a moved
line, a renamed helper with the same role — follow it and say so). This plan is
advice and the first thing to be wrong. **Never twist the code to match it.**
Stop and report, do not commit, when a test does not fail as predicted, a named
symbol is gone, a fix needs a file outside its fence, or a gate fails outside
the task.

## Map

| Path | Change |
| :--- | :--- |
| `packages/vantage-md/src/vantageDirectives.ts` | new — accept `blocked-on` on the `question` directive (find the key table) |
| `packages/vantage-md/src/planning/scan.ts` | new — parse `blocked-on` (a comma-separated list) into the question |
| `packages/vantage-md/src/planning/model.ts` | new — `PlanningQuestion.blockedOn`; narrow `WaitingEntry` to questions |
| `packages/vantage-md/src/planning/sections.ts` | new — derive a question's state from its referent; `waiting` holds questions only; export the resolver |
| `packages/vantage-md/src/planning/guide.ts` | `blockedOn` reads the document's own `dependsOn`; *Blocked*'s explanation; the row's blocker label |
| `packages/vantage-md/src/planning/filter.ts` | `keptCount` / `keepsWaiting` over questions only |
| `packages/vantage-check/src/commands/index.ts` | `INDEX_FORMAT_VERSION` → 3 |
| `packages/vantage-check/src/rules/planning.ts` | new rule — a marker that disagrees with the referent |
| `packages/vantage-check/src/rules/directives.ts` | accept the new key |
| `frontend/src/lib/planningPages.ts` | `sectionEntries`/`layoutPlanningPage` — Blocked questions only; `needsYou` gains the unrouted |
| `frontend/src/components/PlanningNeedsYou.tsx`, `PlanningQuestionCard.tsx` | the *Not on a roadmap* mark |
| `frontend/src/components/PlanningGroups.tsx` | the Blocked row names its blocker |
| [`docs/reference/planning-index.md`](../reference/planning-index.md) | the question key, *Blocked*, *Needs you*, the JSON version, the planning rules, the ledger |
| `userguide/guides/planning.md` | the marker table, *Blocked*, *Needs you* |
| this repository's own `🔒` questions | add a referent or move to `💬` |

## Reuse

- **`DependsOn` and its resolution.** `findDocument`, the `depends-on` parser and
  `waits` in `sections.ts` do exactly what `blocked-on` needs; do not write a
  second resolver.
- **`dependsOnLabel`** (`guide.ts`) is the one label formatter for a target.
- **`questionEntry` / `cardsOf` / `sectionEntries`** in `planningPages.ts` are
  where the page's composition already lives.
- **The planning badge/chip** the cards already draw is where the *Not on a
  roadmap* mark belongs; do not invent a second chip.

## Traps

- **The filter's kept-count reads `sections.waiting`, not the layout.** Removing
  the document rows in `derivePlanningSections` is what keeps the header's
  *N match* honest; removing them only in the layout desyncs it.
- **`guide.ts`'s `blockedOn` currently sources from `sections.waiting`.** Once
  documents leave it, the *Ready to build* / *Ready to graduate* "(blocked on …)"
  mark must read the document's own `dependsOn` directly, or it silently empties.
- **P0.** A viewer older than this release drops the unknown `blocked-on` key and
  reads the question exactly as it read it before. Test that.
- **`oq` on a 🔒 question is already an error**, so `blocked-on` is only ever on a
  `question`.
- **`INDEX_FORMAT_VERSION` is a contract.** Whatever consumes `--format json`
  (the frontend index reader, tests) must tolerate version 3.

## Tasks

**T1 — the `blocked-on` key (notation).** *Independent.* Add the key to the
`question` directive's table in `vantageDirectives.ts`; parse a comma-separated
list in `scan.ts` (an entry that is not a repo-relative path is an external
blocker name) into `PlanningQuestion.blockedOn`. Test first: a fixture document
with `blocked-on="docs/a.md, the 1.0 release"` scans to two entries, the
first a target and the second external; a pre-change round-trip still parses the
question. Gate: the `vantage-md` unit tests for scan and directives. Commit:
`feat(planning): a question's block names its referent`.

**T2 — the derivation (Blocked is questions only).** *After T1.* Derive a
question's state from its referent (`🔒` + live referent = blocked; otherwise
open) in `sections.ts`; stop emitting `{kind: "document"}` into `waiting`; export
the resolver so `guide.ts` can mark the ready/graduate rows from a document's own
`dependsOn`. Update `keptCount`. Test first: a document with a waiting
`depends-on` appears in no `waiting` entry; a `🔒` question with a live referent
is blocked; a `🔒` with none is open. Gate: `vantage-md` planning tests. Commit:
`refactor(planning): blocked is a question with a referent`.

**T3 — the checker rule and the JSON.** *After T2.* `INDEX_FORMAT_VERSION` to 3;
the new `planning/*` rule for a marker that disagrees with its referent (a `🔒`
with no live referent, a `🔒` whose referent closed, a `💬` with a live one);
accept the key in `rules/directives.ts`. Test first: the rule fires on each
disagreement and is silent on agreement; the index JSON reports version 3.
Gate: the `vantage-check` unit tests. Commit: `feat(check): a marker must agree
with its referent`.

**T4 — the page.** *After T2.* `sectionEntries`/`layoutPlanningPage`: `blocked`
holds questions only; `needsYou` appends the unrouted open questions, marked.
`PlanningNeedsYou` draws the mark; `PlanningGroups` names a blocker. Test first:
the layout's `blocked` has no document entry; `needsYou` ends with the unrouted
in path order; the mark renders. Gate: the frontend layout and component tests.
Commit: `feat(planning): unrouted questions join the to-do list`.

**T5 — the documents this change owns.** *After T3.*
[`docs/reference/planning-index.md`](../reference/planning-index.md) (the
directive key, *Blocked*, *Needs you*, the JSON version, the planning rule, the
ledger rows), `userguide/guides/planning.md`, and the
`design-doc`/`vantage-docs` skill text if it names the keys. Commit:
`docs(planning): the page is its questions`.

**T6 — this repository's own bare blocks.** *After T3.* Every `🔒` in this tree
that the new rule reports is answered, given a referent, or moved to `💬`.
Commit: `docs(planning): give every blocked question its referent`.

**T7 — the gate.** Run `just done` on the clean tree, with
`env -u LD_LIBRARY_PATH` (see the jail's staticcheck note) and, on a loaded host,
`VITEST_MAX_WORKERS=2`.

## Ships with

- The reference's Decision Ledger gains the four rulings from the design doc.
- The style guide and `inline-markup.md` name the new directive key.
- `INDEX_FORMAT_VERSION` 3 documented in the reference's JSON section.

## Don’t

- Do not add a config key, a stage role, or a "mark your plan" rule. The design's
  whole point is that no document is marked; the convention decides.
- Do not change `depends-on` or its parser; `blocked-on` reuses the resolution,
  not the field.
- Do not renumber sections or change a section's id.

## Blockers

None. The design is `DECIDED` with no open questions.
