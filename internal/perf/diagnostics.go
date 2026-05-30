package perf

import "sort"

// OperationStats holds the percentile summary of one operation's durations.
// All times are milliseconds, rounded to one decimal place. The JSON key names
// are part of the perf-report contract: a "request" bucket carries p99 while a
// service bucket omits it (see Diagnostics.Services).
type OperationStats struct {
	Count int     `json:"count"`
	P50   float64 `json:"p50"`
	P95   float64 `json:"p95"`
	P99   float64 `json:"p99,omitempty"`
	Max   float64 `json:"max"`
	Avg   float64 `json:"avg"`
}

// SlowRequest is one request that exceeded the slow threshold. Status is a
// pointer so a request recorded without an HTTP status serializes as null.
// The timestamp is deliberately absent from the JSON contract.
type SlowRequest struct {
	Operation  string  `json:"operation"`
	DurationMs float64 `json:"duration_ms"`
	Status     *int    `json:"status"`
}

// RequestsSection aggregates request-category timings keyed by endpoint
// ("METHOD /path"). ByEndpoint percentile buckets include p99.
type RequestsSection struct {
	Total      int                       `json:"total"`
	ByEndpoint map[string]OperationStats `json:"by_endpoint"`
}

// ServicesSection aggregates non-request timings (git, fs) keyed by operation.
// The request category is excluded here; its buckets omit p99 via OperationStats.
type ServicesSection struct {
	Total       int                       `json:"total"`
	ByOperation map[string]OperationStats `json:"by_operation"`
}

// Meta carries diagnostics provenance and the cost of building the report.
type Meta struct {
	AppVersion  string  `json:"app_version"`
	GitSha      string  `json:"git_sha"`
	CollectedAt string  `json:"collected_at"`
	UptimeS     float64 `json:"uptime_s"`
	BufferSize  int     `json:"buffer_size"`
	BufferMax   int     `json:"buffer_max"`
	BuildMs     float64 `json:"build_ms"`
}

// RepoShape is the anonymized structural summary of a repository tree. It is
// produced by CollectRepoShape and attached to Diagnostics by the server.
type RepoShape struct {
	TotalFiles            int            `json:"total_files"`
	TotalDirs             int            `json:"total_dirs"`
	MaxDepth              int            `json:"max_depth"`
	ExtensionDistribution map[string]int `json:"extension_distribution"`
	DirEntryCount         DirEntryCount  `json:"dir_entry_count"`
	WalkMs                float64        `json:"walk_ms"`
}

// DirEntryCount holds percentiles of per-directory entry counts.
type DirEntryCount struct {
	P50 int `json:"p50"`
	P95 int `json:"p95"`
	Max int `json:"max"`
}

// Diagnostics is the full perf report. It is the shared wire type between the
// server (which marshals it) and the perf-report client (which unmarshals it),
// so the JSON tags here are the contract. RepoShape is populated by the server
// after Store.Diagnostics returns and so carries omitempty.
type Diagnostics struct {
	Requests     RequestsSection      `json:"requests"`
	Services     ServicesSection      `json:"services"`
	SlowRequests []SlowRequest        `json:"slow_requests"`
	Meta         Meta                 `json:"meta"`
	RepoShape    map[string]RepoShape `json:"repo_shape,omitempty"`
}

// round1 rounds a millisecond value to one decimal place, matching the
// frontend-facing precision of every duration in the perf report.
func round1(v float64) float64 {
	r := v * 10
	if r < 0 {
		r -= 0.5
	} else {
		r += 0.5
	}
	return float64(int64(r)) / 10
}

// computePercentiles returns the percentile summary of durations using a
// truncated-index nearest-rank method: p50 uses int(n*0.50) directly, while p95
// and p99 clamp to the last index via min(int(n*p), n-1). The slice is sorted
// in place. withP99 controls whether the p99 field is populated (request
// buckets carry it; service buckets do not).
func computePercentiles(durations []float64, withP99 bool) OperationStats {
	n := len(durations)
	if n == 0 {
		return OperationStats{}
	}
	sort.Float64s(durations)
	var sum float64
	for _, d := range durations {
		sum += d
	}
	stats := OperationStats{
		Count: n,
		P50:   round1(durations[int(float64(n)*0.50)]),
		P95:   round1(durations[min(int(float64(n)*0.95), n-1)]),
		Max:   round1(durations[n-1]),
		Avg:   round1(sum / float64(n)),
	}
	if withP99 {
		stats.P99 = round1(durations[min(int(float64(n)*0.99), n-1)])
	}
	return stats
}
