---
title: Planning question state — identity, comment ownership, live vs applied, session restore
status: in-review
stage: DECIDED
next: Plan server-held editing sessions and validated source capture; then implement migration and explicit update actions
---

# Planning question state: identity, comment ownership, live vs applied, session restore

## Status (2026-11-03)

- Partly implemented: safe highlighting, question-ID ownership, scoped answer counts and clipboard context are built. The remaining protocols below are not implemented.
- The owner's live incident was not reproduced. Permanent regression tests now reproduce the confirmed stale-line mechanism, moved questions, repeated block text and duplicate question IDs.
- The integrated tests cover the document viewer, planning cards, answer counts, clipboard payloads and the shared planning scanner. Passing them is not a verification of the owner's running service.

### Partly implemented (anchor safety)

- **Built:** `resolveCommentBlock` returns only a hash-verified block (exact hash at the line, else the one same-hash block within the neighbor radius; several equal candidates are ambiguous and resolve to nothing). The highlighter shows an unmatched comment as outdated and tints no unrelated text, which **overrides the [§3.3](#3-recommendation-upfront) reading that a fallback keeps whole-document highlights**. `ReviewComment.question_id` (optional, set at creation from a planning card, never recaptured on edit) owns a comment by directive id when exactly one listed question has it. Copy answers and the layout no longer place a comment by its line; a pending comment with no owner is counted in `PendingAnswers.unplaced` and shown nowhere yet.
- **Limitation:** the server stores `question_id` as given and does not check that the id exists in the document; there is no server-side validation bridge.
- **Built (follow-up):** a hash that occurs at more than one source line anywhere in the document is ambiguous, so `resolveCommentBlock` returns nothing even when a block with that hash sits at the old line — an identical block B may have taken the place of the commented A. The comment is shown outdated, tinted nowhere, with its original quote (`fallback_text`, else `selected_text`, else `captured_block`). A comment with a `question_id` is owned only by the one question that has the id (no match or a repeated id: no owner); its anchor never gives it to another question. Legacy exact anchors on a unique hash still resolve. Identical table cells in different rows, and repeated one-line items, are now outdated for this reason.
- **Built (follow-up):** `question_id` is immutable once stored: `EditCommentText` and a repeated create naming a held id touch only `Comment`, `EditedAt` and `CapturedBlock`. `captured_block` is a per-round before/after snapshot, deliberately recaptured on a root edit, a reply and a repeated create, so the next round's diff does not credit round 1's changes.
- **Not built (backlog, next agent):** a root text edit made after the document rewrote the comment's block still recaptures whatever block sits at the old line, so the next round's "before" text can be an unrelated block B. The safe fix is a conditional capture: recapture only when same-owner is provable (for example the anchor still resolves to its own unique block). The server cannot judge that today because it has no client canonical block hash or question scope; not done in this slice, and no server bridge is added.
- **Not built:** a count of pending comments for documents whose reviews are not loaded yet (`unplaced` counts only what is held), legacy migration/backfill of `question_id`, an attach-to-question UI for unplaced comments, refresh/session restore ([§7](#7-restoring-an-editing-session)), and the server bridge.
- **Built (integration seams):** `useReviewHighlights` now enforces the question_id scope: a bound comment (question_id set) is painted only on a block inside the one question's DOM unit with that id; a missing or duplicate id in the DOM takes the outdated path, never an arbitrary block. The Take this leaning and Answer… buttons pass `question_id` to their callbacks (and on to `addComment`) when the question has a unique id in the document; a duplicate id in the DOM is treated as no id. `ownerOfComment` accepts an optional `all` parameter, and the planning page passes every raw question of the index (`allQuestionsByPath`) as a guard: a repeated id there would credit no card. The shared planning scanner assigns an ID claimed by separate question runs to neither question; aliases on the same question run still count as one declaration. Counts and Copy answers therefore cannot credit the first occurrence of an ambiguous ID, matching the viewer's conservative ownership rule. The clipboard payload (`quotedFor`) suppresses the ±2 current-line context for bound comments — the question may have moved, so the current line may hold unrelated text; the original fallback quote is kept and a label states the question id and original line instead.

## 1. In short

**In short.** Comments belong to questions, not old line numbers. An agent reply is not a document ruling, and late data changes status indicators without replacing painted content until the reader acts.

**Why.** A planning comment today is bound to a *place* (path + source line + block hash) and never to a *question*. Every reader — card rendering, pending-answer counts, Copy answers, Done marks — re-derives "which question owns this comment" from the place, through at least two different resolvers that disagree (hash-with-fallback vs line-only). Reordering or deleting a question changes places, so ownership silently changes, and different surfaces change at different times. The UI also uses one word, "Done", for "ruling recorded" and "question no longer exists", and holds painted text that is refreshed on some actions but not others.

**Cost.** Honest count of storage and contract changes. On the root comment: optional `question_id`, `question_evidence`, a semantic `root_text_version` (new value per text edit; restore re-adopts the baseline's value) and a monotonic mutation counter that only increments. On each delivered agent response: an optional `root_text_version` echoed from the copied payload (transport evidence only; the outcome enum stays with [answer-publication.md](./answer-publication.md)). Clipboard/inbox contract: Copy answers writes `root_text_version` beside each comment id; agents echo it; legacy responses without it are stored as coverage-unknown. Per editing session: one persisted record (fixed repo/doc/comment/session, server baseline snapshot, closed outcome; closed records keep id + outcome only). Per document: a server-assigned monotonic generation and a bounded cache of the shared planning scanner's output (ids, unit fingerprints, ledger ids, content hash) filled at most once per generation by calling the existing scanner/CLI — new bridge, no second Go parser. Reviews: a monotonic mutation revision. Three new server commands (bind, begin session, restore session), `session_id` on existing create/edit, one `finish` call. Frontend: one ownership map replacing three resolvers, renamed states, two named actions, an editor guard. No new store, no per-card parsing, no new agent reply outcomes.

**Start at.** Ownership binding ([§4](#4-ownership-and-legacy-migration)) — the root of the wrong-question symptom and of the counts; the restore protocol ([§7](#7-restoring-an-editing-session)) is independent and can land second.

**Needs your ruling.** None. The one real tradeoff (legacy comments that cannot be bound confidently) is resolved conservatively in [§4](#4-ownership-and-legacy-migration): show them, never guess.

## 1.1 Reads with

- [planning-review-actions.md](./planning-review-actions.md) — selection → comment, explicit deletion intents, durable deletion record, Save/Keep/Restore confirmation. Its "session-baseline restoration" item is specified **here** ([§7](#7-restoring-an-editing-session)); it should link here rather than restate.
- [answer-publication.md](./answer-publication.md) — reply outcomes ([OQ-AP1](./answer-publication.md#OQ-AP1)) stay routed there. This doc describes only the *lifecycle and wording* of pending/recorded/compacted; it does not choose an outcome schema and is not blocked on it.
- [agent-planning-handoff.md](./agent-planning-handoff.md) — accepted; default-on question-candidate warning untouched.
- [planning-index.md](../reference/planning-index.md): [§6.4 Needs you](../reference/planning-index.md#64-needs-you-as-a-to-do-list), [§6.7 Answering and Copy answers](../reference/planning-index.md#67-answering-and-copy-answers), [§12 Late data never moves painted content](../reference/planning-index.md#12-late-data-never-moves-painted-content). The owner's standing rule (2026-09-29) is kept: late data never reflows what is on screen.
- [userguide/guides/planning.md](../../userguide/guides/planning.md); [comment-autosave.md](../reference/comment-autosave.md) (shipped keep-every-close controller; [§7](#7-restoring-an-editing-session) supersedes only the cancel flavor); [review-state-architecture.md, the commands-in/state-out section](./review-state-architecture.md#6-the-right-shape-commands-in-state-out-delivery-is-an-event) for the implemented command endpoints and `review_changed` delivery (the earlier sections of that document are historical, not shipped).

## 2. Evidence: what the code does today

| Mechanism | Where | Consequence |
|---|---|---|
| Comment anchor is line + block hash + offsets only; `ReviewComment` has no question id | [types/index.ts#L171-L178](../../frontend/src/types/index.ts#L171-L178), [#L214-L234](../../frontend/src/types/index.ts#L214-L234), [models.go#L219-L231](../../internal/model/models.go#L219-L231) | Ownership can only ever be inferred |
| `resolveCommentBlock` used to fall back to the **block at the line even if its hash mismatched**, and to trust a hash match at the old line without asking whether the same hash occurs elsewhere | [reviewAnchor.ts#L278-L302](../../frontend/src/lib/reviewAnchor.ts#L278-L302), radius [#L60](../../frontend/src/lib/reviewAnchor.ts#L60) | Confirmed before the fix: after reorder a comment landed on whatever sat at its old line |
| `commentsOnQuestions` used to assign the resolved block to the nearest containing question unit whichever branch resolved it | [useOpenQuestionButtons.ts#L277-L319](../../frontend/src/hooks/useOpenQuestionButtons.ts#L277-L319), units [#L231-L273](../../frontend/src/hooks/useOpenQuestionButtons.ts#L231-L273) | A low-confidence fallback was treated as ownership |
| Unrendered cards used **line-only** `placeComment` (no hash at all); now replaced by id ownership, `ownerOfComment` | [planningPages.ts#L726-L742](../../frontend/src/lib/planningPages.ts#L726-L742), [planningLayout.ts#L207-L228](../../frontend/src/lib/planningLayout.ts#L207-L228) | Rendered and unrendered cards can disagree about the same comment |
| Pending answers trust a card's report only while `question`/`comments` are the same object; otherwise fall back to line-only | [planningAnswers.ts#L85-L153](../../frontend/src/lib/planningAnswers.ts#L85-L153), key [#L42-L46](../../frontend/src/lib/planningAnswers.ts#L42-L46) | Counts change on open/render/reload without any data change |
| Two identities: `itemKey` = path + question id (or line); `questionKey` = path + host line | [planningLayout.ts#L40-L44](../../frontend/src/lib/planningLayout.ts#L40-L44) vs [planningAnswers.ts#L42-L46](../../frontend/src/lib/planningAnswers.ts#L42-L46) | Fold state and answer state can refer to different things |
| "Done" is set when the question is gone **or** marked ✅; change detection uses title/leaning/marker/state/length, not body hash | [planningLayout.ts#L353-L404](../../frontend/src/lib/planningLayout.ts#L353-L404) | Deletion looks like a ruling; same-length edits are invisible |
| Card holds the comment prop and painted list while answering; list may be painted snapshot until opened | [PlanningQuestionCard.tsx#L790-L810](../../frontend/src/components/PlanningQuestionCard.tsx#L790-L810), [#L1049-L1096](../../frontend/src/components/PlanningQuestionCard.tsx#L1049-L1096), [#L1143](../../frontend/src/components/PlanningQuestionCard.tsx#L1143) | "Stale comments on expand" is by design but unlabeled |
| Page "refresh" closes all open boxes, waits for them to settle, recomposes from data already held; it is not a network fetch | [PlanningPage.tsx#L2615-L2654](../../frontend/src/pages/PlanningPage.tsx#L2615-L2654) | Users expect "refresh" to fetch; it does not |
| Reviews refetch per `review_changed`; last good data kept on failure; no revision pairing with the document | [usePlanningReviews.ts#L147-L236](../../frontend/src/hooks/usePlanningReviews.ts#L147-L236) | Comments and document can be from different moments |
| Pending-for-agent = unresolved and newest round not addressed/wont_fix, or reviewer edit newer than last response | [useReviewStore.ts#L96-L122](../../frontend/src/stores/useReviewStore.ts#L96-L122) | Any pending comment anywhere on a question is "an answer" (ruling 2026-10-01, kept) |
| `EditCommentText` sets `EditedAt = now` and recaptures `captured_block` at the *current* anchor line, on purpose (per-round before/after snapshot); the capture is unconditional, so after a document rewrite it can take an unrelated block | [commands.go#L91-L115](../../internal/review/commands.go#L91-L115) | A naive "restore by PATCH" re-pends the thread and may capture the wrong block |
| Delete removes the whole root incl. reactions | [commands.go#L248-L275](../../internal/review/commands.go#L248-L275) | Delete and session-cancel must stay distinct operations |

## 3. Recommendation (upfront)

1. **Bind comments to questions by the directive `id`, durably, within one repository + document.** Add optional `question_id` and `question_evidence` (document content hash, unit body fingerprint and selected quote from the shared scanner at bind time) to the comment; set on create; backfill legacy comments only when provably unique ([§4](#4-ownership-and-legacy-migration)). Cards, counts, Copy answers and marks read ownership from this binding and nothing else.
2. **No stable id means unknown.** Identity is never synthesized from a line, a block hash or unit text. A comment on an id-less question stays Unassigned until the author gives the question a directive id and the owner attaches it.
3. **The line fallback is drift display only.** `resolveCommentBlock`'s fallback keeps serving whole-document highlights; for planning ownership it yields "unknown", never a question.
4. **Duplicate or reused ids are ambiguous, never credited to a card.** Such threads sit in a document-wide *Ambiguous* group labelled with the candidate id ([§4](#4-ownership-and-legacy-migration)).
5. **Split "Done" into its real meanings.** States are derived from the current scan + review and labelled as such; none is a permanent verdict ([§5](#5-user-visible-states)).
6. **Live metadata, painted bodies, named actions.** State and counts update live; card bodies and lists repaint only on opening that card or **Apply updates**; **Reload from server** is the only fetching action; both respect an editor guard ([§6](#6-live-data-vs-applied-layout)).
7. **Session restore with a server-held baseline** and a closed-session barrier, for new and existing answers alike ([§7](#7-restoring-an-editing-session)).

## 4. Ownership and legacy migration

**Logical question identity.** A question is `repository + document + directive id`. A question unit is the source section belonging to one question; its body fingerprint is a hash of that complete source text, not of the shortened card display. That one identity key drives fold state, counts, Copy answers payload and card identity. Source line and fold are properties, never identity. A question without a directive id renders and folds by its scan position but **owns no comments**: its card says "no id — comments cannot be attached"; selection-to-comment on it creates an Unassigned comment. Ids are never reused for a different decision (authoring rule; the accepted handoff warning stays as is).

**Binding at create.** A new planning comment carries `question_id` and `question_evidence` = {document generation, document content hash, unit body fingerprint, selected quote}. The server today holds no parsed questions; the bind is validated against a **bounded cached bridge**: once per document generation the server runs the existing shared planning scanner/CLI and caches ids, unit fingerprints, ledger ids and the content hash (no second Go Markdown parser, no per-card CLI). The bind is accepted only if the review revision and document generation match the current ones, the cached content hash equals the client's, and the id occurs exactly once; otherwise the comment is stored **unbound**, never bound to an arbitrary target. `captured_block` stays a per-round snapshot (set at create, recaptured on root edit and reply; see the conditional-capture backlog in [§2](#2-evidence-what-the-code-does-today)); the comment's own anchor keeps serving drift display of the original quote. Legacy clients ignore the new fields; `null` binding is accepted indefinitely.

**Coherent pair.** Ordering uses generations only, never hashes: the server assigns a per-document monotonic generation (new) and a per-review monotonic mutation revision; both carry a server boot id, and a pair from another boot id is never compared with a held one — the client discards and reloads. Because document and review are separate files read in one batch, not atomically, the read samples the document content hash before and after; if it changed, the pair is reported *unknown* and the page offers Reload (no busy loop). Equality is by hash, order by generation; no existing client sequence number is assumed to guarantee this.

**Legacy backfill** runs in the client at most once per coherent (document generation, review revision) pair, from the shared scan, and persists only through `bind-comment-question` carrying that pair as a precondition; the server rejects a stale mapper after an intervening edit, and the next coherent read maps again.

- **Bind** only when the comment's exact block hash occurs **once in the whole scanned document**, that block lies in exactly one question unit, and that unit's id occurs exactly once. The block may have moved any distance.
- **Otherwise** (same text anywhere else, no id, duplicate id, missing capture, scan limit or unreadable document) → *Unassigned comments* for that document, with `fallback_text` and original line. Unknown scan shows "not scanned", never zero.

**Attach to question…** (owner action) lists the document's valid ids with titles, shows the comment's quote beside the target's current text, preselects nothing, and asks to confirm; the bind carries the same preconditions. A mismatch warning retains the comment.

**Duplicate / renamed / reused ids.** Duplicate id in one document: every unit with it shows a "duplicate id" chip; all threads bound to it move to the document-wide *Ambiguous: id X appears N times* group, credited to no card. Renamed id: old threads stay under the old id in *Removed questions*; explicit reattach only. Removed id reappearing: if the stored unit fingerprint equals the current one it rebinds; otherwise *Ambiguous* until reattached — body differences are not treated as proof of either edit or reuse.

**Rename / move / repo.** Binding lives inside the review; when the review moves with a renamed or relocated file the id binding is preserved unchanged. Nothing crosses repositories.

**Counts and Copy answers.** "Needs you", badges, Copy answers and filters read one ownership map per coherent pair. Filters narrow display, never recompute ownership. The header always shows two numbers: "N need you" (bound, pending, in filter) and "M with unresolved ownership" (Unassigned/Ambiguous/Removed pending threads in documents the filter keeps; question-specific text and `is:open` filters are never presumed to match them). **Copy answers** copies only bound pending comments of listed questions. The M count opens a *Review unassigned* scope and offers a separate **Copy unassigned requests** action; unknown-ownership threads are never appended to Copy answers and never credited as an answer to any question.

## 5. User-visible states

| Shown as | Meaning (factual) | Appears when | Disappears when |
|---|---|---|---|
| **Open** | Id present once, review fully read, no pending comment bound to it | coherent scan + review | a pending comment appears, or scan evidence changes |
| **Response saved — waiting for agent** | A comment bound here is pending for the agent (any part of the question) | comment saved (incl. autosave) | a reply covers its current wording/round; you resolve/dismiss; you delete it |
| **Agent replied — question still open** | Agent response covers the current wording/round; no Markdown ruling yet; your comment is not thereby recorded | covering reply arrives | you edit or follow up again (→ waiting), resolve, or ✅/ledger evidence appears |
| **Ruling recorded ✅** | The directive with this id carries ✅ in the current scan | scan | derived; follows the next coherent scan |
| **Compacted** | This exact id is in the ledger's first column and no live directive has it | scan with parsed ledger evidence | derived; a live directive with that id reappearing applies the reuse rule |
| **Question removed from document** | Id absent from directives and ledger in a readable scan; threads retained | scan | id reappears, or you Attach the threads elsewhere |
| **Unknown** | Scan limit hit, unreadable document, or duplicate id | scan | a readable, unique scan |
| **Unassigned comment** | No valid binding | create/backfill cannot bind | Attach to question… or explicit Delete |
| **Newer than shown** (chip) | Live metadata differs from this card's painted body | late data | you open this card or press Apply updates |

Rules: "Done" as a word is dropped. Every state is derived from the current scan + review, never stored as a verdict; absent evidence is Unknown, not Removed or Compacted. The scanner parses ledger first-column ids as shared evidence (no card does this itself). Dismiss/resolve removes a thread from *pending* without deleting. Explicit **Delete** physically removes the thread; only the id record remains to reject late writes — nothing is kept for recovery. Removed/compacted questions keep their non-deleted threads in review history and source, discoverable from the *Removed questions* group. The "still open" label is factual lifecycle wording; whether a reply can record an outcome stays routed in [answer-publication.md](./answer-publication.md).

## 6. Live data vs applied layout

- **Live metadata** (always fresh): pending/replied/resolved state, reply counts, chips, "Needs you" count, freshness pill. Computed from the freshest coherent (document, review) pair through the stable-id ownership map; never from the line of an older applied snapshot, and never combining an old held question with a newer review.
- **Painted body**: card text and comment list as painted at the last apply or open, labelled "as of <revision>" when live differs. Late data never changes a painted body's length or content ([the standing stability rule](../reference/planning-index.md#12-late-data-never-moves-painted-content)). Counts that disagree read "N shown of current M".
- **Change detection** uses the scanner's unit body fingerprint cached per document revision, replacing the title/length heuristic.
- **Open/close a card** repaints that card's body and list from live data and clears its chip; it never reorders, inserts or removes other cards. Height change below is inherent to folding.
- **Apply updates** (rename of today's recompose; non-network): guarded by the page's editors. If any editor on this page has buffered changes or earlier server text mutations in its session, Apply is disabled with the reason "Save or Restore the open answer first"; it never saves, restores or deletes a session itself. Unchanged editors close without rollback. No boxes elsewhere in the app are touched. Apply may move compacted/removed questions out of the active list; the *Removed questions* group keeps them discoverable.
- **Reload from server** fetches the document scan and its reviews as one batch with the before/after hash sample ([§4](#4-ownership-and-legacy-migration)) and adopts the pair only if both generations are not older than the held ones and the boot id matches; a changed sample yields *unknown* and a Reload offer; out-of-order snapshots never roll state backwards. Live metadata updates immediately; layout waits for Apply and its guard. Editor content is never replaced.
- **Active editor + late change**: the chip appears; after Save/Restore the body repaints. If the question was removed while editing, the editor stays, state reads *Question removed from document*, Save still works.
- **Offline / failed read**: the page shows one pill, "Last successful read HH:MM · last attempt failed HH:MM"; unknown counts show Unknown, not zero; documents over scan limit show "not scanned". Reconnect propagation to planning reviews is untraced here; the adopt-if-not-older rule is the contract whatever path delivers it.

## 7. Restoring an editing session

**Semantics (settled by owner).** Escape or top-right × undoes *everything this session did since the box opened*, whether the answer is new or existing. New comment → the root created in this session goes, including replies it gathered. Existing comment → text and `captured_block` return to the server-held opening snapshot; replies, reactions, resolved flag and other writers' edits are never touched. Explicit **Delete** (whole thread) stays a separate action and is never reached from Cancel.

**Session owns:** root text, root `captured_block`, root `root_text_version`, and coverage of its own text versions. Nothing else. Version-aware coverage replaces only the timestamp test for restored roots; resolved state and the existing follow-up/round rules still determine whether the agent owes a response.

**Begin.** Opening a box sends `begin-comment-session {repo, path, comment_id, session_id, shown_root_version}`; the client always fixes `comment_id` (a fresh id for a new answer), so no command ever has an ambiguous target, and every later session command carries the same repo/doc/comment/session. Under the existing document lock the server snapshots the baseline for an existing root — {text, captured_block, root_text_version, edited_at, ids of replies present and which of them carry that version} — or records "did not exist" for a new one, and acknowledges with the current root version. Replaying the same `session_id` returns the **original** snapshot; a lost ack never re-snapshots. If `shown_root_version` differs from the server's, the ack says so: the box shows the server text, and the text typed before the ack is kept as a separate buffer (Insert / Copy), never silently applied to a different root. The client makes **no write before the ack**: typing is allowed, autosave is held, the box reads "Not saving yet — retrying" with Retry and Copy text. The baseline never comes from the client.

**Writes.** Create/edit carry `session_id`; the server accepts them only while that session is open for that comment and has no `external_text_edit` conflict, assigns a new `root_text_version`, and increments the mutation counter. Any write to the root attributed to another session, or with no session (legacy client), marks our open session `external_text_edit`. Replies do not get stamped with the current version on receipt — the agent may answer a stale clipboard — they carry the `root_text_version` the agent echoed, or coverage-unknown.

**Finish (Save, or close keeping edits).** Client quiesces (flushes the last queued autosave, awaits acks), then `finish-comment-session`. The session closes with outcome *kept*; any later write with that session id is rejected with 404 (closed-session barrier; the only status legacy clients handle), and session-only writes can never recreate a deleted root. Until the finish ack arrives the box shows "Saving…", never "Saved", and does not open a second session for the same comment. Durable, no expiry; closed records retain id + outcome only.

**Cancel.** Client quiesces outstanding operations (await or abort), then `restore-comment-session {session_id}`. Server, under the document lock:

1. Session already closed → return the stored outcome and the newest comment state (idempotent replay, checked **before** anything else, so a retry after a discarded root still succeeds; a lost response never yields a permanent 409).
2. Unknown session → 404. Root deleted elsewhere → 404 without any text echo (the server cannot know unsent text); the client keeps its buffer and offers Copy text / Close.
3. `external_text_edit` set → **409 conflict**, no write, session stays open.
4. New-in-session root → delete it with its replies; record the id so a late create cannot resurrect it (reuses the durable deletion record of [planning-review-actions.md](./planning-review-actions.md)).
5. Existing root → set text and `captured_block` to the snapshot, re-adopt the baseline `root_text_version` and increment the mutation counter (never decrement). Replies that arrived after open are retained. Coverage is version-aware and replaces the timestamp-only predicate for restored roots: replies known at open to carry the baseline version keep covering it; a later reply echoing the baseline version covers it; a reply echoing another version is shown "reply to discarded wording"; a reply with no version is *coverage unknown* — neither credited to the baseline nor hidden. The card reads *Restored — agent replied to discarded wording* or *Restored — reply coverage unknown* instead of claiming the exact at-open state. Close session with outcome *restored*.

**Confirmation (mouse and keyboard alike).** "Unchanged" means no buffered changes and no earlier text mutation in this session; returning the textarea to its original spelling after an autosave is not enough. Unchanged existing text → `finish-comment-session` then close (no rollback, late replies kept; the session is never left open by a local close). Changed existing → *Restore what you opened?* Keep editing (focused) / Restore. New → *Discard this new answer?* ("including N replies" when any) Keep editing (focused) / Discard. Conflict → *Changed outside this box* with three texts (theirs now, yours, opened): Keep editing (focused) / Copy my text / Close without saving / Replace with mine — the last requires confirming the shown comparison and runs as a new session preconditioned on the shown version; no blind overwrite.

**Retries / failure.** Transient: retry 1 s doubling, cap 30 s, indefinitely; the box reads "Restore failed — retrying in Ns" with Retry now / Copy text only — editing is not offered until the outcome is known, because the commit may already have landed; the next attempt reconciles through the replay receipt and never resumes autosave on a closed session. Permanent (404/409): no automatic retry, text preserved. Component unmount: intent survives in the client registry. Page close: the standard browser prompt only (no custom wording); if the user leaves, the comment ends at whatever the server last committed (restored if the request landed, else the last autosave) and the card shows that honestly.

**Guarantees and limits.** No restore deletes an existing thread, wipes reply arrays, resets resolved/reactions, issues a whole-review PUT, or claims a pending state it cannot derive. All session commands run under the existing document lock; no distributed lock. Already-published autosaves may have been read by other tabs or the agent; the prompt says so.

## 8. Costs and alternatives

| Alternative | Verdict |
|---|---|
| Fix ownership by tightening hash matching only | Rejected: duplicates stay ambiguous; nothing is durable; counts still drift on reload |
| Identity from unit-text hash for id-less questions | Rejected: hash changes on every edit and is equal for duplicate units; not a logical identity |
| Client-supplied baseline + last-writer check for restore | Rejected: client can forge time/capture; identical text from a second writer is undetectable; late writes can land after restore |
| Treat source line as the question identity | Rejected: lines move on every edit; this is the current failure |
| Restore via PATCH of opening text | Rejected: sets `edited_at = now`, re-pends, recaptures possibly wrong block ([commands.go#L91-L115](../../internal/review/commands.go#L91-L115)) |
| Restore via whole-review PUT / timestamp rewind | Rejected: overwrites concurrent replies |
| New global viewed-document store or per-card parse | Rejected (owner constraint): reuse the shared scan and client cache |
| Choosing reply outcome schema here | Rejected: stays in [answer-publication.md](./answer-publication.md), [OQ-AP1](./answer-publication.md#OQ-AP1) |

Cost summary: see [§1](#1-in-short); additionally the shared scanner gains ledger-id and fingerprint evidence.

## 9. Acceptance scenarios (observable)

1. Comment A on question A at line 10; reorder so question B is at line 10. Card B shows no comment; card A shows comment A; "Needs you" unchanged; Copy answers lists A under A.
2. Legacy comment whose old line now holds different text: appears under *Unassigned comments* with its fallback text; no card counts it; Attach to question… moves it and the count follows.
3. Delete question A from Markdown without ✅: card shows *Question removed from document*, comments still readable; nothing shows "Done".
4. Mark question ✅: *Ruling recorded*; move to ledger: *Compacted*; comments remain on it in both states.
5. Agent replies without Markdown change: card goes *waiting* → *Agent replied*; no other card moves.
6. While a card is folded, its comment text changes elsewhere: chip appears, card does not move; opening repaints only that card.
7. Apply updates never fetches; Reload from server fetches both scan and reviews; neither changes the first visible card's top.
8. Open existing answer with a reply, type, autosave fires, press Escape → *Restore what you opened?* → Restore: opening text back, existing reply intact, pending state as derived; no Delete offered.
9. Same as 8 but the agent replied to the autosaved wording before Escape → restored text, reply kept and labelled "reply to discarded wording", card reads *Restored — agent replied to discarded wording*.
10. Same as 8 but a second tab (or a legacy client) edited meanwhile → *Changed outside this box*; the user's text stays in the editor; no automatic retry; Replace with mine requires the comparison confirm.
11. Open new answer, autosave, agent replies, Escape → *Discard this new answer? (including 1 reply)* → Discard removes root and reply; a late retried create for that id is rejected.
12. Begin fails (offline): box shows "Not saving yet — retrying", typing continues, nothing is written until the ack; Copy text works.
13. Duplicate directive ids: both units flagged; their threads appear in *Ambiguous: id X appears 2 times*, credited to no card, counted under "M with unresolved ownership", excluded from Copy answers and available through Copy unassigned requests; nothing lost.
14. Apply updates with a changed open editor: button disabled with the reason; after Save it recomposes; no box on another page closes.
15. Network down: pill shows last successful and last failed read; Unknown shown instead of zero; Reload from server clears it on success and never adopts an older pair.
16. Begin ack lost, client retries the same session id → the original baseline comes back; a root changed by another tab between open and ack → the box shows the server text and keeps the typed buffer as Insert / Copy.
17. Agent answers a stale clipboard after the user edited twice → reply shows "reply to discarded wording"; a legacy response with no version shows *coverage unknown*; neither flips the card to covered.

## 10. Risks and non-goals

**Risks.** Root cause of the owner's live incident is not proven — only one mechanism is confirmed in isolation; other causes (reconnect propagation, painted snapshots) may coexist. Backfill confidence rule may leave many legacy comments Unassigned on heavily edited documents — intended, but visible. Any writer without a session id turns a cancel into a conflict; until every client sends one, conflicts are more frequent than needed. The "did it address the baseline" judgement for late replies relies on recorded text versions; replies from before the feature lands are treated as uncertain. Reconnect propagation to planning reviews remains untraced.

**Non-goals.** No change to whole-document highlight drift behaviour outside planning ownership; no new reply-outcome schema; no change to the accepted handoff warning; no second lock or distributed coordination; no attempt to recall published autosaves; no automatic reflow of painted content.

## 11. Open questions

None filed. The legacy-binding tradeoff is settled conservatively in [§4](#4-ownership-and-legacy-migration); the rest is designer investigation, not an owner gate.