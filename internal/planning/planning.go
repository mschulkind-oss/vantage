// Package planning serves the planning index its sources: which Markdown files
// are candidates, and the text of each one, within the limits `[planning]`
// sets. Architecture and invariants: docs/reference/planning-index.md, which
// covers candidates in §3.1 and the stream and the content hash in §9.
//
// The server lists, filters and reads. It never parses Markdown: the planning
// scan lives in vantage-md and runs in the viewer and in vantage-check, so that
// one parser decides what a document says (the reference's principle P4). What
// this package decides is only what the scan is given.
//
// # Candidates
//
// A candidate is a file the repository's Markdown listing yields
// ([fs.FileSystemService.ListAllFiles]) that `include` matches and `exclude`
// does not, plus each roadmap `[planning] roadmap` lists, whatever either says
// ([Matcher]). The patterns go through the gitignore matcher `[starred]
// promote` uses, quirks included, and vantage-md ports that matcher line for
// line; testdata/planning-patterns.json in internal/repoconfig holds the two to
// one answer.
//
// # Roadmaps
//
// Which candidates are roadmaps is [repoconfig.Planning.IsRoadmap]'s to say: the
// paths `roadmap` lists, or, with no `roadmap` key, every candidate named
// roadmap.md. That is a test on a path, not Markdown parsing. The server needs it for two things
// only: a listed roadmap is a candidate whatever the patterns say, and every
// roadmap is sent whole, never as `same`. The stream marks no line as a
// roadmap; its header carries the config, and the browser applies the same
// test to it. testdata/planning-roadmaps.json in internal/repoconfig holds the
// two tests to one answer. Reference: docs/reference/planning-index.md §4.1.
//
// # Limits
//
// Past `max-candidates` nothing is opened at all, and the answer says so
// ("refused"), because a partial index would quietly under-report. A candidate
// larger than `max-file-bytes` is stat'ed and never opened ("skipped"). Both are
// decided before any read, and every answer for many files is written one file
// at a time, since 5,000 files of 1 MiB each is a valid config and a marshaled
// slice would hold all of it at once.
//
// # Content hash
//
// A file read whole is named by its content hash: the first 128 bits of
// SHA-256 over its bytes, as 32 lowercase hex digits. The browser keeps each
// file's scan result under that hash, and tells the stream which ones it holds,
// so a file it already scanned crosses the wire as its hash alone.
//
// # Two modes
//
// [Stream.Write] answers for every candidate, one line each, sending the text
// only of the files whose hash the browser does not hold. [Lookup] answers for
// one path, the viewer's refresh after a change push, and applies the same
// tests to it so that a path joins the index only on the terms a full scan
// would have given it.
package planning

import (
	"encoding/json"
	"sync"

	gitignore "github.com/sabhiram/go-gitignore"

	"github.com/mschulkind-oss/vantage/internal/repoconfig"
)

// Listing is the repository's Markdown listing, which
// [github.com/mschulkind-oss/vantage/internal/fs.FileSystemService] provides.
//
// ListAllFiles and IsListed must give one answer: IsListed(p) is whether p is in
// ListAllFiles(). The stream uses the first and the single-path mode the second,
// so a disagreement would let a path into the index by one route that the other
// keeps out.
type Listing interface {
	RootPath() string
	ListAllFiles() []string
	IsListed(rel string) bool
}

// Matcher decides which listed paths are candidates.
type Matcher struct {
	// listed is the listed roadmaps, each a candidate whatever the patterns
	// say. Empty when `roadmap` is [] or absent: a roadmap found by name is
	// exempt from nothing.
	listed  map[string]struct{}
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
	listed := make(map[string]struct{}, len(cfg.Roadmaps))
	for _, rel := range cfg.Roadmaps {
		listed[rel] = struct{}{}
	}
	return &Matcher{
		listed:  listed,
		include: gitignore.CompileIgnoreLines(cfg.Include...),
		exclude: gitignore.CompileIgnoreLines(cfg.Exclude...),
	}
}

// matchers holds the Matcher of each config compiled lately, by its lines. The
// single-path mode answers every pushed Markdown path, and compiling runs every
// include and exclude line through a regular-expression compile, so a large
// table would cost that on each save. Bounded, since a daemon serves several
// repositories and each edit of a table is a new key.
var matchers = struct {
	sync.Mutex
	byKey map[string]*Matcher
}{byKey: map[string]*Matcher{}}

const matchersKept = 16

// matcherFor is [NewMatcher], compiled once per distinct cfg.
func matcherFor(cfg repoconfig.Planning) *Matcher {
	// JSON, so no choice of separator can make two tables one key, and so the
	// roadmaps are spelled as they marshal: null, which finds them by name,
	// and [], which names none, are two keys.
	raw, _ := json.Marshal([]any{cfg.Roadmaps, cfg.Include, cfg.Exclude})
	key := string(raw)
	matchers.Lock()
	defer matchers.Unlock()
	if m, ok := matchers.byKey[key]; ok {
		return m
	}
	if len(matchers.byKey) >= matchersKept {
		clear(matchers.byKey)
	}
	m := NewMatcher(cfg)
	matchers.byKey[key] = m
	return m
}

// IsCandidate reports whether a listed path is a candidate: a listed roadmap,
// or matched by include and not by exclude. rel is repo-relative and
// slash-separated, as the listing spells it. A roadmap found by its name has no
// exemption: it is a roadmap because it is a candidate, and the patterns are
// how a reader hides one.
//
// It does not ask whether rel is listed. That belongs to whoever produced the
// path, which is why [Candidates] takes a listing and [Lookup] asks the listing
// first: a listed roadmap in a hidden directory is never read.
func (m *Matcher) IsCandidate(rel string) bool {
	if _, ok := m.listed[rel]; ok {
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
