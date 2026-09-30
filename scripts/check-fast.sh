#!/bin/sh
# What the pre-commit hook runs: the checks the staged files call for, and no
# others. Wired through `just check-fast`, which is also how to run it by hand.
#
# `just check-ci` is the gate, and it takes about a minute, which is too long to
# pay on every commit. This runs the part of the gate the staged paths can
# affect, so a typical commit takes seconds. It is deliberately NOT the gate:
# `just done` runs all of `check-ci` over a clean tree and has to pass before
# work is finished, and CI runs `check-ci` on every push to main and every pull
# request against it.
#
#   check-fast.sh            choose checks from what is staged, and run them
#   check-fast.sh --plan     print the choice, and run nothing
#   check-fast.sh --select   print the choice for `git diff --name-status`
#                            lines read on stdin, touching neither git nor the
#                            disk. scripts/test-check-fast.sh tests the choice
#                            through this.
#
# WHAT IT READS. Every check reads files on disk; a type-checker or a test
# runner can read nothing else. So each staged path has to be on disk as it is
# staged, and this refuses to run when one is not, rather than check a version
# the commit does not contain: a staged file with unstaged changes on top, or a
# staged deletion whose file is still there, as `git rm --cached` leaves it.
# Everything else is read as it is on disk, exactly as `check-ci` reads it: an
# unstaged edit to a file nobody staged, or an untracked file, can still sway a
# type-check or a test. This warns when one sits where the checks read, and
# `just done` insists on a clean tree, which is what makes it see the commit
# and nothing else.
#
# HOW IT CHOOSES. select_path, below, is a table from one staged path to the
# checks that read it. Three rules keep it honest:
#   - Files every check depends on (the manifests, the lockfile, the Justfile,
#     a package's tsconfig, eslint, vite or vitest config) run the whole gate.
#   - So does a path the table has never met. Being slow on a new kind of file
#     costs a minute; passing it unchecked costs a red CI run.
#   - A check that is cheap over everything runs over everything. go vet,
#     staticcheck and go test take every package, because their caches make an
#     untouched package nearly free and a dependent that the change broke is
#     exactly what a per-package run would miss. The document check takes all of
#     the gate's documents, because a renamed heading breaks links in documents
#     nobody staged, and it runs on every commit, because a document can reach
#     any file in the tree (select_path says how).
#
# The plan is one line per reason, `<check><TAB><path>`: the check, and the
# staged path that called for it. For the checks that take files (gofmt,
# prettier, eslint:*, vitest:frontend) those paths are the files they check.

set -eu

tab=$(printf '\t')
nl='
'

# --- the choice ---------------------------------------------------------------

emit() {
    printf '%s\t%s\n' "$1" "$p"
}

