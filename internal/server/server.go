// Package server is the integrator: it assembles the resolved configuration,
// per-repository services, the shared singletons (review store, bookmark store,
// perf store, live Manager), and the api handlers into a single chi router and runs the
// background lifecycle (file watchers + the refresh loop that discovers new
// repositories and re-warms repo activity).
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
//   - It owns the bookmark store, which is keyed by the vantage invocation
//     rather than by repository, so in daemon mode one list spans every served
//     repo (see [starred.RootKey]). That is why the /starred routes are
//     [api.ScopeGlobal] and have no "/r/{repo}" mounting.
//   - It keeps a repo-activity cache (last commit time per repo) warmed at
//     startup and refreshed on a loop, feeding RepoInfo.last_activity.
//   - The same loop reconciles the served set with the configured source_dirs,
//     so a repository that appears under one after startup is registered,
//     watched and broadcast without a daemon restart — and one whose directory
//     goes away is retired, its watcher closed, its routes 404 until it returns.
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
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"slices"
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
	"github.com/mschulkind-oss/vantage/internal/repoconfig"
	"github.com/mschulkind-oss/vantage/internal/review"
	"github.com/mschulkind-oss/vantage/internal/starred"
)

// defaultRefreshInterval is how often the daemon refresh loop runs: it
// reconciles the served repositories with what source_dirs now hold and
// recomputes the repo-activity cache. It mirrors the historical 30s activity
// TTL — the cache always serves (possibly stale) values instantly and the loop
// keeps them fresh — and it bounds how long a repository takes to start or stop
// being served after it appears or disappears.
const defaultRefreshInterval = 30 * time.Second

// repoServices is the server-side bundle for one repository: its name plus the
// git and fs services scoped to it. It is the value the resolve middleware
// converts into an [api.RepoServices] for the request context.
type repoServices struct {
	name string
	git  *git.GitService
	fs   *fs.FileSystemService
	// root is the absolute repository root, used to start a watcher.
	root string
	// cfg reads this repository's own .vantage.toml — the file vantage-check
	// also reads. Attached here rather than in NewServer because
	// newRepoServices is the only path a repository takes into s.repos, whether
	// configured at construction or discovered by the source-dir loop later;
	// wiring it anywhere else is correct at startup and silently leaves every
	// discovered repository without a config.
	cfg *repoconfig.Config
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
	// starred is the bookmark store for this invocation, or nil when the user
	// config dir could not be resolved — bookmarks then answer 503 and
	// everything else keeps working.
	starred *starred.Store

	// refreshInterval is the daemon refresh loop's period. It is
	// [defaultRefreshInterval] in production; tests shorten it to observe a
	// source-dir discovery without waiting out the real one.
	refreshInterval time.Duration

	// reposMu guards repos and order. Both were immutable after construction
	// until source-dir discovery began registering repositories at runtime, so
	// every read goes through repoByName/repoList rather than the maps directly.
	reposMu sync.RWMutex
	// repos holds the per-repository services. Single-repo mode has exactly one
	// entry keyed by the empty string (the sentinel); daemon mode has one entry
	// per configured repo keyed by name. order preserves registration order —
	// configuration order, then discovery order — for stable fan-out output.
	repos map[string]*repoServices
	order []string

	// activity caches the last-activity RepoInfo per repo name (daemon mode). It
	// is read by the /repos override and written by warmActivity.
	//
	// The map is copy-on-write: a reader takes the reference under the lock and
	// then reads the map outside it, so a writer must swap in a new map and
	// never mutate the live one.
	activityMu sync.RWMutex
	activity   map[string]model.RepoInfo

	// watchersMu guards watchers, which Run fills at startup and the refresh
	// loop adds to and deletes from as repositories come and go.
	watchersMu sync.Mutex
	// watchers are the live file watchers, keyed by repository name, retained so
	// Shutdown can close them all and retireRepos can close exactly one.
	watchers map[string]*live.Watcher

	// wg tracks the goroutines Run starts — one per watcher plus the refresh
	// loop — so Run does not return before they have stopped.
	wg sync.WaitGroup
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
		cfg:             cfg,
		logger:          logger,
		refreshInterval: defaultRefreshInterval,
		manager:         live.NewManager(logger, cfg.AllowedOrigins),
		reviews:         review.NewStore(reviewDir),
		perf:            perf.Default,
		repos:           map[string]*repoServices{},
		watchers:        map[string]*live.Watcher{},
		activity:        map[string]model.RepoInfo{},
	}

	if err := s.buildRepoServices(); err != nil {
		return nil, err
	}

	// Bookmarks are a convenience, not a precondition for serving documents, so
	// a store that cannot be built leaves the routes answering 503 rather than
	// failing startup. Note this cannot rescue an unresolvable home directory:
	// config.ReviewDir above needs one too and has already returned by then.
	// What it does cover is a Config with no root to key on — one assembled in
	// process rather than by the serve/daemon commands.
	if root, err := starred.RootKey(cfg); err != nil {
		logger.Warn("server: bookmarks unavailable", "error", err)
	} else if store, err := starred.DefaultStore(root); err != nil {
		logger.Warn("server: bookmarks unavailable", "error", err)
	} else {
		s.starred = store
	}

	handlers := api.NewHandlers(api.Deps{
		Reviews:        s.reviews,
		Perf:           s.perf,
		Config:         cfg,
		ReviewChanged:  s.broadcastReviewChanged,
		Starred:        s.starred,
		StarredChanged: s.broadcastStarredChanged,
		Promoted:       s.promoted,
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
			s.register(rc.Name, rc.Path)
		}
		return nil
	}
	s.register("", s.cfg.TargetRepo)
	return nil
}

