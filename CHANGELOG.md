# Changelog

What changed in each release of Vantage, newest first.

Releases before 0.7.0 are summarized one section per minor line — `0.6.x`,
`0.5.x` — rather than one per patch release. The per-patch detail is in the
commit log.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-09-23

Vantage now supports color themes and bookmarks, and reads per-project settings
from `.vantage.toml`.

### Added

**Color themes.** Pick a palette under **Colors** in the settings menu. Six come
with Vantage: Catppuccin, Gruvbox, Lila, Nord, Solarized, and Tokyo Night, each
with its own light and dark variants, alongside the default look, now called
Slate.

To write your own, put a CSS file in `~/.config/vantage/themes/`. It shows up in
the menu on the next page load, with no restart. Set `theme = "gruvbox"` in your
config to start every browser in one. A project can suggest a theme in its
`.vantage.toml`, and your own choice always wins. A theme with no dark colors is
listed as "(light only)". Every built-in theme keeps its text at 3:1 contrast or
better in both modes, checked in a real browser; your own themes aren't checked.
Review mode's comment colors and printing still ignore the theme. See
[Color Themes](userguide/guides/themes.md).

**Bookmarks.** Click the star next to a document's name to bookmark it. Folders
work too. Bookmarks appear in a **Starred** section above the file tree. They're
stored in `~/.local/share/vantage/starred/` instead of in your browser, so they
survive a restart and show up in every tab. If a bookmarked file disappears, the
entry stays put and offers to remove itself when you open it.

