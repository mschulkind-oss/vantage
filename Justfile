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

# Build the vantage binary with the frontend embedded.
build: _bundle
    go build -ldflags "-X github.com/mschulkind-oss/vantage/internal/buildinfo.commit=$(git rev-parse --short HEAD)" -o vantage ./cmd/vantage

# bun compiles the TypeScript into one self-contained executable in about a
# second, which is why the gate can afford to rebuild it on every run. The
# output lands in packages/vantage-check/dist, which is gitignored, so this
# never dirties a tracked file.
#
# Build the vantage-check CLI for the current host.
cli:
    cd packages/vantage-check && bun run build

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

# Format the code (Go + frontend + the agent CLI). No tests — run before committing.
format:
    gofmt -w cmd internal web
    cd packages/vantage-check && npm run format
    cd frontend && npm run format

# Format, then lint, type-check, and test. The full local gate.
check: format
    go vet ./cmd/... ./internal/... ./web/...
    staticcheck ./cmd/... ./internal/... ./web/...
    go test ./cmd/... ./internal/... ./web/...
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

# Bump the vantage-check version. The build + publish (cross-compiled binaries
# and PyPI wheels) is driven by the vantage-check@* tag in
# .github/workflows/publish-check.yml — this recipe only bumps and reminds you
# to push the tag. (vantage-check is never published to npm.)
release-check bump="":
    #!/usr/bin/env bash
    set -euo pipefail
    test -z "$(git status --porcelain)" || { echo "working tree dirty — commit or stash first"; exit 1; }
    just check-ci
    cd packages/vantage-check
    if [ -n "{{bump}}" ]; then
        npm version "{{bump}}"
    fi
    version="$(node -p "require('./package.json').version")"
    echo "Bumped vantage-check to ${version}."
    echo "Push the tag to build and publish:  git tag vantage-check@${version} && git push origin vantage-check@${version}"

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
