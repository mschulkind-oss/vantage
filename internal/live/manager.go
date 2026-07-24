// Package live provides the realtime layer of the Vantage server: a WebSocket
// connection Manager, the /api/ws handler, and an fsnotify-backed file Watcher
// that broadcasts file-change notifications to connected browsers.
//
// The Manager owns a set of connections, each driven by its own writer
// goroutine fed from a buffered channel. Broadcast marshals a message once and
// fans the bytes out to every connection; a connection whose buffer overflows
// is evicted as a slow client rather than blocking the broadcaster. The Watcher
// coalesces filesystem events, invalidates the git/fs caches, consumes review
// inbox deliveries, warns when a reviewed document still carries a
// retired-protocol changelog block, and broadcasts a sorted files_changed
// payload.
package live

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"sync/atomic"

	"github.com/coder/websocket"
)

// sendBuffer is the per-connection outbound queue depth. A connection that
// falls this far behind the broadcaster is treated as a slow client and
// evicted instead of stalling every other connection.
const sendBuffer = 32

// conn wraps a single WebSocket connection with its own buffered send channel.
// The writer goroutine is the sole writer of the connection, which keeps the
// coder/websocket usage single-writer as that library requires.
type conn struct {
	ws   *websocket.Conn
	send chan []byte
	addr string

	closeOnce sync.Once
	// closed is signalled by drop so the writer goroutine and Broadcast can
	// stop targeting an evicted connection without a second close.
	closed chan struct{}
}

// Manager tracks active WebSocket connections and broadcasts messages to them.
// It is safe for concurrent use.
type Manager struct {
	mu    sync.Mutex
	conns map[*conn]struct{}

	// count mirrors len(conns) for lock-free reads from callers that only
	// need an approximate connection total (e.g. heartbeat logging).
	count atomic.Int64

	logger *slog.Logger

	// allowedOrigins are extra WebSocket-origin hostnames permitted beyond the
	// always-allowed loopback names. Read-only after construction.
	allowedOrigins map[string]struct{}
}

// NewManager returns an empty Manager. If logger is nil the default slog logger
// is used. allowedOrigins lists extra hostnames (beyond loopback) permitted to
// open a WebSocket; loopback names are always allowed regardless.
func NewManager(logger *slog.Logger, allowedOrigins []string) *Manager {
	if logger == nil {
		logger = slog.Default()
	}
	origins := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		origins[o] = struct{}{}
	}
	return &Manager{
		conns:          make(map[*conn]struct{}),
		logger:         logger,
		allowedOrigins: origins,
	}
}

// Count returns the number of currently active connections.
func (m *Manager) Count() int {
	return int(m.count.Load())
}

// connect registers ws and starts its writer goroutine. It returns the wrapper
// and the connection total after the add, so the caller can detect the 0->1
// transition for cache warming.
func (m *Manager) connect(ctx context.Context, ws *websocket.Conn, addr string) (*conn, int) {
	c := &conn{
		ws:     ws,
		send:   make(chan []byte, sendBuffer),
		addr:   addr,
		closed: make(chan struct{}),
	}

	m.mu.Lock()
	m.conns[c] = struct{}{}
	total := len(m.conns)
	m.mu.Unlock()
	m.count.Store(int64(total))

	go m.writeLoop(ctx, c)

	m.logger.Info("websocket connected", "addr", addr, "total", total)
	return c, total
}

// disconnect removes c from the active set. It is idempotent: a connection
// already evicted by drop is a no-op here.
func (m *Manager) disconnect(c *conn) {
	m.mu.Lock()
	_, present := m.conns[c]
	if present {
		delete(m.conns, c)
	}
	total := len(m.conns)
	m.mu.Unlock()
	if !present {
		return
	}
	m.count.Store(int64(total))
	c.stop()
	m.logger.Info("websocket disconnected", "addr", c.addr, "total", total)
}

// stop signals the writer goroutine to exit exactly once.
func (c *conn) stop() {
	c.closeOnce.Do(func() { close(c.closed) })
}

// writeLoop is the single writer for c. It drains the send channel until the
// connection is stopped or the context is cancelled, then closes the socket.
func (m *Manager) writeLoop(ctx context.Context, c *conn) {
	defer func() {
		// CloseNow is safe to call repeatedly and unblocks any peer.
		_ = c.ws.CloseNow()
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.closed:
			return
		case msg := <-c.send:
			if err := c.ws.Write(ctx, websocket.MessageText, msg); err != nil {
				m.logger.Debug("websocket write failed, evicting", "addr", c.addr, "error", err)
				m.disconnect(c)
				return
			}
		}
	}
}

// Broadcast marshals msg once and delivers the bytes to every active
// connection. A connection whose buffer is full is evicted as a slow client.
// Marshalling errors are logged and drop the broadcast.
func (m *Manager) Broadcast(msg any) {
	data, err := json.Marshal(msg)
	if err != nil {
		m.logger.Error("websocket broadcast marshal failed", "error", err)
		return
	}

	m.mu.Lock()
	if len(m.conns) == 0 {
		m.mu.Unlock()
		m.logger.Debug("broadcast skipped: no active connections")
		return
	}
	targets := make([]*conn, 0, len(m.conns))
	for c := range m.conns {
		targets = append(targets, c)
	}
	m.mu.Unlock()

	var slow []*conn
	sent := 0
	for _, c := range targets {
		select {
		case c.send <- data:
			sent++
		case <-c.closed:
			// Already shutting down; nothing to do.
		default:
			// Buffer full: the client cannot keep up. Evict it rather than
			// blocking every other connection on the slowest one.
			slow = append(slow, c)
		}
	}

	for _, c := range slow {
		m.logger.Warn("evicting slow websocket client", "addr", c.addr)
		m.disconnect(c)
	}

	m.logger.Debug("broadcast complete", "sent", sent, "evicted", len(slow), "remaining", m.Count())
}
