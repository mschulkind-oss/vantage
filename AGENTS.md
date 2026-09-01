# AGENTS.md

Only what you cannot get from `just --list`, `ls`, or a config file already in
front of you. Toolchain versions, the recipe list, and the gate's step order are
all discoverable, so they are deliberately not here.

## Shape

- One Go binary serves an embedded React SPA, and the backend **shells out to
  the `git` CLI**. There is no in-process git library; introducing one is a
  design change, not an implementation detail.
- `web/dist` is that embedded frontend, and it is **tracked on purpose** — the
  one build product in the tree. `//go:embed all:dist` accepts an empty
  directory, so while it was ignored, any build that skipped the bundle step
  served `Frontend bundle not found.` behind one `slog.Warn`, `go install
  …@latest` included. Rationale: `docs/design/pypi-distribution.md` §4.1.
- `packages/vantage-md` is consumed **from TypeScript source, never from
  `dist/`**: the frontend resolves it through a Vite alias
  (`frontend/vite.config.ts`), and `packages/vantage-check` imports it by
  relative path. `dist/` (tsup) is produced only at `npm publish`. So never
  copy pipeline code into `frontend/src` — one implementation, three consumers.
- `packages/vantage-check` ships as one compiled binary (~92 MB per platform)
  and is never published to npm. Design: `docs/design/agent-cli.md`.

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
- **A green local gate can still be a CI red.** `check-ci` starts by asserting
  `node_modules` matches the manifests in all three npm packages, because CI
  installs with `npm ci` and therefore answers a different question than a stale
  local install. A stale eslint plugin once hid three live suppressions, so
  deleting them as dead broke CI (`caba056`, fixed in `5226587`). Lint runs at
  `--max-warnings 0`, so a stale suppression is an error, not a note.
- **`tsc --noEmit` in `frontend/` checks nothing.** `frontend/tsconfig.json` is
  solution-style (`files: []` plus project references), so it checked **zero
  files** until the gate moved to `tsc --build`, which walks the references and
  covers `frontend/src` and `packages/vantage-md/src` both. Keep it `--build`;
  reverting to `--noEmit` looks identical and silently checks nothing.
- **`packages/vantage-md` is type-checked twice, under two TypeScript
  versions** — standalone at its own pin (`~6.0.3`) and again through
  `frontend/`'s project reference (`~5.9.3`). Both are deliberate; a change that
  passes one and not the other is a real finding, not a flake. It has no tests
  of its own: its behaviour is covered by `frontend/`'s tests through the source
  alias.
- **Editing Markdown can fail the gate.** It rebuilds the CLI and runs it over
  `docs/`, `userguide/` and the READMEs, so a broken relative link or a dead
  anchor is a failure. `just cli` then
  `packages/vantage-check/dist/vantage-check <file>` is the same check locally,
  and `… style-guide` prints the conventions it enforces — cheaper before
  writing than at commit time.
- **Every `just` recipe must leave tracked files unchanged, with exactly one
  exception**: `just web-sync` rewrites the tracked `web/dist` export, and
  `just build`/`just deploy` run it. Commit what it changes, or use `just
  build-bin` to get a binary without touching it. Otherwise the rule holds —
  `npm ci` in CI and deploy, `npm install` only in dev, and a `package.json`
  change lands in the same commit as its `package-lock.json`.

## Releases

**One version, one tag, one run.** Pushing `v<semver>` publishes everything:
per-platform archives carrying *both* binaries, a PyPI wheel for each of
`vantage-md` (the server) and `vantage-check` (the CLI), the `vantage-md`
library to npm, and a Homebrew formula that installs both binaries. There are no
per-package tags any more, and **no manifest decides a version** — CI stamps the
tag into both `package.json`s before building, so nothing can disagree with it.

The tag filter is `v[0-9]*`, not `v*`, and that is load-bearing: it is what makes
a stray `vantage-…` tag unable to reach the workflow at all. Until 2026-09-01 the
app triggered on `release: [published]` — which takes no tag filter — so a
release created for a `vantage-check@…` tag woke it, `${GITHUB_REF_NAME#v}`
yielded `antage-check@0.1.0`, and only a runtime guard stopped it attaching the
wrong archives and pushing a broken formula to the public tap.

PyPI publishes by trusted publishing (OIDC, no token), and **both projects must
name `publish.yml`** as their trusted publisher. npm is the exception: it
publishes with `NPM_TOKEN` plus OIDC provenance.

PyPI's state is worth knowing before you tell anyone to install from it —
`vantage-md` there still serves the retired Python app and `vantage-check` is
unregistered until the next release. See `docs/design/pypi-distribution.md`.
