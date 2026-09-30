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
  installservice.go   Login-service installer (systemd unit / launchd agent)
  perfreport.go       Performance report client
internal/             Backend packages (not importable outside the module)
  server/             Integrator: wires config, per-repo services, router
  api/                HTTP handlers + the route table
  git/                GitService — shells out to the git binary
  fs/                 FileSystemService — file tree + file content
  review/             Review-mode persistence + agent response delivery (inbox + paste)
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
(`scripts/hooks`), so every commit runs the checks its staged files call for.
That is not the whole gate; see [Code Quality](#code-quality).

## Running in Development

```bash
just dev [PATH]    # Run the Go server + Vite dev server together (Ctrl-C to stop; default path: .)
```

`just dev` starts both processes under overmind (see `Procfile`). To run one
half on its own:

```bash
go run ./cmd/vantage serve [PATH]   # backend only
cd frontend && npm run dev          # frontend only
```

## Testing

`just check` runs the whole suite; while iterating, run a half directly:

```bash
go test ./...                       # Go tests (add -run / -v / a package to narrow)
cd frontend && npm run test         # frontend tests (vitest)
```

### TDD Workflow

1. **Red:** Write a failing test for the new functionality.
2. **Green:** Write the minimum code to make it pass.
3. **Refactor:** Clean up while keeping tests green.

Bug fixes must include a regression test that demonstrates the bug.

## Code Quality

```bash
just format      # format Go + frontend (gofmt + prettier), no tests — run before committing
just check       # format, then lint, type-check, and test (the full local gate)
just check-ci    # the whole gate, read-only: errors on unformatted/lint issues, never rewrites
just check-fast  # what the pre-commit hook runs: only the checks the staged files call for
just done        # finish a task: assert nothing is uncommitted, then run all of check-ci
```

Run `just format` before committing. None of the pre-commit hook,
`just check-ci` or CI rewrites anything: each *fails* on unformatted or
lint-dirty code rather than rewriting it (only `just format` and `just check`
rewrite) — so formatting stays an explicit, staged step (no surprise reformats
showing up after a commit).

### What a commit runs, and what finishes the work

The pre-commit hook runs `just check-fast`, not the whole gate. It picks, from
the staged paths, the checks those paths can affect, and runs them side by
side, so a commit takes seconds rather than the gate's minute:

- every commit runs `vantage-check` over every document the gate checks. A
  renamed heading breaks links in documents nobody staged, and a document can
  reach any file: a link to a deleted file breaks, a `#L` anchor breaks when
  the file it points into gets shorter, and a new file breaks a document beside
  it that already names it in prose;
- a Markdown file also runs `vantage-check`'s tests, which read this
  repository's own documents;
- a Go file runs `gofmt` on it, then `go vet`, `staticcheck` and `go test` over
  every package, whose caches make the untouched ones nearly free. A file under
  `internal/` also runs `vantage-check`'s tests, which hold its copies of the
  server's rules to the Go source;
- a frontend or `vantage-md` module runs prettier and eslint on it, the
  type-check, and the tests that import it, plus the tests that read files off
  disk rather than importing them (and, for `vantage-md`, the package build and
  the `vantage-check` binary compiled from it);
- a manifest, the lockfile, the `Justfile`, a package's configuration, or any
  path `check-fast` does not know runs the whole gate, `just check-ci`.

[`scripts/check-fast.sh`](../scripts/check-fast.sh) holds every path's checks,
and the reasons for them; `just check-fast --plan` prints what the staged files would
run, without running it.

How long that takes depends on what is staged and on the machine. Measured on
32 threads with other work running (load average 8 to 35), against about 50 s
for `just check-ci`:

| Staged                        | 32 threads | 8 threads |
| ----------------------------- | ---------- | --------- |
| a user guide page             | 3 s        | 4.5 s     |
| a Go file                     | 3–7 s      | 5.5 s     |
| a frontend module             | 4–5.5 s    | 6 s       |
| a page under `docs/`          | 8–11 s     | 15 s      |
| a `vantage-check` module      | 9.5–14 s   | 10–11 s   |
| a `vantage-md` module         | 14.5–16 s  | 25–31 s   |

A `vantage-md` change is the slowest because the frontend suite that tests it
is, in effect, all of the frontend's tests; a `docs/` page runs the frontend's
planning suites, which read the documents.

Every check reads the files on disk, so `check-fast` **refuses a staged path
that is not on disk as staged**, rather than check a version the commit does
not hold: a staged file with unstaged changes on top, or a staged deletion
whose file is still there (as `git rm --cached` leaves it). Stage the rest, or
set it aside for the commit with `git stash push --keep-index
--include-untracked`, then `git stash pop`. Files nobody staged are still read
as they are on disk, as `just check-ci` reads them, so `check-fast` lists any
unstaged or untracked file it finds: a commit that needs one passes the hook
and fails in CI.

**Passing it does not finish anything.** `just done` does: it fails if anything
is uncommitted and then runs all of `just check-ci`, so what it checks is
exactly what was committed, and it has to pass before the work is called
finished. CI runs `just check-ci` on every push to `main` and every pull request
against it, as the backstop.

`just check` covers both halves of the codebase:

- **Go:** `gofmt`, `go vet`, `staticcheck`, `go test ./...`
- **Frontend:** prettier, eslint, `tsc --noEmit`, vitest

## Building & Installing

```bash
just build       # build the frontend, embed it, and build ./vantage
just deploy      # build, `go install` onto your PATH, and restart the systemd service
```

`just build` builds the SPA, copies it into `web/dist`, and runs `go build`,
stamping the short commit SHA into `internal/buildinfo` via `-ldflags`. The
result is a single self-contained `./vantage` binary with the frontend embedded.

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

The compiled frontend is embedded into the Go binary at build time (`just build`
copies the Vite output into `web/dist`); a committed `web/dist/.gitkeep` keeps
the `web` package compiling during day-to-day backend work.

## Additional Docs

- [docs/design/technical_spec.md](design/technical_spec.md) — Architecture and design decisions
- [docs/design/review-mode.md](design/review-mode.md) — Review-mode design and model gaps
- [docs/design/review-state-architecture.md](design/review-state-architecture.md) — Why review state placement keeps causing bugs, and the proposed command-based rework
- [docs/design/working-directory-diffs.md](design/working-directory-diffs.md) — Uncommitted change viewing
