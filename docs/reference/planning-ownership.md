---
title: "Planning question ownership, editing sessions and updates — the built contract"
status: accepted
stage: CURRENT
verified: 2026-11-04
verified_commit: de702313
covers:
  - internal/review/
  - internal/api/review_command_handlers.go
  - internal/api/planning_handlers.go
  - internal/api/questionscan.go
  - packages/vantage-md/src/planning/evidence.ts
  - frontend/src/lib/questionOwnership.ts
  - frontend/src/lib/commentSession.ts
  - frontend/src/lib/selectionAnchor.ts
  - frontend/src/hooks/usePlanningReviews.ts
  - frontend/src/hooks/useLegacyAutoBind.ts
  - frontend/src/components/PlanningUnresolved.tsx
  - frontend/src/components/PlanningUpdates.tsx
tags: [planning, review, comments, ownership, sessions]
summary: "What is built of the planning question-state and review-action designs: comments bound to questions by directive id with scanner proof, the evidence pair, editing sessions with server-held restore, deleted ids, Apply updates versus Reload, and selection anchors — with the HTTP contract and the parts that are not built."
---

# Planning question ownership, editing sessions and updates

This is the maintained reference for what the code does. The reasoning and the
full proposal stay in [planning-question-state.md](../design/planning-question-state.md)
and [planning-review-actions.md](../design/planning-review-actions.md); where
they and this page disagree about built behavior, this page wins, and
[§9](#9-not-built) lists what those designs still hold that is not built. The
page around all of this is [planning-index.md §6](./planning-index.md#6-the-planning-page);
the comment box's autosave is [comment-autosave.md](./comment-autosave.md).

## 1. The one rule

A comment on a planning question belongs to a question only when the shared
scanner proved it. The server runs no Markdown parser of its own; it runs the
checker and reads what it prints ([§3](#3-the-scanner-bridge)). Where the proof
is missing the comment is kept, shown, and **not** credited to any question.

## 2. Evidence: which reading a pair belongs to

| Term                  | Definition                                                                                                                            | Where             |
| :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------ | :---------------- |
| `boot_id`             | Random per server `Store`; a value from another boot is never compared with a held one                                                | `review.Evidence` |
| `document_generation` | Per (repository, document); starts at 1 and rises each time an observed content hash differs from the last one observed               | `review.Evidence` |
| `content_hash`        | First 128 bits of SHA-256 of the text the server reads (the planning scan's content hash); empty for an unreadable or binary document | `review.Evidence` |
| `mutation_revision`   | Rises in `saveLocked`, so every persisted change counts; a no-op retry does not save and does not count                               | review JSON       |

`GET /review/evidence?path=…` answers
`{boot_id, document_generation, content_hash, mutation_revision}` with
`Cache-Control: no-store`; `mutation_revision` is 0 when no review exists.
`POST /planning/reviews` ([planning-index.md §9.3](./planning-index.md#93-reviews-in-one-request))
adds to each entry `evidence: {boot_id, document_generation, content_hash,
mutation_revision, sample_changed}`; `sample_changed` is true when the content
hash read before the batch differs from the one read after it, and the pair is
then unknown. Order is by generation, equality by hash; no client sequence
number is assumed to order anything.

## 3. The scanner bridge

The server runs `vantage-check index --format json` in the repository root and
reads each question's `id`, `unitLine`, `unitEndLine` and `unitText` (the unit as
rendered). The checker is found at `$VANTAGE_CHECK`, else an executable
`vantage-check` beside the running server executable, else on `PATH`; with none
the server has **no scanner**: nothing binds, recaptures read `unknown`
(`scanner_unavailable`, for every document and not only planning ones, so no
capture refreshes), a bind answers `scanner_unavailable`, and the server logs
one warning at startup. An installed checker that does not answer is told
apart: its stdout carrying `index.refused` (over `max-candidates`; the real
checker exits 3, and the server keys on the refused JSON with any non-zero exit,
not on the number) reads `scan_refused`; a crash, timeout or unreadable answer
reads `scanner_failed`; a document written while it was scanned reads
`scan_raced`. `scanner_unavailable` means only that no checker was found, and
the page words each reason apart ("not installed", "refused", "failed", "changed
while checked"). A failed or raced scan is remembered for 5 s per (repository, path, content hash), so a failing
checker is not re-run on every write. One scan is bounded by 30 s and cached per
(repository, path, content hash); a scan costs a whole-project `index` run per
distinct document content, serialized, and keeps one document's result.

Every command that needs the document reads and scans it **after** taking the
review's lock, so the revision, the content hash and the units are one reading.

`unit_fingerprint` is the SHA-256 (first 128 bits) of the unit's file lines, each
less a trailing CR, joined by `\n`. The server computes it in `review.BuildUnit`;
the scanner computes the same in `packages/vantage-md/src/planning/evidence.ts`,
and one literal in `observation_test.go` and `planningScanEvidence.test.ts` pins
both. The scan also emits per document `ledgerIds` (ids in the first column of
tables under a "Decision Ledger" heading) and `blockLines` (anchor hash → file
line of the block, `0` where several blocks share the hash).

## 4. Ownership

### 4.1 What a comment holds

| Field                           | Meaning                                                                                                                                                                                                                                                                                         |
| :------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `question_id`                   | The directive id the comment is bound to; absent when unbound                                                                                                                                                                                                                                   |
| `question_evidence`             | `{document_generation, document_content_hash, unit_fingerprint, selected_quote}`; the fingerprint is the server's own                                                                                                                                                                           |
| `ownership`, `ownership_reason` | What the scanner proved about who owns the captured block: `proven` (the bound question's unit holds the anchor), `unowned` (the anchor lies in no question unit: a plain note) or `unknown`, with a reason: `scanner_unavailable`, `scan_refused`, `scanner_failed`, `scan_raced`, `question_not_at_anchor`, `anchor_in_unbound_question_unit` |

An id-less question owns no comments. Identity is never synthesized from a line,
a block hash or unit text.

### 4.2 Binding

- **At create** (`POST /review/comments` with `question_id`, optional
  `question_evidence` and `preconditions`): the id binds only if the scanner
  proves it names exactly one question and any given fingerprint and quote are
  about that unit. `selected_quote` is compared with the unit's rendered text
  after whitespace collapse, by containment; a checker too old to report
  `unitText` falls back to the Markdown source. Unproven — no scanner, scan
  failed, id absent or duplicated, stale `boot_id`, `document_generation` or `content_hash` — stores the comment
  **unbound**; it never fails the create. The review's `mutation_revision` is
  **not** checked on create (an unrelated write between evidence and create must
  not unbind the answer; the server proves the id itself under the lock); it is
  checked on bind.
- **`POST /review/bind-comment-question`** binds an existing comment. Body:
  `{comment_id, question_id, evidence?, preconditions: {boot_id,
document_generation, mutation_revision, content_hash}, allow_rebind?}`. Missing
  `comment_id`/`question_id` is 400; an unknown or deleted comment 404. A refused
  bind is **409** `{error, reason}` with `reason` one of `document_unreadable`,
  `boot_id`, `document_generation`, `content_hash`, `mutation_revision`
  (preconditions, checked in that order), then `scanner_unavailable`, `scan_refused`,
  `scanner_failed`, `scan_raced`, `question_id` (absent or duplicated), `unit_fingerprint`, `selected_quote`
  (proof); a comment already bound to another id is 409 `already_bound` unless
  `allow_rebind` is set (Attach). Binding to the id it already has changes
  nothing. A bound comment is never rewritten by recapture.
- **Recapture.** `captured_block` refreshes only on scanner proof: a bound
  comment when the block at the anchor lies in its question's unit; an unbound
  one only when the anchor lies outside every question unit. A legacy unbound
  comment never captures a replacing question.
- **Move.** A review moved with its file keeps bindings, evidence, sessions and
  `deleted_ids`.

### 4.3 How the page reads ownership

`ownershipMap` ([questionOwnership.ts](../../frontend/src/lib/questionOwnership.ts))
classifies every held comment against its document's **whole** scan, never the
listed or filtered subset, and is memoised on the identity of the held scan and
reviews:

| Group      | A pending comment whose…                                                                                                                                                                                       |
| :--------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bound      | id is declared exactly once; it appears on that question's card, in the counts and in Copy answers                                                                                                             |
| Unassigned | binding is absent                                                                                                                                                                                              |
| Ambiguous  | id is declared more than once; credited to no card                                                                                                                                                             |
| Removed    | id is in no directive and nowhere in the text                                                                                                                                                                  |
| Compacted  | id is in `ledgerIds` and in no directive                                                                                                                                                                       |
| Unknown    | document is not scanned, the reviews were read against another version of the document (no evidence, `sample_changed`, or `content_hash` not the scan's), or the id is written in the text outside a directive |

The header counts "M with unresolved ownership" apart from the questions that
need you, and says Unknown until every listed document's reviews are read. The
groups ([PlanningUnresolved.tsx](../../frontend/src/components/PlanningUnresolved.tsx))
carry the original quote and their own **Copy unassigned requests**; a comment is
in Copy answers or in a group, never both. Filters narrow what is displayed and
what Copy answers copies ([planning-index.md §6.7](./planning-index.md#67-answering-and-copy-answers));
they never reclassify a comment.

**Legacy auto-bind** (`useLegacyAutoBind`) binds an unbound comment only when its
anchor hash is one block of the whole document (`blockLines[hash] > 0`), that
block lies in exactly one question's unit, that id is unique, and the reading is
coherent. It sends one `bind-comment-question` per (comment, reading), carrying
the scanner fingerprint, the quote and the reading; a refusal is shown in the
server's reason and not retried until a new reading.

**Attach to question…** (Unassigned, Ambiguous, Removed, Compacted) shows the
original quote beside the chosen question's current text, preselects nothing and
binds only on Confirm, with `allow_rebind` when the comment already names a
question.

## 5. Lifecycle labels

`lifecycleOf` derives a card's label from the scan and the comments bound to it,
never from a stored verdict:

| Label                              | When                                                                     |
| :--------------------------------- | :----------------------------------------------------------------------- |
| Open                               | readable, no pending comment, not ✅                                     |
| Response saved, waiting for agent  | a bound comment is pending for the agent                                 |
| Agent replied, question still open | an unresolved bound comment has an agent reaction and nothing is pending |
| Ruling recorded                    | the directive is ✅ in the current scan                                  |
| Unknown                            | reviews not read, or the document's pairing is not coherent              |

_Compacted_ and _Removed_ name ids with no card, so they are the groups in
[§4.3](#43-how-the-page-reads-ownership), not card labels. A comment whose
`ownership` is `unknown` shows a cue beside its text on a card — "(anchor moved)"
for `question_not_at_anchor` (its question id stays proven), "(checker not
installed)", "(scan refused)", else "(ownership unknown)" —
in the review panel list and in the answer popover. A label never says an agent
reply recorded an outcome; [OQ-AP1](../design/answer-publication.md#OQ-AP1) stays open in
[answer-publication.md](../design/answer-publication.md).

## 6. Editing sessions

A session owns a root comment's text, `captured_block` and `root_text_version`,
and the coverage of its own text versions; nothing else. All endpoints are
repo-scoped, take `?path=<document>` and answer errors as `{"error": …}`.

| Endpoint                                               | Body                                           | Answer                                                                                                         |
| :----------------------------------------------------- | :--------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| `POST /review/begin-comment-session`                   | `{comment_id, session_id, shown_root_version}` | `{session: {session_id, comment_id, state, outcome?, baseline?, root_text_version, stale?, comment?}, review}` |
| `POST /review/finish-comment-session`                  | `{comment_id, session_id}`                     | same; `state: "closed"`, `outcome: "kept"`                                                                     |
| `POST /review/restore-comment-session`                 | `{comment_id, session_id}`                     | same; `outcome: "restored"` (existing root) or `"discarded"` (new root, deleted with its replies)              |
| `POST /review/comments`, `PATCH /review/comments/{id}` | adds `session_id?`                             | full review                                                                                                    |

Statuses: missing `comment_id`/`session_id` 400; unknown session, a write on a
closed session, or a deleted root **404** (no text echoed); `external_text_edit`
on restore or on a session write **409** `reason: "external_text_edit"`.

- **Begin** snapshots the baseline (text, `captured_block`, `root_text_version`,
  edit time, replies present) under the document lock, or records "did not
  exist" for a new root. Replaying a `session_id` returns the original snapshot.
  `stale: true` means the shown version differs from the server's; the box then
  shows the server text and keeps the typed buffer apart. The client sends no
  write before the ack.
- **Versions.** Every text write (create, edit, repeated create with new text)
  assigns a new random `root_text_version` and bumps `mutation_counter`; restore
  re-adopts the baseline version and bumps the counter. A root that predates
  versions has none until its next write.
- **Finish** closes the session as _kept_; a later write with that id is a 404
  (the closed-session barrier), so a session-only write can never recreate a
  deleted root. Closed records keep id, comment and outcome.
- **Restore**, in order: a closed session returns its stored outcome (replay);
  unknown session or deleted root 404; `external_text_edit` 409 with no write;
  a new-in-session root is deleted with its replies and the reply ids recorded in
  `deleted_ids`; an existing root gets the snapshot's text and `captured_block`
  back and keeps replies, reactions, resolved state and other writers' edits.
- **External edit.** A root write from another session, or with no session,
  marks the open session `external_text_edit`; it never recovers on the server,
  and the client opens a new session ("Replace with mine").
- **Delete** does not touch sessions, so a restore after a foreign delete is 404.
- **Reply coverage.** Each comment carries `reply_coverage[{reaction_index,
root_text_version?, covers}]`, derived on every save: `current` (the reply
  echoed the comment's version), `other` (a different one) or `unknown` (none,
  or the root has no version). An agent reply echoes `root_text_version` from
  the payload it read ([inbox.go](../../internal/review/inbox.go)); the server
  never stamps a reply with the current version. The page words it "reply to the
  current wording", "reply to earlier wording" or "coverage unknown"; it is not an
  outcome.

**The page** ([commentSession.ts](../../frontend/src/lib/commentSession.ts),
[commentAutosave.ts](../../frontend/src/lib/commentAutosave.ts)): begin is
retried on one session id; Escape or × on a changed box asks **Restore what you
opened?** (or **Discard this new answer?**, naming the reply count), focused on
Keep editing; Ctrl+Enter, Close and an unchanged box finish. "Unchanged" means
nothing typed differently **and** no write sent in the session. A failed restore
retries from 1 s doubling to 30 s, offers only Retry now and Copy text, and
survives the popover in a registry; 404 keeps the text; 409 shows the three texts
(theirs now, yours, opened) with Keep editing, Copy my text, Close without saving
and Replace with mine, the last behind the comparison checkbox. Reply boxes are
not sessions and keep Escape as keep. A leave guard covers a pending session
write.

## 7. Deleting an answer

`deleted_ids` on the review is the durable deletion record: `DELETE` adds the id
before persisting, even when the comment is missing (the response stays 404),
and a create or update for a recorded id is refused with 404 and writes nothing.
Entries never expire. The card's **Delete** names the replies, focuses Keep
answer, retries until the server confirms and holds the leave guard. Outside
click, navigation and Close keep the text.

## 8. Apply updates, Reload from server and selection anchors

- **Apply updates** (the header button, _N updates · Refresh_) lays the page out
  from the data in hand with no request. It is **disabled** with "Save or Restore
  the open answer first" while an open box holds changes: a session box not
  `unchanged`, or a reply box with typed text. It never saves, restores or
  deletes a session; unchanged boxes close first.
- **Reload from server** reads every listed path's review in one
  `POST …/planning/reviews` (waiting for requests in flight, discarding older
  answers) and then asks the scan store for a rescan. It adopts only a
  `document_generation` not older than the held one for the same boot; a new
  `boot_id` discards the repository's held reviews and evidence first. It touches
  no box and no painted body. A failure keeps what was held; the header then
  shows "Unknown · last successful read HH:MM · last attempt failed HH:MM", or
  "the document changed while it was read, so Reload again" for a changed sample.
- **Selection anchors.** A settled selection (mouse-up, or a keyboard selection
  quiet for 300 ms) of at least 3 characters inside one question's unit offers
  **Comment on selection**; it opens the answer box on that anchor. A headline
  selection is carried onto the hidden title block at the question's `unitLine`
  and accepted only when the scan's `blockLines` holds that block's hash at
  exactly that line. Anything else, and the leaning aside, offers **Open
  document** and creates no comment.

## 9. Not built

These stay in the designs; none is claimed above.

| Item                                                                                                                                                           | State                                                                                                                                                           | Where it is specified                                           |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| "as of <revision>" and "N shown of current M" labels | Not built. The **Newer than shown** chip is built (fingerprint, or the old size heuristic for the block, differs from what the card painted); opening one row, or unfolding one card, that carries the chip (for either cause) repaints that card's body and chip from the live scan, a refresh that lands after the layout (its generation or its filter, roadmap and page size) or that card's live reading moved on is dropped, and Apply updates repaints all. The chip is a mark in the card's top line | question-state [§5](../design/planning-question-state.md#5-user-visible-states), [§6](../design/planning-question-state.md#6-live-data-vs-applied-layout) |
| Card labels _Compacted_ and _Question removed from document_, the _duplicate id_ chip, the "Removed questions" group by that name, _Restored — …_ card wording | Not built; those cases are the unresolved groups, and the _Done_ mark of the layout is unchanged                                                                | question-state [§4](../design/planning-question-state.md#4-ownership-and-legacy-migration), [§5](../design/planning-question-state.md#5-user-visible-states)                                           |
| Change detection by the unit fingerprint                                                                                                                       | Built as an addition: a differing `unitFingerprint` marks a card; the title/marker/state/length heuristic remains for the block outside the unit                                                                                                      | question-state [§6](../design/planning-question-state.md#6-live-data-vs-applied-layout)                                               |
| Headline and leaning selections anchoring                                                                                                                      | Headline: built only when the scan holds the block at exactly that line. Leaning: not built (it is the directive's text, no block holds it)                     | review-actions                                                  |
| Legacy `blockLines` for math, raw HTML, hidden content                                                                                                         | `blockLines` hashes the parsed text, not the rendered `innerText`, so those blocks are never auto-bound; fails toward Unassigned. Not measured on a real corpus | question-state [§4](../design/planning-question-state.md#4-ownership-and-legacy-migration)                                               |
| Selected quote across source markup or a link destination                                                                                                      | Matches rendered text only; containment, not uniqueness                                                                                                         | [§4.2](#42-binding)                                             |
| Scan cost                                                                                                                                                      | A whole-project `index` run per distinct document content, serialized                                                                                           | [§3](#3-the-scanner-bridge)                                     |
| A scan failure in the Unknown pill                                                                                                                             | Only the reviews request is shown there; the scan has no generation or boot id of its own                                                                       | [§8](#8-apply-updates-reload-from-server-and-selection-anchors) |
| The changed-sample pill text at page level                                                                                                                     | Covered at hook level only                                                                                                                                      | —                                                               |
| Reply outcome enum                                                                                                                                             | Not built, by decision: [OQ-AP1](../design/answer-publication.md#OQ-AP1) is open                                                                                                                          | answer-publication                                              |
| Replies without an id on a discarded new root                                                                                                                  | Cannot be recorded in `deleted_ids`                                                                                                                             | [§6](#6-editing-sessions)                                       |

## 10. Tests

| Behavior                        | Test                                                                                                                                                                                                                   |
| :------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bind preconditions and proof    | `TestBindQuestionNeedsEveryPreconditionAndProofAndNeverRewritesABoundComment`, `TestBindThroughTheHandlerChecksIDFingerprintAndQuoteAgainstTheRealScanner`                                                             |
| Create binds only on proof      | `TestCreateBindsOnlyWhatTheScannerProves`, `TestBareCreateIsBoundOnlyWhenTheRealScannerProvesTheIDUnique`                                                                                                              |
| Recapture                       | `TestBoundRecaptureKeepsAWhenBTakesAsSlotWithSameNeighbours`, `TestLegacyUnboundCommentNeverCapturesAReplacingQuestion`                                                                                                |
| Session protocol                | `TestBeginSessionSnapshotsBaselineAndReplaysIt`, `TestRestoreIsRefusedAfterAnExternalEditAndWritesNothing`, `TestRestoreNewRootDeletesItWithRepliesAndRecordsTheID`, `TestSessionEndpointsRoundTripRestoreAndConflict` |
| Evidence                        | `TestDocumentGenerationIncreasesOnlyWhenTheHashChanges`, `TestPlanningReviewsCarryEvidence`                                                                                                                            |
| Page ownership, groups, filters | `questionOwnership` tests; `ownership under a filter` in `PlanningPage.test.tsx`                                                                                                                                       |
| Session client                  | `commentSession.test.ts`, `CommentSessionViews.test.tsx`, `CommentSessionLifecycle.test.tsx`                                                                                                                           |
| Apply guard and Reload          | `usePlanningReviews.test.ts`, `PlanningPage.test.tsx` (`Reload from server and the reply guard`)                                                                                                                       |

The real-scanner Go tests run `bun packages/vantage-check/src/main.ts` and skip
where `bun` is missing.
