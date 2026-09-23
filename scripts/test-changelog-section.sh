#!/bin/sh
# Tests for changelog-section.sh. Run by `just check-ci`, exactly like
# test-commit-messages.sh — the script is a release gate that two callers share,
# so its rules have to be pinned somewhere a change to them shows up as a diff.
#
# Every case builds a whole fixture changelog rather than editing the real one:
# the interesting failures are about which section a heading belongs to, and that
# needs neighbors on both sides to be worth asserting. The last case runs
# against the repository's own CHANGELOG.md, which is what proves the default
# path and today's file shape still work.

set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
script="$here/changelog-section.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

pass=0
fail=0

# The preamble is the real file's, so a fixture differs from CHANGELOG.md only in
# the part under test.
changelog() {
    {
        echo "# Changelog"
        echo ""
        echo "All notable changes to Vantage will be documented in this file."
        echo ""
        cat
    } >"$tmp/CHANGELOG.md"
}

# expect <want-exit> <label> <version>
expect() {
    _want=$1
    _label=$2
    _version=$3
    _got=0
    "$script" "$_version" "$tmp/CHANGELOG.md" >"$tmp/out" 2>"$tmp/err" || _got=$?
    if [ "$_got" = "$_want" ]; then
        pass=$((pass + 1))
    else
        fail=$((fail + 1))
        echo "FAIL [$_label]: wanted exit $_want, got $_got"
        sed 's/^/      /' "$tmp/err"
    fi
}

# expect_says <text> <label> — the reason must name what is wrong, on stderr,
# because stdout is the payload the callers redirect.
expect_says() {
    if grep -qiF "$1" "$tmp/err"; then
        pass=$((pass + 1))
    else
        fail=$((fail + 1))
        echo "FAIL [$2]: the failure never mentioned '$1'"
        sed 's/^/      /' "$tmp/err"
    fi
}

# expect_body <label> — stdout must equal $tmp/want, byte for byte.
expect_body() {
    if diff -u "$tmp/want" "$tmp/out" >"$tmp/diff"; then
        pass=$((pass + 1))
    else
        fail=$((fail + 1))
        echo "FAIL [$1]: extracted body differs from what was written"
        sed 's/^/      /' "$tmp/diff"
    fi
}

# --- a good section, and only that section ------------------------------------

changelog <<'EOF'
## [0.7.0] - 2026-09-22

### Added

- Six themes, and a picker that names the one on the page.

## [0.6.0] - 2026-09-10

### Added

- A neighbor that must not leak into 0.7.0.

## [0.5.4] - 2026-09-01
EOF

cat >"$tmp/want" <<'EOF'
### Added

- Six themes, and a picker that names the one on the page.
EOF

expect 0 "good section" 0.7.0
expect_body "good section, nothing of the neighbors"

expect 0 "middle section" 0.6.0
cat >"$tmp/want" <<'EOF'
### Added

- A neighbor that must not leak into 0.7.0.
EOF
expect_body "a section bounded on both sides"

# The last section in the file ends at end of file, not at a heading.
expect 1 "trailing heading with no body" 0.5.4
expect_says "empty" "trailing heading with no body"

# --- byte-for-byte, no reflowing ---------------------------------------------

# Two-space hard breaks, an indented continuation, a table, a very long line and
# a fenced block whose comment looks like a heading. A release body that
# re-wrapped any of this would render differently from the file it came from —
# and the fence is the case that once truncated a section at `# rebuild`.
printf '%s\n' \
'## [0.8.0] - 2026-10-01' \
'' \
'### Changed' \
'' \
'- The picker names the palette on the page.  ' \
'  It reads the resolved theme, not the stored preference.' \
'' \
'  | palette | contrast |' \
'  | ------- | -------- |' \
'  | Slate   | 7.1:1    |' \
'' \
'This paragraph is deliberately far longer than any reasonable fill column, because a release body that has been re-wrapped by the tool that extracted it is no longer the text anybody reviewed.' \
'' \
'```sh' \
'# rebuild the bundle' \
'just web-sync' \
'```' \
'' \
'## [0.7.0] - 2026-09-22' \
'' \
'### Added' \
'' \
'- A neighbor.' \
    | changelog

sed -n '5,$p' "$tmp/CHANGELOG.md" | sed -n '/^### Changed/,/^```$/p' >"$tmp/want"
expect 0 "fenced comment does not end the section" 0.8.0
expect_body "byte-identical, including hard breaks and the fence"

