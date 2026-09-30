---
title: "The planning index — write each planning fact once, and show it wherever it is linked"
author: "Matt Schulkind"
date: 2026-09-28
status: accepted
stage: BUILT
next: "Measure planning-index-at-scale.md's §19 targets against the build, then graduate both designs into one system doc"
tags: [planning, roadmap, viewer, vantage-check, vantage-md, config]
summary: "Vantage reads a repository's planning documents as a set — frontmatter, open questions, and the links between them — and shows each fact beside every link to it, on a page of its own, and to agents through vantage-check. It finds every roadmap by its file name, and never writes a document."
---

# The planning index — write each planning fact once, and show it wherever it is linked

**Status:** BUILT, 2026-09-30. Phases 1 and 2 were built on `main` by `70a05b3`, and
[the amendment for large repositories](planning-index-at-scale.md) by `f2fe17a`–`5d13a29`. The
user's ruling of 2026-09-30, that roadmaps are found by their file name and that several can be
listed and picked ([§6.1](#61-the-roadmaps), [§6.4](#64-several-roadmaps-on-the-page)), was
built by `4bef79d` from
[the first section of `planning-index-plan.md`](planning-index-plan.md#several-roadmaps--the-2026-09-30-build).
MEASURED at `70a05b3`: this repository's scan took 336–487 ms of wall time, within
[§15](#15-what-done-looks-like)'s 1 s
([`planning-index-at-scale.md` §2](planning-index-at-scale.md#2-what-the-measurements-say));
the amendment's own targets are unmeasured. Every question is ruled, the implementation plan's
twenty included. [§2](#2-what-exists-today) is the tree at `612e784`, before any of it was
built.

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
completed against the tree on 2026-09-28; its first section is the build plan for several
roadmaps, written against `da26523`), [the brainstorm](../brainstorm/planning-index.md)
(the ideas this chose between, and the ones it retired), and
[`planning-index-at-scale.md`](planning-index-at-scale.md) (the 2026-09-29 amendment for large
repositories, which changed [§3](#3-the-planning-index),
[§3.4](#34-when-it-is-built-and-how-it-stays-fresh),
[§3.5](#35-limits-and-what-happens-past-them), [§3.6](#36-failure),
[§5.3](#53-how-a-badge-behaves), [§6](#6-the-planning-page),
[§7](#7-referenced-by-and-status-in-the-file-tree), [§13](#13-risks) and
[§15](#15-what-done-looks-like); each carries a dated pointer to the part of it that did).

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
- **P5. A roadmap owns priority, and nothing another document owns.** Its order and its
  one-clause reasons are the only judged facts it holds about a planning document. A repository
  may keep several roadmaps ([§6.1](#61-the-roadmaps)); each owns the order of what it links, and
  none is merged into another's. Prose kept
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
documents, rebuilt from the files on every page load. The index itself is never stored. Each
file's scan result, its derived facts and its questions' card blocks, is kept in the browser
under the file's content hash, and never trusted without it.

> [!NOTE]
> **Amended 2026-09-29** by [`planning-index-at-scale.md` §8](planning-index-at-scale.md#8-the-scan-cache)
> ([OQ-PS1](planning-index-at-scale.md#decision-ledger)).

### 3.1 Which files it reads

- **Candidate:** a Markdown file the server lists that is matched by `[planning] include`
  and not matched by `[planning] exclude` ([§9](#9-configuration)). A roadmap that
  `[planning] roadmap` lists ([§6.1](#61-the-roadmaps)) is also a candidate whenever the
  server lists it, even when `include` or `exclude` would rule it out. A listed roadmap the
  listing leaves out, in a hidden directory or a `.vantageignore` match, is not read, and
  counts as missing. A roadmap found by its file name has no such exemption: it is a roadmap
  because it is a candidate, and `include` and `exclude` are how a reader hides one.
- **Patterns** use the gitignore-style matcher that `[starred] promote` already uses, quirks
  included, and the checker ports that matcher rather than using a library. It is not git's:
  `?` is a literal character, a pattern with a slash inside it is not anchored to the root (so
  `docs/gallery/**` also matches `x/docs/gallery/a.md`), and `[`, `(`, `\`, `{` and `+` keep
  their meaning in an [RE2](https://github.com/google/re2/wiki/Syntax) regular expression, so
  a line RE2 cannot compile is ignored. Keeping one matcher means a pattern means the same thing
  to the server, the checker and `promote`, and one shared test fixture holds both readers to
  it.
- **Planning document:** a candidate whose frontmatter has `status` or `stage`, or that
  contains at least one `oq` directive. Every roadmap is always a planning document, even with
  neither.
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
| `directiveIds[]` | every id a well-formed `oq` directive carries, whether or not it is a question's | only to tell *not a question* from *ruled* ([§5.2](#52-what-a-badge-says)) |

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

> [!NOTE]
> **Amended 2026-09-29** by [`planning-index-at-scale.md` §5](planning-index-at-scale.md#5-the-shape),
> [§6](planning-index-at-scale.md#6-the-server) and [§7](planning-index-at-scale.md#7-the-scan-worker): *Full scan* and *Transport*.

- **Full scan:** once per page load, on first need, and kept while the reader moves between
  pages. First need is opening any document, the planning page, or the file tree. It runs in a
  dedicated worker, off the page's main thread, and scans only the roadmaps and the files whose
  content this browser has not scanned before; every other file's result comes from the
  browser's scan cache. Nothing waits on it but the planning page, which shows its progress,
  and a document's first paint, which may hold up to 150 ms for a build the cache has made
  nearly free ([§5.3](#53-how-a-badge-behaves)).
- **Incremental:** when the existing change push names a candidate path, only that file is
  fetched and re-scanned. A new or deleted file joins or leaves the index. A change to
  `.vantage.toml` triggers a full rescan, which still reuses the scan cache.
- **Reconnect:** pushes sent while the push connection is down are lost. So when it drops and
  comes back while a page is open, a ready index is rescanned in full, and stays shown until the
  new scan lands. Only a genuine reconnect does this: a page's first connection is not one. A
  push lost while moving between pages stays lost until that file changes again or the index is
  rescanned.
- **Ordering:** each request for a path is numbered. A response is discarded if a newer request
  for the same path has already been sent. Otherwise the latest response wins. Scanning is a
  pure function of file contents, so re-running it is always safe.
- **Transport:** one streamed request, `POST …/planning/stream`, sends the content hash of every
  file the browser holds a result for. The server answers one line per candidate, in path order: the
  file's source, or only its hash when that matches, followed by an `end` line
  ([`planning-index-at-scale.md` §6.1](planning-index-at-scale.md#61-the-stream)). It applies its
  file listing's own rules, the include and exclude patterns and the limits, hashes what it reads,
  and does no parsing. A per-file refresh asks the planning endpoint's single-path mode, `GET
  …/planning/sources?path=`, and gets the same tests applied to that file: it answers with the
  file's source and hash, or says the file is skipped, unreadable, or absent (missing, or not a
  candidate). The existing content endpoint is not used for this. It serves paths the listing never
  yields, has no size limit, and answers a missing file and an unreadable one alike.

### 3.5 Limits, and what happens past them

> [!NOTE]
> **Amended 2026-09-29.** No new candidate limit.
> [`planning-index-at-scale.md` §10.2](planning-index-at-scale.md#102-pages) adds two render
> budgets to the planning page: 32 KiB of card Markdown per section page, and 32,000 characters
> per card before it is drawn as a preview card.

| Limit | Default | Past it |
| --- | --- | --- |
| Candidate file size | 1 MiB | skipped. Listed under *Skipped* on the planning page and by `vantage-check index` |
| Candidates per project | 5,000 | **no scan at all.** The planning page says how many files there are and to narrow `include`. `vantage-check index` prints the same and exits `3` ([§8](#8-vantage-check-index-and-the-planning-rules)) |

A partial index would quietly under-report questions, so a refusal is always visible. Both
numbers are defaults in `[planning]`.

### 3.6 Failure

> [!NOTE]
> **Amended 2026-09-29** by [`planning-index-at-scale.md` §12](planning-index-at-scale.md#12-failure-modes): the
> stream's failures, the scan worker's and the scan cache's.

- **The build fails:** the stream request fails, its first line is not the stream's header, a
  line does not parse, or the body ends without its `end` line. No badges and no Referenced by
  line; a build that stopped part way is never shown as a smaller index. The planning page
  shows the error with a Retry button, which scans again without the scan cache. Documents
  render exactly as they do without the index.
- **The scan worker stops** in the middle of a build: that build fails with *The planning scan
  stopped*, and Retry starts a new worker.
- **The browser keeps nothing** when its IndexedDB is missing, full or failing: every page load
  is then a full scan of every candidate, and nothing else changes.
- **One file cannot be read:** a file the server cannot read, or whose frontmatter does not
  parse (invalid YAML, an unterminated block, or not a mapping), is listed under *Could not
  read* on the planning page and contributes nothing, its `oq` directives included. Everything
  else is unaffected.
- **Multi-repo mode:** one index per repository. A link from one repository into another is
  never decorated.
- **A static export** ([`vantage build`](../../userguide/guides/static-sites.md)) has no
  planning endpoint and starts no scan, so it behaves as a failed build: no badges and no
  Referenced by line, and its planning page says it is a static export. A static host may
  answer the endpoint's URL with the site's `index.html`, so an answer whose first line is not
  the stream's header counts as a failure.

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
| `done` | not a live proposal | **contributes to no section:** its questions are not routed and appear nowhere on the page, a `depends-on` naming it never makes its dependent wait, and a roadmap with this role routes nothing ([§6.1](#61-the-roadmaps)). Badges, Referenced by and the file tree still show it |

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

Being a roadmap changes nothing here. A badge says what its target holds, never who routes it,
so a link to a roadmap is badged as a link to any planning document is, and a link inside any
roadmap is badged as a link anywhere else. With several roadmaps, badges need nothing new.

### 5.2 What a badge says

| Link to | Badge |
| --- | --- |
| a document | its status chip, then `stage`, then `💬 N` for open questions and `🔒 M` for blocked ones. Zero counts are left out, and a badge left with nothing is not drawn ([§5.1](#51-which-links-get-a-badge)) |
| `…#OQ-X`, and the directive is there | that question's state: `💬 open`, `🔒 blocked` or `✅ answered` |
| `…#OQ-X`, and the directive is there but is no question's: an orphan, or one in raw HTML ([§3.3](#33-a-question)) | `⚠ not a question`. Nothing compacted it, so it is not ruled, and the reconciling pass ([§10](#10-what-the-conventions-change)) must not compact it |
| `…#OQ-X`, no directive, but the id appears in the target's text | `✅ ruled`. The `design-doc` compaction rule keeps a compacted id in the Decision Ledger, so the ledger never has to be parsed (P3) |
| `…#OQ-X`, and the id appears nowhere | `⚠ not found`. The checker's existing `link/dead-section-anchor` reports it too |
| `…#some-heading` | the same as a link to the document |

### 5.3 How a badge behaves

> [!NOTE]
> **Amended 2026-09-29** by [`planning-index-at-scale.md` §11](planning-index-at-scale.md#11-late-data-never-moves-painted-content):
> when a badge may arrive.

- **It is appended after the link**, as a sibling element. It is not part of the link's text,
  and clicking it does nothing.
- **Review comment anchors ignore badges.** A comment anchor hashes a block's visible text, so a
  badge that changed with the counts would move every comment on a roadmap line. Badges are
  also left out of the contents column, of copied selections, and of the visible text that
  `vantage-check`'s agreement tests use.
- **Badges appear once the index is ready, and change as it updates.** A document's first paint
  waits for them only while a build the scan cache makes nearly free is under way, and never
  more than 150 ms. A badge that arrives after the paint is drawn only in blocks that have not
  been on screen yet, so it never moves what the reader has seen.
- **In print**, a badge prints as plain text.
- **On GitHub there are no badges.** A roadmap there is ordered links with their reasons,
  which are the judged part. The derived part is one click away, in each document's frontmatter
  table. That is accepted as the cost of writing nothing into the file.
- **Screen readers** read a badge after the link as its own text, for example
  "agent-bootstrap, in review, design, five open questions".

## 6. The planning page

> [!NOTE]
> **Amended 2026-09-29** by [`planning-index-at-scale.md` §10](planning-index-at-scale.md#10-the-planning-page-paged):
> paging, and [§6.3](#63-a-question-on-the-page)'s cards.

A page for each project, reached from a toolbar entry and with `g p` (a free chord that matches
`g h` and `g r`). It is built entirely from the index and **stores nothing** of its own: no
snooze, no assignment, no read state.

**It pages.** It paints its frame first: the header, a
[section bar](planning-index-at-scale.md#3-terms) naming each non-empty section with its count,
and its notices. Each section then shows one page: 10 entries in *Needs you*, *Unrouted* and
*Waiting*, where a page also stops before its cards' Markdown passes 32 KiB; 25 document rows in
the stage sections; 50 lines in *Skipped* and *Could not read*. The shown pages paint together,
in one commit, once their cards, their documents' comments and their diagrams are in hand. Each
section's page is in the URL, as `?needs-you=2`, so Back returns to the same pages.

Its URL is `/.vantage/planning`, and `/.vantage/planning/<repo>` in
[daemon mode](../../userguide/guides/daemon-mode.md). Viewer URLs are `/<path>` and
`/<repo>/<path>`, so a bare `/planning` would hide every document under a top-level
`planning/` directory, and a whole repository named `planning`. The server never serves a
`.vantage` path as a document, so this URL hides nothing. The history and recents pages keep
`/history` and `/recent`, and the user guide says that each hides a top-level directory of the
same name.

### 6.1 The roadmaps

A **roadmap** is a planning document whose links set an order. A repository may have none, one
or several, and which files they are is decided one of two ways:

- **Found by name, by default.** With no `roadmap` key under `[planning]`, every candidate
  ([§3.1](#31-which-files-it-reads)) whose file name is `roadmap.md` is a roadmap, in any
  directory. The file name, the path's last segment, is compared ASCII case-insensitively:
  `ROADMAP.md` and `docs/plans/Roadmap.md` are roadmaps, and `roadmap.markdown`,
  `my-roadmap.md` and a directory named `roadmap.md` are not. Nothing needs configuring. The
  normal exclusions are how a reader hides one: a hidden directory, a `.vantageignore` match,
  and `include` and `exclude`.
- **Listed, when configured.** `roadmap = "plans/roadmap.md"` or
  `roadmap = ["roadmap.md", "docs/plans/roadmap.md"]` names exactly the roadmaps, and finding
  by name is off: a `roadmap.md` the list leaves out is an ordinary document. A listed path need
  not be named `roadmap.md`, and it is read even when `include` or `exclude` would rule it out
  (Plan Q2, now per entry). `roadmap = []` names none ([§9](#9-configuration)).

> [!WARNING]
> **Finding by name looks only among candidates, and the default `include` is case-sensitive.**
> `**/*.md` does not match `ROADMAP.MD`, so the server lists that file but it is not a
> candidate, and so not a roadmap, until `include` matches it. The name alone never makes a
> roadmap.

**Roadmap order** *(coined here)* is fewer path segments first, then path order:
`roadmap.md`, then `docs/roadmap.md`, then `docs/plans/roadmap.md`. Every list of roadmaps uses
it, and the order a configured list is written in changes nothing. The **default roadmap**
*(coined here)* is the first in roadmap order that routes.

**Each roadmap has one state** *(coined here, for the notices, the picker and
`vantage-check index`)*:

| State | When | Routes |
| :--- | :--- | :--- |
| `routes` | read as a planning document, and its stage has no `done` role | yes |
| `done` | read, but its stage has the `done` role ([§4](#4-the-header-of-record-stage-next-depends-on)) | no. This is how an archived roadmap stays in the tree without holding questions off *Unrouted* |
| `skipped` | over `max-file-bytes` ([§3.5](#35-limits-and-what-happens-past-them)) | no |
| `unreadable` | under *Could not read* ([§3.6](#36-failure)) | no |
| `missing` | listed, and the index holds nothing at that path: it does not exist, or the server does not list it | no. A roadmap found by name is never missing |

Each roadmap that routes has its own order. Its links, taken in document order, **route**
questions *(coined here: a routed question is one some roadmap links, either directly or
through its document)*:

- A link to a question (`x.md#OQ-X`) routes that question.
- A bare link to a document, with no fragment, routes every live question
  ([§3.3](#33-a-question)) in it, in document order, at that position. Linking a whole doc
  under a heading such as *Building* is normal, and it should not flag that doc's questions as
  forgotten.
- A link to a heading (`x.md#some-heading`) routes nothing, although its badge is the
  document's ([§5.2](#52-what-a-badge-says)). A compacted question is cited through its
  document's `#decision-ledger` heading, and routing that citation would route the document's
  unrelated open questions.
- A question one roadmap reaches twice keeps its first position in that roadmap's order.
- Links to non-planning documents are ignored, and so are the questions of a document whose
  stage has the `done` role ([§4](#4-the-header-of-record-stage-next-depends-on)). A
  roadmap's links to itself route nothing.
- **A link to another roadmap is an ordinary link.** A bare link from `roadmap.md` to
  `docs/plans/roadmap.md` routes the questions written in `docs/plans/roadmap.md`, not the
  questions that roadmap routes: routing never passes through a roadmap.

**A question is routed when any roadmap routes it,** and unrouted when none does. The
**chosen roadmap** *(coined here)* is the one *Needs you* follows: the reader's pick on the
page ([§6.4](#64-several-roadmaps-on-the-page)), `--roadmap` in `vantage-check index`
([§8](#8-vantage-check-index-and-the-planning-rules)), and otherwise the default roadmap.

### 6.2 Sections, top to bottom

| Section | Contains | Order |
| --- | --- | --- |
| **Needs you** | Questions the chosen roadmap routes whose state is *open* or *answered* | the chosen roadmap's order |
| **Unrouted** | Open questions no roadmap routes | path, then document order |
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
- **A question only another roadmap routes** is in neither *Needs you* nor *Unrouted*: it is
  routed, just not by the chosen roadmap. The page counts those questions beside its roadmap
  picker ([§6.4](#64-several-roadmaps-on-the-page)) rather than list them in a section of
  their own.
- If no roadmap routes, because there is none or because every one is `done`, `skipped`,
  `unreadable` or `missing` ([§6.1](#61-the-roadmaps)), *Needs you* lists every open question
  grouped by document, *Unrouted* disappears, and a single line says what the page looked for
  and how to point it at a roadmap ([§6.4](#64-several-roadmaps-on-the-page)).
- If no stages are declared, the three stage sections disappear, and a single line says how to
  declare stages.

### 6.3 A question on the page

Each question appears as a card with the following parts:

- **The question itself,** rendered exactly as the viewer renders that list item: its options,
  context and leaning. The page adds no summary, so the question reads the same here as in its
  document. A question whose [card block](planning-index-at-scale.md#3-terms) is over 32,000
  characters is a *preview card* instead: its document's name and badge, the question's marker,
  title, state and leaning, and **Show question** and **Open document**. Show question renders the
  full card in place.
- **Its document,** by name, with that document's badge.
- **Its controls, which follow its state.** An open question offers **Take this leaning** (only
  when a leaning exists), **Answer…** and **Open document**. A ✅ answered question has been
  ruled, so it offers **Answer…** and **Open document**, with no leaning left to take. A 🔒
  blocked question, listed under *Waiting*, cannot be answered yet and offers only **Open
  document**.
- **Any comments already filed on it,** each marked *waiting on the agent* while it is still
  pending, painted with the card. The page waits up to 1 s for them; comments that arrive later
  go only into the card's comment count, which is always there, until it is opened. They come
  from the review comments Vantage already stores, so the page stores nothing.

**The viewer's review mode follows the same rule.** It offers **Take this leaning** on open
questions only, never on a 🔒 or ✅ one, and the Review toggle's count of questions answerable in
one click counts only the questions that offer it. The contents column still lists every
question, in every state.

**Answering** files a comment on the question in its own document. That comment is
**indistinguishable from one filed with the in-page button**: the same anchor and the same text.
Filing does not reorder the page.

**Copy answers** hands the answers to the agent in one trip. The button sits at the top of the page
and shows how many answers are pending. It copies every comment still pending for the agent on a
question listed on the page, on every page and not only the shown ones, grouped by document.
With several roadmaps that means listed under any of them: *Needs you* under every roadmap that
routes, *Unrouted* and *Waiting*, so choosing another roadmap never changes what it copies or
its count, and answers filed while reading two roadmaps still go to the agent in one trip. A
question whose card has not been rendered this visit gets the comments anchored between the first
and the last line of its unit, the innermost unit winning. Each group is the block that document's
own Copy produces, and one set of responding instructions closes the payload. Agent replies already
name their `path`, so the reply side needs nothing new. The button is disabled when nothing is
pending. Other comments in the same documents are not included; each document's own Copy still
covers those.

**Open document lands at the top of the document**, not at the question (ruled 2026-09-28).
A question that can't be answered from its own card usually needs the wider document, and no
anchor can point at "the context." From the top, the contents column lists the question one
click away. Opening a document does not change its review mode. Going **Back** returns to the
planning page at its previous scroll position.

### 6.4 Several roadmaps on the page

**The roadmap line** *(coined here)* is one line of the page's frame, directly above the section
bar, shown only when two or more roadmaps route ([§6.1](#61-the-roadmaps)). With one, or none,
there is no line, and the page reads as a one-roadmap page always has.

- **The picker** is a native select with the visible label **Roadmap**. It offers every roadmap
  that routes, in roadmap order, each by its full repo-relative path followed by its *Needs
  you* count, as `docs/plans/roadmap.md (4 need you)`, or `(1 needs you)`. Every such file is
  named `roadmap.md`, so the path is the only name that tells them apart, and it is never
  shortened. A closed native select shows its value on one line, clipped to its box, so on a
  narrow screen a deep path lost its file name and its count. The page therefore draws the
  chosen option's text itself, wrapping, under a transparent select that still takes the
  pointer and the keyboard, opens the platform's menu and is what a screen reader hears; the
  select's title is the path, for a pointer.
- **After the picker,** when some questions need you only on other roadmaps, the line says so:
  *3 more questions need you on other roadmaps*. It counts the open and answered questions
  another roadmap routes and the chosen one does not, each once. It is text, not a control: the
  picker is how a reader reaches them.
- **The choice is in the URL**, as `?roadmap=docs/plans/roadmap.md`, next to the section pages
  ([`planning-index-at-scale.md` §10.2](planning-index-at-scale.md#102-pages)). The value is
  repo-relative, and whether its `/` is escaped in the address is the implementer's; both
  spellings are read.
- **Which roadmap is chosen,** in order: the URL's, when it names a roadmap that routes; else
  the one this browser remembers for this repository, when it still routes; else the default
  roadmap. With two or more roadmaps the page then writes the choice into the URL in place,
  with no history entry, so the address always says which roadmap is shown and a copied link
  shows the same one to anyone. With fewer than two it removes the parameter in place, as it
  removes a page parameter that names page 1.
- **Picking a roadmap** replaces the URL's `roadmap`, with no history entry, as a page flip
  does, and drops `needs-you`, since that section's order is another roadmap's now; every other
  parameter stays. It also remembers the choice for this repository: in `localStorage`, per
  origin, keyed by the repository (the empty name in single-repo mode). Only a pick is
  remembered, never a visit to a URL that names one. The remembered choice is read once per
  visit, so another tab's pick never changes a page already on screen, and storage that fails
  remembers nothing and says nothing.
- **The swap is a flip.** The picker shows the roadmap asked for at once. *Needs you*, the
  section bar's counts and the line's own count change together, in one commit, once the new
  page's inputs are in hand, with the 150 ms spinner rule of a flip. The spinner sits beside the
  picker in room kept for it, so showing it never changes the line's height. Nothing else is
  announced: the select's own value is what a screen reader hears.
- **When the chosen roadmap stops routing** under an index update, because it was deleted,
  renamed, excluded or given a `done` stage, the page falls back as above and rewrites the URL
  in place. That is a change of data, which may re-lay the page out.

**The notice names what was looked for.** When no roadmap routes, the one line of
[§6.2](#62-sections-top-to-bottom) says why, in words the page and `vantage-check index` share
(P7):

| Case | The line reads |
| :--- | :--- |
| Found by name, and nothing found | *No roadmap: no planning candidate is named roadmap.md, so Needs you lists every open question by document. Add a roadmap.md in any directory, or name one with roadmap under [planning] in .vantage.toml. A roadmap.md in a hidden directory, matched by .vantageignore, or ruled out by include or exclude is not read.* |
| Found by name, and none routes | the same, with its first clause naming each roadmap found and why it does not route, as *docs/roadmap.md is larger than max-file-bytes, and plans/roadmap.md has a stage with the done role*; when every one found has a `done` stage, the remedy starts *Give it a stage without the done role* (*them stages*, for several) |
| Listed, as `[]` | *No roadmap: roadmap under [planning] in .vantage.toml is an empty list, so Needs you lists every open question by document. List a roadmap there, or remove roadmap to find every roadmap.md.* |
| Listed, and none routes | *No roadmap: roadmap under [planning] in .vantage.toml lists plans/roadmap.md, which is missing or not in Vantage's file list (it is not a .md file, or is in a hidden or excluded directory, or matches .vantageignore), so Needs you lists every open question by document. Correct the path, or remove roadmap to find every roadmap.md.* |
| Listed, and every one has a `done` stage | *No roadmap: roadmap under [planning] in .vantage.toml lists roadmap.md, which has a stage with the done role, so Needs you lists every open question by document. Give it a stage without the done role, or list another roadmap.* The path is right, and finding by name would find the same file, so neither correcting it nor removing `roadmap` would help |

Each roadmap is named with its state's phrase: `missing` *is missing or not in Vantage's file
list (…)*, `skipped` *is larger than max-file-bytes*, `unreadable` *could not be read*, and
`done` *has a stage with the done role*. When at least one roadmap routes and a listed one does
not, because it is `missing`, `skipped` or `unreadable`, a line under the section bar names it
the same way: *Not read as a roadmap: plans/b.md, which roadmap under [planning] lists, is
missing or not in Vantage's file list (…).* A listed roadmap in the `done` state gets no such
line, since a `done` stage is a deliberate retirement, and neither does a roadmap found by name,
since *Skipped* and *Could not read* already list it.

## 7. Referenced by, and status in the file tree

> [!NOTE]
> **Amended 2026-09-29** by [`planning-index-at-scale.md` §11.2](planning-index-at-scale.md#112-every-late-datum-and-where-its-space-comes-from):
> Referenced by's reserved line.

- **Referenced by:** one line below a planning document's frontmatter card, or first in the
  document when it has no card. It answers the two questions a reader asks of a document on its
  own page, *is this on the roadmap?* and *who depends on it?*, and the list of who links to it
  waits behind the line until someone asks for it. The line has up to three parts, joined by
  *·* in this order, and each appears only when its row applies:

  | Part | When | It reads |
  | :--- | :--- | :--- |
  | Count | A planning document links here | *Referenced by N documents* |
  | Roadmap | A roadmap routes the document or one of its questions ([§6.1](#61-the-roadmaps)) | With one roadmap that routes: *on the roadmap under Building*, naming the roadmap heading of the first link that routes it, or just *on the roadmap* when that link sits above every heading. With several: *on plans/roadmap.md under Building*, naming the first roadmap in roadmap order that routes it, then *and N other roadmaps* when more do |
  | Unrouted | The document has open questions no roadmap routes, which the planning page lists under *Unrouted* ([§6.2](#62-sections-top-to-bottom)) | *K open questions not routed by the roadmap*, in the warning tone; with several roadmaps that route, *…not routed by any roadmap* |

  With several roadmaps, a roadmap is named by the fewest trailing directories that tell it
  from the other roadmaps that route, as a list row names a file: `roadmap.md` at the root
  beside `plans/roadmap.md`. Names are compared ASCII case-insensitively, as a roadmap's file
  name is found ([§6.1](#61-the-roadmaps)), so `docs/Roadmap.md` and `plans/ROADMAP.md` each
  keep their directory: a reader does not tell two files apart by the case of a letter. The
  line never reads the page's chosen roadmap, so every reader, and every browser, sees the
  same line for a document.

  So a document the roadmap routes one question of, holding another it does not, reads
  *Referenced by 2 documents · on the roadmap under Now · 1 open question not routed by the
  roadmap*. The unrouted part says what the roadmap leaves out rather than that the document
  is off it, because both can be true at once: the roadmap may link the document only by
  heading, which routes nothing, and the roadmap's own page holds questions the roadmap does
  not route without the roadmap being off itself. When nothing links to the document the
  unrouted part stands alone, because the line is then the only place the document says so.

  N counts the planning documents that link to this one or to one of its questions, once each
  however many links they hold. Each roadmap counts as one when it links here. The document's
  links to itself are not counted. When nothing links to it and nothing in it is unrouted,
  there is no line. When the index is not ready at first paint, a document that is a planning
  document by its own frontmatter or directives reserves the line's room, so the line never
  pushes the document down when it lands; it stays empty if it has nothing to say.

  From the `sm` width up the line is one line, cut off at its end when it does not fit, with
  the whole of it on hover. Below that width it wraps instead: the end is the roadmap's
  answer, the part the line exists for, and a touch screen has no hover to show it. A row of
  the list wraps there too, with a hanging indent, and breaks a file name that has no other
  break point rather than widen the page.

  Routing is read exactly as the planning page reads it, so the line and the page cannot
  disagree. Only a bare link to the document and a link to one of its `#OQ-…` ids route it; a
  heading link routes nothing. A document whose stage has the `done` role contributes nothing
  ([§4](#4-the-header-of-record-stage-next-depends-on)), so its line is the count alone, and so
  is every line when no roadmap routes. A roadmap is never on itself, though it may be on
  another roadmap that links it.

  **Opening the line** shows one row per linking document: the roadmaps that route first, in
  roadmap order, and then the rest by path. A
  row is the document's file name, with its full path on hover (two documents with the same file
  name each show the fewest trailing directories that tell them apart, such as *brainstorm/x.md*
  and *design/x.md*), then the headings its links sit under, in document order and each once,
  for example *roadmap.md · Rule these first · Later*. Each heading links to the first line
  under it that links here, and the file name to the link above every heading, if the document
  has one, or else to the top of the document. A link above every heading adds no heading. A row
  shows at most four headings, then *+M more*, which opens that row. With several roadmaps that
  route, the rows' names are told apart from those roadmaps too, so a roadmap's row names it
  exactly as the line does: a `docs/roadmap.md` that is the only roadmap linking here is
  *docs/roadmap.md* in its row, never a *roadmap.md* that would read as the root's.

  When a document links here, the line is a button that says whether it is open, so it works
  from the keyboard and to a screen reader. **It is collapsed on every document load**, and
  nothing is stored: opening it lasts for that visit only. In print, the line prints, and the
  list prints only when it is open, with every heading of every row, since paper has no *+M
  more* to press.
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

`vantage-check index [--format text|json] [--roadmap <path>] [--config <path> | --no-config]`
scans the **project root** *(coined here)*: the nearest ancestor of the current directory
holding `.git` or `.vantage.toml`, or the current directory itself when there is none. `check`
finds its roadmaps from the same kind of root, looking up from each file it checks, so the two
commands agree on the project; with no root, `check` finds no roadmap and `planning/unrouted`
reports nothing, and it reads `include` and `exclude` against the current directory, the tree
`index` scans then. `--config` chooses which config is read, never which project is scanned, so
a config file kept outside the tree, such as a temporary one, does not move the scan with it.

Without `--config` or `--no-config`, both commands read `[planning]` from the project root's
own `.vantage.toml`, the one file the server reads for the repository
([`repo-config.md` §2.2](repo-config.md#22-the-repository-root-only--no-upward-walk)). `check`
still finds its own `[check]` table by walking up from its first target, and a file found that
way above the root, or at another project's root, rules nothing about this project's planning.

`index` prints the planning page's sections as text, followed by the chosen roadmap with each
link's badge written inline in brackets. With `--format json` it prints the whole index plus
those sections, with a `version` field so the format can change later. It exits `0` when it
ran, `2` for bad arguments or a bad config, and `3` when it couldn't run, which includes a
project past `max-candidates` ([§3.5](#35-limits-and-what-happens-past-them)). It never exits
`1`, because `index` reports and does not judge. That limit does not touch `check`: its planning
rules need only each checked document and the roadmaps, so it reads those alone and has nothing
to count.

**Several roadmaps, for an agent.** Every roadmap is listed, and one is chosen, as on the page
([§6.4](#64-several-roadmaps-on-the-page)), with no memory between runs:

- **`--roadmap <path>`** chooses the roadmap *Needs you* follows and whose source is printed.
  The path is repo-relative, as every path `index` prints is, with one leading `./` dropped;
  given twice, the last wins, as `--config` does. Without it the default roadmap is chosen
  ([§6.1](#61-the-roadmaps)). A path that is not a roadmap that routes exits `2` with a message
  naming the roadmaps that do, or saying there is none. Past `max-candidates` the exit is `3`
  whatever `--roadmap` says, since nothing was read to check it against.
- **Text** puts the notices first, as today, and adds the page's line for questions on other
  roadmaps, followed by *Choose one with --roadmap \<path\>*. With two or more roadmaps in any
  state it then prints a block, before *Needs you*:

  ```text
  Roadmaps (3)
    roadmap.md  3 need you  (chosen)
    docs/old/roadmap.md  does not route: has a stage with the done role
    docs/plans/roadmap.md  4 need you
  ```

  A roadmap that does not route says why: *does not route* for one a `done` stage retires,
  which was read and whose links the JSON carries, and *not read* for one that is `missing`,
  `skipped` or `unreadable`.

  and it ends, as today, with the chosen roadmap's own source, badged. The other roadmaps'
  sources are not printed; `--roadmap` prints any one of them. With one roadmap, or none, the
  text is what it was, the notice's new words aside.
- **JSON** is format `version` 2, because `sections.roadmap` and the top-level `roadmap` are
  gone, and `index.config.roadmap` became `index.config.roadmaps`: the listed paths, or `null`
  when roadmaps are found by name:

  ```json
  {
    "tool": "vantage-check",
    "toolVersion": "0.8.0",
    "version": 2,
    "root": "/home/me/project",
    "index": { "config": { "roadmaps": null, "…": "…" }, "…": "…" },
    "sections": {
      "roadmaps": [
        { "path": "roadmap.md", "state": "routes", "needsYouCount": 3 },
        { "path": "docs/old/roadmap.md", "state": "done", "needsYouCount": 0 },
        { "path": "docs/plans/roadmap.md", "state": "routes", "needsYouCount": 4 }
      ],
      "chosenRoadmap": "roadmap.md",
      "needsYou": [{ "path": "docs/a.md", "id": "OQ-1", "line": 12, "heading": "Now" }],
      "onOtherRoadmaps": [
        { "path": "docs/b.md", "id": "OQ-4", "line": 30, "heading": "Later", "roadmap": "docs/plans/roadmap.md" }
      ],
      "unrouted": [],
      "…": "…"
    },
    "roadmaps": [
      { "path": "roadmap.md", "state": "routes", "chosen": true, "links": [] },
      { "path": "docs/old/roadmap.md", "state": "done", "chosen": false, "links": [] },
      { "path": "docs/plans/roadmap.md", "state": "routes", "chosen": false, "links": [] }
    ]
  }
  ```

  `sections.roadmaps` lists every roadmap in roadmap order, with its state
  ([§6.1](#61-the-roadmaps)) and how many *Needs you* entries it gives when chosen, `0` unless
  it routes. `chosenRoadmap` is `null` when none routes. `onOtherRoadmaps` holds the questions
  the page counts beside its picker: open or answered, routed by another roadmap and not by the
  chosen one, each once, in roadmap order and then that roadmap's own order, with the first
  roadmap that routes it. The top-level `roadmaps` has one entry per entry of
  `sections.roadmaps`, in the same order, each with the links version 1 printed as `roadmap`,
  and `links` empty unless the file was read, which is the `routes` and `done` states. A
  refused project prints `null` for both `sections` and `roadmaps`.

**Finding the roadmaps costs `check` one walk of the listing when they are found by name.** A
listed roadmap is found as before, with the listing's one-path test. With nothing listed,
`planning/unrouted` cannot know which `roadmap.md` files exist without listing the tree, so it
walks the project root's listing once per run and reads only the candidates named `roadmap.md`.
It does so only when that rule is on and a document it checks has an open question and no
stage with the `done` role, and it still counts nothing and refuses nothing. Its message names the roadmap, *not routed by the
roadmap (roadmap.md)*, or with several, *not routed by any roadmap (roadmap.md,
docs/plans/roadmap.md)*.

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
| `planning/unrouted` | off | an open question no roadmap routes. This repository runs it as a warning, so the gate lists unrouted questions without failing |

These rules are the same derivations the page uses, so the page and the gate can never
disagree (P7).

## 9. Configuration

One new table in `.vantage.toml`. It is read by both the server (for the roadmaps, include,
exclude and the limits) and the checker (for everything). The server reads `roadmap` for two
reasons: a listed roadmap is a candidate whenever it exists, whatever include and exclude say
([§3.1](#31-which-files-it-reads), Plan Q2), and the stream sends every roadmap whole
([`planning-index-at-scale.md` §6.1](planning-index-at-scale.md#61-the-stream)). Telling a
roadmap by its path or its file name is a test on a path, not Markdown parsing, so P4 holds:

```toml
[planning]
# roadmap absent, the default: every candidate named roadmap.md is a roadmap
# roadmap = "plans/roadmap.md"                       # exactly this one
# roadmap = ["roadmap.md", "docs/plans/roadmap.md"]  # exactly these; [] is none
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
- This repository sets no `roadmap`, so the roadmap is found by name: `roadmap.md` at the root,
  the one `roadmap.md` outside `frontend/e2e/fixtures/`, which `exclude` already rules out. It
  adds `exclude = ["docs/gallery/**", "frontend/e2e/fixtures/**"]` (the second holds the
  end-to-end tests' planning fixtures, whose own `.vantage.toml` keeps
  `roadmap = "plans/roadmap.md"`), the table above, and `"planning/unrouted" = "warning"`
  under `[check.rules]` ([§8](#8-vantage-check-index-and-the-planning-rules)).

**`roadmap` takes a string or a list, and both readers hold it to one set of rules**, pinned by
the shared fixture that already pins the rest of the table:

- **Absent** means found by name ([§6.1](#61-the-roadmaps)). **A string** is a list of one, so
  every `.vantage.toml` written before lists could be keeps its meaning. **A list of strings**
  names exactly those roadmaps, and `[]` names none. The key stays `roadmap` in both forms;
  `roadmaps` is an unknown key, an error like any other.
- **Each path** is text, with one leading `./` dropped, and must then be non-empty, must not
  start with `/`, and must hold no `..` segment, as the string form always had to.
- **No path twice.** Two entries that are one path once `./` is dropped are an error. Paths are
  compared exactly, so `Roadmap.md` and `roadmap.md` are two roadmaps.
- **Anything else is refused whole:** a number, a boolean, an inline table, an array of tables
  (`[[planning.roadmap]]`), a list holding anything but text (a number, a nested list), and a
  list entry that breaks a path rule. The error names `planning.roadmap`, the entry's position,
  counted from 1, and its value; each reader words it in its own voice.
- **The resolved table** carries the setting as `roadmaps`: `null` when the key is absent,
  otherwise the list, in the order written, each path with its `./` dropped. That is the shape
  both readers produce, the shape the stream's header carries, and the shape the fixture
  compares.

## 10. What the conventions change

- **Vantage's style guide** (`vantage-check style-guide`, and the user guide's style-guide
  page) documents `stage`, `next` and `depends-on`, names frontmatter as the stage's one home,
  and documents the `[planning]` table, including that a file named `roadmap.md` is a roadmap
  wherever it sits and that `roadmap` lists them instead when set.

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
  badges, and put the links back in order. A roadmap is found wherever it is kept as
  `roadmap.md`, and a repository with several reconciles each with `--roadmap`.
- **`system-doc`:** no change in this design. Its `covers:` key feeds a later phase
  ([§11](#11-non-goals)).

## 11. Non-goals

- **Writing into any document.** That rules out a generated table, transclusion and templates
  (P2).
- **Deciding priority, or tracking tasks.** No board and no task state (P5).
- **Parsing prose conventions,** including status lines, roadmap tables and Decision Ledgers
  (P3).
- **Linking across repositories,** and any planning page covering several projects.
- **Merging several roadmaps into one order.** Each roadmap's order is its author's; the page
  shows one at a time and counts what the others route.
- **Routing through a roadmap.** A roadmap that links another routes the questions written in
  it, never the ones it routes ([§6.1](#61-the-roadmaps)).
- **Choosing a roadmap from the document the reader came from.** The page's choice is the URL's,
  then the remembered one, then the default, whatever document `g p` was pressed on.
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
| One roadmap, `roadmap.md` at the root unless `[planning] roadmap` names another | **Replaced** (user ruling 2026-09-30). A repository that keeps its roadmap at `docs/plans/roadmap.md` got *No roadmap* until someone configured it, the failure [§3.1](#31-which-files-it-reads) rejected declared roots for |
| Questions only another roadmap routes counted as *Unrouted* | **Rejected** by the same ruling. Unrouted says no roadmap has placed a question, and another roadmap has |
| Questions only another roadmap routes as a section of their own | **Rejected.** Its entries would be other roadmaps' *Needs you* again, in no order anyone wrote, and the picker already reaches them in theirs; a count beside the picker says they exist |
| One *Needs you* merging every roadmap's order | **Rejected.** Two authors' orders have no common order, and interleaving them is a priority nobody wrote (P5) |
| A per-line roadmap mark on the stream | **Rejected.** The header's config already says which paths are roadmaps, and the worker applies the same path test as the server; a mark would make the server a second judge of it ([`planning-index-at-scale.md` §6.1](planning-index-at-scale.md#61-the-stream)) |
| A configured list's first entry as the default roadmap | **Rejected.** One rule, nearest the root first, serves both forms, so the order a list is written in never matters |
| `--roadmap` resolved against the current directory | **Rejected.** Every path `index` prints is repo-relative, and one spelling means the same path from any directory |

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| A badge changes a block's visible text and moves comment anchors | Excluded from anchor text by rule ([§5.3](#53-how-a-badge-behaves)). A test files a comment, changes the count, and checks that the anchor still resolves |
| The index and the contents column disagree on a question's state | One extraction, or an agreement test ([§3.3](#33-a-question)) |
| Scan time on a large repository | Parse only planning documents and refuse past the candidate limit. Scan in a worker, fed only the files whose content changed, with each file's result kept in the browser, and render one page of each section ([`planning-index-at-scale.md`](planning-index-at-scale.md)). A background scan on the main thread alone froze `g p` for seconds at 300 documents. Targets: [§15](#15-what-done-looks-like) here, and the amendment's [§19](planning-index-at-scale.md#19-what-done-looks-like) at scale |
| Another tool already uses a top-level `stage` key, such as a site generator's `stage: production` | **Accepted.** A `stage` key alone makes a file a planning document ([§3.1](#31-which-files-it-reads)), so every link to it and its file-tree row show `production` as its stage. The checker holds `stage` to a vocabulary only when stages are declared, and a repository whose files use the key for something else lists them in `[planning] exclude`. A foreign `next` is read only in a file that is already a planning document |
| An answer filed from the page gets a different anchor than the in-page button would give | The two paths are compared in a test that files from both |
| A stray `roadmap.md` (a vendored package's, a test fixture's, an old plan's) becomes a roadmap and hides the questions it routes from *Unrouted* | **Accepted.** Every roadmap is listed by the picker and by `vantage-check index`, so a stray one is visible; `exclude` hides it, and a `done` stage retires one kept on purpose ([§6.1](#61-the-roadmaps)) |
| The server and the worker disagree on which paths are roadmaps, and a stored result is used for one | One shared fixture holds both path tests to one answer, and the worker never uses a stored result for a path it holds to be a roadmap, even when the stream says `same` ([`planning-index-at-scale.md` §6.1](planning-index-at-scale.md#61-the-stream)) |
| Many roadmaps make every warm reload send each of them whole | **Accepted.** Each is bounded by `max-file-bytes`; a monorepo with one per package can list the ones it wants |
| Two readers of one repository open the page on different roadmaps | By design: the choice is remembered per browser. The URL always names the roadmap shown, so a shared link shows the same one |
| An upgrade: a repository with no `roadmap` key that narrowed `include` or `exclude`, such as `include = ["docs/**"]`, relied on the old default's exemption, which read the root's `roadmap.md` whatever the patterns said; found by name, that file is a candidate like any other, so the repository has *No roadmap* | **Accepted** (the ruling applies the normal exclusions). The notice's last sentence names the cause, the [configuration reference](../../userguide/reference/configuration.md#planning-documents) says what to do, `roadmap = "roadmap.md"`, and the notes of the first release carrying several roadmaps say so. The planning index has shipped in no tag, so only a build of `main` is affected |
| An upgrade: a listed roadmap whose stage has the `done` role, such as `roadmap = "roadmap.md"` in a repository whose own roadmap carries a stage its vocabulary maps to `done`, routed before and routes nothing now | **Accepted** ([§6.1](#61-the-roadmaps)). The notice says it has a stage with the `done` role and gives the remedy that fits, *Give it a stage without the done role, or list another roadmap* ([§6.4](#64-several-roadmaps-on-the-page)), since the path is right and finding by name would find the same file |
| A tab from before this change reads a stream header that has `roadmaps` instead of `roadmap` | Its build fails with the stream's shape error and Retry, as a tab of an older build does after any wire change; a reload fixes it. No released tab has ever read the stream ([`planning-index-at-scale.md` §6.1](planning-index-at-scale.md#61-the-stream)) |

## 14. Sequencing

1. **Phase 1:** the scan in `vantage-md`, the `[planning]` config in both readers, the
   frontmatter keys, the planning endpoint, link badges, and `vantage-check index` with its
   rules. At this point the roadmap can be rewritten as lists of links.
2. **Phase 2:** the planning page, Referenced by, and file-tree badges.
3. **Several roadmaps** (ruled 2026-09-30): the config's second form, finding roadmaps by name,
   the picker, and every surface's reading of several. The change crosses both config readers
   and the planning module's types, so its three work packages landed as one commit, `4bef79d`
   ([`planning-index-plan.md`](planning-index-plan.md#several-roadmaps--the-2026-09-30-build)).

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
- On this repository, the first page load has the index ready within 1 s, and no document's
  first paint waits for it longer than the 150 ms hold
  ([`planning-index-at-scale.md` §11.3](planning-index-at-scale.md#113-the-hold)). The amendment's
  [§19](planning-index-at-scale.md#19-what-done-looks-like) sets the targets at scale.
- **Several roadmaps**, with nothing configured:
  - A repository whose only roadmap is `docs/plans/roadmap.md` gets a planning page whose
    *Needs you* follows that file's order, with no *No roadmap* line.
  - With a second `roadmap.md` at the root, the page shows the roadmap line, chooses the root's
    by default, and switches *Needs you* when the other is picked. The address then names it,
    and a reload, and a later `g p`, open on it.
  - A question only the other roadmap routes is counted beside the picker and is not under
    *Unrouted*. Copy answers includes a comment filed on it.
  - `vantage-check index` lists both roadmaps, `--roadmap docs/plans/roadmap.md` prints that
    one's order and source, and `planning/unrouted` reports only questions neither routes.
  - A `roadmap.md` under an `exclude` pattern is no roadmap anywhere.
- **This repository** sets no `roadmap`, and its page, its `index` and its gate read exactly as
  they did with `roadmap.md` named.

## Decision Ledger

Rows named *Plan Q1* to *Plan Q20* rule the questions that
[`planning-index-plan.md`](planning-index-plan.md) raised for the coordinator, which the plan
cites by those numbers. They are not `OQ-` ids. Plan Q5 and Plan Q8 differ from the defaults
the plan proposed.

| ID | Ruling / Decision | Date | Settled in | Built |
| :--- | :--- | :--- | :--- | :--- |
| — | Build it: a planning index in Vantage, following the brainstorm's direction ([`OQ-PI1`](../brainstorm/planning-index.md#decision-ledger)) | 2026-09-28 | [§1](#1-verdict-and-the-principles) | ✅ [`planning/`](../../packages/vantage-md/src/planning/index.ts) |
| — | **Open document** from the planning page lands at the top of the document, not at the question | 2026-09-28 | [§6.3](#63-a-question-on-the-page) | ✅ [`PlanningQuestionCard.tsx`](../../frontend/src/components/PlanningQuestionCard.tsx) |
| — | User direction 2026-09-29: Referenced by is one motivated, collapsed line. It says whether the roadmap routes the document and how many documents link to it, and opens to one row per document. It replaces a list with one row per linking document and heading, always open, which pushed a heavily cited document's body a screen down | 2026-09-29 | [§7](#7-referenced-by-and-status-in-the-file-tree) | ✅ [`ReferencedBy.tsx`](../../frontend/src/components/ReferencedBy.tsx) |
| — | Referenced by always counts the open questions the roadmap does not route, as *K open questions not routed by the roadmap*, even when the roadmap routes another of the document's questions. It replaces *not on the roadmap (K open questions)*, shown only when nothing was routed, which hid a partly routed document's unrouted questions, read as false on a document the roadmap links only by heading, and on the roadmap's own page said the roadmap was not on itself. The user direction did not say which wins when both apply; this keeps both, and is open to the user's review | 2026-09-29 | [§7](#7-referenced-by-and-status-in-the-file-tree) | ✅ [`ReferencedBy.tsx`](../../frontend/src/components/ReferencedBy.tsx) |
| OQ-PL1 | `stage:` is the stage's only home; a prose status line carries the date and the why. Decided on generic grounds, not to fit one set of conventions | 2026-09-28 | [§4](#4-the-header-of-record-stage-next-depends-on) | ✅ [`scan.ts`](../../packages/vantage-md/src/planning/scan.ts) |
| OQ-PL2 | A planning document is any file with planning frontmatter or an `oq` directive; everything is included by default, with an exclude list | 2026-09-28 | [§3.1](#31-which-files-it-reads) | ✅ [`scan.ts`](../../packages/vantage-md/src/planning/scan.ts) |
| OQ-PL3 | A roadmap fully readable only in Vantage is acceptable: GitHub keeps the order and reasons | 2026-09-28 | [§5.3](#53-how-a-badge-behaves) | ✅ nothing to build |
| OQ-PL4 | One **Copy answers** button on the planning page, grouped by document | 2026-09-28 | [§6.3](#63-a-question-on-the-page) | ✅ [`PlanningPage.tsx`](../../frontend/src/pages/PlanningPage.tsx) |
| — | Plan Q1: patterns keep the server's matcher, its quirks and RE2 dialect included; the checker ports it, and one shared fixture pins both readers | 2026-09-28 | [§3.1](#31-which-files-it-reads) | ✅ [`patterns.ts`](../../packages/vantage-md/src/planning/patterns.ts) |
| — | Plan Q2: the roadmap is read whenever it exists, even when `include` or `exclude` rules it out | 2026-09-28 | [§3.1](#31-which-files-it-reads) | ✅ [`planning.go`](../../internal/planning/planning.go) |
| — | Plan Q3: static exports get no badges and no planning index; the planning page shows its failed-fetch error | 2026-09-28 | [§3.6](#36-failure) | ✅ [`usePlanningStore.ts`](../../frontend/src/stores/usePlanningStore.ts) |
| — | Plan Q4: this repository runs `planning/unrouted` as a warning | 2026-09-28 | [§8](#8-vantage-check-index-and-the-planning-rules), [§9](#9-configuration) | ✅ [`.vantage.toml`](../../.vantage.toml) |
| — | Plan Q5: an `oq` with no id, a malformed id or a repeated one is still a question, counted with no id. **Take this leaning** is not offered on 🔒 or ✅ questions, neither in the viewer's review mode nor on the planning page, where 🔒 questions sit under *Waiting* with no Take or Answer… control; the contents column still lists them. The plan's default had left the buttons unchanged | 2026-09-28 | [§3.3](#33-a-question), [§6.3](#63-a-question-on-the-page) | ✅ [`useOpenQuestionButtons.ts`](../../frontend/src/hooks/useOpenQuestionButtons.ts) |
| — | Plan Q6: every question the index holds is live; a `depends-on` naming a question waits only while that question is open (💬) | 2026-09-28 | [§3.3](#33-a-question), [§6.2](#62-sections-top-to-bottom) | ✅ [`sections.ts`](../../packages/vantage-md/src/planning/sections.ts) |
| — | Plan Q7: `vantage-check index` exits `3` past `max-candidates`; `check` is unaffected | 2026-09-28 | [§8](#8-vantage-check-index-and-the-planning-rules) | ✅ [`index.ts`](../../packages/vantage-check/src/commands/index.ts) |
| — | Plan Q8: this work adds no Unreleased section to the changelog; release notes are written at release time, as today. The plan's default had added one | 2026-09-28 | [§14](#14-sequencing) | ✅ nothing to build |
| — | Plan Q9: the checker mirrors the repository-level listing rules only; per-reader settings stay invisible to it | 2026-09-28 | [§8](#8-vantage-check-index-and-the-planning-rules) | ✅ [`candidates.ts`](../../packages/vantage-check/src/core/candidates.ts) |
| — | Plan Q10: each roadmap item becomes a link plus a one-clause reason with its existing prose kept beneath; this repository's stages are [§9](#9-configuration)'s table | 2026-09-28 | [§1](#1-verdict-and-the-principles) (P5), [§14](#14-sequencing) | ✅ [`roadmap.md`](../../roadmap.md) |
| — | Plan Q11: a `done` document contributes nothing to any section, and a `depends-on` on it never makes its dependent wait | 2026-09-28 | [§4](#4-the-header-of-record-stage-next-depends-on) | ✅ [`sections.ts`](../../packages/vantage-md/src/planning/sections.ts) |
| — | Plan Q12: only a bare document link and a `#OQ-…` link route; a heading link routes nothing | 2026-09-28 | [§6.1](#61-the-roadmaps) | ✅ [`sections.ts`](../../packages/vantage-md/src/planning/sections.ts) |
| — | Plan Q13: the planning page lives at `/.vantage/planning`, and `/.vantage/planning/<repo>` in daemon mode; `/recent` and `/history` stay, and the user guide documents what they hide | 2026-09-28 | [§6](#6-the-planning-page) | ✅ [`planningRoute.ts`](../../frontend/src/lib/planningRoute.ts) |
| — | Plan Q14: a genuine reconnect rescans a ready index and keeps it shown until the new scan lands; a page's first connection is not a reconnect | 2026-09-28 | [§3.4](#34-when-it-is-built-and-how-it-stays-fresh) | ✅ [`usePlanningStore.ts`](../../frontend/src/stores/usePlanningStore.ts) |
| — | Plan Q15: a per-file refresh asks the planning endpoint for one path, never the content endpoint | 2026-09-28 | [§3.4](#34-when-it-is-built-and-how-it-stays-fresh) | ✅ [`core.ts`](../../frontend/src/planningScan/core.ts) |
| — | Plan Q16: one project root for both commands, the nearest ancestor holding `.git` or `.vantage.toml`; `--config` never moves it, and `index` falls back to the current directory | 2026-09-28 | [§8](#8-vantage-check-index-and-the-planning-rules) | ✅ [`projectRoot.ts`](../../packages/vantage-check/src/core/projectRoot.ts) |
| — | Plan Q17: an `oq` inside a raw HTML block is not a question to the index; the agreement test pins that one divergence | 2026-09-28 | [§3.3](#33-a-question) | ✅ [`scan.ts`](../../packages/vantage-md/src/planning/scan.ts) |
| — | Plan Q18: a foreign top-level `stage` key makes a planning document, as designed; `[planning] exclude` is the remedy | 2026-09-28 | [§13](#13-risks) | ✅ nothing to build |
| — | Plan Q19: the planning module is internal to `vantage-md`; `FrontmatterDisplay`'s optional `linkIds` is the one public addition | 2026-09-28 | [§1](#1-verdict-and-the-principles) (P4) | ✅ [`FrontmatterDisplay.tsx`](../../packages/vantage-md/src/FrontmatterDisplay.tsx) |
| — | Plan Q20: the plan's eight gap-fills. A header that does not parse makes its file unreadable; a non-string or empty `stage` and a non-string or multi-line `next` are ignored, a single `depends-on` path is a one-entry list, and a non-string entry is dropped; stage matching is exact and case-sensitive; an empty stages table is none; a `depends-on` target outside the repository, or whose `#OQ-…` id appears nowhere in it, is a finding; a skipped or unreadable roadmap counts as missing; an empty document badge is not drawn; `next` links only an id a question carries | 2026-09-28 | [§3.6](#36-failure), [§4](#4-the-header-of-record-stage-next-depends-on), [§5.1](#51-which-links-get-a-badge), [§6.2](#62-sections-top-to-bottom), [§9](#9-configuration) | ✅ [`scan.ts`](../../packages/vantage-md/src/planning/scan.ts) |
| — | User ruling 2026-09-28: the file name wins. A tree badge takes no width from a file name: it uses only the room the name leaves, is drawn whole or not at all, and is a compact dot and `💬 N` whose words are its tooltip and accessible name. It replaced a full status chip that cut long names down to their first letter | 2026-09-28 | [§7](#7-referenced-by-and-status-in-the-file-tree) | ✅ [`PlanningTreeBadge.tsx`](../../frontend/src/components/PlanningTreeBadge.tsx) |
| — | Amended for large repositories by [`planning-index-at-scale.md`](planning-index-at-scale.md): the index is built in a worker from a stream that carries only the files whose content changed, each file's scan result is kept in the browser under its content hash ([OQ-PS1](planning-index-at-scale.md#decision-ledger)), the planning page pages, and late data never moves painted content | 2026-09-29 | [§3](#3-the-planning-index), [§3.4](#34-when-it-is-built-and-how-it-stays-fresh), [§3.6](#36-failure), [§5.3](#53-how-a-badge-behaves), [§6](#6-the-planning-page), [§7](#7-referenced-by-and-status-in-the-file-tree) | ✅ [`planningScan/`](../../frontend/src/planningScan/core.ts) |
| — | User ruling 2026-09-30: roadmaps are discovered by name; several can be listed and picked. With no `roadmap` key, every candidate named `roadmap.md` (ASCII case-insensitive, any directory) is a roadmap, hidden by the normal exclusions; `roadmap` takes a string or a list, which names exactly the roadmaps, each read whatever `include` and `exclude` say, and `[]` names none. The page offers a picker when several route, its choice in the URL and remembered per repository, the default nearest the root. A question is routed when any roadmap routes it, and *Needs you* follows the chosen one. Every surface agrees, and a notice names what was looked for. This repository's `.vantage.toml` keeps working unchanged | 2026-09-30 | [§3.1](#31-which-files-it-reads), [§6.1](#61-the-roadmaps), [§6.2](#62-sections-top-to-bottom), [§6.4](#64-several-roadmaps-on-the-page), [§7](#7-referenced-by-and-status-in-the-file-tree), [§8](#8-vantage-check-index-and-the-planning-rules), [§9](#9-configuration) | ✅ [`sections.ts`](../../packages/vantage-md/src/planning/sections.ts), [`repoconfig.go`](../../internal/repoconfig/repoconfig.go) |
| — | The details that ruling left, decided with it and open to the user's review: questions only another roadmap routes are counted beside the picker (*N more questions need you on other roadmaps*), not listed; the roadmap line is a native select above the section bar, shown only when two or more roadmaps route; the URL always names the roadmap shown when there is a choice, and only a pick is remembered; Copy answers covers every roadmap's questions; a roadmap with a `done` stage routes nothing; a roadmap's link to another routes that roadmap's own questions, never transitively; `vantage-check index` JSON is format version 2, with `sections.roadmaps`, `chosenRoadmap`, `onOtherRoadmaps` and a top-level `roadmaps`; `--roadmap` is repo-relative and exits `2` on a path that does not route; a list entry that is not text, breaks a path rule or repeats a path refuses the file in both readers; the stream marks roadmaps only through its header's config | 2026-09-30 | [§6.1](#61-the-roadmaps), [§6.3](#63-a-question-on-the-page), [§6.4](#64-several-roadmaps-on-the-page), [§8](#8-vantage-check-index-and-the-planning-rules), [§9](#9-configuration), [§12](#12-alternatives-considered) | ✅ [`PlanningPage.tsx`](../../frontend/src/pages/PlanningPage.tsx), [`index.ts`](../../packages/vantage-check/src/commands/index.ts) |
