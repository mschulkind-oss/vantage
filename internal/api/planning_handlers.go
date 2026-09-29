package api

import (
	"compress/gzip"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/mschulkind-oss/vantage/internal/planning"
	"github.com/mschulkind-oss/vantage/internal/repoconfig"
)

// PlanningSources handles GET /planning/sources (and
// /r/{repo}/planning/sources): the text of every planning candidate, for the
// viewer's planning index to scan. Design: docs/design/planning-index.md §3.4.
//
// Without parameters it answers the batch, streamed: the effective `[planning]`
// table, the candidate count, whether the scan was refused past
// `max-candidates`, and the files, the skipped and the unreadable, each list
// sorted by path and never null. See [planning.WriteBatch].
//
// With `?path=` it answers for that one path — the viewer's refresh after a
// change push — as a single `file`, `skipped`, `unreadable` or `absent` entry,
// under the batch's own tests, a `file` carrying its content hash beside its
// text. See [planning.Lookup]. An empty `path` is a 400, like every other
// endpoint's.
//
// The existing /content endpoint is deliberately not the per-file refresh. It
// serves paths the listing never yields, has no size limit, and answers a
// missing file and an unreadable one with the same 400.
//
// The config is read with [repoconfig.Config.SettingsNow], past the reload
// throttle, because the request this most often answers is the rescan a
// `.vantage.toml` push just caused. A file that cannot be used is logged and the
// defaults are served, so a bad table costs the reader their exclusions and
// never the index.
func (h *Handlers) PlanningSources(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	cfg := planningConfig(svc)

	if q := r.URL.Query(); q.Has("path") {
		rel := q.Get("path")
		if rel == "" {
			writeDetail(w, http.StatusBadRequest, "Missing required query parameter: path")
			return
		}
		writeJSON(w, http.StatusOK, planning.Lookup(svc.FS, cfg, rel))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := planning.WriteBatch(w, svc.FS, cfg); err != nil {
		// Headers are gone, so there is no status left to change: the client
		// stopped reading, and its parse of a truncated body is what fails.
		slog.Debug("api: planning batch not delivered", "repo", svc.Repo, "error", err)
	}
}

// streamBodyLimit caps the planning stream's request body. Its `have` costs
// about 60 B a candidate, so the cap holds several times `max-candidates`'
// default of 5,000. A variable so a test can lower it rather than send 4 MiB.
var streamBodyLimit int64 = 4 << 20

// PlanningStream handles POST /planning/stream (and
// /r/{repo}/planning/stream): every planning candidate as one line of NDJSON,
// with the text only of the files whose content hash the browser does not
// already hold. Design: docs/design/planning-index-at-scale.md §6.1. The lines
// are [planning.WriteStream]'s.
//
// The body is `{"have": {path: hash, …}}`, the hashes the browser keeps scan
// results under. No body, `{}`, or an empty or null `have` asks for a cold
// build: every text. A body past [streamBodyLimit] is a 413, and one that is
// not exactly an object of that shape, alone, is a 400, both with the
// {"detail":…} envelope and before a line is written.
//
// The answer is `application/x-ndjson`, never cached, and gzipped at the
// fastest level when the request accepts gzip, since a cold build's body is
// the whole corpus. It is flushed through the [http.ResponseController], which
// reaches the connection past the perf middleware's wrapper, and the
// compressor is flushed first each time, or a line would sit in it.
//
// No write deadline is set, and none should be: a browser that reads slowly,
// because it scans each line before reading the next, holds the server back by
// TCP, which is the design's backpressure.
//
// The config is read as [Handlers.PlanningSources] reads it, past the reload
// throttle, because the build this most often answers is the one a
// `.vantage.toml` push just caused.
func (h *Handlers) PlanningStream(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	var req *struct {
		Have map[string]string `json:"have"`
	}
	switch err := decodeCapped(w, r, streamBodyLimit, &req); {
	case errors.Is(err, io.EOF):
		// No body at all: a cold build.
	case isTooLarge(err):
		writeDetail(w, http.StatusRequestEntityTooLarge,
			"The planning stream's request is larger than "+strconv.FormatInt(streamBodyLimit, 10)+" bytes")
		return
	case err != nil || req == nil:
		writeDetail(w, http.StatusBadRequest, `Invalid request body: expected {"have": {path: hash}}`)
		return
	}
	var have map[string]string
	if req != nil {
		have = req.Have
	}
	cfg := planningConfig(svc)

	header := w.Header()
	header.Set("Content-Type", "application/x-ndjson")
	header.Set("Cache-Control", "no-store")
	header.Add("Vary", "Accept-Encoding")
	out := &streamWriter{w: w, rc: http.NewResponseController(w)}
	if acceptsGzip(r) {
		header.Set("Content-Encoding", "gzip")
		// BestSpeed is a valid level, so this cannot fail.
		out.gz, _ = gzip.NewWriterLevel(w, gzip.BestSpeed)
		out.w = out.gz
	}
	w.WriteHeader(http.StatusOK)

	err := planning.WriteStream(out, svc.FS, cfg, have)
	if err == nil && out.gz != nil {
		err = out.gz.Close()
	}
	if err != nil {
		// As for the batch: the status is gone, the client stopped reading,
		// and its reader fails on a body without `end`.
		slog.Debug("api: planning stream not delivered", "repo", svc.Repo, "error", err)
	}
}

// streamWriter is the stream's [planning.Flusher] over a response: through a
// gzip writer when the request accepts one, flushed compressor first.
type streamWriter struct {
	w  io.Writer
	gz *gzip.Writer
	rc *http.ResponseController
}

func (s *streamWriter) Write(p []byte) (int, error) { return s.w.Write(p) }

func (s *streamWriter) Flush() error {
	if s.gz != nil {
		if err := s.gz.Flush(); err != nil {
			return err
		}
	}
	// A writer that cannot flush still delivers the body, only later.
	if err := s.rc.Flush(); err != nil && !errors.Is(err, http.ErrNotSupported) {
		return err
	}
	return nil
}

// acceptsGzip reports whether the request's Accept-Encoding names gzip with a
// nonzero quality. Every browser sends it; a client that does not gets the
// lines uncompressed.
func acceptsGzip(r *http.Request) bool {
	for _, value := range r.Header.Values("Accept-Encoding") {
		for _, part := range strings.Split(value, ",") {
			coding, params, _ := strings.Cut(part, ";")
			if !strings.EqualFold(strings.TrimSpace(coding), "gzip") {
				continue
			}
			name, q, found := strings.Cut(strings.TrimSpace(params), "=")
			if found && strings.EqualFold(strings.TrimSpace(name), "q") {
				if v, err := strconv.ParseFloat(strings.TrimSpace(q), 64); err == nil && v == 0 {
					return false
				}
			}
			return true
		}
	}
	return false
}

// decodeCapped decodes the request body, at most limit bytes of it, into v as
// exactly one JSON value.
//
// It returns io.EOF for a body that is empty or only whitespace, an
// [*http.MaxBytesError] (see [isTooLarge]) for one past the limit, and any
// other error for one that is not a single JSON value of v's shape, a key v
// does not have included: a misspelled field read as absent would pass for a
// request that asked for nothing. [decodeBody] answers 400 for all three alike,
// which is why the planning endpoints do not use it.
func decodeCapped(w http.ResponseWriter, r *http.Request, limit int64, v any) error {
	body := http.MaxBytesReader(w, r.Body, limit)
	defer func() { _ = body.Close() }()
	dec := json.NewDecoder(body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	switch _, err := dec.Token(); {
	case errors.Is(err, io.EOF):
		return nil
	case err != nil:
		return err
	default:
		return errors.New("more than one JSON value")
	}
}

// isTooLarge reports whether err is a request body past its cap.
func isTooLarge(err error) bool {
	var tooLarge *http.MaxBytesError
	return errors.As(err, &tooLarge)
}

// planningConfig is the repository's effective `[planning]` table: its own when
// it has a usable one, the defaults otherwise.
func planningConfig(svc RepoServices) repoconfig.Planning {
	if svc.Config == nil {
		return repoconfig.DefaultPlanning()
	}
	settings, err := svc.Config.SettingsNow()
	if err != nil {
		// Warned, not fatal, as the server's promoted() does for the same file:
		// in daemon mode one contributor's typo must not take the planning
		// index away from every other repository.
		slog.Warn("api: ignoring repository config for the planning index",
			"repo", svc.Repo, "path", svc.Config.Path(), "error", err)
		return repoconfig.DefaultPlanning()
	}
	return settings.Planning.Resolved()
}
