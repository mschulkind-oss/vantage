# Planning Documents

A repository's plans are spread across many files: design documents with open
questions, implementation plans, and a roadmap that says what comes next. The
usual way to keep them in step is to copy each fact by hand into every file
that mentions it: a document's status, its stage, how many of its questions are
still open. The copies go stale, and nothing notices.

Vantage reads those files as a set instead. Each fact is written once, in the
document it belongs to, and everywhere else a plain Markdown link is enough:
Vantage shows the fact's current value in a **badge** beside the link, lists
under each document what links to it, and gathers every question still waiting
on someone onto one [planning page](#the-planning-page). Vantage never writes
into a document.

The terms this page defines (*planning document*, *stage role*, *routed* and
the rest) are Vantage's own, defined in the
[planning index reference](../../docs/reference/planning-index.md#2-terms).

---

## What Vantage reads

The **planning index** is Vantage's model of a repository's planning
documents. It is rebuilt from the files on every page load, in the background
and off the page's own thread, so scrolling and typing never wait for it. The
index itself is never stored, but to keep the rebuild cheap this browser keeps
what it found in each file, and fetches and scans a file again only once its
content has changed ([What this browser keeps](#what-this-browser-keeps)).

A document's first paint waits at most 150 ms after its content arrives, for
what is already on its way: its git facts for the header
([Git Integration](../features.md#last-commit-info)), and the planning index
when this browser already holds nearly all of it. Past that, the document
paints without them, and badges that arrive later appear only where they
cannot move what you are reading ([below](#badges-on-links)).

**Candidates.** Every `.md` file in the repository is a candidate unless one of
these rules it out:

- it sits in a hidden directory, or in a directory Vantage hides by default,
  such as `node_modules`, `dist` or a linked worktree
  ([Excluded Directories](../reference/configuration.md#excluded-directories));
- `.vantageignore` or your own ignore file matches it
  ([Ignore Files](../reference/configuration.md#ignore-files-and-live-reload));
- it is a symbolic link;
- the `[planning]` table in `.vantage.toml` excludes it
  ([Planning Documents](../reference/configuration.md#planning-documents)). By
  default that table excludes nothing.

**Planning documents.** A candidate is a **planning document** when its
frontmatter has a `status` or a `stage` key, or when it contains at least one
question directive: a `question` (the markup that declares a question, in any
state, and makes an open one answerable in one click; see
[Style Guide for Agents](../reference/style-guide.md)), or an `oq`, the
deprecated name it replaces. Every roadmap
([below](#the-roadmap)) is one too. Every other candidate is read, found to
be neither, and dropped. Only planning documents contribute to the index: their
header, their questions and their links.

**Questions.** A question is a `question` or an `oq` directive, identified by
its document and its `id`. Its state comes from the emoji before its bold
title:

| Marker | State |
| :--- | :--- |
| 💬 | open |
| 💬 🤷 | open, and a matter of preference |
| 🔒 | blocked on something upstream |
| ✅ | answered, and waiting to be compacted |
| none | open |

A question written without a directive does not exist to the index, so a
question keeps its `question` directive in every state, and changing its state
changes its marker and nothing else. An open question with no leaning yet takes
the directive with no `leaning`. `oq` is the name `question` replaces: every
Vantage still reads it, and a viewer before 0.8 offers the button on every `oq`
it meets, so `vantage-check` reports an `oq` on a 🔒 or ✅ question as
`vantage/question-name` and any other as `vantage/oq-deprecated`. Outside a
list, write the directive above the question's title: below it, the directive
lands on the block after the title, which carries no marker, so the question
reads as open, and `vantage/question-name` says so.

A question stops counting when its directive is removed, and that is normally
when it is **compacted**: once a question is ruled, the design-document
convention Vantage's own documents follow deletes the question and keeps one
row for it, id included, in the document's **Decision Ledger**, a table of
its rulings.

A directive with no `id`, a malformed one, or an id used earlier in the same
document still makes a question, counted like any other; it simply has no id
that a `#OQ-…` link could name. A directive inside a raw HTML block is not a
question to the index, although the page's
[table of contents](../features.md#table-of-contents) lists it.

---

## The header: `stage`, `next` and `depends-on`

Three top-level frontmatter keys sit beside `status`. They are facts about the
document, so each is written once, here, and read from here by everything else:

```yaml
---
title: "Bootstrapping an agent"
status: in-review
stage: DESIGN
next: "Rule OQ-B2 — the payload's install step waits on it"
depends-on:
  - pypi-distribution.md
---
```

| Key | Holds | Rules |
| :--- | :--- | :--- |
| `stage` | one word from the repository's own vocabulary | Shown as written, trimmed. Matched against `[planning.stages]` exactly, case included, so `Decided` is not `DECIDED`. When stages are declared, a word outside them is drawn in the warning tone, and `vantage-check` reports it. |
| `next` | the next step, as one line of plain text | A bare `OQ-…` id in it becomes a link to this document's question of that id ([below](#the-next-link)). |
| `depends-on` | what the document waits on: relative paths, each optionally ending in `#OQ-…` | Resolved like links. One path on its own counts as a one-entry list. A target that does not exist, lies outside the repository, or does not contain the id is reported by `vantage-check`. |

A value of the wrong shape, such as a `stage` that is a number or a list, or a
`next` that runs over several lines, is ignored. A header that does not parse
at all makes the whole file unreadable to the index, question directives
included.

**`stage:` is the only place Vantage reads a stage.** A repository that also
writes the word in a prose `**Status:**` line has a second copy that no tool
can read or check; keep the date and the reason there, and the word here.

**There is no `priority` key.** A priority only means something relative to
the others, so it belongs in an ordered list, a roadmap, rather than in
each document.

### Stage roles

A **stage role** says what a stage word means to Vantage. There are four, and a
repository maps its own words onto them in `[planning.stages]`
([Configuration](../reference/configuration.md#planning-documents)):

| Role | Means |
| :--- | :--- |
| `open` | still being decided |
| `ready` | decided, not built |
| `built` | built |
| `done` | not a live proposal: graduated, superseded, or reference material |

A document whose stage has the `done` role still gets its badge, its
[Referenced by](#referenced-by) line and its [file-tree badge](#in-the-file-tree),
but it appears in no section of the [planning page](#the-planning-page) or of
`vantage-check index`, its questions included, and a `depends-on` naming it
never makes anything wait. A document with no stage, or
in a repository that declares none, has no role, and every surface that needs
only questions and links still works for it.

---

## Badges on links

A link gets a badge when all of these hold:

1. it is a rendered Markdown link, not text inside code;
2. it points to a planning document in the same repository;
3. it points to *another* document, since a document's own table of contents
   already lists its questions;
4. the badge has something to show: for a document, a `status`, a `stage`, or
   at least one open or blocked question.

What the badge says depends on what the link names:

| The link names | The badge shows |
| :--- | :--- |
| a document | its status chip, its `stage`, then `💬 N` open and `🔒 M` blocked questions, e.g. `in-review · DESIGN · 💬 5`. Zero counts are left out. |
| a heading, `x.md#some-heading` | the same as a link to the document |
| a question, `x.md#OQ-X`, whose directive is there | its state: `💬 open`, `🔒 blocked` or `✅ answered` |
| an id whose directive is there, but is not a question: one above a table, say, or inside raw HTML | `⚠ not a question`. It was never compacted, so it is not ruled. `vantage-check` reports one above a table (`vantage/orphan`) |
| a question whose directive is gone, but whose id is still in the text | `✅ ruled`: compacting a question keeps its id in the Decision Ledger, so Vantage never has to read the ledger |
| a question whose id is nowhere in the document | `⚠ not found`. `vantage-check` reports the dead anchor too (`link/dead-section-anchor`) |

A badge is decoration, never content:

- **It sits after the link**, not inside it, and clicking it does nothing, in
  review mode included.
- **It is invisible to everything that reads the page's text.** Review comment
  anchors ignore it, so a badge whose count changes never moves a comment. It
  is also left out of the table of contents and of copied text.
- **It keeps up.** When a file changes, the badges on every open page follow
  without a reload. Answer a question, let the agent compact it, and the link
  to it turns to `✅ ruled`.
- **It never moves what you are reading.** When the index is ready as a
  document first paints, every badge is in that paint. When the index comes
  later, a badge is drawn only in the part of the document below the screen
  that you have not scrolled to yet, and a link you have already seen gets its
  badge the next time you open the document.
- **It prints as plain text**, and a screen reader reads it after the link as
  words: *in review, design, 5 open questions*.

Some places get no badges at all:

- **GitHub**, or any other renderer. A roadmap there reads as its links and
  their reasons, and each document's frontmatter table is one click away.
- **A static export** from [`vantage build`](static-sites.md), which has no
  server to read the files from. Its documents render exactly as they did
  before badges existed, with no Referenced by line and no file-tree badges
  either.
- **A link into another repository** in [daemon mode](daemon-mode.md). Each
  repository has an index of its own.

### The `next` link

A bare `OQ-…` id in a document's `next` is drawn as a link to that question,
in the frontmatter card at the top of the page, once the index is ready. Only
an id that one of *this* document's questions carries is linked. An id found
only in the text, such as a compacted one kept in the Decision Ledger, stays
plain, because its question has no anchor left to land on.

---

## In the file tree

A planning document's row in the sidebar shows a small badge after its name:

- **A dot** in the color of the document's status chip. In the default colors
  that is gray for `draft`, amber for `in-review`, green for `accepted` and red
  for `deprecated`. A document with a stage and no status gets a gray dot.
- **A hollow amber ring** instead, when the document's `stage` is not one of
  the words the repository declares ([Stage roles](#stage-roles)).
- **`💬 N`** when it has open questions. Blocked questions are not counted
  here.

Hover the badge, or the file name, for the words: *in review, design, 4 open
questions*. A stage that is not declared is spelled there exactly as the
document writes it, so a `design` that is not the declared `DESIGN` shows
which it is. A screen reader hears these words after the file name.

**The file name always comes first.** A badge only uses the room a name leaves
over, so a name is exactly as wide as it would be with no badge, and a long
name is cut short exactly where it always was. When the whole badge does not
fit in what is left, it is not drawn at all rather than cut in half; widen the
sidebar to see it, or hover the file name for its words. The dot that marks a file
with uncommitted changes stays at the end of the row, as it always has, and is
the smaller of the two, since the planning dot's amber and green are colors
that dot uses too.

Every other row, directories included, looks as it always did.

---

## The roadmap

A **roadmap** is a planning document whose links set an order. A repository can
have none, one or several, and which files they are is decided one of two ways:

- **Found by name,** with no `roadmap` key under `[planning]`, which is the
  default: every candidate named `roadmap.md`, in any directory, is a roadmap,
  so `roadmap.md` at the root and `docs/plans/roadmap.md` both are, with nothing
  to configure. The name is compared ignoring case, so `ROADMAP.md` is one too,
  but only among candidates, and the default `include`, `**/*.md`, does not
  match `ROADMAP.MD`. To hide a `roadmap.md`, rule it out as any file is ruled
  out: a hidden directory, `.vantageignore`, or `include` and `exclude`.
- **Listed:** `roadmap = "plans/roadmap.md"`, or a list such as
  `roadmap = ["roadmap.md", "docs/plans/roadmap.md"]`, names exactly the
  roadmaps, and finding by name is off. A listed file need not be named
  `roadmap.md`, and it is read even if `include` or `exclude` would rule it out.
  `roadmap = []` names none
  ([Planning Documents](../reference/configuration.md#planning-documents)).

A roadmap whose stage has the `done` role routes nothing: that is how an
archived roadmap stays in the tree without keeping its questions off *Not on a
roadmap*. With several roadmaps, the one nearest the repository root, in the
fewest folders and then by path, is the **default**, and the planning page
offers the others ([below](#several-roadmaps)).

What a roadmap holds is an **order**: a list of links, each with a one-clause
reason for its place. Everything the linked documents own is in their badges,
so a roadmap entry never copies a status, a count or a stage, and prose kept
beneath an entry holds only what has no other home, such as the condition that
would unblock it.

Its links, in document order, **route** questions. A routed question is one
some roadmap reaches:

- a link to a question, `x.md#OQ-X`, routes that question;
- a bare link to a document, with no `#`, routes every question in it, at that
  position, so linking a whole document under a heading is enough;
- a link to a heading, `x.md#some-heading`, routes nothing, although its badge
  is the document's. That is how a compacted question is cited, through
  `#decision-ledger`, without routing the document's other questions;
- a question reached twice keeps its first position;
- links to other files, to a document whose stage has the `done` role, and
  from a roadmap to itself route nothing;
- a link to another roadmap is an ordinary link: it routes the questions
  written in that roadmap, not the ones that roadmap routes.

An open question no roadmap routes is **not on a roadmap**: it needs a ruling,
and every list that says what to do next has missed it. The planning page lists
those under *Not on a roadmap*, and so does `vantage-check index`. A document
linked from a roadmap can still hold such a question, when the link names
another question or a heading.

---

## Referenced by

Below a planning document's frontmatter card, or at the top of a document
that has none, one line says whether a roadmap has the document and how many
planning documents link to it:

| The line | Means |
| :--- | :--- |
| *Referenced by 3 documents · on the roadmap under Building* | The roadmap [routes](#the-roadmap) this document or one of its questions. *Building* is the roadmap heading its first such link sits under |
| *Referenced by 3 documents · on the roadmap* | The same, when the roadmap's link sits above every heading |
| *Referenced by 3 documents · 2 open questions not on the roadmap* | The roadmap routes neither of two of its open questions: they need a ruling, and the roadmap has missed them. That part is in the warning tone |
| *Referenced by 3 documents · on the roadmap under Building · 1 open question not on the roadmap* | The roadmap routes one question and has missed another |
| *2 open questions not on the roadmap* | Open questions no roadmap routes, in a document nothing links to. The line is then the only place the document shows them, and there is nothing to open |
| *Referenced by 3 documents* | Other documents link here, and the roadmap has nothing to add |
| *Referenced by 3 documents · on plans/roadmap.md under Building and 1 other roadmap* | With several roadmaps that route: the first, nearest the root, that routes this document or one of its questions, named by as much of its path as tells it from the other roadmaps that route, and how many more route it |
| *Referenced by 3 documents · 2 open questions not on any roadmap* | With several roadmaps that route: two of its open questions are routed by none of them |
| *Referenced by 3 documents · on the roadmap under Building · its questions on the planning page* | The document holds a question, in any state, and its stage has no `done` role. The last part is a link to the planning page [filtered](#filtering-the-page) to this document |
| *its questions on the planning page* | The same, for a document nothing links to and nothing it holds is off the roadmap: the line is only the link |

The line reads the same in every browser: it never depends on the roadmap the
planning page shows. The count is of documents, not links, and a roadmap is one
of them when it links here. A document's links to itself do not count. When
nothing links to a document and it holds no question, or its stage has the
`done` role, there is no line. When no roadmap routes, the line names no
roadmap and no question off one, and for a document whose stage has the `done`
role it gives the count alone. With one roadmap that routes, it is *the
roadmap*, however many others are retired by a `done` stage or cannot be read.

**Its questions on the planning page** opens the planning page with its
[Filter box](#filtering-the-page) holding this document's path, as
`path:docs/design/search.md`, or `path:/notes.md` for a file at the root. That
filter keeps everything the page lists for the document: its open questions,
its 🔒 and ✅ ones, and its own rows, such as *Ready to build*. It is a link of
its own after the part you click to see who links here, so Ctrl-click or a
middle click opens it in a new tab, and it prints as text. Where the line is
cut off at its end, the words before the link give way, never the link. On a
narrow screen, when the line had no room kept for it, the link takes a line of
its own. A static export has no planning page, so its documents have no link.

Click the line, or press Enter or Space on it, to see who links here: one row
per document, the roadmaps that route first, nearest the root first, then the
rest by path. A row is the document's file
name, with its full path on hover, then the headings its links sit under. Each
heading links to the first line under it that links here. Two documents with
the same file name each show as much of their folder as tells them apart, such
as *brainstorm/x.md* and *design/x.md*, and names that differ only in capitals,
such as `roadmap.md` and `ROADMAP.md`, count as the same name. With several
roadmaps that route, a roadmap's row names it exactly as the line does, so
`docs/roadmap.md` is never shortened to a `roadmap.md` that would read as the
root's. A row shows four headings, then *+M more* for the rest.

The list is closed whenever you open a document, and nothing remembers that
you opened it. It prints only when it is open, and then with
every heading; the line always prints.

When a document opens before the index is ready, the line's room is kept for
it in the first paint, so the line fills in later without pushing the document
down, and stays blank if it turns out to have nothing to say. The room is kept
when the document's own `status` or `stage` key, or a question directive in it,
already shows it is a planning document. A roadmap with neither shows its line
the next time it is opened.

---

## The planning page

The planning page gathers, for one repository, every question that is waiting
on someone and every document whose stage calls for a next step. Press **`g p`**
while viewing a document or a folder to open it, or click the checklist icon
beside **Vantage** at the top of the sidebar. It is built from the index every time and stores nothing of its
own: no snooze, no assignment, no read state, no remembered filter. It changes
when the documents do, without a reload. Its **Filter** box, at the top, narrows
it to one piece of work as you type ([below](#filtering-the-page)).

It sits in the app as a document does: the sidebar is beside it, with its file
tree, bookmarks and recent files (**`b`** puts it away and brings it back), and
the header carries the sidebar button, the
[contents column](#the-contents-column) and
[full width](../features.md#full-width) toggles, and
[Copy answers](#copy-answers). The contents and full-width toggles are the
document viewer's own: turned on for one, they are on for the other. The keys
that act on the page work here too (`t`, `r`, `Shift+P`, `?`, `j`, `k`), and
those that act on a document, such as `d` for its diff, do nothing, so the
shortcuts help (`?`) leaves them out. One key is the planning page's own: `/`
puts the focus in the Filter box. Going between a document and this page
leaves the sidebar exactly as it was, its tree scrolled where you left it. The
page scrolls with PageDown, Space and the arrow keys as soon as it opens. The
cards keep a reading width; **Use full width** widens them to the window.

Its address is `/.vantage/planning`, or `/.vantage/planning/<repo>` in
[daemon mode](daemon-mode.md). A document's own address is its path, `/<path>`
or `/<repo>/<path>`, so a page at `/planning` would hide every document under a
top-level `planning/` directory, and a whole repository named `planning`.
Vantage never serves a `.vantage` path as a document, so this address hides
nothing. In daemon mode, the address with no repository, or with one Vantage
does not serve, lists each repository's planning page, with the rest of the
address kept, so a [filtered](#filtering-the-page) link is one click from the
page it was made for.

> [!NOTE]
> **The history and recent-files pages do hide something.** They are older, and
> `/history/…` and `/recent/…` are theirs, so a document in a top-level
> directory named `history` or `recent` cannot be opened in the viewer:
> `/recent/notes.md` is the recent-files page, and `/history/notes.md` is the
> commit history of a root-level `notes.md`. In daemon mode the same goes for a
> whole repository named `history` or `recent`.

**What appears when.** The page's header, its Filter box and its
[section bar](#pages) appear as soon as you press `g p`. The cards of each
section's shown page follow together, in one step, once their text, their
documents' comments and their Mermaid diagrams are all in hand, so nothing on
the page moves as they arrive. A spinner shows only if that takes longer than
150 ms. Opened while the index is still being read, the page says *Reading
planning documents…* where the section bar will be, then *Scanning planning
documents: 412 of 1,000*, and the section bar and the sections replace that
line when the index is ready. A rescan of an index already shown keeps the page
as it is, with a thin bar along its top.

### Its sections

From top to bottom, leaving out any that are empty, each with its count and
who does the next thing with its entries:

| Section | Holds | Who acts | Each entry shows |
| :--- | :--- | :--- | :--- |
| **Needs you** | Questions the shown roadmap [routes](#the-roadmap) that are open or answered, in its order | you | the question's [card](#a-questions-card) |
| **Not on a roadmap** | Open questions no roadmap routes, by path | an agent proposes where each goes, and you confirm | the question's card |
| **Blocked** | Blocked questions, and documents with a `depends-on` entry that still waits: one naming a question waits while it is open (💬), and one naming a document waits while that document has an open question | nobody: what it waits on comes first | a blocked question's card; a document's name and badge, then *blocked on* each entry it waits on, with that entry's badge |
| **Ready to build** | Documents whose stage has the `ready` role and no open questions; one can be under *Blocked* too | an agent | the document's name and badge |
| **Ready to graduate** | Documents whose stage has the `built` role and no questions left; one can be under *Blocked* too | an agent | the document's name and badge |
| **Stage conflict** | Documents whose stage says `ready` or `built` while they still have open questions | an agent | the document's name and badge |
| **Too large** | Candidates over the size limit ([below](#limits)) | you | the path, its size and the limit |
| **Unreadable** | Candidates that could not be read, or whose frontmatter does not parse | you | the path and why |

Under each heading, one line says what the section's entries are and what to
do with them, such as *Built, with no questions left. An agent turns it into a
reference doc.* under *Ready to graduate*. The [section bar](#pages) and the
[contents column](#the-contents-column) show the same line when the pointer
rests on a section's name, and `vantage-check index` prints it under each
heading. A section that is an agent's work has **Copy agent request**
([below](#agent-requests)).

Clicking a document's name opens it in this tab, and **Back** returns to the
planning page with the same [pages](#pages), at the same scroll position. A
card's **Open document** opens it in a new tab instead
([below](#a-questions-card)).

Two cases change the sections:

- **When no roadmap routes,** because no candidate is named `roadmap.md`, or
  each roadmap is missing, too large, unreadable or retired by a `done` stage,
  *Needs you* lists every open question by document, *Not on a roadmap* is not
  shown, and a line says what the page looked for and how to point it at a roadmap,
  such as *No roadmap: no planning candidate is named roadmap.md, so Needs you
  lists every open question by document.*, followed by what to do: when every
  roadmap found or listed is retired by a `done` stage, that is to give it a
  stage without the `done` role. A listed roadmap is missing when it does not exist or is not in the file list Vantage
  shows: a hidden or excluded directory, a `.vantageignore` match, or a file not
  named `.md`.
- **When a listed roadmap cannot be read while another routes,** the sections
  are as usual, and a line names it: *Not read as a roadmap: plans/b.md, which
  roadmap under [planning] lists, is missing or not in Vantage's file list …*.
- **With no stages declared,** *Ready to build*, *Ready to graduate* and
  *Stage conflict* are not shown, and a line says how to declare them.

When no document has an open question, `done` documents aside, the page says
**Nothing needs you**. That line can sit above a *Needs you* holding only ✅
answered questions: those await compaction, not a ruling. It says so too once
every open question has your answer waiting on the agent
([below](#a-comment-on-a-question-is-your-answer)).

Past the candidate limit ([below](#limits)) there are no sections at all, only a
line saying how many candidates there are and to narrow `include`.

### Several roadmaps

When two or more roadmaps route, a **Roadmap** menu sits above the section bar,
or at the head of the [contents column](#the-contents-column) while that is
shown. There is only ever one.
It lists each by its full path, nearest the repository root first, with how
many of its questions need you, such as `docs/plans/roadmap.md (4 need you)`:
a question you have already answered with a comment, waiting on the agent, is
not counted.
The path is never shortened: on a narrow screen the closed menu wraps it onto a
second line rather than cut off its end.
*Needs you* follows the one shown, in its order, and after the menu a line says
how many more questions need you only on the others, such as *3 more questions
need you on other roadmaps.*, again leaving out those you have answered. Those
questions are on a roadmap, so they are not under *Not on a roadmap*: choose
their roadmap to see them.

- **The address says which roadmap is shown,** as
  `?roadmap=docs/plans/roadmap.md` (the `/` may be escaped as `%2F`; both
  read alike), so a copied link shows the same roadmap to anyone.
- **Choosing one** replaces the history entry rather than adding one, as a
  [flip](#pages) does, and shows *Needs you* from its first page. The menu
  changes at once, and the sections once the new cards are ready; a spinner
  beside the menu, in room kept for it, shows when that takes a moment.
- **This browser remembers your choice** for each repository, and the next
  visit opens on it. Only a choice made in the menu is remembered, never a link
  that names one, opened or [pasted](#filtering-the-page), and a choice made in
  another tab does not change a page already open.
- **Which roadmap is shown:** the address's, when it names one that routes;
  else the one this browser remembers, while it still routes; else the one
  nearest the root. A roadmap that stops routing, because it was deleted,
  renamed, excluded or given a `done` stage, gives way in the same order, and
  the address is corrected in place.
- **[Copy answers](#copy-answers)** covers the questions of every roadmap, so
  choosing another changes neither what it copies nor its count.
- **Under a [filter](#filtering-the-page),** the menu's counts and the line
  after it count only the questions the filter keeps, and choosing a roadmap
  keeps the filter.

With one roadmap that routes, or none, there is no menu, and the address
carries no `roadmap`.

### Pages

Each section shows one page of its entries at a time, so the page opens as
quickly for a thousand documents as for ten:

| Sections | A page holds |
| :--- | :--- |
| Needs you, Not on a roadmap, Blocked | 10 entries, or fewer when their cards together would pass 32,768 characters of Markdown. A page always holds at least one entry, and a [preview card](#a-questions-card) counts for none of those characters |
| Ready to build, Ready to graduate, Stage conflict | 25 documents |
| Too large, Unreadable | 50 lines |

- **The section bar,** under the header, names each section that is not empty
  with its count, such as `Needs you 143 · Not on a roadmap 12 · Blocked 7`.
  The counts are of the whole section, whatever page is shown. Clicking one scrolls to its
  section without adding a history entry.
- **A pager** sits under the heading of a section with more than one page, and
  again after its last entry: `1–10 of 143 · ‹ Previous · Next ›`, with a page
  menu once a section has five pages. The pager at the bottom brings the
  section's heading back into view; the one at the top leaves the scroll where
  it is. A section of one page has no pager.
- **The page you flip to** replaces the shown one only once its cards are
  ready, and the shown page stays up until then.
- **The address carries the pages,** as in
  `/.vantage/planning?needs-you=3&waiting=2`, with page 1 left out. A flip
  replaces the history entry rather than adding one, so Back from a document
  you opened in this tab returns to the same pages at the same scroll
  position, and Back from the planning page leaves it rather than stepping
  back through its pages. A page past a section's end shows its last page, a
  value that is not a page number shows page 1, and either way the address is
  corrected in place. A flip keeps the [filter](#filtering-the-page), and a
  filtered page's numbers count only what the filter keeps.

Paging decides only what is drawn. Every question is still counted in the
section bar and reachable through its section's pager, and
[Copy answers](#copy-answers) and the [agent requests](#agent-requests) cover
the entries on every page.

### The contents column

The header's contents toggle, the one that shows a document's
[table of contents](../features.md#table-of-contents), shows the page's outline
in the same column here, beside the cards:

- **Each section** that is not empty, with its count. Clicking one scrolls to
  it, as the section bar does.
- **Under a section,** the documents it lists, in the section's order, each by
  its file name with its folder below it, and after the name how many of its
  questions the section holds (under *Stage conflict*, how many are still
  open).
  Clicking one shows the page of the section that holds its first card or row,
  and scrolls to it. Like a flip, that replaces the history entry.
- **Where you are** is marked as you scroll: the section, and the document
  whose card is at the top of the page.
- **Every entry is a link.** Tab reaches it and Enter follows it, and
  Ctrl-click or a middle click opens it in a new tab, at the same page and card.
- **With several roadmaps,** the **Roadmap** menu sits at the head of the
  column instead of above the section bar, its path and count whole, wrapped
  to the column's width.

A section lists its first 50 documents, then says how many more there are; its
pager reaches them. The column is not drawn on a narrow screen, where the menu
stays above the section bar.

### A question's card

A card shows the question as its document renders it, laid out to be read at
a glance. Above it, the card names the document, with that document's badge;
clicking the name opens the document in this tab.

- **The question's bold title is the card's headline,** after its status
  emoji, and the rest of its list item, or of its own block when it is not in
  a list, follows it.
- **Its leaning is a block of its own,** set off in color, and an answer
  already written in is shown whole.
- **The rest is cut to three lines** while the card is folded. When that
  hides anything, the last line shown fades out and **Show full question**
  sits right under it, where the question stops; unfolded, **Show less** at
  the end of the question folds it again. The card's top stays where it was
  on the screen either way, and from the keyboard the focus goes to what you
  revealed: the question, unfolded, or Show full question, folded. Tabbing to
  a link in the hidden lines unfolds the card. A question that fits its lines
  shows neither. A question opened with Show question from its preview card,
  below, arrives unfolded, and a printout shows every card unfolded.
- **An empty answer is not shown:** the convention's `**Answer:**` over
  `_(empty — fill in when decided)_` is left out until someone fills it in.
- **The badges on links inside the question are quiet,** with no colored box,
  no capitals and no color, the status emoji in gray, so they read as context
  rather than as the card's news.

Nothing is summarized or rewritten: every word on the card is the document's
own. A question with no bold title, such as a bare paragraph, shows as its
document renders it, with its directive's leaning beside it when it writes none
out.

**Expand all**, at the end of the line naming the sections, unfolds every card
on the page, and **Collapse all** folds them again. Either one also decides how
cards open from then on: on the section's next page, in the other sections, and
the next time you open the page. Vantage remembers it in this browser, as it
remembers [full width](../features.md#full-width). Unfolding or folding one card
yourself wins for that card, even after you flip to another page and back, until
you next press Expand all or Collapse all.

What the card offers follows the question's state:

| State | Take this leaning | Answer… | Open document |
| :--- | :--- | :--- | :--- |
| 💬 open, or no marker | yes | yes | yes |
| ✅ answered | no: it has been ruled | yes | yes |
| 🔒 blocked, under *Blocked* | no | no: it cannot be answered yet | yes |

- **Take this leaning** files the question's leaning as a review comment on
  it: the same comment review mode's own **Take this leaning** button files in
  the document, with the same text, anchored to the same place, and *Take the
  stated leaning.* when its directive states none. Once it is filed, the card
  says *Leaning taken*, with **Undo**, which deletes the comment, until someone
  replies.
- **Answer…** opens the comment box, and what you type is filed on the
  question the same way.
- **Open document** opens the question's document in a new tab, as its icon
  says, and the planning page stays as it was in its own. It opens at the
  document's top, not at the question: a question you could not answer from
  its card usually needs the rest of the document, and its table of contents
  lists the question one click away. To open the document in this tab instead,
  click its name above the question; **Back** then returns to the planning
  page with the same [pages](#pages), at the same scroll position. Either way,
  opening it leaves the document's review mode as it was.

A comment filed from a card is filed in the question's own document, exactly as
if you had filed it there: that document's Review panel lists it, its own Copy
includes it, and the agent answers it through the
[review inbox](review-inbox.md) as usual. Filing never reorders the page.

#### A comment on a question is your answer

Any comment on a question that is still waiting on the agent is your answer to
it: Take this leaning, Answer…, or a comment you typed on any part of the
question in its document — its title, an option, the leaning, the Answer. The
card then says so where Take this leaning stood: *Leaning taken* for the
leaning you took, otherwise *Answered — waiting on the agent*. The question
stays where it is, so you can see what you answered, and Copy answers includes
the comment, but not Answer…: your answer is filed. It no longer counts as
needing you: the roadmap menu's counts, the line counting the questions on
other roadmaps and *Nothing needs you* leave it out, and its section's count
says how many it lists are answered, as *Needs you 3 (2 answered)*. Nothing is
written into the document: `vantage-check index`, which reads documents and no
comments, counts it as before.

Once the agent replies, or you dismiss the comment, the question needs you
again until its document says it is settled, and its card offers Answer…
again. A take says what became of it, *Leaning taken — the agent replied* or
*Leaning taken — dismissed*, and is not offered again, since that would send
the agent the same leaning twice: answer with Answer…, or, while nobody has
replied, Undo the take and take it afresh. Review mode in the document offers
the same, in the row at the end of the question.

An answer counts from the moment the page opens, whichever roadmap's question
it answers. Only when its document's comments take longer than a second to load
does *Nothing needs you* wait for your next page flip or roadmap choice, so
nothing moves under you while you read.

When comments are filed on that question, and only on it, the card's row of
buttons ends with their count, such as *2 comments*, which shows or hides
them. Comments already in hand when the card appears are listed below its
buttons at once. The page waits up to a second for them; comments that load
later than that go only into the count until you open it, so the card never
grows under you. Each is marked *waiting on the agent* until the agent answers
it, the agent's latest reply appears beneath it once there is one, and a
dismissed comment says so. A comment filed while the page is open, from the
page or elsewhere, shows up on its card at once.

A Mermaid diagram in a card is drawn before the card appears. One that takes
longer than a second draws later into a frame of fixed height, 240 px, scaled
to fit.

**A very long question gets a preview card.** When the Markdown a card would
render is over 32,000 characters, the card shows only the document's name and
badge and the question's marker, title, state and leaning, with **Show
question** and **Open document**. Show question renders the whole card in
place, and it then offers Take this leaning and Answer… as any card does:
both need the rendered question to anchor the comment to.

### Copy answers

**Copy answers**, in the page's header, hands every answer given on the page
to the agent in one trip, rather than one trip per document. Beside it is the
number of comments waiting on the agent on the questions the page lists: not
dismissed, and not yet answered, or edited or replied to since the agent's last
answer. With none, the button is disabled.

It counts and copies the comments on the questions of every
[page](#pages), not only the ones shown, so a comment on a question two pages
on is included, and those of every [roadmap](#several-roadmaps), so is one on
a question only another roadmap routes. The count reads `–` until every listed document's comments have
loaded, and the button waits until then; the count has room for four digits, so
its arrival moves nothing. A question whose card has not been drawn in this
visit gets the comments filed on its lines in the document, which is exact
unless the question has moved since a comment was filed.

It copies those comments grouped by document, each group exactly the block that
document's own Copy produces, then one set of instructions for answering all of
them. Each answer the agent delivers names the document it is about, so replies
come back through the [review inbox](review-inbox.md) as any other reply does.
With several documents the delivery file the instructions suggest is
`.vantage/inbox/planning.<random>.jsonl`, because the name is only a
suggestion: Vantage reads which document a line is about from the line itself.

Only comments on questions the page lists are copied. A document's other
comments, on its prose or on a question the page does not list, are left to
that document's own Copy.

**Under a [filter](#filtering-the-page),** Copy answers covers only the
questions the filter keeps, and its count only their comments, so the agent
working on one piece of work gets that work's answers and no one else's. Its
tooltip, and the name a screen reader hears, say how many waiting answers the
filter leaves out; clear the filter to copy those too. A comment is placed on
its question as it is without a filter, so a comment on a question the filter
hides, such as a ✅ question inside an open one under `is:open`, is never
credited to the question around it.

### Agent requests

Four sections are an agent's work: *Not on a roadmap*, *Ready to build*,
*Ready to graduate* and *Stage conflict*. Each has **Copy agent request** beside
its heading, which copies an instruction for an agent covering every entry of
that section, on every [page](#pages), not only the ones shown. **Copy all
agent requests**, before Expand all on the line naming the sections, copies one
instruction covering all four. An empty section is not shown, so it has no
button, and with all four empty there is no Copy all agent requests.

| Section | The request asks the agent to |
| :--- | :--- |
| Not on a roadmap | propose where each question belongs on a roadmap, with a one-clause reason, and leave the order for you to confirm. It decides no priority |
| Ready to build | build each document from its plan, then give it a stage with the `built` role. If one should not be built, it asks you before retiring it, with the stage with the `done` role you choose. It skips a document marked blocked, one *Blocked* lists too |
| Ready to graduate | rewrite each as a reference document of the system as built, verified against the code, saying what it covers and the commit it was verified at, with the stage your other reference documents carry; then delete the design document and any plan written for it, repoint every link and citation of them, in documents, code comments and tests, and keep every question id that other documents cite resolvable |
| Stage conflict | find whether the stage or the open questions are wrong, from the document and the code, and set a wrong stage back to one with the `open` role, or propose moving a follow-up question to a new document. It rules and answers nothing: where a question looks settled, it tells you what it found and asks you for the ruling |

Every request names the repository, by the absolute path of its root, and
each entry by its path, with its question's id and title or the document's
stage, and for a document *Blocked* lists too, what it waits on. It ends with
how to check the work: run `vantage-check` on the Markdown files changed, then
`vantage-check index`. Vantage writes the text when you press the button, from
the index on screen, so it names what the documents say now, in the stage
words `[planning.stages]` declares now. Nothing is stored, nothing is fetched,
and nothing needs to be selected first. Until the server has reported the
repository's root, the request names it `.`, or by its name in
[daemon mode](daemon-mode.md).

The button's label reads *Copied* for two seconds, in room kept for it, so
nothing moves. Neither button prints. `vantage-check index --request` prints the
same text, so an agent can ask for it itself
([`vantage-check index`](vantage-check.md#vantage-check-index)).

**Under a [filter](#filtering-the-page),** both buttons cover only the entries
the filter keeps, and the request says so in a line after `Repository:`:

```text
Filter: `path:docs/design/search.md is:open`. Only the entries it keeps are listed.
```

The agent can run `vantage-check index --request --filter` with that text and
get the same request. The line leaves out a `path:` term that matches no
path, with or without its `-`, since leaving it out keeps the same entries,
so the checker accepts its text as it is. What an entry is *blocked on* is
still read from the whole page, so a filter never hides that a document waits
on another. A filter the page does not understand is not applied, so its
request has no `Filter:` line.

### Filtering the page

The **Filter** box at the top of the planning page narrows it to one piece of
work, the way a search box does. Type a word, such as `generator`, or a filter
such as `path:docs/design/search.md is:open`, and the page follows as you
type, with no Enter to press: it lists only the entries the filter keeps, in
the order they had, and a notice above the sections says what it hides. The
box is there in every state of the page, from its first paint, before the
index is ready too.

A **filter** is one line of text, and the same text works in three places: the
box, the page's address, and `vantage-check index --filter`
([Handing the human a filtered planning page](vantage-check.md#handing-the-human-a-filtered-planning-page)).
So a link an agent hands you holds a filter you could have typed, and what you
type is what the agent's command takes.

#### Writing a filter

A filter is **terms** separated by spaces. A term is a word, a phrase in
double quotes, or a key, a `:` and a value, and a `-` in front of any of them
leaves out what it matches:

| Term | Keeps |
| :--- | :--- |
| A word, such as `generator`, or a phrase, such as `"command surface"` | Entries that hold it, in any case. A question is matched by its id, its title, its leaning and its document's path; a row under *Blocked*, *Ready to build*, *Ready to graduate* or *Stage conflict* by its path, its `stage` and its `next`; a *Too large* or *Unreadable* entry by its path. A phrase is matched whole, spaces included |
| `path:<pattern>` | Entries whose path the pattern matches: for a question, its document's path; for a row under *Blocked*, *Ready to build* or any other section that lists documents, the row's own path |
| `is:open` | Questions still open: 💬, 💬 🤷 or no marker. Never a 🔒 or ✅ question, and never a document's row |
| `-` and a term, such as `-payload`, `-path:docs/archive` or `-is:open` | Everything but what that term keeps. `-is:open` leaves out open questions and keeps every row |

- **Every word must match, and `path:` terms keep any of their matches.** So
  `generator is:open` keeps the open questions that hold *generator*, and
  `path:docs/design/search.md path:docs/design/search-plan.md is:open` keeps
  the open questions of both documents. Words match in any order, and each in
  a field of its own, so a question can match one word by its title and
  another by its path.
- **A word matches any part of a field, and nothing more.** `gen` matches
  *generator*, and `pypi` matches *PyPI*, but a typo matches nothing, and
  neither does `cafe` match *café*. Outside `path:`, `*` and `?` are just
  characters.
- **Only those fields are searched:** never a question's body or its
  comments, the rest of a document's frontmatter, or a file that is not a
  planning document.
- **Only `path` and `is` are keys.** Any other term with a colon in it is a
  word: `Note:` and `http://x` are searched as text. When the part before the
  colon is a lowercase word, as in `stage:ready`, the notice says *`stage:` is
  not a filter key*, so you know a key you meant was read as a word. The keys
  are lowercase: `Path:docs` is a word too.
- **A word is the quick way to a path.** `path:` matches whole folder and file
  names, so `path:docs/des` matches nothing until `design` is complete, while
  the word `docs/des` keeps every entry whose path holds it.
- **`is:open` keeps a question you have already answered** with a comment,
  since Vantage reads no comments to decide what is open. It stays under its
  section's *(N answered)* count.
- **A filter never reorders anything.** *Needs you* keeps its roadmap's order,
  and a section the filter empties is not shown.

A `path:` pattern is written as in a `.gitignore` file, with fewer forms:

| Pattern | Keeps |
| :--- | :--- |
| `path:docs/design/search.md` | That file. A `/` anywhere but at the end ties a pattern to the repository root |
| `path:search.md`, `path:*search*` | That name in any folder: with no `/` inside, a pattern matches at any depth |
| `path:/roadmap.md` | Only the root's file, since `path:roadmap.md` keeps `docs/roadmap.md` too |
| `path:docs/design` or `path:docs/design/` | Everything under that folder |
| `path:docs/design/search*` | The design and its `search-plan.md`: a `*` matches within one folder |
| `path:docs/**/*.md` | Any depth below `docs`: a `**` that is a whole folder of its own crosses folders |
| `path:"docs/my notes.md"` | A path holding a space, or any character but `A`–`Z`, `a`–`z`, `0`–`9`, `.`, `_`, `-` and `/`. Inside double quotes every character stands for itself, `*` included, and `"` and `\` are written `\"` and `\\` |

A leading `./` means the root, as `/` does. A `path:` pattern is matched
exactly: `path:Docs` does not keep `docs`, and a name is matched in the Unicode
form it is written in. A word is the way to find a path in any case.

**What Vantage does not understand.** Only text that is malformed: an
unclosed quote; a quote around part of a term, as in `a"b"`; an empty `""`; a
`\` inside quotes before anything but `"` or `\`; a `-` on its own; an empty
`path:` or `is:`; an `is:` value other than `open`, such as `is:closed`; a
bare `path:` pattern holding any character the table above puts in quotes; a
`**` that is not a whole folder with more of the path after it, as in
`docs/**`, where `/docs/` keeps everything under the root's `docs` folder, or
two `**` folders in a row; two `/` in a row, or a `.` or `..` folder past a
leading `./`, in a `path:` value; a control or invisible character inside a
term, such as a zero-width space, though a tab or a line break between terms
is only a space; and more than 64 terms or 2,048 code points. Such a
filter is **not understood**, and none of it is applied, since applying only
the terms it reads could hide entries the filter asked for:

- **While you type one,** such as a phrase whose closing quote is still to
  come, the page keeps what it shows, and the box's hint says *Not applied:
  Enter says why*. On a narrow screen the hint is an amber icon beside the
  box, with those words as its tooltip.
- **Press Enter on it, or open a link that holds one,** and the page shows
  every entry, the box gets an amber ring, and the notice names what it could
  not read, as in *Not filtered: this Vantage cannot read `is:closed`. It
  reads words, "quoted phrases", path: and is:open terms, and a - before any of
  them to leave out what it matches, such as
  `generator path:docs/design/*.md is:open`. Every entry is shown.*

#### What the notice says

Under a filter, the first of the page's notices says how much of the page it
shows:

*Filtered by `path:docs/design/search.md is:open`: 5 of 15 entries, in 1 of 20
paths, 5 of them open questions.*

That is the entries shown, of all the entries the page would list without it;
the documents its `path:` terms keep, of every path the index lists; and how
many of the entries shown are open questions. The paths are left out when the
filter keeps every one, as a filter of words alone does. A line follows for
each of these that applies:

- **A `path:` term that matches no path:** *`path:docs/desing` matches no
  path the index lists.* The rest of the filter still applies, and that term
  keeps nothing, or with a `-` in front leaves nothing out. A word that matches
  nothing gets no line: the counts already say what it kept.
- **A word before a `:` that is not a key:** *`stage:` is not a filter key, so
  `stage:ready` is searched as text. The keys are `path:` and `is:`.*
- **Questions on other roadmaps:** *2 more questions it keeps are on other
  roadmaps: `docs/a/roadmap.md` (1), `docs/b/roadmap.md` (1). Choose one to
  see them; the filter stays.* A question only another roadmap routes is in
  no section, so it is counted here rather than shown.
- **Blocked questions left out:** *3 of its questions are blocked and will
  need you later.* It counts the 🔒 questions the rest of the filter keeps and
  `is:open` leaves out, so you know whether another round of rulings will
  come.
- **A document waiting outside the filter:** *docs/design/x.md waits on
  docs/design/y.md, which this filter leaves out.* Add a `path:` term for that
  document to see what it holds.

The last line says how to see the rest, as *Clear the filter to see the other
10.* When nothing the filter keeps needs a ruling, the page says *Nothing this
filter keeps needs you* in place of *Nothing needs you*.

#### Using the box

- **`/`** puts the focus in the box and selects its text, so what you type or
  paste replaces it. It works wherever the page's shortcuts do: with **Enable
  shortcuts** on in Settings, and the focus outside a text field. If the
  shortcuts help is open, `/` closes it first. Tab and a click reach the box
  either way. On a document `/` does nothing, so Firefox's quick find keeps it.
- **Typing applies.** Each key that changes the filter changes the page, and
  the box shows what you type at once, whatever the page is doing. The page
  keeps the shown entries until the new ones are ready, then swaps them in
  together without moving anything, and the results that stay are always
  those of the last text you typed. A key that leaves the filter as it was, such as a second
  space, changes nothing. While an input method composes, as for Japanese or
  Chinese, nothing applies until the composition ends.
- **Enter** applies the box's text and writes it into the address at once,
  and the box then shows it in its [canonical text](#the-address). On a text
  Vantage does not understand, Enter is how you see why: the page shows every
  entry, and the notice names what it could not read.
- **✕** clears the filter and applies that at once, and the focus stays in the
  box.
- **Esc** puts back the filter the page shows when the box holds a text that
  is not applied, and otherwise gives the focus back to the page. It never
  clears the filter.
- **Leaving the box** writes the filter into the address at once, if the
  address does not hold it yet. A text that is not applied stays in the box,
  with its hint.
- **Pasting a planning link** applies its filter at once, as Enter does. The
  link can be a whole URL or start at `/.vantage/planning`, on its own or
  inside the lines `vantage-check index --filter` prints around it. Backticks,
  quotes, brackets or the `*` of emphasis around it, and a period after it,
  are not read as part of it. Only its filter, and its roadmap when it names
  one, are read, never its scheme, host, port, repository or pages, so a link
  made for another address or another machine applies to the repository on
  screen. The roadmap it names is shown, not remembered. A link with no filter
  in it clears the filter. Pasted text that holds no planning link applies as
  typed text does, and goes into the address at once.
- **While a filtered page is on its way,** the shown page's pagers and
  contents column do nothing, and a spinner in the box's row shows when the
  wait takes more than 150 ms.

#### The address

The page's address carries the filter, as
`/.vantage/planning?filter=path:docs/design/search.md+is:open`. That is how
the checker prints it too: `:` and `/` stay readable, a space is a `+`, and
every other character but `A`–`Z`, `a`–`z`, `0`–`9`, `-`, `.`, `_` and `~` is
percent-encoded, such as `*` as `%2A`. A `.` or `_` that would end the address
is encoded too, so a sentence's period after a pasted address cannot take it.

- **The address follows the box.** Once you stop typing for 300 ms, the
  address takes the filter the page shows. Enter, ✕, a paste and leaving the
  box write it at once, so an address you copy right after typing holds the
  filter on screen.
- **Typing never adds a history entry.** Each write replaces the history entry
  rather than adding one, as a flip does, so **Back** goes where it went before
  you typed. A write shows every section from its first page, keeps the
  roadmap and the rest of the address, and drops a `#` anchor.
- **Vantage writes an understood filter in one spelling,** its canonical text:
  a repeated term is dropped, quotes that are not needed are dropped, as in
  `"pypi"`, and a leading `./` or `/` that changes nothing is dropped, so
  `path:./docs/x.md` reads `path:docs/x.md`, while `path:./roadmap.md` reads
  `path:/roadmap.md`. A word keeps the case you typed it in. The address holds
  the canonical text, and the box shows it after Enter and when a link opens,
  but never while you type: what you typed stays as you typed it, so the
  caret never jumps.
- **A filter Vantage does not understand** stays in the address and the box
  exactly as written once you press Enter, or open a link that holds one, so
  you can fix it.
- **A flip, a roadmap choice and the contents column's links keep the
  filter,** written the same way. An address written by hand may spell it
  with `%3A` and `%2F` for `:` and `/`, and both read alike.
- **`g p` and the sidebar's planning entry open the page with no filter,**
  whatever document you were on, and **Back** returns to the filtered page,
  with the box holding its filter again.
- **Nothing remembers a filter.** It lives in the address and in the box, and
  a link that holds it is the way to share it.

#### Everything else under a filter

- The section bar, the pagers and the [contents column](#the-contents-column)
  follow the filtered sections.
- A *Blocked* row the filter keeps still names every document it waits on.
- [Copy answers](#copy-answers) and the [agent requests](#agent-requests)
  cover only what the filter keeps, as their sections say, and with
  [several roadmaps](#several-roadmaps) the menu counts only the questions it
  keeps.
- In print, the box is left out. A line, *Filter:* and the filter, prints in
  its place, and the notice prints too, so a printout always says it is
  filtered and by how much.
- A screen reader hears the notice when the address takes a filter: at once
  on Enter, ✕ or a paste, and for typing once you have stopped for a second
  or left the box. It hears that every entry is shown after you clear one. It
  hears nothing per key, however slowly you type, and nothing as the page
  opens. The box is described by the notice, and by its hint while it shows.

#### Filtered links

A filtered page is usually reached by a link:

- **From a document:** its [Referenced by](#referenced-by) line ends with *its
  questions on the planning page*, which opens the page filtered to that
  document.
- **From an agent:** `vantage-check index --filter` prints a `Planning page:`
  line
  ([Handing the human a filtered planning page](vantage-check.md#handing-the-human-a-filtered-planning-page)).
  It starts at `/.vantage/planning`, because the checker cannot know the
  address you open Vantage at. Press `/` on your planning page and paste the
  line, or put that address in front of the link, such as
  `http://localhost:8000`, and open it.
- **In [daemon mode](daemon-mode.md),** such a link has no repository in it,
  so opened with an address in front it lists each repository's planning page,
  every one with the same filter. Pasted into a repository's Filter box, it
  needs no click.

A filtered link is for handing over, not for keeping. A later Vantage may keep
other entries for the same text, so an agent runs `vantage-check index
--filter` again rather than reuse an old link, and the notice always says what
the page in front of you shows.

A Vantage from before the filter, 0.8.1 or earlier, has no Filter box and opens
a filtered link as the whole planning page, without saying so. A page with no
*Filtered by* notice is not filtered, and its Copy agent request has no
`Filter:` line. A static export has no planning page.

---

## Reading it from the command line

`vantage-check index` prints the planning index of the repository the current
directory is in, so an agent sees what a person sees, with no server running.
It prints the [planning page's sections](#its-sections) as text, with the same
notices, and leaves out any that are empty: a question as its path, line,
marker and title rather than a card, and a document as its path. Each section's
heading is followed by the line the page shows under it, and `--request` prints
the [agent requests](#agent-requests) the page copies.

After the sections comes the roadmap *Needs you* follows, with each link's badge
written inline in brackets. With several roadmaps it lists them all, chooses the
one nearest the root as the page does, and takes `--roadmap <path>` to choose
another. `--filter` takes the text of the [Filter box](#filtering-the-page),
prints the filtered sections, and prints a link to the filtered page for an
agent to hand you. The options, the JSON form and the exit codes are in the
vantage-check guide's [`index` section](vantage-check.md#vantage-check-index),
and the `planning/*` rules that `check` runs over the same scan are in
[What it checks](vantage-check.md#what-it-checks).

---

## Limits

| Limit | Default | Past it |
| :--- | :--- | :--- |
| One file's size | 1 MiB | The file is skipped, and listed under *Too large* |
| Candidates in the repository | 5,000 | Nothing is scanned at all, and the planning page and `vantage-check index` say how many candidates there are and to narrow `include`. A partial index would quietly under-count, so the refusal is always visible |

Both are keys of `[planning]`
([Configuration](../reference/configuration.md#planning-documents)).

The planning page adds two limits of its own, which are not settings and never
leave anything out: a page stops before its cards pass 32,768 characters of
Markdown ([Pages](#pages)), and a card over 32,000 characters is a
[preview card](#a-questions-card) until you ask for the whole question.

## How it stays current

- **Each page load** builds the index once, in the background, the first time
  a page needs it, and keeps it while you move from page to page. The server
  answers with one line for every candidate, but with a file's text only when
  this browser does not already hold what it found in that content
  ([below](#what-this-browser-keeps)). So the first visit fetches and scans
  every candidate, and a reload afterwards only the roadmaps and the files
  that changed.
- **A changed file** is fetched and scanned again on its own, as the live-reload
  push names it. A new file joins the index and a deleted one leaves it.
- **A change to `.vantage.toml`** rescans the whole repository, and files whose
  content has not changed are not fetched again.
- **A dropped connection** to the server means changes may have been missed,
  so when it comes back while a page is open, the whole repository is rescanned,
  and the old index stays shown until the new one is ready.
- **Retry,** on the planning page's error, rescans without what this browser
  keeps: every candidate is fetched and scanned again, and what was kept for it
  is replaced.

## What this browser keeps

To make a reload cheap, your browser keeps what Vantage read from each file, in
an [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
database named `vantage-planning`. Each address Vantage is served from, host
and port, has a database of its own.

- **What it holds,** for each candidate: its path, its **content hash**, and
  whether it is a planning document. The content hash is the first 128 bits of
  the [SHA-256](https://csrc.nist.gov/pubs/fips/180-4/upd1/final) of the file's
  bytes, a fingerprint that changes whenever the content does. For a planning
  document it also holds what the index takes from it (its header, headings,
  links and questions) and the Markdown each of its question cards shows, which
  is the document's own text. A card over 32,000 characters is not kept, and
  nothing is kept for a roadmap, which is read afresh on every page load.
- **When it is used:** only when the server reports the same content hash for
  the file. An edit, a checkout or a branch switch changes the hash of every
  file it touches, and those files are fetched and scanned again.
- **When it is emptied:** all of it, whenever Vantage's code for reading these
  files changes, as it does in most releases, or your browser is upgraded, or a
  different Vantage server answers at that address: another repository started
  on the same port, or a tunnel to another machine. The next page load then
  fetches and scans everything once. Nothing kept from one server is ever sent
  to another, or shown with it. After each full read, what was kept for files
  that are no longer candidates is removed.
- **Where it lives:** in your browser profile, on the machine you browse from.
  With a [daemon](daemon-mode.md) on another machine, that puts text from its
  repositories on yours: text you can already open there.
- **To remove it,** clear the site data for Vantage's address in your
  browser's settings.

It also keeps **the roadmap you chose** on the planning page
([Several roadmaps](#several-roadmaps)), one per repository, in the browser's
`localStorage` for Vantage's address, under `vantage:planningRoadmap:`
followed by the repository's name, which is empty when Vantage serves one
repository. It holds the roadmap's path and nothing else, and only a choice
made in the menu writes it. Clearing the site data removes it too; without it,
the page opens on the roadmap nearest the root. Whether cards open unfolded
([Expand all](#a-questions-card)) is kept the same way, under
`vantage:planningCardsExpanded`; without it, they open folded. A
[filter](#filtering-the-page) is not kept anywhere: it is in the page's address
and nowhere else.

A browser without IndexedDB, or whose IndexedDB is full, disabled or failing,
as in some private windows, keeps nothing. Vantage then fetches and scans
every candidate on every page load, and everything else works the same.

## When something goes wrong

- **The server cannot be reached,** or answers with anything but the index's
  own shape: no badges, no Referenced by lines and no file-tree badges, and
  every document renders exactly as it would without them. The planning page
  shows the error, with a **Retry** button.
- **A static export** from [`vantage build`](static-sites.md) is always in that
  case, because it has no server to read the files from, and its planning page
  says so.
- **The planning scan stopped:** the background thread that scans the files
  ended in the middle of a build. The planning page says so, and Retry starts
  a new one.
- **A filter Vantage does not understand:** the page applies none of it.
  While you type it, the page keeps what it shows; on Enter, or opened from a
  link, it shows every entry, under *Not filtered* and the term it could not
  read ([Filtering the page](#filtering-the-page)). `vantage-check index
  --filter` exits `2` instead, and so it does for a `path:` term that matches
  no path, which the page applies and names.
- **A filtered link opened in Vantage 0.8.1 or earlier:** the whole planning
  page, with no notice, since that release has no filter.
- **The comments cannot be loaded:** the planning page's sections appear
  without them, under the line *Comments could not be loaded.*, and Copy
  answers stays disabled.
- **One file cannot be read,** or its frontmatter does not parse: it is listed
  under *Unreadable* and contributes nothing, its questions included.
  Everything else is unaffected.
- **A `[planning]` table that is wrong,** such as a role outside the four: the
  server logs it and falls back to the defaults, and `vantage-check` refuses
  the file and exits `2`. An unknown key is not wrong in that way: both warn
  about it and ignore it, and read the rest of the table, since it may come
  from a newer release
  ([Configuration](../reference/configuration.md#planning-documents)).

## Related

- [Configuration](../reference/configuration.md#planning-documents): every
  `[planning]` key
- [vantage-check](vantage-check.md): `index`, its `--filter`, and the
  `planning/*` rules
- [Keyboard Shortcuts](../reference/keyboard-shortcuts.md): `g p`, `/`, and the
  rest
- [Style Guide for Agents](../reference/style-guide.md): the frontmatter keys,
  as agents are told to write them
