// Package server is the integrator: it assembles the resolved configuration,
// per-repository services, the shared singletons (review store, perf store, live
// Manager), and the api handlers into a single chi router and runs the
// background lifecycle (file watchers + the repo-activity refresh loop).
//
// # What the server owns that the api package cannot
//
// The api package is deliberately repo-agnostic and single-repo only: its
// /repos, /files/all, /recent/all, and /perf/diagnostics handlers cover the
// single-repo case and read one [api.RepoServices] from the request context. The
// server owns everything cross-repo:
//
//   - It builds one git+fs service pair per configured repository (single-repo:
//     one pair keyed by the empty name; daemon: one per [config.RepoConfig]).
//   - Its resolve middleware (resolve.go) injects the right RepoServices into the
//     request context for both the legacy "/api{Pattern}" and multi
//     "/api/r/{repo}{Pattern}" mountings of every [api.ScopeRepo] route. Legacy
//     repo routes 404 in daemon mode; an unknown "/r/{repo}" 404s.
//   - In daemon mode it replaces the api package's single-repo /repos,
//     /files/all, /recent/all, and /perf/diagnostics with fan-out handlers
//     (resolve.go) that aggregate across every repository.
//   - It keeps a repo-activity cache (last commit time per repo) warmed at
//     startup and refreshed on a loop, feeding RepoInfo.last_activity.
//
// # Routing families
//
// All API routes mount under /api with the perf middleware. [api.ScopeGlobal]
// routes mount once; [api.ScopeRepo] routes mount twice (legacy + /r/{repo}).
// The WebSocket lives at GET /api/ws. Everything else falls through to the SPA
// handler, which serves embedded static assets and otherwise returns index.html
// for client-side routing.
package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/sync/errgroup"

	"github.com/mschulkind-oss/vantage/internal/api"
	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/fs"
	"github.com/mschulkind-oss/vantage/internal/git"
	"github.com/mschulkind-oss/vantage/internal/live"
	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/perf"
	"github.com/mschulkind-oss/vantage/internal/review"
)

// activityRefreshInterval is how often the repo-activity cache is recomputed in
// daemon mode. It mirrors the historical 30s TTL: the cache always serves
// (possibly stale) values instantly and the loop keeps them fresh.
const activityRefreshInterval = 30 * time.Second

// repoServices is the server-side bundle for one repository: its name plus the
// git and fs services scoped to it. It is the value the resolve middleware
// converts into an [api.RepoServices] for the request context.
type repoServices struct {
	name string
	git  *git.GitService
	fs   *fs.FileSystemService
	// root is the absolute repository root, used to start a watcher.
	root string
}

// Server is the assembled application. Construct it with [NewServer]; expose its
// router with [Handler]; run its background lifecycle with [Run]; stop it with
// [Shutdown].
type Server struct {
	cfg    *config.Config
	logger *slog.Logger

	router  chi.Router
	manager *live.Manager
	reviews *review.Store
	perf    *perf.Store

	// repos holds the per-repository services. Single-repo mode has exactly one
	// entry keyed by the empty string (the sentinel); daemon mode has one entry
	// per configured repo keyed by name. order preserves configuration order for
	// stable fan-out output.
	repos map[string]*repoServices
	order []string

	// activity caches the last-activity RepoInfo per repo name (daemon mode). It
	// is read by the /repos override and written by warmActivity. The mutex
	// guards both the map contents and replacement.
	activityMu sync.RWMutex
	activity   map[string]model.RepoInfo

	// watchers are the live file watchers started by Run, retained so Shutdown
	// can close them.
	watchers []*live.Watcher
}

// NewServer assembles a Server from a resolved [config.Config]. It constructs
// the per-repository services, the shared review/perf stores and live Manager,
// the api handlers, and the chi router (perf middleware, resolve-wrapped route
// mountings, the /repos|/files/all|/recent/all|/perf/diagnostics daemon
// overrides, the /api/ws WebSocket, and SPA static serving). It does not start
// any background work — call [Server.Run] for that.
func NewServer(cfg *config.Config) (*Server, error) {
	if cfg == nil {
		return nil, fmt.Errorf("server: nil config")
	}
	logger := slog.Default()

	reviewDir, err := config.ReviewDir()
	if err != nil {
		return nil, fmt.Errorf("server: resolving review dir: %w", err)
	}

	s := &Server{
		cfg:      cfg,
		logger:   logger,
		manager:  live.NewManager(logger, cfg.AllowedOrigins),
		reviews:  review.NewStore(reviewDir),
		perf:     perf.Default,
		repos:    map[string]*repoServices{},
		activity: map[string]model.RepoInfo{},
	}

	if err := s.buildRepoServices(); err != nil {
		return nil, err
	}

	handlers := api.NewHandlers(api.Deps{
		Reviews:       s.reviews,
		Perf:          s.perf,
		Config:        cfg,
		ReviewChanged: s.broadcastReviewChanged,
	})

	s.router = s.buildRouter(handlers)
	return s, nil
}

