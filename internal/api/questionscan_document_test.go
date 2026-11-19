package api

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/mschulkind-oss/vantage/internal/perf"
	"github.com/stretchr/testify/require"
)

// oneDocumentIndex is `index --format json`'s answer holding a.md alone.
const oneDocumentIndex = `{"index":{"refused":false,"documents":[{"path":"a.md","questions":[{"id":"OQ-1","unitLine":9,"unitEndLine":13,"unitText":"x"}]}]}}`

// fakeChecker writes an executable standing in for vantage-check: it appends its
// arguments, one run per line, to the returned log, and answers with
// oneDocumentIndex — unless it is an older checker, which refuses --document as
// an unknown option, exactly as a pre---document release does.
func fakeChecker(t *testing.T, older bool) (bin, log string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the fake checker is a POSIX shell script")
	}
	dir := t.TempDir()
	log = filepath.Join(dir, "args.log")
	refuse := ""
	if older {
		refuse = `case " $* " in *" --document "*) echo "vantage-check: unknown option for index: --document" >&2; exit 2;; esac` + "\n"
	}
	bin = filepath.Join(dir, "vantage-check")
	script := "#!/bin/sh\necho \"$*\" >> '" + log + "'\n" + refuse + "echo '" + oneDocumentIndex + "'\n"
	require.NoError(t, os.WriteFile(bin, []byte(script), 0o755))
	return bin, log
}

func runs(t *testing.T, log string) []string {
	t.Helper()
	raw, err := os.ReadFile(log)
	require.NoError(t, err)
	return strings.Split(strings.TrimSpace(string(raw)), "\n")
}

// A review command proves one document's questions, so it asks the checker for
// that document alone: scanning the whole project per take is what made Take
// this leaning wait 10–27 s on a project of ~700 candidates.
func TestScanAsksTheCheckerForTheOneDocument(t *testing.T) {
	bin, log := fakeChecker(t, false)
	scanned, err := CLIQuestionScanner{Command: []string{bin}}.Scan(context.Background(), t.TempDir(), "a.md")

	require.NoError(t, err)
	require.Equal(t, "OQ-1", scanned["a.md"][0].ID)
	require.Equal(t, []string{"index --format json --document a.md"}, runs(t, log))
}

// A checker older than --document (one found on PATH, say) refuses it as an
// unknown option; the scan falls back to the whole project, and remembers, so
// later scans do not pay for a refused run first.
func TestScanFallsBackToTheWholeProjectForAnOlderChecker(t *testing.T) {
	bin, log := fakeChecker(t, true)
	sc := CLIQuestionScanner{Command: []string{bin}}
	for range 2 {
		scanned, err := sc.Scan(context.Background(), t.TempDir(), "a.md")
		require.NoError(t, err)
		require.Equal(t, "OQ-1", scanned["a.md"][0].ID)
	}
	require.Equal(t, []string{
		"index --format json --document a.md",
		"index --format json",
		"index --format json",
	}, runs(t, log))
}

// Every scan is timed as a checker service call, so a slow one is named in the
// perf report and its log line rather than hidden inside a request's latency.
func TestScanIsTimedAsACheckerCall(t *testing.T) {
	bin, _ := fakeChecker(t, false)
	count := func() int { return perf.Default.Diagnostics().Services.ByOperation["index_scan"].Count }
	before := count()
	_, err := CLIQuestionScanner{Command: []string{bin}}.Scan(context.Background(), t.TempDir(), "a.md")
	require.NoError(t, err)

	require.Equal(t, before+1, count())
	require.Equal(t, perf.CategoryChecker, perf.Default.Diagnostics().Services.ByOperation["index_scan"].Category)
}
