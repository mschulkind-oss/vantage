# Vantage Justfile

default:
    @just --list

# Install dependencies and git hooks (run once after cloning).
setup: _hooks
    mise install
    go mod download
    # Install each package's own deps so the app and the agent CLI can resolve
    # them from source. No tsup build needed — the frontend imports vantage-md's
    # TS source directly (see frontend/vite.config.ts), and so does
    # packages/vantage-check. dist/ is built only at release.
    cd packages/vantage-md && npm ci
    cd packages/vantage-check && npm ci
    cd frontend && npm ci

# Run the backend + frontend dev servers (Ctrl-C to stop).
dev path=".":
    TARGET_REPO={{path}} overmind start

# Refreshes the tracked export first, so this is the one recipe that may modify
# tracked files — see web-sync.

# Build the vantage binary with a freshly built frontend embedded.
build: web-sync build-bin

# Build the binary from the export committed in web/dist, changing nothing else.
build-bin:
    go build -ldflags "-X github.com/mschulkind-oss/vantage/internal/buildinfo.commit=$(git rev-parse --short HEAD)" -o vantage ./cmd/vantage

# bun compiles the TypeScript into one self-contained executable in about a
# second, which is why the gate can afford to rebuild it on every run. The
# output lands in packages/vantage-check/dist, which is gitignored, so this
# never dirties a tracked file.
#
# Build the vantage-check CLI for the current host.
cli:
    cd packages/vantage-check && bun run build

# Installs both binaries, matching what a release ships: one archive and one
# Homebrew formula carry `vantage` and `vantage-check` together.

# Build, install both binaries onto PATH, and restart the systemd user service.
deploy: build cli
    #!/usr/bin/env bash
    set -euo pipefail
    bindir="$(go env GOBIN)"
    [ -n "$bindir" ] || bindir="$(go env GOPATH)/bin"
    mkdir -p "$bindir"
    for bin in vantage vantage-check; do
        # Replace any stale binary/symlink from a previous install.
        rm -f "$bindir/$bin"
    done
    install -m 0755 ./vantage "$bindir/vantage"
    install -m 0755 ./packages/vantage-check/dist/vantage-check "$bindir/vantage-check"
    echo "Installed $bindir/vantage and $bindir/vantage-check"
    systemctl --user restart vantage

# Format the code (Go + all three npm packages). No tests — run before committing.
format: _deps-match
    gofmt -w cmd internal web
    cd packages/vantage-md && npm run format
    cd packages/vantage-check && npm run format
    cd frontend && npm run format

# Format, then lint, type-check, and test. The full local gate.
check: format
    go vet ./cmd/... ./internal/... ./web/...
    staticcheck ./cmd/... ./internal/... ./web/...
    go test ./cmd/... ./internal/... ./web/...
    cd packages/vantage-md && npm run lint && npm run typecheck
    cd packages/vantage-check && npm run lint && npm run typecheck && npm run test
    cd frontend && npm run lint && npx tsc --build && npm run test
    just _self-check

# Read-only gate (errors on issues, never rewrites) — used by the pre-commit hook and CI.
check-ci: _deps-match
    #!/usr/bin/env bash
    set -euo pipefail
    test -z "$(gofmt -l cmd internal web)" || { echo "unformatted Go (run: just format):"; gofmt -l cmd internal web; exit 1; }
    # Target the Go source dirs explicitly: `./...` would descend into
    # packages/*/node_modules, which contains third-party Go code (flatted).
    go vet ./cmd/... ./internal/... ./web/...
    staticcheck ./cmd/... ./internal/... ./web/...
    go test ./cmd/... ./internal/... ./web/...
    # check-ci is one bash script, so a bare `cd` would leak into the next line
    # — each package gets its own subshell.
    # vantage-md has no tests of its own: its behaviour is covered by frontend/
    # tests through the source alias. Its own typecheck still earns its place —
    # it runs the package standalone under its own TypeScript (~6.0.3), where
    # frontend/'s --build reads the same files under ~5.9.3.
    ( cd packages/vantage-md && npm run format:check && npm run lint && npm run typecheck )
    ( cd packages/vantage-check && npm run format:check && npm run lint && npm run typecheck && npm run test )
    ( cd frontend && npm run format:check && npm run lint && npx tsc --build && npm run test )
    # Then the artifact, not just the source it was built from.
    just _self-check

