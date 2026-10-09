---
title: "Comment autosave — every comment box saves as the reviewer types"
status: accepted
stage: CURRENT
verified: 2026-10-09
verified_commit: cf28344a
covers:
  - frontend/src/lib/commentAutosave.ts
  - frontend/src/lib/reviewBoxes.ts
  - frontend/src/hooks/useCommentBox.ts
  - frontend/src/components/ReviewCommentPopover.tsx
  - frontend/src/components/CommentBoxFields.tsx
  - frontend/src/components/UnsavedComments.tsx
  - frontend/src/hooks/useReviewHighlights.ts
  - internal/review/commands.go
  - internal/api/review_command_handlers.go
tags: [review, comments, autosave, viewer, planning]
summary: "Every comment box in Vantage saves as the reviewer types and has no Save and no Cancel. A box-level controller sends one request at a time, retries a failed save for as long as the tab is open, and keeps the text through every way of leaving the box; the server makes creating a comment or a reply safe to repeat, so a retry never duplicates one."
---

# Comment autosave — every comment box saves as the reviewer types

**Status:** Verified 2026-10-09 against `cf28344a`. Built in `025852b2`; nothing in
the perimeter changed between that commit and the one verified. This document
replaces the comment-autosave half of the planning to-do list's design, whose text
is in git; the planning-page half graduated into
[`planning-index.md`](planning-index.md).

A **comment box** *(a term the to-do list design coined)* is any place a reviewer
types review text: the new-comment popover, which **Answer…** also opens on a
document and on a planning card; the edit box ✎ opens on a comment; and the reply
box, opened by **Reply** on a thread the agent has answered or by **Reopen &
Reply** on a dismissed one. Edit and reply boxes are drawn inline in the document
and in the review panel. It is not the review panel's paste box, which takes an
agent's reply rather than the reviewer's text.