// register builds and records the services for one repository, returning them.
// It is how every repository enters s.repos — the configured ones at
// construction, the discovered ones from the refresh loop.
func (s *Server) register(name, root string) *repoServices {
	rs := s.newRepoServices(name, root)
	s.reposMu.Lock()
	defer s.reposMu.Unlock()
	s.repos[name] = rs
	s.order = append(s.order, name)
	return rs
}

// repoByName returns the services for a repository name, or nil when none is
// registered under it.
func (s *Server) repoByName(name string) *repoServices {
	s.reposMu.RLock()
	defer s.reposMu.RUnlock()
	return s.repos[name]
}

// repoList returns the registered repositories in registration order:
// configuration order first, then whatever source-dir discovery has added
// since. The slice is a snapshot, so a fan-out handler iterating it is
// unaffected by a repository registered while the request is in flight.
func (s *Server) repoList() []*repoServices {
	s.reposMu.RLock()
	defer s.reposMu.RUnlock()
	out := make([]*repoServices, 0, len(s.order))
	for _, name := range s.order {
		out = append(out, s.repos[name])
	}
	return out
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
		cfg:  repoconfig.New(fsSvc.RootPath()),
	}
}

// promoted collects the bookmark rows config promotes, across every repository
// this server serves plus the reader's own user-level list.
//
// Wired to api.Deps.Promoted. It runs on every GET /starred, which the viewer
// issues on mount, on reconnect and after every change push — so the cheap path
// has to stay cheap: a literal promote line never touches the filesystem, and
// ListAllFiles is passed as a closure that only a pattern calls.
func (s *Server) promoted() []starred.Listed {
	var repoRows []starred.Listed
	for _, rs := range s.repoList() {
		settings, err := rs.cfg.Settings()
		if err != nil {
			// Warned, not fatal, and the repository is served as if it had no
			// config: in daemon mode, failing on this would let one
			// contributor's typo take out every other repository here.
			s.logger.Warn("server: ignoring repository config",
				"repo", rs.name, "path", rs.cfg.Path(), "error", err)
			continue
		}
		if settings.IsZero() {
			continue
		}

		// "" is the repo key in single-repo mode — the sentinel Entry uses — and
		// the {repo} segment in daemon mode.
		repoKey := ""
		if s.cfg.MultiRepo {
			repoKey = rs.name
		}
		rows, rejected := starred.Promote(starred.PromoteRequest{
			Repo:       repoKey,
			Root:       rs.root,
			Lines:      settings.Starred.Promote,
			Source:     starred.SourceRepo,
			Candidates: rs.fs.ListAllFiles,
		})
		for _, r := range rejected {
			s.logger.Warn("server: ignoring promoted document",
				"repo", rs.name, "reason", r)
		}
		repoRows = append(repoRows, rows...)
	}

	// The reader's own config beats the repository's on a collision, so it goes
	// first. Their stored bookmarks beat both, and the handler puts those ahead of
	// whatever this returns.
	return starred.MergeListed(s.userPromoted(), repoRows)
}

