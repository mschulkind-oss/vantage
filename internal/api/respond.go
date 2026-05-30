package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
)

// writeJSON marshals v and writes it as the response body with the given status
// and a JSON content type. A marshal failure (which should never happen for the
// model types) is logged and downgraded to a 500 with an {"error":…} envelope.
func writeJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		slog.Error("api: failed to marshal response", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if _, err := w.Write(body); err != nil {
		slog.Debug("api: failed to write response body", "error", err)
	}
}

// writeError writes an {"error":…} envelope at status. This is the repo-wide
// default envelope: the frontend only checks the status code for these (git
// 4xx, review delete-miss, repo-required), so the message is informational.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// writeDetail writes a {"detail":…} envelope at status. This envelope is used
// ONLY for filesystem validation 400s (tree/content bad path), where the
// frontend reads the detail field to surface the reason.
func writeDetail(w http.ResponseWriter, status int, detail string) {
	writeJSON(w, status, map[string]string{"detail": detail})
}

// queryBool parses a query parameter as a boolean, returning def when the
// parameter is absent or unparseable. It accepts the same spellings as
// strconv.ParseBool ("1","t","true","0","f","false", …).
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

// queryInt parses a query parameter as an int, returning def when the parameter
// is absent or unparseable.
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

// clamp constrains v to the inclusive range [lo, hi].
func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
