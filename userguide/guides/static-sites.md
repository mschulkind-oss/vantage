# Static Sites

Vantage can generate a fully self-contained static site from any directory of Markdown files. The output is a folder of HTML, CSS, JS, and pre-rendered JSON that works without a backend — deploy it anywhere.

This is ideal for:

- **Publishing documentation** to Cloudflare Workers, GitHub Pages, Netlify, or Vercel
- **Sharing rendered Markdown** without requiring readers to install anything
- **Archiving** a snapshot of your docs with full Git history and diffs

## Quick Start

```bash
# Build a static site from your docs directory
vantage build ~/projects/my-docs -o ./output -n "My Docs"

# Preview it locally with any static file server, e.g.
npx serve ./output
```

Open the URL your static server prints — you'll see the full Vantage UI with file tree, Markdown rendering, Mermaid diagrams, Git history, and diffs, all running entirely from static files.

## How It Works

The `vantage build` command:

1. **Copies the frontend** — the same React UI used by the live server
2. **Pre-renders all API data** — every file, directory listing, Git commit, and diff is saved as a JSON file
3. **Injects static mode** — the frontend detects it's running without a backend and reads from the JSON files instead of making API calls

The result is a completely static site. No backend, no server process, no WebSocket — just files.

## Deployment Examples

### Cloudflare Workers

Workers with static assets, which replaced Workers Sites. `wrangler pages deploy` still works if you already have a Pages project, but Workers is the current path for a new one.

```bash
# Build
vantage build ./docs -o ./site -n "My Project Docs"

# Deploy
npx wrangler deploy --assets ./site
```

Or configure automatic deployments by pointing your Worker's build command at Vantage:

```bash
# In your build command:
go install github.com/mschulkind-oss/vantage/cmd/vantage@latest
vantage build docs/ -o site/docs -n "My Docs"
```

Note that the build and deploy commands live in the Cloudflare dashboard rather than in your repository, so renaming a build script is invisible to CI and breaks the deploy silently.

### GitHub Pages

```bash
# Build to the docs/ directory (GitHub Pages default)
vantage build ./content -o ./docs -n "My Docs"

# Commit and push
git add docs/
git commit -m "Update static docs"
git push
```

Then enable GitHub Pages in your repository settings, pointing to the `/docs` folder.

### Nginx / Any Static Server

```bash
vantage build ./content -o /var/www/docs -n "Documentation"
```

The output directory can be served by any HTTP server. No special configuration needed — just serve the files.

### As Part of a Build Pipeline

Add `vantage build` to your CI/CD pipeline or site generation workflow:

```yaml
# Example GitHub Actions step
- name: Build documentation
  run: |
    go install github.com/mschulkind-oss/vantage/cmd/vantage@latest
    vantage build docs/ -o site/ -n "Project Docs"

- name: Deploy to Pages
  uses: actions/deploy-pages@v4
  with:
    path: site/
```

## What Gets Generated

The output directory contains:

```
output/
  index.html              # Main app entry point
  assets/                 # Frontend CSS, JS, fonts
  api/
    static.json           # Static mode marker
    repos.json            # Repository list
    info.json             # Repository metadata
    files.json            # List of all files
    health.json           # Health check
    tree/
      _.json              # Root directory listing
      subdir.json         # Subdirectory listings
    content/
      file.md.json        # Content for each file
    git/
      recent.json         # Recently changed files
      history/
        file.md.json      # Commit history per file
      status/
        file.md.json      # Latest commit per file
      diff/
        file.md/
          abc123.json     # Diff for each commit
  _headers                # Cache and security headers
```

SPA fallback comes from `404.html`, which mirrors `index.html`. On Cloudflare Workers, set `not_found_handling = "single-page-application"` in your Wrangler config to serve unmatched routes as the app with a 200 instead. No `_redirects` file is emitted: the catch-all rule it would hold is a Pages idiom, and Workers rejects it as an infinite loop because its asset server strips `.html` and `/index` before matching, so the rewrite target re-enters the same rule.

## Options Reference

| Option            | Default            | Description                                |
| ----------------- | ------------------ | ------------------------------------------ |
| `PATH`            | `.` (current dir)  | Source directory with Markdown files       |
| `--output`, `-o`  | _required_         | Where to write the static site             |
| `--name`, `-n`    | Directory name     | Display name shown in the UI header        |
| `--frontend-dist` | _(embedded)_       | Override the embedded frontend bundle (ignored) |

## Limitations

Static sites are a snapshot — they don't include:

- **Live reload** — no WebSocket connection, so file changes aren't reflected
- **Search** — the file picker still works (all filenames are included), but there's no full-text search
- **Review mode** — a comment has to be written back to the repository, and there's nothing to write to, so the **Review** button isn't offered on an exported site
- **Updates** — rebuild and redeploy to pick up new content

For a live, updating experience, use `vantage serve` or `vantage daemon` instead.
