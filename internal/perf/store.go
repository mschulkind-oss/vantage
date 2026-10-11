// Package perf provides in-memory performance instrumentation: a ring buffer of
// timing records, request-timing middleware, percentile diagnostics, and an
// anonymized repo-shape walk.
//
// Timing records are grouped by category. Only three categories exist:
// "request" (HTTP requests, recorded by the middleware), "git", and "fs"
// (service calls, recorded via Track). Diagnostics splits the two: request
// timings feed requests.by_endpoint, while non-request timings feed
// services.by_operation.
package perf

import (
	"log/slog"
	"sort"
	"sync"
	"time"
)

// maxRecords is the capacity of the timing ring buffer. Older records are
// overwritten once the buffer is full.
const maxRecords = 2000

// CategoryRequest, CategoryGit, and CategoryFS are the only valid timing
// categories. Anything other than CategoryRequest is treated as a service call.
const (
	CategoryRequest = "request"
	CategoryGit     = "git"
	CategoryFS      = "fs"
)

// timingRecord is a single timing measurement. status is set only for request
// records (the HTTP response code) and is nil otherwise.
type timingRecord struct {
	category   string
	operation  string
	durationMs float64
	status     *int
}

// Store is a concurrency-safe ring buffer of timing records plus aggregate
// counters. The zero value is not usable; construct one with NewStore. A
// package-level Default instance is shared by the middleware and service Track.
type Store struct {
	mu           sync.Mutex
	records      []timingRecord
	next         int  // write cursor into records
	full         bool // whether the ring has wrapped
	requestCount int
	serviceCount int
	counters     map[string]int // named tallies, e.g. cache hits and misses
	startTime    time.Time
	bufferMax    int
}

// Default is the process-wide Store used by the middleware and Track. The server
// reads Diagnostics from it for the perf report.
var Default = NewStore()

// NewStore returns an empty Store with a maxRecords-entry ring and its uptime
// clock started.
func NewStore() *Store {
	return &Store{
		records:   make([]timingRecord, 0, maxRecords),
		counters:  map[string]int{},
		startTime: time.Now(),
		bufferMax: maxRecords,
	}
}

// record appends a timing record to the ring, overwriting the oldest entry once
// the buffer is full, and bumps the matching counter. The caller must not hold
// the lock; record acquires it.
func (s *Store) record(rec timingRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.records) < s.bufferMax {
		s.records = append(s.records, rec)
	} else {
		s.records[s.next] = rec
		s.next = (s.next + 1) % s.bufferMax
		s.full = true
	}
	if rec.category == CategoryRequest {
		s.requestCount++
	} else {
		s.serviceCount++
	}
}

// Record stores a service-call timing for the given category and operation.
// Use Track to time a function body; Record is for callers that already have a
// measured duration.
func (s *Store) Record(category, operation string, durationMs float64) {
	s.record(timingRecord{category: category, operation: operation, durationMs: durationMs})
}

// recordRequest stores a request timing with its HTTP status. It is used by the
// middleware; status is copied so the caller may reuse its variable.
func (s *Store) recordRequest(operation string, durationMs float64, status int) {
	st := status
	s.record(timingRecord{
		category:   CategoryRequest,
		operation:  operation,
		durationMs: durationMs,
		status:     &st,
	})
}

// Track times the body of a function and records the elapsed duration under the
// given category and operation. It is deferred-safe: call it as
//
//	defer perf.Default.Track(perf.CategoryGit, "get_history")()
//
// The returned closure must be invoked (typically immediately via defer) to
// finalize the measurement. Because the closure runs during stack unwinding, the
// timing is recorded even if the tracked function panics — the panic continues
// to propagate afterward.
func (s *Store) Track(category, operation string) func() {
	start := time.Now()
	return func() {
		durationMs := float64(time.Since(start).Microseconds()) / 1000
		s.Record(category, operation, durationMs)
		logDuration(category, operation, durationMs)
	}
}

// logDuration emits a perf log line gated by duration: WARN above 1000ms, INFO
// above 200ms, DEBUG otherwise.
func logDuration(category, operation string, durationMs float64) {
	switch {
	case durationMs > 1000:
		slog.Warn("perf slow service call",
			slog.String("category", category),
			slog.String("operation", operation),
			slog.Float64("duration_ms", durationMs))
	case durationMs > 200:
		slog.Info("perf service call",
			slog.String("category", category),
			slog.String("operation", operation),
			slog.Float64("duration_ms", durationMs))
	default:
		slog.Debug("perf service call",
			slog.String("category", category),
			slog.String("operation", operation),
			slog.Float64("duration_ms", durationMs))
	}
}

// Count increments the named counter by one. Counters are free-form named
// tallies (cache hits and misses, for instance) surfaced verbatim as
// Diagnostics.Counters; use a stable snake_case name as the contract. It is
// safe for concurrent use.
func (s *Store) Count(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.counters == nil {
		s.counters = map[string]int{}
	}
	s.counters[name]++
}

// Clear drops all timing records, zeroes the request and service counters, and
// empties the named counters. The uptime clock is preserved: Diagnostics.Meta.UptimeS
// keeps counting from process start across a Clear.
func (s *Store) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records = s.records[:0]
	s.next = 0
	s.full = false
	s.requestCount = 0
	s.serviceCount = 0
	s.counters = map[string]int{}
}

