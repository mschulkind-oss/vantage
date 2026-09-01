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

You can also just run `vantage` with no arguments — it serves the current directory:

```bash
cd ~/projects/my-docs
vantage
```

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
