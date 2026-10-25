package ignore

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestDiagnosticMatcherMatchesOrdinaryLayeredMatcher(t *testing.T) {
	root := t.TempDir()
	userPath := filepath.Join(t.TempDir(), "user-ignore")
	require.NoError(t, os.WriteFile(userPath, []byte("build/\nlogs/\n!logs/keep.md\n"), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(root, workspaceIgnoreName), []byte("!build/keep.md\n*.tmp\n"), 0o600))

	ordinary := NewMatcher(root, true, userPath)
	snapshot, err := NewDiagnosticMatcher(context.Background(), root, true, userPath)
	require.NoError(t, err)
	for _, path := range []struct {
		rel   string
		isDir bool
	}{
		{"build", true}, {"build/output.o", false}, {"build/keep.md", false},
		{"logs", true}, {"logs/drop.md", false}, {"logs/keep.md", false},
		{"archive.tmp", false}, {"./unmatched.md", false}, {".vantage/inbox", true},
	} {
		require.Equal(t, ordinary.IsIgnored(path.rel, path.isDir), snapshot.IsIgnored(path.rel, path.isDir), path.rel)
	}

	disabled, err := NewDiagnosticMatcher(context.Background(), root, false, userPath)
	require.NoError(t, err)
	require.False(t, disabled.IsIgnored("build/output.o", false))
	require.True(t, disabled.IsIgnored(".vantage/inbox", true))
}

func TestDiagnosticMatcherIsImmutableAndDoesNotReload(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, workspaceIgnoreName)
	require.NoError(t, os.WriteFile(workspace, []byte("first\n"), 0o600))
	snapshot, err := NewDiagnosticMatcher(context.Background(), root, true, "")
	require.NoError(t, err)

	require.NoError(t, os.WriteFile(workspace, []byte("second\n"), 0o600))
	require.True(t, snapshot.IsIgnored("first", false))
	require.False(t, snapshot.IsIgnored("second", false))
}

func TestDiagnosticMatcherRejectsOversizedInputs(t *testing.T) {
	for _, tc := range []struct {
		name       string
		user       string
		workspace  string
		wantReason string
	}{
		{
			name:       "combined bytes",
			user:       strings.Repeat(strings.Repeat("x", diagnosticIgnoreLineBytes)+"\n", diagnosticIgnoreByteLimit/4097+1),
			wantReason: "1 MiB combined diagnostic limit",
		},
		{
			name:       "line bytes",
			workspace:  strings.Repeat("x", diagnosticIgnoreLineBytes+1),
			wantReason: "4 KiB diagnostic limit",
		},
		{
			name:       "combined line count",
			user:       strings.Repeat("rule\n", diagnosticIgnoreLineLimit),
			workspace:  "one-more\n",
			wantReason: "4096-line combined diagnostic limit",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			userPath := ""
			if tc.user != "" {
				userPath = filepath.Join(t.TempDir(), "user-ignore")
				require.NoError(t, os.WriteFile(userPath, []byte(tc.user), 0o600))
			}
			if tc.workspace != "" {
				require.NoError(t, os.WriteFile(filepath.Join(root, workspaceIgnoreName), []byte(tc.workspace), 0o600))
			}
			_, err := NewDiagnosticMatcher(context.Background(), root, true, userPath)
			require.Error(t, err)
			require.Contains(t, err.Error(), tc.wantReason)
		})
	}
}

func TestDiagnosticMatcherRejectsNonRegularIgnoreSource(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.Mkdir(filepath.Join(root, workspaceIgnoreName), 0o700))
	_, err := NewDiagnosticMatcher(context.Background(), root, true, "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "not a regular file")
}

func TestDiagnosticMatcherCancellationBeforeAndDuringLoad(t *testing.T) {
	root := t.TempDir()
	userPath := filepath.Join(t.TempDir(), "user-ignore")
	require.NoError(t, os.WriteFile(userPath, []byte("one\ntwo\nthree\n"), 0o600))
	_, err := NewDiagnosticMatcher(cancelledContext{}, root, true, userPath)
	require.ErrorIs(t, err, context.Canceled)

	// Cancellation at the pattern loop proves loading checks context between
	// per-line compilations rather than only before and after file I/O.
	_, err = NewDiagnosticMatcher(&cancelAfterChecks{cancelAt: 12}, root, true, userPath)
	require.ErrorIs(t, err, context.Canceled)
}

type cancelledContext struct{}

func (cancelledContext) Deadline() (time.Time, bool) { return time.Time{}, false }
func (cancelledContext) Done() <-chan struct{}       { return nil }
func (cancelledContext) Err() error                  { return context.Canceled }
func (cancelledContext) Value(any) any               { return nil }

type cancelAfterChecks struct {
	checks   int
	cancelAt int
}

func (c *cancelAfterChecks) Deadline() (time.Time, bool) { return time.Time{}, false }
func (c *cancelAfterChecks) Done() <-chan struct{}       { return nil }
func (c *cancelAfterChecks) Err() error {
	c.checks++
	if c.checks >= c.cancelAt {
		return context.Canceled
	}
	return nil
}
func (c *cancelAfterChecks) Value(any) any { return nil }
