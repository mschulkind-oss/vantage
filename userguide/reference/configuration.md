# Configuration

Vantage works out of the box with zero configuration. For daemon mode (serving multiple directories), you'll need a config file.

## Config File Location

The default config path is:

```
~/.config/vantage/config.toml
```

That is the path on Linux and macOS alike. `$XDG_CONFIG_HOME` overrides the `~/.config` half of it when set, on both.

> [!NOTE]
> Macs set up before 2026-09-04 got `~/Library/Application Support/vantage/config.toml` instead, and that file is still honored: when `~/.config/vantage/config.toml` does not exist and the Application Support one does, Vantage reads the old location. Moving the file to `~/.config/vantage/` is the whole migration, and the same rule covers the user ignore file (`~/.config/vantage/ignore`) alongside it.

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

Each directory is accessible at `http://localhost:8000/{name}/` — or
whatever port Vantage printed on startup, if 8000 was taken.

## Reference

| Key                        | Type             | Default       | Description                                          |
| -------------------------- | ---------------- | ------------- | ---------------------------------------------------- |
| `host`                     | string           | `"127.0.0.1"` | Server bind address                                  |
| `port`                     | integer          | `8000`        | Server port. Set explicitly (config, env, or flag) it must be free or startup fails; only the default falls forward, scanning up to 100 ports |
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
| `log_level`                | string           | `"INFO"`      | Log verbosity: `DEBUG`, `INFO`, `WARNING`, or `ERROR` |

## Source Directory Auto-Discovery

Instead of listing every repo by hand, you can point Vantage at one or more parent directories. Any subdirectory containing a `.git` folder is automatically added as a project:

```toml
source_dirs = ["~/code", "~/projects"]
```

Auto-discovered repos use the directory name as their display name. If a repo is already listed explicitly in `[[repos]]` (by matching its resolved path), it is skipped — so you can mix manual entries with auto-discovery without duplicates. If two discovered repos would have the same name, a numeric suffix is added (e.g., `my-project-2`).

**The scan repeats while the daemon runs**, every 30 seconds, and the project list follows the directories in both directions. A repo you clone into a source dir is served within half a minute; one you delete or move away — or whose `.git` you remove, which is the same test that admitted it — stops being served just as quickly. No restart either way, and browsers already open follow along: the project list updates itself, and a page showing a document from a repo that has gone says the repository is not found, then loads that same document again by itself if the repo comes back.

Only repos that auto-discovery added are retired this way. An explicit `[[repos]]` entry whose directory is missing stays in the list and keeps being served — you asserted it should exist, so Vantage lets its requests fail loudly rather than quietly dropping it.

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

## Stored Bookmarks

The [Starred](../features.md#starred) list is not a setting — nothing in the
config file controls it. It is something you accumulated, so it is kept with your
review comments in the data directory rather than beside your settings:

```
~/.local/share/vantage/starred/
```

That location is deliberately fixed, and `XDG_DATA_HOME` does not move it — the
same promise the review store makes, for the same reason: a release that moved it
would leave what you already had behind without saying so.

One file per project, named after the project's own folder with a short hash
after it — `vantage-a1b2c3d4e5f60718.json` — so you can tell at a glance which
list is which. The hash is what keeps two projects of the same name apart, and it
is always there. Which project a list
belongs to is decided by where Vantage was started: `vantage serve` keys on the
directory it is serving, so relaunching there restores the same bookmarks
whatever port or browser you use, while `vantage daemon` keys on its config
file, which stays the same across restarts and does not depend on the working
directory a service manager happens to give it. In daemon mode the one list
covers every repository being served, and each bookmark remembers which it came
from.

On macOS and Windows the project's path is matched without regard to case, the
way those filesystems do, so starting Vantage in `~/Docs` and `~/docs` finds the
same bookmarks. On Linux those are two directories and get two lists.

Deleting a file here clears that project's bookmarks and nothing else.

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
| `PORT`               | Server port (explicit: must be free, never falls forward) |
| `SHOW_HIDDEN`        | Show hidden files (`true`/`false`, default `true`)   |
| `EXCLUDE_DIRS`       | Comma-separated directory names to hide (replaces defaults) |
| `WALK_MAX_DEPTH`     | Max directory depth for untracked-file discovery     |
| `WALK_TIMEOUT`       | Timeout in seconds for the file-discovery subprocess |
| `USE_IGNORE_FILES`   | Honor ignore files (`true`/`false`, default `true`)  |
| `VANTAGE_LOG_LEVEL`  | Log verbosity (`DEBUG`/`INFO`/`WARNING`/`ERROR`)     |
