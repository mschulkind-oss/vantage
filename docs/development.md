# Development Guide

Instructions for building, testing, and contributing to Vantage.

## Project Structure

Vantage is a single Go binary that embeds a React/Vite single-page app.

```
cmd/vantage/          Command-line entry point (cobra commands)
  main.go             Root command + version
  serve.go            Single-repo server
  daemon.go           Multi-repo daemon (reads config.toml)
  build.go            Static-site export
  initconfig.go       Writes a starter config.toml
  installservice.go   systemd --user unit installer (Linux)
  perfreport.go       Performance report client
internal/             Backend packages (not importable outside the module)
  server/             Integrator: wires config, per-repo services, router
  api/                HTTP handlers + the route table
  git/                GitService — shells out to the git binary
  fs/                 FileSystemService — file tree + file content
  review/             Review-mode persistence + changelog reactions
  reviewanchor/       Block hashing that anchors comments (mirrors the frontend)
  live/               WebSocket Manager + fsnotify file watcher
  static/             Self-contained static-site builder
  perf/               In-memory timing instrumentation
  config/             Unified runtime configuration (flags, env, TOML)
  model/              Wire-format DTOs shared with the frontend
  buildinfo/          Version metadata stamped at build time
  ignore/             .gitignore-style exclusion matching
web/                  Go embed of the built frontend
  embed.go            //go:embed all:dist
  dist/               Built SPA bundle (produced by bundle-frontend)
frontend/             React frontend (Vite + TypeScript)
  src/components/     UI components
  src/stores/         Zustand state management (repo, git, review)
  src/hooks/          Custom React hooks
  src/pages/          Page-level components
  src/lib/            Shared helpers (static-mode interceptor, review anchoring)
packages/vantage-md/  Markdown rendering library (rehype/remark plugins)
docs/                 Documentation
  design/             Architecture and design decisions
```

Tests are co-located with the code they cover: Go tests live beside their
package as `*_test.go` files under `internal/` and `cmd/`; frontend tests live
beside their components as `*.test.ts`/`*.test.tsx`.

## Prerequisites

| Tool                          | Purpose                                  | Install                                      |
| ----------------------------- | ---------------------------------------- | -------------------------------------------- |
| [mise](https://mise.jdx.dev/) | Manages Go, Node, just, and staticcheck  | `curl https://mise.jdx.dev/install.sh \| sh` |
| [just](https://just.systems/) | Command runner                           | Managed by mise                              |

`mise` pins the toolchain in `mise.toml`: Go 1.26, Node 22, `just`, and
`staticcheck`. Running `mise install` provisions all of them.

## Setup

```bash
git clone https://github.com/mschulkind-oss/vantage.git
cd vantage
mise install      # Go 1.26, Node 22, just, staticcheck
just setup        # go mod download + build vantage-md + npm ci
```

`just setup` also points git at the tracked hooks directory
(`scripts/hooks`), so the quality gate runs on commit.

## Running in Development

```bash
just dev [PATH]       # Start both frontend + backend (default path: .)
just dev-connect      # View logs (Ctrl+B D to detach)
just dev-stop         # Stop both servers
```

`just dev` runs the Go server and the Vite dev server together under overmind.
You can also run them separately:

```bash
just dev-go [PATH]    # Backend only (go run ./cmd/vantage serve PATH)
just dev-js           # Frontend only (Vite dev server)
```

## Testing

```bash
just test             # Run all tests (Go + frontend)
just test-go [args]   # Go tests only (go test ./...)
just test-js          # Frontend tests only (vitest)
```

`just test-go` forwards any extra arguments to `go test`, so you can target a
single package or run with verbose output:

```bash
just test-go ./internal/git/...
just test-go -run TestWorkingDiff -v
```

### TDD Workflow

1. **Red:** Write a failing test for the new functionality.
2. **Green:** Write the minimum code to make it pass.
3. **Refactor:** Clean up while keeping tests green.

Bug fixes must include a regression test that demonstrates the bug.

## Code Quality

```bash
just check            # Local gate: format in place, fix lint, run tests
just check-ci         # Read-only gate used by the pre-commit hook and CI
just format           # Auto-format all code (gofmt + prettier)
just lint             # Lint all code (go vet, staticcheck, eslint, tsc)
```

`just check` formats, lints, and tests both halves of the codebase:

- **Go:** `gofmt`, `go vet`, `staticcheck`, `go test ./...`
- **Frontend:** prettier, eslint, `tsc --noEmit`, vitest

**Always run `just check` before committing.** The pre-commit hook runs
`just check-ci` (the read-only variant: it fails on unformatted code rather
than rewriting it).

## Building & Installing

```bash
just build            # Build the frontend, embed it, build the vantage binary
just bundle-frontend  # Build the SPA and copy it into web/dist
```

`just build` runs `bundle-frontend` (Vite build copied into `web/dist`) and
then `go build`, stamping the short commit SHA into `internal/buildinfo` via
`-ldflags`. The result is a single self-contained `./vantage` binary with the
frontend embedded.

To install from the module path:

```bash
go install github.com/mschulkind-oss/vantage/cmd/vantage@latest
```

## Backend

- **Router:** chi (`github.com/go-chi/chi/v5`).
- **CLI:** cobra (`github.com/spf13/cobra`).
- **WebSocket:** `github.com/coder/websocket`.
- **File watching:** `github.com/fsnotify/fsnotify`.
- **Config:** TOML via `github.com/BurntSushi/toml`, env via `caarlos0/env`.
- **Git:** the backend shells out to the `git` binary with explicit argument
  slices — it never links an in-process git library.
- **Style:** standard Go layout; handlers in `api/` stay thin and delegate to
  the services in `git/`, `fs/`, and `review/`.

## Frontend

- **Framework:** React 18 + TypeScript + Vite.
- **Styling:** Tailwind CSS.
- **State:** Zustand for global state, React hooks for local state.
- **Testing:** Vitest + React Testing Library.
- **Tests** are co-located with source files (`Component.test.tsx`).

The compiled frontend is committed into the Go build only at release time
(`just bundle-frontend` overwrites `web/dist`); a placeholder `index.html`
keeps the `web` package compiling during day-to-day backend work.

## Additional Docs

- [docs/design/technical_spec.md](design/technical_spec.md) — Architecture and design decisions
- [docs/design/review-mode.md](design/review-mode.md) — Review-mode design and model gaps
- [docs/design/working-directory-diffs.md](design/working-directory-diffs.md) — Uncommitted change viewing
