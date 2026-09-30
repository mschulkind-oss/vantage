package api

import (
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/planning"
	"github.com/mschulkind-oss/vantage/internal/repoconfig"
)

// planningBatchGone is the old batch's answer. The only client still asking
// for it is a tab loaded before the batch became the stream, and what that tab
// needs is a reload.
const planningBatchGone = "The planning index moved to a stream; reload the page."

// PlanningSources handles GET /planning/sources (and
// /r/{repo}/planning/sources) with `?path=`: the answer for that one path —
// the viewer's refresh after a change push, and its fetch of one file's card
// text — as a single `file`, `skipped`, `unreadable` or `absent` entry, under
// the stream's own tests, a `file` carrying its content hash beside its text.
// Design: docs/design/planning-index.md §3.4, and for the hash
// docs/design/planning-index-at-scale.md §6.2. See [planning.Lookup]. An empty
// `path` is a 400, like every other endpoint's.
//
// Without `path` this URL was the batch, every candidate's text in one body,
// which [Handlers.PlanningStream] replaced. It now answers 410 Gone with the
// {"detail":…} envelope, and reads nothing: a tab loaded before the change
// shows its error with Retry, and a reload fixes it (§6.1).
//
// The existing /content endpoint is deliberately not the per-file refresh. It
// serves paths the listing never yields, has no size limit, and answers a
// missing file and an unreadable one with the same 400.
//
// The config is read with [repoconfig.Config.SettingsNow], past the reload
// throttle, as the stream reads it, so one path is judged under the same table
// as the rescan a `.vantage.toml` push just caused. A file that cannot be used
// is logged and the defaults are served, so a bad table costs the reader their
// exclusions and never the index.
func (h *Handlers) PlanningSources(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	if !q.Has("path") {
		writeDetail(w, http.StatusGone, planningBatchGone)
		return
	}
	rel := q.Get("path")
	if rel == "" {
		writeDetail(w, http.StatusBadRequest, "Missing required query parameter: path")
		return
	}
	writeJSON(w, http.StatusOK, planning.Lookup(svc.FS, planningConfig(svc), rel))
}

// bodyBytesPerCandidate is how much of a planning request's body each of the
// repository's `max-candidates` allows. A warm `have` entry costs its path and
// about 40 B more, and a reviews path its own length and 3, so a repository at
// its limit fits with room to spare, and raising the limit raises the cap with
// it: a fixed cap would answer every warm build past about 54,000 candidates
// with a 413 the limit allows (design §6.1).
const bodyBytesPerCandidate = 1 << 10

// streamBodyFloor and reviewsBodyFloor are the least each endpoint's body cap
// is, whatever `max-candidates` says. Variables so a test can lower them
// rather than send megabytes.
var (
	streamBodyFloor  int64 = 4 << 20
	reviewsBodyFloor int64 = 1 << 20
)

// bodyLimit is a planning request's body cap for a repository whose
// `max-candidates` is maxCandidates: [bodyBytesPerCandidate] each, and never
// below floor. It saturates rather than overflow, since the config bounds
// `max-candidates` only from below.
func bodyLimit(floor int64, maxCandidates int) int64 {
	if int64(maxCandidates) > math.MaxInt64/bodyBytesPerCandidate {
		return math.MaxInt64
	}
	return max(floor, int64(maxCandidates)*bodyBytesPerCandidate)
}

