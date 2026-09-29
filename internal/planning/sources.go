package planning

import (
	"encoding/json"
	"io"
	"strconv"

	"github.com/mschulkind-oss/vantage/internal/perf"
	"github.com/mschulkind-oss/vantage/internal/repoconfig"
)

// Skipped is a candidate over `max-file-bytes`, which was never opened.
type Skipped struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

// Unreadable is a candidate that exists and could not be read, with the reason.
type Unreadable struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

// file is one entry of the batch's `files`.
type file struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// WriteBatch writes the batch body for listing under cfg:
//
//	{"config": …, "candidate_count": N, "refused": false,
//	 "files": [{"path", "content"}], "skipped": [{"path", "size"}],
//	 "unreadable": [{"path", "reason"}]}
//
// `config` is cfg itself, so the viewer applies the same rules this did. Every
// list is sorted by path, because the listing is, and none is ever null.
//
// Past cfg.MaxCandidates the answer is refused and nothing is opened: `files`,
// `skipped` and `unreadable` are empty and `candidate_count` says how many
// there were. A candidate that vanished between the listing and its read is left
// out; the watcher reports its removal.
//
// The body is streamed, one file at a time. An error means w stopped accepting
// the body — the client went away — and what was written is incomplete.
func WriteBatch(w io.Writer, listing Listing, cfg repoconfig.Planning) error {
	defer perf.Default.Track(perf.CategoryFS, "planning_batch")()

	candidates := Candidates(listing.ListAllFiles(), NewMatcher(cfg))
	refused := len(candidates) > cfg.MaxCandidates

	config, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	head := `{"config":` + string(config) +
		`,"candidate_count":` + strconv.Itoa(len(candidates)) +
		`,"refused":` + strconv.FormatBool(refused) +
		`,"files":[`
	if _, err := io.WriteString(w, head); err != nil {
		return err
	}

	skipped := []Skipped{}
	unreadable := []Unreadable{}
	if !refused {
		r := newReader(listing.RootPath(), cfg.MaxFileBytes)
		first := true
		for _, rel := range candidates {
			got := r.read(rel)
			switch got.kind {
			case KindSkipped:
				skipped = append(skipped, Skipped{Path: rel, Size: got.size})
			case KindUnreadable:
				unreadable = append(unreadable, Unreadable{Path: rel, Reason: got.reason})
			case KindFile:
				entry, err := json.Marshal(file{Path: rel, Content: got.content})
				if err != nil {
					return err
				}
				if !first {
					if _, err := io.WriteString(w, ","); err != nil {
						return err
					}
				}
				first = false
				if _, err := w.Write(entry); err != nil {
					return err
				}
			}
		}
	}

	tail, err := json.Marshal(struct {
		Skipped    []Skipped    `json:"skipped"`
		Unreadable []Unreadable `json:"unreadable"`
	}{skipped, unreadable})
	if err != nil {
		return err
	}
	// tail is `{"skipped":…,"unreadable":…}`; its opening brace becomes the
	// separator after `files`, so the object closes with the tail's own brace.
	if _, err := io.WriteString(w, "],"); err != nil {
		return err
	}
	_, err = w.Write(tail[1:])
	return err
}

// Entry is the single-path mode's answer for one path, one of four kinds:
//
//	{"path": …, "kind": "file", "content": …}
//	{"path": …, "kind": "skipped", "size": N}
//	{"path": …, "kind": "unreadable", "reason": …}
//	{"path": …, "kind": "absent"}
//
// Absent covers a missing path and a path that is not a candidate alike, so the
// answer never says whether a file the listing keeps out exists.
type Entry struct {
	Path    string
	Kind    string
	Content string // KindFile
	Size    int64  // KindSkipped
	Reason  string // KindUnreadable
}

// MarshalJSON writes exactly the fields the entry's kind carries. `content` is
// present for a file even when it is empty, which omitempty could not express.
func (e Entry) MarshalJSON() ([]byte, error) {
	switch e.Kind {
	case KindFile:
		return json.Marshal(struct {
			Path    string `json:"path"`
			Kind    string `json:"kind"`
			Content string `json:"content"`
		}{e.Path, e.Kind, e.Content})
	case KindSkipped:
		return json.Marshal(struct {
			Path string `json:"path"`
			Kind string `json:"kind"`
			Size int64  `json:"size"`
		}{e.Path, e.Kind, e.Size})
	case KindUnreadable:
		return json.Marshal(struct {
			Path   string `json:"path"`
			Kind   string `json:"kind"`
			Reason string `json:"reason"`
		}{e.Path, e.Kind, e.Reason})
	default:
		return json.Marshal(struct {
			Path string `json:"path"`
			Kind string `json:"kind"`
		}{e.Path, KindAbsent})
	}
}

// Lookup answers for the one path rel, applying the batch's tests to it: it must
// be listed, it must be a candidate, and then it is read within the size limit
// exactly as [WriteBatch] reads it.
//
// The candidate limit is not applied. Whether a scan is refused is a property of
// the whole batch, and the viewer asks about one path of a refused index only
// while a rescan's batch is out, whose answer may not be refused.
func Lookup(listing Listing, cfg repoconfig.Planning, rel string) Entry {
	absent := Entry{Path: rel, Kind: KindAbsent}
	if !NewMatcher(cfg).IsCandidate(rel) || !listing.IsListed(rel) {
		return absent
	}
	got := newReader(listing.RootPath(), cfg.MaxFileBytes).read(rel)
	switch got.kind {
	case KindFile:
		return Entry{Path: rel, Kind: KindFile, Content: got.content}
	case KindSkipped:
		return Entry{Path: rel, Kind: KindSkipped, Size: got.size}
	case KindUnreadable:
		return Entry{Path: rel, Kind: KindUnreadable, Reason: got.reason}
	default:
		return absent
	}
}
