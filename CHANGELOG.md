# Changelog

What changed in each release of Vantage, newest first, written for the people who
read documents in it rather than the people who write it.

A version's section here is not a record of the release — it *is* the release
announcement. `just release` refuses to cut a tag until the section exists, and
CI publishes it verbatim as the body of that release on GitHub. The standard the
entries are held to is
[`.claude/skills/release-notes/SKILL.md`](.claude/skills/release-notes/SKILL.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions `0.3.2` through `0.6.2` shipped without entries here; what they contain
is in the commit log.

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

## [0.3.1] - 2026-04-06

### Fixed

- `just build` now works after `git pull` without needing `just setup` — the build bootstraps its own environment.
- `just setup` no longer modifies lockfiles (`go mod download`, `npm ci`).
- `just build` safely stamps dev version metadata via linker flags instead of a fragile `git checkout` trap.

## [0.3.0] - 2026-04-06

### Added

- **Review mode** — Toggle review mode on any markdown file to select text and leave inline comments. Comments are highlighted in the document and stored server-side for persistence across sessions.
- **Outdated comment detection** — When the document changes and a comment's selected text no longer matches, it appears as an amber "Outdated" block near the changed section with a Dismiss button — similar to GitHub's outdated review comments.
- **Auto-snapshots & revision history** — While in review mode, each file change automatically snapshots the previous version. Navigate revisions with `← Rev N of M →` controls.
- **Block-level change highlights** — Changed paragraphs between revisions are marked with a purple left border for quick scanning.
- **Copy all comments** — One-click export of all active review comments as markdown quotes, ready to paste back to an AI agent.
- **TOML frontmatter support** — Zola-style `+++` TOML frontmatter is now parsed and displayed, with taxonomies and extra fields flattened into tag pills.
- **Collapsible sidebar** — Click the collapse button to hide the file tree and maximize content area. State persists across sessions.
- **Show hidden / gitignored files** — New filter toggles in the sidebar to reveal hidden files and gitignored files.
- **Mermaid error handling** — Broken mermaid diagrams now show a friendly error message instead of crashing.
- **`disable_whats_new` config** — Suppress the What's New popup entirely via server config.

### Changed

- **Startup performance** — Significantly faster initial load with background tree fetching, repo caching, and loading gate.
- **Auto-discover repos** — `source_dirs` now recursively discovers git repos without explicit enumeration.

### Fixed

- Suppress What's New popup in static export mode.
- Show directory index and README on root path in static mode.
- Replace bundled GitHub SVG icon with inline SVG to avoid asset issues.

## [0.2.0] - 2026-03-25

### Added

- **Global file search** — Press `T` (Shift+T) from anywhere to search files across all projects. Press `t` on the project picker page to do the same.
- **Project picker shortcut** — Press `P` from anywhere to fuzzy-search project names and quickly switch between repos.
- **Recent file search** — Press `r` to search recently modified files in the current project, or `R` to search recents across all projects.
- **Copy file path** — Press `y` or click the "Path" button to copy the current file's absolute filesystem path to the clipboard.
- **Changelog & What's New** — A built-in changelog with a "What's New" popup that appears when new features are available. Opt out anytime via settings.
- **Source directories** — Configure `source_dirs` in your config to auto-discover git repos from specified directories.
- **Repo sorting** — Toggle between alphabetical and recent-activity sorting on the project picker page.

### Changed

- **Project picker redesign** — Full-page layout without sidebar, cleaner table with repo names and relative timestamps.
- **Repo age display** — Project picker now shows the age of the newest file in each repo rather than the last git commit.

## [0.1.0] - 2026-03-20

### Added

- Markdown rendering with GitHub-flavored markdown, syntax highlighting, and KaTeX math support.
- Mermaid diagram rendering with click-to-zoom.
- Live reload via WebSocket — files update automatically when saved.
- Git integration — view commit history, diffs, working-tree diffs, and file status.
- Fuzzy file picker with `t` keyboard shortcut.
- Dark mode with `Shift+D` toggle.
- Vim-style keyboard navigation (`j`/`k` scroll, `g g`/`G` jump, `g h` home).
- Multi-repo daemon mode with TOML configuration.
- Static site export for hosting on Cloudflare Pages, GitHub Pages, etc.
- Print-optimized stylesheet.
