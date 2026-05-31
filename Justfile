# Vantage Justfile

default:
    @just --list

# Install dependencies and git hooks (run once after cloning).
setup: _hooks
    mise install
    go mod download
    cd packages/vantage-md && npm ci && npx tsup
    cd frontend && npm ci

# Run the backend + frontend dev servers (Ctrl-C to stop).
dev path=".":
    TARGET_REPO={{path}} overmind start

# Build the vantage binary with the frontend embedded.
build: _bundle
    go build -ldflags "-X github.com/mschulkind-oss/vantage/internal/buildinfo.commit=$(git rev-parse --short HEAD)" -o vantage ./cmd/vantage

# Build, install onto PATH (GOBIN), and restart the systemd user service.
deploy: _bundle
    go install -ldflags "-X github.com/mschulkind-oss/vantage/internal/buildinfo.commit=$(git rev-parse --short HEAD)" ./cmd/vantage
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
