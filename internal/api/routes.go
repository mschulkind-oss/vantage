package api

import "net/http"

// Scope tells the server how to mount a [Route].
type Scope int

const (
	// ScopeGlobal routes are mounted exactly once under "/api{Pattern}". They
	// either operate across all repositories (e.g. /repos, /files/all) or are
	// repository-agnostic (e.g. /health, /perf/diagnostics).
	ScopeGlobal Scope = iota
	// ScopeRepo routes are mounted twice by the server, sharing one handler:
	// the legacy form "/api{Pattern}" (single-repo; 404 in daemon mode) and the
	// multi form "/api/r/{repo}{Pattern}". The handler reads the resolved
	// services from the request context either way.
	ScopeRepo
)

// Route is one mountable endpoint. Pattern is the path suffix below "/api"
// (e.g. "/git/history"), without the "/r/{repo}" prefix the server adds for
// ScopeRepo routes. Method is an uppercase HTTP method. Handler is the bound
// [Handlers] method.
//
// The /api/ws WebSocket route is deliberately not represented here; the live
// package mounts it directly.
type Route struct {
	Method  string
	Pattern string
	Handler http.HandlerFunc
	Scope   Scope
}

// Routes returns the full table of API routes for the server to mount. The
// order is stable and groups routes by concern (global, then repo-scoped git,
// fs, and review families) for readability; mounting order is otherwise
// insignificant.
func (h *Handlers) Routes() []Route {
	return []Route{
		// --- Global (mounted once under /api) ---
		{http.MethodGet, "/health", h.Health, ScopeGlobal},
		{http.MethodGet, "/repos", h.Repos, ScopeGlobal},
		{http.MethodGet, "/files/all", h.FilesAll, ScopeGlobal},
		{http.MethodGet, "/recent/all", h.RecentAll, ScopeGlobal},
		{http.MethodGet, "/perf/diagnostics", h.PerfDiagnostics, ScopeGlobal},
		{http.MethodPost, "/perf/reset", h.PerfReset, ScopeGlobal},

		// --- Repo-scoped: info/version ---
		{http.MethodGet, "/version", h.Version, ScopeRepo},
		{http.MethodGet, "/info", h.Info, ScopeRepo},
		{http.MethodGet, "/files", h.Files, ScopeRepo},

		// --- Repo-scoped: filesystem ---
		{http.MethodGet, "/tree", h.Tree, ScopeRepo},
		{http.MethodGet, "/content", h.Content, ScopeRepo},

		// --- Repo-scoped: git ---
		{http.MethodGet, "/git/history", h.GitHistory, ScopeRepo},
		{http.MethodGet, "/git/status", h.GitStatus, ScopeRepo},
		{http.MethodGet, "/git/diff", h.GitDiff, ScopeRepo},
		{http.MethodGet, "/git/diff/working", h.GitWorkingDiff, ScopeRepo},
		{http.MethodGet, "/git/recent", h.GitRecent, ScopeRepo},

		// --- Repo-scoped: review ---
		{http.MethodGet, "/review", h.ReviewGet, ScopeRepo},
		{http.MethodPut, "/review", h.ReviewPut, ScopeRepo},
		{http.MethodDelete, "/review", h.ReviewDelete, ScopeRepo},
	}
}
