#!/bin/sh
# Tests for check-fast.sh, the pre-commit hook's choice of checks. Run by
# `just check-ci`, like the other script tests here.
#
# The choice is the part that can quietly go wrong: a path mapped to too few
# checks lets a commit through that the gate would stop, and nothing reports it
# until CI does. So the table is tested through --select, which reads
# `git diff --name-status` lines and touches nothing else; the prettier globs are
# held to the package.json scripts they copy; and the part that talks to git —
# what counts as staged, and when a staged file is refused — runs against a
# throwaway repository, because it is only real once there is an index to read.

set -eu

# This can run inside the pre-commit hook (check-fast.sh runs it when it is
# staged), where git's environment points at the repository being committed to.
# All of it has to go before the throwaway repository below is touched. See
# test-commit-messages.sh, which learned this the hard way.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
    GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_PREFIX GIT_COMMON_DIR \
    GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_AUTHOR_DATE \
    GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_COMMITTER_DATE \
    GIT_EDITOR GIT_INDEX_VERSION GIT_REFLOG_ACTION 2>/dev/null || true

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
script="$here/check-fast.sh"
top=$(CDPATH='' cd -- "$here/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
tab=$(printf '\t')

pass=0
fail=0

ok() { pass=$((pass + 1)); }
no() {
    fail=$((fail + 1))
    echo "FAIL [$1]: $2"
}

# select_for <lines>: the plan for "STATUS path" lines, one per line.
select_for() {
    printf '%s\n' "$1" | sed "s/ /$tab/" | sh "$script" --select
}

# expect_checks <label> <lines> <checks>: exactly these checks, and no others.
expect_checks() {
    _got=$(select_for "$2" | cut -f1 | sort -u | tr '\n' ' ')
    # shellcheck disable=SC2086
    _want=$(for _c in $3; do echo "$_c"; done | sort -u | tr '\n' ' ')
    if [ "$_got" = "$_want" ]; then ok; else no "$1" "wanted [$_want], got [$_got]"; fi
}

# expect_files <label> <lines> <check> <paths>: the files that check is given.
expect_files() {
    _got=$(select_for "$2" | awk -F "$tab" -v c="$3" '$1 == c { print $2 }' | sort)
    _want=$(printf '%s\n' "$4" | sed '/^$/d' | sort)
    if [ "$_got" = "$_want" ]; then ok; else no "$1" "$3 wanted [$_want], got [$_got]"; fi
}

# --- what macOS's /bin/sh can parse --------------------------------------------
#
# macOS's /bin/sh is bash 3.2, which cannot parse a `case` pattern's closing
# parenthesis inside a `$( … )` command substitution; dash and a current bash
# both can, so nothing run here would notice. CI's macOS job is the first to, and
# it fails every case of this file at once. So a `case` inside a command
# substitution is refused by reading the script: keep it in a function and call
# the function inside the substitution instead.

# case_in_substitution <file>: "line: text" for each `case` inside `$( … )`.
case_in_substitution() {
    awk '
        { line = $0; sub(/#.*/, "", line) }
        depth > 0 && line ~ /^[ \t]*\)[ \t]*$/ { depth--; next }
        depth > 0 && line ~ /(^|[^A-Za-z_])case[ \t]/ { print NR ": " $0 }
        line ~ /\$\([^)]*(^|[^A-Za-z_])case[ \t]/ { print NR ": " $0 }
        line ~ /\$\([ \t]*$/ { depth++ }
    ' "$1"
}

_found=$(case_in_substitution "$script")
if [ -z "$_found" ]; then ok; else no "a case inside a command substitution" "$_found"; fi

# The guard itself, against the shape that broke macOS.
cat >"${TMPDIR:-/tmp}/check-fast-guard.$$" <<'SH'
x=$(
    printf '%s\n' "$y" | while read -r l; do
        case $l in
        D*) echo "$l" ;;
        esac
    done
)
SH
_found=$(case_in_substitution "${TMPDIR:-/tmp}/check-fast-guard.$$")
rm "${TMPDIR:-/tmp}/check-fast-guard.$$"
if [ -n "$_found" ]; then ok; else no "the case-in-substitution guard" "missed the shape that breaks bash 3.2"; fi

# --- the table ---------------------------------------------------------------

# Every path runs the document check, since a document can reach any file, and
# every Markdown file runs vantage-check's tests, which read the repository's
# own documents. So `docs` is in every plan below that is not the whole gate.
expect_checks "a document under docs/" "M docs/development.md" "docs vitest:repo vitest:vantage-check"
expect_checks "the reference whose examples vantage-check's tests copy" \
    "M docs/reference/inline-markup.md" "docs vitest:repo vitest:vantage-check"
expect_checks "a user guide page" "M userguide/getting-started.md" "docs vitest:vantage-check"
expect_checks "a root document" "M README.md" "docs vitest:vantage-check"
expect_checks "a document the gate never checks is still a link target" "M roadmap.md" "docs vitest:vantage-check"
expect_checks "an image in docs/" "M docs/screenshot.png" "docs"
expect_checks "CHANGELOG.md" "M CHANGELOG.md" "docs vitest:vantage-check script:test-changelog-section"

# A document may name a file that does not exist yet (ref/unlinked-file), and a
# `#L` anchor reads the length of whatever file it points into.
expect_checks "a new file beside a document" "A userguide/guides/Nord.css" "docs"
expect_checks "a new file under docs/" "A docs/diagram.svg" "docs"
expect_checks "a workflow a document anchors into" "M .github/workflows/publish.yml" "docs"
expect_checks "a Go file a document anchors into" "M internal/server/spa.go" \
    "docs go gofmt vitest:vantage-check"

expect_checks "one Go file" "M internal/git/service.go" "docs go gofmt vitest:vantage-check"
expect_files "one Go file" "M internal/git/service.go" gofmt "internal/git/service.go"
expect_checks "a deleted Go file" "D internal/git/fswalk.go" "go docs vitest:vantage-check"
expect_checks "go.mod" "M go.mod" "docs go"
expect_checks "the embed package" "M web/embed.go" "docs go gofmt"
expect_checks "a Go file outside internal/" "M cmd/vantage/main.go" "docs go gofmt"
# vantage-check's tests read these two by path, to hold its copies to them.
expect_checks "the server's excluded directories" "M internal/config/config.go" \
    "docs go gofmt vitest:vantage-check"
expect_checks "the server's config size cap" "M internal/repoconfig/repoconfig.go" \
    "docs go gofmt vitest:vantage-check"
expect_checks "shared Go testdata" "M internal/repoconfig/testdata/shared-config.toml" \
    "docs go vitest:repo vitest:vantage-check"

leaf="M frontend/src/lib/headerFit.ts"
expect_checks "one frontend module" "$leaf" \
    "docs prettier eslint:frontend tsc:frontend vitest:frontend vitest:disk"
expect_files "one frontend module" "$leaf" vitest:frontend "frontend/src/lib/headerFit.ts"
expect_files "one frontend module" "$leaf" eslint:frontend "frontend/src/lib/headerFit.ts"
expect_checks "a frontend test" "M frontend/src/lib/headerFit.test.ts" \
    "docs prettier eslint:frontend tsc:frontend vitest:frontend vitest:disk"
expect_checks "a frontend stylesheet" "M frontend/src/index.css" "docs prettier vitest:disk"
expect_checks "a deleted frontend module" "D frontend/src/lib/headerFit.ts" \
    "docs tsc:frontend vitest:all vitest:disk"
expect_checks "a deleted stylesheet still type-checks" "D frontend/src/themes/lila.css" \
    "docs tsc:frontend vitest:disk"
expect_checks "the test setup file" "M frontend/src/test/setup.ts" \
    "docs prettier eslint:frontend tsc:frontend vitest:frontend vitest:all vitest:disk"
expect_checks "a Playwright spec" "M frontend/e2e/basic.spec.ts" "docs eslint:frontend"
expect_checks "an e2e fixture document" "M frontend/e2e/fixtures/test_repo/page1.md" "docs vitest:vantage-check"
expect_checks "the frontend's index.html" "M frontend/index.html" "docs"
expect_checks "a measurement harness module" "M frontend/perf/planning/run.ts" \
    "docs prettier eslint:frontend tsc:frontend"
expect_files "a measurement harness module" "M frontend/perf/planning/run.ts" prettier \
    "frontend/perf/planning/run.ts"
expect_checks "a deleted harness module" "D frontend/perf/planning/run.ts" "docs tsc:frontend"
expect_checks "the harness's README" "M frontend/perf/planning/README.md" "docs vitest:vantage-check"
expect_checks "the harness's tsconfig" "M frontend/tsconfig.perf.json" "docs full"

# A rename arrives as a deletion and an addition, because check-fast.sh reads
# the staged set with --no-renames.
rename="D frontend/src/lib/headerFit.ts
A frontend/src/lib/headerFitting.ts"
expect_checks "a renamed frontend module" "$rename" \
    "docs prettier eslint:frontend tsc:frontend vitest:frontend vitest:all vitest:disk"
expect_files "a renamed frontend module" "$rename" prettier "frontend/src/lib/headerFitting.ts"
expect_files "a renamed frontend module" "$rename" docs "frontend/src/lib/headerFit.ts
frontend/src/lib/headerFitting.ts"

vmd="M packages/vantage-md/src/pipeline.ts"
expect_checks "one vantage-md module" "$vmd" \
    "docs prettier eslint:vantage-md tsc:vantage-md tsc:frontend tsc:vantage-check published self-check vitest:frontend vitest:disk vitest:vantage-check"
expect_checks "a vantage-md stylesheet" "M packages/vantage-md/src/styles/directives.css" \
    "docs published vitest:disk"
expect_checks "a vantage-md release check" "M packages/vantage-md/scripts/check-published-css.mjs" \
    "docs eslint:vantage-md published"
expect_checks "the published-types consumer" "M packages/vantage-md/typetest/consumer.ts" \
    "docs eslint:vantage-md published"
expect_checks "a vantage-md README" "M packages/vantage-md/README.md" "docs vitest:vantage-check"

expect_checks "one vantage-check module" "M packages/vantage-check/src/main.ts" \
    "docs prettier eslint:vantage-check tsc:vantage-check vitest:vantage-check self-check"
expect_checks "a vantage-check test" "M packages/vantage-check/test/slugs.test.ts" \
    "docs prettier eslint:vantage-check tsc:vantage-check vitest:vantage-check"
expect_checks "the vantage-check build script" "M packages/vantage-check/scripts/build.ts" \
    "docs prettier eslint:vantage-check tsc:vantage-check vitest:vantage-check self-check"

expect_checks "the commit-message policy" "M scripts/check-commit-messages.sh" "docs script:test-commit-messages"
expect_checks "the commit-msg hook" "M scripts/hooks/commit-msg" "docs script:test-commit-messages"
expect_checks "the changelog policy" "M scripts/changelog-section.sh" "docs script:test-changelog-section"
expect_checks "this script" "M scripts/check-fast.sh" "docs script:test-check-fast"
expect_checks "the pre-commit hook" "M scripts/hooks/pre-commit" "docs script:test-check-fast"
expect_checks "a script the gate never runs" "M scripts/build-site.sh" "docs"

# What every check reads, and what the table has never met: the whole gate.
for _p in package.json package-lock.json Justfile mise.toml .prettierrc.json .vantage.toml \
    frontend/package.json frontend/tsconfig.app.json frontend/vite.config.ts \
    frontend/vitest.config.ts frontend/eslint.config.js frontend/public/icon.svg \
    packages/vantage-md/package.json packages/vantage-md/tsdown.config.ts \
    packages/vantage-check/vitest.config.ts packages/vantage-check/bin/new \
    newdir/thing.txt Makefile; do
    expect_checks "whole gate for $_p" "M $_p" "docs full"
done

for _p in LICENSE NOTICE Procfile .air.toml .gitignore .github/workflows/ci.yml docs-worker.js; do
    expect_checks "only the document check reads $_p" "M $_p" "docs"
done
expect_checks "a Markdown file under .github/" "M .github/pull_request_template.md" "docs vitest:vantage-check"

# A path git has to quote is not parsed, and not passed: it runs the gate.
expect_checks "a quoted path" 'M "odd\tname.md"' "full"
expect_files "a path with a space" "M docs/design/a b.md" docs "docs/design/a b.md"

mix="M docs/development.md
M internal/git/service.go
M frontend/src/lib/headerFit.ts
M LICENSE"
expect_checks "a mix" "$mix" \
    "docs vitest:repo vitest:vantage-check go gofmt prettier eslint:frontend tsc:frontend vitest:frontend vitest:disk"
expect_files "a mix runs the document check for every path" "$mix" docs "docs/development.md
internal/git/service.go
frontend/src/lib/headerFit.ts
LICENSE"

expect_checks "nothing" "" ""

# --- what the frontend's disk readers leave out --------------------------------
#
# check-fast.sh runs the frontend tests that read files by path (vitest:disk)
# for every source change, except those that import src/test/planning.ts: they
# read docs/ and Go's testdata, which no source change touches, and they run
# for those paths instead (vitest:repo). A test that did both, reading a source
# by a path of its own too, would silently stop running for the change that
# breaks it. Every by-path reader here finds its file from its own location, so
# none of the planning importers may.

frontend_tests() {
    git -C "$top" grep -l "$@" -- 'frontend/src/*.test.ts' 'frontend/src/*.test.tsx' | sort -u || true
}
frontend_tests -E "node:fs|from ['\"]fs['\"]" >"$tmp/fs-readers"
frontend_tests -e 'test/planning' >"$tmp/repo-readers"
frontend_tests -E 'import\.meta\.(url|dirname|filename)|__dirname|process\.cwd\(' >"$tmp/own-path"
if [ ! -s "$tmp/fs-readers" ] || [ ! -s "$tmp/repo-readers" ]; then
    no "disk readers" "found no frontend test that reads the disk or imports test/planning"
fi
both=$(comm -12 "$tmp/fs-readers" "$tmp/repo-readers" | comm -12 - "$tmp/own-path")
if [ -z "$both" ]; then
    ok
else
    no "disk readers" "these import test/planning and read a path of their own, so no source change runs them: $both"
fi

# --- the prettier globs are the gate's ---------------------------------------
#
# prettier is the one check that has to be told which files to take: the gate
# runs it over the globs in each package's format:check script, and given a file
# outside them it would check that file anyway. So over every tracked file, the
# files check-fast.sh hands prettier must be exactly the ones those globs match,
# apart from the ones that run the whole gate, which runs prettier on them itself.

git -C "$top" ls-files | sed "s/^/M$tab/" | sh "$script" --select >"$tmp/all-plan"
awk -F "$tab" '$1 == "prettier" || $1 == "full" { print $2 }' "$tmp/all-plan" | sort -u >"$tmp/covered"
awk -F "$tab" '$1 == "prettier" { print $2 }' "$tmp/all-plan" | sort -u >"$tmp/handed"
for ws in frontend packages/vantage-md packages/vantage-check; do
    # shellcheck disable=SC2016 # JavaScript, not shell: the ${} is a template literal.
    node -e '
        const [pkg, ws] = process.argv.slice(1);
        const script = require(pkg).scripts["format:check"];
        for (const [, glob] of script.matchAll(/\x27([^\x27]+)\x27/g)) {
            const m = glob.match(/^(.*)\{([^}]*)\}(.*)$/);
            const alts = m ? m[2].split(",").map((a) => m[1] + a + m[3]) : [glob];
            for (const g of alts) console.log(`:(glob)${ws}/${g}`);
        }' "$top/$ws/package.json" "$ws" >"$tmp/globs"
    if [ ! -s "$tmp/globs" ]; then
        no "prettier globs for $ws" "no quoted globs in its format:check script"
        continue
    fi
    set -f
    _ifs=$IFS
    IFS='
'
    # shellcheck disable=SC2046
    git -C "$top" ls-files -- $(cat "$tmp/globs") | sort -u >"$tmp/gate"
    IFS=$_ifs
    set +f
    missed=$(comm -23 "$tmp/gate" "$tmp/covered")
    if [ -z "$missed" ]; then ok; else no "prettier globs for $ws" "the gate formats, check-fast skips: $missed"; fi
    grep "^$ws/" "$tmp/handed" | sort -u >"$tmp/ws-handed" || true
    extra=$(comm -13 "$tmp/gate" "$tmp/ws-handed")
    if [ -z "$extra" ]; then ok; else no "prettier globs for $ws" "check-fast formats, the gate does not: $extra"; fi
done

# --- against a real index -----------------------------------------------------

repo=$(mkdir -p "$tmp/repo" && CDPATH='' cd -P -- "$tmp/repo" && pwd)
cd "$repo"
git init -q -b main "$repo"

# Pin every git command below to the fixture, and prove it before writing
# anything, exactly as test-commit-messages.sh does and for the same reason.
GIT_DIR="$repo/.git"
GIT_WORK_TREE="$repo"
export GIT_DIR GIT_WORK_TREE
_resolved=$(CDPATH='' cd -P -- "$(git rev-parse --show-toplevel)" && pwd)
if [ "$_resolved" != "$repo" ]; then
    echo "REFUSING TO RUN: git resolves to $_resolved, not the fixture $repo." >&2
    exit 1
fi
git config user.email "dev@example.com"
git config user.name "Dev"
git config commit.gpgsign false
git config core.hooksPath /dev/null

mkdir -p scripts docs frontend/src/lib
cp "$script" scripts/check-fast.sh
echo "# Guide" >docs/guide.md
echo "export const a = 1;" >frontend/src/lib/a.ts
echo "license" >LICENSE
# The recipes check-fast.sh runs through just on every commit, as stand-ins: the
# toolchain they need is not what this tests.
cat >Justfile <<'JUST'
_deps-match:
    @echo the install matches
cli:
    @echo the CLI is built
_check-docs:
    @echo the documents pass
JUST

# expect_run <want-exit> <label> <args> <text>...: each text must be in the
# output; one starting with ! must not be.
expect_run() {
    _want=$1 _label=$2 _args=$3
    shift 3
    _got=0
    # shellcheck disable=SC2086
    sh scripts/check-fast.sh $_args >"$tmp/out" 2>&1 || _got=$?
    _bad=
    if [ "$_got" != "$_want" ]; then _bad=" wanted exit $_want, got $_got;"; fi
    for _text in "$@"; do
        case $_text in
        !*) if grep -Fq -e "${_text#!}" "$tmp/out"; then _bad="$_bad has '${_text#!}';"; fi ;;
        *) if ! grep -Fq -e "$_text" "$tmp/out"; then _bad="$_bad lacks '$_text';"; fi ;;
        esac
    done
    if [ -z "$_bad" ]; then
        ok
    else
        no "$_label" "$_bad"
        sed 's/^/      /' "$tmp/out"
    fi
}

