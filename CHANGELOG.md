# Changelog

What changed in each release of Vantage, newest first. Releases before 0.7.0
are summarized one section per minor line; the commit log has the rest.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-09-30

`vantage-check index` and a planning page show what a repository's plans still
need, and `vantage ~/code` serves each clone as its own project.

### Added

**`vantage-check index` prints what a repository's planning documents still
owe:** questions that need a ruling, what waits on what, and which documents
are ready to build. `--request` prints an instruction for an agent, and
`--format json` gives a script the whole index. See
[`vantage-check index`](userguide/guides/vantage-check.md#vantage-check-index).

**Press `g p` for the planning page and answer open questions from their
cards.** Its **Copy answers** and **Copy agent request** hand the work to an
agent. Links to planning documents get badges such as
`in-review · DESIGN · 💬 5`. See [Planning Documents](userguide/guides/planning.md).

**Every `roadmap.md`, in any folder, is a roadmap,** and with several the
planning page lets you pick one. List yours in `roadmap` under `[planning]` in
`.vantage.toml` to limit them. See
[The roadmap](userguide/guides/planning.md#the-roadmap).

**An inline `<svg>`, wrapped in a `<div>` with no blank line inside, renders as
a drawing.** Colors written in `style` are dropped, so Inkscape and matplotlib
exports render black. GitHub and Vantage 0.7 drop it, so follow it with a
`<!-- vantage: fallback -->` paragraph saying what it shows, which only Vantage
0.8 hides. See
[Inline SVG](docs/reference/inline-markup.md#inline-svg).

**One `question` directive declares a question in any state, and `oq` is
deprecated.** Its marker says the state, and `oq` still works. `vantage-check`
warns on each `oq` with the `question` to write instead. Vantage 0.7 drops a
`question`, losing its one-click answer, so while your readers are on 0.7, keep
`oq` on open questions and turn the warning off with
`"vantage/oq-deprecated" = "off"` under `[check.rules]`. See
[When Your Readers Are on 0.7](userguide/guides/vantage-check.md#when-your-readers-are-on-07).

**A comment on a question is its answer,** whether you take its leaning, use
**Answer…**, or comment anywhere in it. The question then shows that it is
answered (_Leaning taken_, or _Answered — waiting on the agent_) in the
document, where its controls now sit at its end, and on its planning card, and
stops counting as needing you. See
[Planning Documents](userguide/guides/planning.md#a-comment-on-a-question-is-your-answer).

### Changed

**Keep running bare `uvx vantage-check` for readers still on 0.7.** A 0.7.x
viewer drops every directive the 0.8.0 style guide adds, and the 0.7.1 checker
reports `question` and `fallback` as unknown names. See
[Which release it writes for](userguide/guides/vantage-check.md#which-release-it-writes-for).

**A `.vantage.toml` key or rule the checker does not know warns, naming the
checker's release, instead of exiting `2`.** A top-level `target = "0.8"` is
reserved for the oldest release your readers use, and a checker older than it
refuses to run. See
[Keys From a Newer Release](userguide/reference/configuration.md#keys-from-a-newer-release).

**A `[starred]` key the server does not know no longer makes it ignore the
whole file.** It logs a warning and ignores the key, as it does an unknown
`[planning]` key; a wrong value for a key it knows still makes it ignore the
file. See
[Keys From a Newer Release](userguide/reference/configuration.md#keys-from-a-newer-release).

**The review prompt's check command names your release,** as
`VANTAGE_VIEWER=0.8.0 uvx vantage-check <file>`, and so does the planning
page's agent request, so a later checker can write for the viewer you run. See
[How agents find out about it](userguide/guides/vantage-check.md#how-agents-find-out-about-it).

**The style guide says how to write a question:** a list item with a bold
title line, short context, the options as a list, and the leaning and the
Answer as paragraphs of their own, never one run-together paragraph. See
[Style Guide for Agents](userguide/reference/style-guide.md#questions).

**Hand-written HTML and Mermaid can no longer draw over Vantage's own page.**
Vantage keeps a `class` only where Markdown puts one, drops a `style` whose
`display` is `contents` or not a listed keyword, and ignores a Mermaid
diagram's `themeCSS` and font families. `vantage-check` reports none of these.
See [Security](docs/reference/inline-markup.md#security).

**`vantage ~/code` serves each clone as its own project,** with its
`.gitignore` and git status, and the Markdown outside them as one more, when
the directory is not inside a git repository. Only `--one-project`, the old
behavior, shows review comments left on that Markdown. See
[Serve a directory of clones](userguide/getting-started.md#serve-a-directory-of-clones).

**`vantage` started in a terminal prints a tip about the background service.**
`VANTAGE_NO_TIPS=1`, or `tips = false` in your config, turns it off.

**A CI job can notice these `vantage-check` changes;
[pin the checker](userguide/guides/vantage-check.md#in-ci) to take them when you
choose.** Check a file named `index` as `vantage-check ./index`, since `index`
is now a command. `planning/depends-on-missing` and `vantage/question-name`,
which reports an `oq` on a 🔒 or ✅ question, are errors.
`planning/question-length` warns past 120 words, failing `--strict`, as do the
new `vantage/oq-deprecated` and `vantage/question-layout` warnings, and
`vantage/oq-missing` reads more ways of writing a leaning.

### Fixed

- A request for `docs/../.vantage/…`, or on macOS for any case of `.git` or
  `.vantage` such as `.GIT/config` (which can hold a token), read the real file.
  Vantage refuses both now.
- Review mode's **Copy** quotes each path, so a file name holding `$(…)` or a
  backtick cannot run a command.
- On a `vantage build` site, the address a heading's `#` link left in the
  address bar opened a blank page. Rebuild and redeploy to get links that name
  their document; see [Page URLs](userguide/guides/static-sites.md#page-urls).
- On macOS, a large tree could use up the server's open files and stop it.
- A document reloaded when only its attributes changed, as Spotlight and backup
  tools do.
- A page in a project or folder named `api` showed a JSON 404 on a reload.

### Contributors

Thanks to Eduardo Hidalgo ([@edus44](https://github.com/edus44)) for inline SVG.

## [0.7.1] - 2026-09-27

### Added

**`Shift+R` lists recent files across all projects,** as `r` does for the
current one, with each row's project name. See
[Recently Changed Files](userguide/reference/keyboard-shortcuts.md#recently-changed-files).

**`Alt+Enter` or `Ctrl+Enter` (`Cmd+Enter` on macOS) opens the highlighted row
of a picker in a new tab,** as do Ctrl-click and middle-click. See
[File Picker](userguide/reference/keyboard-shortcuts.md#file-picker).

### Fixed

- Build output (`target`, `build`, `dist`) and tool caches such as `.cache` and
  `__pycache__` are no longer listed, discovered or watched by default, so a
  build no longer exhausts inotify watches. Linked Git worktrees are left out
  too, so no tree shows twice. See
  [Ignore Files and Live Reload](userguide/reference/configuration.md#ignore-files-and-live-reload).

## [0.7.0] - 2026-09-23

Vantage now supports color themes and bookmarks, and reads per-project settings
from `.vantage.toml`.

### Added

**Pick a color theme under Colors in the settings menu:** six come with Vantage,
each with light and dark variants, and the default look is now called Slate.
Add your own as a CSS file in `~/.config/vantage/themes/`, or set
`theme = "gruvbox"` in your config to start every browser in one. See
[Color Themes](userguide/guides/themes.md).

**Click the star beside a document or folder to bookmark it in the Starred
section above the file tree.** Bookmarks are kept in
`~/.local/share/vantage/starred/`, not your browser, so every tab sees them, and
a project's `.vantage.toml` and your config can list pinned entries. See
[Starred](userguide/features.md#starred).

**A document's open questions appear under their headings in its table of
contents,** with a count beside **Contents**: `💬 1 ✅ 2` means one open and two
answered. See [Table of Contents](userguide/features.md#table-of-contents).

### Changed

**Settings follow you between tabs:** the sidebar and its width, the tree
filters, the project sort order, light/dark and the color theme. Review mode
does not, so a toggle in one tab cannot close the review pane in another.

### Fixed

- The file pickers reload their list each time they open, so a file created
  after the page loaded can be found without a reload.
- A document that fails to load, or a slow response for one you have left, no
  longer replaces the one you are reading.
- `vantage-check check --config <a directory>` says it is a directory and exits
  2, instead of printing a stack trace.

### Contributors

Thanks to [@nichiflu](https://github.com/nichiflu) for the initial color-theme
implementation.

## 0.6.x

_0.6.0 – 0.6.2, September 2026._

Long documents have a table of contents: the list button beside the breadcrumb
shows the headings in the left margin, and the button beside it lets the text
fill the pane.

- Serving a git repository no longer makes the browser reload once a second.
- A repository cloned under one of your `source_dirs` shows up within thirty
  seconds, with no restart. See [Daemon Mode](userguide/guides/daemon-mode.md).
- A port you name is bound exactly or startup fails. Only the default 8000 walks
  to the next free port.
- Images on adjacent lines render on one row, as on GitHub.

### Contributors

Thanks to Eduardo Hidalgo ([@edus44](https://github.com/edus44)) for the table
of contents, the Vantage favicon, and fixes to port selection and spurious
browser reloads.

## 0.5.x

_0.5.0 – 0.5.10, May to September 2026._

Vantage stopped being a Python server and became one Go binary. Install it with
`brew install`, `uvx vantage-md ~/notes`, or a platform archive from a release.
`vantage serve` opens your browser, and `--no-open` stops it.

- `vantage-check` is new. It reports dead links, dead anchors, broken Mermaid
  diagrams, and style problems. See
  [vantage-check](userguide/guides/vantage-check.md).
- `<!-- vantage: … -->` comments, which GitHub ignores, add status chips,
  collapsible sections, emphasis, and badges. GitHub's alert blocks render too.
- Review mode was rebuilt: a comment anchors to a whole block, replies thread,
  and agents reply through a `.vantage/` directory. See
  [The `.vantage/` directory](userguide/guides/review-inbox.md).
- The "What's New" popup, the changed-document highlight, and the jj history
  viewer were removed.
- `.vantageignore` and `~/.config/vantage/ignore` keep files out of the tree.

## 0.4.x

_0.4.0 – 0.4.2, April 2026._

`uvx vantage-md ~/notes` started the server and opened your browser at the
directory you named, a Homebrew formula arrived, and macOS became a tested
platform.

- Review mode became per file, and hovering a paragraph put a comment button in
  the gutter.
- You could edit a comment in place, and resolved comments collapsed into one
  indicator.
- `log_level` in the config and `VANTAGE_LOG_LEVEL` in the environment arrived,
  and the watcher warned near your inotify limit, the usual reason live reload
  stops.

## 0.3.x

_0.3.0 – 0.3.8, April 2026._

This line added review mode. You selected text in a document and left a comment,
which the server stored and marked "Outdated" when the text under it changed.
Each save in review mode snapshotted the previous version so you could step
back through revisions, and one button copied every comment as Markdown for an
agent.

- Opening a project no longer waited for its file tree.
- Headings got hover anchors, and `#L42` or `#L42-L50` in the URL highlighted
  those source lines.
- You could collapse the sidebar and show hidden or gitignored files.
- TOML frontmatter between `+++` fences was shown, with taxonomies as tag pills.
- A red banner appeared when the page lost its connection.

## 0.2.x and earlier

_0.0.1 – 0.2.0, February to March 2026._

Where Vantage started: a Python server for the Markdown in your git
repositories, reloading the page when you saved, with GitHub-flavored Markdown,
syntax highlighting, KaTeX math, Mermaid diagrams, commit history and diffs, a
fuzzy file picker on `t`, dark mode on `Shift+D`, vim-style scrolling, and
static-site export.

- `Shift+T` searched files across every project, `P` switched projects, `r` and
  `Shift+R` found recently modified files, and `y` copied the current file's
  path.
- `source_dirs` in the config found every git repository under a directory.
- The project picker became a full page.
