package api

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/perf"
	"github.com/mschulkind-oss/vantage/internal/planning"
	"github.com/mschulkind-oss/vantage/internal/repoconfig"
)

// planningEnv is a testEnv whose requests carry the repository's config, which
// the planning endpoints read and every older route ignores.
type planningEnv struct {
	*testEnv
	cfg *repoconfig.Config
}

func newPlanningEnv(t *testing.T, files map[string]string) *planningEnv {
	t.Helper()
	e := newTestEnv(t, false)
	for rel, content := range files {
		writeFile(t, e.dir, rel, content)
	}
	return &planningEnv{testEnv: e, cfg: repoconfig.New(e.dir)}
}

func (e *planningEnv) withServices(r *http.Request) *http.Request {
	return r.WithContext(WithRepoServices(r.Context(),
		RepoServices{Repo: e.repo, Git: e.git, FS: e.fs, Config: e.cfg}))
}

func (e *planningEnv) get(target string) *httptest.ResponseRecorder {
	r := e.withServices(httptest.NewRequest(http.MethodGet, target, nil))
	w := httptest.NewRecorder()
	e.h.PlanningSources(w, r)
	return w
}

// stream POSTs body to the stream endpoint; "" sends no body at all. Each pair
// of headers is a name and its value.
func (e *planningEnv) stream(body string, headers ...string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	e.h.PlanningStream(w, e.streamRequest(body, headers...))
	return w
}

func (e *planningEnv) streamRequest(body string, headers ...string) *http.Request {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	r := e.withServices(httptest.NewRequest(http.MethodPost, "/planning/stream", reader))
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Set(headers[i], headers[i+1])
	}
	return r
}

// streamLine is one line of the stream, every kind's fields together.
type streamLine struct {
	Kind           string              `json:"kind"`
	Config         repoconfig.Planning `json:"config"`
	CandidateCount int                 `json:"candidate_count"`
	Refused        bool                `json:"refused"`
	Path           string              `json:"path"`
	Hash           string              `json:"hash"`
	Content        string              `json:"content"`
	Size           int64               `json:"size"`
	Reason         string              `json:"reason"`
	Candidates     int                 `json:"candidates"`
}

// streamBody is the stream's body, ungzipped when it came gzipped.
func streamBody(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	if w.Header().Get("Content-Encoding") != "gzip" {
		return w.Body.String()
	}
	zr, err := gzip.NewReader(bytes.NewReader(w.Body.Bytes()))
	require.NoError(t, err)
	plain, err := io.ReadAll(zr)
	require.NoError(t, err, "a whole gzip stream, footer included")
	return string(plain)
}

// streamLines is the stream's body decoded one line at a time, with the check
// that it opens with a header and closes with end.
func streamLines(t *testing.T, w *httptest.ResponseRecorder) []streamLine {
	t.Helper()
	body := streamBody(t, w)
	require.True(t, strings.HasSuffix(body, "\n"), "every line ends in a newline: %q", body)
	var out []streamLine
	for _, raw := range strings.Split(strings.TrimSuffix(body, "\n"), "\n") {
		var line streamLine
		require.NoError(t, json.Unmarshal([]byte(raw), &line), "line: %q", raw)
		out = append(out, line)
	}
	require.GreaterOrEqual(t, len(out), 2)
	require.Equal(t, "header", out[0].Kind)
	require.Equal(t, "end", out[len(out)-1].Kind)
	return out
}

// sent is "kind path" for every candidate's line of a stream.
func sent(lines []streamLine) []string {
	out := []string{}
	for _, l := range lines[1 : len(lines)-1] {
		out = append(out, l.Kind+" "+l.Path)
	}
	return out
}

// served reads a cold stream's config and the paths it sent the text of.
func (e *planningEnv) served(t *testing.T) (repoconfig.Planning, []string) {
	t.Helper()
	lines := streamLines(t, e.stream(""))
	paths := []string{}
	for _, l := range lines {
		if l.Kind == "file" {
			paths = append(paths, l.Path)
		}
	}
	return lines[0].Config, paths
}

func TestThePlanningRoutesAreRepoScoped(t *testing.T) {
	e := newTestEnv(t, false)
	want := map[string]string{
		"/planning/sources": http.MethodGet,
		"/planning/stream":  http.MethodPost,
		"/planning/reviews": http.MethodPost,
	}
	for _, rt := range e.h.Routes() {
		if method, ok := want[rt.Pattern]; ok {
			require.Equal(t, method, rt.Method, rt.Pattern)
			require.Equal(t, ScopeRepo, rt.Scope, "each repository has its own index: %s", rt.Pattern)
			delete(want, rt.Pattern)
		}
	}
	require.Empty(t, want, "missing from the route table")
}

