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

	"github.com/mschulkind-oss/vantage/internal/model"
)

// Store reads and writes review JSON files beneath a single base directory.
// The zero value is not usable; construct one with NewStore or DefaultStore.
type Store struct {
	dir string
}

// NewStore returns a Store rooted at dir. The directory is created lazily on
// the first save, so dir need not exist yet.
func NewStore(dir string) *Store {
	return &Store{dir: dir}
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

// Delete removes the review file for filePath in repo. It reports whether a
// file was actually removed: false (with a nil error) means there was nothing
// to delete, which the handler maps to a 404.
func (s *Store) Delete(filePath, repo string) (bool, error) {
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
