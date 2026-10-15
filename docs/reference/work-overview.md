---
title: "Work overview — saved document stages and transition evidence"
status: accepted
stage: CURRENT
verified: 2026-10-14
verified_commit: 3fd4099b7b28f72784e7dbfa4f564f69a448c37c
covers:
  - packages/vantage-md/src/planning/
  - frontend/src/pages/WorkPage.tsx
  - frontend/src/pages/PlanningPage.tsx
  - frontend/src/components/PlanningViewsHeader.tsx
  - frontend/src/planningScan/cache.ts
  - frontend/e2e/work_shell.spec.ts
  - packages/vantage-check/src/commands/index.ts
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
summary: "The Overview screen groups saved planning documents into compact stage tiles and separates that source from bounded Git transition evidence."
---

# Work overview — saved document stages and transition evidence

**Status:** Reconciled 2026-10-14 against the working tree based on source commit
`3fd4099b`. The implementation changes are uncommitted and pending review.
UNMEASURED: assistive-technology observation remains outstanding. See
[Verification](#verification) for the checked source behavior and viewport.

**Overview** answers **where do the planning documents say work stands, and what
is recorded as changing?** It is a read-only companion to **Questions**, derived from
[the planning index](planning-index.md), not a task system or build verifier.
Its compact tiles show saved document claims; its separate history feed shows
the source and limits of evidence for stage changes.

**Reads with:** [Planning Documents](../../userguide/guides/planning.md) (using
Questions and Overview), [the planning index](planning-index.md) (candidate discovery,
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
  `built` means built as a saved claim. These are the same roles as Questions.
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

A tile's identity is its path. Its display title comes from a trimmed nonempty
frontmatter `title`, else the first H1 flattened to plain text, else the
filename. This shared scanner projection is presentation metadata, not question
title or identity, and the checker omits it from `index --format json` to preserve
that CLI document shape. The title-first link is paired with the repository-relative
path, so same-basename documents remain distinct. A compact tile shows stage,
question and conflict cues; its keyboard-accessible details disclosure is named
with both the title and path, so repeated titles remain distinct. Open details
flow within the tile, growing it in the page rather than floating over its
neighbors; every fact and handoff action remains in the same scrollable content
as its tile.

Question links open Questions scoped to that document, preserving the existing
answer-and-copy flow. Known next-step question references link to the same
scoped view; other next steps stay plain saved text. Waiting dependencies link
to indexed target documents. No owner, assigned worker or completion fraction
is manufactured, and no title fetch is made for a card.

Active tiles render together in responsive stage grids within one page scroll;
stage counts and jump links keep the configured role order discoverable. No
per-stage reveal limit or nested lane scroll hides an active tile. Terminal
/reference stays collapsed by default with its full count and a visible access
control. The labeled Overview filter searches title, path, stage and next step;
it is local to the page and offers **Clear filter** when nothing matches. It
restores the saved board rather than applying a pending index.

`WorkPage` holds one complete applied index snapshot. Later versions are
pending until the reader presses **Refresh saved index updates**. Filtering,
comments and WebSocket pushes do not replace the painted groups, tiles or
counts. Refresh replaces the snapshot and resets view-local expansion; the
history computation belongs to that applied snapshot, not to an unapplied newer
index.

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

Overview and Questions share a fixed viewer-style header with sidebar access,
reciprocal navigation and active state, and each page's right-side tools. The
visible **Overview** / **Questions** selector supplies the page identity; the
full page heading remains an accessible `h1` without repeating the selector's
text. A repository breadcrumb is shown in multi-repository mode; in a
single-repository install the redundant `root` crumb and separator are omitted
to preserve room for header controls. At narrow widths, the repository name
moves into the existing labeled collapsed-folders control, preserving access to
the project identity and folder navigation. Repository routes select that
repository's index; a missing repository shows an unavailable message rather
than another repository's board. A projectless multi-repository route offers a
chooser.

The visible **Questions** label does not rename planning URLs, APIs, filter
syntax, agent links, CLI output or **`g p`**. Overview introduces no global
shortcut or new query language. Its filter is labeled; document and dependency
navigation uses ordinary links; details use the native keyboard-operable
`summary` disclosure. The **Terminal/reference** reveal control exposes
`aria-expanded`.

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
| Shared metadata, title projection and exhaustive grouping | `packages/vantage-md/src/planning` — `scanPlanningDocument`, `PlanningDocument`, `deriveWorkBoard`, `filterWorkDocuments` |
| Applied snapshot, compact tiles, handoffs and shared navigation | `frontend/src/pages` — `WorkPage`; `frontend/src/components` — `PlanningViewsHeader`, `AppShell` |
| Routing, batch client and evidence comparison | `frontend/src/lib` — `workPath`, `loadWorkHistory`, `buildWorkHistory`, `PlanningSnapshots`, `WorkTransition` |
| Bounded read-only Git inspection | `internal/git` — `GitService.PlanningSnapshots`, `rawCommitParents`, `snapshotBlob` |
| Repository-scoped API and wire model | `internal/api` — `GitPlanningSnapshots`, `BuildPlanningSnapshots`; `internal/model` — `PlanningSnapshot`, `PlanningSnapshots` |

## Verification

The changed presentation and scanner projection were checked in the working tree
based on source commit `3fd4099b`; this review does not treat the uncommitted
source as landed. Focused frontend tests cover scanner title precedence, cache
schema, title filtering, both page headers and accessible links. The checker
regression proves that the scanner's presentation-only `title` stays out of
`vantage-check index --format json`.

The source-Vite Playwright fixture uses 40 active documents across four
repository-defined stage labels of ten each (mapped to the `open`, `ready` and
`built` roles), plus two `done`-role documents in the collapsed terminal group.
Those test labels and role mappings exercise grouped overhead; they do not
define a universal workflow. At 1440×900 with the sidebar collapsed, all 40
active tile bounds fit in the content viewport: top `198.5`, bottom `882.5`,
inside content bounds `56`–`900`. The 40-active bound check excludes the two
terminal tiles, whose count and access control are measured separately.

At 375×812 the page has no horizontal overflow. Playwright opens details and
checks the first/last desktop columns and bottom row, and the phone list's first
and last cards. In every case the expanded panel and both handoff actions stay
within the horizontal content bounds; actions remain visible when brought into
the normal page scroll. The keyboard opens the native disclosure. Screenshots
from this run are retained with the implementation review artifact. These are
deterministic acceptance checks, not a claim about arbitrary repository scale.
Assistive-technology observation is still outstanding. The clean-tree `just done`
gate has not been run because this change is awaiting review and has not been
committed.


## Current values

Reconciled against the working tree based on source commit `3fd4099b` on
2026-10-14. This table isolates tunable limits and operational paths from the
mechanisms above.

| Value | Setting | Defined in |
| :--- | :--- | :--- |
| Overview route | `/.vantage/work`, `/.vantage/work/<encoded-repo>` | `workPath`, `workRepoFromPath` in `frontend/src/lib` |
| Questions route and shortcut, unchanged | `/.vantage/planning`, repository-scoped variant; `g p` | `planningPath` in `frontend/src/lib`, keyboard shortcut registration |
| Snapshot endpoint | `GET /api/git/planning-snapshots`; multi-repo `GET /api/r/<encoded-repo>/git/planning-snapshots` | `Routes`, `GitPlanningSnapshots` in `internal/api` |
| Commit / source-pair caps | 50 local commits / 50 old-new file pairs | `planningCommitLimit`, `planningPairLimit` in `internal/git` |
| Blob / returned source-text caps | 64 KiB per blob / 2 MiB total source text | `planningBlobLimit`, `planningTextLimit` in `internal/git` |
| Changed-path output cap | 2 MiB per inspected commit | `planningPathLimit` in `internal/git` |
| Overview active tiles | All filtered active documents render without a progressive reveal cap; terminal/reference remains collapsed with a count | `WorkPage` in `frontend/src/pages` |
| Overview local filter fields | Display title, path, stage and next step; separate from Questions' filter grammar | `filterWorkDocuments` in `packages/vantage-md/src/planning/work.ts` |
| Viewport acceptance | 40 active documents across four configured stages at 1440×900 with sidebar collapsed (bounds 198.5–882.5 inside content bounds 56–900); 2 terminal documents remain collapsed but counted/accessed; 375×812 has no horizontal overflow, opened detail bounds/actions fit, and native disclosure is keyboard-operable | `frontend/e2e/work_shell.spec.ts` |
| Initial events | 5; Show more reveals remaining bounded candidates | `INITIAL_EVENTS` in `WorkPage` |
| Evidence window | Inclusive `[now - 168 hours, now]` | `buildWorkHistory` in `frontend/src/lib` |
