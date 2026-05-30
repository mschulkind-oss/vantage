package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"

	"github.com/mschulkind-oss/vantage/internal/perf"
)

// ANSI color codes used by the perf report. They are emitted only when stdout
// is a terminal (see colorize).
const (
	ansiReset  = "\033[0m"
	ansiBold   = "\033[1m"
	ansiCyan   = "\033[36m"
	ansiYellow = "\033[33m"
	ansiRed    = "\033[31m"
)

// newPerfReportCmd builds the `perf-report` command: fetch perf diagnostics
// from a running server over HTTP and render them as a table.
func newPerfReportCmd() *cobra.Command {
	var (
		url    string
		asJSON bool
		shape  bool
		reset  bool
	)

	cmd := &cobra.Command{
		Use:   "perf-report",
		Short: "Print performance diagnostics from a running server",
		Long: "Collect and display performance diagnostics from a running Vantage\n" +
			"instance. The data is anonymized — no file names, project names, or\n" +
			"content — and safe to share.",
		Args: cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			base := strings.TrimRight(url, "/")
			endpoint := base + "/api/perf/diagnostics"
			timeout := 10 * time.Second
			if shape {
				endpoint += "?include_shape=true"
				timeout = 120 * time.Second
			}

			client := &http.Client{Timeout: timeout}
			resp, err := client.Get(endpoint)
			if err != nil {
				return fmt.Errorf("failed to connect to Vantage at %s: %w", base, err)
			}
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != http.StatusOK {
				return fmt.Errorf("perf endpoint returned status %d", resp.StatusCode)
			}
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				return fmt.Errorf("reading response: %w", err)
			}

			if asJSON {
				// Re-indent so the raw output is human-readable.
				var generic any
				if err := json.Unmarshal(body, &generic); err != nil {
					return fmt.Errorf("decoding diagnostics: %w", err)
				}
				pretty, err := json.MarshalIndent(generic, "", "  ")
				if err != nil {
					return fmt.Errorf("encoding diagnostics: %w", err)
				}
				fmt.Println(string(pretty))
			} else {
				var diag perf.Diagnostics
				if err := json.Unmarshal(body, &diag); err != nil {
					return fmt.Errorf("decoding diagnostics: %w", err)
				}
				printPerfReport(os.Stdout, &diag, isTerminal(os.Stdout))
			}

			if reset {
				req, err := http.NewRequest(http.MethodPost, base+"/api/perf/reset", nil)
				if err == nil {
					if rr, rerr := client.Do(req); rerr == nil {
						_ = rr.Body.Close()
						fmt.Println("\nPerformance counters reset.")
					} else {
						fmt.Fprintln(os.Stderr, "\nFailed to reset counters.")
					}
				}
			}
			return nil
		},
	}

	f := cmd.Flags()
	f.StringVar(&url, "url", "http://localhost:8000", "Base URL of the running Vantage server")
	f.BoolVar(&asJSON, "json", false, "Output raw JSON instead of a formatted report")
	f.BoolVar(&shape, "shape", false, "Include repo shape stats (slow for large repos)")
	f.BoolVar(&reset, "reset", false, "Reset perf counters after collecting")

	return cmd
}

