---
title: "New meaning gets new notation, and the version machinery waits until it can't"
date: 2026-09-30
status: in-review
stage: DESIGN
next: "Rule OQ-VS1 and OQ-VS5 before 0.8.0 is tagged: both decide strings frozen into every 0.8.0 viewer"
tags: [vantage-check, versioning, release, agents, config, forward-compatibility]
summary: "An agent's checker is whatever PyPI released last, and its readers' viewer may be releases behind. Vantage keeps them compatible by never giving existing notation a new meaning, by pairing each new capability with a fallback older viewers show, and by reserving a target key now so that the version machinery can be added the day a change truly needs it."
---

# New meaning gets new notation, and the version machinery waits until it can't

**Status:** 2026-10-01. Built at `9507cac`: the `style-guide` header line, the two-branch messages and the development-build name. Ruled for 0.8.0 on 2026-09-30, and built in the commit after `958dab3`: `question`, `fallback`, config tolerance in the checker, the reserved `target`, the compatibility test (run by `just release` too) and the payload's exit-2 sentence. Open, and not built: `VANTAGE_VIEWER` in the payload ([OQ-VS1](#OQ-VS1)) and the server's unknown keys ([OQ-VS5](#OQ-VS5)). Nothing deferred is built. The evidence in [§2](#2-what-exists-today) describes `958dab3` and the published 0.7.1 packages.

> **In short.** Old viewers can read new documents because a release never gives existing notation a new meaning ([P0](#1-verdict-and-the-principles)), not because anything negotiates versions. 0.8.0 fixes its one violation, gives its one new capability a fallback, and ships the few pieces a later release can't retrofit, so the version machinery can wait until a change truly needs it.

**Why it matters.** Bare `uvx vantage-check` runs the newest release within minutes of an upload ([§2.1](#21-how-an-agent-gets-its-checker)), so an agent routinely writes for a newer Vantage than its reader runs. As `958dab3` had it, 0.8.0 broke an older viewer once: an `oq` directive on a blocked question offers a 0.7.1 reviewer a button that files the wrong comment ([§2.2](#22-080s-notation-on-a-071-viewer)).

**The shape.** Four things ship in 0.8.0: a `question` directive beside `oq`, a `fallback` directive, config readers that warn about keys they don't know instead of failing on them, and a reserved `target` key. A compatibility test renders the guide through the previous release, so [P0](#1-verdict-and-the-principles) is checked, not just promised.

**Cost.** One CI job needs the network. A typo in `.vantage.toml` warns instead of failing. Once tagged, `question`, `fallback`, `target`'s form and its refusal are permanent, and so is `VANTAGE_VIEWER` if [OQ-VS1](#OQ-VS1) puts it in the payload.

**Start at [§3](#3-forward-compatible-notation-in-080):** what 0.8.0 changes so that it keeps P0.

**Needs your ruling:** [OQ-VS1](#OQ-VS1) and [OQ-VS5](#OQ-VS5), both before 0.8.0 is tagged, then [OQ-VS2](#OQ-VS2) and [OQ-VS3](#OQ-VS3).

**Reads with:** [`checker-version-skew-plan.md`](checker-version-skew-plan.md) (the implementation sketch, incomplete while questions are open), [`inline-markup.md`](../reference/inline-markup.md) (the directive vocabulary, whose D3 this amends), [`repo-config.md`](repo-config.md) (whose [OQ-RC5](repo-config.md#6-decision-ledger) [OQ-VS5](#OQ-VS5) reopens), [`agent-cli.md`](agent-cli.md) (whose R6 this replaces), and [`agent-bootstrap.md`](agent-bootstrap.md) (whose [OQ-B6](agent-bootstrap.md#decision-ledger) wording the payload amends).

---

## 1. Verdict, and the principles

**Keep the notation forward compatible, and build version machinery only for what that can't cover.** My first draft put the machinery first: a declared target, a feature table, an archive of every released guide. Review showed it was guarding mostly against a break the guide had made itself, and that undoing that break costs less than building the guard. What remains of the machinery is the part a shipped release can't acquire later. That ships now, and the rest waits ([§12](#12-deferred-until-a-capability-gap-needs-it)).

| Direction | 0.8.0's answer |
| :--- | :--- |
| **Newer checker, older viewer** | New notation that older viewers drop harmlessly ([§3.1](#31-questions-oq-for-open-ones-question-for-the-rest)), and a fallback block for a capability they lack ([§3.2](#32-a-fallback-block-for-a-capability)). Under [OQ-VS1](#OQ-VS1), the payload names the viewer, for the checkers that come later ([§5](#5-the-viewers-version-in-the-review-payload)). |
| **Older checker, newer repository** | An older checker warns about config keys it doesn't know instead of exiting 2 ([§3.3](#33-config-an-older-checker-can-read)), and refuses with one clear message when a repository declares a newer `target` ([§4](#4-the-target-reserved)). |

The principles, numbered so other documents can cite them. **target** *(coined here)*, **fallback block** *(coined here)* and **`VANTAGE_VIEWER`** *(coined here)* are defined where they are introduced, in [§4.1](#41-the-key), [§3.2](#32-a-fallback-block-for-a-capability) and [§5](#5-the-viewers-version-in-the-review-payload).

- **P0. Notation is forward compatible.** A release never gives existing notation a new meaning. A new meaning gets a new directive name, key or value, which older viewers already drop without harm. A 0.7.1 viewer drops an unknown directive name entirely, and an unknown key or value pair by pair (verified at v0.7.1). The same holds for `.vantage.toml`: a new meaning there gets a new key, which older readers ignore ([§3.3](#33-config-an-older-checker-can-read)). Review enforces P0 when notation is designed, and the compatibility test enforces it on every push ([§3.4](#34-the-compatibility-test)).
- **P1. A capability older renderers lack comes with a fallback they show and newer ones swallow.** This is the `<noscript>` pattern: inline SVG isn't notation, it's a drawing an older sanitizer can't keep, so the document says in words what an older reader is missing.
- **P2. What can't be retrofitted ships first.** Whatever a released viewer or checker freezes ships before the machinery that will rely on it: what the payload says, what a config reader does with a key it doesn't know, the refusal. Nothing added later reaches a release that has already shipped.
- **P3. A mismatch fails once, clearly, and names the fix.** One message saying which version is needed replaces a flood of `vantage/unknown-name` errors or a false pass.
- **P4. Whoever knows the viewer's version passes it along, and never pins a checker to it.** An old checker can't see what came after it, so the newest checker gets the viewer's version as an input ([§5](#5-the-viewers-version-in-the-review-payload)).
- **P5. The checker never asks anyone.** [`agent-cli.md` P1](agent-cli.md#1-verdict-up-front) holds: no server, no network, and no fetching of a different version.

**What this does not ensure:**

- **A capability used without its fallback.** The guide teaches the pairing, but no rule enforces it in 0.8.0. A rule would need to know whether the readers are all on 0.8, and that's the deferred machinery.
- **0.7.x checkers.** They report `question` and `fallback` as unknown names, and exit 2 on any config key newer than they are. Nothing reaches them.
- **A breaking change.** If a release ever breaks P0, older viewers misread the documents that use it. `target` protects only through checkers, which refuse ([§4.2](#42-which-release-a-checker-is-and-when-it-refuses)).

## 2. What exists today

### 2.1 How an agent gets its checker

- **Every channel says bare `uvx vantage-check`.** That includes the review payload ([`useReviewStore.ts:1223`](../../frontend/src/stores/useReviewStore.ts#L1223), the same command at v0.7.1), the user guide ([`vantage-check.md`](../../userguide/guides/vantage-check.md)), and agent instructions in circulation, this repository author's own skills among them.
- **Bare `uvx` means the newest release, and the lag is short.** Measured with uv 0.12.17 on 2026-09-30:
  - uv consults the index on every run, and PyPI's simple index sends `max-age=600`.
  - A cached environment for 0.6.0 was created 14 minutes after that version was uploaded.
  - `uv tool install vantage-check==X` pins a machine, and `@latest` bypasses that pin.
- **uv never looks at `PATH`, and no project-level uv config pins it.** A Homebrew `vantage-check` that matches the Homebrew viewer is invisible to `uvx`.
- **The two wheels don't know about each other.** [`build-wheel.py`](../../scripts/build-wheel.py) writes no `Requires-Dist` in either.

### 2.2 0.8.0's notation on a 0.7.1 viewer

The SVG, `stage:` and `depends-on:` rows were checked by rendering a probe with the published `vantage-md@0.7.1`. The other rows depend on the app or the server, which that package doesn't contain, so they were read from the v0.7.1 tag's code.

| 0.8.0 notation, as `958dab3` had it | 0.7.1 viewer | 0.8.0's answer |
| :--- | :--- | :--- |
| An `oq` directive on a 🔒 or ✅ question, which that guide required | **Wrong control.** Review mode offers "Take this leaning", and with no leaning set it files the literal text "Take the stated leaning." (`useOpenQuestionButtons.ts:44` and `:294` at v0.7.1) | `question` ([§3.1](#31-questions-oq-for-open-ones-question-for-the-rest)) |
| Inline `<svg>` | **Drawing lost.** It's dropped, and the text of its `<title>`, `<desc>` and `<text>` elements is left as loose words in the `<div>` that held it. GitHub prints the `<title>` and `<desc>` tags themselves | A fallback block, shown in place of the drawing ([§3.2](#32-a-fallback-block-for-a-capability)) |
| `stage:`, `next:` | Plain metadata rows | none needed |
| `depends-on:` | Raw paths, shown as tag chips rather than links | none needed |
| `[planning]` in `.vantage.toml` | Ignored: `ours()` at v0.7.1 claims only `starred` | none needed |
| A roadmap entry with no copied status | No badge, so the reader follows the link for the status, as on GitHub | none needed: a convenience is missing, but nothing is misread |

### 2.3 An older checker and a newer repository

- **Every published checker exits 2 on this repository's own `.vantage.toml`.** Every version tested (0.5.10, 0.6.2, 0.7.0 and 0.7.1) reports `unknown rule "planning/unrouted"`.
- **At `958dab3`, an unknown key or rule id was still fatal.** An unknown `check.*` or `planning.*` key exited 2 (`config.ts:244` and `:296` there), and so did an unknown rule id (`:421`). [§3.3](#33-config-an-older-checker-can-read) changes that for 0.8.0.
- **A checker before 0.8.0 reads only `[check]`** (`config.ts:124` at v0.7.1), so it ignores a top-level `target` forever.
- **A newer directive name is an error in an older checker.** `vantage/unknown-name` defaults to `error` ([`registry.ts:149`](../../packages/vantage-check/src/rules/registry.ts#L149)). A 0.7.x checker will report `question` and `fallback` that way, saying "Vantage knows `section`, `block` or `oq`".
- **An old checker passes what a new one catches.** 0.7.1 passes a `depends-on:` that points at a missing file, which the current build reports as `planning/depends-on-missing`.

### 2.4 Where versions are visible

| Signal | What it says |
| :--- | :--- |
| `vantage --version` | `vantage-md, version 0.7.1` for a release build, and `v0.7.1` for a `go install` build. A local build, `just deploy` included, stamps only the commit ([`Justfile:58`](../../Justfile#L58)), and reports a Go pseudo-version. It names the installed binary, which isn't always the running service. |
| The browser | **No frontend code reads the app version.** `/api/version` returns the *served repository's* HEAD. `GET /api/perf/diagnostics` carries `app_version` ([`perf_handlers.go:21`](../../internal/api/perf_handlers.go#L21)), but only the perf-report CLI reads it. |
| `vantage-check version` | `vantage-check 0.8.0` for a release build. Any other build says `development build` with its commit ([§4.2](#42-which-release-a-checker-is-and-when-it-refuses)). |
| `vantage-check style-guide` | Its first line names the release whose conventions follow ([§6.1](#61-the-style-guide-names-its-release)). |
| `.vantage.toml` | No version key until `target` ([§4](#4-the-target-reserved)). |

## 3. Forward-compatible notation, in 0.8.0

### 3.1 Questions: `oq` for open ones, `question` for the rest

Ruled [OQ-VS4](#decision-ledger) A on 2026-09-30.

- **`oq` keeps its 0.7 meaning: an open question that can be answered.** That's a question marked 💬 or 💬 🤷, or carrying no marker at all. Every viewer that knows `oq` offers "Take this leaning" on it in review mode, 0.8.0 included.
- **A 🔒 or ✅ question gets `question`:** `<!-- vantage: question id=OQ-… -->`. It's a new name, so a 0.7.x viewer drops it whole and offers nothing. It takes `id` alone: a `leaning` is the comment "Take this leaning" files, and `question` offers no such control, so on one it's a `vantage/unknown-key` error and the question's prose keeps its `_Leaning:_` line. Starting narrow keeps P0 open: a key added later is one older viewers drop pair by pair. Marking a question answered changes the marker and the directive's name, and drops its `leaning`; the checker's message quotes the directive to write.
- **Both names declare a question**, to the planning index, the contents column, the planning outline and the checker. They share one id grammar, and the id is the anchor under either name. Ids are unique across both names in a document, so an `oq` and a `question` with one id are a duplicate. A run of directives holding both is one question, and the `oq` wins, as it does in a 0.7.x viewer, which drops the `question` and reads the `oq`.
- **They render differently.** An `oq` stamps `data-vantage-oq`; a `question` stamps `data-vantage-question` and the same anchor. So anything that reads `[data-vantage-oq]` still means "a question to answer".
- **The state comes from the marker, never from the name.** A mismatched name doesn't change what the index counts; it changes what an older viewer offers.
- **The checker reports a mismatch as an error, and names the right directive:**
  - `oq` on a 🔒 or ✅ question, because to every viewer before 0.8 `oq` means "answerable";
  - `question` on an open question, because without `oq` nobody can answer it in one click. The fix is `oq`, or a 🔒 or ✅ marker.

  Both are `vantage/question-name`, reported at the directive in every document, including folders `[planning]` excludes. It reads the question's state from the planning scan, so it can't disagree with the index. A 0.8.0 viewer still withholds the button from an `oq` marked 🔒 or ✅, as a second line of defence.
- **The checker reads a layout an author can get wrong, and names the placement instead of a name.** Outside a list item, a question is the one block its directive lands on, so a directive written *below* a bold `✅` title lands on the block after it, which has no marker, and every viewer reads the question as open. Naming either directive there would be wrong: `oq` is what every Vantage offers to answer, and `question` on an "open" question would be told to become one. So when the block a question directive lands on has no title and the block above it carries one marked 🔒 or ✅, `vantage/question-name` says to put the directive above the title, or write the question as a list item.
- **A run holding both names is one declaration.** The checker reports the extra name with "delete this one", never with a rewrite that would declare the question twice, and an id the two share is no duplicate.
- **An open question with no leaning yet takes `oq` without `leaning`,** so the index counts it. Its button files 0.7's default text, "Take the stated leaning.", until the question states one; that is 0.7's own behavior, not a new meaning.
- **What a 0.7.x viewer loses:** `question` gives it no anchor, so a link to a blocked or answered question lands at the top of the document there. That's what 0.7's own guide did, since it gave those questions no directive at all.

> [!WARNING]
> **A new key on `oq` would not have done it.** `oq state=blocked` reads like the smaller change, and it's wrong: a 0.7.x viewer drops the unknown key, keeps the `oq` and offers the button anyway. P0's "new name, key or value" has a sharper edge than it looks. When a new meaning has to *stop* an older viewer acting on notation it knows, only a new name will do, because a name is the one thing whose absence makes the whole directive drop.

### 3.2 A fallback block for a capability

Ruled 2026-09-30.

A **fallback block** *(coined here)* is the block after a `<!-- vantage: fallback -->` directive. It's a stand-in for a reader whose renderer lacks a capability the document uses. A Vantage that knows the directive (0.8.0 on) never renders it, while a 0.7.x viewer and GitHub drop the comment and show the block. It isn't a styling directive, and it isn't a way to hide text from Vantage readers: a fallback block holds only what a reader *without* the capability needs.

```markdown
<div>
<svg viewBox="0 0 120 40" role="img" aria-label="Weekly builds">…</svg>
</div>

<!-- vantage: fallback -->

This drawing needs Vantage 0.8 or later; [view the image](weekly-builds.svg).
```

- **The target is found as `block` finds one:** the one block after the directive, with the same placement rules. It sits on its own line with a blank line after it, and it's indented inside a list item.
- **What it withholds is a closed list, and the list is notation.** A paragraph, a list, a quote, a code block, a table, a rule or a `<div>`, and never a heading. Raw HTML counts by the element it opens with, so a `<div>` with blank lines inside it is withheld whole, up to its closing tag. A raw `<img>`, `<figure>` or `<details>` is not on the list, so Vantage shows it, and `vantage/orphan` says to wrap it in a `<div>`. Once released, the list can't grow: a later viewer that withheld an `<img>` would hide what every earlier one shows, which is a new meaning for the same bytes (P0).
- **"Never renders" means removed, not hidden.** The block is gone from the rendered document in every Vantage renderer: the app, the static export and the npm package's renderer. So nothing in it is painted, printed, searched, copied, outlined or offered for review comments.
- **It takes no keys.** An unknown key is dropped pair by pair (D2), so the block is still withheld, and the checker reports it as usual.
- **It never withholds a heading,** which is the document's structure: the outline lists it, other documents link to its slug, and the planning index reads sections under it. One fallback is one block; a stand-in longer than that is a quote, or a directive per block. The checker warns (`vantage/orphan`) on a fallback above a heading, and on another directive in a fallback's run, which goes with its block.
- **The checker still checks it.** The block's links are read by every reader who sees it, so a broken one is broken for exactly those readers.
- **It pairs with any capability, not only SVG.** No rule requires a nearby drawing, and none reports a drawing with no fallback in 0.8.0 ([§1](#1-verdict-and-the-principles)).
- **The style guide teaches the pairing.** It marks inline SVG as a capability that needs Vantage 0.8 or later, and tells agents to follow every inline `<svg>` with a fallback block.
- **What the fallback can't fix:** an older viewer, and GitHub, still print the drawing's `<text>` as a run of loose words. No block can hide that, so the guide keeps `<text>` to short labels, and the fallback is what tells the reader why they're there. A `<title>` or `<desc>` is printed too (GitHub prints its tags), while 0.8 removes both, so the guide names a drawing with `aria-label` and never with either.
- **D1 holds.** Everywhere but Vantage, the document renders exactly as it would without the directive. Without the directive, Vantage would show the drawing and also a redundant note, and lose nothing.

### 3.3 Config an older checker can read

Ruled 2026-09-30.

- **An unknown key in a table the checker owns, or an unknown rule id, is a warning, and the checker ignores it:**
  - an unknown key in `[check]`;
  - an unknown rule id or family under `[check.rules]`;
  - an unknown key in a rule's table. The rest of the table, its severity included, still applies;
  - a table for a rule that takes no options in this release. Its severity still applies.
- **The warning gives [§6.2](#62-what-a-checker-says-about-a-name-it-doesnt-know)'s two-branch advice.** It names this checker's version, and says that if the key belongs to a newer `vantage-check`, keep it and run one, and if it's a typo, fix it.
- **It isn't a finding, and it never changes the exit code, under `--strict` or `check.strict` too.** It's printed on stderr, once per message per run, outside the findings. `--format json` doesn't carry it yet, which leaves the release that implements targets free to design per-root fields. `--strict` is the repository's demand about its documents, and a warning about the checker's own age isn't one. If strict counted it, every new key would turn every older pinned CI red, which is the failure this exists to end.
- **What stays exit 2: anything wrong with a key this checker knows.**
  - TOML that doesn't parse.
  - A wrong type or value for a known key, or for a known rule's known option, such as `check.strict = "yes"` or a severity of `"fatal"`.
  - `theme`, `starred` or `target` written inside one of the checker's tables, and `target` written inside `[starred]`, the server's, where appending it to a file that ends in that table puts it. This checker knows each of them, and knows the line does nothing where it stands. The message says where it goes.
- **The cost:** a typo is a warning on every run rather than a failure. Usually the rule the typo meant to silence keeps firing, which shows the typo up anyway.
- **What this means for later releases.** A config value from a closed set, such as a stage role or a severity, can't gain a member without breaking every older checker. So in `.vantage.toml`, a new meaning is always a new key and never a new value.
- **`[planning]` is the one table the server reads too.** The checker treats an unknown key there as it does one in `[check]`: it warns, ignores the key and reads the rest of the table, and the warning says that a server of the same release ignores the whole file over it. The 0.8.0 server, as built, still does ([OQ-RC5](repo-config.md#6-decision-ledger)), and whether it should warn and ignore too is [OQ-VS5](#OQ-VS5). The two readers' answers are pinned side by side, file by file, in [`version-skew-config.json`](../../internal/repoconfig/testdata/version-skew-config.json), and [`planning-config.json`](../../internal/repoconfig/testdata/planning-config.json) holds the files they agree on.
- **A top-level key the server doesn't decode is already ignored.** The server polices only the tables it claims ([`repoconfig.go:479`](../../internal/repoconfig/repoconfig.go#L479)), so a top-level `target` reaches the server and does nothing.

### 3.4 The compatibility test

Ruled 2026-09-30. This turns P0 from a promise into a mechanism. It renders what the current style guide teaches through the previous release's published renderer, and fails when the old viewer would misread any of it. It's `just compat-previous [version]`, and [`notation.ts`](../../frontend/src/compat/notation.ts) defines what counts as a misreading.

- **What it renders:**
  - every example in the current guide that shows notation: a directive, frontmatter, and inline SVG with its fallback;
  - one case for each directive name, key and value in the current vocabulary, and for each frontmatter key the guide teaches.

  A name, key or value that no case covers fails the test, so a new form can't arrive untested.
- **Through what:** the published `vantage-md` of the **previous release**, which is the newest `v[0-9]*` tag whose version npm has published, passing over a tag npm doesn't have yet. A clone without tags reads `CHANGELOG.md`'s version headings instead, and never npm's `latest`, which a patch to an older line moves. So before 0.8.0 is tagged it's 0.7.1, and right after 0.8.0 is published it's 0.8.0, which is what every later commit has to stay readable by. `just compat-previous X.Y.Z` asks for another. It's fetched at test time, with its own dependencies, into the test's own scratch directory. It is never a dependency in any manifest or in the lockfile.
- **What fails:**
  1. **A new affordance.** The old renderer stamps an `oq` on a question that the current scan reads as blocked or answered. The stamp stands for the button: the app isn't in the package, but at v0.7.1 it offers "Take this leaning" on every stamped `oq` in review mode.
  2. **Leaked text.** The old render shows text that the current one doesn't, other than a fallback block's text, which only older readers should see, and a listed capability's text (below). A dropped directive whose text leaks, or a frontmatter key that lands in the body, fails here.
  3. **A changed meaning.** The old renderer puts a `data-vantage-*` stamp on a block, and the current renderer doesn't put the same stamp with the same value on the same block.

  The built test also fails on a directive the old release drops whose comment still spills into the page (a `-->` inside a value), on an `id` the two renders set differently, and on frontmatter the old release reads differently. The app's button logic isn't in the package, so the affordance check is a written model of it at v0.7.1.
- **Capabilities are listed, each with the release it arrived in.** 0.8.0's list is inline SVG. A capability's case passes only when the guide marks it with that release and its example pairs it with a fallback block, which the old render has to show. A previous release that draws the capability itself has no gap to fill, so the case is skipped; otherwise the job would turn red on `main` the moment 0.8.0 became the previous release.
- **Where it runs:** in a recipe of its own, as a CI job of its own on every push to `main` and every pull request, and in `just release`, which runs it with `CI=true` before anything is tagged, so a tag can't be cut from a commit the job never passed. It's outside `check-ci` and `check-fast`, so `just done` stays able to run offline. Branch protection should list the job as required; that's repository settings, not this tree.
- **Offline:** a local run that can't fetch the package skips, with one message naming the package and version it couldn't fetch. In CI, the same failure fails the job, because a skipped check that shows green is a false pass.
- **What it doesn't cover:** the server's config handling and the app's other controls, which aren't in the package. [§3.3](#33-config-an-older-checker-can-read)'s tests cover the config side.
- **When it fails, change the notation, not the test.** Express the change as new notation (P0), or give the capability a fallback (P1). If neither is possible, declare a breaking change ([§12](#12-deferred-until-a-capability-gap-needs-it)).

## 4. The target, reserved

### 4.1 The key

```toml
# At the top of .vantage.toml, above the first [table].
# The Vantage release this repository's documents are written for.
target = "0.8"
```

Ruled 2026-09-30. 0.8.0 reserves the key so that a later breaking change can rely on every checker from 0.8.0 on to refuse correctly. Without that refusal, a breaking change could rely only on the checkers released after it.

- **Meaning.** The **target** *(coined here)* is the Vantage release a repository's documents are written for, which is the oldest release its readers use. Checkers older than the target refuse to check them. It isn't a pin on any tool, and no viewer reads it.
- **Form.** A string, either `"X.Y"` or `"X.Y.Z"`, where `"0.8"` means `0.8.0`.
  - Anything else is a configuration error (exit 2), and the message lists the accepted forms. That includes a TOML number (`target = 0.8`), `"latest"`, a range, a leading `v`, and a pre-release.
  - **The form is permanent.** A later release that needs more than one version gets a new key ([§3.3](#33-config-an-older-checker-can-read)).
- **Placement.** It's a top-level scalar, next to `theme`, **above the first `[table]`**. Every example shows it there, because TOML moves a key written after a table header into that table.
  - Appended to this repository's file, it would become stage word `target` under `[planning.stages]`, with a role that isn't one. Both readers refuse that file.
  - Below `[check.rules]`, it would become a rule id.

  A checker that knows the key exits 2 on a `target` written inside `[check]`, `[check.rules]`, a rule's table or `[planning]`, on a release-shaped one inside `[planning.stages]`, where `target` could also be a stage word, and on one inside `[starred]`, the server's table. The message ends "TOML reads a key written after a [table] header as part of that table: move it above the first [table]" ([§3.3](#33-config-an-older-checker-can-read)). Another tool's table is not the checker's to police.
- **One writer: a human.** No Vantage tool writes `target` or offers to, and agent instructions say never to change it ([§6.3](#63-what-agent-instructions-must-say)).
- **Readers.** From 0.8.0, the checker reads it. The server accepts it and ignores it ([§3.3](#33-config-an-older-checker-can-read)), and checkers before 0.8.0 ignore it ([§2.3](#23-an-older-checker-and-a-newer-repository)).
- **This amends D3.** [`inline-markup.md`](../reference/inline-markup.md)'s "no version negotiation, no minimum-version key" is scoped to renderers. Only checkers read `target`, and no viewer renders differently because of it.

### 4.2 Which release a checker is, and when it refuses

- **A release checker is one that the release workflow stamped** with the tag's version. Every other build is a **development build** and says so wherever a version is printed: `just cli`, `npm run build`, and running from source. Built at `9507cac`.
- **A release checker refuses a target newer than itself.** The comparison is by major, minor and patch: `"X.Y"` counts as `X.Y.0`, and a pre-release checker counts as the release it leads to, whose notation it knows. When it refuses:
  - it exits 2, with one message, before reading any document, and prints nothing about documents;
  - once the file parses, the comparison comes before every other config check, because a newer checker may accept what this one would call an error.
- **The message** names each file whose target is too new, the target, this checker's version and the version needed. It shows one way to get that version, as an example only, because the checker can't tell how it was installed. It says not to change `target`, because an agent told its checker is too old will otherwise "fix" the file. The rest of the wording is the implementer's.

  ```text
  vantage-check: .vantage.toml targets Vantage 0.9, and this is vantage-check 0.8.3, which is older: it knows nothing a newer release added, so it can neither check that release's documents nor teach its notation, and stops here. Run vantage-check 0.9.0 or later (for example, `uvx vantage-check@latest`), and leave target as it is.
  ```

- **Which commands refuse, and which files they read:**
  - `check` reads `target` from every `.vantage.toml` the run reads: the file `[check]` comes from, and each root's own file for `[planning]`.
  - `index` reads the root's own file.
  - `style-guide` reads `target` alone, from the working directory's repository root. If it can't read or parse that file, it prints the guide, because reporting config errors is `check`'s job. A malformed `target` exits 2, as it does everywhere.
  - `version` and `help` never refuse.
  - `--no-config` reads no file, so it reads no target. `--config` names the file.
- **A development build never refuses.** It checks, and notes the target as [§4.3](#43-a-target-the-checker-meets) describes, calling itself a development build.
- **The refusal is hard, not a warning.** A warning followed by findings from a checker that can't know the newer vocabulary is the misleading output P3 replaces. Go 1.21 made its toolchains refuse for the same reason.

### 4.3 A target the checker meets

That is a target at or below the checker's release, or any target on a development build.

- **The checker notes it,** one line on stderr for each file that declares one, from `check`, `index` and `style-guide` alike. The report itself, text or JSON, is unchanged, which leaves the release that implements targets free to design its fields.
- **The checker changes nothing else.** It runs the same rules and teaches the same guide, and it reports the same findings. A target below the checker's release doesn't make it check for that older release, and the note says so ("checks against its own, newer release's notation whatever the target"), so nobody reads `target = "0.7"` as "checked for 0.7".

## 5. The viewer's version in the review payload

**`VANTAGE_VIEWER`** *(coined here)* is an environment variable holding the Vantage release a reader's viewer runs, as `X.Y.Z`. It's an input for whatever checker runs, never a pin. Whether 0.8.0's payload carries it is [OQ-VS1](#OQ-VS1). No 0.8.0 checker reads it; the first checker that implements targets does ([§12](#12-deferred-until-a-capability-gap-needs-it)).

- **The rule.** A release build whose version is a plain `X.Y.Z`, once a leading `v` is removed, sends `VANTAGE_VIEWER=X.Y.Z uvx vantage-check <paths>`. Every other build keeps today's bare command, which is right for them: a development viewer is at or ahead of every release. That covers `just build`, `just deploy`, a Go pseudo-version and a pre-release.
- **Why it can't wait (P2).** A payload is frozen into every viewer that ships it, so a later checker has nothing to read from a viewer that shipped without the variable. Every 0.7.x viewer is already one of those.
- **Why a variable, and not a flag or a pin.**
  - An older checker ignores an environment variable it doesn't read. 0.8.0's checker reads only `VANTAGE_CHECK_JOBS` ([`io.ts:14`](../../packages/vantage-check/src/io.ts#L14)).
  - A flag would make every checker that doesn't know it exit 2.
  - A pin (`uvx vantage-check@X.Y.Z`) freezes the old checker's blindness and its bugs into every review its viewer sends (P4). The published 0.7.1 checker passes every row of [§2.2](#22-080s-notation-on-a-071-viewer).
- **The version is exact.** It's the version the browser tab was served, so it names the viewer actually rendering, even a tab left open across an upgrade. No frontend code reads that version today ([§2.4](#24-where-versions-are-visible)), and how it reaches the browser is the implementer's choice (the sketch lists routes).
- **The exit-2 sentence ships in 0.8.0 whatever [OQ-VS1](#OQ-VS1) decides:** "If the command cannot run, or exits 2 (a configuration error or a refusal), deliver anyway and leave `.vantage.toml` as it is — this is a quality gate, not a delivery dependency." Exit 2 means the checker did run, so the sentence has to say so, or an agent is likely to "fix" the refusal by editing the file. It doesn't depend on the variable: the refusal ships in 0.8.0, and so does every 0.8.0 viewer's payload, frozen. It replaces "If `uvx` is not available, deliver anyway", which it covers.
- **This amends the wording of [OQ-B6](agent-bootstrap.md#decision-ledger), not its reason.** That ruling forbade a payload version that probes whether the agent has seen the payload before. A release version probes nothing: it's a constant of the build. So P6's "a pure function of the document" becomes "of the document and the build".
- **Viewers released before this change** send the bare command.

## 6. What agents are told

### 6.1 The style guide names its release

Built at `9507cac`. `vantage-check style-guide` prints one line before the guide: *"Vantage 0.8.0's conventions: for readers on 0.8.0 or later."* A development build says that its conventions can be newer than every release.

- **The checker prints the line.** It isn't part of the guide's text, so the in-app modal and the npm export are unchanged.
- **A pasted copy keeps it,** so a copy in `AGENTS.md` says which release it froze.
- **The 0.8.0 guide teaches the new names:** `oq` for open questions, `question` for 🔒 and ✅ ones, and `fallback` after every inline `<svg>`, which it marks as needing 0.8 or later. It also tells agents never to change `target`.

### 6.2 What a checker says about a name it doesn't know

These strings are frozen into 0.8.0's checker. They are what a pinned 0.8.0 install says for as long as it runs. Built at `9507cac`, apart from `vantage/frontmatter-value` and the config change in the second bullet, which came after `958dab3`.

- **Document findings** (`vantage/unknown-name`, `unknown-key` and `unknown-value`) say what a viewer at this checker's version does with the markup. Then they say: if it's a typo, fix it; if it comes from a newer Vantage, don't remove it, because this repository's readers need that version and a newer `vantage-check` checks it.
  - They never give an upgrade command, because most hits are typos, and upgrading is the wrong fix for a document.
  - The default severity stays `error`.
  - `vantage/frontmatter-value`, a `vantage:` frontmatter value outside this checker's set, says the same. It doesn't name a release yet. Its sibling `vantage/frontmatter-key` is already a warning, so that a newer document doesn't fail an older checker.
- **An unknown config key or rule id** names the checker's version. Then it says: if this repository is configured for a newer `vantage-check`, run one (for example `uvx vantage-check@latest`) and keep the key; if it's a typo, fix it. Before 0.8.0 that was an exit-2 error. From 0.8.0 it is a warning ([§3.3](#33-config-an-older-checker-can-read)).
- **A target newer than the checker** is the one refusal, with [§4.2](#42-which-release-a-checker-is-and-when-it-refuses)'s message.

### 6.3 What agent instructions must say

This covers skills, `AGENTS.md`, and any other standing instructions to an agent.

1. **Run the review payload's command exactly as written.** Otherwise run bare `uvx vantage-check`. Under P0 the newest checker's notation is safe for older viewers, and a capability carries its fallback.
2. **Never change `target`.** If the checker refuses, run the version it names.
3. **A copy of the guide comes only from a published release's `style-guide` output, with its header line.** A copy made from an unreleased commit teaches conventions no reader's viewer has.
4. **Instructions that restate a convention themselves say which release it belongs to.** "A 🔒 question gets a `question` directive" is 0.8.0's rule, and an instruction that states it without that release misleads every agent whose checker is older.
5. **Nothing claims the guide is "correct for the Vantage in front of you".** It's correct for the checker's release.
6. **A repository that pins its checker in CI names the same pin for its agents,** in `AGENTS.md`.
7. **A checker that reports `question` or `fallback` as an unknown name is older than 0.8.0.** The fix is a newer checker, not removing the directive.

## 7. The cases

| Case | With this design |
| :--- | :--- |
| **One human, a viewer a release behind** | The agent writes the newest notation, which the viewer drops where it's new. A drawing shows its fallback. Under [OQ-VS1](#OQ-VS1), the payload names the viewer for the checkers that come later. |
| **Several humans, on 0.7.1 and on 0.8.0** | The same as above, for each of them. Nothing makes the checker forbid what 0.7.1 can't render: that needs the deferred machinery, and with P0 and P1 holding, nothing yet does. |
| **A development viewer (`just deploy`)** | Bare payload, correctly: the viewer is at or ahead of every release. |
| **A pinned CI checker, and a newer repository** | From 0.8.0, a newer config key is a warning, not a red build. A document's newer directive is an error that says not to remove it. A declared `target` newer than the pin refuses, with one message, on every run. |
| **A 0.7.x checker** | It exits 2 on any newer config key, and reports `question` and `fallback` as unknown names. Nothing reaches it; the 0.8.0 CHANGELOG says so. |
| **A future breaking change** | Its release says so. A repository that adopts it raises `target`, and every checker from 0.8.0 on that is older than the target refuses. Raising it before every reader upgrades is the repository's call. |
| **This repository** | Its config is readable by 0.8.0. It declares no `target` until a breaking change needs one. |

## 8. Alternatives considered

| Alternative | Verdict |
| :--- | :--- |
| Keep `oq` on every question, as `958dab3` had it ([OQ-VS4](#decision-ledger) B) | **Rejected 2026-09-30.** It gives old notation a new meaning, and 0.7.x reviewers see a control that files the wrong comment. |
| Directives on open questions only ([OQ-VS4](#decision-ledger) C) | **Rejected.** The planning index reads a question only from its directive, so it would lose every blocked question. |
| A key on `oq`, such as `oq state=blocked` | **Rejected.** A 0.7.x viewer drops the key and keeps offering the button ([§3.1](#31-questions-oq-for-open-ones-question-for-the-rest)). |
| `block hide=true` instead of `fallback` | **Rejected.** It works mechanically, since a 0.7.x viewer drops the key and the bare `block` stamps nothing. But it makes a styling directive also mean "remove", and the name is what says what a directive does. |
| An HTML fallback (`<noscript>`, an `<object>`'s fallback content) | **Rejected.** Sanitizers, GitHub's among them, strip or unwrap those elements. A comment is the one carrier every renderer drops the same way (D1). |
| Commit every drawing as a file instead of inline SVG | **Kept as the guide's advice** for a document read mostly on GitHub. The fallback is for authors who inline the drawing anyway. |
| Reserve `target` but accept and ignore it in 0.8.0 | **Rejected.** Every 0.8.x checker would then ignore a target forever, and a breaking change could rely only on the checkers released after it. |
| Land the whole target machinery in 0.8.0 | **Deferred** ([§12](#12-deferred-until-a-capability-gap-needs-it)). Nothing 0.8.0 ships needs it, and the pieces a later release can't retrofit ship now. |
| Make unknown names, keys and rule ids warnings | **Split.** In config, warnings, ruled 2026-09-30 ([§3.3](#33-config-an-older-checker-can-read)). In documents, errors, because typos are the usual cause, and the two-branch message says which case it might be. |
| Pin the payload to the viewer's checker (`uvx vantage-check@X.Y.Z`) | **Rejected.** An old checker can't see what came after it, and the pin makes its bugs permanent (P4). |
| Put `--target X.Y.Z` in the payload | **Rejected.** An older checker exits 2 on an unknown flag. And the viewer's version must be combined with the repository's target by taking the lower of the two, not replace it. |
| Pin a minor line (`vantage-check>=0.8,<0.9`) | **Rejected.** It still freezes old bugs, and the guide has changed within patch lines. |
| The checker asks the running server for its version | **Rejected.** It breaks P5, and it can't work from a jail. |
| The viewer writes its version into `.vantage/` | **Rejected.** [`review-inbox.md`](../../userguide/guides/review-inbox.md) promises that Vantage doesn't create `.vantage/`. |
| One wheel requires the other (`Requires-Dist`) | **Rejected.** `uvx vantage-check` would then install a viewer nobody on that machine runs. |
| A version stamp in each document | **Rejected.** It's the per-document stamp that [OQ-B6](agent-bootstrap.md#decision-ledger) and D3 forbid, and every human reader pays for it. |
| Pin the checker only, in `AGENTS.md`, mise or `uv tool install` | **Kept as a supplement.** It fixes one toolchain, and says nothing about the readers. |
| Backport a 0.7.2 that knows `target` | **Rejected.** A 0.7.x viewer's payload is already shipped and names no version, so a backported checker would have nothing to read. |

## 9. Non-goals

- **No negotiation with a running viewer.** The checker never fetches another version of itself.
- **No viewer ever refuses, hides or re-renders a document because of `target`.** The fallback block is hidden because of a directive in the document, never because of a version.
- **Not the sanitizer gap.** The current checker passes markup that the current sanitizer strips: foreign `class` names, `display: contents`, and Mermaid `themeCSS`. That's a gap in coverage at every version, not version skew.
- **The in-app style guide modal isn't versioned.** It shows the guide for the viewer's own release.
- **Nothing reaches 0.7.x checkers.**

## 10. Risks

| Risk | Mitigation |
| :--- | :--- |
| **A new meaning slips into existing notation.** | The compatibility test fails on a new affordance or a changed stamp ([§3.4](#34-the-compatibility-test)), and every name, key and value must have a case. |
| **The compatibility test passes against itself,** right after a tag. | Right after a publish it does compare against that release, and that's the comparison later commits need: they must stay readable by it. The release itself was compared against the one before it, by the CI job and again by `just release`. |
| **A tag is cut from a commit the compatibility job never passed.** | `just release` runs it, with `CI=true` so that an offline run fails rather than skips. |
| **The registry is unreachable.** | A local run skips, saying what it couldn't fetch. In CI the job fails, so a skip never shows green. |
| **A fallback block carries content a Vantage reader needs.** | The guide says a fallback holds only the stand-in. No test can tell, so review catches this. |
| **An older viewer prints an SVG's `<title>` and `<text>`.** | The fallback explains what is missing. The leaked text itself stays ([§3.2](#32-a-fallback-block-for-a-capability)). |
| **A config typo only warns.** | The warning prints on every run, and the rule the typo meant to silence usually keeps firing. A bad value for a known key still exits 2. |
| **An agent "fixes" a refusal by lowering `target`.** | The refusal says to leave it, and the guide says only a human edits it. |
| **A local build misreports its version and refuses a real target.** | Development builds never refuse ([§4.2](#42-which-release-a-checker-is-and-when-it-refuses)). |
| **`target` is written below a `[table]` header.** | Every example shows it at the top, and a checker that knows the key says to move it. |
| **0.7.x checkers report `question` and `fallback` as errors.** | The 0.8.0 CHANGELOG and the user guide name the cause. That's the older-checker direction, and nothing can reach those checkers. |

## 11. What ships when

| When | What | State |
| :--- | :--- | :--- |
| **0.8.0** | The `style-guide` header line, the two-branch messages and the development-build name ([§6.1](#61-the-style-guide-names-its-release), [§6.2](#62-what-a-checker-says-about-a-name-it-doesnt-know)) | built |
| **0.8.0** | `vantage/frontmatter-value` gives the same two branches ([§6.2](#62-what-a-checker-says-about-a-name-it-doesnt-know)) | designed |
| **0.8.0** | `question` beside `oq`, across the scan, the contents column, the outline, the checker, the guide and this repository's 🔒 and ✅ questions ([§3.1](#31-questions-oq-for-open-ones-question-for-the-rest)) | built |
| **0.8.0** | `fallback`, and the guide's SVG pairing ([§3.2](#32-a-fallback-block-for-a-capability)) | built |
| **0.8.0** | Config tolerance in the checker, `[planning]` included ([§3.3](#33-config-an-older-checker-can-read)); the server's own unknown keys follow [OQ-VS5](#OQ-VS5) | checker built; server open |
| **0.8.0** | `target` reserved: validated, refused, noted; the server ignores it ([§4](#4-the-target-reserved)) | built |
| **0.8.0** | The compatibility test, as its own recipe and CI job ([§3.4](#34-the-compatibility-test)) | built |
| **0.8.0** | The payload's exit-2 sentence ([§5](#5-the-viewers-version-in-the-review-payload)) | built |
| **0.8.0, if [OQ-VS1](#OQ-VS1) is B** | `VANTAGE_VIEWER` in the payload ([§5](#5-the-viewers-version-in-the-review-payload)) | open |
| **0.8.0** | **Text.** The CHANGELOG's paragraph for 0.7.x readers is rewritten: they need no pin, and a drawing shows its fallback. The user guide and the agent instructions follow [§6.3](#63-what-agent-instructions-must-say) and [§13](#13-what-this-changes-in-other-documents). | CHANGELOG and user guide done; agent instructions text |
| **When 0.8.0 is on PyPI** | Guide copies in agent instructions are regenerated from the published output. | text |
| **When a capability gap needs it** | [§12](#12-deferred-until-a-capability-gap-needs-it) | deferred |

## 12. Deferred until a capability gap needs it

**The trigger** is the first change that keeps neither P0 nor P1: notation that can't get a new name, key or value, or a capability whose absence a fallback block can't explain. The compatibility test is where that shows up, because it can't be passed without one or the other. That change is a declared **breaking change**: its release notes say so, a repository that adopts it raises `target`, and every checker from 0.8.0 on that is older than the target refuses. What follows is the machinery that would make a *newer* checker write for older readers. None of it is needed until then. The full draft is this document as of `958dab3`, in its sections on the target and on the viewer's version.

- **An effective target** *(coined here)*: the release a checker writes for, as opposed to `target`, which only declares one. It's chosen per repository root: `--target`, then the lower of the root's `target` and `VANTAGE_VIEWER`, then the default that [OQ-VS2](#OQ-VS2) decides. Below a floor (0.7.0 in the draft), a checker checks as the floor and names the floor's exact checker.
  - **Trap: read it per root, never through `[check]`'s upward walk.** That walk goes past `.git` to `/` from the first path given ([`config.ts:105`](../../packages/vantage-check/src/core/config.ts#L105)), so a target found that way could belong to a parent directory or to another repository in the run.
  - **A `VANTAGE_VIEWER` newer than the checker doesn't refuse.** It says what one reader can render, not what the documents use, and refusing would turn a stale offline cache into an unchecked delivery.
- **A feature table.** It lists every feature since the floor, with the release that added it, what an older viewer does with it, and what a newer reader loses without it.
  - What an entry says an older viewer does comes from running the preceding release, never from reading code: a wrong entry is a false finding. The compatibility test's fetch is the way to run it ([§3.4](#34-the-compatibility-test)), rather than any dependency.
  - Entries on unreleased commits say `unreleased`, and `just release` refuses while one does.
- **`target/*` rules.** These report a feature newer than the effective target, as an error when an older viewer misrenders it and as a warning when it merely shows it plain. No message about a document ever suggests upgrading the checker.
- **A verbatim archive of each released guide,** and `style-guide --target`. It's never a filtered copy of today's guide, which would be text no release ever shipped.
- **`VANTAGE_VIEWER` beyond the payload.** The checker reads it, and a machine can declare it once in a jail's config, a CI job's environment or a shell profile, the only protection outside review mode for a repository with no target.
- **The server reading `target`,** and a viewer older than it showing the reader a notice. The notice must never move content already on screen, and a development build never shows it.

## 13. What this changes in other documents

These land with the 0.8.0 work, except where noted. Done with the build, after `958dab3`:

- [`inline-markup.md`](../reference/inline-markup.md): the names gain `question` and `fallback`. `fallback` is the one directive that removes its block, and D1 still holds for it. D3's "no version negotiation, no minimum-version key" is scoped to renderers ([§4.1](#41-the-key)).
- [`planning-index.md`](../reference/planning-index.md): a question is declared by `oq` or by `question`.
- The style guide ([`styleGuide.ts`](../../packages/vantage-md/src/styleGuide.ts)): [§6.1](#61-the-style-guide-names-its-release)'s last bullet.
- [`agent-cli.md`](agent-cli.md): R6 ("checks describe the format, which is stable") links here instead.
- [`pypi-distribution.md`](pypi-distribution.md): the agent row's "at the repo's shared version" holds only with a pin, since bare `uvx` runs the newest release.
- [`vantage-check.md`](../../userguide/guides/vantage-check.md): "Which release it writes for" drops the `uvx vantage-check@0.7.1` remedy, since a 0.7.1 checker reports 0.8.0's `question` and `fallback` as errors. It documents the config warnings and the refusal instead.
- [`configuration.md`](../../userguide/reference/configuration.md) documents `target`.
- [`CHANGELOG.md`](../../CHANGELOG.md): 0.8.0's paragraph for readers on 0.7 says they need no pinned checker ([§11](#11-what-ships-when)), and the section names `question`, `fallback`, the config warnings and `target`.

Still to do:

- [`repo-config.md`](repo-config.md): [OQ-RC5](repo-config.md#6-decision-ledger) is amended for unknown keys if [OQ-VS5](#OQ-VS5) is A.
- [`agent-bootstrap.md`](agent-bootstrap.md): P6 and [OQ-B6](agent-bootstrap.md#decision-ledger) gain [§5](#5-the-viewers-version-in-the-review-payload)'s line, if [OQ-VS1](#OQ-VS1) is B.

## 14. What done looks like

1. The compatibility job passes against the published `vantage-md@0.7.1`. Changing a 🔒 example's `question` to `oq` makes it fail, naming that example.
2. In 0.8.0, a 🔒 question with `question` is counted by the planning index, reached by its `#OQ-…` link, and listed in the contents column, and review mode offers no button on it. Rendered through 0.7.1, it shows no directive and no button.
3. `oq` on a ✅ question is a checker error that names `question`. `question` on a 💬 question is an error that names `oq`.
4. A fallback paragraph after an inline `<svg>` is absent from the 0.8.0 page, its print view and the static export, and present on GitHub and in 0.7.1's render.
5. With `"future/rule" = "off"` under `[check.rules]` and `newkey = 1` under `[check]`, a 0.8.0 checker warns twice, naming 0.8.0, ignores both, and exits 0 on clean documents, with `--strict` too. `check.strict = "yes"` still exits 2.
6. With `target = "0.9"`, a 0.8.0 release checker prints one message naming 0.9.0, exits 2, and says nothing about any document, for `check`, `index` and `style-guide` alike. A development build checks, and notes the target.
7. With `target = "0.8"`, a note on stderr names the target. `target = 0.8`, `"v0.8"` and `"latest"` each exit 2 and list the accepted forms. `target` written below `[planning.stages]` exits 2 with "move it above the first [table]".
8. The server serves a repository whose `.vantage.toml` says `target = "9.9"` with its theme, stars and planning intact.
9. Offline, the compatibility recipe skips with a message naming what it couldn't fetch.
10. If [OQ-VS1](#OQ-VS1) is B: a release viewer's payload says `VANTAGE_VIEWER=X.Y.Z`, and a development build's names no version.

## 15. Open Questions

1. 💬 **OQ-VS1: Does the 0.8.0 review payload carry `VANTAGE_VIEWER=<release>`?** A payload is frozen into every viewer that ships it, so a viewer released without the variable can never tell a later checker what it renders ([§5](#5-the-viewers-version-in-the-review-payload)). This blocks the tag.

   - **A — No; ship it in 0.8.1.** No delay. Every 0.8.0 viewer installed and never upgraded sends the bare command for good, as every 0.7.x viewer does.
   - **B — Yes, in 0.8.0.** About half a day: the browser learns the server's release version, the payload's command gains the variable, and the payload tests follow. No 0.8.0 checker reads it. The exit-2 sentence ships either way ([§5](#5-the-viewers-version-in-the-review-payload)).

   <!-- vantage: oq id=OQ-VS1 leaning="B — put VANTAGE_VIEWER=<release> in the 0.8.0 payload now: the payload cannot be retrofitted into a viewer that has shipped, and no checker is harmed by a variable it doesn't read." -->

   _Leaning:_ B. The payload is the one piece that can't be retrofitted into a shipped viewer, and a variable costs older checkers nothing.

   **Answer:**
   > _(empty — fill in when decided)_

2. 💬 **OQ-VS5: Does the 0.8.0 server ignore an unknown key in its own tables, as the checker now does?**
   [OQ-RC5](repo-config.md#6-decision-ledger) rejects the whole file for one unknown `[starred]` or `[planning]` key, citing the checker's discipline, which the config ruling ended: the checker now warns and ignores one ([§3.3](#33-config-an-older-checker-can-read)). 0.8.0 is the first server to read `[planning]`, and what it does with a newer key, every 0.8.0 server does for good. This blocks the tag.

   - **A — The server warns and ignores it too.** A bad known value still rejects the file; three fixture cases flip.
   - **B — The server stays strict, or both do.** A later `[planning]` key makes every 0.8.0 server drop the whole file, theme and stars included.

   <!-- vantage: oq id=OQ-VS5 leaning="A — the server and the checker both warn about and ignore an unknown key in [starred] and [planning]; a known key with a bad value still rejects the whole file." -->

   _Leaning:_ A. Under B, every later `[planning]` key is a breaking change for every 0.8.0 server, and a server reads no `target`, so it can't even refuse clearly.

   **Answer:**
   > _(empty — fill in when decided)_

3. 💬 **OQ-VS2: Once checkers implement targets, what does one assume with no `target` and no `VANTAGE_VIEWER`?** Most repositories have no Vantage config, so this is what most of them get. It doesn't block 0.8.0, because a 0.8.0 checker checks against its own release whatever is declared.

   - **A — Its own release, named in every output.** Today's behavior, made visible. Outside review mode, a repository whose viewer lags is unprotected.
   - **B — The oldest release it implements.** Protected by default, but every repository that wants newer notation has to declare `target`.
   - **C — The `vantage` on `PATH`.** Right on a single-user machine, wrong in a jail or CI, and two machines would check one repository differently.

   <!-- vantage: oq id=OQ-VS2 leaning="A — the checker's own release, named in every output; the payload, a machine and a human writing target each have a one-line way to say otherwise." -->

   _Leaning:_ A. The payload, a machine and a human writing `target` each have a one-line way to say otherwise. Under P0 and P1, writing for the newest release rarely harms an older reader.

   **Answer:**
   > _(empty — fill in when decided)_

4. 💬 **OQ-VS3: May a release ever change what existing notation means?** This decides whether the deferred machinery needs rules for markup that means different things to different viewers. It doesn't block 0.8.0: the one change 0.8.0 made is undone by `question` ([§3.1](#31-questions-oq-for-open-ones-question-for-the-rest)).

   - **A — Never; close the question.** P0 forbids it. A change that truly can't get a new name is a declared breaking change, which is what `target` exists for ([§12](#12-deferred-until-a-capability-gap-needs-it)).
   - **B — Allow it, and pick a side per change.** Either newer readers or the oldest win, with a `target/reversed` warning and a note after the archived guide.

   <!-- vantage: oq id=OQ-VS3 leaning="A — close it: P0 forbids giving notation a new meaning, and a change that truly cannot get a new name is a declared breaking change that target exists for." -->

   _Leaning:_ A. B builds machinery for something P0 already forbids.

   **Answer:**
   > _(empty — fill in when decided)_

## Decision Ledger

| ID | Ruling / Decision | Date | Settled in | Built |
| :--- | :--- | :--- | :--- | :--- |
| OQ-VS4 | A: `oq` keeps its 0.7 meaning, an open question that can be answered. 🔒 and ✅ questions get a new directive name, `question`, which 0.7.x viewers drop. Both declare a question, and only `oq` gets "Take this leaning"; the checker flags each one on the wrong state. | 2026-09-30 | [§3.1](#31-questions-oq-for-open-ones-question-for-the-rest) | 0.8.0 |
| — | P0 binds: a release never gives existing notation a new meaning, and 0.8.0 doesn't break it on day one. | 2026-09-30 | [§1](#1-verdict-and-the-principles) | 0.8.0 |
| — | `<!-- vantage: fallback -->` removes its block from 0.8.0 on, and the guide pairs every inline SVG with one. | 2026-09-30 | [§3.2](#32-a-fallback-block-for-a-capability) | 0.8.0 |
| — | The checker warns about and ignores an unknown rule id or an unknown key in a table it owns; parse errors in known keys stay errors. | 2026-09-30 | [§3.3](#33-config-an-older-checker-can-read) | 0.8.0 |
| — | `target` is reserved in 0.8.0: validated; refused when newer than a release checker, never by a development build; otherwise noted. The server accepts it and ignores it. | 2026-09-30 | [§4](#4-the-target-reserved) | 0.8.0 |
| — | A compatibility test renders the guide's notation through the previous release's published renderer, fetched at test time, as its own job. | 2026-09-30 | [§3.4](#34-the-compatibility-test) | 0.8.0 |

## Prior art

- **HTML's `<noscript>`** ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/noscript)) is the pattern behind P1: content that only a reader lacking a capability shows, and that a capable reader swallows.
- **Go's `go` line** ([go.dev/doc/toolchain](https://go.dev/doc/toolchain)) is the model for `target`. Since 1.21, older toolchains refuse modules that declare a newer version, "so the problem is reported clearly", and newer ones hold features to the declared version.
- **clippy `msrv`, ruff `target-version` and eslint-plugin-n** hold a linter's suggestions to a declared runtime version. Their defaults differ, and that difference is [OQ-VS2](#OQ-VS2):
  - clippy uses the current toolchain;
  - ruff uses a fixed, cautious version;
  - eslint-plugin-n reads the version declared in `package.json`.
- **Browserslist** ([github.com/browserslist/browserslist](https://github.com/browserslist/browserslist)): a project declares its oldest browsers once, the newest tools compile for them, and an environment variable can supply the same answer from outside. That's the deferred machinery.
- **Prettier's install docs** say that running `npx` with no local install "will temporarily download the latest version. That's not a good idea." Bare `uvx vantage-check` does the same, which P0 makes safe rather than wrong.
- **The failure, in the wild**: GitHub renders Mermaid older than the syntax people write, and a VS Code extension pinned to Mermaid 8.8.0 fails on diagram syntax Copilot generates. In both cases the renderer lagged behind the authoring side, and nothing signaled it.