func TestThePlanningEndpointsWithoutARepoAre400(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.PlanningSources, http.MethodGet, "/planning/sources", "", false)
	require.Equal(t, http.StatusBadRequest, w.Code)
	w = e.do(e.h.PlanningStream, http.MethodPost, "/planning/stream", "{}", false)
	require.Equal(t, http.StatusBadRequest, w.Code)
	w = e.do(e.h.PlanningReviews, http.MethodPost, "/planning/reviews", `{"paths":["a.md"]}`, false)
	require.Equal(t, http.StatusBadRequest, w.Code)
}

// The batch moved to the stream, so its old URL, GET …/planning/sources
// without `path`, answers 410 Gone with a detail that says what to do. Only a
// tab loaded before the move still asks for it, and a reload gives it a viewer
// that reads the stream. Whatever else the query holds, only `path` asks for
// the single-path mode.
func TestTheOldPlanningBatchIsGone(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{"roadmap.md": "# Roadmap\n", "a.md": "# A\n"})
	for _, target := range []string{"/planning/sources", "/planning/sources?", "/planning/sources?paths=a.md"} {
		w := e.get(target)
		require.Equal(t, http.StatusGone, w.Code, target)
		require.Equal(t, "application/json", w.Header().Get("Content-Type"), target)
		require.JSONEq(t, `{"detail":"The planning index moved to a stream; reload the page."}`, w.Body.String(), target)
	}
}

// The stream's shape, byte for byte for an empty repository: a header with the
// effective config, then end. The viewer's reader refuses a first line that is
// not a header, which is what a static host's SPA fallback would answer.
func TestPlanningStreamHasTheContractsShape(t *testing.T) {
	e := newPlanningEnv(t, nil)
	w := e.stream("")
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "application/x-ndjson", w.Header().Get("Content-Type"))
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	require.Empty(t, w.Header().Get("Content-Encoding"), "not asked for gzip, so not gzipped")
	require.Equal(t,
		`{"kind":"header","config":{"roadmap":"roadmap.md","include":["**/*.md"],"exclude":[],`+
			`"max_file_bytes":1048576,"max_candidates":5000,"stages":null},"candidate_count":0,"refused":false}`+"\n"+
			`{"kind":"end","candidates":0}`+"\n",
		w.Body.String())
}

func TestPlanningStreamAppliesTheRepositorysTable(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{
		"roadmap.md":             "# Roadmap\n",
		"docs/design/a.md":       "---\nstage: DESIGN\n---\n",
		"docs/gallery/status.md": "---\nstatus: accepted\n---\n",
		"docs/huge.md":           strings.Repeat("x", 100),
		"docs/latin1.md":         "caf\xe9\n",
		".vantage.toml": "[planning]\nexclude = [\"docs/gallery/**\"]\nmax-file-bytes = 64\n\n" +
			"[planning.stages]\nDESIGN = \"open\"\nDECIDED = \"ready\"\n",
	})

	lines := streamLines(t, e.stream(`{}`))
	header := lines[0]
	require.Equal(t, []string{"docs/gallery/**"}, header.Config.Exclude)
	require.Equal(t, int64(64), header.Config.MaxFileBytes)
	require.Equal(t, map[string]string{"DESIGN": "open", "DECIDED": "ready"}, header.Config.Stages)
	require.Equal(t, 4, header.CandidateCount, "the gallery is excluded")
	require.False(t, header.Refused)
	require.Equal(t, []string{
		"file docs/design/a.md", "skipped docs/huge.md", "unreadable docs/latin1.md", "file roadmap.md",
	}, sent(lines))
	require.Equal(t, int64(100), lines[2].Size)
	require.Equal(t, "not UTF-8", lines[3].Reason)
	require.Equal(t, 4, lines[len(lines)-1].Candidates)
}

func TestPlanningStreamPastTheLimitIsRefused(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{
		"a.md": "# A\n", "b.md": "# B\n",
		".vantage.toml": "[planning]\nmax-candidates = 1\n",
	})
	lines := streamLines(t, e.stream(""))
	require.Len(t, lines, 2, "the header, then end")
	require.True(t, lines[0].Refused)
	require.Equal(t, 2, lines[0].CandidateCount)
	require.Equal(t, 2, lines[1].Candidates)
}

