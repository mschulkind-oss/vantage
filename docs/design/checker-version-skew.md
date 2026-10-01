---
title: "The checker writes for the oldest viewer, not for itself"
date: 2026-09-30
status: in-review
stage: DESIGN
next: "Rule OQ-VS1: tag 0.8.0 with the text and the messages now, or hold it for the VANTAGE_VIEWER payload"
tags: [vantage-check, versioning, release, agents, config]
summary: "An agent's checker is whatever PyPI released last, so it teaches Markdown the viewer its humans run may not render. Tell the newest checker who the readers are, in .vantage.toml, in the review payload and in a machine's environment, and have it write for the oldest of them."
---

# The checker writes for the oldest viewer, not for itself

**Status:** 2026-09-30. The checker's part of the 0.8.0 slice ([§11](#11-what-ships-when)) is built: the two-branch messages, the development-build name, the `style-guide` header line and the user-guide edits. Nothing for a later release is built. The evidence was checked against `bb7f67f` (main) and against the published 0.7.1 packages on the same day.

> **In short.** Nothing today stops an agent's checker from being newer than its readers' viewer, because the checker writes for its own version. The fix is to tell the newest checker which viewers the readers run and have it write for the oldest, not to pin an old checker, which can't see what came after it.

**Why it matters.** 0.8.0 is the first incident. Its guide teaches two features that a 0.7.1 viewer renders wrong, and every 0.7.x viewer's review payload sends agents to that guide within about ten minutes of the upload. Agent instructions in circulation already teach conventions that exist only in 0.8.0.

**The shape.** Two declarations of which Vantage the readers run: `target` in `.vantage.toml`, and `VANTAGE_VIEWER` from the review payload or a machine's environment. The newest checker reads both, and checks against a feature table and an archive of every released style guide.

**Cost.** Every new Markdown feature needs a version, a proof of what older viewers do with it, and an entry the release gate checks. Once a viewer ships `VANTAGE_VIEWER`, that name is permanent.

