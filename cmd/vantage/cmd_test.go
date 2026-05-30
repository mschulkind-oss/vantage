package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/perf"
)

func TestServeByDefault(t *testing.T) {
	root := newRootCmd()
	tests := []struct {
		name string
		argv []string
		want []string
	}{
		{
			name: "bare path is rewritten to serve",
			argv: []string{"vantage", "/home/user/notes"},
			want: []string{"vantage", "serve", "/home/user/notes"},
		},
		{
			name: "known subcommand is left alone",
			argv: []string{"vantage", "daemon", "-c", "x.toml"},
			want: []string{"vantage", "daemon", "-c", "x.toml"},
		},
		{
			name: "init-config subcommand is left alone",
			argv: []string{"vantage", "init-config"},
			want: []string{"vantage", "init-config"},
		},
		{
			name: "root flag is left alone",
			argv: []string{"vantage", "--version"},
			want: []string{"vantage", "--version"},
		},
		{
			name: "no args is left alone",
			argv: []string{"vantage"},
			want: []string{"vantage"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := serveByDefault(tt.argv, root)
			require.Equal(t, tt.want, got)
		})
	}
}

func TestVersionTemplate(t *testing.T) {
	root := newRootCmd()
	var out bytes.Buffer
	root.SetOut(&out)
	root.SetArgs([]string{"--version"})
	require.NoError(t, root.Execute())
	require.True(t, strings.HasPrefix(out.String(), "vantage-md, version "),
		"got %q", out.String())
}

func TestRootHasAllSubcommands(t *testing.T) {
	root := newRootCmd()
	want := []string{"serve", "daemon", "init-config", "install-service", "build", "perf-report"}
	have := map[string]bool{}
	for _, c := range root.Commands() {
		have[c.Name()] = true
	}
	for _, w := range want {
		require.True(t, have[w], "missing subcommand %q", w)
	}
}

func TestLatencyColor(t *testing.T) {
	tests := []struct {
		name string
		p95  float64
		want string
	}{
		{"fast is plain", 50, ""},
		{"medium is yellow", 200, ansiYellow},
		{"slow is red", 800, ansiRed},
		{"boundary 100 is plain", 100, ""},
		{"boundary 500 is yellow", 500, ansiYellow},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, latencyColor(tt.p95))
		})
	}
}

func TestTopExtensions(t *testing.T) {
	ext := map[string]int{".md": 10, ".go": 5, ".txt": 5, ".json": 1}
	// Descending count, ties broken by name (".go" before ".txt").
	require.Equal(t, ".md: 10, .go: 5, .txt: 5", topExtensions(ext, 3))
	require.Equal(t, ".md: 10", topExtensions(ext, 1))
}

func TestSortedByP95(t *testing.T) {
	m := map[string]perf.OperationStats{
		"a": {P95: 10},
		"b": {P95: 100},
		"c": {P95: 100},
	}
	// Descending p95; equal p95 broken by key ("b" before "c").
	require.Equal(t, []string{"b", "c", "a"}, sortedByP95(m))
}

func TestColorizer(t *testing.T) {
	on := colorizer(true)
	require.Equal(t, ansiRed+"hi"+ansiReset, on(ansiRed, "hi"))
	require.Equal(t, "hi", on("", "hi"))

	off := colorizer(false)
	require.Equal(t, "hi", off(ansiRed, "hi"))
}

func TestPrintPerfReport(t *testing.T) {
	status := 200
	diag := &perf.Diagnostics{
		Requests: perf.RequestsSection{
			Total: 42,
			ByEndpoint: map[string]perf.OperationStats{
				"GET /api/tree": {Count: 10, P50: 1.2, P95: 3.4, P99: 9.9, Max: 12.3},
			},
		},
		Services: perf.ServicesSection{
			Total: 7,
			ByOperation: map[string]perf.OperationStats{
				"git.status": {Count: 5, P50: 0.5, P95: 600, Max: 700},
			},
		},
		SlowRequests: []perf.SlowRequest{
			{Operation: "GET /api/files/all", DurationMs: 250, Status: &status},
		},
		Meta: perf.Meta{AppVersion: "1.2.3", GitSha: "abc1234", UptimeS: 90},
		RepoShape: map[string]perf.RepoShape{
			"notes": {
				TotalFiles:            100,
				TotalDirs:             20,
				MaxDepth:              4,
				ExtensionDistribution: map[string]int{".md": 90, ".txt": 10},
				DirEntryCount:         perf.DirEntryCount{P50: 5, P95: 30, Max: 50},
			},
		},
	}

	// Plain (no color) output: no ANSI escapes, all sections present.
	var buf bytes.Buffer
	printPerfReport(&buf, diag, false)
	out := buf.String()
	require.NotContains(t, out, "\033[")
	require.Contains(t, out, "Vantage Performance Report")
	require.Contains(t, out, "v1.2.3 (abc1234)")
	require.Contains(t, out, "Total API requests: 42")
	require.Contains(t, out, "GET /api/tree")
	require.Contains(t, out, "git.status")
	require.Contains(t, out, "Slow Requests")
	require.Contains(t, out, "GET /api/files/all")
	require.Contains(t, out, "Repository Shape")
	require.Contains(t, out, "notes:")
	require.Contains(t, out, ".md: 90")

	// Colored output emits ANSI escapes.
	var cbuf bytes.Buffer
	printPerfReport(&cbuf, diag, true)
	require.Contains(t, cbuf.String(), "\033[")
}

func TestOrUnknown(t *testing.T) {
	require.Equal(t, "?", orUnknown(""))
	require.Equal(t, "x", orUnknown("x"))
}