// What the browser holds comes back as `same`, the roadmap excepted. The hash
// is "test"'s, the one the design's example shows.
func TestPlanningStreamAnswersHaveWithSame(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{
		"AGENTS.md": "test", "docs/a.md": "test", "roadmap.md": "test",
	})
	const hash = "9f86d081884c7d659a2feaa0c55ad015"
	lines := streamLines(t, e.stream(`{"have":{"AGENTS.md":"`+hash+`","roadmap.md":"`+hash+`","gone.md":"`+hash+`"}}`))
	require.Equal(t, []string{"same AGENTS.md", "file docs/a.md", "file roadmap.md"}, sent(lines))
	require.Equal(t, hash, lines[1].Hash)
	require.Empty(t, lines[1].Content)
	require.Equal(t, hash, lines[2].Hash)
	require.Equal(t, "test", lines[2].Content)
}

// The request body's answers, each decided before a line is written. No body,
// `{}` and a `have` that is empty or null are all a cold build. Anything that
// is not one object of the shape `{"have": {path: hash}}` is a 400, an unknown
// key included, since a misspelled `have` read as empty would silently turn
// every warm build cold.
func TestPlanningStreamReadsItsBody(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{"a.md": "test"})
	for _, body := range []string{"", "  \n", `{}`, `{"have":{}}`, `{"have":null}`} {
		w := e.stream(body)
		require.Equal(t, http.StatusOK, w.Code, "body %q", body)
		require.Equal(t, []string{"file a.md"}, sent(streamLines(t, w)), "body %q is a cold build", body)
	}
	for _, body := range []string{
		`null`, `[]`, `"have"`, `{`, `{"have":[]}`, `{"have":{"a.md":5}}`, `{"have":{"a.md":{}}}`,
		`{"hav":{"a.md":"9f86d081884c7d659a2feaa0c55ad015"}}`, `{"have":{}} {}`, `{"have":{}}x`,
		// Cut short at each depth: a body that ends early is never a cold build.
		`{"have":`, `{"have":{`, `{"have":{"a.md"`, `{"have":{"a.md":"9f86d081884c7d659a2feaa0c55ad015"}`,
	} {
		w := e.stream(body)
		require.Equal(t, http.StatusBadRequest, w.Code, "body %q", body)
		require.Equal(t, "application/json", w.Header().Get("Content-Type"), "body %q", body)
		require.Contains(t, w.Body.String(), `"detail"`, "body %q", body)
	}
}

// The body cap, its floor lowered to 2 KiB rather than proven with 4 MiB, in a
// repository whose `max-candidates` of 1 asks for less than the floor: a body
// of exactly the cap is read, and one byte more is a 413, however the extra
// byte arrives.
func TestPlanningStreamRefusesABodyPastItsCap(t *testing.T) {
	const floor = 2 << 10
	prev := streamBodyFloor
	streamBodyFloor = floor
	t.Cleanup(func() { streamBodyFloor = prev })
	e := newPlanningEnv(t, map[string]string{"a.md": "test", ".vantage.toml": "[planning]\nmax-candidates = 1\n"})

	have := `{"have":{"a.md":"9f86d081884c7d659a2feaa0c55ad015"}}`
	atCap := have + strings.Repeat(" ", floor-len(have))
	require.Len(t, atCap, floor)
	require.Equal(t, []string{"same a.md"}, sent(streamLines(t, e.stream(atCap))))

	for _, body := range []string{
		atCap + " ",
		`{"have":{"` + strings.Repeat("x", floor) + `.md":"h"}}`,
		strings.Repeat(" ", floor+1),
	} {
		w := e.stream(body)
		require.Equal(t, http.StatusRequestEntityTooLarge, w.Code, "a %d-byte body", len(body))
		require.JSONEq(t, `{"detail":"The planning stream's request is larger than 2048 bytes"}`, w.Body.String())
	}
}

