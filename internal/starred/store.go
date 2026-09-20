package starred

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/mschulkind-oss/vantage/internal/config"
)

// dirName is the subdirectory of the user config dir holding one file per root.
const dirName = "starred"

// Store reads and writes the single JSON file backing one root's bookmarks.
//
// One mutex, not the review store's shard array: a Store owns exactly one file,
// so there is nothing to shard. The mutex serializes this process's
// read-modify-writes; [lockFile] serializes them against other processes.
type Store struct {
	mu   sync.Mutex
	root string
	path string

	// now is the clock StarredAt is stamped from, injectable so tests can
	// assert an exact timestamp.
	now func() time.Time
}

// file is the on-disk document. Root is recorded so a hash collision — or a
// hand-edited file — is detectable rather than silently merging two roots'
// lists.
type file struct {
	Root    string  `json:"root"`
	Entries []Entry `json:"entries"`
}

// FileName returns the store file's path relative to the user config dir:
// "starred/<first 16 hex of sha256(root)>.json".
//
// Hashing rather than flattening the root keeps the name bounded on a deeply
// nested path; 64 bits makes a collision negligible, and the Root field inside
// the file catches the one that happens anyway.
func FileName(root string) string {
	sum := sha256.Sum256([]byte(NormalizeRoot(root)))
	return filepath.Join(dirName, hex.EncodeToString(sum[:])[:16]+".json")
}

// NormalizeRoot returns the canonical form of a launch root for this platform.
//
// The root is only ever used as an identity — hashed into a filename, and
// compared against the one recorded in the file — so it has to answer "is this
// the same directory?" the way the filesystem does. On darwin and windows the
// default filesystems are case-insensitive, so /Users/me/Docs and
// /Users/me/docs are one directory that Resolve hands back as two different
// strings (it makes the path absolute and follows symlinks, neither of which
// touches case). Hashing those unchanged would hand the same project two
// bookmark lists depending on how its path was typed — exactly the "where did
// my bookmarks go" this feature exists to prevent.
//
// Linux is left alone: there those really are two directories, and folding
// case would merge two projects' lists into one, which is the worse failure.
func NormalizeRoot(root string) string {
	return normalizeRoot(runtime.GOOS, root)
}

// normalizeRoot is [NormalizeRoot] with the platform passed in, so every branch
// is reachable from a test on any host — the seam internal/config uses for the
// same reason.
func normalizeRoot(goos, root string) string {
	switch goos {
	case "darwin", "windows":
		return strings.ToLower(root)
	default:
		return root
	}
}

// RootKey returns the storage key for cfg.
//
// Serve mode keys on TargetRepo, which Resolve has already made absolute and
// symlink-free — for a bare `vantage` that is the directory it was launched in,
// so relaunching there restores the same bookmarks on any port.
//
// Daemon mode keys on the config file instead. Keying on the working directory
// would be worse than it looks: config.Defaults leaves TargetRepo at "." and
// LoadDaemonFile never clears it, so a daemon under `systemctl --user` resolves
// it to "/" and every daemon on the machine would share one bookmark file,
// while a daemon restarted from a different shell would silently get another.
// The config path is stable, unique per daemon, and independent of both the
// working directory and the port.
func RootKey(cfg *config.Config) (string, error) {
	if cfg == nil {
		return "", errors.New("starred: nil config")
	}
	if cfg.MultiRepo {
		if cfg.ConfigPath != "" {
			return cfg.ConfigPath, nil
		}
		// A daemon configured without a file (tests, embedded use) still needs
		// a key; the resolved TargetRepo is the best remaining answer.
	}
	if cfg.TargetRepo == "" {
		return "", errors.New("starred: config has no resolved root")
	}
	return cfg.TargetRepo, nil
}

// NewStore returns a Store for root backed by filePath. The parent directory is
// created lazily on the first save, so it need not exist yet.
//
// The root is canonicalized on the way in (see [NormalizeRoot]) so the name it
// hashes to and the value compared against the file's own Root field are the
// same string — normalizing only one of the two would make a re-typed path
// open the right file and then reject it as another project's.
func NewStore(root, filePath string) *Store {
	return &Store{root: NormalizeRoot(root), path: filePath, now: time.Now}
}

// DefaultStore returns a Store for root whose file is resolved through
// [config.UserFilePath], which already handles the XDG location and the darwin
// legacy fallback.
func DefaultStore(root string) (*Store, error) {
	p, err := config.UserFilePath(FileName(root))
	if err != nil {
		return nil, fmt.Errorf("starred: resolving store path: %w", err)
	}
	return NewStore(root, p), nil
}

// Root returns the launch root this Store is keyed by.
func (s *Store) Root() string { return s.root }

// Path returns the JSON file this Store reads and writes.
func (s *Store) Path() string { return s.path }

