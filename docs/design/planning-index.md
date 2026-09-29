---
title: "The planning index — write each planning fact once, and show it wherever it is linked"
author: "Matt Schulkind"
date: 2026-09-28
status: accepted
stage: DECIDED
tags: [planning, roadmap, viewer, vantage-check, vantage-md, config]
summary: "Vantage reads a repository's planning documents as a set — frontmatter, open questions, and the links between them — and shows each fact beside every link to it, on a page of its own, and to agents through vantage-check. It never writes a document."
---

# The planning index — write each planning fact once, and show it wherever it is linked

**Status:** DECIDED, 2026-09-28. Every question is ruled, the implementation plan's twenty
included; nothing is built. Evidence verified against the tree at `612e784`.

> **In short.** A roadmap goes stale because it copies each design doc's state. If every
> planning fact has exactly one home and every other mention of it is a plain link, Vantage
> can show the current value beside the link. The roadmap then shrinks to the one thing only a
> person can write: the order.

**Why it matters.** On 2026-09-25 this repository's roadmap was missing a design with five
live questions, cited two questions that had long been ruled, and sat beside eight design docs
whose status lines were missing or used words outside the agreed vocabulary. Every one of those
is a fact that had been copied by hand
([brainstorm, evidence table](../brainstorm/planning-index.md#why-this-keeps-turning-into-a-mess-measured-on-this-repository)).

**The shape.** One scan (the *planning index*) and four surfaces that display it: badges on links,
a planning page, a Referenced by line plus file-tree badges, and `vantage-check index`.

**Cost.** Two new frontmatter keys and one `.vantage.toml` table. Vantage's style guide and any
planning conventions built on it change what they write ([§10](#10-what-the-conventions-change)).

**Start at [§3](#3-the-planning-index).** Every surface is a view of that model.

**Needs your ruling:** None.

**Reads with:** [`planning-index-plan.md`](planning-index-plan.md) (the implementation plan,
completed against the tree on 2026-09-28) and [the brainstorm](../brainstorm/planning-index.md)
(the ideas this chose between, and the ones it retired).

---

## 1. Verdict, and the principles

Build it in two phases ([§14](#14-sequencing)). The principles, numbered so later sections can
cite them:

- **P1. One home per fact.** A *derived* fact (computable from the tree) is computed wherever it
  is shown. A *judged* fact (someone has to decide it) is written once, and everything else
  links to it. Both terms were coined in the brainstorm.
- **P2. Decorate and index; never generate.** Vantage may add a badge next to what an author
  wrote, and may build pages that are not documents. It never writes into a document, never
  transcludes one document into another, and has no template language.
- **P3. Only markup with a fixed meaning.** That means frontmatter keys, the `oq` directive, and
  Markdown links. Prose conventions, such as the `**Status:**` line, a roadmap's tables, or a
  Decision Ledger's columns, are never parsed.
- **P4. One parser.** The planning scan lives in `vantage-md` and is shared by the viewer and
  `vantage-check`. It is internal to that package: both consume it from source, as they already
  consume the rest of the package, and it is not exported from the published entry point. The
  one public addition is an optional `linkIds` prop on `FrontmatterDisplay`, the component that
  draws a document's header, so that `next` can link its ids
  ([§4](#4-the-header-of-record-stage-next-depends-on)). The Go server serves files and reads
  TOML; it never parses Markdown ([`AGENTS.md`](../../AGENTS.md)).
- **P5. The roadmap owns priority, and nothing another document owns.** Its order and its
  one-clause reasons are the only judged facts it holds about a planning document. Prose kept
  beneath an entry holds only facts with no other home, such as an upstream blocker's unblock
  condition ([§10](#10-what-the-conventions-change)).
- **P6. Conventions plug in through `.vantage.toml`.** Nothing specific to Matcraft is
  hard-coded. A repository that declares no stages still gets every surface that needs only
  directives and links.
- **P7. Agents see what the human sees.** Each surface has a `vantage-check` equivalent that is
  computed from the same scan.

## 2. What exists today

Verified 2026-09-28:

| Piece | Where | What it gives this design |
| --- | --- | --- |
| Frontmatter parse, and the status chip with the closed four statuses | `packages/vantage-md/src/vantageFrontmatter.ts:35-45`, `FrontmatterDisplay.tsx:109-130` | the `status` fact, and where a document's header is drawn |
| The `oq` directive, and the emoji-to-state map | `packages/vantage-md/src/vantageDirectives.ts:216-253` | question identity and state |
| Contents column question tally | `frontend/src/hooks/useDocumentOutline.ts:86`, `:257` | an existing per-document view of the same questions (from the DOM) |
| "Take this leaning" | `frontend/src/hooks/useOpenQuestionButtons.ts:353` → `POST …/review/comments` (`useReviewStore.ts:508-538`) | the answer path. Its anchor is built from the *rendered* block (`frontend/src/lib/reviewAnchor.ts:163-178`) |
| Clipboard handoff to the agent | `useReviewStore.ts:708-738` | one payload per document |
| Recursive Markdown watcher, pushed over WebSocket | `internal/live/watcher.go:105`, `ws.go` | per-file change events for invalidation |
| Every Markdown path, and `[starred] promote` with gitignore-syntax patterns | `internal/fs/service.go:589`, `internal/starred/promote.go:67-155` | the candidate list, and the pattern syntax to reuse |
| `.vantage.toml`, read by both server and checker, each skipping the other's tables | `internal/repoconfig/repoconfig.go:9-21`, `packages/vantage-check/src/core/config.ts` | where `[planning]` goes |
| Post-render DOM hooks in the viewer | `frontend/src/components/MarkdownViewer.tsx:258-334` | the pattern for decorating links |

Nothing today builds backlinks, a link graph, or a whole-project scan of Markdown content.

## 3. The planning index

The **planning index** *(coined in the brainstorm)* is a model of the repository's planning
documents, rebuilt from the files and never stored.

### 3.1 Which files it reads

- **Candidate:** a Markdown file the server lists that is matched by `[planning] include`
  and not matched by `[planning] exclude` ([§9](#9-configuration)). The roadmap
  ([§6.1](#61-the-roadmap)) is also a candidate whenever it exists, even when `include` or
  `exclude` would rule it out.
- **Patterns** use the gitignore-style matcher that `[starred] promote` already uses, quirks
  included, and the checker ports that matcher rather than using a library. It is not git's:
  `?` is a literal character, a pattern with a slash inside it is not anchored to the root (so
  `docs/gallery/**` also matches `x/docs/gallery/a.md`), and `[`, `(`, `\`, `{` and `+` keep
  their meaning in an [RE2](https://github.com/google/re2/wiki/Syntax) regular expression, so
  a line RE2 cannot compile is ignored. Keeping one matcher means a pattern means the same thing
  to the server, the checker and `promote`, and one shared test fixture holds both readers to
  it.
- **Planning document:** a candidate whose frontmatter has `status` or `stage`, or that
  contains at least one `oq` directive. The roadmap is always a planning document.
- Only planning documents contribute anything: facts, questions, or links. Any other candidate
  is read, found to be neither, and dropped.

By default everything is included and nothing is excluded, so a repository that has never
configured this still gets an index. A repository opts files out with `exclude`. This one
excludes `docs/gallery/`, whose 11 demo questions outnumber the 6 real ones. Requiring declared
roots was rejected ([§12](#12-alternatives-considered)): nothing would appear until someone
wrote the config.

### 3.2 What a document contributes

| Field | Source | Notes |
| --- | --- | --- |
| `path` | repo-relative | identity |
| `status` | frontmatter `status` | shown only if it is one of the four, otherwise ignored |
| `stage`, `next`, `depends-on` | frontmatter ([§4](#4-the-header-of-record-stage-next-depends-on)) | |
| `questions[]` | every question, in document order | [§3.3](#33-a-question) says which `oq` directives are questions |
| `links[]` | every Markdown link to another candidate, with the nearest heading above it | code blocks and HTML comments are not links |
| `ids[]` | every `OQ-…` token anywhere in the text | only to tell *ruled* from *not found* ([§5.2](#52-what-a-badge-says)) |

### 3.3 A question

A question is identified by **(document path, id)**. It carries:

- **state:** read from the emoji before its title, using the existing map. 💬 means *open*,
  💬 🤷 is *open* flagged as a preference, 🔒 is *blocked*, and ✅ is *answered, awaiting
  compaction*. A question with no marker counts as *open*.
- **title**, **leaning** (the directive's `leaning=`, which may be absent), and **source line**.

A question with no `oq` directive does not exist to the index. The `design-doc` skill currently
exempts 🔒 questions from the directive, so it has to change
([§10](#10-what-the-conventions-change)).

- **No id, or a repeated one.** A directive with no `id=`, with a malformed id
  (`vantage/oq-id-format`), or with an id used earlier in the same document
  (`vantage/oq-id-duplicate`) still makes a question. It is counted, badged and listed like any
  other, with no id: a link to its document routes it, but no `#OQ-…` link can name it. The
  first occurrence of a repeated id keeps that id.
- **Inside a raw HTML block,** where the directive and the paragraph after it are written as
  HTML and Markdown sees one opaque block, an `oq` directive is not a question to the index,
  although the viewer stamps that paragraph and the contents column lists it. That is the one
  disagreement allowed between the index and the column, and the agreement test below names
  it.
- **Live.** Every question the index holds is *live* *(coined here)*, whatever its state.
  Compacting a question deletes its directive, so the index no longer holds it, and that is the
  only way a question stops being live.

> [!IMPORTANT]
> **The index and the contents column must agree on every question and its state,** the
> raw-HTML case above excepted. Today the contents column reads state from the DOM. The index
> reads it from source. Either they share one extraction in `vantage-md`, or a test in the
> style of `frontend/src/lib/pipelineAgreement.test.tsx` holds them equal over the same corpus.

### 3.4 When it is built, and how it stays fresh

- **Full scan:** once per project per browser session, on first need. First need is opening any
  document, the planning page, or the file tree. It runs in the background, and nothing waits
  on it.
- **Incremental:** when the existing change push names a candidate path, only that file is
  fetched and re-scanned. A new or deleted file joins or leaves the index. A change to
  `.vantage.toml` triggers a full rescan.
- **Reconnect:** pushes sent while the push connection is down are lost. So when it drops and
  comes back while a page is open, a ready index is rescanned in full, and stays shown until the
  new scan lands. Only a genuine reconnect does this: a page's first connection is not one. A
  push lost while moving between pages stays lost until that file changes again or the index is
  rescanned.
- **Ordering:** each request for a path is numbered. A response is discarded if a newer request
  for the same path has already been sent. Otherwise the latest response wins. Scanning is a
  pure function of file contents, so re-running it is always safe.
- **Transport:** one request returns every candidate's source. The server applies its file
  listing's own rules, the include and exclude patterns and the limits, and does no parsing. A per-file
  refresh asks the same endpoint for one path and gets the same tests applied to that file: it
  answers with the file's source, or says the file is skipped, unreadable, or absent (missing,
  or not a candidate). The existing content endpoint is not used for this. It serves paths the
  listing never yields, has no size limit, and answers a missing file and an unreadable one
  alike.

### 3.5 Limits, and what happens past them

| Limit | Default | Past it |
| --- | --- | --- |
| Candidate file size | 1 MiB | skipped. Listed under *Skipped* on the planning page and by `vantage-check index` |
| Candidates per project | 5,000 | **no scan at all.** The planning page says how many files there are and to narrow `include`. `vantage-check index` prints the same and exits `3` ([§8](#8-vantage-check-index-and-the-planning-rules)) |

A partial index would quietly under-report questions, so a refusal is always visible. Both
numbers are defaults in `[planning]`.

### 3.6 Failure

- **The batch fetch fails:** no badges and no Referenced by line. The planning page shows the error
  with a Retry button. Documents render exactly as they do today.
- **One file cannot be read:** a file the server cannot read, or whose frontmatter does not
  parse (invalid YAML, an unterminated block, or not a mapping), is listed under *Could not
  read* on the planning page and contributes nothing, its `oq` directives included. Everything
  else is unaffected.
- **Multi-repo mode:** one index per repository. A link from one repository into another is
  never decorated.
- **A static export** ([`vantage build`](../../userguide/guides/static-sites.md)) has no
  planning endpoint, so it behaves as a failed batch fetch: no badges and no Referenced by
  line, and its planning page shows the error. A static host may answer the endpoint's URL
  with the site's `index.html`, so any answer that is not the batch's own shape counts as a
  failure.

## 4. The header of record: `stage`, `next`, `depends-on`

These are three **top-level** frontmatter keys, next to `status`. They sit at the top level
because they are facts about the document, while `vantage:` holds only Vantage chrome, and
because GitHub's frontmatter table then shows each as its own labeled row (verified against this
repository's [`repo-config.md`](repo-config.md) on 2026-09-26). **`stage:` is the only place Vantage reads a stage.** Vantage's style guide names it as the
stage's one home, and a repository that also writes the word in a prose status line has a second
copy that no tool can read or check (P3). This is decided on generic grounds, not for any one
set of conventions: a frontmatter key can be read by Vantage, by GitHub's table, and by any
script, and it is the one spelling a checker can hold to a vocabulary. A prose line, where a
repository keeps one, carries the date and the *why*, not the word.

```yaml
status: in-review
stage: DESIGN
next: "Rule OQ-B2 — the payload's install step waits on it"
depends-on:
  - pypi-distribution.md
```

| Key | Type | Rules |
| --- | --- | --- |
| `stage` | one word | Displayed as written, trimmed; a value that is not a non-empty string is ignored. Matching against `[planning.stages]` is exact and case-sensitive, so `Decided` is not `DECIDED`. When stages are declared, a word outside them is a checker error, and its badge is drawn in the warning tone |
| `next` | a string on one line | Plain text; a value that is not a one-line string is ignored. A bare `OQ-…` id in it is linked to this document's question when one of this document's questions carries that id. An id found only in the text, such as a compacted one kept in the Decision Ledger, stays plain |
| `depends-on` | a list of relative paths, each optionally with `#OQ-…` | A single path counts as a one-entry list, and an entry that is not a string is dropped. Resolved like links. A target that does not exist or lies outside the repository, or whose `#OQ-…` id appears nowhere in its text, is a checker error |

A **stage role** *(coined here)* says what a stage word means to the planning page. Roles come
from a closed set of four, and a repository maps its own words onto them ([§9](#9-configuration)):

| Role | Meaning | Planning page |
| --- | --- | --- |
| `open` | still being decided | nothing extra |
| `ready` | decided, not built | **Ready** |
| `built` | built | **Graduate**, when it has no live questions |
| `done` | not a live proposal | **contributes to no section:** its questions are not routed and appear nowhere on the page, and a `depends-on` naming it never makes its dependent wait. Badges, Referenced by and the file tree still show it |

A document with no `stage`, or whose repository declares no stages (no `[planning.stages]`
table, or an empty one), has no role. It still appears under Needs you, Unrouted and Waiting,
because those sections depend only on questions and links.

**Forbidden:** a `priority` key. Priorities written separately into each doc cannot be compared
with each other (P5).

## 5. Links show their target's state

### 5.1 Which links get a badge

A link gets a badge when all of the following hold:

1. It is a rendered Markdown link, not text inside code.
2. Its target is a planning document in the same repository.
3. The badge has something to show. A badge for a document needs a `status`, a `stage`, or at
   least one open or blocked question, so a document with neither status nor stage whose only
   questions are ✅ answered gets no badge rather than an empty one. A badge for a question
   always has its state to show.
4. It points to another document. Links within a document get no badge, because the contents
   column already covers them.

### 5.2 What a badge says

| Link to | Badge |
| --- | --- |
| a document | its status chip, then `stage`, then `💬 N` for open questions and `🔒 M` for blocked ones. Zero counts are left out, and a badge left with nothing is not drawn ([§5.1](#51-which-links-get-a-badge)) |
| `…#OQ-X`, and the directive is there | that question's state: `💬 open`, `🔒 blocked` or `✅ answered` |
| `…#OQ-X`, no directive, but the id appears in the target's text | `✅ ruled`. The `design-doc` compaction rule keeps a compacted id in the Decision Ledger, so the ledger never has to be parsed (P3) |
| `…#OQ-X`, and the id appears nowhere | `⚠ not found`. The checker's existing `link/dead-section-anchor` reports it too |
| `…#some-heading` | the same as a link to the document |

### 5.3 How a badge behaves

- **It is appended after the link**, as a sibling element. It is not part of the link's text,
  and clicking it does nothing.
- **Review comment anchors ignore badges.** A comment anchor hashes a block's visible text, so a
  badge that changed with the counts would move every comment on a roadmap line. Badges are
  also left out of the contents column, of copied selections, and of the visible text that
  `vantage-check`'s agreement tests use.
- **Badges appear once the scan finishes, and change as the index updates.** First render never
  waits for them.
- **In print**, a badge prints as plain text.
- **On GitHub there are no badges.** A roadmap there is ordered links with their reasons,
  which are the judged part. The derived part is one click away, in each document's frontmatter
  table. That is accepted as the cost of writing nothing into the file.
- **Screen readers** read a badge after the link as its own text, for example
  "agent-bootstrap, in review, design, five open questions".

## 6. The planning page

A page for each project, reached from a toolbar entry and with `g p` (a free chord that matches
`g h` and `g r`). It is built entirely from the index and **stores nothing** of its own: no
snooze, no assignment, no read state.

Its URL is `/.vantage/planning`, and `/.vantage/planning/<repo>` in
[daemon mode](../../userguide/guides/daemon-mode.md). Viewer URLs are `/<path>` and
`/<repo>/<path>`, so a bare `/planning` would hide every document under a top-level
`planning/` directory, and a whole repository named `planning`. The server never serves a
`.vantage` path as a document, so this URL hides nothing. The history and recents pages keep
`/history` and `/recent`, and the user guide says that each hides a top-level directory of the
same name.

### 6.1 The roadmap

The roadmap is the file named by `[planning] roadmap`, `roadmap.md` at the root by default. Its
links, taken in document order, **route** questions *(coined here: a routed question is one the
roadmap links, either directly or through its document)*:

- A link to a question (`x.md#OQ-X`) routes that question.
- A bare link to a document, with no fragment, routes every live question
  ([§3.3](#33-a-question)) in it, in document order, at that position. Linking a whole doc
  under a heading such as *Building* is normal, and it should not flag that doc's questions as
  forgotten.
- A link to a heading (`x.md#some-heading`) routes nothing, although its badge is the
  document's ([§5.2](#52-what-a-badge-says)). A compacted question is cited through its
  document's `#decision-ledger` heading, and routing that citation would route the document's
  unrelated open questions.
- A question reached twice keeps its first position.
- Links to non-planning documents are ignored, and so are the questions of a document whose
  stage has the `done` role ([§4](#4-the-header-of-record-stage-next-depends-on)).

### 6.2 Sections, top to bottom

| Section | Contains | Order |
| --- | --- | --- |
| **Needs you** | Routed questions whose state is *open* or *answered* | roadmap position |
| **Unrouted** | Open questions the roadmap does not route | path, then document order |
| **Waiting** | Blocked questions; also documents with a `depends-on` entry that still waits. An entry naming a question waits while that question is open (💬); one naming a document waits while that document has an open question | path |
| **Ready** | Documents whose stage has the `ready` role and no open questions | path |
| **Graduate** | Documents whose stage has the `built` role and no live questions | path |
| **Disagrees** | Documents whose stage says `ready` or `built` while they still have open questions | path |
| **Skipped** / **Could not read** | [§3.5](#35-limits-and-what-happens-past-them), [§3.6](#36-failure) | path |

- An empty section is not shown.
- A document whose stage has the `done` role appears in no section
  ([§4](#4-the-header-of-record-stage-next-depends-on)).
- If no document has an open question, `done` documents aside, the page says **Nothing needs
  you**. That line can sit above a *Needs you* holding only ✅ answered questions, which await
  compaction rather than a ruling.
- If the roadmap file is missing, or is skipped or unreadable
  ([§3.5](#35-limits-and-what-happens-past-them), [§3.6](#36-failure)), *Needs you* lists
  every open question grouped by document, *Unrouted* disappears, and a single line says which
  file the page would read as the roadmap.
- If no stages are declared, the three stage sections disappear, and a single line says how to
  declare stages.

### 6.3 A question on the page

Each question appears as a card with the following parts:

- **The question itself,** rendered exactly as the viewer renders that list item: its options,
  context and leaning. The page adds no summary, so the question reads the same here as in its
  document.
- **Its document,** by name, with that document's badge.
- **Its controls, which follow its state.** An open question offers **Take this leaning** (only
  when a leaning exists), **Answer…** and **Open document**. A ✅ answered question has been
  ruled, so it offers **Answer…** and **Open document**, with no leaning left to take. A 🔒
  blocked question, listed under *Waiting*, cannot be answered yet and offers only **Open
  document**.
- **Any comments already filed on it,** each marked *waiting on the agent* while it is still
  pending. They come from the review comments Vantage already stores, so the page stores
  nothing.

**The viewer's review mode follows the same rule.** It offers **Take this leaning** on open
questions only, never on a 🔒 or ✅ one, and the Review toggle's count of questions answerable in
one click counts only the questions that offer it. The contents column still lists every
question, in every state.

**Answering** files a comment on the question in its own document. That comment is
**indistinguishable from one filed with the in-page button**: the same anchor and the same text.
Filing does not reorder the page.

**Copy answers** hands the answers to the agent in one trip. The button sits at the top of the
page and shows how many answers are pending. It copies every comment still pending for the agent
on a question listed on the page, grouped by document. Each group is the block that document's
own Copy produces, and one set of responding instructions closes the payload. Agent replies
already name their `path`, so the reply side needs nothing new. The button is disabled when
nothing is pending. Other comments in the same documents are not included; each document's own
Copy still covers those.

**Open document lands at the top of the document**, not at the question (ruled 2026-09-28).
A question that can't be answered from its own card usually needs the wider document, and no
anchor can point at "the context." From the top, the contents column lists the question one
click away. Opening a document does not change its review mode. Going **Back** returns to the
planning page at its previous scroll position.

## 7. Referenced by, and status in the file tree

- **Referenced by:** one line below a planning document's frontmatter card, or first in the
  document when it has no card. It answers the two questions a reader asks of a document on its
  own page, *is this on the roadmap?* and *who depends on it?*, and the list of who links to it
  waits behind the line until someone asks for it. The line has up to three parts, joined by
  *·* in this order, and each appears only when its row applies:

  | Part | When | It reads |
  | :--- | :--- | :--- |
  | Count | A planning document links here | *Referenced by N documents* |
  | Roadmap | The roadmap routes the document or one of its questions ([§6.1](#61-the-roadmap)) | *on the roadmap under Building*, naming the roadmap heading of the first link that routes it, or just *on the roadmap* when that link sits above every heading |
  | Unrouted | The document has open questions the roadmap does not route, which the planning page lists under *Unrouted* ([§6.2](#62-sections-top-to-bottom)) | *K open questions not routed by the roadmap*, in the warning tone |

  So a document the roadmap routes one question of, holding another it does not, reads
  *Referenced by 2 documents · on the roadmap under Now · 1 open question not routed by the
  roadmap*. The unrouted part says what the roadmap leaves out rather than that the document
  is off it, because both can be true at once: the roadmap may link the document only by
  heading, which routes nothing, and the roadmap's own page holds questions the roadmap does
  not route without the roadmap being off itself. When nothing links to the document the
  unrouted part stands alone, because the line is then the only place the document says so.

  N counts the planning documents that link to this one or to one of its questions, once each
  however many links they hold. The roadmap counts as one when it links here. The document's
  links to itself are not counted. When nothing links to it and nothing in it is unrouted,
  there is no line.

  From the `sm` width up the line is one line, cut off at its end when it does not fit, with
  the whole of it on hover. Below that width it wraps instead: the end is the roadmap's
  answer, the part the line exists for, and a touch screen has no hover to show it. A row of
  the list wraps there too, with a hanging indent, and breaks a file name that has no other
  break point rather than widen the page.

  Routing is read exactly as the planning page reads it, so the line and the page cannot
  disagree. Only a bare link to the document and a link to one of its `#OQ-…` ids route it; a
  heading link routes nothing. A document whose stage has the `done` role contributes nothing
  ([§4](#4-the-header-of-record-stage-next-depends-on)), so its line is the count alone, and so
  is every line when there is no roadmap. The roadmap is never on the roadmap itself.

  **Opening the line** shows one row per linking document, the roadmap first and then by path. A
  row is the document's file name, with its full path on hover (two documents with the same file
  name each show the fewest trailing directories that tell them apart, such as *brainstorm/x.md*
  and *design/x.md*), then the headings its links sit under, in document order and each once,
  for example *roadmap.md · Rule these first · Later*. Each heading links to the first line
  under it that links here, and the file name to the link above every heading, if the document
  has one, or else to the top of the document. A link above every heading adds no heading. A row
  shows at most four headings, then *+M more*, which opens that row.

  When a document links here, the line is a button that says whether it is open, so it works
  from the keyboard and to a screen reader. **It is collapsed on every document load**, and
  nothing is stored: opening it lasts for that visit only. In print, the line prints, and the
  list prints only when it is open.
- **File tree:** a planning document's row shows a badge after its name. The file name has the
  first claim on the row's width, and four rules follow from that:

  1. **A name is never narrower than it would be with no badge.** It gets the width it had
     before the tree had badges, and a name too long for its row truncates exactly as it did
     then.
  2. **The badge uses only the room the name leaves, and is drawn only when all of it fits
     there.** It is never cut off. When it does not fit, it is not drawn, and the name's tooltip
     and the row's accessible name still say what it would have said.
  3. **The badge is compact:** a dot in the color of the document's status chip, and `💬 N` in
     small muted text when it has open questions.
     - A stage outside the declared words
       ([§4](#4-the-header-of-record-stage-next-depends-on)) draws the dot as a ring in the
       warning tone, so it does not read as `in-review`, whose chip is the warning tone too.
     - A declared stage with no status draws a muted dot.
     - A document whose only state is its open questions shows the count alone.
     - In forced colors (Windows High Contrast) every dot and ring is drawn in the text color:
       the ring still marks an undeclared stage, and the status is in the words below.

     The words are the tooltip of the name and of the badge, and the badge's accessible name,
     which a screen reader hears once, after the file name, and not again as a description. They
     are phrased as a link's badge is
     ([§5.3](#53-how-a-badge-behaves)): status, stage and open questions, for example
     *in review, design, 4 open questions*. The tooltip, the only text the tree shows of them,
     spells a stage outside the declared words as it is written, *stage “design” is not a declared
     stage*, because matching is exact and a lowercased word would hide why. Blocked questions are
     not counted here. The full
     status chip stays where there is room for it: beside links, and in the
     document's header when it asks for one (`vantage: status-chip`).

     The dot's only visual cue for the status is its color. Its words are the tooltip and the
     accessible name, not something the row shows, so a keyboard or touch user who cannot tell
     two colors apart does not see them either. And the dot takes the chip's tones, so amber
     (`in-review`) and green (`accepted`) are the colors the tree also uses for a modified and an
     untracked file. The git-change dot is the smaller one, and always the last thing in the row.
     Both are accepted for now to keep the badge a few pixels wide. A shape for each status, or
     the words on focus, would be a new ruling.
  4. **A row with no badge is unchanged.** That is every file that is not a planning document,
     every directory, and every planning document with nothing to show
     ([§5.1](#51-which-links-get-a-badge)).

Both come from the index ([§3](#3-the-planning-index)). Neither needs anything new from the
server.

## 8. `vantage-check index`, and the planning rules

`vantage-check index [--format text|json] [--config <path> | --no-config]` scans the
**project root** *(coined here)*: the nearest ancestor of the current directory holding `.git`
or `.vantage.toml`, or the current directory itself when there is none. `check` finds its
roadmap from the same kind of root, looking up from each file it checks, so the two commands
agree on the project; with no root, `check` finds no roadmap and `planning/unrouted` reports
nothing. `--config` chooses which config is read, never which project is scanned, so a config
file kept outside the tree, such as a temporary one, does not move the scan with it.

`index` prints the planning page's sections as text, followed by the roadmap with each link's
badge written inline in brackets. With `--format json` it prints the whole index plus those
sections, with a `version` field so the format can change later. It exits `0` when it ran, `2`
for bad arguments or a bad config, and `3` when it couldn't run, which includes a project past
`max-candidates` ([§3.5](#35-limits-and-what-happens-past-them)). It never exits `1`, because
`index` reports and does not judge. That limit does not touch `check`: its planning rules need
only each checked document and the roadmap, so it reads those alone and has nothing to count.

**Candidates are found as the server finds them, from the repository's own rules only:** `.md`
files, skipping hidden directories, the default excluded directories such as `node_modules`
and `dist`, linked worktrees, `.vantageignore` matches and symlinks. The server's list is also
shaped by settings that belong to one reader rather than to the repository, such as its
`exclude_dirs` setting and the user ignore file (`~/.config/vantage/ignore`). The checker
cannot see those, so where they are set, `index` can list a file that the planning page does
not.

The `check` command gains four rules:

| Rule | Default | Reports |
| --- | --- | --- |
| `planning/stage-vocabulary` | error, when `[planning.stages]` is declared | a `stage` outside the declared words |
| `planning/depends-on-missing` | error | a `depends-on` entry whose target does not exist or lies outside the repository, or whose `#OQ-…` id appears nowhere in its target |
| `planning/stage-disagrees` | warning | the page's *Disagrees* section |
| `planning/unrouted` | off | an open question the roadmap does not route. This repository runs it as a warning, so the gate lists unrouted questions without failing |

These rules are the same derivations the page uses, so the page and the gate can never
disagree (P7).

## 9. Configuration

One new table in `.vantage.toml`. It is read by both the server (for include, exclude and the
limits) and the checker (for everything):

```toml
[planning]
roadmap  = "roadmap.md"        # default; repo-relative
include  = ["**/*.md"]         # default; gitignore syntax, as [starred] promote
exclude  = []                  # default
max-file-bytes = 1048576       # default: 1 MiB
max-candidates = 5000          # default

[planning.stages]              # optional; absent or empty = no vocabulary, no roles
SKETCH = "open"
DESIGN = "open"
DECIDED = "ready"
BUILT = "built"
GRADUATED = "done"
SUPERSEDED = "done"
CURRENT = "done"
```

- An unknown key in `[planning]`, or a role outside the four, is an error in both readers.
- The server logs the error and falls back to the defaults. The checker exits `2`, as it does
  for bad `[check]` keys.
- An empty `[planning.stages]` table is the same as none.
- This repository adds `exclude = ["docs/gallery/**", "frontend/e2e/fixtures/**"]` (the second
  holds the end-to-end tests' planning fixtures), the table above, and
  `"planning/unrouted" = "warning"` under `[check.rules]`
  ([§8](#8-vantage-check-index-and-the-planning-rules)).

## 10. What the conventions change

- **Vantage's style guide** (`vantage-check style-guide`, and the user guide's style-guide
  page) documents `stage`, `next` and `depends-on`, names frontmatter as the stage's one home,
  and documents the `[planning]` table.

The Matcraft skills live outside this repository, so the rest are proposals for whoever
maintains them.

- **`design-doc`:** write `stage:` and `next:` in the frontmatter, and keep only the date and the
  why in the prose status line. Put an
  `oq` directive on 🔒 questions too, with no `leaning` required. Drop the hand-maintained
  **Needs your ruling** line, or keep it knowing that nothing checks it (P3).
- **`roadmap`:** an entry becomes an ordered link plus a one-clause reason. The Doc, Live and
  Gate columns and the counted header go away, because a badge replaces each of them. Prose that
  holds a fact with no other home, such as an upstream blocker and its unblock condition, stays
  beneath its entry (P5).
  Reconciling becomes: run `vantage-check index`, act on *Unrouted* and on any `✅ ruled`
  badges, and put the links back in order.
- **`system-doc`:** no change in this design. Its `covers:` key feeds a later phase
  ([§11](#11-non-goals)).

## 11. Non-goals

- **Writing into any document.** That rules out a generated table, transclusion and templates
  (P2).
- **Deciding priority, or tracking tasks.** No board and no task state (P5).
- **Parsing prose conventions,** including status lines, roadmap tables and Decision Ledgers
  (P3).
- **Linking across repositories,** and any planning page covering several projects.
- **Later phases, not designed here:** *Moved since Monday*
  ([brainstorm #5](../brainstorm/planning-index.md#5-this-week)) and staleness warnings for
  reference docs based on `covers:`
  ([brainstorm #11](../brainstorm/planning-index.md#11-freshness-of-reference-docs)).

## 12. Alternatives considered

| Alternative | Verdict |
| --- | --- |
| A generated, staleness-checked table in `roadmap.md` | **Rejected.** It writes into a document, and badges show the same information. Displaced in the brainstorm, whose direction was accepted on 2026-09-28 |
| A directive that renders a live table inside a document | **Rejected.** It is invisible on GitHub, and it is a template language by another name |
| A `priority:` key in each doc | **Rejected.** A priority is relative, so it needs a single list |
| Scanning in Go on the server | **Rejected.** It would be a second Markdown parser, breaking P4 |
| `stage`/`next` under `vantage:` | **Rejected.** `vantage:` is for chrome, and the keys read worse as a nested table on GitHub |
| Reading the prose `**Status:**` line | **Rejected.** This repository already spells it several different ways |
| Writing the stage in both frontmatter and the prose status line | **Rejected.** Two copies, and only one of them can be read or checked |
| Planning documents only under declared roots | **Rejected.** Nothing appears until someone writes the config |
| Handing answers to the agent only through each document's own Copy | **Rejected.** Answering three documents from one page would take three trips |
| Opening a document at the question's anchor | **Rejected** (ruled 2026-09-28). Context is in the wider document, and the contents column puts the question one click away |

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| A badge changes a block's visible text and moves comment anchors | Excluded from anchor text by rule ([§5.3](#53-how-a-badge-behaves)). A test files a comment, changes the count, and checks that the anchor still resolves |
| The index and the contents column disagree on a question's state | One extraction, or an agreement test ([§3.3](#33-a-question)) |
| Scan time on a large repository | Parse only planning documents, refuse past the candidate limit, and scan in the background. Measured by the done criteria in [§15](#15-what-done-looks-like) |
| Another tool already uses a top-level `stage` key, such as a site generator's `stage: production` | **Accepted.** A `stage` key alone makes a file a planning document ([§3.1](#31-which-files-it-reads)), so every link to it and its file-tree row show `production` as its stage. The checker holds `stage` to a vocabulary only when stages are declared, and a repository whose files use the key for something else lists them in `[planning] exclude`. A foreign `next` is read only in a file that is already a planning document |
| An answer filed from the page gets a different anchor than the in-page button would give | The two paths are compared in a test that files from both |

## 14. Sequencing

1. **Phase 1:** the scan in `vantage-md`, the `[planning]` config in both readers, the
   frontmatter keys, the batch endpoint, link badges, and `vantage-check index` with its
   rules. At this point the roadmap can be rewritten as lists of links.
2. **Phase 2:** the planning page, Referenced by, and file-tree badges.

Each phase lands with this repository's own corpus converted, so it is used the day it ships:
[§9](#9-configuration)'s stages declared, the gallery and the end-to-end fixtures excluded, and
every roadmap item kept, rewritten as a link and a one-clause reason with its existing prose
beneath.

Neither phase adds a section to [`CHANGELOG.md`](../../CHANGELOG.md). The release that ships a
phase writes its notes then, as every release does.

## 15. What done looks like

- Opening `roadmap.md` shows a badge on every link to a planning doc or question. Answering one
  of those questions and letting the agent compact it turns that badge to `✅ ruled` without a
  reload.
- `g p` opens the planning page. On this repository it lists [`agent-bootstrap.md`](agent-bootstrap.md)'s questions
  under *Unrouted* until the roadmap links them.
- Taking a leaning from the planning page produces a comment identical to the one the in-page
  button produces for the same question.
- **Open document** lands at the top of the document, and Back returns to the same scroll
  position.
- `vantage-check index` prints the same sections the page shows, and
  `planning/stage-vocabulary` fails on an off-vocabulary `stage`.
- On this repository, the first page load has the index ready within 1 s. No document's first
  render waits for it.

## Decision Ledger

Rows named *Plan Q1* to *Plan Q20* rule the questions that
[`planning-index-plan.md`](planning-index-plan.md) raised for the coordinator, which the plan
cites by those numbers. They are not `OQ-` ids. Plan Q5 and Plan Q8 differ from the defaults
the plan proposed.

| ID | Ruling / Decision | Date | Settled in | Built |
| :--- | :--- | :--- | :--- | :--- |
| — | Build it: a planning index in Vantage, following the brainstorm's direction ([`OQ-PI1`](../brainstorm/planning-index.md#decision-ledger)) | 2026-09-28 | [§1](#1-verdict-and-the-principles) | — |
| — | **Open document** from the planning page lands at the top of the document, not at the question | 2026-09-28 | [§6.3](#63-a-question-on-the-page) | — |
| — | User direction 2026-09-29: Referenced by is one motivated, collapsed line. It says whether the roadmap routes the document and how many documents link to it, and opens to one row per document. It replaces a list with one row per linking document and heading, always open, which pushed a heavily cited document's body a screen down | 2026-09-29 | [§7](#7-referenced-by-and-status-in-the-file-tree) | — |
| — | Referenced by always counts the open questions the roadmap does not route, as *K open questions not routed by the roadmap*, even when the roadmap routes another of the document's questions. It replaces *not on the roadmap (K open questions)*, shown only when nothing was routed, which hid a partly routed document's unrouted questions, read as false on a document the roadmap links only by heading, and on the roadmap's own page said the roadmap was not on itself. The user direction did not say which wins when both apply; this keeps both, and is open to the user's review | 2026-09-29 | [§7](#7-referenced-by-and-status-in-the-file-tree) | — |
| OQ-PL1 | `stage:` is the stage's only home; a prose status line carries the date and the why. Decided on generic grounds, not to fit one set of conventions | 2026-09-28 | [§4](#4-the-header-of-record-stage-next-depends-on) | — |
| OQ-PL2 | A planning document is any file with planning frontmatter or an `oq` directive; everything is included by default, with an exclude list | 2026-09-28 | [§3.1](#31-which-files-it-reads) | — |
| OQ-PL3 | A roadmap fully readable only in Vantage is acceptable: GitHub keeps the order and reasons | 2026-09-28 | [§5.3](#53-how-a-badge-behaves) | — |
| OQ-PL4 | One **Copy answers** button on the planning page, grouped by document | 2026-09-28 | [§6.3](#63-a-question-on-the-page) | — |
| — | Plan Q1: patterns keep the server's matcher, its quirks and RE2 dialect included; the checker ports it, and one shared fixture pins both readers | 2026-09-28 | [§3.1](#31-which-files-it-reads) | — |
| — | Plan Q2: the roadmap is read whenever it exists, even when `include` or `exclude` rules it out | 2026-09-28 | [§3.1](#31-which-files-it-reads) | — |
| — | Plan Q3: static exports get no badges and no planning index; the planning page shows its failed-fetch error | 2026-09-28 | [§3.6](#36-failure) | — |
| — | Plan Q4: this repository runs `planning/unrouted` as a warning | 2026-09-28 | [§8](#8-vantage-check-index-and-the-planning-rules), [§9](#9-configuration) | — |
| — | Plan Q5: an `oq` with no id, a malformed id or a repeated one is still a question, counted with no id. **Take this leaning** is not offered on 🔒 or ✅ questions, neither in the viewer's review mode nor on the planning page, where 🔒 questions sit under *Waiting* with no Take or Answer… control; the contents column still lists them. The plan's default had left the buttons unchanged | 2026-09-28 | [§3.3](#33-a-question), [§6.3](#63-a-question-on-the-page) | — |
| — | Plan Q6: every question the index holds is live; a `depends-on` naming a question waits only while that question is open (💬) | 2026-09-28 | [§3.3](#33-a-question), [§6.2](#62-sections-top-to-bottom) | — |
| — | Plan Q7: `vantage-check index` exits `3` past `max-candidates`; `check` is unaffected | 2026-09-28 | [§8](#8-vantage-check-index-and-the-planning-rules) | — |
| — | Plan Q8: this work adds no Unreleased section to the changelog; release notes are written at release time, as today. The plan's default had added one | 2026-09-28 | [§14](#14-sequencing) | — |
| — | Plan Q9: the checker mirrors the repository-level listing rules only; per-reader settings stay invisible to it | 2026-09-28 | [§8](#8-vantage-check-index-and-the-planning-rules) | — |
| — | Plan Q10: each roadmap item becomes a link plus a one-clause reason with its existing prose kept beneath; this repository's stages are [§9](#9-configuration)'s table | 2026-09-28 | [§1](#1-verdict-and-the-principles) (P5), [§14](#14-sequencing) | — |
| — | Plan Q11: a `done` document contributes nothing to any section, and a `depends-on` on it never makes its dependent wait | 2026-09-28 | [§4](#4-the-header-of-record-stage-next-depends-on) | — |
| — | Plan Q12: only a bare document link and a `#OQ-…` link route; a heading link routes nothing | 2026-09-28 | [§6.1](#61-the-roadmap) | — |
| — | Plan Q13: the planning page lives at `/.vantage/planning`, and `/.vantage/planning/<repo>` in daemon mode; `/recent` and `/history` stay, and the user guide documents what they hide | 2026-09-28 | [§6](#6-the-planning-page) | — |
| — | Plan Q14: a genuine reconnect rescans a ready index and keeps it shown until the new scan lands; a page's first connection is not a reconnect | 2026-09-28 | [§3.4](#34-when-it-is-built-and-how-it-stays-fresh) | — |
| — | Plan Q15: a per-file refresh asks the planning endpoint for one path, never the content endpoint | 2026-09-28 | [§3.4](#34-when-it-is-built-and-how-it-stays-fresh) | — |
| — | Plan Q16: one project root for both commands, the nearest ancestor holding `.git` or `.vantage.toml`; `--config` never moves it, and `index` falls back to the current directory | 2026-09-28 | [§8](#8-vantage-check-index-and-the-planning-rules) | — |
| — | Plan Q17: an `oq` inside a raw HTML block is not a question to the index; the agreement test pins that one divergence | 2026-09-28 | [§3.3](#33-a-question) | — |
| — | Plan Q18: a foreign top-level `stage` key makes a planning document, as designed; `[planning] exclude` is the remedy | 2026-09-28 | [§13](#13-risks) | — |
| — | Plan Q19: the planning module is internal to `vantage-md`; `FrontmatterDisplay`'s optional `linkIds` is the one public addition | 2026-09-28 | [§1](#1-verdict-and-the-principles) (P4) | — |
| — | Plan Q20: the plan's eight gap-fills. A header that does not parse makes its file unreadable; a non-string or empty `stage` and a non-string or multi-line `next` are ignored, a single `depends-on` path is a one-entry list, and a non-string entry is dropped; stage matching is exact and case-sensitive; an empty stages table is none; a `depends-on` target outside the repository, or whose `#OQ-…` id appears nowhere in it, is a finding; a skipped or unreadable roadmap counts as missing; an empty document badge is not drawn; `next` links only an id a question carries | 2026-09-28 | [§3.6](#36-failure), [§4](#4-the-header-of-record-stage-next-depends-on), [§5.1](#51-which-links-get-a-badge), [§6.2](#62-sections-top-to-bottom), [§9](#9-configuration) | — |
| — | User ruling 2026-09-28: the file name wins. A tree badge takes no width from a file name: it uses only the room the name leaves, is drawn whole or not at all, and is a compact dot and `💬 N` whose words are its tooltip and accessible name. It replaced a full status chip that cut long names down to their first letter | 2026-09-28 | [§7](#7-referenced-by-and-status-in-the-file-tree) | — |
