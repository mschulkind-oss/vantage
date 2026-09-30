package api

import (
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net/http"
	"os"

	"github.com/mschulkind-oss/vantage/internal/starred"
)

// PlanningServerID handles GET /planning/server-id (and
// /r/{repo}/planning/server-id): this server's server id, which the viewer's
// scan cache files every result under. The scan worker asks for it before each
// build, and a browser holding results under any other id empties its cache
// before it reads or sends anything, so a different server answering at the
// same address is never sent another server's paths and hashes as `have`, nor
// shown its text. Design: docs/design/planning-index-at-scale.md §6.5, §8.2.
//
// The answer is `{"server_id": "<32 lowercase hex digits>"}`, from
// [serverID] over the host name and [starred.RootKey], the key that already
// names this vantage invocation: a single-repo server's repository root, or a
// daemon's config file. So it is one id for every repository a daemon serves,
// the same across a restart, and another one for another repository started on
// the same port or another machine behind the same local tunnel port. It is no
// secret: /info already answers the root path. It is sent `no-store`, since a
// cached answer would outlive a change of server, which is the one thing it is
// asked to tell.
func (h *Handlers) PlanningServerID(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.repoOr400(w, r); !ok {
		return
	}
	host, err := os.Hostname()
	if err != nil {
		slog.Debug("api: no host name for the server id", "error", err)
		host = ""
	}
	root, err := starred.RootKey(h.deps.Config)
	if err != nil {
		slog.Debug("api: no root key for the server id", "error", err)
		root = ""
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, struct {
		ServerID string `json:"server_id"`
	}{serverID(host, root)})
}

// serverID is the first 128 bits of SHA-256 over host and root, joined by a
// NUL, which neither can hold, so no two pairs share an input: 32 lowercase hex
// digits, the content hash's own form.
func serverID(host, root string) string {
	sum := sha256.Sum256([]byte(host + "\x00" + root))
	return hex.EncodeToString(sum[:16])
}