# --- headings it accepts -----------------------------------------------------

changelog <<'EOF'
## [v0.7.0] — 2026-09-22

The em dash, the bracket and the `v` are all cosmetic; the version is not.
EOF
expect 0 "v prefix and em dash" 0.7.0
expect 0 "a v on the argument too" v0.7.0

changelog <<'EOF'
## 0.7.0

No brackets and no date, which Keep a Changelog does not require.
EOF
expect 0 "bare version heading" 0.7.0

changelog <<'EOF'
##  [0.7.0]  - 2026-09-22

Extra spaces around the heading are cosmetic as well.
EOF
expect 0 "loose spacing" 0.7.0

# `###` is the subsection level inside a section, so it cannot also be a version
# heading — accepting both would make "where does this section end" ambiguous.
changelog <<'EOF'
### [0.7.0] - 2026-09-22

Written one level too deep.
EOF
expect 1 "level three is not a version heading" 0.7.0

# --- the version matches whole ----------------------------------------------

changelog <<'EOF'
## [0.7.0-rc1] - 2026-09-20

A release candidate, which is not the release.

## [0.17.0] - 2026-09-18

A later minor whose number contains no substring of 0.7.0 either way round.
EOF
expect 1 "0.7.0 does not match 0.7.0-rc1 or 0.17.0" 0.7.0
expect 0 "the rc can be asked for by its full version" 0.7.0-rc1
expect 0 "and so can the later minor" 0.17.0

changelog <<'EOF'
## [10.7.0] - 2026-09-18

A major version that ends with the version being asked for.
EOF
expect 1 "0.7.0 does not match 10.7.0" 0.7.0

# --- absent, empty, placeholder ---------------------------------------------

changelog <<'EOF'
## [0.6.0] - 2026-09-10

### Added

- Something real, for a version nobody asked about.
EOF
expect 1 "missing version" 0.7.0
expect_says "no section for 0.7.0" "missing version"

changelog <<'EOF'
## [0.7.0] - 2026-09-22

## [0.6.0] - 2026-09-10

- Something real.
EOF
expect 1 "empty section" 0.7.0
expect_says "empty" "empty section"

# Headings with nothing under them are as empty as nothing at all, and saying so
# is more useful than handing GitHub three bare subheadings.
changelog <<'EOF'
## [0.7.0] - 2026-09-22

### Added

### Fixed
EOF
expect 1 "headings but no content" 0.7.0
expect_says "no content" "headings but no content"

for stub in "TBD" "- TODO" "_Coming soon._" "- Nothing yet" "..."; do
    changelog <<EOF
## [0.7.0] - 2026-09-22

### Added

$stub
EOF
    expect 1 "placeholder: $stub" 0.7.0
    expect_says "placeholder" "placeholder: $stub"
done

# The stub a maintainer leaves themselves, in a comment.
changelog <<'EOF'
## [0.7.0] - 2026-09-22

### Added

<!-- write this before tagging -->
EOF
expect 1 "placeholder in an HTML comment" 0.7.0

# One real line among the stubs is prose being written, not a placeholder. This
# is the boundary the check has to get right, or it fails an honest release.
changelog <<'EOF'
## [0.7.0] - 2026-09-22

### Added

- Six themes, and a picker that names the one on the page.
- TODO: the second half of this list
EOF
expect 0 "a stub beside real prose is not a placeholder section" 0.7.0

# --- the filler list --------------------------------------------------------
#
# One line per phrase changelog-section.sh refuses. A phrase added there without
# a line here is a rule nothing pins down.
for slop in \
    "Various improvements to the viewer." \
    "Various fixes." \
    "Miscellaneous fixes across the frontend." \
    "Misc. changes to the picker." \
    "Bug fixes and improvements." \
    "Bug fixes and other improvements." \
    "This release includes a new theme picker." \
    "The release brings a new theme picker." \
    "We're excited to ship six new palettes." \
    "We are pleased to announce the theme picker." \
    "Excited to announce six new palettes." \
    "Under the hood, preferences moved to one layer." \
    "Six new palettes and much more." \
    "Six new palettes and lots more." \
    "Six new palettes and more!" \
    "**Full Changelog**: https://github.com/mschulkind-oss/vantage/compare/v0.6.0...v0.7.0" \
    ; do
    changelog <<EOF
## [0.7.0] - 2026-09-22

### Added

- A theme picker that names the palette on the page.

$slop
EOF
    expect 1 "filler: $slop" 0.7.0
done

