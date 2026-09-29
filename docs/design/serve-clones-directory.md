---
title: "Serving a directory of clones: `vantage ~/code` becomes one project per repository"
author: "Matt Schulkind"
date: 2026-09-29
status: accepted
stage: DECIDED
tags: [serve, daemon, config, install-service, watcher, onboarding]
summary: "`serve` on a directory that holds git clones now serves it the way the daemon serves a `source_dirs` entry, with one extra project for Markdown that sits outside every clone. A startup reminder points at `install-service`, which gains `--source-dir`, and a browser banner reports when a project is too big to watch or walk."
vantage:
  status-chip: true
---

# Serving a directory of clones

**Status:** decided on 2026-09-29. The owner approved the defaults below in the
brief for this change. Where the brief left a question open, this note gives the
ruling and the reason, in the [Decision Ledger](#decision-ledger).

**The short version.** A first-time user ran `vantage ~/code`, where `~/code`
holds all his clones and is exactly what a daemon's `source_dirs` would point
at. `serve` treated it as one project, and the result was poor enough that he
reported 404s. The daemon already knows how to split such a directory into one
project per clone, so `serve` now splits it with the same code. Everything else
here supports that change: a flag that keeps the old behavior, a reminder that a
background service exists, a way to add the directory to that service in one
command, and a banner for the cases where a project is still too big to serve
well.

## 1. What actually failed

The 404 has not been reproduced. A fixture of three tiny repositories, each with
a `README.md`, a `docs/guide.md` and a gitignored `generated/out.md`, plus one
loose `notes.md`, served as one project answered every request the viewer made
with a 200. That covered `/`, a file view, history, a commit diff, the
working-copy diff and recents. So the defect is the conditions a real `~/code`
creates, not a route that is missing. Four of those conditions are confirmed
on the fixture, and the first grows with the number of clones:

1. **The watcher watches the inside of every clone's `.git`.** The watcher
   prunes `.git` below its first level only when `.git` is the *root's*
   (`shouldPruneDir` in `internal/live/watcher.go` checks `parts[0] == ".git"`).
   Under a parent directory, `alpha/.git/objects/…` is an ordinary subdirectory,
   so the watcher watches every object directory. It registered 57 watches for
   the fixture, and 51 of them were inside `.git`. This repository's own `.git`
   holds 249 directories, so 23 real clones cost thousands of watches before
   the first document is counted. On a machine with the older default of
   `fs.inotify.max_user_watches=8192`, the watch limit (coined here: the kernel
   cap on how many directories one user can watch) runs out. After that, live
   reload fails for this process and for every other watcher the user runs.
   Until this change, the only report of that failure was a log line.
2. **No clone's `.gitignore` applies.** The listing asks `git check-ignore` from
   the served root, which is not a repository, so the call fails and nothing is
   hidden. `alpha/generated/out.md` stayed in the tree with *show gitignored*
   turned off, and stayed in `/files/all` and the planning index too.
3. **Working-copy status is blank.** `GitService.Status` returns nothing when
   the root is not a work tree, and unlike history it does not hand the path to
   the child repository. A modified `alpha/README.md` reported
   `git_status: null`.
4. **Every walk covers every clone.** The file picker, the planning index and
   the has-Markdown probe all walk the whole directory, `node_modules` excepted.
   Once a directory holds more than 5,000 Markdown files, the planning index
   refuses to answer.

Review found one literal 404, and it is not particular to either mode. A
project's name is the first segment of its URLs, and `api` is a common name for
a repository, so a project named `api`, or a folder `api/` served as one
project, has its pages under the API's own `/api/` prefix. Loading one
directly (a reload, a bookmark, a link) got the API's JSON 404 for a route it
does not have. A browser loading a page there now gets the viewer, whose own
requests go through `/api/r/api/…`, while any other request that misses every
API route still gets the 404. Projects named `history` or `recent` have the
same problem with the viewer's own pages of those names, and still open the
wrong page on a direct load.

The likeliest source of the reported 404s is the first condition together with
the viewer's own error states. A request that times out, or a document the
tree lists but the watcher never reports, shows as "not found" to someone who
does not read the log. That remains a guess, and this change does not depend on
it: splitting the directory removes all four conditions, and the banner in
[§7](#7-too-big-to-serve-well-a-banner-in-the-browser) makes the first one
visible wherever it still happens.

## 2. Detection, at `serve` startup only

A clones directory (coined here: a directory that is not inside a git work tree
and has at least one immediate child that is a repository) is served the way
the daemon serves a `source_dirs` entry. `serve` makes that decision once, at
startup, using these rules:

- **Inside a repository means one project**, however many repositories sit
  below it. The test is `git rev-parse --show-toplevel`, the same one the git
  service runs. A monorepo with vendored clones stays one project.
- **Detection looks one level deep.** A child counts when it holds a `.git`
  directory or is a linked worktree: its `.git` is a *file* whose content starts
  with `gitdir:`, as `git worktree add` writes it. A grandchild never counts.
- **The projects come from `Config.DiscoverReposFromSourceDirs`.** `serve` sets
  `SourceDirs` to the one directory and calls the daemon's discovery. Both modes
  run the same code, so they cannot drift, and the daemon's refresh loop comes
  along too. A clone made after startup appears within the loop's 30 seconds,
  and a deleted one is retired.
- **Names are the directory names**, with the daemon's `-2`, `-3` suffix on a
  collision. Every clone gets exactly the name the daemon gives it, so a link
  to a clone means the same project in `serve` and in the service. When a clone
  is named like the directory that holds it, the loose project
  ([§3](#3-the-loose-project)) is the one that takes the suffix.
- **`--one-project`** turns detection off and serves the directory as one
  project, the way `serve` always has.

### 2.1 Linked worktrees count for detection and are not served

The brief asked for a linked worktree to count as a repository, and for a ruling
on whether that belongs in the shared discovery code.

**It does not, so the daemon's behavior is unchanged.** On 2026-09-27, commit
`194e4f3` made discovery, the listing, the file walks and the watcher all skip
linked worktrees on purpose, so that several worktrees of one repository do not
show up as several copies of its documents. Serving them here would undo that
ruling for one mode only, and the shared code exists so that the modes cannot
differ.

A linked worktree therefore counts as evidence that a directory holds
repositories, which triggers the split, and it is a boundary (coined here: a
directory no walk enters). It is not a project in either mode. If every child
is a worktree, the directory still splits, and only the loose project is served
([§3](#3-the-loose-project)), because every mode already skips worktrees.

## 3. The loose project

Markdown that sits in the directory but in none of its clones (a `notes.md`
beside the clones, a `drafts/` folder) would vanish in a plain split. When such
a file exists, one more project is served, named after the directory itself,
or with the `-2` suffix when a clone already has that name.
This note coins the name *loose project* for it. It is listed first in both of
the sidebar's sort orders.

- **Its walks stop at every repository boundary.** The tree, the file picker,
  recents, the planning index, the has-Markdown probe and the watcher skip any
  directory that holds a `.git` directory or is a linked worktree, at any depth.
  Requests for a path inside a boundary are refused the way a missing file is,
  images included. It never hands git work to a child repository, because each
  child is a project of its own.
- **Boundaries can change while it runs.** A directory that becomes a
  repository is dropped from the watcher, whether git writes its `.git` before
  or after the directory's watch exists. A clone that loses its `.git` is
  retired by the next rescan, and the loose project's watcher then watches it
  as a plain folder. A repository deeper down that loses its `.git` is listed
  at once but not watched until the next start, because nothing from inside it
  reaches the watcher.
- **A link into a clone opens the clone's project.** A relative link or image
  in a loose note that points into a clone, such as `[alpha](alpha/README.md)`
  in `~/code/README.md`, names a path the loose project refuses. So the loose
  project's entry in `/api/repos` carries `clones`: each directory directly
  inside it that another project serves, a symlink to a clone included, mapped
  to that project's name. The viewer sends such a link, and such an image, to
  that project.
- **The existence check is bounded.** It is the fs service's own has-Markdown
  walk: it stops at the first Markdown file, respects `walk_max_depth` and the
  exclude list, and skips boundaries. So it costs one short walk, not a count.
- **With no loose Markdown, there is no loose project.** The one exception is a
  directory that has no project at all, where every child is a worktree. The
  loose project is then served anyway, because a server with nothing to show
  would be worse.
- **The decision is made at startup.** A loose file created later does not add
  the project. This is the same startup-only rule as [§2](#2-detection-at-serve-startup-only).

## 4. What `serve` prints

Unlike the tips in [§5](#5-the-service-reminder), this line always prints, on stderr, before the
`Serving on` line:

```text
~/code holds 23 git repositories; serving each as its own project (plus "code" for the Markdown outside them). Use --one-project to serve it as a single project.
```

The brief's example gave a file count ("for 4 loose files"). That conflicts
with the rule that the check stops at the first file, and the rule wins: an
exact count would mean a full walk of the directory at startup, which is the
cost this change removes. Paths under the home directory are shown with `~`.

## 5. The service reminder

`serve` prints one tip on stderr at startup, but only when stderr is a
terminal. `VANTAGE_NO_TIPS=1`, or `tips = false` in the user config, turns it
off. The tip describes the state of the per-user service that
`install-service` writes:

| State | Tip |
| --- | --- |
| clones directory, no service installed | `To keep them all in the background at http://localhost:8000: vantage install-service --source-dir ~/code` |
| one project, no service installed | `Tip: vantage install-service runs Vantage in the background for all your projects.` |
| service running | `A Vantage service is already running at http://localhost:<port>.`, followed by `This project is open there: http://localhost:<port>/<project>` when it serves this directory. For a clones directory with a loose project, it is `Its clones are open there, but not the Markdown outside them: …`, because the daemon never serves a loose project |
| installed, not running | `A Vantage service is installed but not running. Start it with: systemctl --user start vantage`. On macOS it is `launchctl kickstart gui/$(id -u)/io.github.mschulkind-oss.vantage (or, if it is not loaded, launchctl bootstrap …)`: an installed agent that does not answer is usually loaded and stopped, and `bootstrap` refuses an agent that is loaded |
| installed, a foreground `serve` at its address | `A Vantage service is installed, but a foreground vantage serve is answering at its address, http://localhost:8000. Stop that one, then start the service with: …` |

- **Installed** means the unit file or property list that `install-service`
  writes exists, at the same path. Both commands use one path function.
- **Running** means one `GET /api/repos` to the configured host and port, which
  `config.toml` sets and which default to `127.0.0.1:8000`, with a 200 ms
  timeout, answered by `vantage daemon`. Every API response says which kind of
  server sent it in an `X-Vantage-Mode` header, `daemon` or `serve`, because a
  split `serve` lists project names just as the daemon does. So `vantage ~/code`
  in one terminal is not taken for the service by `vantage ~/notes` in
  another. A server too old to send the header is judged by its answer: a
  single-project `serve` lists one project with no name. The check runs before
  `serve` binds its own port, so it cannot find itself, and it runs only when
  a tip will be printed. Before it, only the address is read from the config;
  the rest, which resolves paths and scans source dirs, is read only once a
  service has answered.
- **This project is open there** is decided from the service's own config. The
  served directory is compared with each configured and discovered repository
  path, or with a `source_dirs` entry when the directory is a clones directory,
  and the service must list the matching name in its `/api/repos`: for a
  clones directory, a project discovered in it. A daemon reads `source_dirs`
  only at startup, so an entry added by hand is not open there until it
  restarts. For a clones directory, the link goes to the service's root, where
  every clone is listed.
- **The clones-directory tip starts at "To keep them all"**, because the line
  in [§4](#4-what-serve-prints) has already said what the directory holds. The brief's wording would
  have printed that fact twice.

## 6. `install-service --source-dir`

`vantage install-service --source-dir <dir>` may be repeated. Each directory is
expanded (`~`, relative paths, symlinks) and added to `source_dirs` in the user
config. The command then installs the service and starts it. Without
`--source-dir`, it writes the unit and prints the commands, as before.

- **The config file keeps everything already in it.** The command reads the
  file as TOML and then rewrites only the text of the top-level `source_dirs`
  assignment. If there is none, it inserts one before the first table header.
  Duplicates of an existing entry are dropped. The command then decodes the new
  text and checks that every other key decodes as before.
- **A config that is a link is edited behind it.** A `config.toml` kept in a
  dotfiles repository is a symlink. The file it points to is the one edited,
  with any backup beside it, and the link stays a link. Replacing the link
  would leave the dotfile without the entry and move the path the daemon keys
  its bookmarks on. A file the user cannot write, such as one made read-only
  or a link into `/nix/store`, is refused with its name rather than replaced.
- **When a safe in-place edit is impossible, the old file is kept.** Comments
  inside the array, or after its `[`, are no obstacle: a new entry goes on a
  line of its own, indented like the first entry that starts a line. What the
  edit cannot rewrite is a key written as a quoted name, a closing bracket that
  shares its line with an entry, or text that fails the round-trip check. For
  those, the original is copied to `config.toml.bak-<timestamp>` first, then
  rewritten from the decoded values, and the command says that it made a
  backup and where. The rewrite must pass the same round-trip check, because
  the TOML encoder moves a local time through the time zone, and one that
  would change another setting is refused, with the file left alone. A dotted key makes `source_dirs` a table, which is no list
  of directories, so that file is refused.
- **A missing config is created** with a short header, the key, and the
  default port written down. A daemon whose port is only the default moves to
  the next free one when it is busy, as it is while the `serve` that printed
  the tip still runs, and a service that moved is one nothing looks for. With
  the port written down, the daemon exits instead, and the service manager
  starts it again until the port is free.
- **What changed is printed:** which directories were added, which were already
  there, and the file that was written.
- **A config that would not start the daemon stops the command** before
  anything is installed, and before the config itself changes: the edited file
  is written beside the config and checked there, and replaces it only when
  the daemon would start from it. So a refused run leaves an existing config
  byte for byte as it was, and creates none. This happens when no repository
  is configured at all, for example when the only source directory holds no
  clones. The daemon's own validation gives the reason.
- **Starting the service** on Linux runs `systemctl --user daemon-reload`,
  `enable vantage` and `restart vantage`. The command uses `restart` because a
  running daemon reads `source_dirs` only at startup. On macOS it runs
  `launchctl bootout` and then `launchctl bootstrap`. A failed `bootout`
  usually means the agent was not loaded, so it does not stop the command, but
  its error is printed: if it meant something else, `bootstrap` fails next,
  and that error is what explains it. The commands go through a runner that
  tests replace, so no test starts a real service.
- **The unit or plist is rewritten on every run**, since running the command
  again is how a directory is added and how an upgrade points the service at
  the new binary. One that differs in anything but the binary it names holds
  edits of the user's own, such as a raised `LimitNOFILE`, and is first kept as
  `<file>.bak-<timestamp>`, which the command names.
- **The service reads the config the command wrote.** The config path follows
  `XDG_CONFIG_HOME`, and a service manager hands its service none of the
  shell's environment. So when the variable names somewhere other than
  `~/.config`, the unit's `Environment=` or the plist's
  `EnvironmentVariables` carries it, with or without `--source-dir`. Its
  themes, bookmarks and ignore file follow the same variable.
- **Running is what answers.** A start command succeeds as soon as the process
  forks, so the command then asks the service's address for up to three
  seconds. It says the service is running only when a daemon answers, and
  otherwise says what does: a foreground `serve` holding the port, or nothing,
  with the command that shows the service's log.

## 7. Too big to serve well: a banner in the browser

A project too big to serve well now says so in the browser. This applies with
or without the split. Three conditions are reported:

- **Watch limit reached.** When registering a watch fails with the kernel's
  watch-limit error (`ENOSPC` from inotify, or on macOS and the BSDs, where
  kqueue holds a file open for every watched directory and file, `EMFILE`),
  the watcher records a degradation (coined here: a named
  way a project is served worse than normal, with the path where it starts).
  The banner says: *Live reload is off below `docs/big` (and N more folders):
  the system's file-watch limit was reached.* It also names the setting to
  raise.
- **The untracked-file walk hits `walk_timeout`.** Recents then lack every
  untracked file, and the banner says so and names the setting. A later run
  of the same walk that finishes in time takes the report back, and the
  report lasts while any walk's latest run timed out. Walks are told apart by
  the directory they cover, which is a child repository's when a directory of
  clones is served as one project, and by whether they include gitignored
  files, since a reader who hides those runs a walk of their own. The server's
  own last-activity walk reports nothing, because nobody reads its result as a
  list of files.
- **A project's watcher cannot start at all.** Live reload is then off for the
  whole project. Each project has a watcher of its own, and on Linux each one
  takes an inotify instance, whose default limit of 128 per user is shared
  with every other program. A directory of many clones can run out, and the
  banner names `fs.inotify.max_user_instances` when it does.

Degradations are kept per project in memory and served at `GET
/api/degraded`. The first degradation of each kind in each project also
pushes `degraded_changed` over the WebSocket, and the viewer fetches the list
again when it arrives. The banner is fixed to the bottom of the viewport, so a
report that arrives late never moves content already on screen. The reader can
dismiss it until the page is reloaded; a limit still hit after a reload is worth
saying again. Tests trigger these conditions by
setting the limits low, a watch budget of a few directories or a walk timeout
of a nanosecond, and never by building a large tree.

## 8. Non-goals

- **Detection deeper than one level.** `~/code/work/*` clones are not
  discovered, just as the daemon does not discover them. Point `serve` at
  `~/code/work`.
- **A live change of mode.** A directory that becomes a repository, or gains
  its first clone, while `serve` is running keeps the mode it started with.
- **Fixing the one-project mode's four conditions.** `--one-project` keeps
  today's behavior, and the banner makes its worst case visible. Delegating
  status and `.gitignore` to children is possible, but only someone who asked
  for one project uses that path now.

## Decision Ledger

| # | Question | Ruling |
| --- | --- | --- |
| D1 | Split a clones directory by default? | Yes, at startup, with the daemon's discovery code ([§2](#2-detection-at-serve-startup-only)). |
| D2 | Do linked worktrees belong in the shared discovery? | No. They count for detection and are boundaries, and they are not served in either mode, following `194e4f3` ([§2.1](#21-linked-worktrees-count-for-detection-and-are-not-served)). |
| D3 | When is there a loose project? | When the directory has Markdown outside every clone, found by a walk that stops at the first file. It is listed first and stops at every boundary ([§3](#3-the-loose-project)). |
| D4 | Does the startup line give a count of loose files? | No. The walk stops at the first file, so there is no count to print ([§4](#4-what-serve-prints)). |
| D5 | Where does the tip read service state? | The unit or plist path `install-service` writes, plus one 200 ms `GET /api/repos` before `serve` binds ([§5](#5-the-service-reminder)). |
| D6 | How does `--source-dir` edit the config? | It rewrites only the text of the `source_dirs` value and checks the round trip. It backs the file up first whenever it cannot do that safely ([§6](#6-install-service---source-dir)). |
| D7 | How does the service pick up a new `source_dirs`? | `install-service --source-dir` restarts it ([§6](#6-install-service---source-dir)). |
| D8 | What reaches the browser? | The watch limit, the untracked-walk timeout, and a watcher that cannot start, through `/api/degraded` and a bottom-fixed banner ([§7](#7-too-big-to-serve-well-a-banner-in-the-browser)). |
