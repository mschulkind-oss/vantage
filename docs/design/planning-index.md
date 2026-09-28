---
title: "The planning index — write each planning fact once, and show it wherever it is linked"
author: "Matt Schulkind"
date: 2026-09-28
status: in-review
stage: DESIGN
tags: [planning, roadmap, viewer, vantage-check, vantage-md, config]
summary: "Vantage reads a repository's planning documents as a set — frontmatter, open questions, and the links between them — and shows each fact beside every link to it, on a page of its own, and to agents through vantage-check. It never writes a document."
---

# The planning index — write each planning fact once, and show it wherever it is linked

**Status:** DESIGN, 2026-09-28. Nothing built. Evidence verified against the tree at `612e784`.

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
a planning page, Referenced-by lists plus file-tree badges, and `vantage-check index`.

**Cost.** Two new frontmatter keys and one `.vantage.toml` table. The Matcraft `design-doc` and
`roadmap` skills change what they write ([§10](#10-what-the-matcraft-skills-change)).

**Start at [§3](#3-the-planning-index).** Every surface is a view of that model.

**Needs your ruling:** [OQ-PL1](#OQ-PL1), [OQ-PL2](#OQ-PL2), [OQ-PL3](#OQ-PL3), [OQ-PL4](#OQ-PL4).

**Reads with:** [`planning-index-plan.md`](planning-index-plan.md) (the implementation sketch,
incomplete while questions are open) and [the brainstorm](../brainstorm/planning-index.md)
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
  `vantage-check`. The Go server serves files and reads TOML; it never parses Markdown
  ([`AGENTS.md`](../../AGENTS.md)).
- **P5. The roadmap owns priority and nothing else.** Its order and its one-clause reasons are
  the only judged facts it holds.
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
  and not matched by `[planning] exclude`
  ([§9](#9-configuration)). Both use gitignore syntax, the same as `[starred] promote`.
- **Planning document:** a candidate whose frontmatter has `status` or `stage`, or that
  contains at least one `oq` directive. The roadmap is always a planning document.
- Only planning documents contribute anything: facts, questions, or links. Any other candidate
  is read, found to be neither, and dropped.

What counts by default is [OQ-PL2](#OQ-PL2). On this repository, `docs/gallery/` has to be
excluded under any default, because its 11 demo questions outnumber the 6 real ones.

### 3.2 What a document contributes

| Field | Source | Notes |
| --- | --- | --- |
| `path` | repo-relative | identity |
| `status` | frontmatter `status` | shown only if it is one of the four, otherwise ignored |
| `stage`, `next`, `depends-on` | frontmatter ([§4](#4-the-header-of-record-stage-next-depends-on)) | |
| `questions[]` | every `oq` directive, in document order | [§3.3](#33-a-question) |
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
([§10](#10-what-the-matcraft-skills-change)). If an id is duplicated, the first occurrence wins;
the checker already reports the second (`vantage/oq-id-duplicate`).

> [!IMPORTANT]
> **The index and the contents column must agree on every question's state.** Today the
> contents column reads state from the DOM. The index reads it from source. Either they share
> one extraction in `vantage-md`, or a test in the style of
> `frontend/src/lib/pipelineAgreement.test.tsx` holds them equal over the same corpus.

### 3.4 When it is built, and how it stays fresh

- **Full scan:** once per project per browser session, on first need. First need is opening any
  document, the planning page, or the file tree. It runs in the background, and nothing waits
  on it.
- **Incremental:** when the existing change push names a candidate path, only that file is
  fetched and re-scanned. A new or deleted file joins or leaves the index. A change to
  `.vantage.toml` triggers a full rescan.
- **Ordering:** each request for a path is numbered. A response is discarded if a newer request
  for the same path has already been sent. Otherwise the latest response wins. Scanning is a
  pure function of file contents, so re-running it is always safe.
- **Transport:** one request returns every candidate's source. The server applies the include
  and exclude patterns and does no parsing. Per-file refreshes use the existing content
  endpoint.

### 3.5 Limits, and what happens past them

| Limit | Default | Past it |
| --- | --- | --- |
| Candidate file size | 1 MiB | skipped. Listed under *Skipped* on the planning page and by `vantage-check index` |
| Candidates per project | 5,000 | **no scan at all.** The planning page says how many files there are and to narrow `include` |

A partial index would quietly under-report questions, so a refusal is always visible. Both
numbers are defaults in `[planning]`.

### 3.6 Failure

- **The batch fetch fails:** no badges or Referenced-by lists. The planning page shows the error
  with a Retry button. Documents render exactly as they do today.
- **One file fails to parse:** listed under *Could not read* on the planning page, contributing
  nothing. Everything else is unaffected.
- **Multi-repo mode:** one index per repository. A link from one repository into another is
  never decorated.

## 4. The header of record: `stage`, `next`, `depends-on`

These are three **top-level** frontmatter keys, next to `status`. They sit at the top level
because they are facts about the document, while `vantage:` holds only Vantage chrome, and
because GitHub's frontmatter table then shows each as its own labeled row (verified against this
repository's [`repo-config.md`](repo-config.md) on 2026-09-26). Whether `stage` should replace the word in the
prose `**Status:**` line is [OQ-PL1](#OQ-PL1).

```yaml
status: in-review
stage: DESIGN
next: "Rule OQ-B2 — the payload's install step waits on it"
depends-on:
  - pypi-distribution.md
```

| Key | Type | Rules |
| --- | --- | --- |
| `stage` | one word | Displayed as written. When `[planning.stages]` is declared, a word outside it is a checker error, and its badge is drawn in the warning tone |
| `next` | a string on one line | Plain text. A bare `OQ-…` id in it is linked to this document's question when this document declares that id |
| `depends-on` | a list of relative paths, each optionally with `#OQ-…` | Resolved like links. A missing target is a checker error |

A **stage role** *(coined here)* says what a stage word means to the planning page. Roles come
from a closed set of four, and a repository maps its own words onto them ([§9](#9-configuration)):

| Role | Meaning | Planning page |
| --- | --- | --- |
| `open` | still being decided | nothing extra |
| `ready` | decided, not built | **Ready** |
| `built` | built | **Graduate**, when it has no live questions |
| `done` | not a live proposal | left off the page. Badges still show |

A document with no `stage`, or whose repository declares no stages, has no role. It still
appears under Needs you, Unrouted and Waiting, because those sections depend only on questions
and links.

**Forbidden:** a `priority` key. Priorities written separately into each doc cannot be compared
with each other (P5).

## 5. Links show their target's state

### 5.1 Which links get a badge

A link gets a badge when all of the following hold:

1. It is a rendered Markdown link, not text inside code.
2. Its target is a planning document in the same repository.
3. The target has something to show: a `status`, a `stage`, or at least one question.
4. It points to another document. Links within a document get no badge, because the contents
   column already covers them.

### 5.2 What a badge says

| Link to | Badge |
| --- | --- |
| a document | its status chip, then `stage`, then `💬 N` for open questions and `🔒 M` for blocked ones. Zero counts are left out |
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
- **Screen readers** read a badge after the link as its own text, for example
  "agent-bootstrap, in review, design, five open questions".

## 6. The planning page

A page for each project, reached from a toolbar entry and with `g p` (a free chord that matches
`g h` and `g r`). It is built entirely from the index and **stores nothing** of its own: no
snooze, no assignment, no read state.

### 6.1 The roadmap

The roadmap is the file named by `[planning] roadmap`, `roadmap.md` at the root by default. Its
links, taken in document order, **route** questions *(coined here: a routed question is one the
roadmap links, either directly or through its document)*:

- A link to a question routes that question.
- A link to a document routes every live question in it, in document order, at that position.
  Linking a whole doc under a heading such as *Building* is normal, and it should not flag that
  doc's questions as forgotten.
- A question reached twice keeps its first position.
- Links to non-planning documents are ignored.

### 6.2 Sections, top to bottom

| Section | Contains | Order |
| --- | --- | --- |
| **Needs you** | Routed questions whose state is *open* or *answered* | roadmap position |
| **Unrouted** | Open questions the roadmap does not route | path, then document order |
| **Waiting** | Blocked questions; also documents whose `depends-on` target still has open questions | path |
| **Ready** | Documents whose stage has the `ready` role and no open questions | path |
| **Graduate** | Documents whose stage has the `built` role and no live questions | path |
| **Disagrees** | Documents whose stage says `ready` or `built` while they still have open questions | path |
| **Skipped** / **Could not read** | [§3.5](#35-limits-and-what-happens-past-them), [§3.6](#36-failure) | path |

- An empty section is not shown.
- If there are no open questions at all, the page says **Nothing needs you**.
- If there is no roadmap file, *Needs you* lists every open question grouped by document,
  *Unrouted* disappears, and a single line says which file the page would read as the roadmap.
- If no stages are declared, the three stage sections disappear, and a single line says how to
  declare stages.

### 6.3 A question on the page

Each question appears as a card with the following parts:

- **The question itself,** rendered exactly as the viewer renders that list item: its options,
  context and leaning. The page adds no summary, so the question reads the same here as in its
  document.
- **Its document,** by name, with that document's badge.
- **Take this leaning** (only when a leaning exists), **Answer…**, and **Open document**.
- **Any comments already filed on it,** each marked *waiting on the agent* while it is still
  pending. They come from the review comments Vantage already stores, so the page stores
  nothing.

**Answering** files a comment on the question in its own document. That comment is
**indistinguishable from one filed with the in-page button**: the same anchor and the same text.
Filing does not reorder the page. How the agent then receives answers spread across several
documents is [OQ-PL4](#OQ-PL4).

**Open document lands at the top of the document**, not at the question (ruled 2026-09-28).
A question that can't be answered from its own card usually needs the wider document, and no
anchor can point at "the context." From the top, the contents column lists the question one
click away. Opening a document does not change its review mode. Going **Back** returns to the
planning page at its previous scroll position.

## 7. Referenced by, and status in the file tree

- **Referenced by:** below a planning document's frontmatter card, a list of the planning
  documents that link to this one or to one of its questions. Each entry names the heading the
  link sits under, for example *roadmap.md · Rule these first*. The document's links to itself
  are not listed. If nothing links to it, the list is not shown.
- **File tree:** each planning document shows its `stage` (or its status chip when it has no
  stage) and `💬 N` when it has open questions. Other files are unchanged.

Both come from the index ([§3](#3-the-planning-index)). Neither needs anything new from the
server.

## 8. `vantage-check index`, and the planning rules

`vantage-check index [--format text|json] [--config <path> | --no-config]` scans the project
that owns the config: the directory holding `.vantage.toml`, otherwise the git root, otherwise
the current directory. It prints the planning page's sections as text, followed by the roadmap
with each link's badge written inline in brackets. With `--format json` it prints the whole
index plus those sections, with a `version` field so the format can change later. It exits
`0` when it ran, `2` for bad arguments, and `3` when it couldn't run. It never exits `1`,
because `index` reports and does not judge.

The `check` command gains four rules:

| Rule | Default | Reports |
| --- | --- | --- |
| `planning/stage-vocabulary` | error, when `[planning.stages]` is declared | a `stage` outside the declared words |
| `planning/depends-on-missing` | error | a `depends-on` entry whose target does not exist |
| `planning/stage-disagrees` | warning | the page's *Disagrees* section |
| `planning/unrouted` | off | an open question the roadmap does not route. This repository turns it on |

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

[planning.stages]              # optional; absent = no vocabulary, no roles
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
- This repository adds `exclude = ["docs/gallery/**"]` and the table above.

## 10. What the Matcraft skills change

The skills live outside this repository, so these changes are proposals for whoever maintains
them.

- **`design-doc`:** write `stage:` and `next:` in the frontmatter ([OQ-PL1](#OQ-PL1)). Put an
  `oq` directive on 🔒 questions too, with no `leaning` required. Drop the hand-maintained
  **Needs your ruling** line, or keep it knowing that nothing checks it (P3).
- **`roadmap`:** an entry becomes an ordered link plus a one-clause reason. The Doc, Live and
  Gate columns and the counted header go away, because a badge replaces each of them.
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
| Opening a document at the question's anchor | **Rejected** (ruled 2026-09-28). Context is in the wider document, and the contents column puts the question one click away |

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| A badge changes a block's visible text and moves comment anchors | Excluded from anchor text by rule ([§5.3](#53-how-a-badge-behaves)). A test files a comment, changes the count, and checks that the anchor still resolves |
| The index and the contents column disagree on a question's state | One extraction, or an agreement test ([§3.3](#33-a-question)) |
| Scan time on a large repository | Parse only planning documents, refuse past the candidate limit, and scan in the background. Measured by the done criteria in [§15](#15-what-done-looks-like) |
| Another tool already uses a top-level `stage` or `next` key | Vantage shows them only in a planning document, and checks `stage` only when stages are declared |
| An answer filed from the page gets a different anchor than the in-page button would give | The two paths are compared in a test that files from both |

## 14. Sequencing

1. **Phase 1:** the scan in `vantage-md`, the `[planning]` config in both readers, the
   frontmatter keys, the batch endpoint, link badges, and `vantage-check index` with its
   rules. At this point the roadmap can be rewritten as lists of links.
2. **Phase 2:** the planning page, Referenced by, and file-tree badges.

Each phase lands with this repository's own corpus converted, meaning stages declared and the
gallery excluded, so it is used the day it ships.

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

## Open Questions

1. 💬 **OQ-PL1: Does `stage:` replace the word in the prose `**Status:**` line?** This changes
   the `design-doc` skill and every design doc here.

   - **A — Replace it.** The word lives only in frontmatter. The prose line keeps the date and
     the *why*. The stage has one home, and the checker can hold it to the vocabulary.
   - **B — Keep both.** The prose line stays as it is and `stage:` is added. That is two homes,
     and it is exactly the drift [§2](#2-what-exists-today)'s evidence came from.

   <!-- vantage: oq id=OQ-PL1 leaning="A — replace it: the stage word lives only in frontmatter stage:, and the prose status line keeps only the date and the why." -->

   _Leaning:_ A. B is the problem this design exists to remove.

   **Answer:**
   > _(empty — fill in when decided)_

2. 💬 **OQ-PL2: What makes a file a planning document by default?** This decides what shows up
   with no configuration in a repository that has never heard of this design.

   - **A — Planning frontmatter or an `oq` directive** ([§3.1](#31-which-files-it-reads)), with
     everything included and an exclude list. There is nothing to configure, and demos are
     excluded explicitly.
   - **B — Only paths under declared roots.** Precise, but nothing appears until someone writes
     the config.

   <!-- vantage: oq id=OQ-PL2 leaning="A — any file with planning frontmatter or an oq directive, everything included by default, with an exclude list; this repository excludes docs/gallery." -->

   _Leaning:_ A. It costs this repository one line.

   **Answer:**
   > _(empty — fill in when decided)_

3. 💬 🤷 **OQ-PL3: Is a roadmap that is fully readable only in Vantage acceptable?** On GitHub
   it is an ordered list of links with their reasons. Status and counts are one click away,
   in each document's frontmatter table.

   <!-- vantage: oq id=OQ-PL3 leaning="Acceptable — GitHub keeps the order and the reasons, which are the judged part, and the derived part is one click away." -->

   _Leaning:_ Acceptable. This is a preference.

   **Answer:**
   > _(empty — fill in when decided)_

4. 💬 **OQ-PL4: How does the agent get answers filed on the planning page?** The clipboard
   handoff covers one document at a time today, and a single sitting on this page can answer
   questions in several documents.

   - **A — One combined payload.** A **Copy answers** button on the page copies every pending
     answer, grouped by document. Agent replies already name their `path`, so the reply side
     needs nothing new.
   - **B — Per document.** Each document's own Copy stays the only route. Nothing new is built,
     but three answered documents means three trips.

   <!-- vantage: oq id=OQ-PL4 leaning="A — one Copy answers button on the planning page, grouped by document; replies already carry their path." -->

   _Leaning:_ A.

   **Answer:**
   > _(empty — fill in when decided)_

## Decision Ledger

| ID | Ruling / Decision | Date | Settled in | Built |
| :--- | :--- | :--- | :--- | :--- |
| — | Build it: a planning index in Vantage, following the brainstorm's direction ([`OQ-PI1`](../brainstorm/planning-index.md#decision-ledger)) | 2026-09-28 | [§1](#1-verdict-and-the-principles) | — |
| — | **Open document** from the planning page lands at the top of the document, not at the question | 2026-09-28 | [§6.3](#63-a-question-on-the-page) | — |
