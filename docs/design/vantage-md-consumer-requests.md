---
title: "vantage-md's consumer surface: a working entry point, an embedded viewer, and a written directive dialect"
date: 2026-11-13
status: in-review
stage: DESIGN
next: "Rule on [OQ-VM1](#OQ-VM1) (publish the planning index as a subpath), then the CommonJS removal and the embedded-viewer prop ship together"
tags: [vantage-md, packaging, npm, esm, cjs, directives, consumers, planning]
summary: "A QA lane filed four requests against the published vantage-md package and several against other projects. Triaged: the CommonJS entry is broken and the package should ship ESM only; the viewer gains a hideFrontmatter prop; the directive dialect gets its own README section; and publishing the planning index stays open because the package documents it as deliberately internal."
---

# vantage-md's consumer surface

**Status:** 2026-11-13. The CommonJS removal, the `hideFrontmatter` prop, the README directive section and the `scratch/` ignore rule are built in this change. [OQ-VM1](#6-open-questions) is open and is the only thing keeping the document out of `accepted`.

**Needs your ruling:** [OQ-VM1](#6-open-questions).

**Reads with:** [`inline-markup.md`](../reference/inline-markup.md) (the directive vocabulary the README now summarizes), [`pypi-distribution.md`](../reference/pypi-distribution.md) (how the package is published from a tag), and the request file this triages, which is a scratch record and lives in `swarf/docs/`, not in this repository.

---

## 1. What arrived, and what this repository owns

An unattended QA lane wrote one request file on 2026-11-13 covering five projects. It is a scratch record, not a repository document: the file itself says so, and it lived at the repository root only because that is where the lane put it. This document is the part of it this repository can act on.

| Section | What it asks for | Owner | In this repository |
| :--- | :--- | :--- | :--- |
| tillr, T1–T10 | A dispatcher that resolves its own utilities, a seed that owns `rank`, a view that carries counts, two question dialects, honest tick counts, a stop reason, a store that reports itself absent, per-drain lane branches, fallback on a shared-pool 429, and a design-document route | the tillr toolset | no — the binaries and the store are not part of this tree |
| observatory, F1–F14 / O1–O3 | Rank-ordered queue rows, truthful run counts, six distinct empty and failure states, the item document rendered through `vantage-md`, and a written design | the tillr board | no — `docs/design/observatory-*.md` does not exist here |
| dotfiles, D1–D6 | A migration that keeps `env.files`, a migration that follows a swept symlink, `scratch/` in the repository's `.gitignore`, a store lock, and two recorded dev-loop properties | yolo, this repository, tillr | **D3 only** |
| vantage-md, 1–4 | A non-throwing CJS entry, a published planning model, an embedded viewer, and documented directives | this repository | **yes** |
| rows 63, 161, 507 | Close two board rows as dead-and-built, seed a third as a build | the board, the pi fork | no |

The three dotfiles requests that are not D3 are about yolo's own migration path. This change resolved the underlying confusion by hand — the workspace config now lives at `yolo-jail.local.toml`, swept into `swarf/.links/` and gitignored, and the pre-migration JSONC is gone — and the two yolo bugs (a converter that drops an empty `env.files`, and a migration that writes a new regular file instead of the swept link's target) belong to yolo, not here.

## 2. The CommonJS entry is broken, so the package ships ESM only

`require("vantage-md")` throws at import: the built `dist/index.cjs` hands `unified` an empty preset, and the same throw is waiting in `dist/react.cjs`. The ESM entry is fine.

The cause is structural, not a typo. Every runtime dependency `vantage-md` renders with — `unified`, `remark-parse`, `remark-rehype`, the `rehype-*` plugins, `react-markdown` — is **ESM-only**. The CommonJS bundle reaches them through `require()`, which Node 22 answers by wrapping the ESM namespace; the bundler's interop then sets `.default` to the namespace object rather than the function, and `unified().use(namespace)` is the empty preset the error names. There is no interop flag on the bundler that changes this, and the only two ways out are:

- **Bundle the ESM-only dependencies into the CommonJS output.** It works — measured, the CJS entry then imports and renders — but it duplicates every renderer's dependency graph into a 1.6 MB artifact, bundles `katex` and `react-markdown` into a subpath that declared them external, and leaves a mixed install where the CJS copy and the ESM copy are different object graphs.
- **Stop emitting CommonJS.** The package is `"type": "module"`, its README's every example is an `import`, and the CJS entry has never worked — a consumer cannot be relying on it, because requiring it throws before a single call. Removing it is a breaking change only to a claim, not to a working use.

The second is the honest one, so the package is ESM-only from this change: `main` and the `require` conditions leave `package.json`, `tsdown` emits one format, and the manifest's `exports` map names `types` and an `import` target for `.` and `./react`. The release that carries it is a minor bump under the repository's 0.x convention, and the note should say plainly that the CommonJS entry was broken and is withdrawn rather than fixed.

**What done looks like:** building the package produces `.js` and `.d.ts` and no `.cjs`; `node --input-type=module -e 'import("vantage-md").then(m => m.renderMarkdown("# hi"))'` renders; `just published` passes, because `typetest/consumer.ts` resolves the `import` condition under both supported compilers and `check-published-css.mjs` walks the same `exports` map.

## 3. The embedded viewer: one prop, not a second component

`MarkdownViewer` always draws the frontmatter card and is shaped like a document page. A panel that wants the prose, the directive anchors and the same render chain has to hide the card from outside the package.

The design is `hideFrontmatter?: boolean`, default `false`. It skips `<FrontmatterDisplay>` and nothing else: the pipeline, the link and image resolution, the mermaid handling and the line-anchor hook are unchanged, because a second component over `buildPipeline` would be a second place for the chain to drift. The memo comparator now covers every prop rather than four of them — it ignored `baseUrl`, `imageApiBase` and `onNavigate`, so a panel that changed one of those kept the old render — which is a latent defect this request surfaced.

`className` remains the caller's, and the prose classes stay applied when the card is hidden, so an embedded viewer is the same prose as a page viewer with the card removed.

**What done looks like:** a frontend test that renders the package viewer with `hideFrontmatter` and asserts the frontmatter card is absent, the document body is present, and the same test without the prop asserts the card is present.

## 4. The directive dialect gets its own README section

The README explained the `<!-- vantage: question id=OQ-… -->` form only in passing, inside the `DocumentStatusChip` example, and never said that `:::question` is not the notation. A consumer who tried the fence saw colons and concluded the package was broken.

The README gains a **Directives** section: the carrier (an HTML comment with a `vantage:` sentinel, which every other renderer drops), the five names (`section`, `block`, `question`, `fallback`, and `oq` as the deprecated spelling of `question`), the `data-vantage-*` attributes they compile to, and the one-sentence warning that a fenced form is not a directive. It links to [`inline-markup.md`](../reference/inline-markup.md) for the grammar instead of restating it.

## 5. `scratch/` goes in the repository's `.gitignore`

`scratch/` was ignored only by the agent's global `~/.config/git/ignore`. A fresh checkout on another machine has no such file, so an agent's scratch tree becomes untracked files that `git status` reports and `git add -A` sweeps into a commit. The repository's own `.gitignore` now names `/scratch/` and `/scratch-*`, so the rule travels with the clone.

## 6. Open Questions

1. 💬 **OQ-VM1: Should the planning index become a published `vantage-md/planning` subpath?**

   The request asks the package to publish `src/planning/` — 18 files, about 7,400 lines, with `questionFor`, `questionState`, `routeQuestions`, `questionNeedsYou`, `answeredQuestions`, `filterKeepsQuestion`, `cardSource`, `evidence` and `leaning` — because the question card Vantage's own UI draws cannot be used by anyone else. Today `planning/index.ts` says in its own header that it is deliberately internal: nothing in it is exported from the published entry, so it is not semver API, and the viewer reaches it through the frontend's source alias.

   That is a reversal of a written decision, not an oversight, so it is the owner's to make.

   - **A — Publish it and take on the API surface.** Add the `exports` entry and a build entry; the module is self-contained (`mdast`, `remark-parse`, `smol-toml`, `unified`, `yaml`), so it is mechanically a packaging change.
   - **B — Keep it internal and publish nothing.** A consumer rebuilds the card from `parseVantageDirective`, as it does today.
   - **C — Publish a smaller, purpose-built surface.** Name the handful of functions a card needs and export those, leaving the rest internal.

   <!-- vantage: question id=OQ-VM1 leaning="B, for now: the module's header says the exclusion is deliberate, and the request names no consumer beyond 'anyone else', so publishing the whole 7,400 lines commits the package to semver on an API nobody has asked to consume yet." -->

   _Leaning:_ B, for now. The module's header says the exclusion is deliberate, and the request names no consumer beyond "anyone else", so publishing the whole 7,400 lines commits the package to semver on an API nobody has asked to consume yet. C is the better shape if a real consumer appears.

   **Answer:**

   > _(empty — fill in when decided)_

## Decision Ledger

| ID | Ruling | Why |
| :--- | :--- | :--- |
| OQ-VM2 | The package ships ESM only; the CommonJS entry is withdrawn, not fixed. | Every renderer dependency is ESM-only, so a working CJS build means bundling a second copy of the graph; the published CJS entry has never imported, so no working use is broken. |
| OQ-VM3 | `hideFrontmatter` is a prop on the existing viewer, not a second component. | Two components over `buildPipeline` is two places for the chain to drift, which is the failure the shared pipeline exists to prevent. |
| OQ-VM4 | The directive dialect is documented in the package README and linked to `inline-markup.md`, not restated there. | One statement of the grammar; the reference already owns it. |
| OQ-VM5 | `/scratch/` and `/scratch-*` belong in the repository's `.gitignore`. | A global git exclude does not travel with a clone, so the rule was invisible to every other checkout. |
