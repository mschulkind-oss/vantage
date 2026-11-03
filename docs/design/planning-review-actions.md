---
title: "Always-on review for planning questions — and a way to actually delete an answer"
status: in-review
stage: DESIGN
next: "Rule OQ-PRA1 (does Escape/× also ask when editing a stored answer?); then review the deletion-record proposal in Ordering, failure and recovery"
---

# Always-on review for planning questions — and a way to actually delete an answer

**Status:** 2026-11-03. Nothing built. Code evidence verified against `01837a0a` on 2026-11-03; the planning card, popover, autosave controller, store and backend delete command are cited as shipped behavior. The three owner directions are the ledger rows; every other decision here is a recommendation awaiting the owner's review.

> **In short.** The planning card gets a *scoped* selection-to-comment capability (reusing the viewer's anchor algorithm, not its review mode), and an answer gets a real **Delete**. Escape and × on a *new* answer ask "delete or save?"; every other way of leaving keeps the text — and keeping is never a trap, because every kept answer can be deleted afterwards.

**Why it matters.** Today a question can only be answered as a whole block or via the full document in review mode; and once autosave has stored an answer, nothing on the planning page can remove it — Escape, ×, outside click, and a blanked Edit all keep it ([The gap today](#the-gap-today)).

**Cost.** One confirmation step on Escape/× for a new answer; a Delete on comment rows; one new controller-level operation — an explicit deletion intent composing the existing retire/quiesce and remove steps; and one small backend contract extension — a per-comment-id deletion record kept with the review data, so a late create can never resurrect a deleted answer. Nothing deleted from the shipped review system.

**Start at [Actions](#actions-what-each-way-of-leaving-does)** — the behavior table; [Ordering, failure and recovery](#ordering-failure-and-recovery) is what makes it safe.

**Needs your ruling:** [OQ-PRA1](#OQ-PRA1).

**Reads with:** [`comment-autosave.md`](../reference/comment-autosave.md) (shipped keep/flush semantics this builds on), [`planning-index.md`](../reference/planning-index.md) (cards and stable paint), [`planning.md`](../../userguide/guides/planning.md) ("a comment on a question is your answer"), [`answer-publication.md`](answer-publication.md) (independent proposal; not a prerequisite and not assumed).

---

## Verdict and principles

Build both requests as one change to the planning card's answer lifecycle, at the smallest state surface:

- **P1 — Review is a capability, not a mode.** Selecting words inside a question yields a comment on those words without toggling review mode or opening the document. The card gains a scoped selection capability; the global review store's single-viewed-document state is untouched.
- **P2 — Keeping is the default; deletion is explicit.** Only Escape and × on a *new* answer ask. Outside click, navigation, refresh and tab close keep, as shipped. No single keystroke destroys text.
- **P3 — Every stored answer is deletable afterwards.** Delete is a first-class action on a comment row, independent of empty-text behavior. This is what makes P2 safe.
- **P4 — Save is flush-and-finish, not publication.** Autosave stays. "Save" means: flush pending text, close the box, show the answer row. It does not change who can already see the text ([Visibility](#visibility-what-save-does-not-change)).
- **P5 — Markdown is never written for the user.** Deleting an answer changes review state only; question directives and planning metadata are untouched. Waiting state is recomputed from the comments that remain.

### Non-goals

- No new review system, no second Markdown renderer or parser, no inline highlights inside planning cards.
- No change to agent-side publication semantics (that is [`answer-publication.md`](answer-publication.md), [OQ-AP1](answer-publication.md#OQ-AP1)).
- No "revert my edit to the previous text" for an existing answer (edits autosave; a revert needs original-text capture and is a later, separate addition).
- No reply-only deletion: an agent reply cannot be removed on its own. Deleting an answer removes its whole thread, replies included, and says so ([Actions](#actions-what-each-way-of-leaving-does)). No mass deletion and no cross-target side effects: the planning page intentionally shows cards from many documents, and each Delete addresses exactly one comment in its own card's source document.

## The gap today

| Shipped behavior | Evidence |
| :--- | :--- |
| The card embeds the question's Markdown with `embedded=true`; embedded mode has no review mode, comments, highlights or popover, and hard-disables `isReviewMode`. Forcing it on is unsafe because the global store holds one viewed document while planning embeds several. | [`MarkdownViewer.tsx#L68-L97`](../../frontend/src/components/MarkdownViewer.tsx#L68-L97) (`embedded` contract), [`MarkdownViewer.tsx#L187-L190`](../../frontend/src/components/MarkdownViewer.tsx#L187-L190) (hard-disable); [`PlanningQuestionCard.tsx#L1225-L1231`](../../frontend/src/components/PlanningQuestionCard.tsx#L1225-L1231) (embed) |
| The viewer already has a complete selection→anchor algorithm (block by `data-source-line`, `block_text_hash`, `selection_offset/length`, minimum 3 characters, clamp to starting block with a warning), listening on `mouseup` only. | [`MarkdownViewer.tsx#L459-L511`](../../frontend/src/components/MarkdownViewer.tsx#L459-L511) (anchor), [`MarkdownViewer.tsx#L520-L578`](../../frontend/src/components/MarkdownViewer.tsx#L520-L578) (listener) |
| The headline a user reads is **not** a source-backed node: `markCardParts` hides the original strong title with `data-card-part`, and the card draws a synthetic `h3` from `question.title`. The body blocks are source-backed and may be clamped until expanded. | [`planningCardParts.ts#L230`](../../frontend/src/lib/planningCardParts.ts#L230) (`markCardParts`, from this line on); [`PlanningQuestionCard.tsx#L635-L651`](../../frontend/src/components/PlanningQuestionCard.tsx#L635-L651) (synthetic headline) |
| A new answer is a `newCommentBox` with fixed `reviewTarget(question.path)` and a whole-block anchor; new answers and edits share `ReviewCommentPopover`. The list offers Edit; the only delete path is the whole-thread Undo on **Take**. | [`PlanningQuestionCard.tsx#L1095-L1129`](../../frontend/src/components/PlanningQuestionCard.tsx#L1095-L1129), [`PlanningQuestionCard.tsx#L1475-L1502`](../../frontend/src/components/PlanningQuestionCard.tsx#L1475-L1502) |
| Every way of closing the popover — footer Close, ×, Escape, outside mousedown, unmount — keeps text; there is no Save/Cancel/Delete. A duplicate document-level Escape listener exists. | [`ReviewCommentPopover.tsx#L44-L91`](../../frontend/src/components/ReviewCommentPopover.tsx#L44-L91); [`CommentBoxFields.tsx#L27-L49`](../../frontend/src/components/CommentBoxFields.tsx#L27-L49), [`CommentBoxFields.tsx#L79-L116`](../../frontend/src/components/CommentBoxFields.tsx#L79-L116) |
| Autosave: 1000 ms pause / 5000 ms max wait; retry 1000 ms doubling to 30000 ms; one writer per comment, one request in flight; the controller outlives the UI and flushes nonempty text on close. There is **no discard/delete** on a controller; `remove` exists only for a new box closed empty. `editCommentBox` has no `remove`. A create retried with the same id upserts. | [`commentAutosave.ts#L25-L32`](../../frontend/src/lib/commentAutosave.ts#L25-L32); [`reviewBoxes.ts#L93-L139`](../../frontend/src/lib/reviewBoxes.ts#L93-L139) |
| The store already has `removeComment(target,id)` (fixed base, safe) and `deleteCommentFrom(path,id)` (derives the *current* base — unsafe after a repository switch). | [`useReviewStore.ts#L354-L440`](../../frontend/src/stores/useReviewStore.ts#L354-L440) |
| Backend `DeleteComment` takes the per-document lock, returns `ErrCommentNotFound` when the document has no review or the id is absent, removes the **entire root object** (replies and reactions included) and persists. The API handler delegates to it. Nothing records that an id was deleted, so a late create for that id is accepted. | [`commands.go#L248-L275`](../../internal/review/commands.go#L248-L275); [`review_command_handlers.go#L221-L227`](../../internal/api/review_command_handlers.go#L221-L227) |

Net: the owner's two complaints are one missing operation (delete a stored answer, from the card and from an abandoned new box) plus one missing capability (selection comments on the card). Most of the machinery exists. The one server gap is that nothing stops a late create from re-inserting an id that was just deleted; closing it is the only backend change proposed.

## Selection comments on the card

**Question unit** *(coined here)*: the parts of one question the card renders from the question's own source text — the headline, the leaning when the source carries one, and the body blocks — excluding hidden sibling questions, the card's controls and comment list, and other cards.

- **Source-backed mapping.** Every selectable node in the unit mirrors source text that also exists in the full document. Body blocks already do. The headline is a synthetic `h3` while the original strong title is hidden, so the synthetic headline (and a rendered leaning) carries a mapping to its hidden original node — same `source_line`, same canonical block text — and a selection on it resolves to the anchor the full document would produce. Card text with no source node (index-only preview, fallback headline, truncation marker) gets **no fabricated anchor**: the affordance reads **Open document** instead.
- **Canonical text.** `block_text_hash`, `selection_offset` and `selection_length` are computed by the full viewer's **existing** canonicalizer over the source block and must include exactly what that canonicalizer includes in the full document — the original title, the status marker and any other source text the card removes only for presentation — while excluding review-UI nodes as the existing helper already does. No independent canonicalizer; never clamped or rearranged presentation text. A selection on clamped body text maps its offsets back into the full block. `source_line` keeps including `card.lineOffset`. This is what keeps card-made anchors identical to document-made ones.
- **Mechanism.** Extract the viewer's anchor algorithm (block resolution by `data-source-line`, canonical hash and offsets, 3-character minimum, clamp-to-starting-block with the shipped warning) into a shared helper used by viewer and card. The card owns its own container and listener; nothing is written to the global store's viewed-document state.
- **Settled selection.** Acted on when `mouseup` lands with both endpoints inside the unit, or a keyboard selection ends (Shift released, or `selectionchange` quiet for 300 ms) with both endpoints inside the unit. A selection touching anything outside the unit — another card, controls, a hidden sibling — is ignored, not clipped.
- **Captured anchor.** On settling, the card resolves the anchor and keeps it. Focusing the affordance collapses the browser selection; the captured anchor survives until activated or discarded. Discard: a new settled selection, a click inside the unit that collapses the selection, card collapse, or Escape while the affordance is focused.
- **Affordance, not auto-open.** A captured anchor shows a small **Comment on selection** button adjacent to the selection end, focusable and next in Tab order after the unit; plain copying never opens a box. Click, Enter or Space opens the answer box with the captured anchor. When the mapping is uncertain (no source node, or the hash disagrees with the canonical block) the button reads **Open document** and opens the full document at the question with the selection — never a silent fallback to a whole-question anchor. One box per card: the button is hidden while a box is open.
- **Consequence for answers.** The comment is created exactly as a whole-block answer is today (`newCommentBox`, `reviewTarget(question.path)`), differing only in anchor, so it is the question's answer, pending for the agent, in the same list and waiting state. Showing the selected words in the row is the implementer's choice.

## Actions: what each way of leaving does

Three states of an answer: **new** (box opened from Answer or Comment on selection, comment not yet stored or stored only by autosave in this box's lifetime), **saved** (a row in the comment list), **edited** (saved answer reopened in the edit box). "Empty" means no non-whitespace characters.

| Action | New answer, empty | New answer, nonempty | Edited answer, nonempty | Edited answer, blanked | Saved answer (row) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Escape** | Close, remove (shipped) | **Ask: Delete / Save** | Close, keep (shipped) | Close, previous text kept (shipped) + hint | — |
| **× (top right)** | Close, remove | **Ask: Delete / Save** | Close, keep | Close, previous text kept + hint | — |
| **Save** (footer, Ctrl/⌘+Enter) | Close, remove | Flush, close, show row | Flush, close | Close, previous text kept + hint | — |
| **Delete** (footer / row) | n/a (nothing stored) | **Ask**, then retire and delete | **Ask**, then delete thread | **Ask**, then delete thread | **Ask** (anchored dialog), then delete thread |
| **Outside click** | Close, remove | Flush, close, show row | Flush, close | Close, previous text kept | — |
| **Navigate (SPA)** | Nothing stored | Flush continues (shipped); row present on return | Flush continues | Previous text kept | pending delete continues |
| **Reload / tab close** | Nothing stored | Flush attempted (shipped); leave prompt if pending | same | Previous text kept | leave prompt if a delete is pending |

Notes that bind the table:

- **Scope of the popover change.** The Save/Delete footer, the Escape/× prompt and the blank-edit hint apply to **planning answer boxes only** — new-answer and edit boxes opened from a card — as a per-box flavor of the shared popover. The document viewer's selection, reply and edit boxes keep today's Close/Escape behavior; changing them is a separate decision, not a side effect of this one.
- The footer's **Close** becomes **Save** for planning boxes, keeping Ctrl/⌘+Enter; the footer wording no longer says Escape closes. The footer gains **Delete** (secondary styling).
- **Save is honest.** Save closes the box at once; the row reads *Saving…* until the flush succeeds, and *Save failed — retrying* (shipped backoff) if it does not. It never reads Saved before the server confirmed.
- **Hint** on a blanked edit: *"Blank text keeps the previous answer — use Delete to remove it."* It appears as soon as the text is blank, stays while it is blank, and is repeated as a shell notice on close so it remains actionable after the box is gone. The shipped empty-edit rule is unchanged.
- **Edit boxes keep on Escape/× — open as [OQ-PRA1](#OQ-PRA1), not an owner direction.** The owner asked that Escape and × ask generally. For a *stored* answer this doc recommends the opposite: Escape and × keep (today's behavior) and removal is the explicit row or footer Delete. The trade-off: asking on edits would offer to delete a stored, possibly replied, answer on a reflexive keystroke and nag the common glance-and-close path; explicit Delete gives the same removal on purpose. If the owner prefers asking on edits too, the prompt in [Confirmation](#confirmation-and-keyboard-contract) applies unchanged with Save as the keep path.
- A **dismissed** comment is still a row the user authored; it gets Delete too. Deleting it never changes waiting state (it was not pending).
- **Replied thread.** Deleting an answer that has agent replies removes the whole thread — the server deletes the root object with its replies and reactions — and the confirmation says so: *"Delete this answer and its N replies?"* This is the only way replies are removed; there is no reply-only delete. The default-focused button is the keep path, so a thread is never lost by a stray Enter.
- **Waiting state after delete** is recomputed from the remaining comments: if another pending comment on this question remains, the card stays *Answered — waiting on the agent*; otherwise it returns to the open-question row. Markdown is untouched (P5).

## Confirmation and keyboard contract

Two surfaces, one contract; never a browser `confirm()`. **In a box** (new or edit) the prompt is rendered inside the popover in place of the footer; the popover may grow by one row, but the card and the other rows do not move. **On a row** no popover exists, so the prompt is a small anchored dialog opened beside the row's Delete control, positioned so the row itself does not move.

| Element | In a box (Escape, ×, footer Delete) | On a row (row Delete) |
| :--- | :--- | :--- |
| Role and name | `role="dialog"`, `aria-modal="true"`, labelled by its prompt text | same |
| Prompt | *"Delete this answer?"*; adds *"It has already been autosaved."* once a create succeeded; *"…and its N replies?"* when replies exist | *"Delete this answer?"* / *"Delete this answer and its N replies?"* |
| Buttons, in order | **Save** (default) · **Delete** (destructive styling) | **Keep answer** (default) · **Delete** |
| Initial focus | Save — a second Escape never deletes | Keep answer |
| Tab / Shift+Tab | cycles the two buttons only while the prompt is shown | same |
| Enter / Space | activates the focused button | same |
| Escape | returns to editing: prompt closes, focus to the textarea at its previous caret; nothing deleted | cancels: dialog closes, focus to the row's Delete control; nothing deleted |
| Outside click | returns to editing (box stays open); nothing saved or deleted by the click itself | cancels — it never saves, opens or edits anything |
| Keep path | Save: flush, close, show row; focus → that row's **Edit** | Keep answer: dialog closes; focus → the row's **Delete** |
| Delete | runs the deletion intent in [Ordering](#ordering-failure-and-recovery); focus → the question's **Answer** button, or the next row's Edit if rows remain | same |
| Delete fails | prompt closes; the row shows the failure state from Ordering with focus on it | same |
| Mouse / keyboard | fully operable with either alone | same |
| Escape handlers | exactly one handler decides per keypress: while a planning box or prompt is open, that handler owns Escape and stops propagation, and the document-level listener ignores Escape. No cascade from "ask" through to "close". | same |

## Ordering, failure and recovery

Two client-side facts must be kept apart. **Client-known success**: a 2xx for the create arrived. **Ambiguous write**: the create was sent and its promise rejected, timed out or was aborted — the server may still process it later, including *after* a `DELETE` that answered `404`. No client-side waiting, flag or fixed id can rule that out, so ordering is enforced on the server by a small contract extension.

**Deletion record** *(coined here)*: a per-document set of comment ids that have been deleted, stored with the review data and written under the same per-document lock `DeleteComment` already takes. It is a durable server fact, not a local flag.

1. **Server contract (extension).** `DELETE` for an id adds the id to the document's deletion record *before* persisting, whether or not the comment exists (a document with no review gets a review holding only the record); the response shape is kept, so a missing id still answers `404`. A create or update whose id is in the record is refused with `404` — the same answer a missing comment gets today — and writes nothing. Entries never expire — the cost is one id per deletion, persisted with the review, surviving restarts and travelling with the review on a document move. Ids are never reused: **Post as new** always mints a fresh id. The existing delete endpoint remains the single entry point; no other endpoint or lock is added.
2. **Compatibility.** `404` rather than `410` is deliberate: the shipped client's gone detection recognizes only `404` ([`commentAutosave.ts#L122-L125`](../../frontend/src/lib/commentAutosave.ts#L122-L125)) and its send path handles only that case ([`commentAutosave.ts#L399`](../../frontend/src/lib/commentAutosave.ts#L399)), so a `410` would leave a pre-change client retrying indefinitely with a visible failure. With `404`, a pre-change client retrying a create or update for a deleted id stops on its existing gone path (Copy text / Post as new) and nothing is resurrected; new clients use the same path, so "gone" and "deleted" are one case.
3. **One deletion intent.** Every entry point — new-box Escape/×/Delete, edit-box Delete, row Delete — runs the same **deletion intent**, keyed by (repository base, document path, comment id): look up any local controller for that key in the registry and **retire** it — the existing operation at [`commentAutosave.ts#L279-L286`](../../frontend/src/lib/commentAutosave.ts#L279-L286) — (cancel timers; drop queued creates and updates; mark retired so a late success callback neither marks the answer kept, opens the list, calls `onAnswered`, nor adopts the box text), then send `DELETE` through `removeComment(target,id)` with the fixed base — `deleteCommentFrom` is not used. This covers a row deleted while its closed controller is still retrying, and an edit in flight.
4. **In flight.** If a request for that id is in flight, the `DELETE` waits behind it (one request in flight per controller) and goes when it settles — success, failure or abort. Correctness no longer depends on that order; the wait only preserves the one-writer rule.
5. **Nothing sent yet.** If no create was ever sent, retire removes the local box and sends nothing (today's empty-close path).
6. **Success.** A 2xx or `404` on `DELETE` completes the intent: remove the row, recompute waiting state from the remaining comments (dismissed excluded), and let the existing push inform other tabs. The server's `404` still wrote the record, so a late create is refused.
7. **Transient failure** (network, 5xx, timeout): retry **indefinitely** with the shipped 1000 ms doubling to 30000 ms, one in flight. The row stays, muted, without Edit, reading *Delete failed — retrying in Ns* with a **Retry now** control; the shell notice says the same. Nothing ever reads a plain *Deleting…* after a failed attempt.
8. **Permanent failure** (401/403, 400 invalid path, document gone): stop retrying; restore the row with Edit and Delete, show the server's reason on the row, and offer **Retry** and **Open document**. Local text is never discarded until the server confirmed deletion.
9. **Leaving.** A pending delete registers in the same leave-guard registry as a pending autosave, survives component unmount, and continues across SPA navigation. On full reload or tab close the browser's leave prompt fires while a delete is pending; if the user leaves anyway the intent is lost with the tab's memory and the row may be back on return, to be deleted again. No persisted intent is kept; this limitation is accepted and stated rather than hidden.
10. **Other tabs.** A tab with the comment open in an edit box gets `404` on its next update and takes the shipped gone path; its create retries for the old id are refused by the record; its **Post as new** gets a fresh id. A thread deleted under an open reply box behaves the same way.
11. **Thread and documents.** Deleting a root deletes its replies and reactions with it (shipped server behavior); the prompt names the reply count. Everything above is per `reviewTarget`; deleting on one card never touches another card's controller or comments.

## Visibility: what Save does not change

Half-typed answers **remain externally visible** exactly as shipped: the first nonempty autosave (≈1 s after typing pauses) creates the comment, marks the question pending, and appears in Copy answers and other tabs. Save adds nothing to that; it flushes and closes. The practical window in which an agent could read an answer the user then deletes is therefore seconds to minutes. Delete prevents *future* copying and reading; it cannot recall text an agent or another tab has already read or copied. Holding publication until Save would be a draft state on the server and a change to what "pending" means — a different proposal, not this one.

## Alternatives considered

| Alternative | Verdict |
| :--- | :--- |
| Force `isReviewMode=true` on embedded viewers | **Rejected.** Global store holds one document; planning embeds several; drags across cards would misattach. |
| Open the full document in review mode on selection | **Rejected.** Fails the request (no page switch), and loses the card context. |
| Auto-open the box on any selection | **Rejected.** Breaks ordinary copy and link use; the affordance button costs one click. |
| Escape/× also ask on edit boxes (the owner's general wording) | **Not recommended; open as [OQ-PRA1](#OQ-PRA1).** A stored, possibly replied, answer would be offered for deletion on a reflexive keystroke; row Delete removes it on purpose. The prompt is ready if the owner wants it on edits. |
| Outside click also asks | **Rejected.** Turns every stray click into a modal; P3 makes keeping safe instead. |
| Blank text on edit deletes the answer | **Rejected.** Reverses a shipped rule (empty edit preserves text) and hides deletion behind an accident; explicit Delete plus a hint is clearer. |
| Delete disabled once the agent has replied | **Rejected.** Owner needs removal; the confirmation names the replies instead. |
| Hold publication until Save (server draft state) | **Rejected / out of scope.** New server state; changes "pending" semantics; owner did not ask to remove autosave. |
| Browser `confirm()` dialog | **Rejected.** Not focus-controllable, inconsistent styling, and interacts badly with the duplicate Escape listener. |
| Client-only ordering: local flag, wait for the create to settle, then `DELETE` | **Rejected.** A rejected or timed-out promise does not prove the server skipped the create; a late create after a `404` delete resurrects the answer. Only a server-side record closes it. |
| Expire deletion-record entries after a period | **Rejected.** Saves bytes and reopens the race after expiry; one id per deletion is cheap and bounded by the number of deletions. |
| Persist pending delete intents across reload | **Rejected for v1.** A leave prompt plus "delete again on return" is honest and cheap; persisted intents need their own replay and cleanup rules. |

## Acceptance scenarios (observable)

1. Select at least three characters in a collapsed question's visible body on the planning page; a **Comment on selection** button appears; Enter opens a box; typing and Save produce a row, the card shows *Answered — waiting on the agent*, and the same comment in the full document anchors to exactly those characters.
2. Select words in the card's headline (and in a rendered leaning where the source has one): the comment anchors to the original title/leaning line in the full document. On an index-only preview with no source node, the button reads **Open document** and no comment is created from the card.
3. Drag from one card into another, or from a question into its controls: no button appears. Select text and copy: no box opens.
4. Keyboard-only: Shift+arrows select text, Tab reaches the button (selection highlight collapses, button stays), Enter opens the box with the selected words as anchor; type; Escape → prompt with focus on Save; Tab → Delete; Enter → box closes. Online, no row and no notice remain once the server confirmed; offline, the row shows *Delete failed — retrying in Ns* until it does.
5. Type in a new answer, wait 2 s (autosave fired), Escape, Delete: no row remains, waiting state is recomputed from the remaining comments (back to open if this was the only pending one), and another tab sees the comment appear and then vanish; a stale create retry from that tab is refused and nothing reappears.
6. Type, Escape, Escape: box returns to editing with text intact; nothing deleted.
7. Type, click elsewhere on the page: row appears with Edit and Delete; Delete → anchored dialog with focus on **Keep answer**; click outside → dialog closes, row unchanged; Delete again → Delete removes it and the question returns to open.
8. Two pending comments on one question; delete one: card stays *Answered — waiting on the agent*.
9. Answer with two agent replies; the prompt reads "and its 2 replies"; Keep answer (default) leaves everything; Delete removes the thread.
10. Edit an existing answer, blank it: hint appears at once; Escape: previous text kept, hint repeated as a notice; no prompt.
11. Go offline, delete a saved answer: row muted with *Delete failed — retrying in Ns* and **Retry now**; back online the row disappears without a second click. Reload while offline: leave prompt fires; leaving anyway shows the row again on return.
12. Delete a saved answer while another tab is mid-edit of it: that tab's next update gets `404` and offers Copy text / Post as new; Post as new creates a comment with a fresh id.
13. Refresh mid-typing a new answer: text already acknowledged by autosave is a row with Delete available on return. Unsent text triggers the leave prompt; leaving anyway may lose those last keystrokes — no claim is made that an unacknowledged save always reaches the server.

## Open Questions

1. 💬 **OQ-PRA1: Should Escape and × also ask "delete or save?" when editing an answer that is already stored?**

   Priya starts an answer and presses Escape: the box asks *Delete / Save*. Later she opens Edit on that saved answer, now with an agent reply, and presses Escape. Today closing keeps text; should the requested confirmation apply here too?

   - **A — Ask on both.** Every Escape/× prompts, with Save focused; deleting a replied answer removes its thread.
   - **B — Ask on new answers only.** Edit closes and keeps; use the row or footer Delete to confirm removal.

   <!-- vantage: question id=OQ-PRA1 leaning="B — a stored, possibly replied answer should not be offered for deletion by a reflexive keystroke; explicit Delete gives the same removal on purpose." -->

   _Leaning:_ B — a stored, possibly replied answer should not be offered for deletion by a reflexive keystroke; explicit Delete gives the same removal on purpose.

   **Answer:**
   > _(empty — fill in when decided)_

## Decision Ledger

Only owner directions are recorded here. Everything else in this document — the edit-box Escape exception ([OQ-PRA1](#OQ-PRA1)), outside-click and leave behavior, the thread-deletion prompt, the deletion record — is a proposal awaiting the owner's review and is described in the body, not settled.

| ID | Ruling / Decision | Date | Settled in | Built |
| :--- | :--- | :--- | :--- | :--- |
| D1 | The planning page always offers review: selecting words of a question lets the user comment on those words without toggling review mode or opening the document. | 2026-11-03 | [Selection comments on the card](#selection-comments-on-the-card) | No |
| D2 | An already-stored answer must be removable from the card with an explicit Delete, not merely dismissed or blanked. | 2026-11-03 | [Actions: what each way of leaving does](#actions-what-each-way-of-leaving-does) | No |
| D3 | Escape and the top-right × on an answer box ask whether to delete, confirmed by a Delete button, with Save as the keep path; the whole flow is mouse- and keyboard-operable. The owner stated this generally; whether it also applies to editing a stored answer is [OQ-PRA1](#OQ-PRA1). | 2026-11-03 | [Confirmation and keyboard contract](#confirmation-and-keyboard-contract) | No |