---
title: "Brainstorm — a planning index: write each fact once, and let Vantage show it everywhere it is referenced"
author: "Matt Schulkind"
date: 2026-09-25
status: accepted
stage: SUPERSEDED
tags: [brainstorm, planning, roadmap, vantage-check, viewer]
summary: "Every planning fact gets one home: a document's own frontmatter, its `oq` directives, or an ordered list of links. Vantage decorates links with the current state of what they point at, and builds index pages from them, so nobody hand-copies state and no agent has to re-gather it."
---

# A planning index: write each fact once, and let Vantage show it wherever it is referenced

**Status:** SUPERSEDED, 2026-09-28, by the planning-index design, since built and
graduated into the reference [`planning-index.md`](../reference/planning-index.md).
Ideas #5 and #11 are still candidates here, and the retired ideas stay listed with
their reasons.

**In short.** A roadmap goes stale because it **copies** each design doc's state
into another file: the doc's status, how many questions it has open, which one to
rule first. The weekly doc copies the roadmap in turn. The fix proposed here is to
stop copying. Every fact is written in one place — a design doc's **frontmatter**,
its **`oq` directives**, or, for priority alone, an **ordered list of links** in
`roadmap.md`. Every other mention of the fact is a plain Markdown link to that
place. Vantage then shows the target's *current* state beside each link, and
builds index pages from the links. On GitHub, all of it reads as ordinary links
and frontmatter tables.

**Needs your ruling:** None. The live questions moved to the design doc.

## Terms

All of these were coined here except the last.

- **Home** — the single place a fact is written. Anything else that wants the
  fact links to its home.
