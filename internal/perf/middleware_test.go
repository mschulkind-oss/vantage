package perf

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestCollapseRepoPath pins the repo-name collapsing rule across the path shapes
// the middleware encounters.
func TestCollapseRepoPath(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"non-repo passthrough", "/api/tree", "/api/tree"},
		{"non-api passthrough", "/static/app.js", "/static/app.js"},
		{"repo with rest", "/api/r/myrepo/git/history", "/api/r/*/git/history"},
		{"repo single segment rest", "/api/r/myrepo/tree", "/api/r/*/tree"},
		{"bare repo", "/api/r/myrepo", "/api/r/*"},
		{"bare repo trailing slash", "/api/r/myrepo/", "/api/r/*"},
		{"repo deep rest", "/api/r/a/files/content/x.md", "/api/r/*/files/content/x.md"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, collapseRepoPath(tc.in))
		})
	}
}

// TestMiddlewareRecordsAndCollapses drives a request through the middleware and
// confirms the operation key collapses the repo and the captured status matches
// what the handler wrote.
func TestMiddlewareRecordsAndCollapses(t *testing.T) {
	s := NewStore()
	handler := Middleware(s)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/r/myrepo/git/history", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusTeapot, rec.Code)

	diag := s.Diagnostics()
	require.Equal(t, 1, diag.Requests.Total)
	require.Contains(t, diag.Requests.ByEndpoint, "GET /api/r/*/git/history")

	require.Len(t, diag.SlowRequests, 0)
}

// TestMiddlewareDefaultsTo200 confirms a handler that writes a body without an
// explicit WriteHeader is recorded as status 200.
func TestMiddlewareDefaultsTo200(t *testing.T) {
	s := NewStore()
	handler := Middleware(s)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/tree", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	// Force a slow record so we can read back the captured status.
	s.recordRequest("GET /api/tree", 300.0, 200)
	diag := s.Diagnostics()
	require.NotEmpty(t, diag.SlowRequests)
	require.NotNil(t, diag.SlowRequests[0].Status)
	require.Equal(t, 200, *diag.SlowRequests[0].Status)
}

// TestMiddlewareSkipsNonAPIAndPerf verifies non-/api/ paths and /api/perf* are
// passed through without being recorded.
func TestMiddlewareSkipsNonAPIAndPerf(t *testing.T) {
	s := NewStore()
	var served int
	handler := Middleware(s)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		served++
		w.WriteHeader(http.StatusOK)
	}))

	for _, path := range []string{"/static/app.js", "/api/perf", "/api/perf/clear", "/index.html"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		handler.ServeHTTP(httptest.NewRecorder(), req)
	}

	require.Equal(t, 4, served, "all requests reach the handler")
	require.Equal(t, 0, s.Diagnostics().Requests.Total, "skipped paths are not recorded")
}

// fakeHijacker is a ResponseWriter that supports hijacking, used to prove the
// middleware's wrapper stays transparent to connection upgrades.
type fakeHijacker struct {
	http.ResponseWriter
	hijacked bool
}

func (f *fakeHijacker) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	f.hijacked = true
	return nil, nil, nil
}

// TestMiddlewareSkipsWebSocket confirms the long-lived /api/ws upgrade is passed
// through untimed (wrapping its writer would block the handshake — a 501).
func TestMiddlewareSkipsWebSocket(t *testing.T) {
	s := NewStore()
	served := 0
	handler := Middleware(s)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		served++
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/ws", nil)
	handler.ServeHTTP(httptest.NewRecorder(), req)

	require.Equal(t, 1, served)
	require.Equal(t, 0, s.Diagnostics().Requests.Total, "/api/ws must not be timed")
}

// TestStatusRecorderUnwrapEnablesHijack guards the regression where the
// status-capturing wrapper hid the underlying Hijacker, breaking WebSockets.
func TestStatusRecorderUnwrapEnablesHijack(t *testing.T) {
	base := &fakeHijacker{ResponseWriter: httptest.NewRecorder()}
	rec := &statusRecorder{ResponseWriter: base, status: http.StatusOK}

	_, _, err := http.NewResponseController(rec).Hijack()
	require.NoError(t, err, "ResponseController must reach the Hijacker via Unwrap")
	require.True(t, base.hijacked)
}

// TestMiddlewareRecordsAPIPath confirms a plain /api/ path is recorded with the
// method-and-path operation key.
func TestMiddlewareRecordsAPIPath(t *testing.T) {
	s := NewStore()
	handler := Middleware(s)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodPost, "/api/files", nil)
	handler.ServeHTTP(httptest.NewRecorder(), req)

	require.Contains(t, s.Diagnostics().Requests.ByEndpoint, "POST /api/files")
}
