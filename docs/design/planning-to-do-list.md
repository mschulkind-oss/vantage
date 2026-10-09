---
title: "The planning page is a to-do list"
status: accepted
stage: DECIDED
next: "Write the implementation plan from the sketch, then build in the order of §12"
---

# The planning page is a to-do list

**Status:** 2026-10-09. Every ruling is in; nothing is built. Shaped in
conversation with the user on 2026-10-08 and 2026-10-09, whose rulings are in
the [Decision Ledger](#decision-ledger). Evidence verified at `e4f046c0`.

> **In short.** The planning page should show what needs you, in roadmap
> order, and answer it in place; everything else is a count until you ask for
> it. Two rules make that safe to use: only your own action ever moves, resizes
> or removes an item, and nothing you type is ever lost.

**Why it matters.** Today the top of the page is mostly clutter: a section
bar that repeats the contents column, a notice that repeats the filter box,
✅ questions and questions you have already answered mixed into *Needs you*,
four maintenance sections at full size, and pages that hold 8 cards, then 3.

**The shape.** *Needs you* holds only questions waiting on your reply, under a
header that holds every action; two folded groups hold everything else; and
late data marks items instead of moving them, until you press **Refresh**.

**Cost.** It reverses six rulings of the planning page's reference
([§2](#2-what-it-reverses)), drops paging, and turns every comment box in the
app from Save/Cancel into autosave, which needs the server to make creating a
comment safe to repeat and to let a reply be edited.

**Start at [§4](#4-what-moves-and-who-moves-it)**, the rule about movement;
the layout in [§3](#3-the-page-top-to-bottom) follows from it.

**Needs your ruling:** None.

**Reads with:** [`planning-to-do-list-plan.md`](planning-to-do-list-plan.md)
(the implementation sketch, to be completed into the plan),
[`planning-index.md`](../reference/planning-index.md) (the page as built today),
[`answer-publication.md`](answer-publication.md) (what an agent's reply means,
which decides where a replied question lands).

---

## 1. Principles

- **P1. The page lists what needs you, and counts the rest.** A question needs
  you while it is open in its document and carries no reply of yours that is
  still waiting on the agent. Everything else on the page is a one-line row
  or a count, with a way to open it.
- **P2. Only your own action changes an item's height, position or presence.**
  A reply, a document change, an index update, or an answer made in another
  tab changes text, numbers and marks on what is painted, never its layout,
  until you ask for a new layout. Your own actions move things, and that is
  expected.
- **P3. Nothing you type is lost.** A comment box saves as you type, and
  every way of leaving it keeps the text.
- **P4. Your preferences live in this browser.** The page size, the copy
  panel's checkboxes and which groups are open are remembered by
  [`preferences.ts`](../../frontend/src/lib/preferences.ts#L35), like the
  cards' fold today, never in the address and never on the server.
- **P5. The index keeps its meaning.** The planning index, `vantage-check
  index`'s text and JSON, and their section ids keep their meaning (P0 of
  [`checker-version-skew.md`](checker-version-skew.md)). What changes is how
  the page arranges them. The page and the checker still derive from the same
  functions (P7 of [the reference](../reference/planning-index.md)), so a new
  agent request is added to both.

## 2. What it reverses

The planning page is specified in
[`planning-index.md`](../reference/planning-index.md). This design changes it
in these places, each deliberately:

| Today | Reference | Becomes |
| :--- | :--- | :--- |
| *Needs you* lists open and ✅ questions (`needsYouFilter`, [`sections.ts`](../../packages/vantage-md/src/planning/sections.ts#L768)), and questions you have answered stay in it, marked | [§6.2](../reference/planning-index.md#62-sections-top-to-bottom), [§6.7](../reference/planning-index.md#67-answering-and-copy-answers) | Only questions that need you get full cards; answered ones gather as one-line rows at its top; ✅ ones leave it ([§3.3](#33-needs-you)) |
| **Copy all agent requests** sits on the section bar's line, because beside Copy answers "it would arrive after the header had painted, and move it" | [§6.2](../reference/planning-index.md#62-sections-top-to-bottom) | A header button whose room is kept from first paint, as Copy answers' count already is ([§5](#5-copy-answers--maintenance)) |
| The section bar repeats what the contents column lists | [§6.3](../reference/planning-index.md#63-the-frame-and-the-section-bar) | Gone; the page's top is short enough to need no bar ([§3.5](#35-the-contents-column)) |
| Pages of up to 10 cards, cut early by a 32 Ki-character budget, with a select from 5 pages ([`planningPages.ts`](../../frontend/src/lib/planningPages.ts#L171), [`PlanningPager.tsx`](../../frontend/src/components/PlanningPager.tsx#L105)) | [§6.4](../reference/planning-index.md#64-pages) | No pages: a fixed number of full cards that you choose ([§3.3](#33-needs-you), [§7](#7-dropping-pages)) |
| The filter notice repeats the box's text and counts *entries* and *paths* | [§6.18](../reference/planning-index.md#618-the-filter-notice-and-nothing-matches) | *18 match · 379 hidden* in the filter line, and *hidden* clears the filter ([§3.2](#32-the-filter-line)) |
| An index update lays the page out again live ("L2: applied live") | [§6.4](../reference/planning-index.md#64-pages), [§12](../reference/planning-index.md#12-late-data-never-moves-painted-content) | Held, and marked, until **Refresh** ([§4.2](#42-what-arrives-late)) |

It also overrides one proposal in [`answer-publication.md`
§3.1](answer-publication.md#31-document-evidence), which keeps ✅ questions in
*Needs you* until compaction, labeled as the agent's work. The user ruled that
a ✅ question should not be seen at all ([OQ-TD4](#decision-ledger)); here it
becomes a maintenance item ([§3.4](#34-the-folded-groups)).

## 3. The page, top to bottom

```text
[≡][⊟ contents][⊟ width][⊟ cards]  repo › Planning    3 updates · Refresh   [Copy answers 3] [Copy answers + maintenance 12 ▾]
Filter [ path:docs/design/*.md                                  ✕ ]   18 match · 379 hidden

Needs you 12 · 15 answered
  ✓ OQ-KC1  Should a jail's Copilot share the host's login?      Answered · Show
  ✓ OQ-JL2  …                                                     Answered · Show
  … 10 more answered · Show
  ┌ OQ-KC2 card ┐
  … 10 full cards
  2 more need you · show 10 | 20 | 30 | 50

▸ Blocked 3
▸ Maintenance 13 · 3 not on a roadmap · 4 ready to build · 2 to graduate · 1 stage conflict · 3 to fold into the ledger
```

### 3.1 The header

The header is outside the pane that scrolls, so what is in it is always in
view. It holds, left to right:

- **The view toggles** it holds today (the sidebar, the contents column, the
  full width) and **Expand all / Collapse all**, moved there from the section
  bar's line ([`CardsToggle`](../../frontend/src/pages/PlanningPage.tsx#L742)).
  It still folds every card, and keeps its preference,
  `vantage:planningCardsExpanded`.
- **The breadcrumb**, as today.
- **The updates slot**: *N updates · Refresh* while the page holds updates
  back ([§4.3](#43-refresh)), empty otherwise. Its room is kept from first
  paint, as Copy answers' count is
  ([`pendingCountDigits`](../../frontend/src/pages/PlanningPage.tsx#L3003)),
  so its appearing moves nothing. Where the header is narrow it shows an icon
  and the count; it never goes into the ⋯ overflow, where an update would be
  hidden.
- **Review answers** and **Copy answers**, as today.
- **Copy answers + maintenance**, with its panel ([§5](#5-copy-answers--maintenance)).

### 3.2 The filter line

The box, its ✕ and its spinner are as built
([§6.17](../reference/planning-index.md#617-the-filter-line)), including
Enter leaving the box for the results ([OQ-PF9](../reference/planning-index.md#why-its-this-way)).
What changes is the slot beside them:

- **An applied, understood filter shows its counts there:** *18 match · 379
  hidden*. An *item* *(coined here)* is one question or one document row the
  page lists, counted once even where two groups list it, so a document in
  both *Ready to graduate* and *Blocked* is one item. Items in folded groups
  count. This replaces *entries* (which counted a document in two sections
  twice) and *paths*, neither of which a reader could check by looking.
- **The hint wins the slot.** While the box holds a text that is not applied,
  the slot says *Not applied: Enter says why*, as it does today.
- **At a narrow width** the counts give way to *379 hidden*, the part you can
  act on.
- **Clearing the filter adds a history entry,** whether by pressing *379
  hidden* ([OQ-TD6](#decision-ledger)) or ✕ ([OQ-TD13](#decision-ledger)), so
  Back brings the filter back. ✕ replaced the entry until now, which is why
  Esc never clears; Esc still never clears. Typing still replaces the entry,
  so a filter typed after clearing replaces the cleared page, and Back from it
  returns to the filter before.
- **The notice line under the filter line stays only for what the counts
  cannot say:** *Not filtered: this Vantage cannot read …* after Enter on a
  text the page cannot read, and *Nothing matches* with its reason. The line
  saying a blocked document waits on something the filter leaves out moves
  into *Blocked*, beside that document.
- **In print,** where the box is hidden, the print line reads *Filter:
  `<canonical text>`, 18 match, 379 hidden*. The live region speaks the same
  counts where it speaks the notice today.

The counts' wording is the page's own. `vantage-check index --filter` keeps
its notice, which agents read; the two already end in their own words
([`filterNoticeLines`](../../frontend/src/pages/PlanningPage.tsx#L913),
[`index.ts`](../../packages/vantage-check/src/commands/index.ts#L462)).

### 3.3 Needs you

*Needs you* follows the chosen roadmap's order, as today. Laid out
([§4](#4-what-moves-and-who-moves-it)), it holds three parts:

1. **Answered rows.** An *answered row* *(coined here)* is a question answered
   by a comment ([§6.7](../reference/planning-index.md#67-answering-and-copy-answers)),
   one of yours still waiting on the agent, drawn as one line: its marker, id
   and title, the chip its card shows today (*Answered — waiting on the agent*,
   or *Leaning taken* with its Undo), and **Show**. They come first, in roadmap
   order. The
   first **5** show; past that, *… N more answered · Show* opens the rest in
   place. The 5 is fixed ([OQ-TD9](#decision-ledger)). **Show** opens the
   row into its card, with your answer, in place.
2. **Full cards.** The first *N* questions that need you, as cards, where *N*
   is the *page size* *(coined here)*: 10, 20, 30 or 50, default **10**,
   remembered in this browser.
3. **The end line.** *M more need you · show 10 | 20 | 30 | 50*, where
   choosing a size is both the setting and its effect. With nothing more, the
   line offers the sizes alone. With nothing that needs you at all, the line
   is replaced by *Nothing needs you*, as today.

The heading says *Needs you 12 · 15 answered*: 12 questions need you, and 15
answered rows are listed. The 12 is the count of questions that need you,
live ([§4.2](#42-what-arrives-late)), whatever the page size shows.

**What leaves *Needs you*.** A ✅ question, which has its answer and waits
only for compaction, is listed under *Maintenance* as one to fold into the
ledger. *Blocked* and *Not on a roadmap* questions are not in *Needs you*,
as today.

**The answered rows are not a read state.** Whether a question is answered is
read from the review store, as today; the page stores nothing about which
questions you have seen ([§1.3 of the reference](../reference/planning-index.md#13-invariants),
*Nothing the page shows is stored by the page*). An answer you gave on a
document page, or in another tab, is an answered row on your next visit.

### 3.4 The folded groups

Below *Needs you*, two groups, each a heading line with its count, closed by
default, its open or closed state remembered in this browser per group:

- **Blocked**: what *Blocked* holds today: 🔒 questions, and documents whose
  `depends-on` still waits.
- **Maintenance**: everything an agent should already have done, and the
  files the index could not read. Its heading line names each kind with its
  count. Opened, it shows one sub-list per kind:

  | Kind | Holds | Agent request |
  | :--- | :--- | :--- |
  | Not on a roadmap | Open questions no roadmap routes | `unrouted`, as today |
  | Ready to build | Documents ready to build | `ready`, as today |
  | Ready to graduate | Built documents with no live questions | `graduate`, as today |
  | Stage conflict | Documents whose stage disagrees with their questions | `disagrees`, as today |
  | To fold into the ledger | ✅ questions, by document | **`compact`**, new ([§5.2](#52-the-new-compact-request)) |
  | Too large, Unreadable | Files the index could not read | none |

An opened group lists **one row per item**, never a card: a question by its
document, id and title, a document by its path and stage, each a link. It
lists the first **100** and then *Show all N*. Each kind with a request keeps
its **Copy agent request** button on its sub-heading. A question listed here
is answered from its document, not from this page.

### 3.5 The contents column

The left column, drawn where the screen is wide enough and its toggle is on,
as today ([`outlineShown`](../../frontend/src/pages/PlanningPage.tsx#L1400)),
is retitled **On this page**, since it is no longer a document's contents. It
lists the documents of *Needs you*'s full cards, in list order, each with how
many of its questions need you, and then one line each for the answered rows,
*Blocked* and *Maintenance*, with their counts; pressing one scrolls to it
and, for a folded group, opens it. Maintenance items are not listed in it.

**The section bar is gone.** With the maintenance sections folded, the page's
top is the filter line, *Needs you*'s heading and its first card, so the bar
has nothing left to jump to. **The roadmap picker**, which sits at the
column's head and moved above the section bar where the column is not drawn,
moves to *Needs you*'s heading line there instead, since *Needs you* is the
list the roadmap orders.

## 4. What moves, and who moves it

P2 splits every change into two kinds: the reader's own actions, which may
move anything, and everything else, which may change only text, numbers and
marks. A *layout* *(coined here)* is the page's arrangement of items: which
items it lists, in what order, as rows or as cards. A layout is made only by
the reader's actions in [§4.1](#41-your-own-actions) and by opening the page.

### 4.1 Your own actions

| Action | What it does to the layout |
| :--- | :--- |
| Answering a full card: its comment box closes holding text | The card shrinks to an answered row where it is, and the first question beyond the page size, if any, joins the end of the full cards |
| Undo on a take, while the take is the whole thread, as today | The row opens back into its card where it is; the card that joined is not taken away, so the list holds one more card than the page size until the next layout. A typed answer has no Undo on the row, as today: it is the reviewer's to change on its document ([`inline-markup.md`](../reference/inline-markup.md#a-comment-on-a-question-is-its-answer)) |
| **Show** on an answered row, or *N more answered* | Opens it in place |
| A mark's own control, such as *New reply* ([§4.2](#42-what-arrives-late)) | Opens what it marks, in place |
| Refresh, a filter change, a roadmap pick, a page-size choice | A new layout from the data in hand ([§4.3](#43-refresh)) |
| Opening or closing a group, Expand all / Collapse all | Opens or closes in place |

A card shrinks when its box closes, never at the first keystroke, so a card
never collapses under you while you type. Nothing you do reorders *Needs
you*: an answered row stays where its card was until the next layout, which
gathers the answered rows at the top.

### 4.2 What arrives late

Late data is everything that arrives after a layout: an index update from a
push or a rescan, reviews arriving, a reply from the agent, an answer you made
on another page or in another tab. **Numbers change live** — the heading's
counts, the folded groups' counts, the filter line's counts and the header
buttons' counts — in slots sized for them, so they move nothing.
**Membership, order and size wait.** Each late change becomes a mark on the
item it concerns, a held update, or both:

| Late change | On screen | After the next layout |
| :--- | :--- | :--- |
| The agent replied on a question's thread | A **New reply** mark ([below](#the-new-reply-mark)); pressing it opens the reply in place | Wherever the question now belongs: a full card if it needs you again |
| You answered it elsewhere | *Answered elsewhere* on the card | An answered row |
| It became ✅, was compacted, or left the index | *Done* on the item, which stays | Gone from *Needs you*; a ✅ one is under *Maintenance* |
| Its text changed in the document | *Changed in the document*; the card keeps the text it painted | The new text |
| A new question needs you | Counted in the updates slot only | Placed in roadmap order |
| The roadmap was reordered | Counted once in the updates slot | The new order |
| A maintenance or blocked item came or went | The group's count changes; an opened group marks a gone row *Done* and counts a new one | Listed or gone |

A card that keeps the text it painted is the costly row of that table: it
means the page keeps a card's rendered block after the index has moved on, so
a changed question cannot re-render under you. Where a question's block is no
longer in the index at all, its painted card stays as it is, marked *Done*.

#### The New reply mark

A reply is the one late change that may need you, so its mark carries weight:
a colored bar in the item's left gutter and *New reply* in the item's own
line, both drawn in room the item already has, so its height does not change.
Pressing it opens the reply in place: a height change, made by you. Where the
question goes after the next layout is decided by the answer predicates
([`planningAnswers.ts`](../../frontend/src/lib/planningAnswers.ts#L192)), and
[OQ-AP1](answer-publication.md#OQ-AP1) may refine them: a reply asking for
another ruling needs you again, and one that only acknowledges may not. This
design works under either answer: the mark is drawn for any reply, and the
next layout puts the question wherever the predicates say.

### 4.3 Refresh

**N updates** counts the held changes that a new layout would apply: one per
item that would appear, leave, change between row and card, or re-render, and
one for a reordered roadmap. Its title lists them by kind (*2 new replies, 1
new question, 1 done*). Pressing **Refresh**:

1. **Makes a new layout from the data in hand**, as opening the page would:
   answered rows gathered at the top, the first *N* questions that need you
   as cards, every mark cleared.
2. **Keeps your place:** the first item on screen that is still listed stays
   at the same height on screen; with none left, the page shows *Needs you*'s
   top.
3. **Closes an open comment box first.** Its text has been saving as you
   typed ([§6](#6-comment-autosave)), and closing saves the rest, so Refresh
   loses nothing; then it lays out. The card it was on becomes an answered row in the new
   layout.

Every other new layout the reader makes, listed in [§4.1](#41-your-own-actions),
applies the held updates too and clears the count. Nothing applies them on
its own: not a timer, not the tab coming back into view, not the index
finishing a rescan. Leaving the page and coming back, Back included, is
opening it, a new layout, with the scroll restored as well as the new layout
allows.

The first layout of a visit is made when the sections first paint, from what
is in hand then; until then there is nothing painted to protect. While the
index builds, the page waits as it does today.

## 5. Copy answers + maintenance

**Copy answers** stays as it is, the same as on every document's page. Beside
it, **Copy answers + maintenance** copies your answers and then the
maintenance requests ([OQ-TD7](#decision-ledger)). It replaces Copy all
agent requests.

### 5.1 The panel

The button has a ▾ at its right end. Its *panel* opens below it:

- **On hover**, after the pointer has rested on the button for 200 ms, and it
  stays open while the pointer is on the button or the panel, closing 300 ms
  after it leaves both.
- **On the ▾**, by click, tap, Enter, Space or ↓: the way on a touch screen,
  where there is no hover, and from the keyboard. Esc or a click elsewhere
  closes it. Focus on the button alone does not open it.

The panel reads:

```text
Your answers, the same as Copy answers, plus the
maintenance this page found for the agent.        All · None

      Your answers                  3
   ☑  Not on a roadmap              3
   ☑  Stage conflict                1
   ☑  To fold into the ledger       3
   ☑  Ready to graduate             2
   ☐  Ready to build                4
   ──────────────────────────────────
      Copied                       12
```

- **The counts are live** and follow the filter, as both buttons do today. A
  kind with nothing in it shows 0 and keeps its checkbox.
- **Your answers has no checkbox:** the button's name promises them. **All**
  and **None** check or uncheck every kind.
- **The checkboxes are one preference** in this browser: the kinds left out.
  **Ready to build starts unchecked.** If *ready* means an agent is already
  building it, its request is redundant; if it means *go and build it*,
  sending it by accident starts the most expensive work there is. Either way
  off is the safe default, and a reader who wants it checks it once.
- **The button's count is the total it copies**: your answers plus every
  checked kind's items.
- **With no kind checked** the button is greyed out, since it would copy
  nothing Copy answers does not. It is `aria-disabled`, not `disabled`: the
  panel still opens from it, on hover and from the ▾, or nothing could check a
  kind again. It is greyed out too when its total is 0.
- **What it copies:** the Copy answers payload, byte for byte, then the agent
  request for the checked kinds, as `vantage-check index --request` prints
  for the same kinds and filter. Copy answers' closing instructions stay where
  they are; the request after them carries its own.

### 5.2 The new compact request

Today a ✅ question is listed in *Needs you*, as an answer still to be
compacted, and no agent request asks for the compaction: the agent sections
are four, and none of them holds a ✅ question
([`PLANNING_AGENT_SECTION_IDS`](../../packages/vantage-md/src/planning/guide.ts#L177)).
A fifth agent request, `compact`, asks the agent to compact each listed ✅
question: fold its ruling into the body it governs, add a Decision Ledger row
keeping its id, remove its directive, and repair the links to its anchor, the
rule the style guide already states under *Record rulings before downstream
work*.

`compact` is a request, not a section: the index's sections and their JSON
keep their meaning (P5), so `sections.needs-you` still holds ✅ questions in
`vantage-check index --format json`. It is shared with the checker, so
`vantage-check index --request compact` prints it, and `--request` with no
section now prints all five.

## 6. Comment autosave

Every comment box in the app, in review mode on a document and on a planning
card alike, saves as you type, and has no Save and no Cancel
([OQ-TD10](#decision-ledger)).

**Today, typed text is lost easily.** There are four boxes, and every one
discards on Cancel. The new-comment box, which **Answer…** opens on a document
and on a planning card, also discards on Esc and on a click outside it
([`ReviewCommentPopover.tsx`](../../frontend/src/components/ReviewCommentPopover.tsx#L31)),
and on a file switch or review mode turned off. A failed save keeps the text
only in a banner the review panel shows while it is open
([`useReviewStore.ts`](../../frontend/src/stores/useReviewStore.ts#L656)); on a planning card
the box closes before the request answers, so a failure loses the text
([`PlanningQuestionCard.tsx`](../../frontend/src/components/PlanningQuestionCard.tsx#L1179)).

| Box | Where | Today |
| :--- | :--- | :--- |
| New comment | A block or a selection in review mode; **Answer…** on a document or a planning card | Save, Cancel, ✕; Esc and a click outside discard |
| Edit | ✎ on a comment in the document, and in the review panel | Save, Cancel; Esc discards |
| Reply | A thread the agent has answered, or **Reopen & Reply** on a dismissed one, in the document and the review panel | Reply, Cancel; Esc discards |

### 6.1 What a box does

- **It saves after you pause:** 1,000 ms after the last keystroke, or 5,000 ms
  after the first keystroke not yet saved, if typing has not paused by then.
  The first save creates the comment, or the reply; every later one edits it
  in place.
- **Every way of leaving keeps the text.** **Close**, the ✕,
  Ctrl+Enter or ⌘+Enter, Esc, a click outside, a file switch, review mode
  turned off, Refresh and navigation each save what is not yet saved and close
  the box. Nothing discards. A comment is removed only as it is today: Delete
  where the box's comment offers it, or Undo on a take.
- **It says where it stands,** at its foot, beside its one button, **Close**:
  *Saving…* while a save is on its way; *Saved just now*, then *Saved 1 min
  ago* and so on, with a short pulse each time a save lands (none under
  `prefers-reduced-motion`); and *Not saved, retrying* in amber. Its hint reads
  *Ctrl+Enter or Esc closes* (⌘ on macOS).
- **Empty text is never saved.** While the box is empty, nothing is sent, so
  selecting all and retyping never stores an empty comment. Closing a box that
  created its comment and is now empty deletes that comment. An emptied edit
  box keeps the comment's last saved text, and says *Empty text is not saved*
  while it is empty: the server accepts an empty edit today, and only the box
  stops it
  ([`review_command_handlers.go`](../../internal/api/review_command_handlers.go#L128)).
  A reply box closed empty does the same as an edit box: the reply keeps its
  last saved text.
- **Its own saves never disturb it.** A save pushes a review change to every
  tab, this one included, and the document page rebuilds its comment layer on
  every push ([`useReviewHighlights.ts`](../../frontend/src/hooks/useReviewHighlights.ts#L913)),
  putting back only an open box's text today. The box being typed in keeps its
  focus, caret, selection and scroll through every save, in every tab's
  rebuild.
- **The document page still holds back a file's reload while a box is open**,
  as it does while a comment is being written today
  ([`useWebSocket.ts`](../../frontend/src/hooks/useWebSocket.ts#L55)); it now waits for the
  box to close rather than for a save or a cancel.

### 6.2 Ordering and failure

- **One box, one writer, one request at a time.** A box sends one save at a
  time; typing while one is on its way is sent as one save after it, carrying
  the newest text. An edit is never sent before the create it edits has
  succeeded: the server answers an edit of a comment it does not hold with 404
  ([`commands.go`](../../internal/review/commands.go#L345)).
- **Creating a comment becomes safe to repeat.** The client chooses a
  comment's id ([`useReviewStore.ts`](../../frontend/src/stores/useReviewStore.ts#L179)), and
  a retried create today appends a second comment with the same id
  ([`commands.go`](../../internal/review/commands.go#L49)). A create whose id
  the document's review already holds becomes an edit of that comment's text,
  so a retry after a lost response cannot duplicate it.
- **A reply becomes editable.** Today a reply cannot be changed once sent.
  The reviewer's reply a box created is edited in place by that box's later
  saves, whatever has been added to the thread since. Editing it after the
  agent has answered it makes the thread pending again, as editing a comment
  does today ([`useReviewStore.ts`](../../frontend/src/stores/useReviewStore.ts#L113)).
- **A failed save is retried** 1 s later, then after twice as long each time,
  up to every 30 s, for as long as the tab is open. The text stays in the box
  meanwhile. A box closed with text not yet saved hands it to the same
  retries. While any save has failed and is being retried, the app shell says
  how many comments are not saved, with a way to reopen each; it does not
  flash for an ordinary pause or a save in flight. Leaving or reloading the
  tab asks first whenever any text is unsaved, a pause's included. No text is ever dropped without the reader being told.
- **Two tabs editing one comment:** the last save wins, as it does today
  ([`review-state-architecture.md` §6.1](review-state-architecture.md#61-reviewer-writes-become-commands)).

### 6.3 What the agent and the page see

- **A saved comment is a comment.** It is pending for the agent from its first
  save ([`isPendingForAgent`](../../frontend/src/stores/useReviewStore.ts#L91)), so it counts
  as an answer and Copy answers copies it, in any tab, half-written or not.
  There is no draft state ([OQ-TD10](#decision-ledger)). In the tab that holds
  the box, Copy answers copies the text as last typed.
- **The agent still sees only what is copied.** The clipboard is the only way
  a comment reaches an agent: no command or endpoint is offered to agents for
  reading reviews ([`agent-cli.md`](../reference/agent-cli.md#10-non-goals)).
- **On the planning page,** a card's own saves do not mark it; it shrinks to
  an answered row when its box closes with text ([§4.1](#41-your-own-actions)).
  Another tab's planning page sees the answer arrive as late data: *Answered
  elsewhere* ([§4.2](#42-what-arrives-late)).
- **The rate is bounded by the pause:** about one save a second per box while
  typing continues, each one push and one review fetch per open tab
  ([`useWebSocket.ts`](../../frontend/src/hooks/useWebSocket.ts#L480)).

## 7. Dropping pages

*Needs you* has no pages. Its cost is what pages bounded:

- **Today a page's cards are bounded twice:** 10 entries, and 32 Ki characters
  of card Markdown ([`limits.ts`](../../frontend/src/planningScan/limits.ts#L138)),
  so a page of long questions holds fewer, which is why one page held 8 and
  the next 3. `commitCards` (30) and `commitMarkdownChars` (96 Ki) are not
  enforced anywhere ([`limits.ts`](../../frontend/src/planningScan/limits.ts#L143)
  is their only use); they are the three card sections' pages added up.
- **Now the bound is the page size.** At 10, *Needs you*'s cards are what one
  page holds today, without the character budget. At 50 they are five times
  that, and a card's block may run to 32,000 characters before it becomes a
  preview card, so the worst case is 1.6 M characters in one layout.
- **The full cards of one layout paint in one commit,** whatever the page
  size: painting them in batches would push the end line and the folded
  groups down as later batches land, which P2 forbids.
- **So the cost is measured before it ships:** the planning page's typing
  targets, T1 to T4 of [§18](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured),
  are met at page size 10 and reported at 50, by the existing harness. A page
  size whose first layout misses them is a risk to report, not a reason to put
  the character budget back ([OQ-TD8](#decision-ledger)).

The folded groups' rows are text, with no Markdown to render, so they are
bounded by their 100-row cut alone. Page parameters in an existing address,
such as `needs-you=3`, are ignored and dropped by the in-place rewrite; no
old link is honored ([OQ-TD11](#decision-ledger)).

## 8. Non-goals

- **No change to the planning index, the scan, or `vantage-check index`'s
  sections and JSON** (P5). The checker counts ✅ and answered questions in
  *Needs you*; the page does not. The two are different views of the same
  data, at different times, and converge once the agent acts
  ([OQ-TD12](#decision-ledger)).
- **No read state, snooze or dismissal.** Refresh applies updates; it never
  hides anything that still belongs on the page.
- **No infinite scroll** ([OQ-TD5](#decision-ledger)).
- **No sticky headings.** With one list of cards, the heading you are under is
  always *Needs you*.
- **No request for Too large or Unreadable files**, which the index lists but
  cannot describe beyond their size or error.
- **No draft state for comments.** A saved comment is a comment, copied by
  Copy answers wherever it was typed ([OQ-TD10](#decision-ledger)).
- **No reply or edit box on the planning page.** A question the agent
  answered back is answered again with **Answer…**, as today, or in its
  document's thread.

## 9. Alternatives

| Alternative | Verdict |
| :--- | :--- |
| A default filter, such as one meaning *needs you*, applied when the address has none | Rejected: the checker cannot read reviews, so the term would mean one thing on the page and another in an agent's `--filter` link; and every plain visit would carry the notice and *hidden* count, which is the clutter this removes |
| Removing a card when you answer it | Rejected: the next card would jump up under your pointer, and Undo would have nowhere to be |
| Dismissing finished items with a *Clear* button | Rejected by the user: a reply is a finished-looking change that may need you, so dismissal would hide what you should read. Refresh lays out instead, and replies come back as cards |
| Applying late data while the tab is hidden | Rejected: you would come back to a different page mid-review, which is the move P2 exists to stop |
| Keeping pages, with a fixed size and a page-number box | Rejected: a to-do list fills in as you work, so there is never a next page to go to |
| Loading more cards as you scroll | Rejected by the user ([OQ-TD5](#decision-ledger)) |
| One copy button with every kind, answers included, behind checkboxes | Rejected: Copy answers is the same button on every page, and a planning page whose answers button behaves differently is the confusion this fixes |
| A hover-only panel, with no ▾ | Rejected: a touch screen has no hover, and there a tap on the button copies before any panel could open |

## 10. Risks

| Risk | Mitigation |
| :--- | :--- |
| Page size 50 misses T2 (keystroke to results, p95 ≤ 100 ms) | Measured before shipping ([§7](#7-dropping-pages)); 10 stays the default |
| Holding a painted card's block after the index moves on costs memory | Bounded by the page size: at most 50 cards plus the answered rows opened |
| A ✅ question is now out of sight, and nothing makes the agent compact it | It is under *Maintenance*, counted in the header button, and copied by default |
| Autosave sends a half-typed answer through Copy answers in another tab | Accepted by the user ([OQ-TD10](#decision-ledger)) |
| The hover panel opens when you only meant to pass | The 200 ms rest before it opens, and focus never opens it |
| A save's push rebuilds the comment layer under the box being typed in | Forbidden outright ([§6.1](#61-what-a-box-does)), and tested in the document page, where the rebuild happens |
| A retried create duplicates a comment | Creating becomes safe to repeat on the server ([§6.2](#62-ordering-and-failure)) |

## 11. What done looks like

1. Opening the page with 15 answered questions and 12 that need you shows 5
   answered rows, *10 more answered*, 10 full cards and *2 more need you*,
   with no ✅ question anywhere above *Maintenance*.
2. Answering the first card shrinks it to a row where it was, and an eleventh
   card joins at the end; nothing above the row moves.
3. An agent reply arriving while the page is open marks its item *New reply*
   and changes no item's height; Refresh then shows the question as a card if
   it needs you again.
4. A document edit that changes a painted question's text leaves the card's
   text as painted, marked, until Refresh.
5. The layout-shift observer the planning e2e tests already use reports 0
   through every late change in this list.
6. Typing in a comment box, then pressing Esc, clicking elsewhere or
   pressing Refresh, keeps the text, and *Saved just now* shows as it lands.
   Reloading the tab finds the text saved, or, inside the pause, asks first.
   With the server stopped, the box says *Not saved, retrying*, and the text
   is saved once the server is back.
7. Hovering Copy answers + maintenance opens its panel; unchecking every kind
   greys it out; the ▾ still opens the panel; a reload keeps the checkboxes.
8. Pressing *379 hidden*, or ✕, clears the filter, and Back brings it back.
9. `vantage-check index --format json` prints what it prints at `e4f046c0`
   for the same tree.

## 12. What I would build, in order

1. **Comment autosave**, first: it fixes text you can lose today, and
   Refresh relies on it.
2. **The movement rule**: layouts, marks, the updates slot and Refresh, on
   today's sections. This is the core, and it is testable on its own.
3. ***Needs you* as a to-do list**: answered rows, the page size, ✅ out.
4. **The folded groups and the `compact` request.**
5. **The header and the copy panel**, then the filter line's counts, then the
   contents column and the section bar's removal.

## Decision Ledger

| ID | Ruling / Decision | Date | Settled in | Built |
| :--- | :--- | :--- | :--- | :--- |
| OQ-TD1 | The page is a to-do list: what needs you comes first, and everything that is not a question for you is folded, with counts | 2026-10-08 | [§3](#3-the-page-top-to-bottom) | — |
| OQ-TD2 | *Needs you* keeps its name, and now holds only questions waiting on your reply; *your turn*, *on your plate* and the other names offered were rejected | 2026-10-08 | [§3.3](#33-needs-you) | — |
| OQ-TD3 | This is the page's default view, not a default filter; an agent never needs to link to finished questions | 2026-10-08 | [§9](#9-alternatives) | — |
| OQ-TD4 | A ✅ question is never shown in *Needs you*; it should go away as fast as possible, and the agent is asked to compact it | 2026-10-08 | [§3.4](#34-the-folded-groups), [§5.2](#52-the-new-compact-request) | — |
| OQ-TD5 | No infinite scroll | 2026-10-08 | [§8](#8-non-goals) | — |
| OQ-TD6 | Pressing *hidden* clears the filter, and Back undoes it | 2026-10-08 | [§3.2](#32-the-filter-line) | — |
| OQ-TD7 | Two copy buttons stay side by side: Copy answers, and a second that adds the maintenance requests, with a panel of live counts and remembered checkboxes, All and None, opened on hover with a visible indicator; no checked kind greys it out; its count is the total it copies | 2026-10-08 | [§5](#5-copy-answers--maintenance) | — |
| OQ-TD8 | Pages hold a fixed number of cards, never a character budget; the number is a setting remembered in this browser | 2026-10-08 | [§3.3](#33-needs-you), [§7](#7-dropping-pages) | — |
| OQ-TD9 | Answering shrinks a card to a row in place and the list fills in to keep the page size; answered rows gather at the top on the next visit, the first 5 shown, and the 5 is fixed until it proves to need a setting | 2026-10-08 | [§3.3](#33-needs-you), [§4.1](#41-your-own-actions) | — |
| OQ-TD10 | Late changes never change an item's height; they mark it, a reply with visual weight, and Refresh in the header applies them, rather than a dismiss. Comments save as you type, with a *Saved* indicator and a Close button, no Save and no Cancel, and no draft state: Copy answers copies what is saved | 2026-10-08 | [§4](#4-what-moves-and-who-moves-it), [§6](#6-comment-autosave) | — |
| OQ-TD11 | Old links do not matter: page parameters are dropped | 2026-10-08 | [§7](#7-dropping-pages) | — |
| OQ-TD12 | The page and the checker counting *Needs you* differently is acceptable: they are views of the same data at different times, and converge | 2026-10-08 | [§8](#8-non-goals) | — |
| OQ-TD13 | ✕ adds a history entry when it clears the filter, as *hidden* does, so Back undoes either; Esc still never clears | 2026-10-09 | [§3.2](#32-the-filter-line) | — |