// The cap grows with `max-candidates`, 1 KiB a candidate, so a warm build the
// limit allows is never a 413. With a fixed cap, a repository whose `have` had
// outgrown it was answered 413 on every warm load, and Retry, which sends no
// `have`, only refilled the cache for the next load to fail again. Here the
// floor is 1 KiB and 20 candidates' `have` is larger than that.
func TestPlanningStreamsCapGrowsWithMaxCandidates(t *testing.T) {
	prev := streamBodyFloor
	streamBodyFloor = 1 << 10
	t.Cleanup(func() { streamBodyFloor = prev })
	files := map[string]string{".vantage.toml": "[planning]\nmax-candidates = 20\n"}
	have := map[string]string{}
	for i := range 20 {
		path := fmt.Sprintf("docs/design/document-%02d.md", i)
		files[path] = "test"
		have[path] = "9f86d081884c7d659a2feaa0c55ad015"
	}
	e := newPlanningEnv(t, files)
	raw, err := json.Marshal(map[string]any{"have": have})
	require.NoError(t, err)
	require.Greater(t, len(raw), 1<<10, "past the floor")

	lines := streamLines(t, e.stream(string(raw)))
	require.Len(t, lines, 22)
	for _, line := range lines[1:21] {
		require.Equal(t, "same", line.Kind, line.Path)
	}

	const limit = 20 << 10
	atCap := string(raw) + strings.Repeat(" ", limit-len(raw))
	require.Equal(t, http.StatusOK, e.stream(atCap).Code)
	w := e.stream(atCap + " ")
	require.Equal(t, http.StatusRequestEntityTooLarge, w.Code)
	require.Contains(t, w.Body.String(), "larger than 20480 bytes")
}

func TestBodyLimitIsAKiBPerCandidateAboveItsFloor(t *testing.T) {
	require.Equal(t, int64(4<<20), bodyLimit(4<<20, 1))
	require.Equal(t, int64(4<<20), bodyLimit(4<<20, 4096), "at the floor exactly")
	require.Equal(t, int64(5000<<10), bodyLimit(4<<20, repoconfig.DefaultMaxCandidates),
		"the default max-candidates asks for a little more than 4 MiB")
	require.Equal(t, int64(100000<<10), bodyLimit(4<<20, 100000))
	require.Equal(t, int64(1<<20), bodyLimit(1<<20, 1))
	if strconv.IntSize == 64 {
		require.Equal(t, int64(math.MaxInt64), bodyLimit(1<<20, math.MaxInt), "it saturates rather than overflow")
	}
}

// The stream's `have` is kept to what the stream can use as the body is read:
// an entry for a path that is no candidate, for the roadmap, or with a value
// no content hash could equal is dropped, so a body of short distinct keys
// holds nothing in the heap. Decoded whole, such a body held about 4.4 times
// its size, 18.6 MB for a body just under 4 MiB (design §6.4).
func TestTheStreamKeepsOnlyTheHaveItCanUse(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{"roadmap.md": "# Roadmap\n", "a.md": "test", "b.md": "test"})
	const hash = "9f86d081884c7d659a2feaa0c55ad015"
	var body strings.Builder
	body.WriteString(`{"have":{"a.md":"` + hash + `","roadmap.md":"` + hash + `","b.md":"not a hash"`)
	for i := range 2000 {
		fmt.Fprintf(&body, `,"x%04d.md":"%s"`, i, hash)
	}
	body.WriteString(`}}`)

	r := e.streamRequest(body.String())
	stream := planning.NewStream(e.fs, repoconfig.DefaultPlanning())
	have, err := readHave(httptest.NewRecorder(), r, 1<<20, stream.Wants)
	require.NoError(t, err)
	require.Equal(t, map[string]string{"a.md": hash}, have)

	require.Equal(t, []string{"same a.md", "file b.md", "file roadmap.md"}, sent(streamLines(t, e.stream(body.String()))))
}

// Gzipped when the request accepts it, at no cost to the lines: the same body,
// byte for byte, once decompressed.
func TestPlanningStreamIsGzippedWhenAccepted(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{
		"roadmap.md": "# Roadmap\n", "docs/a.md": strings.Repeat("---\nstatus: draft\n---\n", 20),
	})
	plain := e.stream("")
	zipped := e.stream("", "Accept-Encoding", "gzip, deflate, br, zstd")
	require.Equal(t, "gzip", zipped.Header().Get("Content-Encoding"))
	require.Contains(t, zipped.Header().Values("Vary"), "Accept-Encoding")
	require.Equal(t, "application/x-ndjson", zipped.Header().Get("Content-Type"))
	require.Less(t, zipped.Body.Len(), plain.Body.Len(), "it compressed")
	require.Equal(t, plain.Body.String(), streamBody(t, zipped))
}

