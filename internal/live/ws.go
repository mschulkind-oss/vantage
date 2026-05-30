package live

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/coder/websocket"

	"github.com/mschulkind-oss/vantage/internal/buildinfo"
)

// helloMessage is the first frame sent to a newly connected client. The
// frontend reloads itself whenever version changes between connections, which
// is how a rebuilt/restarted server pushes fresh code to open tabs.
type helloMessage struct {
	Type    string `json:"type"`
	Version string `json:"version"`
}

// clientLogEntry is a single browser-originated log record. Unknown levels map
// to info.
type clientLogEntry struct {
	Level string `json:"level"`
	Msg   string `json:"msg"`
}

// clientLogFrame is the envelope for client_log / client_log_batch frames.
type clientLogFrame struct {
	Type    string           `json:"type"`
	Level   string           `json:"level"`
	Msg     string           `json:"msg"`
	Entries []clientLogEntry `json:"entries"`
}

// clientLevels maps JS console levels onto slog levels. Anything not present
// falls back to Info so unexpected payloads are still captured.
var clientLevels = map[string]slog.Level{
	"debug":   slog.LevelDebug,
	"info":    slog.LevelInfo,
	"log":     slog.LevelInfo,
	"warn":    slog.LevelWarn,
	"warning": slog.LevelWarn,
	"error":   slog.LevelError,
}

// allowedOriginHosts are the hostnames permitted to open a WebSocket. An empty
// Origin header (non-browser clients, same-origin navigations) is always
// allowed.
var allowedOriginHosts = map[string]struct{}{
	"localhost": {},
	"127.0.0.1": {},
	"::1":       {},
}

// WarmFunc warms expensive caches when the first client connects (the 0->1
// transition), so the initial API calls after an idle period hit warm caches.
// It runs in its own goroutine and must tolerate a cancelled context.
type WarmFunc func(ctx context.Context)

// Handler returns an http.HandlerFunc serving the /api/ws endpoint. warm, if
// non-nil, is invoked in a background goroutine on the 0->1 connection
// transition. The handler blocks for the lifetime of each connection, so it is
// mounted directly (chi/net.http run it on the request goroutine).
func (m *Manager) Handler(warm WarmFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && !originAllowed(origin) {
			m.logger.Warn("websocket rejected: origin not allowed", "origin", origin)
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}

		// Origin is gated above, so skip the library's host check.
		ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			m.logger.Warn("websocket accept failed", "error", err)
			return
		}

		ctx := r.Context()
		c, total := m.connect(ctx, ws, r.RemoteAddr)
		defer m.disconnect(c)

		hello, _ := json.Marshal(helloMessage{Type: "hello", Version: buildinfo.BuildVersion()})
		m.logger.Info("websocket hello sent", "version", buildinfo.BuildVersion())
		if err := ws.Write(ctx, websocket.MessageText, hello); err != nil {
			m.logger.Debug("websocket hello write failed", "addr", c.addr, "error", err)
			return
		}

		if total == 1 && warm != nil {
			// Warm in the background with a context that outlives this single
			// connection; cancellation is tied to the request, so detach it.
			go warm(context.WithoutCancel(ctx))
		}

		m.readLoop(ctx, ws, c.addr)
	}
}

// readLoop consumes frames from the client until the connection closes,
// routing client_log / client_log_batch frames to the client logger and
// ignoring everything else.
func (m *Manager) readLoop(ctx context.Context, ws *websocket.Conn, addr string) {
	clientLog := m.logger.With("source", "client", "addr", addr)
	for {
		typ, data, err := ws.Read(ctx)
		if err != nil {
			status := websocket.CloseStatus(err)
			if status == websocket.StatusNormalClosure || status == websocket.StatusGoingAway {
				m.logger.Info("websocket client disconnected", "addr", addr, "status", status)
			} else {
				m.logger.Debug("websocket read ended", "addr", addr, "error", err)
			}
			return
		}
		if typ != websocket.MessageText {
			continue
		}
		routeClientFrame(clientLog, data)
	}
}

// routeClientFrame parses a single text frame and logs any client_log entries.
// Malformed JSON and unknown frame types are silently ignored so the read loop
// is never poisoned.
func routeClientFrame(clientLog *slog.Logger, data []byte) {
	var frame clientLogFrame
	if err := json.Unmarshal(data, &frame); err != nil {
		return
	}

	var entries []clientLogEntry
	switch frame.Type {
	case "client_log":
		entries = []clientLogEntry{{Level: frame.Level, Msg: frame.Msg}}
	case "client_log_batch":
		entries = frame.Entries
	default:
		return
	}

	for _, e := range entries {
		level, ok := clientLevels[strings.ToLower(e.Level)]
		if !ok {
			level = slog.LevelInfo
		}
		clientLog.Log(context.Background(), level, e.Msg)
	}
}

// originAllowed reports whether origin's hostname is in the localhost set.
func originAllowed(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	_, ok := allowedOriginHosts[u.Hostname()]
	return ok
}
