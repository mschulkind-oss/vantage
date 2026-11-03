---
status: accepted
stage: DECIDED
title: "Grounded agent handoffs: one command, two counts"
next: "Complete an implementation plan for the guidance correction and default-on diagnostic"
---

# Grounded agent handoffs — one command, two counts, and what the tool cannot see

**Status:** 2026-11-03. Nothing built. Evidence verified at `01837a0a`; the owner's quoted report is the only specimen of the failure and its three documents are not in this checkout.

> **In short.** The quoted handoff's ungrounded claims — about combining paths, table rows, ledger rows and `is:open` — are each answered by documentation the agent did not find or trust, so the fix is first a documentation correction (one canonical instruction, one false loop, one false equivalence) and only second two small optional safeguards; waiting on other writers is ordinary coordination and stays. Nothing here is a prerequisite for anything else.

**Why it matters.** The owner was told to open a whole document because `is:open` "won't pick up" a table, to run three filters because the agent did not know whether paths combine, and to confirm two ledger rows as if they were new decisions. Each costs the owner a trip; the last costs trust in what *Needs you* means. Asking the owner to wait for other writers is fine; it is only a defect when it stands in for saying what is saved and indexed now.

**The shape.** A six-step agent handoff contract (docs), a corrected vocabulary for two counts the tool already distinguishes (docs), and two proposed checker-side safeguards with their boundaries stated (product).

**Cost.** Wording changes in the printed style guide and the guides that cross-reference it; one new default-on warning for the two narrowly defined candidate shapes. No schema, MCP, index-shape or filter-notation change.