func TestAcceptsGzipReadsTheHeadersQualities(t *testing.T) {
	for value, want := range map[string]bool{
		"":                       false,
		"identity":               false,
		"gzip":                   true,
		"GZIP":                   true,
		"deflate, gzip;q=0.5":    true,
		"gzip;q=0":               false,
		"gzip; q=0.000, br":      false,
		"br;q=1.0, gzip ; q=0.1": true,
		"x-gzip":                 false,
	} {
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		if value != "" {
			r.Header.Set("Accept-Encoding", value)
		}
		require.Equal(t, want, acceptsGzip(r), "Accept-Encoding: %q", value)
	}
}

// flushRecorder is a response that keeps a copy of its body at each flush, so a
// test can see what the client had been sent at that moment.
type flushRecorder struct {
	*httptest.ResponseRecorder
	flushed [][]byte
	onFlush func() // called after each flush, when set
}

func (f *flushRecorder) Flush() {
	f.flushed = append(f.flushed, bytes.Clone(f.Body.Bytes()))
	f.ResponseRecorder.Flush()
	if f.onFlush != nil {
		f.onFlush()
	}
}

// The header line reaches the client by the first flush, compressed or not,
// through the perf middleware's wrapper as in production. The compressor has to
// be flushed before the connection, or the line sits in it: this is the test
// that says so.
func TestPlanningStreamFlushesTheHeaderThroughTheCompressor(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{"a.md": "test", "b.md": "# B\n"})
	handler := perf.Middleware(perf.NewStore())(http.HandlerFunc(e.h.PlanningStream))
	const header = `{"kind":"header","config":{"roadmap":"roadmap.md","include":["**/*.md"],"exclude":[],` +
		`"max_file_bytes":1048576,"max_candidates":5000,"stages":null},"candidate_count":2,"refused":false}` + "\n"

	for _, encoding := range []string{"", "gzip"} {
		w := &flushRecorder{ResponseRecorder: httptest.NewRecorder()}
		r := e.streamRequest("", "Accept-Encoding", encoding)
		r.URL.Path = "/api/planning/stream"
		handler.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code)
		require.NotEmpty(t, w.flushed, "flushed at all (%q)", encoding)

		first := w.flushed[0]
		if encoding == "gzip" {
			// A flushed gzip stream decodes up to its last flush and then ends
			// early, since the footer comes only with Close.
			zr, err := gzip.NewReader(bytes.NewReader(first))
			require.NoError(t, err)
			got, err := io.ReadAll(zr)
			require.ErrorIs(t, err, io.ErrUnexpectedEOF)
			first = got
		}
		require.Equal(t, header, string(first), "the first flush carries the header line and nothing after it (%q)", encoding)
	}
}

// A client that goes away ends the request's context, and the stream reads
// nothing more for it. Through the compressor no write would fail: the lines
// sat in it until the next 64 KiB flush, so a repository of fewer than about
// 870 candidates had its whole corpus read and hashed for nobody. Here the
// context ends once the header has been flushed, and the body is that header
// alone, with no `end` and, gzipped, no footer either.
func TestPlanningStreamStopsReadingWhenTheRequestEnds(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{"a.md": "test", "b.md": "# B\n", "c.md": "# C\n"})
	handler := perf.Middleware(perf.NewStore())(http.HandlerFunc(e.h.PlanningStream))

	for _, encoding := range []string{"", "gzip"} {
		r := e.streamRequest("", "Accept-Encoding", encoding)
		ctx, cancel := context.WithCancel(r.Context())
		r = r.WithContext(ctx)
		r.URL.Path = "/api/planning/stream"
		w := &flushRecorder{ResponseRecorder: httptest.NewRecorder(), onFlush: cancel}
		handler.ServeHTTP(w, r)
		cancel()

		body := w.Body.Bytes()
		if encoding == "gzip" {
			zr, err := gzip.NewReader(bytes.NewReader(body))
			require.NoError(t, err)
			got, err := io.ReadAll(zr)
			require.ErrorIs(t, err, io.ErrUnexpectedEOF, "never closed, so no footer")
			body = got
		}
		lines := strings.SplitAfter(string(body), "\n")
		require.Len(t, lines, 2, "the header and nothing after it (%q): %q", encoding, body)
		require.True(t, strings.HasPrefix(lines[0], `{"kind":"header",`), lines[0])
	}
}

