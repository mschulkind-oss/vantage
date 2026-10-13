---
title: "See where work stands, not just which questions need answers"
date: 2026-10-12
status: draft
stage: SKETCH
next: "Compare the stage-column sketch with a real repository's documents before promoting this into a design"
tags: [brainstorm, planning, viewer]
summary: "A companion to the question-answering screen: documents grouped by stage, questions and dependencies visible on each card, and recent lifecycle changes kept separate from ordinary edits."
---

# See where work stands, not just which questions need answers

**Status:** 2026-10-12. Concept exploration grounded in the current planning
index; no interface built and no layout selected by the user.

> The current screen answers **what needs my decision?** The companion should
> answer **where does the work stand, and what happens next?**

## Options at a glance

Estimates below are rough implementation size, including tests, not measured
work or a delivery commitment. No owner-approved time budget exists yet.

| ID | Direction | Estimated added lines | Fit | Recommendation |
| --- | --- | --- | --- | --- |
| 1 | Stage columns with compact document cards | 600–1,000 | Strong overview; limited simultaneous detail | **First choice** |
| 2 | Grouped table with stage, questions, dependencies, next step | 450–750 | Strong comparison; weaker sense of flow | Narrow-screen presentation or fallback |
| 3 | Relationship graph as the main screen | 1,200–2,000 | Shows connections; poor stage census and reading order | Do not lead with this |

All three add to the existing decision workflow rather than replace it. The
history component is separate: another estimated 700–1,200 lines for bounded
revision retrieval, historical scanning, event comparison, and tests.

## What already exists, and what is missing

