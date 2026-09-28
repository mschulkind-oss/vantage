---
title: "The planning index — implementation plan"
status: in-review
stage: DECIDED
next: "Build WP-A alone; every other work package codes against its types"
depends-on:
  - planning-index.md
tags: [planning, implementation-plan]
summary: "Build hand-off for the whole planning-index design, phases 1 and 2: seven work packages with disjoint file sets, the contracts between them, and the tests that prove each behavior."
---

# The planning index — implementation plan

**Design:** [`planning-index.md`](planning-index.md) · **Status:** promoted from sketch on
2026-09-28 and revised after review the same day; build-ready for phases 1 and 2. Its twenty
questions for the coordinator were ruled the same day
([below](#the-coordinators-rulings)). Written against `4948138`; revised against `dc400f6`,
2026-09-28.

**Precedence.** The design wins on behavior. The tree wins on fact: when a file has moved or a
helper is gone, follow the tree and say so in the commit. This plan is advice, and it is the
first thing to be wrong. Never twist the code to match it.

**Terms.** A *work package* (WP, coined here) is a slice with its own file set, built in its
own worktree and cherry-picked onto `main`. The *post-pass* (coined here) is the planning
rules' run in `check`'s main thread after the per-file workers finish. A *narrow index*
(coined here) is the index `check` builds from the roadmap plus the run's own files, with no
walk of the tree. The *single-path mode* (coined here) is the planning endpoint answering for
one `?path=`. A question's *unit* (coined here) is the element at its `unitLine`: the `<li>`,
or the host block outside a list. An *agreement test* runs two implementations over one corpus
and asserts equal answers, as `frontend/src/lib/pipelineAgreement.test.tsx` does. *Q1* to *Q20*
are the questions this plan raised for the coordinator, each ruled into a design ledger row
named *Plan Q1* and so on ([below](#the-coordinators-rulings)). The rest are the design's
terms: [planning index](planning-index.md#3-the-planning-index),
[candidate and planning document](planning-index.md#31-which-files-it-reads),
[live question](planning-index.md#33-a-question),
[stage role](planning-index.md#4-the-header-of-record-stage-next-depends-on),
[routed](planning-index.md#61-the-roadmap),
[project root](planning-index.md#8-vantage-check-index-and-the-planning-rules).

## Order of work

1. **WP-A, alone.** Every other WP codes against its types, and it moves checker helpers that C
   must not touch.
2. **WP-B, WP-C, WP-D and WP-F1 in parallel**, once A is on `main`.
3. **WP-E after WP-D.** It consumes D's store, badge component, socket option and `embedded`
   viewer.
4. **WP-F2 after WP-E.** It documents what E ships.

Cherry-pick constraints:

- **F1's `.vantage.toml` lands after C.** Its `"planning/unrouted"` line is an unknown rule to
  today's checker, which exits 2 (`config.ts:151-167`), and the gate goes red. F1's other
  commits can land in any order.
- **D's and E's e2e specs need B.** Their unit tests mock the endpoint.
- **Phases** ([§14](planning-index.md#14-sequencing)): phase 1 is A, B, C, F1 and D's phase-1
  slice (the store, the socket calls, link badges, and the `next` link). Phase 2 is D's
  Referenced by and tree badges, then E, then F2. D commits its phase-1 slice first, so a
  release can stop at the line and document only what it ships.

## Shared contracts

What the WPs code against. Changing one after A lands is a coordinator decision.

### vantage-md planning module (A provides; C, D and E consume)

All pure and JSON-serializable (no `Map`, `Set` or class). Exported from
`packages/vantage-md/src/planning/index.ts`, **not** from the published entry
`src/index.ts` (Q19). The frontend reaches it as `vantage-md/planning` through an alias in
`frontend/vite.config.ts`, `frontend/vitest.config.ts` and `frontend/tsconfig.app.json`;
vantage-check imports it by relative path, as it does the rest of vantage-md.

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
  stages: Record<string, StageRole> | null; // null: [planning.stages] absent or empty (Q20)
}
export const DEFAULT_PLANNING_CONFIG: Readonly<PlanningConfig>;
export function compileIgnorePatterns(lines: readonly string[]): (path: string) => boolean; // Go's MatchesPath (Q1)
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
  block: { startLine: number; endLine: number }; // the root-level block holding it; a root-level directive's starts at its run's first comment
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
  target: string | null;   // null when it resolves outside the repository
  fragment: string | null;
  line: number;            // file line of the entry; 1 when unknown
}
export interface HeaderProblem { key: "stage" | "next" | "depends-on"; line: number; message: string }
export interface PlanningDocument {
  path: string;
  status: DocStatus | null; // only the four; the key's presence still makes it planning
  stage: string | null;     // a trimmed non-empty string, as written; else null plus a HeaderProblem
  stageLine: number | null;
  next: string | null;      // a one-line string, trimmed; else null plus a HeaderProblem
  dependsOn: DependsOn[];   // a scalar string is a one-entry list; a non-string entry is dropped plus a HeaderProblem
  headerProblems: HeaderProblem[];
  questions: PlanningQuestion[]; // document order
  links: PlanningLink[];         // document order; every repo-relative link, self-links kept
  ids: string[];                 // unique OQ-shaped tokens in the raw text, first-seen order
}
export type ScanResult =
  | { kind: "planning"; document: PlanningDocument }
  | { kind: "not-planning" }
  | { kind: "unreadable"; reason: string }; // parseFrontmatter set `problem` (Q20)
export function scanPlanningDocument(path: string, source: string, isRoadmap: boolean): ScanResult;
export function normalizeLeaning(raw: string): string; // the plugin's collapse, trim and cap

// ---- the index --------------------------------------------------------------
export interface PlanningSources { // the batch, camelCased
  config: PlanningConfig; candidateCount: number; refused: boolean;
  files: { path: string; content: string }[];
  skipped: { path: string; size: number }[];
  unreadable: { path: string; reason: string }[];
}
export type SourceEntry = // one path, from the single-path mode
  | { kind: "file"; path: string; content: string }
  | { kind: "skipped"; path: string; size: number }
  | { kind: "unreadable"; path: string; reason: string }
  | { kind: "absent"; path: string }; // missing, or not a candidate
export function parsePlanningSources(json: unknown): PlanningSources | null; // null on any other shape
export function parseSourceEntry(json: unknown): SourceEntry | null;
export interface PlanningIndex {
  config: PlanningConfig;
  candidateCount: number;        // as of the last batch
  refused: boolean;              // documents, skipped and unreadable are then []
  documents: PlanningDocument[]; // by path
  skipped: { path: string; size: number }[];      // over maxFileBytes, by path
  unreadable: { path: string; reason: string }[]; // B's read failures plus ScanResult "unreadable", by path
}
export function buildPlanningIndex(sources: PlanningSources): PlanningIndex;
export function applySource(index: PlanningIndex, entry: SourceEntry): PlanningIndex;
export function withoutDirectory(index: PlanningIndex, dir: string): PlanningIndex;
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
  roadmap: { path: string; present: boolean }; // false: missing, skipped or unreadable (Q20)
  stagesDeclared: boolean;
  nothingNeedsYou: boolean;       // no open question in any document without the done role
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
  { markdown: string; lineOffset: number };
```

Rules the types cannot carry. A tests each one.

- **Roadmap identity.** `isRoadmap` is `path === config.roadmap`, decided inside
  `buildPlanningIndex` and `applySource`. No caller passes it.
- **Refusal and the count belong to the batch.** `applySource` and `withoutDirectory` return a
  refused index unchanged, and never touch `candidateCount` or `refused`, because
  non-planning candidates are not recorded and a client cannot tell a new path from a known
  one. The count is as of the last full scan; only a rescan changes either field.
- **`applySource`** removes the path from `documents`, `skipped` and `unreadable` first, then
  adds it by kind. A `file` that scans as `not-planning` adds nothing; one that scans as
  `unreadable` goes to `unreadable`. **`withoutDirectory`** drops every entry under
  `dir + "/"`.
- **`parsePlanningSources`** maps the endpoint's snake_case (`candidate_count`,
  `max_file_bytes`, `max_candidates`) and returns `null` unless `config`, `files`, `skipped`
  and `unreadable` are present with the right types. A static export's SPA fallback answers
  the batch URL with `index.html` at 200 (below, WP-D).
- **The `done` role contributes nothing to any section.** Its questions are not routed, not in
  Needs you, Unrouted or Waiting, and do not count against `nothingNeedsYou`. Badges,
  Referenced by and tree badges are unaffected
  ([§4](planning-index.md#4-the-header-of-record-stage-next-depends-on)). A `depends-on` whose
  target has the `done` role never waits (Q11).
- **Routing.** A bare document link and a `#OQ-…` link route; a heading link routes nothing
  (Q12).
- **`nothingNeedsYou`** can be true while Needs you holds ✅ answered questions; the page then
  shows both ([§6.2](planning-index.md#62-sections-top-to-bottom)).
- **`badgeFor` returns `null`** when the target has nothing to show
  ([§5.1](planning-index.md#51-which-links-get-a-badge) rule 3): no status, no stage, no
  questions. That covers `status: current` alone and a document whose only `oq` is an orphan,
  which is still a planning document ([§3.1](planning-index.md#31-which-files-it-reads)). A
  document badge that would read empty is also `null` (Q20).
- **Header values** ([§4](planning-index.md#4-the-header-of-record-stage-next-depends-on)).
  Stage matching is exact and case-sensitive. A multi-word stage is kept as written, and the
  vocabulary is what rejects it. An out-of-repo `depends-on` keeps `target: null`. Everything
  else degenerate is in the type comments above (Q20).
- **`questionCardSource`.** The slice is `question.block`. A root-level directive is its own
  `html` node before its host (gallery [`OQ-4`](../gallery/open-questions.md#OQ-4) to
  [`OQ-7`](../gallery/open-questions.md#OQ-7)), so the block starts at that
  comment, not at the host. The document's link reference definitions follow **after one
  blank line**: a definition directly after a paragraph is lazy continuation text. A block
  holding a `footnoteReference` returns the whole source with `lineOffset` 0. Footnotes are
  numbered in document order, so a slice renders `yes1.` where the document renders `yes2.`,
  and the anchor hash differs.

### `GET /api/planning/sources` (B provides; D consumes)

Repo-scoped, so also `/api/r/{repo}/planning/sources`. Snake_case like the rest of the API;
arrays never `null`; every list sorted by path. Without parameters it answers the batch:

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

With `?path=<repo-relative>`, the single-path mode, it answers one entry. This is D's only
per-file refresh (Q15):

```json
{ "path": "docs/x.md", "kind": "file", "content": "…" }
{ "path": "docs/huge.md", "kind": "skipped", "size": 2097152 }
{ "path": "docs/locked.md", "kind": "unreadable", "reason": "permission denied" }
{ "path": ".github/pull_request_template.md", "kind": "absent" }
```

- `stages` is `null` when undeclared or empty. `refused: true` means `files`, `skipped` and
  `unreadable` are `[]` and nothing was opened.
- `config` is always the effective config: defaults when the table is absent or the file is
  refused, and the refusal is logged.
- The single-path mode applies the batch's own tests: `ListAllFiles`' pruning, `include` and
  `exclude`, stat before read, the size limit, UTF-8. `absent` covers a missing path and a
  non-candidate alike; a file that exists but cannot be read is `unreadable`, never `absent`.
- **Not `/content`**, which lets in paths the listing never yields. The watcher prunes only
  `.git`, `.vantage` and matcher-ignored directories (`watcher.go:75-96`), so an edit to
  `.github/pull_request_template.md` is pushed and would be indexed until the next rescan.
  `/content` also has no size guard, and answers `400 Not a file` for a missing file and an
  unreadable one alike (`service.go:652-660`).
- `files_changed` also names the root `.vantage.toml` and the `.md` files already inside a
  newly created directory, and gains `removed_dirs` (omitempty): a watched directory renamed
  away or removed, which today yields no file path at all (`watcher.go:303-322`).

### `vantage-check index` (C provides)

`vantage-check index [--format text|json] [--config <path> | --no-config]` takes no paths.
Exit codes: 0 ran, 2 bad arguments or config, 3 could not run (Q7: a refused index is 3).

```json
{
  "tool": "vantage-check",
  "toolVersion": "0.1.0",
  "version": 1,
  "root": "/abs/project",
  "index": { "…": "PlanningIndex; each document's links narrowed to other candidates" },
  "sections": { "…": "PlanningSections, verbatim" },
  "roadmap": [
    { "line": 12, "target": "docs/design/x.md", "fragment": null,
      "badge": { "kind": "document", "…": "…" }, "badgeText": "accepted · DECIDED" }
  ]
}
```

`links` is narrowed on output only, to the walk's candidates minus the document itself, which
is what [§3.2](planning-index.md#32-what-a-document-contributes) calls a link. The index keeps
every repo-relative link, because a target's candidacy can change between scans.

Text: non-empty sections in page order, one indented line per entry, and `PLANNING_NOTICES`
where the page shows them. Then `Roadmap: <path>` and the roadmap's source, with
` [<badgeText>]` inserted at each badged link's `endOffset`. Layout is C's choice, pinned by a
golden test.

### Shared fixtures (A writes; B and C read)

In `internal/repoconfig/testdata/`, beside the `shared-config.toml` precedent. Never name one
`.vantage.toml`: the checker walks up to that name, and the file would configure the docs gate.

| File | Shape | Read by |
| :--- | :--- | :--- |
| `planning-patterns.json` | `{cases: [{include, exclude, path, candidate}]}`; every expected value is Go's answer | A's matcher test; B's `internal/planning` test |
| `planning-config.json` | `{cases: [{name, toml, ok, planning?}]}`, `planning` as `PlanningConfig`; one case is an empty `[planning.stages]` | B's repoconfig test; C's config test |
| `planning-candidates.json` | `{tree: {path: content}, listed: [path]}`; the tree holds `.github/x.md` and a `DefaultExcludeDirs` path | B's `ListAllFiles` and single-path tests; C's walk test |
| `shared-config.toml` | gains a valid `[planning]` | both existing shared-fixture tests |

### Frontend (D provides; E consumes)

```ts
// frontend/src/stores/usePlanningStore.ts
export type PlanningLoad =
  | { status: "idle" } | { status: "loading" }
  | { status: "ready"; index: PlanningIndex; version: number; rescanning: boolean;
      sources: Readonly<Record<string, string>> } // planning docs' text, for cards and Copy
  | { status: "error"; message: string };
interface PlanningStore {
  byRepo: Readonly<Record<string, PlanningLoad>>; // "" is single-repo
  reviewEpoch: Readonly<Record<string, number>>;  // `${repo}\n${path}`, bumped on review_changed
  ensure(repo: string): void;  // idempotent, background; no-op until repos load; error at once in static mode
  rescan(repo: string): void;  // Retry, .vantage.toml; a ready index stays shown until the new batch lands
  noteFilesChanged(repo: string, paths: readonly string[], removedDirs: readonly string[]): void;
  noteReviewChanged(repo: string, path: string): void;
  noteReconnect(): void;       // genuine reconnects only (Q14); nothing for idle, loading or error
}
export function usePlanningIndex(): PlanningLoad; // current repo; ensures on mount

// frontend/src/components/PlanningBadge.tsx
export const PLANNING_BADGE_ATTR = "data-vantage-planning-badge";
export function PlanningBadgeChip(props: { badge: PlanningBadge }): JSX.Element;
export function planningBadgeElement(badge: PlanningBadge): HTMLElement; // same markup, for DOM passes
  // role="img", aria-label = badgeSpeech(badge); spacing is a CSS margin, never a text node

// MarkdownViewer gains two optional props
sourceLineOffset?: number; // added to every data-source-line; default 0
embedded?: boolean;        // no frontmatter, Referenced by, comments, buttons, delta flash, drift publish

// frontend/src/lib/reviewAnchor.ts gains, moved from useReviewHighlights.ts:165-185 and :355-393
export interface BlockIndex { byLine: Map<number, HTMLElement[]>; byHash: Map<string, HTMLElement[]> }
export function indexBlocks(root: HTMLElement): BlockIndex; // stamps data-block-hash, as the loop did
export function blockAtLine(index: BlockIndex, line: number, hash: string): HTMLElement | null;
export function findHashNeighbor(index: BlockIndex, hash: string, line: number,
  radius: number): HTMLElement | null;

// frontend/src/hooks/useWebSocket.ts
export const useWebSocket: (options?: { viewer?: boolean }) => void;
  // viewer: false skips the document, tree and recents refreshes; E's page passes it
```

## WP-A — the scan and every derivation (`packages/vantage-md`)

| Path | Change |
| :--- | :--- |
| `packages/vantage-md/src/planning/*.ts` | new: config, patterns, scan, index, badges, sections, card source, and the `index.ts` entry |
| `packages/vantage-md/src/htmlComments.ts` | new: `scanComments`, moved from the checker's `core/comments.ts` |
| `packages/vantage-md/src/directiveTargets.ts` | new: target resolution, moved from the checker's `rules/directives.ts` |
| `packages/vantage-md/src/vantageDirectives.ts` | `normalizeLeaning`, `MAX_LEANING`, `VANTAGE_OQ_PREFERENCE` |
| `packages/vantage-md/src/rehypeVantageDirectives.ts` | `stampOq` (`:328-350`) calls `normalizeLeaning` |
| `frontend/vite.config.ts`, `frontend/vitest.config.ts`, `frontend/tsconfig.app.json` | the `vantage-md/planning` alias, beside the two that exist (Q19) |
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
- **A directive inside a raw HTML block** stamps the inner `<p>`, which the column lists, while
  the mdast scan sees one `html` node and `nextBlock` answers `"unknown"`
  (`directives.ts:364-368`, `:481-483`). The index does not count it (Q17).
- **Directives merge per run** (`rehypeVantageDirectives.ts:361-392`), last key wins.
  `collectOqIds` (`packages/vantage-check/src/core/openQuestions.ts:33`) does not merge, so
  don't build on it.
- **`line` is the anchor block's `data-source-line`:** the leaning paragraph after the
  directive, not the `<li>`. `anchorBlockWithin` (`reviewAnchor.ts:144`) resolves a stamped
  `li` or `blockquote` to its first inner block.
- **Links include `linkReference`** resolved through `definition`; the viewer renders both as
  `<a>`. Code, inline code and html comments are never links.
- **`parseFrontmatter` never throws** (`frontmatter.ts:11-19`). Invalid YAML gives
  `frontmatter: {}` with `problem` set, so "a scan that throws" would never fire and a broken
  header would silently drop its `status` and `stage`. Test `problem`.
- **Skip the mdast parse for non-planning files.** Test the frontmatter keys and
  `source.includes("vantage:")` first. That is [§13](planning-index.md#13-risks)'s mitigation,
  and [§15](planning-index.md#15-what-done-looks-like)'s 1 s budget depends on it.
- **The matcher is a port, not a library.** npm `ignore` (7.0.8, present only as a transitive
  dev dependency of `typescript-eslint`) follows git; the server's `sabhiram/go-gitignore` does
  not. It treats `?` as a literal and leaves an inner-slash pattern unanchored, so
  `docs/gallery/**` also matches `x/docs/gallery/a.md`. Port `getPatternFromLine` and
  `MatchesPathHow` (last match wins; `!` clears only a prior match), as Q1 ruled.
- **The port needs a dialect step.** `getPatternFromLine` passes `[`, `(`, `\`, `{` and `+`
  through into an RE2 expression, and JS `RegExp` is not RE2: `[[:upper:]]*.md` matches
  `README.md` in Go and not in JS, and `(?=b)` compiles in JS while Go drops the line. Translate
  POSIX bracket classes; drop a line using lookaround, backreferences or other syntax RE2
  rejects, as Go drops a line that will not compile; compile without the `u` flag.
- **Don't export the module from `src/index.ts`.** vantage-md is published, and that entry is
  semver API that `typetest/consumer.ts` does not cover (Q19).

**Tests** (`frontend/src/lib/`). Prove with `npm run test -w frontend -- src/lib/planning`,
`npm run test -w vantage-check`, `npm run typecheck -w vantage-md`, `npx tsc --build frontend`.

- [§3.1](planning-index.md#31-which-files-it-reads): planning by `status`, by `stage`, by one
  `oq`, and as the roadmap; dropped with none. A document whose only `oq` is an orphan is
  planning, has no questions and gets no badge. A frontmatter `problem` (invalid,
  unterminated, not a mapping) gives `unreadable` with that reason.
- [§3.2](planning-index.md#32-what-a-document-contributes): `status: current` gives `null`,
  stays planning, and gets no badge; links in fences, inline code and comments are excluded;
  heading attribution; ledger-table ids land in `ids`.
- [§3.3](planning-index.md#33-a-question): 💬, 💬 🤷, 🔒, ✅ and no marker map to open,
  preference, blocked, answered and open. A duplicate id gives the second `id: null`. Inline
  fixtures with an `oq` above a list, above a fence and above a table each yield no question.
  The gallery's orphan example ([`open-questions.md`](../gallery/open-questions.md), `:139-143`)
  sits inside a `markdown` fence, so it proves fence exclusion only.
- **The [§3.3](planning-index.md#33-a-question) agreement test** (`planningAgreement.test.tsx`):
  render each corpus document through the app's `MarkdownViewer` and run `collectOutline`.
  Assert the same questions in the same order, equal `id`, and `state` equal to the column's
  `status ?? "open"` (settled is answered). Corpus: every `docs/**/*.md` from disk, gallery
  included, plus fixtures for ✅ in the body, a bare-paragraph question, blockquote and heading
  hosts, a nested list, and a title containing a link. The raw-HTML directive is the one
  pinned divergence, named for Q17.
- [§4](planning-index.md#4-the-header-of-record-stage-next-depends-on): each degenerate header
  value in Q20 (a number, list and date `stage`; a multi-line and a non-string `next`; a
  scalar `depends-on`; a non-string entry; an out-of-repo target) gives the contract's answer
  and a `HeaderProblem` where it says so.
- [§5.1](planning-index.md#51-which-links-get-a-badge),
  [§5.2](planning-index.md#52-what-a-badge-says): every row of the badge table; zero counts
  dropped; a heading fragment is the document; a self-link, a non-planning target and a
  target with nothing to show give `null`; an undeclared word gives `stageInVocabulary:
  false`; a `done` document still gets its badge. `resolveRepoLink` gives `null` for a scheme,
  `//`, a leading `/` and a path escaping the root, which is the rule
  [§3.6](planning-index.md#36-failure)'s cross-repository line rests on.
- [§6.1](planning-index.md#61-the-roadmap), [§6.2](planning-index.md#62-sections-top-to-bottom):
  routing by question link and by bare document link; a `#decision-ledger` link, as
  `roadmap.md:16` cites [`OQ-CT1`](color-themes.md#decision-ledger), routes nothing (Q12); a
  second reach keeps its first position; every section's contents, order and empty-hides
  rule; the no-roadmap and
  no-stages variants; a skipped and an unreadable roadmap each route as missing; *Nothing
  needs you*, including beside a Needs you holding only ✅ questions. A `done` document with an
  open question is absent from every section and from `nothingNeedsYou`; a `depends-on` on it
  does not wait.
- [§7](planning-index.md#7-referenced-by-and-status-in-the-file-tree): self-links excluded,
  headings named, no entry from a non-planning document.
- [§3.5](planning-index.md#35-limits-and-what-happens-past-them): refused at max + 1 and not
  at max; skipped carried through.
- Incremental: `applySource` on a refused index returns it unchanged; a rescanned path leaves
  `skipped` and `unreadable`; `absent` leaves every list; `candidateCount` never moves;
  `isRoadmap` follows the path; `withoutDirectory("docs/a")` keeps `docs/ab.md`.
- `parsePlanningSources`: the B contract's example maps field by field; an HTML string,
  `null`, and a body without `files` each give `null`.
- Matcher: every case in `planning-patterns.json`, including rows for `[[:upper:]]*.md`,
  `(?=x)`, `a+b`, `{a,b}` and a directory-only `dir/`. Card source: lines round-trip; a
  root-level directive's block starts at its comment; definitions follow one blank line; a
  footnote block returns the whole source.

## WP-B — config, endpoint, watcher (Go)

| Path | Change |
| :--- | :--- |
| `internal/repoconfig/repoconfig.go` | `Settings.Planning`; `ours` (`:133`) claims `planning`; validation; `SettingsNow` |
| `internal/planning/` | new: candidates, limits, guarded reads, the streamed body, the single-path answer |
| `internal/api/planning_handlers.go` | new: `PlanningSources`, both modes |
| `internal/api/routes.go` | `{GET, "/planning/sources", h.PlanningSources, ScopeRepo}` beside `/content` (`:67`) |
| `internal/api/api.go` | `RepoServices.Config *repoconfig.Config` (`:59-66`) |
| `internal/server/resolve.go` | `withRepo` (`:92-98`) sets `Config: rs.cfg` |
| `internal/fs/service.go` | `IsListed(rel)`: `ListAllFiles`' pruning (`:589-633`) for one path, one predicate for both |
| `internal/live/watcher.go` | `classify` (`:53`) keeps exactly the root `.vantage.toml`; a created directory's `.md` files; `removed_dirs` |

Pointer fields, so an absent key and `include = []` stay distinct:

```go
type PlanningSettings struct {
	Roadmap       *string           `toml:"roadmap"`
	Include       *[]string         `toml:"include"`
	Exclude       *[]string         `toml:"exclude"`
	MaxFileBytes  *int64            `toml:"max-file-bytes"`
	MaxCandidates *int              `toml:"max-candidates"`
	Stages        map[string]string `toml:"stages"` // nil or empty: undeclared
}
func (p PlanningSettings) Resolved() Planning // defaults applied; the endpoint's "config"
```

**Reuse.** `fs.ListAllFiles` (`internal/fs/service.go:589`) is the candidate list. Match with
`gitignore.CompileIgnoreLines`, the call `starred.Promote` makes (`internal/starred/promote.go:153`).
Read through `pathsafe.Resolve` with `ReadFile`'s UTF-8 test (`service.go:646-666`). Tests use
`newTestEnv` (`internal/api/handlers_test.go:39`); the server test sits beside
`TestRepositoryPromotesItsOwnDocuments` (`internal/server/server_test.go:908`), and the
discovered-repo case mirrors `TestSourceDirRepoIsServedWithoutRestart` (`:458`).

**Traps.**

- **Validation is whole-or-nothing** (`repoconfig.go:107-126`). An unknown `[planning]` key, a
  role outside the four, or a limit below 1 rejects the whole file, `[starred]` and `theme`
  included. Existing behavior: keep it, and log as `promoted()` does (`server.go:316-323`).
- **Every `include` and `exclude` line goes through the matcher**, literal or not.
  `starred.Promote` splits literal lines off before matching (`promote.go:122-125`); copying
  that split would make a literal `roadmap.md` mean something A's port does not.
- **The reload throttle serves stale config** (`reloadInterval`, `repoconfig.go:56`). The
  `.vantage.toml` push triggers a rescan within about 250 ms, usually inside the window of the
  `/starred` read the same push caused. The endpoint calls `SettingsNow`, which re-stats
  regardless.
- **Refuse before reading.** Count first; over the limit, answer without opening a file. Stat
  for size before every read. **Stream** `files` one entry at a time: 5,000 × 1 MiB is a valid
  config, and a marshaled slice holds all of it.
- **`classify` feeds every consumer** (`watcher.go:53`; `flush` at `:379`). Keep only the exact
  root path, so `docs/.vantage.toml` stays dropped. `flush` clears no cache for it, correctly.
- **Directory events yield no file paths today.** `mv docs/old docs/new` is a Rename of a
  directory, which `classify` drops, plus a Create that only calls `addRecursive`
  (`watcher.go:303-322`). Files written into a new directory before its watch exists produce
  no event at all. Enqueue the `.md` files `addRecursive` walks past, subject to `classify` and
  the matcher, and broadcast a Rename or Remove of a registered directory in `removed_dirs`.
  Every consumer now sees those paths; today's recover only because the next push refetches
  the tree wholesale.
- **Isolate the user ignore file** in the `ListAllFiles` fixture test. Set `XDG_CONFIG_HOME`
  and call `ignore.ClearCache()`, or the developer's `~/.config/vantage/ignore` changes the
  answer.

**Tests.** Prove with
`go test ./internal/repoconfig ./internal/planning ./internal/api ./internal/server ./internal/live ./internal/fs`.

- repoconfig: every case in `planning-config.json`, the empty `[planning.stages]` resolving to
  undeclared; `[planning]` read from `shared-config.toml`; `SettingsNow` sees an edit made
  inside the throttle window.
- planning: `planning-patterns.json`. At max + 1 the answer is refused and nothing is opened: a
  candidate with mode `000` causes no error. Oversized is skipped, non-UTF-8 is unreadable, and
  a symlink out of the root is never read.
- single-path: `.github/x.md` carrying `status:` is `absent`; a missing path is `absent`; mode
  `000` is `unreadable`; an oversized file is `skipped` without being opened.
- api: the body's shape, with `[]` and never `null`; a bad `[planning]` answers with defaults.
- server: `/api/r/{repo}/planning/sources` uses that repository's config, in daemon mode and
  for a discovered repository, which is the trap the `repoServices.cfg` comment warns about
  (`server.go:86-91`).
- live: `TestClassify` (`watcher_test.go:48`) gains rows for the root and nested cases. A
  renamed directory pushes `removed_dirs` and the new directory's `.md` paths; a file written
  under a just-created directory is pushed.
- fs: `planning-candidates.json` gives the same `ListAllFiles` answer as C's walk, and
  `IsListed` agrees with it on every path in the tree.

## WP-C — `vantage-check`: config, `index`, four rules

| Path | Change |
| :--- | :--- |
| `packages/vantage-check/src/core/config.ts` | parse `root["planning"]` (`:123`) into `LoadedConfig.planning: PlanningConfig` |
| `packages/vantage-check/src/core/candidates.ts` | new: the walk that mirrors `ListAllFiles`, and `isCandidate` for one path |
| `packages/vantage-check/src/core/projectRoot.ts` | new: `repositoryRoot`, moved from `links.ts:341-350`; one root for both commands (Q16) |
| `packages/vantage-check/src/rules/links.ts` | imports `repositoryRoot` from `projectRoot.ts`; behavior unchanged |
| `packages/vantage-check/src/commands/index.ts` | new: `index` |
| `packages/vantage-check/src/rules/planning.ts` | new: the post-pass over a narrow index |
| `packages/vantage-check/src/rules/registry.ts` | four `planning/*` entries |
| `packages/vantage-check/src/commands/check.ts` | run the post-pass before the report renders (`:85-99`) |
| `packages/vantage-check/src/cli.ts`, `help.ts` | `index` in `COMMANDS` (`cli.ts:19`), its parser, `USAGE` |

**Reuse.** `loadConfig` and `findConfig` (`config.ts:46-99`); `ConfigError`, which maps to exit
2; `scanPlanningDocument` over each re-read file; `displayPath`; `sortFindings`
(`report/text.ts:127`); `Settings.severity`; `makeTree` (`test/helpers.ts:28`). Drive commands
through `run(argv, io)` as `cli.test.ts` does.

**Traps.**

- **All four rules run in the post-pass**, `stage-vocabulary` and `depends-on-missing`
  included. A worker gets only rule overrides (`ShardRequest`, `core/parallel.ts`) and returns
  only a `ShardReport`, so the post-pass parses each planning document a second time. Budget:
  `loadDocument` averages 9.2 ms per file
  ([`check-performance.md` §2](check-performance.md#2-where-the-time-went)), about 0.15 s over
  this repository's planning documents. Record the measured cost in C's commit. Report only
  for files in the run's list, with `file` from `displayPath`.
- **`check` reads a narrow index, never the walk.** Every rule needs only a document and the
  roadmap: three read the document alone, and `unrouted` reads the roadmap's links plus the
  document's own questions. `derivePlanningSections` over the roadmap and the run's candidate
  files gives each of them the membership the full index would. So a one-file
  `uvx vantage-check x.md` costs one roadmap parse, and there is no count to refuse (Q7).
- **One root, `repositoryRoot`, for both commands**: the nearest ancestor holding `.git` or
  `.vantage.toml`. An explicit `--config` never moves it, because `_self-check` passes
  `--config "$(mktemp)"` (`Justfile:220-224`), whose directory is `/tmp`. With no root,
  `check` runs the per-document rules only, and `unrouted` finds no roadmap and reports
  nothing, as the page hides Unrouted without one; `index` falls back to the cwd (Q16).
- **`--jobs 1` and `--jobs 4` stay byte-identical** (`Justfile:223-229`). The post-pass runs
  once, in the main thread, after either path.
- **The candidate walk is not `discover`**, which takes `.markdown`, descends into `dist/` and
  `build/`, and ignores `.vantageignore` (`core/discover.ts`). Mirror the server: `.md` only,
  case-insensitively; prune dot-directories, `DefaultExcludeDirs`
  (`internal/config/config.go:44-55`), linked worktrees (`internal/git/fswalk.go:22`) and
  `.vantageignore` matches; skip symlinks. A directory is matched as `rel` and again as
  `rel + "/"`, as `matchPath` does (`internal/ignore/ignore.go:297-310`), or directory-only
  patterns never prune. Per-reader settings are out of reach (Q9).
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

- config: `planning-config.json`; `shared-config.toml`. candidates: `planning-candidates.json`,
  and `isCandidate` agrees with the walk on every path.
- index: text golden; JSON shape with `version` and narrowed `links`; exit codes 0, 2 and 3;
  roots through the config directory, the git root and cwd, with `--config` and
  `--no-config`. The `sections` object deep-equals `derivePlanningSections` over the same
  tree. Text and JSON each list Skipped and Could not read, and a refused tree prints
  `PLANNING_NOTICES.refused` and exits 3.
- root: `index` and `check` derive the same sections when `--config` points outside the tree;
  a `.vantage.toml` above the git root does not move the root; a run with no root gives
  per-document findings only.
- rules: each fires, and stays quiet, on the
  [§4](planning-index.md#4-the-header-of-record-stage-next-depends-on) table's cases; `unrouted`
  is off until configured, and quiet on a `done` document's open question; `depends-on-missing`
  reports an out-of-repo target and a `#OQ-…` id found nowhere in its target (Q20); a finding
  in an unchecked file is not reported; the in-process `runShard` gives the same findings at
  1 and 4 jobs. For each fixture tree and each file, the narrow index's findings equal that
  file's membership in the full index's sections.
- cli: `index` parses; `index docs` is a usage error; `help` lists the command and the rules.

## WP-D — store, link badges, Referenced by, tree badges (frontend)

Phase-1 slice, committed first: the store, the socket calls, link badges, and the `next` link.
Phase 2: Referenced by and tree badges.

| Path | Change |
| :--- | :--- |
| `frontend/src/stores/usePlanningStore.ts` | new: the store contract |
| `frontend/src/components/PlanningBadge.tsx`, `ReferencedBy.tsx`, `PlanningTreeBadge.tsx` | new |
| `frontend/src/hooks/usePlanningLinkBadges.ts` | new: a post-render pass in `useOpenQuestionButtons`' style |
| `frontend/src/components/MarkdownViewer.tsx` | `a` (`:609`) stamps `data-vantage-link-target`; the hook; Referenced by directly after `<FrontmatterDisplay>` (`:702`); click bail (`:529`); two props; memo comparator (`:731-743`) |
| `frontend/src/lib/reviewAnchor.ts` | the badge attribute in `REVIEW_UI_SELECTOR` (`:52`); `indexBlocks` and the two moved helpers |
| `frontend/src/hooks/useReviewHighlights.ts` | calls `indexBlocks`; no comments and no drift publish (`:137-146`) when embedded |
| `frontend/src/hooks/useDocumentOutline.ts` | `headingText` (`:229`) and `questionLabel` (`:176`) strip badges |
| `frontend/src/hooks/useDeltaFlash.ts` | snapshots (`:69`) strip badges |
| `frontend/src/hooks/useWebSocket.ts` | `noteReviewChanged` (`:239`), `noteFilesChanged` with `removed_dirs` (`:257`), `noteReconnect` (`:307-324`); the `viewer` option |
| `frontend/src/components/FileTree.tsx` | `PlanningTreeBadge` after the name (`:279-287`) |
| `packages/vantage-md/src/FrontmatterDisplay.tsx` | optional `linkIds`: a bare OQ id in `next` becomes `#id` ([§4](planning-index.md#4-the-header-of-record-stage-next-depends-on)); phase 1 |
| `frontend/src/index.css` | badge styles, spacing as margin, the warning tone, `user-select: none`, plain text in print |
| `frontend/e2e/planning.spec.ts`, `frontend/e2e/fixtures/test_repo/plans/*`, `test_repo/planning/notes.md`, `test_repo/.vantage.toml` | new; `planning/notes.md` is a plain document under a top-level `planning/` directory (Q13) |

**Reuse.** Badge chips use `DOC_STATUS_TONES` and `.vantage-chip--<tone>`
(`packages/vantage-md/src/DocumentStatusChip.tsx`), so a badge's chip is the status chip. The
hook takes `useOpenQuestionButtons`' shape (`:252-370`): sweep its own nodes first, re-run on
content and on the index `version`, leave no trace on unmount. A private `getApiBase` per store
is house style (`useRepoStore.ts:63`). `linkIds` is the ids of
`findDocument(index, path).questions`: "declares that id" means a question carrying it, never
a bare token in `ids`, which would link a compacted id to a dead anchor. Until the index is
ready, `next` renders as plain text.

**Traps.**

- **A badge missing from `REVIEW_UI_SELECTOR` moves every anchor** on its block when a count
  changes: [§13](planning-index.md#13-risks)'s first risk.
- **Badge spacing is a CSS margin inside the badge element.** A space text node beside it
  survives the strip, and `x.` becomes `x .`: a comment filed before the index was ready then
  hashes differently once badges appear.
- **A badge click in review mode opens the comment popover** unless the handler
  (`MarkdownViewer.tsx:529`) bails on it; [§5.3](planning-index.md#53-how-a-badge-behaves) says
  clicking does nothing.
- **Don't parse the rendered `href` back into a path.** It carries `/{repo}/` in daemon mode
  and an unnormalized `..` (`resolveHref`, `:231-255`). Stamp
  `resolveRepoLink(currentPath, href)` as `data-vantage-link-target` and read that.
- **`files_changed` carries `repo` only in daemon mode** (`omitempty`, `watcher.go:417`), and
  `processBatch` never filters by it. Key by `message.repo ?? ""`.
- **Every per-file refresh is the single-path mode, never `/content`.** A path joins only when
  the server answers `file`, which carries the listing rules, the size limit and UTF-8. No
  client-side matcher, no `TextEncoder` check. `removed_dirs` calls `withoutDirectory`.
- **Sequencing** ([§3.4](planning-index.md#34-when-it-is-built-and-how-it-stays-fresh)). Number
  the batch too, and apply its entry for a path only if no newer request for that path was
  sent. A push during `loading` sends its per-file request at once; the response is held and
  applied on top of the batch. A batch superseded by a later rescan is discarded whole,
  config, count and refusal included. A failed per-file request keeps the previous entry and
  is retried on the next push for that path.
- **Rescan only on a genuine reconnect.** `socket.onopen` calls `refreshAfterReconnect` on
  every connection, the first of each mount included (`useWebSocket.ts:307-324`), and the hook
  remounts with each page. Call `noteReconnect` only when `connectNum > 1` within the mount:
  that covers a dropped socket and the forced reconnect after 30 s hidden (`:415-427`), and
  skips every page's first connect. `rescan` keeps the ready index shown (`rescanning: true`)
  until its batch lands, so the page never flashes `loading` where E restores scroll (Q14).
- **`useWebSocket` refreshes the viewer's world.** It is mounted only by `ViewerPage` (`:268`),
  and on every push and reconnect it reloads the current document, its status and review, the
  tree and the recents. With `{ viewer: false }` it runs only the planning-store calls, the
  starred, file-picker and repos refreshes, and the version check. E mounts it that way.
- **Static exports serve HTML for the batch.** This repository's docs site answers a missing
  path with `index.html` at 200 (`docs-wrangler.toml`, `not_found_handling`), and
  `staticMode.ts` rewrites the batch URL to `./api/planning/sources.json`. `ensure` and
  `rescan` give `error` at once under `isStaticMode()`, and `parsePlanningSources` rejects any
  other shape (Q3).
- **`ensure` waits for the repo store**, as `refreshAfterReconnect` does (`useWebSocket.ts:155-159`):
  a no-op until `reposLoaded`, and in daemon mode until a current repo, re-run when that
  flips. Existing suites that render the app's `MarkdownViewer` or `FileTree` then start
  issuing `GET …/planning/sources`: `MarkdownViewer.test.tsx`, `ViewerPage.test.tsx` (sets
  `reposLoaded: true`, counts `/files` GETs at `:240`), `FileTree.test.tsx`,
  `pipelineAgreement.test.tsx` and A's `planningAgreement.test.tsx`. Mock `usePlanningStore`
  in them rather than loosening their assertions.
- **The `.vantage.toml` push exists only once B lands.** Test with a synthetic message.
- **Referenced by sits inside the prose container:** no `h1`–`h6` (`collectOutline` would list
  it) and no `[data-vantage-oq]`. `FrontmatterDisplay` renders nothing without frontmatter
  (`FrontmatterDisplay.tsx:120`), and `roadmap.md` has none, so its slot is directly after that
  element, not "below the card".
- **An embedded viewer shows no comments and publishes no drift.** The review store holds the
  last-viewed document's comments, which an embedded highlighter would paint onto a card, and
  `useReviewHighlights` writes `commentsDrifted` on every pass, so a card would clear the real
  document's flag.
- **Scan off the critical path.** Yield between documents with `setTimeout(0)`. No Worker: it
  needs a second bundle entry, and the corpus is 55 files. Log the time to ready once, for
  [§15](planning-index.md#15-what-done-looks-like).

**Tests.** Prove with `npm run test -w frontend` and `just e2e`.

- store ([§3.4](planning-index.md#34-when-it-is-built-and-how-it-stays-fresh)): the batch fills
  the index; a changed candidate; a new file answered `file` joins; a pushed `.github/x.md`
  with `status:` is answered `absent` and never joins; a delete; `removed_dirs` drops its
  documents; a `.vantage.toml` rescan keeps the ready index until the batch lands; another
  repo's push ignored; the ordering race both ways; a push during `loading` lands on top of the
  batch; a superseded batch is discarded whole; a failed per-file refresh keeps the entry; a
  `skipped` answer goes to skipped. `noteReconnect` does nothing for idle and loading; a
  mount's first connect does not call it, its second does. Static mode and an HTML body each
  give `error`, the first with no request. [§3.6](planning-index.md#36-failure): a failed batch
  gives `error`, and `MarkdownViewer`'s output is unchanged.
- badges: a sibling after the link; none for a self-link, a non-planning target, a target with
  nothing to show or an external link. **[§13](planning-index.md#13-risks)'s test:** comment
  on a badged block, change the count, and `hashBlockText(blockVisibleText(block))` is
  unchanged. It is also equal with no badge and with one for `[x](y.md).`, a link followed
  directly by punctuation. A click is inert in review mode; outline text excludes badges; a
  badge-only change does not flash. `getByRole("img", { name: badgeSpeech(badge) })` finds the
  badge, and an off-vocabulary stage carries the warning-tone class.
- `next`: a declared id renders `<a href="#OQ-X">`; an id no question carries, undeclared or
  compacted, stays text; an id that is only part of a longer token stays text.
- Referenced by: directly below the card; first in the prose container for a planning
  document with no frontmatter; absent when empty, and absent from the outline. Tree badge:
  the stage (the chip without one) and `💬 N`.
- e2e `planning.spec.ts`: the roadmap shows badges. For
  [§15](planning-index.md#15-what-done-looks-like)'s first bullet, remove a question's
  directive the way `livereload.spec.ts` edits a file, and without a reload the badge reads
  `✅ ruled`. Restore the file afterwards. `/planning/notes.md` opens that document. Select
  across a badged line and copy: the clipboard holds no badge text. If `user-select: none`
  fails that in Chromium, add a `copy` listener that strips `[data-vantage-planning-badge]`.
- **Manual check**, since no test reaches print: print preview shows each badge as plain text.

## WP-E — the planning page (frontend)

| Path | Change |
| :--- | :--- |
| `frontend/src/App.tsx` | `/.vantage/planning/*` beside `/recent/*` (`:9-11`); Q13 |
| `frontend/src/pages/PlanningPage.tsx` | new: sections, notices, Retry, Copy answers, scroll restore; mounts `useWebSocket({ viewer: false })` |
| `frontend/src/components/PlanningQuestionCard.tsx` | new: an embedded `MarkdownViewer` over `questionCardSource`; Take, Answer… and Open document as the question's state allows (Q5); comments |
| `frontend/src/hooks/usePlanningReviews.ts` | new: `GET /review?path=` per listed document, refetched on `reviewEpoch` |
| `frontend/src/hooks/useKeyboardShortcuts.ts` | `g p` beside `g h` and `g r` (`:83-106`) |
| `frontend/src/components/KeyboardShortcuts.tsx` | a help row (`:30-31`) |
| `frontend/src/pages/ViewerPage.tsx` | a toolbar entry in the sidebar header (`:845-895`) |
| `frontend/src/stores/useReviewStore.ts` | export the comment-body builder, `postCommentTo(path, …)`, the per-document group block, multi-path instructions |
| `frontend/src/hooks/useOpenQuestionButtons.ts` | export the comment-text helper (`:291-294`); no row and no count for a 🔒 or ✅ question (Q5) |
| `frontend/src/hooks/useOpenQuestionButtons.test.ts`, `frontend/src/components/TableOfContents.test.tsx` | gain the Q5 cases below; the second's existing ✅ and 🔒 assertions stay unmodified |
| `frontend/e2e/planning_page.spec.ts` | new |

**Reuse.** The page shell copies `RecentsPage.tsx`. Answer… reuses `ReviewCommentPopover`.
`isPendingForAgent` marks a comment waiting.

**Traps.**

- **The card holds its siblings.** It renders the whole root-level block, and
  [`agent-bootstrap.md`](agent-bootstrap.md)'s five open questions are items of one loose
  `<ol>` (`:436-527`), so every card's DOM holds all five. Run `answerableOpenQuestions` on the
  card and take the host whose anchor block's `data-source-line` equals `question.line`, then
  `buildWholeBlockAnchor` (`reviewAnchor.ts:163-178`). A comment belongs to the card only if
  `blockAtLine`, then `findHashNeighbor(…, NEIGHBOR_RADIUS)`, over `indexBlocks(card)` resolves
  it inside the unit. Build Copy answers from `usePlanningReviews`' data, never by
  concatenating cards, so each comment appears once.
- **`runCommand` posts only for the store's current `filePath`**
  (`useReviewStore.ts:443-446`). Build the body with the helper `addComment` uses (`:508-538`),
  a fresh `id` and `created_at` included, and POST to `{base}/review/comments?path=<doc>`. The
  handler accepts any path (`internal/api/review_command_handlers.go:84-110`) and broadcasts
  `review_changed`.
- **Slice the root-level block, not the list item.** A root-level block re-parses the same in
  isolation; an item cut out of a nested list or a blockquote does not. Render
  `questionCardSource` with `sourceLineOffset` and `embedded`, then hide everything outside the
  unit. Query within the card, never with `getElementById`: two documents can share an id.
- **Hiding renumbers ordered lists.** A `display: none` item does not increment the list
  counter, so [`OQ-B3`](agent-bootstrap.md#OQ-B3)'s card would read `1.` where the document
  reads `3.`. Before hiding, set `value` on the unit `<li>` and on each ancestor `<li>` to its
  position in the document.
- **Take this leaning shows only on an open question with a non-null `leaning`**
  ([§6.3](planning-index.md#63-a-question-on-the-page)); the in-page button shows on an open
  question without one. Its text still comes from the shared helper over the rendered card,
  never from `question.leaning`, so both paths file the same bytes.
- **Controls follow state on the page (Q5).** An open card offers Take, Answer… and Open
  document; an ✅ card offers Answer… and Open document; a 🔒 card, which only *Waiting* lists,
  offers Open document alone. Take the state from `question.state`, which A's agreement test
  holds equal to the column's.
- **The in-page button skips 🔒 and ✅ (Q5), and the column must not.** `answerableOpenQuestions`
  (`useOpenQuestionButtons.ts:216`) is the set both the button pass and the contents column
  list (`useDocumentOutline.ts:91`), so filter what the pass gets back from it (`:269`), never
  inside it: the column keeps listing every state, and `TableOfContents.test.tsx` already
  asserts it does. Read the state with the column's own rule, `questionLabel(stamped)` then
  `vantageOqStatus(marker) ?? vantageOqStatus(text)` (`useDocumentOutline.ts:133`, `:176`),
  never a second reading. Importing `questionLabel` makes the two hooks import each other;
  both export only functions, so the cycle is inert, and moving the helper would put D's file
  in E's set. A skipped question gets **no row at all**: no Take, no taken chip, no Undo.
- **The count follows the buttons, not the column.** `onCount` (`:276`) feeds the Review
  toggle's "N open questions here can be answered in one click" (`ViewerPage.tsx:320-328`), so
  it counts only the questions that get a row. It is reported before the review-mode gate, so
  the filter comes before the count, not inside the loop.
- **No scroll restoration exists:** `BrowserRouter` has none (`main.tsx:22`). Save `scrollY` by
  `location.key`, and restore after the cards render, once more after Mermaid and KaTeX settle.
- **Open document is a bare path, no hash.** `loadReview` auto-enables review mode for any
  document with comments (`useReviewStore.ts:407`), so a document answered from the page opens
  in review mode by that existing rule. The page neither sets nor clears the persisted
  per-document preference (`readReviewModePref`, `:46`).
- **Single-document Copy stays byte-identical.** `copyAllToClipboard`'s tests
  (`useReviewStore.test.ts:874-990`) stay unmodified. `respondingInstructions` uses the path in
  three places: the inbox file stem (`:938`), the `uvx vantage-check` line (`:950`) and the
  example JSONL's `"path"` (`:956`). A list names every path on the check line, gives one
  example line per path, and uses a fixed stem, since the filename is advisory (`:933-936`).
  One path renders exactly as today.
- **Filing does not reorder.** Order comes from `derivePlanningSections` alone.
- **The route sits under `.vantage`** because viewer URLs are `/<path>` and `/<repo>/<path>`,
  so `/planning/*` would shadow a top-level `planning/` directory and a repository named
  `planning`. `pathsafe.Resolve` refuses a `.vantage` path (`pathsafe.go:73-79`), and a
  source-dir scan never discovers a dot-named repository (`config.go:488`), so no servable
  document has this URL. Both servers fall back to `index.html` for it (`spa.go:32-61`).
- **Static exports** get no Take or Answer (`isStaticMode`, `useOpenQuestionButtons.ts:283`).
  The store gives `error` there, so the page shows the
  [§3.6](planning-index.md#36-failure) error (Q3).

**Tests.** Prove with `npm run test -w frontend` and `just e2e`.

- [§15](planning-index.md#15-what-done-looks-like)'s third bullet and
  [§13](planning-index.md#13-risks)'s last risk: for each question in
  [`agent-bootstrap.md`](agent-bootstrap.md) and each gallery shape
  ([`OQ-1`](../gallery/open-questions.md#OQ-1) to [`OQ-7`](../gallery/open-questions.md#OQ-7):
  list items, bare paragraph, blockquote, heading, no leaning), plus fixtures whose block uses
  a reference-style link and a footnote, file from the card and from the in-page button over
  the whole document, and assert equal `anchor`, `comment` and `fallback_text`. Answer… files
  the typed text on the same anchor.
- scoping: file on [`OQ-B3`](agent-bootstrap.md#OQ-B3) from its card; no other card lists the
  comment, Copy answers includes it once, and the card shows `3.`.
- card: it lists the question's existing comments, pending ones marked *waiting on the agent*,
  and names its document with that document's badge. Filing from the second card leaves the
  card order unchanged. Open document neither sets nor clears the persisted review-mode
  preference. The toolbar entry navigates to the page.
- sections: each rendered, each hidden when empty; the notices; the refused message; the error
  with Retry; Skipped and Could not read.
- Copy answers: the count, disabled with nothing pending, the grouping, other comments left
  out, one instructions block.
- keys: `g p` navigates; `KeyboardShortcuts.test.tsx` finds the row.
- Q5, in-page: over [`docs/gallery/status.md`](../gallery/status.md)'s three questions, review
  mode renders a Take this leaning row for 💬 [`OQ-1`](../gallery/status.md#OQ-1) only, none
  for ✅ [`OQ-2`](../gallery/status.md#OQ-2) or 🔒 [`OQ-3`](../gallery/status.md#OQ-3); the
  count reported is 1; the contents column still lists all three with their states. A ✅
  question with an existing take shows no taken chip and no Undo. A question with no marker
  still gets its row.
- Q5, page: a 🔒 card under *Waiting* has Open document and no Take or Answer…; an ✅ card
  under *Needs you* has Answer… and Open document and no Take.
- e2e `planning_page.spec.ts`: `g p` opens the page, and `/.vantage/planning` loads by URL; the
  fixture's unrouted question is listed; take a leaning, and Open document shows the same
  comment. For [§15](planning-index.md#15-what-done-looks-like)'s fourth bullet, Open document
  lands at the top, and Back restores the scroll position. Viewer, then `g p`, then Back
  issues exactly one batch request (count `/planning/sources` requests without `?path=`).

## WP-F1 — phase-1 docs and this repository's corpus

| Path | Change |
| :--- | :--- |
| `packages/vantage-md/src/styleGuide.ts` | `stage`, `next`, `depends-on`, `[planning]`; frontmatter as the stage's one home |
| `userguide/guides/planning.md` | new: badges, the `next` link, `[planning]` |
| `userguide/README.md` | a Guides row |
| `userguide/reference/configuration.md` | `[planning]` beside `[starred]` |
| `userguide/guides/vantage-check.md` | `index`, the four rules, the command-word and exit-2 notes |
| `userguide/reference/style-guide.md` | a pointer for planning frontmatter ([§10](planning-index.md#10-what-the-conventions-change)) |
| `.vantage.toml` | new: `[planning]` excluding `docs/gallery/**` and `frontend/e2e/fixtures/**`, the [§9](planning-index.md#9-configuration) stages, and `"planning/unrouted" = "warning"` (Q4) |
| `packages/vantage-check/test/repositoryConfig.test.ts` | new: this repository's `.vantage.toml` rejects a fixture path and a gallery path |
| `docs/**` frontmatter | `stage:` per the table below |
| `roadmap.md` | ordered link lists ([§6.1](planning-index.md#61-the-roadmap)), every item kept, its prose beneath (Q10) |

**Traps.**

- **The style guide contradicts [§3.3](planning-index.md#33-a-question) today.** Its
  `oq-missing` bullet says a 🔒 or ✅ question "needs no directive", but the index cannot see a
  🔒 question without one. Rewrite that sentence. Say nothing there about Take this leaning
  skipping 🔒 and ✅ (Q5): E ships that and F2 documents it, so phase 1's docs describe phase 1.
- **Style-guide examples are checked.** `directives.test.ts:118-146` runs every `yaml` fence
  carrying `vantage:` through the checker. A `depends-on:` there names a file the temp tree
  lacks, so give planning keys their own example.
- **The e2e fixtures are candidates here.** `ListAllFiles` does not apply `.gitignore`, and
  `frontend/e2e/fixtures/test_repo/` is neither hidden nor a default-excluded directory, so D's
  and E's planning fixtures would land on this repository's page and in its `index`.
- **After C and F1, the gate lists planning findings.** At `warning` it stays green and shows
  [`agent-bootstrap.md`](agent-bootstrap.md)'s five, which is
  [§15](planning-index.md#15-what-done-looks-like)'s second bullet. At `error`
  the roadmap must route them first.
- **Run `packages/vantage-check/dist/vantage-check` on every edited file.** `roadmap.md` is not
  in the gate's path list (`Justfile:203-204`).

Stages, as Q10 confirmed them. A `BUILT` document with no live question lands under
*Graduate*, which is the intended signal. A `done` stage takes the document off the page's
sections.

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

## WP-F2 — phase-2 docs (after E)

| Path | Change |
| :--- | :--- |
| `userguide/guides/planning.md` | the page and its URL, Copy answers, Referenced by, tree badges; that `/recent/*` and `/history/*` still shadow top-level directories of those names (Q13) |
| `userguide/reference/keyboard-shortcuts.md` | `g p` |
| `docs/reference/inline-markup.md` | "The one-click Open Question answer": the page files the same comment; the button's fourth condition, an open question, and the column that now lists more questions than there are buttons (Q5) |
| `userguide/features.md` | the Contents paragraph (`:171-175`): the column lists every question, and review mode's button and the Review toggle's count cover open ones only (Q5) |

## Ships with

- **Docs describing the old behavior:** the style guide's 🔒 sentence and the userguide's rule
  list (F1), `inline-markup.md`'s button section and `userguide/features.md`'s "the same set the
  Review toggle counts" (F2, for Q5), and the checker's `USAGE` (C). Check
  `docs/reference/inline-markup.md`'s claims, not just its links. The comment in
  `useDocumentOutline.ts` (`:102-107`) that calls the column and the buttons "the same set by
  construction" is E's to correct.
- **No changelog entry** (Q8). Release notes are written at release time, from the tree, as
  every release's are.
- **Surfaces:** the five `[planning]` keys and defaults, the two limit messages, the four rule
  ids and summaries, the `index` JSON `version`, the single-path mode and its four kinds,
  `removed_dirs`, the `/.vantage/planning` route, `data-vantage-planning-badge`,
  `data-vantage-link-target`.
- **Norms:** every commit passes `just check-ci`, which the pre-commit hook runs. A manifest
  change lands with `package-lock.json`; none is expected.
- **When all seven have landed:** delete this plan, move traps that proved real into a system
  doc (the `system-doc` skill), and take the roadmap item out. That commit records what the
  implementers had to rediscover and what they never needed.

## Don't

- **Parse Markdown in Go** (P4). The server lists, filters and reads.
- **Store anything for the page:** no snooze, no read state
  ([§6](planning-index.md#6-the-planning-page)). Comments already live in the review store.
- **Add npm `ignore`.** Q1 ruled for the server's matcher, and with git's semantics the
  checker and the server would disagree on every pattern.
- **Add a total-bytes cap, or take `.markdown` as a candidate.** Neither is in the design.
- **Walk the tree in `check`.** No rule needs more than the document and the roadmap.
- **Render cards from `question.title`** or any other summary:
  [§6.3](planning-index.md#63-a-question-on-the-page) requires the viewer pipeline.
- **Touch `web/dist`, the static builder or `docs/gallery/`.** Q3 ruled that a static export
  shows the failed-fetch error, which needs nothing from the builder.
- **Touch `CHANGELOG.md`** (Q8).

## The coordinator's rulings

All twenty questions this plan raised were ruled on 2026-09-28, each into the section of the
design it governs and a row of its [Decision Ledger](planning-index.md#decision-ledger) named
*Plan Q1* to *Plan Q20*. That ledger is where the numbers this plan cites resolve.

Eighteen rulings took the plan's default. Two did not, and the work packages above already
reflect them:

- **Q5.** An `oq` with no id, or a repeated one, is still counted with `id: null`, as the
  default had it. But **Take this leaning** is not offered on 🔒 or ✅ questions, neither in the
  viewer's review mode nor on the planning page, where a 🔒 question sits under *Waiting* with
  no Take or Answer… control. The contents column still lists them. WP-E builds and tests it.
- **Q8.** No `## [Unreleased]` section: F1 and F2 do not touch `CHANGELOG.md`, and release
  notes are written at release time, as today.

## Done — mirrors [§15](planning-index.md#15-what-done-looks-like)

- [ ] `roadmap.md` shows a badge on every link to a planning doc or question, and a compacted
  answer turns its badge to `✅ ruled` without a reload (D's e2e).
- [ ] `g p` opens the page, and on this repository it lists
  [`agent-bootstrap.md`](agent-bootstrap.md)'s questions under *Unrouted* (E, F1).
- [ ] Taking a leaning from the page gives a comment identical to the in-page button's (E's
  anchor test).
- [ ] **Open document** lands at the top, and Back restores the scroll position (E's e2e).
- [ ] `vantage-check index` prints the page's sections (C's deep-equal), and
  `planning/stage-vocabulary` fails on an off-vocabulary `stage` (C).
- [ ] The index is ready within 1 s of first load on this repository, and no first render waits
  for it: D logs the time; the landing commit records it.
- [ ] The [§3.3](planning-index.md#33-a-question) agreement test, `just check-ci` and
  `just e2e` are green.
