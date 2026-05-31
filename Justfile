# Vantage Justfile

# Socket path — single source of truth
export OVERMIND_SOCKET := justfile_directory() / ".overmind.sock"

# Fixed title so we can reliably find orphaned processes
export OVERMIND_TITLE := "vantage-dev"

default:
    @just --list

# ── Setup ───────────────────────────────────────────────────────────

# Install everything needed to build, test, and run the project.
setup: install-hooks
    mise install
    go mod download
    cd packages/vantage-md && npm ci && npx tsup
    cd frontend && npm ci

# Point git at the tracked hooks dir. Idempotent.
install-hooks:
    #!/usr/bin/env bash
    set -euo pipefail
    chmod +x scripts/hooks/pre-commit scripts/hooks/commit-msg scripts/hooks/pre-push
    git config core.hooksPath scripts/hooks
    echo "Hooks active via core.hooksPath=scripts/hooks"

# ── Quality gate ────────────────────────────────────────────────────

# Local dev gate: format in place, fix lint, run tests.
check: format lint test

# Read-only gate used by the pre-commit hook and CI.
check-ci: lint-ci test

format: format-go format-js
format-go:
    gofmt -w cmd internal web
format-js:
    cd frontend && npm run format

lint: lint-go lint-js
lint-go:
    go vet ./...
    staticcheck ./...
lint-js:
    cd frontend && npm run lint
    cd frontend && npx tsc --noEmit

lint-ci: lint-ci-go lint-ci-js
lint-ci-go:
    #!/usr/bin/env bash
    set -euo pipefail
    unformatted="$(gofmt -l cmd internal web)"
    if [ -n "$unformatted" ]; then echo "gofmt needed:"; echo "$unformatted"; exit 1; fi
    go vet ./...
    staticcheck ./...
lint-ci-js:
    cd frontend && npm run format:check
    cd frontend && npm run lint
    cd frontend && npx tsc --noEmit

test: test-go test-js
test-go *args:
    go test ./... {{args}}
test-js:
    cd frontend && npm run test

# ── Dev servers (overmind) ──────────────────────────────────────────

dev-go path=".":
    go run ./cmd/vantage serve {{path}}

dev-js:
    cd frontend && npm run dev

# Start dev servers (idempotent — safe to call repeatedly)
dev path=".":
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -e "$OVERMIND_SOCKET" ] && overmind status &>/dev/null; then
        echo "Dev servers already running. Use 'just dev-stop' or 'just dev-restart'."
        exit 0
    fi
    rm -f "$OVERMIND_SOCKET"
    pkill -f "overmind-${OVERMIND_TITLE}" 2>/dev/null || true
    sleep 0.5
    TARGET_REPO={{path}} overmind start -D
    echo "Dev servers started. Use 'just dev-connect' to view logs."

dev-stop:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -e "$OVERMIND_SOCKET" ]; then
        overmind quit 2>/dev/null || true
        for _ in $(seq 1 30); do [ ! -e "$OVERMIND_SOCKET" ] && break; sleep 0.1; done
        rm -f "$OVERMIND_SOCKET"
    fi
    pkill -f "overmind-${OVERMIND_TITLE}" 2>/dev/null || true
    echo "Dev servers stopped."

dev-restart path=".":
    just dev-stop
    just dev {{path}}

dev-connect:
    overmind connect

# ── Build ───────────────────────────────────────────────────────────

# Build the frontend single-page app.
build-frontend:
    cd frontend && npm run build

# Copy the built frontend into the Go embed directory.
bundle-frontend: build-frontend
    rm -rf web/dist
    cp -r frontend/dist web/dist

# Build the vantage binary with the frontend embedded.
build: bundle-frontend
    go build -ldflags "-X github.com/mschulkind-oss/vantage/internal/buildinfo.commit=$(git rev-parse --short HEAD)" -o vantage ./cmd/vantage

# Run the server directly (dev — frontend served from web/dist placeholder
# unless you have run bundle-frontend).
run path=".":
    go run ./cmd/vantage serve {{path}}

# Build the static user-guide documentation site into dist/docs.
build-docs:
    ./scripts/build-site.sh

# Deploy the user-guide site to Cloudflare.
deploy-docs: build-docs
    npx wrangler deploy --config docs-wrangler.toml

# ── Housekeeping ────────────────────────────────────────────────────

# Verify the repo is clean and in sync at the end of a task.
done:
    @echo "== branch =="
    @current=$(git symbolic-ref --short HEAD); \
     if [ "$current" != "main" ]; then echo "FAIL: on '$current', expected 'main'"; exit 1; \
     else echo "OK: on main"; fi
    @echo "== working tree =="
    @if [ -n "$(git status --porcelain)" ]; then echo "FAIL: working tree not clean:"; git status --short; exit 1; \
     else echo "OK: clean"; fi
    @echo "== quality gate =="
    @just check-ci
    @echo ""
    @echo "done: ready to report task complete."
