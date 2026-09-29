# Planning Documents

A repository's plans are spread across many files: design documents with open
questions, implementation plans, and a roadmap that says what comes next. The
usual way to keep them in step is to copy each fact by hand into every file
that mentions it: a document's status, its stage, how many of its questions are
still open. The copies go stale, and nothing notices.

Vantage reads those files as a set instead. Each fact is written once, in the
document it belongs to, and everywhere else a plain Markdown link is enough:
Vantage shows the fact's current value in a **badge** beside the link.
Vantage never writes into a document.

The terms this page defines (*planning document*, *stage role*, *routed* and
the rest) are Vantage's own, from its
[planning-index design](../../docs/design/planning-index.md).

---

## What Vantage reads

The **planning index** is Vantage's model of a repository's planning
documents. It is rebuilt from the files every time and never stored. Nothing
waits for it: a document renders as it always has, and its badges appear once
the index is ready.

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

A document whose stage has the `done` role still gets its badge, but its
questions are left out of every list `vantage-check index` prints, and a
`depends-on` naming it never makes anything wait. A document with no stage, or
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
- **It prints as plain text**, and a screen reader reads it after the link as
  words: *in review, design, 5 open questions*.

Some places get no badges at all:

- **GitHub**, or any other renderer. A roadmap there reads as its links and
  their reasons, and each document's frontmatter table is one click away.
- **A static export** from [`vantage build`](static-sites.md), which has no
  server to read the files from. Its documents render exactly as they did
  before badges existed.
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
ruling, and the one list that says what to do next has missed it. Finding
those is the reason to run `vantage-check index`.

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
heading links to the first line under it that links here. A row shows four
headings, then *+M more* for the rest.

The list is closed whenever you open a document, and nothing remembers that
you opened it. It prints only when it is open; the line always prints.

---

## Reading it from the command line

`vantage-check index` prints the planning index of the repository the current
directory is in, so an agent sees what a person sees, with no server running.
It lists these sections, and leaves out any that are empty:

| Section | Holds |
| :--- | :--- |
| **Needs you** | Routed questions that are open or answered, in roadmap order |
| **Unrouted** | Open questions the roadmap does not route, by path |
| **Waiting** | Blocked questions, and documents with a `depends-on` entry that still waits: one naming a question waits while it is open (💬), and one naming a document waits while that document has an open question |
| **Ready** | Documents whose stage has the `ready` role and no open questions |
| **Graduate** | Documents whose stage has the `built` role and no questions left |
| **Disagrees** | Documents whose stage says `ready` or `built` while they still have open questions |
| **Skipped** | Candidates over the size limit ([below](#limits)) |
| **Could not read** | Candidates that could not be read, or whose frontmatter does not parse |

Two cases change the sections:

- **With no roadmap,** because the file is missing, too large or unreadable,
  *Needs you* lists every open question by document, *Unrouted* is not shown,
  and a line names the file that would be read as the roadmap.
- **With no stages declared,** *Ready*, *Graduate* and *Disagrees* are not
  shown, and a line says how to declare them.

When no document has an open question, `done` documents aside, it says
**Nothing needs you**. That line can sit above a *Needs you* holding only ✅
answered questions: those await compaction, not a ruling.

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
| Candidates in the repository | 5,000 | Nothing is scanned at all, and `vantage-check index` says how many candidates there are and to narrow `include`. A partial index would quietly under-count, so the refusal is always visible |

Both are keys of `[planning]`
([Configuration](../reference/configuration.md#planning-documents)).

## How it stays current

- **The first scan** runs in the background the first time a page needs it,
  and its result is kept while you move from page to page.
- **A changed file** is fetched and scanned again on its own, as the live-reload
  push names it. A new file joins the index and a deleted one leaves it.
- **A change to `.vantage.toml`** rescans the whole repository.
- **A dropped connection** to the server means changes may have been missed,
  so when it comes back while a page is open, the whole repository is rescanned,
  and the old index stays shown until the new one is ready.

## When something goes wrong

- **The server cannot be reached,** or answers with anything but the index's
  own shape: no badges, and every document renders exactly as it would without
  them.
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
- [Style Guide for Agents](../reference/style-guide.md): the frontmatter keys,
  as agents are told to write them
