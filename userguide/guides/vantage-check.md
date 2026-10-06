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

How it works inside: [`docs/reference/agent-cli.md`](../../docs/reference/agent-cli.md).

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
([`docs/reference/pypi-distribution.md`](../../docs/reference/pypi-distribution.md)
[§6.3](../../docs/reference/pypi-distribution.md#63-platforms)), and no separate `vantage-check@*` release: everything in this repo ships
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
guide. It asks no server about the viewer your readers run, and a
[`target`](../reference/configuration.md#the-oldest-release-your-readers-use)
in `.vantage.toml` changes only one thing it checks, which directive name it
asks for on an open question ([below](#when-your-readers-are-on-07)), so the
checker's version is the version your agents write for.

Bare `uvx vantage-check` runs the newest release, so the checker is often
newer than your readers' viewer. That is safe by design: a release never gives
existing notation a new meaning. What a newer guide adds is a directive name,
key or value that an older viewer drops without harm, and a drawing an older
viewer cannot show comes with a fallback it shows instead
([`checker-version-skew.md` P0 and P1](../../docs/design/checker-version-skew.md#1-verdict-and-the-principles)).
So run the newest checker even when your readers have not upgraded.

### When your readers are on 0.7

0.8.0 is the first release where this matters. A 0.7.x viewer cannot show two
things the 0.8.0 guide teaches:

- **An inline `<svg>` drawing.** The drawing is dropped, and the words of its
  `<text>` elements are left behind as loose text, with those of any `<title>`
  or `<desc>` (GitHub prints those tags too). The 0.8.0 guide pairs every
  drawing with a
  [fallback block](../../docs/reference/inline-markup.md#fallback-blocks),
  which a 0.7.x viewer shows, so its reader is at least told what is missing,
  and it names a drawing with `aria-label` rather than `<title>`.
- **The one-click answer on an open question.** A `question` directive, which
  0.8.0 writes on every question, is dropped like any directive name a viewer
  does not know, so there the question has no anchor and no *Take this
  leaning*; it is never misread. A repository whose readers are still on 0.7
  keeps the `oq` that 0.7.x offers *Take this leaning* on, on its open
  questions, until they upgrade, and never on a 🔒 blocked or ✅ answered one,
  which every 0.7.x viewer would offer to answer (`vantage/question-name`).
  `vantage/oq-deprecated` warns on each `oq` it keeps, and fails a `--strict`
  run, so say at the top of `.vantage.toml` that your readers are on 0.7:

  ```toml
  # .vantage.toml, above the first [table]
  target = "0.7"
  ```

  From 0.8.1, `vantage-check` then leaves those `oq`s alone, tells an open
  question written with no directive to take an `oq`, and still reports an
  `oq` on a 🔒 or ✅ question. A checker before 0.8 ignores the line. A 0.8.0
  checker reads it but still warns, so where one runs, also turn the rule off
  with `"vantage/oq-deprecated" = "off"` under `[check.rules]`, a line a
  checker before 0.8 exits `2` on, as on any rule it does not know.

The rest of what 0.8.0 adds, a 0.7.x viewer shows without its meaning or
ignores. The `stage` and `next` frontmatter are plain metadata rows, the
`depends-on` paths are tags rather than links, and the `[planning]` table is
ignored. One [roadmap](planning.md#the-roadmap) convention costs more than that.
A roadmap written the 0.8.0 way copies no status into it, because 0.8.0 shows
the status in a [badge](planning.md#badges-on-links) beside each link. A 0.7.x
viewer draws no badges, so its reader sees no status at all.

Do not run the 0.7.1 checker for those readers. It reports 0.8.0's `question`
and `fallback` directives as `vantage/unknown-name` errors, and it exits `2` on
a `.vantage.toml` that names a `planning/*` rule. Upgrade the viewer when you
can, and until then keep running the newest checker.

### How to tell

- **The checker's release** is the first line of `style-guide`'s output from
  0.8.0 on, and `vantage-check version` prints it too. A
  [development build](#from-source) says so instead of naming a release.
- **The viewer's release** is what `vantage --version` prints. That names the
  binary installed on the machine, and a service started before an upgrade still
  runs the binary it started with.

Where the checker's version has to stay put, pin it, and name the same pin for
your agents, as [In CI](#in-ci) shows.

### A checker older than the repository

To an older checker, a `.vantage.toml` key, a rule id or a rule's option from a
newer release looks like a typo. From 0.8.0 it warns on stderr, names its own
release, ignores the key and checks under the rest of the file
([Keys From a Newer Release](../reference/configuration.md#keys-from-a-newer-release)).
Checkers before 0.8.0 exit `2` instead. A directive name from a newer release
is a `vantage/unknown-name` error to both. When the repository was written for
a newer Vantage, run a newer checker, and leave the key or the directive where
it is.

A repository can say so outright, with a
[`target`](../reference/configuration.md#the-oldest-release-your-readers-use)
at the top of its `.vantage.toml`. A checker from 0.8.0 on that is older than
the target refuses to run: it exits `2` with one message naming the release it
needs, and checks nothing.

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
| `2` | Bad arguments, a path that does not exist, a config file that cannot be trusted, or a `target` newer than the checker. |
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
about the finding. For a `vantage/unknown-*` or `vantage/frontmatter-value`
finding, `detail` is where it says not to remove a name or a value that comes
from a newer Vantage. Text output prints
`detail` indented under the message, so a consumer that shows a finding should
show both.

`failures` is a sibling of `findings` rather than mixed into it, so a consumer
cannot mistake "we could not check this" for "this is broken" by looping over
one list.

---

## What it checks

Five groups, and the difference between them is the whole idea.

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
| `vantage/unknown-name` | A name outside `section`, `block`, `question`, `oq` and `fallback` — the whole directive is dropped | error |
| `vantage/unknown-key` | A key the closed vocabulary does not contain | error |
| `vantage/unknown-value` | A value outside the closed token set for its key | error |
| `vantage/list-split` | A directive between two list items, which ends the list and starts a second one | error |
| `vantage/block-split` | A directive that restructures the document around it — a table losing its remaining rows, a paragraph cut in two, a setext heading losing its underline | error |
| `vantage/duplicate-key` | The same key twice in one directive, or across a run of them, which merges the same way — the last one wins, so a warning | warning |
| `vantage/oq-missing` | An open question (💬) in a list item, with an `OQ-…` id and a `_Leaning:_` line but no `question` directive, so review mode offers no one-click answer for it. Under a [`target`](../reference/configuration.md#the-oldest-release-your-readers-use) before 0.8 it asks for an `oq` instead | error |
| `vantage/question-name` | An `oq` directive on a 🔒 blocked or ✅ answered question, which every Vantage before 0.8 offers to answer in one click, or a question directive below a 🔒 or ✅ title outside a list, where it lands on an unmarked block and the question reads as open | error |
| `vantage/oq-deprecated` | Any other `oq` directive: it still works in every Vantage, and the message quotes the `question` directive to write instead, keys unchanged. Not reported under a [`target`](../reference/configuration.md#the-oldest-release-your-readers-use) before 0.8, whose readers answer only an `oq` in one click | warning |
| `vantage/question-layout` | A question's `_Leaning:_` run into a paragraph with other text — after the title or the context, or followed by its `**Answer:**` — which neither the page nor the planning card can lay out as its leaning | warning |
| `vantage/oq-id-format` | A question directive's id that is not `OQ-`, an optional uppercase prefix and digits, which the sanitizer refuses, so the question gets no anchor | error |
| `vantage/oq-id-duplicate` | The same id on two questions in one document, on `question` or `oq` directives, so every `#OQ-…` link to it lands on the first (one run of directives is one question) | error |
| `vantage/orphan` | A directive with no block it can attach to, so it styles nothing, or a `fallback` above a heading or a raw `<img>`, `<figure>` or `<details>`, which it never withholds, or merged with another directive, which goes with its block | warning |
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
the documents the question directives exist for: an Open Questions list is one long top-level list
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
fail a gate. An unknown *value* for a key this build does know is usually a typo
in the vocabulary this build itself defines, and its `detail` gives the same two
branches as the directive findings: fix a typo, keep a newer Vantage's value. `vantage/status-chip-stale` covers the two
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
frontmatter, its `oq` and `question` directives, and the roadmaps' links, all as the
[planning index](planning.md) reads them. The viewer's badges come from the same
scan, so the gate and the page of one release cannot disagree.

| Rule | Catches | Default |
| :--- | :--- | :--- |
| `planning/stage-vocabulary` | A `stage` outside the words `[planning.stages]` declares | error, once stages are declared |
| `planning/depends-on-missing` | A `depends-on` entry whose target does not exist or lies outside the repository, or whose `#OQ-…` id appears nowhere in it | error |
| `planning/stage-disagrees` | A document whose stage has the `ready` or `built` role while it still has open questions | warning |
| `planning/unrouted` | An open question no roadmap [links to](planning.md#the-roadmap), directly or through its document | **off** |
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
- **`planning/unrouted` is off until you turn it on.** It reports what the
  planning page lists under *Not on a roadmap*: an open question no roadmap
  links to, neither at its `#OQ-…` anchor nor through a link to its whole
  document, which is only worth asking of a repository that keeps a roadmap.
  Set it to `"warning"` to have `check` list those questions without failing on
  them. A question in a document whose stage has the `done` role is never
  reported, and neither is anything when no roadmap can be read. The message
  names the roadmap, as *is not on a roadmap: the roadmap (roadmap.md) links
  neither to it nor to this document as a whole*, or with several, *no roadmap
  (roadmap.md, docs/plans/roadmap.md) links to it or to this document as a
  whole*. It then says where the question goes is yours to confirm, and points
  at `vantage-check index --request unrouted`, which asks an agent for a
  proposal rather than a placement.
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
  shows no card for it. A question found by a heading whose directive sits
  directly above its leaning is read as that leaning alone, as its card shows
  it, so it measures nothing however long the text under the heading is. A
  finding names a question by its `id=`, or by the first 100 characters of its
  title, and says how a question is written in parts, since a leaning run into
  another paragraph counts here as the question's own words
  (`vantage/question-layout` reports that on its own).

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

**Prose** is the fifth group, and its rule is a warning: it reports how a
paragraph reads, which can be meant, rather than something that does not work.

| Rule | Catches | Default |
| :--- | :--- | :--- |
| `prose/inline-list` | A paragraph that runs three or more enumerators together, as `(a) … (b) … (c)`, instead of a list | warning |

`prose/inline-list` reads every paragraph, in a list item, a quote or a
footnote as much as at the top level, and fires on one that holds a run of
three or more parenthesized enumerators: `(a) (b) (c)`, `(A) (B) (C)`,
`(1) (2) (3)` or `(i) (ii) (iii)`, each the next in its sequence from the
first, in the order they are written, and each after some text of the item
before it. So a lone `(c) 2026`, a reference to `(1)`, a call such as `f(a)`
and the two terms of "either (a) or (b)" are all left alone. So are terms with
nothing but punctuation, `and`, `or` or `nor` between them, as in "certified
(a), (b) or (c)", which name items written somewhere else rather than write
them, and a run that already sets each term after the first on a line of its
own with a hard line break or a `<br>`. It reports a paragraph once, at the
first term of its run, and fixes nothing, because rewriting a sentence into a
list is the author's call. Headings and table cells are never read (GFM cannot
put a list in a cell), and neither are code blocks, math, HTML blocks, link
destinations or the text of inline code, whether in backticks or in a
`<code>`, `<kbd>` or `<samp>` tag, so a specimen written as code is safe.

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
> A value the checker cannot take for a key it knows (a severity that is not a
> severity, a `strict` that is not `true` or `false`) exits `2` rather than
> warning. A key, rule id or rule option it does not know is different: it may
> come from a newer release, so the checker warns on stderr, ignores it and
> checks under the rest of the file. The warning names the checker's release
> and says to keep the line if the repository is configured for a newer
> checker, or to fix it if it is a typo
> ([Keys From a Newer Release](../reference/configuration.md#keys-from-a-newer-release)).

The same file's `[planning]` table
([Configuration](../reference/configuration.md#planning-documents)) is read by
the planning rules and by `index`, and it is held to the same standard: a role
outside the four, or a limit that is not a whole number of at least 1, **fails
every run with exit `2`**, `check` included, not only the planning rules. An
unknown key there is warned about and ignored, and the server of the same
release does the same.

A `target` at the top of the file names the oldest Vantage release your
readers use, and a checker older than it refuses to run
([The Oldest Release Your Readers Use](../reference/configuration.md#the-oldest-release-your-readers-use)).

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
vantage-check index [--format text|json] [--request [<section>…]] [--roadmap <path>] [--filter <text>] [--config <path> | --no-config]
```

Prints the repository's [planning index](planning.md): the sections that say
which questions need a ruling, which ones no roadmap has placed, what is
blocked, and which documents are ready to build or to graduate, each with a line
saying what it means and who acts on it, then the chosen roadmap with each
link's badge written inline. With `--request`, it prints instead the
[request to hand an agent](#agent-requests) for the sections an agent works
on. With `--filter`, it prints only what a
[planning filter](planning.md#filtering-the-page) keeps, and a link to the
planning page filtered the same way. It is how an agent sees what a person sees
on the [planning page](planning.md#the-planning-page), with no server running.
How it works:
[`planning-index.md` §13](../../docs/reference/planning-index.md#13-vantage-check-index-and-the-planning-rules).

| Option | Effect |
| :--- | :--- |
| `--format text\|json` | Output format. Default `text`. |
| `--request [<section>…]` | Print the [agent request](#agent-requests) for these sections instead: `unrouted` (*Not on a roadmap*), `ready` (*Ready to build*), `graduate` (*Ready to graduate*) or `disagrees` (*Stage conflict*), any of them, separated by spaces. Default: all four. Takes no `--format json`. |
| `--roadmap <path>` | The roadmap *Needs you* follows, and whose source is printed. Relative to the project root, with one leading `./` dropped; given twice, the last wins. Default: the nearest the root of the roadmaps it can follow, which are those it can read whose stage has no `done` role. |
| `--filter <text>` | Show only the entries a [planning filter](planning.md#filtering-the-page) keeps, the text the planning page's Filter box takes, such as `'path:/docs/design/search.md is:open'` or `'generator is:open'`, and print a link to the page filtered the same way ([Filtering](#filtering)). Also `--filter=<text>`. Given twice, the texts join with a space; an empty one is no filter. Works with `--format json`, `--request` and `--roadmap`. |
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
else the one nearest the root that it can follow, a roadmap it can read whose
stage has no `done` role: the one with the fewest directories in its path, the
first by path among equals. *Not on a roadmap* holds
only the open questions no roadmap links to, and a question only another roadmap
links to is counted in one line instead:
*3 more questions need you on other roadmaps. Choose one with --roadmap
\<path\>.* A `--roadmap` that names no roadmap it can follow is a bad
argument, and the message lists the ones it can.

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

The text form lists each non-empty section in order: its title and count, the
line that explains it, then one indented line per entry. The sections are the
planning page's, with the same titles and lines
([Planning Documents](planning.md#its-sections)). On the page, *you* is the
person reading it; an agent reads this output, so the heading of a section that
is the person's to act on says so, as in *Needs you (4) · for the human*, and
an agent does not take *Rule each* as meant for it:

```text
Ready to graduate (2)
Built, with no questions left. An agent turns it into a reference doc.
  docs/design/api.md  [accepted · BUILT]
  docs/design/search.md  [accepted · BUILT]
```

A *Blocked* document's line names what it waits on, as
`docs/c.md  blocked on docs/a.md`. Before the sections come the notes the
guide describes: no roadmap, and what was looked for; a listed roadmap that
could not be read; questions on other roadmaps; or nothing that needs you.
With no stages declared, the line saying so stands where the stage sections
would be, after *Blocked*. After the sections, when a section an agent works
on has an entry, one line points at `--request`.
With two or more roadmaps, in any state, a block before *Needs you* lists them,
nearest the root first. A roadmap it cannot follow says why: *ignored* for one
retired by a `done` stage, which was read, and *not read* for one that is
missing, too large or unreadable.

```text
Roadmaps (3)
  roadmap.md  3 need you  (chosen)
  docs/old/roadmap.md  ignored: has a stage with the done role
  docs/plans/roadmap.md  4 need you
```

Then it prints the chosen roadmap's own source, with each link that has a badge
followed by that badge in brackets, as in
`[the plan](docs/design/x-plan.md) [in-review · DECIDED]`. The other roadmaps'
sources are not printed; `--roadmap` prints any one of them. With one roadmap,
or none, there is no block. *Too large* and *Unreadable* are listed in both
forms.

`--format json` prints the whole index as one object, shown here with its
four large fields emptied:

```json
{
  "tool": "vantage-check",
  "toolVersion": "0.8.0",
  "version": 2,
  "root": "/home/me/project",
  "index": {},
  "sections": {},
  "sectionGuide": [],
  "roadmaps": []
}
```

- **`version`** is the version of this output format, so a consumer can tell
  when it changes. It is not the tool's version: that is `toolVersion` here,
  and `check`'s JSON calls it `version`.
- **`root`** is the project root that was scanned.
- **`index`** holds the effective `[planning]` config, the candidate count, and
  every planning document with its header, its questions and its links, the
  links narrowed to those that point at another candidate. *Too large* and
  *Unreadable* are here too. Each question carries the file lines it spans,
  `unitLine` to `unitEndLine`, and `cardChars`, the length of the Markdown its
  card shows on the planning page, which is what the page's
  [pages](planning.md#pages) are cut by. Its `directive` is the name that
  declared it, `question` or the deprecated `oq`; whether a question is offered
  to answer in one click is its `state`'s to say, never the name's.
- **`sections`** holds the same lists the text form prints, for the chosen
  roadmap. `sections.roadmaps` lists every roadmap nearest the root first, each
  with its `path`, its `state` (`routes`, `done`, `skipped`, `unreadable`, or,
  for a listed one the index does not hold, `missing`) and its
  `needsYouCount`, the length of *Needs you* when it is chosen.
  `sections.chosenRoadmap` is the one followed, or `null` when there is none
  to follow. `sections.onOtherRoadmaps` holds the open and answered questions
  another roadmap links to and the chosen one does not, each once, with the
  first roadmap that links to it. Its keys are the sections' ids in camel case, and
  `unreadable` is *Unreadable*'s.
- **`sectionGuide`** lists every section in page order, as the page shows it:
  its `id` (`needs-you`, `unrouted`, `waiting`, `ready`, `graduate`,
  `disagrees`, `skipped`, `could-not-read`), the `key` of `sections` holding its
  entries, its `title`, its `explanation` line, and its `actor`: `you`,
  `agent` or `nobody`, whoever acts next on its entries.
- **`roadmaps`** has one entry per entry of `sections.roadmaps`, in the same
  order: its `path`, its `state`, whether it is `chosen`, and its `links`, one
  per link in it with its line, its target and the badge it gets. `links` is
  empty unless the file was read, which is the `routes` and `done` states.

A refused project prints `null` for `sections`, `sectionGuide` and
`roadmaps`. Version 2 replaced version 1's `sections.roadmap` and top-level
`roadmap` when a repository could have several roadmaps, and
`index.config.roadmap` became `index.config.roadmaps`: the listed paths, or
`null` when roadmaps are found by name. A new key, such as `sectionGuide`,
keeps the version; a changed one bumps it.

A section's title is display text, and its id is what a script should read:
the ids, the JSON keys and the rule ids never change when a title does. That
is why some differ from their titles, such as `waiting` for *Blocked*: they are
the sections' names from before the titles were settled.

### Filtering

`--filter` takes a planning filter: the text the planning page's Filter box
and its `filter=` address read, with the same code. Its terms are separated by
spaces:

- **Words and `"quoted phrases"`** search what the index holds about each
  entry, in any case: a question's id, title, leaning and path, a document
  row's path, `stage` and `next`, and a *Too large* or *Unreadable* path.
  Every word must match.
- **`path:<pattern>`** keeps documents whose path holds the pattern, in any
  case, and **`is:open`** open questions. A `*` in a pattern stands for any
  characters within one folder or file name, `**` for any across folders, or
  for any number of folders as a folder's whole name, as in `docs/**/x.md`,
  and a leading `/` ties it to the start of the path. `path:` terms keep any
  of their matches.
- **A `-` before any term** leaves out what it matches, as in `-payload` or
  `-path:docs/archive`.

A word before a `:` that is not `path` or `is`, as in `stage:ready`, is
searched as text, and a line under the notice's first line says *`stage:` is
not a filter key*. [Writing a filter](planning.md#writing-a-filter) has every
form, and `vantage-check help` lists them. Quote the text for your shell.

The text output starts with the filter notice, in the page's words with code
between backticks, then the `Planning page:` line and how to use it, then the
usual output over the filtered sections:

```console
$ vantage-check index --filter 'path:/docs/design/search.md path:/docs/design/search-plan.md is:open'
Filtered by `path:/docs/design/search.md path:/docs/design/search-plan.md is:open`: 3 of 7 entries, in 2 of 5 paths, 3 of them open questions.
1 of its questions is blocked and will need you later.
docs/design/search.md waits on docs/design/indexing.md, which this filter leaves out.
Run without --filter to see the other 4.
Planning page: /.vantage/planning?filter=path:/docs/design/search.md+path:/docs/design/search-plan.md+is:open
  Press / on the planning page and paste this line, or put the scheme, host and port you open Vantage at in front of the link.

Needs you (3) · for the human
Open or answered questions on this roadmap, in its order. Rule each open one, then Copy answers.
  docs/design/search.md:13  💬 OQ-S1: Is search case-sensitive?  (Roadmap)
  docs/design/search.md:19  💬 OQ-S2: Does it search code blocks?  (Roadmap)
  docs/design/search-plan.md:9  💬 OQ-SP1: One worker or two?  (Roadmap)
```

- **The filter is echoed in its canonical text,** the one spelling the page
  writes too: `path:./docs/design/search.md` reads
  `path:/docs/design/search.md`, and `path:"docs/x.md"` reads `path:docs/x.md`.
  The leading `/` stays, since without it `path:docs/design/search.md` would
  keep `old/docs/design/search.md` too.
- **The link is root-relative.** It starts at `/.vantage/planning`, with no
  scheme, host or port, because the checker never asks a server, so it cannot
  know the address the human opens Vantage at: a port that moved on from a busy
  8000, a daemon's name for the repository, a tunnel, a container. The human
  pastes the line into the Filter box, which reads only the link's query, or
  puts their address in front. When two or more roadmaps route, the link
  names the chosen one with `&roadmap=`, so the human's *Needs you* follows the
  roadmap you checked.
- **Two more lines can follow the hint.** In a linked worktree, one saying
  that the page shows the checkout the human's Vantage serves, which may not
  hold these documents as they are here. And when `.vantage.toml`'s `target`
  names a release from before the filter, one saying that a viewer before the
  release that added it ignores the filter and shows every entry. A `target`
  before 0.8, such as `target = "0.7"`, makes that line say first that a
  viewer before 0.8 has no planning page at all: *A Vantage viewer before 0.8
  has no planning page, and one before 0.9 ignores this filter and shows every
  entry.*
- **Everything after it is filtered.** *Nothing needs you* reads *Nothing this
  filter keeps needs you*, the Roadmaps block counts the questions the filter
  keeps, and the `Agent requests:` line carries the filter, as
  `vantage-check index --request --filter '<the filter>'`.
- **A filter that keeps no entry says *Nothing matches*,** in the page's
  words, where the sections would be, with one line saying why, and it still
  exits `0`. *Nothing this filter keeps needs you* is not printed then, and
  there is no `Agent requests:` line. The reasons, first that applies, are the
  ones [the planning page gives](planning.md#when-nothing-matches): the
  questions it keeps are on other roadmaps, the index lists no entry at all,
  its `path:` terms keep documents that list nothing, `is:open` leaves out
  everything else it keeps, a `-` word or phrase does, or else what words are
  matched against. Where the questions it keeps are on other roadmaps, it
  does match something, so it says *Nothing on this roadmap matches* and
  names them, and the notice above does not: *1 question it keeps is on
  another roadmap: `docs/plans/roadmap.md` (1). Rerun with --roadmap naming
  it.* An `is:open` that leaves out everything else it keeps reads:

  ```console
  $ vantage-check index --filter 'path:/docs/design/search.md is:open'
  Filtered by `path:/docs/design/search.md is:open`: 0 of 5 entries, in 1 of 5 paths, none of them open questions.
  Run without --filter to see the other 5.
  Planning page: /.vantage/planning?filter=path:/docs/design/search.md+is:open
    Press / on the planning page and paste this line, or put the scheme, host and port you open Vantage at in front of the link.

  Nothing matches `path:/docs/design/search.md is:open`.
  Without `is:open` it would keep 1 entry, and it is not an open question.
  ```

  The JSON and `--request` are as for any other filter: `entries.shown` is
  `0`, and `--request` prints nothing and says why.

**JSON.** With `--filter`, the object gains one last key, `filter`, and every
other key is byte for byte what it is without the flag: `index` is the whole
index, `sections` the unfiltered sections and `roadmaps` the same list, since
their counts are defined over the whole index. Shown here with the filtered
sections emptied:

```json
{
  "…": "…",
  "filter": {
    "text": "path:/docs/design/search.md is:open",
    "canonical": "path:/docs/design/search.md is:open",
    "link": "/.vantage/planning?filter=path:/docs/design/search.md+is:open",
    "documents": { "kept": 1, "of": 5 },
    "entries": { "shown": 2, "of": 7 },
    "openQuestions": 2,
    "blockedLeftOut": 1,
    "otherRoadmaps": [],
    "waitsOutside": [
      { "path": "docs/design/search.md", "target": "docs/design/indexing.md" }
    ],
    "unknownKeys": [],
    "sections": {}
  }
}
```

- **`text`** is the filter as given, and **`canonical`** as the page writes it.
  **`link`** is always root-relative.
- **`documents`** is the documents the filter keeps, of every path the index
  lists; **`entries`** the entries shown, of every entry the unfiltered
  sections hold; **`openQuestions`** how many of those shown are open
  questions.
- **`blockedLeftOut`** counts the 🔒 questions that every other term keeps
  and an `is:` term leaves out.
- **`otherRoadmaps`** names each roadmap other than the chosen one that routes
  a kept question, with how many it routes; a question two of them route counts
  under both.
- **`waitsOutside`** lists each kept document that waits on something the
  filter leaves out, with the `target` as its `depends-on` names it, `#OQ-…`
  included.
- **`unknownKeys`** lists each word before a `:` that is not a filter key,
  once, in the order written: `["stage"]` for `stage:ready`. The text output
  says the same in its *not a filter key* line.
- **`sections`** is the filtered sections, in the shape of the top-level
  `sections`.

A refused project prints `"filter": null`. The format version stays 2, because
the key is new and no existing one changed.

**`--request --filter`** prints the [agent request](#agent-requests) for the
entries the filter keeps, with the `Filter:` line the planning page's **Copy
agent request** adds on a filtered page. With nothing the filter keeps to ask
for, it prints nothing, says so on stderr, and exits `0`.

### Agent requests

Four sections are work for an agent: *Not on a roadmap* (`unrouted`), *Ready to
build* (`ready`), *Ready to graduate* (`graduate`) and *Stage conflict*
(`disagrees`). `vantage-check index --request` prints, for each of them that
holds an entry, what it means, what to do and every entry, on every page, then
how to check the work: the planning page's **Copy agent request** and **Copy
all agent requests** buttons copy exactly this text. Name sections to narrow
it, as in `vantage-check index --request graduate`.

```text
Repository: /home/me/project

Ready to graduate (1): built, with no questions left. For each, write a reference document of the system as built, where the repository keeps those: verify every claim against the code, and say what it covers and the commit it was verified at (if you use a system-doc skill, use it). Give it the stage the repository's other reference documents carry (one with the done role: CURRENT, GRADUATED, SUPERSEDED), or none. Then delete the design document and any plan written for it, repoint every link to them and citation of them, in documents, code comments and tests, at the new one, and keep every question id other documents cite resolvable.
- docs/design/api.md  (stage BUILT)

Verify: in the repository, run `vantage-check` on every Markdown file you changed, then `vantage-check index`. If the command cannot run, or exits 2 (a configuration error or a refusal), leave `.vantage.toml` as it is: the check is a quality gate, not part of the work.
```

| Section | The agent is asked to |
| :--- | :--- |
| Not on a roadmap | propose each question's place on a roadmap with a one-clause reason, and leave the order to you: it shows you the proposals and edits a roadmap only once you confirm |
| Ready to build | build each document's plan and give it a stage with the `built` role, or, if one should not be built, ask you, and only with your agreement give it the stage with the `done` role you choose. It skips a document marked blocked, which *Blocked* lists too |
| Ready to graduate | write each as a reference document of the system as built, with the stage the repository's other reference documents carry; delete the design document and any plan written for it; and repoint every link and citation of them, in documents, code comments and tests |
| Stage conflict | find which is wrong, the stage or the questions, and fix a wrong stage, or propose moving a follow-up question to a new document; it rules and answers nothing, and asks you for rulings |

The request is generated when it is asked for, from the documents and
`[planning.stages]` as they are then, so it names the stage words the
repository declares. A document *Blocked* lists too, which *Ready to build* and
*Ready to graduate* can hold, is marked with what it waits on, and the agent is
told to skip it. The check it ends with names Markdown files only, because
`vantage-check` reads any file it is given as Markdown, and a section number
cited in a code comment would read as a broken reference. The planning page of
a released Vantage names its release there, as its review payload does:
`VANTAGE_VIEWER=0.8.0 uvx vantage-check`. With nothing in the sections asked for,
it prints nothing, says so on stderr, and exits `0`.

### Exit codes

| Code | Meaning |
| :--- | :--- |
| `0` | It ran. That includes a `--filter` whose words match nothing, and one with a word before a `:` that is not a key. |
| `2` | Bad arguments, a `--roadmap` that names no roadmap it can follow, a config file that cannot be trusted, a `--filter` it does not understand, or a `--filter` with a `path:` or `-path:` term that matches no path. |
| `3` | It could not run, which includes a project with more candidates than `max-candidates`, whatever `--roadmap` or `--filter` says. It prints how many there are, and nothing is scanned. |

It never exits `1`: `index` reports and does not judge. Failing a build on what
the index finds is `check`'s job, through the planning rules above.

A `--filter` it does not understand is refused before anything is scanned,
naming the first term it cannot read, or the reason where there is no term to
name, such as an unclosed quote:

```text
vantage-check: --filter: this checker cannot read `is:closed`; it reads words, "quoted phrases", path: and is:open terms, and a - before any of them to leave out what it matches
```

A `path:` term that matches no path the index lists, with or without its
`-`, is refused after the scan, one line for each such term, with nothing on
stdout:

```text
vantage-check: --filter: `path:docs/desing` matches no path the index lists
```

The planning page applies such a term, keeps nothing for it and names it. The
checker stops instead, because a mistyped path is an agent's likeliest mistake,
and the human should never be handed an empty page for it. A word that matches
nothing is not refused: a search that finds nothing is an answer, and the
notice's counts say so. A checker from before the filter exits `2` with
`unknown option for index: --filter`.

### Handing the human a filtered planning page

When the human asks for the questions one piece of work needs answered, hand
them the planning page filtered to that work. The loop:

1. **List the work's planning documents,** each by its path from the
   repository root, with a leading `/`: the design, its `-plan.md` if one
   exists, and every document a kept one names in `depends-on`. The `/`
   matters, because a pattern is found anywhere in a path: `path:search.md`
   keeps a `search.md` in every folder, and `research.md` too. A
   `depends-on` entry naming one question by its `#` fragment brings in that
   question's whole document, since no term selects a single question.
2. **In the checkout the human's Vantage serves,** run
   `vantage-check index --filter 'path:/docs/design/search.md path:/docs/design/search-plan.md is:open'`.
   A link made in another checkout, such as a worktree, opens the documents of
   the checkout Vantage serves, which may not hold the questions as they are
   where you ran it. When the human asked about one part of the work, a word
   narrows it further, as in `'indexing path:/docs/design/search.md is:open'`.
   - Exit `2` names the term to fix.
   - `unknown option for index: --filter` means the checker predates the
     filter: run `uvx vantage-check@latest`.
   - If the notice, or the line under *Nothing on this roadmap matches*,
     names other roadmaps, rerun with `--roadmap` naming each, and hand over
     each link.
   - If the notice says a kept document waits on one the filter leaves out,
     add a `path:` term for that document and rerun.
3. **Hand over the `Planning page:` line, the filter text in a code span, and
   the counts the notice gives,** and tell the human to press `/` on their
   planning page and paste the line. Put an address in front of the link only
   when the human has told you theirs.
4. **The human answers on the page** and presses **Copy answers**, which under
   the filter copies only the answers to the questions it keeps.
5. **Apply the answers, and rerun the same command** until it says *Nothing
   this filter keeps needs you*, or, once no entry is left at all, *Nothing
   matches*, as in *Without `is:open` it would keep 1 entry, and it is not an
   open question.* *Nothing on this roadmap matches* is not the end: the
   questions it keeps are on the roadmaps its line names, so rerun with
   `--roadmap` naming each. The line counting blocked questions says whether
   another round will follow.

What you hand over can be as short as this:

```text
Four questions about search need your rulings. On your planning page, press /
and paste this line:

Planning page: /.vantage/planning?filter=path:/docs/design/search.md+path:/docs/design/search-plan.md+path:/docs/design/indexing.md+is:open

It filters to `path:/docs/design/search.md path:/docs/design/search-plan.md path:/docs/design/indexing.md is:open`:
4 open questions in 3 documents. One more is blocked and will need you later.
```

The loop also runs the other way. A human who filtered the page by hand and
pressed **Copy agent request** hands you its `Filter:` line, and `--filter`
takes its text as it is. The [style guide](#vantage-check-style-guide) teaches
this loop in one rule, so an agent that reads it before writing learns it too.

A link is for handing over now, not for keeping. A later release may keep
other entries for the same filter text, so rerun the command rather than
reuse a link from an earlier round.

---

## How agents find out about it

They are told, on every review turn. The prompt Vantage copies to your clipboard
when you [respond to review comments](review-inbox.md) opens with a line telling
the agent to run `uvx vantage-check <this file>` and fix what it reports before
delivering — a quality gate, not a delivery dependency, so an agent without
`uvx` still delivers. From 0.8.0 it also says what exit `2` means: if the
command cannot run, or exits `2` (a configuration error, or a checker older
than your [`target`](../reference/configuration.md#the-oldest-release-your-readers-use)
refusing to run), the agent delivers anyway and leaves `.vantage.toml` as it is.

From 0.8.0 a released Vantage also names itself in that command:
`VANTAGE_VIEWER=0.8.0 uvx vantage-check <this file>`. The variable tells
the checker which release your viewer runs, so a later checker can hold the
document to what that viewer renders. No checker reads it yet, and one that
does not read it ignores it, so the agent runs the command as written. A
Vantage you built yourself (`just build`, `just deploy`) names no release and
sends the bare command, since it is at least as new as every release.

That channel needs no setup from you, it reaches whatever environment the agent
happens to have, and it arrives at the moment it is useful — just before the
work comes back to you. The planning page's agent requests carry the same
pointer: each ends by telling the agent to run `vantage-check` on every
Markdown file it changed ([Agent requests](#agent-requests)). Nothing writes it
into the agent's own configuration. The trade-off is that a document being
drafted with no review round and no agent request behind it gets no pointer;
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
knows, such as a new rule id in `[check.rules]`. The pinned job warns about it
and ignores it, so the setting the agent relied on does nothing in CI, and a
pin older than 0.8.0 fails on it with exit `2`. Raise both pins together,
deliberately.

---

## How it stays accurate

`vantage-check` imports the viewer's Markdown pipeline — the `vantage-md`
package — by relative path from source, rather than depending on a published
copy, so `check` runs the code the browser runs in a viewer of the same
release. A second implementation would drift invisibly and pass documents the
viewer breaks on. It uses the very Mermaid the viewer does: the packages share
one npm workspace with a single installed copy, and a test in the package
(`test/deps.test.ts`) fails the gate if the checker and the viewer ever resolve
different copies.

KaTeX is not yet held to that. The checker parses formulas with the workspace's
KaTeX, while the viewer renders them with an older copy that its math plugin
brings along, so a command only the newer KaTeX knows, such as `\mapsfrom`, can
pass the check and still render as red error text. The reference lists this
with the checker's other
[known gaps](../../docs/reference/agent-cli.md#11-known-gaps).

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
