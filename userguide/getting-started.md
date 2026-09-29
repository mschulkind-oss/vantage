# Getting Started

Vantage is a local Markdown viewer that renders your files the way GitHub does — with live reload, Mermaid diagrams, and Git integration. Point it at a directory and start reading.

Vantage is a single self-contained Go binary with the React frontend embedded. There is nothing to install at runtime beyond the binary itself.

## Installation

### Go install

If you have a Go toolchain, install the latest release directly:

```bash
go install github.com/mschulkind-oss/vantage/cmd/vantage@latest
```

This places a `vantage` binary in your `GOBIN` (typically `~/go/bin` — make sure it's on your `PATH`).

### Homebrew

```bash
brew install mschulkind-oss/tap/vantage
```

### From source

Building from source uses [mise](https://mise.jdx.dev/) to pin the toolchain and [just](https://just.systems/) as the command runner:

```bash
git clone https://github.com/mschulkind-oss/vantage.git
cd vantage
mise install   # installs Go 1.26, Node.js 22, and just
just build     # builds the frontend and embeds it into ./vantage
```

The result is a `./vantage` binary in the repository root. Copy it onto your `PATH` or run it in place.

### Prerequisites

You only need these to build from source. The `go install` and Homebrew paths require none of them.

| Tool                               | Purpose                          | Install                                                       |
| ---------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| [Go 1.26+](https://go.dev/)        | Compiling the binary             | Managed by `mise`, or via your package manager                |
| [Node.js 22+](https://nodejs.org/) | Building the embedded frontend   | Managed by `mise`, or via [nvm](https://github.com/nvm-sh/nvm) |
| [just](https://just.systems/)      | Command runner                   | Managed by `mise`, or `brew install just`                     |

## Quick Start

### Serve a single directory

```bash
vantage serve ~/Documents/notes
```

Open **http://localhost:8000** in your browser. That's it.

If port 8000 is already taken — another Vantage, or anything else — Vantage
moves to the next free port above it (scanning up to 100 ports before giving
up) and prints the one it picked, so a second instance never fails to start.

That freedom belongs to the default alone: a port you set yourself —
`--port` on the command line, `PORT` in the environment, or `port` in the
config file — binds exactly or Vantage exits with an error. A systemd unit
or a script that names a port must never come up on a different one.

You can also just run `vantage` with no arguments — it serves the current directory:

```bash
cd ~/projects/my-docs
vantage
```

### Serve a directory of clones

Point Vantage at the directory that holds your git clones, and it serves each
clone as its own project rather than all of them as one:

```bash
vantage ~/code
```

```text
~/code holds 23 git repositories; serving each as its own project (plus "code" for the Markdown outside them). Use --one-project to serve it as a single project.
```

This happens when the directory is not itself inside a git repository and at
least one of its immediate children is one. It is exactly what the daemon does
with a [`source_dirs`](reference/configuration.md#source-directory-auto-discovery)
entry:

- Each project is named after its directory, with `-2` added when two would
  share a name.
- A clone made while Vantage runs appears in the project list within 30
  seconds, and a deleted one drops out.
- Markdown that sits in the directory but in none of the clones (a `notes.md`
  beside them, say) is served as one more project, named after the directory
  and listed first. It never shows the clones' files. With no such Markdown,
  there is no extra project.
- Linked worktrees are not served as projects, just as the daemon skips them.

To serve the whole directory as a single project, the way Vantage did before,
pass `--one-project`.

### A tip about running in the background

When `vantage` starts in a terminal, it prints one line about the background
service ([Daemon Mode](guides/daemon-mode.md)): how to install it, how to start
an installed one, or where your project is already open when one is running.
For a directory of clones, the line gives the one command that serves it in the
background from then on:

```text
To keep them all in the background at http://localhost:8000: vantage install-service --source-dir ~/code
```

Set `VANTAGE_NO_TIPS=1`, or `tips = false` in
[the config file](reference/configuration.md#reference), to turn it off. Nothing
is printed when the output is not a terminal.

### What you'll see

- A **file tree sidebar** on the left showing your Markdown files
- **GitHub-style rendering** of the selected file
- **Live reload** — edit a file in your editor and the browser updates instantly
- **Git integration** — if the directory is a Git repo, you'll see commit info and can view diffs

## Next Steps

- [Configuration](reference/configuration.md) — Customize the server settings and excluded directories
- [Daemon Mode](guides/daemon-mode.md) — Serve multiple directories at once
- [Features](features.md) — Everything Vantage can render and do
- [Keyboard Shortcuts](reference/keyboard-shortcuts.md) — Navigate quickly
