package api

import (
	"net/http"

	"github.com/mschulkind-oss/vantage/internal/buildinfo"
	"github.com/mschulkind-oss/vantage/internal/perf"
)

// PerfDiagnostics handles GET /perf/diagnostics. It builds the timing report
// from the perf store and stamps its Meta provenance (app version and git SHA)
// from buildinfo, which [perf.Store.Diagnostics] leaves blank for the caller to
// fill. When include_shape=true and a single-repo service is in context, it
// attaches that repository's anonymized shape under the "repo_1" key; multi-repo
// shape fan-out is the server's responsibility.
//
// The report has no frontend consumer — only the perf-report CLI reads it — so
// the only contract is the key set documented in the port spec §7.
func (h *Handlers) PerfDiagnostics(w http.ResponseWriter, r *http.Request) {
	diag := h.deps.Perf.Diagnostics()
	diag.Meta.AppVersion = buildinfo.Version()
	diag.Meta.GitSha = buildinfo.ShortCommit()

	if queryBool(r, "include_shape", false) {
		if svc, ok := RepoServicesFromContext(r.Context()); ok {
			var excl map[string]struct{}
			if h.deps.Config != nil {
				excl = excludeSet(h.deps.Config.ExcludeDirs)
			}
			shape := perf.CollectRepoShape(svc.FS.RootPath(), excl)
			diag.RepoShape = map[string]perf.RepoShape{"repo_1": shape}
		}
	}

	writeJSON(w, http.StatusOK, diag)
}

// PerfReset handles POST /perf/reset. It clears all collected timing data and
// returns the literal {"status":"cleared"}.
func (h *Handlers) PerfReset(w http.ResponseWriter, _ *http.Request) {
	h.deps.Perf.Clear()
	writeJSON(w, http.StatusOK, map[string]string{"status": "cleared"})
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
