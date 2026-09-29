package planning

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	iofs "io/fs"
	"math"
	"os"
	"path/filepath"
	"unicode/utf8"

	"github.com/mschulkind-oss/vantage/internal/pathsafe"
)

// The kinds of answer for one path. They are also the single-path mode's `kind`
// values, so the wire and this package spell them one way.
const (
	KindFile       = "file"
	KindSkipped    = "skipped"
	KindUnreadable = "unreadable"
	KindAbsent     = "absent"
)

// Reasons a file could not be read. These reach the planning page's
// *Could not read* list, so each says what is wrong with the file in words a
// reader can act on, and none carries an absolute path.
const (
	reasonNotUTF8    = "not UTF-8"
	reasonNotRegular = "not a regular file"
	reasonOutside    = "outside the repository"
	reasonOtherPath  = "its name reads as a different path"
)

// read is the outcome of reading one candidate.
type read struct {
	kind    string
	content string // KindFile only
	hash    string // KindFile only: [contentHash] of content
	size    int64  // KindSkipped only
	reason  string // KindUnreadable only
}

// contentHash is the design's *content hash* of a file's bytes: the first 128
// bits of SHA-256, as 32 lowercase hex digits. The browser keeps each file's
// scan result under it and names it back in the stream's `have`, so the two
// sides must spell it one way. Design: docs/design/planning-index-at-scale.md §3.
//
// Only a file read whole has one. A skipped file was never opened, and an
// unreadable one has no text a scan could be kept for.
func contentHash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:16])
}

// openFile is os.Open, replaceable in tests so they can prove what was never
// opened — the refusal and the size limit both promise that — without relying
// on permissions, which a test running as root does not have.
var openFile = os.Open

// reader reads candidates under one root, within one size limit.
type reader struct {
	root     string
	maxBytes int64
}

func newReader(root string, maxBytes int64) *reader {
	return &reader{root: root, maxBytes: maxBytes}
}

// read reads the candidate at rel, refusing what a planning source cannot be.
//
// Containment is proved by [pathsafe.Resolve], the rule `/content` uses. The
// file must then be a regular file by Lstat, which refuses a symlink even to a
// file inside the repository: the listing never yields one, so neither does
// this. Size is decided from that stat, so an oversized file is never opened.
// After opening, the handle is stat'ed again, and the read is capped one byte
// past the limit, so a file that grew in between is skipped rather than read
// whole. Finally the bytes must be UTF-8, the test `ReadFile` applies. A file
// that passes comes back with its [contentHash], taken over exactly the bytes
// returned.
//
// A file that no longer exists is KindAbsent. Anything else that goes wrong is
// KindUnreadable: a file that exists and cannot be read is never "absent",
// because the planning page lists unreadable files and says nothing of absent
// ones.
func (r *reader) read(rel string) read {
	full, err := pathsafe.Resolve(r.root, rel)
	if err != nil {
		return read{kind: KindUnreadable, reason: reasonOutside}
	}
	// pathsafe reads a backslash as a separator and cleans the result, so on
	// POSIX, where a backslash is an ordinary file-name character, a listed
	// name like `x\..\.private\notes.md` resolves to a different file. The
	// file read must be the file listed, or a name could serve any other
	// file's text, one the listing hides included, as its own.
	if got, err := filepath.Rel(r.root, full); err != nil || filepath.ToSlash(got) != rel {
		return read{kind: KindUnreadable, reason: reasonOtherPath}
	}

	info, err := os.Lstat(full)
	if err != nil {
		return failed(err)
	}
	if !info.Mode().IsRegular() {
		return read{kind: KindUnreadable, reason: reasonNotRegular}
	}
	if info.Size() > r.maxBytes {
		return read{kind: KindSkipped, size: info.Size()}
	}

	f, err := openFile(full)
	if err != nil {
		return failed(err)
	}
	defer func() { _ = f.Close() }()

	fi, err := f.Stat()
	if err != nil {
		return failed(err)
	}
	if !fi.Mode().IsRegular() {
		return read{kind: KindUnreadable, reason: reasonNotRegular}
	}
	if fi.Size() > r.maxBytes {
		return read{kind: KindSkipped, size: fi.Size()}
	}

	// One byte past the limit shows a file that grew; at the largest limit
	// the config accepts, that byte would overflow to a negative count.
	data, err := io.ReadAll(io.LimitReader(f, min(r.maxBytes, math.MaxInt64-1)+1))
	if err != nil {
		return failed(err)
	}
	if int64(len(data)) > r.maxBytes {
		return read{kind: KindSkipped, size: max(fi.Size(), int64(len(data)))}
	}
	if !utf8.Valid(data) {
		return read{kind: KindUnreadable, reason: reasonNotUTF8}
	}
	return read{kind: KindFile, content: string(data), hash: contentHash(data)}
}

// failed maps a filesystem error to its answer: a missing file is absent, and
// anything else is unreadable with the error's own words and not its path.
func failed(err error) read {
	if errors.Is(err, iofs.ErrNotExist) {
		return read{kind: KindAbsent}
	}
	if errors.Is(err, iofs.ErrPermission) {
		return read{kind: KindUnreadable, reason: "permission denied"}
	}
	var pe *iofs.PathError
	if errors.As(err, &pe) {
		return read{kind: KindUnreadable, reason: pe.Err.Error()}
	}
	return read{kind: KindUnreadable, reason: err.Error()}
}
