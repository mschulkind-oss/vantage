package api

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/stretchr/testify/require"
)

// A project over the checker's candidate limit is no longer refused for one
// document: the REAL checker reads that document alone under --document, so the
// reply is proven from its scan (here: the anchor lies in OQ-1's unit, and the
// comment is bound to no question).
func TestRealCheckerPastTheCandidateLimitStillProvesOneDocument(t *testing.T) {
	e := scanEnv(t)
	writeFile(t, e.dir, ".vantage.toml", "[planning]\nmax-candidates = 1\n")
	writeFile(t, e.dir, "b.md", planDoc)
	writeFile(t, e.dir, "c.md", planDoc)
	e.createComment(t, "c1", alphaLine)
	got := e.reply(t, "c1", "r1")
	require.Equal(t, model.ReasonAnchorInQuestion, got.OwnershipReason)
}

// A checker older than --document falls back to the whole project, where a
// project over the limit is refused (exit 3 with a refused index); the reason
// reaches the comment unchanged.
func TestOlderCheckerRefusalIsNamedScanRefused(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the fake checker is a POSIX shell script")
	}
	bin := filepath.Join(t.TempDir(), "vantage-check")
	script := `#!/bin/sh
case " $* " in *" --document "*) echo "vantage-check: unknown option for index: --document" >&2; exit 2;; esac
echo '{"index":{"refused":true,"documents":[]}}'
exit 3
`
	require.NoError(t, os.WriteFile(bin, []byte(script), 0o755))
	e := newCmdEnv(t)
	writeFile(t, e.dir, "a.md", planDoc)
	deps := e.h.deps
	deps.QuestionScanner = CLIQuestionScanner{Command: []string{bin}}
	e.h = NewHandlers(deps)
	e.createComment(t, "c1", alphaLine)
	require.Equal(t, model.ReasonScanRefused, e.reply(t, "c1", "r1").OwnershipReason)
}

// A checker that is installed but errors is not "not installed".
func TestCheckerFailureIsNamedScannerFailed(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "a.md", planDoc)
	deps := e.h.deps
	deps.QuestionScanner = &failingScanner{err: errors.New("boom")}
	e.h = NewHandlers(deps)
	e.createComment(t, "c1", alphaLine)
	require.Equal(t, model.ReasonScannerFailed, e.reply(t, "c1", "r1").OwnershipReason)
}

type racingScanner struct{ path string }

func (r racingScanner) Scan(context.Context, string, string) (map[string][]ScannedQuestion, error) {
	if err := os.WriteFile(r.path, []byte(planDoc+"\nchanged under the scan\n"), 0o644); err != nil {
		return nil, err
	}
	return map[string][]ScannedQuestion{}, nil
}

// A document written while the checker scanned it is a race, not a missing checker.
func TestDocumentChangedDuringScanIsNamedScanRaced(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "a.md", planDoc)
	deps := e.h.deps
	deps.QuestionScanner = racingScanner{path: filepath.Join(e.dir, "a.md")}
	e.h = NewHandlers(deps)
	e.createComment(t, "c1", alphaLine)
	require.Equal(t, model.ReasonScanRaced, e.reply(t, "c1", "r1").OwnershipReason)
}
