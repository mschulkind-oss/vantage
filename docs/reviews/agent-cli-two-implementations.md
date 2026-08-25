---
title: "Two implementations of the same design — a comparison"
date: 2026-08-25
status: in-review # draft | in-review | accepted | deprecated
tags: [review, cli, agents, tooling, model-comparison]
summary: "The same design doc, the same prompt, the same base commit, two models. What each spent, how each worked, and — measured against the real renderer — which one is right where they disagree."
---

# Two implementations of the same design

Two agents were given `implement @docs/design/agent-cli.md` against the same
base commit (`3e7d8e4`) and left to it. This compares what came back.

| | **Run A** | **Run B** |
| :--- | :--- | :--- |
| Tree | this repository | `vantage2` |
| Model | `qwen3.8-27b-long250k` | `claude-opus-5` |
| Head | `554da8e` | `1a58010` |

**Reads with:** [`agent-cli-implementation-review.md`](agent-cli-implementation-review.md)
(the detailed defect review of Run A) and
[`../design/agent-cli.md`](../design/agent-cli.md) (the shared contract).

> [!NOTE]
> Where the two disagree about a document, "who is right" is settled against
> the actual Vantage renderer and viewer — not against taste. Every such call
> below names the code that decides it.

---

## 1. At a glance

| | Run A (qwen) | Run B (opus) |
| :--- | ---: | ---: |
| Wall clock, first to last event | 12 h 14 m | **49 m** |
| Minus gaps > 5 min | ~4 h 54 m | **~44 m** |
| Assistant turns | 1,019 | **288** |
| Output tokens | 1,110,760 | **353,984** |
| Cache-read tokens | 123.9 M | **58.6 M** |
| Subagents | 4 (3 × `Explore`, 1 × `Plan`) | 0 |
| Context compactions | 2 | 0 |
| Tool calls (main session) | 367 | 185 |
| Commits | 9 | 12 |
| Insertions | 8,527 | 9,783 |
| CLI package LOC | 2,539 | 3,569 |
| Tests | 88 in 12 files | 94 in 8 files |
| Shipped binary | 92 MB (bun) | 124 MB (Node SEA) |
| `check docs userguide` | 1,180 ms | **445 ms** |

Run A's token figures include its four subagents. The two models are not on the
same price sheet, so token counts are not a cost comparison — but a 3.1×
difference in output tokens and a 2.1× difference in cache reads for the same
deliverable is a real efficiency gap, and the wall-clock difference is larger
still.

---

## 2. How each one worked

### Run A — plan first, then grind

Run A spent its first 1 h 40 m before any code: three `Explore` subagents
mapping the package layout, the style-guide feature, and the CI/release
infrastructure in parallel, then plan mode with two questions put to the user
(scope, and how to compile the binary), then a `Plan` subagent producing a
214-line implementation plan.

That front-loading was not wasted — the plan is good and the commits follow it
— but the run then took twelve hours to execute it, ran out of context twice,
and lost the thread each time (the second compaction summary records
half-written phase-5 sources on disk, untypechecked and untested).

