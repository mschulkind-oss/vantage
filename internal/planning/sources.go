package planning

import (
	"encoding/json"

	"github.com/mschulkind-oss/vantage/internal/repoconfig"
)

// Entry is the single-path mode's answer for one path, one of four kinds:
//
//	{"path": …, "kind": "file", "hash": …, "content": …}
//	{"path": …, "kind": "skipped", "size": N}
//	{"path": …, "kind": "unreadable", "reason": …}
//	{"path": …, "kind": "absent"}
//
// Absent covers a missing path and a path that is not a candidate alike, so the
// answer never says whether a file the listing keeps out exists.
//
// A file's `hash` is its content hash, the key the viewer keeps the file's
// scan result under, so a result kept from this answer is found again by the
// next build that sees the same bytes.
type Entry struct {
	Path    string
	Kind    string
	Hash    string // KindFile
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
			Hash    string `json:"hash"`
			Content string `json:"content"`
		}{e.Path, e.Kind, e.Hash, e.Content})
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

// Lookup answers for the one path rel, applying the stream's tests to it: it
// must be listed, it must be a candidate, and then it is read within the size
// limit exactly as [WriteStream] reads it.
//
// The candidate limit is not applied. Whether a scan is refused is a property of
// the whole stream, and the viewer asks about one path of a refused index only
// while a rescan's stream is out, whose answer may not be refused.
func Lookup(listing Listing, cfg repoconfig.Planning, rel string) Entry {
	absent := Entry{Path: rel, Kind: KindAbsent}
	if !matcherFor(cfg).IsCandidate(rel) || !listing.IsListed(rel) {
		return absent
	}
	got := newReader(listing.RootPath(), cfg.MaxFileBytes).read(rel)
	switch got.kind {
	case KindFile:
		return Entry{Path: rel, Kind: KindFile, Hash: got.hash, Content: got.content}
	case KindSkipped:
		return Entry{Path: rel, Kind: KindSkipped, Size: got.size}
	case KindUnreadable:
		return Entry{Path: rel, Kind: KindUnreadable, Reason: got.reason}
	default:
		return absent
	}
}
