# Changelog

What changed in each release of Vantage, newest first. Releases before 0.7.0
are summarized one section per minor line; the commit log has the rest.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-10-06

### Added

**A planning page filtered to one piece of work.** The planning page has a new
**Filter** box, and the page narrows as you type. A word, such as `generator`,
finds the questions whose id, title, leaning or path holds it, in any case, and
the documents whose path, stage or `next` does. `path:`, which finds its text
anywhere in a path as GitHub's code search does, and `is:open` narrow further,
as in `path:/docs/design/search.md is:open`, and a `-` before a term leaves out
what it matches. The page keeps its order, a notice says what the filter hides,
and **Copy answers** and **Copy agent request** cover only what it keeps. Press
`/` to reach the box. The address follows the box without adding to your
history. See [Filtering the page](userguide/guides/planning.md#filtering-the-page).

A planning document that holds a question, and whose stage does not map to
`done`, now ends its Referenced by line with *its questions on the planning
page*, a link to the planning page filtered to that document. A document that
had no line, because nothing links to it and the roadmap misses none of its
questions, now shows a line with only that link. See
[Referenced by](userguide/guides/planning.md#referenced-by).

**`vantage-check index --filter`** takes the same text, prints only what it
keeps, and prints a `Planning page:` line for your agent to hand you.
`vantage-check style-guide` now tells agents to hand you that line when they
need your rulings. The checker cannot know the address you open Vantage at, so
the link starts at `/.vantage/planning`: press `/` on your planning page and
paste the line, or put your address in front. In daemon mode, opening it lists
each project's planning page with the filter kept. With `--format json`, the
output gains a `filter` key, and the format version stays 2.

`--filter` exits `2` on a filter it cannot read, such as one with an unclosed
quote, and on a `path:` or `-path:` term that matches no path. A word that
matches nothing is an empty answer and exits `0`. `vantage-check` 0.8.0 and
0.8.1 exit `2` with `unknown option for index: --filter`: run
`uvx vantage-check@latest`. Vantage 0.8.0 and 0.8.1 ignore the filter without
saying so: they show the whole planning page, or, in daemon mode, ask you to
choose a project. A later release may keep other entries for the same filter
text, so have your agent rerun `--filter` rather than keep an old link. See
[Handing the human a filtered planning page](userguide/guides/vantage-check.md#handing-the-human-a-filtered-planning-page).

### Fixed

- In daemon mode, `g p` and the sidebar's planning entry opened the wrong page
  for a project whose name holds `#` or `?`.
- On the planning page, the roadmap picker at the top of the contents column
  drew its focus ring cut off at the left edge.

## [0.8.1] - 2026-10-02

If your `.vantage.toml` sets a `target` before 0.8, such as `target = "0.7"`,
`vantage-check` no longer asks you to write `question` on an open question,
because a viewer before 0.8 offers its one-click answer only on an `oq`: it stops
warning on an `oq` (`vantage/oq-deprecated`), and tells a question with no
directive to take one (`vantage/oq-missing`). An `oq` on a 🔒 or ✅ question is
still an error. A checker before 0.8 ignores the `target` line, where 0.7.1
rejects `"vantage/oq-deprecated" = "off"`. See
[When Your Readers Are on 0.7](userguide/guides/vantage-check.md#when-your-readers-are-on-07).

## [0.8.0] - 2026-10-02

**Highlights.** Vantage 0.8 puts every open question in your design docs on one
page, in roadmap order, hands your answers to an agent in one copy, and serves a
whole folder of clones with `vantage ~/code`.

### Added

**The planning page.** Press `g p`, or run `vantage-check index`, to see what a
repository's planning documents still owe: questions that need a ruling, what
waits on what, and which documents are ready to build. Answer questions from
their cards, then hand the work to an agent with **Copy answers** or **Copy
agent request**. Links to planning documents get badges such as
`in-review · DESIGN · 💬 5`, and with several `roadmap.md` files the page lets
you pick one. See [Planning Documents](userguide/guides/planning.md).

**Inline SVG.** An `<svg>` wrapped in a `<div>`, with no blank line inside,
renders as a drawing. Colors written in `style` are dropped, so Inkscape and
matplotlib exports render black. GitHub and Vantage 0.7 drop the drawing, so
follow it with a `<!-- vantage: fallback -->` paragraph saying what it shows,
which only Vantage 0.8 hides. See
[Inline SVG](docs/reference/inline-markup.md#inline-svg).

**`question` replaces `oq`.** One `question` directive declares a question in
any state, and `oq` still works but is deprecated. Vantage 0.7 drops a
`question`, losing its one-click answer, so keep `oq` on open questions until
every reader is on 0.8, and turn its new warning off with
`"vantage/oq-deprecated" = "off"` under `[check.rules]`. Keep running the newest
checker meanwhile: 0.7.1 rejects that line and the new directives. See
[When Your Readers Are on 0.7](userguide/guides/vantage-check.md#when-your-readers-are-on-07).

**Answers by comment.** A comment on a question is its answer, whether you take
its leaning, use **Answer…**, or comment anywhere in it. The question then shows
as answered, in the document and on its planning card, and no longer counts as
needing you. See
[Planning Documents](userguide/guides/planning.md#a-comment-on-a-question-is-your-answer).

### Changed

**Unknown config keys.** An unknown `.vantage.toml` key no longer breaks the
server or the checker. `vantage-check` used to exit `2`, and the server ignored
the whole file over one in `[starred]`. From 0.8.0, a checker older than a
top-level `target`, the oldest release your readers use, refuses to run. See
[Keys From a Newer Release](userguide/reference/configuration.md#keys-from-a-newer-release).

**Your release in the review prompt.** The prompt's check command names it, as
`VANTAGE_VIEWER=0.8.0 uvx vantage-check <file>`, and so does the planning page's
agent request, so a later checker can write for the viewer you run. See
[How agents find out about it](userguide/guides/vantage-check.md#how-agents-find-out-about-it).

**Hand-written HTML.** It and Mermaid can no longer draw over Vantage's own
page. Vantage drops a `class` Markdown did not put there, a `style` whose
`display` is `contents` or unlisted, and a Mermaid diagram's `themeCSS` and font
families. `vantage-check` reports none of these. See
[Security](docs/reference/inline-markup.md#security).

**A folder of clones.** `vantage ~/code` serves each clone as its own project,
and the Markdown outside them as one more, when the directory is not inside a
git repository. Only `--one-project`, the old behavior, shows review comments
left on that Markdown. See
[Serve a directory of clones](userguide/getting-started.md#serve-a-directory-of-clones).

**A startup tip.** `vantage` started in a terminal mentions the background
service. `VANTAGE_NO_TIPS=1`, or `tips = false` in your config, turns it off.

**New checker findings.** Some can fail a CI job, so
[pin the checker](userguide/guides/vantage-check.md#in-ci) to take them when you
choose. `planning/depends-on-missing` and `vantage/question-name`, an `oq` on a
🔒 or ✅ question, are errors. The new warnings, which fail `--strict`, are
`planning/question-length`, `vantage/oq-deprecated`, `vantage/question-layout`
and `prose/inline-list`, on a paragraph that runs `(a) (b) (c)` together. Check
a file named `index` as `vantage-check ./index`, since `index` is now a command.

### Fixed

- A request for `docs/../.vantage/…`, or on macOS for any case of `.git` or
  `.vantage` such as `.GIT/config` (which can hold a token), read the real file.
  Vantage refuses both now.
- Review mode's **Copy** quotes each path, so a file name holding `$(…)` or a
  backtick cannot run a command.
- On a `vantage build` site, a heading's `#` link left an address that opened a
  blank page. Rebuild and redeploy to fix it; see
  [Page URLs](userguide/guides/static-sites.md#page-urls).
- On macOS, a large tree could use up the server's open files and stop it.
- A document reloaded when only its attributes changed, as Spotlight and backup
  tools do.
- A page in a project or folder named `api` showed a JSON 404 on a reload.
- The sidebar's recent files could miss or misplace a document just written.

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
