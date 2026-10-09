import { GIT_LOCATION_ENV } from "../src/core/gitIgnore.js";

// A commit made in a linked worktree runs the pre-commit hook, and so these
// tests, with GIT_DIR naming that worktree's directory under the clone's
// shared .git. A test's own `git init` that inherits it re-initializes that
// directory and sets core.bare = true in the shared config, which leaves every
// checkout of the clone unusable. Two tests did that before each was fixed on
// its own, so no test inherits a repository's location at all: every git a
// test starts finds its repository from its own directory.
for (const name of GIT_LOCATION_ENV) delete process.env[name];