The friction is catalogued in the
[Run A review](agent-cli-implementation-review.md#23-what-it-got-stuck-on):
nine traps, several of them self-inflicted gate breakage.

### Run B — plan as a commit, then straight through

Run B used no subagents and never compacted. It opened by writing the plan into
the repository as `docs/plans/agent-cli-implementation.md` (57 lines, ticked off
as it went) and committing it — so the plan survived as an artifact rather than
as conversation state. It then produced eleven more commits in 37 minutes.

Two mechanical habits show up in the transcript and matter more than they look:

- **It worked almost entirely through `Bash`** — 137 Bash calls, 47 `Write`,
  and exactly **one** `Read`. Files were inspected with `sed`/`rg` and written
  whole.
- **It ran the slow things in the background** — `npm install` and the full CI
  gate were backgrounded, and the only two pauses in the whole session are
  those two waits.

It also asked the user nothing. Where Run A surfaced the compile-method
trade-off as a question, Run B picked Node SEA and justified it in a comment.
Section 5 argues that was the weaker of the two answers — but it did not cost
the run anything to decide it alone.

---

## 3. Where they disagree about a document

Both were run over the same probe corpus and over each other's repositories.
Every disagreement below was adjudicated against the renderer.

```console
$ # a document with a data: link, an xmpp: link, a directory link, a file:// link
$ runA check docs/schemes.md
docs/schemes.md:4: error: link/uri-scheme — scheme "xmpp:" is not openable in the viewer …
docs/schemes.md:5: error: link/missing-target — "../docs" points at a directory (docs), not a document
docs/schemes.md:6: error: link/uri-scheme — scheme "file:" is not openable in the viewer …
3 findings in 1 file

$ runB docs/schemes.md
docs/schemes.md
  6:3  error  link/uri-scheme  `file:///etc/hosts` uses the `file://` scheme, which Vantage
                               cannot route. Write the target relative to this file instead.
✖ 1 error in 1 file checked
```

Two of Run A's three findings are false positives.

| Case | Run A | Run B | Who is right, and why |
| :--- | :--- | :--- | :--- |
| Link to a directory | error | quiet | **B.** [`ViewerPage.tsx:421`](../../frontend/src/pages/ViewerPage.tsx#L421) routes any non-`.md` path to `viewDirectory()`, which renders a directory listing |
| `xmpp:` / `irc:` link | error | quiet | **B.** `defaultSchema.protocols.href` allows `http, https, irc, ircs, mailto, xmpp`, kept by [`sanitize.ts:11`](../../packages/vantage-md/src/sanitize.ts#L11) |
| `data:` link | quiet | quiet | **Neither.** The sanitizer strips the href — verified: the pipeline emits a bare `<a>data</a>` |
| `<a id="notes">` then `[x](#notes)` | dead-section-anchor | quiet | **B.** The sanitizer renames it to `user-content-notes`, and [`MarkdownViewer.tsx:155-156`](../../frontend/src/components/MarkdownViewer.tsx#L155-L156) falls back to exactly that id |
| Mermaid syntax error | line of the opening fence | line *inside* the diagram | **B.** The error is on diagram line 2 = file line 5; A reports line 3 |
| Section-anchor typo | names the bad anchor | names it and suggests the nearest real one | **B**, and its suggestion is byte-correct against `rehype-slug` (verified: `já--em-dash--section`) |
| Link in inline code or a fence | quiet | quiet | **Both.** Both walk the AST, as the design's §5.3 tip demands |
| Raw-HTML `<a href="/x.md">` | unchecked | unchecked | **Neither.** `rehypeRaw` renders it; both miss it |

On the one real defect in this repository's own docs — a `#L13-L97` anchor that
went stale when the style guide moved — **both agree**, and both report it.

---

## 4. Where they disagree about engineering

### 4.1 The Mermaid trap — the same problem, two mechanisms

The design predicted (§5.2) that Mermaid's parser would fail headless. Both
runs hit it. The difference is in how the fix is wired.

**Run A** replaces the `dompurify` module at build time with a hand-written
stand-in, aliased twice: once in `tsconfig.json` for the bun bundle, once in
`vitest.config.ts` for the tests. Only the second is exercised by CI. Deleting
the first leaves all 88 tests green and ships a binary that is permanently
inconclusive on any labeled flowchart — verified by doing it.

**Run B** patches the real module's export in place, before importing mermaid,
and then **parses a known-good labeled flowchart as a canary**:

> If that fails, the shim did not take (a hoisted second copy of dompurify, a
> mermaid release that needs more of a DOM) and the rule reports *nothing*
> about anybody's document — it fails the run instead.

One mechanism, exercised identically in tests, in dev, and in the binary, with
a runtime self-check behind it. Run B's version of this cannot silently
regress; Run A's already can.

### 4.2 What each build actually verifies

| | Run A | Run B |
| :--- | :--- | :--- |
| CLI typechecked and tested in CI | yes | yes |
| CLI **linted** (ESLint, `--max-warnings 0`) | yes | **no** — prettier + `tsc` only |
| CLI **bundled** in CI | no | yes |
| **Binary built and smoke-tested** before release | no | yes — `version`, `style-guide`, and `check` over the repo's own docs, on every platform runner |
| Checker run over this repo's docs in the gate | no | yes — a `_self-check` recipe inside `check-ci` |
| Tag/manifest version agreement checked | no | yes |

Run B's release job is the difference between a claim and a promise: the binary
that gets uploaded has already checked this repository's documentation on the
platform it was built for, with no Node and no `node_modules` in the picture.

### 4.3 Distribution

Run A's `uvx` channel cannot work as written: the PyPI job publishes a
directory containing the 92 MB binary alongside the wheel, and the Windows
wheel bundles the binary under a name its console script does not look for.
Run B builds wheels into their own directory, collects only `*.whl` for
publishing, and handles the `.exe` name in all three places it appears.

Both, however, ship the **same latent release bug**: creating a GitHub Release
for a `vantage-check@*` tag fires `publish.yml`, which triggers on
`release: [published]` with no tag filter, computes `version="${GITHUB_REF_NAME#v}"`
→ `antage-check@0.1.0`, and pushes a broken formula to the public Homebrew tap.
Run A gets there through `softprops/action-gh-release`, Run B through
`gh release create`. Neither noticed the cross-workflow interaction.

### 4.4 Where Run A is ahead

Three things Run A has that Run B does not:

1. **Version-parity enforcement.** Run A pins `katex` and `mermaid` to the
   viewer's exact versions and fails a test if the two `node_modules` trees
   drift. Run B uses caret ranges — and the drift is already live in its
   lockfile:

   | | CLI checks with | Viewer renders with |
   | :--- | :--- | :--- |
   | `katex` | **0.16.47** | 0.18.0 |
   | `mermaid` | **11.17.2** | 11.16.0 |

   Run B's userguide says the CLI runs "the same KaTeX the viewer uses." Today
   it does not. Its Mermaid canary limits the damage there; nothing covers the
   KaTeX gap.

2. **An end-to-end pipeline rule.** Run A adds `render/pipeline`, which pushes
   every document through `renderMarkdown` itself — a backstop for anything the
   individual rules miss. Run B has no equivalent.

3. **ESLint on the package.** Run B's CLI is typechecked and formatted but not
   linted.

Run A's compile choice is also the better one, and it got there by asking:
`bun build --compile` cross-compiles all five targets from one host and yields a
**92 MB** binary. Run B's Node SEA needs five platform runners and produces
**124 MB**. Run B's own comment concedes the constraint ("must be built on the
platform it targets").

---

## 5. The delivered tool, measured

Same machine, same corpus, best of three:

| Workload | Run A | Run B |
| :--- | ---: | ---: |
| `check docs userguide` (18–20 files) | 1,180 ms | **445 ms** |
| `check README.md` (one file) | 234 ms | **71 ms** |
| `style-guide` | 128 ms | **44 ms** |

Run B is 2.6–3.3× faster despite the larger binary, mostly because it loads
Mermaid only when a document actually contains a diagram. For a tool an agent
runs before every delivery, that is the difference between a pause and none.

Run B also ships more surface: `--quiet`, `--color`/`--no-color`,
`--no-config`, a `help` command, an ESLint-style report with columns, a
distinct exit code (`3`) for "could not check" as against `2` for "bad
arguments", and a configurable `check.exit-code` — which is the part of the
design's OQ-6 that Run A left unimplemented.

---

## 6. Reading of it

Run B produced a better tool in a sixteenth of the wall clock and a third of the
output tokens. The gap is not in *scope* — both implemented all six phases, and
Run A's is a real, working checker — it is in the parts of the job that only
show up when you interrogate your own work:

- Run A's false positives all come from **hand-written approximations of the
  pipeline** (its own scheme list, its own idea of what a valid link target is)
  in a design whose central principle is *do not approximate, delegate*. Run B
  read the sanitizer and the viewer's navigation code and matched them.
- Run A verified everything it built **from source**, and shipped a binary and
  a wheel that had never been exercised. Run B wired the artifact into the gate.
- Run A's one genuine advantage — the version-drift guard — is exactly the kind
  of thing that comes from having been burned by drift mid-run, which it was.

The shared Homebrew-tap bug is worth dwelling on: neither run looked at what
else in the repository listens for the event its new workflow emits. That is a
whole-repository question, and both agents were reasoning inside the boundary of
the task they were given.

> [!TIP]
> If the two trees are ever merged, the shape to want is Run B's checker with
> Run A's pinning discipline and `render/pipeline` rule, Run A's bun build in
> place of SEA, and the `publish.yml` tag filter that neither wrote.

---

## Appendix — method

Everything above was measured, not read off the diffs.

- **Session figures** come from the Claude Code transcripts:
  `.yolo/home/claude/projects/-workspace/*.jsonl` in each tree. Turns, tokens,
  tool counts, and timestamps were summed from the `assistant` records
  (including Run A's four subagent transcripts under `…/subagents/`). "Gaps"
  are intervals over five minutes between consecutive transcript events.
- **Run B was made runnable** by extracting `git archive HEAD` into a scratch
  directory and running `npm install` in `packages/vantage-md` and
  `packages/vantage-check`; its suite is 94 passing tests and a clean `tsc`.
  Its bundle and its 124 MB SEA binary both build from that checkout.
- **Behavioral comparisons** ran both binaries over one shared fixture corpus
  (labeled flowchart, broken flowchart, broken KaTeX, four link schemes, a
  directory link, links inside code, a raw-HTML anchor, an em-dash heading) and
  over each other's `docs/` and `userguide/` trees.
- **Adjudication** used the real pipeline: `renderMarkdown` output for the
  sanitizer's verdict on each scheme and for heading ids, and the frontend
  source for how the viewer resolves a fragment or a directory path.
- **Timings** are wall-clock around each binary, best of three, same machine,
  warm cache.
