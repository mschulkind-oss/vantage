---
title: "Planning filter: implementation sketch"
date: 2026-10-05
status: accepted
stage: BUILT
next: "Graduate with the design into docs/reference/planning-index.md, moving the traps that proved real into its warnings, then delete this file"
depends-on:
  - planning-filter.md
tags: [planning, vantage-check, agents, url, sketch]
summary: "How to build the planning filter: nine work packages, the exported API of the shared module that the checker, the page and the viewer build against, and each package's files, tests, checks and traps. WP-1 to WP-5 were read from the tree at f8fda54, WP-6 to WP-9, live search, from 519cd66, and all nine are built."
---

# Planning filter: implementation sketch

**Status:** 2026-10-06 (`5013844`). Built. WP-1 to WP-4 landed from `29b07c8` to `d22eedc`, WP-5 in `9e02e2a`, and QA's fixes in `e92787c`, all written against `f8fda54`. WP-6 to WP-9, [live search](#live-search-wp-6-to-wp-9), were written against `519cd66` for the rulings of 2026-10-05 ([OQ-PF1](planning-filter.md#decision-ledger), [OQ-PF6](planning-filter.md#decision-ledger), [OQ-PF7](planning-filter.md#decision-ledger)): WP-6 landed in `a2cc14c`, WP-7 in `8b4df7c`, WP-8 in `5013844`, and WP-9 in the commit after it. [As built](#as-built) records where the tree departs from this file; the tree wins. MEASURED: T1 to T4 met on both trees on the one batch that could be judged, which began at a load average of 3.83 and rose to about 18, with T2 at 60 documents met by 1.2 ms; the figures, and the burst's one stale frame at 60 documents, are in the design's Status. A cold filtered link and an Enter shift nothing painted, leave `history.length` as it was, and make at most two review requests through a clear (`frontend/e2e/planning_filter.spec.ts`). UNMEASURED: criterion 8's long tasks on a cold load ([risk 6](#risks-and-where-to-stop-and-ask)), and the rest the design's [§14](planning-filter.md#14-costs-and-what-is-unmeasured) lists.

**Design:** [`planning-filter.md`](planning-filter.md). It wins on behavior, the tree wins on fact, and this file is advice and the first thing to be wrong: never twist the code to match it. Every line here is a **must** (a fact of the repository) or a default with its reason. Where the design is silent, the implementer decides, and the default is named.

**Reads with:** [`planning-filter.md`](planning-filter.md) (the design; its terms, [§2](planning-filter.md#2-terms), are used here undefined), [`planning-index.md`](../reference/planning-index.md) (the system it extends).

A **work package** (WP, coined here) is one unit of this build, landing as one commit with its tests.

| WP | Scope | Starts after |
| :--- | :--- | :--- |
| WP-1 Core | the filter module in `packages/vantage-md/src/planning/`, its fixture, `planningRoute.ts` | nothing |
| WP-2 CLI | `packages/vantage-check` | WP-1 |
| WP-3 Page | the planning page and the shell's `/` | WP-1; its parity test also needs WP-2 |
| WP-4 Viewer | Referenced by's link | WP-1 |
| WP-5 Docs | user guide, references, style guide, `CHANGELOG.md`, the design | WP-2, WP-3, WP-4 |
| [WP-6](#wp-6-core-and-checker-the-language) Core and checker | text terms, exclusions and the colon rule in the filter module, its fixture and notices, and the checker's JSON and help | WP-1 to WP-5 |
| [WP-7](#wp-7-page-applying-as-you-type) Page | applying as you type, the idle write, the caches and the review request | WP-6 |
| [WP-8](#wp-8-harness-the-typing-flow) Harness | the typing flow that reads T1 to T4 | WP-7 |
| [WP-9](#wp-9-docs) Docs | the guides, the checker's reference, `CHANGELOG.md`, the design once measured | WP-6, WP-7, WP-8 |

## The WP-1 API

The contract. Every name is re-exported from `planning/index.ts`, so the frontend imports `vantage-md/planning` and the checker `../../../vantage-md/src/planning/index.js`.

```ts
// filter.ts (new)
export const PLANNING_FILTER_PARAM = "filter";
export const PLANNING_ROADMAP_PARAM = "roadmap"; // planningPages.ts's ROADMAP_PARAM becomes this
export const PLANNING_PAGE_PATH = "/.vantage/planning"; // planningRoute.ts's PLANNING_ROUTE becomes this

export interface PlanningFilterLimits { terms: number; codePoints: number }
export const PLANNING_FILTER_LIMITS: Readonly<PlanningFilterLimits>; // { terms: 64, codePoints: 2048 }

export type PlanningFilterTerm =
  /** `text` is the canonical term (`path:docs/x.md`); `value` is unquoted, unescaped, rule 2 applied. */
  | { key: "path"; text: string; value: string; quoted: boolean }
  | { key: "is"; text: "is:open"; value: "open" };
/** Why a filter is not understood where there is no term to name (§6.7). */
export type PlanningFilterReason = "unclosed-quote" | "too-many-terms" | "too-long";
export type PlanningFilter =
  | { kind: "none" } // "" or white space alone
  | { kind: "understood"; canonical: string; terms: readonly PlanningFilterTerm[] }
  /** `text` as written; exactly one of `term` and `reason` is non-null. */
  | { kind: "not-understood"; text: string; term: string | null; reason: PlanningFilterReason | null };
export type UnderstoodPlanningFilter = Extract<PlanningFilter, { kind: "understood" }>;
export type NotUnderstoodPlanningFilter = Extract<PlanningFilter, { kind: "not-understood" }>;

/** One filter text: the box's, or every `filter=` / `--filter` value joined with one space. */
export function parsePlanningFilter(text: string, limits?: PlanningFilterLimits): PlanningFilter;
/** Its path is a kept document, and an `is:` term, if any, matches its state. */
export function filterKeepsQuestion(
  filter: UnderstoodPlanningFilter,
  question: { path: string; state: QuestionState },
): boolean;

export interface PlanningFilterSummary {
  canonical: string;
  /** `canonical` less its unmatched terms (§6.6); `null` when every `path:` term is unmatched. */
  requestText: string | null;
  entries: { shown: number; of: number };
  documents: { kept: number; of: number };
  openQuestions: number;
  blockedLeftOut: number;
  onOtherRoadmaps: number; // the filtered onOtherRoadmaps' length: each question once, the notice's total
  otherRoadmaps: { path: string; count: number }[]; // roadmap order; a question two roadmaps route counts under both
  waitsOutside: { path: string; target: string }[]; // target as dependsOnLabel writes it
  unmatched: string[]; // canonical term texts, in order
}
export interface FilteredPlanningSections { sections: PlanningSections; summary: PlanningFilterSummary }
/** `sections` is `derivePlanningSections` over the whole index (F2); the result has its shape, entries removed, order kept. */
export function applyPlanningFilter(
  index: PlanningIndex,
  sections: PlanningSections,
  filter: UnderstoodPlanningFilter,
): FilteredPlanningSections;

/** Everything but A–Z a–z 0–9 - . _ ~ : / percent-encoded as UTF-8, a space as `+` (§9.2). */
export function encodePlanningQueryValue(value: string): string;
/** `<path ?? PLANNING_PAGE_PATH>?filter=<canonical>`, then `&roadmap=<roadmap>` when given. */
export function planningLink(canonical: string, options?: { roadmap?: string | null; path?: string }): string;
/** `path:/<path>` in canonical text (§5.6), or `null` when that is not understood. */
export function documentFilter(path: string): string | null;
/** The first planning link in pasted text (§7): its `filter` values joined with a space ("" for none), its `roadmap`. */
export function readPastedPlanningLink(text: string): { filter: string; roadmap: string | null } | null;

// guide.ts
/** A CommonMark code span: one backtick more than the longest run inside, padded where it starts or ends with one. */
export function codeSpan(text: string): string;
export interface PlanningAgentRequestOptions {
  // …repository, ids, viewer as today
  /** An applied filter: `Filter: <codeSpan(text)>. Only the entries it keeps are listed.` after `Repository:`, and every blocked-on fact read from `unfiltered` (§6.3). */
  filter?: { text: string; unfiltered: PlanningSections };
}

// sections.ts
export type PlanningNoticeLine = readonly (string | { code: string })[];
export type PlanningNoticeReader = "page" | "checker";
/** A line as the checker prints it: each code part through codeSpan. */
export function noticeText(line: PlanningNoticeLine): string;
// PLANNING_NOTICES gains:
//   filtered(summary: PlanningFilterSummary, reader: PlanningNoticeReader): PlanningNoticeLine[];
//     the first line, one line per unmatched term, the clauses that apply, then the last line
//   notFiltered(filter: NotUnderstoodPlanningFilter): PlanningNoticeLine; // the page's Not understood form
//   filterNotUnderstood(filter: NotUnderstoodPlanningFilter): string;   // exit 2's message, unprefixed
//   nothingFilteredNeedsYou: string;                                    // "Nothing this filter keeps needs you."
export interface ReferenceSummary {
  // …as today
  /** Its stage has no done role and it holds at least one question: Referenced by links it (§7). */
  hasLiveQuestions: boolean;
}
```

## WP-1 Core

| Path | Change |
| :--- | :--- |
| `packages/vantage-md/src/planning/filter.ts` | new: grammar, not understood, canonical text, matching, `applyPlanningFilter`, link, paste reader |
| `packages/vantage-md/src/planning/filterForms.json` | new: the fixture of forms ([§10.4](planning-filter.md#104-how-it-is-checked)) |
| `packages/vantage-md/src/planning/sections.ts:127-199` | the four `PLANNING_NOTICES` members (type and object), and `noticeText` |
| `…/sections.ts:537-606` | `hasLiveQuestions`, set in `referenceSummary` from `isLive` |
| `…/guide.ts:215-276`, `:298-314`, `:458-503` | `filter` option and `codeSpan`; `requestBlock`, `documentItem` and `blockedOn` take the sections blocked-on reads |
| `…/planning/index.ts:20-114` | the exports |
| `frontend/src/lib/planningRoute.ts:11-22` | `PLANNING_ROUTE = PLANNING_PAGE_PATH`; `planningPath` percent-encodes the repository segment ([§9.4](planning-filter.md#94-daemon-mode)), as `cmd/vantage/tips.go:201` does with `url.PathEscape` |
| `frontend/src/test/planning.ts` | a loader for the fixture, and its index built with `indexOf` |
| `docs/design/planning-filter.md:27` | **Reads with** names this file as the sketch |

**Reuse.**

- `compileIgnorePatterns([pattern])` (`patterns.ts:103`), compiled once per bare term, with `/` prefixed to an anchored one ([§5.4](planning-filter.md#54-path-patterns)). Never for a quoted value.
- `routeQuestions`, `questionFor`, `findDocument`, `dependsOnLabel`. `waitsOutside[].target` is `dependsOnLabel(entry)`, fragment included.
- The 0.8.x model: copy `pageSearch` and `planningSearch` from `git show v0.8.1:frontend/src/lib/planningPages.ts` into the test, as `questionOffersTake` models 0.7.1 (`frontend/src/compat/notation.ts:117-133`).

**Traps.**

- **White space is `[ \t\r\n]` only** ([§5.2](planning-filter.md#52-grammar)). JavaScript's `\s` also splits at U+00A0 and U+2000 to U+200A, which must instead make a term not understood.
- **Code points, not `.length`**: `[...text].length` for the 2,048 limit.
- `encodeURIComponent` leaves `! ' ( ) *` bare, and `*` must be `%2A`.
- **No runtime import cycle.** `filter.ts` imports `sections.ts`, `guide.ts`, `patterns.ts` and `model.ts`, and nothing but `index.ts` imports it back: the notice members use `import type` for the summary, and `codeSpan` lives in `guide.ts`. Otherwise `PLANNING_NOTICES` is built before its imports exist.
- **Plain data across the boundary** (`planning/index.ts:16-18`): no compiled matcher inside `PlanningFilter`. Default: a module `WeakMap` from the filter object to its matchers, because the page's recount calls `filterKeepsQuestion` once per routed question.
- `requestText` is `null` when every `path:` term is unmatched: dropping them all leaves `is:open`, which keeps every open question.
- `entries.of` sums the unfiltered entry arrays (`needsYou`, `unrouted`, `waiting`, `ready`, `graduate`, `disagrees`, `skipped`, `unreadable`); `onOtherRoadmaps` is counted and never an entry. `documents.of` counts `documents`, `skipped` and `unreadable`.
- `needsYouCount` and `nothingNeedsYou` are recounted from the index: `routeQuestions(index, path)` and the live documents. `isLive` is private to `sections.ts`: export it from there, not from `index.ts`.
- `just check-fast` sees a `.json` under `packages/vantage-md/src/` as no module (`scripts/check-fast.sh:78-83`, `:140-155`), so a fixture-only edit runs no vitest at commit: run the suites by hand. It is hashed into the scanner id (`frontend/src/planningScan/scannerId.ts:57-79`), costing one cold scan in a release that pays it anyway.

**Fixture shape** (default): `{ index: { stages, files: { <path>: <markdown> } }, read: [{ text, canonical, keeps }], notUnderstood: [{ text, term } | { text, reason }] }`, with `keeps` in page order as `"<section id> <path>"` for a row and `"<section id> <path>#<OQ-id>"` for a question. Beside what [§10.4](planning-filter.md#104-how-it-is-checked) lists, the index declares stages, has a routing roadmap and an unrouted question, so WP-3's parity test has requests to compare. The `keeps` of path forms come from `git check-ignore --no-index` over a scratch repository of the fixture's paths; the test's header says the command.

**Tests** (`frontend/src/lib/planningFilter.test.ts`, new, unless named):

- Every `read` entry: its `canonical`, its `keeps`, canonical text parsing to itself, and the round trip `URLSearchParams` → `canonical` through `planningLink`.
- Every `notUnderstood` entry: its `term` or `reason`. The limits configured down (`{ terms: 2, codePoints: 8 }`), never a 2,049-code-point input. Each end of each excluded range, inside quotes.
- Canonical rules 1 to 5, a case each. The comparator and the port agree wherever rule 3 writes a quoted value bare.
- `applyPlanningFilter`: one case per row of [§6.2](planning-filter.md#62-every-section-and-every-whole-index-value)'s table; order kept; an emptied section absent; a Blocked row kept by `path:` with every blocker, and dropped by `is:open`; `blockedLeftOut`; `otherRoadmaps` in roadmap order; a `#OQ-…` target in `waitsOutside`; `unmatched`; `requestText` null.
- `planningAgentRequest`: the `Filter:` line and its fencing around a backtick, unfiltered text byte-identical, and blocked-on read from `unfiltered` when the filtered sections keep a Ready row and drop its 🔒 entry (built by hand: no key of this release reaches it, [§6.3](planning-filter.md#63-blocked-on-reads-the-unfiltered-sections)).
- `readPastedPlanningLink`: bare, whole URL, daemon segment, the checker's two-line block, `localhost:8000/.vantage/planning?…` with no scheme, no `filter`, `roadmap`, fragment and page parameters ignored, no link. Default: read from the index of `/.vantage/planning` on, against a dummy base, because `new URL("localhost:8000/…")` takes `localhost:` for a scheme.
- `documentFilter`: `roadmap.md` → `path:/roadmap.md`, `plans/design.md` → `path:plans/design.md`, a space or `*` → quoted, a control character → `null`.
- Every notice form and clause, in both readers.
- `frontend/src/lib/planningRoute.test.ts` (new): an odd name encoded, a plain one unchanged. `frontend/src/compat/planningLink.test.ts` (new): every link of a `read` text passes the 0.8.1 model with `filter` untouched and no page parameter.
- **Rewrite**, not repair: `planningSections.test.ts:1035`'s `toEqual` of `referenceSummary` gains `hasLiveQuestions`.

**Checks:** `cd frontend && npx vitest run src/lib/planningFilter.test.ts src/lib/planningSections.test.ts src/lib/planningGuide.test.ts src/lib/planningRoute.test.ts src/compat`, then `npx tsc --build frontend`, `npm run typecheck -w vantage-md` and `npm run typecheck -w vantage-check`. `just check-fast --plan` names what the hook adds.

## WP-2 CLI

| Path | Change |
| :--- | :--- |
| `packages/vantage-check/src/cli.ts:157-265` | `--filter <text>` and `--filter=<text>` beside `--roadmap`; repeats join with one space; no value is a usage error |
| `src/commands/index.ts:67-85` | `IndexOptions.filter?: string`, the joined text |
| `index.ts:104-184` | parse before `scanProject` (not understood: exit 2); after the `--roadmap` check, apply, and exit 2 with stdout empty on an unmatched term; a refused index skips both and exits 3 |
| `index.ts:240-261` | `requestOut` gets the filtered sections and `filter: { text: requestText, unfiltered }` |
| `index.ts:335-362` | `filter` as the last key, only with a filter |
| `index.ts:459-569` | [§8.3](planning-filter.md#83-output)'s order; `:553`'s pointer gains `--filter '<canonical>'` |
| `src/core/target.ts:199-207` | a `FILTER_RELEASE` beside `QUESTION_RELEASE`, and a predicate for the target caution, as `readsOnlyOq` is |
| `src/help.ts:57-69`, `:78-86` | the `--filter` row of [§8.3](planning-filter.md#83-output), and exit 2's line |

**Traps.**

- `--filter ''`, or white space alone, is no filter: no `filter` key and byte-identical output, in text, JSON and `--request`.
- The JSON key order is the design's: `text, canonical, link, documents, entries, openQuestions, blockedLeftOut, otherRoadmaps, waitsOutside, sections`. Spreading the summary leaks `requestText` and `unmatched`. Default for a refused index: `filter: null`, as `sections` is.
- `link` carries `roadmap=` only when two or more roadmaps route ([§9.2](planning-filter.md#92-the-link-it-prints)).
- The pointer shell-quotes: `'…'`, each `'` written `'\''`, since a quoted path can hold one. The package has no helper.
- Worktree caution: the root's `.git` is a file (`statSync(…).isFile()`). `repositoryRoot` (`core/projectRoot.ts:23-33`) also returns a root found by `.vantage.toml` alone, which gets no caution.
- The target caution reads `targets` from `index.ts:125`, already in hand.
- `--filter -path:x` is a value: `takeValue` takes the next argument whatever it is, so it exits 2 as not understood, never as an unknown option.
- Default: not-understood's message prints alone, as `--roadmap`'s does (`index.ts:162-165`), without the usage the `usage-error` path appends: the message already says what it reads. Cheap and yours.

**Tests** (`test/index.test.ts` and `test/cli.test.ts`):

- Parsing: `--filter a --filter=b` is `"a b"`; `--filter ''`; a trailing `--filter` is a usage error.
- Not understood: exit 2 before the scan, proved by a tree past `max-candidates` that still exits 2, naming the term (`OR`, `Path:`) or the reason (an unclosed quote).
- Unmatched: exit 2, each term on stderr, stdout empty, in all three outputs. Past `max-candidates` with a filter: exit 3.
- `--filter ''` byte-equal to no flag, three ways. JSON: `index`, `sections` and `roadmaps` stringify byte-equal to the unfiltered run, and `filter.sections` deep-equals `applyPlanningFilter`.
- Text: [§8.3](planning-filter.md#83-output)'s order; criterion 1 of [§15](planning-filter.md#15-success-criteria) over a copy of `frontend/e2e/fixtures/test_repo` with a `.git/HEAD` written, pinning the exact `Planning page:` line.
- `--request --filter` equals `planningAgentRequest` with the filter; with nothing to ask, stderr and exit 0.
- The pointer with a `'`; the worktree caution; the target caution under `target = "0.8"`; `roadmap=` with two routing roadmaps.
- Every fixture text: each `read` one runs, each `notUnderstood` one exits 2 naming its term or reason.
- No unfiltered assertion changes. If one must, the change is a bug.

**Checks:** `cd packages/vantage-check && npx vitest run test/index.test.ts test/cli.test.ts && npm run typecheck`; then `just cli` and `packages/vantage-check/dist/vantage-check index --filter 'path:/docs/design/planning-filter.md is:open'` here.

## WP-3 Page

| Path | Change |
| :--- | :--- |
| `frontend/src/lib/planningPages.ts:101-115`, `:261-293` | `PlanningLayout.filter`: the applied canonical text, `""` for none and for not understood |
| `planningPages.ts:302-323` | `sectionsOf(index, roadmap, filter = "")`, cached index → roadmap → filter, and the summary beside it |
| `planningPages.ts:326`, `:387-445` | `ROADMAP_PARAM` from WP-1; `planningSearch` writes an understood filter canonically as one parameter, deletes an empty one, and leaves a not-understood one alone |
| `planningPages.ts`, new | `readFilterRequest`, `withFilter` (deletes every section parameter, keeps the rest), `planningQuery` (form encoding, but `encodePlanningQueryValue` for `filter`, written first by `withFilter`), and `listedDocuments`: `listedQuestions`' paths plus the document of every Blocked and stage row ([§6.6](planning-filter.md#66-copy-agent-request-and-copy-answers)) |
| `frontend/src/lib/planningAnswers.ts:75-129`, `:157-189` | `pendingAnswers` and `needYou` take a keep predicate: place over every listed question, then narrow; `pendingAnswers` also returns how many it left out |
| `frontend/src/hooks/usePlanningPageInputs.ts:123-129`, `:405-423` | `inputsKey` gains `layout.filter`; `prefetchPlanningPage` takes a filter |
| `frontend/src/components/PlanningFilterLine.tsx` | new: the line of [§7](planning-filter.md#7-the-filter-line) |
| `frontend/src/pages/PlanningPage.tsx:1124-1166` | read, parse, derive and lay out with the filter; the canonical rewrite through `planningQuery` |
| `PlanningPage.tsx:1203-1271` | prefetch with `layout.filter`; `listedPaths` from `listedDocuments` over the unfiltered sections |
| `PlanningPage.tsx:1311-1384`, `:1497-1541` | placement with the predicate; Copy answers' tooltip and name; the frame's sections with the filter; `requestOf` with `filter` |
| `PlanningPage.tsx:1418-1436` | the filter spinner, as `roadmapSwapSlow` |
| `PlanningPage.tsx:800-824`, `:1982-2010` | the notice first, and the filtered *Nothing needs you* words in both places |
| `PlanningPage.tsx:1729-1734`, `:1870-1890` | register `/`; the line as `<main>`'s first child; *Choose a project* and *Repository not found* list `planningPath(true, name)` plus the query |
| `frontend/src/hooks/useShellPage.ts:48-78`, `:118-140` | an `onFocusFilter` registered, a `filterKey` published |
| `frontend/src/components/AppShell.tsx:154-198`, `:408-424`, `:705` | read both, as `onViewDiff` reads `pageRef.current?.shortcuts`; `filterKey` in the `publish` equality |
| `frontend/src/hooks/useKeyboardShortcuts.ts:130-212` | `/` calls `onFocusFilter` when one is registered |
| `frontend/src/components/KeyboardShortcuts.tsx:27-81`, `:125-138` | the `/` row, on the planning page only |

**Traps.**

- **The box is local state, reset from the URL when `location.key` changes.** `BrowserRouter` commits location in a transition (`main.tsx:38`), so a box controlled from `useSearchParams` drops keystrokes. A push (`g p`, the sidebar entry) or a pop (Back, Forward) resets it even while it has the focus; the page's own replaces (the open rewrite, a clamp, a flip, a pick) reset it only while it lacks the focus ([§7](planning-filter.md#7-the-filter-line)); `useNavigationType()` tells them apart. Enter, ✕ and paste set the text they navigate to first.
- `<form role="search">` submits on Enter: `preventDefault`, or the page reloads.
- `/` typed in the box is a path character, and already safe: the shell ignores keys while an input has the focus (`useKeyboardShortcuts.ts:67-77`). On a document `/` must not `preventDefault`, because Firefox's quick find uses it.
- Never register `PageShortcuts` here: it lists `d`, `h` and `y` in the help (`useShellPage.ts:128`).
- `navigate({ search })` writes the string as given, so Enter, ✕, paste and the open rewrite build it with `planningQuery`. Flips and picks kept `setSearch`'s form encoding until QA, which left a bare `*` in the address for the paste reader to stop at; they use `planningQuery` too now ([As built](#as-built)).
- Miss one identity of [§6.5](planning-filter.md#65-identities-and-what-typing-must-not-churn) and two filters share a set.
- The second reviews request reads the unfiltered sections' documents, so no filter change asks for a third: that is what keeps [D11](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured) at two.
- `data-reserve` draws nothing outside a ghost (`index.css:193-220`). A slot that holds room has a fixed width or uses `ReservedLabel`.
- Copy answers keeps "Copy answers" first in its accessible name: tests find it by `/Copy answers/` (`PlanningPage.test.tsx:1621`, `:2495`).
- Static export: `isStaticMode()` (`lib/staticMode.ts:38`) draws no line.

**Tests** (a new `describe` in `PlanningPage.test.tsx`, whose helpers are local at `:227-465`, unless named):

- A filtered link opened cold: criterion 2; one canonical rewrite keeping the fragment; not understood (every entry, the notice, `aria-invalid`, URL untouched); unmatched; each clause; nothing kept.
- Enter: one replace, section parameters gone, `roadmap` and `x=1` kept, fragment dropped, the old page up until its inputs are in, the spinner past a lowered `spinnerMs` (`setPlanningLimitsForTests`), the applied text again doing nothing.
- ✕, Esc and leaving the box, with the hint; `/` focusing and selecting; `/` inert with shortcuts off; criterion 9's `g p` then Back, focus in the box; the live region speaking after Enter or ✕ and never on open; `aria-describedby` naming the notice.
- Paste: a bare link, a whole URL from another origin, the checker's block, a link naming a roadmap, one with no `filter`, one not understood, and in daemon mode (criterion 11).
- The parity test at `:3065`, extended over every `read` text whose request is not empty; it runs the CLI, so it needs WP-2.
- Copy answers over kept questions with its tooltip count; a ✅ question nested in an open one, under `is:open`, keeps its comment (`planningAnswers.test.ts` too); opening filtered and then clearing makes two review requests.
- Daemon mode's two lists (criterion 10); the print line; no line in static mode; the `/` row (`KeyboardShortcuts.test.tsx`) and key (`useKeyboardShortcuts.test.ts`).
- `planningPages.test.ts`: each new function, and `sectionsOf`'s identity per filter. `usePlanningPageInputs.test.ts`: another filter is another set, beside `:210`.
- `frontend/e2e/planning_filter.spec.ts` (new): a cold filtered link and an Enter, each with zero layout shift (the observer of `planning_roadmaps.spec.ts:191`) and `history.length` unchanged (`:156-169`); `/` and paste the checker's block; `g p` and Back; the row unwrapped at a phone's width; `?filter=path:plans/design.md`, WP-4's link, showing the box holding it.
- **Rewrite**, not repair: tests counting the second reviews request's paths gain row documents. The anchored unfiltered URL patterns (`planning_page.spec.ts:345`) must not change: a failure there is a `filter` leaking into an unfiltered URL.

**Checks:** `cd frontend && npx vitest run src/pages/PlanningPage.test.tsx src/lib/planningPages.test.ts src/lib/planningAnswers.test.ts src/hooks src/components/KeyboardShortcuts.test.tsx`; `sh scripts/e2e-fixture.sh`, then `cd frontend && npx playwright test e2e/planning_filter.spec.ts e2e/planning_page.spec.ts e2e/planning_roadmaps.spec.ts e2e/planning_shell.spec.ts`; `just e2e` before the commit.

## WP-4 Viewer

| Path | Change |
| :--- | :--- |
| `frontend/src/components/ReferencedBy.tsx:56-65`, `:76-130` | a `planningHref` prop; `summaryLine` gains the part, and is not `null` when the link alone applies |
| `ReferencedBy.tsx:296-377` | the link after the disclosure button, and after the plain-text line, never inside either; it never shrinks, and the button's text truncates instead |
| `frontend/src/components/MarkdownViewer.tsx:829-868` | the href: `planningLink(documentFilter(path), { path: planningPath(isMultiRepo, currentRepo) })` when `hasLiveQuestions`, `documentFilter` is not `null`, and not `isStaticMode()` |

- **Must:** an `AppLink`, so Ctrl and middle clicks open a tab, and outside the `<button>`, since nested interactive content is invalid.
- The reservation logic (`MarkdownViewer.tsx:946-960`) stays as it is: a document holding a question is already reserved a line, by its frontmatter or by its directives.
- **Tests:** drawn for a live document with a question; absent for a `done` stage, for no questions and in static mode; its href in both modes, the repository encoded; a line holding only the link; one line when it fills a reservation; zero layout shift as the index lands (`frontend/e2e/referenced_by.spec.ts`).
- **Rewrite**, not repair: `MarkdownViewerPlanning.test.tsx:446-451` (`^1 open question not on the roadmap$`), `ReferencedBy.test.tsx`'s `summaryLine` cases and `referenced_by.spec.ts`'s line texts gain the part. Do not loosen the patterns.
- **Checks:** `cd frontend && npx vitest run src/components/ReferencedBy.test.tsx src/components/MarkdownViewerPlanning.test.tsx`, then `npx playwright test e2e/referenced_by.spec.ts`.

## WP-5 Docs

| Path | Change |
| :--- | :--- |
| `userguide/guides/planning.md` | a filtering subsection under *The planning page* (`:351`); the link under *Referenced by* (`:301`); *Several roadmaps* (`:456`), *Pages* (`:495`), *Copy answers* (`:675`), *Agent requests* (`:704`), *Reading it from the command line* (`:739`), *What this browser keeps* (`:794`) and *When something goes wrong* (`:839`) |
| `userguide/guides/vantage-check.md` | synopsis (`:673`), options (`:686-692`), JSON, exit codes (`:870-881`), and *Handing the human a filtered planning page*, with [§9.5](planning-filter.md#95-the-loop-and-what-agents-are-taught)'s loop |
| `userguide/reference/keyboard-shortcuts.md:26`, `userguide/features.md:289` | `/` |
| `docs/reference/agent-cli.md:274-284` | [§3.3](../reference/agent-cli.md#33-index-version-and-help): `--filter`, and why the link is root-relative |
| `docs/reference/planning-index.md` | [§14](planning-filter.md#14-costs-and-what-is-unmeasured)'s list: [§2](../reference/planning-index.md#2-terms), [§6](../reference/planning-index.md#6-the-planning-page), [§7.1](../reference/planning-index.md#71-referenced-by), the [§12.2](../reference/planning-index.md#122-every-late-datum-and-where-its-space-comes-from) row [§7](planning-filter.md#7-the-filter-line) words, [§13.2](../reference/planning-index.md#132-vantage-check-index), [§15](../reference/planning-index.md#15-failure-modes), [§17](../reference/planning-index.md#17-non-goals), and the Current values row at `:2579` |
| `packages/vantage-md/src/styleGuide.ts:70-104` | the bullet of [§9.5](planning-filter.md#95-the-loop-and-what-agents-are-taught) |
| `userguide/reference/style-guide.md:79-86` | one clause: the guide teaches the filtered link (that page summarizes the guide) |
| `CHANGELOG.md` | `## [Unreleased]` above `## [0.8.1]`, written to the `open-source-project` skill's changelog standard |
| `docs/design/planning-filter.md` | once built: `stage: BUILT`, a Status line with the commit and a measurement clause, the ledger's Built column |

- The section becomes the release body byte for byte, and `just release` refuses a version with no section: `[Unreleased]` is renamed at release.
- `packages/vantage-check/test/styleGuidePlanning.test.ts`: a test that the bullet's filter text is understood.
- **Checks:** `just cli`, then `packages/vantage-check/dist/vantage-check` over every changed Markdown file; `just compat-previous` after the style guide changes (it needs the network); `just done` last.

## Live search: WP-6 to WP-9

Read from the tree at `519cd66`, for the design's [OQ-PF1](planning-filter.md#decision-ledger), [OQ-PF6](planning-filter.md#decision-ledger) and [OQ-PF7](planning-filter.md#decision-ledger). These packages change behavior WP-1 to WP-3 built, so a test that pins the old behavior is **rewritten** to the new rule, never loosened to pass.

### WP-6 Core and checker: the language

| Path | Change |
| :--- | :--- |
| `packages/vantage-md/src/planning/filter.ts:56-63` | `PlanningFilterTerm` gains `{ key: "text"; text; value; quoted }`, and every term an `exclude: boolean`; `text` is the canonical term, its `-` included |
| `filter.ts:310-326` (`readTerm`) | the colon rule of [§5.2](planning-filter.md#52-grammar): a term is a qualifier only when the part before its first `:` is `path` or `is`; any other is a text term, and an unknown key's word is noted |
| `filter.ts:339-372` (`parsePlanningFilter`) | the leading `-` and a lone `-`; a `"` only around a whole value; `""`; an excluded code point in any term, not only inside quotes. `UnderstoodPlanningFilter` gains `unknownKeys: readonly string[]` |
| `filter.ts:415-450` (`Compiled`, `compiled`) | text needles lowercased once; the exclusions; `keepsPath` honoring `-path:` |
| `filter.ts:457-466` (`filterKeepsQuestion`) | takes a `PlanningQuestion`, since a text term reads its id, title and leaning; the four tests of [§5.3](planning-filter.md#53-what-a-term-matches-and-how-terms-combine) |
| `filter.ts:552-685` (`applyPlanningFilter`) | a row by its path, `stage` and `next` (`findDocument`), Too large and Unreadable by path; `blockedLeftOut` as [§6.7](planning-filter.md#67-the-filter-notice) counts it; `unmatched` includes `-path:`; `requestText` is `null` only when every `path:` term without a `-` is unmatched; the summary gains `unknownKeys` |
| `filter.ts:1-27`, `:796-815` | the header's "what a later release may never change" and the paste reader's "may only widen" go: nothing is frozen now ([§10.3](planning-filter.md#103-later-releases)) |
| `packages/vantage-md/src/planning/sections.ts:160-322` | `notFiltered` and `filterNotUnderstood` say what the language reads now; `filteredNotice` gains the *Not a key* line after the unmatched lines; `FILTER_EXAMPLE` (`:188`) may gain a word |
| `packages/vantage-md/src/planning/filterForms.json` | the entries below move from `notUnderstood` to `read`, with their `documents`, `questions` and `keeps`; the text cases of the design's [§10.4](planning-filter.md#104-how-it-is-checked) are added; every `read` entry gains `unknownKeys` |
| `frontend/src/lib/planningFilter.test.ts:266-332` | delete the comparison with the previous tag, the imports only it uses (`execFileSync`, `pickPreviousRelease`, `:19`, `:45`), and the header's last sentence (`:16-18`) |
| `frontend/src/lib/planningPages.ts:382-401` | bound `filteredSectionsOf`'s map per derivation, as `understoodFilter` keeps 16 (`:413`): typing applies a text per keystroke |
| `packages/vantage-check/src/commands/index.ts:566-591` (`filterJson`) | `unknownKeys` before `sections`; its comment's "may only widen" becomes P0's "keeps its meaning" ([§10.3](planning-filter.md#103-later-releases)) |
| `packages/vantage-check/src/help.ts:68-86`, `:100-105` | the row of the design's [§8.3](planning-filter.md#83-output); exit 2's line names a `-path:` term too |
| `packages/vantage-check/src/cli.ts:166-173` | the comment on `--filter -path:x`: an exclusion now, and still a value |

**What moves to `read`.** Of today's `notUnderstood`, these 14 are understood now: `Path:docs/design`, `PATH:docs/design`, `title:planning` and the fixture's `id:` entry (both with a hint), `docs/design`, `path:docs/design OR is:open`, `path:docs/design AND is:open`, `NOT path:docs/design`, `(path:docs/design)`, `"path:docs/design"`, `-path:docs/design`, `!path:docs/design`, `path:docs/design -is:open` and `path:docs/design Path:x OR`. Every other entry stays, the U+00A0 and U+2003 ones included: those characters sit inside a `path:` pattern.

**Reuse.**

- `findDocument` (`sections.ts`) for a row's `stage` and `next`; `questionFor` for a question entry's fields, as `keepsRef` already does.
- The lowercased fields: a module `WeakMap` from the `PlanningIndex` to them, built on the first text term. The research's 1 to 12 ms at 20,000 questions is a once-per-index cost.
- `notUnderstoodPart` (`sections.ts:173-178`) and `noticeText` (`:144`) for the new notice words.

**Traps.**

- **`toLowerCase` on both sides, per field.** Never join the fields into one string: a term would then match across two of them.
- **A text term's canonical form keeps its case** (rule 4 of [§5.6](planning-filter.md#56-canonical-text)), so `Generator` and `generator` are two terms, both kept. Only a repeat of the same canonical text is dropped.
- **`-is:open` drops no row.** A row has no state; `keepsRow` must not treat the exclusion as an `is:` term.
- **The hint's rule is exact:** one or more ASCII lowercase letters before the first `:`, not a key, and no `/` right after it. `http://x` draws none.
- **Unmatched for exit 2 now includes `-path:`.** The page shows it as a notice line either way.
- **The fixture is still the P7 check.** Both suites load it; only the cross-release rule goes.
- `just check-fast` sees `filterForms.json` as no module, so an edit to it alone runs no vitest at commit: run the suites by hand (`scripts/check-fast.sh:78-83`).

**Tests** (`frontend/src/lib/planningFilter.test.ts`, unless named):

- Each test of [§5.3](planning-filter.md#53-what-a-term-matches-and-how-terms-combine): every field alone, case, a phrase against the same words apart, NFC against NFD, `*` literal, two terms in two fields, never across one join.
- Each exclusion, `-is:open` keeping a row, `--x`, a lone `-`, `a"b"`, `""`, an excluded code point in a word, and the limits configured down.
- The hint: `stage:ready`, `-title:x`, and none for `http://x`, `Note:`, `Path:x` or a quoted phrase.
- Canonical rules 4 and 5, and the round trip through `planningLink` for every new `read` text.
- `applyPlanningFilter`: a Ready row kept by its `stage` while its 🔒 questions drop, with the request's blocked-on read from the unfiltered sections ([§6.3](planning-filter.md#63-blocked-on-reads-the-unfiltered-sections)); `blockedLeftOut` under a text term; `requestText` with an unmatched `-path:`.
- `packages/vantage-check/test/index.test.ts:1200-1229`: **rewrite** the not-understood cases, since `OR`, `Path:docs/design` and `-path:docs/a.md` are understood now; use `is:closed`, `a"b"` and an unclosed quote. Add: a text term matching nothing exits 0; `stage:ready` prints the hint and lists `unknownKeys`; an unmatched `-path:` exits 2.
- `packages/vantage-check/test/cli.test.ts:143-145` stays: `-path:x` is still a value.

**Checks:** `cd frontend && npx vitest run src/lib/planningFilter.test.ts src/lib/planningGuide.test.ts src/lib/planningPages.test.ts`, then `cd packages/vantage-check && npx vitest run test/index.test.ts test/cli.test.ts`, then `npx tsc --build frontend` and both packages' `npm run typecheck`. `just cli` before running the checker over this repository.

### WP-7 Page: applying as you type

| Path | Change |
| :--- | :--- |
| `frontend/src/components/PlanningFilterLine.tsx:163` | `onChange` reports each text to the page, except while an input method composes; `compositionend` reports the composed text |
| `PlanningFilterLine.tsx:119`, `:40`, `:208` | *not applied* is a not-understood text the reader has not entered, not "differs from the URL"; `FILTER_HINT` gets its words |
| `PlanningFilterLine.tsx:164-169` | Esc puts back the applied filter's text over a text that is not applied |
| `PlanningFilterLine.tsx`, new `onBlur` | asks the page to write the URL at once |
| `PlanningFilterLine.tsx:99-108` | a push or a pop still resets the box; a replace resets it only while it lacks the focus **and** its text does not read as the URL's filter (compare canonical texts, never strings), so no write of the box's own filter touches it, the blur's included |
| `frontend/src/pages/PlanningPage.tsx:1244-1254` | the applied filter: the box's newest understood text while it leads the URL, else the URL's |
| `PlanningPage.tsx:1314-1366` | `replaceSearch`, `pickRoadmap` and `flip` write the applied filter into the query they write, and cancel the idle timer |
| `PlanningPage.tsx:1347-1351` (`askedIsFlip`) | compares the shown layout's filter with the applied filter's layout, not the URL's |
| `PlanningPage.tsx:2016-2053` (`applyFilter`) | split in two: apply, on each understood text; and write, on the idle pause, Enter, ✕, a paste and the box's blur. Only Enter rewrites the box |
| `PlanningPage.tsx:2073-2126` | the live region speaks when a write lands, never per keystroke |
| `PlanningPage.tsx:1452-1455` | `readRest` also once the reader has changed the filter |
| `frontend/src/planningScan/limits.ts:83-135` | `filterIdleMs: 300` beside `spinnerMs`, so tests lower it through `setPlanningLimitsForTests` (`:152`) |
| `frontend/src/hooks/usePlanningPageInputs.ts:369-400` (`loadPageInputs`) | a set laid out for a text the reader has typed past leaves the cache once superseded, so typing holds at most two of the eight |
| `usePlanningPageInputs.ts:268-276` (`gather`) | a typed text's reviews wait on the visit's second request; `fetchPlanningReviews` already waits on a path in flight (`usePlanningReviews.ts:156-159`) |

**Traps.**

- **The echo is urgent and the results are not.** The box's text is local state, so its render is urgent already. Set the page's applied filter inside `startTransition`. A plain `setState` of it in the change handler puts the whole layout into the keystroke's task, and T1 fails.
- **The keyed remount is T2's likeliest miss.** `frameFilterKey` (`PlanningPage.tsx:1657-1658`) keys the sections' box (`:2314`), the section bar (`:2429`) and the frame's notices (`:2486`). It exists because Enter once shifted painted content by 0.078, and under typing it mounts every card again, Markdown and all, on each keystroke. Measure it with WP-8 before keeping it. If it must go, keep the cards that both texts show mounted, and hold T4 another way.
- **CLS forgives a shift only within 500 ms of the input** (`hadRecentInput`), so results that land later count against T4. Do not lean on the exclusion.
- **A push or a pop cancels a pending write.** Otherwise the timer writes the old text onto the entry Back just went to. `useNavigationType()` on a `location.key` change tells them apart, as `PlanningFilterLine` already does.
- **One write per pause.** `useScrollRestore` (`PlanningPage.tsx:232`) carries the scroll position to each replaced history key, so a write per keystroke would grow its map per keystroke.
- **Composition.** React fires `onChange` mid-composition. Read `nativeEvent.isComposing`, or track `compositionstart` and `compositionend`, and report on the end.
- **`navigate({ search })` writes the string as given**, so every write goes through `planningQuery`, as now.
- **Before the index is ready** there are no sections: the applied filter is recorded and the URL written, and the first layout uses it.

**Tests:**

- `frontend/src/components/PlanningFilterLine.test.tsx`: **rewrite** `:36-81`, which assume only Enter, ✕ and a paste apply. New: each change reported, nothing during composition, Esc over a not-understood text, a blur asking for a write, the hint.
- `frontend/src/pages/PlanningPage.test.tsx`, beside `describe("the planning filter …")` (`:4393`). **Rewrite** `:5010` ("applies nothing when the focus leaves it, and says Enter applies the text it holds"), `:5434` and `:5482` ("takes any other paste as text, applied on Enter"). New, with `filterIdleMs` lowered: a narrowing per keystroke; no history entry; one write after the pause and at once on Enter, ✕, a paste and a blur; the caret and selection unchanged by a write; a not-understood text keeping the page; a push or a pop cancelling a write; the live region after a write only; a flip and a pick carrying a pending filter; criterion 14.
- `frontend/src/hooks/usePlanningPageInputs.test.ts`: typing past a dozen texts leaves another history entry's set cached.
- Beside `PlanningPage.test.tsx:5709`: typing before and after the second request goes makes no third.
- `frontend/e2e/planning_filter.spec.ts`: criterion 13, typed with `page.keyboard.type` and a delay, with the layout-shift observer and `history.length`; **rewrite** `:183` ("applies typed text on Enter") as typing, then Enter.

**Checks:** `cd frontend && npx vitest run src/components/PlanningFilterLine.test.tsx src/pages/PlanningPage.test.tsx src/hooks/usePlanningPageInputs.test.ts src/lib/planningPages.test.ts`; then the e2e specs of WP-3 under the lock the task gives, and `just e2e` before the commit.

### WP-8 Harness: the typing flow

| Path | Change |
| :--- | :--- |
| `frontend/perf/planning/scenarios.ts` | `typingRun`: the design's [§16](planning-filter.md#16-typing-targets-and-how-they-are-read) flow. On a page whose index, first pages and second review request are in, `/`, then `generator is:open` at 150 ms a key, a second's wait, ✕ |
| `frontend/perf/planning/probe.ts:211`, `:227` | beside the long-animation-frame observer: an `event` observer with `durationThreshold: 16`, grouped by `interactionId`, for T1; and the paint probe for T2 |
| `frontend/perf/planning/run.ts` | targets `T1` to `T4` and `--targets typing`; p95 over the pooled keystrokes of every run; the load average already in the JSON |
| `frontend/perf/planning/README.md` | four rows in *How each target is read* |
| `frontend/src/pages/PlanningPage.tsx:2314` | `data-planning-filter` on the sections' box: the shown layout's canonical filter, which the paint probe reads |

**Traps.**

- **Time each key from the page.** T2 starts at the keydown's own `timeStamp`, never at the moment Node sent the key.
- **Event Timing rounds `duration` to 8 ms**, so T1's 32 ms is four steps of it.
- **The word must be in the fixture.** The copies' titles come from four sources at `SOURCES_COMMIT` (`fixture.ts:52`); *generator* is in two of [`agent-bootstrap.md`](agent-bootstrap.md)'s titles there, so every copy of it narrows the page. Assert that after the fixture is written, as its averages already are.
- **Ports.** The harness takes kernel ports already; never 8000, 8101, 8200, 8201 or 5201.
- Not part of the gate or CI: timings on a busy machine are noise.

**Checks:** `just planning-perf --targets typing --runs 10` on both cells, with the load average recorded, and once more in alternation with `519cd66` for a paired comparison.

### WP-9 Docs

| Path | Change |
| :--- | :--- |
| `userguide/guides/planning.md:784-938` | *Filtering the page*: as you type; *Writing a filter* (`:798`): words, phrases, the searched fields, exclusion, the colon rule and its hint, what is not understood now; *Using the box* (`:879`): Enter, ✕, Esc, leaving the box, the idle pause |
| `userguide/guides/vantage-check.md:694`, `:837-975`, `:976` | the option row, *Filtering* with a word in its example, `unknownKeys`, and the exit codes: an unmatched `-path:` exits 2, a text that matches nothing exits 0 |
| `docs/reference/agent-cli.md:281-290` | "a `path:` term that matches no path" gains "with or without its `-`" |
| `CHANGELOG.md:13-32` | the unreleased entry: the box narrows as you type, and finds words |
| `packages/vantage-md/src/styleGuide.ts` | unchanged: `path:` and `is:open` are still the loop agents run |
| `docs/design/planning-filter.md` | once built and measured: `stage: BUILT`, the ledger's Built column from the tree, and a Status whose measurement clause gives T1 to T4 with the load average |
| this file | [As built](#as-built) for WP-6 to WP-9 |

**Checks:** `just cli`, then `packages/vantage-check/dist/vantage-check` over every changed Markdown file; `just compat-previous` if the style guide changes after all; `just done` last.

## Risks, and where to stop and ask

1. **`is:"open"`.** Settled: not understood. The design's [§5.5](planning-filter.md#55-what-is-not-understood) lists it among the `is:` values the language does not read.
2. **A lone surrogate** in the box's text: no excluded range covers it, and `encodeURIComponent` throws on it. Default: not understood, for the same reason; pin it in the fixture.
3. **A pasted link wrapped in backticks or followed by a period.** Settled on 2026-10-05 in the design's [§7](planning-filter.md#7-the-filter-line): the link ends at the first character a link never holds unencoded, and loses the trailing punctuation GitHub's autolinks drop. Built in WP-1.
4. **The release the target caution names** is not known. Default `FILTER_RELEASE = 0.9.0`, since a feature is a minor; confirm it before the tag, because a wrong value cautions the wrong repositories.
5. **A submodule's `.git` is a file too,** so the worktree caution names a submodule a linked worktree. The design's rule is the file test: stop and ask to narrow it.
6. **Criterion 8's long tasks.** A CI runner's long tasks are noise. Default: observe them in the e2e flow and report the figure, and keep the design's Status UNMEASURED if no stable assertion holds.
7. **macOS CI** (`ci.yml:55-57`) writes the fixture's NFC path to disk for the parity test. APFS preserves the form; HFS+ would not.
8. **`planningPath` now encodes**, which changes `g p` and the sidebar entry for a name holding `#`, `?`, `%` or a space, all broken today. Stop and ask if a test pins such a name unencoded.
9. **T1 to T4 on a loaded machine.** A batch that began above a load average of 4 is reported, never judged ([§16](planning-filter.md#16-typing-targets-and-how-they-are-read)). If a quiet machine still misses a target, report the figure in the design's Status and stop and ask; do not move the target to fit.
10. **The keyed remount ([WP-7](#wp-7-page-applying-as-you-type)).** If removing it costs a layout shift that no other change avoids, stop and ask before trading T4 for T2.

## Don't

- Filter the index before deriving: it breaks *Blocked* and routing ([§3](planning-filter.md#3-what-exists-today)).
- Copy the parser into `frontend/src` or `packages/vantage-check`: one implementation, three readers ([F1](planning-filter.md#1-verdict-and-the-principles)).
- Debounce the results: only the URL waits for the idle pause, and [§12](planning-filter.md#12-alternatives-with-verdicts) rejects a wait before applying.
- Rewrite the box's text while the reader types, or add a history entry per filter ([§6.4](planning-filter.md#64-typing-and-the-url)).
- Store anything: `preferences.test.ts` fails a new preference that has no follower, and the design stores nothing.
- Change `index`, `sections` or `roadmaps` in the JSON under `--filter`, or bump `INDEX_FORMAT_VERSION` or `SCAN_CACHE_SCHEMA`.
- Touch Go, `.vantage/inbox`, or `type="search"`.

## As built

The tree at `d22eedc` for WP-1 to WP-5, then at `5013844` for [live search](#live-search-wp-6-to-wp-9), read against this file. Each item is something graduation states from the code, not from the sections above. Where live search changed an item of the first build, the item says so.

- **Module layout.** The limits live in `filterLimits.ts`, not `filter.ts`, so that the notices in `sections.ts` can name them without an import cycle; `filter.ts` re-exports them. Risks 1 and 2 kept their defaults: `is:"open"` and a lone surrogate are not understood.
- **The summary.** `PlanningFilterSummary` gained `onOtherRoadmaps`, the notice's total, each question once. `otherRoadmaps` names every roadmap but the chosen one that routes a kept question, so a question two of them route counts under both. Neither `requestText`, `unmatched` nor `onOtherRoadmaps` is a JSON key.
- **One wording for an unmatched term.** `PLANNING_NOTICES.filterUnmatched(term)` is both the checker's exit-2 message and the notice's line, less its period.
- **Notice words the design delegated.** *none of them open questions* when there are none; *It hides no entry.* when nothing is hidden; one *Waits on* line per kept document, naming every target it waits on; *Choose that roadmap* when only one other roadmap holds what it keeps.
- **The checker.** Its exit-2 messages set a term off as code, and the worktree caution sets the root off as code, as the design's [§9.2](planning-filter.md#92-the-link-it-prints) quotes it. The cautions are text only, with no JSON key. The help row says which characters need quotes. An empty `--request` under a filter ends *have no entries the filter keeps*. `FILTER_RELEASE` is `0.9.0` by [risk 4](#risks-and-where-to-stop-and-ask)'s default: confirm it before the tag. A submodule's `.git` is a file too, so the worktree caution still names a submodule a linked worktree (risk 5).
- **The page.** A filter change replaces the section bar, the notices with the sections, and the outline, keyed by the shown filter, rather than moving them: without it a first run measured a 0.078 layout shift on Enter. WP-7 keeps the sections' box and re-inserts it instead (below). A pending layout counts as a flip of the shown page only when both share one filter, so the old page's pagers stay as they were. The *Enter to apply* hint showed whenever the box differed from what was applied, until WP-7 gave the hint its live-search meaning. A pasted roadmap is written as the page's rewrite would leave it, so a paste is one replace. `/` closes the shortcuts help before it focuses the box. A push or a pop clears the live region. Copy answers' accessible name says what the filter leaves out only when it leaves out something. The first review request is as before; only the second widens, to every row's document.
- **The viewer.** `hasLiveQuestions` is read in `summaryLine`, and `MarkdownViewer.tsx` builds only the address. Below `sm`, with no line reserved, the link takes a line of its own and the separator is not drawn.
- **Tests that differ from the lists above.** Criterion 12 runs through `plans/paged.md`, because `planning.spec.ts` rewrites `plans/design.md` while other specs run; `planning_filter.spec.ts` opens `?filter=path:plans/design.md` directly.
- **After QA, `e92787c`.** Each finding QA reproduced landed with a test that failed before its fix.
  - **The paste reader** keeps the `*` the page's form encoding leaves bare, and drops a trailing `*` only where a `*` before the link in its run opened emphasis. It reads a repository segment by a URL path's characters, so a daemon project named `notes (old)` no longer ends the link before its query.
  - **The link's end.** `encodePlanningQueryValue(value, ends)` escapes a last `.`, `_`, `~` or `:`, and `planningLink` and `planningQuery` pass it for the value that ends what they write, because the paste reader drops those from a link's end.
  - **One encoding.** `withFilter` writes `filter` first, so with two routing roadmaps Enter's address is the checker's link. Flips, picks, outline jumps and the outline's hrefs all go through `planningQuery`.
  - **A filter's wait.** While the shown filter is not the URL's, `flip`, `prefetch` and `jumpToDocument` do nothing. The filter line's spinner is drawn when the reader applies a filter, or when the URL changes, and the `planning-reveal` class shows it after `spinnerMs`, because a timer's update commits only with the transition it waits on. `usePlanningPageInputs` forgets `slow` once a wait ends. The notices and the sections' box are keyed by whether the frame has landed as well as by the filter.
  - **Copy answers** is counted once the listed questions' documents are read, not every listed document, and is marked failed only when one of those is missing.
  - **Print.** With no filter the filter line is `print:hidden`, margin and all.
  - **The fixture** holds a `💬 🤷` question on a routed path and one with no marker on an unrouted path, and `path:Docs/design` and an NFD `path:"docs/café.md"` as unmatched read entries. Each read entry gained `questions`, and the previous-tag comparison leaves out `keeps`.
- **WP-5 left `docs/reference/planning-index.md` as it was.** The sections the WP-5 table names change at graduation, with the link [`agent-cli.md` §3.3](../reference/agent-cli.md#33-index-version-and-help) now makes to the design.

### Live search, at `5013844`

- **WP-6, the language (`a2cc14c`).**
  - **Kept documents are decided by `path:` and `-path:` terms alone,** through a new export, `filterKeepsDocument`; text and `is:` terms choose among a kept document's entries. `filterKeepsQuestion` takes the question itself, since a text term reads its id, title and leaning.
  - **The searched fields are lowercased once** per question, document and entry object of the index, each kept beside its object in a `WeakMap`. Section references resolve through a per-index line map, which also took a `path:`-only filter at 20,000 questions from about 6.7 ms to 4 ms (Bun, load average 7 to 10).
  - **The summary.** `unknownKeys` pairs each word with the terms that drew it, for the notice's line; the JSON lists the words alone. `requestText` leaves out unmatched `-path:` terms too, and is `""` when nothing else is left, which the request writes with no `Filter:` line. It is `null` only when every `path:` term without a `-` is unmatched.
  - **The fixture.** 14 `notUnderstood` entries moved to `read`; 42 text, phrase, exclusion and colon-rule entries and 20 not-understood ones were added; and every `read` entry gained `unknownKeys`. Its index gained a question whose title holds no id, a distinct leaning, and a `next`. The new entries' `keeps` are held to a plain second reading of the design's four tests ([§5.3](planning-filter.md#53-what-a-term-matches-and-how-terms-combine)), which is a test of its own.
  - **Words.** The Not filtered notice's example gained the word `generator`; the box's placeholder did not, and is still `path:docs/design/*.md is:open`.
  - `filteredSectionsOf` keeps the sixteen filters each derivation used last.
- **WP-7, the page (`8b4df7c`).**
  - **Re-insertion instead of the keyed remount.** The sections' box is no longer keyed by the filter. A layout effect removes it and puts it back in the same place before the browser paints. Chromium scores a re-inserted node as new rather than moved, so the layout shift stays 0, while every card the new filter still shows stays mounted. The section bar, the notices and the outline are still drawn anew. In alternating runs on this repository, at a load average of 5.5 to 7.5 and so not judged, T2's p95 was 38 to 41 ms against 79 to 84 ms with the keyed remount, so [risk 10](#risks-and-where-to-stop-and-ask)'s trade never arose.
  - **The typing slot.** Sets laid out for a typed text the URL has not taken live in a slot of their own, which keeps two, the set on screen and the newest, outside the eight-set cache. When the URL takes the text, its set moves into the cache and the same visit's earlier typed set leaves it, so a visit's typing costs one place, as an Enter does. Typed sets still lend their blocks to the next keystroke.
  - **The second review request.** Typing before the sections paint sends it at once, through a direct `fetchPlanningReviews` call: a flag passed to the reviews hook would let the page-inputs effect run first and make a third request.
  - **The box without the focus** is rewritten by a replace only while it still holds the URL's previous text. The design's [§7](planning-filter.md#7-the-filter-line) words it as "only when its text does not read as the URL's filter", which would wipe a not-understood text on the write a blur makes, against its own rule that a text that is not applied stays in the box.
  - **Writes.** `filterIdleMs` is 300 in `limits.ts`; one replace follows the pause, skipped when the URL already holds the text. Other pasted text is typing written at once. ✕ prevents its own `mousedown`, so pressing it does not take the focus from the box. A `popstate` listener, and a layout effect when a push or a pop commits, drop a write still owed. Flips, picks and outline jumps build on the applied filter's query and cancel the timer.
  - **The hint** reads *Not applied: Enter says why*, and its slot widened from `w-28` to `w-44`, since the text measured 169 px.
  - **The live region** speaks once per write. A section's flip announcement ignores a page change a filter caused, and the scroll saver keeps one identity across replaces, so the cards do not render again on each write.
  - **`data-planning-filter`** on the sections' box, the shown layout's canonical filter, landed here rather than in WP-8.
  - **A known gap.** The *Comments could not be loaded* alert sits inside the re-inserted box, so when the reviews request has failed, a screen reader may announce it again on every filter change, as it did on each Enter before.
  - **Mutation checks.** Of six deliberate breaks, the page tests catch five. The sixth, setting the applied filter outside the transition, breaks the echo rule, which jsdom cannot time; only the browser runs, the e2e spec and WP-8, cover it.
- **WP-8, the harness (`5013844`).**
  - **Which keystrokes count for T2** is decided by `vantage-md`'s own parser, through `frontend/perf/planning/filterText.ts`. Before any run, `vantage-check index --filter` checks that the query narrows each subject's page.
  - **`--repo` runs beside `--size`,** as one more subject in the same interleaved runs, instead of replacing the fixture.
  - **Beyond this file's flow:** a burst visit types the query again at 30 ms a key, to show that the newest text wins with no backlog; T1 also records the box's own repaint, unrounded, as *echo*; and T4 reports the shift both as the browser scores it and with the shifts it forgives after an input counted.
  - **What it found beyond T1 to T4** is the burst's stale frame at 60 documents, in the design's Status. A profile of 60 documents on an unminified build, which inflates times about 1.35 times, puts a slow keystroke, one that brings in cards not on screen before, at about 83 ms: 40 to 49 ms in the Markdown pipeline of the cards it mounts, 16 to 18 ms of style, layout and paint, paid on every keystroke because the sections' box is re-inserted, 7 to 10 ms in the clamp measurement's forced layout, and 6 to 10 ms in React's reconcile and commit. The filter itself took 0.3 ms or less. The first keystroke that needs card blocks from the worker also waits 37 to 58 ms on IndexedDB, cold on first use. In a paired run of 8 against 8, a per-card cache of the rendered Markdown took T2's p95 at 60 documents from 85.8 to 64.1 ms and the stale frame from 8 runs to none.
- **WP-9, the docs.** The style guide's bullet is unchanged, as the WP-9 table says: the loop it teaches still runs `path:` and `is:open`. The planning reference's Current values table gained the idle pause's row ahead of graduation, because `limits.ts` names that table as the list of its defaults.
