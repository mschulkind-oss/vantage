#!/bin/sh
# Reject AI attribution trailers, generation footers, AI author emails, and
# non-conventional commit subjects.
#
# Source of truth for the policy:
# https://github.com/mschulkind/backplane/blob/main/docs/standards/commit-attribution.md
# and agent-standards.md in the same directory.
#
# THREE CALLERS, ONE COPY OF THE PATTERNS. The commit-msg hook checks one message
# before the commit exists; the pre-push hook checks a range; CI's `commits` job
# checks the range a pull request contributes. The patterns were duplicated
# between the two hooks and had already drifted — `powered by …` was rejected at
# commit time and allowed at push time, and the conventional-subject rule existed
# only in commit-msg. Worse, both live in `core.hooksPath`, which is per-clone
# local config: a fork that never ran `just setup` has no hooks, so nothing
# anywhere looked at a contributed commit until this ran in CI.
#
# Usage:
#   check-commit-messages.sh --message <file>       one message, no commit yet
#   check-commit-messages.sh <rev-list arguments>   every commit they select
#
# The second form passes its arguments straight to `git rev-list`, so it takes a
# range (`base..head`, what CI has) and a set-difference alike (`HEAD --not
# --remotes`, what a first push of a new branch has) without either caller
# reshaping one into the other.
#
# Exit 0 when clean, 1 on a violation, 2 when the revisions cannot be read.

set -eu

ai_coauthor='^[[:space:]]*Co-authored-by:[[:space:]]*(Copilot|Claude|Gemini|ChatGPT|GPT-|Codex|Cursor|Windsurf|Devin|aider|Bard|Llama)'
ai_noreply='^[[:space:]]*Co-authored-by:.*<[^>]*(anthropic\.com|openai\.com|users\.noreply\.github\.com.*Copilot)'
ai_footer='(Generated (with|by) (\[?Claude|Copilot|Cursor|aider)|Co-generated with|powered by (Claude|GPT|Copilot))'
ai_author_email='(copilot@|noreply@anthropic\.com|Copilot@users\.noreply\.github\.com)'
subject_re='^(feat|fix|docs|chore|refactor|test|perf|ci|build|style|revert)(\([^)]+\))?!?:[[:space:]]'

fail=0

# A human co-author is fine and is the point of the trailer — only the AI names
# and the provider noreply domains above are refused.
check_attribution() {
    _text=$1
    _label=$2
    if printf '%s\n' "$_text" | grep -Eqi "$ai_coauthor" \
    || printf '%s\n' "$_text" | grep -Eqi "$ai_noreply" \
    || printf '%s\n' "$_text" | grep -Eqi "$ai_footer"; then
        echo "$_label: AI attribution is forbidden in this repo."
        fail=1
    fi
}

# The first line that is neither blank nor a comment. `git commit` passes the
# template through, so the comment filter is what keeps its help text out.
subject_of() {
    grep -v '^#' | sed '/^[[:space:]]*$/d' | head -1
}

check_subject() {
    _subject=$1
    _label=$2
    if ! printf '%s\n' "$_subject" | grep -Eq "$subject_re"; then
        echo "$_label: first line must use conventional commits."
        echo "  Got:    $_subject"
        echo "  Expect: feat|fix|docs|chore|refactor|test|perf|ci|build|style|revert: <summary>"
        fail=1
    fi
}

if [ "${1:-}" = "--message" ]; then
    [ -n "${2:-}" ] || { echo "usage: $0 --message <file>" >&2; exit 2; }
    [ -r "$2" ] || { echo "$0: cannot read $2" >&2; exit 2; }
    message=$(cat "$2")
    check_attribution "$message" "commit-msg"
    check_subject "$(subject_of <"$2")" "commit-msg"
    exit "$fail"
fi

[ "$#" -gt 0 ] || { echo "usage: $0 <rev-list arguments> | --message <file>" >&2; exit 2; }

revs=$(git rev-list "$@" 2>/dev/null) || {
    echo "$0: cannot read revisions '$*'" >&2
    exit 2
}

for sha in $revs; do
    short=$(git rev-parse --short "$sha")
    check_attribution "$(git log -1 --format=%B "$sha")" "$short"

    email=$(git log -1 --format=%ae "$sha")
    if printf '%s\n' "$email" | grep -Eqi "$ai_author_email"; then
        echo "$short: AI author email: $email"
        fail=1
    fi

    # Merge commits are exempt from the subject rule: git and GitHub compose
    # those messages ("Merge pull request #3 from …"), and this repo's own main
    # carries them from dependabot merges — so enforcing it here would fail a
    # push that did nothing wrong.
    if [ "$(git log -1 --format=%p "$sha" | wc -w)" -le 1 ]; then
        check_subject "$(git log -1 --format=%B "$sha" | subject_of)" "$short"
    fi
done

if [ "$fail" -ne 0 ]; then
    echo ""
    echo "Rewrite the offending commits (git rebase -i, or amend) before merging."
fi
exit "$fail"