// PlanningStream handles POST /planning/stream (and
// /r/{repo}/planning/stream): every planning candidate as one line of NDJSON,
// with the text only of the files whose content hash the browser does not
// already hold. Design: docs/design/planning-index-at-scale.md §6.1. The lines
// are [planning.Stream.Write]'s.
//
// The body is `{"have": {path: hash, …}}`, the hashes the browser keeps scan
// results under. No body, `{}`, or an empty or null `have` asks for a cold
// build: every text. A body past [bodyLimit] is a 413, and one that is not
// exactly an object of that shape, alone, is a 400, both with the
// {"detail":…} envelope and before a line is written.
//
// The candidates are listed before the body is read, and the body is read one
// entry at a time, keeping only the entries [planning.Stream.Wants] accepts:
// whatever the body's size, what the request holds of `have` is at most one
// path and one hash per candidate (design §6.4).
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
// The request's context ends the reading: once the client has gone, no
// further candidate is opened, although behind gzip no write fails until the
// next flush.
//
// The config is read as [Handlers.PlanningSources] reads it, past the reload
// throttle, because the build this most often answers is the one a
// `.vantage.toml` push just caused.
func (h *Handlers) PlanningStream(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	cfg := planningConfig(svc)
	stream := planning.NewStream(svc.FS, cfg)
	limit := bodyLimit(streamBodyFloor, cfg.MaxCandidates)
	have, err := readHave(w, r, limit, stream.Wants)
	switch {
	case errors.Is(err, io.EOF):
		// No body at all: a cold build.
	case isTooLarge(err):
		writeDetail(w, http.StatusRequestEntityTooLarge,
			"The planning stream's request is larger than "+strconv.FormatInt(limit, 10)+" bytes")
		return
	case err != nil:
		writeDetail(w, http.StatusBadRequest, `Invalid request body: expected {"have": {path: hash}}`)
		return
	}

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

	err = stream.Write(r.Context(), out, have)
	if err == nil && out.gz != nil {
		err = out.gz.Close()
	}
	if err != nil {
		// Headers are gone, so there is no status left to change: the client
		// stopped reading, and its reader fails on a body without `end`.
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

// planningReview is one entry of the reviews answer.
type planningReview struct {
	Path   string            `json:"path"`
	Review *model.ReviewData `json:"review"`
}

// PlanningReviews handles POST /planning/reviews (and
// /r/{repo}/planning/reviews): the stored reviews of many documents in one
// request, where the planning page used to send one GET /review per listed
// document. Design: docs/design/planning-index-at-scale.md §6.3.
//
// The body is `{"paths": [...]}`, and the answer is
// `{"reviews": [{"path": …, "review": …}]}`: one entry for each distinct path
// that has a stored review, in the order the request named them, each
// `review` exactly what GET /review answers for that path. `reviews` is `[]`,
// never null, when none has one.
//
// A path is validated as GET /review validates it, and one that fails, the
// empty path, is left out. A store read error leaves its path out with a
// warning, as GET /review degrades to null. The body is capped at [bodyLimit]
// and at the repository's `max-candidates` paths, since the page never lists
// more documents than that; past either cap it is a 413, and the path past the
// second is refused as soon as it is read. A body that is not exactly that
// shape, an empty one included, is a 400.
func (h *Handlers) PlanningReviews(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	maxPaths := planningConfig(svc).MaxCandidates
	limit := bodyLimit(reviewsBodyFloor, maxPaths)
	paths, err := readPaths(w, r, limit, maxPaths)
	switch {
	case isTooLarge(err):
		writeDetail(w, http.StatusRequestEntityTooLarge,
			"The reviews request is larger than "+strconv.FormatInt(limit, 10)+" bytes")
		return
	case errors.Is(err, errTooManyPaths):
		writeDetail(w, http.StatusRequestEntityTooLarge,
			"The reviews request names more than "+strconv.Itoa(maxPaths)+" paths, the planning index's max-candidates")
		return
	case err != nil:
		writeDetail(w, http.StatusBadRequest, `Invalid request body: expected {"paths": [path]}`)
		return
	}

	reviews := make([]planningReview, 0, len(paths))
	seen := make(map[string]bool, len(paths))
	for _, path := range paths {
		if path == "" || seen[path] {
			continue
		}
		seen[path] = true
		data, err := h.deps.Reviews.Get(path, svc.Repo)
		if err != nil {
			slog.Warn("api: review get failed; leaving it out of the reviews answer", "path", path, "error", err)
			continue
		}
		if data != nil {
			reviews = append(reviews, planningReview{Path: path, Review: data})
		}
	}
	writeJSON(w, http.StatusOK, struct {
		Reviews []planningReview `json:"reviews"`
	}{reviews})
}

// errTooManyPaths is a reviews body naming more paths than `max-candidates`.
var errTooManyPaths = errors.New("more paths than max-candidates")

// readHave reads the stream's body, `{"have": {path: hash, …}}`, keeping only
// the entries wants accepts. A null `have` is nil, as no `have` is.
func readHave(w http.ResponseWriter, r *http.Request, limit int64, wants func(path, hash string) bool) (map[string]string, error) {
	var have map[string]string
	err := readObject(w, r, limit, "have", func(dec *json.Decoder) error {
		switch tok, err := dec.Token(); {
		case err != nil:
			return err
		case tok == nil:
			have = nil
			return nil
		case tok != json.Delim('{'):
			return errors.New(`"have" is not an object`)
		}
		if have == nil {
			have = map[string]string{}
		}
		for dec.More() {
			// A key is always a string: the decoder refuses anything else.
			key, err := dec.Token()
			if err != nil {
				return err
			}
			value, err := dec.Token()
			if err != nil {
				return err
			}
			hash, ok := value.(string)
			if !ok {
				return errors.New("a hash that is not a string")
			}
			if path := key.(string); wants(path, hash) {
				have[path] = hash
			}
		}
		_, err := dec.Token()
		return err
	})
	return have, err
}

// readPaths reads the reviews body, `{"paths": [path, …]}`, refusing it with
// [errTooManyPaths] at the first path past maxPaths.
func readPaths(w http.ResponseWriter, r *http.Request, limit int64, maxPaths int) ([]string, error) {
	var paths []string
	err := readObject(w, r, limit, "paths", func(dec *json.Decoder) error {
		switch tok, err := dec.Token(); {
		case err != nil:
			return err
		case tok == nil:
			paths = nil
			return nil
		case tok != json.Delim('['):
			return errors.New(`"paths" is not an array`)
		}
		paths = paths[:0]
		for dec.More() {
			tok, err := dec.Token()
			if err != nil {
				return err
			}
			path, ok := tok.(string)
			if !ok {
				return errors.New("a path that is not a string")
			}
			if len(paths) == maxPaths {
				return errTooManyPaths
			}
			paths = append(paths, path)
		}
		_, err := dec.Token()
		return err
	})
	return paths, err
}

// readObject reads the request body, at most limit bytes of it, as exactly one
// JSON object whose only key is field, handing the decoder to value to read
// what follows the key each time it appears. The body is read token by token,
// so what a handler holds of it is what value keeps, never the decoded whole.
//
// It returns io.EOF for a body that is empty or only whitespace, an
// [*http.MaxBytesError] (see [isTooLarge]) for one past the limit, value's own
// error, and any other error for one that is not a single object of that
// shape, another key included: a misspelled field read as absent would pass
// for a request that asked for nothing. [decodeBody] answers 400 for all of
// them alike, which is why the planning endpoints do not use it.
func readObject(w http.ResponseWriter, r *http.Request, limit int64, field string, value func(*json.Decoder) error) error {
	body := http.MaxBytesReader(w, r.Body, limit)
	defer func() { _ = body.Close() }()
	dec := json.NewDecoder(body)
	switch tok, err := dec.Token(); {
	case err != nil:
		return err
	case tok != json.Delim('{'):
		return errors.New("not an object")
	}
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return truncated(err)
		}
		if key != field {
			return fmt.Errorf("unknown key %q", key)
		}
		if err := value(dec); err != nil {
			return truncated(err)
		}
	}
	// The object's closing brace, and then nothing but whitespace.
	if _, err := dec.Token(); err != nil {
		return truncated(err)
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

// truncated is err met inside the object, where the end of the body is a
// body cut short and not an empty one.
func truncated(err error) error {
	if errors.Is(err, io.EOF) {
		return io.ErrUnexpectedEOF
	}
	return err
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
