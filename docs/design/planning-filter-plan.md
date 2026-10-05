---
title: "Planning filter: implementation sketch"
date: 2026-10-05
status: draft
stage: SKETCH
next: "Build WP-1, the shared filter module, then WP-2, WP-3 and WP-4 in parallel against its API, and WP-5 last"
depends-on:
  - planning-filter.md
tags: [planning, vantage-check, agents, url, sketch]
summary: "How to build the planning filter: five work packages, the exported API of the shared module that the checker, the page and the viewer build against, and each package's files, tests, checks and traps, read from the tree at f8fda54."
---

# Planning filter: implementation sketch

**Status:** 2026-10-05. Written against `f8fda54` after reading the tree, with every question of the design ruled. It stays a sketch until WP-1 lands: the API below is the contract WP-2 to WP-4 build against, and WP-1's commit corrects this file if the tree forces a change.

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
  otherRoadmaps: { path: string; count: number }[]; // roadmap order
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
| `packages/vantage-md/src/planning/filterForms.json` | new: the fixture of forms ([§10.4](planning-filter.md#104-how-p0-is-checked)) |
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
- The previous tag: `pickPreviousRelease` (`frontend/src/compat/previousRelease.ts:63`) over `git tag --list 'v[0-9]*'`, with the tags' own versions as `published`, picks the newest tag offline.

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
- The fixture has no copy at `v0.8.1`: the comparison skips and says so when the tag, or the file at it, is absent.

**Fixture shape** (default): `{ index: { stages, files: { <path>: <markdown> } }, read: [{ text, canonical, keeps }], notUnderstood: [{ text, term } | { text, reason }] }`, with `keeps` in page order as `"<section id> <path>"` for a row and `"<section id> <path>#<OQ-id>"` for a question. Beside what [§10.4](planning-filter.md#104-how-p0-is-checked) lists, the index declares stages, has a routing roadmap and an unrouted question, so WP-3's parity test has requests to compare. The `keeps` of path forms come from `git check-ignore --no-index` over a scratch repository of the fixture's paths; the test's header says the command.

**Tests** (`frontend/src/lib/planningFilter.test.ts`, new, unless named):

- Every `read` entry: its `canonical`, its `keeps`, canonical text parsing to itself, and the round trip `URLSearchParams` → `canonical` through `planningLink`.
- Every `notUnderstood` entry: its `term` or `reason`. The limits configured down (`{ terms: 2, codePoints: 8 }`), never a 2,049-code-point input. Each end of each excluded range, inside quotes.
- Canonical rules 1 to 5, a case each. The comparator and the port agree wherever rule 3 writes a quoted value bare.
- `applyPlanningFilter`: one case per row of [§6.2](planning-filter.md#62-every-section-and-every-whole-index-value)'s table; order kept; an emptied section absent; a Blocked row kept by `path:` with every blocker, and dropped by `is:open`; `blockedLeftOut`; `otherRoadmaps` in roadmap order; a `#OQ-…` target in `waitsOutside`; `unmatched`; `requestText` null.
- `planningAgentRequest`: the `Filter:` line and its fencing around a backtick, unfiltered text byte-identical, and blocked-on read from `unfiltered` when the filtered sections keep a Ready row and drop its 🔒 entry (built by hand: no key of this release reaches it, [§6.3](planning-filter.md#63-blocked-on-reads-the-unfiltered-sections)).
- `readPastedPlanningLink`: bare, whole URL, daemon segment, the checker's two-line block, `localhost:8000/.vantage/planning?…` with no scheme, no `filter`, `roadmap`, fragment and page parameters ignored, no link. Default: read from the index of `/.vantage/planning` on, against a dummy base, because `new URL("localhost:8000/…")` takes `localhost:` for a scheme.
- `documentFilter`: `roadmap.md` → `path:/roadmap.md`, `plans/design.md` → `path:plans/design.md`, a space or `*` → quoted, a control character → `null`.
- Every notice form and clause, in both readers.
- The fixture against the previous tag: no `read` entry edited or removed.
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
| `planningPages.ts`, new | `readFilterRequest`, `withFilter` (deletes every section parameter, keeps the rest), `planningQuery` (form encoding, but `encodePlanningQueryValue` for `filter`), and `listedDocuments`: `listedQuestions`' paths plus the document of every Blocked and stage row ([§6.6](planning-filter.md#66-copy-agent-request-and-copy-answers)) |
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
- `navigate({ search })` writes the string as given, so Enter, ✕, paste and the open rewrite build it with `planningQuery`. Flips and picks keep `setSearch`'s form encoding, which [§6.4](planning-filter.md#64-the-url) accepts.
- Miss one identity of [§6.5](planning-filter.md#65-identities) and two filters share a set.
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

## Risks, and where to stop and ask

1. **`is:"open"`.** [§5.3](planning-filter.md#53-keys-and-how-terms-combine) lists the quoted form for `path:` only. Default: not understood, the reversible reading, since a later release may move a `notUnderstood` entry to `read` and never back. Stop and ask before putting it in `read`.
2. **A lone surrogate** in the box's text: no excluded range covers it, and `encodeURIComponent` throws on it. Default: not understood, for the same reason; pin it in the fixture.
3. **A pasted link wrapped in backticks or followed by a period** reads up to white space ([§7](planning-filter.md#7-the-filter-line)), so its filter is not understood and the notice names it. Trimming punctuation widens the pasted-link surface for good ([§10.3](planning-filter.md#103-how-a-key-is-added-later)): stop and ask.
4. **The release the target caution names** is not known. Default `FILTER_RELEASE = 0.9.0`, since a feature is a minor; confirm it before the tag, because a wrong value cautions the wrong repositories.
5. **A submodule's `.git` is a file too,** so the worktree caution names a submodule a linked worktree. The design's rule is the file test: stop and ask to narrow it.
6. **Criterion 8's long tasks.** A CI runner's long tasks are noise. Default: observe them in the e2e flow and report the figure, and keep the design's Status UNMEASURED if no stable assertion holds.
7. **macOS CI** (`ci.yml:55-57`) writes the fixture's NFC path to disk for the parity test. APFS preserves the form; HFS+ would not.
8. **`planningPath` now encodes**, which changes `g p` and the sidebar entry for a name holding `#`, `?`, `%` or a space, all broken today. Stop and ask if a test pins such a name unencoded.

## Don't

- Filter the index before deriving: it breaks *Blocked* and routing ([§3](planning-filter.md#3-what-exists-today)).
- Copy the parser into `frontend/src` or `packages/vantage-check`: one implementation, three readers ([F1](planning-filter.md#1-verdict-and-the-principles)).
- Apply as the reader types, or debounce: [§12](planning-filter.md#12-alternatives-with-verdicts) rejects it.
- Store anything: `preferences.test.ts` fails a new preference that has no follower, and the design stores nothing.
- Change `index`, `sections` or `roadmaps` in the JSON under `--filter`, or bump `INDEX_FORMAT_VERSION` or `SCAN_CACHE_SCHEMA`.
- Touch Go, `.vantage/inbox`, or `type="search"`.
