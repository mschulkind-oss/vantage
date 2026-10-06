// Package spaceid reads a checkout's space id: a name coined for this feature,
// for one random id per checkout, kept as the single line of
// <checkout>/.vantage/space. `vantage-check index --filter` makes the file the
// first time it prints a planning link and puts the id in the link as `space=`,
// so a Vantage serving many projects can open the one the link was made in
// without the checker knowing the name the server gives it. Reference:
// docs/reference/planning-index.md §13.6.
//
// The server only ever reads the file. It never makes one, never rewrites one,
// and parses nothing in the checkout but this one line.
//
// The id's pattern and the file's reading are vantage-md's too
// (packages/vantage-md/src/planning/space.ts), and testdata/space-files.json
// holds the two readers to the same answer for every text in it.
package spaceid

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// FileRel is where a checkout keeps its space id, slash-separated and
// relative to the checkout's root. vantage-md's PLANNING_SPACE_FILE.
const FileRel = ".vantage/space"

// Length is how many characters a space id has: 80 random bits, five to a
// character. vantage-md's PLANNING_SPACE_ID_LENGTH.
const Length = 16

// maxFileBytes caps what is read: the id and its newline are 17 bytes, so a
// bigger file holds no id and is not opened. vantage-check's cap is the same.
const maxFileBytes = 64

// pattern is lowercase RFC 4648 base32, exactly [Length] characters.
// vantage-md's PLANNING_SPACE_ID_PATTERN.
var pattern = regexp.MustCompile(`^[a-z2-7]{16}$`)

// Valid reports whether id is a space id. A caller checks this before it
// looks for an id anywhere, so a request naming anything else touches nothing.
func Valid(id string) bool { return pattern.MatchString(id) }

// Parse returns the space id a .vantage/space file's whole text holds, and
// false when it holds none. The file is the id and one newline: one trailing
// "\n" is dropped, and a "\r" before it, and what is left is taken only when it
// is a space id whole. White space around the id, a second line, or a byte
// order mark is no id.
func Parse(data []byte) (string, bool) {
	text := string(data)
	if line, ok := strings.CutSuffix(text, "\n"); ok {
		text = strings.TrimSuffix(line, "\r")
	}
	if !Valid(text) {
		return "", false
	}
	return text, true
}

// File is one checkout's .vantage/space, re-read only when it changes.
//
// Every [File.ID] stats the file, and reads it again only when the stat says it
// is another file than the one last read: another size, another modification
// time, or another inode, which is what a rename into place leaves even within
// one tick of a coarse clock. A lookup is rare (one per planning link opened),
// so there is no throttle and no watcher: the answer is never older than the
// request asking for it.
//
// Safe for concurrent use.
type File struct {
	path string

	mu   sync.Mutex
	info os.FileInfo // what the last read saw; nil when nothing was read
	id   string
	ok   bool
}

// New returns the File for the checkout rooted at root. Nothing is read until
// [File.ID] is called.
func New(root string) *File {
	return &File{path: filepath.Join(root, filepath.FromSlash(FileRel))}
}

// Path returns the file this File reads.
func (f *File) Path() string { return f.path }

// ID returns the space id the file holds now, and false when there is no file,
// when it is not a regular file (a symlink is not followed), when it is larger
// than any id, or when it holds no id ([Parse]).
func (f *File) ID() (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()

	info, err := os.Lstat(f.path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxFileBytes {
		f.info, f.id, f.ok = nil, "", false
		return "", false
	}
	if f.info != nil && os.SameFile(f.info, info) &&
		f.info.Size() == info.Size() && f.info.ModTime().Equal(info.ModTime()) {
		return f.id, f.ok
	}
	data, err := read(f.path)
	if err != nil {
		f.info, f.id, f.ok = nil, "", false
		return "", false
	}
	f.info = info
	f.id, f.ok = Parse(data)
	return f.id, f.ok
}

// read is how [File.ID] reads the file: [readSmall], which a test replaces to
// count the reads.
var read = readSmall

// readSmall reads path when it is still a regular file once opened, and no
// more of it than one byte past [maxFileBytes]: the Lstat and the open are two
// calls, and the file can have been replaced between them.
func readSmall(path string) ([]byte, error) {
	fh, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = fh.Close() }()
	info, err := fh.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("spaceid: not a regular file")
	}
	data, err := io.ReadAll(io.LimitReader(fh, maxFileBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxFileBytes {
		return nil, errors.New("spaceid: larger than any space id")
	}
	return data, nil
}