// A table the server refuses is logged, and the index is served with the
// defaults rather than not at all: the exclusions are lost, not the index.
func TestABadPlanningTableServesTheDefaultsAndSaysSo(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{
		"docs/gallery/status.md": "---\nstatus: accepted\n---\n",
		".vantage.toml":          "[planning]\nexclude = [\"docs/gallery/**\"]\nroadmaps = \"x.md\"\n",
	})
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelWarn})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	config, paths := e.served(t)
	require.Equal(t, repoconfig.DefaultPlanning(), config)
	require.Equal(t, []string{"docs/gallery/status.md"}, paths)
	require.Contains(t, logs.String(), "planning.roadmaps")
	require.Contains(t, logs.String(), filepath.Join(e.dir, ".vantage.toml"))
}

// The rescan a `.vantage.toml` push causes lands inside the config's reload
// throttle. The endpoint must see the edit anyway, or the rescan is served the
// table from before it and nothing asks again.
func TestThePlanningEndpointSeesAConfigEditAtOnce(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{
		"a.md": "# A\n", "docs/b.md": "# B\n",
		".vantage.toml": "[planning]\nexclude = []\n",
	})
	_, paths := e.served(t)
	require.Equal(t, []string{"a.md", "docs/b.md"}, paths)

	writeFile(t, e.dir, ".vantage.toml", "[planning]\nexclude = [\"docs/**\"]\n")
	_, paths = e.served(t)
	require.Equal(t, []string{"a.md"}, paths)
}

// Without a config to read, a repository is served the defaults.
func TestPlanningStreamWithNoConfigServesTheDefaults(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{"a.md": "# A\n"})
	e.cfg = nil
	config, paths := e.served(t)
	require.Equal(t, repoconfig.DefaultPlanning(), config)
	require.Equal(t, []string{"a.md"}, paths)
}

// A file's answer carries its content hash, the first 128 bits of SHA-256 in
// hex (here of "---\nstatus: draft\n---\n"), so the result the viewer scans
// from it is kept under the key the next stream will name.
func TestPlanningSinglePathAnswersEachKind(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{
		"docs/x.md":                        "---\nstatus: draft\n---\n",
		"docs/huge.md":                     strings.Repeat("x", 100),
		"docs/bad.md":                      "caf\xe9\n",
		".github/pull_request_template.md": "---\nstatus: draft\n---\n",
		".vantage.toml":                    "[planning]\nmax-file-bytes = 64\n",
	})
	for target, want := range map[string]string{
		"/planning/sources?path=docs/x.md":                        `{"path":"docs/x.md","kind":"file","hash":"b55fe4e52335215e853f63ea6a91c8da","content":"---\nstatus: draft\n---\n"}`,
		"/planning/sources?path=docs/huge.md":                     `{"path":"docs/huge.md","kind":"skipped","size":100}`,
		"/planning/sources?path=docs/bad.md":                      `{"path":"docs/bad.md","kind":"unreadable","reason":"not UTF-8"}`,
		"/planning/sources?path=.github/pull_request_template.md": `{"path":".github/pull_request_template.md","kind":"absent"}`,
		"/planning/sources?path=docs/missing.md":                  `{"path":"docs/missing.md","kind":"absent"}`,
		"/planning/sources?path=..%2Fetc%2Fpasswd.md":             `{"path":"../etc/passwd.md","kind":"absent"}`,
	} {
		w := e.get(target)
		require.Equal(t, http.StatusOK, w.Code, target)
		require.JSONEq(t, want, w.Body.String(), target)
	}
}

// The single-path answer and the stream name one file by one hash, so a
// result kept from either is found by the other.
func TestTheSinglePathAndTheStreamAgreeOnAHash(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{"docs/x.md": "---\nstatus: draft\n---\n"})
	var entry struct {
		Hash string `json:"hash"`
	}
	decode(t, e.get("/planning/sources?path=docs/x.md"), &entry)
	lines := streamLines(t, e.stream(""))
	require.Equal(t, entry.Hash, lines[1].Hash)
	require.Equal(t, []string{"same docs/x.md"}, sent(streamLines(t, e.stream(`{"have":{"docs/x.md":"`+entry.Hash+`"}}`))))
}

func TestPlanningSinglePathRequiresAPath(t *testing.T) {
	e := newPlanningEnv(t, nil)
	w := e.get("/planning/sources?path=")
	require.Equal(t, http.StatusBadRequest, w.Code)
	require.Contains(t, w.Body.String(), "detail")
}