The [planning page](../reference/planning-index.md#6-the-planning-page) leads
with question cards under *Needs you*. Readiness and document maintenance live
under a folded *Maintenance* group. That is appropriate for answering questions,
but makes it hard to survey every live document without opening several groups.

The [index](../reference/planning-index.md#3-the-planning-index-what-it-reads-and-holds)
already has document paths, stages, next steps, questions, dependencies, and
links. It has **neither a document title nor transition timestamps**, and it
has no worker assignment or activity state. Pretty titles would need a deliberate
addition to the shared scan result, not a second full-document fetch per card.
A readable filename plus path is an honest initial label.

The repository maps its stages onto four
[roles](../reference/planning-index.md#34-the-header-of-record-stage-next-depends-on):
being decided, decided but not built, built, and no longer a live proposal.
Those roles are not four measures of implementation progress.

## Principles and governing constraints

1. **Files remain authoritative.** Zero new manually maintained stage or
   priority stores. This is another view of documents, not a task manager.
2. **Reuse one current index.** Zero additional whole-repository scans just to
   enter the companion screen. History is separate, lazy, and bounded.
3. **Stage and impediment are different facts.** A design can have both an open
   question and a dependency. Neither should make it disappear into a generic
   *Blocked* column.
4. **Do not imply an active worker.** A stage can describe unfinished work;
   it cannot prove an agent is running, a branch is active, or a test is passing.
5. **Bound the reading surface.** Start the layout experiment at ten cards per
   lane, with explicit paging and total counts. Test it with the existing
   [15–60-document scale fixtures](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured).
   Forty cards visible across four lanes is a proposal, not a proven optimum.
6. **Priority stays on its roadmap.** Never invent a global priority by merging
   separate roadmaps. A selected roadmap supplies order; a repository-wide view
   groups by stage and uses stable path order without claiming priority.

## 1. Stage columns: my recommendation

The familiar [Kanban board](https://www.atlassian.com/agile/kanban/boards)
mechanism is useful here: cards grouped by stage expose accumulated work and
make drill-down cheap. The portable part is the visual grouping, **not** dragging
cards to move work or maintaining a second task database.

**The turn:** one card represents one document, and its location comes from
that document's saved stage. Questions, pending answers, and dependencies are
independent annotations. The page observes the lifecycle rather than running it.

### A first sketch

Illustrative content and counts, not this repository's current state:

```text
Vantage / Work                 [Decisions] [Work]
Scope: [Whole repository v]     Filter: [                 ]

Active documents 18 · Need decisions 5 · Ready, unblocked 3

Exploring (4)     Designing (7)      Ready to build (4)   Built (3)
SKETCH            DESIGN             DECIDED             BUILT
┌──────────────┐  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ Search ideas │  │ Theme support  │ │ Export bundle  │ │ Link previews  │
│ Next: compare│  │ 3 open         │ │ No open Qs     │ │ Needs reference│
│ two options  │  │ 1 answer to    │ │ Waiting on     │ │ write-up       │
│              │  │ record         │ │ release policy │ │                │
│ Open doc     │  │ Questions →    │ │ Dependency →   │ │ Open doc       │
└──────────────┘  └────────────────┘ └────────────────┘ └────────────────┘

Needs classification: 2 unstaged documents · 1 unknown stage

Recent transitions                             [Past 7 days v]
  Link previews     DECIDED → BUILT             Open doc · Diff
  Answer publication  design → reference       Open reference · Diff
  Old export idea   retired, not completed      Open replacement · Diff
```

The four columns illustrate this repository's vocabulary, not a universal
pipeline. Other repositories retain their own stage words. Mapping words to
roles does not establish their sequence; column order needs an explicit design
when a repository has a different vocabulary. Unstaged and unknown-stage
planning documents remain visible in *Needs classification*.

### What belongs on a card

| Part | Purpose | Click behavior |
| --- | --- | --- |
| Document label and path | Identity; filename first until titles are supported | Open the document |
| Exact stage | Show the source's claim, even if inconsistent | Read its frontmatter in the document |
| Questions: open, blocked, answered | Distinguish a ruling needed from one waiting to be recorded | Open that document's questions on the Decisions screen |
| Answer waiting on the agent | Do not ask the user to answer twice | Reuse the existing review-aware question state |
| Next step | Explain what someone should do, from `next` | Follow an existing question link where available |
| Waiting dependencies | Explain why work cannot proceed yet | Open the named document or question |
| Stage conflict | Prevent a contradictory stage from looking clean | Open the unresolved questions |
| Related documents | Reach a plan, research, roadmap, or reference | Expand the card's existing document links |

Count cards as documents, not features. A design and its companion plan are two
cards initially, each with direct links to the other where those links exist.
Do not infer that every same-basename pair is one feature or that every outgoing
link is a companion plan. Cross-linking is useful before automatic grouping is safe.

**Ready to build is a claim with qualifications.** A ready-role stage can coexist
with a waiting dependency, blocked questions, or answers awaiting compaction in
the [existing sections](../reference/planning-index.md#62-sections-top-to-bottom).
Keep those facts visible. A headline labeled *Ready, unblocked* must exclude
waiting dependencies and unresolved questions; a pending review answer does not
advance the saved stage. No question does not, by itself, mean ready to implement.

### Interaction and failure handling

- Start with a repository-wide census; offer the selected roadmap as a scope,
  with an explicit count of documents outside it. Define roadmap membership
  separately from question routing before implementing that scope.
- Use the existing shared app shell. Opening a card preserves scope, filter,
  paging, and scroll position when returning to Work.
- A question badge goes to Decisions scoped to the document. Work has no second
  answer editor; the existing answer-and-copy flow keeps its job.
- Hold external updates behind an *Updates available* action so a card never
  moves under the pointer. Reuse the existing page's stable-update approach.
- On narrow screens, show the same groups vertically or as the grouped table,
  not four unreadably narrow columns. Every destination must be an ordinary
  keyboard-accessible link; color alone never conveys stage or a blocker.
- Empty stages say *No documents in this stage*. An empty filter offers to
  clear it. An incomplete scan shows unreadable/skipped counts and links rather
  than implying every document was classified.

> [!IMPORTANT]
> **No drag-to-change-stage in the first version.** Moving a document is a claim
> about decisions or implementation, not just a display preference. A gesture
> cannot verify that claim, and writing Markdown from this screen is a separate
> product decision.

**Cost verdict:** 600–1,000 estimated lines for a read-only overview and its
tests, without history or worker tracking. This fits the zero-new-state-store
constraint; it still needs a visual experiment to validate the attention budget.

**Displacement:** it removes the need to use folded Maintenance groups as the
primary portfolio overview. Those groups remain useful for agent requests;
the decision screen and the roadmap's authored order remain intact.

## 2. Grouped table: strongest alternative

One row per document, grouped by stage, with questions, dependencies, and next
step in aligned columns. Its turn is **comparison without horizontal board
scrolling**: easier to spot ten ready documents sharing the same dependency.

Cost: 450–750 estimated lines with tests, zero new fact stores, and ten rows per
group as the starting page size. It handles many stages better than columns,
but long paths and next steps still need disclosure on small screens.

This displaces the column layout if the real repository is too crowded; it does
not displace Decisions. It must not grow into a spreadsheet of editable status
cells. My preference is to test columns first and retain the table as the
narrow-screen or dense-repository alternative, not build two full interfaces now.

## 3. Relationship graph: not the landing screen

Documents as nodes and explicit links or dependencies as edges would support
exploration. Its turn is showing connections rather than manufacturing tasks.
But an ordinary link does not mean dependency, and a busy graph cannot answer
*how many documents are ready?* at a glance.

Cost: 1,200–2,000 estimated lines with tests and accessible navigation, before
history. It respects the zero-new-fact-store constraint, but fails the bounded
reading-surface goal unless heavily filtered. Hidden nodes then undermine the
census. Defer it; a local list of related documents adds useful drill-down for
less cost and displaces most of the need for a graph on the landing screen.

## Recent transitions are not recently edited files

The current git-backed recents mechanism reports changed files, not stage
changes. Fixing a typo in an old reference must not make it appear newly completed.
Also, this repository's `CURRENT` stage means an evergreen reference; `SUPERSEDED`
means retired. Both have the terminal role, and neither alone proves recent success.

**Recent transition** *(coined here)* means a change in a document's saved stage
between inspected revisions, or a verified move from a proposal to its reference.
It is not every edit, nor a record of everything that happened between commits.

| Event | Evidence needed | What the user should see |
| --- | --- | --- |
| Stage changed | Scan old and new content, then compare exact stage values | Old stage → new stage; time, document, diff |
| Built | An observed transition into a built-role stage | Built; not an unsupported claim of deployment |
| Became a reference | Historical proposal plus demonstrable successor relationship | Reference link and transition evidence |
| Retired or superseded | Terminal transition whose meaning is retirement | Retired, separate from successful completion |
| Local uncommitted change | Working tree differs from inspected committed state | Uncommitted, without an invented completion time |

**Recommended eventual shape:** five recent events over the past seven days,
with *Show more* into bounded history, and filters for built, references, and
retired. Ordinary edits stay on the existing Recents screen.

The [earlier “This week” idea](planning-index.md#5-this-week) already proposed
questions and stages moved since Monday. This is its focused successor for the
new Work screen, not a separate weekly reporting system. Its suggested directive
search cannot find stage-only frontmatter changes or every reference move; that
filter is not sufficient for this feature.

The mechanism must retrieve bounded git revisions through the existing git CLI
boundary, then compare scan results through the shared Markdown parser. Do not
introduce Markdown parsing in Go or a second git library. Load this after the
current-state view, and cache only derived evidence, never authored lifecycle facts.

**Hard part:** graduation can delete the design and create a differently named
reference. A deletion plus a new file in one commit is not proof of succession.
Use explicit replacement links or unambiguous historical evidence; otherwise
show the stage changes and deletion separately, without guessing a completion.
Shallow history or no git means a labeled unavailable history section, not an
empty feed pretending nothing happened. Reading history can also be costly;
the [recent activity investigation](../design/activity-scan-efficiency.md) is
reason not to add a background repository-wide history timer.

**Cost verdict:** 700–1,200 additional estimated lines and tests. History is the
largest uncertainty and deserves its own measured experiment. The overview can
ship independently, but **must not claim to satisfy recent completion tracking**
until this evidence exists. A placeholder called *Recently changed* is not an
equivalent substitute.

## Naming and scope choices

My suggested navigation is **Decisions · Work**:

- **Decisions** describes the current question-answering screen's main job.
- **Work** describes the new survey without pretending to be a project manager.
- Keep the existing planning URL, shortcut, and agent-facing planning links.
  Changing a visible label does not justify breaking those contracts.
- *Overview* is too nonspecific; *Pipeline* suggests linear progress and an
  active implementation stage that Vantage cannot currently establish.

Pickable variants for the next conversation, not settled requirements:

- **Cards or table.** Cards emphasize stages; a table compares many documents
  better. Validate against a real repository before selecting.
- **Documents or efforts.** Documents have reliable identity now. One card per
  effort is appealing, but needs an explicit relationship convention and rules
  for conflicting stages across its documents.
- **Rename now or later.** Decisions/Work makes the distinction clear. Keeping
  Planning/Work initially avoids changing familiar navigation during the experiment.
- **History in the initial release or a follow-up.** Together meets the whole
  request; separately validates the overview sooner but leaves a stated gap.

## Open threads

Nothing here authorizes implementation. These are investigations and browseable
choices, not artificial blockers on a build already requested.

- **Column order outside this repository:** stage roles are not an ordering
  contract. Try a custom vocabulary before settling default layout behavior.
- **History cost and identity:** inspect real graduation commits and measure a
  bounded scan. Successor detection is unverified, not solved by the sketch.
- **What “in flight” means:** this proposal means live documents. Active worker
  presence would require a separate source of truth and is not included.
- **Overview membership:** selected-roadmap document membership must be defined
  without confusing document links with the current question-routing rules.
- **Visual density:** test 60 documents, long paths, many dependencies, missing
  stages, and mobile widths before making the ten-card page size normative.

### Idea parking lot

- A small dependency list for the selected card, rather than a global graph.
- A shareable Work link scoped to one area, mirroring decision handoffs.
- A later *Changed since my last visit* view, explicitly a personal comparison,
  not authoritative completion history.

## Recommendation

Start by validating **read-only stage columns, one card per document**, with
questions and waiting dependencies visible and linked. Keep question answering
on the existing screen. Treat recent transitions as a separate, evidence-backed
component rather than smuggling ordinary recents into a completion feed.
