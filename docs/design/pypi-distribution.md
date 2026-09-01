---
title: "The PyPI half of Vantage ships software that no longer exists"
status: in-review # draft | in-review | accepted | deprecated
date: 2026-09-01
tags: [packaging, pypi, releases, cli, agents]
summary: "PyPI `vantage-md` is meant to be the executable server's distribution — the twin of npm `vantage-md`, the library. It froze in April holding the retired FastAPI app, because the Go cutover deleted the Python packaging and never replaced it. Fix the wheel path, yank the dead releases, and give the agent CLI its own project rather than a seat in the server's wheel."
---

# The PyPI half of Vantage ships software that no longer exists

**Status:** DESIGN, 2026-09-01, reviewed the same day — **OQ-P1 through OQ-P5
are settled** (see the [Decision Ledger](#decision-ledger)); the review opened
two, [OQ-P6](#open-questions) (is the built frontend tracked?) and
[OQ-P7](#open-questions) (whose wheel builder?), which are the only things still
open. Nothing built. Every claim about the tree, pypi.org, and the GitHub
releases was verified on 2026-09-01, and the checks are named inline so they can
be repeated.

**The short version.** One product name, one registry each: npm `vantage-md`
carries the library form, PyPI `vantage-md` carries the executable server. The
npm half is current. The PyPI half stopped at `0.4.2` on 2026-04-23 and still
holds the **retired Python FastAPI app**, because `e4e3120` deleted
`pyproject.toml`, `src/vantage/` and the PyPI publish job in the Go cutover and
nothing took their place. So `uvx vantage-md` today installs and runs a viewer
whose source is not in this tree. The fix is three things: publish the Go binary
as platform wheels on every `v*` release (`go-to-wheel`, as
`mschulkind-oss/swarf` already does), **yank** the two Python releases so no
platform silently resolves to them, and give the agent CLI **its own PyPI
project** rather than a seat in the server's wheel.

**The most important section is now [§4.1](#41-the-frontend-has-to-be-there-at-build-time-and-today-it-often-isnt),** which the review
turned from a wheel-job footnote into a live defect: a pristine `go build` — and
therefore `go install …@latest`, which the README documents — produces a server
that serves *"Frontend bundle not found."* [§6](#6-the-agent-cli-its-own-project-or-a-passenger)
is the reasoning behind the CLI's own project, kept because the alternative will
be proposed again.

**Reads with:** [`agent-bootstrap.md`](agent-bootstrap.md) (**depends on this
doc** — its **R1** and its step 2 are blocked until `vantage-check` is
installable), [`agent-cli.md`](agent-cli.md) (the CLI being distributed, and why
it is a compiled binary at all), and
[`../reviews/agent-cli-implementation-review.md`](../reviews/agent-cli-implementation-review.md)
§F3 (the defects that were fixed in the CLI's wheel path, and the reason nobody
has seen it work).

---

## 1. Verdict and principles

**Fix the server's wheel path, and give the CLI its own project.** As settled on
2026-09-01: yank `0.4.1`/`0.4.2`, publish `--entry-point vantage` for the four
archive targets with no Windows, declare Apache-2.0 everywhere, and register
`vantage-check` separately. Three principles, cited by number below and citable
from sibling docs:

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
with `go-to-wheel` below because that is the shape swarf proves; which builder
actually runs is [OQ-P7](#open-questions), and [§4.5](#45-which-builder--and-the-dual-entry-question-it-settles)
argues for the one we already own. The job's *shape* — trigger, guard, frontend
first, OIDC publish — is the same either way:

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

Vantage needs one thing swarf does not, and it is the trap below — which turns
out to be bigger than the wheel.

### 4.1 The frontend has to be there at build time, and today it often isn't

> [!WARNING]
> **`go build` on a pristine checkout produces a server that serves
> `Frontend bundle not found.`** — verified 2026-09-01 by building `git archive
> HEAD` in a temp directory and curling it. `web/dist` carries only `.gitkeep`
> in git (`.gitignore:10-11` ignores the rest deliberately), and
> [`web/embed.go:13`](../../web/embed.go#L13) embeds it with `//go:embed
> all:dist`, a pattern that tolerates an otherwise-empty directory. It is not
> silent: `indexHTML` logs `slog.Warn("server: embedded index.html missing;
> serving placeholder")` and serves a one-line placeholder page
> ([`internal/server/spa.go:94-101`](../../internal/server/spa.go#L94-L101)).
> But the warning goes to the server's own stderr, and what the user sees is a
> page that looks like a broken app.

**This is not a wheel problem, it is a build-input problem, and one documented
install path already has it.** `go install github.com/mschulkind-oss/vantage/cmd/vantage@latest`
— [`README.md:21-25`](../../README.md#L21-L25), no caveat attached — resolves
the module from the proxy, whose zip is the git contents, so it embeds the
`.gitkeep` and nothing else. Anyone following that line today installs the
placeholder. A wheel job would inherit the same defect, and
[`publish.yml`](../../.github/workflows/publish.yml)'s `build` job is the only
path that gets it right (tsup → `npm run build` → `cp -r frontend/dist web/dist`
→ `go build`).

There are two shapes of answer, and `mschulkind-oss/polyclav` already runs the
better one.

| | **Commit the export** (polyclav) | **Build it in every job** (today, plus a guard) |
| :--- | :--- | :--- |
| How | The built web export is a tracked artifact (`internal/web/static/app`); `just web-sync` refreshes it from `web/` sources, and `just build` runs `web-sync` first. Without pnpm it warns — *"using the committed web export (may be stale)"* — instead of failing | `web/dist` stays a `.gitkeep`; the wheel job repeats the three frontend steps, with `test -f web/dist/index.html` immediately before the build |
| Fixes `go install` | **Yes** — every checkout has a real frontend to embed | No |
| Fixes a bare `go build` | Yes | No |
| Wheel job | `uvx go-to-wheel .` alone | three npm steps plus an assertion, per job |
| Costs | A tracked build product: Vite's hashed filenames churn on every frontend change, and it can go stale silently — so `just build` must refresh it, which **reverses `.gitignore:10-11` and needs an explicit carve-out from the "no `just` recipe dirties tracked files" invariant** | Nothing tracked changes; the trap simply stays live everywhere except the release job |

Cross-target binaries cannot be executed on the runner, so an assertion on
`index.html` is the only publish-time check either way; the difference is
whether there is anything left to assert.

Which shape vantage takes is [OQ-P6](#open-questions) — the one question this
review round opened rather than closed, because committing a build product is a
repo-wide decision, not a packaging detail.

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
> program.
>
> **Ruling (2026-09-01): yank both.** [OQ-P1](#open-questions) — the cost is
> close to zero, and the failure it removes is the silent one.

### 4.3 The command is `vantage`; the one-shot pays for it

`go-to-wheel` takes a single `--entry-point`. The `v0.4.2` wheel declared two
console scripts, `vantage-md` and `vantage`, and its README said so: *"Both
`vantage-md` and the shorter alias `vantage` are installed and do the same
thing."* Every other channel installs `vantage` — the archives, the tap formula,
`go install`, `just deploy`.

**Ruling (2026-09-01): `--entry-point vantage`.** The installed command matches
every other channel, and the ephemeral one-shot becomes
`uvx --from vantage-md vantage <path>`. Note that `--from` is only the *one-shot*
tax: `uv tool install vantage-md` and `pipx install vantage-md` put `vantage` on
`PATH` with no `--from` anywhere.

> [!NOTE]
> **The two-script wheel was not a mistake.** It bought `uvx vantage-md <path>`
> with no `--from`, at the price of a second command name — a sound trade with
> setuptools, which lets a project declare as many console scripts as it likes.
> What changed is only what *`go-to-wheel`* can express: one entry point. That
> is a constraint of a candidate builder, not of wheels — a wheel's
> `.data/scripts/` directory holds as many files as you put in it, and **we
> already own a builder that writes that zip by hand**
> ([§4.5](#45-which-builder--and-the-dual-entry-question-it-settles)). So the
> route to the alias, if it is ever wanted, is ours, not an upstream patch.

### 4.4 Which platforms the server wheel covers

**Ruling (2026-09-01): the four archive targets — Linux and macOS on x86-64 and
arm64 — plus musl Linux if it comes free. No Windows.** Name the set explicitly
rather than inheriting a tool's default, and check what actually lands on the
first run: `go-to-wheel`'s README advertises Windows in its defaults while
swarf's published output has none. A static Go binary (`CGO_ENABLED=0`, which
`publish.yml` already sets) runs under glibc and musl alike, so musl is a second
*tag* on the same bytes rather than a second build — free if the builder lets us
say so ([§4.5](#45-which-builder--and-the-dual-entry-question-it-settles)).

Note the interaction with [§4.2](#42-version-continuity-and-why-the-yank-is-not-cosmetic):
every platform outside the set is one that falls through to the old release, so
a deliberately narrow set makes the yank matter more, not less.

> [!NOTE]
> **The CLI's Windows target went too**, on the same day and by the same ruling
> (`5485a0b`). It was the only place this repo claimed Windows support, and the
> only defect that ever shipped in the CLI's wheel path was Windows-specific —
> §F3's `vantage-check` bundled against a `vantage-check.exe` console script.
> Its removal took the `.exe` naming and the zip-archive branch with it, and
> `build-wheel.py` now rejects a `win_*` platform tag outright rather than
> keeping a code path nothing exercises.

### 4.5 Which builder — and the dual-entry question it settles

`go-to-wheel` is the obvious choice right up to the moment you notice **we
already own a wheel builder, and it does not care what language produced the
binary.** [`build-wheel.py`](../../packages/vantage-check/scripts/build-wheel.py)
takes `--binary`, `--platform-tag`, `--version` and writes the zip: the binary
goes in `<pkg>-<ver>.data/scripts/` as the console script itself, with no Python
shim anywhere. Nothing in those ~160 lines knows bun from Go. What is hardcoded
is only the distribution name, the script name, the summary/description, and
`Requires-Python` — roughly thirty lines of argparse away from serving both
artifacts.

| | **`go-to-wheel`** | **`build-wheel.py`, parameterized** |
| :--- | :--- | :--- |
| Go compile at release | **A second one**, inside the tool — so the wheel's binary is a different artifact from the one attached to the release | None: it wraps the binary `publish.yml` already cross-compiled, so wheel and archive are the same bytes |
| Platform set | The tool's, and it can change under us | Ours, per invocation — and since `CGO_ENABLED=0` makes the binary static, the same bytes can carry a `manylinux` **and** a `musllinux` tag with no second build |
| Entry points | Exactly one | As many as we write into `.data/scripts/` — the alias costs one generated two-line shim (`exec "$(dirname "$0")/vantage" "$@"`), not a duplicated binary and not a build backend |
| Version stamping | `--set-version-var` / `--ldflags` | Already done upstream by `publish.yml`'s own `go build` ldflags |
| Maintenance | Upstream's, free | Ours — but already ours, already exercised, and the wheel spec's surface here is frozen |
| Release chain | One more tool fetched at release time | Nothing new |

The second row is the one that changes my mind. Two builders means two Go
compiles per release and two binaries that *should* be identical; one builder
means the thing on PyPI is provably the thing on the release.

> [!NOTE]
> **The shim is POSIX-only, and that is now fine.** A `sh` shim in
> `.data/scripts/` works on Linux and macOS and would need a `.exe` on Windows —
> which is exactly the disagreement that produced §F3's defect. With Windows
> dropped from both artifacts ([§4.4](#44-which-platforms-the-server-wheel-covers)),
> the trap that made a second script name expensive is gone.

This is [OQ-P7](#open-questions), and it is the one place where "we already
built this" is an argument *for* doing more with our own code rather than an
argument for reaching outside.

## 5. The install matrix after the fix

| Audience | Channel | Command |
| :--- | :--- | :--- |
| Human, macOS/Linux | Homebrew | `brew install mschulkind-oss/tap/vantage` |
| Human, Go toolchain | `go install` | `go install …/cmd/vantage@latest` |
| Human, Python-first machine | **PyPI wheel** | `uv tool install vantage-md` then `vantage <path>`; one-shot is `uvx --from vantage-md vantage <path>` (§4.3) |
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

**Ruling (2026-09-01): its own project** — which is also what the tree already
assumes end to end:
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
- **Not Windows, for either artifact.** The server wheel covers Linux and macOS
  only, and the CLI's `win_amd64` target was removed the same day (§4.4).
- **Not the website's install copy.** Out of this tree, and unverifiable from
  here.

## 8. Risks

| Risk | Mitigation |
| :--- | :--- |
| **R1. Silent fallback to the dead app** — `py3-none-any` `0.4.x` stays compatible with every platform, so any machine outside the wheel set resolves to it and runs the Python viewer with no warning ([§4.2](#42-version-continuity-and-why-the-yank-is-not-cosmetic)) | Yank `0.4.1` and `0.4.2` — settled, and step 1 of [§9](#9-what-i-would-do-in-order) |
| **R2. A build with no frontend in it** — the embed tolerates an empty `web/dist`, so any build path that skips the three frontend steps ships a placeholder page instead of the app, warning only to the server's own stderr ([§4.1](#41-the-frontend-has-to-be-there-at-build-time-and-today-it-often-isnt)) | Depends on [OQ-P6](#open-questions): a committed export removes the failure mode, a per-job assertion catches it one job at a time. Either way, assert `web/dist/index.html` before the build — cross-target binaries cannot be smoke-tested on the runner |
| **R8. `go install` already ships the placeholder** — [`README.md:21-25`](../../README.md#L21-L25) documents `go install …/cmd/vantage@latest` with no caveat, and the module zip carries only `web/dist/.gitkeep`. Verified 2026-09-01 against a pristine `git archive HEAD` build | The same [OQ-P6](#open-questions) decision, and it is the reason that question is repo-wide rather than packaging-local. Until it is settled, the README line needs a caveat or the path needs removing |
| **R3. The wheel job fails after the release is public** | Keep it a separate job with no `needs:` on `build`, so archives and the tap land regardless — the same tolerance `publish-check.yml` already documents for its own PyPI step |
| **R4. Firing on the wrong tag** — a `vantage-check@*` release also fires `release: [published]`, and an unguarded job would publish an app wheel versioned `antage-check@0.1.0` | Copy `build`'s guard verbatim. This is a documented near-miss in `publish.yml`, not a hypothetical |
| **R5. Two projects drifting about one style guide** | They share source, not copies: `packages/vantage-check` imports `vantage-md`'s TypeScript by relative path, and `check-ci` pins its katex and mermaid to `vantage-md`'s |
| **R6. `uvx` running a long-lived server is unusual** — `uvx` is built for one-shot tools; here it starts a process that serves until killed | It is what `0.4.x` did and documented. Keep it a convenience path, never the recommendation ([§5](#5-the-install-matrix-after-the-fix)) |
| **R7. License metadata disagrees across artifacts** — the repo `LICENSE` is Apache-2.0 and the tap formula says so, while `packages/vantage-md` and `packages/vantage-check` declare MIT and the CLI wheel stamps `License: MIT` | Settle before the first publish under these names; a wheel's metadata is the copy people quote. [OQ-P5](#open-questions) |

## 9. What I would do, in order

1. **Yank `0.4.1` and `0.4.2`.** Owner action, one minute, settled. The only
   step that makes today's state *less* wrong entirely on its own.
2. **Settle [OQ-P6](#open-questions)** — committed export or per-job frontend
   build. Everything about the wheel job's shape follows from it, and so does
   whether `go install` (**R8**) is fixed or documented as broken.
3. **Settle [OQ-P7](#open-questions)** — our builder or `go-to-wheel` — then
   **add the wheel job** to `publish.yml`: `build`'s guard verbatim, a `vantage`
   entry point, the four archive targets (plus musl tags if the builder allows),
   Apache-2.0 metadata, and an `index.html` assertion before the build.
4. **Cut the next app release** (102 commits are waiting) and verify the wheel
   end to end: install it on a clean machine, confirm the server serves the real
   frontend rather than the placeholder, and that it reports the right version
   from `internal/buildinfo.version`.
5. **Register `vantage-check` on PyPI**, configure trusted publishing for this
   repo, push `vantage-check@0.1.0`, and watch that first run
   ([§6](#6-the-agent-cli-its-own-project-or-a-passenger)'s IMPORTANT).
6. **Then** [`agent-bootstrap.md`](agent-bootstrap.md) step 2 is unblocked and
   its **R1** clears — the payload's `uvx vantage-check` resolves for the first
   time.

Step 5 is independent of steps 1–4 and is the only one that gates the bootstrap
design. The Apache-2.0 alignment is not in this list because it is already
done — `packages/vantage-md`, `packages/vantage-check`, and `build-wheel.py`'s
wheel metadata all declare it as of 2026-09-01.

## 10. Alternatives considered

- **Parameterize `build-wheel.py` for the server too**, instead of adding
  `go-to-wheel`. Not rejected — on a second look this is the *leading* option,
  and it is [OQ-P7](#open-questions). The first draft of this doc dismissed it in
  favour of a maintained upstream tool, before noticing that `publish.yml`
  already cross-compiles the binaries a wheel needs, which makes the upstream
  tool's own compile a duplicate ([§4.5](#45-which-builder--and-the-dual-entry-question-it-settles)).
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
- **`--entry-point vantage-md`**, keeping the historical `uvx vantage-md <path>`
  line. Rejected 2026-09-01: the installed command should match every other
  channel. The `--from` tax lands only on the ephemeral one-shot (§4.3).
- **A hand-rolled two-entry-point wheel** to get `vantage` and `vantage-md`
  both, as the `0.4.2` setuptools wheel did. Rejected as the wrong lever — if
  the alias matters later, patch `go-to-wheel` upstream rather than owning a
  second wheel builder for the server.

## Decision Ledger

| ID | Ruling / Decision | Date | Settled in |
| :--- | :--- | :--- | :--- |
| OQ-P1 | Yank `vantage-md` `0.4.1` and `0.4.2` — the `py3-none-any` fallback is the silent failure | 2026-09-01 | §4.2, §9 step 1 |
| OQ-P2 | The agent CLI gets **its own PyPI project**, `vantage-check`; not a second executable in the server's wheel. Supersedes `agent-bootstrap.md`'s `OQ-B7` | 2026-09-01 | §6 |
| OQ-P3 | `--entry-point vantage`, matching every other channel; the one-shot is `uvx --from vantage-md vantage`. The `0.4.2` two-script wheel was a sound trade that `go-to-wheel` cannot express | 2026-09-01 | §4.3 |
| OQ-P4 | The four archive targets (Linux + macOS × x86-64 + arm64), musl if free, **no Windows**. Pass `--platforms` explicitly rather than trusting defaults | 2026-09-01 | §4.4, §7 |
| OQ-P5 | Apache-2.0 everywhere. Applied the same day to `packages/vantage-md`, `packages/vantage-check`, and `build-wheel.py`'s wheel metadata, which all declared MIT | 2026-09-01 | §8 **R7**, §9 |

## Open Questions

1. 💬 **OQ-P6: Is the built frontend a tracked artifact?** `mschulkind-oss/polyclav`
   commits its web export and refreshes it in `just build`; vantage keeps
   `web/dist` empty in git and builds it per job. Only the first shape fixes
   `go install …@latest`, which ships the placeholder page today (**R8**) — but
   it reverses a deliberate `.gitignore` decision, adds Vite's hashed-filename
   churn to every frontend commit, and needs an explicit carve-out from the
   invariant that no `just` recipe dirties tracked files. Full comparison in
   [§4.1](#41-the-frontend-has-to-be-there-at-build-time-and-today-it-often-isnt); this gates §9 step 3 and decides whether **R8** is
   fixed or merely documented.

   _Leaning:_ commit the export. `go install` is a documented install path that
   is broken right now, and no per-job assertion can reach it — the module proxy
   serves what git holds. The churn is the price, and `just build` refreshing a
   tracked file is a carve-out worth writing down rather than a rule worth
   keeping intact. I would want the sync step to warn-and-continue like
   polyclav's, so a checkout without pnpm/npm still builds.

   **Answer:**

   > _(empty — fill in when decided)_

2. 💬 **OQ-P7: Which wheel builder — ours, or `go-to-wheel`?** We already own
   `build-wheel.py`, and it is binary-agnostic; `publish.yml` already
   cross-compiles the binaries a wheel would carry. Full comparison in
   [§4.5](#45-which-builder--and-the-dual-entry-question-it-settles). It decides §9 step 3, and it decides whether a second
   entry point is ever available: `go-to-wheel` expresses one, a builder we own
   expresses as many as we write.

   _Leaning:_ ours, parameterized. The deciding fact is not the ~30 lines either
   way — it is that `go-to-wheel` would compile the Go binary a *second* time, so
   the wheel on PyPI and the archive on the release would be different artifacts
   that ought to be identical. One builder also means the wheel-spec bugs get
   fixed once, and it hands us the `manylinux` + `musllinux` double-tag on one
   static binary for free.

   **Answer:**

   > _(empty — fill in when decided)_