**Start at [§2](#2-what-the-report-got-wrong-and-what-is-already-true)** — the ledger of report claims against current behavior; everything proposed falls out of it.

**Needs your ruling:** None.

**Reads with:** [`answer-publication.md`](answer-publication.md) (owns how an agent's response is recorded as document evidence; not a prerequisite here), [`planning-index.md`](../reference/planning-index.md) (the index this document's counts refer to), [`planning.md`](../../userguide/guides/planning.md) and [`vantage-check.md`](../../userguide/guides/vantage-check.md) (the guides this design corrects).

---

## 1. The specimen

The owner pasted this; the three paths are foreign to this checkout and are quoted only as a specimen, never as link targets or as claims about those files' contents.

```text
path:/docs/design/mcp-auth-sharing.md is:open
path:/docs/research/macos-keychain-session.md
path:/docs/design/github-write-scopes.md is:open
- macos-keychain-session.md: OQ-KS1 to OQ-KS6. They're written as a table, not as
  Vantage question blocks, so is:open won't pick them up. Open the document itself.
- github-write-scopes.md: OQ-GW13, OQ-GW14 and OQ-GW15, plus confirming GW-D57 and GW-D58.
I don't know whether Vantage filters can combine paths with OR, so I've given one per document.
Wait for the two agents to finish before reviewing the first two.
```

## 2. What the report got wrong, and what is already true

| Report claim | Current behavior | Evidence |
| :--- | :--- | :--- |
| "I don't know whether Vantage filters can combine paths with OR" | The uncertainty is the defect, not a false claim: positive `path:` terms are OR'd; every other term is AND'd across the kept documents, and this is documented. One command covers all three. Observed: two paths plus `is:open` kept 2 documents and showed 1 open question. | [`filter.ts#L778-L811`](../../packages/vantage-md/src/planning/filter.ts#L778-L811); [planning.md L969–973](../../userguide/guides/planning.md#L969-L973) |
| "Open the document itself" (risk inferred here, not stated in the report: a reader may try the path filter to read it) | A `path:` term keeps planning documents the scan indexed and renders no file body. An unmatched `+/-path` term exits 2 after being checked against indexed, skipped *and* unreadable documents, so exit 2 means the term matched nothing the scan saw — a typo, a missing file, a file not treated as planning, an excluded or ignored path, or scan configuration — not specifically "no frontmatter". | [`filter.ts#L1239-L1250`](../../packages/vantage-md/src/planning/filter.ts#L1239-L1250); [planning.md L54–106](../../userguide/guides/planning.md#L54-L106); [`index.ts#L71-L99`](../../packages/vantage-check/src/commands/index.ts#L71-L99) |
| Table rows described as open questions | Only a `question` (or legacy `oq`) directive declares a question; an OQ-shaped id in a table cell is text. Unfiled, those decisions are the *agent's* defect to fix before handing over, not the owner's reading assignment. | [planning.md L54–106](../../userguide/guides/planning.md#L54-L106); [`scan.ts#L210-L246`](../../packages/vantage-md/src/planning/scan.ts#L210-L246) |
| "Confirm GW-D57 and GW-D58" | A ledger row is a ruling. Retained id text resolves dependencies, it never reopens. A genuinely new choice needs a new question with its own id and directive linking the settled row; a redundant confirmation is not a blocker. | [planning.md L184–186](../../userguide/guides/planning.md#L184-L186) |
| `is:open` = "still waiting on you" | `is:open` is Markdown state. The CLI reads files, not review comments, so an already-answered question with a pending review answer still counts. The live page subtracts pending answers; the CLI cannot. | [planning.md L991–994](../../userguide/guides/planning.md#L991-L994); [`planningAnswers.ts`](../../frontend/src/lib/planningAnswers.ts) |
| "Wait for the two agents to finish" | Valid coordination, not an error. Vantage sees saved files and review state only, so the wait is the agent's promise, and the handoff must still say what is saved and indexed now. | [`index.ts#L250`](../../packages/vantage-check/src/commands/index.ts#L250) onward (link generation knows only `.vantage/space`) |

Two existing texts already answer the OR question and the single-command rule — the printed style guide ([`styleGuide.ts#L94-L127`](../../packages/vantage-md/src/styleGuide.ts#L94-L127)) and the end-to-end handoff section of the checker guide ([Handing the human a filtered planning page](../../userguide/guides/vantage-check.md#handing-the-human-a-filtered-planning-page)). The agent did not find or trust them. That section also carries a defect: its loop says rerun until *Nothing this filter keeps needs you*, which the CLI can never reach for a question answered only in review. So the lesson is not "write a third manual"; it is correct the canonical instruction and make the two counts speak distinctly.

## 3. Two counts, two names

The tool already computes two different things; the guides use one phrase for both. This design fixes the words, not the notation.

- **Open in Markdown** — what `is:open`, the CLI `index`, and the JSON `openQuestions` report: a question whose effective state of the question or the document it refers to in the saved document is open — including a 🔒 marker whose declared blocker no longer holds — within the documents the scan read and the chosen roadmap routes; skipped documents and documents another roadmap routes are outside the count. Source of record is the file. The public filter syntax is unchanged; only the words describing the count change.
- **Waiting on you** — what the live Planning page shows after subtracting answers pending in review. Only the served app can compute it today.

Rule for every guide and for the style guide the CLI prints: a CLI count is always described as *open in Markdown*; *waiting on you* is reserved for the Planning page readout. The handoff loop's exit condition becomes "no remaining live entry under this filter asks the owner for another answer"; the agent records pending answers in the saved document promptly, reruns the CLI, and expects its count to drop — recording does not retire the CLI, it makes it agree.

## 4. The agent handoff contract (docs-first, shippable alone)

One canonical statement in the printed style guide's handoff section, cross-referenced (not restated) from the two guides. Six steps, each with the user-observable result:

1. **File before handing over.** Every decision the owner must make is a list-item question with a unique id and a `question` directive in the saved document. A table of candidate decisions is not handed over; it is converted or omitted. A confirmation of a settled ledger row is not raised unless it is a new question linking that row.
2. **Save in the served checkout.** Rulings and questions live in the files Vantage serves; a brief or chat message changes nothing ([`styleGuide.ts#L23-L38`](../../packages/vantage-md/src/styleGuide.ts#L23-L38)).
3. **Run the one combined command** in that checkout: all `path:` terms, root-anchored, plus `is:open`, exactly the shape the style guide shows. Exit 2 on an unmatched `path:` means the term matched nothing the scan saw — indexed, skipped or unreadable — so check the literal path, exclusions and scan configuration before touching frontmatter, and do not split the filter. A checker that rejects `--filter` is older than the guide: run the current checkout build or `uvx` latest honoring the repository's pin or `target`, as the checker guide already says, and never edit `target` to pass; if a viewer warns the filter is unknown, say so. If no supported checker runs, hand over direct source links to the filed questions and say no filter was generated — never fabricate one. None of this is a new prerequisite for work.
4. **Hand over the generated line, not a hand-typed one:** the Planning page link the command printed, the filter string, and the *open in Markdown* count, worded as such.
5. **Say what each command covers and does not.** Run the checker on the written sources and the roadmap for structural findings on exactly those files; then run `index`. `index` exit 0 means the scan ran, and it may still list skipped or unreadable documents. Neither command proves every decision in the prose was filed. Skipped, unreadable or unrouted documents are named as gaps, never folded into "nothing waiting".
6. **Hand over only finished, indexed state.** An agent that cannot see or has not finished a document does not list it as an owner blocker. It may say another writer is still working, but it hands over what is saved and indexed now and says the rest is not yet ready — no readiness flags, no UI lock.

Forbidden in a handoff: one filter per document when one command suffices; "open the document itself" as a substitute for filing; a `is:open` count described as waiting; asking the owner to confirm ledger rows.

## 5. Optional product safeguards (not prerequisites)

### 5.1 Filter readout wording (CLI, no new flag)

Where the text filter currently prints the Planning link and notice ([`index.ts#L452-L469`](../../packages/vantage-check/src/commands/index.ts#L452-L469)), the notice states the count as *open in Markdown* and adds one sentence: answers pending in review are not subtracted here; the Planning page shows them. On exit 2 for an unmatched `path:` term, the message says what was checked: the term matched none of the indexed, skipped or unreadable documents, and several `path:` terms combine in one filter. For a root-anchored exact literal path only — no wildcard — the message may add whether a file exists at that path inside the scan perimeter the command was already authorized to read; a pattern is reported as an unmatched pattern, never as a missing file. Whether an existing file was excluded, ignored or simply not recognized is not determined, and the message says so. Exit 2, the JSON shape and the scan perimeter are unchanged. Empty result: unchanged behavior, reworded.

### 5.2 Structural diagnostic for unfiled candidates (checker warning)

**Question candidate** *(coined here)*: a parsed structure that carries the shape of a question but no directive. The existing `vantage/oq-missing` covers one case only — an open list item with an id and a leaning ([`directives.ts#L1156-L1203`](../../packages/vantage-check/src/rules/directives.ts#L1156-L1203)). Its name is not reused; the new rule gets its own name and reports exactly two further structural cases from the shared parse, never from re-scanning prose with a regex:

- a list item whose first inline run is a 💬 or 🔒 marker followed by an OQ-shaped id, with no directive, excluding every item `vantage/oq-missing` already reports (open, id, leaning), so no occurrence is reported twice;
- a GFM table whose header row has a cell spelled `Leaning` or `Answer`, whose body rows carry an OQ-shaped id as plain text or inline code in one column, and whose first header cell is not `ID`; a row whose id is a link to a question elsewhere is a reference and is excluded.

Never reported: a table whose first header is exactly `ID` (the ledger form, and the exact ledger schema `ID | Ruling / Decision | …`), ids inside fenced code, ids that are links or inline code in prose, bare mentions in paragraphs, and ✅ items (compaction is the fix there, which other guidance owns). Stated limitation: the owner's pasted table was not seen; if its first column is `ID` this rule does not detect it. An `ID`-first table could be reported only on an explicit 💬/🔒 state at the row start plus a question-specific header; that is not proposed until a real case is surveyed. Default severity is **warning, enabled by default** ([Decision Ledger](#decision-ledger)). Compatibility: existing repositories gain findings only on the two shapes above; `--strict` will fail on warnings, so the rollout default matters. Zero candidates produces no output. The rule never edits, infers intent, or converts a table.

### 5.3 Not proposed

A review-aware CLI query ("what is actually waiting on me") would need the CLI to read local review state, which it does not have; it is deferred as its own, separately owned question. [`answer-publication.md`](answer-publication.md) ([OQ-AP1](answer-publication.md#OQ-AP1)) owns the adjacent concern of how an agent's reply outcome becomes document evidence; neither is a prerequisite for the other, and the honest wording in [§3](#3-two-counts-two-names) removes the confusion without either. No workflow lock or readiness field for concurrent writers: the tool cannot observe them, and the contract step 6 covers it. No edits to the three foreign documents.

## 6. Alternatives considered

| Alternative | Verdict |
| :--- | :--- |
| A third "agent handoff" manual | Rejected: the rule already exists twice and was not found; a third copy drifts like the others. Correct the canonical text and link to it. |
| Teach `is:open` as "waiting on you" with caveats | Rejected: it is false for review-answered questions; rename the count instead. |
| Infer that any table with OQ ids is a question list | Rejected as magical; [§5.2](#52-structural-diagnostic-for-unfiled-candidates-checker-warning) requires a `Leaning`/`Answer` header and excludes `ID`-first tables, accepting that it misses them. |
| Extend `vantage/oq-missing` in place | Rejected: silently widens an existing error's scope; a new name declares the change. |
| CLI reads review state | Deferred separately; not owned by answer-publication and not a prerequisite of anything here. |
| Do nothing beyond docs | Acceptable floor; [§5](#5-optional-product-safeguards-not-prerequisites) is explicitly optional. |

## 7. Observable acceptance

| Scenario | Expected |
| :--- | :--- |
| Three root-anchored `path:` terms plus `is:open`, all indexed | One command, exit 0; kept documents = 3; link printed once; count worded *open in Markdown*. |
| Same filter, one path indexed with zero open questions | Still kept (documents count includes it); shown entries come from the others. |
| Root-anchored literal `path:` matching no indexed, skipped or unreadable document | Exit 2 preserved; message says the term matched nothing the scan saw, adds the combine hint, and states file existence only for a literal path inside the perimeter. |
| `path:` with a wildcard matching nothing | Exit 2; reported as an unmatched pattern, never as a missing file. |
| Table with `ID` first header and OQ ids (ledger, or a question table shaped like one) | No candidate finding — stated limitation. |
| Table with `Leaning` header and OQ ids in a column, no `ID` first | One default-on candidate warning per table. |
| Open list item with id and leaning, no directive | `vantage/oq-missing` only; no second finding. |
| OQ ids in fenced code, links, inline code or prose mention | No finding. |
| 🔒 list item with id and no directive | Candidate finding; today nothing. |
| Question answered via review comment, Markdown still 💬 | CLI lists it as open in Markdown; Planning page shows it under pending answer; agent records the answer in the document and the CLI count drops on rerun. |
| Agent asked to hand over a document another writer is still editing | Contract: hand over what is saved and indexed, say that document is not ready; the wait itself is allowed. |
| Old checker rejects `--filter` | Agent runs the current checkout build or `uvx` latest honoring the repo pin; if none runs, hands over direct source links and says no filter was generated. |
| `index` exit 0 with skipped/unreadable documents | Scan ran; handoff names them as gaps, not as zero waiting. |

## Decision Ledger

| ID | Ruling / Decision | Date | Settled in | Built |
| :--- | :--- | :--- | :--- | :--- |
| OQ-AH1 | Ship the narrowly scoped question-candidate diagnostic as a default-on warning. Existing `--strict` runs can fail on new findings; the documented false-positive boundaries remain. | 2026-11-03 | [Structural diagnostic](#52-structural-diagnostic-for-unfiled-candidates-checker-warning) | No |
