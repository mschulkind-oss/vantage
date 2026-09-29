package planning

import (
	"encoding/json"
	"io"

	"github.com/mschulkind-oss/vantage/internal/perf"
	"github.com/mschulkind-oss/vantage/internal/repoconfig"
)

// The stream's own kinds of line. Between its header and its end, each line is
// one candidate's, and is [KindSame], [KindFile], [KindSkipped] or
// [KindUnreadable]. A candidate that vanished has no line.
const (
	KindHeader = "header"
	KindSame   = "same"
	KindEnd    = "end"
)

// flushEvery is how many bytes of lines [WriteStream] writes before it flushes
// them. It is a variable so that a test can prove the bound by lowering it,
// rather than by building a tree past 64 KiB.
var flushEvery = 64 << 10

// Flusher is where [WriteStream] writes: a writer that can push everything it
// has been given to the client at once. Over HTTP it is the response, through
// its compressor when there is one.
type Flusher interface {
	io.Writer
	Flush() error
}

// The lines, one struct per kind, with `kind` first so a reader can tell what a
// line is from its opening bytes.
type (
	headerLine struct {
		Kind           string              `json:"kind"`
		Config         repoconfig.Planning `json:"config"`
		CandidateCount int                 `json:"candidate_count"`
		Refused        bool                `json:"refused"`
	}
	sameLine struct {
		Kind string `json:"kind"`
		Path string `json:"path"`
		Hash string `json:"hash"`
	}
	fileLine struct {
		Kind    string `json:"kind"`
		Path    string `json:"path"`
		Hash    string `json:"hash"`
		Content string `json:"content"`
	}
	skippedLine struct {
		Kind string `json:"kind"`
		Path string `json:"path"`
		Size int64  `json:"size"`
	}
	unreadableLine struct {
		Kind   string `json:"kind"`
		Path   string `json:"path"`
		Reason string `json:"reason"`
	}
	endLine struct {
		Kind       string `json:"kind"`
		Candidates int    `json:"candidates"`
	}
)

// WriteStream writes the planning stream for listing under cfg: one JSON object
// per line (NDJSON), naming by its content hash alone each file whose hash the
// browser already holds. Design: docs/design/planning-index-at-scale.md §6.1.
//
//	{"kind":"header","config":…,"candidate_count":N,"refused":false}
//	{"kind":"same","path":…,"hash":…}
//	{"kind":"file","path":…,"hash":…,"content":…}
//	{"kind":"skipped","path":…,"size":N}
//	{"kind":"unreadable","path":…,"reason":…}
//	{"kind":"end","candidates":N}
//
// have maps a path to the content hash the browser holds a scan result for. A
// candidate that reads whole, as UTF-8 and within the size limit, to exactly
// that hash is `same`; any other readable candidate is `file`, with its text.
// The roadmap is always `file`, whatever have says, so that whether a file is
// the roadmap is never part of what the browser keeps. A path in have that is
// not a candidate is ignored, and a nil have asks for every text: a cold build.
//
// The candidates are [Candidates] of the listing, in its order, which is path
// order, each read exactly as [Lookup] reads one. Every candidate is sent
// whatever it holds: which files are planning documents is the scan's to
// decide, in the browser, and never this package's. A candidate that vanished
// between the listing and its read is left out, as the watcher reports its
// removal. Past cfg.MaxCandidates the header says `"refused":true`, `end`
// follows it, and nothing is opened.
//
// `end` carries the candidate count again and closes every stream, refused or
// not, because a body without it is how a reader tells a dropped connection
// from a small repository. The header is flushed as soon as it is written, so
// the browser has the config and the count before the first file is read, and
// the lines after it each time 64 KiB more have been written, so what is
// written and not yet flushed is never more than 64 KiB and one line. Go's JSON
// encoder escapes every newline inside a value, so each line ends at its own
// newline and at no other. `<`, `>` and `&` are written as themselves: the
// body is never HTML, and Markdown is full of them.
//
// An error means w stopped accepting the body — the client went away — and
// nothing more is read for it.
func WriteStream(w Flusher, listing Listing, cfg repoconfig.Planning, have map[string]string) error {
	defer perf.Default.Track(perf.CategoryFS, "planning_stream")()

	candidates := Candidates(listing.ListAllFiles(), matcherFor(cfg))
	refused := len(candidates) > cfg.MaxCandidates

	out := newLineWriter(w)
	if err := out.line(headerLine{KindHeader, cfg, len(candidates), refused}); err != nil {
		return err
	}
	if err := out.flush(); err != nil {
		return err
	}
	if !refused {
		r := newReader(listing.RootPath(), cfg.MaxFileBytes)
		for _, rel := range candidates {
			line := candidateLine(rel, r.read(rel), rel == cfg.Roadmap, have)
			if line == nil {
				continue
			}
			if err := out.line(line); err != nil {
				return err
			}
		}
	}
	return out.line(endLine{KindEnd, len(candidates)})
}

// candidateLine is the line for one candidate's read, or nil for a candidate
// that is gone.
func candidateLine(rel string, got read, roadmap bool, have map[string]string) any {
	switch got.kind {
	case KindFile:
		if held, ok := have[rel]; ok && held == got.hash && !roadmap {
			return sameLine{KindSame, rel, got.hash}
		}
		return fileLine{KindFile, rel, got.hash, got.content}
	case KindSkipped:
		return skippedLine{KindSkipped, rel, got.size}
	case KindUnreadable:
		return unreadableLine{KindUnreadable, rel, got.reason}
	default:
		return nil
	}
}

// lineWriter writes one JSON value per line to a [Flusher], and flushes once
// flushEvery bytes have gone out since it last did.
type lineWriter struct {
	w       Flusher
	enc     *json.Encoder
	pending int
}

func newLineWriter(w Flusher) *lineWriter {
	l := &lineWriter{w: w}
	l.enc = json.NewEncoder(countingWriter{l})
	l.enc.SetEscapeHTML(false)
	return l
}

// line writes v and its newline, in one write.
func (l *lineWriter) line(v any) error {
	if err := l.enc.Encode(v); err != nil {
		return err
	}
	if l.pending >= flushEvery {
		return l.flush()
	}
	return nil
}

func (l *lineWriter) flush() error {
	l.pending = 0
	return l.w.Flush()
}

// countingWriter counts, for its lineWriter, the bytes the encoder writes.
type countingWriter struct{ l *lineWriter }

func (c countingWriter) Write(p []byte) (int, error) {
	n, err := c.l.w.Write(p)
	c.l.pending += n
	return n, err
}
