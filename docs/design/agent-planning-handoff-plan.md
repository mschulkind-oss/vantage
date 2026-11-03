---
title: "Grounded agent handoffs — implementation plan"
date: 2026-11-03
status: accepted
stage: BUILT
next: "None; all three slices are built"
tags: [vantage-check, planning, agent-handoff, plan]
depends-on:
  - agent-planning-handoff.md
---

# Grounded agent handoffs — implementation plan

**Status:** 2026-11-03. Plan for [`agent-planning-handoff.md`](agent-planning-handoff.md), whose ruling [OQ-AH1](agent-planning-handoff.md#decision-ledger) (default-on warning) is settled and not reopened. Where this plan and the design disagree, the design wins.

Verified against `b93e0dc0`: `vantage/oq-missing` is `checkOpenQuestions` in `packages/vantage-check/src/rules/directives.ts`, registered in `rules/registry.ts` and called from `core/runner.ts`; the printed style guide is `packages/vantage-md/src/styleGuide.ts`; the `--filter` readout is `filterHead` in `packages/vantage-check/src/commands/index.ts`.

## Slice 1 — the diagnostic (`vantage/question-candidate`, warning, on by default)

Red tests first in `packages/vantage-check/test/directives.test.ts` (or a new `questionCandidate.test.ts`), then the rule in a new `rules/questionCandidate.ts`, registered and called after `checkOpenQuestions`. It reads the shared mdast the other rules read; no second parser, no prose regex over the raw source.

| Input | Finding |
| :--- | :--- |
| List item, first inline run 💬 or 🔒 then an OQ-shaped id, no question directive in the item | one warning |
| Same with 💬, an id and a `_Leaning:_` paragraph (the `oq-missing` case) | none from this rule |
| GFM table, header has `Leaning` or `Answer`, first header not `ID`, body cell holds the id as plain text or inline code | one warning per table |
| Same table, first header exactly `ID` (ledger) | none |
| Row id is a link | none |
| ids in fenced code, prose, links, inline code in prose; ✅ items | none |
| Zero candidates | no output; `--strict` passes |

Reuse `OQ_ID`, `vantageOqStatus`, `isQuestionDirective` and the directive scan from `directives.ts` (export them; do not copy). Message names the fix: file a `question` directive or convert/omit the table. Add the rule to the rules table in `docs/reference/agent-cli.md` or wherever `vantage/oq-missing` is listed, and the rule-count test if one exists.

## Slice 2 — wording and messages

- `styleGuide.ts` handoff text: the six-step contract of the design [§4](agent-planning-handoff.md#4-the-agent-handoff-contract-docs-first-shippable-alone) stated once, with *open in Markdown* versus *waiting on you* ([§3](agent-planning-handoff.md#3-two-counts-two-names)) and the corrected loop exit. Update the style-guide tests that pin it.
- `userguide/guides/planning.md` and `vantage-check.md`: point to the style guide's text instead of restating; fix the false loop exit *Nothing this filter keeps needs you*; stop calling `is:open` "waiting on you"; list the new rule next to `oq-missing`.
- `index.ts`: under a filter, one added sentence that answers pending in review are not subtracted here. Unmatched `path:` exit 2: say the term matched nothing among indexed, skipped or unreadable documents, that several `path:` terms combine in one filter, and, only for a root-anchored literal path inside the scan perimeter, whether a file exists there; a pattern is an unmatched pattern, never a missing file. Exit code, JSON shape and perimeter unchanged. Do not change `vantage-md` notice text that the frontend shares unless a test proves it is checker-only.

## Slice 3 — close out

Set [`agent-planning-handoff.md`](agent-planning-handoff.md) ledger `Built` and `stage` truthfully: `BUILT` only if everything in [§4](agent-planning-handoff.md#4-the-agent-handoff-contract-docs-first-shippable-alone), [§5.1](agent-planning-handoff.md#51-filter-readout-wording-cli-no-new-flag) and [§5.2](agent-planning-handoff.md#52-structural-diagnostic-for-unfiled-candidates-checker-warning) is built, otherwise state what remains. Concise, no changelog/roadmap edits (parent integrates).

## Out of scope

Frontend, Go, `CHANGELOG.md`, roadmaps, other lanes' docs, review-aware CLI, `ID`-first tables, [`answer-publication.md`](answer-publication.md) ([OQ-AP1](answer-publication.md#OQ-AP1) unchanged).
