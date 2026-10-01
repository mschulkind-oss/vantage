---
title: "Defects found verifying seven references, and the runs they still owe"
date: 2026-10-01
status: accepted
stage: DECIDED
next: "Pick a defect, write the failing test that reproduces it, then fix it and rewrite the reference section that describes it"
tags: [defects, vantage-check, server, viewer, releases, measurement]
summary: "Verifying seven designs against the code, to graduate them into references, found thirteen places where the code breaks a rule its own reference states, and three runs nobody has made. The references describe that behavior as it is; this document owns fixing it and making the runs."
---

# Defects found verifying seven references, and the runs they still owe

**Status:** 2026-10-01, written when seven designs graduated into references:
[`agent-cli.md`](../reference/agent-cli.md),
[`check-performance.md`](../reference/check-performance.md),
[`contents-open-questions.md`](../reference/contents-open-questions.md),
[`linked-references.md`](../reference/linked-references.md),
[`pypi-distribution.md`](../reference/pypi-distribution.md),
[`repo-config.md`](../reference/repo-config.md) and
[`serve-clones-directory.md`](../reference/serve-clones-directory.md). Each
reference describes the behavior below as the code at `7fa8cbf` has it, in its
*Known gaps* section, and links here. This document owns only the fixes and the
runs: what is wrong, the rule it breaks, and what proves it fixed.

