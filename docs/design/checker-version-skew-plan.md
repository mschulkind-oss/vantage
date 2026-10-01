---
title: "Checker version skew — implementation sketch"
date: 2026-09-30
status: draft
stage: SKETCH
next: "Complete against the tree once OQ-VS1 and OQ-VS5 are ruled, for the 0.8.0 pieces; the deferred pieces wait for a capability gap"
depends-on:
  - checker-version-skew.md#OQ-VS1
  - checker-version-skew.md#OQ-VS5
tags: [vantage-check, versioning, sketch]
---

# Checker version skew: implementation sketch

**Status:** 2026-10-01. Incomplete, and unstable while questions are open. **Do not build from this.** When this sketch and [`checker-version-skew.md`](checker-version-skew.md) disagree about behavior, the design wins.

These are notes that came up during design and need no ruling. The `implementation-plan` skill completes them against the tree.

## The 0.8.0 pieces

Built at `9507cac`, and not repeated here: the development-build name, the two-branch messages, the `style-guide` header line and their user-guide edits. Built after `958dab3`: `question`, `fallback`, the checker's config tolerance, `target` with its refusal and its note, the compatibility test (`just compat-previous`, [`notation.ts`](../../frontend/src/compat/notation.ts), which `just release` runs too), and the payload's exit-2 sentence. What is left is below.

- **The server's release version reaching the browser, for the payload.** Blocked on [OQ-VS1](checker-version-skew.md#OQ-VS1), whose leaning now puts it in 0.8.0. The routes below are candidates, and choosing between them is delegated.
  - **Baked into the bundle at build time.** This needs no new API. Both builders of a release bundle already know the semver. `just release <version>` runs `web-sync` after its changelog check ([`Justfile`](../../Justfile), the `release` recipe). `publish.yml` builds the frontend with `steps.ver.outputs.version` in scope. A `go install` build embeds the tag's committed bundle, which `just release` built, so it carries the version too. `just build` and `just deploy` bundles carry none, so their payloads stay bare. This route also avoids normalizing `buildinfo.Version()`.
  - **The WebSocket hello, or `/api/info`.** Neither carries the release version today. The hello carries `BuildVersion()`, which is a commit or a timestamp, and `/api/info` is `{name, root_path}`. With either one, normalize the version: remove a leading `v`, accept only `^\d+\.\d+\.\d+$`, and treat anything else as unknown. `buildinfo.Version()` returns `v0.7.1` for `go install` builds and a pseudo-version for local builds, because the release tags sit on bundle commits outside main.
  - `GET /api/perf/diagnostics` already carries `app_version` from `buildinfo.Version()` ([`perf_handlers.go:21`](../../internal/api/perf_handlers.go#L21)). No frontend code reads it, and it isn't meant as a contract for the app.
- **Tests that assert the bare payload command:**
  - `frontend/src/stores/useReviewStore.test.ts` at lines 1274, 1342, 2247 and 2309, and the regex at line 2295, which matches `` `uvx vantage-check `` with nothing before it;
  - `frontend/src/pages/PlanningPage.test.tsx` at line 2480.
  - The payload description in `userguide/guides/vantage-check.md`'s "How agents find out about it" changes with the payload.
  - The exit-2 sentence is already in the payload and pinned by its own test ("tells the agent that exit 2 is no reason to edit .vantage.toml"); the variable changes only the command before it.
- **Unknown `[starred]` and `[planning]` keys in the server.** Blocked on [OQ-VS5](checker-version-skew.md#OQ-VS5). The checker already warns and ignores an unknown `[planning]` key. [`version-skew-config.json`](../../internal/repoconfig/testdata/version-skew-config.json) records each reader's answer separately, and its cases "an unknown key", "an unknown sub-table" and "an unknown [starred] key" are the ones that flip for the server under A. The server polices its tables in `Parse` (`internal/repoconfig/repoconfig.go`, the loop over `meta.Undecoded()`).

## Hand-off: agent instructions outside this repository

The author's own skills live outside this tree, and their owner edits them. As of 2026-10-01, five `SKILL.md` files mention the checker: `vantage-docs`, `roadmap`, `design-doc`, `user-stories` (without `uvx`) and `system-doc`. These edits follow from [design §6.3](checker-version-skew.md#63-what-agent-instructions-must-say), and they are needed before the 0.8.0 tag:

- **`vantage-docs`.** Drop "correct for the Vantage in front of you" (`SKILL.md` around lines 34 and 254, and `references/style-guide.md` line 7). Adopt that section's list: the payload's command or bare `uvx`, and never change `target`. Delete "an older published guide is not evidence that the newer syntax is invalid". `SKILL.md` line 86 says to keep the `oq` directive on ✅ and 🔒 questions: they get `question` instead, from 0.8.0. Regenerate `references/style-guide.md` from the published 0.8.0 output once it exists.
- **`design-doc`** (`SKILL.md` line 399) and **`user-stories`** (`SKILL.md` line 284) both say a 🔒 or ✅ question keeps an `oq`-style directive. From 0.8.0 it is `question`, and the line should say which release the rule belongs to.
- **`roadmap`**: "use a version supporting `index`" becomes "0.8.0 or later".

## Deferred until a capability gap needs it

- **Archiving the guide.** Recover each released guide with `git show vX.Y.Z:packages/vantage-md/src/styleGuide.ts`. The 0.7.0 and 0.7.1 guides are identical: `styleGuide.ts` is 137 lines, and the guide it prints is 121.
  - The archive lives next to `styleGuide.ts`, so that every consumer can reach it.
  - `just release` only *checks* that the current guide is archived, and that no feature-table entry says `unreleased`. Recipes leave tracked files unchanged, so a developer commits the archive entry and the versions before cutting the release. The changelog check in the same recipe is the model.
- **Proofs for the feature table.**
  - Renderer proofs reuse the compatibility test's fetch, never an npm alias or any other dependency. That covers the sanitizer, the directive plugin and `FrontmatterDisplay` (in `vantage-md/react` at v0.7.1).
  - Proofs that need the app or the server run the published release binary end to end, in the e2e job or at release. These cover the review-mode button (`frontend/src/hooks/useOpenQuestionButtons.ts` at v0.7.1) and the server's handling of `[planning]` (`ours()`, `internal/repoconfig/repoconfig.go:133` at v0.7.1).
- **The effective target per root.** Follow `planningConfigFor` rather than the upward `[check]` walk.
- **`VANTAGE_VIEWER`** is read from `io.env`, beside `VANTAGE_CHECK_JOBS` (`packages/vantage-check/src/io.ts:14`).
- **The server reading `target`.** It's a top-level scalar decoded beside `theme`, and `ours()` is unaffected. Blocked on [OQ-VS2](checker-version-skew.md#OQ-VS2) only for what the server does when no target is declared.
