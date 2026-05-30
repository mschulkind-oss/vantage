package perf

import (
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// statusRecorder wraps an http.ResponseWriter to capture the status code that
// reaches the client. A handler that never calls WriteHeader implicitly sends
// 200, so the recorder defaults to that.
type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

// WriteHeader records the status code and forwards it to the underlying writer.
func (r *statusRecorder) WriteHeader(code int) {
	if !r.wroteHeader {
		r.status = code
		r.wroteHeader = true
	}
	r.ResponseWriter.WriteHeader(code)
}

// Write ensures a status is captured for handlers that write a body without an
// explicit WriteHeader (which implies 200).
func (r *statusRecorder) Write(b []byte) (int, error) {
	if !r.wroteHeader {
		r.status = http.StatusOK
		r.wroteHeader = true
	}
	return r.ResponseWriter.Write(b)
}

// Middleware returns net/http middleware that records request timings into the
// given Store. Requests outside /api/ and the /api/perf* endpoints are passed
// through untimed. The recorded operation is "METHOD path" with the repo name
// collapsed out of /api/r/{repo}/… routes so that all repos share one bucket.
func Middleware(store *Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			path := req.URL.Path
			if !strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/api/perf") {
				next.ServeHTTP(w, req)
				return
			}

			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			start := time.Now()
			next.ServeHTTP(rec, req)
			durationMs := float64(time.Since(start).Microseconds()) / 1000

			operation := req.Method + " " + collapseRepoPath(path)
			store.recordRequest(operation, durationMs, rec.status)

			logRequest(operation, durationMs, rec.status)
		})
	}
}

// collapseRepoPath rewrites /api/r/{repo}/rest → /api/r/*/rest and the bare
// /api/r/{repo} → /api/r/*. Any other path is returned unchanged. Splitting into
// at most five fields isolates the repo segment (index 3) from the remainder.
func collapseRepoPath(path string) string {
	if !strings.HasPrefix(path, "/api/r/") {
		return path
	}
	parts := strings.SplitN(path, "/", 5)
	// parts == ["", "api", "r", "{repo}", "rest"] for a full path, or
	// ["", "api", "r", "{repo}"] for the bare /api/r/{repo}.
	if len(parts) < 4 {
		return path
	}
	if len(parts) > 4 && parts[4] != "" {
		return "/api/r/*/" + parts[4]
	}
	return "/api/r/*"
}

// logRequest emits a request-timing log line gated by duration: WARN above
// 1000ms, INFO above 200ms, DEBUG otherwise.
func logRequest(operation string, durationMs float64, status int) {
	attrs := []any{
		slog.String("operation", operation),
		slog.Float64("duration_ms", durationMs),
		slog.Int("status", status),
	}
	switch {
	case durationMs > 1000:
		slog.Warn("perf slow request", attrs...)
	case durationMs > 200:
		slog.Info("perf request", attrs...)
	default:
		slog.Debug("perf request", attrs...)
	}
}