# Assert node_modules matches the manifests, in both npm packages.
#
# CI installs with `npm ci`, so it lints and tests against the lockfile. Locally
# the gate uses whatever is already in node_modules, which silently answers a
# different question: a stale eslint plugin let three genuinely-live suppressions
# be deleted as dead (caba056, fixed in 5226587) because the older version simply
# did not report them. A local green that CI cannot reproduce is worse than a red.
[private]
_deps-match:
    #!/usr/bin/env bash
    set -euo pipefail
    for pkg in frontend packages/vantage-md packages/vantage-check; do
        if [ ! -d "$pkg/node_modules" ]; then
            echo "$pkg/node_modules is missing — this is a fresh clone."
            echo "Run: just setup   (mise install alone provisions the toolchain, not the packages)"
            exit 1
        fi
        if ! out="$(cd "$pkg" && npm ls --depth=0 2>&1)"; then
            echo "$pkg/node_modules does not match its manifest (run: cd $pkg && npm ci):"
            echo "$out" | grep -E 'invalid|missing|npm error' | head -20 || echo "$out" | head -20
            exit 1
        fi
    done

# End-of-task gate: assert the tree is clean, then re-run the full CI gate.
#
# check-ci already runs on every commit via the pre-commit hook, so this adds the
# two things a hook cannot see: that nothing was left uncommitted, and that the
# committed state — not the working tree that happened to be on disk mid-task —
# passes. Run it as the last thing you do.
done:
    #!/usr/bin/env bash
    set -euo pipefail
    dirty="$(git status --porcelain)"
    if [ -n "$dirty" ]; then
        echo "working tree is dirty — commit or discard before finishing:"
        echo "$dirty"
        exit 1
    fi
    just check-ci
    echo
    echo "✓ tree clean, gate green — $(git log -1 --format='%h %s')"

# ── helpers ─────────────────────────────────────────────────────────

# Build the vantage-check CLI and run it over this repository's own docs.
#
# Dogfooding, and the only thing keeping the docs' links and anchors honest: the
# checker we hand to other people's agents has to pass the tree it ships from.
# It runs the compiled binary rather than the TypeScript sources, so anything
# that type-checks but cannot be bundled — or cannot run with no Node and no
# node_modules in the picture — fails here instead of at release.
#
# The paths are named explicitly rather than swept from the repo root, so an
# untracked scratch file in someone's working tree cannot fail the gate.
[private]
_self-check: cli
    #!/usr/bin/env bash
    set -euo pipefail
    bin=./packages/vantage-check/dist/vantage-check
    "$bin" version
    test -n "$("$bin" style-guide)" || { echo "style-guide printed nothing"; exit 1; }
    "$bin" check docs userguide README.md AGENTS.md \
        packages/vantage-check/README.md packages/vantage-md/README.md

# Refresh web/dist — the tracked frontend export — from frontend/ sources.
#
# web/dist is committed (see .gitignore), because //go:embed accepts an empty
# directory and every build path that skips this step would otherwise ship a
# placeholder page — including `go install …@latest`, which gets whatever git
# holds. The cost of that choice lands here: this recipe MAY MODIFY TRACKED
# FILES, and it is the only one that may. Commit what it changes.
#
# Without npm it warns and leaves the committed export in place, so a checkout
# with only a Go toolchain still builds a working binary — the same trade
# polyclav makes for the same reason.

# Rebuild web/dist (the tracked frontend export) from frontend/ sources.
web-sync:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v npm >/dev/null 2>&1; then
        echo "warning: npm not found — embedding the committed web/dist export (may be stale)"
        exit 0
    fi
    ( cd frontend && npm run build )
    rm -rf web/dist
    mkdir -p web/dist
    cp -R frontend/dist/. web/dist/
    touch web/dist/.gitkeep

# Point git at the tracked hooks dir. Idempotent.
[private]
_hooks:
    #!/usr/bin/env bash
    set -euo pipefail
    chmod +x scripts/hooks/pre-commit scripts/hooks/commit-msg scripts/hooks/pre-push
    git config core.hooksPath scripts/hooks
    echo "Hooks active via core.hooksPath=scripts/hooks"
