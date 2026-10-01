# CLI Reference

All available `vantage` commands and their options.

## `vantage` / `vantage serve`

Start the Vantage server for a single directory.

```bash
vantage [PATH]
vantage serve [PATH] [--host HOST] [--port PORT] [--no-open] [--show-hidden]
              [--exclude-dirs DIR,...] [--use-ignore-files] [--walk-max-depth N]
              [--walk-timeout SECONDS] [--one-project]
```

`PATH` may be a directory (served as the repo root) or a single Markdown file (its parent becomes the repo root). When omitted, the current directory is served. Vantage opens your default browser automatically on startup.

A directory of clones — one that is not inside a git repository and has git repositories among its immediate children — is served the way the daemon serves a `source_dirs` entry: one project per repository, plus one project named after `PATH` for any Markdown outside them. `--one-project` serves it as a single project instead. See [Serve a directory of clones](../getting-started.md#serve-a-directory-of-clones).

When its output is a terminal, `serve` prints one line about the background service at startup. `VANTAGE_NO_TIPS=1` or `tips = false` in the config file turns it off.

| Argument/Option       | Default                 | Description                                            |
| --------------------- | ----------------------- | ------------------------------------------------------ |
| `PATH`                | `.` (current directory) | Directory or Markdown file to serve                    |
| `--host`              | `127.0.0.1`             | Server bind address                                    |
| `--port`              | `8000`                  | Server port. Set explicitly (flag, `PORT` env, or config) it must be free or startup fails; only the default falls forward, scanning up to 100 ports |
| `--no-open`           |                         | Do not open the browser on startup                     |
| `--show-hidden`       | `true`                  | Show hidden files/directories (dotfiles) in the sidebar |
| `--exclude-dirs`      | _(see Configuration)_   | Directory names to exclude from listings (replaces defaults) |
| `--use-ignore-files`  | `true`                  | Honor `~/.config/vantage/ignore` and `.vantageignore` |
| `--walk-max-depth`    | `0` (unlimited)         | Maximum depth for untracked-file discovery             |
| `--walk-timeout`      | `30`                    | Timeout in seconds for untracked-file discovery        |
| `--one-project`       |                         | Serve `PATH` as one project even when it is a directory of git clones |

Running `vantage` with no subcommand is equivalent to `vantage serve .`.

---

## `vantage daemon`

Start the daemon to serve multiple directories from a config file.

```bash
vantage daemon [--config PATH] [--host HOST] [--port PORT]
```

| Option           | Default                         | Description                       |
| ---------------- | ------------------------------- | --------------------------------- |
| `--config`, `-c` | `~/.config/vantage/config.toml` | Path to the config file           |
| `--host`         | From config                     | Override the host from the config |
| `--port`         | From config                     | Override the port from the config (must be free — explicit ports never fall forward) |

See [Daemon Mode](../guides/daemon-mode.md) for details on the config file format.

---

## `vantage init-config`

Generate an example configuration file for daemon mode.

```bash
vantage init-config [--path PATH] [--force]
```

| Option          | Default                         | Description                       |
| --------------- | ------------------------------- | --------------------------------- |
| `--path`, `-p`  | `~/.config/vantage/config.toml` | Where to create the config file   |
| `--force`, `-f` |                                 | Overwrite an existing config file |

---

## `vantage build`

Build a static site from a directory of Markdown files. The output is a self-contained folder that can be deployed to any static hosting provider.

```bash
vantage build [PATH] --output DIR [--name NAME] [--frontend-dist DIR]
```

| Argument/Option   | Default            | Description                                            |
| ----------------- | ------------------ | ------------------------------------------------------ |
| `PATH`            | `.` (current dir)  | Directory containing Markdown files                    |
| `--output`, `-o`  | _required_         | Output directory                                       |
| `--name`, `-n`    | Directory name     | Display name shown in the UI                            |
| `--frontend-dist` | _(embedded)_       | Use this built frontend (a Vite build's output folder) instead of the one inside the binary |

See [Static Sites](../guides/static-sites.md) for a full guide on this workflow.

---

## `vantage install-service`

Install Vantage as a per-user background service that starts on login.

```bash
vantage install-service [--source-dir DIR]...
```

On its own it writes the service definition for the host platform and prints the commands that load it — it does not activate anything itself.

`--source-dir DIR`, which may be repeated, does the whole setup for a directory of clones. It adds `DIR` to `source_dirs` in `~/.config/vantage/config.toml`, then writes the service and starts it. On Linux that runs `systemctl --user daemon-reload`, `enable vantage` and `restart vantage`; on macOS, `launchctl bootout` and `bootstrap`.

- `~` and relative paths are expanded, and a directory already listed is skipped.
- A missing config file is created, with the default port written down so that the service waits for that port when it is busy rather than moving to another. An existing one keeps its comments and every other key: the command edits its text and then checks that nothing else changed. When it cannot edit the file that way, it saves the original as `config.toml.bak-<time>` first and says so. A config that is a symlink, into a dotfiles repository say, is edited where it points, and the link is left in place.
- The service definition is rewritten every time, so it runs the binary you ran. If you edited it yourself, your version is saved beside it as `<file>.bak-<time>` first, and the command says so. For settings that should last, a systemd drop-in (`systemctl --user edit vantage`) is never touched.
- When `XDG_CONFIG_HOME` points somewhere other than `~/.config`, the service is given it too, since a login service does not inherit your shell's environment. This holds without `--source-dir` as well.
- The command prints what it changed and what it ran. If the resulting config would give the daemon nothing to serve, it stops before installing anything.
- It then waits a few seconds for the service to answer, and says it is running only if it does. Otherwise it says what is answering at the service's address instead, such as a `vantage serve` still running in another terminal, or where the service's log is.

```bash
vantage install-service --source-dir ~/code --source-dir ~/work
```

| Platform | Writes | Full setup |
| -------- | ------ | ---------- |
| Linux (systemd) | `~/.config/systemd/user/vantage.service` | [Daemon Mode](../guides/daemon-mode.md#running-as-a-systemd-service) |
| macOS (launchd) | `~/Library/LaunchAgents/io.github.mschulkind-oss.vantage.plist` | [Daemon Mode](../guides/daemon-mode.md#running-as-a-launchd-agent-macos) |

Any other platform prints that it is unsupported and exits 0; run `vantage daemon` directly there.

---

## `vantage perf-report`

Collect and display performance diagnostics from a running Vantage instance. Connects to the Vantage server API and retrieves anonymized timing data — safe to share (no file names, project names, or content).

```bash
vantage perf-report [--url URL] [--json] [--shape] [--reset]
```

| Option    | Default                  | Description                                            |
| --------- | ------------------------ | ------------------------------------------------------ |
| `--url`   | `http://localhost:8000`  | Base URL of the running Vantage server                 |
| `--json`  |                          | Output raw JSON instead of a formatted report          |
| `--shape` |                          | Include repo shape stats (can be slow for large repos) |
| `--reset` |                          | Reset performance counters after collecting            |

### Examples

```bash
# Quick timing report from a local instance
vantage perf-report

# Include repo shape stats (file counts, depth)
vantage perf-report --shape

# Export JSON for sharing or analysis
vantage perf-report --json > perf.json

# Connect to a remote instance
vantage perf-report --url http://192.168.1.50:9000

# Collect and reset counters
vantage perf-report --json --reset > perf.json
```

---

## `vantage-check`

A separate, standalone binary for the agents writing your documents: it prints
Vantage's Markdown conventions and checks that a document really renders. It is
not part of the `vantage` server binary and needs nothing running.

```bash
vantage-check <path>...      # or: uvx vantage-check <path>...
vantage-check style-guide
```

See [vantage-check](../guides/vantage-check.md) for installation, rules, configuration and
exit codes.
