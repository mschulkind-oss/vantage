# Daemon Mode

Daemon mode lets you serve multiple directories from a single Vantage instance. Each directory appears as a separate entry in the sidebar.

## Setup

### 1. Create a config file

```bash
vantage init-config
```

This creates `~/.config/vantage/config.toml` with an example configuration.

### 2. Add your directories

```toml
# ~/.config/vantage/config.toml

host = "127.0.0.1"
port = 8000

[[repos]]
name = "notes"
path = "~/Documents/notes"

[[repos]]
name = "work"
path = "~/work/documentation"

[[repos]]
name = "projects"
path = "~/projects/docs"
```

The `name` is used in URLs — for example, `http://localhost:8000/notes/readme.md`.

### Alternative: Auto-Discover from Source Directories

Instead of listing every repo by hand, you can point Vantage at parent directories that contain git repos:

```toml
# ~/.config/vantage/config.toml

host = "127.0.0.1"
port = 8000

# Automatically discover all git repos under these directories
source_dirs = ["~/code", "~/projects"]

# You can still add specific repos alongside auto-discovery
[[repos]]
name = "notes"
path = "~/Documents/notes"
```

Any subdirectory of `source_dirs` that contains a `.git` folder is added automatically, using the directory name. Repos already listed in `[[repos]]` are not duplicated. See [Configuration](../reference/configuration.md#source-directory-auto-discovery) for details.

### 3. Start the daemon

```bash
vantage daemon
```

Or with a custom config file:

```bash
vantage daemon --config /path/to/config.toml
```

You can also override the host and port from the command line:

```bash
vantage daemon --host 0.0.0.0 --port 9000
```

## Running as a systemd Service

On Linux, Vantage can run as a systemd user service that starts automatically when you log in. On macOS the same command writes a launchd agent instead — see [Running as a launchd Agent](#running-as-a-launchd-agent-macos).

### Install the service

```bash
vantage install-service
```

This creates `~/.config/systemd/user/vantage.service`.

### Enable and start

```bash
# Reload systemd to pick up the new service
systemctl --user daemon-reload

# Enable auto-start on login
systemctl --user enable vantage

# Start the service now
systemctl --user start vantage
```

### Managing the service

```bash
# Check status
systemctl --user status vantage

# View logs (follow mode)
journalctl --user -u vantage -f

# Restart after changing the config
systemctl --user restart vantage

# Stop the service
systemctl --user stop vantage

# Disable auto-start
systemctl --user disable vantage
```

### Keep running after logout

By default, user services stop when you log out. To keep Vantage running in the background:

```bash
loginctl enable-linger $USER
```

## Running as a launchd Agent (macOS)

On macOS, `vantage install-service` writes a launchd agent:

```bash
vantage install-service
```

This creates `~/Library/LaunchAgents/io.github.mschulkind-oss.vantage.plist`.

### Load and start

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.github.mschulkind-oss.vantage.plist
```

The agent sets `RunAtLoad`, so bootstrapping starts the daemon immediately and again at every login. There is no separate enable step the way systemd has one.

### Managing the agent

```bash
# Check status
launchctl print gui/$(id -u)/io.github.mschulkind-oss.vantage

# View logs — launchd has no journal, so the agent writes to a file
tail -f ~/Library/Logs/vantage.log

# Restart after changing the config
launchctl kickstart -k gui/$(id -u)/io.github.mschulkind-oss.vantage

# Stop and unload
launchctl bootout gui/$(id -u)/io.github.mschulkind-oss.vantage
```

> [!IMPORTANT]
> `kickstart` restarts the job from the plist launchd loaded at bootstrap time, not from the file on disk. After re-running `install-service` — upgrading the binary, say — run `bootout` and then `bootstrap` again, or launchd keeps running the definition it already has.

### What the agent sets, and why

- **An explicit `PATH`.** launchd hands a job a minimal `PATH` that contains neither `/opt/homebrew/bin` nor `/usr/local/bin`, and Vantage shells out to the `git` CLI for everything it serves. The agent sets `PATH` with the Homebrew prefixes first, so a Homebrew `git` is found. Without it the daemon starts clean and then fails every request.
- **Restart on failure only.** `KeepAlive` is conditioned on `SuccessfulExit`, which matches the systemd unit's `Restart=on-failure`: a crash is restarted, a clean `launchctl bootout` stays stopped.
- **Your home directory as the working directory**, so relative `path` entries in the config resolve the way they do from a login shell.

There is no macOS equivalent of `loginctl enable-linger`. A `gui/` agent runs while you are logged in; running with nobody logged in means a `LaunchDaemon` under `/Library/LaunchDaemons`, which runs as root and is outside what `install-service` will write for you.

## Troubleshooting

### Service won't start

Check the logs — on Linux:

```bash
journalctl --user -u vantage --no-pager -n 50
```

On macOS, the agent's own log plus launchd's view of the job:

```bash
tail -n 50 ~/Library/Logs/vantage.log
launchctl print gui/$(id -u)/io.github.mschulkind-oss.vantage
```

`launchctl print` reports the last exit status. A job that never ran at all usually means a plist launchd could not parse or a `StandardOutPath` it could not open.

### Config file not found

Make sure the config exists at `~/.config/vantage/config.toml`, or specify a path explicitly:

```bash
vantage daemon --config /path/to/config.toml
```

### Port already in use

Change the port in your config file or override it on the command line:

```bash
vantage daemon --port 8001
```
