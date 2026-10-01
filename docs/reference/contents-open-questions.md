---
title: "Open questions in the contents column — what a document still owes its reader, beside its headings"
status: accepted
stage: CURRENT
verified: 2026-10-01
verified_commit: fced33d
covers:
  - frontend/src/components/TableOfContents.tsx
  - frontend/src/hooks/useDocumentOutline.ts
  - frontend/src/hooks/useOpenQuestionButtons.ts
  - frontend/src/lib/anchorScroll.ts
  - frontend/src/lib/staticMode.ts
  - packages/vantage-md/src/vantageDirectives.ts
  - packages/vantage-md/src/planning/scan.ts
  - packages/vantage-check/src/rules/directives.ts
tags: [vantage-md, viewer, docs-conventions]
summary: "The viewer's table of contents lists every question a directive declares beside the document's headings, in document order and in the state its author marked, under a tally that counts them by state and says how many review mode can answer in one click."
---

# Open questions in the contents column — what a document still owes its reader, beside its headings

**Status:** Verified 2026-10-01 against `fced33d`, the commit that added this
document. Inside the `covers:` perimeter it changed only comments, repointing them
here, so the code it describes is `7fa8cbf`'s, unchanged. Amended 2026-10-01,
in the commit after `936e24b`, and read from that commit's code: the
question-directive row of [§2](#2-terms), the first bullet of
[§3.1](#31-which-questions), the example HTML in
[§3.3](#33-the-label-read-from-the-title-not-from-the-stamped-element), the
`oq` row of [§6](#6-failure-modes), the question attributes in
[Current values](#current-values), and [OQ-C1](#why-its-this-way) and its note
in [Why it's this way](#why-its-this-way); nothing else was re-verified.
MEASURED: CI's end-to-end suite drives the column in a real browser
(`frontend/e2e/toc.spec.ts`); nobody watched it by hand for this verification.
[§8](#8-known-gaps) lists where the code breaks an invariant below.

The **contents column** is the table of contents Vantage draws in the margin to
the left of a rendered Markdown document, shown and hidden from the header.
Besides the document's headings, it lists the document's Open Questions: every
[question](planning-index.md#2-terms) a question directive declares, in document
order, nested under the heading it sits beneath, and wearing the status emoji its
author wrote. A **tally** beside the column's *Contents* label counts them by
state. A reader can therefore tell whether a document is waiting on a ruling
before reading a word of it. Headings alone cannot show that, because the
convention writes questions as list items rather than headings.

Clicking a question scrolls to it. The entry's link is the question's own
`#OQ-…` anchor, which is the URL another document uses to reference it.

| Component | Lives in |
| :--- | :--- |
| The column: its header, its tally, and its entries as links | `frontend/src/components/TableOfContents.tsx` (`TableOfContents`) |
| The outline: collecting entries, reading a question's title and state, the tally, and which entry is active | `frontend/src/hooks/useDocumentOutline.ts` (`collectOutline`, `questionLabel`, `tallyQuestions`, `tallySentence`, `entryAccessibleName`, `activeEntryId`, `measureEntryOffsets`, `useDocumentOutline`) |
| The question walk the column shares with review mode's buttons, which the planning page also uses to find a card's question in its rendered body | `frontend/src/hooks/useOpenQuestionButtons.ts` (`documentQuestions`, `offersTake`) |
| The status vocabulary: each emoji, the state it names, and that state in words | `vantage-md` (`VANTAGE_OQ_STATUS`, `vantageOqStatus`, `VANTAGE_OQ_STATUS_LABEL` in `vantageDirectives.ts`) |
| Scrolling to an entry, opening a collapsed section on the way | `frontend/src/lib/anchorScroll.ts` (`scrollToAnchorElement`) |
| The planning index's prediction of the column's reading, and the test holding the two equal | `packages/vantage-md/src/planning/scan.ts`; `frontend/src/lib/planningAgreement.test.tsx` |

**Reads with:** [`inline-markup.md`](inline-markup.md) (the question directives
that declare what this column lists, and the one-click answer whose count it must
not contradict) and [`planning-index.md`](planning-index.md) (the index that
counts the same questions from source, and the planning outline this column shows
on the planning page). For readers rather than maintainers:
[Table of Contents](../../userguide/features.md#table-of-contents).

---

## 1. What it is for, and the rules it keeps

A reader opening a design document asks two things before reading it: what state
is this in, and does it want anything from me? The `status:` frontmatter answers
the first, as a row of the metadata card, and as a chip above the card when the
document opts in with `vantage: status-chip`. The contents column answers the
second, by listing the document's questions where the reader already looks for
its structure.

### 1.1 Invariants

These are what a maintainer breaks by accident. Each is held by a test.

- **One walk finds the questions for the column and for review mode.** The
  column and review mode's **Take this leaning** buttons both take their
  questions from `documentQuestions`. The column lists the whole result. The
  buttons, and the Review toggle's count of them, take what is left after the
  `offersTake` filter. A second query of the directive attributes would also list
  a stamped code block or table, which hosts no button and is no question to the
  planning index. That would put five questions in the column against three
  buttons
  ([the count, and why the gate needed one](inline-markup.md#the-count-and-why-the-gate-needed-one)).
  The planning page's cards take their questions from the planning index
  instead, and call `documentQuestions` only to find each question's host inside
  the body a card renders.
- **The tally's one-click count is the Review toggle's count.** Both are the
  questions `offersTake` accepts, so wherever the toggle exists the column never
  promises a button the document does not have ([§5](#5-the-tally)). A static
  export has no toggle and no buttons, and its tally still states the count
  ([known gaps](#8-known-gaps)).
- **A question's state is the marker its author wrote, and is never inferred from
  its directive.** An `oq` left on a question marked ✅ is listed as answered and
  offers no button. `vantage-check` reports that `oq` as `vantage/question-name`,
  because every viewer before 0.8 would offer the button on it.
- **The element an entry scrolls to is the element the active highlight
  measures** ([§4.2](#42-the-scroll-and-the-active-entry)).
- **The column and the planning index agree on every question and its state,**
  with one named exception: a directive inside a raw HTML block. The index reads
  the source and the column reads the rendered page, so
  `frontend/src/lib/planningAgreement.test.tsx` renders every document in `docs/`
  and holds the two equal
  ([planning index invariants](planning-index.md#13-invariants)).
- **An entry's label is the document's own words.** Text the viewer adds inside a
  title, such as a planning badge after a link or a heading's hover `#`, is left
  out of it.

## 2. Terms

Each term is Vantage's own unless its row links elsewhere. The design this
document replaced (2026-09-20) coined *tally*; its text is in git, and this is
now where the term is defined.

| Term | Means | Is not | Origin |
| :--- | :--- | :--- | :--- |
| **Contents column** | The table of contents drawn in the margin beside a rendered Markdown document, listing its headings and its questions | the planning outline, which the same column shows on the planning page ([planning outline](planning-index.md#69-the-planning-outline)) | Vantage's own; the name dates from 2026-09-18 (`50c0762`), when the existing table of contents moved into the reading band's margin |
| **Question**, **question directive** | Defined in [the planning index's terms](planning-index.md#2-terms): a `question` directive, or an `oq`, the deprecated name it replaces, on a block that could host the one-click button | a prose question with no directive | that reference |
| **Stamped element** | The block a directive's attributes and `id` land on: the block after the directive, which in the layout the convention prescribes is the question's *leaning* paragraph ([names, position, and extent](inline-markup.md#names-position-and-extent)) | the question's list item | the directive vocabulary |
| **Title** (of a question) | The bold run whose text opens with the question's `OQ-` id, which is how the documentation convention names a question in prose | a heading above the question | the documentation convention (`vantage-check style-guide`) |
| **Marker** | The status emoji written before a title, which may be two glyphs (`💬 🤷`) | the directive's name | the documentation convention |
| **State** | *Open* (💬), *answered* (✅) or *blocked* (🔒), read from the marker, or *unmarked* when there is none | whether review mode offers a button, which also depends on the directive's name | the documentation convention; the words are `vantage-md`'s |
| **Tally** | The per-state counts beside the column's *Contents* label ([§5](#5-the-tally)) | the Review toggle's count, which counts buttons | coined by the design this document replaced, 2026-09-20 |
| **Active entry** | The entry the reader is currently inside, which the column highlights | the entry last clicked | Vantage's own |
| **Active band** | How far below the top of the document's scroll pane an entry may sit and still be the one being read | the margin a scroll leaves above its target | Vantage's own |

---

## 3. What the column lists

### 3.1 Which questions

The column lists every question `documentQuestions` finds, in every state:

- **Declared by a question directive.** That is a `question`, in any state, or
  an `oq`, the deprecated name it replaces
  ([names, position, and extent](inline-markup.md#names-position-and-extent)). A
  question written without a directive is not listed, and nothing else in Vantage
  counts it either. The column never infers a question from prose and never
  mints an anchor.
- **On a block that could host the one-click button:** a paragraph, a heading, a
  list item or a blockquote. A directive above a code block or a table stamps
  that block but declares no question, so neither the column nor the planning
  index counts it, and `vantage-check` reports it as `vantage/orphan`.
- **Once per block.** Two directives that resolve to one block, such as a stamped
  list item and a stamped paragraph inside it, are one question.
- **Rendered.** A question inside a block withheld by a `fallback` directive is
  never rendered, so it has no entry
  ([fallback blocks](inline-markup.md#fallback-blocks)).
- **Inside a raw HTML block too.** There the viewer stamps the paragraph, but the
  planning index, reading the source, sees no question. This is the one
  disagreement allowed between the two
  ([questions in the planning index](planning-index.md#33-questions)).

The column lists and tallies these whether or not review mode is on, and in a
[static export](../../userguide/guides/static-sites.md) too: the site `vantage
build` writes, with no server behind it. What a document holds is true either
way, and a reader with review mode off is the one who most needs telling. Only
review mode's buttons are gated on review mode and on static mode.

> [!WARNING]
> Do not narrow the list to the questions review mode offers to answer. A blocked
> or answered question is still one a reader of the document wants to see. What
> the column must not do is claim that such a question can be answered, and the
> entry's state and the tally's tooltip already prevent that.

### 3.2 Order and nesting

Headings and questions are collected in **one pass over one selector** that names
the six heading levels and both question attributes, so the DOM returns them in
document order. A second collector for questions would have to rebuild that
order, along with the nesting, active tracking and collapsed-section handling
below, and the two collectors would drift.

- **A heading with no id is skipped,** because nothing could link to it.
- **A question with no id is kept,** because, unlike a heading, it is the thing
  the reader is looking for. It renders as a focusable entry with the link role
  but no address, so it scrolls on a click, Enter or Space, while middle-click
  and *Copy Link* have nothing to use. Dropping it would list fewer open
  questions than review mode has buttons.
- **A question nests one step under the last heading above it.** A question
  before any heading sits at the top level.
- **A question written as a heading,** with its directive above a heading, is
  listed as a question rather than a heading. It still opens a section, so what
  follows it nests beneath it.
- **Indentation is relative to the document's shallowest entry,** so a document
  that starts at `h2` is not indented throughout. It stops deepening after a few
  levels.

### 3.3 The label: read from the title, not from the stamped element

In the layout the convention prescribes, the directive sits **between** a
question's title and its leaning. The stamped element, which carries the `id`, is
therefore the *leaning* paragraph:

```html
<li>
  <p>💬 <strong>OQ-B1: What is the generator's command surface?</strong></p>
  <p>…</p>
  <p data-vantage-question="true" data-vantage-leaning="…" id="OQ-B1"><em>Leaning:</em> …</p>
</li>
```

So the label is found by scoping to the enclosing list item, or to the stamped
element itself outside a list, and taking the first bold run whose text opens
with an `OQ-` id. The marker is the text before that bold run in the element
that holds it, less a heading's hover `#`.

- **Recognizing a title is looser than the id grammar.** The id grammar decides
  what becomes an anchor. The title test only has to recognize a title that a
  document may have written with a lowercase prefix or a typo, and missing one
  costs a readable label, so the loose test is the safer error.
- **A question with no bold title,** written as a bare paragraph, is labeled with
  the whole text of its scope. Its marker is whatever precedes the first letter
  or digit.
- **The title is flattened to one line,** so a title wrapped across source lines
  does not carry a line break into the tooltip or the accessible name.
- **A question entry is clamped to a couple of lines.** The browser clamps it
  rather than script cutting it, and the entry's tooltip carries the whole title.
  The marker sits inside the clamped box as its first inline run, so it never
  ends up on a line of its own.

> [!WARNING]
> Do not read the label off the stamped element. In the prescribed layout every
> entry would then read "Leaning: …", which looks plausible and is uniformly
> useless.

### 3.4 State, and saying it in words

A question's state is read from its marker, falling back to its title text: ✅ is
answered, 🔒 is blocked, 💬 is open, and no marker leaves it unmarked. A non-open
marker wins over 💬 when both appear, because a question marked both has been
answered and its stale marker not yet cleared.

The glyphs, the states and their words are one vocabulary in `vantage-md`. The
column and `vantage-check`'s `vantage/oq-missing` and `vantage/question-name`
import it, so the viewer and the checker cannot answer "what does this marker
mean?" differently.

The column shows the emoji exactly as the document wrote it, because it renders in
print and in any theme, and hides it from assistive technology. A marked question
entry's tooltip says the state in words before the title, such as *Blocked
question: OQ-…*, because a glyph alone is read out as "speech bubble", and so
does the accessible name of an entry with an id. An entry with no id says the
state only in its tooltip: its accessible name comes from its visible text, which
with the emoji hidden is the title alone. An unmarked question's tooltip and name
are its title alone.

Whether review mode offers **Take this leaning** (`offersTake`) is decided from
the same reading: the title, then the state. So the column's glyph and the button
never disagree about which state a question is in.

---

## 4. Following an entry

### 4.1 The link

An entry with an id is a real link whose `href` is its own anchor. For a question
that is the `#OQ-…` id its directive declared, so middle-click, modifier-click
and *Copy Link* produce the URL a cross-document reference uses. A plain click is
taken over: the address is replaced, adding no history entry, and the entry is
scrolled to.

In a [static export](../../userguide/guides/static-sites.md), a bare `#id` would
replace the page's route, which lives in the fragment, so the link names the route
before the anchor (`fragmentHref`).

### 4.2 The scroll and the active entry

A click scrolls to the entry's **element**: a heading itself, or, for a question,
its enclosing list item rather than the stamped leaning paragraph. Scrolling to
the leaning would put the question's title above the top of the pane, so the
reader would arrive at the answer to a question they cannot see. The scroll goes
through `scrollToAnchorElement`, the same path a heading's own `#` link takes,
which opens a collapsed section before it measures.

The **active entry** is the last entry whose element sits at or above the active
band, or the first entry when the reader is above all of them. An entry with no id
cannot be the active entry. An entry whose element is not rendered, inside a
closed collapsed section, is skipped: an undisplayed element measures as zero and
would win every comparison after it, so the highlight would never move past it.

> [!WARNING]
> Keep the scroll target and the measured element the same element. Measuring the
> stamped leaning while scrolling to the list item puts the two nearly an active
> band apart, so clicking a question scrolls it into view and then highlights
> the **previous** entry.

> [!NOTE]
> Clicking a question near the end of a document leaves it partway down the pane
> and highlights the entry above it. That is the pane reaching its maximum scroll,
> not a defect, and headings at the end of a document have always behaved the same
> way. Do not "fix" it.

### 4.3 Staying current while it is open

The outline is rebuilt on any mutation of the document pane, coalesced to one
rebuild per animation frame. That covers added and removed nodes, text edited in
place, and changes to `class`, the collapse flag, `id` and both question
attributes. Each attribute is there for a case that changes no tree structure:
live reload patching a heading's text and slug in place, a directive added above a
paragraph that already exists, and the full-width toggle or a collapsed section
reflowing the text.

Scrolling and resizing the window re-measure the active entry, also once per
frame. While the column is closed, none of these observers or listeners is
installed.

---

## 5. The tally

Beside the *Contents* label there is one group per state that occurs, in the
convention's order ([current values](#current-values)), each a glyph and a
count. A state with no questions is left out, so the common case, where every
question is open, reads as one simple count. A document with no questions shows
no tally at all, rather than a zero. An unmarked question is counted under a
neutral dot rather than borrowing a state's glyph.

The tally is a breakdown rather than one total under 💬, because a single number
under the open marker claims that every question awaits a ruling. That is false on
any document that has answered a question and kept its directive.

The tally's tooltip, which is also its accessible name, says in words what the
glyphs cannot: the split by state, and how many of the questions can be answered
in one click. For example: *3 questions here — 1 open, 1 answered, 1 blocked; 1
can be answered in one click*. Its shape follows what there is to say:

- **The one-click clause appears only when some question can be answered in one
  click.** When every question can, the sentence leads with it (*3 questions here
  can be answered in one click*).
- **The split by state appears whenever there is more than one group.** A lone
  group gets no split. When not all of its questions can be answered it names its
  state in words (*2 open questions here; 1 can be answered in one click*, or *1
  blocked question here*); otherwise the glyph beside the number already says it.

The one-click number is the one the Review toggle's tooltip gives. The column may
list more questions than review mode has buttons, and the tooltip says so instead
of implying that all of them can be answered. In a static export, which has no
Review toggle and no buttons, the tooltip still states that number
([known gaps](#8-known-gaps)).

---

## 6. Failure modes

| Situation | What the column does |
| :--- | :--- |
| A question directive with no `id=` | Lists the question as a focusable entry with the link role and no address, whose accessible name is the title alone; it is never the active entry |
| A question with no bold title | Labels it with its own text, clamped; the marker is whatever precedes the first letter or digit |
| An `oq` on a question marked ✅ or 🔒 | Shows the marker's state, and counts no one-click answer; `vantage-check` reports `vantage/question-name`, since every viewer before 0.8 offers one |
| A question directive above a code block or a table | Lists nothing; `vantage-check` reports `vantage/orphan` |
| A question in a closed collapsed section | Lists it; skips it when finding the active entry; a click opens the section on the way |
| Live reload, or a Mermaid diagram arriving late | Rebuilds the outline on the next frame |
| A document with no headings and no questions | Says so, in place of the list |
| A static export | Lists and tallies every question, with links that name the route before the anchor; the tally's tooltip still states a one-click count though the export offers no button ([known gaps](#8-known-gaps)) |

---

## 7. Non-goals

- **No anchors are minted.** A question its author did not declare is not listed.
  A 🔒 or ✅ question can be reached because its own `question` directive anchors
  it, never because the viewer gave it an id.
- **No filtering by state.** Every declared question appears, including one its
  author marked ✅.
- **No count inside the document.** The tally lives in the column's header, and
  the one-click count in two tooltips, the Review toggle's and the tally's.
- **Nothing on a narrow screen.** Below the `md` breakpoint a phone has no margin
  to put the column in, and the header hides its toggle at the same width.
- **Not over raw source, a directory listing or a binary file,** where there is no
  rendered document to outline, and **not on the planning page,** where the same
  column shows the [planning outline](planning-index.md#69-the-planning-outline)
  instead.

---

## 8. Known gaps

Behavior that breaks an invariant in [§1.1](#11-invariants). It is a defect in
the code, not a ruling, and fixing it is
[`as-built-defects.md`](../design/as-built-defects.md)'s work.

- **A static export's tally promises a click it cannot take.** The column renders
  in a static export, and its tally's tooltip and accessible name still say how
  many questions *can be answered in one click*, but the export has no Review
  toggle, no review mode and no button. The one-click count (`offersTake`, as
  `collectOutline` records it) is not gated on static mode, while everything that
  would act on it is, and no test renders the tally in an export.

---

## Current values

Verified at `fced33d`. The prose above explains what each of these is for; this
table is the only place the values themselves are stated.

| Value | Setting | Defined in |
| :--- | :--- | :--- |
| Active band | 96 px below the top of the document's scroll pane | `ACTIVE_BAND` in `useDocumentOutline.ts` |
| Title test | `^OQ-[A-Za-z0-9]*\d`, on the bold run's text | `OQ_TITLE` in `useDocumentOutline.ts`, mirrored by `OQ_TITLE` in the planning scan (`packages/vantage-md/src/planning/scan.ts`) and `OQ_TITLE_TEXT` in `vantage-check` (`packages/vantage-check/src/rules/directives.ts`); no test holds the three equal |
| Question attributes | `data-vantage-question` on every question; `data-vantage-oq` besides on one an `oq` declared | `QUESTION_SELECTOR` in `useOpenQuestionButtons.ts`, which reads either |
| Blocks a question can be declared on | `p`, `h1`–`h6`, `li`, `blockquote` | `VANTAGE_OQ_HOST_TARGETS` in `vantage-md` |
| State glyphs | 💬 open, ✅ answered (`settled`), 🔒 blocked | `VANTAGE_OQ_STATUS` in `vantage-md` |
| State words | Open question, Answered question, Blocked question | `VANTAGE_OQ_STATUS_LABEL` in `vantage-md` |
| Tally order, and the unmarked glyph | open, answered, blocked, unmarked; `•` | `tallyQuestions` |
| Column width | Tailwind `w-64` | `TableOfContents` |
| Indent | 8 px, plus 12 px per level below the shallowest entry, for at most 3 levels | `MAX_INDENT`, and the indent expression in `TableOfContents` (`TableOfContents.tsx`) |
| Lines a question entry shows | 2 (`line-clamp-2`) | `OutlineLink` in `TableOfContents.tsx` |
| Hidden below | Tailwind's `md` breakpoint | `TableOfContents` |
| Attributes that trigger a rebuild | `class`, `data-vantage-collapsed`, `id`, `data-vantage-oq`, `data-vantage-question` | `useDocumentOutline` |
| Test ids | `table-of-contents`, `toc-question-count`, `toc-question`, `toc-heading` | `TableOfContents.tsx` |

---

## Why it's this way

Rulings a maintainer reading only the text above might undo on purpose, each with
the id the design this document replaced gave it. Three were amended after that
design was ruled, by two rulings recorded in the planning index's table: Plan Q5
([planning-index.md](planning-index.md#why-its-this-way)), which narrowed review
mode's button to open questions and kept the column listing every state, and
[OQ-VS4](planning-index.md#why-its-this-way), which gave 🔒 and ✅ questions a
`question` directive of their own, since made the name for every question by
[OQ-VS6](planning-index.md#why-its-this-way). Each amended row says which, and states the
ruling as it now stands.

| ID | Ruling | Date |
| :--- | :--- | :--- |
| OQ-C1 | List only what a question directive declares, in every state: a `question`, or an `oq`, the deprecated name it replaces. The author's directive is the signal, and the column never infers a question from prose, nor drops one because review mode offers it no button ([§3.1](#31-which-questions)) | 2026-09-20; amended 2026-09-28 (Plan Q5), 2026-09-30 ([OQ-VS4](planning-index.md#why-its-this-way)) and 2026-10-01 ([OQ-VS6](planning-index.md#why-its-this-way)) |
| OQ-C2 | Mint no anchor for any question. One without a directive is not listed, and a 🔒 or ✅ one is reached through its own `question` directive's id ([§7](#7-non-goals)) | 2026-09-20; amended 2026-09-30 ([OQ-VS4](planning-index.md#why-its-this-way)) |
| OQ-C3 | Take the questions from the walk review mode's buttons use (`documentQuestions`), before their one-click filter, rather than re-deriving the set; a fresh query of the attributes would list a stamped code block or table that has no button and is no question. The list is not gated on review mode, because what a document holds is true either way ([§1.1](#11-invariants), [§3.1](#31-which-questions)) | 2026-09-20; amended 2026-09-28 (Plan Q5) |
| OQ-C4 | Collect headings and questions in one document-order pass into one entry list; a second collector would have to reproduce the order, the nesting, the active tracking and the collapsed-section handling ([§3.2](#32-order-and-nesting)) | 2026-09-20 |
| OQ-C5 | Read the label from the title, scoped to the enclosing list item, never from the stamped element ([§3.3](#33-the-label-read-from-the-title-not-from-the-stamped-element)) | 2026-09-20 |
| OQ-C6 | Link to the question's anchor; scroll to, and measure, the enclosing item ([§4.1](#41-the-link), [§4.2](#42-the-scroll-and-the-active-entry)) | 2026-09-20 |
| OQ-C7 | The status emoji, their states and their words live in `vantage-md`, imported by the viewer and the checker alike ([§3.4](#34-state-and-saying-it-in-words)) | 2026-09-20 |
