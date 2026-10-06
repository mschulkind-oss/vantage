package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// getSpace calls the Space handler as the router would for /spaces/{id}.
func getSpace(h *Handlers, id string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, "/spaces/x", nil)
	r.SetPathValue("id", id)
	w := httptest.NewRecorder()
	h.Space(w, r)
	return w
}

// spaceIDs is the `ids` half of internal/spaceid/testdata/space-files.json.
func spaceIDs(t *testing.T) []struct {
	ID    string `json:"id"`
	Valid bool   `json:"valid"`
} {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "spaceid", "testdata", "space-files.json"))
	require.NoError(t, err)
	var fixture struct {
		IDs []struct {
			ID    string `json:"id"`
			Valid bool   `json:"valid"`
		} `json:"ids"`
	}
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.NotEmpty(t, fixture.IDs)
	return fixture.IDs
}

func TestSpaceRouteIsGlobal(t *testing.T) {
	e := newTestEnv(t, false)
	for _, rt := range e.h.Routes() {
		if rt.Pattern == "/spaces/{id}" {
			require.Equal(t, http.MethodGet, rt.Method)
			// Which repository holds the id is the question, so it cannot be
			// asked under /r/{repo}.
			require.Equal(t, ScopeGlobal, rt.Scope)
			return
		}
	}
	t.Fatal("GET /spaces/{id} is not in the route table")
}

// An id the pattern refuses is a 400 before the server is asked anything, so a
// request can never steer a lookup to anything but a well-formed id.
func TestSpaceRefusesWhatIsNoSpaceIDBeforeLookingAnywhere(t *testing.T) {
	var asked []string
	e := newTestEnv(t, false)
	e.h.deps.SpaceRepo = func(id string) (string, bool) {
		asked = append(asked, id)
		return "alpha", true
	}
	var valid []string
	for _, tc := range spaceIDs(t) {
		w := getSpace(e.h, tc.ID)
		if !tc.Valid {
			require.Equalf(t, http.StatusBadRequest, w.Code, "%q", tc.ID)
			require.JSONEq(t, `{"error":"Not a space id"}`, w.Body.String())
			continue
		}
		valid = append(valid, tc.ID)
		require.Equalf(t, http.StatusOK, w.Code, "%q", tc.ID)
	}
	require.Equal(t, valid, asked, "only the valid ids reach the lookup")
}

func TestSpaceAnswersTheRepositoryThatHoldsTheID(t *testing.T) {
	e := newTestEnv(t, false)
	held := map[string]string{"abcdefghijklmnop": "alpha", "qrstuvwxyz234567": ""}
	e.h.deps.SpaceRepo = func(id string) (string, bool) {
		repo, ok := held[id]
		return repo, ok
	}

	w := getSpace(e.h, "abcdefghijklmnop")
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t, `{"repo":"alpha"}`, w.Body.String())
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))

	// The single-repo sentinel: this server's one repository holds it.
	w = getSpace(e.h, "qrstuvwxyz234567")
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t, `{"repo":""}`, w.Body.String())

	// None does: an answer, not a failure.
	w = getSpace(e.h, "2222222222222222")
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t, `{"repo":null}`, w.Body.String())
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
}

func TestSpaceWithNoLookupHoldsNoSpace(t *testing.T) {
	e := newTestEnv(t, false)
	w := getSpace(e.h, "abcdefghijklmnop")
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t, `{"repo":null}`, w.Body.String())
}