// A file that exists and cannot be read is `unreadable`, never `absent`: the
// planning page lists the one and cannot see the other.
func TestPlanningSinglePathReportsALockedFileUnreadable(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{"locked.md": "# Locked\n"})
	full := filepath.Join(e.dir, "locked.md")
	require.NoError(t, os.Chmod(full, 0o000))
	t.Cleanup(func() { _ = os.Chmod(full, 0o644) })
	if _, err := os.ReadFile(full); err == nil {
		t.Skip("file modes are not enforced for this user")
	}

	w := e.get("/planning/sources?path=locked.md")
	require.JSONEq(t, `{"path":"locked.md","kind":"unreadable","reason":"permission denied"}`, w.Body.String())
}

// --- reviews in one request --------------------------------------------------

func (e *planningEnv) reviews(body string) *httptest.ResponseRecorder {
	r := e.withServices(httptest.NewRequest(http.MethodPost, "/planning/reviews", strings.NewReader(body)))
	w := httptest.NewRecorder()
	e.h.PlanningReviews(w, r)
	return w
}

// saveReview stores a review of path holding one comment, id.
func (e *planningEnv) saveReview(t *testing.T, path, id string) {
	t.Helper()
	rd := model.NewReviewData(path)
	c := model.NewReviewComment(id, "comment on "+path, 1717000000)
	c.Anchor = &model.CommentAnchor{SourceLine: 3, BlockTextHash: "d58b3fa7"}
	rd.Comments = append(rd.Comments, c)
	require.NoError(t, e.h.deps.Reviews.Save(path, e.repo, rd))
}

// reviewsAnswer is the reviews body, each review kept raw so it can be held to
// GET /review's own bytes.
type reviewsAnswer struct {
	Reviews []struct {
		Path   string          `json:"path"`
		Review json.RawMessage `json:"review"`
	} `json:"reviews"`
}

func (a reviewsAnswer) paths() []string {
	out := []string{}
	for _, r := range a.Reviews {
		out = append(out, r.Path)
	}
	return out
}