// buildRepoServices populates s.repos and s.order. Single-repo mode builds one
// pair keyed by "" from cfg.TargetRepo; daemon mode builds one pair per
// cfg.Repos entry keyed by its name.
func (s *Server) buildRepoServices() error {
	if s.cfg.MultiRepo {
		for _, rc := range s.cfg.Repos {
			s.repos[rc.Name] = s.newRepoServices(rc.Name, rc.Path)
			s.order = append(s.order, rc.Name)
		}
		return nil
	}
	s.repos[""] = s.newRepoServices("", s.cfg.TargetRepo)
	s.order = append(s.order, "")
	return nil
}

// newRepoServices constructs the git and fs services for one repository root,
// applying the config's exclude/walk/ignore options to both.
func (s *Server) newRepoServices(name, root string) *repoServices {
	gitSvc := git.NewService(root, git.Options{
		ExcludeDirs:    s.cfg.ExcludeDirs,
		WalkTimeout:    s.cfg.WalkTimeout,
		WalkMaxDepth:   s.cfg.WalkMaxDepth,
		UseIgnoreFiles: s.cfg.UseIgnoreFiles,
	})
	fsSvc := fs.New(fs.Config{
		RootPath:       root,
		ExcludeDirs:    s.cfg.ExcludeDirs,
		UseIgnoreFiles: s.cfg.UseIgnoreFiles,
		WalkMaxDepth:   s.cfg.WalkMaxDepth,
	})
	return &repoServices{
		name: name,
		git:  gitSvc,
		fs:   fsSvc,
		root: fsSvc.RootPath(),
	}
}

// buildRouter wires the chi router: the perf middleware on /api, the WebSocket,
// every api route (resolve-wrapped, with daemon overrides), and the SPA handler.
func (s *Server) buildRouter(handlers *api.Handlers) chi.Router {
	r := chi.NewRouter()

	// Security headers on every response, mirroring the historical middleware.
	r.Use(securityHeaders)

	r.Route("/api", func(api chi.Router) {
		api.Use(perf.Middleware(s.perf))

		// WebSocket: mounted before the catch-all API routes. The live package
		// owns this endpoint; warm is our cache-warm closure.
		api.Get("/ws", s.manager.Handler(s.warmFunc()))

		s.mountAPIRoutes(api, handlers)
	})

	// Everything else is the SPA: static assets, else index.html.
	r.NotFound(s.spaHandler())
	r.MethodNotAllowed(s.spaHandler())

	return r
}

// mountAPIRoutes mounts every [api.Route] onto the /api subrouter. ScopeGlobal
// routes mount once; ScopeRepo routes mount both the legacy form and the
// /r/{repo} form, each wrapped by the resolve middleware. In daemon mode the
// four cross-repo globals are replaced by server fan-out handlers.
func (s *Server) mountAPIRoutes(r chi.Router, handlers *api.Handlers) {
	overrides := s.daemonOverrides()

	for _, rt := range handlers.Routes() {
		handler := rt.Handler
		if override, ok := overrides[rt.Pattern]; ok {
			handler = override
		}

		switch rt.Scope {
		case api.ScopeGlobal:
			// Global routes still pass through resolve so single-repo services
			// land in context for the api package's single-repo globals
			// (/files/all, /recent/all, /perf/diagnostics?include_shape).
			r.Method(rt.Method, rt.Pattern, s.resolveGlobal(handler))

		case api.ScopeRepo:
			// Legacy single-repo mounting: "/api{Pattern}". 404 in daemon mode.
			r.Method(rt.Method, rt.Pattern, s.resolveLegacy(handler))
			// Multi mounting: "/api/r/{repo}{Pattern}".
			r.Method(rt.Method, "/r/{repo}"+rt.Pattern, s.resolveRepo(handler))
		}
	}
}

// daemonOverrides returns the per-pattern handler replacements active only in
// daemon mode: the cross-repo /repos, /files/all, /recent/all, and
// /perf/diagnostics fan-out handlers. In single-repo mode it returns an empty
// map and the api package's own handlers are used.
func (s *Server) daemonOverrides() map[string]http.HandlerFunc {
	if !s.cfg.MultiRepo {
		return nil
	}
	return map[string]http.HandlerFunc{
		"/repos":            s.handleReposMulti,
		"/files/all":        s.handleFilesAllMulti,
		"/recent/all":       s.handleRecentAllMulti,
		"/perf/diagnostics": s.handlePerfDiagnosticsMulti,
	}
}

