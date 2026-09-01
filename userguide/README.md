# Vantage User Guide

**A beautiful local Markdown viewer with live reload and Git awareness.**

You're looking at a live instance of Vantage, serving its own documentation. Everything you see here — the file tree, Markdown rendering, syntax highlighting, and navigation — is exactly what you get when you run Vantage locally.

---

## Quick Start

```bash
go install github.com/mschulkind-oss/vantage/cmd/vantage@latest
vantage ~/my-docs
```

Then open [http://localhost:8000](http://localhost:8000) in your browser.

See [Getting Started](getting-started.md) for full installation instructions.

---

## What's in This Guide

Start here:

| Page | Description |
|------|-------------|
| [Getting Started](getting-started.md) | Installation, prerequisites, and first run |
| [Features](features.md) | GitHub Flavored Markdown, Mermaid diagrams, live reload, Git integration |

### Guides

Task-shaped: pick the one matching what you are trying to do.

| Page | Description |
|------|-------------|
| [Daemon Mode](guides/daemon-mode.md) | Running Vantage as a background service with multi-repo support |
| [Review Inbox](guides/review-inbox.md) | The `.vantage/` directory: how agent responses are delivered, and gitignoring it |
| [Static Sites](guides/static-sites.md) | Building static exports for deployment |
| [vantage-check](guides/vantage-check.md) | The agent CLI: the Markdown style guide, and a check that a document really renders |

### Reference

Look-it-up material: complete lists rather than walkthroughs.

| Page | Description |
|------|-------------|
| [CLI Reference](reference/cli-reference.md) | Complete command-line interface documentation |
| [Configuration](reference/configuration.md) | Config file, environment variables, and CLI options |
| [Keyboard Shortcuts](reference/keyboard-shortcuts.md) | Navigation and UI shortcuts |
| [Style Guide for Agents](reference/style-guide.md) | The canonical Markdown conventions, and how to get them |

---

## Links

- [GitHub](https://github.com/mschulkind-oss/vantage)
- [Issues](https://github.com/mschulkind-oss/vantage/issues)