// List returns the bookmarks, sorted.
//
// A missing file and a corrupt one both yield an empty list — the review
// store's contract, so one bad record never breaks the endpoint. Only an
// unexpected I/O failure surfaces as an error.
func (s *Store) List() ([]Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := s.loadLocked()
	if err != nil {
		return nil, err
	}
	return f.Entries, nil
}

// Add stores e and returns the resulting list.
//
// It is idempotent: an existing (Repo, Path) keeps its original StarredAt and
// only refreshes IsDir, which is also how a bookmark whose target changed kind
// heals itself the next time it is starred.
func (s *Store) Add(e Entry) ([]Entry, error) {
	if err := ValidateEntry(e); err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	unlock, err := s.acquireFileLock()
	if err != nil {
		return nil, err
	}
	defer unlock()

	f, err := s.loadLocked()
	if err != nil {
		return nil, err
	}

	for i := range f.Entries {
		if f.Entries[i].Repo == e.Repo && f.Entries[i].Path == e.Path {
			f.Entries[i].IsDir = e.IsDir
			if err := s.saveLocked(f); err != nil {
				return nil, err
			}
			return f.Entries, nil
		}
	}

	if len(f.Entries) >= MaxEntries {
		return nil, fmt.Errorf("%w: at most %d bookmarks", ErrTooMany, MaxEntries)
	}

	e.StarredAt = s.now().UTC()
	f.Entries = append(f.Entries, e)
	SortEntries(f.Entries)
	if err := s.saveLocked(f); err != nil {
		return nil, err
	}
	return f.Entries, nil
}

// Remove drops (repo, path) and returns the resulting list plus whether
// anything was removed. false with a nil error is the 404 the handler maps.
func (s *Store) Remove(repo, path string) ([]Entry, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	unlock, err := s.acquireFileLock()
	if err != nil {
		return nil, false, err
	}
	defer unlock()

	f, err := s.loadLocked()
	if err != nil {
		return nil, false, err
	}

	kept := make([]Entry, 0, len(f.Entries))
	removed := false
	for _, e := range f.Entries {
		if e.Repo == repo && e.Path == path {
			removed = true
			continue
		}
		kept = append(kept, e)
	}
	if !removed {
		return f.Entries, false, nil
	}

	f.Entries = kept
	if err := s.saveLocked(f); err != nil {
		return nil, false, err
	}
	return f.Entries, true, nil
}

// loadLocked reads and sorts the store file. Callers must hold s.mu.
func (s *Store) loadLocked() (*file, error) {
	empty := &file{Root: s.root, Entries: []Entry{}}

	raw, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return empty, nil
		}
		return nil, err
	}

	var f file
	if err := json.Unmarshal(raw, &f); err != nil {
		slog.Warn("starred: unreadable store file, treating as empty", "path", s.path, "error", err)
		return empty, nil
	}
	// A file written for another root means the hash collided or someone edited
	// it by hand. Never merge: that would show one project's bookmarks in
	// another.
	if f.Root != "" && f.Root != s.root {
		slog.Warn("starred: store file belongs to another root, treating as empty",
			"path", s.path, "want", s.root, "got", f.Root)
		return empty, nil
	}
	if f.Entries == nil {
		f.Entries = []Entry{}
	}
	f.Root = s.root
	SortEntries(f.Entries)
	return &f, nil
}

// saveLocked writes f atomically: a temp file in the same directory, then a
// rename into place, so a reader never observes a half-written file. Callers
// must hold s.mu.
func (s *Store) saveLocked(f *file) error {
	dir := filepath.Dir(s.path)
	// config.UserFilePath resolves a path; it does not create directories.
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	encoded, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, "*.tmp")
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
	if err := renameWithRetry(tmpName, s.path); err != nil {
		return err
	}
	cleanup = false
	return nil
}

// renameRetries and renamePause bound the replace-in-place retry below. The
// whole window is under a tenth of a second, so a genuinely permanent failure
// still surfaces promptly.
const (
	renameRetries = 5
	renamePause   = 15 * time.Millisecond
)

// renameWithRetry replaces dst with src, retrying briefly.
//
// The retry is there for Windows. Go opens files with FILE_SHARE_READ |
// FILE_SHARE_WRITE and not FILE_SHARE_DELETE, so a reader that merely has the
// store file open — another vantage answering GET /starred, an indexer, an
// antivirus scanning the file we just wrote — makes MoveFileEx fail with a
// sharing violation. Those holders let go in milliseconds, and the lock file
// does not help: it serializes writers against each other, while this is a
// reader in the way.
//
// On unix a rename is atomic and cannot be blocked this way, so the loop just
// never runs a second time.
func renameWithRetry(src, dst string) error {
	var err error
	for attempt := range renameRetries {
		if err = os.Rename(src, dst); err == nil {
			return nil
		}
		if attempt < renameRetries-1 {
			time.Sleep(renamePause)
		}
	}
	return err
}
