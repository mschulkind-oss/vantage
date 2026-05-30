package perf

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestTrackRecordsOnPanic verifies the deferred Track closure finalizes the
// timing even when the tracked body panics, and that the panic still propagates.
func TestTrackRecordsOnPanic(t *testing.T) {
	s := NewStore()

	panicked := false
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		defer s.Track(CategoryGit, "exploding_op")()
		panic("boom")
	}()

	require.True(t, panicked, "panic must propagate past the deferred Track")

	diag := s.Diagnostics()
	require.Equal(t, 1, diag.Services.Total)
	require.Contains(t, diag.Services.ByOperation, "exploding_op")
	require.Equal(t, 1, diag.Services.ByOperation["exploding_op"].Count)
}

// TestByOperationExcludesRequest confirms request-category records feed
// requests.by_endpoint and are absent from services.by_operation, while git/fs
// records do the reverse.
func TestByOperationExcludesRequest(t *testing.T) {
	s := NewStore()
	s.recordRequest("GET /api/tree", 12.0, 200)
	s.recordRequest("GET /api/tree", 8.0, 200)
	s.Record(CategoryGit, "git_log", 5.0)
	s.Record(CategoryFS, "list_directory", 3.0)

	diag := s.Diagnostics()

	require.Equal(t, 2, diag.Requests.Total)
	require.Equal(t, 2, diag.Services.Total)

	require.Contains(t, diag.Requests.ByEndpoint, "GET /api/tree")
	require.NotContains(t, diag.Services.ByOperation, "GET /api/tree")

	require.Contains(t, diag.Services.ByOperation, "git_log")
	require.Contains(t, diag.Services.ByOperation, "list_directory")
	require.NotContains(t, diag.Requests.ByEndpoint, "git_log")
}

// TestServiceBucketOmitsP99 verifies request buckets carry p99 while service
// buckets omit it (P99 stays at the zero value and is dropped by omitempty).
func TestServiceBucketCarriesNoP99(t *testing.T) {
	s := NewStore()
	s.recordRequest("GET /api/x", 10.0, 200)
	s.Record(CategoryGit, "git_log", 10.0)

	diag := s.Diagnostics()
	require.NotZero(t, diag.Requests.ByEndpoint["GET /api/x"].P99)
	require.Zero(t, diag.Services.ByOperation["git_log"].P99)
}

// TestClearPreservesUptime confirms Clear zeroes the counters and empties the
// buffer but leaves the uptime clock (and thus Meta.UptimeS) running.
func TestClearPreservesUptime(t *testing.T) {
	s := NewStore()
	s.recordRequest("GET /api/x", 10.0, 200)
	s.Record(CategoryGit, "git_log", 5.0)

	before := s.Diagnostics().Meta.UptimeS
	startTime := s.startTime

	s.Clear()

	after := s.Diagnostics()
	require.Equal(t, 0, after.Requests.Total)
	require.Equal(t, 0, after.Services.Total)
	require.Equal(t, 0, after.Meta.BufferSize)
	require.Empty(t, after.Requests.ByEndpoint)
	require.Empty(t, after.Services.ByOperation)

	require.Equal(t, startTime, s.startTime, "Clear must not reset the uptime clock")
	require.GreaterOrEqual(t, after.Meta.UptimeS, before, "uptime keeps counting across Clear")
}

// TestRingBufferWrap checks that exceeding capacity overwrites the oldest
// records while the request counter keeps the lifetime total.
func TestRingBufferWrap(t *testing.T) {
	s := NewStore()
	for i := 0; i < maxRecords+50; i++ {
		s.recordRequest("GET /api/x", 1.0, 200)
	}
	diag := s.Diagnostics()
	require.Equal(t, maxRecords, diag.Meta.BufferSize, "buffer is capped at maxRecords")
	require.Equal(t, maxRecords+50, diag.Requests.Total, "counter is a lifetime total")
}

// TestSlowRequestsThresholdAndSort verifies slow_requests filters by threshold,
// sorts descending by duration, and carries the captured status.
func TestSlowRequestsThresholdAndSort(t *testing.T) {
	s := NewStore()
	s.recordRequest("GET /api/fast", 10.0, 200) // below threshold
	s.recordRequest("GET /api/slow", 250.0, 200)
	s.recordRequest("GET /api/slower", 900.0, 503)

	diag := s.Diagnostics()
	require.Len(t, diag.SlowRequests, 2)
	require.Equal(t, "GET /api/slower", diag.SlowRequests[0].Operation)
	require.Equal(t, "GET /api/slow", diag.SlowRequests[1].Operation)
	require.NotNil(t, diag.SlowRequests[0].Status)
	require.Equal(t, 503, *diag.SlowRequests[0].Status)
}

// TestPercentileMath pins the truncated-index nearest-rank computation including
// rounding to one decimal place. With durations 1..10, n=10:
// p50 -> index int(10*0.50)=5 -> value 6; p95 -> min(int(10*0.95),9)=9 -> 10;
// p99 -> min(int(10*0.99),9)=9 -> 10; max -> 10; avg -> 5.5.
func TestPercentileMath(t *testing.T) {
	durs := []float64{10, 9, 8, 7, 6, 5, 4, 3, 2, 1}
	stats := computePercentiles(durs, true)
	require.Equal(t, 10, stats.Count)
	require.Equal(t, 6.0, stats.P50)
	require.Equal(t, 10.0, stats.P95)
	require.Equal(t, 10.0, stats.P99)
	require.Equal(t, 10.0, stats.Max)
	require.Equal(t, 5.5, stats.Avg)
}

// TestPercentileRounding checks half-up rounding to one decimal place.
func TestPercentileRounding(t *testing.T) {
	require.Equal(t, 1.3, round1(1.25))
	require.Equal(t, 1.2, round1(1.24))
	require.Equal(t, 2.5, round1(2.45))
	require.Equal(t, 0.0, round1(0.0))
}

// TestEmptyPercentiles confirms an empty bucket yields the zero summary.
func TestEmptyPercentiles(t *testing.T) {
	require.Equal(t, OperationStats{}, computePercentiles(nil, true))
}