A **defect** here is behavior that breaks a rule the reference itself states (an
invariant, a principle or a ruling in its *Why it's this way* table), so the
target behavior is already decided, and only the code is owed. Where a fix would
change one of those rules instead, it is not a fix: write it up as a design
question for the human.

## How each is done

1. **A failing test first.** Write the test that reproduces the defect, watch it
   fail, then fix the code. Each entry below says what the test has to show.
2. **The reference changes in the same commit.** The section that describes the
   behavior is rewritten to describe the fixed behavior, its *Known gaps* entry
   goes, and the reference is re-verified and stamped.
3. **The entry here goes in the same commit.** When the last one goes, this
   document is retired with a `done` stage.

---

## The checker

1. **The checker and the viewer run different KaTeX copies.** `katex/parse`
   checks formulas with the workspace's hoisted `katex`, and the viewer renders
   them through `rehype-katex`, which resolves an older copy nested under it.
   `$$a \mapsfrom b$$` checks clean and renders as red error text. It breaks the
   rule that the checker validates with the engines the viewer renders with
   ([`agent-cli.md` §1.2](../reference/agent-cli.md#12-invariants)). Fixed when
   `packages/vantage-check/test/deps.test.ts` also resolves `katex` from
   `rehype-katex`'s own location and finds the same file, and the check and the
   page agree about that formula. Described in
   [`agent-cli.md` §11](../reference/agent-cli.md#11-known-gaps).
2. **The checker slugs a heading the page does not.** `rehype-slug` skips a
   heading that already carries a question anchor and does not count it toward
   the `-1`, `-2` suffixes; the checker's heading pass slugs it anyway. So after
   a question written as a heading, every later repeated heading's slug is one
   off from the page's, a link to the slug the page lacks passes, and
   `ref/unlinked-section` resolves a numbered question heading to a slug the page
   does not have. It breaks the invariant that the checker's anchors are the
   page's ([`linked-references.md`](../reference/linked-references.md#invariants)).
   Fixed when a document with a question heading `## Foo` and a second `## Foo`
   gives the checker the page's slugs, `#foo` for the second. Described in
   [`agent-cli.md` §11](../reference/agent-cli.md#11-known-gaps) and
   [`linked-references.md`](../reference/linked-references.md#known-gaps).
3. **The checker accepts question anchors the page does not carry.** It counts
   every well-formed id a question directive declares, so
   `link/dead-section-anchor` passes a `#OQ-…` fragment that goes nowhere in four
   cases: the directive's target cannot carry a question (a list rather than a
   list item); the target is a raw-HTML element with its own `id`; the target is
   a `$$` display-math block; and a directive run declares two different ids, of
   which the page keeps only the last. Same invariant as the previous entry.
   Fixed when the checker resolves the id per directive run, last value across
   the run, and counts it only when the run lands on a block that can carry the
   anchor, has no `id` of its own and is not display math, with a test for each
   of the four. Described in
   [`linked-references.md`](../reference/linked-references.md#known-gaps).
4. **A malformed percent escape ends a check.** `ref/unlinked-section` and
   `ref/unlinked-file` percent-decode a link's path with no guard, so a link
   whose path holds a malformed escape, such as `bad%zz.md`, makes the rule
   throw: a one-thread run prints an internal error and no report, and a
   parallel run loses that file's whole shard as a
   `run/shard` failure. Both exit `3`, where the `link/*` rules report the same
   link as `link/missing-target`. A broken link is a statement about the
   document, so it breaks the invariant that a finding is about the document and
   a failure about the run ([`agent-cli.md` §1.2](../reference/agent-cli.md#12-invariants));
   what the throw costs each kind of run is
   [`check-performance.md` §5.6](../reference/check-performance.md#56-a-shard-that-never-answers)'s.
   Fixed when that link gets the `link/*` rules' answer and the run checks every
   other file. Described in
   [`linked-references.md`](../reference/linked-references.md#known-gaps).
5. **A query string makes a correct filename link "a different file".**
   `ref/unlinked-file` strips a link's fragment and not its query, so
   ``[`f.md`](f.md?plain=1)`` is reported, while the `link/*` rules strip both and
   accept it. Fixed when the two strip the same parts. Described in
   [`linked-references.md`](../reference/linked-references.md#known-gaps).
6. **A reference-style link counts as bare.** The `ref/*` rules recognize inline
   links and autolinks only, so `[OQ-N][q]`, `[§N][s]` and ``[`f.md`][f]`` are
   each reported as an unlinked reference, although the `link/*` rules resolve
   the same definitions. It breaks P1 of
   [`linked-references.md`](../reference/linked-references.md#principles): the
   reference is a link. Fixed when each of the three, written reference-style,
   passes.
7. **A dead § fragment is reported twice.** A § link whose fragment resolves
   nowhere, to a target whose numbered headings carry that number, is reported
   by `link/dead-section-anchor` and by `ref/unlinked-section`. It breaks the
   invariant of one finding per defect
   ([`linked-references.md`](../reference/linked-references.md#invariants)).
   Fixed when `ref/unlinked-section` leaves a fragment that resolves nowhere to
   `link/dead-section-anchor`. Described in
   [`linked-references.md`](../reference/linked-references.md#known-gaps).

## The viewer

8. **A static export's tally promises a click it cannot take.** The contents
   column's tally says how many questions *can be answered in one click* in a
   static export too, which has no review mode and no button. It breaks the
   invariant that the tally never promises a button the document does not have
   ([`contents-open-questions.md` §1.1](../reference/contents-open-questions.md#11-invariants)).
   Fixed when the export's tally counts no one-click answer, and a test renders
   the tally in static mode. Described in
   [`contents-open-questions.md` §8](../reference/contents-open-questions.md#8-known-gaps).

## The server

9. **The guarded config read follows a symlink swapped in after its stat.** The
   server `Lstat`s `.vantage.toml`, opens it, and re-checks the type through the
   handle. The open follows a symlink, and the re-check refuses only what is not
   a regular file, so a symlink to a regular file put in place between the two
   calls is read. [`OQ-RC6`](../reference/repo-config.md#why-its-this-way) ruled
   that the read never follows a symlink. Fixed when the handle is proved to be
   the file the `Lstat` saw, with a test that swaps the file between the two.
   Described in
   [`repo-config.md` §8](../reference/repo-config.md#8-known-gaps).
10. **A clone made later can mean a different project in `serve` than in the
    daemon.** `serve` holds the loose project's name in the list its rescan
    names new clones against, so a clone created after startup whose name is the
    loose project's is served as `code-2` where a daemon serving that directory
    serves it as `code`. [`D1`](../reference/serve-clones-directory.md#why-its-this-way)
    requires that a link to a clone mean the same project in both modes. Fixed
    when such a clone gets the daemon's name, without renaming the loose
    project while it is served, since links to the loose project would break.
    Described in
    [`serve-clones-directory.md` §10](../reference/serve-clones-directory.md#10-known-gaps).
11. **The server's help names a command most channels do not install.** The root
    command is named `vantage-md`, so `vantage --help` prints `vantage-md
    [command]` in its usage lines and `vantage completion` writes completions for
    `vantage-md`. Homebrew and `go install` install only `vantage`, which every
    channel installs
    ([`pypi-distribution.md` §6.2](../reference/pypi-distribution.md#62-vantage-is-the-command-vantage-md-is-an-alias)).
    Fixed when the usage, the help and the completion script name `vantage`. The
    `--version` line, `vantage-md, version <version>`, is pinned by a test in
    `cmd/vantage` and by the Homebrew formula's test, so it changes only together
    with both. Described in
    [`pypi-distribution.md` §9](../reference/pypi-distribution.md#9-known-gaps).

## The release

12. **macOS wheels claim a lower macOS than their binaries run on.** Both
    programs' macOS wheels are tagged `macosx_11_0`, and the published 0.7.1
    binaries declare macOS 12.0 (the server) and 13.0 (the CLI) as their minimum,
    so `uvx` installs them on Macs the binaries do not support. Fixed when no
    wheel's tag is lower than the minimum its binary declares, and something in
    the release checks that, since the minimum moves with the Go and bun
    pins. Described in
    [`pypi-distribution.md` §6.3](../reference/pypi-distribution.md#63-platforms)
    and [§9](../reference/pypi-distribution.md#9-known-gaps).
13. **`publish.yml`'s refusal messages say to re-cut the same version.** A pushed
    tag is never moved or reused, because anything that fetched it pinned its
    tree ([`pypi-distribution.md` §4.1](../reference/pypi-distribution.md#41-cutting-the-tag)).
    Fixed when both refusals say to delete the tag and cut the next patch version
    with `just release`. Described in
    [`pypi-distribution.md` §9](../reference/pypi-distribution.md#9-known-gaps).

---

## Runs nobody has made

These are not defects: the references mark them `UNMEASURED:`, and the code may
be right. Each is owed a run, recorded in its reference's Status line with the
date and the commit run.

- **The wheels CI never runs.** Only the Linux x86-64 wheels are installed and
  run before they ship. The Linux arm64 and macOS wheels of both programs, and
  the server's `musllinux` wheel under musl, have never been run
  ([`pypi-distribution.md`](../reference/pypi-distribution.md), Status). Each is
  owed an install into a fresh environment on its platform, then both
  `--version` and one real command.
- **The background service, for real.** No test starts a real `systemctl` or
  `launchctl`, so `install-service --source-dir` is owed one run against a real
  systemd user manager and one against a real launchd
  ([`serve-clones-directory.md` §6.2](../reference/serve-clones-directory.md#62-installing-and-starting-the-service)).
- **The kernel's own limits.** The banner's degradations are tested by
  configuring Vantage's limits down. Each is owed a run against the kernel's
  limit, lowered for the run (`sysctl` for inotify, `ulimit -n` for kqueue)
  rather than reached with a large tree, and the comparison
  [`serve-clones-directory.md` §9.1](../reference/serve-clones-directory.md#91-what-one-project-still-does)
  names: how often one project over a directory of clones reaches the watch
  limit, against the same clones served as separate projects.

## What a result changes

- **A fix lands:** its entry here goes, and its reference describes the fixed
  behavior and is stamped again, in the same commit.
- **A run passes:** the reference's `UNMEASURED:` clause for it becomes a
  `MEASURED:` one, with the date and the commit.
- **A run fails:** that is a defect. Add it above, and to the reference's
  *Known gaps*.