// snapshot returns a copy of the live records in insertion order along with the
// current counters and buffer fill. The caller works on the copy so aggregation
// runs without holding the lock.
func (s *Store) snapshot() (recs []timingRecord, requests, services, bufSize int, counters map[string]int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.full {
		recs = make([]timingRecord, 0, s.bufferMax)
		recs = append(recs, s.records[s.next:]...)
		recs = append(recs, s.records[:s.next]...)
	} else {
		recs = make([]timingRecord, len(s.records))
		copy(recs, s.records)
	}
	counters = make(map[string]int, len(s.counters))
	for name, n := range s.counters {
		counters[name] = n
	}
	return recs, s.requestCount, s.serviceCount, len(recs), counters
}

// operationBucket accumulates one operation's durations together with the
// category of the first record seen for it, so a bucket can report its
// category (git or fs) without changing the by-operation map key.
type operationBucket struct {
	category string
	durs     []float64
}

// byOperation groups durations by operation and computes percentiles for each.
// When onlyRequest is true, only request-category records are included and their
// buckets carry p99; otherwise only non-request records are included and p99 is
// omitted. Results are keyed by operation name; the map iterates unordered but
// JSON marshaling sorts keys. Each bucket carries the category of the timing
// records that fed it.
func byOperation(recs []timingRecord, onlyRequest bool) map[string]OperationStats {
	buckets := make(map[string]*operationBucket)
	for _, r := range recs {
		isRequest := r.category == CategoryRequest
		if isRequest != onlyRequest {
			continue
		}
		b := buckets[r.operation]
		if b == nil {
			b = &operationBucket{category: r.category}
			buckets[r.operation] = b
		}
		b.durs = append(b.durs, r.durationMs)
	}
	out := make(map[string]OperationStats, len(buckets))
	for op, b := range buckets {
		stats := computePercentiles(b.durs, onlyRequest)
		stats.Category = b.category
		out[op] = stats
	}
	return out
}

// slowThresholdMs is the minimum request duration included in slow_requests.
const slowThresholdMs = 200

// slowRequestLimit caps how many slow requests are reported.
const slowRequestLimit = 20

// slowRequests returns the slowest request-category records at or above
// slowThresholdMs, sorted descending by duration and capped at slowRequestLimit.
func slowRequests(recs []timingRecord) []SlowRequest {
	var slow []SlowRequest
	for _, r := range recs {
		if r.category != CategoryRequest || r.durationMs < slowThresholdMs {
			continue
		}
		slow = append(slow, SlowRequest{
			Operation:  r.operation,
			DurationMs: round1(r.durationMs),
			Status:     r.status,
		})
	}
	sort.SliceStable(slow, func(i, j int) bool {
		return slow[i].DurationMs > slow[j].DurationMs
	})
	if len(slow) > slowRequestLimit {
		slow = slow[:slowRequestLimit]
	}
	return slow
}

// slowServices returns the slowest non-request (git/fs) records at or above
// slowThresholdMs, sorted descending by duration and capped at slowRequestLimit.
// It mirrors slowRequests for the service categories.
func slowServices(recs []timingRecord) []SlowOperation {
	var slow []SlowOperation
	for _, r := range recs {
		if r.category == CategoryRequest || r.durationMs < slowThresholdMs {
			continue
		}
		slow = append(slow, SlowOperation{
			Operation:  r.operation,
			DurationMs: round1(r.durationMs),
		})
	}
	sort.SliceStable(slow, func(i, j int) bool {
		return slow[i].DurationMs > slow[j].DurationMs
	})
	if len(slow) > slowRequestLimit {
		slow = slow[:slowRequestLimit]
	}
	return slow
}

// Diagnostics builds the full perf report from the current ring contents. It
// snapshots the buffer under the lock and computes everything on the copy, so
// concurrent recording is never blocked by report generation. RepoShape and
// Watchers are left nil for the server to populate.
func (s *Store) Diagnostics() Diagnostics {
	t0 := time.Now()
	recs, requests, services, bufSize, counters := s.snapshot()

	byEndpoint := byOperation(recs, true)
	byService := byOperation(recs, false)
	slow := slowRequests(recs)
	slowSvc := slowServices(recs)

	buildMs := float64(time.Since(t0).Microseconds()) / 1000

	slog.Debug("perf diagnostics built",
		slog.Int("buffer", bufSize),
		slog.Int("requests", requests),
		slog.Int("services", services),
		slog.Int("endpoints", len(byEndpoint)),
		slog.Int("operations", len(byService)),
		slog.Int("slow", len(slow)),
		slog.Int("slow_services", len(slowSvc)),
		slog.Float64("build_ms", buildMs))

	if len(counters) == 0 {
		counters = nil
	}

	return Diagnostics{
		Requests: RequestsSection{
			Total:      requests,
			ByEndpoint: byEndpoint,
		},
		Services: ServicesSection{
			Total:       services,
			ByOperation: byService,
		},
		SlowRequests: slow,
		SlowServices: slowSvc,
		Counters:     counters,
		Meta: Meta{
			CollectedAt: t0.UTC().Format(time.RFC3339Nano),
			UptimeS:     round1(time.Since(s.startTime).Seconds()),
			BufferSize:  bufSize,
			BufferMax:   s.bufferMax,
			BuildMs:     round1(buildMs),
		},
	}
}
