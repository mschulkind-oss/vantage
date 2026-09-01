// Package static builds a self-contained static site from a Markdown
// repository. Every API endpoint the frontend calls is pre-rendered to a JSON
// file under api/, the embedded single-page app is copied alongside it, and
// index.html is patched into static mode (window.__VANTAGE_STATIC__ = true)
// with its assets rewritten to relative paths. The result loads offline from
// any static host (Cloudflare Pages, GitHub Pages, S3) with no backend.
//
// # The R2 contract
//
// The output file-path scheme (scheme.go) is the producer side of a contract
// with the frontend's static-mode axios interceptor
// (frontend/src/lib/staticMode.ts), which rewrites live "/api/…" URLs to these
// JSON paths. The two must agree exactly or the no-backend site 404s silently,
// so scheme_test.go mirrors staticMode.test.ts. The per-file JSON is produced
// by the SAME api.Build* response builders the live server uses, so the live
// and static payloads cannot drift in shape either.
//
// # Top-level null
//
// A file's git status and per-commit diff serialize as literal JSON null when
// empty (json.Marshal(nil)), so the frontend receives a 200 with a null body
// instead of a 404 — matching how the live endpoints behave for a clean file.
package static

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"golang.org/x/sync/errgroup"

	"github.com/mschulkind-oss/vantage/internal/api"
	fsservice "github.com/mschulkind-oss/vantage/internal/fs"
	"github.com/mschulkind-oss/vantage/internal/git"
	"github.com/mschulkind-oss/vantage/web"
)

// recentLimit is the number of recently changed files baked into
// api/git/recent.json. It matches the reference builder.
const recentLimit = 30

// Config controls a single Build. Source and Output are required.
type Config struct {
	// Source is the repository root to render. It is read but never modified.
	Source string
	// Output is the directory the static site is written to. It is created if
	// absent; existing files may be overwritten.
	Output string
	// RepoName is the repository display name baked into api/info.json and
	// api/static.json. Empty defaults to the base name of Source.
	RepoName string
	// ExcludeDirs names directories pruned from listings and discovery (mirrors
	// config.ExcludeDirs). Nil applies no name-based exclusions.
	ExcludeDirs []string
	// UseIgnoreFiles layers the .vantageignore matcher into listings/discovery.
	UseIgnoreFiles bool
	// WalkMaxDepth caps markdown-discovery recursion depth; nil means unlimited.
	WalkMaxDepth *int
	// Concurrency bounds the per-file generation errgroup. Zero or negative
	// defaults to GOMAXPROCS.
	Concurrency int
	// Logger receives progress and per-file warnings. Nil uses slog.Default().
	Logger *slog.Logger
}

