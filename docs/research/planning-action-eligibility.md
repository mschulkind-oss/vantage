---
title: Planning action eligibility — repository findings
date: 2026-11-16
status: accepted
tags: [planning, research, scanner, cli, cache]
summary: >
  What the tree at 545c88b5 does today for the approved `planning-actions: none`
  opt-out: where each action list is decided, which stored and printed shapes a
  new scanner field touches, and what was reproduced. Evidence for the build plan,
  not a decision record.
---

# Planning action eligibility — repository findings

Written for the [build plan](../design/planning-eligibility-and-review-context-plan.md) of [the design](../design/planning-eligibility-and-review-context.md). The design's rulings are not reopened here. Every row below was read in the tree at `545c88b5` on 2026-11-16 (read from source, and reproduced where marked).

## 1. The gap, reproduced

A scratch tree with a `DECIDED` and a `BUILT` record carrying `planning-actions: none`, an answered question in a `DESIGN` record carrying it, and a `DECIDED` document carrying `planning-actions: maybe` was run through the source CLI (`bun run` over `packages/vantage-check/src/cli.ts`, no build). Result at `545c88b5`:

| Command | Result | Reading |
| :--- | :--- | :--- |
| `index` | Ready lists the opted-out record and the `maybe` document; Graduate lists the opted-out `BUILT` record | The key is unknown to the scan, so every document is eligible |
| `index --request ready graduate compact` | All three lists name the opted-out documents, including its answered question | Compaction uses the same eligibility |
| `check` over the two files | `nothing to fix`, exit 0 | An unknown top-level frontmatter key is ignored everywhere, which settles the design's one unverified point (section 2.7) |

The log is `.yolo/durable/planning-actions-build/repro-gap-at-545c88b5.log` (untracked and ignored; the script beside it is `repro/repro.ts`).

## 2. Where each action list is decided

One decision point per list. Every other consumer reads these, so a gate in them reaches the page, the CLI, the filter and the checker together.