reset_fixture() {
    git reset -q --hard HEAD
    git clean -q -fd
}

refused="not what this commit holds"

# Before the first commit there is no HEAD to compare against.
git add docs/guide.md
expect_run 0 "an unborn branch" --plan "$(printf 'docs\tdocs/guide.md')"
git add -A
git commit -q -m "feat: the base"

expect_run 0 "nothing staged" --plan "nothing is staged"
expect_run 0 "nothing staged, run" "" "nothing is staged"

echo "More." >>docs/guide.md
git add docs/guide.md
expect_run 0 "a staged document" --plan "$(printf 'docs\tdocs/guide.md')" "$(printf 'vitest:repo\tdocs/guide.md')"

echo "Unstaged." >>docs/guide.md
expect_run 1 "a staged file with unstaged changes" --plan "$refused" "    docs/guide.md"
expect_run 1 "a staged file with unstaged changes, run" "" "$refused"
reset_fixture

echo "export const b = 2;" >frontend/src/lib/a.ts
git add frontend/src/lib/a.ts
rm frontend/src/lib/a.ts
expect_run 1 "a staged file deleted from disk" --plan "$refused" "    frontend/src/lib/a.ts"
reset_fixture

# The document check reads the length of any file a `#L` anchor points into, so
# no staged path is exempt.
echo "more" >>LICENSE
git add LICENSE
echo "and more" >>LICENSE
expect_run 1 "an unstaged change to a file only a link reads" --plan "$refused" "    LICENSE"
reset_fixture

