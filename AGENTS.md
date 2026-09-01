# AGENTS.md

Only what you cannot get from `just --list`, `ls`, or a config file already in
front of you. Toolchain versions, the recipe list, and the gate's step order are
all discoverable, so they are deliberately not here.

## Shape

- One Go binary serves an embedded React SPA, and the backend **shells out to
  the `git` CLI**. There is no in-process git library; introducing one is a
  design change, not an implementation detail.
- `web/dist` is that embedded frontend, filled by `just build`. In git it holds
  only `.gitkeep`, and `//go:embed all:dist` accepts that silently — so a
  `go build` on a clean checkout yields a server that starts and serves nothing.
  No error, blank page.
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

- **A green local gate can still be a CI red.** `check-ci` starts by asserting
  `node_modules` matches the manifests in all three npm packages, because CI
  installs with `npm ci` and therefore answers a different question than a stale
  local install. A stale eslint plugin once hid three live suppressions, so
  deleting them as dead broke CI (`caba056`, fixed in `5226587`). Lint runs at
  `--max-warnings 0`, so a stale suppression is an error, not a note.
- **Nothing type-checks the app.** `frontend/tsconfig.json` is solution-style
  (`files: []` plus project references), so the gate's `tsc --noEmit` checks
  **zero files** — measured with `--listFiles`, 2026-09-01. `packages/vantage-md`
  is never linted, format-checked or type-checked either, and has no tests of
  its own; its source is exercised only through `frontend/`'s tests. Type errors
  in either place reach main.
- **Editing Markdown can fail the gate.** It rebuilds the CLI and runs it over
  `docs/`, `userguide/` and the READMEs, so a broken relative link or a dead
  anchor is a failure. `just cli` then
  `packages/vantage-check/dist/vantage-check <file>` is the same check locally,
  and `… style-guide` prints the conventions it enforces — cheaper before
  writing than at commit time.
- **Every `just` recipe must leave tracked files unchanged** — `npm ci` in CI
  and deploy, `npm install` only in dev, and a `package.json` change lands in
  the same commit as its `package-lock.json`.

## Releases

Three tag namespaces, all starting with `v`: `v*` (the app), `vantage-md@*` (the
npm library), `vantage-check@*` (the CLI). The workflows guard on the **`@`**,
because `release: [published]` takes no tag filter and a `v`-prefix test alone
lets one package's tag drive another's release — which would attach the wrong
archives and push a broken formula to the public Homebrew tap.

Publishing is by trusted publishing (OIDC): there is no `NPM_TOKEN`, and adding
one is the wrong fix for a failed publish.

PyPI is currently wrong in a way worth knowing before you tell anyone to install
from it: `vantage-md` there still serves the retired Python app, and
`vantage-check` is not registered at all. See
`docs/design/pypi-distribution.md`.