// Build generates the static site described by cfg. It copies the embedded
// frontend, pre-renders every API JSON file via the shared api.Build* builders,
// patches index.html into static mode, and writes the SPA host config
// (_headers, 404.html). Per-file git/content failures are logged
// and skipped rather than aborting the build; a failure to copy the frontend or
// write a top-level file is returned.
func Build(cfg Config) error {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	if cfg.Source == "" {
		return fmt.Errorf("static: Source is required")
	}
	if cfg.Output == "" {
		return fmt.Errorf("static: Output is required")
	}

	src, err := filepath.Abs(cfg.Source)
	if err != nil {
		return fmt.Errorf("static: resolve source: %w", err)
	}
	out, err := filepath.Abs(cfg.Output)
	if err != nil {
		return fmt.Errorf("static: resolve output: %w", err)
	}
	repoName := cfg.RepoName
	if repoName == "" {
		repoName = filepath.Base(src)
	}

	logger.Info("static: building site", "source", src, "output", out)

	if err := os.MkdirAll(out, 0o755); err != nil {
		return fmt.Errorf("static: create output dir: %w", err)
	}

	// 1. Copy the embedded frontend bundle.
	if err := copyFrontend(out); err != nil {
		return fmt.Errorf("static: copy frontend: %w", err)
	}

	// 2. Pre-render every API JSON file.
	fsSvc := fsservice.New(fsservice.Config{
		RootPath:       src,
		ExcludeDirs:    cfg.ExcludeDirs,
		UseIgnoreFiles: cfg.UseIgnoreFiles,
		WalkMaxDepth:   cfg.WalkMaxDepth,
	})
	gitSvc := git.NewService(src, git.Options{
		ExcludeDirs:    cfg.ExcludeDirs,
		WalkMaxDepth:   cfg.WalkMaxDepth,
		UseIgnoreFiles: cfg.UseIgnoreFiles,
	})
	if err := generateAPIData(out, repoName, fsSvc, gitSvc, cfg.Concurrency, logger); err != nil {
		return fmt.Errorf("static: generate api data: %w", err)
	}

	// 3. Patch index.html into static mode (sentinel + relative assets + base
	//    strip) and copy it to 404.html.
	if err := injectStaticMode(out, logger); err != nil {
		return fmt.Errorf("static: inject static mode: %w", err)
	}

	// 4. Write SPA host config.
	if err := writeSPAConfig(out); err != nil {
		return fmt.Errorf("static: write spa config: %w", err)
	}

	logger.Info("static: build complete", "output", out)
	return nil
}

// copyFrontend writes every file in the embedded web.Dist() bundle into out,
// preserving the directory layout.
func copyFrontend(out string) error {
	dist := web.Dist()
	return fs.WalkDir(dist, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		dest := filepath.Join(out, filepath.FromSlash(p))
		if d.IsDir() {
			return os.MkdirAll(dest, 0o755)
		}
		data, err := fs.ReadFile(dist, p)
		if err != nil {
			return fmt.Errorf("read embedded %s: %w", p, err)
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		return os.WriteFile(dest, data, 0o644)
	})
}

// generateAPIData pre-renders every static API JSON file under out/api. The
// query-less endpoints (static, repos, info, files) and the recent-files list
// are written once; tree files are emitted per directory; content and git
// (history, status, per-commit diffs) are emitted per Markdown file in a
// bounded errgroup. Per-file failures are logged and skipped.
func generateAPIData(
	out, repoName string,
	fsSvc *fsservice.FileSystemService,
	gitSvc *git.GitService,
	concurrency int,
	logger *slog.Logger,
) error {
	logger.Info("static: generating api data")

	// 1. Static-mode sentinel (parity with reference; not fetched by frontend).
	sentinel := map[string]any{
		"static":       true,
		"repo_name":    repoName,
		"generated_by": "vantage-static-builder",
	}
	if err := writeJSON(out, StaticSentinelPath(), sentinel); err != nil {
		return err
	}

	// 2. Repos list (single-repo sentinel) — shared live builder.
	if err := writeJSON(out, SimpleEndpointPath("repos"), api.BuildReposList()); err != nil {
		return err
	}

	// 3. Repo info — shared live builder.
	if err := writeJSON(out, SimpleEndpointPath("info"), api.BuildInfo(gitSvc, fsSvc)); err != nil {
		return err
	}

	// 4. Health probe (no builder; mirrors the live handler's body).
	if err := writeJSON(out, SimpleEndpointPath("health"), map[string]string{"status": "ok"}); err != nil {
		return err
	}

	// 5. All Markdown files (single-repo: bare paths, not the scoped shape, to
	//    match the live GET /files response the frontend consumes here).
	allFiles := api.BuildFilesAll(fsSvc)
	if err := writeJSON(out, SimpleEndpointPath("files"), allFiles); err != nil {
		return err
	}

	// 6. Recent files — shared live builder.
	recents := api.BuildRecent(gitSvc, recentLimit, true, true)
	if err := writeJSON(out, RecentPath(), recents); err != nil {
		return err
	}

	// 7. Tree data for the root and every subdirectory.
	if err := generateTreeData(out, fsSvc, logger); err != nil {
		return err
	}

	// 8. Content + git data for every Markdown file, concurrently.
	if concurrency <= 0 {
		concurrency = runtime.GOMAXPROCS(0)
	}
	g, _ := errgroup.WithContext(context.Background())
	g.SetLimit(concurrency)
	for _, file := range allFiles {
		file := file
		g.Go(func() error {
			generateFileData(out, file, fsSvc, gitSvc, logger)
			return nil
		})
	}
	// Per-file work never returns an error (failures are logged and skipped),
	// so Wait reports only an unexpected panic-free nil.
	return g.Wait()
}

