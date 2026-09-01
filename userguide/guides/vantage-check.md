# vantage-check

Vantage knows two things the agent writing your documents needs: **how to
format a document**, and **whether the document it just wrote actually
renders**. Both used to reach the agent only through a human's clipboard, and
the second one never reached it at all, because nothing checked the result.

`vantage-check` is a small standalone command that closes both loops:

```console
$ uvx vantage-check docs/            # check that documents really render
$ uvx vantage-check style-guide      # print the conventions Vantage expects
```

It is a single compiled file with its own runtime inside it: no Node, no npm,
no `node_modules`, nothing to install on the machine that runs it. And it never
talks to a server — every command works offline against files on disk, because
an agent's sandbox is not guaranteed to have a Vantage running in it.

Design background: [`../docs/design/agent-cli.md`](../../docs/design/agent-cli.md).

---

## Install

### `uvx` — nothing to install

```bash
uvx vantage-check docs/
```

`uv` fetches a wheel carrying the binary for your platform, caches it, and runs
it. This is the form the review payload puts in front of agents, because it
works in a sandbox that has nothing but Python tooling.

### `curl` — download the binary

```bash
# asset names: vantage_<version>_<os>_<arch>.tar.gz — both binaries inside
curl -fsSL "https://github.com/mschulkind-oss/vantage/releases/download/v0.5.4/vantage_0.5.4_linux_amd64.tar.gz" \
  | tar -xz vantage-check
./vantage-check docs/design/api.md
```

Archives are published on the app's own release, `v<version>`, and each one
carries **both** binaries — `vantage` and `vantage-check` — as
`vantage_<version>_<os>_<arch>.tar.gz`, where `<os>` is `linux` or `darwin` and
`<arch>` is `amd64` or `arm64`. There is no Windows build
([`../docs/design/pypi-distribution.md`](../../docs/design/pypi-distribution.md)
§4.4), and no separate `vantage-check@*` release: everything in this repo ships
on one tag at one version.

### From source

```bash
just cli          # packages/vantage-check/dist/vantage-check
```

The binary is roughly 90 MB, nearly all of which is the runtime it carries so
that nothing has to be installed next to it. It starts in about a tenth of a
second.

> [!NOTE]
> Every platform's binary is cross-compiled from a single host with
> `bun build --compile`, so a release needs one runner rather than one per
> operating system.

---

## `vantage-check check`

```bash
vantage-check <path>...                 # check is the default command
vantage-check check <path>... [options]
```

A path may be a file or a directory. Directories are walked for `.md` and
`.markdown`, skipping `node_modules` and dot-directories (which is also how
`.vantage/` stays out of it). A file named directly is checked whatever its
extension — naming it is the intent. `vantage-check check` with no path at all
checks the working directory; `vantage-check` with no arguments prints the help.

| Option | Effect |
| :--- | :--- |
| `--format text\|json` | Output format. Default `text`. |
| `--strict` | Warnings fail the run as well as errors. |
| `-q`, `--quiet` | Drop the summary line. |
| `--color` / `--no-color` | Force colour on or off (default: on when stdout is a terminal). |
| `--config <path>` | Use this `.vantage.toml`. A path that is not there is an error. |
| `--no-config` | Ignore `.vantage.toml` and use the built-in defaults. |
| `--` | Everything after it is a path, not an option. |

### Exit codes