// userPromoted resolves the reader's own `[starred] promote` list against every
// repository this server serves.
//
// Their list travels with them rather than with a project, so it is applied per
// repository — which is also why its literals are existence-filtered. "Always
// star my roadmap" means "if there is one"; without the filter a single line
// would carry a phantom row into every project that has no roadmap.
//
// Read in both modes on purpose. Serve mode has never opened a config file —
// cmd/vantage/serve.go is Defaults, ApplyEnv, flags — so reading it only in
// daemon mode would leave the motivating use case dead in the mode most people
// use.
func (s *Server) userPromoted() []starred.Listed {
	user, err := config.LoadUserStarred()
	if err != nil {
		s.logger.Warn("server: ignoring the user bookmark list", "error", err)
		return nil
	}
	if len(user.Promote) == 0 {
		return nil
	}

	var rows []starred.Listed
	for _, rs := range s.repoList() {
		repoKey := ""
		if s.cfg.MultiRepo {
			repoKey = rs.name
		}
		got, rejected := starred.Promote(starred.PromoteRequest{
			Repo:          repoKey,
			Root:          rs.root,
			Lines:         user.Promote,
			Source:        starred.SourceUserConfig,
			Candidates:    rs.fs.ListAllFiles,
			RequireExists: true,
		})
		for _, r := range rejected {
			s.logger.Warn("server: ignoring an entry in the user bookmark list",
				"repo", rs.name, "reason", r)
		}
		rows = append(rows, got...)
	}
	return rows
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

// reposChangedMessage is the push sent when the set of served repositories
// changes, naming what came and what went. The browser's repository list is
// fetched from /api/repos, so the message is a "refetch that" signal; the names
// ride along for the log line on the other side, not as a list to merge in.
//
// Both fields are always present (empty rather than absent) so a reader never
// has to distinguish "none" from "not stated".
type reposChangedMessage struct {
	Type    string   `json:"type"`
	Added   []string `json:"added"`
	Removed []string `json:"removed"`
}

// broadcastReposChanged pushes repos_changed, normalizing nil name slices to
// empty ones so the message shape does not depend on which half fired.
func (s *Server) broadcastReposChanged(added, removed []string) {
	if added == nil {
		added = []string{}
	}
	if removed == nil {
		removed = []string{}
	}
	s.manager.Broadcast(reposChangedMessage{Type: "repos_changed", Added: added, Removed: removed})
}

// broadcastReviewChanged pushes a review_changed message through the live hub.
// It is the api package's Deps.ReviewChanged, invoked after every successful
// review command so open browsers reload the document's review state.
func (s *Server) broadcastReviewChanged(repo, path string) {
	s.manager.Broadcast(reviewChangedMessage{Type: "review_changed", Repo: repo, Path: path})
}

// starredChangedMessage is the push sent after a bookmark is added or removed.
// It carries no payload: the list is per-invocation and global, so every
// browser refetches /api/starred rather than merging a delta — which also means
// two near-simultaneous mutations cannot leave anyone holding a list nobody has.
type starredChangedMessage struct {
	Type string `json:"type"`
}

// broadcastStarredChanged pushes starred_changed through the live hub. It is
// the api package's Deps.StarredChanged, and it is what keeps several open
// browsers showing the same bookmarks.
func (s *Server) broadcastStarredChanged() {
	s.manager.Broadcast(starredChangedMessage{Type: "starred_changed"})
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
// refresh loop (daemon mode) — and blocks until ctx is cancelled. It returns
// ctx.Err() on cancellation. Watchers and the loop are torn down before Run
// returns. Serving HTTP is the caller's responsibility (cmd owns the
// http.Server); Run only drives the realtime/background machinery.
func (s *Server) Run(ctx context.Context) error {
	// Warm the activity cache before accepting the first /repos so it is instant.
	if s.cfg.MultiRepo {
		s.warmActivity(ctx)
	}

	for _, rs := range s.repoList() {
		s.startWatcher(ctx, rs)
	}

	if s.cfg.MultiRepo {
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			s.refreshLoop(ctx)
		}()
	}

	<-ctx.Done()
	s.wg.Wait()
	return ctx.Err()
}

// startWatcher starts the live watcher for one repository and tracks it, so
// Shutdown can close it and Run can wait for it. A watcher that cannot be
// created is logged and skipped: the repository stays served over HTTP, it just
// does not push live updates. It is called for every repository Run finds at
// startup and for every one the refresh loop discovers afterwards.
func (s *Server) startWatcher(ctx context.Context, rs *repoServices) {
	w, err := live.NewWatcher(rs.root, rs.name, s.manager, s.reviews, s.cfg.UseIgnoreFiles, s.logger)
	if err != nil {
		s.logger.Warn("server: failed to start watcher", "repo", rs.name, "root", rs.root, "error", err)
		return
	}
	s.watchersMu.Lock()
	s.watchers[rs.name] = w
	s.watchersMu.Unlock()

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		// Start blocks until ctx is cancelled; its ctx.Err() return is the
		// expected shutdown path, not a failure worth logging.
		if err := w.Start(ctx); err != nil && !errors.Is(err, ctx.Err()) {
			s.logger.Warn("server: watcher stopped with error", "repo", rs.name, "error", err)
		}
	}()
}

