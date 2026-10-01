---
title: "Measuring the planning index at scale"
date: 2026-09-30
status: accepted
stage: DECIDED
next: "Run D1 and D2 on the scale fixture at all four sizes, with just planning-perf"
tags: [planning, performance, measurement]
summary: "The planning index is built and has graduated into a reference, but of its thirteen scale targets only D1 and D2 have been run against the build, and only on this repository's tree. This is the work of running the rest, in order, and what each result changes."
---

# Measuring the planning index at scale

**Status:** 2026-09-30, written when the planning index graduated into
[its reference](../reference/planning-index.md). The targets, the harness, the
scale fixture and the scenarios are defined in the reference's
[§18](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured),
which also records what has been run. This document owns only the work of running
the rest, and what each result changes.

## What is owed

- **D1 and D2 on the scale fixture**, at each of its four sizes. They have been run
  on this repository's tree only.
- **D3, D4, D5, D6, D7, D9 and D10**, which have never been run anywhere.
- **The hold's keep-or-remove measurement**
  ([§12.3](../reference/planning-index.md#123-the-hold)): whether, on warm loads of
  the scale fixture, the index and the header's git data are already in hand when a
  document's content arrives.
- **This repository's first build with the worker**, against the target of under
  a second that the planning index was first designed to.

D8, D11, D12 and D13 are held by tests, so they are not owed here.

## Stops, in order

1. **Build the harness and the scale fixture.** Done: both are in the tree,
   behind `just planning-perf`
   ([`frontend/perf/planning/`](../../frontend/perf/planning/README.md)). The
   fixture never holds more than 60 documents, so no run builds a large input,
   and every run checks its averages against
   [§18](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured)'s
   before measuring anything, because D3 and D9 are slopes over that mix.
2. **D1 and D2 on the fixture**, in all three scenarios at each size. They come
   first because they are what a reader feels: how long `g p` takes to paint.
3. **D3, D9 and D10**, from the same runs: how D2 grows from 45 to 60 documents,
   the main-thread heap with the planning page open, and the page's element count.
4. **D5, D6 and D7**: the frame while the index builds, long tasks from planning
   code, and how long the index takes to be ready, cold and warm.
5. **D4**, on the dev server, last, since only contributors run it.
6. **The hold and the first build**, from the runs above.

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
  reference records there why it stays.
- **When every target has been run,** the reference holds the record, and this
  document is deleted, with its roadmap entry and the reference's two links to it.