**Start at [§4.2](#42-choosing-the-effective-target):** how the checker picks the version it writes for.

**Needs your ruling:** [OQ-VS1](#OQ-VS1) (before 0.8.0 is tagged), [OQ-VS2](#OQ-VS2), [OQ-VS3](#OQ-VS3).

**Reads with:** [`checker-version-skew-plan.md`](checker-version-skew-plan.md) (the implementation sketch, incomplete while questions are open), [`agent-cli.md`](agent-cli.md) (whose R6 this replaces), [`repo-config.md`](repo-config.md) (the file the key lives in), [`inline-markup.md`](../reference/inline-markup.md) (whose D3 this amends, [§4.1](#41-the-key)), and [`agent-bootstrap.md`](agent-bootstrap.md) (whose [`OQ-B6`](agent-bootstrap.md#decision-ledger) wording this amends, [§5.1](#51-the-review-payload)).

---

## 1. Verdict, and the principles

**Build the target, and give the viewer's version to the newest checker instead of pinning an old checker to it.** 0.8.0 needs text and three small checker changes. Whether it also carries the payload change is [OQ-VS1](#OQ-VS1). The rest ships in the next release ([§11](#11-what-ships-when)).

**What this does not ensure.** Two cases stay unprotected, and nobody should read the design as covering them:

- **An unconfigured repository.** With no `target`, no `VANTAGE_VIEWER` on the machine, and no review payload, nothing stops an agent from getting a newer checker than the viewer, under [OQ-VS2](#OQ-VS2)'s leaning. The checker only says which version it checked for.
- **0.7.x viewers.** No mechanism can reach them. Their payloads are already shipped, and they carry no version. For those users, 0.8.0's remedies are only the CHANGELOG and the user guide.

Five principles carry the design. The words **target** *(coined here)*, **feature table** *(coined here)* and **`VANTAGE_VIEWER`** *(coined here)* are defined where they are introduced, in [§4.1](#41-the-key), [§4.4](#44-the-feature-table) and [§5](#5-the-viewers-version-goes-to-the-newest-checker).

- **P1. Readers are declared, and the checker writes for the oldest one.** A repository declares its oldest reader once, in config. That's Go's `go` line in `go.mod`, not a stamp in each document. A reviewer's viewer, or a machine's viewer, declares itself.
- **P2. The newest checker implements every target back to a floor.** Nobody installs an old checker to write for an old viewer. As Go puts it, the newest tool is the best implementation of every older version. The one exception: a version below the floor has no newer implementation, and neither does any version before the target release ships. For those, the viewer's own checker is the only implementation there is.
- **P3. A mismatch fails once, clearly, and names the fix.** One message saying which version is needed replaces a flood of `vantage/unknown-name` errors or a false pass.
- **P4. Whoever knows the viewer's version passes it along, and never pins a checker to it.** The review payload knows the reviewer's viewer, and a machine's environment knows the machine's viewer. Neither can know what a later release changed, so neither picks the checker.
- **P5. The checker never asks anyone.** [`agent-cli.md` P1](agent-cli.md#1-verdict-up-front) holds: no server, no network, and no fetching of a different version.

## 2. What exists today

### 2.1 How an agent gets its checker

- **Every channel says bare `uvx vantage-check`.** That includes:
  - the review payload ([`useReviewStore.ts:1216`](../../frontend/src/stores/useReviewStore.ts#L1216), and the same string at v0.7.1);
  - the user guide, including its CI example and its `style-guide >> AGENTS.md` recipe ([`vantage-check.md`](../../userguide/guides/vantage-check.md));
  - agent instructions in circulation, which include this repository author's own skills.
- **Bare `uvx` means the newest release, and the lag is short.** Measured with uv 0.12.17 on 2026-09-30:
  - uv consults the index on every run, and PyPI's simple index sends `max-age=600`.
  - A cached environment for 0.6.0 was created 14 minutes after that version was uploaded.
  - `uv tool install vantage-check==X` pins a machine, and `@latest` bypasses that pin.
- **uv never looks at `PATH`, and no project-level uv config pins it.** A Homebrew `vantage-check` that matches the Homebrew viewer is invisible to `uvx`. `constraint-dependencies` in the working directory's `uv.toml` or `pyproject.toml` was ignored.
- **The two wheels don't know about each other.** [`build-wheel.py`](../../scripts/build-wheel.py) writes no `Requires-Dist` in either.

### 2.2 What a 0.8.0 agent writes, and what a 0.7.1 viewer does with it

Rows 1, 3 and 4 were checked by rendering a probe with the published `vantage-md@0.7.1`. Rows 2, 5 and 6 depend on the app or the server, which that package doesn't contain, so they were read from the v0.7.1 tag's code. The published `uvx vantage-check@0.7.1` passed every row except the directive name it doesn't know.

| 0.8.0 feature | 0.7.1 viewer | 0.8.0 checker |
| :--- | :--- | :--- |
| Inline `<svg>` | **Wrong.** The drawing is dropped, and the text of its `<title>`, `<desc>` and `<text>` elements runs together as a paragraph | clean |
| An `oq` directive on a 🔒 or ✅ question, which the 0.8.0 guide requires | **Wrong control, in review mode.** It offers "Take this leaning", and with no leaning set it files the literal text "Take the stated leaning." (`useOpenQuestionButtons.ts:44` and `:294` at v0.7.1) | clean |
| `stage:`, `next:` | Plain metadata rows | clean |
| `depends-on:` | Raw paths shown as tag chips, not as links | checks the paths exist |
| `[planning]` in `.vantage.toml` | Ignored: `ours()` at v0.7.1 claims only `starred` (`repoconfig.go:133`) | read |
| The roadmap convention "never copy a status into it" | The badge that stands in for the status doesn't exist, **so the reader loses the status** | taught by the guide |

### 2.3 The other direction: an old checker and a newer repository

- **Every published checker exits 2 on this repository's own `.vantage.toml`.** Every version tested (0.5.10, 0.6.2, 0.7.0 and 0.7.1) reports `unknown rule "planning/unrouted"`. So bare `uvx` can't check this repository until 0.8.0 ships.
- **A newer key or rule id is fatal to an older checker.** Unknown `check.*` and `planning.*` keys exit 2 ([`config.ts:242`](../../packages/vantage-check/src/core/config.ts#L242), [`:294`](../../packages/vantage-check/src/core/config.ts#L294)). So do unknown rule ids (`assertRuleId`, [`:412`](../../packages/vantage-check/src/core/config.ts#L412)), unless their namespace is `markdown`.
- **A newer directive name is an error in an older checker.** `vantage/unknown-name` defaults to `error` ([`registry.ts:134`](../../packages/vantage-check/src/rules/registry.ts#L134)). Its message says "Vantage knows `section`, `block` or `oq`" without saying which Vantage. Most hits are typos, which is why it is an error.
- **The two style guides contradict each other.** The 0.7.1 guide says blocked and answered questions need no directive. The 0.8.0 planning index counts a question only when it has one ([`scan.ts:59`](../../packages/vantage-md/src/planning/scan.ts#L59)). In `git diff v0.7.1 HEAD -- packages/vantage-md/src/styleGuide.ts`, that rule is the only line changed rather than added.
- **An old checker passes what a new one catches.** 0.7.1 passes a `depends-on:` that points at a missing file, while the current build reports `planning/depends-on-missing`.

### 2.4 Where versions are visible

| Signal | What it says |
| :--- | :--- |
| `vantage --version` | `vantage-md, version 0.7.1` for a release build, and `v0.7.1` for a `go install` build. A local build, including `just deploy`, stamps only the commit ([`Justfile:58`](../../Justfile#L58)) and reports a Go pseudo-version older than every release. It names the installed binary, which is not always the running service. |
| The browser | **No frontend code reads the app version.** `/api/version` returns the *served repository's* HEAD, and the WebSocket hello carries a commit or a timestamp. `GET /api/perf/diagnostics` carries `app_version` ([`perf_handlers.go:21`](../../internal/api/perf_handlers.go#L21)), but only the perf-report CLI reads it. |
| `vantage-check version` | `vantage-check 0.7.1` for a release build. A local `just cli` build prints `vantage-check 0.1.0`, which is the manifest's placeholder, and running from source prints `0.0.0-dev`. |
| `vantage-check style-guide` | No version anywhere. The first line is `## Markdown style guide (for Vantage viewer)`. |
| `.vantage.toml` | No version key. |

## 3. Two directions, one cause

Both kinds of skew have the same cause: **the checker decides what to teach and enforce from its own version, and nobody reading the documents runs that version.**

| Direction | How it happens | What it costs today |
| :--- | :--- | :--- |
| **Newer checker, older viewer** | Bare `uvx`, and a viewer that's a release behind. A long-running viewer service keeps running the binary it started with. | The agent writes features the viewer renders wrong or ignores, and the checker calls them clean. |
| **Older checker, newer repository** | A pinned CI job, a `uv tool install`, or a machine that hasn't been upgraded. | Exit 2 on a new key or rule id, `unknown-name` errors on new directives, and false passes on conventions the checker doesn't know. |

## 4. The target

### 4.1 The key

```toml
# At the top of .vantage.toml, above the first [table].
# The oldest Vantage release anyone reading this repository uses.
target = "0.8"
```

- **Meaning.** The **target** *(coined here)* is the oldest Vantage release that any reader of the repository renders it with. It sets a floor across all the readers, and it isn't a pin on any tool.
  - For a feature that only adds something, readers on newer viewers see exactly what they'd have seen without the target.
  - **A feature whose meaning changed between releases is the exception.** At a target below the change, no markup is right for every reader ([§4.4](#44-the-feature-table), [OQ-VS3](#OQ-VS3)).
- **Form.** A string, either `"X.Y"` or `"X.Y.Z"`. `"0.8"` means `0.8.0`.
  - Anything else is a configuration error (exit 2), and the message lists the accepted forms. That includes a TOML number (`target = 0.8`), `"latest"`, a range, a leading `v`, and a pre-release.
  - Ranges are rejected because the checker would have to choose a point in the range, and it would choose its own version. That's the choice this design exists to stop.
- **Placement.** A top-level scalar, next to `theme`, **above the first `[table]`**. Every example shows it there, for two reasons:
  - **Readers that don't know the key ignore it.** The checker reads only `[check]` and `[planning]` ([`config.ts:194`](../../packages/vantage-check/src/core/config.ts#L194)). The server polices only the tables it claims ([`repoconfig.go:467`](../../internal/repoconfig/repoconfig.go#L467)).
  - **TOML moves a key written after a table header into that table.** Appended to this repository's file, the key becomes `planning.stages.target`, which the 0.8 server rejects along with the whole file ([`repo-config.md` §2.3](repo-config.md#23-rejected-whole-never-half)). Placed after `[check.rules]`, it becomes `unknown rule "target"`, which makes every checker exit 2. A checker that knows the key reports a version-shaped `target` inside any table with "move `target` above the first [table]".
- **One writer.** Only a human edits `target`. No Vantage tool writes it or offers to.
- **This amends D3; it doesn't keep it.** [`inline-markup.md` D3](../reference/inline-markup.md) says "no version negotiation, no minimum-version key", without limiting it to documents. Its premise is D2: an older Vantage meeting newer markup renders it plain. 0.8.0 broke that premise twice:
  - Inline SVG isn't a directive. It's HTML that the 0.7.1 sanitizer mangles.
  - The directive on a 🔒 or ✅ question is an existing directive with a new meaning. 0.7.1 renders it as a control that files the wrong comment, which is exactly what D4 forbids ("a control that cannot work must not render").

  So D2 and D3 hold for new directive names, keys and values, and the target exists for everything else. What stays forbidden is negotiation by a renderer: only the checker reads the target, and no viewer renders differently because of it. [§12](#12-what-this-changes-in-other-documents) lists the amendment.

### 4.2 Choosing the effective target

**The target is read per repository root, from the same file the viewer reads.** That's the root's own `.vantage.toml` and nothing above it, the same way `[planning]` is read today (`planningConfigFor`, [`config.ts:162`](../../packages/vantage-check/src/core/config.ts#L162)).

- **`check` finds `[check]` differently, and the target must not use that search.** For `[check]`, `check` walks up from the first path it's given ([`check.ts:70`](../../packages/vantage-check/src/commands/check.ts#L70)) all the way to `/`, and never stops at `.git` ([`config.ts:77`](../../packages/vantage-check/src/core/config.ts#L77)). A target found that way could come from a parent directory's file, or from the first of several repositories in the run.
- **`index` already reads the root's own file** ([`index.ts:88`](../../packages/vantage-check/src/commands/index.ts#L88)).
- **`style-guide` reads no config today.** It finds the root from the working directory, and its header names the file it read.
- **A file under no repository root** has no config target, unless `--config` names one.

For each root, the checker picks one **effective target**, taking the first of these that applies:

1. `--target X` on the command line. This applies to every root, and its source is `flag`. An explicit question overrides anything read from the surroundings.
2. Otherwise, the lower of the root's `target` and `VANTAGE_VIEWER` ([§5](#5-the-viewers-version-goes-to-the-newest-checker)), with source `config` or `viewer`. When the viewer is older than the configured target, one line says so: that reviewer's viewer is below the floor the repository declared.
3. Otherwise, the default, which [OQ-VS2](#OQ-VS2) decides, with source `default`. The rest of this doc assumes the leaning: the checker's own version.

`VANTAGE_VIEWER` takes the same forms as `target`. An empty value counts as unset. Any other invalid value exits 2 and names the variable.

Then these rules apply, in this order:

| Condition | What the checker does |
| :--- | :--- |
| A `flag` or `config` target is newer than the checker | Refuses to run ([§4.5](#45-a-checker-older-than-the-target)). The repository may use features this checker can't tell from typos. |
| A `viewer` target is newer than the checker | Checks as its own version, and prints one line saying a newer checker knows more of what that viewer renders. **It doesn't refuse.** The viewer's version says what one reader can render, not what the documents use, and a refusal would turn a stale offline cache into an unchecked delivery. |
| The target is below the floor, which is **0.7.0** | Checks as 0.7.0, and prints one line naming `uvx vantage-check@<T>` for that release's exact conventions. It reports no finding for this. |
| The checker doesn't know its own version (any build the release workflow didn't produce) | Treats itself as newer than every target, and prints "development build" wherever it would print a version. |
| The target is one or more minor releases behind the checker | Prints one informational line: raise `target` once every reader has upgraded, or, for a `viewer` source, the viewer is behind. This isn't a finding and doesn't change the exit code. Without it, a stale target would never produce a signal, because the archived guide doesn't teach the newer features that would trigger a finding. |

**Why the floor is 0.7.0.** It's my choice, and it's cheap to move later.

- The feature table has to describe every release above the floor. At 0.7.0 it starts with exactly the five 0.8.0 entries measured in [§2.2](#22-what-a-080-agent-writes-and-what-a-071-viewer-does-with-it).
- 0.7.0 and 0.7.1 ship identical guides, so one archive entry covers the whole line.
- 0.7.0 is the oldest release that `CHANGELOG.md` documents.
- Lowering the floor means adding one minor line's entries, each with its proof.

**The effective target and its source appear in every output:**

- the text report's closing line, with one line per root when roots differ;
- `--format json`, which carries each root's effective target and source (field names are the implementer's);
- the first line of `style-guide` ([§6.1](#61-the-style-guide-names-its-release)).

### 4.3 What the checker does at a target

| Surface | At target T |
| :--- | :--- |
| **Findings** | A feature from the table ([§4.4](#44-the-feature-table)) that is newer than T, found in a document or in `.vantage.toml`, is reported under one of the rules below. A rule that polices one of those features, such as `planning/stage-vocabulary` for `stage:`, is **off** when its feature is newer than T, so each use is reported once. A rule tied to no feature runs at every target, because a broken link is broken on every viewer. |
| **Style guide** | `style-guide` prints the guide shipped by the newest release at or below T, **byte for byte**, after one line naming that release. It is never a filtered version of today's guide ([§8](#8-alternatives-considered)). What follows the guide for reversed conventions is [OQ-VS3](#OQ-VS3)'s choice. |
| **Config** | A key the *viewer* reads is a feature. A `[planning]` key newer than T is reported, because a viewer older than that key rejects the whole file ([`repo-config.md` §2.3](repo-config.md#23-rejected-whole-never-half)). Keys that only checkers read (`[check]` keys and rule ids) aren't compared with T. The checker a reader's payload runs is the newest one ([§5.1](#51-the-review-payload)). An older checker reads that config only through a pinned install, and [§6.3](#63-what-agent-instructions-must-say) covers the pin a repository chooses for its own CI. |
| **Commands** | Every command works at every target. `index` is the checker's report, not the viewer's, so it runs at T = 0.7 as well. |

| Rule | Default | Fires on a feature newer than T that a viewer at T… |
| :--- | :--- | :--- |
| `target/renders-wrong` | error | renders wrongly, offers a control that does the wrong thing, or treats as grounds to drop the config |
| `target/renders-plain` | warning | ignores or shows as plain text. D2's promise holds, and the reader merely misses out |
| `target/reversed` (if [OQ-VS3](#OQ-VS3) is A) | warning | renders wrongly, while a newer viewer needs it. The message states both harms |

### 4.4 The feature table

The **feature table** *(coined here)* lists every Markdown and config feature added since the floor. It also lists every existing feature whose meaning changed. Each entry records:

- the release the feature arrived in, or **`unreleased`** on commits since the last tag. `just release X` refuses to cut a release while any entry still says `unreleased`. The developer commits the version, so the recipe leaves tracked files unchanged.
- its class: `renders-wrong`, `renders-plain` or `reversed`.
- what an older viewer does with it, in words, which the finding quotes. If older releases differ, the entry records each one's behavior, and a finding uses the behavior of the target release.
- **what a newer reader loses when the feature is left out.** Features aren't monotone: a later release can make existing markup mean more, and then leaving the feature out costs the newer readers.
- its proof: `npm`, `binary` or `manual` (below).

> [!IMPORTANT]
> **An entry's class comes from running the preceding release, not from reading code.** A wrong entry produces a false finding, and a false finding is the thing [`agent-cli.md` R2](agent-cli.md#8-costs-and-risks) says costs the checker its users. Each entry's proof names how it was established:
>
> - **`npm`**: the preceding release's published `vantage-md`, installed under an npm alias. This covers the sanitizer, the directive plugin and `FrontmatterDisplay`.
> - **`binary`**: the preceding release's published binary, run end to end. This covers the app's review controls and the server's config handling, which the npm package doesn't contain.
> - **`manual`**: a human check, dated and recorded in the entry.
>
> Where each proof runs (the gate, the e2e job, or the release) is the implementer's choice. An entry with no proof fails the gate.

The first entries, which cover 0.8.0, measured or read against 0.7.1 ([§2.2](#22-what-a-080-agent-writes-and-what-a-071-viewer-does-with-it)):

| Feature | Since | Class | Without it, a 0.8 reader… | Proof |
| :--- | :--- | :--- | :--- | :--- |
| Inline `<svg>` | 0.8.0 | renders-wrong | sees no drawing | npm |
| An `oq` directive on a 🔒 or ✅ question | 0.8.0 | reversed ([OQ-VS3](#OQ-VS3)) | loses the question from the planning index, its badges and its waiting lists | binary |
| `stage:`, `next:` frontmatter | 0.8.0 | renders-plain | loses the stage badge and the next step | npm |
| `depends-on:` frontmatter | 0.8.0 | renders-plain | loses the dependency | npm |
| Any `[planning]` key | 0.8.0 | renders-plain (0.7.x ignores the table) | gets the defaults | binary |

**A missing entry is caught mechanically where the tree allows it.** v0.7.1's `vantage-md` already exports `DIRECTIVE_VOCABULARY`, `sanitizeSchema` and `STYLE_GUIDE` (`index.ts:32`, `:90` and `:107` at that tag). A test diffs each of them, from the previous published release against the current source, and fails in two cases:

- a new directive name, key or value, or a newly allowed tag or attribute, that has no feature-table entry;
- a changed guide that has no archive entry.

Frontmatter keys and config keys aren't exported that way, so for them a missing entry is caught only by review, unless the implementer exports them too.

**Conventions aren't features.** "Never copy a status into the roadmap" can't be detected in a document, so the archived guide carries it instead: at T = 0.7 the guide simply doesn't teach it. Agent instructions that restate such a convention bypass the target entirely ([§6.3](#63-what-agent-instructions-must-say)).

### 4.5 A checker older than the target

- **It refuses before reading any document.** It exits 2, the same code as a configuration error, with one message. The message names each root whose `flag` or `config` target is too new, the checker's own version, and the minimum version needed. It never goes on to report findings for documents; that avalanche is what Go 1.21 made its toolchains refuse to produce.
- **The refusal is hard, not a warning.** A warning followed by findings from a checker that can't know the newer vocabulary is exactly the misleading output this replaces.
- **The message names a version, and gives an install command only as an example.** The checker can't tell how it was installed (uvx, `uv tool install`, Homebrew or a release archive), so it names the minimum version and shows the `uvx` form as one way to get it. The rest of the wording is the implementer's.
- **The target comparison comes first.** In a repository whose target is newer than the checker, the answer is "needs a newer checker". Where the target is at or below the checker's version, an unknown key keeps its existing meaning: a typo, exit 2.
- **Checkers released before the key ignore it forever.** Nothing is backported. A payload from a viewer that ships `VANTAGE_VIEWER` runs the newest checker ([§5.1](#51-the-review-payload)), so the refusal matters only for pinned installs.

### 4.6 Messages

The implementer chooses the wording. A `target/*` finding must say five things:

- the feature;
- the release it needs;
- the target, and where it came from;
- what a viewer at the target does with the feature, and, for `reversed`, what a newer viewer loses without it;
- the fix: remove the feature, or raise `target` once every reader has upgraded.

**No message about a document ever suggests upgrading the checker.** An upgrade makes the finding disappear while the reader's viewer still mishandles the feature. Upgrade commands belong only to config errors and refusals.

```text
docs/plan.md:14:1  error  Inline <svg> needs Vantage 0.8.0; this repository targets 0.7 (.vantage.toml).
  A 0.7 viewer drops the drawing and prints its <title> and <text> as a paragraph.
  Remove it, or raise target once everyone reads with 0.8.  target/renders-wrong

vantage-check: .vantage.toml targets Vantage 0.9, and this is vantage-check 0.8.3.
  It needs vantage-check 0.9.0 or later, for example `uvx vantage-check@latest`.
```

## 5. The viewer's version goes to the newest checker

**`VANTAGE_VIEWER`** *(coined here)* is an environment variable holding the Vantage release a reader's viewer runs, in the same forms as `target`.

- **It's an input, not a pin.** Whatever checker runs reads it. From the release that ships the target ([§11](#11-what-ships-when)) onward, the newest checker writes for the lower of it and the repository's target ([§4.2](#42-choosing-the-effective-target)).
- **An environment variable, because older checkers ignore it.** Every checker released before then, 0.8.0 included, ignores a variable it doesn't read, so 0.8.0's checker needs no change for it. A flag would make every checker that doesn't know it exit 2.
- **There's a precedent.** `VANTAGE_CHECK_JOBS` is already read the same way ([`io.ts:14`](../../packages/vantage-check/src/io.ts#L14)).

### 5.1 The review payload

- **The rule.** If the server is a release build whose version is a plain `X.Y.Z` after removing a leading `v`, the payload says `VANTAGE_VIEWER=X.Y.Z uvx vantage-check <paths>`. Every other build keeps today's bare command. That includes `just build`, `just deploy`, a Go pseudo-version and a pre-release.
  - Bare is the right command for those builds, not a gap: a development viewer is at or ahead of every release, so the newest checker is the right one for it.
- **Why not `uvx vantage-check@X.Y.Z`.** An old checker can't see what came after it:
  - The published 0.7.1 checker passes all five 0.8.0 features in [§2.2](#22-what-a-080-agent-writes-and-what-a-071-viewer-does-with-it).
  - A pin freezes that checker's false positives into every review its viewer ever sends ([`agent-cli.md` R2](agent-cli.md#8-costs-and-risks)).
  - The pinned checker exits 2 on any checker-only config newer than itself.
  - The pin can fail offline when the cache lacks that exact version.
- **The version is exact.** It's the one the browser tab was served, so it names the viewer actually rendering. That holds for a service upgraded but not yet restarted, and for a tab left open across an upgrade. `vantage --version` names the installed binary instead.
- **The prefix asks nothing new of the agent's shell.** The payload's delivery command is already a bash heredoc.
- **What it requires.** The browser must learn the server's release version, which no frontend code reads today ([§2.4](#24-where-versions-are-visible)). How it gets there is the implementer's choice; the sketch lists the routes. Static exports have no review payload, so they need nothing.
- **The fallback sentence, frozen along with the payload:** "If the command cannot run, or exits 2 (a configuration error or a refusal), deliver anyway and leave `.vantage.toml` as it is. This is a quality gate, not a delivery dependency." Exit 2 means the checker did run, so the sentence has to say it. Otherwise an agent told `unknown rule` is likely to "fix" the finding by deleting the key.
- **The wording of P6 and its ruling is amended; the reason holds.** [`agent-bootstrap.md`'s `OQ-B6`](agent-bootstrap.md#decision-ledger) ruled "no version, no token, no conditionality" on 2026-09-01. That was about a version probing whether the agent had already seen the payload, which is state nobody can observe.
  - The release version isn't that. It's a constant of the build. Every payload from one build carries the same value, it probes nothing, and it varies with nothing observed at runtime.
  - So P6's reason still holds: every agent demonstrably saw the same text, per build. P6's "pure function of the document" becomes "of the document and the build". [§12](#12-what-this-changes-in-other-documents) lists the edit.
- **When several humans review.** Each reviewer's payload names that reviewer's viewer, so the newest checker checks for the person who asked. It uses the lower of that viewer and the repository's target, and says in one line when the viewer is below the target.
- **Viewers released before this change** send the bare command. Their agents get the newest checker, at the repository's target or at its default.

### 5.2 A machine's environment

- **The viewer's version is a fact about the machine, not the repository.** A machine can declare it once: in a jail's config, a CI job's environment, or a shell profile.
  - Outside review mode, this is the only mechanical protection in a repository with no target.
  - It's also the only protection in a jail or a CI runner, which usually has no `vantage` on `PATH`.
- **A payload's prefix overrides the machine's value for that one command.** That's ordinary shell behavior, and it's what's wanted: the reviewer's own viewer is the more exact source.
- **A declaration goes stale the way a pin does.** When the viewer upgrades, the declaration lags behind. That's the safe direction, because the agent writes for an older viewer, and the informational line in [§4.2](#42-choosing-the-effective-target) says so.
- **A machine running viewers of several versions** declares the oldest.

## 6. What agents are told

### 6.1 The style guide names its release

`vantage-check style-guide` prints one line before the guide: *"Vantage 0.8.0's conventions: for readers on 0.8.0 or later."* This ships in 0.8.0.

- **From the target release onward,** the line names the effective target, its source, and the `.vantage.toml` it came from.
- **The checker prints the line.** It isn't part of the guide's text, so the in-app modal and the npm export are unchanged.
- **A pasted copy keeps it.** A copy pasted into `AGENTS.md` carries the line, so the copy says which release it froze.

### 6.2 What a checker says about a name it doesn't know

These strings are frozen into 0.8.0's checker, and they are what a pinned 0.8.0 install says for as long as it runs. So both branches are settled here, before the tag.

- **Document findings** (`vantage/unknown-name`, `unknown-key` and `unknown-value`) say what a viewer at this checker's version does with the markup. Then they say: if it's a typo, fix it; if it comes from a newer Vantage, don't remove it, because this repository's readers need that version and a newer `vantage-check` checks it.
  - They never give an upgrade command, because most hits are typos and "upgrade" is the wrong fix for a document.
  - The default severity stays `error`.
- **Config errors** (an unknown `check.*` or `planning.*` key, or an unknown rule id, all exit 2) name the checker's version. Then they say: if this repository is configured for a newer `vantage-check`, run one (for example, `uvx vantage-check@latest`) and leave the key in place; if it's a typo, fix it.
- **A build CI didn't stamp** calls itself a development build wherever these messages would name a version.

### 6.3 What agent instructions must say

This covers skills, `AGENTS.md`, and any other standing instructions to an agent.

1. **Find the checker in this order:**
   1. **A review payload's command**, run exactly as written. Put the same `VANTAGE_VIEWER=` prefix on `style-guide`.
   2. Otherwise, if **`VANTAGE_VIEWER`** is set on the machine, bare `uvx vantage-check`.
   3. Otherwise, if a **`vantage` on this machine** reports a release, `VANTAGE_VIEWER=<that version> uvx vantage-check`. It names the installed binary, not a running service.
   4. Otherwise, bare `uvx vantage-check`, which says which version it checked for.

   Then read the first line of `style-guide`. If it names a release newer than the reader's viewer, this checker isn't writing for that viewer. That's true of every checker before the target release, because those checkers ignore `VANTAGE_VIEWER`. In that case, `uvx vantage-check@<the viewer's version>` is the one right answer until a newer checker implements that version (the exception in P2).
2. **A copy of the guide comes only from a published release's `style-guide` output, with its header line.** A copy made from an unreleased commit teaches conventions no reader's viewer has.
3. **Instructions that restate a convention themselves bypass the target.** No check can tell the agent that the convention is newer than the reader's viewer. "A 🔒 question gets an id-only directive" is one example. "Don't compensate with copied status tables" is another, and it can't be detected at all. Either point at `style-guide`, or say which release the convention belongs to.
4. **Nothing claims the guide is "correct for the Vantage in front of you".** That's true only when the reader's viewer is the latest PyPI release.
5. **A repository that pins its checker in CI names the same pin for its agents,** in `AGENTS.md`. Otherwise an agent on a newer checker writes checker-only config, such as a new rule id, that the pinned CI then fails with exit 2.

The edits these rules imply for particular skill files are in the sketch.

## 7. The cases

| Case | Today | With this design |
| :--- | :--- | :--- |
| **One human, a release viewer a release behind, review mode** | The agent is taught the newest features | From the release that ships it, the payload's `VANTAGE_VIEWER` makes the newest checker write for that viewer. |
| **The same, outside review mode** | The same | `VANTAGE_VIEWER` on the machine, a declared target, or the `vantage --version` step. **Otherwise nothing is ensured** under [OQ-VS2](#OQ-VS2)'s leaning, and the output says which version was checked for. |
| **An agent in a jail or CI, with no viewer on `PATH`** | Bare `uvx`, the newest release | Set `VANTAGE_VIEWER` once in the jail's config or the CI environment. Otherwise, the same as the row above. |
| **A development viewer (`just deploy`)** | Bare payload | Bare payload, correctly: the viewer is at or ahead of every release. |
| **Several humans, on 0.7.1 and on 0.8.0** | Agents write for 0.8 | Set `target = "0.7"`. Inline SVG is an error, `stage:` is a warning, the 🔒 directive is [OQ-VS3](#OQ-VS3)'s, and agents are taught the 0.7 guide. Each reviewer's payload checks for the lower of the target and their own viewer. A human raises the target once everyone has upgraded. |
| **CI** | `uvx vantage-check docs/` gets the newest release, so any release can turn CI red | Pin the checker in CI (`uvx vantage-check@0.8.0`), name the same pin for agents in `AGENTS.md`, and bump both deliberately. |
| **No Vantage config at all** | Checks as the checker's own version | The same, unless [OQ-VS2](#OQ-VS2) decides otherwise, but now stated in the output. |
| **Old checker, newer repository** | Exit 2, `unknown-name` errors, or false passes | One refusal that names the version to run. For 0.8.0 checkers, which predate the key, the two-branch messages in [§6.2](#62-what-a-checker-says-about-a-name-it-doesnt-know) apply. |
| **0.7.x viewers, once 0.8.0 is on PyPI** | Agents get the 0.8.0 guide | Unchanged mechanically. The 0.8.0 CHANGELOG and the user guide tell these users to upgrade, or to run `uvx vantage-check@0.7.1` until they do. |
| **This repository** | Every published checker exits 2 on its config | 0.8.0 fixes that. Add `target = "0.8"` once the key ships. |

## 8. Alternatives considered

| Alternative | Verdict |
| :--- | :--- |
| Pin the payload to the viewer's own checker (`uvx vantage-check@X.Y.Z`) | **Rejected.** An old checker can't see what came after it, and it exits 2 on newer checker-only config. A pin also makes the old checker's bugs permanent and contradicts P2 ([§5.1](#51-the-review-payload)). |
| Put `--target X.Y.Z` in the payload, with 0.8.0 implementing a narrow version of the flag | **Rejected in favor of the variable.** It needs a 0.8.0 checker change settled under deadline, and an older checker exits 2 on the unknown flag. It also mixes two quantities: the flag is the repository's floor, and a viewer's version must be combined with that floor by taking the lower, not replace it. |
| Pin a minor line (`vantage-check>=0.8,<0.9`) | **Rejected.** It still freezes old bugs. The guide has changed within patch lines (at v0.5.7 and v0.5.9), so this would also need a policy of no Markdown changes in patch releases. |
| The checker asks the running server for its version | **Rejected.** It breaks [`agent-cli.md` P1](agent-cli.md#1-verdict-up-front). It also can't work from a jail, where the connection to the host's `:8000` was refused. |
| The checker falls back to the `vantage` on `PATH` | **This is option C of [OQ-VS2](#OQ-VS2)** for the default. As an agent-instruction step it stays ([§6.3](#63-what-agent-instructions-must-say)), passed through `VANTAGE_VIEWER`. |
| The viewer writes its version into `.vantage/` | **Rejected.** [`review-inbox.md`](../../userguide/guides/review-inbox.md) promises that Vantage doesn't create `.vantage/`, and the file would show up in `git status`. |
| One wheel requires the other (`Requires-Dist`) | **Rejected.** `uvx vantage-check` never installs a viewer, so this would tie the checker to a viewer nobody on that machine runs. |
| A version stamp in each document | **Rejected.** It is the document stamp that [OQ-B6](agent-bootstrap.md#decision-ledger) and D3 forbid, and it costs bytes every human reads. |
| Filter today's guide by marking each section with the release it arrived in | **Rejected.** Changes between releases aren't only additions: the 🔒-directive rule reversed between 0.7 and 0.8. A filtered guide would contain text no release ever shipped, while the archive is verbatim and testable against the tags. |
| Pin the checker only (`AGENTS.md`, mise, `uv tool install`) | **Kept as a supplement, rejected as the mechanism.** It fixes one toolchain, says nothing about the readers, and someone has to bump it by hand. |
| A skew window, as kubectl has, keeping the checker within one minor version of the viewer | **Rejected.** Under P2 the newest checker supports every target, so there's no window to enforce. |
| Make unknown names, keys and rules warnings | **Rejected.** Those errors catch typos. The target handles the forward case properly, and [§6.2](#62-what-a-checker-says-about-a-name-it-doesnt-know) makes the error say which case it might be. |
| Land `target` and its refusal in 0.8.0 | **Rejected.** It settles the key under deadline. And without the feature table, a 0.8.0 checker would accept a lower target and then ignore it, which is the unenforced advisory field that prior art shows decays. |
| The 0.8.0 server decodes `target`, so the viewer notice reaches 0.8.x viewers | **Deferred.** Decoding a top-level string is cheap, but it also settles the key's name and form under deadline, and the notice is a courtesy, not the mechanism. |
| Backport a 0.7.2 that knows the target | **Rejected.** A 0.7.x viewer's payload is already shipped and names no version, so a backported checker would have nothing to read. |
| The server keeps a file with unknown keys instead of rejecting all of it (the Kubernetes "Warn" mode) | **Deferred.** It would reverse [`repo-config.md` §2.3](repo-config.md#23-rejected-whole-never-half), and the target already keeps newer keys out of repositories whose viewers can't read them. |

## 9. Non-goals

- **No negotiation with a running viewer.** The checker never fetches another version of itself.
- **No viewer ever refuses, hides or re-renders a document because of the target.**
- **Not the sanitizer gap.** The current checker passes markup the current sanitizer strips: foreign `class` names, `display: contents`, and Mermaid `themeCSS`. That's a gap in what the checker covers at every version, not version skew, and it needs its own entry.
- **The in-app style guide modal isn't targeted.** It keeps showing the guide for the viewer's own version.
- **Nothing reaches 0.7.x viewers except text** ([§1](#1-verdict-and-the-principles)).

## 10. Risks

| Risk | Mitigation |
| :--- | :--- |
| **A wrong feature-table entry produces false findings.** | Every entry carries a proof, `npm`, `binary` or `manual`, taken against the preceding release ([§4.4](#44-the-feature-table)). |
| **A new feature ships with no entry, so it passes silently at older targets.** | Mechanical for directive vocabulary, sanitizer schema and the guide, which are diffed against the previous published release. Frontmatter and config keys remain a review discipline, and this design doesn't pretend otherwise. |
| **An entry's version is guessed before the release exists.** | Entries say `unreleased`, and `just release` refuses while any entry still does. |
| **Nobody ever raises the target, so agents never use new features.** | That's the intended trade. The informational line fires once the target is a minor release behind. |
| **At a target below 0.8, one group of readers loses something on 🔒/✅ questions.** | Under [OQ-VS3](#OQ-VS3) A, 0.7.x reviewers see a wrong button. Under B, the 0.8 planning index undercounts. Either way it lasts only until the target is raised. |
| **An offline cache holds a checker older than `VANTAGE_VIEWER`.** | It checks as its own version and says so ([§4.2](#42-choosing-the-effective-target)). It doesn't refuse. |
| **A machine's `VANTAGE_VIEWER` goes stale after its viewer upgrades.** | That's the safe direction, and the informational line reports it. |
| **`target` is written below a `[table]` header.** | Every example shows it at the top. A checker that knows the key reports it with "move it above the first [table]". |
| **A local build misreports its version (`0.1.0`) and refuses a real target.** | Development builds identify themselves as development builds ([§4.2](#42-choosing-the-effective-target)). |

## 11. What ships when

| When | What | Size |
| :--- | :--- | :--- |
| **0.8.0** | **Text for the first incident.** A 0.8.0 CHANGELOG paragraph names the two features a 0.7.x viewer renders wrong (inline SVG, and `oq` directives on 🔒/✅ questions). It tells 0.7.x users to upgrade the viewer, or to run `uvx vantage-check@0.7.1` for `check` and `style-guide` until they do. The user-guide edits in [§12](#12-what-this-changes-in-other-documents) ship with it. | text |
| **0.8.0** | **Agent instructions** follow [§6.3](#63-what-agent-instructions-must-say)'s lookup order and self-check. They're edited before the tag, because the window opens at the upload. | text |
| **0.8.0** | **The two-branch messages** ([§6.2](#62-what-a-checker-says-about-a-name-it-doesnt-know)). A local build calls itself a development build. | small |
| **0.8.0** | **The `style-guide` header line** ([§6.1](#61-the-style-guide-names-its-release)) | tiny |
| **0.8.0 under [OQ-VS1](#OQ-VS1) B, 0.8.1 under A** | **The `VANTAGE_VIEWER` payload** and its fallback sentence ([§5.1](#51-the-review-payload)) | small: the browser learns the release version, plus the payload string and six test sites |
| **When 0.8.0 is on PyPI** | Guide copies in agent instructions are regenerated from the published 0.8.0 output ([§6.3](#63-what-agent-instructions-must-say)). | text |
| **The next release** | `target` read per root, and `VANTAGE_VIEWER` read beside it. The refusal, the effective target in every output, the informational line and the misplaced-key report. The feature table with its 0.8.0 entries and their proofs, the `unreleased` gate in `just release`, and the vocabulary diff. The `target/*` rules. The guide archive from 0.7.0 onward, and `style-guide --target`. | the design |
| **Later** | The server reads `target`, and a viewer older than it shows the reader a notice. The notice reaches only viewers from that release on; no 0.7.x or 0.8.x viewer ever shows it. It must not move content already on screen, and a development build never shows it. This repository declares `target`. | small |

## 12. What this changes in other documents

These edits land when this design is accepted, except where noted.

- [`agent-cli.md`](agent-cli.md): R6 ("checks describe the format, which is stable") is replaced by a link to this document. That claim stopped being true in 0.8.0.
- [`pypi-distribution.md`](pypi-distribution.md): the agent row's "at the repo's shared version" is true only with a target, a `VANTAGE_VIEWER` or a pin, and should say so.
- [`inline-markup.md`](../reference/inline-markup.md) D3, amended 2026-09-30: "no version negotiation, no minimum-version key" is scoped to renderers. Its forward-compatibility promise is scoped to new directive names, keys and values. It links here for markup the sanitizer newly admits, and for existing directives whose meaning changes ([§4.1](#41-the-key)).
- [`agent-bootstrap.md`](agent-bootstrap.md) P6 and [`OQ-B6`](agent-bootstrap.md#decision-ledger): one line saying that a build's release version in the command isn't the payload version the ruling forbade, and that the payload is a pure function "of the document and the build" ([§5.1](#51-the-review-payload)). This lands with the payload.
- [`style-guide.md`](../../userguide/reference/style-guide.md): "the same text" becomes "the same text for the same version", and the `uvx vantage-check style-guide` lines say that the output describes the checker's release. This ships in 0.8.0.
- [`vantage-check.md`](../../userguide/guides/vantage-check.md), in 0.8.0:
  - the opening examples say the same thing as `style-guide.md`;
  - the `style-guide >> AGENTS.md` recipe becomes a pointer to the command, since an appended copy is frozen at one release;
  - the CI example becomes pinned, and names the same pin for agents.

  Its "How agents find out about it" section changes with the payload.
- [`configuration.md`](../../userguide/reference/configuration.md) documents `target` and `VANTAGE_VIEWER` when they're built.

## 13. What done looks like

1. With `target = "0.7"`, a document containing an inline `<svg>` fails with a message naming 0.8.0 and the fix. With `target = "0.8"` the same document is clean.
2. With `target = "0.9"`, a checker that knows the key but is older than 0.9 prints one message, exits 2, and prints nothing about any document.
3. With the target at 0.7, the output of `style-guide` after its first line is byte-identical to the output of `uvx vantage-check@0.7.1 style-guide`, apart from whatever [OQ-VS3](#OQ-VS3) appends after the guide.
4. The payload from a release viewer says `VANTAGE_VIEWER=X.Y.Z`, where `X.Y.Z` equals that viewer's version. The payload from a development build names no version.
5. With `VANTAGE_VIEWER=0.8.0` set and no target, a checker from the target release reports a feature newer than 0.8.0, and names 0.8.0 and `VANTAGE_VIEWER` as the effective target and its source.
6. `--format json` carries each root's effective target and its source.
7. `target = "0.8"` written after `[planning.stages]` is reported with "move it above the first [table]".
8. In 0.8.0, a `vantage/unknown-name` message names 0.8.0 and gives no upgrade command. An unknown rule id says not to remove it. A `just cli` build calls itself a development build.

## 14. Open Questions

1. 💬 **OQ-VS1: Tag 0.8.0 now, or hold it for the `VANTAGE_VIEWER` payload?** 0.8.0 is already the first incident, since every 0.7.x viewer's payload is bare. This question decides whether 0.8.0 viewers become the second: whether their payloads carry the variable a later checker needs in order to write for them. Nothing added in a later release reaches a viewer that has already shipped.

   - **A: Tag 0.8.0 with the text, the two-branch messages and the header, and ship the payload in 0.8.1.** Release cost: about half a day. Exposure: 0.8.0 viewers that are installed before 0.8.1 and never upgraded keep the bare payload for good, as every 0.7.x viewer already has. At September's pace of twelve checker releases, the gap is days. It also means the one permanent string isn't settled under deadline.
   - **B: Also hold 0.8.0 for the payload.** Release cost: about another half day, for the browser learning the release version, the payload string and its fallback sentence, and six test sites. The string that gets frozen is the variable's name and meaning. The 0.8.0 checker needs no change for it.

   <!-- vantage: oq id=OQ-VS1 leaning="A — tag 0.8.0 with the text, the messages and the header; ship the VANTAGE_VIEWER payload in 0.8.1 once its name has had a review." -->

   _Leaning:_ A. You asked for the release sooner, and A's exposure is limited to viewers installed in the gap. It also gives the one permanent string a review round instead of a deadline. B is right if another half day doesn't matter.

   **Answer:**
   > _(empty — fill in when decided)_

2. 💬 **OQ-VS2: With no target declared and no `VANTAGE_VIEWER`, what does the checker assume?** This decides what every repository without a Vantage config experiences, and those are most repositories. It is also the case the original question asked about.

   - **A: Its own version, named in every output.** This is today's behavior, made visible. Repositories that upgrade in lockstep lose nothing. An unconfigured repository whose viewer lags is **not protected**, outside review mode and without a machine declaration.
   - **B: The floor (0.7.0), until someone declares otherwise.** Every unconfigured repository is protected by default. But every repository that wants the planning features, this one included, has to declare a target or set `VANTAGE_VIEWER`. Agents in unconfigured repositories are taught the 0.7 guide, and they meet [OQ-VS3](#OQ-VS3)'s reversal.
   - **C: The `vantage` on `PATH`, if it reports a release; otherwise its own version.** This is right on a single-user machine. It's wrong in a jail or in CI, where there usually isn't one, and wrong for a service that hasn't been restarted. The same repository would also check differently on two machines.

   <!-- vantage: oq id=OQ-VS2 leaning="A — the checker's own version, named in every output; the payload, a machine's VANTAGE_VIEWER and a declared target cover the cases where the viewer's version is knowable." -->

   _Leaning:_ A. The checker can't know the viewer's version, but the payload, a machine and a human writing `target` can, and each has a one-line way to say it. B makes every repository do something to avoid a problem many of them don't have. If you want unconfigured repositories protected by default, B is the right choice.

   **Answer:**
   > _(empty — fill in when decided)_

3. 💬 **OQ-VS3: When a release changes what existing markup means, which reader does a lower target favor?** This decides what the checker enforces, and what the archived guide is followed by, at a target below 0.8 for directives on 🔒 and ✅ questions. That is the first such reversal, and it won't be the last. It is scope for the next release, and it doesn't block 0.8.0.

   - **A: Newer readers.** Keep the directive. Below 0.8 it is a `target/reversed` warning that names the 0.7 review-mode harm, and `style-guide` follows the verbatim archived guide with a note, taken from the feature table, for each convention a later release reversed. Cost: 0.7.x reviewers see "Take this leaning" on blocked and answered questions, and the guide output is no longer only the archive.
   - **B: The oldest reader.** Omit the directive. The 0.7 guide stays verbatim, and the directive stays a `target/renders-wrong` error below 0.8. Cost: the 0.8 planning index silently loses every blocked and answered question until the target is raised.

   <!-- vantage: oq id=OQ-VS3 leaning="A — keep the directive and warn; the 0.7 harm is a visible review-mode button a reviewer can decline, while the 0.8 harm is silent data missing from the planning index." -->

   _Leaning:_ A. The 0.7 harm is visible, it appears only in review mode, and a reviewer can decline the button. The 0.8 harm is silent, and it strikes what the planning index exists to show.

   **Answer:**
   > _(empty — fill in when decided)_

## Prior art

- **Go's `go` line** ([go.dev/doc/toolchain](https://go.dev/doc/toolchain)) is the model for P1.
  - Newer toolchains reject features newer than the declared version, and `go vet`'s `stdversion` check reports them.
  - Since 1.21, older toolchains refuse modules that declare a newer version, "so the problem is reported clearly".
- **clippy `msrv`, ruff `target-version` and eslint-plugin-n** are linters that each hold their suggestions to a declared runtime version. Their defaults differ, and that difference is the choice [OQ-VS2](#OQ-VS2) asks you to make:
  - clippy uses the current toolchain;
  - ruff uses a fixed, cautious version;
  - eslint-plugin-n reads the version declared in `package.json`.
- **Browserslist** ([github.com/browserslist/browserslist](https://github.com/browserslist/browserslist)): a project declares its oldest browsers once, the newest tools compile for them, and an environment variable can supply the same answer from outside the project. That is P2 and [§5.2](#52-a-machines-environment) together.
- **Prettier's install docs**: running `npx` with no local install "will temporarily download the latest version. That's not a good idea." Bare `uvx vantage-check` makes the same mistake.
- **Obsidian `minAppVersion` and pip `Requires-Python`** let the consumer's version pick an older producer. That's the model the pinned payload followed, and the reason [§8](#8-alternatives-considered) rejects it: a linter isn't a library, and an old linter can't see what came after it.
- **The failure, in the wild**: GitHub renders Mermaid older than the syntax people write, and a VS Code extension pinned to Mermaid 8.8.0 fails on diagram syntax Copilot generates. In both cases the renderer lagged behind the authoring side, and nothing signaled it.
