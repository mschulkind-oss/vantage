# vantage-check

`vantage-check` is a small standalone binary that answers one question about a
Markdown document: **does it really render in Vantage?**

It runs the document through the *same* pipeline the viewer uses — the same
remark/rehype plugins, the same KaTeX, the same mermaid — and reports what
would break. It is a single compiled file with no runtime, works fully
offline, and checks links, math, frontmatter, Mermaid, and the render pipeline
itself.

This is the tool an agent should run before delivering a document, and the
tool to run when a page renders wrong in the browser but looks fine as text.

## Install

**With [uv](https://docs.astral.sh/uv/)** (nothing to install — it runs from
PyPI):

```bash
uvx vantage-check docs/design/api.md
```

**Directly from a GitHub release:**

```bash
# asset names: vantage-check_<version>_<os>_<arch>.{tar.gz|zip}
curl -fsSL "https://github.com/mschulkind-oss/vantage/releases/download/vantage-check%400.1.0/vantage-check_0.1.0_linux_x64.tar.gz" \
  | tar -xz
./vantage-check docs/design/api.md
```

`<os>` is `linux`, `darwin`, or `windows`; `<arch>` is `x64` or `arm64`.

## Usage

```bash
vantage-check [PATH]...            # check is the default command
vantage-check style-guide          # print the canonical style guide
```

- A **file** argument checks that file. A **directory** argument is walked
  recursively (hidden directories and `node_modules` are skipped). Omitting
  the path checks the current directory.
- Several paths may be given; their results are merged.
- `check` is the default subcommand, so `vantage-check docs/api.md` and
  `vantage-check check docs/api.md` are the same.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `--strict` | off | Treat warnings as errors (any finding exits 1) |
| `--format json` | `text` | Machine-readable output |
| `--config PATH` | discovered | Use this `.vantage.toml` instead of discovering one |

## Rules

Every rule is named `area/rule`. Line numbers are file line numbers (the
offset a document's frontmatter consumes is accounted for).

| Rule | Default | What it catches |
| --- | --- | --- |
| `link/missing-target` | error | A relative link or image target that does not resolve to a file (or resolves to a directory) |
| `link/leading-slash` | error | A `/absolute/path` href — the viewer resolves links against the document, so this never works |
| `link/uri-scheme` | error | A scheme the viewer cannot open (`file://`, drive letters, editor URIs); `http`, `https`, `mailto`, `data` are allowed |
| `link/line-anchor-range` | error | A `#L<n>` line anchor beyond the target file's last line |
| `link/dead-section-anchor` | error | A `#section` anchor that matches no heading in the target (using the viewer's own slug rules) |
| `frontmatter/unclosed` | warning | A `---` (or `+++`) block opened but never closed — it renders as visible text |
| `frontmatter/invalid` | error | A frontmatter block that is not valid YAML/TOML (the message is the parser's own) |
| `math/compile` | error | A `$$…$$` expression KaTeX cannot compile (the viewer's math engine) |
| `mermaid/parse` | error | A `mermaid` code block that fails `mermaid.parse` (the viewer's Mermaid, run headless) |
| `render/pipeline` | error | The full end-to-end render pipeline rejects the document |
| `lint/*` | warning | remark-lint's recommended preset — **opt in** via `.vantage.toml` |

The rules check what *renders*, not what is *pretty*: a document full of
single-`$` typos renders fine (as literal text) and is not flagged, because
that is what the viewer does.

## `.vantage.toml`

Optional. Discovered by walking up from each checked file's directory to the
nearest `.git` (or the filesystem root) — so it sits at the repo root. An
explicit `--config PATH` applies to every file in the run. A *missing* config
is fine (built-in defaults apply); a **present but invalid** one is an error
and exits 2 — the checker never silently falls back.

```toml
[check]
strict = false              # warnings become errors (CLI --strict also works)

[check.severity]             # per-rule overrides: "error" | "warning" | "off"
"link/missing-target" = "warning"

[check.lint]
enabled = true               # opt in to the remark-lint recommended preset
```

Precedence, highest first: a CLI flag, then the config file, then built-in
defaults.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Clean — no findings (or warnings only, without `--strict`) |
| `1` | At least one error-severity finding (or any finding under `--strict`) |
| `2` | Inconclusive — the target does not exist, a present config is invalid, or a validator could not run (an *environment* failure, e.g. a dependency that changed shape). An inconclusive run never reports green. |

## JSON output

`--format json` prints the full report:

```json
{
  "files": 3,
  "findings": [
    {
      "file": "docs/guide.md",
      "rule": "link/missing-target",
      "severity": "error",
      "line": 7,
      "message": "\"missing.md\" does not resolve to a file (...)"
    }
  ],
  "unchecked": [],
  "environmentError": null,
  "configError": null,
  "strict": false
}
```

`unchecked` lists validator ids that could not run; when it is non-empty the
exit code is 2 and `environmentError` carries the first such failure.
`configError` is set (and the exit code is 2) when a present config was
invalid.

## How it stays accurate

`vantage-check` is built from the same source as the viewer's Markdown
pipeline (the `vantage-md` package), and its KaTeX and Mermaid versions are
pinned to the viewer's — a test in the package fails the build if the two
drift. If Vantage's rendering changes, `vantage-check` changes with it; they
are released together from this repository.

One deliberate scope boundary: Mermaid is validated **headless**, grammar
only. `mermaid.parse` needs no browser, so that is what runs — but layout and
sanitization happen at render time in the viewer, and a diagram that parses
cleanly can still render badly (a typo in a label is a style bug, not a
render failure). Everything else — links, math, frontmatter, and the full
render pipeline — is checked against the real code.

## Related

- [Style Guide](style-guide.md) — the `vantage-check style-guide` command
- [Review Inbox](review-inbox.md) — agents are told to run this before
  delivering
