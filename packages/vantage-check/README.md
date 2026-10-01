# vantage-check

The agent-facing CLI for Vantage: it emits the Markdown conventions Vantage's
renderer expects, and checks that a document really renders.

```console
$ vantage-check docs/                       # check every Markdown file under docs/
$ vantage-check check docs/design/api.md --format json
$ vantage-check style-guide                 # print this release's conventions
```

Every command speaks for the binary's own release: the checks it runs and the
guide it prints are that release's, and a local build is a development build
that can be newer than every release. Which one to run for readers on an older
viewer: [Which release it writes for](../../userguide/guides/vantage-check.md#which-release-it-writes-for).

Design: [`../../docs/design/agent-cli.md`](../../docs/design/agent-cli.md).
User documentation: [`../../userguide/vantage-check.md`](../../userguide/guides/vantage-check.md).

## Why this package is shaped the way it is

- **Never published to npm.** `vantage-md` on npm stays a pure rendering
  library; this package is `"private": true` and ships only as a compiled
  binary. That keeps a lint-time dependency tree out of the library.
- **It imports `vantage-md`'s TypeScript source by relative path** rather than
  depending on the built package. A `check` that answers *"will this render in
  Vantage"* has to run the code the viewer runs; a second implementation would
  drift invisibly and pass documents the viewer breaks on.
- **It never needs a server.** Every command works offline against files on
  disk — no port, no socket, no "is Vantage running" check.

## Layout

| Path | What lives there |
| :--- | :--- |
| [`src/cli.ts`](./src/cli.ts) | Argument parsing and dispatch — no filesystem, no process |
| `src/commands/` | One file per command |
| `src/core/` | Config, file discovery, document parsing, heading slugs |
| [`src/core/runner.ts`](./src/core/runner.ts) | Every rule over every file, in one thread |
| [`src/core/parallel.ts`](./src/core/parallel.ts) | Sharding that file list across worker threads |
| `src/rules/` | One file per rule family; each owns its failure classification |
| `src/report/` | Text and JSON output |
| `scripts/` | The single-file binary and the Python wheel |

## Building the binary

```console
$ npm run build                      # dist/vantage-check for this host, ~90 MB
$ bun ./scripts/build.ts --target bun-darwin-arm64   # or any other platform
```

`npm run build` is `bun build --compile`: the whole program and a bun runtime in
one file, with the version and commit inlined at compile time. The size is the
runtime; it is the price of a tool that runs in a sandbox with nothing
installed.

Only the release workflow builds a release: it stamps the tag into
[`package.json`](./package.json) first, and `version` then prints
`vantage-check 0.8.0`. Every other build, this one included, has only the
manifest's placeholder version, so it prints
`vantage-check development build (<commit>)` instead, and so does every other
place that would name a version, such as the first line of `style-guide`.

bun cross-compiles, so **one host builds every platform** — that is why the
release job is a single runner rather than one per OS. Release CI wraps each
binary in a platform wheel ([`../../scripts/build-wheel.py`](../../scripts/build-wheel.py)) so `uvx vantage-check`
works, and attaches the archives to a GitHub release for the `curl` path.
