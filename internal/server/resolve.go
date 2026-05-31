package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"

	"github.com/go-chi/chi/v5"
	"golang.org/x/sync/errgroup"

	"github.com/mschulkind-oss/vantage/internal/api"
	"github.com/mschulkind-oss/vantage/internal/buildinfo"
	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/perf"
)

// resolveLegacy wraps a ScopeRepo handler mounted at the legacy "/api{Pattern}"
// path. In single-repo mode it injects the single repository's services (keyed
// by the empty name) into the request context. In daemon mode legacy repo
// routes are disabled — serving the default target would expose the wrong
// repository — so it responds 404 before the handler runs.
func (s *Server) resolveLegacy(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.MultiRepo {
			writeJSONError(w, http.StatusNotFound,
				"Legacy endpoints are disabled in multi-repo mode. Use /api/r/{repo}/... instead.")
			return
		}
		rs, ok := s.repos[""]
		if !ok {
			writeJSONError(w, http.StatusNotFound, "Repository not found")
			return
		}
		next(w, r.WithContext(withRepo(r.Context(), rs)))
	}
}

// resolveRepo wraps a ScopeRepo handler mounted at "/api/r/{repo}{Pattern}". It
// looks up the {repo} path parameter and injects its services into the context;
// an unknown repository name is a 404. In single-repo mode the only repository
// is keyed by the empty name, so a named "/r/{repo}" request 404s there too.
func (s *Server) resolveRepo(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "repo")
		rs, ok := s.repos[name]
		if !ok || name == "" {
			writeJSONError(w, http.StatusNotFound, "Repository not found: "+name)
			return
		}
		next(w, r.WithContext(withRepo(r.Context(), rs)))
	}
}

// resolveGlobal wraps a ScopeGlobal handler. The cross-repo globals (/repos,
// /files/all, /recent/all) do not need repo services, but the single-repo
// variants of /files/all, /recent/all, and /perf/diagnostics?include_shape do.
// In single-repo mode it injects the lone repository's services so those api
// handlers work; in daemon mode it injects nothing (the fan-out overrides own
// the cross-repo behavior).
func (s *Server) resolveGlobal(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.cfg.MultiRepo {
			if rs, ok := s.repos[""]; ok {
				next(w, r.WithContext(withRepo(r.Context(), rs)))
				return
			}
		}
		next(w, r)
	}
}

// withRepo attaches rs to ctx as an [api.RepoServices] so api handlers recover
// it with [api.RepoServicesFromContext].
func withRepo(ctx context.Context, rs *repoServices) context.Context {
	return api.WithRepoServices(ctx, api.RepoServices{
		Repo: rs.name,
		Git:  rs.git,
		FS:   rs.fs,
	})
}

// ---------------------------------------------------------------------------
// Multi-repo fan-out overrides (daemon mode only)
// ---------------------------------------------------------------------------

// handleReposMulti handles GET /repos in daemon mode. It returns one RepoInfo
// per configured repository in configuration order, attaching last_activity from
// the activity cache. The single-repo sentinel ([{"name":""}]) is never emitted
// here — that is the api package's job in single-repo mode.
func (s *Server) handleReposMulti(w http.ResponseWriter, _ *http.Request) {
	s.activityMu.RLock()
	cache := s.activity
	s.activityMu.RUnlock()

	out := make([]model.RepoInfo, 0, len(s.order))
	for _, name := range s.order {
		if info, ok := cache[name]; ok {
			out = append(out, info)
			continue
		}
		// Cache not yet warmed for this repo: return the name with null activity.
		out = append(out, model.RepoInfo{Name: name})
	}
	writeJSONOK(w, out)
}

// handleFilesAllMulti handles GET /files/all in daemon mode. It fans out across
// every repository, tags each Markdown path with its repo name, and concatenates
// the per-repo results in configuration order.
func (s *Server) handleFilesAllMulti(w http.ResponseWriter, _ *http.Request) {
	perRepo := make([][]model.RepoFile, len(s.order))

	g := new(errgroup.Group)
	for i, name := range s.order {
		rs := s.repos[name]
		g.Go(func() error {
			perRepo[i] = api.BuildFilesAllScoped(rs.fs, rs.name)
			return nil
		})
	}
	_ = g.Wait()

	out := make([]model.RepoFile, 0)
	for _, files := range perRepo {
		out = append(out, files...)
	}
	writeJSONOK(w, out)
}

