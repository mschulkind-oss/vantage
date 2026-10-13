---
title: "Work overview — saved document stages and transition evidence"
status: accepted
stage: CURRENT
verified: 2026-10-13
verified_commit: 1fe1e7e3170b9f3bb97083e43009629464dbaa41
covers:
  - packages/vantage-md/src/planning/
  - frontend/src/pages/WorkPage.tsx
  - frontend/src/lib/workHistory.ts
  - frontend/src/lib/workTransitions.ts
  - frontend/src/lib/workRoute.ts
  - frontend/src/App.tsx
  - frontend/src/components/AppShell.tsx
  - internal/git/snapshots.go
  - internal/model/models.go
  - internal/api/git_handlers.go
  - internal/api/responses.go
  - internal/api/routes.go
tags: [planning, viewer, git]
summary: "The read-only Work screen groups every indexed document by saved stage and shows separately labeled metadata and bounded Git evidence."
---

# Work overview — saved document stages and transition evidence

**Status:** Verified 2026-10-13 against source commit `1fe1e7e3`.
Independent source and documentation reviews passed, and the clean committed
`just done` gate passed on 2026-10-13. UNMEASURED: Work-specific runtime scale and
assistive-technology observation remain outstanding. See
[Verification](#verification) for the observed checks and their limits.

Work answers **where do the planning documents say work stands, and what is
recorded as changing?** It is a read-only companion to Decisions, derived from
[the planning index](planning-index.md), not a task system or build verifier.
Its board shows saved document claims; its separate history feed shows the
source and limits of evidence for stage changes.

**Reads with:** [Planning Documents](../../userguide/guides/planning.md) (using
Decisions and Work), [the planning index](planning-index.md) (candidate discovery,
effective question state, dependencies and machine interfaces), and
[repository configuration](repo-config.md) (the stage vocabulary).

## Principles and authority

P1. **One home per planning fact.** Documents own `stage`, `next`, and
`depends-on`; roadmaps own relative priority. Work derives its board from the
same current planning index and never keeps a second stage or priority store.

P2. **A claim is not evidence of implementation.** No completion percentage,
active-worker state, test status, or successful outcome is inferred from a
stage, a commit, a comment, or a missing document.

P3. **Exact words stay exact.** Repository stage labels and ordering are not
universal. Grouping by stage role is navigation, not a claim that one stage
follows another.

P4. **Evidence stays labeled.** A document date, a Git commit date, and an
implementation time are different facts. The interface names the evidence and
never upgrades its meaning.

P5. **Updates do not move the reader's target.** A complete board layout stays
painted until the reader applies external index changes. New documents, stage
groups, and counts do not appear underneath a pointer or focused control.

Documents remain the authority. Owners and agents maintain them through their
chosen authoring tools. Work does not verify implementation and never writes
documents or source files; this is a permanent boundary, not an
initial-release limitation. Its always-visible disclosure names that boundary.

## Board census and stage roles

A planning document is one already admitted to `PlanningIndex`. Work neither
broadens discovery nor fetches full Markdown for a card. `deriveWorkBoard`
accounts for every indexed document exactly once across these groups:

- **Active role groups:** `open`, `ready`, then `built`. A role is the
  repository's mapping of a saved word, not a universal lifecycle sequence.
  `open` means still being decided, `ready` means decided and not built,
  `built` means built as a saved claim. These are the same roles as Decisions.
- **Terminal/reference:** every `done`-role document, initially collapsed with
  its count. `done` means no longer a live proposal; it does not mean completed.
  The group retains each exact stage label and orders documents by path.
- **Needs classification:** missing stages and configured-but-unknown stages
  stay visible. Without a declared vocabulary, saved words appear under
  **Unmapped saved stages**, not as guessed roles or configuration errors.

Within each active role and the unmapped groups, exact stage names sort in
code-unit order, then repository-relative paths sort in the same order. Empty
active roles are omitted. Stage ordering never guesses that a repository's
`SKETCH` precedes its `DESIGN`.

Loading, index refusal, skipped files, unreadable candidates and failures are
visible. An empty index says only that no planning documents are currently
indexed; it is not a claim that the repository contains no work. Static exports
show index unavailability, not a substituted empty board.

## Cards, filtering and reader-applied updates

A card's identity is its path, shown as a basename and repository-relative
path. It retains the exact saved stage and next-step text. `questionState` and
`waitingDependsOn` supply effective question counts and waiting dependencies;
a ready/built claim with an effective open question shows a stage conflict.
These counts describe saved questions, not pending review-answer-adjusted work.

Question links open Decisions scoped to that document, preserving its existing
answer-and-copy flow. Known next-step question references link to the same
scoped view; other next steps stay plain saved text. Waiting dependencies link
to indexed target documents. No owner, assigned worker or completion fraction
is manufactured, and no title fetch is made for a card.

Cards stack vertically, including on narrow screens. Bounded initial card
lists have **Show more** controls. The labeled page-local filter searches only
path, stage and next-step text, case-insensitively. It does not use Decisions'
query language or a URL parameter. A no-match result offers **Clear filter**;
clearing restores the saved board rather than applying a pending index.

`WorkPage` holds one complete applied index snapshot. Later versions are
pending until the reader presses **Refresh saved index updates**. Filtering,
comments and WebSocket pushes do not replace the painted groups, cards or
counts. Refresh replaces the snapshot and resets expanded card and event
limits. The history computation belongs to that applied snapshot, not to an
unapplied newer index.

## Transition evidence

A **recent transition** means evidence that a document's saved stage changed,
or that an explicit stage claim disappeared with a deleted document. It is not
ordinary file recency and does not establish implementation success. The feed
uses a rolling window, captures one reference instant per computation, excludes
future evidence, and orders newest evidence first with path and source as
stable ties. Its exact window and display limits are in [Current values](#current-values).

### Current-stage document metadata

Optional top-level `stage-since` records when the **current saved stage** began,
not creation, modification, implementation or completion time. The shared
`scanPlanningDocument` projection carries normalized `stageSince` only when
both the stage and date are valid. Accepted date-only values are strict
`YYYY-MM-DD` real Gregorian dates, normalized to midnight UTC. RFC 3339
[timestamps](https://www.rfc-editor.org/rfc/rfc3339) require a timezone and are
normalized to their represented instant, including lowercase `t` and `z`.
Equivalent YAML and TOML date values normalize identically; unzoned local
TOML date-times and time-only values are not evidence instants. Malformed dates
must not become events through calendar rollover. TOML validation occurs before
accepting a parser-produced Date, so an impossible unquoted date cannot be
silently repaired into metadata evidence.

The event is labeled **Document metadata evidence: stage entered** and names
only the current stage; it fabricates no prior stage. Missing or malformed
metadata contributes no event and requires no legacy-document migration.
Metadata remains the primary current-stage evidence when present. A conflicting
Git stage is separate, explicitly labeled evidence and cannot replace the
board's saved current stage.

### Bounded local Git snapshots

After an applied board is available, `loadWorkHistory` makes one
repository-level batch request. Refreshing the applied index can load a new
batch. There is no timer walking history and no per-card request.

`GitService.PlanningSnapshots` shells out to the Git CLI and returns bounded
historical Markdown source pairs. Go does not parse Markdown. The shared
TypeScript scanner determines planning eligibility and before/after stages in
`buildWorkHistory`. The service considers newest local commits first and
code-unit-sorted paths within a commit. Merges compare with the first parent.

A **verified root** has no parent in its raw commit object and is compared with
an absent prior file. An unavailable first parent, including a shallow
boundary, is not an empty tree. Unreadable or oversized source is not an empty
file either. The response carries `complete`, `partial` or `unavailable`, with
`commits_examined`, `truncated`, a reason when relevant, and source snapshots.
Bounds, shallow history and unreadable inputs remain disclosed even if usable
events were found.

The comparator retains the newest proven transition per eligible path in the
examined batch. Unchanged stages produce no event. The old side must prove a
planning document: a root/new-file snapshot alone does not fabricate a prior
planning stage. A deleted document with an old saved stage can produce
**stage → Deleted**, separately labeled as Git evidence. A rename or a new
reference is not inferred to be a successor, and deletion never means success.

Git events are dated by the commit that recorded them, not a save or
implementation time. Events link to an extant indexed document or file history;
Git events also offer **View file history**. They do not claim to open the exact
commit diff directly. No Git, a non-Git child, static mode, invalid API data or a
failed request stays unavailable. Partial evidence never says that nothing
happened; a complete inspected window with no qualifying event can say that
none was found there.

> [!WARNING]
> Do not reuse ordinary recents or an empty-on-error history response as stage
> evidence. Neither proves a stage change, and an unavailable parent must never
> be upgraded to a verified root. Bounds limit what was inspected, not what
> happened in the repository.

## Reachability and accessible handoffs

Work and Decisions share `AppShell`, ordinary labeled sidebar links and
reciprocal links. Repository routes select that repository's index; a missing
repository shows an unavailable message rather than another repository's
board. A projectless multi-repository route offers a chooser.

The visible Decisions label does not rename planning URLs, APIs, CLI output,
filter syntax, agent links or **`g p`**. Work introduces no global shortcut or
new planning query language. Its filter is labeled; document and dependency
navigation uses ordinary links; reveal controls are buttons, and
Terminal/reference exposes `aria-expanded`.

**Open document to comment** and **Copy change request** are handoffs through
existing navigation and clipboard conventions. A request is proposed document
maintenance, not a source edit or a saved stage change. The board changes only
when Markdown changes and the reader applies the updated index.

## Boundaries

Work is not a task manager, universal Kanban pipeline, progress tracker,
active-worker detector, event store or successor registry. It does not merge
roadmap priority, write roadmaps, expose drag/reorder, verify tests or infer
completion from a terminal stage. A future ordering proposal still cannot
change authoritative priority until the roadmap's Markdown changes.

## Where it lives

| Component | Package and greppable anchors |
| :--- | :--- |
| Shared metadata and exhaustive grouping | `packages/vantage-md/src/planning` — `scanPlanningDocument`, `PlanningDocument`, `deriveWorkBoard`, `filterWorkDocuments` |
| Applied snapshot, board, cards and handoffs | `frontend/src/pages` — `WorkPage`; shared shell in `frontend/src/components` — `AppShell` |
| Routing, batch client and evidence comparison | `frontend/src/lib` — `workPath`, `loadWorkHistory`, `buildWorkHistory`, `PlanningSnapshots`, `WorkTransition` |
| Bounded read-only Git inspection | `internal/git` — `GitService.PlanningSnapshots`, `rawCommitParents`, `snapshotBlob` |
| Repository-scoped API and wire model | `internal/api` — `GitPlanningSnapshots`, `BuildPlanningSnapshots`; `internal/model` — `PlanningSnapshot`, `PlanningSnapshots` |

## Verification

This reference was independently reconciled against source commit `1fe1e7e3`:
its authority, exhaustive grouping, reader-held board, metadata, Git bounds,
provenance and handoffs match the committed implementation. The retired
design's stale **Built: No** ledger was not evidence that these mechanisms were
absent. No unanswered question directive remains in this reference.

The final metadata review found no issues: 119 scanner tests and 1,140
independent grammar/date probes passed. The independent browser assertion
review approved the expectation repairs without weakened checks, skipped tests
or extra source mutations. The final integration report records 4,954 frontend
tests across 139 files and 246 E2E tests passed, with no failures, skips or
unrun tests; it also records the focused API/Git, typecheck and Markdown checks.
These integration results validated the subsequently committed source overlay,
not the clean committed full gate. The browser suite used Vite's current source,
not the embedded bundle. The source commit's normal pre-commit hook passed all
12 applicable checks. The separate clean-tree `just done` gate passed on
2026-10-13 after source and documentation landing: Go checks, workspace
formatting/lint/types, published-package checks, 4,954 frontend tests in 139
files, 1,234 checker tests in 27 files (one existing skip), script-policy tests
and compiled-CLI self-checks. The documentation self-check reported nine
pre-existing planning warnings in unrelated documents, not failures.

The apparent workspace stall was resolved by the saved final reports: the
metadata reviewer, browser reviewer and integration worker had completed, and
their artifacts record successful exits. Coordinator provider validation and
stream errors prevented acceptance and landing from being recorded at that
time; they were not evidence of a still-running worker or a failed feature
gate. Source acceptance and landing have since completed; the full gate is a
separate verification, not a reason to reopen that resolved stall.

Formal acceptance criteria were not populated on the existing work-control
objective. `create_goal` refuses an already-existing objective, and the
available update path does not edit its criteria; this note does not claim that
field was populated or replace the objective. The concrete reviews and checks
above are the operational evidence. The exploratory reordering proposal remains
unimplemented and is not part of this change.

The `verified_commit` identifies the actual source commit, not this reference's
own documentation commit. Its covered source paths were reviewed at that
commit. The compatibility check was not repeated in this documentation pass
because neither notation nor tested behavior changed. Source entry-point
backlinks were not added in this docs-only pass.

## Current values

Verified against source commit `1fe1e7e3`. This table isolates tunable limits
and operational paths from the mechanisms above.

| Value | Setting | Defined in |
| :--- | :--- | :--- |
| Work routes | `/.vantage/work`, `/.vantage/work/<encoded-repo>` | `workPath`, `workRepoFromPath` in `frontend/src/lib` |
| Decisions route and shortcut, unchanged | `/.vantage/planning`, repository-scoped variant; `g p` | `planningPath` in `frontend/src/lib`, keyboard shortcut registration |
| Snapshot endpoint | `GET /api/git/planning-snapshots`; multi-repo `GET /api/r/<encoded-repo>/git/planning-snapshots` | `Routes`, `GitPlanningSnapshots` in `internal/api` |
| Commit / source-pair caps | 50 local commits / 50 old-new file pairs | `planningCommitLimit`, `planningPairLimit` in `internal/git` |
| Blob / returned source-text caps | 64 KiB per blob / 2 MiB total source text | `planningBlobLimit`, `planningTextLimit` in `internal/git` |
| Changed-path output cap | 2 MiB per inspected commit | `planningPathLimit` in `internal/git` |
| Initial cards / expansion increment | 10 per stage or classification list; terminal group uses one path-sorted list | `INITIAL_CARDS` in `WorkPage` |
| Initial events | 5; Show more reveals remaining bounded candidates | `INITIAL_EVENTS` in `WorkPage` |
| Evidence window | Inclusive `[now - 168 hours, now]` | `buildWorkHistory` in `frontend/src/lib` |