# The files a workspace's `format:check` script names. test-check-fast.sh holds
# this to the globs in the three package.json files, so the two cannot drift.
prettier_glob() {
    case $1 in
    frontend/src/*.ts | frontend/src/*.tsx | frontend/src/*.js | frontend/src/*.jsx | frontend/src/*.css) return 0 ;;
    packages/vantage-md/src/*.ts | packages/vantage-md/src/*.tsx) return 0 ;;
    packages/vantage-md/*/*) return 1 ;;
    packages/vantage-md/*.ts | packages/vantage-md/*.js | packages/vantage-md/*.json) return 0 ;;
    packages/vantage-check/src/*.ts | packages/vantage-check/test/*.ts | packages/vantage-check/scripts/*.ts) return 0 ;;
    esac
    return 1
}

# A JavaScript or TypeScript module: what eslint may lint and vitest may import.
# eslint is handed every one and left to apply its own config, which is why it
# runs with --no-warn-ignored: a file its config does not cover is skipped, as
# `eslint .` skips it.
is_module() {
    case $p in
    *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.mts | *.cts) return 0 ;;
    esac
    return 1
}

is_ts() {
    case $p in *.ts | *.tsx | *.mts | *.cts) return 0 ;; esac
    return 1
}

lint() {
    if [ -n "$here" ] && is_module; then emit "eslint:$1"; fi
    if [ -n "$here" ] && prettier_glob "$p"; then emit prettier; fi
}

# tsc reads TypeScript, and a deleted file of any kind can break it: a side
# effect import of a stylesheet that is gone is a type error, because every
# tsconfig here sets noUncheckedSideEffectImports.
typecheck() {
    if is_ts || [ -z "$here" ]; then
        for _t in "$@"; do emit "tsc:$_t"; done
    fi
}

go_path() {
    emit go
    case $p in
    *.go) if [ -n "$here" ]; then emit gofmt; fi ;;
    esac
    case $p in
    internal/*)
        # vantage-check copies some of the server's rules and holds each copy to
        # the Go source by reading it (DefaultExcludeDirs in internal/config,
        # the size cap in internal/repoconfig), and it reads the fixtures in
        # internal/repoconfig/testdata. No import graph shows either, and the
        # whole suite takes a few seconds alongside go's, so any change under
        # internal/ runs it rather than a list of the files it happens to read.
        emit vitest:vantage-check
        ;;
    esac
    case $p in
    # Shared fixtures, which the frontend's planning suites read too.
    internal/*/testdata/*) emit vitest:repo ;;
    esac
}

frontend_src() {
    # Some frontend tests read sources by path rather than importing them
    # (stylesheets, whole-tree scans), which no import graph records.
    emit vitest:disk
    lint frontend
    typecheck frontend
    if is_module; then
        # `vitest related` follows imports from a file, and a deleted file has
        # none left to follow.
        if [ -n "$here" ]; then emit vitest:frontend; else emit vitest:all; fi
    fi
    if [ "$p" = frontend/src/test/setup.ts ]; then emit vitest:all; fi
}

vantage_md_src() {
    # The frontend's tests read its stylesheets and its viewer by path, and
    # `just _published-package` builds dist/ from here.
    emit vitest:disk
    emit published
    lint vantage-md
    # frontend's tsconfig compiles these sources, and vantage-check imports them.
    typecheck vantage-md frontend vantage-check
    if is_module; then
        # vantage-check imports this code and compiles it into its binary.
        emit vitest:vantage-check
        emit self-check
        if [ -n "$here" ]; then emit vitest:frontend; else emit vitest:all; fi
    fi
}

vantage_check_code() {
    lint vantage-check
    emit tsc:vantage-check
    emit vitest:vantage-check
}

# select_path <status> <path>: the plan lines for one staged path.
select_path() {
    p=$2 here=yes
    if [ "$1" = D ]; then here=; fi

    case $p in
    '"'*)
        # git quotes a name holding a tab, a newline, a quote or a backslash.
        # Nothing below is written to reason about one.
        emit full
        return 0
        ;;
    esac

    # The document check reads more than documents, so every path calls for
    # it. A link may point at any file: deleting it breaks the link (and since
    # the staged set is read with --no-renames, that is also the old half of
    # every rename), and changing its length can break a `#L` anchor into it
    # (link/line-anchor-range). A new file breaks a document beside it that
    # already names it in prose (ref/unlinked-file). Knowing which files the
    # documents reach would take a list to keep; the check takes a couple of
    # seconds alongside the others.
    emit docs
    # vantage-check's tests read this repository's own documents: `index` runs
    # over every planning document in it, and directives.test.ts over the
    # fenced examples in docs/reference/inline-markup.md, which the document
    # check cannot see because a fence is code to it.
    case $p in *.md) emit vitest:vantage-check ;; esac

    case $p in
    # What every check reads: no subset of the gate is safe.
    package.json | package-lock.json | Justfile | mise.toml | .prettierrc.json | .vantage.toml)
        emit full ;;

    go.mod | go.sum | cmd/* | internal/* | web/*) go_path ;;

    # The frontend's planning suites read the documents themselves.
    docs/*.md) emit vitest:repo ;;

    CHANGELOG.md | scripts/changelog-section.sh | scripts/test-changelog-section.sh)
        emit script:test-changelog-section ;;
    scripts/check-commit-messages.sh | scripts/test-commit-messages.sh | scripts/hooks/commit-msg | scripts/hooks/pre-push)
        emit script:test-commit-messages ;;
    scripts/check-fast.sh | scripts/test-check-fast.sh | scripts/hooks/pre-commit)
        emit script:test-check-fast ;;

    frontend/src/*) frontend_src ;;
    # Playwright specs: `eslint .` lints them, and nothing else but the
    # document check reads them.
    frontend/e2e/*) lint frontend ;;
    frontend/README.md | frontend/index.html | frontend/.gitignore) ;;
    # Anything else in frontend/ is its configuration: the manifest, the
    # tsconfigs, and the eslint, vite, vitest, playwright, postcss and tailwind
    # configs. A directory the table has never met lands here too.
    frontend/*) emit full ;;

    packages/vantage-md/src/*) vantage_md_src ;;
    packages/vantage-md/scripts/* | packages/vantage-md/typetest/*)
        lint vantage-md
        emit published
        ;;
    packages/vantage-check/src/* | packages/vantage-check/scripts/*)
        vantage_check_code
        emit self-check
        ;;
    packages/vantage-check/test/*) vantage_check_code ;;
    packages/*/README.md) ;;
    packages/*) emit full ;;

    # Read by nothing else in the gate: by the document check alone, which
    # every path already calls for.
    docs/* | userguide/* | *.md) ;;
    .github/* | .air.toml | .gitignore | LICENSE | NOTICE | Procfile) ;;
    docs-worker.js | docs-wrangler.toml | yolo-jail.jsonc) ;;
    scripts/build-site.sh | scripts/build-wheel.py | scripts/e2e-fixture.sh | scripts/update-brew-tap.sh) ;;

    *) emit full ;;
    esac
}

# The plan for `git diff --name-status` lines on stdin, sorted and deduplicated.
plan_from_stdin() {
    while IFS= read -r _line || [ -n "$_line" ]; do
        [ -n "$_line" ] || continue
        _status=${_line%%"$tab"*}
        select_path "${_status%"${_status#?}"}" "${_line#*"$tab"}"
    done | sort -u
}

case ${1-} in
--select)
    plan_from_stdin
    exit 0
    ;;
--plan) mode=plan ;;
'') mode=run ;;
*)
    echo "usage: check-fast.sh [--plan | --select]" >&2
    exit 2
    ;;
esac

root=$(git rev-parse --show-toplevel)
cd "$root"
work=$(mktemp -d)
: >"$work/jobs"
: >"$work/reaped"

# descendants <file of PIDs>: those PIDs and every process under them, sorted.
descendants() {
    ps -A -o pid= -o ppid= | awk '
        NR == FNR { queue[++n] = $1; next }
        { kids[$2] = kids[$2] " " $1 }
        END {
            for (i = 1; i <= n; i++) {
                if (seen[queue[i]]++) continue
                print queue[i]
                m = split(kids[queue[i]], k, " ")
                for (j = 1; j <= m; j++) queue[++n] = k[j]
            }
        }' "$1" - | sort -u
}

# stop_jobs: end every job launched below that is still running, and all it
# started. A shell without job control, which is what runs a hook, starts a
# background job with SIGINT ignored, and the tools a job runs keep it ignored,
# so a Ctrl-C reaches this script and none of them: go test and the rest would
# run on after the commit was abandoned. TERM is not ignored. A job's checks are
# its children and theirs, so the tree is stopped first, until a fresh look
# finds nothing new, which leaves no job a moment to start its next step.
stop_jobs() {
    cut -f1 "$work/jobs" | grep -Fvx -f "$work/reaped" >"$work/tree" || true
    while [ -s "$work/tree" ]; do
        # One PID per line, so word splitting is exactly what is wanted.
        # shellcheck disable=SC2046
        kill -STOP $(cat "$work/tree") 2>/dev/null || true
        descendants "$work/tree" >"$work/grown"
        if cmp -s "$work/tree" "$work/grown"; then break; fi
        mv "$work/grown" "$work/tree"
    done
    if [ -s "$work/tree" ]; then
        # shellcheck disable=SC2046
        kill -TERM $(cat "$work/tree") 2>/dev/null || true
        # shellcheck disable=SC2046
        kill -CONT $(cat "$work/tree") 2>/dev/null || true
    fi
}

# dash runs no EXIT trap when a signal ends it, so a signal cleans up itself.
on_signal() {
    trap - EXIT INT TERM
    stop_jobs
    rm -rf "$work"
    exit "$1"
}
trap 'rm -rf "$work"' EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

# git sets GIT_INDEX_FILE for a hook, so this is the index being committed:
# `git commit <path>` builds a temporary one, and this reads that.
staged=$(git -c core.quotePath=false diff --cached --name-status --no-renames)
if [ -z "$staged" ]; then
    echo "check-fast: nothing is staged, so there is nothing to check."
    exit 0
fi
plan=$(printf '%s\n' "$staged" | plan_from_stdin)

# Every check reads the disk, so a staged path that is not on disk as it is
# staged would be checked in a version the commit does not hold. git diff lists
# a staged file with unstaged changes on top, but no untracked file, so a staged
# deletion whose file is still there (as `git rm --cached` leaves it) is looked
# for on disk.
printf '%s\n' "$plan" | cut -f2 | sed '/^$/d' | sort -u >"$work/checked"
unstaged=$(git -c core.quotePath=false diff --name-only --no-renames)
# A function rather than inline: macOS's /bin/sh is bash 3.2, which cannot parse
# a `case` pattern's closing parenthesis inside `$( … )` ("syntax error near
# unexpected token `newline'"). test-check-fast.sh refuses any `case` inside a
# command substitution in this file.
deleted_but_on_disk() {
    printf '%s\n' "$staged" | while IFS= read -r _line; do
        case $_line in
        D"$tab"*)
            _p=${_line#*"$tab"}
            if [ -e "$_p" ] || [ -L "$_p" ]; then printf '%s\n' "$_p"; fi
            ;;
        esac
    done
}
differs=$(
    if [ -n "$unstaged" ]; then
        printf '%s\n' "$unstaged" | grep -Fx -f "$work/checked" || true
    fi
    deleted_but_on_disk
)
if [ -n "$differs" ]; then
    echo "check-fast: on disk, these staged paths are not what this commit holds:"
    printf '%s\n' "$differs" | sort -u | sed 's/^/    /'
    echo "Every check reads the disk, so it would check a version the commit does not contain."
    echo "Stage the rest (git add, or git rm), or set it aside while you commit:"
    echo "    git stash push --keep-index --include-untracked && git commit && git stash pop"
    exit 1
fi

if [ "$mode" = plan ]; then
    printf '%s\n' "$plan"
    exit 0
fi

# --- running it ---------------------------------------------------------------

checks=$(printf '%s\n' "$plan" | cut -f1 | sort -u)

has() {
    printf '%s\n' "$checks" | grep -Fqx -e "$1"
}

paths_for() {
    printf '%s\n' "$plan" | awk -F "$tab" -v c="$1" '$1 == c { print $2 }'
}

# with_paths <newline-separated paths> <command...>: the command, with each path
# appended as one argument, spaces and all.
with_paths() {
    _list=$1
    shift
    _ifs=$IFS
    IFS=$nl
    set -f
    # Word splitting on newlines alone is the point here.
    # shellcheck disable=SC2086
    set -- "$@" $_list
    set +f
    IFS=$_ifs
    "$@"
}

started=$(date +%s)
count=$(printf '%s\n' "$staged" | wc -l | tr -d ' ')

# What nobody staged is read as it is on disk, as check-ci reads it: a commit
# that needs a file nobody added, or an unstaged fix to a caller, passes here and
# fails in CI. That cannot be refused without refusing every commit made from a
# tree with other work in it, so it is said instead.
aside=$(
    {
        printf '%s\n' "$unstaged"
        git -c core.quotePath=false ls-files --others --exclude-standard
    } | sed '/^$/d' | sort -u
)
if [ -n "$aside" ]; then
    _n=$(printf '%s\n' "$aside" | wc -l | tr -d ' ')
    echo "check-fast: this commit does not hold these, and the checks read them as they are on disk:"
    printf '%s\n' "$aside" | sed -n '1,10s/^/    /p'
    if [ "$_n" -gt 10 ]; then echo "    ...and $((_n - 10)) more"; fi
    echo "  To check the commit without them: git stash push --keep-index --include-untracked"
fi

if has full; then
    echo "check-fast: every check depends on these, so this commit runs the whole gate:"
    paths_for full | sed 's/^/    /'
    if just check-ci; then exit 0; else exit 1; fi
fi

# The gate's first step, and for the same reason: CI lints and tests against the
# lockfile, and a stale local install answers a different question. Every commit
# runs the document check, whose CLI is built from that install.
just _deps-match

# Frontend tests that read sources off disk by path. The repository readers,
# which reach docs/ and Go's testdata through src/test/planning.ts, are left to
# vitest:repo: they are the slow half, and no change to a source file affects
# what they read. That holds only while none of them also reads a file by a
# path of its own, so test-check-fast.sh fails the day one does.
disk_readers() {
    git grep -l -E "node:fs|from ['\"]fs['\"]" -- 'frontend/src/*.test.ts' 'frontend/src/*.test.tsx' >"$work/fs-readers" || true
    git grep -l -e 'test/planning' -- 'frontend/src/*.test.ts' 'frontend/src/*.test.tsx' >"$work/repo-readers" || true
    grep -Fvx -f "$work/repo-readers" "$work/fs-readers" || true
}

job_gofmt() {
    _out=$(with_paths "$(paths_for gofmt)" gofmt -l) || return 1
    if [ -n "$_out" ]; then
        echo "unformatted Go (run: just format):"
        echo "$_out"
        return 1
    fi
}

# The gate's Go steps, over every package: see the header for why.
job_go() {
    go vet ./cmd/... ./internal/... ./web/... &&
        staticcheck ./cmd/... ./internal/... ./web/... &&
        go test ./cmd/... ./internal/... ./web/...
}

job_prettier() {
    with_paths "$(paths_for prettier)" npx prettier --check
}

# eslint runs from the workspace, as `npm run lint` does, so that each package's
# own eslint.config.js decides.
job_eslint() {
    case $1 in
    frontend) _dir=frontend ;;
    *) _dir=packages/$1 ;;
    esac
    _files=$(paths_for "eslint:$1" | sed "s|^$_dir/||")
    cd "$_dir" && with_paths "$_files" npx eslint --max-warnings 0 --no-warn-ignored
}

job_tsc() {
    case $1 in
    frontend) npx tsc --build frontend ;;
    *) npm run typecheck -w "$1" ;;
    esac
}

# One vitest run for the frontend: the tests that import a staged module, plus
# the disk readers each kind of change calls for. vantage-md has no test runner
# of its own, so its sources are tested here too, through the source alias.
job_vitest_frontend() {
    if has vitest:all; then
        (cd frontend && npx vitest run)
        return
    fi
    _args=$(
        paths_for vitest:frontend
        if has vitest:disk; then disk_readers; fi
        if has vitest:repo; then echo frontend/src/test/planning.ts; fi
    )
    _args=$(printf '%s\n' "$_args" | sed -e 's|^frontend/||' -e 's|^packages/|../packages/|' | sort -u)
    if [ -z "$_args" ]; then
        echo "no test reads the staged files"
        return 0
    fi
    cd frontend && with_paths "$_args" npx vitest related --run
}

job_script() {
    sh "scripts/$1.sh"
}

# launch <name> <command...>: run it in the background, its output kept aside.
launch() {
    _name=$1
    shift
    _log="$work/$(printf '%s' "$_name" | tr ':/' '__')"
    (
        _t0=$(date +%s)
        if "$@" >"$_log.log" 2>&1; then _rc=0; else _rc=$?; fi
        echo $(($(date +%s) - _t0)) >"$_log.secs"
        exit "$_rc"
    ) &
    printf '%s\t%s\t%s\n' "$!" "$_name" "$_log" >>"$work/jobs"
}

if has gofmt; then launch gofmt job_gofmt; fi
if has go; then launch go job_go; fi
if has prettier; then launch prettier job_prettier; fi
for _ws in frontend vantage-md vantage-check; do
    if has "eslint:$_ws"; then launch "eslint:$_ws" job_eslint "$_ws"; fi
done
for _ws in frontend vantage-md vantage-check; do
    if has "tsc:$_ws"; then launch "tsc:$_ws" job_tsc "$_ws"; fi
done
if has published; then launch published just _published-package; fi
if has vitest:frontend || has vitest:disk || has vitest:repo || has vitest:all; then
    launch vitest:frontend job_vitest_frontend
fi
if has vitest:vantage-check; then launch vitest:vantage-check npm run test -w vantage-check; fi
# The document check, which every commit runs, rebuilds the CLI first. bun takes
# well under a second, and a binary left over from other sources could pass what
# the gate's fails. _self-check does both itself, and more.
if has self-check; then
    launch self-check just _self-check
else
    launch docs just cli _check-docs
fi
for _script in $(printf '%s\n' "$checks" | sed -n 's/^script://p'); do
    launch "script:$_script" job_script "$_script"
done

jobs=$(wc -l <"$work/jobs" | tr -d ' ')
if [ "$jobs" -eq 1 ]; then _run="1 check"; else _run="$jobs checks"; fi
if [ "$count" -eq 1 ]; then _for="1 staged path"; else _for="$count staged paths"; fi
echo "check-fast: $_run for $_for"
failed=0
while IFS="$tab" read -r _pid _name _log; do
    if wait "$_pid"; then _rc=0; else _rc=$?; fi
    echo "$_pid" >>"$work/reaped"
    _secs=$(cat "$_log.secs" 2>/dev/null || echo '?')
    if [ "$_rc" -eq 0 ]; then
        printf '  ok    %-22s %ss\n' "$_name" "$_secs"
    else
        failed=$((failed + 1))
        printf '  FAIL  %-22s %ss\n' "$_name" "$_secs"
        sed 's/^/        /' "$_log.log"
    fi
done <"$work/jobs"

elapsed=$(($(date +%s) - started))
if [ "$failed" -ne 0 ]; then
    echo "check-fast: $failed of $jobs checks failed (${elapsed}s)."
    exit 1
fi
echo "check-fast: all $jobs passed in ${elapsed}s. This is not the gate: run \`just done\` before calling the work finished."