git rm -q frontend/src/lib/a.ts
expect_run 0 "a staged deletion" --plan "$(printf 'vitest:all\tfrontend/src/lib/a.ts')" "$(printf 'docs\tfrontend/src/lib/a.ts')"
reset_fixture

# git diff lists no untracked file, so this is the one way to stage a path that
# is not on disk as staged without git diff noticing.
git rm -q --cached frontend/src/lib/a.ts
expect_run 1 "a staged deletion kept on disk" --plan "$refused" "    frontend/src/lib/a.ts" "--include-untracked"
expect_run 1 "a staged deletion kept on disk, run" "" "$refused" "!checks for"
reset_fixture

git mv docs/guide.md docs/manual.md
expect_run 0 "a staged rename" --plan "$(printf 'docs\tdocs/guide.md')" "$(printf 'docs\tdocs/manual.md')"
reset_fixture

printf '# Spaced\n' >"docs/a b.md"
git add "docs/a b.md"
expect_run 0 "a name with a space" --plan "$(printf 'docs\tdocs/a b.md')"
reset_fixture

# `git commit <path>` hands the hook a temporary index, through GIT_INDEX_FILE.
# That index is the commit, whatever the real one holds.
GIT_INDEX_FILE="$tmp/other-index" git read-tree HEAD
echo "Elsewhere." >>docs/guide.md
GIT_INDEX_FILE="$tmp/other-index" git add docs/guide.md
_got=0
GIT_INDEX_FILE="$tmp/other-index" sh scripts/check-fast.sh --plan >"$tmp/out" 2>&1 || _got=$?
if [ "$_got" = 0 ] && grep -Fq "$(printf 'docs\tdocs/guide.md')" "$tmp/out"; then
    ok
