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
the rest) are Vantage's own, from its
[planning-index design](../../docs/design/planning-index.md).

---

## What Vantage reads

The **planning index** is Vantage's model of a repository's planning
documents. It is rebuilt from the files on every page load, in the background
and off the page's own thread, so scrolling and typing never wait for it. The
index itself is never stored, but to keep the rebuild cheap this browser keeps
what it found in each file, and fetches and scans a file again only once its
content has changed ([What this browser keeps](#what-this-browser-keeps)).

A document paints as soon as its content arrives. When the index is only
moments away, because this browser already holds nearly all of it, that first
paint waits for it, never more than 150 ms. Otherwise the document paints
without it, and badges that arrive later appear only where they cannot move
what you are reading ([below](#badges-on-links)).

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
`oq` directive (the markup that makes an Open Question answerable in one click;
see [Style Guide for Agents](../reference/style-guide.md)). The roadmap
([below](#the-roadmap)) is always one. Every other candidate is read, found to
be neither, and dropped. Only planning documents contribute to the index: their
header, their questions and their links.

**Questions.** A question is an `oq` directive, identified by its document and
its `id`. Its state comes from the emoji before its bold title:

| Marker | State |
| :--- | :--- |
| 💬 | open |
| 💬 🤷 | open, and a matter of preference |
| 🔒 | blocked on something upstream |
| ✅ | answered, and waiting to be compacted |
| none | open |

A question written without an `oq` directive does not exist to the index. That
is why a 🔒 question gets a directive too, with no `leaning` needed: without
one, nothing counts it.

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
at all makes the whole file unreadable to the index, `oq` directives included.

**`stage:` is the only place Vantage reads a stage.** A repository that also
writes the word in a prose `**Status:**` line has a second copy that no tool
can read or check; keep the date and the reason there, and the word here.

**There is no `priority` key.** A priority only means something relative to
the others, so it belongs in one ordered list, the roadmap, rather than in
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

The roadmap is the file `[planning] roadmap` names, `roadmap.md` at the
repository root unless it says otherwise. It is always read when it exists,
even if `include` or `exclude` would rule it out.

What the roadmap holds is an **order**: a list of links, each with a one-clause
reason for its place. Everything the linked documents own is in their badges,
so a roadmap entry never copies a status, a count or a stage, and prose kept
beneath an entry holds only what has no other home, such as the condition that
would unblock it.

Its links, in document order, **route** questions. A routed question is one the
roadmap reaches:

- a link to a question, `x.md#OQ-X`, routes that question;
- a bare link to a document, with no `#`, routes every question in it, at that
  position, so linking a whole document under a heading is enough;
- a link to a heading, `x.md#some-heading`, routes nothing, although its badge
  is the document's. That is how a compacted question is cited, through
  `#decision-ledger`, without routing the document's other questions;
- a question reached twice keeps its first position;
- links to other files, and to a document whose stage has the `done` role,
  route nothing.

An open question the roadmap does not route is **unrouted**: it needs a
ruling, and the one list that says what to do next has missed it. The planning
page lists those under *Unrouted*, and so does `vantage-check index`.

---

## Referenced by

Below a planning document's frontmatter card, or at the top of a document
that has none, one line says whether the roadmap has the document and how many
planning documents link to it:

| The line | Means |
| :--- | :--- |
| *Referenced by 3 documents · on the roadmap under Building* | The roadmap [routes](#the-roadmap) this document or one of its questions. *Building* is the roadmap heading its first such link sits under |
| *Referenced by 3 documents · on the roadmap* | The same, when the roadmap's link sits above every heading |
| *Referenced by 3 documents · 2 open questions not routed by the roadmap* | Two of its open questions are unrouted: they need a ruling, and the roadmap has missed them. That part is in the warning tone |
| *Referenced by 3 documents · on the roadmap under Building · 1 open question not routed by the roadmap* | The roadmap routes one question and has missed another |
| *2 open questions not routed by the roadmap* | Unrouted questions in a document nothing links to. The line is then the only place the document shows them, and there is nothing to open |
| *Referenced by 3 documents* | Other documents link here, and the roadmap has nothing to add |

The count is of documents, not links, and the roadmap is one of them when it
links here. A document's links to itself do not count. When nothing links to a
document and none of its questions is unrouted, there is no line. With no
roadmap, or for a document whose stage has the `done` role, the line gives the
count alone.

Click the line, or press Enter or Space on it, to see who links here: one row
per document, the roadmap first, then by path. A row is the document's file
name, with its full path on hover, then the headings its links sit under. Each
heading links to the first line under it that links here. Two documents with
the same file name each show as much of their folder as tells them apart, such
as *brainstorm/x.md* and *design/x.md*. A row shows four headings, then *+M
more* for the rest.

The list is closed whenever you open a document, and nothing remembers that
you opened it. It prints only when it is open, and then with
every heading; the line always prints.

When a document opens before the index is ready, the line's room is kept for
it in the first paint, so the line fills in later without pushing the document
down, and stays blank if it turns out to have nothing to say. The room is kept
when the document's own `status` or `stage` key, or an `oq` directive in it,
already shows it is a planning document. A roadmap with neither shows its line
the next time it is opened.

---

## The planning page

The planning page gathers, for one repository, every question that is waiting
on someone and every document whose stage calls for a next step. Press **`g p`**
while viewing a document or a folder to open it, or click the checklist icon
beside **Vantage** at the top of the sidebar. It is built from the index every time and stores nothing of its
own: no snooze, no assignment, no read state. It changes when the documents do,
without a reload.

Its address is `/.vantage/planning`, or `/.vantage/planning/<repo>` in
[daemon mode](daemon-mode.md). A document's own address is its path, `/<path>`
or `/<repo>/<path>`, so a page at `/planning` would hide every document under a
top-level `planning/` directory, and a whole repository named `planning`.
Vantage never serves a `.vantage` path as a document, so this address hides
nothing.

> [!NOTE]
> **The history and recent-files pages do hide something.** They are older, and
> `/history/…` and `/recent/…` are theirs, so a document in a top-level
> directory named `history` or `recent` cannot be opened in the viewer:
> `/recent/notes.md` is the recent-files page, and `/history/notes.md` is the
> commit history of a root-level `notes.md`. In daemon mode the same goes for a
> whole repository named `history` or `recent`.

**What appears when.** The page's header and its [section bar](#pages) appear
as soon as you press `g p`. The cards of each section's shown page follow
together, in one step, once their text, their documents' comments and their
Mermaid diagrams are all in hand, so nothing on the page moves as they arrive.
A spinner shows only if that takes longer than 150 ms. Opened while the index
is still being read, the page says *Reading planning documents…* where the
section bar will be, then *Scanning planning documents: 412 of 1,000*, and the
section bar and the sections replace that line when the index is ready. A
rescan of an index already shown keeps the page as it is, with a thin bar
along its top.

### Its sections

From top to bottom, leaving out any that are empty, each with its count:

| Section | Holds | Each entry shows |
| :--- | :--- | :--- |
| **Needs you** | Routed questions that are open or answered, in roadmap order | the question's [card](#a-questions-card) |
| **Unrouted** | Open questions the roadmap does not route, by path | the question's card |
| **Waiting** | Blocked questions, and documents with a `depends-on` entry that still waits: one naming a question waits while it is open (💬), and one naming a document waits while that document has an open question | a blocked question's card; a document's name and badge, then each entry it waits on, with that entry's badge |
| **Ready** | Documents whose stage has the `ready` role and no open questions | the document's name and badge |
| **Graduate** | Documents whose stage has the `built` role and no questions left | the document's name and badge |
| **Disagrees** | Documents whose stage says `ready` or `built` while they still have open questions | the document's name and badge |
| **Skipped** | Candidates over the size limit ([below](#limits)) | the path, its size and the limit |
| **Could not read** | Candidates that could not be read, or whose frontmatter does not parse | the path and why |

Clicking a document's name opens it, as **Open document** does
([below](#a-questions-card)).

Two cases change the sections:

- **With no roadmap,** because the file is missing, too large or unreadable,
  or is not in the file list Vantage shows (a hidden or excluded directory, a
  `.vantageignore` match, or a file not named `.md`), *Needs you* lists every open question by document, *Unrouted* is not shown,
  and a line names the file that would be read as the roadmap.
- **With no stages declared,** *Ready*, *Graduate* and *Disagrees* are not
  shown, and a line says how to declare them.

When no document has an open question, `done` documents aside, the page says
**Nothing needs you**. That line can sit above a *Needs you* holding only ✅
answered questions: those await compaction, not a ruling.

Past the candidate limit ([below](#limits)) there are no sections at all, only a
line saying how many candidates there are and to narrow `include`.

### Pages

Each section shows one page of its entries at a time, so the page opens as
quickly for a thousand documents as for ten:

| Sections | A page holds |
| :--- | :--- |
| Needs you, Unrouted, Waiting | 10 entries, or fewer when their cards together would pass 32,768 characters of Markdown. A page always holds at least one entry, and a [preview card](#a-questions-card) counts for none of those characters |
| Ready, Graduate, Disagrees | 25 documents |
| Skipped, Could not read | 50 lines |

- **The section bar,** under the header, names each section that is not empty
  with its count, such as `Needs you 143 · Unrouted 12 · Waiting 7`. The counts
  are of the whole section, whatever page is shown. Clicking one scrolls to its
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
  you opened returns to the same pages at the same scroll position, and Back
  from the planning page leaves it rather than stepping back through its
  pages. A page past a section's end shows its last page, a value that is not
  a page number shows page 1, and either way the address is corrected in place.

Paging decides only what is drawn. Every question is still counted in the
section bar and reachable through its section's pager, and
[Copy answers](#copy-answers) covers the questions on every page.

### A question's card

A card shows the question exactly as its document renders it: its list item,
or its own block when it is not in a list, with the number it has there, its
options, its context and its leaning.
Nothing is summarized, so a question reads the same on the page as in its
document. Above it, the card names the document, with that document's badge.

What the card offers follows the question's state:

| State | Take this leaning | Answer… | Open document |
| :--- | :--- | :--- | :--- |
| 💬 open, or no marker | when it has a leaning | yes | yes |
| ✅ answered | no: it has been ruled | yes | yes |
| 🔒 blocked, under *Waiting* | no | no: it cannot be answered yet | yes |

- **Take this leaning** files the question's leaning as a review comment on
  it: the same comment review mode's own **Take this leaning** button files in
  the document, with the same text, anchored to the same place. Once it is
  filed, the card says *Leaning taken*. To take it back, open the document,
  where review mode offers Undo until someone replies.
- **Answer…** opens the comment box, and what you type is filed on the
  question the same way.
- **Open document** opens the question's document at its top, not at the
  question: a question you could not answer from its card usually needs the
  rest of the document, and its table of contents lists the question one click
  away. Opening it leaves the document's review mode as it was. **Back**
  returns to the planning page with the same [pages](#pages), at the same
  scroll position.

A comment filed from a card is filed in the question's own document, exactly as
if you had filed it there: that document's Review panel lists it, its own Copy
includes it, and the agent answers it through the
[review inbox](review-inbox.md) as usual. Filing never reorders the page.

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

**Copy answers**, at the top of the page, hands every answer given on the page
to the agent in one trip, rather than one trip per document. Beside it is the
number of comments waiting on the agent on the questions the page lists: not
dismissed, and not yet answered, or edited or replied to since the agent's last
answer. With none, the button is disabled.

It counts and copies the comments on the questions of every
[page](#pages), not only the ones shown, so a comment on a question two pages
on is included. The count reads `–` until every listed document's comments have
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

---

## Reading it from the command line

`vantage-check index` prints the planning index of the repository the current
directory is in, so an agent sees what a person sees, with no server running.
It prints the [planning page's sections](#its-sections) as text, with the same
notices, and leaves out any that are empty: a question as its path, line,
marker and title rather than a card, and a document as its path.

After the sections comes the roadmap itself, with each link's badge written
inline in brackets. The options, the JSON form and the exit codes are in the
vantage-check guide's [`index` section](vantage-check.md#vantage-check-index),
and the four `planning/*` rules that `check` runs over the same scan are in
[What it checks](vantage-check.md#what-it-checks).

---

## Limits

| Limit | Default | Past it |
| :--- | :--- | :--- |
| One file's size | 1 MiB | The file is skipped, and listed under *Skipped* |
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
  every candidate, and a reload afterwards only the roadmap and the files that
  changed.
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
  nothing is kept for the roadmap.
- **When it is used:** only when the server reports the same content hash for
  the file. An edit, a checkout or a branch switch changes the hash of every
  file it touches, and those files are fetched and scanned again.
- **When it is emptied:** all of it, whenever Vantage's code for reading these
  files changes, as it does in most releases, or your browser is upgraded; the
  next page load then fetches and scans everything once. After each full read, what was
  kept for files that are no longer candidates is removed.
- **Where it lives:** in your browser profile, on the machine you browse from.
  With a [daemon](daemon-mode.md) on another machine, that puts text from its
  repositories on yours: text you can already open there.
- **To remove it,** clear the site data for Vantage's address in your
  browser's settings.

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
- **A tab left open from an older Vantage,** across an upgrade of the server,
  may say *The planning index moved to a stream; reload the page.* Reloading it
  is the fix.
- **The comments cannot be loaded:** the planning page's sections appear
  without them, under the line *Comments could not be loaded.*, and Copy
  answers stays disabled.
- **One file cannot be read,** or its frontmatter does not parse: it is listed
  under *Could not read* and contributes nothing, its questions included.
  Everything else is unaffected.
- **A `[planning]` table that is wrong,** such as an unknown key or a role
  outside the four: the server logs it and falls back to the defaults, and
  `vantage-check` refuses the file and exits `2`
  ([Configuration](../reference/configuration.md#planning-documents)).

## Related

- [Configuration](../reference/configuration.md#planning-documents): every
  `[planning]` key
- [vantage-check](vantage-check.md): `index`, and the `planning/*` rules
- [Keyboard Shortcuts](../reference/keyboard-shortcuts.md): `g p`, and the rest
- [Style Guide for Agents](../reference/style-guide.md): the frontmatter keys,
  as agents are told to write them
