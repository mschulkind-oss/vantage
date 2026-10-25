---
status: accepted
stage: CURRENT
verified: 2026-10-25
verified_commit: 1a4e736
covers:
  - internal/git/service.go
  - internal/git/scan_analysis.go
  - internal/ignore/ignore.go
  - internal/ignore/diagnostic.go
  - internal/ignore/diagnostic_test.go
  - internal/api/scan_analysis_handlers.go
  - internal/api/routes.go
  - internal/server/scan_analysis_test.go
  - frontend/src/pages/ScanAnalysisPage.tsx
  - frontend/src/components/AppShell.tsx
  - frontend/src/components/DegradedBanner.tsx
  - frontend/src/lib/scanAnalysisRoute.ts
  - frontend/src/lib/scanAnalysisIgnoreRule.ts
  - frontend/src/stores/useRepoStore.ts
  - frontend/e2e/scan_analysis.spec.ts
---

# Recent-file scan analysis

**Status:** Verified 2026-10-25 against `1a4e736`. MEASURED: backend filesystem/process fixtures and browser navigation/results checks exercised the feature; production scan savings are not measured.

A `walk_timeout` warning offers **Analyze recent-file scan** for its project.
The page separates previously captured scan evidence from an optional bounded
investigation. Opening it starts no tree, recent-file or planning-source scan.
The sidebar's file tree and recent list are paused here; returning to ordinary
project pages restores their normal loading behavior.

## Routes and scope

The application reserves `/.vantage/scan-analysis` for a single project and
`/.vantage/scan-analysis/:repo` for multiple projects, with an encoded project
segment. A project or document named `scan-analysis` keeps its ordinary URL.
The route chooses `/api/git/scan-analysis` or
`/api/r/:repo/git/scan-analysis`, never a previously selected project's API.
Invalid project routes show a recovery link rather than falling back to another
project. Static exports have no diagnostic server.

GET reads captured evidence only and returns `diagnostic: null`. POST runs the
reader's deliberate diagnostic, with cancellation from the request context.
Neither accepts a filesystem target or caller-supplied budget. Both use the
existing repository route scope and return `Cache-Control: no-store`.

Both responses contain nullable `evidence` and `diagnostic` members. Evidence
fields are `command`, `directory`, `elapsedMs`, `timeoutMs`, `gitignored`,
`timedOut`, optional `error`, `unknown_failures` and `settings`; settings contain
`show_hidden`, `use_ignore_files`, `exclude_dir_count` and nullable
`walk_max_depth` (null means unlimited). A diagnostic contains `method`,
`partial`, `reason`, `elapsedMs`, `entries`, `directories`, `comparison` and
`recommendations`. Directory rows contain `path`, `elapsedMs`, `entries` and
`examples`; recommendations contain `path`, `reason` and `examples`. The
comparison contains `status`, `elapsedMs`, `entries` and `reason`. Result arrays
serialize as arrays, not null. Errors use the existing `{error: string}` envelope.

## Recorded evidence

The normal untracked-file query records its command description, elapsed and
timeout milliseconds, inclusion of Gitignored entries, timeout/error state,
relative directory and settings. Configured ignore-file paths and patterns in
the command description are redacted; it is not an exact copyable command.
Errors are allowlisted descriptions, not raw Git stderr.

Evidence lives in memory, shared with delegated child scans. Failures are keyed
by relative directory and Gitignored mode; a different successful child does not
clear them. GET selects the most recently recorded retained failure, otherwise
the latest completed report. A matching successful normal scan clears its
failure and the corresponding timeout warning. The legacy walk callback keeps
only its original identity fields, so timing/settings cannot prevent clearance.

At most 64 failing identities are retained. `unknown_failures` counts omitted
failure reports whose completion state is unknown, not distinct current failing
directories. Missing evidence and this overflow remain explicit in the page.
This is bounded current evidence, not a durable history of every invocation.

## Measurements and limits

The diagnostic samples current filesystem directory entries. Each row reports
direct `ReadDir` elapsed time and direct entry count, **not** recursive subtree
time, disk size, metadata-check cost, or attribution of the earlier Git command.
Rows rank by read time, then entry count and path, with millisecond display
rounding. Total elapsed time includes traversal, filtering and comparison work.
Unvisited directories remain unknown even when the retained rows look cheap.

The walk uses `os.Root` confinement, skips symlinks, linked worktrees, `.git`,
root `.vantage` state and configured exclusions, applies enabled Vantage ignore
files and depth limits, and stops at nested repositories when `stop_at_repos`
is enabled. Completion means this filtered scope completed, not a raw census.
It does not change ordinary visibility or write ignore files. Enabled user and
workspace ignore files are loaded into an immutable, bounded one-run matcher,
using the existing parser and layering semantics. Matching never reloads those
files during the probe. Unreadable, non-regular, oversized or cancelled inputs
return partial/unknown without walking or comparing under guessed visibility.
Ordinary viewer/watch/recent-file matchers keep their existing reload behavior.

