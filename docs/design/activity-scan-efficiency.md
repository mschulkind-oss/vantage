---
title: "The activity warm was reading the whole disk every 30 seconds"
date: 2026-10-10
status: in-review
stage: DESIGN
next: "Rule OQ-1 and OQ-2 — whether the timer survives, and what `last_activity` means"
tags: [performance, daemon, disk-io, watcher]
summary: "The daemon's 30s last-activity warm ran four git processes per repository, including an unexcluded working-tree walk, with no concurrency limit. It now prunes excluded trees at the git level, caps the fan-out, and skips a repository whose watcher reports no change. Two questions ask whether the timer should survive at all."
---

# The activity warm was reading the whole disk every 30 seconds

**Status:** 2026-10-10. The bounded warm is built and green at `51f4b668`;
the two questions below ask whether it goes further.

> **In short.** `last_activity` is one timestamp on the project list, and the
> daemon was computing it by running four git processes per repository —
> including an unexcluded `git ls-files --others` that walked `node_modules` —
> every 30 seconds whether anything had changed or not. The walk is now pruned
> at the git level, the fan-out is capped, and a repository whose watcher
> reports no change is not walked at all.

**Why it matters.** On a host serving about twenty repositories from one
spinning disk, the unbounded fan-out launched on the order of ninety concurrent
git processes per pass and saturated the disk (`/data` at 99% busy, 64–67%
iowait, twenty-one processes waiting). The cost was invisible in `perf-report`:
the warm and a reader's recents recorded one operation name.

**The shape.** Three changes, none of which a reader can see: the untracked walk
takes `--exclude` for every configured excluded directory and the warm takes
`--exclude-standard`; `warmActivity` probes only repositories whose watcher
change counter advanced, under a four-way limit, with a ten-minute forced
reconciliation; and each git subprocess is timed as `exec:<subcommand>` so the
walk's own cost stops hiding inside a request's.

**Cost.** An ignored `.md` no longer counts as activity — it was never visible to
a reader. A change the watcher misses can leave `last_activity` stale for up to
ten minutes.

**Start at [§2](#2-the-bounded-warm)** — the three changes. [§4](#4-open-questions)
is what needs a ruling.

**Needs your ruling:** [OQ-1](#OQ-1), [OQ-2](#OQ-2).

**Reads with:** [`serve-clones-directory.md`](../reference/serve-clones-directory.md)
(the walk-timeout behaviour this leaves untouched).

---

## 1. What was happening

`refreshLoop` (`internal/server/server.go`) ticks every 30 seconds
(`defaultRefreshInterval`) and ends each pass in `warmActivity`, which called
`rs.git.RecentsUnreported(1, nil, true, true)` for every repository
concurrently, with no limit.

The full recents pipeline is four git processes: a fifty-commit `git log`, the
untracked discovery, a `status --porcelain -uno`, and a staged-name diff
(`internal/git/service.go`, `computeRecents`). The untracked probe is the one
that reads the working tree, and its last argument — `showGitignored=true` —
dropped `--exclude-standard`, so git descended into every ignored directory
looking for `*.md`. A `node_modules` full of published `README.md` files is the
worst case, and a pathspec does not save it: a directory is pruned only when the
pathspec cannot match anything below it.

The result was a value nobody had asked to be fresh. `last_activity` reaches the
frontend only through `GET /repos`, which sorts the project picker by it
(`frontend/src/stores/useRepoStore.ts`). The walk also defeated its own cache:
the warm asked for `limit=1`, a reader defaults to `limit=10`, and the recents
cache key includes the limit, so the warm never primed the entry a reader would
use.

## 2. The bounded warm

Three orthogonal changes, each landing on its own axis.

**Pruning at the git level.** `GitService.walkExcludeArgs` now emits
`--exclude=<name>` for every configured `ExcludeDirs` entry — `node_modules`,
`dist`, `build`, `target`, `.cache`, and the rest — before the layered
`--exclude-from` ignore files. The walk's post-filter already discarded those
paths, but only after git had read every directory. The warm additionally passes
`showGitignored=false`, so `--exclude-standard` applies too. This is the change
that removes the disk traffic.

**Gating on the watcher.** `live.Watcher` counts flushed change batches
(`Changes`). `warmActivity` records the count it probed under and, on the next
pass, reuses a repository's cached `RepoInfo` when the count has not moved. A
repository with no watcher is always probed, because nothing else can say whether
its activity moved. Every `activityReconcileEvery` (20) passes, every repository
is probed regardless, which bounds how long a change the watcher missed — a
failed watcher, an overflowed event queue, a folder the watch limit refused — can
stay invisible. The gate is `shouldProbeActivity`, a pure function so the
decision is testable without a live watcher.

**Capping the fan-out.** `warmActivity` runs its probes through an `errgroup`
with `SetLimit(activityWarmConcurrency)` (4). The number is a constant, not a
knob, until a measurement asks for one.

## 3. Stats and host access

Two stats changes make the next diagnosis possible. Each git subprocess is timed
as `exec:<subcommand>` in `GitService.run`, so `exec:ls-files` is legible apart
from `exec:log`. And the warm's recents run records `activity_warm_recents`
instead of `get_recently_changed_files`, so a background walk no longer inflates
the latency of a user-facing request. The warm logs `probed`/`repos` each pass.
Parameterized routes added since the middleware (`/themes/{id}`, `/spaces/{id}`,
the review comment and reply ids) collapse to `*` in `by_endpoint`, which they
did not before, so their percentiles stop fragmenting.

For the host side, the jail's `yolo-jail.jsonc` enables the `host-processes` and
`journal` loopholes. `yolo-ps --tree` names the disk-heavy process and every
descendant of it; `yolo-journalctl` reads the user-scope log. The `host-processes`
`visible` allowlist includes `git` and `vantage`, which is what answers "who is
holding the disk" directly. `journal.settings.full` is user-scope only and needs a
host-side edit to read beyond `--user`. The Prometheus/Grafana stack on
`begonias.lan` is reachable from the jail but monitors a different machine (the
NAS, not this jail's host), so it is the wrong tool for this particular question.

## 4. Open Questions

1. 💬 **OQ-1: Does the 30-second timer survive at all?**

   <!-- vantage: question id=OQ-1 leaning="Not as a scanner. Keep the gated timer as the backstop, and move the value itself to the watcher, which already receives every Markdown write and every real .git state change." -->

   _Leaning:_ Not as a scanner. The watcher already knows when a document
   changes; the timer is only needed to repair the cases it cannot see. That
   would make `last_activity` update immediately on a save instead of up to
   thirty seconds later, and cost zero git processes on a quiet machine.
   The gated timer shipped here is the safe step toward it; deleting the walk
   from the timer needs the seed and the reconciliation fallback designed.

2. 💬 **OQ-2: What does `last_activity` mean?**

   <!-- vantage: question id=OQ-2 leaning="Newest visible Markdown mtime, ignoring gitignored files — which is what the warm now computes." -->

   _Leaning:_ The newest modification time among Markdown a reader could be
   shown, which is what the warm now computes. The alternatives are the newest
   commit time (blind to uncommitted work, and rewritten by rebase) and the
   newest change the watcher saw (fresher for edits, but coarser and dependent
   on a healthy watch set). The field only sorts the project picker, so the
   cheapest honest definition should win.

## 5. Decision Ledger

| ID | Question | Ruling | Date |
| :--- | :--- | :--- | :--- |
| — | No rulings yet. | | |
