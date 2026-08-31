# CLI Reference

All available `vantage` commands and their options.

## `vantage` / `vantage serve`

Start the Vantage server for a single directory.

```bash
vantage [PATH]
vantage serve [PATH] [--host HOST] [--port PORT] [--no-open] [--show-hidden]
              [--exclude-dirs DIR,...] [--use-ignore-files] [--walk-max-depth N]
              [--walk-timeout SECONDS]
```

`PATH` may be a directory (served as the repo root) or a single Markdown file (its parent becomes the repo root). When omitted, the current directory is served. Vantage opens your default browser automatically on startup.

| Argument/Option       | Default                 | Description                                            |
| --------------------- | ----------------------- | ------------------------------------------------------ |
| `PATH`                | `.` (current directory) | Directory or Markdown file to serve                    |
| `--host`              | `127.0.0.1`             | Server bind address                                    |
| `--port`              | `8000`                  | Server port                                            |
| `--no-open`           |                         | Do not open the browser on startup                     |
| `--show-hidden`       | `true`                  | Show hidden files/directories (dotfiles) in the sidebar |
| `--exclude-dirs`      | _(see Configuration)_   | Directory names to exclude from listings (replaces defaults) |
| `--use-ignore-files`  | `true`                  | Honor `~/.config/vantage/ignore` and `.vantageignore` |
| `--walk-max-depth`    | `0` (unlimited)         | Maximum depth for untracked-file discovery             |
| `--walk-timeout`      | `30`                    | Timeout in seconds for untracked-file discovery        |

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
| `--port`         | From config                     | Override the port from the config |

See [Daemon Mode](daemon-mode.md) for details on the config file format.

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
| `--frontend-dist` | _(embedded)_       | Override the embedded frontend bundle (currently ignored) |

See [Static Sites](static-sites.md) for a full guide on this workflow.

---

## `vantage install-service`

Install Vantage as a systemd user service that starts on login.

```bash
vantage install-service
```

This creates `~/.config/systemd/user/vantage.service`. See [Daemon Mode](daemon-mode.md#running-as-a-systemd-service) for the full setup steps.

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

See [vantage-check](vantage-check.md) for installation, rules, configuration and
exit codes.
