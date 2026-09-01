---
title: "The PyPI half of Vantage ships software that no longer exists"
status: in-review # draft | in-review | accepted | deprecated
date: 2026-09-01
tags: [packaging, pypi, releases, cli, agents]
summary: "PyPI `vantage-md` is meant to be the executable server's distribution — the twin of npm `vantage-md`, the library. It froze in April holding the retired FastAPI app, because the Go cutover deleted the Python packaging and never replaced it. Fix the wheel path, yank the dead releases, and give the agent CLI its own project rather than a seat in the server's wheel."
---

# The PyPI half of Vantage ships software that no longer exists

**Status:** DESIGN, 2026-09-01. Nothing built. Every claim about the tree,
pypi.org, and the GitHub releases was verified on 2026-09-01, and the checks are
named inline so they can be repeated.

**The short version.** One product name, one registry each: npm `vantage-md`
carries the library form, PyPI `vantage-md` carries the executable server. The
npm half is current. The PyPI half stopped at `0.4.2` on 2026-04-23 and still
holds the **retired Python FastAPI app**, because `e4e3120` deleted
`pyproject.toml`, `src/vantage/` and the PyPI publish job in the Go cutover and
nothing took their place. So `uvx vantage-md` today installs and runs a viewer
whose source is not in this tree. The fix is three things: publish the Go binary
as platform wheels on every `v*` release (`go-to-wheel`, as
`mschulkind-oss/swarf` already does), **yank** the two Python releases so no
platform silently resolves to them, and answer the question this doc exists for
— whether the agent CLI gets its own PyPI project or rides the server's.