| Code | Meaning |
| :--- | :--- |
| `0` | Nothing to fix. |
| `1` | Findings that fail the run. Configurable — see [Configuration](#configuration). |
| `2` | Bad arguments, a path that does not exist, or a config file that cannot be trusted. |
| `3` | **A check could not run.** The documents were not fully checked, so the result is *unknown*, not clean. |

Code `3` is the one worth wiring into a script properly. A validator that cannot
run — a parser that needed a browser, a file that could not be read — never
becomes a finding against your document, because a checker reporting its own
broken environment as your broken document is a checker nobody runs twice. It
says so separately, on stderr, and it wins over `1`: an incomplete run is never
reported as a clean one.

### Example

```console
$ vantage-check docs/
docs/design/api.md
  12:1  error  link/missing-target       `./overview.md` does not exist (looked for `overview.md`).
  40:3  error  link/dead-section-anchor  `#usage` matches no heading in `../guide.md`. Did you mean `#usage-notes`?

✖ 2 errors in 14 files checked
```

Findings are sorted by file, then line and column, so two runs over the same
tree print the same bytes and a report can be diffed against the previous one.

### JSON output

`--format json` emits the same run as one object:

```json
{
  "tool": "vantage-check",
  "version": "0.1.0",
  "filesChecked": 2,
  "summary": { "errors": 1, "warnings": 0, "failures": 0 },
  "findings": [
    {
      "rule": "link/missing-target",
      "severity": "error",
      "message": "`./overview.md` does not exist (looked for `overview.md`).",
      "file": "docs/design/api.md",
      "line": 12,
      "column": 1
    }
  ],
  "failures": []
}
```

`failures` is a sibling of `findings` rather than mixed into it, so a consumer
cannot mistake "we could not check this" for "this is broken" by looping over
one list.

---

## What it checks

Three groups, and the difference between them is the whole idea.

**Our rules** need *this repository on disk* and Vantage's routing semantics. No
general-purpose Markdown linter can answer them, which is why they are written
here — and why they are filesystem-verified rather than guessed at.

| Rule | Catches | Default |
| :--- | :--- | :--- |
| `link/leading-slash` | A target starting with `/`, which breaks web routing and multi-repo scoping | error |
| `link/uri-scheme` | A `file://` link, a Windows drive letter, or a UNC path | error |
| `link/missing-target` | A relative link whose target does not exist on disk | error |
| `link/line-anchor-range` | A `#L42` anchor that points past the end of its target file | error |
| `link/inverted-range` | A `#L50-L10` anchor that ends before it starts — it resolves, so a warning | warning |
| `link/line-anchor-format` | A `#L4x` anchor Vantage cannot parse, so it scrolls nowhere | error |
| `link/dead-section-anchor` | A `#section` anchor matching no heading in the target document | error |

Section anchors are checked with the *renderer's own slugger*, not a
hand-derived guess, and a near miss comes back as a suggestion
(``Did you mean `#getting-started`?``). Links come from the parsed document,
never a text search, so `[Doc](/docs/x.md)` inside inline code or a fenced block
is a code sample rather than a broken link. A link to a **directory** is not a
finding: Vantage routes those to a directory listing.

**Delegated rules** hand the question to the parser that owns it, so a diagram
fails for exactly the reason the viewer would fail on it, in that parser's own
words. `frontmatter/not-at-top` is the one that cannot be delegated: frontmatter is
recognised only at the very first byte of the file, so a comment, a directive or
one stray blank line above the opening `---` leaves the parser seeing no
frontmatter at all and nothing to report. The block renders as a horizontal rule
followed by a heading of the raw keys, and every field is gone — so this rule
strips the leading comments itself, re-parses, and says so when the block would
have parsed one line higher. Two `---` rules with a paragraph between them are
not that: the fields of real frontmatter sit *against* its delimiters, which is
what turns them into a heading, so a blank line beside either `---` means these
are horizontal rules and the rule stays quiet — even when the prose between them
happens to be something YAML would read as a key.

| Rule | Catches | Default |
| :--- | :--- | :--- |
| `frontmatter/parse` | Frontmatter that `yaml` or `smol-toml` — the viewer's own parsers — reject, so it renders as text | error |
| `frontmatter/unterminated` | An opening `---` or `+++` with no closing delimiter | warning |
| `frontmatter/not-a-mapping` | Frontmatter that parses to a value rather than a table of fields | warning |
| `frontmatter/not-at-top` | A frontmatter block with a comment or a blank line above it, so it is body text and every field is lost | error |
| `mermaid/parse` | A diagram Mermaid's own parser rejects, rendered as an error box | error |
| `katex/parse` | A `$$...$$` formula KaTeX rejects, rendered as red error text | error |
| `render/pipeline` | A document the viewer's own render pipeline throws on, end to end | error |
| `markdown/hygiene` | General Markdown hygiene via `remark-lint` | **off** |

**Vantage's own markup** is the third group: the `<!-- vantage: … -->` directives
that Vantage compiles into styling attributes and every other renderer drops. No
third party owns these questions, and there is no error to surface — a directive
that Vantage does not understand is *silently* inert by design, so a typo renders
a bare document with no message anywhere. These rules are the only thing that
will ever tell you.

| Rule | Catches | Default |
| :--- | :--- | :--- |
| `vantage/unterminated` | A `<!-- vantage:` comment with no `-->`, which deletes the rest of the document from the render | error |
| `vantage/malformed` | A `<!-- vantage: … -->` comment that does not parse, so it is ignored | error |
| `vantage/unknown-name` | A name outside `section`, `block` and `oq` — the whole directive is dropped | error |
| `vantage/unknown-key` | A key the closed vocabulary does not contain | error |
| `vantage/unknown-value` | A value outside the closed token set for its key | error |
| `vantage/list-split` | A directive between two list items, which ends the list and starts a second one | error |
| `vantage/block-split` | A directive that restructures the document around it — a table losing its remaining rows, a paragraph cut in two, a setext heading losing its underline | error |
| `vantage/duplicate-key` | The same key twice in one directive, or across a run of them, which merges the same way — the last one wins, so a warning | warning |
| `vantage/orphan` | A directive with no block it can attach to, so it styles nothing | warning |
| `vantage/frontmatter-shape` | A `vantage:` frontmatter key that is not a table of keys, so it configures nothing | warning |
| `vantage/frontmatter-key` | A key under `vantage:` this build does not know | warning |
| `vantage/frontmatter-value` | A `vantage:` value outside its closed set, so the chrome silently vanishes | error |
| `vantage/status-chip-stale` | A status chip with no `status:` to show, or one that disagrees with it | warning |

The grammar, the vocabulary and the list of blocks a directive can attach to are
all imported from the viewer's own module, so the checker cannot disagree with
the renderer about what a directive means. And like links, directives come from
the parsed document — a `<!-- vantage: … -->` inside a fenced block or backticks
is a code sample, not a finding.

`vantage/block-split` is the one rule that does not read the document so much as
*experiment* on it. A directive is invisible, so the one thing it must never do is
change the document — and the way to be sure is to take it away: the rule deletes
the directive's own lines, re-parses the block that contains them, and compares
the block structure. Only the directive's lines: a `<!-- -->` beside it is the
author's markup — CommonMark's own separator between two lists — and deleting
that would answer a question about it and blame the directive for the answer.
That catches any construct a comment at the start of a line can end,
not a list of the ones somebody thought of. `vantage/list-split` stays because the
list case has a fix of its own worth spelling out ("indent it inside the item"),
and it reports first when both apply.

"The block that contains them" is two neighbouring blocks for a directive at the
top level, and the **whole enclosing top-level block** for one indented inside a
list item, a block quote or a footnote definition — so the cost is one re-parse
of that block per directive. That is normally nothing, and it is not nothing for
the document `oq` exists for: an Open Questions list is one long top-level list
with a directive in every item, and a 40-question list measures 171 ms where the
same document with the rule off measures 0.3 ms. It grows as the square of the
question count. If you ever have a document where that matters, switching the
rule off really does buy the time back:

```toml
[check.rules]
"vantage/block-split" = "off"
```

The last four are the same family one scope up: the reserved `vantage:`
frontmatter key, which carries chrome that belongs to the *file* rather than to a
section. They are not `frontmatter/*` rules, because those delegate to `yaml` and
`smol-toml` — parsers that own the syntax and have no opinion about Vantage's
vocabulary. Once the block has parsed, everything under `vantage:` is ours, and
just as silent: a mistyped `status-chip: Draft` renders no chip and says nothing.

`vantage/frontmatter-key` is a warning while `vantage/frontmatter-value` is an
error, and the asymmetry is deliberate. An unknown *key* is what a document
written for a newer Vantage looks like to an older checker, and that must not
fail a gate. An unknown *value* for a key this build does know is a typo in the
vocabulary this build itself defines. `vantage/status-chip-stale` covers the two
ways a chip goes stale rather than wrong: a `status-chip: true` with no `status:`
to show, and a literal `status-chip: accepted` sitting above a `status: draft` —
which is why `status-chip: true`, the form that cannot disagree, is the one the
style guide recommends.

`vantage/unterminated` is an error rather than a warning because of what it
costs: Markdown reads every line below an unclosed `<!--` as part of the comment,
so a single missing `-->` deletes every heading and paragraph beneath it from the
rendered page. Nothing else in this tool notices — the document still parses,
still renders, and still passes every other rule.

`render/pipeline` is the backstop: the whole document through `renderMarkdown`,
the viewer's own function with the same plugins in the same order. Whatever the
specific rules do not cover, a throw there still catches — it is the only
end-to-end check in the tool, and it costs one render per document.

`markdown/hygiene` is off because its rules are opinions about Markdown in
general rather than statements about whether Vantage can render the document,
and everything the checker says by default should be worth acting on. Turn the
family on in config, and silence any single rule by its own `markdown/…` id.

The rules check what *renders*, not what is *pretty*. A document full of
single-`$` typos is not flagged, because single `$` is deliberately not a math
delimiter — `$100` and `$HOME` render as themselves, which is what the viewer
does.

> [!NOTE]
> Mermaid is validated **headless**, grammar only. `mermaid.parse` needs no
> browser, so that is what runs — but layout and sanitization happen at render
> time in the viewer, and a diagram that parses cleanly can still lay out badly.
> Everything else is checked against the code the viewer runs.

---

## Configuration

Optional. With no config file the defaults above apply, so the one-command path
keeps working in a bare checkout.

Put a `.vantage.toml` at the **repository root** — not in `.vantage/`, which is
transient state you are told to gitignore (see
[Review Inbox](review-inbox.md)). Discovery walks up from the first path you
pass until it finds one.

```toml
[check]
strict = false      # warnings fail the run too
exit-code = 1       # the code to exit with when findings fail the run

[check.rules]
# "error", "warning" or "off". A family is "link/*"; everything is "*".
"markdown/hygiene" = "warning"
"markdown/no-literal-urls" = "off"
"link/dead-section-anchor" = "warning"
```

`--strict` on the command line turns strict on; it cannot turn a configured
`strict = true` back off. `exit-code` is about findings only — it can make a run
with findings exit `0`, but it can never turn an unfinished run's `3` into a
clean answer.

> [!WARNING]
> A config file that is present but wrong — an unknown key, a misspelled rule
> name, a severity that is not a severity — exits `2` rather than warning. A
> typo that silently disables nothing is the kind of quiet wrongness a checker
> cannot afford.

---

## `vantage-check style-guide`

Prints the canonical Vantage Markdown conventions: relative-link rules, line
anchors, frontmatter, Mermaid label quoting, code and diff fences, callouts,
tables, and the `$$...$$` math rule.

```bash
uvx vantage-check style-guide >> AGENTS.md      # or pipe it anywhere you like
```

The same text is available in the browser: **Settings (⚙) → Agent Style Guide**
opens a modal with a copy button, for pasting into an agent's context by hand.
Both read one string in the `vantage-md` package, so the modal and the command
can never disagree. See [Style Guide for Agents](../reference/style-guide.md).

Nothing writes to your `AGENTS.md`, `CLAUDE.md` or `.gitignore` on your behalf.
If you want the guide in an agent's system prompt, put it there yourself.

---

## How agents find out about it

They are told, on every review turn. The prompt Vantage copies to your clipboard
when you [respond to review comments](review-inbox.md) opens with a line telling
the agent to run `uvx vantage-check <this file>` and fix what it reports before
delivering — a quality gate, not a delivery dependency, so an agent without
`uvx` still delivers.

That is deliberately the only channel: it needs no setup from you, it reaches
whatever environment the agent happens to have, and it arrives at the moment it
is useful — just before the work comes back to you. The trade-off is that a
document being drafted with no review round yet gets no pointer;
`vantage-check style-guide` is there for anyone who wants to wire it in earlier.

---

## In CI

```yaml
- name: Check the documentation
  run: uvx vantage-check docs/ userguide/
```

Non-zero on findings, so it fails the job. Add `--strict` to fail on warnings
too, or set `exit-code = 0` in config for an advisory run that reports without
failing anything.

---

## How it stays accurate

`vantage-check` imports the viewer's Markdown pipeline — the `vantage-md`
package — by relative path from source, rather than depending on a published
copy, so `check` runs the code the browser runs. Its KaTeX and Mermaid versions
are pinned to the viewer's by a test in the package (`test/deps.test.ts`) that
fails the gate if the two `node_modules` trees drift. A second implementation
would drift invisibly and pass documents the viewer breaks on.

---

## What it deliberately does not do

- **It does not need Vantage running.** No daemon, no port, no socket. If a
  command needed a live server, an agent could not rely on it.
- **It does not touch the network.** External `https://` links are not fetched,
  and never will be.
- **It does not rewrite your documents.** It tells you what is wrong and leaves
  the fixing to you; an agent can fix anything here once it has been told.
- **It does not edit agent configuration.** No `AGENTS.md` writes, no
  `CLAUDE.md` writes, no `.gitignore` writes.

---

## Related

- [Style Guide for Agents](../reference/style-guide.md) — the conventions the checker verifies
- [Review Inbox](review-inbox.md) — the review flow that tells agents to run it
- [CLI Reference](../reference/cli-reference.md) — the `vantage` server binary's own commands