// printPerfReport renders a Diagnostics report to w as aligned tables. When
// color is true ANSI escapes are emitted; otherwise the output is plain text.
func printPerfReport(w io.Writer, d *perf.Diagnostics, color bool) {
	c := colorizer(color)

	fmt.Fprintln(w, c(ansiCyan+ansiBold, fmt.Sprintf(
		"=== Vantage Performance Report ===  v%s (%s)  up %.0fs",
		orUnknown(d.Meta.AppVersion), orUnknown(d.Meta.GitSha), d.Meta.UptimeS)))
	fmt.Fprintln(w)

	// Request summary.
	fmt.Fprintln(w, c(ansiBold, fmt.Sprintf("Total API requests: %d", d.Requests.Total)))
	fmt.Fprintln(w)

	if len(d.Requests.ByEndpoint) > 0 {
		fmt.Fprintln(w, c(ansiYellow+ansiBold, "Endpoint Latencies (ms):"))
		tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
		fmt.Fprintln(tw, "  Endpoint\tCount\tp50\tp95\tp99\tmax")
		for _, ep := range sortedByP95(d.Requests.ByEndpoint) {
			s := d.Requests.ByEndpoint[ep]
			line := fmt.Sprintf("  %s\t%d\t%.1f\t%.1f\t%.1f\t%.1f",
				ep, s.Count, s.P50, s.P95, s.P99, s.Max)
			fmt.Fprintln(tw, c(latencyColor(s.P95), line))
		}
		_ = tw.Flush()
		fmt.Fprintln(w)
	}

	// Service operations (the request category is already excluded server-side).
	if len(d.Services.ByOperation) > 0 {
		fmt.Fprintln(w, c(ansiYellow+ansiBold, "Service Operation Latencies (ms):"))
		tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
		fmt.Fprintln(tw, "  Operation\tCount\tp50\tp95\tmax")
		for _, op := range sortedByP95(d.Services.ByOperation) {
			s := d.Services.ByOperation[op]
			line := fmt.Sprintf("  %s\t%d\t%.1f\t%.1f\t%.1f",
				op, s.Count, s.P50, s.P95, s.Max)
			fmt.Fprintln(tw, c(latencyColor(s.P95), line))
		}
		_ = tw.Flush()
		fmt.Fprintln(w)
	}

	// Slow requests.
	if len(d.SlowRequests) > 0 {
		fmt.Fprintln(w, c(ansiRed+ansiBold, fmt.Sprintf(
			"Slow Requests (>threshold): %d captured", len(d.SlowRequests))))
		limit := len(d.SlowRequests)
		if limit > 10 {
			limit = 10
		}
		for _, s := range d.SlowRequests[:limit] {
			fmt.Fprintf(w, "  %8.0fms  %s\n", s.DurationMs, s.Operation)
		}
		fmt.Fprintln(w)
	}

	// Repo shape.
	if len(d.RepoShape) > 0 {
		fmt.Fprintln(w, c(ansiYellow+ansiBold, "Repository Shape:"))
		for _, name := range sortedKeys(d.RepoShape) {
			shape := d.RepoShape[name]
			fmt.Fprintf(w, "  %s:\n", name)
			fmt.Fprintf(w, "    Files: %d  |  Dirs: %d  |  Max depth: %d\n",
				shape.TotalFiles, shape.TotalDirs, shape.MaxDepth)
			if len(shape.ExtensionDistribution) > 0 {
				fmt.Fprintf(w, "    Extensions: %s\n", topExtensions(shape.ExtensionDistribution, 8))
			}
			dc := shape.DirEntryCount
			fmt.Fprintf(w, "    Dir sizes: p50=%d, p95=%d, max=%d\n", dc.P50, dc.P95, dc.Max)
		}
		fmt.Fprintln(w)
	}
}

// colorizer returns a function that wraps text in the given ANSI codes when
// enabled is true, and otherwise returns the text unchanged.
func colorizer(enabled bool) func(codes, text string) string {
	return func(codes, text string) string {
		if !enabled || codes == "" {
			return text
		}
		return codes + text + ansiReset
	}
}

// latencyColor picks an ANSI color for a p95 latency: red above 500ms, yellow
// above 100ms, none otherwise.
func latencyColor(p95 float64) string {
	switch {
	case p95 > 500:
		return ansiRed
	case p95 > 100:
		return ansiYellow
	default:
		return ""
	}
}

// isTerminal reports whether f is attached to a character device (a TTY),
// gating color output without an external dependency.
func isTerminal(f *os.File) bool {
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}

// sortedByP95 returns the keys of m ordered by descending p95 latency, ties
// broken by key for stability.
func sortedByP95(m map[string]perf.OperationStats) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if m[keys[i]].P95 != m[keys[j]].P95 {
			return m[keys[i]].P95 > m[keys[j]].P95
		}
		return keys[i] < keys[j]
	})
	return keys
}

// sortedKeys returns the keys of a RepoShape map in ascending order.
func sortedKeys(m map[string]perf.RepoShape) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// topExtensions formats the n highest-count extensions as "ext: count" pairs,
// ordered by descending count then name.
func topExtensions(ext map[string]int, n int) string {
	type kv struct {
		k string
		v int
	}
	pairs := make([]kv, 0, len(ext))
	for k, v := range ext {
		pairs = append(pairs, kv{k, v})
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].v != pairs[j].v {
			return pairs[i].v > pairs[j].v
		}
		return pairs[i].k < pairs[j].k
	})
	if len(pairs) > n {
		pairs = pairs[:n]
	}
	parts := make([]string, 0, len(pairs))
	for _, p := range pairs {
		parts = append(parts, fmt.Sprintf("%s: %d", p.k, p.v))
	}
	return strings.Join(parts, ", ")
}

// orUnknown returns s, or "?" when s is empty, matching the reference report's
// placeholder for absent metadata.
func orUnknown(s string) string {
	if s == "" {
		return "?"
	}
	return s
}