// generateTreeData walks the repository directory tree breadth-first via the
// shared BuildTree builder, writing api/tree/<dir>.json for the root (as _) and
// every subdirectory. A directory that fails to list is logged and skipped
// (its subtree is not recursed).
func generateTreeData(out string, fsSvc *fsservice.FileSystemService, logger *slog.Logger) error {
	treeOpts := fsservice.Options{IncludeGit: true, ShowHidden: true, ShowGitignored: true}
	queue := []string{"."}
	for len(queue) > 0 {
		dir := queue[0]
		queue = queue[1:]

		nodes, err := api.BuildTree(fsSvc, dir, treeOpts)
		if err != nil {
			logger.Warn("static: could not list directory", "dir", dir, "err", err)
			continue
		}
		if err := writeJSON(out, TreePath(dir), nodes); err != nil {
			return err
		}
		for _, n := range nodes {
			if n.IsDir {
				queue = append(queue, n.Path)
			}
		}
	}
	return nil
}

// generateFileData writes the content, history, status, and per-commit diff
// files for one Markdown file. Empty status and diffs serialize as literal
// null. All failures are logged and skipped so one bad file never aborts the
// build; a write error is logged rather than propagated to keep the bounded
// errgroup from cancelling its siblings.
func generateFileData(
	out, file string,
	fsSvc *fsservice.FileSystemService,
	gitSvc *git.GitService,
	logger *slog.Logger,
) {
	// Content.
	content, err := api.BuildContent(fsSvc, file)
	if err != nil {
		logger.Warn("static: could not read content", "file", file, "err", err)
		return
	}
	if err := writeJSON(out, ContentPath(file), content); err != nil {
		logger.Warn("static: write content", "file", file, "err", err)
	}

	// Git history.
	history := api.BuildHistory(gitSvc, file)
	if err := writeJSON(out, HistoryPath(file), history); err != nil {
		logger.Warn("static: write history", "file", file, "err", err)
	}

	// Git status: BuildStatus returns a FileStatus whose fields are nil when the
	// file is clean/untracked. The reference writes literal null in that case,
	// so collapse a fully empty status to JSON null.
	status := api.BuildStatus(gitSvc, file)
	if status.LastCommit == nil && status.GitStatus == nil {
		if err := writeJSON(out, StatusPath(file), nil); err != nil {
			logger.Warn("static: write status", "file", file, "err", err)
		}
	} else {
		if err := writeJSON(out, StatusPath(file), status); err != nil {
			logger.Warn("static: write status", "file", file, "err", err)
		}
	}

	// Per-commit diffs. A commit that does not touch the file yields a nil diff,
	// written as literal null so static mode gets a 200 instead of a 404.
	for _, commit := range history {
		diff, derr := api.BuildDiff(gitSvc, file, commit.Hexsha)
		if derr != nil {
			logger.Warn("static: could not diff", "file", file, "commit", commit.Hexsha, "err", derr)
			continue
		}
		path := DiffPath(file, commit.Hexsha)
		if diff == nil {
			if err := writeJSON(out, path, nil); err != nil {
				logger.Warn("static: write diff", "file", file, "commit", commit.Hexsha, "err", err)
			}
			continue
		}
		if err := writeJSON(out, path, diff); err != nil {
			logger.Warn("static: write diff", "file", file, "commit", commit.Hexsha, "err", err)
		}
	}
}