A project can also list the documents worth reading first in its `.vantage.toml`,
and you can list files you always want starred in your own config. Those entries
are marked with a pin and name the file that added them. See
[Starred](userguide/features.md#starred).

**Open questions in the contents panel.** A document's open questions now appear
in the table of contents, under the heading they sit below, with a count next to
**Contents**. `💬 3` means three are waiting on a decision; `💬 1 ✅ 2` means one
is open and two are answered. Click one to jump to it. See
[Table of Contents](userguide/features.md#table-of-contents).

### Changed

Settings now follow you between tabs. Before, a second tab read most settings
once when it loaded and then drifted, so changing the theme in one tab left the
other on the old one. `Shift+D` had the same problem inside a single tab: it
changed the page without updating the settings menu. The sidebar and its width,
the tree filters, the project sort order, light/dark, and the color theme all
stay in sync now.

Review mode is a deliberate exception. Two tabs are usually on different
documents, and picking up a toggle from another tab would close the review pane
while you're partway through a comment.

### Fixed

- The file pickers (`t`, `Shift+T`, `Shift+R`, `Shift+P`) reload their list every
  time they open, and a picker that's already open keeps up with the filesystem.
  Before, a file created after the page loaded was unfindable until you
  reloaded.
- A modified file's icon was too faint to read in the file tree in light mode.
- A document that fails to load no longer moves you off the one you're reading,
  and the error names the file you actually asked for.
- A slow response for a document you've already navigated away from is thrown
  away instead of replacing what you're reading.
- `vantage-check check --config <a directory>` now says
  `docs is a directory, not a config file` and exits 2, instead of printing a
  stack trace.

### Contributors

Thanks to [@nichiflu](https://github.com/nichiflu) for the initial color-theme
implementation.

### Works well with

[matt-craft](https://github.com/mschulkind-oss/matt-craft) is out — the skills I use to
write the documents I then read in Vantage: design notes that carry their open
questions, roadmaps, research rounds, user stories, and one for Vantage's own Markdown
conventions. It is not part of Vantage and Vantage does not need it. If you write your
own documents your own way, nothing here changes for you.

## 0.6.x

_0.6.0 – 0.6.2, September 2026._

Long documents have a table of contents. The list button beside the breadcrumb
shows the document's headings in the left margin, and the list stays put while
you scroll. The button beside it lets the text fill the pane. The reading band
moved to the left edge too, so the file list, the contents, and the text sit
together.

- Serving a git repository no longer makes the browser reload itself once a
  second. Vantage's own `git status` calls rewrote `.git/index`, and the watcher
  read that as your edit.
- A repository cloned under one of your `source_dirs` shows up within thirty
  seconds, with no restart. One whose directory goes away is dropped, then
  picked back up when it returns. See
  [Daemon Mode](userguide/guides/daemon-mode.md).
- A port you name is bound exactly or startup fails. Only the default 8000 walks
  to the next free port, and it tells you which one it took.
- Images on adjacent lines render on one row, the way GitHub lays them out. A
  README's badges used to stack into a column.
- `vantage-check` splits a run across worker threads by default, and the report
  reads the same either way.

### Contributors

Thanks to Eduardo Hidalgo ([@edus44](https://github.com/edus44)) for the table
of contents, the Vantage favicon, and fixes to port selection and spurious
browser reloads.

## 0.5.x

_0.5.0 – 0.5.10, May to September 2026._

Vantage stopped being a Python server and became one Go binary. The viewer and
the shortcuts are the same; installing it is not. You install it with `brew
install`, `uvx vantage-md ~/notes`, or a platform archive from a release.
`vantage serve` opens your browser, and `--no-open` stops it.

- `vantage-check` is new. It runs your documents through the viewer's own
  pipeline and reports dead links, dead anchors, broken mermaid diagrams, and
  style problems. See [vantage-check](userguide/guides/vantage-check.md).
- You can mark a document up with `<!-- vantage: … -->` comments that GitHub
  ignores and Vantage reads: a status chip beside a heading, collapsible
  sections, emphasis, and badges. GitHub's alert blocks render too.
- Review mode was rebuilt. A comment anchors to a whole block, replies thread, a
  rail shows where the comments are, and you can answer an open question in one
  click. Agents reply through a `.vantage/` directory. See
  [The `.vantage/` directory](userguide/guides/review-inbox.md).
- The "What's New" popup, the changed-document highlight, and the jj history
  viewer were removed.
- `.vantageignore` and `~/.config/vantage/ignore` keep files out of the tree, and
  the sidebar has a drag handle that remembers its width.

## 0.4.x

_0.4.0 – 0.4.2, April 2026._

Installing Vantage got short. `uvx vantage-md ~/notes` started the server and
opened your browser at the directory you named, and naming a file landed on that
file with the sidebar already expanded. There was a Homebrew formula as well.
macOS became a platform Vantage was tested on.

- Review mode became per file. Turning it on for one document no longer followed
  you to the next, and the toggle survived a reload even before you had written a
  comment.
- Hovering any paragraph in review mode put a button in the gutter, so you could
  comment on a whole block without selecting text first.
- You could edit a comment in place, from the document or from the sidebar.
  Resolved comments collapsed into one indicator instead of asking to be
  dismissed one at a time.
- A comment you had just written was sometimes marked "Outdated" immediately.
- `log_level` in the config, `VANTAGE_LOG_LEVEL` in the environment. The watcher
  reported your inotify limits at startup and warned near the ceiling, which is
  the usual reason live reload stops working.

## 0.3.x

_0.3.0 – 0.3.8, April 2026._

This is the line that added review mode. You turned it on for a document,
selected some text, and left a comment. The server stored the comments, so they
survived a restart. When the text under a comment changed, the comment turned
amber and said "Outdated". Every save while review mode was on snapshotted the
previous version, so you could step back through revisions and see which
paragraphs had changed. One button copied every comment as Markdown quotes, with
line numbers and surrounding context, ready to paste to an agent.

- Opening a project no longer waited for its file tree. The document rendered
  first and the sidebar filled in behind it.
- Headings got hover anchors, and `#L42` or `#L42-L50` in the URL scrolled to
  those source lines and highlighted them.
- You could collapse the sidebar to give the document the window, and reveal
  hidden or gitignored files with new toggles.
- TOML frontmatter between `+++` fences was parsed and shown, with taxonomies and
  extra fields as tag pills.
- A red banner with a timer appeared when the page lost its connection, so a
  document that had stopped live-reloading said so.

## 0.2.x and earlier

_0.0.1 – 0.2.0, February to March 2026._

Where Vantage started. It served the Markdown in your git repositories over a
local port and reloaded the page when you saved: GitHub-flavored Markdown,
syntax highlighting, KaTeX math, mermaid diagrams you could click to zoom,
commit history and diffs, a fuzzy file picker on `t`, dark mode on `Shift+D`,
vim-style scrolling, and a print stylesheet. It could also export a static site
to host on Cloudflare Pages or S3. The server was written in Python then.

- `Shift+T` searched files across every project, `P` switched projects, `r` and
  `Shift+R` found recently modified files, and `y` copied the current file's
  absolute path.
- `source_dirs` in the config found every git repository under a directory, so
  you did not have to list them one by one.
- The project picker became a full page, with repository names, relative
  timestamps, and a toggle between alphabetical and recent order.
- A "What's New" popup showed the changelog the first time you opened a new
  version. You could turn it off in settings. Vantage dropped it in 0.5.
- A jj history and evolution viewer sat beside the git one, for Jujutsu
  repositories. That went in 0.5 too.
