// Package pathsafe is the single implementation of Vantage's containment rule:
// a caller-supplied, repository-relative path is admitted only when it still
// lands inside the repository root after symlinks are resolved.
//
// The rule has two halves, and both are required. The lexical half rejects
// absolute paths, NUL bytes, ".git" and ".vantage" segments, and any "../" that
// climbs out of the root. The physical half re-checks containment against the
// filesystem, because a lexically innocent path like "docs/logo.png" can be a
// symlink to anywhere the server process can read. Lexical checking alone is
// what made an in-repo symlink an arbitrary-file read through /content and
// /git/diff/working.
//
// [Resolve] is deliberately the only way in. This rule previously existed as
// three hand-copied near-copies — one per caller — and every fix had to be
// applied to each of them; the ".vantage" block was already carrying a comment
// explaining that it was a copy. One implementation is the point of the
// package.
package pathsafe

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/mschulkind-oss/vantage/internal/ignore"
)

// ErrInvalid is the sentinel every rejection unwraps to, so callers can match
// with errors.Is regardless of which rule rejected the path.
var ErrInvalid = errors.New("pathsafe: invalid path")

// Error is returned for a rejected path. Detail is a human-readable reason safe
// to expose to the client; the HTTP layer puts it in a {"detail":…} 400 body.
type Error struct {
	// Detail explains why the path was rejected (e.g. "Absolute paths not
	// allowed").
	Detail string
}

func (e *Error) Error() string { return "pathsafe: " + e.Detail }

// Unwrap lets errors.Is(err, ErrInvalid) succeed for any Error.
func (e *Error) Unwrap() error { return ErrInvalid }

// newError builds an *Error with the given detail message.
func newError(detail string) *Error { return &Error{Detail: detail} }

// Resolve validates path (repository-relative, slash- or OS-separated) against
// root and returns the absolute path to read. It rejects empty paths, NUL
// bytes, absolute paths, any ".git" segment, anything under ".vantage", and any
// path that leaves root either lexically or once symlinks are followed.
//
// A path that does not exist is not an error here: containment is proved
// against its nearest existing ancestor, so a missing file still reaches its
// caller and keeps its own "not found" answer rather than being reported as a
// traversal attempt.
func Resolve(root, path string) (string, error) {
	if path == "" || strings.ContainsRune(path, '\x00') {
		return "", newError("Invalid path")
	}
	if strings.HasPrefix(path, "/") {
		return "", newError("Absolute paths not allowed")
	}

	// Block access to .git internals: reject any segment equal to ".git".
	normalized := strings.ReplaceAll(path, "\\", "/")
	for _, part := range strings.Split(normalized, "/") {
		if part == ".git" {
			return "", newError("Access to .git directory is not allowed")
		}
	}
	// .vantage is vantage's own machine-to-machine state, hidden from every
	// listing and search. Hiding it from listings but still serving it by direct
	// path left it fetchable — and openable as a "document" to annotate — by
	// anyone who typed the path.
	if ignore.IsAlwaysIgnored(normalized) {
		return "", newError("Access to .vantage directory is not allowed")
	}

	full := filepath.Clean(filepath.Join(root, normalized))
	if !within(root, full) {
		return "", newError("Path traversal detected")
	}
	if !containedAfterSymlinks(root, full) {
		// Deliberately the same detail as the lexical rejection: the client
		// learns its path was refused, not whether a symlink exists there or
		// where it points.
		return "", newError("Path traversal detected")
	}
	return full, nil
}

// containedAfterSymlinks reports whether full still resolves inside root once
// symlinks are followed.
//
// full may not exist yet, so this walks up to the nearest existing ancestor and
// resolves that. The unresolved remainder is safe to ignore: full has already
// been cleaned and lexically contained, so it holds no ".." to climb with.
//
// Containment must be *proved*, so anything that leaves it unknown — a broken
// symlink, a permission error, a resolution loop — is refused.
func containedAfterSymlinks(root, full string) bool {
	resolvedRoot := root
	if r, err := filepath.EvalSymlinks(root); err == nil {
		resolvedRoot = r
	}

	probe := full
	for {
		if _, err := os.Lstat(probe); err == nil {
			break
		}
		parent := filepath.Dir(probe)
		if parent == probe {
			return false
		}
		probe = parent
	}

	resolved, err := filepath.EvalSymlinks(probe)
	if err != nil {
		return false
	}
	return within(resolvedRoot, resolved)
}

// within reports whether p is root itself or lies beneath it.
func within(root, p string) bool {
	rel, err := filepath.Rel(root, p)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
