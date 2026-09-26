---
title: "Brainstorm — a planning index: what Vantage could derive from a repository's design docs"
author: "Matt Schulkind"
date: 2026-09-25
status: draft
tags: [brainstorm, planning, roadmap, vantage-check, viewer]
summary: "Whether Vantage should read a repository's design docs as a set — their status and their open questions — and which of the ways it could do that are worth building."
---

# A planning index: what Vantage could derive from a repository's design docs

**Status:** SKETCH, 2026-09-25 — undecided, including whether any of it belongs
in Vantage at all.

**In short.** Vantage already reads the planning conventions one document at a
time: a `status:` chip, a one-click button on each `oq` directive, and the open
questions in the contents column with a tally. It never reads them *across*
documents. That cross-document picture is what `roadmap.md` and a weekly doc keep
trying to maintain by hand, and they keep going stale. The idea here is to let
Vantage **derive** the half that can be derived, so that the hand-written roadmap
only has to hold judgment.

**Needs your ruling:** [OQ-PI1](#OQ-PI1), [OQ-PI2](#OQ-PI2),
[OQ-PI3](#OQ-PI3).

## Terms

- **Planning index** *(coined here)* — the table that can be computed from a
  repository's documents without asking anyone: for each document, its
  frontmatter status and the ids and leanings of its live open questions.
- **Derived** and **judged** *(coined here)* — a derived fact can be recomputed
  from the tree (*"`agent-bootstrap.md` has five live questions"*). A judged fact
  needs someone to decide it (*"rule [`OQ-CT1`](../design/color-themes.md#decision-ledger) first"*). The whole brainstorm
  turns on keeping the two apart.
- **Live open question** — an `oq` directive that is still in the document.
  Once a question is answered and compacted, its directive is deleted (see
  `design-doc`'s compaction rules), so a live question is simply a directive
  that is still present.

## Why this keeps turning into a mess, measured on this repository

On 2026-09-25 this repository had 12 docs under `docs/design/` and one
`roadmap.md`:

| Finding | Evidence | Kind of failure |
| --- | --- | --- |
| A design with five live questions has no roadmap row | [`agent-bootstrap.md`](../design/agent-bootstrap.md): `status: in-review`, 5 `oq` directives; `roadmap.md` never names it | derived fact, maintained by hand, never maintained |
| A live question in a doc the roadmap *does* track is missing from it | [`color-themes.md`](../design/color-themes.md) [`OQ-CT6`](../design/color-themes.md#OQ-CT6) is live; the roadmap cites only [`OQ-CT1`](../design/color-themes.md#decision-ledger) and [`OQ-CT2`](../design/color-themes.md#decision-ledger), both ruled | same |
| Status words drift | 4 of 12 docs have no `**Status:**` line; 4 more use `IMPLEMENTED`, `DESIGNED`, `PROTOTYPE` or `DESIGN SKETCH`, none of which is in the `design-doc` skill's seven words | a vocabulary nothing enforces |
| The obvious count is wrong | `rg -c 💬` finds 4 in [`contents-open-questions.md`](../design/contents-open-questions.md), which has none live, and `rg 'oq id='` matches one inside a Mermaid block in [`linked-references.md`](../design/linked-references.md) | derivation done with grep instead of the parser |
| Most questions in the repository are demos | [`docs/gallery/`](../gallery/README.md) holds 11 `oq` directives, against 6 real ones | *which files count* is itself a decision |

Every row above is a **derived** fact that someone was supposed to keep up to date
by hand. None of them is a failure of judgment. That is the argument for this
brainstorm in one line: the parts of the roadmap that rot are exactly the parts a
program could compute.

## Axioms

Every idea below is checked against these.

1. **Build only on the markup that already has a fixed meaning in Vantage.** Two
   things qualify: frontmatter `status:` (one of Vantage's four values — draft,
   in-review, accepted, deprecated) and the `oq` directive. Heading text comes
   third. The prose `**Status:**` line, the roadmap's tables, and "Rule these
   first" do not qualify, because every repository spells them differently, and
   this one doesn't spell them the same way twice. Reading them generically would
   be a mechanism with nothing behind it.
2. **One parser.** Directives are parsed in TypeScript, in `vantage-md`
   ([`AGENTS.md`](../../AGENTS.md)). If the Go server counted questions, that
   would be a second implementation, and that is a design change. So any
   aggregation runs in the checker or in the browser.
3. **Derive; never ask a person to keep a derived number.** If a number can be
   computed, it is computed where it is shown, not stored in a file.
4. **Vantage does not judge.** Priority, intent ("this week we're doing X") and
   the Rule-these-first order stay in the hand-written roadmap. Vantage can make
   that file shorter, but it doesn't write it.
5. **Someone else's conventions plug in through `.vantage.toml` and nothing
   else.** The Matcraft skills are one set of conventions. Anything specific to
   them, like the seven-word status line, is opt-in configuration and never
   hard-coded.

**The constraint that decides what to build** is a budget: *not super heavy*,
taken to mean a first version of roughly a week of work, or about 1,000 lines of
code plus tests. Parsing is cheap. The checker spends about 9 ms per file parsing
([`check-performance.md`](../design/check-performance.md)), and a file without the
`vantage:` sentinel can be skipped before it is parsed. So all 12 of this repo's
design docs can be scanned in about 100 ms. The budget goes on UI and tests, not
on computation.

## Overview

| # | Idea | Reads | Est. cost | Verdict |
| --- | --- | --- | --- | --- |
| 1 | `vantage-check index`: the planning index as text or JSON | status, `oq` | ~250 LOC | **Build first** |
| 2 | A per-project **Open questions** page, answerable in place | status, `oq` | ~450 LOC | **Build second**. This is the reason it belongs in Vantage |
| 3 | Status chip and question count in the file tree | status, `oq` | ~150 LOC on top of #2 | Ride along with #2 |
| 4 | A generated index block inside `roadmap.md`, checked for staleness | #1's output | ~300 LOC | Wait. Decide after #1 ships |
| 5 | "This week": what moved in the planning tree since a date | git history, #1 | ~600 LOC | Parked |
| 6 | Status-line vocabulary rules, opt-in by config | prose status line | ~200 LOC | Worth it. The slot where Matcraft plugs in |
| 7 | Vantage owns the roadmap: priority, tasks, a board | — | — | **Retired**. Breaks axiom 4 |

## 1. `vantage-check index`

**Hook.** `vantage-check index docs/design` prints one row per document: path,
frontmatter status, and each live question's id and leaning. With `--format json`
it prints the same data for an agent to consume.

**Turn.** The command the `roadmap` skill's reconcile step asks for already has a
name: *"count live questions per doc, mechanically; put the command in the
file."* Today that command is a grep, and on this repository the grep is wrong
(see [the evidence table](#why-this-keeps-turning-into-a-mess-measured-on-this-repository)).
This gives the step a command that agrees with the viewer, because it is the
viewer's own parser.

| Part | Does | Reuses |
| --- | --- | --- |
| Discovery | Walks paths, honors `.vantage.toml` excludes | `core/discover.ts` |
| Question scan | Live `oq` ids and leanings | `core/openQuestions.ts` (`collectOqIds`, extended to return the leaning) |
| Status | Frontmatter `status:` | `rules/frontmatter.ts`'s parse |
| Report | Text table, or JSON | `report/` |

**Why it is generic.** It reads only what axiom 1 allows. A repository that
never heard of the Matcraft skills, but uses `oq` directives because the style
guide tells it to, gets the same report.

**Cost.** Command, about 120 lines. Leaning extraction, about 20. Two report
formats, about 60. Tests, about 150. Total **~250 LOC plus tests: one sitting.**

> [!NOTE]
> **Displaces** the roadmap's hand-typed counts (`**Status:** 3 ready · 1
> blocked`), along with every "Live" column the `roadmap` skill tells an agent to
> re-derive. The agent still re-derives them, but by running one command.

## 2. A per-project Open questions page

**Hook.** One page per project lists every live open question in the repository,
grouped by document, with the doc's status chip. Each question has the same
**Take this leaning** button review mode shows today, plus a box for a different
answer.

**Turn.** This is where the idea has to belong in Vantage, or nowhere. Answering
a question already means filing a review comment, and the review inbox is how
the agent finds out ([`review-mode.md`](../design/review-mode.md)). No other tool
has that path back to the agent. Today you have to open each document, turn on
review mode for it, and scroll. This page is review mode at the scope of the
whole repository, and it adds no new way of answering.

| Part | Does |
| --- | --- |
| Scan | Browser fetches the Markdown under the configured roots, skips files without the sentinel, parses the rest. The same code as #1, from `vantage-md` |
| Page | New route beside Recents; groups by doc, sorts by doc status then question count |
| Answer | Files the comment against the question's anchor in *its* document, exactly as the in-page button does |
| Entry | A Starred-style link, plus a key in the shortcuts help |

**Failure handling.** If a document changes after it was scanned, the anchor
still resolves, because the id is the anchor. If the question has since been
compacted away, the comment lands as outdated, the same as for an in-page comment
whose block disappeared. There is no special case to handle.

> [!IMPORTANT]
> **The way this goes bad is turning into an inbox with its own state:** snooze,
> assign, "seen". The moment the page stores anything, it can disagree with the
> documents. It must stay a pure view of the tree plus the existing review
> comments.

**Cost.** Scan hook, about 80 lines. Page and grouping, about 200. Wiring the
answer to the existing comment call, about 50. Route, entry and shortcut, about
40. Tests, about 200. Total **~450 LOC plus tests.** An open risk: a large
repository with no roots configured. See [OQ-PI2](#OQ-PI2).

> [!NOTE]
> **Adds.** Nothing today lets a reader answer across documents, so it replaces
> nothing. It does make [#1](#1-vantage-check-index)'s JSON unnecessary *for
> people*, though agents still need it.

## 3. Status in the file tree

**Hook.** In the file tree, a design doc gets its status chip, plus `💬 5` when it
has live questions.

**Turn.** This costs almost nothing once #2's scan exists, and it answers *"is
there something here for me?"* before a single file is opened. That question is
the one [`contents-open-questions.md`](../design/contents-open-questions.md)
answers inside a document.

**Cost.** About 150 LOC on top of #2. On its own it would need the whole scan,
which is why it isn't a standalone idea.

> [!NOTE]
> **Adds** to #2. Build them together or not at all.

## 4. A generated index block in `roadmap.md`

**Hook.** `vantage-check index --write roadmap.md` rewrites the table between two
markers. A rule, `index/stale`, fails the gate when the table no longer matches
the tree.

**Turn.** This keeps the derived half **visible on GitHub**, where a
Vantage-only directive would render nothing. It also makes staleness a gate
failure instead of something a person has to notice.

**What won't work:** rendering the table live with a directive (`<!-- vantage:
index -->`). The roadmap is the one file people read on GitHub, and there the
directive is an empty comment. That variant is retired.

**Cost.** About 300 LOC for the writer, the marker handling and the rule. The
real cost is that a generator now writes a tracked file. That's allowed, since
the rule in [`AGENTS.md`](../../AGENTS.md) is about `just` recipes, but it's a
new kind of thing in this repository.

> [!NOTE]
> **Might displace** the `roadmap` skill's step 1 entirely. Only decide after #1
> has been used for a few reconciles. See [OQ-PI3](#OQ-PI3).

## 5. "This week"

**Hook.** A view of what changed in the planning tree since a date: questions
opened and answered (directives that appeared or disappeared), status changes,
new docs.

**Turn.** It replaces the *derived half* of a weekly doc. The other half, what
you *meant* to do this week, is judged (axiom 4), and no view can supply it.

**Why it's parked.** It needs files as of past revisions, parsed. `HistoryPage`
can already fetch a revision, but scanning N revisions of M files is the first
idea here whose computation costs more than its UI. About 600 LOC, which is most
of the budget. Revisit only if #2 is used and the weekly doc still keeps coming
back.

## 6. Status-line vocabulary rules, opt-in by config

**Hook.** `[planning] status-line = ["SKETCH", "DESIGN", …]` in `.vantage.toml`
turns on checker rules that do what `design-doc`'s `status-lines.sh` does:
report a doc with no status line, a word outside the vocabulary, or a `BUILT` doc
with no live questions that should graduate.

**Turn.** **This is the slot axiom 5 promises.** The Matcraft skills bring a
vocabulary, the repository declares it, and the checker enforces it. Someone else
declares a different list. Nothing Matcraft-specific ships turned on.

**Cost.** About 200 LOC plus tests. It would have caught this repo's four
off-vocabulary status lines and its four missing ones on the day each was
written.

> [!NOTE]
> **Displaces** the skill's copy of `status-lines.sh`, which the skill itself
> says rots once it lives in a document instead of in a check.

## 7. Vantage owns the roadmap — retired

A board, a priority order, task state. **Retired, because it breaks axiom 4.**
Every item on it would be a judged fact stored in a second place, which is
exactly the staleness this brainstorm exists to get rid of, moved into a
database. Keep it written down so it doesn't get proposed again.

## If you want my pick

Build **#1 now.** It's one sitting, it fixes a reconcile step that is currently
wrong, and it proves the scan is cheap. Then **#2 with #3**: they answer *"does
this belong in Vantage?"* with yes, because answering across documents only works
where the review inbox lives. Do **#6** whenever the status lines next annoy you.
Leave #4 and #5 until #1 has been in use for a while.

What stays by hand: `roadmap.md` shrinks to the Rule-these-first order and the
rows that have no doc. That's the judged half, and it's small.

## Open Questions

1. 💬 **OQ-PI1: Does the cross-document question page (#2) belong in Vantage?**
   This decides whether Vantage grows any repository-wide view of documents, or
   stops at #1 and #6, which live in the checker.

   <!-- vantage: oq id=OQ-PI1 leaning="Yes — answering questions across documents rides on the review inbox, which only Vantage has; build #1 first, then #2 with the file-tree status (#3)." -->

   _Leaning:_ Yes. It adds no new way of answering, only a wider scope for the
   existing one.

   **Answer:**
   > _(empty — fill in when decided)_

2. 💬 **OQ-PI2: Which files make up the planning tree?** Scanning every Markdown
   file needs no configuration, but on this repository 11 of 17 questions are
   gallery demos. Roots declared in `.vantage.toml` mean nothing gets scanned
   until someone writes that config.

   <!-- vantage: oq id=OQ-PI2 leaning="Default to every file carrying an oq directive, with an exclude list in .vantage.toml — zero config for other repositories, and this one excludes docs/gallery." -->

   _Leaning:_ Scan everything by default, with an exclude list. Other
   repositories need no configuration, and this one pays one line.

   **Answer:**
   > _(empty — fill in when decided)_

3. 💬 🤷 **OQ-PI3: Should the derived index ever be written *into*
   `roadmap.md` (#4)?** A generated block is visible on GitHub and can be
   checked for staleness. The cost is a generator that writes a tracked file.

   <!-- vantage: oq id=OQ-PI3 leaning="Not yet — ship #1, use it for a few reconciles, and decide from whether the hand-typed counts still drift." -->

   _Leaning:_ Not yet. Decide from experience with #1.

   **Answer:**
   > _(empty — fill in when decided)_

## Open threads

- **Untested assumption: the browser can scan a large repository fast enough.**
  About 9 ms per parsed file comes from the checker running on Bun. A browser
  also has to fetch each file. On a 750-file repository, the sentinel pre-filter
  is what saves it, and nobody has measured how many files it actually skips
  there.
- **Found here and not fixed:** `agent-bootstrap.md` and [`OQ-CT6`](../design/color-themes.md#OQ-CT6) have no roadmap
  row, and eight design docs carry missing or off-vocabulary status lines. Those
  are roadmap and `design-doc` reconcile work, not part of this brainstorm.
- **Not yet considered:** documents from more than one project on the same page.
  Recents already works across projects (`Shift+R`), and nobody has asked whether
  a question queue should too.
