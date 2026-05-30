package live

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/require"
)

// quietLogger discards output so tests don't spam.
func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// newTestConn registers a bare *conn (no real socket) directly into the manager
// so Broadcast's fan-out and eviction can be exercised without inotify/ws
// timing. The returned conn's send buffer holds depth messages.
func (m *Manager) newTestConn(depth int) *conn {
	c := &conn{
		send:   make(chan []byte, depth),
		addr:   "test",
		closed: make(chan struct{}),
	}
	m.mu.Lock()
	m.conns[c] = struct{}{}
	m.count.Store(int64(len(m.conns)))
	m.mu.Unlock()
	return c
}

func TestBroadcastFansOutToAllClients(t *testing.T) {
	m := NewManager(quietLogger())
	a := m.newTestConn(4)
	b := m.newTestConn(4)

	m.Broadcast(map[string]any{"type": "files_changed", "paths": []string{"a.md"}})

	for name, c := range map[string]*conn{"a": a, "b": b} {
		select {
		case got := <-c.send:
			var msg map[string]any
			require.NoError(t, json.Unmarshal(got, &msg))
			require.Equal(t, "files_changed", msg["type"], "conn %s", name)
		default:
			t.Fatalf("conn %s received no broadcast", name)
		}
	}
	require.Equal(t, 2, m.Count())
}

func TestBroadcastMarshalsOnce(t *testing.T) {
	m := NewManager(quietLogger())
	a := m.newTestConn(1)
	b := m.newTestConn(1)

	m.Broadcast(map[string]any{"type": "hello", "version": "abc"})

	ga := <-a.send
	gb := <-b.send
	// Same backing bytes prove a single marshal fanned out to both clients.
	require.Equal(t, string(ga), string(gb))
}

func TestBroadcastEvictsSlowClient(t *testing.T) {
	m := NewManager(quietLogger())
	// depth 1: first broadcast fills the buffer, second overflows -> eviction.
	slow := m.newTestConn(1)
	fast := m.newTestConn(8)

	m.Broadcast(map[string]any{"type": "files_changed", "paths": []string{"1"}})
	require.Equal(t, 2, m.Count(), "no eviction on first send")

	m.Broadcast(map[string]any{"type": "files_changed", "paths": []string{"2"}})

	require.Equal(t, 1, m.Count(), "slow client should be evicted")
	select {
	case <-slow.closed:
	default:
		t.Fatal("slow client was not stopped")
	}
	// Fast client keeps both messages and is retained.
	require.Len(t, fast.send, 2)
}

func TestBroadcastNoConnectionsIsNoop(t *testing.T) {
	m := NewManager(quietLogger())
	require.NotPanics(t, func() {
		m.Broadcast(map[string]any{"type": "files_changed"})
	})
	require.Equal(t, 0, m.Count())
}

func TestBroadcastMarshalErrorDropsMessage(t *testing.T) {
	m := NewManager(quietLogger())
	c := m.newTestConn(1)
	// channels are not JSON-marshalable.
	m.Broadcast(map[string]any{"bad": make(chan int)})
	require.Len(t, c.send, 0, "nothing should be queued on marshal failure")
}

// --- integration: real websocket through the Handler ---

func dialTestServer(t *testing.T, m *Manager, warm WarmFunc, origin string) (*websocket.Conn, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(m.Handler(warm))
	wsURL := "ws" + srv.URL[len("http"):]

	hdr := http.Header{}
	if origin != "" {
		hdr.Set("Origin", origin)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: hdr})
	require.NoError(t, err)
	return c, srv
}

func TestHandlerSendsHelloAndWarmsOnFirstConnect(t *testing.T) {
	m := NewManager(quietLogger())
	var warmed atomic.Int32
	warm := func(ctx context.Context) { warmed.Add(1) }

	c, srv := dialTestServer(t, m, warm, "http://localhost:5173")
	defer srv.Close()
	defer c.Close(websocket.StatusNormalClosure, "")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	typ, data, err := c.Read(ctx)
	require.NoError(t, err)
	require.Equal(t, websocket.MessageText, typ)

	var hello map[string]any
	require.NoError(t, json.Unmarshal(data, &hello))
	require.Equal(t, "hello", hello["type"])
	require.NotEmpty(t, hello["version"])

	require.Eventually(t, func() bool { return warmed.Load() == 1 }, time.Second, 10*time.Millisecond)
}

