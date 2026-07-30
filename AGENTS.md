# AGENTS.md

## What Vantage is

A single Go binary that serves a React SPA for viewing LLM-generated Markdown
with GitHub-style rendering, Mermaid, KaTeX, and git history/diff integration.
The frontend is bundled into the binary at build time; the backend shells out to
the `git` CLI (no in-process git library).

## Stack & layout

- **Backend — Go 1.26** (chi router, coder/websocket, cobra CLI).
  - `cmd/vantage/` — CLI entrypoint and subcommands (`serve`, `daemon`,
    `build`, `init-config`, `install-service`, `perf-report`).
  - `internal/` — `server`/`api` (HTTP), `git` (git shell-out), `fs`,
    `live` (websocket), `static` (static-site export), `config`, `model`,
    `perf`, `review`, `gitenv`, …
  - `web/` — Go `embed` dir; `just build` bundles the frontend into `web/dist`.
- **Frontend — React + Vite + TypeScript** in `frontend/` (Tailwind, Zustand,
  Vitest). Tests are co-located as `*.test.tsx`.
- **`packages/vantage-md/`** — the standalone npm Markdown-pipeline package. The
  frontend imports its **TypeScript source directly** (see
  `frontend/vite.config.ts`), so no build is needed in dev; `dist/` (tsup) is
  produced only at release.

There is no Python backend — the former FastAPI/`uv`/`pytest` app under `src/`
was fully replaced by the Go port.

## Tools & commands

`mise` provisions Go, Node, `just`, `overmind`, and `staticcheck`. `just` is the
command runner (`just --list`).

- `just setup` — one-time: toolchain, Go modules, npm deps (both packages), hooks.
- `just dev [path]` — backend on :8200 + Vite on :8201 via overmind. **Develop
  against http://localhost:8201** (hot reload). `path` = repo to view (default `.`).
- `just format` — gofmt + prettier.
- `just done` — end-of-task gate: clean tree + `check-ci`. Run it last.
- `just build` — bundle frontend into `web/dist`, then build the `vantage` binary.
- `just deploy` — build, install to `$GOBIN`, restart the `vantage` user service.
- `just release-md [bump]` — publish `packages/vantage-md` to npm.

The production server (`vantage serve`) defaults to :8000 and may be owned by a
`systemctl --user` service — never kill it; run test instances on other ports.

## Quality gate

The pre-commit hook (`scripts/hooks/`, wired via `core.hooksPath`) runs
`just check-ci`, identical to CI:

- Go: `gofmt -l` check · `go vet` · `staticcheck` · `go test ./...`
- Frontend: `npm run format:check` · `lint` · `tsc --noEmit` · `test`

Lint fails on warnings (`--max-warnings 0`), so a stale `eslint-disable` is an
error, not a note in the output.

`check-ci` first asserts that `node_modules` matches the manifests in **both**
npm packages, because CI installs with `npm ci` and therefore lints and tests
against the lockfile. A stale local install answers a different question and can
report green on code CI rejects — a stale eslint plugin once made three live
suppressions look dead, so removing them broke CI. If the check fails, run
`npm ci` in the package it names.

Finish with **`just done`**: it refuses a dirty tree, then runs `check-ci` again.
The pre-commit hook cannot see either of those things — whether work was left
uncommitted, or whether the *committed* state (rather than the mid-task working
tree) is green.

## Dependencies & clean tree

- Any `just` command must leave every tracked file unchanged — setup/build must
  never dirty lockfiles or manifests (`npm ci` in CI/deploy, `npm install` only
  in dev).
- Commit `package-lock.json` alongside any `package.json` change, in both
  `frontend/` and `packages/vantage-md/`.

## Testing

`go test ./...` and Vitest, both enforced by the gate.

## Releases

Pushing a git tag triggers CI publishing: `vantage-md@*` → npm publish of the
package; `v*` → full app release. npm uses trusted publishing (OIDC) — no
`NPM_TOKEN`; do not add one.
