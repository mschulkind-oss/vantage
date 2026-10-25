---
status: accepted
stage: DECIDED
next: "Integrate the independent backend and frontend lanes, then verify the diagnostic bounds"
---

# Slow recent-file scans should explain their measured work

**Status:** 2026-10-25. User accepted the project-local analysis page; implementation and verification remain pending.

> **In short.** A timed-out scan should preserve cheap evidence and offer a bounded investigation, without starting another expensive walk behind the reader's back.

**Needs your ruling:** None.

**Reads with:** [`recent-scan-analysis-plan.md`](recent-scan-analysis-plan.md) (component ownership, shared contract and integration gates).

## Accepted behavior

- The recent-files timeout warning links to the affected project's analysis page in single-project and daemon modes.
- Opening the page reads captured evidence only: the original command, settings, elapsed time, timeout and whether gitignored files were included. Unavailable evidence is explicitly unknown.
- The reader may deliberately run a bounded diagnostic and cancel it. The server caps time, entry work, retained results and concurrent diagnostics; callers cannot raise those caps or choose arbitrary filesystem paths.
- Results rank directories by measured enumeration work and time, not disk size. The measurement is a current filesystem approximation, not reconstructed attribution of the earlier git subprocess's elapsed time.
- The page provides evidence-backed exclusion suggestions with examples of documents affected, and a bounded comparison excluding gitignored files. Partial coverage and failed comparisons stay visible, never reported as complete or faster.
- Failures offer a concrete next step: retry a cancelled/transient request, wait for an existing diagnostic, or manually inspect the identified project/configuration when bounded measurement cannot finish.

## Invariants

1. **No automatic deep scan.** A timeout captures cheap evidence; GET never starts the diagnostic. Only a deliberate POST starts it.
2. **No visibility mutation.** Diagnostics neither change normal file visibility nor write ignore files. Recommendations disclose consequences before any user edit.
3. **Project isolation.** The URL names the project; requests cannot fall back to whichever project was previously selected. Symlinks and nested repository/worktree boundaries cannot expose another project's paths.
4. **Report privacy.** Project-local paths belong only in the project-scoped response, never the intentionally anonymized performance report.
5. **Honest attribution.** Filesystem enumeration time is not git traversal time. Entry counts with different units are not interchangeable. Bounded sampling cannot prove the largest unvisited directory is cheap.

## Compatibility and costs

The page uses the reserved `/.vantage` namespace, so a directory or project named `scan-analysis` remains reachable. Existing recent-file traversal, cache behavior and ignore semantics remain unchanged except for cheap evidence capture.

A deliberate diagnostic consumes additional filesystem/git work and can warm caches; it is therefore not an uncontaminated replay of the failed scan. Its finite budget favors useful partial evidence over waiting for exhaustive attribution. Exact per-directory timings inside the past git invocation are unavailable and are not a delivery prerequisite.

## Non-goals

No automatic ignore-file editing, production restart, path-bearing perf-report export, new in-process git library, continuous profiler, or exhaustive tree census.

## Decision Ledger

| ID | Ruling / Decision | Date | Settled in | Built |
| :--- | :--- | :--- | :--- | :--- |
| D1 | Preserve cheap failure evidence; deeper work requires a deliberate request | 2026-10-25 | [Invariants](#invariants) | — |
| D2 | Label filesystem measurement as an approximation, not past git causality | 2026-10-25 | [Compatibility and costs](#compatibility-and-costs) | — |
| D3 | Use the reserved app namespace to preserve project/document URLs | 2026-10-25 | [Compatibility and costs](#compatibility-and-costs) | — |