Every comment box saves as the reviewer types, and has no Save and no Cancel: its
one button is **Close**, and every way of leaving it keeps the text. A saved
comment is a comment, pending for the agent from its first save; there is no draft
state ([OQ-TD10](#why-its-this-way)).

| Component | Lives in |
| :--- | :--- |
| The box controller: timing, ordering, retries, the registry of live boxes, the foot's words | `frontend/src/lib/commentAutosave.ts` (`CommentBox`, `boxesToReport`, `closeBoxes`, `liveBoxFor`, `withTypedText`, `statusText`) |
| The three kinds of box, and the requests each saves through | `frontend/src/lib/reviewBoxes.ts` (`newCommentBox`, `editCommentBox`, `replyBox`); the requests in `frontend/src/stores/useReviewStore.ts` (`saveNewComment`, `saveCommentText`, `removeComment`, `saveNewReply`, `saveReplyText`) |
| The React textarea and foot | `frontend/src/components/CommentBoxFields.tsx` (`CommentBoxTextarea`, `CommentBoxFoot`, `GoneActions`), `frontend/src/hooks/useCommentBox.ts` |
| The new-comment popover | `frontend/src/components/ReviewCommentPopover.tsx` |
| The document's inline edit and reply boxes, and the comment layer they live in | `frontend/src/hooks/useReviewHighlights.ts` (`InlineBox`, `liftBox`, `putBoxBack`) |
| The app shell's notice of unsaved comments, and the guard on leaving the tab | `frontend/src/components/UnsavedComments.tsx`, `useUnsavedCommentsGuard` in `useCommentBox.ts` |
| Safe-to-repeat creates, reply ids, reply edits | `internal/review` (`Store.AddComment`, `Store.Reply`, `Store.EditReply`, `ErrReplyNotFound`); the routes in `internal/api` (`ReviewCommentCreate`, `ReviewCommentReply`, `ReviewReplyPatch`) |

**Reads with:** [`planning-index.md`](planning-index.md) (the planning page, whose
cards answer through a comment box, and whose Refresh closes every open box first:
[§6.4](planning-index.md#64-needs-you-as-a-to-do-list)),
[`inline-markup.md`](inline-markup.md#a-comment-on-a-question-is-its-answer) (why a
comment on a question is its answer), and
[`review-state-architecture.md`](../design/review-state-architecture.md#61-reviewer-writes-become-commands)
(reviewer writes as commands, which these saves are). For readers rather than
maintainers: [Comment boxes save as you
type](../../userguide/features.md#comment-boxes-save-as-you-type).

---

## 1. The rules it keeps

### 1.1 Principles

- **Nothing typed is lost.** Every way of leaving a box saves what it holds. A save
  that fails is retried for as long as the tab is open, and no text is ever dropped
  without the reader being told.
- **A saved comment is a comment.** There is no draft state: what a box has saved is
  pending for the agent, counted as an answer and copied by Copy answers, half
  written or not ([OQ-TD10](#why-its-this-way)).
- **A box's own saves never disturb it.** The reader typing in a box never notices
  a save land: not in focus, caret, selection or scroll, in this tab or another.

### 1.2 Invariants

What a maintainer breaks by accident:

- **One box, one request in flight.** A box sends one save at a time, and typing
  while one is on its way is sent as one save after it, carrying the newest text.
- **An edit is never sent before the create it edits has landed.** The server
  answers an edit of a comment it does not hold with 404, which a box reads as *the
  comment was deleted* ([§4.3](#43-a-comment-deleted-under-its-box)).
- **One writer per comment.** Two boxes never write the same comment or reply: a
  box opened on a comment that a closed box is still saving takes that box's text
  over, or reopens it ([§4.4](#44-one-writer-per-comment)). Two writers would let
  the older one's retry land after the newer one's save.
- **Empty text is never sent.** Neither as a create nor as an edit
  ([§3.3](#33-empty-text)).
- **A create, and a reply, are safe to repeat** on the server
  ([§5](#5-the-server)), because a box retries a create whose answer it never
  heard.

---

## 2. Terms

| Term | Meaning | Not |
| :--- | :--- | :--- |
| **Comment box** | Defined above. Coined by the to-do list design. | The paste box |
| **Box controller** *(coined here)* | The view-less object, `CommentBox`, that one box's surface hands every keystroke to and that decides what to send and when. It outlives its surface: a box closed with text still to send goes on sending from it. | The textarea, which only draws its text |
| **Live box** *(coined here)* | A box controller that is open on a surface, or closed with something still to send, or whose comment was deleted with its text neither copied nor posted. The registry of live boxes is what the shell's notice, the tab's leave guard, Copy answers and the planning page's Refresh read. | Every box ever made: React may make a box it throws away, and one joins the registry only when its surface opens it |
| **Gone** | A box's state once a save was answered 404: the comment, or the reply, it saves to no longer exists. | A failed save, which is retried |

---

## 3. What a box does

### 3.1 When it saves

- **After a pause:** a save is sent when typing has paused, or after a longer
  ceiling from the first keystroke not yet saved if typing never pauses, whichever
  comes first ([Current values](#current-values)). So typing costs about one save
  a second per box, each one push and one review fetch per open tab.
- **The first save creates; every later one edits in place.** A new-comment box's
  first save creates the comment, a reply box's first save creates the reply, and
  an edit box's every save edits the comment it was opened on.
- **A reply on a dismissed comment reopens it** with its first save, as **Reopen &
  Reply** always has. While that box is open, the document's comment layer keeps
  drawing the comment among the dismissed ones, so the box does not move under the
  reader as the reopen lands.
- **A box saves to the document it was opened on.** Its target, the repository's
  API and the document's path, is fixed when it is made, whatever the page shows by
  the time a save is sent. A document followed to a new path takes its live boxes
  with it (`retargetBoxes`).

### 3.2 Every way of leaving keeps the text

**Close**, the ✕, Ctrl+Enter or ⌘+Enter, Esc, a click outside the popover, a file
switch, review mode turned off, the planning page's Refresh, and navigation each
close the box, and closing sends at once what is not yet saved. Nothing discards.
A comment is removed only by **Delete** where its comment offers it, by Undo on a
take, or by closing a new-comment box empty ([§3.3](#33-empty-text)).

- **The popover closes its box however it goes**, its own handlers or its unmount.
- **The document's comment layer closes every inline box in it** when the reader
  leaves the document.
- **A closed inline edit box shows what was typed** in the comment's place at once,
  though its save may still be on its way; the next rebuild of the layer draws what
  the server holds.
- **The document page holds back a reload while a box is open on it.** When a push
  says the document is gone, the page waits for the rename's other half before
  saying so, and then also while review mode has a box open, since the page saying
  the document is gone would end the box under the reader. It waits for the box to
  close.

### 3.3 Empty text

- **A box that holds nothing sends nothing,** so selecting all and retyping never
  stores an empty comment.
- **Closing a new-comment box empty deletes the comment it created** — also when a
  create was sent whose answer never came, since that create may have landed.
- **An emptied edit or reply box keeps what it last saved.** Closed empty, it sends
  nothing, and the comment or reply keeps its last saved text. While it is empty,
  its foot says *Empty text is not saved*.

> [!WARNING]
> **Only the box stops an empty edit of a comment.** `PATCH
> /review/comments/{id}` accepts empty text, where a create and a reply, and an
> edit of a reply, answer it with 400. A new surface that writes comment text must
> go through a box, or check for empty text itself.

### 3.4 The foot

At a box's foot, left to right: a hint, *Ctrl+Enter or Esc closes* (⌘ on Apple
systems); the box's status; and **Close**. The status reads:

| Status | When |
| :--- | :--- |
| *(nothing)* | Nothing saved yet, and nothing on its way |
| *Saving…* | A save is on its way |
| *Saved just now*, *Saved 1 min ago*, *Saved 2 h ago* | The last save landed; the words are read again as the minutes pass |
| *Empty text is not saved* | The box is empty, and something is saved that the emptiness does not touch |
| *Not saved, retrying*, in amber | The last save failed and is being retried |
| *This comment was deleted*, in amber | The box is gone ([§4.3](#43-a-comment-deleted-under-its-box)) |

Each save that lands pulses the status once; under `prefers-reduced-motion` it does
not. The status is a `role="status"` region, so a screen reader hears it change.
The inline boxes are hand-built DOM with the same classes as the React ones, so the
four kinds of box look and read alike.

---

## 4. Ordering, retries and failure

### 4.1 Retries

A failed save is retried after a short delay, then after twice as long each time,
up to a ceiling, for as long as the tab is open. The text stays in the box
meanwhile, and typing during a retry's wait is sent by that retry. A box closed
with text not yet saved hands it to the same retries. A failed request leaves the
review store as it was — no banner, and no resync — since nothing was put on screen
before the server answered; a request that succeeds adopts the review the server
answered with when it is the document on screen and nothing newer has landed.

### 4.2 What the reader is told

- **The app shell's notice** floats over the page's bottom corner, so it moves
  nothing painted. It lists the live boxes whose last save failed and is being
  retried, open or closed, as *2 comments not saved, retrying*, and the gone boxes
  whose text is neither copied nor posted, as *1 comment deleted, your text kept*.
  **Show** lists each with its label, its document and its text; **Reopen** opens a
  closed one there, holding the text it was closed with.
- **It does not flash for an ordinary pause or a save in flight.** A box closed with
  text sends it at once and is listed only if that save fails; an open box waiting
  for its pause says so at its own foot.
- **Leaving or reloading the tab asks first** whenever any text in any box is
  unsaved, a pause's included, and sends what it can as it asks, so a reader who
  stays finds it saved.

### 4.3 A comment deleted under its box

A save answered 404 is one the server can never accept: the comment, or the reply,
was deleted elsewhere while the box was open or retrying. It is not retried. The box
is gone, and its foot and the shell's notice say *This comment was deleted* and
offer:

- **Copy text,** which copies what was typed; once copied, the text no longer holds
  the tab.
- **Post as a new comment,** which files the text as a new comment and goes on
  saving it there as any new comment is saved: on the deleted comment's anchor where
  a block on screen still holds the text it was written on, else on the document as
  a whole.

Until one or the other, leaving the tab still asks first. Deleting a comment that is
already gone is done, not a failure. Every other failure keeps retrying.

### 4.4 One writer per comment

- **An edit box opened on a comment whose closed edit box is still saving reopens
  that box,** with its text, rather than starting a second writer.
- **An edit box opened on a comment another live box is writing** — an edit box
  open elsewhere, or the new-comment box that filed it — starts from that box's
  newer text, and a closed one hands over and stops sending (`retire`), so the first
  save of the new box never puts back the comment's older wording.
- **A reply box opened on a comment whose closed reply box is still saving reopens
  it,** rather than starting a second reply.
- **Two tabs editing one comment:** the last save wins, as for any reviewer write.

---

## 5. The server

Every box request is a reviewer command
([`review-state-architecture.md` §6.1](../design/review-state-architecture.md#61-reviewer-writes-become-commands)),
and the server keeps three promises for the boxes:

- **Creating a comment is safe to repeat.** The browser chooses a comment's id. A
  create naming a comment the review already holds is an edit of that comment's
  text, and nothing else about it changes; the same text again changes nothing at
  all, so a pure retry does not mark the comment edited (`Store.AddComment`).
- **A reviewer's reply carries an id the browser chose,** and replying with an id
  the comment already holds edits that reply instead of appending another, so a
  retried reply cannot duplicate it (`Store.Reply`). Replies written before ids, and
  agent reactions, carry none.
- **A reply can be edited in place,** wherever it sits in the thread and whatever
  has been added after it (`Store.EditReply`, `PATCH
  /review/comments/{id}/replies/{reply}`). An unknown comment is 404 *No comment
  found*, and a reply the comment does not hold, or one that is not the reviewer's,
  404 *No reply found*.

**An edit re-queues the thread for the agent.** Editing a comment stamps its
`edited_at`, and editing a reply stamps the reply's own `edited_at`. A comment is
pending for the agent when the last reviewer edit anywhere in its thread is later
than the agent's last answer (`isPendingForAgent`), so editing a reply the agent has
already answered makes the thread pending again, as editing the comment does. Each
edit also re-captures the anchored block, since the reviewer is reading the document
as it stands.

---

## 6. Its own saves never disturb it

A save pushes a review change to every tab, this one included, and the document page
tears its comment layer down and builds it again on every push. So before each
rebuild the layer lifts every inline box open in it out, with where its focus,
caret, selection and scroll were, and puts the same elements back into the rebuilt
layer, restoring them (`liftBox`, `putBoxBack`). A box whose comment is gone from the
rebuilt layer — deleted elsewhere, or no longer shown — is closed instead, which
keeps its text.

> [!WARNING]
> **Do not rebuild an inline box from scratch on a review change.** Restoring only
> the text was what the layer did before autosave, and with a save every second it
> would take the focus and the caret from the reader at every save, in every tab.

---

## 7. What the agent and the pages see

- **A saved comment counts from its first save,** in any tab: it is pending for the
  agent, it answers a question it sits on
  ([`inline-markup.md`](inline-markup.md#a-comment-on-a-question-is-its-answer)),
  and Copy answers copies it.
- **In the tab that holds the box, Copy answers copies the text as last typed,** not
  the text the last save carried (`withTypedText`, `typedComments`): a box whose
  comment or reply is not created yet adds it, and an empty box changes nothing.
- **The agent still sees only what is copied.** The clipboard is the only way a
  comment reaches an agent; no command or endpoint is offered to agents for reading
  reviews ([`agent-cli.md`](agent-cli.md#10-non-goals)).
- **On the planning page,** a card's Answer… box shrinks the card to an answered row
  when it closes holding text, not as it saves, and its own saves never mark the card.
  Refresh closes every open box first and waits for their saves. Another tab's
  planning page sees the answer arrive as late data, *Answered elsewhere*
  ([`planning-index.md` §6.4](planning-index.md#64-needs-you-as-a-to-do-list)).

---

## 8. Non-goals

- **No draft state** ([OQ-TD10](#why-its-this-way)). A comment half written is a
  comment.
- **No Save and no Cancel.** A comment is removed only as [§3.2](#32-every-way-of-leaving-keeps-the-text)
  says.
- **No reply or edit box on the planning page.** A question the agent answered back
  is answered again with **Answer…**, or in its document's thread.
- **No merging of two tabs' edits.** The last save wins.

---

## Current values

Verified at `cf28344a`. The prose above explains what each is for; this table is
the only place the numbers are stated.

| Value | Setting | Defined in |
| :--- | :--- | :--- |
| A save after the last keystroke | 1 s | `SAVE_PAUSE_MS` in `frontend/src/lib/commentAutosave.ts` |
| A save after the first unsaved keystroke, if typing never pauses | 5 s | `SAVE_MAX_WAIT_MS`, same file |
| A failed save's first retry, and the retries' ceiling | 1 s, doubling, up to 30 s | `RETRY_FIRST_MS`, `RETRY_MAX_MS`, same file |
| How often *Saved N min ago* is read again | 15 s | `STATUS_TICK_MS`, same file |
| The pulse when a save lands | 0.7 s | `.comment-box-status--pulse` in `frontend/src/index.css` |
| Create a comment | `POST /review/comments`, `{id, comment, anchor, fallback_text, created_at}` | `ReviewCommentCreate` in `internal/api/review_command_handlers.go` |
| Edit a comment's text | `PATCH /review/comments/{id}`, `{comment}` | `ReviewCommentPatch`, same file |
| Reply, and reopen with a reply | `POST /review/comments/{id}/replies`, `…/reopen-reply`, `{id, text}` | `ReviewCommentReply`, `ReviewCommentReopenReply`, same file |
| Edit a reply | `PATCH /review/comments/{id}/replies/{reply}`, `{text}` | `ReviewReplyPatch`, same file; the route in `internal/api/routes.go` |
| A reviewer reply's id and edit time | `id`, `edited_at` on `CommentReaction` | `internal/model/models.go` |

---

## Why it's this way

Rulings a maintainer reading only the text above might undo on purpose.
[OQ-TD10](#why-its-this-way) ruled both halves of the to-do list design; its planning-page half is also in
[`planning-index.md`](planning-index.md#why-its-this-way). The other rows clarified
it on 2026-10-09.

| ID | Ruling | Date |
| :--- | :--- | :--- |
| OQ-TD10 | Comments save as you type, with a *Saved* indicator and a Close button, no Save, no Cancel and no draft state: Copy answers copies what is saved. A half-typed answer reaching an agent through Copy answers in another tab is accepted ([§1.1](#11-principles), [§7](#7-what-the-agent-and-the-pages-see)) | 2026-10-08 |
| — | An emptied reply box keeps its reply, as an emptied edit box keeps its comment: closing it empty sends nothing, and the reply keeps its last saved text. Only a new-comment box closed empty deletes what it created ([§3.3](#33-empty-text)) | 2026-10-09 |
| — | The shell's notice is for failed saves, not for unsaved text: an ordinary pause or a save in flight never shows it, since listing every close while its save is on its way would flash it at each one. Leaving the tab still asks whenever any text is unsaved ([§4.2](#42-what-the-reader-is-told)) | 2026-10-09 |
| — | A save whose comment was deleted stops retrying, since no retry can succeed, and offers the text back: Copy text, or Post as a new comment. Retrying a 404 forever would hold the tab's leave guard with no way out ([§4.3](#43-a-comment-deleted-under-its-box)) | 2026-10-09 |