// handleRecentAllMulti handles GET /recent/all in daemon mode. It fans out across
// every repository, merges the per-repo recent files, re-sorts the combined set
// by date descending, and truncates to the clamped limit.
func (s *Server) handleRecentAllMulti(w http.ResponseWriter, r *http.Request) {
	limit := clampRecentLimit(queryInt(r, "limit", 10))
	showHidden := queryBool(r, "show_hidden", true)
	showGitignored := queryBool(r, "show_gitignored", true)

	perRepo := make([][]api.RecentAllItem, len(s.order))
	g := new(errgroup.Group)
	for i, name := range s.order {
		rs := s.repos[name]
		g.Go(func() error {
			perRepo[i] = api.BuildRecentAll(rs.git, rs.name, limit, showHidden, showGitignored)
			return nil
		})
	}
	_ = g.Wait()

	out := make([]api.RecentAllItem, 0)
	for _, items := range perRepo {
		out = append(out, items...)
	}
	// Re-sort the merged set newest-first; ties broken by repo then path for a
	// deterministic order.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Date.Equal(out[j].Date) {
			if out[i].Repo != out[j].Repo {
				return out[i].Repo < out[j].Repo
			}
			return out[i].Path < out[j].Path
		}
		return out[i].Date.After(out[j].Date)
	})
	if len(out) > limit {
		out = out[:limit]
	}
	writeJSONOK(w, out)
}

// handlePerfDiagnosticsMulti handles GET /perf/diagnostics in daemon mode. It
// builds the timing report once and, when include_shape=true, attaches each
// repository's anonymized shape under repo_1..repo_n keys (configuration order),
// matching the historical multi-repo shape contract.
func (s *Server) handlePerfDiagnosticsMulti(w http.ResponseWriter, r *http.Request) {
	diag := s.perf.Diagnostics()
	diag.Meta.AppVersion = buildinfo.Version()
	diag.Meta.GitSha = buildinfo.ShortCommit()

	if queryBool(r, "include_shape", false) {
		excl := excludeSet(s.cfg.ExcludeDirs)
		shapes := make(map[string]perf.RepoShape, len(s.order))
		for i, name := range s.order {
			rs := s.repos[name]
			shapes["repo_"+strconv.Itoa(i+1)] = perf.CollectRepoShape(rs.fs.RootPath(), excl)
		}
		diag.RepoShape = shapes
	}

	writeJSONOK(w, diag)
}

// ---------------------------------------------------------------------------
// Repo activity probe
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Local HTTP/query helpers
//
// These mirror the api package's unexported helpers (writeJSON, queryBool,
// queryInt, clamp, excludeSet) so the server's override handlers respond in the
// exact same shapes without reaching into api internals.
// ---------------------------------------------------------------------------

// writeJSONOK marshals v as a 200 application/json response.
func writeJSONOK(w http.ResponseWriter, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// writeJSONError writes an {"error":…} envelope at status, the repo-wide default
// envelope (the frontend keys on the status code for these responses).
func writeJSONError(w http.ResponseWriter, status int, msg string) {
	body, _ := json.Marshal(map[string]string{"error": msg})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// queryBool parses a boolean query parameter, falling back to def when absent or
// unparseable.
func queryBool(r *http.Request, key string, def bool) bool {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return def
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		return def
	}
	return v
}

// queryInt parses an int query parameter, falling back to def when absent or
// unparseable.
func queryInt(r *http.Request, key string, def int) int {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	return v
}

// clampRecentLimit constrains a recents limit to the contract's [1,1000] range.
func clampRecentLimit(limit int) int {
	if limit < 1 {
		return 1
	}
	if limit > 1000 {
		return 1000
	}
	return limit
}

// excludeSet converts a slice of directory names into the set
// [perf.CollectRepoShape] expects.
func excludeSet(dirs []string) map[string]struct{} {
	set := make(map[string]struct{}, len(dirs))
	for _, d := range dirs {
		set[d] = struct{}{}
	}
	return set
}