| List | Decided in | Read by |
| :--- | :--- | :--- |
| Ready, Graduate | `ready` and `graduate` entries returned by [`derivePlanningSections`](../../packages/vantage-md/src/planning/sections.ts#L925) | The page (`sectionsOf` in `frontend/src/lib/planningPages.ts`), `index` text and JSON, `--request`, the checker's `planning/stage-disagrees`, and the filter, which only narrows these arrays (`rows(sections.ready)` in `packages/vantage-md/src/planning/filter.ts`) |
| Stage conflict | The `disagrees` entry of the same function | Same readers. It stays as it is: the design keeps an opted-out document with an open question in it |
| Compaction offer | [`answeredQuestions`](../../packages/vantage-md/src/planning/guide.ts#L241), which filters on [`isLive`](../../packages/vantage-md/src/planning/sections.ts#L656) | `planningRequestCount`, `planningRequestsWithEntries`, the `compact` block of the request, `compactEntries` and `listedQuestions` in `planningPages.ts` |
| Work overview | `deriveWorkBoard` in `packages/vantage-md/src/planning/work.ts`, which groups every document by stage | Not an action list; it keeps showing the stage |

Nothing copies the Ready predicate. `isLive` is also the gate for routing, the unrouted check and dependency waiting, so the opt-out must not touch it: that is how the design's "questions, routing and dependencies unchanged" holds by construction.

## 3. The scanner

- A document contributes when it is the roadmap, has a `status` or `stage` key, or holds a question directive ([`scanPlanningDocument`](../../packages/vantage-md/src/planning/scan.ts#L1453), the `keyed` test at `scan.ts:1463`). A key outside those cannot make a contributor, so "the key alone is inert" needs no code, only a test.
- Header keys and their diagnostics live in [`readHeader`](../../packages/vantage-md/src/planning/scan.ts#L1291): [`HEADER_KEYS`](../../packages/vantage-md/src/planning/scan.ts#L1091) finds each key's line in YAML and TOML, and [`HeaderProblem`](../../packages/vantage-md/src/planning/scan.ts#L223) carries `key`, `line` and `message`. A new key fits there without a second mechanism.
- `readHeader` does not know whether the document is the roadmap. `scanPlanningDocument` does (its `isRoadmap` argument, set from the config by `scanCandidate`), so the roadmap's inert-plus-diagnostic case is decided in the scan, not in the checker.
- A done-role stage is a configuration fact the scan never sees, so "redundant, no diagnostic" falls out for free: the scan reports only a bad value or a roadmap.
- [`stageSince`](../../packages/vantage-md/src/planning/scan.ts#L244) is the precedent for an optional header-derived field: present only when valid, absent otherwise, shown in the JSON index and in no test fixture that predates it.

## 4. Persisted shapes

| Shape | Evidence | Consequence |
| :--- | :--- | :--- |
| Browser scan cache | The scanner id is `schema:sourceHash:userAgent` ([`scannerIdOf`](../../frontend/src/planningScan/cache.ts#L45)). The source hash covers every file under `packages/vantage-md/src/`, so editing `scan.ts` changes it and a mismatch clears every store. The schema number is "bumped by hand whenever a stored shape changes" (the comment above `SCAN_CACHE_SCHEMA`) | Invalidation is already automatic. Bump the schema from 3 to 4 anyway: it is the documented contract, costs one cold build, and keeps a stored record without the field from being read as one that was scanned with it. `cache.test.ts` pins `"3:abc:…"` and is rewritten to `"4:abc:…"` |
| `index --format json` | [`INDEX_FORMAT_VERSION`](../../packages/vantage-check/src/commands/index.ts#L134) is 3, and `renderJson` documents that a key added without changing another's meaning does not change the version (`sectionGuide` was added that way) | One optional property on `index.documents[]`, present only for `none`, so a tree with no key prints byte for byte what it printed. The version stays 3 |
| Go stream | `internal/planning` serves file hashes and text and does not read frontmatter | Nothing changes |
| Published `vantage-md/planning` types | `PlanningDocument` is exported with the optional `stageSince`; a new optional field is compatible with the consumer type test | Nothing breaks for an importer |

## 5. The checker

- Rules are listed in [`PLANNING_RULES`](../../packages/vantage-check/src/rules/planning.ts#L73) and described in [`registry.ts`](../../packages/vantage-check/src/rules/registry.ts#L264). Existing names are `planning/<noun-or-state>`; severities are `error` where the repository is wrong and `warning` where a shape may be meant (`planning/stage-disagrees`).
- The new rule is `planning/actions-value`, default **warning**. It reports the scan's `planning-actions` problems, as `stageVocabulary` and `dependsOnMissing` report theirs from `doc.headerProblems`. A warning because the document stays in the lists, and a `--strict` run still fails on it.
- [`mayFire`](../../packages/vantage-check/src/rules/planning.ts#L345) is a pre-parse shortcut that lists, per rule, the header key that makes a document worth parsing. It needs `has("planning-actions")` for the new rule, or the diagnostic never fires for a document that has no other planning key.
- The registry test counts the planning rules (`registers the six rules` in `packages/vantage-check/test/planning.test.ts`), and the guide's table of rules lists them (`userguide/guides/vantage-check.md`): both are rewritten, not repaired.

## 6. Surfaces that can say "why is it missing"

| Surface | Exists | Use |
| :--- | :--- | :--- |
| The document's own frontmatter card | Shows every top-level key as written | Already says `planning-actions: none`; no change |
| A Work overview card's *Full details* disclosure ([`renderCard`](../../frontend/src/pages/WorkPage.tsx#L267)) | A closed `details` element with stage, next, questions and dependency lines | One more line inside it. Closed by default, so no layout moves and no refresh is involved |
| `index --format json` | Documents carry their header facts | The optional property above |
| The planning page's Ready and Graduate rows | An absent document has no row | Nothing to add. A new chip would be a fixed-height status on a row that is not there |

## 7. Docs that state the old behavior

| Doc | Claim now false or incomplete |
| :--- | :--- |
| [`userguide/guides/planning.md`](../../userguide/guides/planning.md#L61-L68) | "There is no … per-document `planning: false` switch" and "whatever kind of document" read as the whole story. The paragraph is right that no `planning:` switch exists, and incomplete without `planning-actions` |
| [`docs/reference/planning-index.md`](../reference/planning-index.md#L636) | [§3.4](../reference/planning-index.md#34-the-header-of-record-stage-next-depends-on)'s key table, [§6.2](../reference/planning-index.md#62-sections-top-to-bottom)'s Ready, Graduate and To fold rows, [§11.2](../reference/planning-index.md#112-the-scanner-id-and-the-owner)'s schema number, [§13.2](../reference/planning-index.md#132-vantage-check-index)'s JSON shape, [§13.3](../reference/planning-index.md#133-the-planning-rules)'s "six planning rules" |
| [`packages/vantage-md/src/styleGuide.ts`](../../packages/vantage-md/src/styleGuide.ts#L104) | The planning-document frontmatter section teaches `stage`, `next`, `depends-on` and `stage-since` only. It is the single source of the printed guide, so no other copy exists |
| [`docs/reference/work-overview.md`](../reference/work-overview.md) | The card details list |
| `packages/vantage-check/src/rules/planning.ts` | The comment above `mayFire` says "any of the six rules"; it is source prose, corrected with the rule |

## 8. Dead ends

- **Inference.** The design rejected it; nothing found contradicts that, and there is nothing to find: the scan reads no genre signal.
- **Filtering `ready` at the page.** The page, `index`, the request text and the checker would then disagree (P7). One gate in `derivePlanningSections` and one in `answeredQuestions` are enough, because every consumer reads them.
- **A new `index` format version.** Nothing existing changes meaning; the precedent is additive keys.
- **A Playwright test over the shared e2e fixture.** `frontend/e2e/fixtures/test_repo/` is counted by name in many specs ("23 indexed documents"). A document added there moves their numbers. The real-browser path is covered instead by `PlanningPage.test.tsx`, which serves its tree through the real inline scanner client.

## Sources

- [The design](../design/planning-eligibility-and-review-context.md): the rulings and the value rules this applies.
- [The planning index reference](../reference/planning-index.md): the scan, the sections and the cache this read against.
- [The agent CLI reference](../reference/agent-cli.md): why nothing live joins the CLI.
