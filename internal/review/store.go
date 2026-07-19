// Package review persists review-mode data (snapshots + comments) and applies
// the agent-authored changelog that turns "<!-- changelog -->" bullets into
// reviewer-visible reactions.
//
// On-disk layout: one JSON file per reviewed document under a base directory
// (default ~/.local/share/vantage/reviews). The filename flattens the
// repo-relative path by replacing separators with "__" and, in multi-repo mode,
// prefixing the repo name. That scheme is an on-disk upgrade contract, so the
// default directory stays the literal ~/.local/share/vantage/reviews rather
// than an XDG-resolved path.
package review

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/mschulkind-oss/vantage/internal/model"
)

// Store reads and writes review JSON files beneath a single base directory.
// The zero value is not usable; construct one with NewStore or DefaultStore.
//
// Writes are serialized per review file. Two writers race otherwise: the file
// watcher does a read-modify-write to append agent reactions, while a browser
// PUTs the whole review. Without the lock their steps interleave and one
// silently overwrites the other.
type Store struct {
	dir   string
	locks sync.Map // review file path -> *sync.Mutex
}

// NewStore returns a Store rooted at dir. The directory is created lazily on
// the first save, so dir need not exist yet.
func NewStore(dir string) *Store {
	return &Store{dir: dir}
}

