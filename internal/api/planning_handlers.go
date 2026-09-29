package api

import (
	"log/slog"
	"net/http"

	"github.com/mschulkind-oss/vantage/internal/planning"
	"github.com/mschulkind-oss/vantage/internal/repoconfig"
)

// PlanningSources handles GET /planning/sources (and
// /r/{repo}/planning/sources): the text of every planning candidate, for the
// viewer's planning index to scan. Design: docs/design/planning-index.md §3.4.
//
// Without parameters it answers the batch, streamed: the effective `[planning]`
// table, the candidate count, whether the scan was refused past
// `max-candidates`, and the files, the skipped and the unreadable, each list
// sorted by path and never null. See [planning.WriteBatch].
//
// With `?path=` it answers for that one path — the viewer's refresh after a
// change push — as a single `file`, `skipped`, `unreadable` or `absent` entry,
// under the batch's own tests. See [planning.Lookup]. An empty `path` is a
// 400, like every other endpoint's.
//
// The existing /content endpoint is deliberately not the per-file refresh. It
// serves paths the listing never yields, has no size limit, and answers a
// missing file and an unreadable one with the same 400.
//
// The config is read with [repoconfig.Config.SettingsNow], past the reload
// throttle, because the request this most often answers is the rescan a
// `.vantage.toml` push just caused. A file that cannot be used is logged and the
// defaults are served, so a bad table costs the reader their exclusions and
// never the index.
func (h *Handlers) PlanningSources(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	cfg := planningConfig(svc)

	if q := r.URL.Query(); q.Has("path") {
		rel := q.Get("path")
		if rel == "" {
			writeDetail(w, http.StatusBadRequest, "Missing required query parameter: path")
			return
		}
		writeJSON(w, http.StatusOK, planning.Lookup(svc.FS, cfg, rel))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := planning.WriteBatch(w, svc.FS, cfg); err != nil {
		// Headers are gone, so there is no status left to change: the client
		// stopped reading, and its parse of a truncated body is what fails.
		slog.Debug("api: planning batch not delivered", "repo", svc.Repo, "error", err)
	}
}

// planningConfig is the repository's effective `[planning]` table: its own when
// it has a usable one, the defaults otherwise.
func planningConfig(svc RepoServices) repoconfig.Planning {
	if svc.Config == nil {
		return repoconfig.DefaultPlanning()
	}
	settings, err := svc.Config.SettingsNow()
	if err != nil {
		// Warned, not fatal, as the server's promoted() does for the same file:
		// in daemon mode one contributor's typo must not take the planning
		// index away from every other repository.
		slog.Warn("api: ignoring repository config for the planning index",
			"repo", svc.Repo, "path", svc.Config.Path(), "error", err)
		return repoconfig.DefaultPlanning()
	}
	return settings.Planning.Resolved()
}
