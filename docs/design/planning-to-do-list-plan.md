---
title: "The planning page as a to-do list: implementation sketch"
status: draft
stage: SKETCH
next: "Complete against the tree once the design's questions are ruled"
depends-on: [planning-to-do-list.md#OQ-TD13]
---

# The planning page as a to-do list: implementation sketch

**Status:** 2026-10-09. Incomplete, and unstable while questions are open.

A parking lot for what came up while designing
[`planning-to-do-list.md`](planning-to-do-list.md) and is worth keeping, but
needs no ruling. It is not a hand-off: nothing is built from it while it is a
sketch, and the `implementation-plan` written from it reads the tree first.
**The design wins on behavior** wherever the two disagree.

## Preferences

Every new preference goes through
[`preferences.ts`](../../frontend/src/lib/preferences.ts#L35), whose
`PREFERENCE_KEYS` makes an unregistered key a type error and whose lint rule
makes any other `localStorage` access an error. Three new keys, names the
implementer's:

- the page size, one of 10, 20, 30, 50;
- the kinds the copy panel leaves out, Ready to build by default;
- which folded groups are open.

The module already follows a key between tabs, so a second tab picks up a
changed page size without a reload.

## The layout snapshot

The movement rule ([design §4](planning-to-do-list.md#4-what-moves-and-who-moves-it))
means the page renders a stored layout, not the sections derived from the
newest index. Notes:

- The snapshot holds, per listed item, enough to draw it as painted: for a
  full card, its rendered block, so a question whose text changed or that
  left the index still draws.
- The held-update count is a diff between the snapshot and a layout derived
  from the data in hand. Deriving one is what an index update does today
  ([§6.4 of the reference](../reference/planning-index.md#64-pages)), so the cost is the same work, minus the commit.
- `usePlanningPageInputs` and the page-input cache are keyed by page
  parameters today; with no pages, the key is the page size instead.
- The sections box's remove-and-reinsert trick, which keeps layout shift at 0
  through a filter change ([§6.16 of the reference](../reference/planning-index.md#616-typing-and-the-url), its third warning), still
  applies to a new layout.

## Measurement

- `just planning-perf` measures T1 to T4. Run it at page size 10 and 50
  against the scale fixture, before and after removing `pageMarkdownChars`.
- `commitCards` and `commitMarkdownChars` in
  [`limits.ts`](../../frontend/src/planningScan/limits.ts#L143) bound nothing
  in code today. Replace them with a bound derived from the largest page size,
  or delete them with the reference's Current values rows.

## The checker

- `compact` joins the request vocabulary in
  [`guide.ts`](../../packages/vantage-md/src/planning/guide.ts#L177) without
  joining `PLANNING_AGENT_SECTION_IDS`, which names sections. Check every
  consumer of that list before choosing where the new id lives.
- `vantage-check index --request` with no section prints all five; its usage
  line and [the CLI guide](../../userguide/guides/vantage-check.md) say four
  today.
- The `compact` request's text should restate the style guide's *Record
  rulings before downstream work* compaction bullet rather than paraphrase it.

## Comment autosave

- **The server, first.** Two changes in
  [`commands.go`](../../internal/review/commands.go#L49): a create whose id
  exists becomes an edit of that comment's text, and a reviewer's reply turn
  can be edited by its id. Both need handler shapes in
  [`review_command_handlers.go`](../../internal/api/review_command_handlers.go)
  and Go tests beside `TestReviewCommentPatchEditSetsEditedAt`.
- **There is no "edit a comment on path X" helper** for the planning page,
  which has only `postCommentTo` and `deleteCommentFrom`
  ([`useReviewStore.ts`](../../frontend/src/stores/useReviewStore.ts#L248)).
  The planning card's box needs one.
- **The four boxes are built three ways:** a React popover, hand-built DOM in
  [`useReviewHighlights.ts`](../../frontend/src/hooks/useReviewHighlights.ts#L675)
  for the inline edit and reply boxes, and the review panel's own textareas.
  One save controller shared by all three is the obvious shape; the
  hand-built boxes are the ones the comment layer's rebuild recreates, so
  that is where focus and caret have to survive.
- **`writingInReview`** in
  [`useWebSocket.ts`](../../frontend/src/hooks/useWebSocket.ts#L55) keys off
  `pendingSelection` and inline drafts; it keeps working if "a box is open"
  stays true until the box closes.
- **The user guide** says the page "waits until you save or cancel it"
  ([`features.md`](../../userguide/features.md)); planning's guide says what
  Answer… files.

## Tests that will change

- [`PlanningPage.test.tsx`](../../frontend/src/pages/PlanningPage.test.tsx)
  pins pages, the section bar, the pager and the notice wording in many
  places; most of those tests become tests of the new layout, not deletions.
- [`planning_filter.spec.ts`](../../frontend/e2e/planning_filter.spec.ts)
  asserts the notice's text and the section bar.
- The checker's notice tests stay as they are: its wording does not change.
- Every comment test that types and then clicks Save or Cancel:
  `MarkdownViewer.test.tsx`, `PlanningQuestionCard.test.tsx` (its
  `answerOnCard` helper), `useReviewHighlights.test.ts`'s draft suite,
  `ReviewPanel.test.tsx`, `useWebSocket.test.ts`'s waiting tests, and the
  e2e specs `renamed_folder.spec.ts` and `question_names.spec.ts`. No test
  covers the popover's Esc or click outside today.

## Documents to update when it is built

- [`planning-index.md`](../reference/planning-index.md): [§6.2](../reference/planning-index.md#62-sections-top-to-bottom) to
  [§6.4](../reference/planning-index.md#64-pages), [§6.7](../reference/planning-index.md#67-answering-and-copy-answers),
  [§6.9](../reference/planning-index.md#69-the-planning-outline),
  [§6.18](../reference/planning-index.md#618-the-filter-notice-and-nothing-matches),
  [§12](../reference/planning-index.md#12-late-data-never-moves-painted-content)'s late-data table,
  Current values, and new *Why it's this way* rows. The design graduates into it.
- [`userguide/guides/planning.md`](../../userguide/guides/planning.md) and
  [`vantage-check.md`](../../userguide/guides/vantage-check.md).
- The comment box's behavior wherever the user guide describes Save and
  Cancel.
