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

Vantage can run as a systemd user service that starts automatically when you log in.

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

## Troubleshooting

### Service won't start

Check the logs:

```bash
journalctl --user -u vantage --no-pager -n 50
```

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
