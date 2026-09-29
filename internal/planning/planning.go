// Package planning serves the planning index its sources: which Markdown files
// are candidates, and the text of each one, within the limits `[planning]`
// sets. Design: docs/design/planning-index.md §3.
//
// The server lists, filters and reads. It never parses Markdown: the planning
// scan lives in vantage-md and runs in the viewer and in vantage-check, so that
// one parser decides what a document says (the design's principle P4). What
// this package decides is only what the scan is given.
//
// # Candidates
//
// A candidate is a file the repository's Markdown listing yields
// ([fs.FileSystemService.ListAllFiles]) that `include` matches and `exclude`
// does not, plus the roadmap whatever either says ([Matcher]). The patterns go
// through the gitignore matcher `[starred] promote` uses, quirks included, and
// vantage-md ports that matcher line for line; testdata/planning-patterns.json
// in internal/repoconfig holds the two to one answer.
//
// # Limits
//
// Past `max-candidates` nothing is opened at all, and the answer says so
// ("refused"), because a partial index would quietly under-report. A candidate
// larger than `max-file-bytes` is stat'ed and never opened ("skipped"). Both are
// decided before any read, and the batch is streamed one file at a time, since
// 5,000 files of 1 MiB each is a valid config and a marshaled slice would hold
// all of it at once.
//
// # Two modes
//
// [WriteBatch] answers for every candidate. [Lookup] answers for one path, the
// viewer's refresh after a change push, and applies the batch's own tests to it
// so that a path joins the index only on the terms a full scan would have given
// it.
package planning

import (
	gitignore "github.com/sabhiram/go-gitignore"

	"github.com/mschulkind-oss/vantage/internal/repoconfig"
)

// Listing is the repository's Markdown listing, which
// [github.com/mschulkind-oss/vantage/internal/fs.FileSystemService] provides.
//
// ListAllFiles and IsListed must give one answer: IsListed(p) is whether p is in
// ListAllFiles(). The batch uses the first and the single-path mode the second,
// so a disagreement would let a path into the index by one route that the other
// keeps out.
type Listing interface {
	RootPath() string
	ListAllFiles() []string
	IsListed(rel string) bool
}

// Matcher decides which listed paths are candidates.
type Matcher struct {
	roadmap string
	include *gitignore.GitIgnore
	exclude *gitignore.GitIgnore
}

// NewMatcher compiles cfg's include and exclude lines.
//
// Every line goes through the matcher, literal or not. `starred.Promote` takes a
// line with no glob character as a path and never matches it as a pattern, and
// copying that split here would make `include = ["roadmap.md"]` mean something
// other than what vantage-md's port of the matcher says it means: as a pattern,
// that line also matches `docs/roadmap.md`.
//
// A line the matcher cannot compile is dropped, as the matcher drops it for
// `promote`.
func NewMatcher(cfg repoconfig.Planning) *Matcher {
	return &Matcher{
		roadmap: cfg.Roadmap,
		include: gitignore.CompileIgnoreLines(cfg.Include...),
		exclude: gitignore.CompileIgnoreLines(cfg.Exclude...),
	}
}

// IsCandidate reports whether a listed path is a candidate: the roadmap, or
// matched by include and not by exclude. rel is repo-relative and
// slash-separated, as the listing spells it.
//
// It does not ask whether rel is listed. That belongs to whoever produced the
// path, which is why [Candidates] takes a listing and [Lookup] asks the listing
// first.
func (m *Matcher) IsCandidate(rel string) bool {
	if rel == m.roadmap {
		return true
	}
	return m.include.MatchesPath(rel) && !m.exclude.MatchesPath(rel)
}

// Candidates returns the candidates among listed, in listed's order.
func Candidates(listed []string, m *Matcher) []string {
	out := make([]string, 0, len(listed))
	for _, rel := range listed {
		if m.IsCandidate(rel) {
			out = append(out, rel)
		}
	}
	return out
}