// lock acquires the per-file lock for filePath in repo and returns its release
// func. Callers must hold it across an entire read-modify-write, not just the
// write, or the read half still races.
func (s *Store) lock(filePath, repo string) func() {
	key := s.reviewFile(filePath, repo)
	m, _ := s.locks.LoadOrStore(key, &sync.Mutex{})
	mu := m.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

// DefaultStore returns a Store rooted at the literal ~/.local/share/vantage/reviews.
//
// This path is intentionally not XDG-resolved: existing installs keep their
// review files there, so honoring XDG_DATA_HOME would orphan them. When the
// home directory cannot be determined the path collapses to a relative
// ".local/share/vantage/reviews", which still functions for the current
// working directory.
func DefaultStore() *Store {
	home, err := os.UserHomeDir()
	if err != nil {
		slog.Warn("review: could not resolve home directory; using relative review dir", "error", err)
		home = ""
	}
	return NewStore(filepath.Join(home, ".local", "share", "vantage", "reviews"))
}

// Dir returns the base directory this Store reads and writes.
func (s *Store) Dir() string {
	return s.dir
}

// reviewFile returns the absolute path of the JSON file backing the review for
// filePath in repo. The repo-relative path is flattened by replacing both
// forward and back slashes with "__"; in multi-repo mode the repo name is
// prefixed (also "__"-joined). An empty repo (the single-repo sentinel) adds no
// prefix.
func (s *Store) reviewFile(filePath, repo string) string {
	safe := strings.ReplaceAll(filePath, "/", "__")
	safe = strings.ReplaceAll(safe, `\`, "__")
	if repo != "" {
		safe = repo + "__" + safe
	}
	return filepath.Join(s.dir, safe+".json")
}

// Get returns the review for filePath in repo, or nil when none is stored.
//
// A missing file and a corrupt (unparseable) file both return (nil, nil): a
// corrupt file is logged and treated as absent so a single bad record never
// breaks the endpoint. Only an unexpected I/O failure (e.g. a permission error)
// surfaces as a non-nil error.
func (s *Store) Get(filePath, repo string) (*model.ReviewData, error) {
	defer s.lock(filePath, repo)()
	return s.getLocked(filePath, repo)
}

// getLocked is Get without acquiring the lock. Callers must already hold it.
func (s *Store) getLocked(filePath, repo string) (*model.ReviewData, error) {
	p := s.reviewFile(filePath, repo)
	raw, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var data model.ReviewData
	if err := json.Unmarshal(raw, &data); err != nil {
		slog.Warn("review: failed to parse review file; treating as absent", "path", p, "error", err)
		return nil, nil
	}
	return &data, nil
}

// Save writes data for filePath in repo atomically: it marshals to a temp file
// in the base directory, then renames it into place so a reader never observes
// a half-written file. The base directory is created if necessary.
func (s *Store) Save(filePath, repo string, data *model.ReviewData) error {
	defer s.lock(filePath, repo)()
	return s.saveLocked(filePath, repo, data)
}

// saveLocked is Save without acquiring the lock. Callers must already hold it.
func (s *Store) saveLocked(filePath, repo string, data *model.ReviewData) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}

	tmp, err := os.CreateTemp(s.dir, "*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	// Best-effort cleanup if anything below fails before the rename succeeds.
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpName)
		}
	}()

	if _, err := tmp.Write(encoded); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	dst := s.reviewFile(filePath, repo)
	if err := os.Rename(tmpName, dst); err != nil {
		return err
	}
	cleanup = false
	return nil
}

// SaveFromClient persists a review PUT by a browser, preserving any agent
// reactions the client's copy predates.
//
// A browser holds the whole review in memory and PUTs all of it on every edit.
// Meanwhile the watcher appends agent reactions server-side. If the browser
// last read the review before a reaction landed — it was disconnected, or the
// reaction arrived mid-edit — a blind Save would erase that reaction
// permanently, and nothing would ever bring it back: the changelog dedup would
// treat a re-run as a replay.
//
// So an incoming comment keeps everything the client sent (its text, resolved
// flag and reviewer turns are the client's to own) and gets back only the
// stored AGENT reactions it is missing. Comments absent from the payload stay
// deleted — deletion is a real client intent, not staleness.
//
// Server-owned fields are carried across too. The client neither knows nor
// sends AppliedChangelog, so taking the payload at face value would blank it
// and let the watcher re-apply a changelog block it had already consumed.
func (s *Store) SaveFromClient(filePath, repo string, data *model.ReviewData) error {
	defer s.lock(filePath, repo)()

	stored, err := s.getLocked(filePath, repo)
	if err != nil {
		// Unreadable stored copy: nothing to merge, but the client's write must
		// still land or the reviewer silently loses the comment they just made.
		slog.Warn("review: could not read stored review to merge; saving client copy as-is",
			"path", filePath, "error", err)
	} else if stored != nil {
		mergeAgentReactions(stored.Comments, data.Comments)
		if data.AppliedChangelog == "" {
			data.AppliedChangelog = stored.AppliedChangelog
		}
	}
	return s.saveLocked(filePath, repo, data)
}

// mergeAgentReactions re-inserts agent reactions present on disk but missing
// from the incoming copy of the same comment.
//
// Position is recovered by splicing against the turns both sides already share,
// NOT by sorting on Timestamp. Sorting would be wrong: agent turns are stamped
// server-side (whole seconds) and reviewer turns browser-side, so a skewed
// client clock could order a reply BEFORE the answer it responds to — and since
// isPendingForAgent reads the last element, that silently marks the reply
// answered. Both arrays are append-ordered, so relative order is authoritative
// and clock-free.
func mergeAgentReactions(stored, incoming []model.ReviewComment) {
	byID := make(map[string]*model.ReviewComment, len(stored))
	for i := range stored {
		byID[stored[i].ID] = &stored[i]
	}

	for i := range incoming {
		prev, ok := byID[incoming[i].ID]
		if !ok {
			continue
		}
		merged, restored := spliceMissingAgentTurns(prev.Reactions, incoming[i].Reactions)
		if restored == 0 {
			continue
		}
		incoming[i].Reactions = merged
		short := incoming[i].ID
		if len(short) > 8 {
			short = short[:8]
		}
		slog.Info("review: restored agent reactions a stale client write omitted",
			"comment", short, "count", restored)
	}
}

// spliceMissingAgentTurns walks the stored sequence and rebuilds the incoming
// one, inserting each stored agent turn the client lacks at the position the
// stored order puts it. Turns the client dropped that are not agent turns stay
// dropped — reviewer turns are the client's to own.
func spliceMissingAgentTurns(stored, incoming []model.CommentReaction) ([]model.CommentReaction, int) {
	out := make([]model.CommentReaction, 0, len(incoming)+len(stored))
	next := 0 // next unconsumed index in incoming
	restored := 0

	for _, s := range stored {
		if at := indexOfReaction(incoming, next, s); at >= 0 {
			// Shared turn: emit everything the client had before it, then it.
			out = append(out, incoming[next:at+1]...)
			next = at + 1
			continue
		}
		if s.Actor == "agent" {
			out = append(out, s)
			restored++
		}
	}
	out = append(out, incoming[next:]...)
	return out, restored
}

// indexOfReaction finds r in reactions at or after from, or -1.
func indexOfReaction(reactions []model.CommentReaction, from int, r model.CommentReaction) int {
	for i := from; i < len(reactions); i++ {
		if keyOf(reactions[i]) == keyOf(r) {
			return i
		}
	}
	return -1
}

// reactionKey identifies a reaction for dedup during a merge.
//
// The before/after capture is part of the key: ApplyChangelog stamps a whole
// batch with one whole-second timestamp, so (actor, kind, summary, timestamp)
// alone cannot tell two genuinely different answers apart when they land in the
// same second — and dropping one would lose its diff silently.
type reactionKey struct {
	actor      string
	kind       string
	summary    string
	beforeText string
	afterText  string
	timestamp  float64
}

func keyOf(r model.CommentReaction) reactionKey {
	return reactionKey{
		actor:      r.Actor,
		kind:       r.Kind,
		summary:    r.Summary,
		beforeText: r.BeforeText,
		afterText:  r.AfterText,
		timestamp:  r.Timestamp,
	}
}

// Delete removes the review file for filePath in repo. It reports whether a
// file was actually removed: false (with a nil error) means there was nothing
// to delete, which the handler maps to a 404.
func (s *Store) Delete(filePath, repo string) (bool, error) {
	// Delete is the third writer to this file and needs the same serialization
	// as the other two. Unlocked, it lands inside a read-modify-write and the
	// save at the far end recreates the review the reviewer just deleted —
	// acknowledged with a 200, then silently undone.
	defer s.lock(filePath, repo)()
	p := s.reviewFile(filePath, repo)
	err := os.Remove(p)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
