package perf

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// captureLog routes the default logger into a buffer for the rest of the test.
// The perf log lines go to slog's default, so a test of what they say has to
// replace it; none of these tests runs in parallel.
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

// A slow request's log line names the repository its bucket collapsed away: the
// bucket is for percentiles across repos, the line is for finding the one that
// is slow, and on a multi-repo daemon it could not say which.
func TestSlowRequestLogNamesTheRepository(t *testing.T) {
	buf := captureLog(t)
	h := Middleware(NewStore())(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		time.Sleep(1050 * time.Millisecond)
	}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/r/yolo-jail/git/recent", nil))

	require.Contains(t, buf.String(), `msg="perf slow request"`)
	require.Contains(t, buf.String(), `operation="GET /api/r/*/git/recent"`)
	require.Contains(t, buf.String(), "repo=yolo-jail")
}

// A request outside /api/r/ has no repository, and its line says none.
func TestRequestLogWithoutARepositoryNamesNone(t *testing.T) {
	buf := captureLog(t)
	h := Middleware(NewStore())(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/starred", nil))

	require.Contains(t, buf.String(), `operation="GET /api/starred"`)
	require.NotContains(t, buf.String(), "repo=")
}

// Track's attributes go on the log line and nowhere else: the bucket stays one
// per operation, so a repository or path never splits the percentiles.
func TestTrackAttributesReachTheLogLineNotTheBucket(t *testing.T) {
	buf := captureLog(t)
	s := NewStore()
	s.Track(CategoryChecker, "index_scan", "repo", "alpha", "path", "docs/a.md")()
	s.Track(CategoryChecker, "index_scan", "repo", "beta", "path", "docs/b.md")()

	require.Contains(t, buf.String(), "category=checker")
	require.Contains(t, buf.String(), "repo=alpha")
	require.Contains(t, buf.String(), "path=docs/b.md")
	d := s.Diagnostics()
	require.Len(t, d.Services.ByOperation, 1)
	require.Equal(t, 2, d.Services.ByOperation["index_scan"].Count)
	require.Equal(t, CategoryChecker, d.Services.ByOperation["index_scan"].Category)
}
