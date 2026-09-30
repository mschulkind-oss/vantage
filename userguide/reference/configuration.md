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
| `watcher_ignore_defaults`  | array of strings | _(see below)_ | Live-reload watcher-only gitignore patterns |
| `log_level`                | string           | `"INFO"`      | Log verbosity: `DEBUG`, `INFO`, `WARNING`, or `ERROR` |
| `tips`                     | boolean          | `true`        | Let `vantage serve` print its one-line startup tip about the background service (only ever when its output is a terminal). Read by `serve` only |
| `theme`                    | string           | `""` (built-in look) | Color theme a browser opens in until its reader picks another. Read only from `~/.config/vantage/config.toml`, at startup. A project can offer one below it — see [A Theme a Project Offers](#a-theme-a-project-offers) |

## Source Directory Auto-Discovery

Instead of listing every repo by hand, you can point Vantage at one or more parent directories. Any subdirectory containing a `.git` folder is automatically added as a project (linked worktrees are skipped so multiple trees do not duplicate projects):

```toml
source_dirs = ["~/code", "~/projects"]
```

Auto-discovered repos use the directory name as their display name. If a repo is already listed explicitly in `[[repos]]` (by matching its resolved path), it is skipped — so you can mix manual entries with auto-discovery without duplicates. If two discovered repos would have the same name, a numeric suffix is added (e.g., `my-project-2`).

**The scan repeats while the daemon runs**, every 30 seconds, and the project list follows the directories in both directions. A repo you clone into a source dir is served within half a minute; one you delete or move away — or whose `.git` you remove, which is the same test that admitted it — stops being served just as quickly. No restart either way, and browsers already open follow along: the project list updates itself, and a page showing a document from a repo that has gone says the repository is not found, then loads that same document again by itself if the repo comes back.

Only repos that auto-discovery added are retired this way. An explicit `[[repos]]` entry whose directory is missing stays in the list and keeps being served — you asserted it should exist, so Vantage lets its requests fail loudly rather than quietly dropping it.

This feature is **off by default** — add `source_dirs` to your config to enable it, or let `vantage install-service --source-dir ~/code` add the entry and start the service for you ([CLI Reference](cli-reference.md#vantage-install-service)). Running `vantage ~/code` without the daemon serves the clones the same way, through the same discovery, and adds one project for any Markdown outside them, which the daemon does not serve ([Getting Started](../getting-started.md#serve-a-directory-of-clones)).

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

By default, Vantage hides common version-control, worktree, dependency, cache, and build directories from the sidebar, file picker, and recent files list — for example `.git`, `.hg`, `.svn`, `worktrees`, `node_modules`, `vendor`, `dist`, `build`, `target`, and `.cache`.

You can override this list in your config:

```toml
exclude_dirs = ["node_modules", "vendor", "dist", "build", "target"]
```

Setting `exclude_dirs` replaces the default list entirely — include everything you want hidden.

## Ignore Files and Live Reload

When `use_ignore_files = true` (the default), Vantage reads two optional
gitignore-style files: `~/.config/vantage/ignore` for every repo and
`<repo>/.vantageignore` for one workspace. These files hide matching paths from
file listings and from the live-reload watcher. Set `use_ignore_files = false`
to disable those two file-backed layers.

The live-reload watcher has its own built-in patterns before those files:

```toml
watcher_ignore_defaults = [".yolo/", ".pi/", "node_modules/", ".venv/", "venv/", "target/", "build/", "dist/", ".cache/", "__pycache__/"]
```

These are gitignore-style patterns, not directory basenames. They keep generated
or dependency trees from consuming one OS watch per directory, and they do not
affect the sidebar, file picker, recent files, or git discovery. A later user or
workspace ignore file can restore one with a negation such as `!target/`. To
watch everything, replace the list with an empty one:

```toml
watcher_ignore_defaults = []
```

`use_ignore_files = false` disables only the two ignore files. It does not
disable `watcher_ignore_defaults`; use the empty list above for that.

The watcher prunes directories while walking the tree. If a default ignores a
directory, negating only a file inside it (for example
`!target/docs/readme.md`) is not enough; also unignore the directory itself
(`!target/`) so the watcher can enter it.

Vantage-owned state remains special: `.vantage/` is hidden and ignored even when
ignore files are disabled, except the watcher keeps `.vantage/inbox` reachable
for review deliveries. The watcher also keeps the top-level `.git` directory so
repository state files can trigger status updates, but it does not descend into
`.git` internals.

## Stored Bookmarks

The [Starred](../features.md#starred) list is mostly not a setting — what you star
is something you accumulated, so it is kept with your review comments in the data
directory rather than beside your settings:

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

### Documents you always want starred

Two config files *can* add rows to the section, and neither writes anything into
the file above.

Your own list travels with you and applies in whichever project you open:

```toml
# ~/.config/vantage/config.toml
[starred]
promote = ["roadmap.md", "ROADMAP.md"]
```

A plain path is starred **only where it exists**, which is what makes a list like
that one useful across projects: name every spelling of the file you care about,
and each project shows the one it actually has. On macOS and Windows, where the
filesystem treats those spellings as one file, you get a single row under the
first spelling you wrote rather than one per spelling.

A project can also name documents for anyone who opens it, in the same
`.vantage.toml` that [configures `vantage-check`](../guides/vantage-check.md):

```toml
# .vantage.toml, committed at the repository root
[starred]
promote = ["roadmap.md", "docs/design/*.md"]
```

A pattern uses gitignore syntax and matches documents, not folders; a plain path
may name a folder if you give it a trailing slash. Paths are relative to the
repository root and cannot point outside it. Here a plain path is starred whether
or not it exists yet, because a project naming a document it has not written is an
ordinary state.

Both lists add to each other rather than one replacing the other, and the rows
they add carry a pin and name the file that promoted them. You cannot unstar one
— nothing of yours created it — so remove the line instead. Anything you starred
yourself always wins: if you star a promoted document, it becomes yours and the
pin goes.

If either file cannot be read, the rows it would have added are simply absent:
Vantage logs a warning naming the file and serves the project as though the list
were empty.

## A Theme a Project Offers

A project can name the color theme its documents are meant to be read in, in the
same `.vantage.toml` that holds its starred list:

```toml
# .vantage.toml, committed at the repository root
theme = "catppuccin"

[starred]
promote = ["roadmap.md"]
```

The value is a theme id — the same ids the `theme` key above takes.

> [!IMPORTANT]
> **The key goes before any `[table]` header**, as it is above. TOML reads a bare
> key written after a header as part of that table, so `theme` after `[check]` is
> `check.theme` — a key inside `vantage-check`'s own table, which it refuses. The
> mistake therefore shows up as `unknown key check.theme` failing the project's
> check run, not as a theme that quietly did nothing.

**It is an offer, not a setting.** It applies only to a reader who has chosen
nothing in their browser and named nothing in their own config; the full order is
[Which one wins](../guides/themes.md#which-one-wins). Nothing a repository
commits can recolor a reader who has picked a theme.

The theme itself has to be one the reader already has: a built-in, or a file in
their own themes folder. A project names a theme; it does not ship one, and an id
nobody has is simply no default.

This key is re-read as the file changes, so an edit applies on the next page load
— unlike the user config's `theme`, which is read once at startup and needs a
restart. A `.vantage.toml` that does not parse, or a `theme` that could not be an
id at all, is ignored whole: Vantage logs a warning naming that repository and
serves it as though the key were absent, so in daemon mode one project's bad
commit cannot color another's pages.

In daemon mode the project is resolved from the first segment of the URL, which
every document page has (`/notes/README.md` is the `notes` project). The project
list at `/` has no project and so no offer to apply.

## Planning Documents

The `[planning]` table in `.vantage.toml` says which files Vantage reads as the
repository's plans, which of them are roadmaps, and what the repository's stage
words mean. What Vantage does with them (badges on links, the planning page,
and `vantage-check index`) is in the [Planning Documents](../guides/planning.md)
guide. The table is optional, and every key has a default:

```toml
# .vantage.toml, committed at the repository root
[planning]
# roadmap absent, the default: every candidate named roadmap.md is a roadmap
# roadmap = "plans/roadmap.md"                       # exactly this one
# roadmap = ["roadmap.md", "docs/plans/roadmap.md"]  # exactly these; [] is none
include = ["**/*.md"]         # the default
exclude = ["docs/gallery/**"] # the default is []
max-file-bytes = 1048576      # the default: 1 MiB
max-candidates = 5000         # the default

[planning.stages]             # optional; with none, no stage has a role
DESIGN = "open"
DECIDED = "ready"
BUILT = "built"
SUPERSEDED = "done"
```

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `roadmap` | string, or array of strings | none: every candidate named `roadmap.md` | The files whose links set the order. Absent, every candidate whose file name is `roadmap.md`, in any directory and in any ASCII case, is a roadmap; `include` and `exclude` hide one like any other file. Set, it names exactly the roadmaps: a string is one, an array is each of them, and `[]` is none. A listed path is relative to the repository root, a leading `./` is dropped, and an empty path, a leading `/`, a `..` segment or a path listed twice is an error. A listed roadmap is read whenever it exists, even if `include` or `exclude` would rule it out |
| `include` | array of strings | `["**/*.md"]` | Patterns a candidate must match. An explicit `[]` is kept, and then only the listed roadmaps are read |
| `exclude` | array of strings | `[]` | Patterns that rule a candidate out, even when `include` matches it |
| `max-file-bytes` | integer | `1048576` | A candidate larger than this is skipped, and listed as skipped. A whole number, at least 1 |
| `max-candidates` | integer | `5000` | With more candidates than this, nothing is scanned at all. A whole number, at least 1 |
| `[planning.stages]` | table of strings | none | Each stage word, mapped to one of four roles: `open`, `ready`, `built` or `done`. A word is kept exactly as written, case and spaces included. An empty table is the same as none |

The patterns choose from Vantage's own list of the repository's `.md` files,
which already leaves out hidden directories, the
[excluded directories](#excluded-directories), linked worktrees, symbolic
links, and paths matched by the [ignore files](#ignore-files-and-live-reload).
None of those is ever read. `vantage-check` reads the same table and follows
the same rules, except for two settings it cannot see, `exclude_dirs` and
`~/.config/vantage/ignore`: they belong to one reader of the repository rather
than to the repository itself, so where they are set, `vantage-check index` can
list a file that your Vantage does not.

> [!WARNING]
> **A roadmap found by name has to be a candidate, and the default `include` is
> case-sensitive.** `**/*.md` does not match `ROADMAP.MD`, so that file is not a
> roadmap until `include` matches it, or `roadmap` lists it. `ROADMAP.md` and
> `docs/plans/Roadmap.md` are found, since only the `.md` has to match.

With several roadmaps, the [planning page](../guides/planning.md) offers a
choice of roadmap, and `vantage-check index` lists them all; a question is
routed when any roadmap routes it.

The patterns use the same gitignore syntax as `[starred] promote`, and every
line goes through that one matcher, a plain path included. It is not git's own
matcher:

- `?` is a literal character, not a wildcard;
- a pattern with a slash inside it is not anchored to the root, so
  `docs/gallery/**` also matches `x/docs/gallery/a.md`;
- `[`, `(`, `\`, `{` and `+` keep their meaning in an
  [RE2](https://github.com/google/re2/wiki/Syntax) regular expression, and a
  line RE2 cannot compile is ignored.

The table is checked as a whole, like the rest of the file. An unknown key in
`[planning]` (`roadmaps` among them: the key is `roadmap` in both forms), a
`roadmap` that is neither a path nor a list of paths, a role outside the four,
or a limit that is not a whole number of at least 1 makes the file
untrustworthy:

- **the server** logs a warning naming the file and serves the repository as
  though the file were absent, so its `[starred]` list and `theme` are dropped
  along with the table;
- **`vantage-check`** exits `2` on every run, `check` included, as it does for a
  bad `[check]` key.

A change to the file applies at once: an open page rescans the repository.

## Performance Tuning

For very large repositories with deep directory trees, two settings control how Vantage discovers untracked Markdown files:

```toml
# Limit scan depth (default: unlimited)
walk_max_depth = 5

# Timeout for the file-discovery subprocess (default: 30 seconds)
walk_timeout = 30.0
```

These settings only affect the discovery of files not tracked by Git. Tracked files are always shown regardless of depth. In most cases the defaults work fine — adjust these only if you notice slow response times in large repos.

### When a project is too big to serve well

These limits make Vantage serve a project worse than normal, and when one is
hit, a banner at the bottom of the page says so instead of leaving it to the
log:

| What happened | What the banner says is off | What to change |
| ------------- | --------------------------- | -------------- |
| The live-reload watcher ran out of the system's watches | Live reload, below the first folder it could not watch | Raise the limit (on Linux, `fs.inotify.max_user_watches`; on macOS, where every watched file holds an open file, `kern.maxfilesperproc`), or list the biggest folders in `.vantageignore` or `watcher_ignore_defaults` |
| Finding untracked files took longer than `walk_timeout` | Recent files may be missing untracked documents | Raise `walk_timeout`, or list the biggest folders in `.vantageignore` |
| The project's watcher could not start at all, usually because the system ran out of watcher instances (each project takes one) | Live reload, for the whole project | Raise the limit (on Linux, `fs.inotify.max_user_instances`), then restart Vantage |

The banner shows the open project's reports only, and the dismiss button hides it
until the page is reloaded. Serving a directory of clones as one project with
`--one-project` is the usual way to reach the first limit.

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
| `VANTAGE_NO_TIPS`    | Set to `1` to stop the one-line startup tip about the background service (`0`, `false`, `no` and `off` keep it) |