else
    no "a temporary index" "wanted docs/guide.md from GIT_INDEX_FILE, got exit $_got: $(cat "$tmp/out")"
fi
expect_run 0 "the real index, meanwhile" --plan "nothing is staged"
reset_fixture

# Running, as opposed to planning, with the stand-in recipes.
echo "more" >>LICENSE
git add LICENSE
expect_run 0 "run: a path only the document check reads" "" \
    "1 check for 1 staged path" "ok    docs" "all 1 passed" "!does not hold"
reset_fixture

printf 'echo the policy tests ran\nexit 0\n' >scripts/test-commit-messages.sh
git add scripts/test-commit-messages.sh
expect_run 0 "run: a passing check" "" "2 checks for 1 staged path" "ok    script:test-commit-messages" "all 2 passed" "just done"
reset_fixture

printf 'echo the policy tests broke\nexit 3\n' >scripts/test-commit-messages.sh
git add scripts/test-commit-messages.sh
expect_run 1 "run: a failing check" "" "FAIL  script:test-commit-messages" "the policy tests broke" "1 of 2 checks failed"
reset_fixture

# What nobody staged is still read, so it is named, though it is not refused.
echo "export const c = 3;" >frontend/src/lib/unadded.ts
echo "More." >>docs/guide.md
echo "more" >>LICENSE
git add LICENSE
expect_run 0 "run: files the commit does not hold" "" "does not hold these" \
    "    docs/guide.md" "    frontend/src/lib/unadded.ts" "!    LICENSE" "--include-untracked" "all 1 passed"
