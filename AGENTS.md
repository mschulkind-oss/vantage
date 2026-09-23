# AGENTS.md

Only what you cannot get from `just --list`, `ls`, or a config file already in
front of you. Toolchain versions, the recipe list, and the gate's step order are
all discoverable, so they are deliberately not here.

## Shape

- One Go binary serves an embedded React SPA, and the backend **shells out to
  the `git` CLI**. There is no in-process git library; introducing one is a
  design change, not an implementation detail.
- `web/dist` is that embedded frontend, and it is **not tracked**. `//go:embed
  all:dist` accepts an empty directory, so a build that skips the bundle step
  serves `Frontend bundle not found.` behind one `slog.Warn` — which is what a
  fresh clone gets until `just web-sync` runs. It was tracked until 2026-09-01
  to spare `go install …@latest` that fate; **`just release` now carries the
  bundle in a commit reachable only from the tag**, which is where `go install`
  reads it from. Rationale: [`docs/design/pypi-distribution.md` §4.1](docs/design/pypi-distribution.md#41-the-frontend-has-to-be-there-at-build-time-and-today-it-often-isnt).
- `packages/vantage-md` is consumed **from TypeScript source, never from
  `dist/`**: the frontend resolves it through a Vite alias
  ([`frontend/vite.config.ts`](frontend/vite.config.ts)), and `packages/vantage-check` imports it by
  relative path. `dist/` (tsdown) is produced only at `npm publish`. So never
  copy pipeline code into `frontend/src` — one implementation, three consumers.
- The three packages are **one npm workspace** with a single root
  [`package-lock.json`](package-lock.json). `npm ci` at the root installs all of them; there is no
  per-package lockfile and no per-package install. This is what makes `katex`
  and `mermaid` resolve to one hoisted copy shared by the viewer and the CLI —
  the checker's whole claim is that it validates with the engines the viewer
  renders with, and [`packages/vantage-check/test/deps.test.ts`](packages/vantage-check/test/deps.test.ts) asserts they are
  literally the same file, not merely the same version string.
- `packages/vantage-check` ships as one compiled binary (~92 MB per platform)
  and is never published to npm. Design: [`docs/design/agent-cli.md`](docs/design/agent-cli.md);
  what a run spends its time on: [`docs/design/check-performance.md`](docs/design/check-performance.md).
- **A `check` worker thread runs [`packages/vantage-check/src/main.ts`](packages/vantage-check/src/main.ts) again, and a worker
  module of its own cannot replace it.** `bun build --compile` puts every module
  *inside* the executable, so a second build entry point lands in the bundle
  under a name the parent cannot address and the thread dies with `Cannot find
  module '/$bunfs/root/…'`. The entry point is the one module that is
  addressable from inside the bundle *and* a real file when the program is run
  from source, which is why it branches on `isMainThread` and hands
  `core/parallel.ts` its own URL rather than letting that module derive one.
  Rationale: [`docs/design/check-performance.md` §4.2](docs/design/check-performance.md#42-the-worker-is-this-programs-own-entry-point).

## Ports

**Develop against :8201**, the Vite port `just dev` opens. :8200 is the Go
backend it proxies to, and on its own it serves whatever `web/dist` was last
built with — not your edits.

:8000 is the production default and may be a live `systemctl --user` service.
Never kill it; run test instances on other ports.

## What the gate does not tell you

- **On a clone where `just setup` never ran, commits skip the gate silently.**
  The hooks live in `scripts/hooks/` and are wired by `git config
  core.hooksPath`, which is per-clone local config — so a second machine has the
  toolchain (`mise install`) and no hooks, and no npm packages either. `just
  setup` is the whole answer, and the recipes now say so instead of failing with
  `prettier: not found`.

  **The commit-message half of that is no longer silent.** Since 2026-09-20 the
  `commits` CI job runs [`scripts/check-commit-messages.sh`](scripts/check-commit-messages.sh)
  over a pull request's range — the same script both message hooks exec, so the
  policy has one copy. It exists because a fork has no hooks *at all*, which is
  how a contribution arrived carrying `Co-Authored-By: Claude` trailers with
  nothing anywhere reporting it. A human co-author is fine; only the AI names and
  provider noreply domains are refused. Merge commits are exempt from the
  conventional-subject rule, because git and GitHub compose those subjects and
  this repo's own `main` carries them from dependabot merges.

  The rest of the gate is still hook-and-CI only: `check-ci` looks at the working
  tree and has no revision range to apply a per-commit rule to, so what it runs
  for the commit policy is that script's *tests*, not the policy itself.
- **A green local gate can still be a CI red.** `check-ci` starts by asserting
  the workspace `node_modules` matches the manifests, because CI installs with
  `npm ci` and therefore answers a different question than a stale local
  install. A stale eslint plugin once hid three live suppressions, so
  deleting them as dead broke CI (`caba056`, fixed in `5226587`). Lint runs at
  `--max-warnings 0`, so a stale suppression is an error, not a note.
- **`tsc --noEmit` in `frontend/` checks nothing.** [`frontend/tsconfig.json`](frontend/tsconfig.json) is
  solution-style (`files: []` plus project references), so it checked **zero
  files** until the gate moved to `tsc --build`, which walks the references and
  covers `frontend/src` and `packages/vantage-md/src` both. Keep it `--build`;
  reverting to `--noEmit` looks identical and silently checks nothing.
- **Every package is on one TypeScript (`~6.0.3`), and the old-compiler
  guarantee is a real check instead of an accident.** Until 2026-09-01
  `frontend` pinned 5.9 while `vantage-md` pinned 6.0, and because
  [`frontend/tsconfig.json`](frontend/tsconfig.json) references this package its sources were compiled by
  both. That was true but it proved the wrong thing: it compiled `src/`, while
  npm consumers only ever see the emitted `dist/`, and nothing checked the half
  that ships. `just check` now builds the package and type-checks
  [`packages/vantage-md/typetest/consumer.ts`](packages/vantage-md/typetest/consumer.ts) — an importer of the built
  `dist/` — under both `typescript` and `typescript-5`, an alias pinning the
  oldest version we support. Widen the range by adding another alias.
- **`typescript` is declared at the workspace root on purpose.** The dts build
  hoists there and resolves TypeScript from its own location rather than the
  package's, so a root without the pin would generate `vantage-md`'s
  declarations under a different compiler than the one that type-checks it. It has no tests
  of its own: its behavior is covered by `frontend/`'s tests through the source
  alias.
- **Editing Markdown can fail the gate.** It rebuilds the CLI and runs it over
  `docs/`, `userguide/` and the READMEs, so a broken relative link or a dead
  anchor is a failure. `just cli` then
  `packages/vantage-check/dist/vantage-check <file>` is the same check locally,
  and `… style-guide` prints the conventions it enforces — cheaper before
  writing than at commit time.
- **The `Workers Builds: vantage` check on every PR is Cloudflare's, and its
  build command lives in their dashboard, not here.** It ran `bash
  build-docs.sh` from 2026-05-30 — when that file was deleted — until
  2026-09-01, so every PR carried a red check nothing in the tree could explain
  or fix. [`scripts/build-site.sh`](scripts/build-site.sh) is the real entry point, and its header says
  so. A rename here is invisible to CI; update the dashboard in the same breath.
- **Every `just` recipe leaves tracked files unchanged — no exceptions.**
  `web-sync` used to be one, rewriting the tracked `web/dist`; untracking it on
  2026-09-01 removed the carve-out. The rest still holds: `npm ci` in CI and
  deploy, `npm install` only in dev, and a package manifest change lands in the
  same commit as its lockfile.
- **Releases are cut with `just release <semver>`, not by tagging by hand.** The
  tag has to be born carrying `web/dist`, because Go's checksum database records
  a tag's tree hash on first fetch and re-pointing it breaks every later fetch.
  A workflow triggered *by* the tag push is already too late to add anything, so
  no CI job can do this — which is also why the old "assert web/dist matches its
  sources" check existed, and why it is gone.

## Releases

**One version, one tag, one run.** Pushing `v<semver>` publishes everything:
per-platform archives carrying *both* binaries, a PyPI wheel for each of
`vantage-md` (the server) and `vantage-check` (the CLI), the `vantage-md`
library to npm, and a Homebrew formula that installs both binaries. There are no
per-package tags any more, and **no manifest decides a version** — CI stamps the
tag into both package manifests before building, so nothing can disagree with it.

**The notes are written before the tag, not after it.** `just release <semver>`
stops before it builds anything if [`CHANGELOG.md`](CHANGELOG.md) has no section
for that version, or has one still carrying a placeholder. That section is lifted
out byte for byte and becomes the body of the GitHub release — which is where
people who follow this repository read what changed — so the prose is part of the
artifact rather than a record kept beside it, and since a tag here is never moved,
a section improved afterwards improves nothing that was published. What earns a
line, who the entry is addressed to, and the rules against the usual release-note
filler are settled in the **Changelog and Release Notes** standard of the
`open-source-project` skill. `_self-check` now checks [`CHANGELOG.md`](CHANGELOG.md),
because a dead link in a release body is the one kind that cannot be fixed
afterwards — the tag it shipped under is never moved.

The tag filter is `v[0-9]*`, not `v*`, and that is load-bearing: it is what makes
a stray `vantage-…` tag unable to reach the workflow at all. Until 2026-09-01 the
app triggered on `release: [published]` — which takes no tag filter — so a
release created for a `vantage-check@…` tag woke it, `${GITHUB_REF_NAME#v}`
yielded `antage-check@0.1.0`, and only a runtime guard stopped it attaching the
wrong archives and pushing a broken formula to the public tap.

**All three registries publish by trusted publishing (OIDC), and every one of
them must name `publish.yml`** — both PyPI projects and npm alike. A trusted
publisher binds to the workflow *filename*, so renaming this file breaks every
publish until each registry's config is updated to match. That is not
hypothetical: `release.yml` became `publish-npm.yml` became `publish.yml`, and
npm's binding still named `release.yml` when the consolidated workflow first ran
on 2026-09-01.

`NPM_TOKEN` is a dead fallback, and it makes that failure hard to read. When the
OIDC exchange fails, `npm publish` falls back to `NODE_AUTH_TOKEN` and reports
`ENEEDAUTH` — "you need to authorize this machine", which describes a missing
token rather than the mismatched filename that actually caused it. Fix the
trusted publisher; do not go minting tokens.

Since v0.5.4 (2026-09-01) all three registries carry that version: PyPI has
`vantage-md` and `vantage-check`, the first release to register the CLI at all,
and npm has `vantage-md`. npm sat at `0.1.7` from April until then — not from
repeated failures but because `36a75506` moved it onto a `vantage-md@*` tag that
was never pushed. See [`docs/design/pypi-distribution.md`](docs/design/pypi-distribution.md).
