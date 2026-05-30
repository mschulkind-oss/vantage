# Changelog

All notable changes to Vantage will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
