// Package starred persists the user's bookmarked files and directories.
//
// The list is keyed by the vantage *invocation*, not by repository: in serve
// mode that is the resolved single-repo root (the directory vantage was
// launched in), and in daemon mode it is the daemon config file's path. One
// stored list can therefore span repositories, which is why every entry carries
// its own repo name. See [RootKey] for why the daemon does not key on its
// working directory.
//
// On-disk layout: one JSON file per root under a base directory (in production
// ~/.local/share/vantage/starred, resolved by [config.DataFilePath]), named after
// that root. One file per root means two vantage processes serving different
// roots never touch the same file.
//
// The DATA directory and not the config one: a bookmark is content the user made,
// not a setting they wrote, which is the same call [config.ReviewDir] makes for
// the same reason — and it keeps these files out of the tree dotfile managers
// sync, where a list keyed by one machine's absolute paths is noise on another.
//
// The root is canonicalized for the platform before it is hashed, because it is
// an identity and has to answer "same directory?" the way the filesystem does —
// see [NormalizeRoot]. Writes are a temp file plus a replace, with a short
// retry that exists for Windows; see renameWithRetry.
//
// Two deliberate non-goals:
//
//   - Bookmarks are never validated against the filesystem. A bookmark whose
//     target has been deleted must still round-trip, because offering to remove
//     it is precisely what the viewer does when the target fails to load. The
//     same applies to a daemon repository that has been retired: its bookmarks
//     stay listed, and clicking one lands in the viewer's error notice, which
//     offers to delete it — the viewer takes the (repo, path) for that offer
//     from the route rather than from its repo store, which by then has
//     deselected the missing repo.
//   - A second vantage process on the *same* root is serialized by the lock
//     file but does not push to the first process's browsers, so those see a
//     stale list until they reload. Two processes on one root is an unusual
//     setup, and an mtime poller is not worth its weight.
package starred

import (
	"errors"
	"fmt"
	"path"
	"sort"
	"strings"
	"time"
)

// Entry is one bookmark.
//
// Repo is "" in single-repo mode — the same sentinel [api.RepoServices] and the
// review store key on — and the {repo} URL segment in daemon mode. It is
// deliberately not omitempty: a reader must see "repo": "" and know it means
// the lone repository, rather than wonder whether the field was dropped.
type Entry struct {
	Repo      string    `json:"repo"`
	Path      string    `json:"path"`
	IsDir     bool      `json:"is_dir"`
	StarredAt time.Time `json:"starred_at"`
}

// ErrInvalid is the sentinel every shape rejection unwraps to, so handlers can
// map the whole family to one status with errors.Is.
var ErrInvalid = errors.New("starred: invalid bookmark")

// ErrTooMany is returned when a new bookmark would exceed [MaxEntries].
var ErrTooMany = errors.New("starred: too many bookmarks")

const (
	// MaxPathLen bounds a bookmark's repo-relative path.
	MaxPathLen = 1024
	// MaxRepoLen bounds a bookmark's repository name.
	MaxRepoLen = 128
	// MaxEntries caps one root's list. It exists so a pathological list cannot
	// be produced at all: the sidebar renders the whole section inline, with no
	// scroller of its own.
	MaxEntries = 500
)

// ValidateEntry checks the shape of a bookmark.
//
// It is lexical and never touches the filesystem. That is why it does not call
// pathsafe.Resolve, which proves physical containment and refuses anything it
// cannot resolve: that would reject exactly the deleted-target bookmark this
// package exists to round-trip. Do not consolidate the two.
//
// The path.Clean equality check is what rejects "..", "./", "//" and a trailing
// slash in one step; the explicit segment scan then covers the names that are
// lexically clean but must never be reachable.
func ValidateEntry(e Entry) error {
	if len(e.Repo) > MaxRepoLen {
		return fmt.Errorf("%w: repo name too long", ErrInvalid)
	}
	if strings.ContainsAny(e.Repo, "/\\\x00") {
		return fmt.Errorf("%w: repo name must not contain separators", ErrInvalid)
	}

	p := e.Path
	if p == "" {
		return fmt.Errorf("%w: path is required", ErrInvalid)
	}
	if p == "." {
		return fmt.Errorf("%w: the repository root cannot be bookmarked", ErrInvalid)
	}
	if len(p) > MaxPathLen {
		return fmt.Errorf("%w: path too long", ErrInvalid)
	}
	if strings.ContainsRune(p, '\x00') {
		return fmt.Errorf("%w: path contains a NUL byte", ErrInvalid)
	}
	if strings.HasPrefix(p, "/") || strings.HasPrefix(p, `\`) {
		return fmt.Errorf("%w: absolute paths are not allowed", ErrInvalid)
	}
	// A Windows drive prefix ("C:...") is absolute in spirit and never a
	// repo-relative path.
	if len(p) >= 2 && p[1] == ':' {
		return fmt.Errorf("%w: absolute paths are not allowed", ErrInvalid)
	}
	if strings.Contains(p, `\`) {
		return fmt.Errorf("%w: path must use forward slashes", ErrInvalid)
	}
	if path.Clean(p) != p {
		return fmt.Errorf("%w: path must be in cleaned form", ErrInvalid)
	}
	for _, seg := range strings.Split(p, "/") {
		switch seg {
		case "..":
			return fmt.Errorf("%w: path traversal is not allowed", ErrInvalid)
		case ".git":
			return fmt.Errorf("%w: the .git directory cannot be bookmarked", ErrInvalid)
		case ".vantage":
			// vantage's own machine-to-machine state, hidden from every listing
			// and refused by pathsafe. It must not be reachable as a bookmark
			// either.
			return fmt.Errorf("%w: the .vantage directory cannot be bookmarked", ErrInvalid)
		}
	}
	return nil
}

// SortEntries orders es by (Repo, Path), in place.
//
// Sorting server-side and by name — rather than by StarredAt, and rather than
// in each client — buys three things: re-starring an item never makes it jump,
// two browsers render the same order after the same broadcast, and daemon-mode
// lists group by repository the way the project picker does. StarredAt is still
// persisted, so a "most recent" ordering can be added later without a
// migration.
func SortEntries(es []Entry) {
	sort.SliceStable(es, func(i, j int) bool {
		if es[i].Repo != es[j].Repo {
			return es[i].Repo < es[j].Repo
		}
		return es[i].Path < es[j].Path
	})
}
