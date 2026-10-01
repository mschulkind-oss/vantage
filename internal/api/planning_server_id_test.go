package api

import (
	"net/http"
	"os"
	"regexp"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/starred"
)

// The server id is what keeps one server's scan results from being sent to
// another answering at the same address (docs/reference/planning-index.md
// §11.2), so every part of what it names has to move it: the host, which is
// what differs behind one local tunnel port, and the root key, which is what
// differs between two repositories started on the same port.
func TestTheServerIDNamesTheHostAndTheInvocation(t *testing.T) {
	id := serverID("laptop", "/home/me/code/a")
	require.Regexp(t, regexp.MustCompile(`^[0-9a-f]{32}$`), id)
	require.Equal(t, id, serverID("laptop", "/home/me/code/a"), "the same across a restart")
	require.NotEqual(t, id, serverID("build-box", "/home/me/code/a"), "another machine")
	require.NotEqual(t, id, serverID("laptop", "/home/me/code/b"), "another repository")
	// The separator keeps a character from moving between the two halves.
	require.NotEqual(t, serverID("ab", "c"), serverID("a", "bc"))
}

func TestThePlanningServerIDAnswersThisInvocationsID(t *testing.T) {
	e := newTestEnv(t, false)
	cfg := config.Defaults()
	cfg.TargetRepo = e.dir
	e.h = NewHandlers(Deps{Config: cfg})

	w := e.do(e.h.PlanningServerID, http.MethodGet, "/planning/server-id", "", true)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	var body struct {
		ServerID string `json:"server_id"`
	}
	decode(t, w, &body)

	host, err := os.Hostname()
	require.NoError(t, err)
	root, err := starred.RootKey(cfg)
	require.NoError(t, err)
	require.Equal(t, serverID(host, root), body.ServerID)

	// Another repository on the same host is another server.
	other := config.Defaults()
	other.TargetRepo = t.TempDir()
	e.h = NewHandlers(Deps{Config: other})
	w = e.do(e.h.PlanningServerID, http.MethodGet, "/planning/server-id", "", true)
	var second struct {
		ServerID string `json:"server_id"`
	}
	decode(t, w, &second)
	require.NotEqual(t, body.ServerID, second.ServerID)
}
