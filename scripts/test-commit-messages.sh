#!/bin/sh
# Tests for check-commit-messages.sh. Run by `just check-ci`.
#
# The range cases build a throwaway repository rather than mocking git: the
# script's whole job is to read commits, and the two cases most likely to break
# it — a merge commit, and an author email — do not exist at all until there is
# real history to read.

set -eu

# This runs inside `just check-ci`, which the pre-commit hook runs — so git's own
# environment is set and points at the repository being committed to. Every
# variable of it has to go before the throwaway repo below is touched, or
# `git init`/`git add`/`git commit` operate on the outer repo's index instead of
# the temp one, and the range cases assert against the wrong history.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
    GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_PREFIX GIT_COMMON_DIR \
    GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_AUTHOR_DATE \
    GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_COMMITTER_DATE \
    GIT_EDITOR GIT_INDEX_VERSION GIT_REFLOG_ACTION 2>/dev/null || true

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
script="$here/check-commit-messages.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

pass=0
fail=0

# expect_message <expected-exit> <label> <message text>
expect_message() {
    _want=$1
    _label=$2
    printf '%s\n' "$3" >"$tmp/msg"
    _got=0
    "$script" --message "$tmp/msg" >"$tmp/out" 2>&1 || _got=$?
    if [ "$_got" = "$_want" ]; then
        pass=$((pass + 1))
    else
        fail=$((fail + 1))
        echo "FAIL [$_label]: wanted exit $_want, got $_got"
        sed 's/^/      /' "$tmp/out"
    fi
}

# expect_range <expected-exit> <label> <range>
expect_range() {
    _want=$1
    _label=$2
    _got=0
    "$script" "$3" >"$tmp/out" 2>&1 || _got=$?
    if [ "$_got" = "$_want" ]; then
        pass=$((pass + 1))
    else
        fail=$((fail + 1))
        echo "FAIL [$_label]: wanted exit $_want, got $_got"
        sed 's/^/      /' "$tmp/out"
    fi
}

# --- one message at a time ---------------------------------------------------

expect_message 0 "conventional subject" "feat(viewer): add a thing"
expect_message 0 "scopeless" "docs: explain a thing"
expect_message 0 "breaking marker" "feat(api)!: change a thing"
expect_message 1 "no type" "add a thing"
expect_message 1 "unknown type" "wip(viewer): add a thing"
expect_message 1 "missing space" "feat(viewer):add a thing"

# The commit template's comment lines must not be read as the subject.
expect_message 0 "comment lines skipped" "$(printf '# on branch main\nfeat: real subject')"

expect_message 1 "claude trailer" "$(printf 'feat: a thing\n\nCo-Authored-By: Claude <noreply@anthropic.com>')"
expect_message 1 "copilot trailer" "$(printf 'feat: a thing\n\nCo-authored-by: Copilot <x@y.z>')"
expect_message 1 "anthropic email only" "$(printf 'feat: a thing\n\nCo-authored-by: Someone <bot@anthropic.com>')"
expect_message 1 "generated footer" "$(printf 'feat: a thing\n\nGenerated with [Claude Code](https://claude.com)')"
expect_message 1 "powered by footer" "$(printf 'feat: a thing\n\npowered by Claude')"

# The case this repo actually relies on: crediting a human contributor is the
# point of the trailer, and must keep working.
expect_message 0 "human co-author allowed" "$(printf 'feat: a thing\n\nCo-Authored-By: Eduardo <edus44@users.noreply.github.com>')"

expect_message 1 "empty message" ""

_got=0
"$script" --message "$tmp/does-not-exist" >/dev/null 2>&1 || _got=$?
if [ "$_got" = 2 ]; then
    pass=$((pass + 1))
else
    fail=$((fail + 1))
    echo "FAIL [unreadable file]: wanted exit 2, got $_got"
fi

# --- ranges ------------------------------------------------------------------

repo=$(mkdir -p "$tmp/repo" && CDPATH= cd -P -- "$tmp/repo" && pwd)
cd "$repo"
git init -q -b main "$repo"

# Pin every git command below to the fixture, then PROVE it before writing
# anything. This is not defensive dressing: the first version of this file had
# only the `unset` above, and when it ran with git's environment inherited it
# committed its fixtures onto the real repository's `main` and left HEAD on a
# branch it had created. An assertion here is what turns that into a loud
# failure instead of six junk commits in someone's history.
GIT_DIR="$repo/.git"
GIT_WORK_TREE="$repo"
export GIT_DIR GIT_WORK_TREE

_resolved=$(CDPATH= cd -P -- "$(git rev-parse --show-toplevel)" && pwd)
if [ "$_resolved" != "$repo" ]; then
    echo "REFUSING TO RUN: git resolves to $_resolved, not the fixture $repo." >&2
    echo "Something in the environment is redirecting git at another repository." >&2
    exit 1
fi
git config user.email "dev@example.com"
git config user.name "Dev"
git config commit.gpgsign false
# The outer clone sets core.hooksPath in its *local* config, which this repo does
# not inherit — but an installation that set it globally would fire this repo's
# own commit-msg hook on the deliberately-tainted commits below, and the test
# would fail on the thing it is trying to create.
git config core.hooksPath /dev/null

echo one >a
git add a
git commit -q -m "feat: the base"
base=$(git rev-parse HEAD)

echo two >a
git commit -q -am "fix: a clean commit"
clean=$(git rev-parse HEAD)

expect_range 0 "clean range" "$base..$clean"
expect_range 0 "empty range" "$clean..$clean"
expect_range 2 "bad range" "nope..$clean"

# The pre-push hook's first-push form: rev-list arguments, not a range. It must
# reach the script intact, since there is no single commit to anchor a range to.
_got=0
"$script" "$clean" --not "$base" >"$tmp/out" 2>&1 || _got=$?
if [ "$_got" = 0 ]; then
    pass=$((pass + 1))
else
    fail=$((fail + 1))
    echo "FAIL [rev-list arguments]: wanted exit 0, got $_got"
    sed 's/^/      /' "$tmp/out"
fi

echo three >a
git commit -q -am "$(printf 'fix: a tainted commit\n\nCo-Authored-By: Claude <noreply@anthropic.com>')"
tainted=$(git rev-parse HEAD)
expect_range 1 "trailer in range" "$clean..$tainted"
expect_range 0 "earlier commits unaffected" "$base..$clean"

# An AI author email with a blameless message — the pre-push hook's own case.
echo four >a
git -c user.email="copilot@users.noreply.github.com" commit -q -am "fix: authored by a bot"
expect_range 1 "ai author email" "$tainted..$(git rev-parse HEAD)"

# A merge commit, whose subject git composes and the rule must not police.
git checkout -q -b side "$clean"
echo side >b
git add b
git commit -q -m "feat: side work"
git checkout -q main
git merge -q --no-ff -m "Merge branch 'side' into main" side
expect_range 1 "merge is exempt, its parents are not" "$clean..HEAD"

git checkout -q -b clean-merge "$clean"
echo c >c
git add c
git commit -q -m "feat: mergeable work"
git checkout -q -b merge-host "$clean"
git merge -q --no-ff -m "Merge branch 'clean-merge'" clean-merge
expect_range 0 "merge subject is not a violation" "$clean..HEAD"

# --- result ------------------------------------------------------------------

cd "$here"
echo ""
if [ "$fail" -ne 0 ]; then
    echo "check-commit-messages: $pass passed, $fail FAILED"
    exit 1
fi
echo "check-commit-messages: $pass passed"
