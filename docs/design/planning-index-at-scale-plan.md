---
title: "The planning index at scale — implementation plan"
status: draft
stage: SKETCH
next: "Held at sketch until OQ-PS1 is ruled; then WP-A and WP-B go first, in parallel"
depends-on:
  - planning-index-at-scale.md#OQ-PS1
tags: [planning, implementation-plan, performance]
summary: "Build hand-off for the planning index at scale: seven work packages with disjoint file sets, the contracts between them, the tests that prove each behavior, and a test strategy that proves every limit by configuring it down."
---

# The planning index at scale — implementation plan

**Design:** [`planning-index-at-scale.md`](planning-index-at-scale.md) · **Status:** SKETCH,
2026-09-29. It was completed against the tree at `70a05b3` and is held at sketch only because
[OQ-PS1](planning-index-at-scale.md#OQ-PS1) and [OQ-PS2](planning-index-at-scale.md#OQ-PS2) are
open. The entries that rest on them say so, and nothing is built from this file until both are
ruled.

**Precedence.** The design wins on behavior. The tree wins on fact: when a file has moved or a
helper is gone, follow the tree and say so in the commit. This plan is advice, and it is the first
thing to be wrong. Never twist the code to match it.

**Terms.** A *work package* (WP) is a slice with its own file set, built in its own worktree
under `/workspace/.worktrees/` and cherry-picked. The *limits module* (coined here) is
`frontend/src/planningScan/limits.ts`: every number the design fixes, in one object that tests
override. Every other term is the design's
([§3](planning-index-at-scale.md#3-terms)).

## Order of work

1. **WP-A (vantage-md) and WP-B (Go), in parallel.** Nothing else codes without A's types.
2. **WP-C (worker, client, cache)** after A. Its e2e needs B.
3. **WP-D (the store)** after C.
4. **WP-E (the planning page) and WP-F (stable first paint)**, in parallel, after D.
5. **WP-C2 (helpers)** after E, in C's own files.
6. **Cleanups:** A2 after E deletes `questionCardSource`, its outline cache and
   `parsePlanningSources`; B2 after D turns the old batch into `410`.
7. **WP-G (docs)** after E and F.

One release carries all of it ([§18](planning-index-at-scale.md#18-sequencing)). Tag nothing
between the steps.

## Shared contracts

What the WPs code against. Changing one after A or C lands is a coordinator decision.

### vantage-md planning module (A provides; C, D and E consume)

```ts
// scan.ts: two new question fields, and the blocks beside the facts
export interface PlanningQuestion { /* …existing… */ unitEndLine: number; cardChars: number }
export interface CardBlock { startLine: number; endLine: number; markdown: string; lineOffset: number }
export type ScanResult =
  | { kind: "planning"; document: PlanningDocument; cards: CardBlock[] } // one per distinct block, every size
  | { kind: "not-planning" }
  | { kind: "unreadable"; reason: string };

// model.ts
export type ScannedEntry =
  | { kind: "file"; path: string; hash: string; result: ScanResult }
  | { kind: "skipped"; path: string; size: number }
  | { kind: "unreadable"; path: string; reason: string }
  | { kind: "absent"; path: string };
export function applyScanned(index: PlanningIndex, entry: ScannedEntry): PlanningIndex; // applySource = scan + this
// PlanningIndexBuilder gains: addResult(path: string, result: ScanResult): PlanningDocument | null
export type StreamLine =
  | { kind: "header"; config: PlanningConfig; candidateCount: number; refused: boolean }
  | { kind: "same"; path: string; hash: string }
  | { kind: "file"; path: string; hash: string; content: string }
  | { kind: "skipped"; path: string; size: number }
  | { kind: "unreadable"; path: string; reason: string }
  | { kind: "end"; candidates: number };
export function parseStreamLine(json: unknown): StreamLine | null; // as strict as parsePlanningSources
export function cardBlockFor(cards: readonly CardBlock[], q: PlanningQuestion): CardBlock | undefined;
```

`buildPlanningIndex` and the `PlanningSources` type stay, because `vantage-check` builds from
its own walk. Only the wire reader `parsePlanningSources` goes, in A2.

### The stream's lines (B provides; C consumes)

The shapes are the design's ([§6.1](planning-index-at-scale.md#61-the-stream)). B writes
`internal/planning/testdata/stream-lines.ndjson`, one example of every kind, and its Go test
marshals each kind and compares byte for byte. C's test reads each line through
`parseStreamLine`. One file holds the two sides to one shape, as `planning-patterns.json` already
does for the matcher.

### The scanner client (C provides; D, E and F consume)

```ts
export interface ScannerClient {
  build(req: { repo: string; seq: number; bypassCache: boolean }, on: (e: BuildEvent) => void): void;
  cancel(repo: string, seq: number): void;
  refresh(req: { repo: string; seq: number; path: string }): Promise<ScannedEntry | null>; // null: failed
  cards(repo: string, want: { path: string; hash: string; startLine: number }[],
        opts?: { full?: boolean }): Promise<({ path: string; block: CardBlock } | { path: string; startLine: number; stale: true })[]>;
  quotes(repo: string, want: { path: string; hash: string; lines: number[] }[]): Promise<Record<string, Record<number, string>>>;
}
export type BuildEvent =
  | { type: "started"; warm: boolean }
  | { type: "header"; config: PlanningConfig; candidateCount: number; refused: boolean }
  | { type: "documents"; docs: { document: PlanningDocument; hash: string }[];
      unreadable: { path: string; reason: string }[]; skipped: { path: string; size: number }[] }
  | { type: "progress"; done: number; total: number }
  | { type: "ready" }
  | { type: "failed"; message: string; shape: boolean }; // shape: the first line was not a header
export function planningScanner(): ScannerClient;                  // the one instance, made at boot
export function setPlanningScannerForTests(c: ScannerClient | null): void;
```

## WP-A — card blocks and the scanned entry (`packages/vantage-md`)

| Path | Change |
| :--- | :--- |
| `packages/vantage-md/src/planning/scan.ts` | `unitEndLine` beside `unitLine` (`:580`); cut `cards` from `root` between `parseBody` (`:1009`) and `readAlerts` (`:1013`); `cardChars` per question |
| `packages/vantage-md/src/planning/cardSource.ts` | `outlineOf(root, bodyLineOffset)` takes a parsed root: no parse, no cache. The cutter builds `CardBlock`s from it. `questionCardSource` stays as a scan-then-pick wrapper until A2 |
| `packages/vantage-md/src/planning/model.ts` | `addResult`, `applyScanned`, `ScannedEntry`, `StreamLine`, `parseStreamLine` |
| `packages/vantage-md/src/planning/index.ts` | the exports above |
| `frontend/src/test/planning.ts` | `scannedOf(tree)`: the scanned entries and blocks of a tree, for C, D and E |
| `frontend/src/lib/planningCard.test.ts` | rewritten: the agreement below, with today's parse-based outline moved in as the test's oracle |
| `frontend/src/lib/planningScan.test.ts`, `planningIndex.test.ts` | the cases below |

**Reuse.** `definitionText` and `holdsFootnote` (`cardSource.ts:22-37`) move unchanged. The
builder's sort-once `finish` (`model.ts:225-257`) stays; `add` becomes `scan` plus `addResult`.

**Traps.**

- **Cut before `readAlerts`.** It rewrites blockquote children in place. The outline reads only
  root spans and `definition` nodes, which it leaves alone, but cutting first means nobody has to
  prove that.
- **Footnote questions.** A question found while walking `state.footnotes` (`:1034-1037`) has
  the footnote's root child as its block, and that block holds a footnote, so its card is the
  whole document with `lineOffset` 0, and `cardChars` is `source.length`. The agreement test
  covers it; do not special-case it.
- **`scan.ts` and `cardSource.ts` import each other** until A2: the scan calls the cutter, and
  the wrapper calls the scan. Both export only functions, so the cycle is inert. A2 removes it.
- **`unitEndLine` has no DOM twin.** A rendered `<li>` carries only its start line, so test it
  against mdast positions, not in `planningAgreement.test.tsx`.
- **`vantage-check index --format json` grows two fields.** `packages/vantage-check/test/index.test.ts:237`
  compares the payload with `buildPlanningIndex` itself, so it follows. Nothing to edit there.

**Tests** (`npm run test -w frontend -- planning`):

- Agreement: for every question in `docs/`, the gallery and the e2e fixtures, the new block's
  `markdown` and `lineOffset` equal the oracle's, byte for byte. That includes the footnote case,
  a reference-style link and a root-level directive run.
- One block per distinct root child: [`agent-bootstrap.md`](agent-bootstrap.md)'s five questions
  give one block.
- `unitEndLine`: a list item, a nested item, a bare paragraph, a blockquote, a heading.
  `cardChars` equals `markdown.length`.
- `applyScanned` returns the index itself when nothing changed (today's `applySource` case).
  `addResult` plus `finish` equals `buildPlanningIndex` over the same tree.
- `parseStreamLine` refuses a missing field, a wrong type, an unknown kind and a non-object.

**A2 (after E):** delete `questionCardSource`, the wrapper and `parsePlanningSources`, with their
exports.

## WP-B — the stream, one path's hash, reviews in one request (Go)

| Path | Change |
| :--- | :--- |
| `internal/planning/read.go` | `read` returns the content hash beside the content (`:71-126`) |
| `internal/planning/stream.go` | new: `WriteStream(w, listing, cfg, have)`, the design's lines, flushing through a `Flusher` |
| `internal/planning/sources.go` | `Entry` gains `hash` for `file`; B2 deletes `WriteBatch` (`:46-108`) |
| `internal/planning/testdata/stream-lines.ndjson` | new: the shared example lines |
| `internal/api/planning_handlers.go` | `PlanningStream` (body capped by `http.MaxBytesReader`, gzip when accepted), `PlanningReviews`; B2 answers the batch with `410` |
| `internal/api/routes.go` | `POST /planning/stream`, `POST /planning/reviews`, beside `:68` |
| `internal/api/planning_handlers_test.go`, `internal/server/planning_test.go` | the cases below; the batch tests (`:86-140`) rewritten onto the stream |

**Reuse.** `Candidates(listing.ListAllFiles(), matcherFor(cfg))` and `newReader` exactly as
`WriteBatch` uses them. `planningConfig(svc)` for the config. `decodeBody`
(`review_command_handlers.go:70`) behind a `MaxBytesReader`. `h.deps.Reviews.Get(path, repo)`
for each review. `http.NewResponseController(w).Flush()`, which reaches the connection through
`perf`'s `statusRecorder.Unwrap` (`internal/perf/middleware.go:38`).

**Traps.**

- **Gzip and flushing:** flush the `gzip.Writer` before the `ResponseController`, or the header
  line sits in the compressor.
- **The roadmap is never `same`**, whatever `have` says.
- **`end` is written after the loop, even when refused.**
- **A write error means the client went away.** Stop, log at debug, as the batch does (`planning_handlers.go:53-57`).
- **No server timeouts are set** (`cmd/vantage/serve.go:165`), so a slow worker holds the
  connection. That is intended backpressure; do not add a write deadline.

**Tests** (`go test ./internal/planning/... ./internal/api/... ./internal/server/...`):

- Every kind of line and its order. `same` only on an equal hash. The roadmap as `file` despite
  `have`. Refused: the header, then `end`, and nothing opened (the `openFile` hook, `read.go:45`).
  A vanished file is left out.
- The golden lines equal `stream-lines.ndjson`.
- Flushing: a recording writer asserts the header is flushed before the first file is read, and
  that no more than 64 KiB plus one line is written between flushes, with `max-file-bytes`
  configured down to 256 B ([D13](planning-index-at-scale.md#19-what-done-looks-like)).
- A `have` body over the cap is `413`, and malformed is `400`. Gzip round-trips.
- Reviews: request order kept, paths without a review left out, the path cap.
- `?path=` carries `hash`. B2: the batch answers `410`, with the detail text.

## WP-C — the scan worker, its client and the cache (frontend)

| Path | Change |
| :--- | :--- |
| `frontend/src/planningScan/core.ts` | new: the stream reader (bytes in, decoded with `TextDecoder` and `stream: true`), the build and refresh algorithms, the cards and quotes answers, chunking and progress |
| `frontend/src/planningScan/cache.ts` | new: the IndexedDB stores of [§8](planning-index-at-scale.md#8-the-scan-cache) (blocked on [OQ-PS1](planning-index-at-scale.md#OQ-PS1)'s option) |
| `frontend/src/planningScan/worker.ts` | new: a thin `onmessage` adapter over `core.ts` |
| `frontend/src/planningScan/client.ts` | new: `ScannerClient` over the worker, and the inline client over `core.ts` |
| `frontend/src/planningScan/limits.ts` | new: the limits module, holding E's and F's numbers too (page sizes, budgets, deadlines, the hold), so neither edits it |
| `frontend/src/planningScan/scannerId.ts` | new: the Vite plugin serving `virtual:planning-scanner-id`, and the build guard |
| `frontend/vite.config.ts` | the plugin in `plugins` and in `worker.plugins`; `worker.format: "es"` |
| `frontend/src/main.tsx` | create the client after `initStaticMode()` (`:10`) unless static |
| `frontend/package.json`, `package-lock.json` | `fake-indexeddb` as a devDependency, one commit with the lockfile |

**Reuse.** The store's `getApiBase` shape (`usePlanningStore.ts:112`). `parseSourceEntry` for the
single-path answer. The 8 ms slicing (`:211-238`) moves into the inline client.

**Traps.**

- **Vite finds a worker only from `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`**,
  written literally in `client.ts`.
- **No `WebWorker` lib.** `tsconfig.app.json` has `DOM`, and adding `WebWorker` clashes. Type
  `self` in `worker.ts` with a minimal local interface.
- **Keep every worker-side module in `frontend/src/planningScan/`.** The scanner id hashes
  `packages/vantage-md/src/`, that directory and `package-lock.json`. The build guard fails a
  production build whose worker bundle holds any other module outside `node_modules`.
- **Check the worker chunk for KaTeX and highlight.js.** `pipeline.ts` imports both beside
  `buildRemarkPlugins`. `bun build` shook them out (300 KB minified, 87 KB gzipped); if Rollup
  keeps them, move `buildRemarkPlugins` into a module of its own. That is A's file set, so ask
  first.
- **The dev server must invalidate the virtual module** when a hashed file changes, or a dev
  session keeps trusting results from the old code.
- **jsdom has no `Worker`.** Unit tests drive `core.ts` and the inline client; only e2e runs
  the worker.

**Tests** (`npm run test -w frontend -- planningScan`):

- The stream reader: a line split across chunks, a multi-byte character split across chunks, a
  line longer than a chunk. A missing `end`, an unparseable line, a non-header first line
  (`shape: true`).
- A build over `scannedOf(tree)` served as fake lines: the `documents` chunks respect the limits
  module's chunk size (configured down to 2). `started.warm` is false on an empty cache and true
  after one build.
- The cache (`fake-indexeddb/auto`): a second build sends every hash as `have`, and only the
  roadmap comes back as `file`. A scanner-id change clears every store. Absent paths are collected
  after `end`. Nothing is collected when refused. `bypassCache` sends no `have`. A cache that
  throws leaves a memory-only build that still succeeds.
- Cards: served from the cache, `stale` on a hash mismatch, `full` fetching past the size limit
  (configured down to 50 characters). Quotes return only the asked lines.
- Cancel: a superseded build posts nothing more and aborts its fetch.
- The stream lines: every line of `stream-lines.ndjson` parses.
- e2e `planning_cache.spec.ts`: a reload of the fixture issues a stream whose only `file` line is
  the roadmap ([D8](planning-index-at-scale.md#19-what-done-looks-like)).

**C2 (after E), helpers:** in `core.ts` and `client.ts`. The spawn threshold and the per-helper
queue come from the limits module, so a test sets 1 KiB and two helpers over a six-file tree and
asserts equal results, the cache written once, and the helpers ended at `ready`, `failed` and on
cancel.

## WP-D — the store on the client

| Path | Change |
| :--- | :--- |
| `frontend/src/stores/usePlanningStore.ts` | `startBatch` calls `build`; `refreshPath` calls `refresh`; `ready` loses `sources` and gains `hashes`; `Held` loses `sources`; `scanBatch` and `SLICE_MS` go; `loading` gains `progress` and `warm` |
| `frontend/src/stores/usePlanningStore.test.ts` | rewritten over a fake `ScannerClient`: every race keeps its test, now resolved through the fake |

**Traps.**

- **The tracker stays exactly as it is** (`:135-173`). Only the two fetch sites change. A
  scanned entry arrives asynchronously, as the fetch response did, so the numbering rules carry
  over unchanged.
- **Set the store once, at `ready`.** Accumulate `documents` events in a builder outside the
  store, or every chunk re-renders every subscriber.
- **Keep `applySource` answering the index itself** when nothing changed (`:264-266`).
  `applyScanned` keeps that contract, and the tree's per-row selectors depend on it.

**Tests:** the existing 761 lines' cases, rewritten to the fake client and not relaxed until
green. Plus: `hashes` follow a refresh; `progress` is throttled; `warm` reaches `loading`.

## WP-E — the planning page, paged

| Path | Change |
| :--- | :--- |
| `frontend/src/pages/PlanningPage.tsx` | the frame; the section bar; pages from the URL; the gated sections; Copy answers by scoping plus placement; the page-inputs cache beside `scrollPositions` (`:74`) |
| `frontend/src/components/PlanningPager.tsx` | new: range, Previous and Next, page select, fixed height |
| `frontend/src/hooks/usePlanningPageInputs.ts` | new: cards, the shown documents' reviews, the Mermaid pre-draw; `prefetchPlanningPage(repo)` for F and for `g` |
| `frontend/src/components/PlanningQuestionCard.tsx` | `card: CardBlock \| null` and `preview` in place of `source` (`:80-81`, `:222-226`); `React.memo`; the preview card and Show question; the reserved *N comments* count |
| `frontend/src/hooks/usePlanningReviews.ts` | one `POST /planning/reviews` for the shown documents, then one for the rest; `review_changed` still refetches one path with `GET` |
| `frontend/src/stores/useReviewStore.ts` | `AnswerGroup.content` becomes a line lookup (`:885-891`, `quotedFor` `:1159`) |
| `frontend/src/hooks/useKeyboardShortcuts.ts` | prefetch on the `g` of the chord (`:88`) |
| `packages/vantage-md/src/react.ts`, `packages/vantage-md/src/renderMermaidBlocks.ts` | export `prerenderMermaid(code, theme)`, which fills `setCachedSvg` (`mermaidCache.ts:35`) |
| tests: `PlanningPage.test.tsx`, `PlanningQuestionCard.test.tsx`, `usePlanningReviews.test.ts`, `useReviewStore.test.ts` | below |
| `frontend/e2e/planning_page.spec.ts`, `frontend/e2e/fixtures/test_repo/plans/paged.md`, `plans/oversized.md` | new cases and two fixtures |

**Reuse.** `derivePlanningSections` and `questionFor` unchanged. `useScrollRestore`
(`PlanningPage.tsx:90-146`) as it is, keyed by `location.key`. `answersPayload` and
`reviewCommentsBlock` keep their output.

**Traps.**

- **A `replace` navigation gets a new `location.key`.** Carry the saved scroll position over on a
  flip, or Back from a document restores nothing.
- **The router's transition still wraps the route.** Keep the frame's first render free of
  cards; sections come from state set when the inputs resolve, inside `startTransition`.
- **Memo breaks on unstable props.** `onScoped` is an inline closure today
  (`PlanningPage.tsx:358`). Pass a stable `reportScoped` and the card's key. Memoize badges per
  index version.
- **Placement needs `unitEndLine`, and card scoping needs the rendered card.** Use a card's own
  report once it has rendered this visit, placement otherwise. Never both for one card.
- **Keep the single-document Copy byte-identical.** `useReviewStore.test.ts:874-990` stays
  unmodified.
- **The page sizes come from the limits module**, so tests set a page to 2 cards.

**Tests:**

- Pages: sizes, the 32 KiB cut (configured down), clamping, URL replace, Back from Open document
  back to the same pages and scroll, the section bar's counts, and a section of one page having no
  pager.
- The frame commits before the sections. The sections wait on all three inputs. A flip keeps the
  old page until the new one is ready. The two deadlines (configured down to 10 ms): the reserved
  count, and the fixed Mermaid frame.
- A memoized card: a review answer for document *x* renders no card of document *y* (a render
  counter).
- A preview card past the size limit (configured down); Show question renders the whole card.
- Copy answers: a pending comment on an unrendered page-2 question is counted and copied; a
  rendered card's scoping wins over placement; the count's slot keeps its width.
- e2e: `paged.md`'s 12 questions make two pages of 10; Next, then Open document, then Back returns
  to page 2 at the same scroll; the CLS observer reads 0 after first paint
  ([D12](planning-index-at-scale.md#19-what-done-looks-like)); the reviews requests number two.

## WP-F — stable first paint on document pages

| Path | Change |
| :--- | :--- |
| `frontend/src/pages/ViewerPage.tsx` | request git status and history with the content, not after it renders (`:562-566`, `:621-627`); the hold; no *Untracked file* before status answers (`:1515`); prefetch from the toolbar's planning entry (`:936`) |
| `frontend/src/stores/useGitStore.ts` | a "status known" flag beside `latestCommit` |
| `frontend/src/components/MarkdownViewer.tsx` | Referenced by's reserved line (`:767-855`) |
| `frontend/src/hooks/usePlanningLinkBadges.ts` | late badges only in blocks never on screen |
| tests: `MarkdownViewerPlanning.test.tsx`, `usePlanningLinkBadges.test.tsx`, `useGitStore.test.ts`; e2e `stable_paint.spec.ts` (new) | below |

**Traps.**

- **"On screen" is the document's scroll container, not the window.** Observe blocks against
  that container.
- **The hold has one deadline, 150 ms from the content's arrival**, from the limits module. It
  never waits on a cold build: read `warm` from the store.
- **The header's fit logic already reserves a label's longer state** (`hdr-reserve`, commit
  `c845344`). Late items must use it and the leftover room, and `header_fit.spec.ts` stays green.

**Tests:** the late-badge rule over a document taller than the viewport (a badge lands below the
fold, none above it); the Referenced by line reserved and then filled; no *Untracked file* before
status answers. The e2e is a layout-shift observer on warm loads of the fixture's roadmap and a
planning document, asserting 0.

## WP-G — docs

| Path | Change |
| :--- | :--- |
| `userguide/guides/planning.md` | "rebuilt… never stored" (`:25`) per the [OQ-PS1](planning-index-at-scale.md#OQ-PS1) ruling; paging; "How it stays current" (`:433-442`) |
| `README.md` | the API table rows (`:279-280`): the stream and the reviews request |
| `docs/design/technical_spec.md` | its `planning/sources` mention |
| `docs/design/planning-index.md` | the pointers already added by the design; once built, the bodies of [§3.4](planning-index.md#34-when-it-is-built-and-how-it-stays-fresh), [§6](planning-index.md#6-the-planning-page) and the rest move to the built behavior |

## Testing within the memory rules

- **Every limit is proven by configuring it down**: page sizes, the 32 KiB page cut, the
  32,000-character card limit, the chunk size, the helper threshold and queue, the deadlines, and
  `max-file-bytes`, all through the limits module or `.vantage.toml`. No input grows to a default.
- **Fixtures stay small:** at most 12 questions in one file for paging, one file of about 33 KB
  for the preview card, and the e2e repository staying under 40 files.
- **Scale runs** use the existing 15, 30, 45 and 60-document series (about 1.3 MB at 60), with
  one server and one browser per agent on private ports, killed by PID.
- **Every** `node`, `bun` and `npx` runs under `NODE_OPTIONS=--max-old-space-size=1024`. Vite and
  Playwright never run under `ulimit -v`.

## Ships with

- **Docs:** WP-G's table. No changelog section
  ([Plan Q8](planning-index.md#decision-ledger)).
- **Surfaces:** two routes and the `410`; the `hash` field; `unitEndLine` and `cardChars` in
  `index --format json`; the `vantage-planning` IndexedDB database; the planning page's query
  parameters; the progress, preview and *Comments could not be loaded* copy.
- **Tests that must change, rewritten and not relaxed:** the store's, the page's, the card's, the
  reviews hook's, the batch handler's, and the e2e "Back costs no second scan", which now counts
  stream requests.
- **Norms:** every commit passes `just check-ci`, which the pre-commit hook runs. A manifest
  change lands with `package-lock.json` (C only).

## Don't

- **Parse Markdown in Go, or add the sieve**, unless [OQ-PS2](planning-index-at-scale.md#OQ-PS2)
  rules for it.
- **Hold any document text on the main thread**, not even "just for Copy". Quotes come from the
  worker.
- **Show a partial index**, or let a stream without `end` count as one.
- **Put a card on screen before its page's inputs are complete**, except past a deadline, into
  the reserved space the design names.
- **Touch `web/dist`**, and build any scratch bundle into `/workspace/.worktrees/`.

## Blockers

- [OQ-PS1](planning-index-at-scale.md#OQ-PS1) shapes `cache.ts` and WP-G's user-guide sentence.
  Option B drops the `cards` store, and option C drops the file.
- [OQ-PS2](planning-index-at-scale.md#OQ-PS2) adds a sieve to `stream.go` and its fixture only if
  ruled for.
