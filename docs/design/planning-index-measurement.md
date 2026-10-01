---
title: "Measuring the planning index at scale"
date: 2026-09-30
status: accepted
stage: DESIGN
next: "Rule OQ-PM1 and OQ-PM2, then close each miss as ruled and measure it again"
tags: [planning, performance, measurement]
summary: "Every scale target of the planning index was run against the build on 2026-10-01. The scale fixture meets them all but D6 as the harness counts it and D3's cold slope, which the runs cannot resolve, and this repository misses D2, D4's cards and D9. Two questions ask how those misses are closed. The hold stays."
---

# Measuring the planning index at scale

**Status:** Written 2026-09-30, when the planning index graduated into
[its reference](../reference/planning-index.md). Every target it owed was run on
2026-10-01. The reference's
[§18](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured)
records the results, and its [§12.3](../reference/planning-index.md#123-the-hold)
records the hold's. The stage went back to `DESIGN` that day, because two results
need a ruling, and one run is still owed, before this work can close. This document
owns only what remains: those rulings, that run, and what each result changes.

## What was run

All of it on 2026-10-01, with `just planning-perf`
([`frontend/perf/planning/`](../../frontend/perf/planning/README.md)), on
`46c4091`'s code. D8, D11, D12 and D13 are held by tests, so they were not owed.

- **The fixture's averages were checked first:** 19.61, 20.51, 20.12 and 20.38 KB,
  and 3.67, 3.83, 3.87 and 3.75 cards a document, at 15, 30, 45 and 60 documents,
  against a mix of 20.4 KB and 3.75 cards.
- **Met:** D1, D5, D7 and D10 everywhere; D2, D4 and D9 on the scale fixture, D9
  in MiB; D3 for revisit and warm; and this repository's first build, in 561 ms
  against under a second.
- **Missed:** D6 as the harness counts it ([OQ-PM1](#OQ-PM1)), and on this
  repository D2 cold and revisit, D4's cards and D9 ([OQ-PM2](#OQ-PM2)).
- **Not resolved:** D3's cold slope. Cold D2 has two modes about 40 ms apart, and
  the share of runs in each moved the slope more than the documents did, in 21
  runs a size and in 40.
- **D1 and D2 come from runs without D9's heap step,** which ran in the same flow
  in two batches and slowed every later `g p` there
  ([§18](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured)).
  The harness now reads D9 and D10 in a flow of their own, and alternates the
  sizes run by run, which is how the 40-run D3 was measured.
- **The hold stays.** On no warm load of the fixture were the index and the git
  data all in hand when the content arrived.

### D6's counted tasks

During a build, the harness counts every long task that handles the scan worker's
messages, and it counted 33 on the fixture. Profiles of three warm loads on the
Vite dev server, not the production bundle, show that task to be the document's
first render, run there because [the hold](../reference/planning-index.md#123-the-hold)
ends there, with planning code's share under 3 ms
([§18](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured)).
A production profile, with source maps, would confirm it for the build D6 holds.
The four long tasks that ran after a `p` in the 40-run D3 are another kind: the
planning page's own render, which D6 counts however [OQ-PM1](#OQ-PM1) is ruled.

### This repository's misses

D2 is 132 / 111 / 109 ms against 130 / 90 / 110, so cold and revisit miss; D4's
cards are about 300 against 250; and D9 is 12.2 MiB against 12. The reference's
own build, `9507cac`, misses D2's revisit and D9 here too. Run in alternation with
it, this build adds 0.17 MiB to D9 (12.21 against 12.04, three runs each, the
ranges apart), while its D2 gap (122 / 110 / 106 against 117 / 105 / 104, six runs
each) is inside the runs' spread
([§18](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured)).

## What is left

1. Rule [OQ-PM1](#OQ-PM1) and [OQ-PM2](#OQ-PM2).
2. On an idle machine, run the fixture's cold `g p` again, alternating sizes, to
   tell whether the four long tasks the 40-run D3 saw after the `p` (51 to 68 ms,
   two of them while another agent loaded the machine) are the machine's or the
   planning page's; the second would be a D6 defect under either answer to
   [OQ-PM1](#OQ-PM1). In the same runs, find what splits cold D2 into two modes,
   and read D3's cold slope once the split is accounted for.
3. Close each miss as ruled: a fix with a regression test, a design when the fix
   would change one of the reference's principles, or a target set again in
   [§18](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured)'s table.
4. Measure each closed miss again with `just planning-perf`, and record it in
   [§18](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured)
   beside the 2026-10-01 run.

## What a result changes

- **A target met** goes into
  [§18](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured)'s
  record of what has been run, with the date and the commit measured, and the
  reference is verified and stamped again.
- **A target missed** is a defect in the build. Write it up where it can be ruled:
  a fix, or a design when the fix would change one of the reference's principles.
  This document's roadmap entry stays until it is.
- **The hold** is removed if the data is nearly always in hand, as
  [§12.3](../reference/planning-index.md#123-the-hold) says; otherwise the
  reference records there why it stays. It now does.
- **When every miss is closed and every target resolved,** the reference holds the record, and this document
  is deleted, with its roadmap entry and the reference's two links to it.

## Open Questions

1. 💬 **OQ-PM1: Is a held document's first render one of D6's long tasks?**
   The harness counted 33 long tasks during builds, each, as dev-server profiles
   show, the document's first render, run in the task where
   [the hold](../reference/planning-index.md#123-the-hold) ends
   ([D6's counted tasks](#d6s-counted-tasks)). The question is about those alone.

   - **A — No; those tasks are not D6's.** The profiles say they are the
     document's own.
   - **B — Yes; D6 is missed** until a document's first render is no longer one
     long task. That is the viewer's rendering, not the index's, and needs a
     design of its own.

   <!-- vantage: oq id=OQ-PM1 leaning="A — those tasks are not D6's: a document's first render is a long task with the planning index or without it, and the hold decides only which task it runs in." -->

   _Leaning:_ A. The render is a long task with the planning index or without it,
   and the hold decides only which task it runs in.

   **Answer:**
   > _(empty — fill in when decided)_

2. 💬 **OQ-PM2: This repository misses D2, D4's cards and D9: fix the build, or set its column again?**
   The reference's own build, `9507cac`, misses D2's revisit and D9 here too, and
   this build adds 0.17 MiB to D9 over it, a gap option A would fix as a defect
   ([This repository's misses](#this-repositorys-misses)).

   - **A — Set the column again** from a run that alternates this build and
     `9507cac`'s on an idle machine: what `9507cac` measures, with room. A gap this
     build adds over it is a defect to fix.
   - **B — Keep the column,** and profile and fix each miss as a defect of the
     build.
   - **C — Drop this repository's D2, D4 and D9,** and hold only the fixture's.

   <!-- vantage: oq id=OQ-PM2 leaning="A — set this repository's D2, D4 and D9 again from a run that alternates this build and 9507cac's on an idle machine, and fix any gap this build adds over 9507cac as a defect." -->

   _Leaning:_ A. D4 and D9 had never been run before, and the reference's own build
   misses too, so these say more about the column than about any change since. A
   run that alternates the two builds tells those apart.

   **Answer:**
   > _(empty — fill in when decided)_