reset_fixture

# An interrupted commit stops its checks, and what they started, and leaves
# nothing behind. A background job here starts with SIGINT ignored, exactly as
# check-fast.sh's own jobs do, so this sends TERM, which it handles the same way.
alive() {
    _stat=$(ps -o stat= -p "$1" 2>/dev/null) || return 1
    case $_stat in '' | Z*) return 1 ;; esac
}
mkdir "$tmp/tmpdir"
printf 'sleep 30 &\necho $! >"%s"\nwait\n' "$tmp/sleeper" >scripts/test-commit-messages.sh
git add scripts/test-commit-messages.sh
TMPDIR="$tmp/tmpdir" sh scripts/check-fast.sh >"$tmp/out" 2>&1 &
_cf=$!
_i=0
while [ ! -s "$tmp/sleeper" ] && [ "$_i" -lt 200 ]; do
    sleep 0.05
    _i=$((_i + 1))
done
kill -TERM "$_cf"
_got=0
wait "$_cf" || _got=$?
_sleeper=$(cat "$tmp/sleeper" 2>/dev/null || echo)
_i=0
while [ -n "$_sleeper" ] && alive "$_sleeper" && [ "$_i" -lt 100 ]; do
    sleep 0.05
    _i=$((_i + 1))
done
_bad=
if [ -z "$_sleeper" ]; then _bad=" the check never started;"; fi
if [ "$_got" != 143 ]; then _bad="$_bad wanted exit 143, got $_got;"; fi
if [ -n "$_sleeper" ] && alive "$_sleeper"; then
    _bad="$_bad a check's own child outlived it;"
    kill "$_sleeper" 2>/dev/null || true
fi
if [ -n "$(ls -A "$tmp/tmpdir")" ]; then _bad="$_bad left $(ls -A "$tmp/tmpdir") behind;"; fi
if [ -z "$_bad" ]; then ok; else no "an interrupted run" "$_bad $(cat "$tmp/out")"; fi
reset_fixture

if [ "$fail" -ne 0 ]; then
    echo "check-fast: $pass passed, $fail FAILED"
    exit 1
fi
echo "check-fast: $pass passed"