| Bound | Value | Code |
| :--- | :--- | :--- |
| Overall deadline | 5 seconds, cooperative | `ScanAnalysis` |
| Counted filesystem entries | 10,000 | `scanAnalysisEntryLimit` |
| Directory visits/queue | 1,024 | `scanAnalysisDirectoryCap` |
| Directory read batch | 128 entries | `scanAnalysisBatchSize` |
| Retained directory rows | 20 | `scanAnalysisDirResults` |
| Examples per row | 3 | `scanAnalysisExamples` |
| Excluding-Gitignored probe | 2 seconds within the overall deadline | `compareGitignored` |
| Raw comparison records | 10,000 | `scanCompareEntryLimit` |
| Comparison NUL-delimited record | 64 KiB including terminator | `scanComparePathByteLimit` |
| Aggregate comparison stdout | 16 MiB | `scanCompareOutputLimit` |
| Ignore-file input, combined | 1 MiB; 4,096 lines; 4 KiB per line | `diagnosticIgnoreByteLimit`, `diagnosticIgnoreLineLimit`, `diagnosticIgnoreLineBytes` |
| Active diagnostics | One per server process; others receive HTTP 429 | `scanAnalysisSlots` |

Filesystem calls blocked inside the kernel cannot be forcibly interrupted, so
the deadline is not a hard real-time wall-clock guarantee. Git cancellation
closes the stdout reader as well as cancelling the process, including when a
helper retains a pipe. Early decoder termination kills and waits for Git;
malformed, unterminated or oversized output is partial, preserving only valid
prefix counts/examples. Cancellation or a budget breach never proves coverage.

## Gitignored comparison

The bounded probe runs Git `ls-files --others -z --exclude-standard` in the
project root with configured Vantage exclusions. It explicitly uses
`--no-optional-locks` and `-c core.fsmonitor=false`, avoiding a configured
filesystem-monitor helper. Its count is Markdown pathspec matches, not the
filesystem sample's entry count. Examples additionally apply hidden-file,
symlink, depth and repository-boundary visibility rules.

`completed` means this probe completed; `partial`, `unavailable` and `unknown`
remain visible. A loose directory without a Git root cannot supply this
comparison. Probe timings, filesystem timings and past invocation timings have
different work and cache conditions: they do not establish a speedup or identify
the original timeout's cause. Running diagnostics can warm caches.

## Exclusion consequences

Up to three measured non-root directories with observed untracked,
non-Gitignored Markdown examples can become recommendations. A directory needs
at least 50 direct entries or 5 ms direct read time. Examples are affected
paths, not a complete inventory; tracked and Gitignored documents can also be
hidden by a new rule even though these examples do not list them.

An anchored directory rule in the project's `.vantageignore` targets the
measured subtree rather than excluding every directory sharing its basename.
It affects file listings, recent documents and live reload when
`use_ignore_files` is enabled. With that setting disabled or unknown, the page
says to enable/check it or manually configure `exclude_dirs`; directory-basename
exclusions can be broader than the measured relative subtree.

The existing matcher cannot safely quote every legal directory name. Suggestions
with unsupported question marks, brackets, backslashes, regex operators,
control characters, trailing spaces in any segment, invalid UTF-8 or replacement
characters are withheld rather than changing the parser. Replacement-character
names are conservatively manual-only even when legitimate, because lossy JSON
names cannot be distinguished safely. The measurements and examples remain,
with manual inspection/rename guidance. The page never
writes a rule or changes settings itself.

## Failure handling and verification

The page provides request cancellation, evidence retry and diagnostic rerun,
rejects stale cross-project responses, distinguishes partial comparison from
success, and offers next steps for unknown results. HTTP 429 asks the reader to
wait for the existing diagnostic instead of starting more work.

Permanent tests live in `internal/git/scan_analysis_test.go`,
`internal/api/scan_analysis_handlers_test.go`,
`internal/server/scan_analysis_test.go`, the page/route/shell/banner frontend
tests, and `frontend/e2e/scan_analysis.spec.ts`. The browser fixture checks a real
bounded POST through the served project API, encoded project names, zero automatic
tree/recent/planning-source requests, explicit
POST, partial/unknown results, narrow-screen wrapping and timeout-warning
navigation. The intentionally anonymized performance report retains its existing
aggregate schema; project paths stay in the project-scoped analysis response.

See [large-project configuration](../../userguide/reference/configuration.md#when-a-project-is-too-big-to-serve-well)
and [timeout warning behavior](serve-clones-directory.md#74-the-banner).
