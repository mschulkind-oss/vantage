---
title: "Open questions in the contents — telling a reader what a document still owes them"
author: "Matt Schulkind"
date: 2026-09-20
status: accepted
tags: [vantage-md, viewer, docs-conventions]
summary: "The table of contents lists a document's tagged Open Questions beside its headings, each carrying the status emoji the author wrote, so a reader can see what needs a ruling without reading the page."
vantage:
  status-chip: true
---

# Open questions in the contents — telling a reader what a document still owes them

**Status:** IMPLEMENTED (2026-09-20). Every question below is ruled, and the
mechanism landed with them. Two things the design did not anticipate are recorded
in [§5](#5-what-building-it-changed).

**The short version.** A reader opening a design document wants two things before
they read a word: what state is this in, and is there anything here for me to do?
The first is answered — [`status:`](../../userguide/reference/style-guide.md)
frontmatter renders a chip above the metadata card. The second is not. A document
can hold nine questions awaiting a ruling and look, from the contents column,
exactly like one holding none.

So the table of contents lists them. Each tagged Open Question becomes an entry
beside the headings, in document order, carrying the status emoji its author
wrote, and clicking it goes to the question.

## 1. The gap this closes, in the words it was already written in

[`docs/gallery/status.md`](../gallery/status.md) ends its status-vocabulary table
with the finding that motivated this:

> The gap is the interesting part: **nothing says "this document has three
> unanswered questions" at the top of the page**, which is the one thing a
> scanning reader most wants and the one thing no mechanism here provides.

That gallery page is a colour-review surface, so it stated the gap and stopped.
This is the mechanism.

## 2. Why the roadmap already reads well, and design docs do not

Worth stating plainly, because it is the whole reason this looks like a missing
feature rather than a new one. [`roadmap.md`](../../roadmap.md) writes its status
at **heading** level:

```markdown
## 🔒 Open Threads

### 🔒 TypeScript 7 — blocked on typescript-eslint
```

The contents column is built from headings, and a heading's text is taken
verbatim — so the emoji is already there, and the roadmap already scans the way
this design wants every document to. A design document writes its questions as
**list items** instead, which the contents column has never looked at. Same
convention, same emoji, invisible.

## 3. Decisions

### 3.1 Only tagged questions appear, and that is not a filter

The convention gives a question four states, and only one of them carries an `oq`
directive. From the printed style guide:

> **Every open question (💬) with a stated leaning gets an `oq` directive.** […]
> Mark it 🔒 if it is blocked on something upstream and cannot be answered yet,
> or ✅ once it is decided; either state needs no directive.

`vantage/oq-missing` enforces that at **error** severity, which is what makes
the tagged set trustworthy: a question awaiting a ruling *cannot* be missing its
directive and still pass the gate. So "the questions carrying directives" and
"the questions awaiting a ruling" are the same set, and listing exactly that set
is not a judgement about which questions matter — it is the author's own marker,
read back.

This is also the decision that keeps the feature small. Listing settled and
blocked questions too would mean **minting anchors for them**, because by the
convention's own rule they carry no directive and therefore have no `id` in the
page at all — see the "no directive" finding in
[`linked-references.md` §9](linked-references.md#9-what-building-it-changed).
That is a render-pipeline change with a checker consequence, proposed and
rejected here: the tag is the signal, and a reader scanning for what needs them
is not served by a list of what does not.

> [!NOTE]
> A document *may* keep a directive on a question it has since marked ✅ —
> [`docs/gallery/status.md`](../gallery/status.md) does, deliberately, because it
> renders all three states for review. Such a question appears in the contents
> wearing the ✅ it was written with. The emoji is read from the document, never
> assumed from the presence of a directive, so the column cannot claim a question
> is open when its author says otherwise.

### 3.2 The count comes from `answerableOpenQuestions`, which already exists

The viewer already counts these — the Review toggle's tooltip carries the number
while review mode is off, and
[`inline-markup.md`](../reference/inline-markup.md) explains why that function is
exported rather than re-implemented:

> `answerableOpenQuestions` is exported and **shared with the render pass**, so
> the count and the buttons cannot disagree. A count of five against three
> buttons would send the reader hunting for controls that were never there.

The contents column is its **third** caller and re-derives nothing. The same
argument applies with one more surface: a contents column listing five questions
against three buttons is the same lie in a new place. It inherits the
`pre`/`table` exclusion for free, which is the right answer rather than a
side-effect — a question on a fenced block is anchorable but hosts no button, so
an entry leading to it would promise an action that is not there.

It also inherits that function's freedom from the review-mode and static gates,
deliberately: what a document *holds* is true whether or not review mode is on,
and a reader with it off is exactly who needs telling.

### 3.3 Headings and questions are collected in one pass

One `querySelectorAll` naming both, which returns document order natively. Three
things fall out of that rather than being built:

- **Nesting.** A question's indent is one step deeper than the last heading above
  it, so the outline stays truthful about where in the document it lives.
- **Active tracking.** The entry the reader is inside already highlights by
  measuring each entry's offset; a question is just another entry in that list.
  Which element gets measured turned out to matter — see
  [§5](#5-what-building-it-changed).
- **Collapsed sections.** The offset pass already skips anything whose
  `offsetParent` is null, which is how a question inside a collapsed section
  stops winning every comparison.

A second collector alongside the heading one would have had to reproduce all
three, and the two would drift.

### 3.4 The label is read from the question's title, not from the stamped element

The one place this is easy to build wrong. In the layout the convention
prescribes, the directive sits **between** the question's title and its leaning,
so the element it stamps — and therefore the element carrying the `id` — is the
*leaning* paragraph:

```html
<li>
  <p>💬 <strong>OQ-B1: The generator's command surface.</strong> …</p>
  <p data-vantage-oq="true" id="OQ-B1"><em>Leaning:</em> …</p>
</li>
```

Reading the label off the stamped element yields `Leaning: back of the queue` for
every entry in the column — plausible-looking, uniformly useless. The title is a
*sibling*, so the label is found by scoping to the enclosing list item and taking
the first bold run that starts with the id. That bold run is the same declaration
site [`linked-references.md` §9](linked-references.md#9-what-building-it-changed)
identifies for the same reason, and the status emoji is the text just before it.

A question written as a bare paragraph has no title to find; that entry falls
back to its own text, truncated.

### 3.5 The link addresses the anchor; the scroll targets the question

Both, because they answer different questions. The entry's `href` stays the
question's own `#`-anchor so that middle-click, modifier-click and "Copy Link"
all produce the URL a cross-document reference would use. The scroll, however,
goes to the enclosing item via `scrollToAnchorElement`, because the anchor is on
the leaning paragraph ([§3.4](#34-the-label-is-read-from-the-questions-title-not-from-the-stamped-element))
and scrolling to it puts the question's own title
above the top of the viewport — the reader arrives at the answer to a question
they cannot see.

### 3.6 The status vocabulary moves to `vantage-md`

💬, ✅ and 🔒 were private constants in the checker's
[`rules/directives.ts`](../../packages/vantage-check/src/rules/directives.ts).
The contents column needs them too — an emoji alone is not an accessible label,
so an entry says "open question" or "blocked" in text for a screen reader — and
two copies of a vocabulary is the failure
[`vantageDirectives.ts`](../../packages/vantage-md/src/vantageDirectives.ts)
exists to prevent. They move there, beside the id grammar and the target lists
that are already shared, and the checker imports them.

## 4. Non-goals

- **No anchors are minted.** See [§3.1](#31-only-tagged-questions-appear-and-that-is-not-a-filter).
- **No filtering by state**, beyond what the tag already says. Every tagged
  question appears, including one whose author marked it ✅.
- **No new count surface in the document.** The Review toggle's tooltip stays the
  place a number lives; the contents column shows the questions themselves, and a
  reader who wants the total can read the column.
- **Nothing changes on mobile.** The contents column is hidden below `md`
  already, for want of a margin to put it in.

## 5. What building it changed

Two things, both found by running it against this repo's own documents rather
than against a fixture.

**One number over one emoji was a claim the document does not make.** The header
was going to read `💬 3`, and on [`status.md`](../gallery/status.md) that is
wrong: the three questions there are one open, one answered and one blocked, all
three tagged deliberately. Every listed question is answerable — that is what
being tagged means — but heading the count with the *open* marker says all three
await a ruling. So the header tallies by state and omits the states that do not
occur, which leaves the common case (every question open) rendering as the single
group it always was.

**The scroll target and the measured element have to be the same one.** They were
not: the scroll went to the enclosing list item so the question's title would be
on screen ([§3.5](#35-the-link-addresses-the-anchor-the-scroll-targets-the-question)),
while the active highlight measured the stamped leaning paragraph. Those sit about
90px apart and the active band is 96, so clicking a question scrolled to it and
then highlighted the **previous** entry. An entry now carries one element that
does both jobs, and the anchor id is kept only for the link.

> [!NOTE]
> A third symptom turned out not to be a defect and is recorded so it is not
> "fixed" later. Clicking a question near the end of a document leaves it partway
> down the viewport rather than at the top, and highlights the entry above it.
> That is the scroller reaching its maximum offset — the last screenful cannot be
> scrolled any further — and headings at the end of a document have always behaved
> the same way.

## 6. Decision Ledger

| ID | Ruling / Decision | Date | Settled in |
| :--- | :--- | :--- | :--- |
| OQ-C1 | List only questions carrying an `oq` directive. The gate makes that set exactly the questions awaiting a ruling. | 2026-09-20 | [§3.1](#31-only-tagged-questions-appear-and-that-is-not-a-filter) |
| OQ-C2 | Do not mint anchors for ✅ or 🔒 questions. | 2026-09-20 | [§3.1](#31-only-tagged-questions-appear-and-that-is-not-a-filter) |
| OQ-C3 | Reuse `answerableOpenQuestions` as a third caller rather than re-deriving the set. | 2026-09-20 | [§3.2](#32-the-count-comes-from-answerableopenquestions-which-already-exists) |
| OQ-C4 | Collect headings and questions in one document-order pass, one entry list. | 2026-09-20 | [§3.3](#33-headings-and-questions-are-collected-in-one-pass) |
| OQ-C5 | Read the label from the title paragraph, scoped to the enclosing item. | 2026-09-20 | [§3.4](#34-the-label-is-read-from-the-questions-title-not-from-the-stamped-element) |
| OQ-C6 | Link to the anchor, scroll to the enclosing item. | 2026-09-20 | [§3.5](#35-the-link-addresses-the-anchor-the-scroll-targets-the-question) |
| OQ-C7 | Move the status emoji vocabulary into `vantage-md`; the checker imports it. | 2026-09-20 | [§3.6](#36-the-status-vocabulary-moves-to-vantage-md) |
