---
title: Planning action eligibility and review-aware question counts
date: 2026-11-16
status: in-review
stage: DESIGN
next: Owner clarifies and rules on OQ-ER1 (action opt-out); the offline CLI policy is settled, and the opt-out is not built
summary: >
  One proposed change and one retained policy. (A) Add one explicit per-document
  opt-out that removes a document from the Ready, graduation and compaction
  lists only, leaving its questions, routing, dependencies and badges untouched.
  (B) Add no new channel between the CLI and a running Vantage; retain the
  current offline "open in Markdown" count, its existing note and the generated
  handoff, and bind any later review-aware tool to the contract in section 3.3.
tags: [planning, design, cli, review, eligibility]
---

# Planning action eligibility and review-aware question counts

This document answers two unresolved items from an agent report.
Item 8: Ready lists show records, task lists and historical rulings as if they were proposals.
Item 9: the CLI counts a question as open when the browser shows a human answer saved in review.

Action eligibility remains a recommendation awaiting an owner ruling.
The offline CLI policy is settled in the [Decision Ledger](#decision-ledger).
The proposed action opt-out is not implemented, and its syntax is unsupported today.
Evidence was gathered on 2026-11-16 at commit `9e6bbaaa` and is listed in [section 4](#4-evidence).

## 1. Recommendations

| Item | Recommendation | Status | Owner choice |
|---|---|---|---|
| A (report item 8) | One explicit per-document opt-out, scoped to three action lists only. Default unchanged. No genre taxonomy, no inference. | Not built; syntax proposed | [OQ-ER1](#OQ-ER1) |
| B (report item 9) | No new network feature and no review-aware CLI mode. Retain the current offline count, its existing "open in Markdown" note, and the existing generated handoff. | Settled; existing behavior retained, no implementation needed | [OQ-ER2](#decision-ledger) |

Two terms are coined here.

- **Action lists** (coined here): the Ready list, the graduation list, and the offer to compact answered questions. It excludes everything else the planning index does: question listing and counts, routing, dependency waiting, badges, and the stage-disagreement list.
- **Review-aware observation** (coined here): any output that combines the saved Markdown with a per-question status derived from review storage, as served by a running Vantage. It may be a live answer or a browser-produced export of the served state. It excludes sharing the review store, comment bodies, and any claim about what is true after the moment of observation.

## 2. Issue A: participation versus action eligibility

### 2.1 What happens today

A document joins the planning index if it is the configured roadmap, has a `status` or `stage` key, or contains a question directive ([`scan.ts`](../../packages/vantage-md/src/planning/scan.ts#L1442-L1476)).
The scanner has no test for what kind of document it is.

The lists are stage predicates ([`sections.ts`](../../packages/vantage-md/src/planning/sections.ts#L926-L1005)):

| List | Predicate today |
|---|---|
| Ready | role `ready` and no open questions |
| Graduate | role `built` and no questions at all |
| Disagrees | role `ready` or `built`, with open questions |
| Compaction offer | live documents only ([`guide.ts`](../../packages/vantage-md/src/planning/guide.ts)) |

So a record staged `DECIDED` because it shares the frontmatter convention is offered as ready to build.
Three existing tools touch this, and none fits a live record.
A view filter narrows one view without changing the index.
A truthful done-role stage retires the document, as described in [section 2.3](#23-records-tasks-and-existing-stages).
Path exclusion is the existing opt-out from all participation: it removes the document from planning entirely ([planning guide](../../userguide/guides/planning.md#L25-L92)).
Exclusion hides the document's questions and badges, and stops it holding up documents that depend on it.

### 2.2 Recommended policy

Separate two things the index currently treats as one.

- **Participation** is unchanged: status, stage or a question directive.
- **Action eligibility** defaults to yes, and one frontmatter key can turn it off for that document.

Proposed syntax, **unsupported today**:

```yaml
---
title: Rulings log, 2026 Q3
stage: DECIDED
planning-actions: none   # PROPOSED. Values: all (default) | none
---
```

The values are words rather than `on`/`off` because some YAML readers treat those as booleans.

With `planning-actions: none`:

| Surface | Effect |
|---|---|
| Ready list | Never listed |
| Graduation list | Never listed |
| Compaction offer | Never offered; answered directives stay in the file |
| Open questions, counts, handoff routing | Unchanged |
| Badges and stage shown on the document | Unchanged |
| Disagrees list | Unchanged; an open question on a `ready` or `built` record still shows |
| Dependency target | Unchanged; dependents wait on its stage as today |
| Routing and the [`planning/unrouted`](../../.vantage.toml) warning | Unchanged |
| Filters | Cannot re-add it, as they cannot restore retired documents today |

The opt-out can only remove a document from lists that propose an action.
It cannot make a question, a badge or a warning disappear.
The disagrees list is kept because it is the one place a stage and an open question are shown to conflict.

### 2.3 Records, tasks and existing stages

- **Finished records and historical rulings.** Where a done-role stage is true (`CURRENT`, `GRADUATED`, `SUPERSEDED` in [`.vantage.toml`](../../.vantage.toml)), use it. That already removes the document from all three lists, with no new behavior. A done-role document is not live ([`sections.ts`](../../packages/vantage-md/src/planning/sections.ts#L652-L657)), so it also leaves the live set that the question and unrouted lists draw on. A done-role stage is therefore the wrong choice for a record whose genuine questions should stay active.
- **Records with real open questions.** Keep a live stage and add the opt-out. The questions are listed, counted and routed exactly as before. The record is never offered as ready or for graduation.
- **Tasks that track build work.** Leave them alone. A task that moves from decided to built is what Ready and graduation are for.
- **Task lists that are checklists rather than proposals.** Opt out per document if their stage is live. Do not exclude them by path and do not give them a false done stage.

### 2.4 Value rules

| Case | Behaviour |
|---|---|
| Key missing | `all`; identical to today |
| `all` | Identical to today |
| `none` | As in [section 2.2](#22-recommended-policy) |
| Any other value, or a non-string | Treated as `all`, with a visible diagnostic. An invalid value must leave the document in the lists rather than silently drop it. |
| Malformed frontmatter | Unreadable, as today |
| Key on a document with no status, stage or question | Inert; the key does not make a document a contributor |
| Key on a done-role document | Inert and redundant; no diagnostic |
| Key on the configured roadmap | Inert, with a diagnostic. The roadmap owns order only. |
| Roadmap lists an opted-out document | Allowed; the order is shown and the roadmap cannot override the key |

The diagnostic's rule name and severity are not chosen here.

### 2.5 Alternatives

| Option | Verdict | Reason |
|---|---|---|
| Explicit per-document opt-out scoped to action lists | **Recommended** | Smallest change that fixes the false Ready entries without hiding anything |
| Per-document opt-out from planning as a whole (`planning: false`) | Rejected | Same effect as path exclusion; hides real questions behind what looks like a cosmetic switch |
| Per-action values (opt out of Ready but not compaction) | Deferred | No reported case needs it; the value set can grow later |
| Full genre taxonomy (`kind: record`, `task`, `proposal`) | Rejected | Every document must be classified and each genre needs its own rules. Some tasks are proposals, so genre does not decide eligibility. |
| Current path exclusion and filtering | Insufficient alone | Exclusion drops questions, badges and dependency waiting. A filter narrows one view and does not change the index. Still right for galleries and fixtures. |
| Inference from title, directory or shape | Rejected | No reliable signal was found. A wrong guess silently drops a real proposal from Ready. |

No controlling earlier ruling on automatic eligibility was found in targeted searches of the design and reference documents.

### 2.6 Compatibility and migration

- A viewer or checker without this change is assumed to ignore the key and show today's behavior. The opted-out document reappears in Ready, and no question is lost.
- If the index output carries the new fact, it must be additive. Whether that needs a change to `INDEX_FORMAT_VERSION` (3 today, [`index.ts`](../../packages/vantage-check/src/commands/index.ts#L120-L165)) is for implementation to settle; existing consumers must not break.
- Migration is one hand-added line per affected document. Nothing is rewritten automatically, no configuration changes, and the existing fix in [`guide.ts`](../../packages/vantage-md/src/planning/guide.ts) must not regress.

### 2.7 Costs, risks and unverified points

- One more frontmatter key to learn, and one more reason a decided document is missing from Ready. The document's own display should say it is opted out. That is a fixed-height status and causes no reflow.
- An author could opt out a real proposal to quiet the list. The cost is bounded: its questions and its disagreement still show.
- Unverified: whether unknown frontmatter keys are ignored everywhere today.
- Verified: done-role documents are not live, and the action and question lists are selected from live or routed sources ([`sections.ts`](../../packages/vantage-md/src/planning/sections.ts#L926-L960)). Retiring a record to a done-role stage is not a safe substitute for the opt-out when the record has genuine open questions.
- Verified: the unrouted check receives live documents and keeps those with an open question that is not routed ([`sections.ts`](../../packages/vantage-md/src/planning/sections.ts#L839-L850)). An opted-out live document with an unrouted open question still gets the warning.

## 3. Issue B: what an agent may know about review state

### 3.1 What happens today

The CLI index scans the disk from the repository root and has no server or review branch ([`index.ts`](../../packages/vantage-check/src/commands/index.ts#L120-L165)).
Principle P1 in the [agent CLI reference](../reference/agent-cli.md#L112-L132) says: "The filesystem is the only channel … A command that needs a live Vantage is a command an agent cannot rely on."
Its [section 10](../reference/agent-cli.md#10-non-goals) rejects a daemon, RPC, network access and a server check.

The generated style guide already states the rule ([`styleGuide.ts`](../../packages/vantage-md/src/styleGuide.ts#L135)):
"The CLI's count is open in Markdown … It cannot see answers pending in review, so a question answered only in review still counts. … Never describe a CLI count as waiting on the human."

The CLI also says so itself. Its index command carries the note "The count is open in Markdown: answers pending in review are not subtracted here, and the Planning page shows them.", printed once under a filter ([`index.ts`](../../packages/vantage-check/src/commands/index.ts#L451-L453)).

So the report's observation is correct, and it is the documented and labeled behavior.

### 3.2 Retained offline policy

Add no network feature, no review-aware CLI mode, no export and no receipts.

- The CLI count stays offline and stays the default. Invocation and schema are unchanged.
- The existing "open in Markdown" note and the style-guide rule are retained as they are. No new label is proposed, because none is shown to be needed. Other CLI text surfaces were not audited, so this design does not claim that every one carries the note.
- The existing generated handoff remains the bridge. It routes genuine questions and produces one filtered planning-page link, where the human sees the live picture.

What the agent sees is the number of questions the saved files leave open. From that count the agent must not infer:

- that the human owes an answer to each one;
- that no answer exists in review;
- that a question which later disappears from the file was answered and applied line by line.

A saved review answer is not a recorded Markdown ruling and is not automatically delivered to the agent ([planning ownership](../reference/planning-ownership.md#5-lifecycle-labels)).
Knowing "a response is saved" would let the agent do one thing: avoid re-asking.
The style rule already forbids the false claim.
The remaining benefit does not justify amending P1 or creating a second artifact that can go stale.

### 3.3 Contract for any later review-aware observation

If the owner rules that agents need review state, any design must meet all of the following.
None of this exists today, and no switch or command name is proposed.

| Concern | Requirement |
|---|---|
| Invocation | A separate, explicitly requested command or tool. Never the default, never a hidden behavior of the existing index. |
| Connection | The address is given by the caller. No port discovery, and no reading of machine-local review stores by the CLI process. The server's authentication boundary was not investigated and must be settled first. |
| Scope | The tool scans the disk with the same root and config rules as today, then asks only about those paths. Exclusions follow the CLI's config, not the server's. |
| Identity | The caller selects the repository explicitly. The answer must also rest on a trustworthy checkout identity held by the server, or on a mapping the user has confirmed. Repository name, space id and content hash are each insufficient alone: `.vantage/space` can be copied by a clone, and two checkouts can hold identical bytes with different reviews. What `/info` proves was not investigated, so the identity contract is an open prerequisite. A matching `content_hash` is necessary and not sufficient: a mismatch makes that document `unknown`, and a match alone never permits subtraction. |
| Coverage | Every requested path gets an explicit outcome: review present, no review, invalid path, or read failed. Today the endpoint returns stored reviews with their evidence and flags a hash that changed during sampling with `sample_changed`. It omits absent, null, invalid and unreadable paths alike ([`planning_handlers.go`](../../internal/api/planning_handlers.go#L218-L320)), so a missing review cannot be told from a failed read. Complete per-path coverage is a proposed contract extension. The sampling protects each document-and-review pairing only; the batch is not one atomic snapshot, and batch coherence would be a further proposed extension. |
| Facts returned | Per question: id, lifecycle label, evidence. No comment bodies, reply text or author detail. |
| Semantics | Labels come from the existing shared lifecycle rules in [planning ownership](../reference/planning-ownership.md#4-ownership). No second resolver, no scraping the page, no copied decision store. Ambiguous or stale anchors are `unknown`. |
| Freshness | Output carries the observation time and `boot_id`. Counters are comparable only within one boot ([`usePlanningReviews.ts`](../../frontend/src/hooks/usePlanningReviews.ts#L128-L145)). It reads "observed at T", never "currently waiting". A saved export is point-in-time and cannot reveal later edits by itself; a consumer learns of a current mismatch only by hashing the local file when it reads the export. |
| Failure | Server unreachable, wrong version or schema, or a failed request: a distinct non-zero exit and no counts. It must never print Markdown counts under a review-aware label. |
| Partial result | Unknown documents are listed as unknown and left out of any subtraction. The exit status distinguishes complete from incomplete. |
| Schema | Its own versioned output. The existing index output and version are untouched. |
| Outcome policy | Purely observational. It does not record, complete or publish anything, and does not touch [OQ-AP1](./answer-publication.md#OQ-AP1). |

The two non-offline options stand differently against published policy.
A live query conflicts with P1 and [section 10](../reference/agent-cli.md#10-non-goals) of the [agent CLI reference](../reference/agent-cli.md#L112-L132), and would need an explicit owner amendment to both.
A browser-produced export keeps the filesystem as the only channel.
[Answer publication section 3.1](./answer-publication.md#31-document-evidence) prohibits the standalone checker from reading machine-local reviews directly.
An export that carries status only, and never claims a ruling was recorded, is not necessarily that kind of access and may stay inside that boundary; the owner would confirm this rather than assume it.
Neither option depends on deciding [OQ-AP1](./answer-publication.md#OQ-AP1), because observational tooling does not change reply outcomes.

### 3.4 Alternatives

| Option | Verdict | Reason |
|---|---|---|
| Current offline count, existing note and existing handoff | **Recommended** | Already correct, already labeled and P1-clean; no new label is shown to be needed |
| Browser-produced point-in-time export | Fallback if the owner wants more | A human produces a file and passes it explicitly, so the filesystem stays the only channel. It is stale from the moment it is written and must meet [section 3.3](#33-contract-for-any-later-review-aware-observation), including the identity and local-hash requirements. If it carries status only and makes no recording claim, it may stay within the boundary of [answer publication section 3.1](./answer-publication.md#31-document-evidence). |
| Explicit live query (optional mode or separate tool) | Not recommended | Freshest, but contradicts published P1 and [section 10](../reference/agent-cli.md#10-non-goals) and needs an endpoint contract change. It needs owner approval as a policy amendment, not as an implementation detail. |
| Filesystem receipts written when an answer is saved | Rejected | A second copy of review state that drifts. It puts machine-local facts into the tree and invites reading a saved answer as a recorded ruling. |
| Silent fallback from live to Markdown counts | Rejected outright | Produces a number with the wrong label |

### 3.5 Costs and risks

- The recommendation leaves the gap open by design. An agent may still raise a question the human has already answered in review; the human sees the true state on the planning page.
- Nothing changes in CLI output, so the recommendation carries no compatibility cost. CLI text surfaces other than the one audited note were not checked for the same wording.
- The fallback and the live query both add an artifact or channel whose staleness an agent can misread. Section 3.3 exists to bound that.

## 4. Evidence

All rows were observed on 2026-11-16 at `9e6bbaaa` with a clean tree.
Code links are evidence, not definitions.

| # | Source | What it shows |
|---|---|---|
| 1 | [`scan.ts`](../../packages/vantage-md/src/planning/scan.ts#L1442-L1476) | Contributor test is roadmap, `status`, `stage` or a question directive; no genre test |
| 2 | [`sections.ts`](../../packages/vantage-md/src/planning/sections.ts#L926-L1005), with the [live test](../../packages/vantage-md/src/planning/sections.ts#L652-L657) and the [unrouted check](../../packages/vantage-md/src/planning/sections.ts#L839-L850) | Ready, graduate and disagrees are stage predicates over live documents; live means the role is not done; the unrouted check takes live documents only |
| 3 | [`guide.ts`](../../packages/vantage-md/src/planning/guide.ts) | Compaction uses the live test, including all done roles |
| 4 | [`.vantage.toml`](../../.vantage.toml) | Stage roles, excludes, `planning/unrouted=warning` |
| 5 | [Planning guide](../../userguide/guides/planning.md#L25-L92) | Path exclusion removes participation entirely; no kind classifier or opt-out exists |
| 6 | [`index.ts`](../../packages/vantage-check/src/commands/index.ts#L120-L165) | Index format version 3; disk scan only |
| 7 | [Agent CLI reference](../reference/agent-cli.md#L112-L132) | P1 and the [section 10](../reference/agent-cli.md#10-non-goals) rejections |
| 8 | [`styleGuide.ts`](../../packages/vantage-md/src/styleGuide.ts#L135) and the CLI note in [`index.ts`](../../packages/vantage-check/src/commands/index.ts#L451-L453) | The generated guide carries the "open in Markdown" rule, and the CLI prints a matching note once under a filter, both as quoted in [section 3.1](#31-what-happens-today) |
| 9 | [`planning_handlers.go`](../../internal/api/planning_handlers.go#L218-L320), [`routes.go`](../../internal/api/routes.go#L70-L78) | Reviews endpoint omits invalid, failed and absent paths alike |
| 10 | [`usePlanningReviews.ts`](../../frontend/src/hooks/usePlanningReviews.ts#L128-L145) | Ordering is valid only within one `boot_id` |
| 11 | [Planning ownership](../reference/planning-ownership.md#2-evidence-which-reading-a-pair-belongs-to) | Evidence, binding and lifecycle labels; controls shipped behavior |
| 12 | [Answer publication](./answer-publication.md#OQ-AP1) | [OQ-AP1](./answer-publication.md#OQ-AP1) is open; [section 3.1](./answer-publication.md#31-document-evidence) defines recording evidence and its limits |

Related documents, not re-verified for this design: [planning index](../reference/planning-index.md), [work overview](../reference/work-overview.md), [planning question state](./planning-question-state.md), [planning review actions](./planning-review-actions.md).

## 5. Acceptance scenarios

These describe behavior that would show the design is met. None has been run.

**Issue A**

1. A `DECIDED` record with `planning-actions: none` and no open questions is absent from Ready. It still shows its stage badge, and a document depending on it waits exactly as before.
2. The same record gains an open question. The question appears in counts and in the handoff, and the record appears in the disagrees list.
3. A `BUILT` opted-out document with no questions is absent from graduation.
4. An opted-out document with answered directives gets no compaction offer.
5. A document with `planning-actions: maybe` is listed in Ready as today, and a diagnostic is shown.
6. A document with no key behaves identically before and after the change.
7. An opted-out document under an active filter does not reappear in any action list.
8. A build-tracking task with no key still appears in Ready and in graduation.

**Issue B**

1. With no server running, the index command gives the same output structure and exit behavior as today.
2. The existing "open in Markdown" note still appears under a filter with its current wording.
3. No agent-facing output describes a CLI count as waiting on the human.
4. If a review-aware tool is later built, an unreachable server gives a non-zero exit and no counts.
5. For the same tool, a file whose local hash at read time differs from the observed hash is reported as unknown, not subtracted.
6. For the same tool, a matching hash without an established checkout identity yields unknown, not subtraction.

## 6. Non-goals

- No implementation plan, file checklist or code change, and no change to `.dotfiles` configuration or host state.
- No genre taxonomy, and no inference from titles or directories.
- No change to reply-outcome or publication policy; that stays with [OQ-AP1](./answer-publication.md#OQ-AP1).
- No change to the no-surprise-refresh rule: status may update at once at fixed height, and moving cards still wait for explicit Apply.
- No animation redesign, and no freeze of per-round `CapturedBlock` recapture.
- `planning/question-length` stays off by default.
- No second Go Markdown parser, no per-card CLI, and no in-process git library.

## Open Questions

1. 💬 **OQ-ER1: Should a document be able to opt out of Ready, graduation and compaction without leaving planning?**

   Walkthrough: you open the Planning page and Ready lists a quarterly rulings log, staged `DECIDED` only because it shares the frontmatter convention. It is not something to build. Today you can exclude its path, which also hides any open question in it, or you can ignore the entry.

   Under Option A, you or an agent deliberately adds a frontmatter setting to that document. Once implemented, the shared planning scan reads it and keeps the document out of the three action lists in both the browser and CLI. There is no automatic classification or new UI toggle in this proposal. Removing the setting restores normal action eligibility; the setting does not work today.

   - **Option A, action opt-out (proposed key).** Add `planning-actions: none` to that file. It leaves Ready, graduation and compaction. Its questions, badges and dependency role stay. Other documents are unaffected.
   - **Option B, existing tools only.** Restage finished records to a true done stage and path-exclude the rest. Nothing new to learn. A live record with a real open question either stays in the lists or loses its question from planning.
   - **Option C, document kinds.** Every planning document declares a kind, and each kind has its own list rules. Most expressive; every existing document needs classifying, and tasks that are real proposals need an exception.

   <!-- vantage: question id=OQ-ER1 leaning="Option A: one per-document opt-out scoped to Ready, graduation and compaction only" -->

   _Leaning:_ Option A: one per-document opt-out scoped to Ready, graduation and compaction only.

   **Answer:**

   >

## Decision Ledger

| ID | Ruling / Decision | Date | Settled in | Built |
|---|---|---|---|---|
| OQ-ER2 | Option A: retain the offline CLI, its existing "open in Markdown" explanation and generated handoff. Add no review-aware mode, export or live query. | 2026-11-16 | [Retained offline policy](#32-retained-offline-policy) | Existing behavior retained; no implementation needed |