func TestHandlerRejectsForeignOrigin(t *testing.T) {
	m := NewManager(quietLogger())
	srv := httptest.NewServer(m.Handler(nil))
	defer srv.Close()
	wsURL := "ws" + srv.URL[len("http"):]

	hdr := http.Header{}
	hdr.Set("Origin", "http://evil.example.com")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: hdr})
	require.Error(t, err)
}

func TestHandlerCountTracksConnectAndDisconnect(t *testing.T) {
	m := NewManager(quietLogger())
	c, srv := dialTestServer(t, m, nil, "http://127.0.0.1:5173")
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, err := c.Read(ctx) // hello
	require.NoError(t, err)

	require.Eventually(t, func() bool { return m.Count() == 1 }, time.Second, 10*time.Millisecond)

	require.NoError(t, c.Close(websocket.StatusNormalClosure, "bye"))
	require.Eventually(t, func() bool { return m.Count() == 0 }, 2*time.Second, 10*time.Millisecond)
}

func TestRouteClientFrame(t *testing.T) {
	var rec levelRecorder
	logger := slog.New(&rec)

	tests := []struct {
		name      string
		frame     string
		wantLevel slog.Level
		wantMsg   string
		wantSkip  bool
	}{
		{"info log", `{"type":"client_log","level":"info","msg":"hi"}`, slog.LevelInfo, "hi", false},
		{"warn mapped", `{"type":"client_log","level":"warn","msg":"careful"}`, slog.LevelWarn, "careful", false},
		{"error mapped", `{"type":"client_log","level":"error","msg":"boom"}`, slog.LevelError, "boom", false},
		{"log->info", `{"type":"client_log","level":"log","msg":"x"}`, slog.LevelInfo, "x", false},
		{"unknown level->info", `{"type":"client_log","level":"trace","msg":"y"}`, slog.LevelInfo, "y", false},
		{"unknown frame ignored", `{"type":"heartbeat"}`, 0, "", true},
		{"malformed json ignored", `not json`, 0, "", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec.reset()
			routeClientFrame(logger.With("source", "client"), []byte(tc.frame))
			if tc.wantSkip {
				require.Zero(t, rec.count(), "frame should be ignored")
				return
			}
			require.Equal(t, 1, rec.count())
			lvl, msg := rec.last()
			require.Equal(t, tc.wantLevel, lvl)
			require.Equal(t, tc.wantMsg, msg)
		})
	}
}

func TestRouteClientFrameBatch(t *testing.T) {
	var rec levelRecorder
	logger := slog.New(&rec)
	frame := `{"type":"client_log_batch","entries":[` +
		`{"level":"info","msg":"one"},` +
		`{"level":"error","msg":"two"}]}`
	routeClientFrame(logger.With("source", "client"), []byte(frame))
	require.Equal(t, 2, rec.count())
}

func TestOriginAllowed(t *testing.T) {
	tests := []struct {
		origin string
		want   bool
	}{
		{"http://localhost:5173", true},
		{"http://127.0.0.1:8000", true},
		{"http://[::1]:5173", true},
		{"https://localhost", true},
		{"http://evil.example.com", false},
		{"http://192.168.1.10:5173", false},
		{"garbage", false},
	}
	for _, tc := range tests {
		t.Run(tc.origin, func(t *testing.T) {
			require.Equal(t, tc.want, originAllowed(tc.origin))
		})
	}
}

// levelRecorder is a minimal slog.Handler capturing the level and message of
// each record for assertion.
type levelRecorder struct {
	records []slog.Record
}

func (r *levelRecorder) Enabled(context.Context, slog.Level) bool { return true }
func (r *levelRecorder) Handle(_ context.Context, rec slog.Record) error {
	r.records = append(r.records, rec)
	return nil
}
func (r *levelRecorder) WithAttrs([]slog.Attr) slog.Handler { return r }
func (r *levelRecorder) WithGroup(string) slog.Handler      { return r }
func (r *levelRecorder) reset()                             { r.records = nil }
func (r *levelRecorder) count() int                         { return len(r.records) }
func (r *levelRecorder) last() (slog.Level, string) {
	rec := r.records[len(r.records)-1]
	return rec.Level, rec.Message
}
