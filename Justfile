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

# The fast path: skip the frontend build when only Go changed. It used to mean
# "embed the export committed in web/dist", but nothing is committed there any
# more, so on a fresh clone there is no export to embed and //go:embed would
# cheerfully produce a binary serving "Frontend bundle not found."
#
# So it builds one when there is none. That keeps the fast path fast — an
# existing bundle is left exactly as it is — without leaving a recipe that
# silently produces a broken binary the first time anyone runs it.

# Build the binary without rebuilding an existing frontend bundle.
build-bin:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -f web/dist/index.html ]; then
        echo "web/dist has no bundle — building the frontend first"
        just web-sync
    fi
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
# web/dist is ignored (see .gitignore), so this writes only untracked files and
# there is nothing to commit afterwards. //go:embed accepts an empty directory,
# so a binary built without running this serves the "Frontend bundle not found."
# placeholder — which is what a fresh clone gets until you run it.
#
# `go install …@latest` has no npm and cannot run this, so it relies on the
# bundle being present in the tag's tree; `just release` is what puts it there.
#
# Without npm this warns and leaves whatever is already in web/dist alone, so a
# checkout with only a Go toolchain still builds.

# Rebuild web/dist (the local, ignored frontend export) from frontend/ sources.
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

# Cut a release: build the frontend into a commit that exists only on the tag,
# then push the tag. publish.yml does everything else.
#
# web/dist is not tracked on main, so nothing derived can drift out of step with
# its sources. But `go install …@latest` builds from whatever git holds at the
# tag, with no npm in the picture, so the tag itself has to carry the bundle. It
# gets its own commit, reachable only from the tag: main stays clean, and the tag
# is created once, already correct.
#
# The tag is NEVER moved afterwards, and that is why CI cannot do this job. Go's
# checksum database records a tag's tree hash the first time anyone fetches it;
# re-pointing the tag makes every later fetch fail with a mismatch. A workflow
# triggered *by* the tag push is already too late to add anything to it.

# Build the frontend into a tag-only commit and push the tag.
release version:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -n "$(git status --porcelain)" ]; then
        echo "working tree is dirty — commit or stash first" >&2
        exit 1
    fi
    if git rev-parse -q --verify "refs/tags/v{{version}}" >/dev/null; then
        echo "tag v{{version}} already exists — pick another version" >&2
        exit 1
    fi
    just web-sync
    # Built with plumbing, against a scratch index, so the working tree and HEAD
    # are never touched. Checking out a commit that tracks web/dist and then
    # leaving it would delete the bundle from disk on the way back — and the
    # next `just build-bin` would quietly embed nothing.
    idx=$(mktemp)
    GIT_INDEX_FILE="$idx" git read-tree HEAD
    GIT_INDEX_FILE="$idx" git add --force web/dist
    tree=$(GIT_INDEX_FILE="$idx" git write-tree)
    rm -f "$idx"
    commit=$(git commit-tree "$tree" -p HEAD -m "release v{{version}}")
    git tag "v{{version}}" "$commit"
    git push origin "v{{version}}"
    echo "pushed v{{version}} — publish.yml takes it from here"

# Point git at the tracked hooks dir. Idempotent.
[private]
_hooks:
    #!/usr/bin/env bash
    set -euo pipefail
    chmod +x scripts/hooks/pre-commit scripts/hooks/commit-msg scripts/hooks/pre-push
    git config core.hooksPath scripts/hooks
    echo "Hooks active via core.hooksPath=scripts/hooks"