**The most important section is [§6](#6-the-agent-cli-its-own-project-or-a-passenger),**
which is that question. [§4.2](#42-version-continuity-and-why-the-yank-is-not-cosmetic)
is the one with a trap in it that costs nothing to avoid now and is invisible
later.

**Reads with:** [`agent-bootstrap.md`](agent-bootstrap.md) (**depends on this
doc** — its **R1** and its step 2 are blocked until `vantage-check` is
installable), [`agent-cli.md`](agent-cli.md) (the CLI being distributed, and why
it is a compiled binary at all), and
[`../reviews/agent-cli-implementation-review.md`](../reviews/agent-cli-implementation-review.md)
§F3 (the defects that were fixed in the CLI's wheel path, and the reason nobody
has seen it work).

---

## 1. Verdict and principles

**Fix the server's wheel path, and give the CLI its own project.** Three
principles, cited by number below and citable from sibling docs:

- **P1. One name per product surface; one registry each.** `vantage-md` names
  *Vantage* in each registry, and the registry says which form you get: npm the
  Markdown-pipeline library, PyPI the executable server. This is deliberate, not
  a collision — the same product, published where each audience looks. What
  follows from it is that a distribution's name identifies **one artifact**, so a
  third artifact with a different audience gets a third name ([§6](#6-the-agent-cli-its-own-project-or-a-passenger)).
- **P2. The PyPI copy is never behind.** Publishing rides the release trigger
  that already exists; it is never a separate human step. A channel that needs
  someone to remember it is a channel that goes stale, and
  [§3](#3-how-it-broke) is the proof rather than the hypothesis.
- **P3. One wheel, one executable.** A wheel carries exactly one program. Two
  executables in one wheel welds two release cadences together and makes every
  consumer download both.

**Terms used here.** A *platform wheel* is a wheel whose filename carries a
platform tag (`…-py3-none-manylinux_2_17_x86_64.whl`) so an installer picks the
build matching the machine; `manylinux` and `musllinux` are the glibc and musl
Linux tag families. *Trusted publishing* is PyPI's OIDC flow, where a named
GitHub workflow authenticates by identity and no API token exists to leak.
*Yanking* marks a release ineligible for new resolutions while leaving it
installable by exact pin — it is not deletion.

## 2. What is actually published today

Verified 2026-09-01, against pypi.org, the GitHub releases API, and this tree:

| Channel | Carries | At | Last published |
| :--- | :--- | :--- | :--- |
| **npm `vantage-md`** | the Markdown-pipeline library (`packages/vantage-md`) | current | on `vantage-md@*` tags ([`publish-npm.yml`](../../.github/workflows/publish-npm.yml)) |
| **PyPI `vantage-md`** | **the retired Python FastAPI server** — `vantage_md-0.4.2-py3-none-any.whl` + sdist, `requires-python >=3.13` | `0.4.2` | 2026-04-23 |
| **PyPI `vantage-check`** | nothing — the project does not exist (404) | — | never |
| **GitHub releases** | Go binaries, four archives (`linux`/`darwin` × `amd64`/`arm64`) | `v0.5.3` | 2026-07-20 |
| **Homebrew tap** | `Formula/vantage.rb`, generated from those archives ([`update-brew-tap.sh`](../../scripts/update-brew-tap.sh)) | `v0.5.3` | 2026-07-20 |
| PyPI `vantage` | someone else's — IKNL's distributed-learning package, `0.3.0a5`, 2020 | — | not ours |

Two things worth separating, because they look alike and are not:

- **The packaging defect** — PyPI serves a program deleted from this tree. That
  is what this doc fixes.
- **The release cadence** — `HEAD` is **102 commits** past `v0.5.3`, so the
  archive and brew channels are six weeks behind too. That is a decision about
  when to cut a release, not a defect in a channel, and it is out of scope
  ([§7](#7-non-goals)).

> [!NOTE]
> **Nothing in the tree currently advertises the PyPI path.** Today's
> [`README.md`](../../README.md) and
> [`../../userguide/getting-started.md`](../../userguide/getting-started.md)
> document `go install` and `brew install mschulkind-oss/tap/vantage` only. The
> `v0.4.2` README documented `uvx vantage-md <path>` and `pipx install
> vantage-md`, and the tap formula was `vantage-md` then rather than `vantage`.
> So the stale wheel is reachable by memory, by an old link, or by the website —
> not by any instruction in this repo. That narrows the blast radius of
> **R1**; it does not change that the channel is live and wrong.

## 3. How it broke

| Date | Tag / commit | What happened |
| :--- | :--- | :--- |
| 2026-04-23 | `4e4d744`, `v0.4.2` | *"ship vantage-md on PyPI + Homebrew with zero-config first-run"* — setuptools wheel of the Python app, frontend copied into `src/vantage/frontend_dist`, **two** console scripts (`vantage-md` and `vantage`), published by trusted publishing under an `environment: pypi` job |
| 2026-05-30 | `v0.5.0` | the Go cutover release — **zero assets attached** |
| 2026-05-30 | `e4e3120` | *"remove the Python backend, tests, and packaging"* — deletes `pyproject.toml`, `src/vantage/`, and the PyPI job |
| 2026-05-31 → 2026-07-20 | `v0.5.1`–`v0.5.3` | four Go archives each, brew formula regenerated, **no wheel, no upload** |

The diagnosis is narrower than "we forgot PyPI." The Go release path was built to
replace the *archive and Homebrew* half of the old flow, and it does that
correctly — [`publish.yml`](../../.github/workflows/publish.yml) cross-compiles
four targets, tars them onto the release, and rewrites the tap. The *wheel* half
had no counterpart written, and neither `go-to-wheel` nor `goreleaser` appears
anywhere in this tree. So PyPI kept answering with the last thing it was ever
given.

That is why **P2** is stated as an invariant rather than a preference. A dead
distribution that still resolves is worse than a missing one: `uvx vantage-check`
fails loudly and truthfully today, while `uvx vantage-md` succeeds and hands
someone a different program.

## 4. What "fixed" looks like

One new job in [`publish.yml`](../../.github/workflows/publish.yml), on the
trigger that already exists (`release: [published]`), guarded exactly as the
`build` job is, and building the frontend before it builds the binary. Sketched
at the level of the surface, not the diff:

```yaml
wheels:
  # Same guard as `build`, for the same reason: `release: [published]` takes no
  # tag filter, and `vantage-check@…` / `vantage-md@…` both start with `v`.
  if: >-
    github.event_name == 'release' && startsWith(github.ref_name, 'v')
    && !contains(github.ref_name, '@')
  environment: pypi
  permissions: { id-token: write } # trusted publishing; no token
  steps:
    # …the three steps `build` already runs: tsup the library, `npm run build`
    # the frontend, copy `frontend/dist` → `web/dist`. Then:
    - run: |
        version="${GITHUB_REF_NAME#v}"
        test -f web/dist/index.html   # see §4.1
        uvx go-to-wheel . --name vantage-md --version "$version" \
          --entry-point <OQ-P3> \
          --platforms <OQ-P4> \
          --set-version-var github.com/mschulkind-oss/vantage/internal/buildinfo.version \
          --ldflags "-X github.com/mschulkind-oss/vantage/internal/buildinfo.commit=${GITHUB_SHA::7}" \
          --readme README.md --url https://vantageapp.dev --license <OQ-P5>
    - run: uv publish dist/*.whl --check-url https://pypi.org/simple/
```

`go-to-wheel` is simonw's, `0.2` on PyPI: *"Compile Go CLI programs into Python
wheels."* It cross-compiles the module and emits `py3-none-<platform>` wheels,
with `--entry-point` naming the installed command, `--set-version-var` passing
one `-X` ldflag, and `--ldflags` for any others. The precedent is in this org:
`mschulkind-oss/swarf` publishes on release with `uvx go-to-wheel` then
`uv publish` under OIDC, and `swarf 0.4.0` on PyPI carries six wheels — glibc and
musl Linux on x86-64 and aarch64, macOS on x86-64 and arm64 (verified
2026-09-01).

Vantage needs one thing swarf does not, and it is the trap below.

### 4.1 The frontend must be bundled first, or the wheel ships a blank viewer

> [!WARNING]
> **`go build` on a clean checkout succeeds and produces a server with an empty
> site.** `web/dist` holds only `.gitkeep` in git, and
> [`web/embed.go:13`](../../web/embed.go#L13) embeds it with
> `//go:embed all:dist` — a pattern that tolerates an otherwise-empty directory.
> There is no compile error and no runtime error; the server starts and serves
> nothing. `publish.yml`'s `build` job gets this right (tsup → `npm run build` →
> `cp -r frontend/dist web/dist` → `go build`), and any wheel job must repeat
> those steps *before* invoking `go-to-wheel`. swarf is pure Go and needs none
> of it, so the precedent does not carry this over.
>
> The cheap guard is an assertion rather than a comment: `test -f
> web/dist/index.html` immediately before the build. Cross-target binaries
> cannot be executed on the runner, so this is the only check available at
> publish time.

### 4.2 Version continuity, and why the yank is not cosmetic

Numbering is not a problem: PyPI is at `0.4.2`, the next app release is
`v0.5.4`, and `0.5.4 > 0.4.2`, so the sequence stays monotonic with no special
handling. The *resolution* is the problem.

The two Python releases are `py3-none-any` — platform-independent, therefore
compatible with **every** platform. New wheels are platform-tagged for a fixed
set. So for any machine outside that set, the newest *compatible* release
remains `0.4.2`, and `uvx vantage-md` on that machine installs and runs the
retired Python app — successfully, with no warning, forever.

> [!CAUTION]
> **This is the failure that survives the fix.** Ship platform wheels without
> yanking `0.4.1` and `0.4.2`, and the dead app stops being the *only* answer
> and becomes the *silent fallback* — which is harder to notice, not easier.
> Yanking makes those versions ineligible for new resolution while leaving
> `pip install vantage-md==0.4.2` working for anyone who pinned, so the
> unsupported-platform case fails loudly instead of installing a different
> program. This is [OQ-P1](#open-questions), and it is the one item here with a
> wrong default.

### 4.3 The wheel installs one command, and the old one installed two

`go-to-wheel` takes a single `--entry-point`. The `v0.4.2` wheel declared two
console scripts, `vantage-md` and `vantage`, and its README said so: *"Both
`vantage-md` and the shorter alias `vantage` are installed and do the same
thing."* Every other channel today installs `vantage` — the archives, the tap
formula, `go install`, `just deploy`.

The choice therefore is:

| `--entry-point` | `uvx` one-shot | Installed command |
| :--- | :--- | :--- |
| `vantage-md` | `uvx vantage-md ~/notes` — the historical line, works | `vantage-md`, diverging from brew and `go install` |
| `vantage` | `uvx --from vantage-md vantage ~/notes` | `vantage`, consistent everywhere |

[OQ-P3](#open-questions), and note from [§2](#2-what-is-actually-published-today)
that no in-tree document currently advertises either — this decides what we
advertise next rather than what we break.

### 4.4 Which platforms the server wheel covers

The archives cover four targets. `go-to-wheel`'s README claims a default set
spanning glibc and musl Linux, both macOS architectures, and Windows on amd64
and arm64 — but swarf's published output is six wheels with **no Windows**, so
the default set is something to verify on the first run rather than assume. For
contrast, the CLI's own wheels cover five tags *including* `win_amd64`
([`publish-check.yml:138-142`](../../.github/workflows/publish-check.yml#L138-L142)).

The server has never shipped a Windows build and nothing tests it there, so
[OQ-P4](#open-questions) leans toward passing `--platforms` explicitly to match
the archive set. Note the interaction with [§4.2](#42-version-continuity-and-why-the-yank-is-not-cosmetic):
the narrower the set, the more machines fall through to the fallback, and the
more the yank matters.

## 5. The install matrix after the fix

| Audience | Channel | Command |
| :--- | :--- | :--- |
| Human, macOS/Linux | Homebrew | `brew install mschulkind-oss/tap/vantage` |
| Human, Go toolchain | `go install` | `go install …/cmd/vantage@latest` |
| Human, Python-first machine | **PyPI wheel** | `uvx vantage-md <path>` (subject to [OQ-P3](#open-questions)) |
| Human, neither | release archive | download and untar |
| **Agent** | **PyPI wheel** | `uvx vantage-check <file>` |
| Frontend / library consumer | npm | `npm i vantage-md` |

The server's PyPI presence is a convenience for the Python-first case, never the
recommended path — brew and `go install` stay first in the docs.

## 6. The agent CLI: its own project, or a passenger?

The question this doc exists to answer: does the lint-and-style-guide CLI need a
new PyPI project, or does it belong in the `vantage-md` project we are fixing up?

**The mechanics answer most of it.** `go-to-wheel` builds a wheel *from a Go
module*. The CLI is not Go — it is a bun-compiled binary, wrapped by
[`build-wheel.py`](../../packages/vantage-check/scripts/build-wheel.py), a
deliberately zero-dependency script that installs the binary *as* the console
script with no Python shim. Putting both programs under one project means either
abandoning `go-to-wheel` for a hand-rolled builder that packs two binaries, or
post-processing its output. And then every consumer of either program downloads
both: the CLI binary measured **92,325,064 bytes** on 2026-09-01, so a ~6 MB
server wheel becomes ~98 MB, per platform, per app release.

**Cadence is the structural half.** The app is tagged `v*`; the CLI is tagged
`vantage-check@*`, and [`publish.yml`](../../.github/workflows/publish.yml)
carries a guard whose comment explains exactly why the two namespaces must not
be confused — on a `vantage-check@0.1.0` tag, `${GITHUB_REF_NAME#v}` yields
`antage-check@0.1.0` and the job would attach nonsense to the wrong release and
push a broken formula to the public tap. One project means the checker can only
ship when the app ships, and every app release re-uploads the checker.

**Audience is the last half.** The CLI's consumer is an agent linting one file,
often in a sandbox with a cold cache; it must not fetch a server. The server's
consumer is a person reading documents; they must not fetch a 92 MB linter.

**The one real argument for folding** is that PyPI `vantage-md` already exists
with trusted publishing configured, so folding avoids registering a project and
configuring OIDC — an owner action outside this repo. That is a one-time
five-minute cost, weighed against a permanent structural one.

**And P1 points the same way.** The name says which product surface a
distribution carries. The CLI is a third surface — agent-facing tooling, not a
form of the viewer — so it takes a third name. The same reasoning that makes npm
`vantage-md` and PyPI `vantage-md` *correct* makes `vantage-check` correct.

**Leaning: its own project** ([OQ-P2](#open-questions)) — which is also what the
tree already assumes end to end:
[`publish-check.yml`](../../.github/workflows/publish-check.yml),
`build-wheel.py`'s hardcoded `DISTRIBUTION = "vantage-check"`, the review
payload's `uvx vantage-check <file>` string, and
[`../../userguide/vantage-check.md`](../../userguide/vantage-check.md).

> [!IMPORTANT]
> **The CLI's wheel path is fixed but has never run.**
> [`../reviews/agent-cli-implementation-review.md`](../reviews/agent-cli-implementation-review.md)
> §F3 found two defects — the publish step handed twine the whole `dist/`
> including the 92 MB binary, and the Windows wheel's bundled name disagreed
> with the script it execed. Both are addressed in the current workflow: wheels
> land in their own directory and only `*.whl` is uploaded, and the `.exe`
> name is asserted per target before packaging
> ([`publish-check.yml:100-145`](../../.github/workflows/publish-check.yml#L100-L145)).
> But no `vantage-check@*` tag has ever been pushed and the project does not
> exist, so the first tag is also the first execution of that path. Expect to
> watch it, and expect the first run to be where a remaining defect appears.

## 7. Non-goals

- **Not renaming anything.** npm `vantage-md` and PyPI `vantage-md` keep their
  name; the parallel is the design (**P1**). `vantage-viewer` is free on PyPI as
  of 2026-09-01 and solves a problem this doc says we do not have.
- **Not touching the npm publish, the archives, or the tap.** All three work;
  this adds a fourth path beside them.
- **Not fixing the release cadence.** 102 unreleased commits is a separate call
  ([§2](#2-what-is-actually-published-today)).
- **Not making PyPI the primary install path** ([§5](#5-the-install-matrix-after-the-fix)).
- **Not an sdist that compiles Go at install time.** It would require a Go
  toolchain on the user's machine, which is the opposite of what a wheel is for.
- **Not moving the checker into the Go binary.** Rejected in
  [`agent-cli.md`](agent-cli.md) as **R3** — a second renderer implementation
  that drifts invisibly — and nothing here changes it.
- **Not the website's install copy.** Out of this tree, and unverifiable from
  here.

## 8. Risks

| Risk | Mitigation |
| :--- | :--- |
| **R1. Silent fallback to the dead app** — `py3-none-any` `0.4.x` stays compatible with every platform, so any machine outside the wheel set resolves to it and runs the Python viewer with no warning ([§4.2](#42-version-continuity-and-why-the-yank-is-not-cosmetic)) | Yank `0.4.1` and `0.4.2`. [OQ-P1](#open-questions) |
| **R2. A wheel that serves nothing** — the embed tolerates an empty `web/dist`, so a wheel built without the frontend steps starts and serves a blank page ([§4.1](#41-the-frontend-must-be-bundled-first-or-the-wheel-ships-a-blank-viewer)) | `test -f web/dist/index.html` immediately before the build; cross-target binaries cannot be smoke-tested on the runner |
| **R3. The wheel job fails after the release is public** | Keep it a separate job with no `needs:` on `build`, so archives and the tap land regardless — the same tolerance `publish-check.yml` already documents for its own PyPI step |
| **R4. Firing on the wrong tag** — a `vantage-check@*` release also fires `release: [published]`, and an unguarded job would publish an app wheel versioned `antage-check@0.1.0` | Copy `build`'s guard verbatim. This is a documented near-miss in `publish.yml`, not a hypothetical |
| **R5. Two projects drifting about one style guide** | They share source, not copies: `packages/vantage-check` imports `vantage-md`'s TypeScript by relative path, and `check-ci` pins its katex and mermaid to `vantage-md`'s |
| **R6. `uvx` running a long-lived server is unusual** — `uvx` is built for one-shot tools; here it starts a process that serves until killed | It is what `0.4.x` did and documented. Keep it a convenience path, never the recommendation ([§5](#5-the-install-matrix-after-the-fix)) |
| **R7. License metadata disagrees across artifacts** — the repo `LICENSE` is Apache-2.0 and the tap formula says so, while `packages/vantage-md` and `packages/vantage-check` declare MIT and the CLI wheel stamps `License: MIT` | Settle before the first publish under these names; a wheel's metadata is the copy people quote. [OQ-P5](#open-questions) |

## 9. What I would do, in order

1. **Decide the yank** ([OQ-P1](#open-questions)) and do it. Owner action, one
   minute, and it is the only step that makes today's state *less* wrong on its
   own.
2. **Add the wheel job** to `publish.yml` with the guard, the frontend steps, and
   the `index.html` assertion. Settle [OQ-P3](#open-questions),
   [OQ-P4](#open-questions), [OQ-P5](#open-questions) first — all three are
   arguments to the same command.
3. **Cut the next app release** (there are 102 commits waiting) and verify the
   wheel end to end: install it on a clean machine, confirm the server serves the
   built frontend and reports the right version from
   `internal/buildinfo.version`.
4. **Register `vantage-check` on PyPI**, configure trusted publishing for this
   repo, push `vantage-check@0.1.0`, and watch that first run
   ([§6](#6-the-agent-cli-its-own-project-or-a-passenger)'s IMPORTANT).
5. **Then** [`agent-bootstrap.md`](agent-bootstrap.md) step 2 is unblocked and
   its **R1** clears — the payload's `uvx vantage-check` resolves for the first
   time.

Steps 1–3 and step 4 are independent; either order works, and only step 4 gates
the bootstrap design.

## 10. Alternatives considered

- **Parameterize `build-wheel.py` for the server too**, instead of adding
  `go-to-wheel`. Genuinely viable — it is ~160 lines and the only thing pinning
  it to the CLI is `DISTRIBUTION` and the script name. Rejected for the server
  because `go-to-wheel` is maintained, already cross-compiles a Go module to
  every tag, and has a working precedent in this org; keep `build-wheel.py` for
  the CLI, whose bun output is not a Go module.
- **`goreleaser` for the whole release**, as swarf does. Rejected as scope: the
  archive path works, and replacing it buys nothing this doc needs.
- **One project, two entry points.** Rejected —
  [§6](#6-the-agent-cli-its-own-project-or-a-passenger), and **P3**.
- **Rename the PyPI project** to `vantage-viewer` (free as of 2026-09-01).
  Rejected on **P1**: the npm/PyPI parallel is intentional.
- **Delete the PyPI project** rather than yanking. Rejected: a heavier hammer
  that forfeits a claimed name and turns `uvx vantage-md` into a 404 for people
  who have it pinned, where yanking leaves pins working.
- **Leave PyPI alone and drop it from the story.** Rejected: the channel is live
  and serving a deleted program (**P2**), and leaving it costs more the longer
  the two programs diverge.

## Open Questions

1. 💬 **OQ-P1: Yank `vantage-md` `0.4.1` and `0.4.2`?** They are `py3-none-any`,
   so they answer for every platform and become the silent fallback for any
   machine the new wheels miss ([§4.2](#42-version-continuity-and-why-the-yank-is-not-cosmetic)).
   This is the only item that improves things without any other work, and it
   gates nothing else.

   _Leaning:_ yank both, before or with the first platform wheel. Yanking keeps
   existing pins working, so the cost is close to zero and the failure it
   removes is the silent one.

   **Answer:**

   > _(empty — fill in when decided)_

2. 💬 **OQ-P2: Does the agent CLI get its own PyPI project, or ride
   `vantage-md`?** The headline question
   ([§6](#6-the-agent-cli-its-own-project-or-a-passenger)). It decides whether
   `agent-bootstrap.md`'s step 2 is one owner action or a change to the app's
   release, and it supersedes that doc's `OQ-B7`.

   _Leaning:_ its own project. Mechanics (a Go-module wheel builder cannot carry
   a bun binary without abandoning it), weight (~92 MB in every server wheel),
   cadence (`v*` versus `vantage-check@*`, whose confusion `publish.yml` already
   guards against), and audience all point the same way — and so does **P1**,
   since the CLI is a third product surface rather than another form of the
   viewer. The counterweight is one avoided owner action.

   **Answer:**

   > _(empty — fill in when decided)_

3. 💬 **OQ-P3: What is the server wheel's entry point — `vantage-md` or
   `vantage`?** `go-to-wheel` installs exactly one command; the `0.4.2` wheel
   installed both ([§4.3](#43-the-wheel-installs-one-command-and-the-old-one-installed-two)).
   It decides whether the documented one-shot is `uvx vantage-md <path>` or
   `uvx --from vantage-md vantage <path>`.

   _Leaning:_ `vantage-md`. On PyPI the one-shot *is* the point of being there,
   and `--from` is a papercut on the most-used path; the command-name divergence
   is what `0.4.x` already shipped and documented. If it grates, the honest fix
   is upstream support for two entry points, not a hand-rolled wheel.

   **Answer:**

   > _(empty — fill in when decided)_

4. 💬 **OQ-P4: Which platforms does the server wheel cover?** Match the four
   archive targets, take `go-to-wheel`'s default set (which swarf's output
   suggests is glibc + musl Linux and both macOS architectures, no Windows), or
   name something else ([§4.4](#44-which-platforms-the-server-wheel-covers)).
   Interacts with **R1**: every uncovered platform is one that falls through.

   _Leaning:_ pass `--platforms` explicitly for the four archive targets, add
   musl if it comes free, and leave Windows out until someone asks — the server
   has never shipped a Windows build and nothing tests it there. Verify what the
   default set actually produces on the first run rather than trusting the
   README.

   **Answer:**

   > _(empty — fill in when decided)_

5. 💬 **OQ-P5: Which license do the published artifacts declare?** The repo
   `LICENSE` is Apache-2.0 and the tap formula says Apache-2.0, while
   `packages/vantage-md` and `packages/vantage-check` declare MIT and the CLI
   wheel stamps `License: MIT` (**R7**). A wheel's metadata is what people
   quote, so this wants settling before the first publish under these names.

   _Leaning:_ align the published metadata to the repo `LICENSE` unless the two
   packages were deliberately licensed differently — which is a fact about
   intent that only you have.

   **Answer:**

   > _(empty — fill in when decided)_
