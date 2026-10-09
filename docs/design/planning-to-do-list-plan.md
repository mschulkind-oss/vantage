---
title: "The planning page as a to-do list: implementation plan"
status: accepted
stage: DECIDED
next: "Build C1 (the movement rule, Needs you, the folded groups, dropping pages); then C2 (the header, the copy panel, the filter line's counts, the contents column)"
---

# The planning page as a to-do list: implementation plan

**Status:** 2026-10-09. Completed against the tree, written against `080853ad`.
**Design:** [`planning-to-do-list.md`](planning-to-do-list.md), every ruling in.

**Precedence.** The design wins on behavior. The tree wins on fact where the
drift is cosmetic (a moved line, a renamed helper with the same role): follow
it and say so in the commit. This file is advice, and the first thing to be
wrong. **Stop and report, do not commit,** when a test does not fail the way a
task predicts, a file a task names is dirty with someone else's work, a
symbol it names is gone, the fix needs a file outside the task's fence, or a
gate fails outside the task's scope.

Four tracks share the tree. **A** turns every comment box into autosave
([design §6](planning-to-do-list.md#6-comment-autosave)). **B** adds the
`compact` request to `packages/vantage-md` ([§5.2](planning-to-do-list.md#52-the-new-compact-request)).
**C1** is the core of the planning page: [§4](planning-to-do-list.md#4-what-moves-and-who-moves-it), [§3.3](planning-to-do-list.md#33-needs-you), [§3.4](planning-to-do-list.md#34-the-folded-groups) and [§7](planning-to-do-list.md#7-dropping-pages). **C2** is the
rest of the page: [§3.1](planning-to-do-list.md#31-the-header) past the updates slot, [§3.2](planning-to-do-list.md#32-the-filter-line), [§3.5](planning-to-do-list.md#35-the-contents-column) and [§5.1](planning-to-do-list.md#51-the-panel).

## Map

| Path | Track | Change |
| :--- | :--- | :--- |
| `frontend/src/lib/planningLayout.ts` | C1 | new: the pure layout of *Needs you* and the folded groups, the item identity, the marks and the held-update count |
| `frontend/src/lib/planningLayout.test.ts` | C1 | new: unit tests of the above |
| `frontend/src/lib/planningPages.ts` | C1 | paging removed (`cardBounds`, `pageBounds`, `readPageRequest`, `withPage`, `requestWithPage`, `pageSearch`); `PlanningLayout` becomes *Needs you*'s open questions, the page size and the groups; `planningSearch` and `withFilter` drop every section-id parameter |
| `frontend/src/hooks/usePlanningPageInputs.ts` | C1 | key by page size instead of pages; gather blocks for the first page-size-plus-ahead open questions, then for the shortfall the answered ones leave |
| `frontend/src/pages/PlanningPage.tsx` | C1 | the held basis (the index a layout was made from), Refresh, the updates slot, the new *Needs you* and groups; pager, flip and page-request code removed |
| `frontend/src/components/PlanningNeedsYou.tsx` | C1 | new: heading, answered rows, full cards, end line |
| `frontend/src/components/PlanningGroups.tsx` | C1 | new: *Blocked* and *Maintenance*, folded, one-line rows |
| `frontend/src/components/PlanningUpdates.tsx` | C1 | new: the header's *N updates · Refresh* slot |
| `frontend/src/components/PlanningQuestionCard.tsx` | C1 | the New reply mark and the other marks in the card's own lines; the comment list frozen to what the layout painted; report "answered here" and "open box" to the page |
| `frontend/src/components/ReviewCommentPopover.tsx` | C1, then A | an optional close handle the page can call; A replaces its insides |
| `frontend/src/components/PlanningPager.tsx` | C1 | deleted |
| `frontend/src/lib/planningOutline.ts`, `PlanningOutline.tsx` | C1 minimal, C2 | C1: no `page`, a jump opens a folded group first; C2: retitle *On this page*, the rows of [§3.5](planning-to-do-list.md#35-the-contents-column) |
| `frontend/src/lib/preferences.ts` | C1, C2 | C1: page size, the two groups' open state; C2: the copy panel's kinds left out |
| `frontend/src/planningScan/limits.ts` | C1 | drop `pageEntries`, `pageMarkdownChars`, `pageRows`, `pageLines`, `pageSelectFrom`, `commitCards`, `commitMarkdownChars`; add the page sizes, the answered-rows cap, the group-rows cap, the ahead count |
| `frontend/perf/planning/run.ts`, `scenarios.ts`, `fixture.ts` | C1 | `--page-size`, seeded into the profile's `localStorage` before the page's scripts run; the fixture's section-size check reads the new limit |
| `frontend/e2e/planning_*.spec.ts` | C1 | rewrite to the new layout; new spec for [§11](planning-to-do-list.md#11-what-done-looks-like) items 1–5 |
| `userguide/guides/planning.md` | C1, C2 | *Pages* section and every pager mention, *Needs you*, the folded groups, Refresh |
| `frontend/src/components/PlanningFilterLine.tsx` | C2 | counts slot, *hidden*, ✕ pushes |
| `packages/vantage-md/src/planning/guide.ts` | B | the `compact` request (not a section id) |
| `docs/reference/planning-index.md` | after C2 | graduation, not before |

## Reuse before you write

- `sectionsOf(index, roadmap, filter)` (`planningPages.ts`): the one cached derivation every layout, count and request reads. Never call `derivePlanningSections` from the page.
- `pendingAnswers` and `questionKey` (`planningAnswers.ts`): which question a comment answers, placement and card reports both. The answered set of a layout is `pendingAnswers(...).answered` at the moment the layout is made.
- `questionOffer`, `takeUndoable`, `OQ_*` labels (`hooks/useOpenQuestionButtons.ts`): the chip an answered row shows is the card's chip; do not coin new wording.
- `latestAgentReaction` and `isPendingForAgent` (`stores/useReviewStore.ts`): a reply is an agent reaction; count them per question to see a new one.
- `planningCardId(path, id, unitLine)` (`lib/planningCardId.ts`): the item identity across index versions. `questionKey` is path and line, which moves when a line above it is added; use it only within one index.
- `ReservedLabel` and the `hdr-reserve` class: room kept from first paint, as Copy answers' count does (`pendingCountDigits`).
- `readPreference` / `writePreference` / `UNSYNCED_PREFERENCES` (`preferences.ts`): every new key goes in `PREFERENCE_KEYS`, and either a follower in `src` or an `UNSYNCED_PREFERENCES` argument, or `preferences.test.ts` fails.
- `CopyRequestButton` (in `PlanningPage.tsx`): the sub-headings' Copy agent request; move it to its own module if the groups component needs it.
- Page tests: `seed`, `serveTree`, `readyOf`, `setLoad`, `renderPage`, `settle`, `watchScrollTop`, `scroller`, `releaseFrames` at the top of `PlanningPage.test.tsx`. A late change is `setLoad(readyOf(newTree))` or a change to `reviews` followed by `fetchPlanningReviews`.
- e2e: `frontend/e2e/planningIndex.ts` (waits for the index), the layout-shift observer in `planning_filter.spec.ts`, `ownServer.ts` for a spec that rewrites fixture files.

## Traps

- **The page's sections follow the index today.** `layout` is derived from `index`, so an index update changes `wanted` in `usePlanningPageInputs`, a new set is gathered and offered, and the page re-lays out: that is today's L2. Holding updates means deriving the layout from the *basis* load the reader last accepted, never from `usePlanningIndex()` directly. Symptom of getting it wrong: a push swaps the cards.
- **The basis must advance on every reader action of [§4.1](planning-to-do-list.md#41-your-own-actions) that makes a layout,** filter typing included: each keystroke that changes the applied filter is a new layout from the data in hand. Advancing it only on Refresh leaves a typed filter applied to a stale index.
- **Before the first layout there is nothing to protect:** while no set has been shown, the basis follows the load.
- **The answered split needs reviews, and the inputs fetch blocks before reviews answer.** Fetch the first page size plus a few more open questions' blocks in parallel with the reviews, then the shortfall the answered ones leave. Fetching after the reviews serializes two requests and costs D2.
- **A card re-renders its comment list live.** `PlanningQuestionCard` lists `comments` filtered by its scoping, so a reply arriving adds a line under a painted card. Under P2 the list must stay what the layout painted until the reader asks; the card still scopes over the live comments, which Copy answers reads.
- **`commentsLate` closes the list for late comments; it does not freeze it.** A list opened by the reader takes every comment after that, which is the reader's own action.
- **The sections' box is put back in place on a filter change (`placedFor`).** Keep it for every new layout, Refresh included: a box re-inserted is scored as new, not moved, so the layout shift stays 0 ([reference §6.16](../reference/planning-index.md#616-typing-and-the-url), third warning).
- **Refresh's place-keeping is a scroll made in a layout effect,** after the new layout commits and before paint, from the item's `getBoundingClientRect` captured before the commit. jsdom lays nothing out, so tests stub `getBoundingClientRect` and watch `scrollTop` writes (`watchScrollTop`).
- **The outline's documents carry a page number** (`OutlineDocument.page`) and a jump flips pages. With no pages, a jump to a row in a folded group must open the group first, then scroll.
- **`prefetchPlanningPage` lays a layout out with no reviews.** Its key must not include anything only the page knows, or `g p`'s prefetch misses: key by repository, version, roadmap, filter and page size.
- **`planningGuide.test.ts`, `planningOutline.test.ts`, `limits.test.ts` and `perf/planning/fixture.ts` read the paging limits.** Removing them breaks those at compile time; rewrite each to the new limit.
- **The Answer… popover discards on Esc and on a click outside today.** Refresh must not lose its text: until A lands, closing it from Refresh files the text, as Save does.

## C1 tasks

C1 is one track, one worktree, one `feat(planning)` commit. Its tasks are in
build order; each ends green on its own gate.

### Task 1: the layout module (independent)

- **Settled, do not re-open.** *Needs you* holds answered rows first, in roadmap order, the first 5 shown, then *… N more answered · Show*; then the first *N* questions that need you as cards, *N* the page size, 10, 20, 30 or 50, default 10; then the end line *M more need you · show 10 | 20 | 30 | 50*, the sizes alone with nothing more, *Nothing needs you* with nothing at all. A ✅ question leaves *Needs you* for *Maintenance*'s *To fold into the ledger*. ([§3.3](planning-to-do-list.md#33-needs-you))
- **Change.** `planningLayout.ts`: a layout from the index, the sections, the answered set and the page size; the item key; the diff of a layout against the data in hand into marks per item and the held-update count by kind ([§4.2](planning-to-do-list.md#42-what-arrives-late), [§4.3](planning-to-do-list.md#43-refresh)).
- **Tests first.** One case per row of [§4.2](planning-to-do-list.md#42-what-arrives-late)'s table, and the count rule of [§4.3](planning-to-do-list.md#43-refresh) (one per item that would appear, leave, change between row and card, or re-render; one for a reordered roadmap).
- **Gate.** `npx vitest run src/lib/planningLayout.test.ts` in `frontend/`.

### Task 2: drop pages (after 1)

- **Settled.** No pages; page parameters in an address are ignored and dropped by the in-place rewrite; the full cards of one layout paint in one commit ([§7](planning-to-do-list.md#7-dropping-pages)).
- **Change.** `planningPages.ts`, `usePlanningPageInputs.ts`, `limits.ts`, `PlanningPager.tsx` (deleted), the page's flip and prefetch code.
- **Tests.** Rewrite the *pages* describe of `PlanningPage.test.tsx` to: an address with `needs-you=3` is rewritten without it; the inputs key holds the page size; a page size of 50 renders 50 cards in one commit.

### Task 3: the held layout and Refresh (after 2)

- **Settled.** [§4.1](planning-to-do-list.md#41-your-own-actions)'s table, [§4.2](planning-to-do-list.md#42-what-arrives-late)'s table, [§4.3](planning-to-do-list.md#43-refresh)'s three steps, [the New reply mark](planning-to-do-list.md#the-new-reply-mark), and the updates slot in the header with its room kept from first paint ([§3.1](planning-to-do-list.md#31-the-header)).
- **Change.** The basis in `PlanningPage.tsx`; `PlanningUpdates.tsx`; the card's marks and frozen list; the popover's close handle.
- **Tests first.** One page test per row of [§4.1](planning-to-do-list.md#41-your-own-actions) and [§4.2](planning-to-do-list.md#42-what-arrives-late); counts change while the layout is held; Refresh keeps the first item on screen at the same height; Refresh closes an open box first.
- **Integration with A.** Refresh calls the card's close handle; today that files the typed text as Save does. When A lands, closing saves, and the handle is A's close path.

### Task 4: the folded groups (after 1)

- **Settled.** *Blocked* and *Maintenance*, closed by default, open state remembered per group, one row per item, the first 100 then *Show all N*, Copy agent request on each kind's sub-heading ([§3.4](planning-to-do-list.md#34-the-folded-groups)).
- **Integration with B.** *To fold into the ledger* lists ✅ questions of the chosen roadmap's *Needs you*; its Copy agent request is wired only once `vantage-md/planning` exports the `compact` request. Until then the spot is marked in `PlanningGroups.tsx`. When B lands, the list should come from B's own selection function (P7), not the page's.

### Task 5: measure (after 2 and 3)

- `just planning-perf --targets typing --size 15,60 --repo . --runs 10 --page-size 10`, then `--page-size 50`. T1 to T4 are reported, never judged here ([§7](planning-to-do-list.md#7-dropping-pages)).

## C2 tasks (after C1)

- **The header** ([§3.1](planning-to-do-list.md#31-the-header)): Expand all / Collapse all into the header, beside the view toggles; the copy panel ([§5.1](planning-to-do-list.md#51-the-panel)), its preference of kinds left out, *Ready to build* unchecked by default; Copy all agent requests removed. The panel's counts read the same group counts C1 draws live.
- **The filter line** ([§3.2](planning-to-do-list.md#32-the-filter-line)): the counts slot from an *item* count (one question or one document row, counted once), *hidden* and ✕ as pushes, the notice kept only for *Not filtered* and *Nothing matches*, the *Waits on* line moved into *Blocked*. `PlanningFilterLine.tsx` owns the slot; `applyFilter` in the page owns the push.
- **The contents column** ([§3.5](planning-to-do-list.md#35-the-contents-column)): retitled *On this page*, lists the full cards' documents, then one line each for the answered rows, *Blocked* and *Maintenance*; the section bar removed; the roadmap picker onto *Needs you*'s heading line where the column is not drawn.

## Ships with

- **Unit:** `planningLayout.test.ts` (Task 1); `preferences.test.ts` picks up the new keys by itself.
- **Page tests that pin the old behavior, to be rewritten, not repaired:** the *pages* and *a flip's scroll position* describes, *the section bar* counts, *Expand all* across a flip, *Copy answers across pages*, the outline's page jumps, every test reading `cardsIn("Not on a roadmap")` or `cardsIn("Blocked")` (those are rows now), and every test that expects an index update to re-lay out ([reference §12](../reference/planning-index.md#12-late-data-never-moves-painted-content)'s L2).
- **e2e:** `planning_page.spec.ts` (*pages Needs you in tens*), `planning_card_fold.spec.ts` (*a page flip*), `planning_filter.spec.ts`, `planning_shell.spec.ts` (outline jumps); new `planning_todo.spec.ts` for [§11](planning-to-do-list.md#11-what-done-looks-like) items 1–5 with the layout-shift observer.
- **Docs:** `userguide/guides/planning.md` (*Pages*, the sections table, *A comment on a question is your answer*, Copy agent request); `CHANGELOG.md` is the release's, not this commit's. `docs/reference/planning-index.md` graduates after C2.

## Don't

- Don't key the sections' box by the layout: every card would mount anew on Refresh ([reference §6.16](../reference/planning-index.md#616-typing-and-the-url)).
- Don't paint the full cards in batches to meet T2 at 50: P2 forbids the end line moving as batches land ([§7](planning-to-do-list.md#7-dropping-pages)). Report a miss.
- Don't put the character budget back ([OQ-TD8](planning-to-do-list.md#decision-ledger)).
- Don't store which questions the reader has seen: answered rows come from the review store ([§3.3](planning-to-do-list.md#33-needs-you)).
- Don't change `vantage-check index`'s sections or JSON (P5).
