# Features

Vantage renders Markdown with the same fidelity as GitHub, plus extras like live reload and Git integration.

## GitHub Flavored Markdown

Vantage supports the full [GitHub Flavored Markdown](https://github.github.com/gfm/) specification:

- **Headings** with anchor links
- **Syntax highlighting** for fenced code blocks in 100+ languages
- **Tables** with alignment
- **Task lists** with checkboxes
- **Footnotes**
- **Strikethrough**, **bold**, _italic_
- Inline `code` and code blocks
- Blockquotes
- Ordered and unordered lists
- Horizontal rules
- Images and links
- HTML (sanitized), including [inline SVG](../docs/reference/inline-markup.md#inline-svg)
  as static drawing, which is Vantage-only: GitHub drops it, so embed a drawing
  as `![alt](file.svg)` in a document read there

### Math with KaTeX

Vantage renders LaTeX math using [KaTeX](https://katex.org/). Both inline and
block math use `$$...$$` delimiters.

Single dollars are deliberately _not_ math delimiters, so shell variables and
amounts in prose — `$HOME`, `$100` — stay literal instead of turning into a
broken math span.

Inline math: `$$E = mc^2$$` renders as $$E = mc^2$$

Block math — put `$$` alone on its own lines:

```
$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$
```

$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$

### Frontmatter

YAML frontmatter at the top of a file is parsed and displayed as a clean metadata table above the content:

```yaml
---
title: My Document
author: Jane Smith
date: 2026-01-15
status: draft
---
```

One key is Vantage's own: `vantage:`. It holds chrome that belongs to the file
rather than to a section, and it never appears as a row in Vantage's own metadata
card. No other renderer acts on it — GitHub shows it as one row in the frontmatter
table it draws for `title:` and `status:`, and nothing more. Today it has one
key — `status-chip` — which shows the document's lifecycle status as a chip above
the card, **in addition to** the `status:` row it reads. The chip surfaces the
value, it does not move it, so the card stays a faithful view of the frontmatter:

```yaml
---
title: My Document
status: in-review # draft | in-review | accepted | deprecated
vantage:
  status-chip: true
---
```

`status-chip: true` shows the document's own `status:`, so the chip cannot
disagree with it. A literal `status-chip: accepted` works too, but it is a second
value that can drift; `vantage-check` reports the disagreement either way. The
vocabulary is `status`'s own — `draft`, `in-review`, `accepted`, `deprecated`,
lowercase — and anything else renders no chip at all.

## Mermaid Diagrams

Fenced code blocks with the `mermaid` language tag are rendered as diagrams. Vantage supports all Mermaid diagram types:

### Flowchart

```mermaid
flowchart TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Debug]
    D --> B
    C --> E[End]
```

### Sequence Diagram

```mermaid
sequenceDiagram
    participant User
    participant Vantage
    participant FileSystem

    User->>Vantage: Open browser
    Vantage->>FileSystem: Read Markdown files
    FileSystem-->>Vantage: File contents
    Vantage-->>User: Rendered page
    User->>FileSystem: Edit file in editor
    FileSystem-->>Vantage: Change detected (WebSocket)
    Vantage-->>User: Live reload
```

### Other Diagram Types

Vantage supports flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, Gantt charts, pie charts, journey maps, Git graphs, quadrant charts, and more. See the [Mermaid documentation](https://mermaid.js.org/) for the full list.

Click the **maximize button** on any diagram to view it in a full-screen modal.

**A diagram cannot restyle the page.** Vantage ignores the `themeCSS`,
`fontFamily` and `altFontFamily` settings in a diagram's `%%{init: …}%%`
directive or its frontmatter `config:`, because Mermaid lets a stylesheet
written there reach elements outside the diagram. A diagram's `theme` and
`themeVariables` still apply.

## Live Reload

When Vantage is running and you edit a Markdown file in your editor, the browser updates instantly — no manual refresh needed. This works through a WebSocket connection that watches the filesystem for changes.

This is especially useful when:

- **Reviewing LLM output** — watch AI-generated Markdown appear in real time
- **Editing docs** — see your formatting as you write
- **Collaborating** — changes from any source show up immediately

**A document whose folder is renamed stays on screen.** Rename or move the
folder holding the document you are reading — with `mv docs/old docs/new`, in
your editor, or by an agent — and the page switches to the document's new
address, at the place you were reading. A folder you are looking at follows the
same way. The file tree and the recent files follow at once.

If you are reviewing the document, you go on reviewing it at its new address:
its comments move there with it, and a comment you are in the middle of writing
stays open. The comments move only when a Vantage page follows the document, so
a folder renamed while no page has it open leaves them with the old address,
and they come back if the folder does.

If the folder is deleted or moved out of the directory Vantage serves, the page
says, a moment later, that the document could not be loaded, and shows it again
by itself if the folder comes back. If you are writing a comment just then, the
page waits until you save or cancel it. It says the same, rather than guess,
when a rename could have put the document in more than one place — two folders
renamed at once, each holding a file of that name — and when a document is
edited and then its folder renamed in the same moment while it is the only file
in that folder, which looks just like a deletion. In both of those cases the
file tree already shows the folder under its new name.

## Git Integration

If the directory you're serving is a Git repository, Vantage provides:

### Last Commit Info

Every file shows the most recent commit message, author, and relative timestamp (e.g., "about 2 hours ago"). Click the timestamp to view the diff.

Vantage asks git about a file together with its content, and a document's first paint waits for the answer, never more than 150 ms, so the header usually has it from the start. The header never guesses: it says *Untracked file* only once git has said so. Anything that arrives later takes only the room the header has left, and never narrows the file name.

### Commit History

Press **h** on any file to open the full commit history. Each commit shows the message, author, date, and short SHA. Click any commit to view its diff.

### Diff Viewer

The diff viewer shows changes in a unified format with:

- Added lines highlighted in green
- Removed lines highlighted in red
- Line numbers for both old and new versions
- Hunk headers showing the context

### Recent Files

The sidebar shows recently changed files (by Git commit date), so you can quickly jump to whatever was worked on most recently.

## Table of Contents

The list icon in the toolbar, beside the breadcrumb, shows a table of
contents for the open document in the margin to its left. Every heading is
listed and indented by level; clicking one jumps to it and updates the
address bar, so the link is ready to copy. The heading you are currently
reading stays highlighted, and the table of contents stays put as the
document scrolls under it.

**Open Questions are listed too**, indented under the heading they sit below,
each wearing the status emoji the document gave it — so a document that wants a
decision from you says so before you read a word of it. A tally beside
**Contents** counts them by state: `💬 3` is three awaiting a ruling, and
`💬 1 ✅ 2` is one outstanding and two already answered. Clicking a question
scrolls to the question itself, and the link it copies is the question's own
`#OQ-…` anchor, which is what a reference from another document uses.

Every question carrying an [`oq` directive](reference/style-guide.md) appears,
in whatever state it is in: open, blocked or answered. A question written
without one is not listed, and nothing else in Vantage counts it either
([Planning Documents](guides/planning.md#what-vantage-reads)).

Only the open ones can be answered in one click. Review mode's **Take this
leaning** button appears on a 💬 question, or one with no marker, and never on
a 🔒 blocked or ✅ answered one: a blocked question cannot be answered yet, and
an answered one has been ruled. The **Review** toggle's tooltip, while review
mode is off, counts those buttons and nothing else, so it can count fewer
questions than the column lists. The tally's own tooltip says which is which,
such as *3 questions here — 1 open, 1 answered, 1 blocked; 1 can be answered in
one click*.

The choice is remembered: turn it on once and it stays on as you move
between documents and across restarts. It appears only for a rendered Markdown
document — not for raw view, a directory listing or a binary file — and only on
a screen wide enough to have a margin to put it in. On the
[planning page](guides/planning.md#the-contents-column) the same toggle shows
the page's outline instead: its sections, and the documents each one lists.

## Full Width

The expand icon beside it drops the fixed reading column and lets the document
use the whole window, which is what you want for a wide table or a large
diagram. It is remembered the same way, and widens the
[planning page](guides/planning.md#the-planning-page)'s cards too.

## Starred

The star beside the document name bookmarks whatever is open — a document or a
folder — and fills in amber once it is. Bookmarks collect in a **Starred**
section at the top of the sidebar, above the file tree; the section is not there
at all until something is starred.

Bookmarks belong to the project, not to the browser. They are stored under
`~/.local/share/vantage/starred/`, beside your review comments, so they come back
when you restart Vantage — on any port, in any browser — and every open tab
updates the moment one is added or removed anywhere else. They are yours rather
than the repository's: nothing about them is committed, and nothing travels when
you share the project.

Some rows you did not star. A project can name documents worth starting with in
its own `.vantage.toml`, and you can name files you always want starred — your
roadmap, say — in your own config; both are covered in
[Stored Bookmarks](reference/configuration.md#stored-bookmarks). Those rows carry a
small pin and say in their tooltip which file put them there. They are not yours
to remove, because nothing of yours created them — edit the config that did.

Which list you get depends on how Vantage was started. `vantage serve` keys on
the directory it is serving, so each project has its own and launching somewhere
else gives you that project's. A [daemon](guides/daemon-mode.md) keys on its
config file instead, which does not depend on the working directory a service
manager happens to hand it, so one list covers every repository it serves and
each bookmark remembers which one it came from.

Nothing checks that a bookmark still points at something. A starred document
that has been deleted or renamed keeps its place in the list and only says so
when you open it: the page reports that it could not be loaded and offers to
remove the bookmark. That way a file that is briefly missing — mid-rebase, say —
does not quietly disappear from your list.

## File Tree Navigation

The sidebar displays a file tree with:

- **Lazy loading** — directories expand on click, fetching contents on demand
- **Show all folders** toggle — switch between showing only directories with Markdown files and showing everything
- **Directory viewer** — clicking a directory shows its contents in a table with commit messages and timestamps, similar to GitHub's repository view

## File Picker

Press **t** to open the fuzzy file picker. Type to search across all files in the project. Use arrow keys to navigate and Enter to select, or **Alt+Enter** / **Ctrl+Enter** to open the file in a new tab.

### Global Search

Press **Shift+T** from anywhere to search files across all projects at once. On the project picker page, **t** also opens the global file search.

Press **r** to list the recently changed files in the current project, with who changed each one and in which commit, or **Shift+R** for the same list across all projects. Use the arrow keys or **j** / **k** to move through it and Enter to open a file.

Press **Shift+P** to open the project picker and quickly switch between repos.

Press **?** to see all keyboard shortcuts, including sidebar toggle (**b**), vim-style scrolling (**j**/**k**), and quick navigation (**g h** for home, **g r** for recent files, **g p** for the [planning page](guides/planning.md#the-planning-page)).

## Multi-Repo Mode

When running in daemon mode with multiple directories, Vantage shows a full-page project list where you can select a repo. Projects can be sorted alphabetically or by recent activity (with relative timestamps like "2 hours ago"). Switch between directories without restarting the server. See [Daemon Mode](guides/daemon-mode.md) for details.

### Source Directory Auto-Discovery

Instead of manually listing every repository, you can point Vantage at parent directories. Any subdirectory containing a `.git` folder is automatically added as a project:

```toml
source_dirs = ["~/code", "~/projects"]
```

Manually listed `[[repos]]` take precedence — duplicates are skipped. See [Configuration](reference/configuration.md#source-directory-auto-discovery) for details.

`vantage ~/code` serves a directory of clones the same way without a config file: one project per clone, plus one for any Markdown outside them. See [Getting Started](getting-started.md#serve-a-directory-of-clones).

## Review Mode

Vantage includes a built-in review mode for annotating documents:

- **Inline comments** — attach a comment to any block of rendered Markdown: hover it and click, or drag-select a phrase inside it. Tables are commentable cell by cell — point at a cell for that cell, or beside the table for the table as a whole
- **Copy for the agent** — copy pending comments to the clipboard as a prompt that tells the agent exactly how to respond
- **Agent responses** — after editing the document, the agent delivers a per-comment summary by appending a JSON line to `.vantage/inbox/` in the repo; Vantage consumes it and shows the response inline next to the comment
- **Paste box** — for chat agents that cannot write files, paste their `- [<id>] <summary>` bullet reply into the Review panel instead

Reviews are stored on disk and persist across server restarts.

Agent responses arrive through a small `.vantage/inbox/` directory at the repo
root — see [Review Inbox](guides/review-inbox.md), which also covers gitignoring it.

The copied prompt also tells the agent to run
[`vantage-check`](guides/vantage-check.md) over the document before delivering, so
broken links and unparseable diagrams are caught before they reach you.

## Writing for Vantage

Two things help an agent — or a person — write documents that render the way
they meant:

- **The style guide.** Settings (⚙) → **Agent Style Guide** shows the
  conventions Vantage's renderer expects, with a copy button for pasting into an
  agent's context. For the same release, the same text comes out of
  `vantage-check style-guide`, which prints the checker's own release's guide.
  See [Style Guide for Agents](reference/style-guide.md).
- **The checker.** `vantage-check <path>` verifies a document against the
  repository on disk: relative links that resolve, `#L42` anchors that are
  inside their file, `#section` anchors that match a real heading, frontmatter
  that parses, and diagrams and formulas that Mermaid and KaTeX accept. It is a
  standalone binary that needs nothing installed and no server running. See
  [vantage-check](guides/vantage-check.md).

## Dark Mode

Press **Shift+D** to toggle between light and dark themes. The setting is persisted across sessions.

## Color Themes

Light and dark are drawn in a color theme: the built-in look (**Slate**), one of
the six palettes Vantage ships — **Catppuccin**, **Gruvbox**, **Lila**, **Nord**,
**Solarized**, **Tokyo Night** — or one you write yourself as a single CSS file in
`~/.config/vantage/themes/`. Pick
one from **Colors** in the settings menu, or set a default for every browser
with `theme = "…"` in your config. A project can offer a default too, in its
`.vantage.toml` — your own choice always outranks it. See
[Color Themes](guides/themes.md).

## Performance Diagnostics

Vantage includes built-in performance instrumentation. Run `vantage perf-report` against a running instance to see anonymized timing data for all API endpoints. See the [CLI Reference](reference/cli-reference.md#vantage-perf-report) for details.
