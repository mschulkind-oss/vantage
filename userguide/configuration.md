# Configuration

Vantage works out of the box with zero configuration. For daemon mode (serving multiple directories), you'll need a config file.

## Config File Location

The default config path is:

```
~/.config/vantage/config.toml
```

Generate a starter config with:

```bash
vantage init-config
```

Or specify a custom path:

```bash
vantage init-config --path ~/my-vantage-config.toml
```

## Example Config

```toml
# Server settings
host = "127.0.0.1"
port = 8000

# Directories to serve (each appears in the project list)
[[repos]]
name = "notes"
path = "~/Documents/notes"

[[repos]]
name = "work-docs"
path = "~/work/documentation"

[[repos]]
name = "project"
path = "~/code/my-project"
```

Each directory is accessible at `http://localhost:8000/{name}/`.

## Reference

| Key                        | Type             | Default       | Description                                          |
| -------------------------- | ---------------- | ------------- | ---------------------------------------------------- |
| `host`                     | string           | `"127.0.0.1"` | Server bind address                                  |
| `port`                     | integer          | `8000`        | Server port                                          |
| `repos`                    | array            | `[]`          | List of directories to serve                         |
| `repos[].name`             | string           | _required_    | Display name and URL slug                            |
| `repos[].path`             | string           | _required_    | Path to the directory (supports `~`)                 |
| `repos[].allowed_read_roots` | array of strings | `[]`        | Additional directories this repo may read (see below) |
| `source_dirs`              | array of strings | `[]`          | Parent directories to scan for git repos (see below) |
| `exclude_dirs`             | array of strings | _(see below)_ | Directories to hide from all listings                |
| `show_hidden`              | boolean          | `true`        | Show hidden files/directories (dotfiles) in the sidebar |
| `walk_max_depth`           | integer or null  | `null` (unlimited) | Max directory depth for untracked file discovery |
| `walk_timeout`             | float            | `30.0`        | Timeout in seconds for the file-discovery subprocess |
| `use_ignore_files`         | boolean          | `true`        | Honor `~/.config/vantage/ignore` and `.vantageignore` |
| `disable_whats_new`        | boolean          | `false`       | Suppress the "What's New" popup                      |
| `log_level`                | string           | `"INFO"`      | Log verbosity: `DEBUG`, `INFO`, `WARNING`, or `ERROR` |

## Source Directory Auto-Discovery

Instead of listing every repo by hand, you can point Vantage at one or more parent directories. Any subdirectory containing a `.git` folder is automatically added as a project:

```toml
source_dirs = ["~/code", "~/projects"]
```

Auto-discovered repos use the directory name as their display name. If a repo is already listed explicitly in `[[repos]]` (by matching its resolved path), it is skipped — so you can mix manual entries with auto-discovery without duplicates. If two discovered repos would have the same name, a numeric suffix is added (e.g., `my-project-2`).

This feature is **off by default** — add `source_dirs` to your config to enable it.

## Allowed Read Roots

By default, each repo can only read files within its own directory. If you need Vantage to follow symlinks or include files from outside the repo root, add `allowed_read_roots` to that repo:

```toml
[[repos]]
name = "my-project"
path = "~/code/my-project"
allowed_read_roots = ["~/.dotfiles/gemini/skills"]
```

This allows Vantage to read files under `~/.dotfiles/gemini/skills` when serving `my-project`, but only that repo has access.

## Excluded Directories

By default, Vantage hides common version-control, dependency, cache, and build directories from the sidebar, file picker, and recent files list — for example `.git`, `.hg`, `.svn`, `node_modules`, `vendor`, `dist`, `build`, and `.cache`.

You can override this list in your config:

```toml
exclude_dirs = ["node_modules", "vendor", "dist", "build"]
```

Setting `exclude_dirs` replaces the default list entirely — include everything you want hidden.

## Performance Tuning

For very large repositories with deep directory trees, two settings control how Vantage discovers untracked Markdown files:

```toml
# Limit scan depth (default: unlimited)
walk_max_depth = 5

# Timeout for the file-discovery subprocess (default: 30 seconds)
walk_timeout = 30.0
```

These settings only affect the discovery of files not tracked by Git. Tracked files are always shown regardless of depth. In most cases the defaults work fine — adjust these only if you notice slow response times in large repos.

## Environment Variables

When running in single-directory mode (`vantage serve`), you can also configure via environment variables:

| Variable             | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `TARGET_REPO`        | Path to the directory to serve                       |
| `HOST`               | Server bind address                                  |
| `PORT`               | Server port                                          |
| `SHOW_HIDDEN`        | Show hidden files (`true`/`false`, default `true`)   |
| `EXCLUDE_DIRS`       | Comma-separated directory names to hide (replaces defaults) |
| `WALK_MAX_DEPTH`     | Max directory depth for untracked-file discovery     |
| `WALK_TIMEOUT`       | Timeout in seconds for the file-discovery subprocess |
| `USE_IGNORE_FILES`   | Honor ignore files (`true`/`false`, default `true`)  |
| `DISABLE_WHATS_NEW`  | Suppress the "What's New" popup (`true`/`false`)      |
| `VANTAGE_LOG_LEVEL`  | Log verbosity (`DEBUG`/`INFO`/`WARNING`/`ERROR`)     |
