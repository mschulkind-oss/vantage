# Vantage Justfile

default:
    @just --list

# Install dependencies and git hooks (run once after cloning).
setup: _hooks
    mise install
    go mod download
    # Install the package's own deps so the app can resolve it from source.
    # No tsup build needed — the frontend imports vantage-md's TS source
    # directly (see frontend/vite.config.ts). dist/ is built only at release.
    cd packages/vantage-md && npm ci
    cd frontend && npm ci

# Run the backend + frontend dev servers (Ctrl-C to stop).
dev path=".":
    TARGET_REPO={{path}} overmind start

# Build the vantage binary with the frontend embedded.
build: _bundle
    go build -ldflags "-X github.com/mschulkind-oss/vantage/internal/buildinfo.commit=$(git rev-parse --short HEAD)" -o vantage ./cmd/vantage

# Build, install onto PATH, and restart the systemd user service.
deploy: build
    #!/usr/bin/env bash
    set -euo pipefail
    bindir="$(go env GOBIN)"
    [ -n "$bindir" ] || bindir="$(go env GOPATH)/bin"
    mkdir -p "$bindir"
    rm -f "$bindir/vantage"   # replace any stale binary/symlink from a previous install
    install -m 0755 ./vantage "$bindir/vantage"
    echo "Installed $bindir/vantage"
    systemctl --user restart vantage

# Format the code (Go + frontend). No tests — run this before committing.
format:
    gofmt -w cmd internal web
    cd frontend && npm run format

# Format, then lint, type-check, and test. The full local gate.
check: format
    go vet ./...
    staticcheck ./...
    go test ./...
    cd frontend && npm run lint && npx tsc --noEmit && npm run test

# Read-only gate (errors on issues, never rewrites) — used by the pre-commit hook and CI.
check-ci:
    #!/usr/bin/env bash
    set -euo pipefail
    test -z "$(gofmt -l cmd internal web)" || { echo "unformatted Go (run: just format):"; gofmt -l cmd internal web; exit 1; }
    go vet ./...
    staticcheck ./...
    go test ./...
    cd frontend && npm run format:check && npm run lint && npx tsc --noEmit && npm run test

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

# npm runs prepublishOnly (tsup) automatically, so dist/ is built fresh at
# publish time — it is never committed and never needed for app development.
#
# Publish the vantage-md npm package (optional bump: patch/minor/major/X.Y.Z).
release-md bump="":
    #!/usr/bin/env bash
    set -euo pipefail
    test -z "$(git status --porcelain)" || { echo "working tree dirty — commit or stash first"; exit 1; }
    just check-ci
    cd packages/vantage-md
    if [ -n "{{bump}}" ]; then
        npm version "{{bump}}"
    fi
    version="$(node -p "require('./package.json').version")"
    npm publish --access public
    echo "Published vantage-md@${version}"
    echo "Remember to commit the version bump and tag if you ran a bump."

# ── helpers ─────────────────────────────────────────────────────────

# Build the frontend and copy it into the Go embed dir (preserving .gitkeep so
# the build never dirties a tracked file).
[private]
_bundle:
    cd frontend && npm run build
    rm -rf web/dist
    mkdir -p web/dist
    cp -R frontend/dist/. web/dist/
    @touch web/dist/.gitkeep

# Point git at the tracked hooks dir. Idempotent.
[private]
_hooks:
    #!/usr/bin/env bash
    set -euo pipefail
    chmod +x scripts/hooks/pre-commit scripts/hooks/commit-msg scripts/hooks/pre-push
    git config core.hooksPath scripts/hooks
    echo "Hooks active via core.hooksPath=scripts/hooks"