// assetRefRe matches root-relative href/src attribute values produced by a
// Vite build with base "/" (e.g. href="/assets/index-abc.css"). Capture group 1
// is the attribute name, group 2 the path below the leading slash.
var assetRefRe = regexp.MustCompile(`(href|src)="/([^"]*)"`)

// baseTagRe matches a <base href="…"> tag (with optional surrounding
// whitespace) so it can be stripped: relative assets must resolve against the
// document directory, not a fixed base.
var baseTagRe = regexp.MustCompile(`\s*<base href="[^"]*"\s*/?>`)

// sentinelScript is the inline script the frontend's isStaticMode() reads to
// switch into no-backend mode.
const sentinelScript = `<script>window.__VANTAGE_STATIC__=true;</script>`

// injectStaticMode patches out/index.html: it injects the static-mode sentinel
// script into <head>, rewrites root-relative asset references to document-
// relative ones (./…) so the site loads from any subdirectory, strips any
// <base> tag, and copies the result to 404.html as the host error page. A
// missing index.html is logged and skipped (the embedded bundle should always
// provide one).
func injectStaticMode(out string, logger *slog.Logger) error {
	indexPath := filepath.Join(out, "index.html")
	raw, err := os.ReadFile(indexPath)
	if err != nil {
		if os.IsNotExist(err) {
			logger.Warn("static: index.html absent; skipping static-mode injection")
			return nil
		}
		return err
	}
	html := string(raw)

	// Inject the sentinel once, right after <head>.
	if !strings.Contains(html, "window.__VANTAGE_STATIC__") {
		html = strings.Replace(html, "<head>", "<head>\n    "+sentinelScript, 1)
	}

	// Rewrite root-relative assets to relative; strip any <base> tag.
	html = assetRefRe.ReplaceAllString(html, `$1="./$2"`)
	html = baseTagRe.ReplaceAllString(html, "")

	if err := os.WriteFile(indexPath, []byte(html), 0o644); err != nil {
		return err
	}
	// 404.html mirrors index.html so SPA routes resolve on hosts that serve a
	// 404 page for unknown paths (GitHub Pages, S3).
	return os.WriteFile(filepath.Join(out, "404.html"), []byte(html), 0o644)
}

// headersBody sets security headers site-wide and cache policy for api/ and
// assets/, matching the reference builder.
const headersBody = `/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/api/*
  Cache-Control: public, max-age=3600

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`

// writeSPAConfig writes the _headers file that sets caching and security
// headers on Cloudflare (and is inert elsewhere).
//
// It used to write a `_redirects` holding the Pages-era SPA catch-all,
// `/*  /index.html  200`. Workers rejects that rule outright — its asset
// server strips `.html` and `/index` before matching, so the rewrite target
// re-enters the same rule and the API refuses the upload:
//
//	Invalid _redirects configuration:
//	Line 1: Infinite loop detected in this rule. [code: 100324]
//
// There is no non-looping way to write a catch-all there, because Workers
// expects SPA routing to come from `not_found_handling` in the Wrangler
// config, not from a redirect. Hosts that have no such setting are served by
// the 404.html that mirrors index.html, which is why that file exists.
func writeSPAConfig(out string) error {
	return os.WriteFile(filepath.Join(out, "_headers"), []byte(headersBody), 0o644)
}

// writeJSON marshals data and writes it to relPath (an output-relative,
// slash-separated scheme path) under out, creating parent directories. A nil
// data marshals to the literal JSON null the contract requires for empty
// status/diff files. Output is indented for human inspection, matching the
// reference builder.
func writeJSON(out, relPath string, data any) error {
	dest := filepath.Join(out, filepath.FromSlash(relPath))
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	buf, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal %s: %w", relPath, err)
	}
	return os.WriteFile(dest, buf, 0o644)
}
