---
title: "Plan: the planning page keeps itself current"
status: accepted
stage: DECIDED
next: "Build tasks 1–5 in order; each is one commit"
depends-on: [planning-page-freshness.md]
---

# Plan: the planning page keeps itself current

**Status:** 2026-11-20. Written against `9a00a6a3`, 2026-11-20.
**Design:** [`planning-page-freshness.md`](planning-page-freshness.md).
Precedence: the design wins on behavior, the tree wins on fact, this file is
advice and is the first thing to be wrong.

## Map

| Path | Change |
| :--- | :--- |
| `frontend/src/hooks/usePlanningReviews.ts` | `reconcilePlanningReviews` replaces `reloadPlanningReviews`; a per-repository freshness store (failing since, offline) replaces `useReloadStatus`; failed reads join one retry loop |
| `frontend/src/stores/usePlanningStore.ts` | `noteReconnect` also counts reconnects, so the page can reconcile its listed documents |
| `frontend/src/lib/coherentReadings.ts` | new — the last coherent reading per document, substituted for a stale one |
| `frontend/src/lib/questionOwnership.ts` | `lifecycleFor` returns a card status: a lifecycle or a document condition, never Unknown |
| `frontend/src/components/PlanningLifecycleBanner.tsx` | the conditions' words and the _· checking_ mark |
| `frontend/src/components/PlanningUpdates.tsx` | **Update · N** with the new refusal; the offline line with **Retry now**; `PlanningReload` goes |
| `frontend/src/components/PlanningUnresolved.tsx` | the header control becomes the **Comments without a question (N)** group body |
| `frontend/src/lib/planningPages.ts`, `PlanningGroups.tsx`, `PlanningCopyPanel.tsx`, `packages/vantage-md/src/planning/guide.ts` | the **Duplicate or stray id** maintenance kind and its request |
| `frontend/src/pages/PlanningPage.tsx` | wires all of the above |

## Reuse

- `fetchPlanningReviews`'s book (`seq`, `read`, `inflight`) and `hold`'s
  adopt-if-not-older rule are the reconcile's ordering. Never write a second
  copy of either.
- `commentAutosave.ts`'s retry (1 s doubling to `RETRY_MAX_MS`, 30 s) is the
  backoff shape. Reuse that constant.
- `ownershipMap` memoizes on object identity. The substituted index and
  reviews must therefore come from `useMemo`, or every render recomputes the
  map.

## Traps

- `ownership.unpaired` is the *stale* set. Once the coherent-readings
  substitution lands, it holds only documents that never had a coherent
  reading (a first load). Anything still reading it as "the document changed"
  is wrong.
- `refresh()` closes open boxes today (`closeBoxes`). [`OQ-FS4`](planning-page-freshness.md#OQ-FS4) says Update never
  closes a box. Removing that call also removes the wait on `boxSettled`.
- The page reconciles on reconnect, and the reconnect runs its own rescan.
  `reconcilePlanningReviews` asks for a rescan too, which is harmless: the
  store coalesces them.
- Tests that assert _Reload from server_, the _Unknown_ pill, _Apply updates_
  or `unresolved-ownership` in the header describe removed behavior. Rewrite
  them to the new behavior. Do not repair them until they pass.

## Tasks

Each task is one commit, in this order.

1. **Reconcile.** The page reconciles every listed document when the socket
   reconnects, which includes the forced reconnect after 30 s or more hidden.
   It reconciles on Update as the verification read, and on Retry now. A
   failed read retries from 1 s, doubling to 30 s, indefinitely. Its paths
   join the retry and never stop at a failure. Thirty seconds of failure is
   **offline**, and the first success clears it. Tests:
   `usePlanningReviews.test.ts` (backoff gaps, offline at 30 s, cleared on
   success, a reconnect reads every listed path).
2. **The band.** The page holds the last coherent reading of each document,
   so cards and counts keep their last values while a reading is stale. A
   stale card adds _· checking_ after 1 s, and the mark clears when the page
   is offline. The band never reads _Unknown_:
   - _Not checked — scan refused / too large to scan / scan failed_, from
     `index.refused`, `index.skipped` and `index.unreadable`;
   - _Id appears N times_;
   - _Id outside a directive_;
   - a document gone from the scan reads _Question removed from document_.

   _Checker not installed_ is a server-side comment reason. The browser's
   scan never yields it, so the band has no source for it.
3. **The header.** Reload from server and the Unknown pill go. _Apply updates_
   becomes **Update · N**. Update is refused while any answer box is open, with
   "Close the open answer first — what you typed is saved", and it never closes
   a box. Pressing it lays out, then reconciles every listed document. Offline
   shows **Offline since HH:MM · retrying** with **Retry now**, in Update's
   slot.
4. **Comments without a question (N).** This is a section group, drawn after
   _Needs you_ when any comment in it is pending for the agent (today, always)
   and in _Maintenance_ otherwise. Its body is today's menu: the reasons, the
   quote, **Attach to question…** (never on a note), **Copy requests**, and
   automatic-bind refusals. An empty group is not drawn, and the header
   control goes.
5. **Duplicate or stray id.** A new Maintenance kind lists the questions whose
   id is declared twice or written outside a directive. Its request goes in
   _Copy answers + maintenance_ and the checker's `index --request`, with the
   parity test covering it.

## Ships with

- Reference docs:
  - [`planning-index.md`](../reference/planning-index.md) [§6.3](../reference/planning-index.md#63-the-frame-and-the-header), [§6.4](../reference/planning-index.md#64-needs-you-as-a-to-do-list), [§6.6](../reference/planning-index.md#66-question-cards), [§6.7](../reference/planning-index.md#67-answering-and-copy-answers);
  - [`planning-ownership.md` §8](../reference/planning-ownership.md#8-apply-updates-reload-from-server-and-selection-anchors);
  - [`planning-question-state.md`](planning-question-state.md), where it
    names Unknown or the header control;
  - [`userguide/guides/planning.md`](../../userguide/guides/planning.md).
- `CHANGELOG.md`: one entry per task, under Unreleased.
- The e2e specs that click _Reload from server_ or read _Apply updates_
  (`frontend/e2e/planning_roadmaps.spec.ts`, `question_names.spec.ts`,
  `work_shell.spec.ts`).
