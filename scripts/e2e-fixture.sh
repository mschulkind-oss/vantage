#!/bin/sh
# Builds the git repository the commit-info e2e spec serves.
#
# A nested .git cannot be committed, so it is created here, before the suite
# boots its servers: the server binds a repository's git root once, at
# startup, and a fixture repo created after that point would be invisible to
# it — the served directory would resolve to this repository's history
# instead, and the spec would see the wrong commits. Idempotent: a repo that
# is already there is left alone.
set -e

repo=frontend/e2e/fixtures/test_repo

if [ -d "$repo/.git" ]; then
  exit 0
fi

git -C "$repo" init -q
git -C "$repo" config user.email e2e@vantage.local
git -C "$repo" config user.name "Vantage e2e"
git -C "$repo" add page1.md
git -C "$repo" commit -qm "e2e: commit info fixture"
