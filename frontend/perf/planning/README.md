# The planning index's measurement harness

This harness measures the planning index's scale targets, D1 to D10, the hold and
the first build, as
[§18 of the reference](../../../docs/reference/planning-index.md#18-scale-targets-and-what-has-been-measured)
defines them, and the planning filter's typing targets, T1 to T4, as
[§16 of its design](../../../docs/design/planning-filter.md#16-typing-targets-and-how-they-are-read)
defines them. It drives the production bundle in headless Chromium at 1440×900,
three runs per cell, on the _scale fixture_ or on a repository you name. The
scale fixture is the repository of 15 to 60 planning documents the reference
defines, and this directory builds it. A _cell_ is one target, in one scenario,
at one size.

```sh
just planning-perf                                      # every target, the fixture at 15, 30, 45 and 60
just planning-perf --size 45,60 --targets D3 --runs 40  # D3 is a slope from 45 to 60
just planning-perf --repo . --targets D1,D2,D5,D7       # this repository's column of §18
just planning-perf --targets first-build                # this repository's first build
just planning-perf --targets typing --size 15,60 --repo . --runs 10  # T1 to T4, the fixture beside this repository
just planning-perf --help                               # every option
```

It rebuilds `web/dist` (`just web-sync`; `--no-build` reuses it), builds the
binary that embeds it in a temporary directory, and serves each repository on a port
the kernel hands out, never 8000, 8101, 8200, 8201 or 5201, with a home directory
of its own. It prints each cell's runs and their median, and writes every raw run
as JSON to the OS temp directory, or to `--out`. It changes no tracked file.

`--repo` replaces the fixture, unless `--size` is given too, and then the
repository is one more subject beside the sizes, in the same interleaved runs.

It judges nothing. Compare its medians with
[§18's table](../../../docs/reference/planning-index.md#18-scale-targets-and-what-has-been-measured),
and record a result there, with its date and commit, as
[the measurement work](../../../docs/design/planning-index-measurement.md)
says. The typing targets print as percentiles over every run's keystrokes
pooled, which [§16](../../../docs/design/planning-filter.md#16-typing-targets-and-how-they-are-read)
compares, at ten runs or more. It is not part of the gate or CI, because timings on a busy machine are
noise: run it on an idle one. The JSON records the load average when it started.

| File                                                           | What it is                                                                                 |
| :------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| [`run.ts`](./run.ts)                                           | The command line: which targets, which repositories, the runs, the summary, the JSON       |
| [`scenarios.ts`](./scenarios.ts)                               | The flows each target is read from                                                         |
| [`probe.ts`](./probe.ts)                                       | What every page gets before the app's scripts run: the clocks                              |
| [`fixture.ts`](./fixture.ts)                                   | The scale fixture: written, committed and checked at run time                              |
| [`filterText.ts`](./filterText.ts)                             | The planning filter's own parser, which says what each typed text makes the applied filter |
| [`servers.ts`](./servers.ts), [`devServer.ts`](./devServer.ts) | The production server and, for D4, the Vite dev server in front of it                      |

## How each target is read

Three terms, as this harness uses them:

- **Painted**: an element present in an animation-frame callback is drawn in that
  frame. The time is read in a task queued from that callback, which runs once the
  frame's rendering is done. The earlier runs the reference records measured the
  same way.
- **Index ready**: the store logs `[planning] index ready in N ms` once per page
  session (`usePlanningStore`), where N runs from the _first need_ (the first
  build sent) to the index being set ready. The probe wraps `console.info` to
  note when the line is logged. A _page session_ is one document load, and ends
  at the next load or reload.
- **The flows**: the _main flow_ opens `roadmap.md` (or `--start`) in a new
  browser profile, waits for its index, and presses `g p`, with 200 ms between the
  keys, in the reference's three scenarios: cold, then revisit (Back, `g p` again), then
  warm (Back, reload, `g p`). Then it loads each of the hold's documents. The
  _heap flow_ is the main flow again, without the hold's documents, in a profile
  of its own, with D9's garbage collection after each `g p`; it is read for D9
  and D10 alone, because the collection slows every later `g p` of the same page
  (on 2026-10-01, warm D2 by about 34 ms). The _building flow_ is D5's, and the
  _first build_ is a cold load alone.
- **The typing flow** opens the start document in a new profile, waits for its
  index, presses `g p`, and waits for the first pages to paint and for the
  visit's review requests to be answered: two, or none outstanding for a
  settle's time. It then presses `/` and types `generator is:open` (`--query`)
  into the Filter box one key at a time, through the browser's own input
  pipeline, a key every 150 ms (`--type-gap`) on a schedule kept from the first
  key, and waits a settle's time once the whole query's results have painted.
  The _burst_ types the same query again, 30 ms a key (`--burst-gap`), in a
  visit of its own. Before any run the harness asserts, with `vantage-check
index --filter`, that the query keeps some of the page's entries and not all. Each server is loaded once first, in a
  profile thrown away, so the first measured run does not pay for the server's
  caches, or Vite's first compile, being empty.
- **The order**: every repository's server is started before any run, and each
  run takes them in turn, in an order reversed from one run to the next, so the
  machine's drift falls on every size alike. D4's runs come after, with one
  dev server at a time.

| Target      | Flow                    | Read from                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| :---------- | :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1          | main                    | The section bar painted, in ms after the `p` keydown's `timeStamp`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D2          | main                    | The first section's first entry painted; a section's entries commit together                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D3          | main                    | D2's median at the two largest fixture sizes run, as ms per document. Three runs cannot resolve it: on 2026-10-01, 40 runs a size, alternating, resolved warm against 0.5 ms per document, nearly resolved revisit, and not cold, whose D2 has two modes about 40 ms apart. Run it with `--runs 40` or more                                                                                                                                                                                                                                |
| D4          | main, on the dev server | D1 and D2, through Vite, with a dependency cache of its own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D5          | building                | The progress line painted, in ms after `p`. The planning stream is held at the network until it has, so the index is still building; `building` in the JSON says it was                                                                                                                                                                                                                                                                                                                                                                    |
| D6          | all                     | Long tasks, with the scripts that ran in them from Long Animation Frames. Planning code: every task from the `p` on; during a build, a task that handled the scan worker's messages (`Worker.onmessage`: the index assembled, and whatever React renders from it in the same task); and any task of a build that ran on the main thread                                                                                                                                                                                                    |
| D7          | main                    | The logged N, cold (the first load) and warm (the reload), with every worker the load started, so a helper or a build on the main thread shows                                                                                                                                                                                                                                                                                                                                                                                             |
| D9          | heap                    | Once `g p` has settled: Chrome DevTools Protocol garbage collection, twice, then `Runtime.getHeapUsage`, in MiB (2²⁰ bytes)                                                                                                                                                                                                                                                                                                                                                                                                                |
| D10         | heap                    | `document.getElementsByTagName("*").length` on the planning page                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| hold        | main                    | On each warm load (the start document's reload, then the first copy of each source), when each datum the hold waits for arrived, in ms after the document's content: the index as logged ready, then git status and history for the path, the recent-files list and `/info` as their responses ended. In hand means no later than the content                                                                                                                                                                                              |
| first-build | first build             | The logged N of a cold load of this repository, or of `--repo`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| T1          | typing                  | Each keystroke's Event Timing duration: the longest of its `keydown`, `keypress`, `beforeinput`, `input` and `keyup` entries, from the keydown to the next paint after their handlers, as INP reads one. The browser rounds a duration to 8 ms and reports none under 16, so such a keystroke prints as `<16`. Beside it, _echo_ is the box's own text painted, unrounded, in ms after the keydown's `timeStamp`                                                                                                                           |
| T2          | typing                  | For each keystroke whose text changes the applied filter, as [`filterText.ts`](./filterText.ts) reads it (12 of the query's 17), the sections painted under that text, in ms after its keydown's `timeStamp`. The sections' box carries the filter its layout was made under (`data-planning-filter`), set in the commit that swaps the sections in: the probe sees the change when it is committed (_committed_) and takes the next frame as its paint. One whose results never painted, because a later key's came first, counts as over |
| T3          | typing                  | Long tasks from the first keydown until the whole query's results painted, attributed as D6's are, with the long animation frames of the same span. _After typing_ counts those from then until the flow's wait ends, which holds the URL's write after the idle pause                                                                                                                                                                                                                                                                     |
| T4          | typing                  | Layout shift from the first keydown on: _cls_ as the browser scores it, and _clsAll_ counting the shifts it forgives within 500 ms of an input too, since results that land later are not forgiven                                                                                                                                                                                                                                                                                                                                         |
| burst       | typing, 30 ms a key     | The newest text wins without a backlog: the whole query's results painted, in ms after the last keydown (_settled_); the sections committed under any other text once the page has handled the last key's input (_staleAfterLast_, 0 when nothing typed past is shown); and whether the painted texts kept the order they were typed in. T1, T3 and T4 under the burst beside them                                                                                                                                                         |

## The scale fixture

[`fixture.ts`](./fixture.ts) writes it to a temporary directory at run time, commits it, and
checks it with `vantage-check index`, which derives the sections as the page does.
It never holds more than 60 planning documents, about 1.3 MB, so no run builds a
large input. `node frontend/perf/planning/fixture.ts --size 45` writes one, keeps
it, and prints where it is.

Every planning document is a renamed copy of one of four documents, read at the
commit [`fixture.ts`](./fixture.ts) pins (`SOURCES_COMMIT`), so the mix stays the reference's however those
documents change or graduate. A _card_ is one question the planning index holds,
and a KB is 1,000 bytes:

| Source                           |   KB | Cards | What its copies feed                                                |
| :------------------------------- | ---: | ----: | :------------------------------------------------------------------ |
| `docs/gallery/open-questions.md` |  8.3 |     9 | Needs you or Not on a roadmap, and Blocked, through its 🔒 question |
| `docs/design/color-themes.md`    | 36.1 |     1 | The same; the first copy is also a Stage conflict                   |
| `docs/gallery/tones.md`          |  5.2 |     0 | The first copy is Ready to build, the second Ready to graduate      |
| `docs/design/agent-bootstrap.md` | 32.0 |     5 | Needs you or Not on a roadmap                                       |

The four average 20.4 KB and 3.75 cards, as the reference requires. They repeat in that
order, so 60 holds 15 of each. A size that is not a multiple of four is as near
as it can be: 15 averages 19.6 KB and 3.67 cards, 30 averages 20.5 and 3.83, and
45 averages 20.1 and 3.87. Each size's averages are printed and asserted, within
5% and 0.15 cards.

The roadmap routes every other group of four copies, so Needs you and Not on a
roadmap both hold more than a page at every size. Besides the planning documents
there is one file over the fixture's `max-file-bytes` (Too large), and one whose
frontmatter does not parse (Unreadable). Copies are numbered, so a larger fixture
adds documents after every page a smaller one shows. From 45 documents on, every
section's first page holds the same entries, which is the fixed number of cards
D3 needs.

## What it cannot see

- **The three row sections are not full.** Ready to build, Ready to graduate and
  Stage conflict hold one document each at every size: a page of them holds 25
  rows, and no 45 documents of this mix fill even one of them. Their count is
  fixed instead, which keeps the cards shown the same from 45 to 60 just as full
  pages would.
- **"In hand" is when a response ended, for git data.** The store sets each
  answer when its response is handled, so two answers that end within a
  millisecond of each other may land in either order. The index is exact: its
  line is logged when it is set ready.
- **D6 attributes a task by the scripts that started in it.** During a build, a
  long task that ran no script (style, layout, garbage collection) is listed in
  the JSON and not counted as planning code.
- **The typing flow types as a script does.** Its rhythm is regular, the page's
  index is ready before the first key, and no input method composes. A run's
  first keystrokes also meet code that has not run in the page session yet,
  which is what a reader's first keystrokes meet too.
- **D7's one-thread case is every fixture build.** Helpers start only past 2 MiB
  of unscanned content, and the fixture is about 1.3 MB at 60, so no fixture build
  has a helper. The JSON's `helpers` shows it for each load.