# The reason has to name the phrase that matched — a bare "rejected" teaches
# nothing, and the phrase is the whole lesson.
changelog <<'EOF'
## [0.7.0] - 2026-09-22

Various improvements to the viewer.
EOF
expect 1 "filler names itself" 0.7.0
expect_says "various improvements" "filler names itself"

# Words from the list used in honest sentences. A check that fires on these is
# worse than no check, so they are asserted to pass.
changelog <<'EOF'
## [0.7.0] - 2026-09-22

### Changed

- The theme picker reads the resolved palette rather than the stored preference,
  so the two tabs of a split window can no longer disagree about what is on the
  page. Various parts of the preference layer moved with it: `usePreference` is
  now the only writer, and the full changelog of that refactor is in
  docs/design/preferences.md.
- Contrast improved on Solarized Light, which sat under the 4.5:1 floor.
EOF
expect 0 "honest prose using words from the filler list" 0.7.0

# --- a dumped git log -------------------------------------------------------

changelog <<'EOF'
## [0.7.0] - 2026-09-22

- feat(viewer): the theme picker names what is on the page
- feat(viewer): one preference layer, and every preference follows the reader
- refactor(viewer): name the built-in look Slate
- feat(themes): ship Nord, Gruvbox, Solarized and Tokyo Night
EOF
expect 1 "commit subjects" 0.7.0
expect_says "commit subjects" "commit subjects"

# `--generate-notes`' own shape, which is the thing being replaced.
changelog <<'EOF'
## [0.7.0] - 2026-09-22

* fix: stop the picker flashing by @someone in #12
* chore(deps): bump vite by @dependabot in #13
EOF
expect 1 "generated notes pasted in" 0.7.0

# A single bullet that is a commit subject is still a commit subject.
changelog <<'EOF'
## [0.7.0] - 2026-09-22

- feat(viewer): the theme picker names what is on the page
EOF
expect 1 "one commit subject, alone" 0.7.0

# Bullets alone are a shape this repo's changelog has used, so the rule is about
# commit subjects, not bullets.
changelog <<'EOF'
## [0.7.0] - 2026-09-22

### Fixed

- `just build` now works after `git pull` without needing `just setup`.
- `just setup` no longer modifies lockfiles.
EOF
expect 0 "hand-written bullets only" 0.7.0

# And one bullet that happens to open like a commit subject does not make a
# hand-written list into a git log.
changelog <<'EOF'
## [0.7.0] - 2026-09-22

### Fixed

- The picker no longer flashes on first paint.
- Solarized Light now clears the contrast floor.
- fix: the stored preference is migrated, not dropped.
- Tokyo Night's code background matches its prose background.
EOF
expect 0 "one commit-shaped bullet in a majority of prose" 0.7.0

# --- usage errors are not policy failures ------------------------------------

_got=0
"$script" >/dev/null 2>&1 || _got=$?
if [ "$_got" = 2 ]; then
    pass=$((pass + 1))
else
    fail=$((fail + 1))
    echo "FAIL [no arguments]: wanted exit 2, got $_got"
fi

_got=0
"$script" 0.7.0 "$tmp/does-not-exist" >/dev/null 2>&1 || _got=$?
if [ "$_got" = 2 ]; then
    pass=$((pass + 1))
else
    fail=$((fail + 1))
    echo "FAIL [unreadable file]: wanted exit 2, got $_got"
fi

# --- the real file, through the default path ---------------------------------

# No file argument: the default is the changelog beside the repository root,
# which is what both callers rely on — `just release` runs from the repo root and
# publish.yml from a checkout of the tag, and neither passes a path. 0.7.0 is the
# newest released version; this pointed at 0.3.1 until that section was folded
# into the 0.6.x-style series retrospectives. If 0.7.0 ever goes, point it at
# whatever the newest `## [<version>] - <date>` heading is by then.
_got=0
"$script" 0.7.0 >"$tmp/out" 2>"$tmp/err" || _got=$?
if [ "$_got" = 0 ] && [ -s "$tmp/out" ]; then
    pass=$((pass + 1))
else
    fail=$((fail + 1))
    echo "FAIL [real CHANGELOG.md via the default path]: exit $_got"
    sed 's/^/      /' "$tmp/err"
fi

# --- result ------------------------------------------------------------------

echo ""
if [ "$fail" -ne 0 ]; then
    echo "changelog-section: $pass passed, $fail FAILED"
    exit 1
fi
echo "changelog-section: $pass passed"
