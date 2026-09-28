---
title: "The planning index — implementation plan"
status: in-review
stage: DECIDED
next: "Build WP-A alone; every other work package codes against its types"
depends-on:
  - planning-index.md
tags: [planning, implementation-plan]
summary: "Build hand-off for the whole planning-index design, phases 1 and 2: six work packages with disjoint file sets, the contracts between them, and the tests that prove each behavior."
---

# The planning index — implementation plan

**Design:** [`planning-index.md`](planning-index.md) · **Status:** promoted from sketch on
2026-09-28; build-ready for phases 1 and 2. Ten questions for the coordinator remain, each
with a default the work can proceed on ([below](#questions-for-the-coordinator)). Written
against `4948138`, 2026-09-28.

**Precedence.** The design wins on behavior. The tree wins on fact: when a file has moved or a
helper is gone, follow the tree and say so in the commit. This plan is advice, and it is the
first thing to be wrong. Never twist the code to match it.

**Terms.** A *work package* (WP, coined here) is a slice with its own file set, built in its
own worktree and cherry-picked onto `main`. The *post-pass* (coined here) is the planning
rules' run in `check`'s main thread after the per-file workers finish. A *live question* (the
plan's reading, Q6) is any question the index holds, whatever its state. A compacted question
has lost its directive, so the index no longer holds it. An *agreement test* runs two
implementations over one corpus and asserts equal answers, as
`frontend/src/lib/pipelineAgreement.test.tsx` does. The rest are the design's terms:
[planning index](planning-index.md#3-the-planning-index),
[candidate and planning document](planning-index.md#31-which-files-it-reads),
[stage role](planning-index.md#4-the-header-of-record-stage-next-depends-on),
[routed](planning-index.md#61-the-roadmap).

## Order of work

1. **WP-A, alone.** Every other WP codes against its types, and it moves checker helpers that C
   must not touch.
2. **WP-B, WP-C, WP-D and WP-F in parallel**, once A is on `main`.
3. **WP-E after WP-D.** It consumes D's store, badge component and `embedded` viewer.

Cherry-pick constraints:

- **F's `.vantage.toml` lands after C.** Its `"planning/unrouted"` line is an unknown rule to
  today's checker, which exits 2 (`config.ts:151-167`), and the gate goes red. F's other
  commits can land in any order.
- **D's and E's e2e specs need B.** Their unit tests mock the endpoint.
- **Phases** ([§14](planning-index.md#14-sequencing)): phase 1 is A, B, C, F and D's store and
  link badges. Phase 2 is D's Referenced by and tree badges, plus E. D commits its phase-1
  slice first, so a release can stop at the line.

## Shared contracts

What the WPs code against. Changing one after A lands is a coordinator decision.

### vantage-md exports (A provides; C, D and E consume)

All pure and JSON-serializable (no `Map`, `Set` or class), exported from
`packages/vantage-md/src/index.ts`. The frontend reaches vantage-md only through that entry
(`frontend/vite.config.ts:77-90`).

```ts
// ---- config ---------------------------------------------------------------
export type StageRole = "open" | "ready" | "built" | "done";
export const STAGE_ROLES: readonly StageRole[]; // in that order
export interface PlanningConfig {
  roadmap: string;       // repo-relative, no leading "./"; default "roadmap.md"
  include: string[];     // default ["**/*.md"]
  exclude: string[];     // default []
  maxFileBytes: number;  // default 1048576
  maxCandidates: number; // default 5000
  stages: Record<string, StageRole> | null; // null: [planning.stages] absent
}
export const DEFAULT_PLANNING_CONFIG: Readonly<PlanningConfig>;
export function compileIgnorePatterns(lines: readonly string[]): (path: string) => boolean; // server semantics (Q1)
export function candidateMatcher(config: PlanningConfig): (path: string) => boolean; // include && !exclude; roadmap always (Q2)

// ---- one document -----------------------------------------------------------
export type QuestionState = "open" | "blocked" | "answered"; // answered = ✅
export const VANTAGE_OQ_PREFERENCE: "\u{1F937}"; // 🤷, lives in vantageDirectives.ts
export interface PlanningQuestion {
  path: string;
  id: string | null;       // well-formed and first in its document, else null (Q5)
  state: QuestionState;    // no marker => "open"
  preference: boolean;     // 💬 🤷
  marker: string;          // emoji run as written before the bold title; "" when none
  title: string;           // the bold OQ title, flattened; else the scope's flattened text
  leaning: string | null;  // normalizeLeaning(leaning=); null when absent or empty
  line: number;            // file line of the block the in-page button anchors on
  unitLine: number;        // file line of the enclosing <li>; === line outside a list item
  block: { startLine: number; endLine: number }; // root-level block holding it, file lines
}
export interface PlanningLink {
  target: string;          // repo-relative, normalized
  fragment: string | null; // decoded, no "#"
  heading: string | null;  // nearest heading above, flattened; null before any heading
  line: number;            // file line
  endOffset: number;       // source offset just past the link, for `index` text output
}
export interface DependsOn {
  raw: string;
  target: string | null;   // null when it does not resolve inside the repository
  fragment: string | null;
  line: number;            // file line of the entry; 1 when unknown
}
export interface PlanningDocument {
  path: string;
  status: DocStatus | null; // only the four; the key's presence still makes it planning
  stage: string | null;
  stageLine: number | null;
  next: string | null;
  dependsOn: DependsOn[];
  questions: PlanningQuestion[]; // document order
  links: PlanningLink[];         // document order; repo-relative only; self-links kept
  ids: string[];                 // unique OQ-shaped tokens in the raw text, first-seen order
}
export type ScanResult = { kind: "planning"; document: PlanningDocument } | { kind: "not-planning" };
export function scanPlanningDocument(path: string, source: string, isRoadmap: boolean): ScanResult;
export function scanParsedDocument(path: string, source: string, frontmatter: ParsedFrontmatter,
  mdast: Root, isRoadmap: boolean): ScanResult; // the checker has already parsed
export function normalizeLeaning(raw: string): string; // the plugin's collapse, trim and cap

// ---- the index --------------------------------------------------------------
export interface PlanningIndex {
  config: PlanningConfig;
  candidateCount: number;
  refused: boolean;              // candidateCount > maxCandidates; documents is then []
  documents: PlanningDocument[]; // by path
  skipped: { path: string; size: number }[];      // over maxFileBytes, by path
  unreadable: { path: string; reason: string }[]; // read or scan failure, by path
}
export function buildPlanningIndex(input: { config: PlanningConfig; candidateCount: number;
  files: { path: string; content: string }[]; skipped?: PlanningIndex["skipped"];
  unreadable?: PlanningIndex["unreadable"] }): PlanningIndex; // a scan that throws => unreadable
export function withDocument(index: PlanningIndex, path: string, content: string): PlanningIndex;
export function withoutDocument(index: PlanningIndex, path: string): PlanningIndex;
export function findDocument(index: PlanningIndex, path: string): PlanningDocument | undefined;

// ---- badges (design §5) -------------------------------------------------------
export type PlanningBadge =
  | { kind: "document"; path: string; status: DocStatus | null; stage: string | null;
      stageInVocabulary: boolean; open: number; blocked: number } // true when no stages declared
  | { kind: "question"; path: string; id: string; state: QuestionState }
  | { kind: "ruled"; path: string; id: string }
  | { kind: "not-found"; path: string; id: string };
export function resolveRepoLink(fromPath: string, href: string):
  { path: string; fragment: string | null } | null; // null: scheme, "//", leading "/", escapes root
export function badgeFor(index: PlanningIndex, fromPath: string,
  target: { path: string; fragment: string | null }): PlanningBadge | null;
export function badgeText(badge: PlanningBadge): string;   // "in-review · DESIGN · 💬 5", "✅ ruled"
export function badgeSpeech(badge: PlanningBadge): string; // "in review, design, 5 open questions"

// ---- routing and sections (design §6) -------------------------------------------
export interface QuestionRef { path: string; id: string | null; line: number }
export interface RoutedQuestion extends QuestionRef { heading: string | null } // the roadmap's
export type WaitingEntry =
  | { kind: "question"; question: QuestionRef }
  | { kind: "document"; path: string; waitingOn: DependsOn[] };
export interface PlanningSections {
  roadmap: { path: string; present: boolean };
  stagesDeclared: boolean;
  nothingNeedsYou: boolean;       // no open question anywhere
  needsYou: RoutedQuestion[];     // no roadmap: every open question, by path then line
  unrouted: QuestionRef[] | null; // null when there is no roadmap
  waiting: WaitingEntry[];
  ready: string[] | null;         // the three stage sections are null without stages
  graduate: string[] | null;
  disagrees: string[] | null;
  skipped: PlanningIndex["skipped"];
  unreadable: PlanningIndex["unreadable"];
}
export function routeQuestions(index: PlanningIndex): RoutedQuestion[]; // roadmap order
export function derivePlanningSections(index: PlanningIndex): PlanningSections;
export function questionFor(index: PlanningIndex, ref: QuestionRef): PlanningQuestion | undefined;
export const PLANNING_NOTICES: { // one wording for the page and the CLI (P7)
  nothingNeedsYou: string; noRoadmap(path: string): string; noStages: string;
  refused(candidateCount: number, maxCandidates: number): string };

// ---- Referenced by (design §7) and the page's card (§6.3) ---------------------------
export interface Reference { from: string; heading: string | null; line: number }
export function referencedBy(index: PlanningIndex, path: string): Reference[];
  // planning sources only, self-links dropped, one per (from, heading), by from then line
export function questionCardSource(source: string, question: PlanningQuestion):
  { markdown: string; lineOffset: number }; // question.block's lines, then the doc's definitions
```

### `GET /api/planning/sources` (B provides; D consumes)

Repo-scoped, so also `/api/r/{repo}/planning/sources`. No parameters. Snake_case like the rest
of the API; arrays never `null`; every list sorted by path.

```json
{
  "config": {
    "roadmap": "roadmap.md",
    "include": ["**/*.md"],
    "exclude": ["docs/gallery/**"],
    "max_file_bytes": 1048576,
    "max_candidates": 5000,
    "stages": { "DECIDED": "ready", "DESIGN": "open" }
  },
  "candidate_count": 55,
  "refused": false,
  "files": [{ "path": "docs/design/planning-index.md", "content": "---\ntitle: …" }],
  "skipped": [{ "path": "docs/huge.md", "size": 2097152 }],
  "unreadable": [{ "path": "docs/latin1.md", "reason": "not UTF-8" }]
}
```

- `stages` is `null` when undeclared. `refused: true` means `files`, `skipped` and
  `unreadable` are `[]` and nothing was opened.
- `config` is always the effective config: defaults when the table is absent or the file is
  refused, and the refusal is logged.
- Per-file refreshes use the existing `GET /content?path=` (`{path, content, encoding}`).
- The `files_changed` push also names the root `.vantage.toml`.

### `vantage-check index` (C provides)

`vantage-check index [--format text|json] [--config <path> | --no-config]` takes no paths.
Exit codes: 0 ran, 2 bad arguments or config, 3 could not run (Q7: a refused index is 3).

```json
{
  "tool": "vantage-check",
  "toolVersion": "0.1.0",
  "version": 1,
  "root": "/abs/project",
  "index": { "…": "PlanningIndex, verbatim" },
  "sections": { "…": "PlanningSections, verbatim" },
  "roadmap": [
    { "line": 12, "target": "docs/design/x.md", "fragment": null,
      "badge": { "kind": "document", "…": "…" }, "badgeText": "accepted · DECIDED" }
  ]
}
```

Text: non-empty sections in page order, one indented line per entry, and `PLANNING_NOTICES`
where the page shows them. Then `Roadmap: <path>` and the roadmap's source, with
` [<badgeText>]` inserted at each badged link's `endOffset`. Layout is C's choice, pinned by a
golden test.

### Shared fixtures (A writes; B and C read)

In `internal/repoconfig/testdata/`, beside the `shared-config.toml` precedent. Never name one
`.vantage.toml`: the checker walks up to that name, and the file would configure the docs gate.

| File | Shape | Read by |
| :--- | :--- | :--- |
| `planning-patterns.json` | `{cases: [{include, exclude, path, candidate}]}` | A's matcher test; B's `internal/planning` test |
| `planning-config.json` | `{cases: [{name, toml, ok, planning?}]}`, `planning` as `PlanningConfig` | B's repoconfig test; C's config test |
| `planning-candidates.json` | `{tree: {path: content}, listed: [path]}` | B's `ListAllFiles` test; C's walk test |
| `shared-config.toml` | gains a valid `[planning]` | both existing shared-fixture tests |

### Frontend (D provides; E consumes)

```ts
// frontend/src/stores/usePlanningStore.ts
export type PlanningLoad =
  | { status: "idle" } | { status: "loading" }
  | { status: "ready"; index: PlanningIndex; version: number;
      sources: Readonly<Record<string, string>> } // planning docs' text, for cards and Copy
  | { status: "error"; message: string };
interface PlanningStore {
  byRepo: Readonly<Record<string, PlanningLoad>>; // "" is single-repo
  reviewEpoch: Readonly<Record<string, number>>;  // `${repo}\n${path}`, bumped on review_changed
  ensure(repo: string): void;                     // idempotent, background, first need
  rescan(repo: string): void;                     // Retry, .vantage.toml change, reconnect
  noteFilesChanged(repo: string, paths: readonly string[]): void;
  noteReviewChanged(repo: string, path: string): void;
  noteReconnect(): void;
}
export function usePlanningIndex(): PlanningLoad; // current repo; ensures on mount

// frontend/src/components/PlanningBadge.tsx
export const PLANNING_BADGE_ATTR = "data-vantage-planning-badge";
export function PlanningBadgeChip(props: { badge: PlanningBadge }): JSX.Element;
export function planningBadgeElement(badge: PlanningBadge): HTMLElement; // same markup, for DOM passes

// MarkdownViewer gains two optional props
sourceLineOffset?: number; // added to every data-source-line; default 0
embedded?: boolean;        // no frontmatter, Referenced by, review wiring, delta flash, drift publish

// frontend/src/lib/reviewAnchor.ts gains, moved from useReviewHighlights.ts:355-393
export function blockAtLine(byLine: Map<number, HTMLElement[]>, line: number, hash: string): HTMLElement | null;
export function findHashNeighbor(byHash: Map<string, HTMLElement[]>, hash: string, line: number,
  radius: number): HTMLElement | null;
```

## WP-A — the scan and every derivation (`packages/vantage-md`)

| Path | Change |
| :--- | :--- |
| `packages/vantage-md/src/planning/*.ts` | new: config, patterns, scan, index, badges, sections, card source |
| `packages/vantage-md/src/htmlComments.ts` | new: `scanComments`, moved from the checker's `core/comments.ts` |
| `packages/vantage-md/src/directiveTargets.ts` | new: target resolution, moved from the checker's `rules/directives.ts` |
| `packages/vantage-md/src/vantageDirectives.ts` | `normalizeLeaning`, `MAX_LEANING`, `VANTAGE_OQ_PREFERENCE` |
| `packages/vantage-md/src/rehypeVantageDirectives.ts` | `stampOq` (`:328-350`) calls `normalizeLeaning` |
| `packages/vantage-md/src/index.ts` | export the contract |
| `packages/vantage-check/src/core/comments.ts` | becomes a re-export |
| `packages/vantage-check/src/rules/directives.ts` | imports the moved helpers; behavior unchanged |
| `internal/repoconfig/testdata/*` | the four fixtures |
| `frontend/src/lib/planning*.test.ts(x)` | new; vantage-md has no suite of its own (`AGENTS.md`) |

**Reuse.**

- The parser is the checker's exact processor (`packages/vantage-check/src/core/document.ts:43`),
  with `bodyLineOffset` from `parseFrontmatter` (`frontmatter.ts:61`).
- `parseVantageDirective` and `VANTAGE_OQ_ID` for directives; `isDocStatus` for status;
  `vantageOqStatus` for state.
- **Move, don't copy,** the host-target rules: `nextBlock`, `isCommentOnly`, `targetTag`,
  `listIsLoose`, `nextContentInNode`, `BLOCK_PARENTS`, `PHRASING_PARENTS`
  (`packages/vantage-check/src/rules/directives.ts:274-650`). `vantage/orphan` and the scan
  must agree on which `oq` yields a button (D5).
- Link cleaning mirrors `splitFragment` and `cleanPath` (`links.ts:234-252`): drop the query,
  decode percent escapes.

**Traps.**

- **The contents column is the reference for state.** Mirror `questionLabel`, `markerBefore`
  and `leadingMarker` (`frontend/src/hooks/useDocumentOutline.ts:176-224`). Scope: the nearest
  `listItem`, else the target. Title: the first `strong` matching `/^OQ-[A-Za-z0-9]*\d/`.
  Marker: that strong's earlier siblings. Status: `vantageOqStatus(marker) ??
  vantageOqStatus(title)`. The checker's `oq-missing` reads the whole item (`directives.ts:1128`),
  which is **not** the column's rule: 💬 on the title with ✅ in the body is open.
- **Only answerable directives are questions.** The column lists `answerableOpenQuestions`
  (`useOpenQuestionButtons.ts:216-240`): the host must be in `VANTAGE_OQ_HOST_TARGETS`, and two
  directives on one block are one question. An `oq` above a list, fence or table yields none.
- **Directives merge per run** (`rehypeVantageDirectives.ts:361-392`), last key wins.
  `collectOqIds` (`packages/vantage-check/src/core/openQuestions.ts:33`) does not merge, so
  don't build on it.
- **`line` is the anchor block's `data-source-line`:** the leaning paragraph after the
  directive, not the `<li>`. `anchorBlockWithin` (`reviewAnchor.ts:144`) resolves a stamped
  `li` or `blockquote` to its first inner block.
- **Links include `linkReference`** resolved through `definition`; the viewer renders both as
  `<a>`. Code, inline code and html comments are never links.
- **Skip the mdast parse for non-planning files.** Test the frontmatter keys and
  `source.includes("vantage:")` first. That is [§13](planning-index.md#13-risks)'s mitigation,
  and [§15](planning-index.md#15-what-done-looks-like)'s 1 s budget depends on it.
- **The matcher is a port, not a library.** npm `ignore` (7.0.8, present only as a transitive
  dev dependency of `typescript-eslint`) follows git; the server's `sabhiram/go-gitignore` does
  not. It treats `?` as a literal and leaves an inner-slash pattern unanchored, so
  `docs/gallery/**` also matches `x/docs/gallery/a.md`. Measured on 9 patterns, the two
  disagree on 4. Port `getPatternFromLine` and `MatchesPathHow` (last match wins; `!` clears
  only a prior match), and drop a line whose regex will not compile, as Go does. Q1 may
  change this.

**Tests** (`frontend/src/lib/`). Prove with `npm run test -w frontend -- src/lib/planning`,
`npm run test -w vantage-check`, `npm run typecheck -w vantage-md`, `npx tsc --build frontend`.

- [§3.1](planning-index.md#31-which-files-it-reads): planning by `status`, by `stage`, by one
  `oq`, and as the roadmap; dropped with none.
- [§3.2](planning-index.md#32-what-a-document-contributes): `status: current` gives `null` and
  stays planning; links in fences, inline code and comments are excluded; heading attribution;
  ledger-table ids land in `ids`.
- [§3.3](planning-index.md#33-a-question): 💬, 💬 🤷, 🔒, ✅ and no marker map to open,
  preference, blocked, answered and open. A duplicate id gives the second `id: null`. The
  gallery's orphan (the `oq` above a list in
  [`open-questions.md`](../gallery/open-questions.md)) is not a question.
- **The [§3.3](planning-index.md#33-a-question) agreement test** (`planningAgreement.test.tsx`):
  render each corpus document through the app's `MarkdownViewer` and run `collectOutline`.
  Assert the same questions in the same order, equal `id`, and `state` equal to the column's
  `status ?? "open"` (settled is answered). Corpus: every `docs/**/*.md` from disk, gallery
  included, plus fixtures for ✅ in the body, a bare-paragraph question, blockquote and heading
  hosts, a nested list, and a title containing a link.
- [§5.1](planning-index.md#51-which-links-get-a-badge),
  [§5.2](planning-index.md#52-what-a-badge-says): every row of the badge table; zero counts
  dropped; a heading fragment is the document; a self-link and a non-planning target give
  `null`; an undeclared word gives `stageInVocabulary: false`.
- [§6.1](planning-index.md#61-the-roadmap), [§6.2](planning-index.md#62-sections-top-to-bottom):
  routing by question, document and heading link; a second reach keeps its first position;
  every section's contents, order and empty-hides rule; the no-roadmap and no-stages variants;
  *Nothing needs you*.
- [§7](planning-index.md#7-referenced-by-and-status-in-the-file-tree): self-links excluded,
  headings named.
- [§3.5](planning-index.md#35-limits-and-what-happens-past-them): refused at max + 1 and not
  at max; skipped carried through.
- Matcher: every case in `planning-patterns.json`. Card source: lines round-trip, and
  definitions come after the block's last line, so no line number moves.

## WP-B — config, endpoint, watcher (Go)

| Path | Change |
| :--- | :--- |
| `internal/repoconfig/repoconfig.go` | `Settings.Planning`; `ours` (`:133`) claims `planning`; validation; `SettingsNow` |
| `internal/planning/` | new: candidates, limits, guarded reads, the streamed body |
| `internal/api/planning_handlers.go` | new: `PlanningSources` |
| `internal/api/routes.go` | `{GET, "/planning/sources", h.PlanningSources, ScopeRepo}` beside `/content` (`:67`) |
| `internal/api/api.go` | `RepoServices.Config *repoconfig.Config` (`:59-66`) |
| `internal/server/resolve.go` | `withRepo` (`:92-98`) sets `Config: rs.cfg` |
| `internal/live/watcher.go` | `classify` (`:53`) keeps exactly the root `.vantage.toml` |

Pointer fields, so an absent key and `include = []` stay distinct:

```go
type PlanningSettings struct {
	Roadmap       *string           `toml:"roadmap"`
	Include       *[]string         `toml:"include"`
	Exclude       *[]string         `toml:"exclude"`
	MaxFileBytes  *int64            `toml:"max-file-bytes"`
	MaxCandidates *int              `toml:"max-candidates"`
	Stages        map[string]string `toml:"stages"` // nil: undeclared
}
func (p PlanningSettings) Resolved() Planning // defaults applied; the endpoint's "config"
```

**Reuse.** `fs.ListAllFiles` (`internal/fs/service.go:589`) is the candidate list. Match with
`gitignore.CompileIgnoreLines` as `starred.Promote` does (`internal/starred/promote.go:153`).
Read through `pathsafe.Resolve` with `ReadFile`'s UTF-8 test (`service.go:646-666`). Tests use
`newTestEnv` (`internal/api/handlers_test.go:39`); the server test sits beside
`TestRepositoryPromotesItsOwnDocuments` (`internal/server/server_test.go:908`), and the
discovered-repo case mirrors `TestSourceDirRepoIsServedWithoutRestart` (`:458`).

**Traps.**

- **Validation is whole-or-nothing** (`repoconfig.go:107-126`). An unknown `[planning]` key, a
  role outside the four, or a limit below 1 rejects the whole file, `[starred]` and `theme`
  included. Existing behavior: keep it, and log as `promoted()` does (`server.go:316-323`).
- **The reload throttle serves stale config** (`reloadInterval`, `repoconfig.go:56`). The
  `.vantage.toml` push triggers a rescan within about 250 ms, usually inside the window of the
  `/starred` read the same push caused. The endpoint calls `SettingsNow`, which re-stats
  regardless.
- **Refuse before reading.** Count first; over the limit, answer without opening a file. Stat
  for size before every read. **Stream** `files` one entry at a time: 5,000 × 1 MiB is a valid
  config, and a marshaled slice holds all of it.
- **`classify` feeds every consumer** (`watcher.go:53`; `flush` at `:379`). Keep only the exact
  root path, so `docs/.vantage.toml` stays dropped. `flush` clears no cache for it, correctly.
- **Isolate the user ignore file** in the `ListAllFiles` fixture test. Set `XDG_CONFIG_HOME`
  and call `ignore.ClearCache()`, or the developer's `~/.config/vantage/ignore` changes the
  answer.

**Tests.** Prove with
`go test ./internal/repoconfig ./internal/planning ./internal/api ./internal/server ./internal/live ./internal/fs`.

- repoconfig: every case in `planning-config.json`; `[planning]` read from
  `shared-config.toml`; `SettingsNow` sees an edit made inside the throttle window.
- planning: `planning-patterns.json`. At max + 1 the answer is refused and nothing is opened: a
  candidate with mode `000` causes no error. Oversized is skipped, non-UTF-8 is unreadable, and
  a symlink out of the root is never read.
- api: the body's shape, with `[]` and never `null`; a bad `[planning]` answers with defaults.
- server: `/api/r/{repo}/planning/sources` uses that repository's config, in daemon mode and
  for a discovered repository, which is the trap the `repoServices.cfg` comment warns about
  (`server.go:86-91`).
- live: `TestClassify` (`watcher_test.go:48`) gains rows for the root and nested cases.
- fs: `planning-candidates.json` gives the same `ListAllFiles` answer as C's walk.

## WP-C — `vantage-check`: config, `index`, four rules

| Path | Change |
| :--- | :--- |
| `packages/vantage-check/src/core/config.ts` | parse `root["planning"]` (`:123`) into `LoadedConfig.planning: PlanningConfig` |
| `packages/vantage-check/src/core/candidates.ts` | new: the walk that mirrors `ListAllFiles` |
| `packages/vantage-check/src/core/projectRoot.ts` | new: config dir, then git root, then cwd; takes `repositoryRoot` from `links.ts:341` |
| `packages/vantage-check/src/commands/index.ts` | new: `index` |
| `packages/vantage-check/src/rules/planning.ts` | new: the post-pass |
| `packages/vantage-check/src/rules/registry.ts` | four `planning/*` entries |
| `packages/vantage-check/src/commands/check.ts` | run the post-pass after the report (`:85-99`) |
| `packages/vantage-check/src/cli.ts`, `help.ts` | `index` in `COMMANDS` (`cli.ts:19`), its parser, `USAGE` |

**Reuse.** `loadConfig` and `findConfig` (`config.ts:46-99`); `ConfigError`, which maps to exit
2; `loadDocument` with `scanParsedDocument`, so a file parses once; `displayPath`;
`sortFindings` (`report/text.ts:127`); `Settings.severity`; `makeTree` (`test/helpers.ts:28`).
Drive commands through `run(argv, io)` as `cli.test.ts` does.

**Traps.**

- **All four rules run in the post-pass**, `stage-vocabulary` and `depends-on-missing`
  included. A worker gets only rule overrides (`ShardRequest`, `core/parallel.ts`); widening
  that protocol costs more than re-parsing planning documents. Report only for files in the
  run's list, with `file` from `displayPath`.
- **Root the post-pass at `repositoryRoot(firstTarget)`, never at the config file.**
  `_self-check` passes `--config "$(mktemp)"` (`Justfile:220-224`), so the config's directory
  is `/tmp`. For `index`, follow
  [§8](planning-index.md#8-vantage-check-index-and-the-planning-rules) literally.
- **`--jobs 1` and `--jobs 4` stay byte-identical** (`Justfile:223-229`). The post-pass runs
  once, in the main thread, after either path.
- **The candidate walk is not `discover`**, which takes `.markdown`, descends into `dist/` and
  `build/`, and ignores `.vantageignore` (`core/discover.ts`). Mirror the server: `.md` only,
  case-insensitively; prune dot-directories, `DefaultExcludeDirs`
  (`internal/config/config.go:44-55`), linked worktrees (`internal/git/fswalk.go:22`) and
  `.vantageignore` matches; skip symlinks. Per-reader settings are out of reach (Q9).
- **`index` becomes a command word.** `vantage-check index` used to check the path `./index`
  (`cli.ts:53`). Say so in the userguide.
- **Two meanings of `version`.** `check`'s JSON holds the tool version there
  (`report/json.ts:18`); `index`'s holds the format version.
- **`stage-vocabulary` is inert without `[planning.stages]`**, even at `error`.
  `planning/unrouted` defaults to `off`.
- **A bad `[planning]` now fails every `check` with exit 2.** The design wants it; the
  userguide says it.

**Tests.** Prove with `npm run test -w vantage-check`, then `just cli` and
`packages/vantage-check/dist/vantage-check index`.

- config: `planning-config.json`; `shared-config.toml`. candidates: `planning-candidates.json`.
- index: text golden; JSON shape with `version`; exit codes 0, 2 and 3; roots through the config
  directory, the git root and cwd, with `--config` and `--no-config`. The `sections` object
  deep-equals `derivePlanningSections` over the same tree.
- rules: each fires, and stays quiet, on the
  [§4](planning-index.md#4-the-header-of-record-stage-next-depends-on) table's cases; `unrouted`
  is off until configured; a finding in an unchecked file is not reported; the in-process
  `runShard` gives the same findings at 1 and 4 jobs.
- cli: `index` parses; `index docs` is a usage error; `help` lists the command and the rules.

## WP-D — store, link badges, Referenced by, tree badges (frontend)

| Path | Change |
| :--- | :--- |
| `frontend/src/stores/usePlanningStore.ts` | new: the store contract |
| `frontend/src/components/PlanningBadge.tsx`, `ReferencedBy.tsx`, `PlanningTreeBadge.tsx` | new |
| `frontend/src/hooks/usePlanningLinkBadges.ts` | new: a post-render pass in `useOpenQuestionButtons`' style |
| `frontend/src/components/MarkdownViewer.tsx` | `a` (`:609`) stamps `data-vantage-link-target`; the hook; Referenced by below the card (`:702`); click bail (`:529`); two props; memo comparator (`:731-743`) |
| `frontend/src/lib/reviewAnchor.ts` | the badge attribute in `REVIEW_UI_SELECTOR` (`:52`); the two moved helpers |
| `frontend/src/hooks/useReviewHighlights.ts` | helpers moved out; drift publish (`:137-146`) off when embedded |
| `frontend/src/hooks/useDocumentOutline.ts` | `headingText` (`:229`) and `questionLabel` (`:176`) strip badges |
| `frontend/src/hooks/useDeltaFlash.ts` | snapshots (`:69`) strip badges |
| `frontend/src/hooks/useWebSocket.ts` | `noteReviewChanged` (`:239`), `noteFilesChanged` (`:257`), `noteReconnect` (`:144`) |
| `frontend/src/components/FileTree.tsx` | `PlanningTreeBadge` after the name (`:279-287`) |
| `packages/vantage-md/src/FrontmatterDisplay.tsx` | optional `linkIds`: a bare OQ id in `next` becomes `#id` ([§4](planning-index.md#4-the-header-of-record-stage-next-depends-on)) |
| `frontend/src/index.css` | badge styles, `user-select: none`, plain text in print |
| `frontend/e2e/planning.spec.ts`, `frontend/e2e/fixtures/test_repo/planning/*`, `test_repo/.vantage.toml` | new |

**Reuse.** Badge chips use `DOC_STATUS_TONES` and `.vantage-chip--<tone>`
(`packages/vantage-md/src/DocumentStatusChip.tsx`), so a badge's chip is the status chip. The
hook takes `useOpenQuestionButtons`' shape (`:252-370`): sweep its own nodes first, re-run on
content and on the index `version`, leave no trace on unmount. A private `getApiBase` per store
is house style (`useRepoStore.ts:63`).

**Traps.**

- **A badge missing from `REVIEW_UI_SELECTOR` moves every anchor** on its block when a count
  changes: [§13](planning-index.md#13-risks)'s first risk.
- **A badge click in review mode opens the comment popover** unless the handler
  (`MarkdownViewer.tsx:529`) bails on it; [§5.3](planning-index.md#53-how-a-badge-behaves) says
  clicking does nothing.
- **Don't parse the rendered `href` back into a path.** It carries `/{repo}/` in daemon mode
  and an unnormalized `..` (`resolveHref`, `:231-255`). Stamp
  `resolveRepoLink(currentPath, href)` as `data-vantage-link-target` and read that.
- **`files_changed` carries `repo` only in daemon mode** (`omitempty`, `watcher.go:417`), and
  `processBatch` never filters by it. Key by `message.repo ?? ""`.
- **Sequencing covers the batch.** A batch sent before a per-file refresh but answered after it
  must not overwrite that file: number the batch too, and apply its entry for a path only if no
  newer request for that path was sent
  ([§3.4](planning-index.md#34-when-it-is-built-and-how-it-stays-fresh)).
- **`/content` enforces no size limit.** Compare `TextEncoder` bytes, not `.length`, with
  `maxFileBytes`. `encoding: "binary"` is unreadable; `400 {"detail":"Not a file"}` is a
  delete. A new path joins only if `candidateMatcher(index.config)` accepts it.
- **The `.vantage.toml` push exists only once B lands.** Test with a synthetic message.
- **`useWebSocket` is mounted only by `ViewerPage`** (`:268`). Put the store calls inside the
  hook, so E's page gets them by mounting it.
- **Referenced by sits inside the prose container:** no `h1`–`h6` (`collectOutline` would list
  it) and no `[data-vantage-oq]`.
- **An embedded viewer must not publish drift.** `useReviewHighlights` writes
  `commentsDrifted` on every pass, so a card on E's page would clear the real document's flag.
- **Scan off the critical path.** Yield between documents with `setTimeout(0)`. No Worker: it
  needs a second bundle entry, and the corpus is 55 files. Log the time to ready once, for
  [§15](planning-index.md#15-what-done-looks-like).
- **Rescan on reconnect** (`refreshAfterReconnect`, `useWebSocket.ts:144`): pushes missed while
  the socket was down leave the index stale.

**Tests.** Prove with `npm run test -w frontend` and `just e2e`.

- store ([§3.4](planning-index.md#34-when-it-is-built-and-how-it-stays-fresh)): the batch fills
  the index; a changed candidate, a new matching file, a new excluded file, a delete, a
  `.vantage.toml` rescan, another repo's push ignored, and the ordering race both ways; a size
  overrun goes to skipped. [§3.6](planning-index.md#36-failure): a failed batch gives `error`,
  and `MarkdownViewer`'s output is unchanged.
- badges: a sibling after the link; none for a self-link, a non-planning target or an external
  link. **[§13](planning-index.md#13-risks)'s test:** comment on a badged block, change the
  count, and `hashBlockText(blockVisibleText(block))` is unchanged. A click is inert in review
  mode; outline text excludes badges; a badge-only change does not flash.
- Referenced by: below the card, absent when empty, absent from the outline. Tree badge: the
  stage (the chip without one) and `💬 N`.
- e2e `planning.spec.ts`: the roadmap shows badges. For
  [§15](planning-index.md#15-what-done-looks-like)'s first bullet, remove a question's
  directive the way `livereload.spec.ts` edits a file, and without a reload the badge reads
  `✅ ruled`. Restore the file afterwards.

## WP-E — the planning page (frontend)

| Path | Change |
| :--- | :--- |
| `frontend/src/App.tsx` | `/planning/*` beside `/recent/*` (`:9-11`) |
| `frontend/src/pages/PlanningPage.tsx` | new: sections, notices, Retry, Copy answers, scroll restore; mounts `useWebSocket` |
| `frontend/src/components/PlanningQuestionCard.tsx` | new: an embedded `MarkdownViewer` over `questionCardSource`; Take, Answer…, Open document; comments |
| `frontend/src/hooks/usePlanningReviews.ts` | new: `GET /review?path=` per listed document, refetched on `reviewEpoch` |
| `frontend/src/hooks/useKeyboardShortcuts.ts` | `g p` beside `g h` and `g r` (`:83-106`) |
| `frontend/src/components/KeyboardShortcuts.tsx` | a help row (`:30-31`) |
| `frontend/src/pages/ViewerPage.tsx` | a toolbar entry in the sidebar header (`:845-895`) |
| `frontend/src/stores/useReviewStore.ts` | export the comment-body builder, `postCommentTo(path, …)`, the per-document group block, multi-path instructions |
| `frontend/src/hooks/useOpenQuestionButtons.ts` | export the comment-text helper (`:291-294`) |
| `frontend/e2e/planning_page.spec.ts` | new |

**Reuse.** The anchor comes from `answerableOpenQuestions` then `buildWholeBlockAnchor`
(`reviewAnchor.ts:163-178`), run on the rendered card. A question's comments are those whose
anchor resolves inside the card through `blockAtLine` then `findHashNeighbor(…,
NEIGHBOR_RADIUS)`, the highlighter's own rule; `isPendingForAgent` marks them waiting.
Answer… reuses `ReviewCommentPopover`. The page shell copies `RecentsPage.tsx`.

**Traps.**

- **`runCommand` posts only for the store's current `filePath`**
  (`useReviewStore.ts:443-446`). Build the body with the helper `addComment` uses (`:508-538`),
  a fresh `id` and `created_at` included, and POST to `{base}/review/comments?path=<doc>`. The
  handler accepts any path (`internal/api/review_command_handlers.go:84-110`) and broadcasts
  `review_changed`.
- **Slice the root-level block, not the list item.** A root-level block re-parses the same in
  isolation; an item cut out of a nested list or a blockquote does not. Render
  `questionCardSource` with `sourceLineOffset` and `embedded`, then hide everything outside the
  element at `unitLine`. Query within the card, never with `getElementById`: two documents can
  share an id.
- **Take this leaning shows only when `leaning` is non-null**
  ([§6.3](planning-index.md#63-a-question-on-the-page)); the in-page button shows without one.
  Its text still comes from the shared helper over the rendered card, never from
  `question.leaning`, so both paths file the same bytes.
- **No scroll restoration exists:** `BrowserRouter` has none (`main.tsx:22`). Save `scrollY` by
  `location.key`, and restore after the cards render, once more after Mermaid and KaTeX settle.
- **Open document is a bare path, no hash.** `loadReview` auto-enables review mode for any
  document with comments (`useReviewStore.ts:407`), so a document answered from the page opens
  in review mode by that existing rule. Add no toggle either way.
- **Single-document Copy stays byte-identical.** `copyAllToClipboard`'s tests
  (`useReviewStore.test.ts:874-990`) stay unmodified. `respondingInstructions` names one path
  in two places (`:938`, `:950`), so it takes a list, and one path renders exactly as today.
- **Filing does not reorder.** Order comes from `derivePlanningSections` alone.
- **Static exports** get no Take or Answer (`isStaticMode`, `useOpenQuestionButtons.ts:283`).
  The batch fails there too (Q3).

**Tests.** Prove with `npm run test -w frontend` and `just e2e`.

- [§15](planning-index.md#15-what-done-looks-like)'s third bullet and
  [§13](planning-index.md#13-risks)'s last risk: for each question in
  [`agent-bootstrap.md`](agent-bootstrap.md) and each gallery shape, file from the card and from
  the in-page button over the whole document, and assert equal `anchor`, `comment` and
  `fallback_text`. Answer… files the typed text on the same anchor.
- sections: each rendered, each hidden when empty; the notices; the refused message; the error
  with Retry; Skipped and Could not read.
- Copy answers: the count, disabled with nothing pending, the grouping, other comments left
  out, one instructions block.
- keys: `g p` navigates; `KeyboardShortcuts.test.tsx` finds the row.
- e2e `planning_page.spec.ts`: `g p` opens the page; the fixture's unrouted question is listed;
  take a leaning, and Open document shows the same comment. For
  [§15](planning-index.md#15-what-done-looks-like)'s fourth bullet, Open document lands at the
  top, and Back restores the scroll position.

## WP-F — docs and this repository's corpus

| Path | Change |
| :--- | :--- |
| `packages/vantage-md/src/styleGuide.ts` | `stage`, `next`, `depends-on`, `[planning]`; frontmatter as the stage's one home |
| `userguide/guides/planning.md` | new: the page, badges, Referenced by, tree badges, config |
| `userguide/README.md` | a Guides row |
| `userguide/reference/configuration.md` | `[planning]` beside `[starred]` |
| `userguide/reference/keyboard-shortcuts.md` | `g p` |
| `userguide/guides/vantage-check.md` | `index`, the four rules, the command-word and exit-2 notes |
| `userguide/reference/style-guide.md` | a pointer for planning frontmatter ([§10](planning-index.md#10-what-the-conventions-change)) |
| `docs/reference/inline-markup.md` | "The one-click Open Question answer": the page files the same comment |
| `.vantage.toml` | new: `[planning]` excluding the gallery, the [§9](planning-index.md#9-configuration) stages, and `"planning/unrouted" = "warning"` (Q4) |
| `docs/**` frontmatter | `stage:` per the table below |
| `roadmap.md` | ordered link lists ([§6.1](planning-index.md#61-the-roadmap)), every item kept (Q10) |
| `CHANGELOG.md` | `## [Unreleased]` (Q8) |

**Traps.**

- **The style guide contradicts [§3.3](planning-index.md#33-a-question) today.** Its
  `oq-missing` bullet says a 🔒 or ✅ question "needs no directive", but the index cannot see a
  🔒 question without one. Rewrite that sentence (and see Q5).
- **Style-guide examples are checked.** `directives.test.ts:118-146` runs every `yaml` fence
  carrying `vantage:` through the checker. A `depends-on:` there names a file the temp tree
  lacks, so give planning keys their own example.
- **After C and F, the gate lists planning findings.** At `warning` it stays green and shows
  [`agent-bootstrap.md`](agent-bootstrap.md)'s five, which is
  [§15](planning-index.md#15-what-done-looks-like)'s second bullet. At `error`
  the roadmap must route them first.
- **Run `packages/vantage-check/dist/vantage-check` on every edited file.** `roadmap.md` is not
  in the gate's path list (`Justfile:203-204`).

Proposed stages, for the coordinator to confirm (Q10). A `BUILT` document with no live question
lands under *Graduate*, which is the intended signal.

| Document | Prose status now | Stage |
| :--- | :--- | :--- |
| [`agent-bootstrap.md`](agent-bootstrap.md) | DESIGN SKETCH, five open | `DESIGN` |
| [`color-themes.md`](color-themes.md) | PROTOTYPE, [`OQ-CT6`](color-themes.md#OQ-CT6) open | `DESIGN` |
| [`agent-cli.md`](agent-cli.md), [`pypi-distribution.md`](pypi-distribution.md) | DECIDED, and shipped | `BUILT` |
| [`check-performance.md`](check-performance.md), [`contents-open-questions.md`](contents-open-questions.md), [`linked-references.md`](linked-references.md) | IMPLEMENTED | `BUILT` |
| [`repo-config.md`](repo-config.md) | DESIGNED; `[starred]` and `theme` are in the tree | `BUILT` |
| [`planning-index.md`](planning-index.md) | DECIDED | `DECIDED` (already) |
| [`brainstorm/planning-index.md`](../brainstorm/planning-index.md) | SUPERSEDED | `SUPERSEDED` |
| [`reference/inline-markup.md`](../reference/inline-markup.md) | CURRENT | `CURRENT` |
| `docs/reviews/*.md` | reviews of a shipped CLI | `SUPERSEDED` |

The design docs without frontmatter ([`review-mode.md`](review-mode.md) and three others) are
not planning documents; leave them.

## Ships with

- **Docs describing the old behavior:** the style guide's 🔒 sentence, the userguide's rule
  list and `inline-markup.md`'s button section (F), and the checker's `USAGE` (C). Check
  `docs/reference/inline-markup.md`'s claims, not just its links.
- **Surfaces:** the five `[planning]` keys and defaults, the two limit messages, the four rule
  ids and summaries, the `index` JSON `version`, `data-vantage-planning-badge`,
  `data-vantage-link-target`.
- **Norms:** every commit passes `just check-ci`, which the pre-commit hook runs. A manifest
  change lands with `package-lock.json`; none is expected.
- **When all six have landed:** delete this plan, move traps that proved real into a system doc
  (the `system-doc` skill), and take the roadmap item out. That commit records what the
  implementers had to rediscover and what they never needed.

## Don't

- **Parse Markdown in Go** (P4). The server lists, filters and reads.
- **Store anything for the page:** no snooze, no read state
  ([§6](planning-index.md#6-the-planning-page)). Comments already live in the review store.
- **Add npm `ignore`**, unless Q1 rules for git semantics. The checker and the server would
  disagree on every pattern.
- **Add a total-bytes cap, or take `.markdown` as a candidate.** Neither is in the design.
- **Render cards from `question.title`** or any other summary:
  [§6.3](planning-index.md#63-a-question-on-the-page) requires the viewer pipeline.
- **Touch `web/dist`, the static builder or `docs/gallery/`** (the builder is Q3).

## Questions for the coordinator

Each is **stop and ask** before its default ships in a release. Parallel work proceeds on the
default. A ruling goes into the design's [Decision Ledger](planning-index.md#decision-ledger),
and its line here is deleted.

| # | Question the tree forces | Default the plan builds | Blocks |
| :--- | :--- | :--- | :--- |
| Q1 | The server's matcher is not git's: `?` is literal and an inner-slash pattern is unanchored. Keep its quirks on both sides, or move both to git semantics? The second changes `[starred] promote` too. | Port the Go quirks to TS; one fixture pins both | A, B, C |
| Q2 | Is a `roadmap` that `include` or `exclude` rules out still read? "Always a planning document" does not say. | Yes, whenever it exists | A, B, D |
| Q3 | `vantage build` exports have no batch endpoint. Should badges and the page exist there? | No: the [§3.6](planning-index.md#36-failure) failure path, with the page's error shown | B, E |
| Q4 | This repository's `planning/unrouted` severity: at `error` the gate fails until the roadmap routes [`agent-bootstrap.md`](agent-bootstrap.md). | `warning` | F |
| Q5 | Is an `oq` with no `id=`, or a duplicate id, a question? The column counts it; [§3.3](planning-index.md#33-a-question) identifies questions by (path, id). And once 🔒 questions carry directives, review mode offers Take this leaning on them: should the button and the column skip 🔒 and ✅? | Counted with `id: null`; buttons unchanged | A, E |
| Q6 | What is a live question (Graduate; routing a whole document)? Does `depends-on: x.md#id` also wait while the question is 🔒? | Every held question is live; waiting only while 💬 | A |
| Q7 | Past `max-candidates`, does `index` exit 3 or 0? | 3: it did not run | C |
| Q8 | `CHANGELOG.md` has no unreleased section; the precedent writes notes at release (`197d658`). | Keep a Changelog's `## [Unreleased]`, renamed by the release commit | F |
| Q9 | Per-reader settings (`exclude_dirs`, the user ignore file) shape the server's list but are invisible to the checker. | The checker mirrors repository-level rules only | C |
| Q10 | Roadmap items carry facts with no other home, such as TypeScript 7's unblock condition, which the [§6.1](planning-index.md#61-the-roadmap) list form would drop. Also confirm the stage table. | Each item becomes a link plus a reason, its prose kept beneath | F |

## Done — mirrors [§15](planning-index.md#15-what-done-looks-like)

- [ ] `roadmap.md` shows a badge on every link to a planning doc or question, and a compacted
  answer turns its badge to `✅ ruled` without a reload (D's e2e).
- [ ] `g p` opens the page, and on this repository it lists
  [`agent-bootstrap.md`](agent-bootstrap.md)'s questions under *Unrouted* (E, F).
- [ ] Taking a leaning from the page gives a comment identical to the in-page button's (E's
  anchor test).
- [ ] **Open document** lands at the top, and Back restores the scroll position (E's e2e).
- [ ] `vantage-check index` prints the page's sections (C's deep-equal), and
  `planning/stage-vocabulary` fails on an off-vocabulary `stage` (C).
- [ ] The index is ready within 1 s of first load on this repository, and no first render waits
  for it: D logs the time; the landing commit records it.
- [ ] The [§3.3](planning-index.md#33-a-question) agreement test, `just check-ci` and
  `just e2e` are green.
