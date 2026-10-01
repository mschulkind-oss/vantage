# vantage-check

Vantage knows two things the agent writing your documents needs: **how to
format a document**, and **whether the document it just wrote actually
renders**. Both used to reach the agent only through a human's clipboard, and
the second one never reached it at all, because nothing checked the result.

`vantage-check` is a small standalone command that closes both loops:

```console
$ uvx vantage-check docs/            # check that documents really render
$ uvx vantage-check style-guide      # print this release's conventions
$ uvx vantage-check index            # list what the planning documents still owe
```

Both the checks and the conventions are those of the checker's own release, and
`uvx vantage-check` with no version runs the newest one. When your readers'
viewer is older than that, see
[Which release it writes for](#which-release-it-writes-for).

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

With no version, `uv` looks for a newer release on every run, so a new release
reaches an agent running bare `uvx vantage-check` within minutes of its upload,
unless its machine is offline or has installed a version with `uv tool install`.
Name a version to run exactly that one:

```bash
uvx vantage-check@0.8.0 docs/
```

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
[§4.4](../../docs/design/pypi-distribution.md#44-which-platforms-the-server-wheel-covers)), and no separate `vantage-check@*` release: everything in this repo ships
on one tag at one version.

### From source

```bash
just cli          # packages/vantage-check/dist/vantage-check
```

The binary is roughly 90 MB, nearly all of which is the runtime it carries so
that nothing has to be installed next to it. It starts in about a tenth of a
second.

A binary built this way is a **development build**: the checker's name for any
binary the release workflow did not produce. It says so wherever a release
would name its version, and it checks and teaches whatever the checkout holds,
which can be newer than every release.

> [!NOTE]
> Every platform's binary is cross-compiled from a single host with
> `bun build --compile`, so a release needs one runner rather than one per
> operating system.

---

## Which release it writes for

A checker checks and teaches for **its own release**. Its rules accept the
markup that release's viewer renders, and `style-guide` prints that release's
guide. It reads no setting and asks no server about the viewer your readers
run, so the checker's version is the version your agents write for.

That goes wrong when the checker is newer than your readers' viewer: it calls a
document clean that the older viewer renders wrongly. Bare `uvx vantage-check`
makes that the usual case for anyone who has not upgraded yet, because it runs
the newest release.

### When your readers are on 0.7

0.8.0 is the first release where this matters. A 0.7.x viewer renders two
things the 0.8.0 guide teaches wrongly:

- **An inline `<svg>` drawing.** The drawing is dropped, and the text of its
  `<title>`, `<desc>` and `<text>` elements runs together as a paragraph.
- **An `oq` directive on a 🔒 blocked or ✅ answered question**, which the
  0.8.0 guide requires. In review mode a 0.7.x viewer offers *Take this
  leaning* on it, and on a question with no leaning that button files the
  literal comment *Take the stated leaning.*

The rest of what 0.8.0 adds, a 0.7.x viewer shows without its meaning or
ignores. The `stage` and `next` frontmatter are plain metadata rows, the
`depends-on` paths are tags rather than links, and the `[planning]` table is
ignored. One [roadmap](planning.md#the-roadmap) convention costs more than that.
A roadmap written the 0.8.0 way copies no status into it, because 0.8.0 shows
the status in a [badge](planning.md#badges-on-links) beside each link. A 0.7.x
viewer draws no badges, so its reader sees no status at all.

Upgrade the viewer, or run the 0.7.1 checker for `check` and `style-guide`
until you do:

```bash
uvx vantage-check@0.7.1 style-guide
uvx vantage-check@0.7.1 docs/
```

The 0.7.1 checker knows no `planning/*` rule, so a `.vantage.toml` that names
one makes it exit `2`. `--no-config` runs it with its defaults.

### How to tell

- **The checker's release** is the first line of `style-guide`'s output from
  0.8.0 on, and `vantage-check version` prints it too. A
  [development build](#from-source) says so instead of naming a release.
- **The viewer's release** is what `vantage --version` prints. That names the
  binary installed on the machine, and a service started before an upgrade still
  runs the binary it started with.

When the checker's release is newer than the viewer's, run the viewer's release
of the checker, `uvx vantage-check@<version>`. Where the version has to stay
put, pin it, and name the same pin for your agents, as [In CI](#in-ci) shows.

### A checker older than the repository

The other direction fails loudly. To an older checker, a `.vantage.toml` key, a
rule id or a rule's option from a newer release looks like a typo, and it exits
`2`; a directive name from a newer release is a `vantage/unknown-name` error.
When the repository was written for a newer Vantage, run a newer checker, and
leave the key or the directive where it is.

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
| `--color` / `--no-color` | Force color on or off (default: on when stdout is a terminal). |
| `--config <path>` | Use this `.vantage.toml`. A path that is not there is an error. |
| `--no-config` | Ignore `.vantage.toml` and use the built-in defaults. |
| `-j`, `--jobs <n>\|auto` | Threads to check with. Default `auto` — see [Large corpora](#large-corpora). |
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
  "version": "0.8.0",
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

A finding can also carry `detail`, which is what does not fit on the message's
one line: a renderer's own error text, the values a key accepts, or what to do
about the finding. For a `vantage/unknown-*` finding, `detail` is where it says
not to remove a name that comes from a newer Vantage. Text output prints
`detail` indented under the message, so a consumer that shows a finding should
show both.

`failures` is a sibling of `findings` rather than mixed into it, so a consumer
cannot mistake "we could not check this" for "this is broken" by looping over
one list.

---

## What it checks

Four groups, and the difference between them is the whole idea.

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
| `ref/unlinked-oq` | An `OQ-…` id in prose with no link on it, or one linking to a document without naming the question | error |
| `ref/unlinked-section` | A `§N` reference with no link on it, or one pointing at a different section than the number names | error |
| `ref/unlinked-file` | A filename in prose naming a real file beside the document, with no link to it | error |

The `ref/*` family asks the question underneath the rest: **should this have
been a link at all?** A reference written as prose cannot be dead, so nothing
can ever notice when it goes stale — an `OQ-` id outlives the question, a `§`
number outlives the renumbering, a filename outlives the move, and no check
fails. Three markers are recognized because all three are unambiguous; ordinary
prose is left alone.

Resolution is **relative to the document's own directory**, so a name that
matches nothing beside it is left alone — it may be a file in another repo, a
config key, or a name in passing, and the checker cannot tell which. An
absolute path is left alone too: `/etc/resolv.conf` is not a reference to
anything a document can link to, however real the file is on the machine
running the check.

Definition sites are never findings: a question's own bold title, and the ID
column of a Decision Ledger, are where the id is *declared*. Nor is a
specimen inside a fenced block — which is how to write one on purpose, in a
document that is about the convention rather than using it.

Section anchors are checked with the *renderer's own slugger*, not a
hand-derived guess, and a near miss comes back as a suggestion
(``Did you mean `#getting-started`?``). Links come from the parsed document,
never a text search, so `[Doc](/docs/x.md)` inside inline code or a fenced block
is a code sample rather than a broken link. A link to a **directory** is not a
finding: Vantage routes those to a directory listing.

**Delegated rules** hand the question to the parser that owns it, so a diagram
fails for exactly the reason the viewer would fail on it, in that parser's own
words. `frontmatter/not-at-top` is the one that cannot be delegated: frontmatter is
recognized only at the very first byte of the file, so a comment, a directive or
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
| `vantage/oq-missing` | An open question (💬) in a list item, with an `OQ-…` id and a `_Leaning:_` line but no `oq` directive, so review mode offers no one-click answer for it | error |
| `vantage/oq-id-format` | An `oq` id that is not `OQ-`, an optional uppercase prefix and digits, which the sanitizer refuses, so the question gets no anchor | error |
| `vantage/oq-id-duplicate` | The same `oq` id twice in one document, so every `#OQ-…` link to it lands on the first | error |
| `vantage/orphan` | A directive with no block it can attach to, so it styles nothing | warning |
| `vantage/frontmatter-shape` | A `vantage:` frontmatter key that is not a table of keys, so it configures nothing | warning |
| `vantage/frontmatter-key` | A key under `vantage:` this build does not know | warning |
| `vantage/frontmatter-value` | A `vantage:` value outside its closed set, so the chrome silently vanishes | error |
| `vantage/status-chip-stale` | A status chip with no `status:` to show, or one that disagrees with it | warning |

The grammar, the vocabulary and the list of blocks a directive can attach to are
all imported from the viewer's own module, so the checker cannot disagree with
the renderer of the same release about what a directive means. And like links,
directives come from the parsed document — a `<!-- vantage: … -->` inside a
fenced block or backticks is a code sample, not a finding.

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

"The block that contains them" is two neighboring blocks for a directive at the
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

**The planning rules** are the fourth group. They read a repository's plans
rather than one page's rendering: each document's `stage` and `depends-on`
frontmatter, its `oq` directives, and the roadmaps' links, all as the
[planning index](planning.md) reads them. The viewer's badges come from the same
scan, so the gate and the page of one release cannot disagree.

| Rule | Catches | Default |
| :--- | :--- | :--- |
| `planning/stage-vocabulary` | A `stage` outside the words `[planning.stages]` declares | error, once stages are declared |
| `planning/depends-on-missing` | A `depends-on` entry whose target does not exist or lies outside the repository, or whose `#OQ-…` id appears nowhere in it | error |
| `planning/stage-disagrees` | A document whose stage has the `ready` or `built` role while it still has open questions | warning |
| `planning/unrouted` | An open question no roadmap [routes](planning.md#the-roadmap), directly or through its document | **off** |
| `planning/question-length` | A question whose text, not counting its leaning and its Answer, runs past 120 words | warning |

They run once, after every document in the run has been checked, and each one
needs only the document it reports on and the roadmaps. A roadmap that
`[planning] roadmap` lists is read with no walk of the tree, so a one-file run
costs one extra read of each. With none listed, every candidate named
`roadmap.md` is a roadmap, and the only way to know which exist is to list the
tree: `check` walks the project root's file list once per run, and only when
`planning/unrouted` is on and a document it checks has an open question.
Either way nothing is counted, so the `max-candidates` limit that stops `index`
never stops `check`. A finding is reported only against a file the run was
asked to check.

- **`planning/stage-vocabulary` does nothing without `[planning.stages]`**,
  whatever its severity: with no vocabulary declared, every word is allowed.
- **`planning/unrouted` is off until you turn it on.** It asks whether any
  roadmap has placed a question at all, which is only worth asking of a
  repository that keeps a roadmap. Set it to `"warning"` to have `check` list
  those questions without failing on them. A question in a document whose
  stage has the `done` role is never reported, and neither is anything when no
  roadmap routes. The message names the roadmap, as *not routed by the roadmap
  (roadmap.md)*, or with several, *not routed by any roadmap (roadmap.md,
  docs/plans/roadmap.md)*.
- **`planning/question-length` keeps a question readable on its card.** The
  planning page shows each question as a card that leads with its bold title
  and shows only the first few lines of the text below it, so a question
  buried in a paragraph of background, history and cross-references is one the
  reviewer has to dig for. The rule counts the words of the question's text as
  the page renders it: the list item or footnote that holds the question, or
  the block that hosts it when nothing does, title included, less every
  paragraph that states a leaning and less the `**Answer:**` paragraph and
  everything after it. A leaning is a paragraph that opens with `Leaning:`,
  however it is emphasized, with or without a note in parentheses before the
  colon (`_Leaning (revised 2026-09-04):_`), or with a dash in place of the
  colon (`Leaning —`); the card and `vantage/oq-missing` read a leaning the
  same way. So the empty placeholder below the label counts for nothing, and
  neither does a ruling written in its place. A word is anything between
  spaces that holds a letter or a digit: the status emoji is none, a link
  counts its label alone, and a path in a code span is one word. A question in
  a document whose stage has the `done` role is never measured, since the page
  shows no card for it. A question found by a heading whose `oq` directive sits
  directly above its leaning is read as that leaning alone, as its card shows
  it, so it measures nothing however long the text under the heading is. A
  finding names a question by its `id=`, or by the first 100 characters of its
  title.

  The limit of **120 words** was calibrated on 2026-09-30 against the 54
  questions Vantage's own repository had written to the convention over its
  history, each at its newest version. Half ran to 52 words or fewer and 48 to
  93 or fewer; the other six ran from 132 to 233, and none fell between 93
  and 132, so any limit in that gap finds the same six. That is where this
  repository's questions thin out, not a line between a question that buries
  what it asks and one that does not: a question of 93 words below the limit
  is as dense as one of 132 above it, and the limit is well past what a folded
  card shows, the title and about three lines. A repository whose questions
  run longer will see many warnings — in one measured on the same day, the
  median question ran to 187 words and 62% passed 120 — and should raise the
  limit with `max-words`, or turn the rule off:

  ```toml
  [check.rules]
  "planning/question-length" = { severity = "warning", max-words = 200 }
  # or: "planning/question-length" = "off"
  ```

- **The roadmaps are found from the file's [project root](#vantage-check-index)**,
  the same root `index` scans. With no root, the per-document rules still run,
  and `planning/unrouted` finds no roadmap and reports nothing.

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
# A rule with options takes a table: severity (optional) and its options.
"planning/question-length" = { severity = "warning", max-words = 150 }
```

A rule's options are whole numbers of at least 1, set on the rule by its exact
id; a family such as `"planning/*"` takes a severity only. Without `severity`,
the table leaves the rule at the severity its family, `*` or its default gives
it. Today `planning/question-length`'s `max-words` is the only option.

`--strict` on the command line turns strict on; it cannot turn a configured
`strict = true` back off. `exit-code` is about findings only — it can make a run
with findings exit `0`, but it can never turn an unfinished run's `3` into a
clean answer.

> [!WARNING]
> A config file that is present but wrong — an unknown key, a misspelled rule
> name, a severity that is not a severity — exits `2` rather than warning. A
> typo that silently disables nothing is the kind of quiet wrongness a checker
> cannot afford.

The same file's `[planning]` table
([Configuration](../reference/configuration.md#planning-documents)) is read by
the planning rules and by `index`, and it is held to the same standard: an
unknown key, a role outside the four, or a limit that is not a whole number of
at least 1 **fails every run with exit `2`**, `check` included, not only the
planning rules.

---

## `vantage-check style-guide`

Prints the Vantage Markdown conventions of the checker's own release:
relative-link rules, line anchors, frontmatter and the [planning](planning.md)
keys, Mermaid label quoting, code and diff fences, callouts, tables, and the
`$$...$$` math rule. Its first line names that release.
[Which release it writes for](#which-release-it-writes-for) says what to do
when your readers' viewer is older.

Point your agent instructions at the command rather than pasting its output
into them:

```text
Before writing Vantage documents, read the style guide:
`uvx vantage-check style-guide`
```

When your CI pins the checker, put the same version in that command
([In CI](#in-ci)).

A copy pasted into `AGENTS.md` is frozen at the release that printed it. It
goes on teaching that release's conventions after your readers upgrade, and a
copy printed by a checker newer than their viewer teaches them conventions
their viewer does not have. If you keep a copy anyway, print it with a
published release rather than a [development build](#from-source), keep its
first line so that it says which release it froze, and print it again when your
readers' viewer moves to a new release.

The app shows the guide too: **Settings (⚙) → Agent Style Guide** opens a modal
with a copy button, for pasting into an agent's context by hand. The modal shows
the viewer's own release's guide and the command shows the checker's, so they
are the same text when the two are the same release. Both read one string in
the `vantage-md` package, so within one release they can never disagree. See
[Style Guide for Agents](../reference/style-guide.md).

Nothing writes to your `AGENTS.md`, `CLAUDE.md` or `.gitignore` on your behalf.
If you want an agent to read the guide, point its instructions at the command
yourself.

---

## `vantage-check index`

```bash
vantage-check index [--format text|json] [--roadmap <path>] [--config <path> | --no-config]
```

Prints the repository's [planning index](planning.md): the sections that say
which questions need a ruling, which ones no roadmap has placed, what waits on
what, and which documents are ready to build or to graduate, then the chosen
roadmap with each link's badge written inline. It is how an agent sees what a
person sees on the [planning page](planning.md#the-planning-page), with no
server running. Design background:
[`planning-index.md` §8](../../docs/design/planning-index.md#8-vantage-check-index-and-the-planning-rules).

| Option | Effect |
| :--- | :--- |
| `--format text\|json` | Output format. Default `text`. |
| `--roadmap <path>` | The roadmap *Needs you* follows, and whose source is printed. Relative to the project root, with one leading `./` dropped; given twice, the last wins. Default: the roadmap nearest the root that routes. |
| `--config <path>` | Read this `.vantage.toml`. It never changes which project is scanned. |
| `--no-config` | Ignore `.vantage.toml` and use the built-in defaults. |

It takes no paths. It scans the **project root**, which is the nearest
directory at or above the current one holding `.git` or `.vantage.toml`, or the
current directory itself when there is none. `--config` chooses which config is
read, never which project is scanned, so a config file kept outside the tree,
such as a temporary one, does not move the scan with it. `check` finds the
roadmaps from the same kind of root, looking up from each file it checks, so
the two commands agree on the project.

**With several roadmaps**, `index` lists them all and follows one, as the
planning page does, with no memory between runs: the one `--roadmap` names,
else the one nearest the root that routes, which is the one with the fewest
directories in its path, the first by path among equals. A question is routed
when any roadmap routes it, so *Unrouted* holds only what none of them routes, and a
question only another roadmap routes is counted in one line instead:
*3 more questions need you on other roadmaps. Choose one with --roadmap
\<path\>.* A `--roadmap` that names no roadmap that routes is a bad argument,
and the message lists the ones that do.

> [!NOTE]
> **`index` is a command word.** `vantage-check index` used to check a file or
> directory named `index`, because a first argument that is not a command is a
> path. To check one now, write it as a path: `vantage-check ./index`.

### What it reads

Candidates are found the way the server finds them, from the repository's own
rules: `.md` files, skipping hidden directories, the default excluded
directories such as `node_modules` and `dist`, linked worktrees, `.vantageignore`
matches and symbolic links; then `[planning]`'s `include` and `exclude`. The
server's list is also shaped by two settings that belong to one reader rather
than to the repository, its `exclude_dirs` and the user ignore file
(`~/.config/vantage/ignore`). The checker cannot see those, so where they are
set, `index` can list a file that the viewer does not.

### Output

The text form lists each non-empty section in order, one indented line per
entry, with the notes the [Planning Documents](planning.md#its-sections) guide
describes: no roadmap, and what was looked for; a listed roadmap that could not
be read; questions on other roadmaps; no stages; or nothing that needs you.
With two or more roadmaps, in any state, a block before *Needs you* lists them,
nearest the root first. A roadmap that does not route says why: *does not
route* for one retired by a `done` stage, which was read, and *not read* for
one that is missing, too large or unreadable.

```text
Roadmaps (3)
  roadmap.md  3 need you  (chosen)
  docs/old/roadmap.md  does not route: has a stage with the done role
  docs/plans/roadmap.md  4 need you
```

Then it prints the chosen roadmap's own source, with each link that has a badge
followed by that badge in brackets, as in
`[the plan](docs/design/x-plan.md) [in-review · DECIDED]`. The other roadmaps'
sources are not printed; `--roadmap` prints any one of them. With one roadmap,
or none, there is no block. *Skipped* and *Could not read* are listed in both
forms.

`--format json` prints the whole index as one object, shown here with its
three large fields emptied:

```json
{
  "tool": "vantage-check",
  "toolVersion": "0.8.0",
  "version": 2,
  "root": "/home/me/project",
  "index": {},
  "sections": {},
  "roadmaps": []
}
```

- **`version`** is the version of this output format, so a consumer can tell
  when it changes. It is not the tool's version: that is `toolVersion` here,
  and `check`'s JSON calls it `version`.
- **`root`** is the project root that was scanned.
- **`index`** holds the effective `[planning]` config, the candidate count, and
  every planning document with its header, its questions and its links, the
  links narrowed to those that point at another candidate. *Skipped* and
  *Could not read* are here too. Each question carries the file lines it spans,
  `unitLine` to `unitEndLine`, and `cardChars`, the length of the Markdown its
  card shows on the planning page, which is what the page's
  [pages](planning.md#pages) are cut by.
- **`sections`** holds the same lists the text form prints, for the chosen
  roadmap. `sections.roadmaps` lists every roadmap nearest the root first, each
  with its `path`, its `state` (`routes`, `done`, `skipped`, `unreadable`, or,
  for a listed one the index does not hold, `missing`) and its
  `needsYouCount`, the length of *Needs you* when it is chosen.
  `sections.chosenRoadmap` is the one followed, or `null` when none routes.
  `sections.onOtherRoadmaps` holds the open and answered questions another
  roadmap routes and the chosen one does not, each once, with the first
  roadmap that routes it.
- **`roadmaps`** has one entry per entry of `sections.roadmaps`, in the same
  order: its `path`, its `state`, whether it is `chosen`, and its `links`, one
  per link in it with its line, its target and the badge it gets. `links` is
  empty unless the file was read, which is the `routes` and `done` states.

A refused project prints `null` for both `sections` and `roadmaps`. Version 2
replaced version 1's `sections.roadmap` and top-level `roadmap` when a
repository could have several roadmaps, and `index.config.roadmap` became
`index.config.roadmaps`: the listed paths, or `null` when roadmaps are found
by name.

### Exit codes

| Code | Meaning |
| :--- | :--- |
| `0` | It ran. |
| `2` | Bad arguments, a `--roadmap` that names no roadmap that routes, or a config file that cannot be trusted. |
| `3` | It could not run, which includes a project with more candidates than `max-candidates`, whatever `--roadmap` says. It prints how many there are, and nothing is scanned. |

It never exits `1`: `index` reports and does not judge. Failing a build on what
the index finds is `check`'s job, through the planning rules above.

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

## Large corpora

`check` runs on several threads by default, and the report is the same either
way: shards are contiguous slices of the file list, merged in order, so a
parallel run prints the bytes a single-threaded one would have printed. `just
check` in the Vantage repository asserts exactly that, by diffing a four-thread
run's JSON against a one-thread run's.

`auto` spends one thread per 12 files, up to six and never more than the machine
has cores. Six is a measured ceiling rather than a safety margin: each thread
initializes the binary's own module graph in a fresh JavaScript VM, and past six
that cost grows faster than the parallelism pays for it. Measured on a 32-core
machine:

| Files | `--jobs 1` | `auto` | `--jobs 16` | `--jobs 32` |
| ----: | ---------: | -----: | ----------: | ----------: |
|    36 |     1261ms | 1008ms |           — |           — |
|   110 |     4378ms | 1966ms |      3778ms |      7995ms |
|   750 |    22857ms | 6153ms |      9123ms |     17901ms |

Override it when your machine says otherwise:

```bash
vantage-check docs/ --jobs 12     # more threads
vantage-check docs/ --jobs 1      # this thread only
export VANTAGE_CHECK_JOBS=4       # a default for this machine
```

`VANTAGE_CHECK_JOBS` is where a CI runner or a workstation pins the count;
`--jobs` beats it. There is deliberately **no `jobs` key in `.vantage.toml`**:
how many threads to use is a fact about the machine, not about the repository,
so a committed number would be wrong for everyone who checks the tree out
somewhere else.

A thread that dies takes its files with it, and the run says so — `run/shard`
on stderr and exit `3`, naming the files that were not checked. It never reports
a short run as a clean one.

---

## In CI

```yaml
- name: Check the documentation
  run: uvx vantage-check@0.8.0 docs/ userguide/
```

Non-zero on findings, so it fails the job. Add `--strict` to fail on warnings
too, or set `exit-code = 0` in config for an advisory run that reports without
failing anything. On a small runner, pin the thread count with
`VANTAGE_CHECK_JOBS` — see [Large corpora](#large-corpora).

**Pin the version.** Without one, the job runs whichever release is newest, so
a release with a new rule can turn it red on a commit that changed nothing, and
it checks for the newest viewer rather than the one your readers run.

**Name the same pin for your agents**, in `AGENTS.md` or wherever their
instructions live:

```text
Check Vantage documents with `uvx vantage-check@0.8.0 <paths>`, the version CI
runs, and read the style guide with `uvx vantage-check@0.8.0 style-guide`.
```

Otherwise an agent on a newer checker can write configuration only that checker
knows, such as a new rule id in `[check.rules]`, and the pinned job fails on it
with exit `2`. Raise both pins together, deliberately.

---

## How it stays accurate

`vantage-check` imports the viewer's Markdown pipeline — the `vantage-md`
package — by relative path from source, rather than depending on a published
copy, so `check` runs the code the browser runs in a viewer of the same
release. Its KaTeX and Mermaid versions are pinned to the viewer's by a test in
the package (`test/deps.test.ts`) that fails the gate if the two `node_modules`
trees drift. A second implementation would drift invisibly and pass documents
the viewer breaks on.

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