// reviewChangedMessage is the push sent when a review command or delivery
// mutates review state, mirroring the watcher's filesChangedMessage. Repo is
// intentionally not omitempty: the frontend matches it against its current
// repo, and the single-repo sentinel is the empty string, not an absent key.
type reviewChangedMessage struct {
	Type string `json:"type"`
	Repo string `json:"repo"`
	Path string `json:"path"`
}

// broadcastReviewChanged pushes a review_changed message through the live hub.
// It is the api package's Deps.ReviewChanged, invoked after every successful
// review command so open browsers reload the document's review state.
func (s *Server) broadcastReviewChanged(repo, path string) {
	s.manager.Broadcast(reviewChangedMessage{Type: "review_changed", Repo: repo, Path: path})
}

// warmFunc returns the cache-warm closure handed to the WebSocket Handler. On
// the 0->1 connection transition it refreshes the repo-activity cache (daemon
// mode) so the next /api/repos is instant, mirroring the historical warm.
func (s *Server) warmFunc() live.WarmFunc {
	return func(ctx context.Context) {
		if !s.cfg.MultiRepo {
			return
		}
		s.warmActivity(ctx)
	}
}

// Handler returns the assembled http.Handler. It is safe to serve concurrently
// and is the value cmd hands to its http.Server.
func (s *Server) Handler() http.Handler {
	return s.router
}

// Run starts the background lifecycle — one live.Watcher per repository plus the
// repo-activity refresh loop (daemon mode) — and blocks until ctx is cancelled.
// It returns ctx.Err() on cancellation. Watchers and the loop are torn down
// before Run returns. Serving HTTP is the caller's responsibility (cmd owns the
// http.Server); Run only drives the realtime/background machinery.
func (s *Server) Run(ctx context.Context) error {
	// Warm the activity cache before accepting the first /repos so it is instant.
	if s.cfg.MultiRepo {
		s.warmActivity(ctx)
	}

	g, gctx := errgroup.WithContext(ctx)

	for _, name := range s.order {
		rs := s.repos[name]
		w, err := live.NewWatcher(rs.root, rs.name, s.manager, s.reviews, s.cfg.UseIgnoreFiles, s.logger)
		if err != nil {
			s.logger.Warn("server: failed to start watcher", "repo", rs.name, "root", rs.root, "error", err)
			continue
		}
		s.watchers = append(s.watchers, w)
		g.Go(func() error {
			// Start blocks until gctx is cancelled; its ctx.Err() return is
			// expected on shutdown and must not poison the group.
			if err := w.Start(gctx); err != nil && err != gctx.Err() {
				s.logger.Warn("server: watcher stopped with error", "repo", rs.name, "error", err)
			}
			return nil
		})
	}

	if s.cfg.MultiRepo {
		g.Go(func() error {
			s.activityLoop(gctx)
			return nil
		})
	}

	<-ctx.Done()
	_ = g.Wait()
	return ctx.Err()
}

// Shutdown closes the live watchers. It is idempotent and safe to call after Run
// has returned. The HTTP server is owned and shut down by cmd; Shutdown only
// releases the realtime resources this package created.
func (s *Server) Shutdown(_ context.Context) error {
	for _, w := range s.watchers {
		_ = w.Close()
	}
	return nil
}

// activityLoop refreshes the repo-activity cache on a fixed interval until ctx
// is cancelled. Newly discovered source-dir repos are not hot-added here (the
// historical behavior restarted the watcher); that responsibility belongs to a
// future enhancement. Each pass recomputes last-activity for the known repos.
func (s *Server) activityLoop(ctx context.Context) {
	ticker := time.NewTicker(activityRefreshInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.warmActivity(ctx)
		}
	}
}

// warmActivity recomputes last-activity for every repository concurrently and
// swaps the cache atomically. A repo whose probe fails keeps a name-only
// RepoInfo (last_activity null). It is a no-op in single-repo mode.
func (s *Server) warmActivity(_ context.Context) {
	if !s.cfg.MultiRepo {
		return
	}
	t0 := time.Now()

	type result struct {
		name string
		info model.RepoInfo
	}
	results := make([]result, len(s.order))

	g := new(errgroup.Group)
	for i, name := range s.order {
		rs := s.repos[name]
		g.Go(func() error {
			recents := rs.git.Recents(1, nil, true, true)
			if len(recents) > 0 {
				t := recents[0].Date.UTC()
				results[i] = result{name: name, info: model.RepoInfo{Name: name, LastActivity: &t}}
			} else {
				results[i] = result{name: name, info: model.RepoInfo{Name: name}}
			}
			return nil
		})
	}
	_ = g.Wait()

	next := make(map[string]model.RepoInfo, len(results))
	for _, r := range results {
		next[r.name] = r.info
	}

	s.activityMu.Lock()
	s.activity = next
	s.activityMu.Unlock()

	s.logger.Info("server: repo activity cache warmed", "repos", len(next), "took", time.Since(t0))
}