- **Derived** and **judged** — a derived fact can be recomputed from the tree
  (*"`agent-bootstrap.md` has five live questions"*). A judged fact needs
  someone to decide it (*"rule [`OQ-CT1`](../design/color-themes.md#decision-ledger)
  first"*). Derived facts are always computed. Judged facts are written once, at
  their home.
- **Planning index** — the model Vantage builds by reading every document in the
  planning tree: each doc's frontmatter, its live questions, and every link
  between docs. Each idea below is a different view of this one model.
- **Live link** — an ordinary Markdown link that Vantage renders with a small
  display of the target's current state. The display is computed; nothing is
  written into the source. See [#9](#9-live-links).
- **Live open question** — an `oq` directive still present in its document.
  Compaction (`design-doc` skill) deletes the directive once a question is
  answered, so "live" means "the directive is still there."

## The line: decorate and index, never generate

The rule that answers *"how far can this go"*:

| Vantage may… | Example | Why it's safe |
| --- | --- | --- |
| **Decorate** what the author wrote | a `💬 5` chip beside a link to a doc | The source is unchanged. GitHub shows the same link without the chip |
| **Index**: build pages outside the documents | an Open questions page | The page isn't a document, so there's nothing for it to disagree with |
| ~~**Generate** content into a document~~ | a computed table, transclusion, a template language | A computed table has to be regenerated, is invisible on GitHub, or both. This is where Markdown stops being Markdown |

Everything below stays within the first two rows. [#4](#4-a-generated-index-block-in-roadmapmd--displaced)
and [#12](#12-transclusion-and-templates--retired) are the ideas that crossed
into the third, and they are marked as such.

## Why this keeps turning into a mess, measured on this repository

On 2026-09-25 this repository had 12 docs under `docs/design/`:

| Finding | Evidence | What it copied |
| --- | --- | --- |
| A design with five live questions has no roadmap row | [`agent-bootstrap.md`](../design/agent-bootstrap.md): `status: in-review`, 5 `oq` directives; `roadmap.md` never names it | a doc's existence and question count, never copied at all |
| A live question is missing from the roadmap | [`OQ-CT6`](../design/color-themes.md#OQ-CT6) is live; the roadmap cites only [`OQ-CT1`](../design/color-themes.md#decision-ledger) and [`OQ-CT2`](../design/color-themes.md#decision-ledger), both ruled | the question list, copied once and never again |
| Status is written twice and the two copies disagree | 4 of 12 docs have no `**Status:**` line; 4 more use words outside the `design-doc` skill's seven; frontmatter `status:` is on 8 | the doc's stage, copied from frontmatter into prose and then from prose into the roadmap |
| Counting with grep gets the wrong answer | `rg -c 💬` finds 4 in [`contents-open-questions.md`](../design/contents-open-questions.md), which has none live; `rg 'oq id='` matches one inside a Mermaid block in [`linked-references.md`](../design/linked-references.md) | a count, made with the wrong tool |
| Most questions in the repository are demos | [`docs/gallery/`](../gallery/README.md) holds 11 `oq` directives, against 6 real ones | *which files count* is itself a decision |

Every failure is a copy that went stale. None is a wrong judgment.

## Axioms

1. **Build on markup that has a fixed meaning.** That means frontmatter keys, the
   `oq` directive, and links. Frontmatter counts as standard: GitHub renders it
   as a table at the top of the file. This was checked against this repository's
   `repo-config.md` on 2026-09-26, where the nested `vantage:` block showed up in
   the table. Prose conventions — the `**Status:**` line, roadmap tables — don't
   qualify.
2. **One parser.** Directives and links are parsed in TypeScript, by
   `vantage-md` ([`AGENTS.md`](../../AGENTS.md)). The Go server may answer git
   questions but never parses Markdown.
3. **Every fact has one home.** A derived fact's home is the tree, so it's
   computed wherever it is shown. A judged fact's home is the one place it is
   written, and everywhere else links to it.
4. **Decorate and index, never generate.** See [the line](#the-line-decorate-and-index-never-generate).
5. **Priority is the only judged fact the roadmap owns.** Everything else on a
   roadmap row belongs to the linked doc.
6. **Someone else's conventions plug in through `.vantage.toml`.** The Matcraft
   vocabulary, such as the seven stage words, is configuration. It is never
   hard-coded.
7. **Agents see what the human sees.** Every view has a `vantage-check` output
   that computes the same model. Otherwise agents go back to grepping, and the
   grep is wrong.

**Budget.** *Not super heavy*, taken to mean a first version of about a week, or
roughly 1,000 LOC plus tests. The whole program, [#1](#1-vantage-check-index)
through [#11](#11-freshness-of-reference-docs), is about 2,400 LOC, roughly two
and a half weeks. So it ships in phases (see [the pick](#if-you-want-my-pick)),
and phase 1 fits the budget.

## What it looks like to use

A Monday on this repository, once phases 1 and 2 have shipped. Screens are
sketches, not specifications. The `g p` shortcut is proposed here; it's free
today and matches `g h` and `g r`.

### What you write

The roadmap file is ordered lists of links. That's the entire file:

```markdown
# Roadmap

## Rule these first

1. [OQ-B2](docs/design/agent-bootstrap.md#OQ-B2) — the install step waits on it
2. [OQ-CT6](docs/design/color-themes.md#OQ-CT6) — repository themes can't load until it's ruled

## Building

- [color-themes](docs/design/color-themes.md) — semantic tokens, one area per PR

## This week

- [color-themes](docs/design/color-themes.md)
- [OQ-B2](docs/design/agent-bootstrap.md#OQ-B2)
```

A design doc's header gains two keys, `stage` and `next`. The rest of the doc is
unchanged.

### Opening the roadmap

Vantage renders the same file with each link's current state beside it:

```text
Rule these first
  1. OQ-B2  💬 open · agent-bootstrap · DESIGN     — the install step waits on it
  2. OQ-CT6  ✅ ruled                                — repository themes can't load…
             └ answered since this was written; remove the entry?

Building
  • color-themes  in-review · PROTOTYPE · 💬 0       — semantic tokens, one area per PR

This week
  • color-themes  in-review · PROTOTYPE · 💬 0
  • OQ-B2  💬 open
```

Entry 2 shows at a glance that it's stale. Nobody had to reconcile anything to
find that out. Removing the entry is still your edit to make.

### The planning page (`g p`)

```text
┌ vantage · planning ─────────────────────────────────────────────────┐
│ Needs you (2)                               in roadmap order        │
│   OQ-B2  agent-bootstrap · The payload's install step              │
│           Leaning: install into AGENTS.md, never overwrite …        │
│           [ Take this leaning ]  [ Answer… ]                        │
│   OQ-CT6  color-themes · Repository-supplied themes                 │
│           [ Take this leaning ]  [ Answer… ]                        │
│                                                                     │
│ Unrouted (4)                 live, and nothing on the roadmap links │
│   OQ-B1 · OQ-B3 · OQ-B4 · OQ-B5    agent-bootstrap              │
│                                                                     │
│ Ready (1)        accepted, no open questions, not built             │
│   repo-config    DESIGNED                                           │
│                                                                     │
│ Graduate (2)     built, no open questions: hand to system-doc       │
│   check-performance · linked-references                             │
│                                                                     │
│ Stale references (1)                                                │
│   inline-markup.md   ⚠ 4 covered files changed since 3134838        │
└─────────────────────────────────────────────────────────────────────┘
```

Clicking **Take this leaning** files an ordinary review comment on that
question, in its own document. It's the same thing the in-page button does. The
agent picks it up from the review inbox, writes the ruling in, and compacts the
question. On your next visit, that question has left **Needs you**, and its
roadmap entry shows `✅`.

### Inside a design doc

```text
agent-bootstrap.md                         in-review · DESIGN · 💬 5
  next: Rule OQ-B2 — the payload's install step waits on it
  depends on: pypi-distribution  accepted · DECIDED · 💬 0
  Referenced by: roadmap.md (Rule these first #1) · agent-cli.md
```

The contents column keeps its question list and tally, which exist today.

### In the file tree

```text
docs/design/
  agent-bootstrap.md     DESIGN   💬 5
  color-themes.md        PROTOTYPE
  repo-config.md         DESIGNED
```

### What an agent sees

```text
$ vantage-check index
roadmap.md
  Rule these first
    1. OQ-B2   open    agent-bootstrap (in-review, DESIGN)
    2. OQ-CT6   ruled   ← stale entry
unrouted: OQ-B1 OQ-B3 OQ-B4 OQ-B5 (agent-bootstrap.md)
ready: repo-config.md
graduate: check-performance.md linked-references.md
stale-reference: docs/reference/inline-markup.md (4 files since 3134838)
```

This is the same model as the planning page. `--format json` gives the
machine-readable version. The `roadmap` skill's reconcile step becomes: run
this, then edit the lists.

### On GitHub

`roadmap.md` shows as numbered lists of links, each with its clause. That keeps
the order and the reasons, which are the parts you decided. Clicking a link
opens a doc whose frontmatter table shows `stage` and `next`. The live counts
are the only thing GitHub doesn't show ([OQ-PI5](#decision-ledger)).

### What doesn't change

You still decide the order, still write the reason for each entry, and still
delete an entry once it's done. Vantage never edits a file. It only tells you
which entries have gone stale.

## Overview

| # | Idea | Home it reads | Est. LOC | Verdict |
| --- | --- | --- | --- | --- |
| 1 | `vantage-check index`: the planning index as text or JSON | all | ~300 | **Phase 1**: it's the engine |
| 2 | The planning page: Needs you, Ready, Waiting, Unrouted, Stale | all | ~500 | **Phase 2** |
| 3 | Status chip and question count in the file tree | frontmatter, `oq` | ~150 | Phase 2, together with #2 |
| 4 | A generated index block in `roadmap.md` | — | — | **Displaced** by #9 |
| 5 | "This week": a hand-written list of links, plus a derived "what moved" | links, git | ~400 | Phase 3 |
| 6 | Stage vocabulary rules | — | — | **Folded into #8** |
| 7 | Vantage owns the roadmap: board, tasks | — | — | **Retired** by axiom 5 |
| 8 | Frontmatter is the doc's header of record | frontmatter | ~200 | **Phase 1** |
| 9 | Live links | the link target | ~350 | **Phase 1**: the core of it |
| 10 | Backlinks, and questions nothing links to | links | ~250 | Phase 2 |
| 11 | Freshness of reference docs: `covers:` versus git | frontmatter, git | ~250 | Phase 3 |
| 12 | Transclusion and templates | — | — | **Retired**: it generates |

## 8. Frontmatter is the doc's header of record

**Hook.** The facts a roadmap copies out of a design doc move into that doc's
frontmatter, and nowhere else:

```yaml
status: in-review        # Vantage's four, as today
stage: DESIGN            # the owed word; vocabulary declared in .vantage.toml
next: "Rule OQ-B2 — the payload's install step waits on it"
depends-on:
  - pypi-distribution.md
```

**Turn.** Today the doc's stage is written twice: frontmatter `status:` and the
prose `**Status:**` line. The evidence table shows the two copies disagreeing.
This gives the stage one home, where a program can read it and GitHub still
displays it. The prose line stays for the *why* ("amended on the 1st, because
one section was wrong"), but it no longer carries the word.

| Key | Derived or judged | Displaces |
| --- | --- | --- |
| `status` | judged | nothing; it exists today |
| `stage` | judged, from a closed list in `.vantage.toml` | the first word of the prose status line; `status-lines.sh`'s `BADWORD` and `NOSTATUS` |
| `next` | judged, one line | the roadmap row's "Decides" clause |
| `depends-on` | judged | the roadmap's 🔒 "blocked on" prose |
| *(not a key)* live questions | **derived** | the "Needs your ruling" line, and every "Live" count |

**What won't work:** a `priority:` key. Priorities written separately into each
doc can't be compared across docs. Two docs both say `1`, and there's no single
place to reorder them. Priority is relative, so it needs one list (axiom 5,
[#9](#9-live-links)).

> [!IMPORTANT]
> **This is where it can go bad: the header grows into a form.** Every key added
> is one more thing to keep true. The test for a new key: would the roadmap
> otherwise copy it? If not, it stays in the prose.

**Cost.** Known keys plus a vocabulary check in the checker (this absorbs #6),
~200 LOC. It also changes the Matcraft skills: `design-doc` would write `stage:`
and `next:`, and stop hand-maintaining the "Needs your ruling" line. See
[OQ-PI4](#decision-ledger).

## 9. Live links

**Hook.** Any link to a document or to an open question renders in Vantage with
the target's current state:

| Written | Rendered in Vantage | On GitHub |
| --- | --- | --- |
| `[agent-bootstrap](docs/design/agent-bootstrap.md)` | agent-bootstrap `in-review · DESIGN · 💬 5` | the link |
| a link to [`OQ-CT6`](../design/color-themes.md#OQ-CT6), a live question | the link, then `💬 open` | the link |
| a link to a question since compacted into its ledger | the link, then `✅ ruled`, or `⚠ gone` if the id is found nowhere | the link; `vantage-check` flags the dead anchor as it does today |

**Turn.** This is what makes the roadmap stop lying without making it stop being
Markdown. A roadmap row shrinks to its judged part — the position in the list and
a clause saying why now — plus a link:

```markdown
## Rule these first

1. [OQ-B2](docs/design/agent-bootstrap.md#OQ-B2) — the install step is built and waiting on it
2. [OQ-CT6](docs/design/color-themes.md#OQ-CT6) — repository themes can't load until it's ruled
```

The doc, its status, its live count and the gate are all shown next to the link,
not written. A row whose question has been answered **shows `✅` in its own
chip**. That's the stale row the `roadmap` skill's reconcile step hunts for, and
here it's visible without running anything.

| Part | Does |
| --- | --- |
| Target resolution | The same resolution the link checker already does |
| Facts | Frontmatter and live questions of the target, from the planning index |
| Chip | A small appended badge, printed as text and dropped when the target has nothing to show |
| Checker | `vantage-check index` prints the roadmap with the same chips inline as text, so an agent reads exactly what you see (axiom 7) |

**Failure handling.** If the target can't be fetched, there's no chip and the
link works as it always did. If a question has been compacted into a Decision
Ledger, the chip reads `✅ ruled`, because its id appears in the ledger. If the id
is found nowhere, the chip reads `⚠ gone`. So decoration can only add
information.

> [!IMPORTANT]
> **Only for links to planning targets.** A chip on every link in every document
> is noise. The chip appears when the target has a planning fact: a `status:`, a
> `stage:`, or a live question.

**Cost.** Chip rendering in the viewer, ~150 LOC; planning-index lookups
client-side, ~100; the text rendering in the checker, ~100. **~350 LOC.**

> [!NOTE]
> **Displaces #4** (the generated block) completely: the same information, with
> nothing written into the file and nothing to regenerate. It also displaces
> most of what the `roadmap` skill's reconcile procedure exists to do.

## 10. Backlinks, and questions nothing links to

**Hook.** A doc's contents column gets a **Referenced by** list: *roadmap.md,
Rule these first #1 · agent-cli.md section 6*. The planning page (#2) gets an
**Unrouted** section: live questions that no roadmap entry links to.

**Turn.** Unrouted is the `roadmap` skill's step 7 ("find docs carrying live
questions that no row names"), made permanent. On this repository it would have
listed `agent-bootstrap.md`'s five questions and [`OQ-CT6`](../design/color-themes.md#OQ-CT6) on the day each was
written.

**Cost.** ~250 LOC. The real cost is computation: backlinks need every link in
every document, and links can't be skipped with the sentinel check the way
directives can. See the first [open thread](#open-threads).

## 2. The planning page

**Hook.** One page per project, composed entirely from the planning index:

| Section | Derived as |
| --- | --- |
| **Needs you** 💬 | Live questions linked from `roadmap.md`, in the roadmap's order, each with **Take this leaning** and an answer box |
| **Unrouted** | Live questions no roadmap entry links to (#10) |
| **Ready** 📦 | `status: accepted`, zero live questions, a stage that isn't built yet |
| **Waiting** 🔒 | 🔒 questions, and docs whose `depends-on` target has live questions |
| **Graduate** | Stage `BUILT` with zero live questions (the `system-doc` cue) |
| **Stale references** | #11 |

**Turn.** Answering a question files a review comment, which already goes to
the agent through the review inbox ([`review-mode.md`](../design/review-mode.md)).
So this page is review mode across the whole repo, and it adds no new way of
answering. That's the strongest reason it belongs in Vantage. No other tool has
the path back to the agent.

> [!IMPORTANT]
> **The page stores nothing.** No snooze, no assign, no "seen." Anything it
> stored could disagree with the documents, which would recreate the roadmap's
> problem one level up.

**Cost.** ~500 LOC. Most of that is the page itself; the answer path reuses the
existing comment call.

## 3. Status in the file tree

The status chip and `💬 N` on each file in the tree, taken from the planning
index. ~150 LOC. It depends on #2's index, so it ships together with #2.

## 5. "This week"

**Hook.** No weekly file. `roadmap.md` gets a `## This week` heading containing
a list of links: the intent, which is judged, written once. The planning page
adds a derived **Moved since Monday** panel: questions opened and answered,
stage changes, new docs.

**Turn.** This splits the weekly doc into its two halves. The intent half is
judged, so it's links, and live links keep it honest. The history half is
derived from git. `git log -G 'vantage: oq'` finds only the commits that touched
directives, so the TypeScript parser only has to run on those revisions.

**Cost.** ~400 LOC, mostly the history scan. Phase 3.

## 11. Freshness of reference docs

**Hook.** A system doc already declares `covers:` (the source paths it
describes) and `verified_commit:`. [`inline-markup.md`](../reference/inline-markup.md)
does this today, and the `system-doc` skill calls it what "turns *is this doc
stale?* … into a command." Vantage runs that command itself. `git diff --stat
<verified_commit>..HEAD -- <covers>` becomes a chip: `⚠ 4 covered files changed
since verified`.

**Turn.** It's the same idea pointed at reference docs: a fact, the perimeter,
written once, and a staleness state derived from it. The Go server answers the
git question and never parses the Markdown, which keeps axiom 2.

**Cost.** ~250 LOC. Phase 3, because only one doc in this repository declares
`covers:`.

## 1. `vantage-check index`

**Hook.** The engine. It builds the planning index from the files — frontmatter,
live questions and their leanings, and links between planning docs — and prints
it as text or JSON. The viewer builds the same model from the same `vantage-md`
code.

**Turn.** The `roadmap` skill's reconcile step becomes one command, and it agrees
with the viewer by construction. Its text output includes the roadmap with live
links resolved (#9), so an agent reads what you read.

**Cost.** ~300 LOC, reusing `core/discover.ts`, `core/openQuestions.ts` and the
frontmatter parse.

## 4. A generated index block in `roadmap.md` — displaced

The checker would rewrite a table between markers in `roadmap.md`, and fail the
gate when it was stale. **Displaced by [#9](#9-live-links)**, which shows the
same information without writing anything. It was also the one idea here that
generated content into a document.

## 6. Stage vocabulary rules — folded into #8

Its checks become the vocabulary check on the `stage:` key.

## 7. Vantage owns the roadmap — retired

A board, tasks, a priority order kept in a database. **Retired by axiom 5**:
priority is the one fact whose home is a list in the roadmap, and a database
would be a second home.

## 12. Transclusion and templates — retired

Embedding one document's section in another (Obsidian-style `![[doc#heading]]`), or computing
values into the text. **Retired by axiom 4.** Transclusion isn't standard
Markdown, and a directive that does it is the template language you called too
far. A hover preview of a link target is the read-only version that stays on the
right side of the line. It's in the [parking lot](#parking-lot).

## If you want my pick

**Phase 1, which fits the budget: #1, #8, #9.** That's the index, the header of
record, and live links. At that point `roadmap.md` can be rewritten as ordered
lists of links with a clause each, every row shows its own truth, and an agent
reconciles by running one command. About 850 LOC.

**Phase 2: #2, #3 and #10.** The planning page, where you answer questions
across the repo, plus Unrouted, which ends the kind of miss that left
`agent-bootstrap.md` off the roadmap.

**Phase 3: #5 and #11,** once phases 1 and 2 are in daily use.

## Decision Ledger

The planning-index design took over this brainstorm's questions, and its rulings now
live in the reference's
[Why it's this way](../reference/planning-index.md#why-its-this-way). The ids below
still resolve here, so links to them keep working.

| ID | Ruling / Decision | Date | Settled in | Built |
| :--- | :--- | :--- | :--- | :--- |
| OQ-PI1 | Yes: the planning page belongs in Vantage. The user endorsed the vision and asked for a design doc | 2026-09-28 | [reference §1](../reference/planning-index.md#1-what-it-is-for-and-the-rules-it-keeps) | — |
| OQ-PI2 | Moved to the design as [`OQ-PL2`](../reference/planning-index.md#why-its-this-way), now in the reference | 2026-09-28 | — | — |
| OQ-PI3 | Retire the generated block (#4). Live links replace it, as part of the endorsed vision | 2026-09-28 | [reference §1.1](../reference/planning-index.md#11-principles) | — |
| OQ-PI4 | Moved to the design as [`OQ-PL1`](../reference/planning-index.md#why-its-this-way), now in the reference | 2026-09-28 | — | — |
| OQ-PI5 | Moved to the design as [`OQ-PL3`](../reference/planning-index.md#why-its-this-way), now in the reference | 2026-09-28 | — | — |

## Open threads

- **Untested assumption: the whole-repo scan is fast enough in a browser.** It's
  about 9 ms per parsed file in the checker, not counting fetch time. Backlinks
  (#10) can't skip files the way the directive scan can. On a 750-file repository
  that's several seconds, unless results are cached by git blob hash. The server
  can list those hashes cheaply with `git ls-files -s`. This hasn't been measured.
- **How a live chip recognizes a Decision Ledger** (`✅ ruled` versus
  `⚠ gone`). That needs the ledger's id column to be findable, and it's a
  convention table, which axiom 1 excludes. It might need a directive on the
  ledger, or the chip might just say "not open."
- **Found here and not fixed:** `agent-bootstrap.md` and [`OQ-CT6`](../design/color-themes.md#OQ-CT6) have no roadmap
  row, and eight design docs carry missing or off-vocabulary status lines. That's
  reconcile work, not part of this brainstorm.
- **Not considered yet:** planning pages across projects. Recents already works
  across projects (`Shift+R`).

## Parking lot

- Hover preview of a link target: its header and first paragraph, read-only.
- `depends-on` drawn as a Mermaid graph on the planning page, computed only
  there and never written into a doc.
- A **Decided this week** list taken from Decision Ledger rows, if the ledger
  becomes machine-findable (see the second open thread).
- A roadmap entry that links a whole doc, not a question, could show that doc's
  `next:` line as its clause. Then the "why now" wouldn't be written twice.
