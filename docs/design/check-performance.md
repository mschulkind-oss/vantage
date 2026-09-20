---
title: "vantage-check performance — one parse per file, and six threads"
author: "Matt Schulkind"
date: 2026-09-20
status: accepted
tags: [vantage-check, vantage-md, performance]
summary: "Where a check run spends its time, the three duplicate parses that are now one, and why parallelism is worker threads capped at six rather than the core count."
vantage:
  status-chip: true
---

# vantage-check performance — one parse per file, and six threads

**Status:** IMPLEMENTED (2026-09-20). Every question ruled; the parse changes and
`--jobs` landed together.

**The short version.** Checking a large corpus was slow for two reasons, and
only one of them was "it does not use the other cores". A run parsed every
document **two to four times** — once for the rules, once inside the render rule,
and once or twice more whenever another document linked to it — so the single
biggest win was arithmetic rather than concurrency. With those removed, `check`
also shards its file list across worker threads by default.

Measured on a 32-core machine, median of five, compiled binary, a 110-file
corpus: **8206ms → 1966ms**, of which the sequential work accounts for 8206 →
4378 and the threads for the rest.

**The most important section is [§4.1](#41-worker-threads-not-processes-and-why-auto-stops-at-six)** —
this workload stops scaling at six threads and gets actively *slower* past it,
which is the one decision here that looks wrong until you see the numbers.

**Reads with:** [`agent-cli.md`](agent-cli.md) (the checker's design, whose P1
and the finding/failure split this inherits).

---

## 1. Verdict, and the principles behind it

Do both halves, sequential first. Ship parallelism on by default, with `--jobs`
to override and `--jobs 1` to turn it off.

Three principles, cited by number later:

**P1. A faster run that answers differently is not faster, it is broken.** The
checker's value rests on its report being trustworthy and diffable — the user
guide promises that "two runs over the same tree print the same bytes". A
parallel run has to produce the sequential run's bytes, not merely an equivalent
set of findings.

**P2. A thread that dies has not checked its files.** The finding/failure split
is the design the whole tool rests on: a validator that could not run reports
"unknown" (exit `3`), never "clean". A lost shard is exactly that case, and it
gets exactly that treatment.

**P3. Optimise by removing work, not by adding hardware.** Four parses per file
across six threads is still four parses per file. The duplicate work went first,
and it turned out to be worth more than the threads.

---

## 2. Where the time went

Instrumented per rule over this repository's `docs/` and `userguide/` (32 files),
before any of this:

| Step | Share | Per file |
| :--- | ----: | -------: |
| `render/pipeline` | 32% | 14.0ms |
| `loadDocument` (parse) | 21% | 9.2ms |
| `mermaid/parse` | 19% | 8.5ms |
| `link/*` | 15% | 6.6ms |
| `ref/*` | 8% | 3.4ms |
| everything else | 5% | 1.9ms |

Two things in that table are not what they look like.

**`render/pipeline` is mostly a parse.** Broken down on a 39 KB document:
`remark-parse` with GFM costs 21ms and the entire rehype chain after it — raw
HTML, sanitiser, slugs, highlighting, KaTeX, stringify — costs 10ms. So the
"expensive end-to-end backstop" was two thirds a second copy of work
`loadDocument` had already done.

**`mermaid/parse` is mostly a module load.** It is lazy already, but the first
`mermaid` fence in a run costs about 150ms to import; the diagrams themselves are
cheap. That number matters again in [§4.1](#41-worker-threads-not-processes-and-why-auto-stops-at-six),
because every thread pays it separately.

### 2.1 Four parses, for one file

The same bytes went through `remark-parse` up to four times:

1. [`loadDocument`](../../packages/vantage-check/src/core/document.ts), for the mdast every rule reads.
2. `renderMarkdown`, called by [`render.ts`](../../packages/vantage-check/src/rules/render.ts) with the document's *text*, which parsed it again.
3. `Workspace.documentAnchors`, when another document linked to this one — a fresh `readFileSync` and parse.
4. `Workspace.numberedHeadings`, when another document cited a `§` number in it — another fresh read and parse, because the two answers were cached separately.

In a cross-linked set, 3 and 4 apply to nearly every file: documents in a
directory link to each other, so almost every file the run checks is also a
*target* of one.

---

## 3. One parse per file

Three changes, each removing one of the duplicates above.

**The render rule renders the tree the rules already read.** `RenderOptions.tree`
in [`renderMarkdown.ts`](../../packages/vantage-md/src/renderMarkdown.ts) takes an
already-parsed body. `process` is `parse` then `run` then `stringify`; with the
tree in hand only the first is skipped, so it is the same processor with the same
plugins in the same order. The rule can do this safely because it runs **last** —
nothing reads the mdast after the pipeline has, so even a future plugin that
rewrote the tree in place could not change another rule's verdict.

> [!WARNING]
> The tree must come from this package's own remark half (`buildRemarkPlugins`,
> which is exported for exactly this). A tree parsed any other way renders
> through a chain the viewer does not use — the one thing the shared pipeline
> exists to prevent — and nothing can detect it: a tree is a tree.

**One heading pass answers everything about headings.** `indexDocument` in
[`slugs.ts`](../../packages/vantage-check/src/core/slugs.ts) returns the slugs, the
anchor set and the numbered-heading map from a single walk, and `Workspace`
caches that one index instead of two. This also makes an invariant the rules
already assumed *true by construction*: `github-slugger` is stateful — it appends
`-1` to a repeated heading — so two passes agreed only by being an identical
replay of each other.

**The workspace takes the documents the run has already parsed.**
`Workspace.offer` derives the cached answers from a `Document` at load time, so a
target the run has already reached costs nothing at all.

> [!IMPORTANT]
> `offer` credits a non-Markdown file with **no anchors**, exactly as reading it
> from disk would. A file named on the command line is checked whatever its
> extension, so `notes.txt` reaches `offer` with an mdast anyway — and crediting
> it with headings would make `notes.txt#missing` a finding that a sequential
> reader never produces. Faster and differently-answering is P1's failure mode,
> and this is where it was one guard away.

Result, before any threads: **8206ms → 4378ms** on the 110-file corpus, and
1836ms → 1247ms on this repository's own docs.

---

## 4. Parallelism

Every file is an independent unit of work — no rule writes anything another
file's rule reads — so the only shared state is `Workspace`, and that is a
*cache* rather than a channel. Each thread builds its own and answers the same
questions, just without the benefit of what the others already looked up. That is
the entire cost of parallelism here.

### 4.1 Worker threads, not processes, and why `auto` stops at six

Wall clock on a 32-core machine, compiled binary, median of 3–5:

| Files | 1 | 3 | 6 | 8 | 16 | 32 |
| ----: | ----: | ----: | ----: | ----: | ----: | ----: |
| 36 | 1261ms | 1008ms | 1202ms | 1304ms | — | — |
| 110 | 4378ms | 2318ms | 1966ms | 2238ms | 3778ms | 7995ms |
| 750 | 22857ms | — | 6153ms | 6485ms | 9123ms | 17901ms |

Past six threads the run gets **slower**, and the cause is visible in CPU rather
than wall time. Total CPU for one 110-file run:

| Threads | 1 | 4 | 8 | 16 | 32 |
| :--- | ----: | ----: | ----: | ----: | ----: |
| user+sys | 6.6s | 11.5s | 16.8s | 33.1s | 72.0s |

Each thread initialises the binary's 3000-odd modules in a fresh JavaScript VM —
300ms of CPU even for a thread that then checks one three-line document — and
that cost does not stay constant as threads are added. Ten times the CPU for the
same work is not contention on a lock; it is real work being repeated and then
competing with itself.

So `auto` is `min(cores, 6, files / 12)`. Six is the best or within 1% of the
best at every corpus size measured, which is why it does not simply take the core
count. A machine whose runtime scales further is what `--jobs` is for.

> [!NOTE]
> **Child processes scale further, and are not what shipped.** The same 750-file
> corpus, split across N independent processes each running `--jobs 1`: 4851ms at
> 8 and 3920ms at 16, against 6485ms and 9123ms for threads. Processes get a
> genuine 1.6× beyond what threads reach, because each one is a fresh runtime
> with nothing to contend over.
>
> It is not free, though: a process shard needs a request and a response over
> stdio, and it needs to reconstruct the command that re-runs this program —
> which differs between the compiled binary and a run from source, and can only
> be told apart by sniffing at `process.argv`. That is a second mechanism and a
> new class of failure (orphans, signals, a half-written response) for 1.6× on
> corpora above a few hundred files. Threads first; this is the measurement to
> come back to if it is ever not enough.

### 4.2 The worker is this program's own entry point

A thread runs [`main.ts`](../../packages/vantage-check/src/main.ts) again, with
`isMainThread` false, rather than a worker module of its own. That is not a
shortcut — it is the only arrangement that works in the shipped artifact.
`bun build --compile` puts every module *inside* the executable, so a separate
`checkWorker.js` is not a path anything can load:

```text
error: Cannot find module '/$bunfs/root/checkWorker.js'
```

Adding it as a second build entry point does not help either; it lands in the
bundle under a name the parent cannot address. The entry point, by contrast, is
addressable from inside the bundle *and* is a real file when the program is run
from source, so both environments take the same route.

`main.ts` registers the URL rather than `parallel.ts` deriving it. In the
compiled binary `import.meta.url` is the executable from anywhere in the bundle,
so deriving it would work there — and would silently produce a thread listening
to nothing when run from source, where it is the module's own path.

### 4.3 Sharding: contiguous, and weighted by bytes

Shards are **contiguous slices of the sorted file list**, sized by total bytes
rather than file count:

- *Contiguous*, because documents that link to each other live near each other in
  a sorted list. Dealing files round-robin would make every thread re-read every
  other thread's targets.
- *By bytes*, because cost tracks length closely — the two dominant steps are a
  parse and a render of the same text — and the spread is wide. This repository's
  own documents run from under 1 KB to 46 KB, so six equal-count shards would
  have one thread doing several times the work of another, and the run would take
  as long as that thread.

The cut goes where a shard lands **closest** to its share, not at the first file
that reaches it. A "cut when full" rule has a specific failure: one 100 KB
document at the end of a run of small ones means no prefix ever reaches a
half-share, so the whole list stays in one shard and every other thread idles.

### 4.4 Determinism is structural, not sorted

Shards are merged in shard order and each ran its files in list order, so the
merged report is the sequential report — including `failures`, which the report
layer never sorts. Nothing here depends on which thread finished first (P1).

This is asserted where it can actually be asserted: `just check` runs the
compiled binary over this repository's docs twice, at one thread and at four, and
diffs the JSON. The unit tests cannot start a thread — a worker loads the entry
point, which is TypeScript in the source tree — so they drive the same `RunShard`
seam in-process and the gate drives the threads.

### 4.5 A shard that never answers

A thread that dies, runs out of memory, or throws where nothing catches it
becomes one `run/shard` **failure** naming the files it was holding, so the run
exits `3` and says which documents were not checked. The other shards' findings
are still reported, and `filesChecked` counts only what was really checked (P2).

The `exit` handler matters as much as the `error` one: a thread that exits
without posting a response would otherwise leave the run waiting forever, and a
hang is a worse answer than a failure.

### 4.6 The option surface

| How | What |
| :--- | :--- |
| `--jobs <n>`, `-j <n>` | Exactly this many threads, capped at one per file. |
| `--jobs auto` | The default: `min(cores, 6, files / 12)`. |
| `--jobs 1` | No threads at all — the check runs in the calling thread. |
| `VANTAGE_CHECK_JOBS` | The default for a machine. `--jobs` beats it. |

**There is deliberately no `jobs` key in `.vantage.toml`.** How many threads to
use is a fact about the *machine*, not about the repository: a committed
`jobs = 16` is wrong for everyone who checks the tree out on a laptop. The
environment variable is the durable home for a machine-level default, which is
what a CI runner wants.

A `VANTAGE_CHECK_JOBS` that is not a thread count is a usage error (exit `2`),
not a silent fall back to `auto`. A typo in the variable would otherwise make an
explicit choice disappear with nothing said.

---

## 5. What this does NOT propose

- **No in-process git library, no server, no network.** Unchanged: the checker
  still answers every question from files on disk.
- **No faster Markdown parser.** `remark-parse` at roughly 1.9 MB/s is the floor,
  and it is not negotiable — parsing the way the viewer parses *is* the
  checker's claim. The win was parsing once, not parsing differently.
- **No thread pool with work stealing.** One shard per thread, decided up front.
  Byte weighting captures most of the variance, and dynamic dispatch would trade
  the cache locality of [§4.3](#43-sharding-contiguous-and-weighted-by-bytes)
  for balance this workload does not need at six threads.
- **No cache between runs.** Nothing is written to disk. A `.vantage/`
  content-hash cache would beat every number here on a re-run, and it is a
  separate design with a separate invalidation problem.

---

## 6. Results

Median of five, compiled binary, 32-core machine:

| Corpus | Before | Sequential wins | With `auto` |
| :--- | ----: | ----: | ----: |
| 36 files (this repo's docs) | 1836ms | 1247ms | 1008ms |
| 110 files | 8206ms | 4378ms | 1966ms |
| 750 files | ~47s (est.) | 22857ms | 6153ms |

The 750-file figure before the parse work was not measured directly; it is
scaled from the 110-file ratio, and it is marked as an estimate for that reason.

---

## 7. What is left on the table

- **Child-process shards**, worth a further 1.6× above a few hundred files. The
  measurement and the cost are in [§4.1](#41-worker-threads-not-processes-and-why-auto-stops-at-six).
- **One tree walk for `ref/*` instead of three.** `checkOqReferences`,
  `checkSectionReferences` and `checkFileReferences` each walk the document
  separately. Worth about 2% now that the parses are gone — not worth the risk to
  three rules' position arithmetic today.
- **A cheaper module graph.** 300ms of per-thread CPU is module initialisation,
  and `katex` and `highlight.js` are most of it. They are needed by the render
  rule, so laziness would not help a worker — but a thread that could skip them
  would raise the ceiling in [§4.1](#41-worker-threads-not-processes-and-why-auto-stops-at-six).

---

## Decision Ledger

| ID | Ruling / Decision | Date | Settled in |
| :--- | :--- | :--- | :--- |
| OQ-CP1 | Remove the duplicate parses before adding threads — four parses across six threads is still four parses. | 2026-09-20 | [§3](#3-one-parse-per-file) |
| OQ-CP2 | Pass the already-parsed tree into `renderMarkdown` rather than re-parsing; safe because the render rule runs last. | 2026-09-20 | [§3](#3-one-parse-per-file) |
| OQ-CP3 | Worker threads, not child processes, despite processes measuring 1.6× better — one mechanism, no argv reconstruction. | 2026-09-20 | [§4.1](#41-worker-threads-not-processes-and-why-auto-stops-at-six) |
| OQ-CP4 | `auto` caps at six threads, not the core count, because past six this workload gets slower. | 2026-09-20 | [§4.1](#41-worker-threads-not-processes-and-why-auto-stops-at-six) |
| OQ-CP5 | The worker entry is the program's own entry point, registered by `main.ts`, because a compiled bundle has no second loadable module. | 2026-09-20 | [§4.2](#42-the-worker-is-this-programs-own-entry-point) |
| OQ-CP6 | Contiguous byte-weighted shards, cut closest to the share rather than when full. | 2026-09-20 | [§4.3](#43-sharding-contiguous-and-weighted-by-bytes) |
| OQ-CP7 | `--jobs` and `VANTAGE_CHECK_JOBS`, but no `.vantage.toml` key — thread count is a property of the machine, not the repository. | 2026-09-20 | [§4.6](#46-the-option-surface) |
| OQ-CP8 | A lost shard is a `run/shard` failure naming its files (exit `3`), never a quietly shorter clean run. | 2026-09-20 | [§4.5](#45-a-shard-that-never-answers) |
