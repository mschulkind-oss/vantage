---
title: "Checker version skew — implementation sketch"
date: 2026-09-30
status: draft
stage: SKETCH
next: "Complete against the tree once OQ-VS1 is ruled, for the 0.8.0 pieces; the rest once OQ-VS2 and OQ-VS3 are"
depends-on:
  - checker-version-skew.md#OQ-VS1
tags: [vantage-check, versioning, sketch]
---

# Checker version skew: implementation sketch

**Status:** 2026-09-30. Incomplete, and unstable while questions are open. **Do not build from this.** When this sketch and [`checker-version-skew.md`](checker-version-skew.md) disagree about behavior, the design wins.

These are notes that came up during design and need no ruling. The `implementation-plan` skill completes them against the tree.

## The 0.8.0 pieces

- **The server's release version reaching the browser, for the payload.** Blocked on [OQ-VS1](checker-version-skew.md#OQ-VS1), which decides whether this is 0.8.0 or 0.8.1. The routes below are candidates, and choosing between them is delegated.
  - **Baked into the bundle at build time.** This needs no new API. Both builders of a release bundle already know the semver. `just release <version>` runs `web-sync` after its changelog check ([`Justfile`](../../Justfile), the `release` recipe). `publish.yml` builds the frontend with `steps.ver.outputs.version` in scope. A `go install` build embeds the tag's committed bundle, which `just release` built, so it carries the version too. `just build` and `just deploy` bundles carry none, so their payloads stay bare. This route also avoids normalizing `buildinfo.Version()`.
  - **The WebSocket hello, or `/api/info`.** Neither carries the release version today. The hello carries `BuildVersion()`, which is a commit or a timestamp, and `/api/info` is `{name, root_path}`. With either one, normalize the version: remove a leading `v`, accept only `^\d+\.\d+\.\d+$`, and treat anything else as unknown. `buildinfo.Version()` returns `v0.7.1` for `go install` builds and a pseudo-version for local builds, because the release tags sit on bundle commits outside main.
  - `GET /api/perf/diagnostics` already carries `app_version` from `buildinfo.Version()` ([`perf_handlers.go:21`](../../internal/api/perf_handlers.go#L21)). No frontend code reads it, and it isn't meant as a contract for the app.
- **Tests that assert the bare payload string:**
  - `frontend/src/stores/useReviewStore.test.ts` at lines 1274, 1330, 2235 and 2297, and the regex at line 2283, which matches `` `uvx vantage-check `` with nothing before it;
  - `frontend/src/pages/PlanningPage.test.tsx` at line 2365.
- **Local checker builds report `vantage-check 0.1.0`.** `packages/vantage-check/scripts/build.ts` stamps `package.json`'s placeholder, and only CI stamps the real version. A local build should stamp something the checker recognizes as a development build.
- **Which messages need the two-branch wording** ([design §6.2](checker-version-skew.md#62-what-a-checker-says-about-a-name-it-doesnt-know)):
  - the three `vantage/unknown-*` rules (`unknown-name`, `unknown-key` and `unknown-value`) in `packages/vantage-check/src/rules/directives.ts`;
  - `ConfigError` for `check.*` and `planning.*` keys, and `assertRuleId`, in `packages/vantage-check/src/core/config.ts`.
- **The `style-guide` header line** goes in `packages/vantage-check/src/commands/styleGuide.ts`, not in `STYLE_GUIDE` itself. It breaks the byte-identity assertion in `packages/vantage-check/test/cli.test.ts` (around line 124), which should then assert the guide *after* the header.
- **User-guide lines that change in 0.8.0:**
  - `userguide/reference/style-guide.md`, lines 16 and 27;
  - `userguide/guides/vantage-check.md`: the opening examples (line 12), the `>> AGENTS.md` recipe (line 419) and the CI example (around line 631).
  - The payload description in "How agents find out about it" (around lines 575 to 577) changes with the payload.

## Hand-off: agent instructions outside this repository

The author's own skills live outside this tree, and their owner edits them. As of 2026-09-30, five `SKILL.md` files mention the checker: `vantage-docs`, `roadmap`, `design-doc`, `user-stories` (without `uvx`) and `system-doc`. These edits follow from [design §6.3](checker-version-skew.md#63-what-agent-instructions-must-say), and they are needed before the 0.8.0 tag:

- **`vantage-docs`.** Drop "correct for the Vantage in front of you" (`SKILL.md` around lines 34 and 254, and `references/style-guide.md` line 7). Adopt the lookup order and the self-check. Delete "an older published guide is not evidence that the newer syntax is invalid". Regenerate `references/style-guide.md` from the published 0.8.0 output once it exists. "Do not compensate with copied status tables" (around line 65) is a convention no check can detect, so say which release it belongs to.
- **`design-doc`** (`SKILL.md` line 399) and **`user-stories`** (`SKILL.md` line 284) both restate the 0.8 rule that a 🔒 or ✅ question keeps its directive, with no version attached.
- **`roadmap`**: "use a version supporting `index`" becomes "0.8.0 or later".

## The next release

- **Archiving the guide.** Recover each released guide with `git show vX.Y.Z:packages/vantage-md/src/styleGuide.ts`. The 0.7.0 and 0.7.1 guides are identical: `styleGuide.ts` is 137 lines, and the guide it prints is 121.
  - The archive lives next to `styleGuide.ts`, so that every consumer can reach it.
  - `just release` only *checks* that the current guide is archived, and that no feature-table entry says `unreleased`. Recipes leave tracked files unchanged, so a developer commits the archive entry and the versions before cutting the release. The changelog check in the same recipe is the model.
- **Proofs for the feature table.**
  - For `npm` proofs, install the published `vantage-md@0.7.1` under an npm alias, the same way the `typescript-5` alias pins the oldest supported compiler. That adds a root devDependency and a lockfile change. It covers the sanitizer, the directive plugin and `FrontmatterDisplay` (in `vantage-md/react` at v0.7.1).
  - For `binary` proofs, run the published 0.7.1 release binary end to end, in the e2e job or at release. These cover the review-mode button (`frontend/src/hooks/useOpenQuestionButtons.ts` at v0.7.1) and the server's handling of `[planning]` (`ours()`, `internal/repoconfig/repoconfig.go:133` at v0.7.1).
- **The vocabulary diff.** v0.7.1's `packages/vantage-md/src/index.ts` exports `DIRECTIVE_VOCABULARY` (line 32), `sanitizeSchema` (line 90) and `STYLE_GUIDE` (line 107). Diff each one, from the npm alias against the source.
- **Reading `target` per root.** Follow `planningConfigFor` (`packages/vantage-check/src/core/config.ts:160`) rather than the upward `[check]` walk. `style-guide` needs `repositoryRoot(io.cwd)`, as `index` uses.
- **`VANTAGE_VIEWER`** is read from `io.env`, beside `VANTAGE_CHECK_JOBS` (`packages/vantage-check/src/io.ts:14`).
- **The server reading `target`** (later). It's a top-level scalar decoded beside `theme`, and `ours()` is unaffected. Blocked on [OQ-VS2](checker-version-skew.md#OQ-VS2) only for what the server does when no target is declared.