// One entry for each distinct path with a stored review, in the order the
// request named them, and each review exactly what GET /review answers. A path
// with no review, the empty path GET /review would refuse, and a repeat are all
// left out.
func TestPlanningReviewsKeepsTheRequestsOrder(t *testing.T) {
	e := newPlanningEnv(t, nil)
	e.saveReview(t, "c.md", "c1")
	e.saveReview(t, "a.md", "a1")
	e.saveReview(t, "docs/b.md", "b1")

	w := e.reviews(`{"paths":["docs/b.md","none.md","a.md","","c.md","a.md"]}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.Equal(t, "application/json", w.Header().Get("Content-Type"))
	var got reviewsAnswer
	decode(t, w, &got)
	require.Equal(t, []string{"docs/b.md", "a.md", "c.md"}, got.paths())
	for _, r := range got.Reviews {
		one := e.do(e.h.ReviewGet, http.MethodGet, "/review?path="+r.Path, "", true)
		require.Equal(t, http.StatusOK, one.Code)
		require.JSONEq(t, one.Body.String(), string(r.Review), r.Path)
	}
}

// With nothing stored, or nothing asked, the list is [] and never null.
func TestPlanningReviewsWithNoneIsAnEmptyList(t *testing.T) {
	e := newPlanningEnv(t, nil)
	for _, body := range []string{`{"paths":["a.md"]}`, `{"paths":[]}`, `{}`, `{"paths":null}`} {
		w := e.reviews(body)
		require.Equal(t, http.StatusOK, w.Code, body)
		require.JSONEq(t, `{"reviews":[]}`, w.Body.String(), body)
	}
}

// A review the store cannot read is left out with a warning, and the rest are
// still answered: one bad file does not cost the page every comment.
func TestPlanningReviewsLeavesOutAReviewItCannotRead(t *testing.T) {
	e := newPlanningEnv(t, nil)
	e.saveReview(t, "a.md", "a1")
	// A directory where the review file would be reads as an I/O error, not
	// as absent, whoever runs the test.
	require.NoError(t, os.Mkdir(filepath.Join(e.h.deps.Reviews.Dir(), "broken.md.json"), 0o755))
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelWarn})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	w := e.reviews(`{"paths":["broken.md","a.md"]}`)
	require.Equal(t, http.StatusOK, w.Code)
	var got reviewsAnswer
	decode(t, w, &got)
	require.Equal(t, []string{"a.md"}, got.paths())
	require.Contains(t, logs.String(), "broken.md")
}

// At most max-candidates paths, configured down here to 2: the page never lists
// more documents than the index has candidates.
func TestPlanningReviewsCapsItsPaths(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{".vantage.toml": "[planning]\nmax-candidates = 2\n"})
	e.saveReview(t, "a.md", "a1")
	w := e.reviews(`{"paths":["a.md","b.md"]}`)
	require.Equal(t, http.StatusOK, w.Code)

	w = e.reviews(`{"paths":["a.md","b.md","c.md"]}`)
	require.Equal(t, http.StatusRequestEntityTooLarge, w.Code)
	require.Contains(t, w.Body.String(), `"detail"`)
	require.Contains(t, w.Body.String(), "2 paths")
}

// The body cap, its floor lowered to 2 KiB rather than proven with 1 MiB, in a
// repository whose `max-candidates` of 1 asks for less than the floor.
func TestPlanningReviewsCapsItsBody(t *testing.T) {
	const floor = 2 << 10
	prev := reviewsBodyFloor
	reviewsBodyFloor = floor
	t.Cleanup(func() { reviewsBodyFloor = prev })
	e := newPlanningEnv(t, map[string]string{".vantage.toml": "[planning]\nmax-candidates = 1\n"})
	e.saveReview(t, "a.md", "a1")

	body := `{"paths":["a.md"]}`
	atCap := body + strings.Repeat(" ", floor-len(body))
	w := e.reviews(atCap)
	require.Equal(t, http.StatusOK, w.Code)
	w = e.reviews(atCap + " ")
	require.Equal(t, http.StatusRequestEntityTooLarge, w.Code)
	require.JSONEq(t, `{"detail":"The reviews request is larger than 2048 bytes"}`, w.Body.String())
}

// The cap grows with `max-candidates`, 1 KiB a path, so the page's request for
// as many documents as the limit allows is never refused for its size. Here
// the floor is 128 bytes, and three paths are past it.
func TestPlanningReviewsCapGrowsWithMaxCandidates(t *testing.T) {
	prev := reviewsBodyFloor
	reviewsBodyFloor = 128
	t.Cleanup(func() { reviewsBodyFloor = prev })
	e := newPlanningEnv(t, map[string]string{".vantage.toml": "[planning]\nmax-candidates = 3\n"})
	long := "docs/design/" + strings.Repeat("a-rather-long-name-", 3)
	e.saveReview(t, long+"1.md", "a1")

	body := `{"paths":["` + long + `1.md","` + long + `2.md","` + long + `3.md"]}`
	require.Greater(t, len(body), 128)
	w := e.reviews(body)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var got reviewsAnswer
	decode(t, w, &got)
	require.Equal(t, []string{long + "1.md"}, got.paths())

	w = e.reviews(body + strings.Repeat(" ", 3<<10-len(body)+1))
	require.Equal(t, http.StatusRequestEntityTooLarge, w.Code)
	require.Contains(t, w.Body.String(), "larger than 3072 bytes")
}

// The path past `max-candidates` is refused as it is read, before the rest of
// the body is: what the request holds is at most that many paths, never the
// whole body decoded. So a body that would be malformed further on is a 413.
func TestPlanningReviewsStopsReadingAtThePathPastItsLimit(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{".vantage.toml": "[planning]\nmax-candidates = 2\n"})
	w := e.reviews(`{"paths":["a.md","b.md","c.md",` + strings.Repeat("1,", 100) + "{")
	require.Equal(t, http.StatusRequestEntityTooLarge, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), "2 paths")

	w = e.reviews(`{"paths":["a.md","b.md",1]}`)
	require.Equal(t, http.StatusBadRequest, w.Code, "within the limit, a malformed body is still a 400")
}

// A body that is not exactly `{"paths": [path]}` is a 400, an empty one
// included: unlike the stream's, no reviews request means "nothing".
func TestPlanningReviewsRefusesAMalformedBody(t *testing.T) {
	e := newPlanningEnv(t, nil)
	for _, body := range []string{
		"", `null`, `[]`, `{"paths":"a.md"}`, `{"paths":[1]}`, `{"path":["a.md"]}`, `{"paths":[]} {}`, `{`,
		`{"paths":["a.md"]`, `{"paths":["a.md"`, `{"paths":`, `{"paths":[["a.md"]]}`,
	} {
		w := e.reviews(body)
		require.Equal(t, http.StatusBadRequest, w.Code, "body %q", body)
		require.Contains(t, w.Body.String(), `"detail"`, "body %q", body)
	}
}
