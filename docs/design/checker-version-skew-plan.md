---
title: "Checker version skew — implementation sketch"
date: 2026-09-30
status: draft
stage: SKETCH
next: "Nothing for 0.8.0: its pieces are built. The deferred pieces wait for a capability gap; the hand-off below is the skills' owner's"
tags: [vantage-check, versioning, sketch]
---

# Checker version skew: implementation sketch

**Status:** 2026-10-01. Incomplete: no question is open, and what is left is the deferred machinery, which waits for a capability gap. **Do not build from this.** When this sketch and [`checker-version-skew.md`](checker-version-skew.md) disagree about behavior, the design wins.

These are notes that came up during design and need no ruling. The `implementation-plan` skill completes them against the tree.

## The 0.8.0 pieces

Built at `9507cac`, and not repeated here: the development-build name, the two-branch messages, the `style-guide` header line and their user-guide edits. Built after `958dab3`: `question`, `fallback`, the checker's config tolerance, `target` with its refusal and its note, the compatibility test (`just compat-previous`, [`notation.ts`](../../frontend/src/compat/notation.ts), which `just release` runs too), and the payload's exit-2 sentence. The rest followed:

- **Built after `936e24b`, once [OQ-VS1, OQ-VS5 and OQ-VS6](checker-version-skew.md#decision-ledger) were ruled on 2026-10-01:**
  - **The viewer's release, baked into the bundle.** Of the routes this sketch listed, the build-time one: it is the release of the code in the tab, with no API and no race. `frontend/src/lib/viewerRelease.ts` reads `__VANTAGE_RELEASE__`, which `frontend/vite.config.ts` defines from `VANTAGE_RELEASE`, and `publish.yml` and `just release` set that for the bundles they build. `checkCommand` in `useReviewStore.ts` puts `VANTAGE_VIEWER=<release>` in front of the checker command, so the document's Copy and the planning page's Copy answers stay byte-identical. `viewerReleasePayload.test.ts` runs the payload as a release build.
  - **Unknown `[starred]` and `[planning]` keys in the server.** `Parse` in `internal/repoconfig/repoconfig.go` returns a warning for each, which `Config` logs once per version of the file; `theme`, `target` and `starred` inside those tables still refuse the file, in the checker's words. `buildinfo.Release` names the server's release in the warning. The three cases of `version-skew-config.json` flipped, and the checker's `[planning]` warning now says the server ignores the key too.
  - **One `question` directive.** `mergeQuestionRun` in `packages/vantage-md/src/vantageDirectives.ts` merges a run for the plugin and the planning scan alike, so the page and the index cannot disagree; `questionOffersTake` reads Take this leaning off the state. The checker's `checkQuestionNames` gives each `oq` one finding, `vantage/question-name` or `vantage/oq-deprecated`, and `rules/questionLayout.ts` is `vantage/question-layout`. The compatibility model in `notation.ts` tells 0.7's affordance from 0.8's by the page's `data-vantage-question` stamp.
  - **`vantage/frontmatter-value`'s two branches**, from `typoOrNewer`, in its `detail`, for a string value only.

## Hand-off: agent instructions outside this repository

The author's own skills live outside this tree, and their owner edits them. As of 2026-10-01, five `SKILL.md` files mention the checker: `vantage-docs`, `roadmap`, `design-doc`, `user-stories` (without `uvx`) and `system-doc`. These edits follow from [design §6.3](checker-version-skew.md#63-what-agent-instructions-must-say), and from [OQ-VS6](checker-version-skew.md#decision-ledger)'s one directive; they are needed before the 0.8.0 tag:

- **Every question gets `question`, from 0.8.0, in every state.** Wherever a skill says an open question takes `oq` and a 🔒 or ✅ one takes `question`, or says to rename the directive when the marker changes, it now says: `question` on every question, keys unchanged, and only the marker changes with the state. `oq` is the deprecated name, never to be put on a 🔒 or ✅ question, and kept on open questions only for readers still on 0.7, with `"vantage/oq-deprecated" = "off"` under `[check.rules]`. `design-doc`'s answering protocol, its question scaffold, its format-rules bullet (a question "named by its marker … Rename it") and its quality checklist ("never `oq`" on a 🔒 or ✅ question, an "`oq` directive" on a live one), `user-stories`' scaffold and `vantage-docs`' *Open Questions & Decision Ledgers* all carry the old rule as of this date.
- **`vantage-docs`.** Drop "correct for the Vantage in front of you". Adopt [design §6.3](checker-version-skew.md#63-what-agent-instructions-must-say)'s list: the payload's command or bare `uvx`, and never change `target`. Delete "an older published guide is not evidence that the newer syntax is invalid". Regenerate `references/style-guide.md` from the published 0.8.0 output once it exists.
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
- **The server reading `target`.** It's a top-level scalar decoded beside `theme`, and `ours()` is unaffected. With no target declared it writes for its own release and shows no notice, as [OQ-VS2](checker-version-skew.md#decision-ledger) A has a checker do.