// Shutdown closes the live watchers. It is idempotent and safe to call after Run
// has returned. The HTTP server is owned and shut down by cmd; Shutdown only
// releases the realtime resources this package created.
func (s *Server) Shutdown(_ context.Context) error {
	s.watchersMu.Lock()
	defer s.watchersMu.Unlock()
	for _, w := range s.watchers {
		_ = w.Close()
	}
	return nil
}

// refreshLoop runs the daemon's periodic maintenance until ctx is cancelled:
// reconcile the served repositories with what the source dirs now hold, then
// recompute last-activity for whatever survived. Reconciliation runs first so a
// repository found this pass is warmed by the same pass and reaches the browser
// with its last_activity already populated.
//
// Retiring precedes discovering so a name freed by a departing repository is
// available to one arriving in the same pass. The other order hands the arrival
// a "-2" suffix it then keeps for good, while the name it wanted sits unused.
func (s *Server) refreshLoop(ctx context.Context) {
	ticker := time.NewTicker(s.refreshInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			removed := s.retireRepos()
			added := s.discoverRepos(ctx)
			s.warmActivity(ctx)
			if len(added) > 0 || len(removed) > 0 {
				s.broadcastReposChanged(added, removed)
			}
		}
	}
}

// discoverRepos rescans source_dirs and serves every repository that has
// appeared since the last pass, returning their names. Each one is registered,
// given a watcher, and thereafter indistinguishable from a configured repo.
//
// This is what makes `git clone` into a source dir enough: the scan at startup
// was previously the only one, so a directory created afterwards stayed unseen
// until the daemon was restarted.
//
// It pairs with [Server.retireRepos], which drops the ones that have gone away.
func (s *Server) discoverRepos(ctx context.Context) []string {
	if !s.cfg.MultiRepo || len(s.cfg.SourceDirs) == 0 {
		return nil
	}
	// DiscoverReposFromSourceDirs appends to cfg.Repos and resolves name
	// collisions against what is already there, so it returns only repos this
	// pass is the first to see.
	added := s.cfg.DiscoverReposFromSourceDirs()
	if len(added) == 0 {
		return nil
	}

	names := make([]string, 0, len(added))
	for _, rc := range added {
		s.logger.Info("server: discovered repository", "repo", rc.Name, "path", rc.Path)
		s.startWatcher(ctx, s.register(rc.Name, rc.Path))
		names = append(names, rc.Name)
	}
	return names
}

// retireRepos stops serving every discovered repository whose directory has
// gone away, returning their names. Each one is unregistered and its watcher
// closed, so its routes 404 from the next request on.
//
// That 404 is the point rather than a cost: a browser reading one of its
// documents is told the repository is gone the moment it goes, and told again
// — by the repos_changed that follows the next discovery — when it comes back,
// at which point the page loads the document it was on. Keeping a dead
// repository listed instead would leave the sidebar advertising something whose
// every request already fails, with nothing to announce its return.
//
// Only repos the source-dir scan invented are eligible; see
// [config.Config.PruneMissingDiscoveredRepos] for why an explicit [[repos]]
// entry is never retired.
func (s *Server) retireRepos() []string {
	if !s.cfg.MultiRepo || len(s.cfg.SourceDirs) == 0 {
		return nil
	}
	removed := s.cfg.PruneMissingDiscoveredRepos()
	if len(removed) == 0 {
		return nil
	}

	names := make([]string, 0, len(removed))
	for _, rc := range removed {
		s.logger.Info("server: retired repository; its directory is gone",
			"repo", rc.Name, "path", rc.Path)
		s.unregister(rc.Name)
		names = append(names, rc.Name)
	}
	return names
}

// unregister removes a repository's services and closes its watcher. The
// watcher's goroutine ends on its own: closing the fsnotify watcher closes the
// event channel, which is one of the two ways Start returns.
//
// In-flight requests already holding the services finish against them; the
// services are plain structs over a path, so a request that was mid-read when
// the directory vanished fails the same way it would have anyway.
func (s *Server) unregister(name string) {
	s.reposMu.Lock()
	delete(s.repos, name)
	s.order = slices.DeleteFunc(s.order, func(n string) bool { return n == name })
	s.reposMu.Unlock()

	s.watchersMu.Lock()
	if w, ok := s.watchers[name]; ok {
		_ = w.Close()
		delete(s.watchers, name)
	}
	s.watchersMu.Unlock()

	// Copy-on-write, per the invariant on the field: readers are holding this
	// map without the lock.
	s.activityMu.Lock()
	next := maps.Clone(s.activity)
	delete(next, name)
	s.activity = next
	s.activityMu.Unlock()
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
	repos := s.repoList()
	results := make([]result, len(repos))

	g := new(errgroup.Group)
	for i, rs := range repos {
		name := rs.name
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
