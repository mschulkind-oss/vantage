package config

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/BurntSushi/toml"
)

// SourceDirsEdit reports what [AddSourceDirs] did to a config file.
type SourceDirsEdit struct {
	// Path is the config file written (or, when nothing was added, left alone),
	// as the caller named it.
	Path string
	// Target is the file behind Path when Path is a symlink — a config kept in
	// a dotfiles repository, say — which is the file actually edited, or ""
	// when Path is the file itself.
	Target string
	// Created is true when there was no file and one was written.
	Created bool
	// Added are the entries appended to source_dirs, as written.
	Added []string
	// Present are the requested directories source_dirs already held, as the
	// file spells them.
	Present []string
	// Backup is the copy of the original written before a rewrite that could
	// not keep the file's text, or "" when the edit was made in place.
	Backup string
}

// Changed reports whether the file was written.
func (e SourceDirsEdit) Changed() bool { return e.Created || len(e.Added) > 0 }

// sourceDirsHeader opens a config file AddSourceDirs creates.
const sourceDirsHeader = `# Vantage daemon configuration, created by ` + "`vantage install-service --source-dir`" + `.
# Each directory in source_dirs is scanned for git repositories, and each one
# is served as its own project. ` + "`vantage init-config --path <file>`" + ` writes an
# annotated example of every other setting.

`

// createdPortLines fix the port in a config AddSourceDirs creates. A daemon
// whose port is only the default moves to the next free one when that is busy
// — as it is when the `vantage serve` that printed the tip suggesting
// install-service is still running — and a service that moved is one neither
// serve's tip nor install-service looks for. A port written down makes the
// daemon wait for it instead: it exits, and the service manager starts it
// again until the port is free.
var createdPortLines = fmt.Sprintf("# Written down, so that the service waits for this port when it is busy\n"+
	"# instead of moving to another one.\nport = %d\n", Defaults().Port)

// AddSourceDirs adds each of dirs to the top-level source_dirs of the TOML
// config at path, creating the file when it does not exist. Each directory has
// ~ and a relative path expanded and symlinks resolved, must exist, and is
// dropped when source_dirs already names it (however it is spelled there).
// Directories under home are written as ~/…, the form the file is edited in.
//
// Nothing in the file is lost. The edit is made to its text — appending to the
// existing array, or inserting the key before the first table — so comments,
// ordering and every other key survive byte for byte, and the result is decoded
// again to prove every other key still means what it meant. When that is not
// possible (the key is spelled in a form the edit does not rewrite, or the proof
// fails), the original is first copied to "<path>.bak-<now>", the file is
// rewritten from its decoded values, and Backup says where the copy went. The
// rewrite has to pass the same proof — the encoder is not faithful to every
// value — and one that does not is refused, with the file left as it was.
func AddSourceDirs(path string, dirs []string, now time.Time) (SourceDirsEdit, error) {
	return AddSourceDirsChecked(path, dirs, now, nil)
}

// AddSourceDirsChecked is [AddSourceDirs] that first hands check the path of
// the edited file, written beside the config but not yet in its place, and
// replaces the config — making any backup — only when check returns nil. A
// refused edit changes nothing: an existing config stays byte for byte as it
// was, and a missing one stays missing. install-service checks that the
// result would start the daemon, so a mistaken run leaves no entry behind for
// a later run to keep.
func AddSourceDirsChecked(path string, dirs []string, now time.Time, check func(candidate string) error) (SourceDirsEdit, error) {
	edit := SourceDirsEdit{Path: path}
	home, _ := os.UserHomeDir()
	if resolved, err := filepath.EvalSymlinks(home); err == nil {
		home = resolved
	}

	wanted := make([]string, 0, len(dirs))
	for _, d := range dirs {
		abs, err := resolvePath(d)
		if err != nil {
			return edit, err
		}
		// The name is checked before the directory: it is refused whether or
		// not the directory is there, and on macOS it never can be, because
		// APFS refuses to create a name that is not UTF-8.
		if !utf8.ValidString(abs) {
			return edit, fmt.Errorf("config: source dir %q is not valid UTF-8, which a TOML file cannot hold", d)
		}
		if info, err := os.Stat(abs); err != nil || !info.IsDir() {
			return edit, fmt.Errorf("config: source dir %q is not a directory", d)
		}
		wanted = append(wanted, abs)
	}

	// Edit the file behind a link, never the link: replacing a link into a
	// dotfiles repository with a file would leave the dotfile without the
	// entry, and change the path the daemon keys its bookmarks on.
	file, err := followLinks(path)
	if err != nil {
		return edit, err
	}
	if file != path {
		edit.Target = file
	}
	named := func() string {
		if edit.Target != "" {
			return fmt.Sprintf("%s, a link to %s,", path, file)
		}
		return path
	}

	original, err := os.ReadFile(file)
	if errors.Is(err, os.ErrNotExist) {
		edit.Created = true
		original = nil
	} else if err != nil {
		return edit, fmt.Errorf("config: reading %s: %w", file, err)
	} else if err := checkWritable(file); err != nil {
		return edit, fmt.Errorf("config: %s cannot be written (%w); add source_dirs there by hand", named(), err)
	}

	before := map[string]any{}
	if _, err := toml.Decode(string(original), &before); err != nil {
		return edit, fmt.Errorf("config: decoding %s: %w", path, err)
	}
	existing, err := stringList(before["source_dirs"])
	if err != nil {
		return edit, fmt.Errorf("config: %s: source_dirs %w", path, err)
	}

	// Each directory source_dirs names, however it is spelled there: by the
	// path it resolves to, and by what it is (see [dirSet]), since on macOS
	// ~/Code and ~/code are one directory that resolves to two strings.
	type listed struct {
		dir     dirSet
		spelled string
	}
	var seen []listed
	spelling := func(p string) (string, bool) {
		for _, n := range seen {
			if n.dir.holds(p) {
				return n.spelled, true
			}
		}
		return "", false
	}
	remember := func(p, spelled string) {
		n := listed{spelled: spelled}
		n.dir.add(p)
		seen = append(seen, n)
	}
	for _, e := range existing {
		if p, err := resolvePath(e); err == nil {
			remember(p, e)
		}
	}
	for _, w := range wanted {
		if spelled, ok := spelling(w); ok {
			if !slices.Contains(edit.Present, spelled) && !slices.Contains(edit.Added, spelled) {
				edit.Present = append(edit.Present, spelled)
			}
			continue
		}
		entry := homeRelative(w, home)
		remember(w, entry)
		edit.Added = append(edit.Added, entry)
	}
	if len(edit.Added) == 0 && !edit.Created {
		return edit, nil
	}

	var next []byte
	if edit.Created {
		next = []byte(sourceDirsHeader + createdPortLines + "source_dirs = " + tomlStringArray(edit.Added) + "\n")
		// The same proof an edit gets: what was written reads back as meant.
		created := map[string]any{"port": int64(Defaults().Port)}
		if !sameApartFromSourceDirs(created, next, edit.Added) {
			return edit, fmt.Errorf("config: the new %s would not read back as written", path)
		}
	} else {
		next, err = editSourceDirsText(original, edit.Added)
		if err == nil && !sameApartFromSourceDirs(before, next, append(existing, edit.Added...)) {
			err = errors.New("the edited file does not decode to the same settings")
		}
		if err != nil {
			edit.Backup = fmt.Sprintf("%s.bak-%s", file, now.Format("20060102-150405"))
			before["source_dirs"] = append(existing, edit.Added...)
			var buf bytes.Buffer
			buf.WriteString("# Rewritten by `vantage install-service --source-dir`; the original,\n")
			buf.WriteString("# comments included, is " + filepath.Base(edit.Backup) + ".\n\n")
			if eerr := encodeSettings(&buf, before); eerr != nil {
				return edit, fmt.Errorf("config: encoding %s: %w", path, eerr)
			}
			next = buf.Bytes()
			// The rewrite gets the proof the edit did: the encoder moves a local
			// time through the time zone, and nothing but the entries may change.
			if !sameApartFromSourceDirs(before, next, append(existing, edit.Added...)) {
				return edit, fmt.Errorf("config: %s cannot be rewritten without changing another of its settings, "+
					"so add source_dirs to it by hand", named())
			}
		}
	}

	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return edit, fmt.Errorf("config: creating %s: %w", filepath.Dir(file), err)
	}
	tmp, err := stageFile(file, next)
	if err != nil {
		if edit.Target != "" {
			return edit, fmt.Errorf("%w; %s is a link to it, so add source_dirs there by hand", err, path)
		}
		return edit, err
	}
	defer os.Remove(tmp) // gone already once it is renamed into place
	if check != nil {
		if err := check(tmp); err != nil {
			return edit, err
		}
	}
	if edit.Backup != "" {
		if err := os.WriteFile(edit.Backup, original, 0o600); err != nil {
			return edit, fmt.Errorf("config: backing up %s: %w", file, err)
		}
	}
	// A crash before this leaves the old config, never half of a new one.
	if err := os.Rename(tmp, file); err != nil {
		return edit, fmt.Errorf("config: writing %s: %w", file, err)
	}
	return edit, nil
}

// followLinks returns the file path names once every symlink along the way is
// followed — to where it points even when nothing is there yet, so that a link
// to a file still to be written gets that file. A path with no link is
// returned as it is.
func followLinks(path string) (string, error) {
	p := path
	for hops := 0; ; hops++ {
		info, err := os.Lstat(p)
		if err != nil || info.Mode()&os.ModeSymlink == 0 {
			return p, nil
		}
		if hops == 40 {
			return "", fmt.Errorf("config: %s: too many levels of symbolic links", path)
		}
		dest, err := os.Readlink(p)
		if err != nil {
			return "", fmt.Errorf("config: reading the link %s: %w", p, err)
		}
		if !filepath.IsAbs(dest) {
			dest = filepath.Join(filepath.Dir(p), dest)
		}
		p = dest
	}
}

// checkWritable reports why the existing file at path cannot be written, or
// nil. The edit replaces the file by renaming a new one over it, which only
// the directory's permissions govern, so a file made read-only on purpose —
// or one in a read-only store — would be replaced without this check.
func checkWritable(path string) error {
	f, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return err
	}
	return f.Close()
}

// stringList reads a decoded TOML value as a list of strings; nil is empty.
func stringList(v any) ([]string, error) {
	if v == nil {
		return nil, nil
	}
	items, ok := v.([]any)
	if !ok {
		return nil, fmt.Errorf("must be an array of strings, got %T", v)
	}
	out := make([]string, 0, len(items))
	for _, it := range items {
		s, ok := it.(string)
		if !ok {
			return nil, fmt.Errorf("must be an array of strings, got an element of type %T", it)
		}
		out = append(out, s)
	}
	return out, nil
}

// encodeSettings writes decoded settings as TOML: the rewrite a config falls
// back to. A variable so that a test can hand the check an unfaithful one.
var encodeSettings = func(w io.Writer, v map[string]any) error {
	return toml.NewEncoder(w).Encode(v)
}

// sameApartFromSourceDirs decodes next and reports whether it holds exactly
// the settings before did, with source_dirs equal to want.
func sameApartFromSourceDirs(before map[string]any, next []byte, want []string) bool {
	after := map[string]any{}
	if _, err := toml.Decode(string(next), &after); err != nil {
		return false
	}
	got, err := stringList(after["source_dirs"])
	if err != nil || !reflect.DeepEqual(got, want) {
		return false
	}
	delete(after, "source_dirs")
	rest := make(map[string]any, len(before))
	for k, v := range before {
		if k != "source_dirs" {
			rest[k] = v
		}
	}
	return sameValue(rest, after)
}

// sameValue is reflect.DeepEqual for decoded TOML, except that NaN equals NaN:
// a file holding one must still be able to prove it is unchanged.
func sameValue(a, b any) bool {
	switch av := a.(type) {
	case float64:
		bv, ok := b.(float64)
		return ok && (av == bv || (math.IsNaN(av) && math.IsNaN(bv)))
	case map[string]any:
		bv, ok := b.(map[string]any)
		if !ok || len(av) != len(bv) {
			return false
		}
		for k, v := range av {
			w, ok := bv[k]
			if !ok || !sameValue(v, w) {
				return false
			}
		}
		return true
	case []map[string]any:
		bv, ok := b.([]map[string]any)
		if !ok || len(av) != len(bv) {
			return false
		}
		for i := range av {
			if !sameValue(av[i], bv[i]) {
				return false
			}
		}
		return true
	case []any:
		bv, ok := b.([]any)
		if !ok || len(av) != len(bv) {
			return false
		}
		for i := range av {
			if !sameValue(av[i], bv[i]) {
				return false
			}
		}
		return true
	default:
		return reflect.DeepEqual(a, b)
	}
}

// homeRelative spells p as ~/… when it lies under home.
func homeRelative(p, home string) string {
	if home == "" {
		return p
	}
	if p == home {
		return "~"
	}
	if rest, ok := strings.CutPrefix(p, home+string(filepath.Separator)); ok {
		return "~/" + filepath.ToSlash(rest)
	}
	return p
}

// tomlStringArray renders ss as a one-line TOML array of basic strings.
func tomlStringArray(ss []string) string {
	quoted := make([]string, len(ss))
	for i, s := range ss {
		quoted[i] = tomlString(s)
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}

// tomlString renders s, valid UTF-8, as a TOML basic string. Go's quoting is
// not TOML's: it writes \a and \v, which TOML does not have, and \xHH, which
// TOML reads as a code point rather than a byte.
func tomlString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\t':
			b.WriteString(`\t`)
		case '\n':
			b.WriteString(`\n`)
		case '\f':
			b.WriteString(`\f`)
		case '\r':
			b.WriteString(`\r`)
		default:
			if r < 0x20 || r == 0x7f {
				fmt.Fprintf(&b, `\u%04X`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

// stageFile writes data to a new temp file beside path, with the existing
// file's permissions, and returns its name, for the caller to check and then
// rename over path.
func stageFile(path string, data []byte) (string, error) {
	mode := os.FileMode(0o644)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".config.toml.*")
	if err != nil {
		return "", fmt.Errorf("config: writing %s: %w", path, err)
	}
	fail := func(err error) (string, error) {
		tmp.Close()
		os.Remove(tmp.Name())
		return "", fmt.Errorf("config: writing %s: %w", path, err)
	}
	if _, err := tmp.Write(data); err != nil {
		return fail(err)
	}
	if err := tmp.Chmod(mode); err != nil {
		return fail(err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return "", fmt.Errorf("config: writing %s: %w", path, err)
	}
	return tmp.Name(), nil
}

// editSourceDirsText is the text edit AddSourceDirs makes, a variable so that a
// test can hand it a bad one and see the round-trip check catch it.
var editSourceDirsText = appendSourceDirsText

// errNoInPlaceEdit is returned by appendSourceDirsText when the file's text
// has no form of source_dirs it knows how to extend.
var errNoInPlaceEdit = errors.New("source_dirs is written in a form that cannot be edited in place")

// appendSourceDirsText returns text with added appended to its top-level
// source_dirs array, or — when the text has no such key — with the key
// inserted before the first table header. Everything else is left byte for
// byte as it was.
func appendSourceDirsText(text []byte, added []string) ([]byte, error) {
	sc := tomlScanner{src: text}
	assign, firstTable := sc.findTopLevel("source_dirs")
	if assign.keyStart < 0 {
		if sc.hasTopLevelKeyNamed("source_dirs") {
			// Quoted or otherwise spelled differently: present, but not a
			// form this edit rewrites.
			return nil, errNoInPlaceEdit
		}
		return insertBeforeTable(text, firstTable, "source_dirs = "+tomlStringArray(added)+"\n"), nil
	}
	if assign.open < 0 || assign.close < 0 {
		return nil, errNoInPlaceEdit
	}

	inner := text[assign.open+1 : assign.close]
	lastSig, hasItems, trailingComma := sc.arrayShape(assign.open+1, assign.close)
	var out bytes.Buffer
	if bytes.IndexByte(inner, '\n') < 0 {
		// One line: `[…]` gains `, "dir"` before its bracket.
		out.Write(text[:assign.close])
		for i, a := range added {
			switch {
			case i == 0 && !hasItems:
			case i == 0 && trailingComma:
				out.WriteString(" ")
			default:
				out.WriteString(", ")
			}
			out.WriteString(tomlString(a))
		}
		out.Write(text[assign.close:])
		return out.Bytes(), nil
	}

	// Several lines: one line per new entry, before the closing bracket's line,
	// indented like the first entry that starts a line of its own.
	lineStart := bytes.LastIndexByte(text[:assign.close], '\n') + 1
	indent := arrayItemIndent(text, assign.open, lineStart)
	closingIsAlone := len(bytes.TrimSpace(text[lineStart:assign.close])) == 0
	if !closingIsAlone {
		return nil, errNoInPlaceEdit
	}
	if hasItems && !trailingComma {
		out.Write(text[:lastSig+1])
		out.WriteString(",")
		out.Write(text[lastSig+1 : lineStart])
	} else {
		out.Write(text[:lineStart])
	}
	for _, a := range added {
		out.WriteString(indent + tomlString(a) + ",\n")
	}
	out.Write(text[lineStart:])
	return out.Bytes(), nil
}

// arrayItemIndent is the leading whitespace of the first line of a multi-line
// array that starts with an item — the lines after the one holding its "[" at
// open, up to the closing bracket's line at end — or two spaces when no item
// starts a line. Everything before the first item cannot be the indent: a
// comment can follow "[", and so can the first item.
func arrayItemIndent(text []byte, open, end int) string {
	nl := bytes.IndexByte(text[open:end], '\n')
	if nl < 0 {
		return "  "
	}
	for pos := open + nl + 1; pos < end; {
		lineEnd := end
		if i := bytes.IndexByte(text[pos:end], '\n'); i >= 0 {
			lineEnd = pos + i
		}
		line := text[pos:lineEnd]
		if item := bytes.TrimLeft(line, " \t"); len(bytes.TrimSpace(item)) > 0 && item[0] != '#' {
			return string(line[:len(line)-len(item)])
		}
		pos = lineEnd + 1
	}
	return "  "
}

// insertBeforeTable inserts line before the first table header at offset
// table (or at the end when table < 0), above the comment block that
// introduces the table, so that block stays with it.
func insertBeforeTable(text []byte, table int, line string) []byte {
	if table < 0 {
		var out bytes.Buffer
		out.Write(text)
		if len(text) > 0 && text[len(text)-1] != '\n' {
			out.WriteString("\n")
		}
		if len(bytes.TrimSpace(text)) > 0 {
			out.WriteString("\n")
		}
		out.WriteString(line)
		return out.Bytes()
	}
	at := table
	for at > 0 {
		prevEnd := at - 1 // the '\n' ending the previous line
		prevStart := bytes.LastIndexByte(text[:prevEnd], '\n') + 1
		trimmed := bytes.TrimSpace(text[prevStart:prevEnd])
		if len(trimmed) == 0 || trimmed[0] != '#' {
			break
		}
		at = prevStart
	}
	var out bytes.Buffer
	out.Write(text[:at])
	out.WriteString(line)
	out.WriteString("\n")
	out.Write(text[at:])
	return out.Bytes()
}

// tomlScanner is just enough of a TOML lexer to find a top-level key's value
// and the first table header: it knows strings, comments and brackets, which is
// what it takes not to mistake a "[" or "#" inside a string for syntax.
type tomlScanner struct {
	src []byte
}

// assignment locates `key = [ … ]` in the source: the key's offset, and the
// offsets of the value's opening and closing brackets (-1 when the value is
// not an array).
type assignment struct {
	keyStart, open, close int
}

// findTopLevel finds the bare key named key before the first table header,
// and the offset of that header's line (-1 when there is none).
func (sc tomlScanner) findTopLevel(key string) (assignment, int) {
	found := assignment{keyStart: -1, open: -1, close: -1}
	for pos := 0; pos < len(sc.src); {
		lineEnd := bytes.IndexByte(sc.src[pos:], '\n')
		if lineEnd < 0 {
			lineEnd = len(sc.src)
		} else {
			lineEnd += pos
		}
		line := sc.src[pos:lineEnd]
		trimmed := bytes.TrimLeft(line, " \t")
		indentLen := len(line) - len(trimmed)
		switch {
		case len(trimmed) > 0 && trimmed[0] == '[':
			return found, pos
		case found.keyStart < 0 && bytes.HasPrefix(trimmed, []byte(key)):
			rest := bytes.TrimLeft(trimmed[len(key):], " \t")
			if len(rest) > 0 && rest[0] == '=' {
				found.keyStart = pos + indentLen
				valueAt := lineEnd - len(bytes.TrimLeft(rest[1:], " \t"))
				if valueAt < len(sc.src) && sc.src[valueAt] == '[' {
					found.open = valueAt
					found.close = sc.matchBracket(valueAt)
				}
			}
		}
		// Skip over the rest of this statement, which may span lines.
		next := sc.statementEnd(pos)
		if next <= pos {
			next = lineEnd + 1
		}
		pos = next
	}
	return found, -1
}

// hasTopLevelKeyNamed reports whether any top-level line assigns key in a
// quoted spelling — "source_dirs" or 'source_dirs' — which findTopLevel does
// not edit.
func (sc tomlScanner) hasTopLevelKeyNamed(key string) bool {
	for _, q := range []string{`"` + key + `"`, `'` + key + `'`} {
		probe := tomlScanner{src: bytes.ReplaceAll(sc.src, []byte(q), []byte(key))}
		if a, _ := probe.findTopLevel(key); a.keyStart >= 0 {
			return true
		}
	}
	return false
}

// statementEnd returns the offset just past the line that ends the statement
// starting at pos: a value spanning lines — a multi-line array or string —
// ends where it closes.
func (sc tomlScanner) statementEnd(pos int) int {
	depth := 0
	for i := pos; i < len(sc.src); i++ {
		switch c := sc.src[i]; c {
		case '#':
			i = sc.skipComment(i) - 1
		case '"', '\'':
			i = sc.skipString(i) - 1
		case '[', '{':
			depth++
		case ']', '}':
			depth--
		case '\n':
			if depth <= 0 {
				return i + 1
			}
		}
	}
	return len(sc.src)
}

// matchBracket returns the offset of the ']' closing the '[' at open, or -1.
func (sc tomlScanner) matchBracket(open int) int {
	depth := 0
	for i := open; i < len(sc.src); i++ {
		switch sc.src[i] {
		case '#':
			i = sc.skipComment(i) - 1
		case '"', '\'':
			i = sc.skipString(i) - 1
		case '[':
			depth++
		case ']':
			depth--
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

// arrayShape describes the array body src[from:to]: the offset of its last
// significant byte (not whitespace, not a comment), whether it has any items,
// and whether that last byte is a trailing comma.
func (sc tomlScanner) arrayShape(from, to int) (lastSig int, hasItems, trailingComma bool) {
	lastSig = -1
	for i := from; i < to; i++ {
		switch c := sc.src[i]; c {
		case ' ', '\t', '\n', '\r':
		case '#':
			i = sc.skipComment(i) - 1
		case '"', '\'':
			end := sc.skipString(i)
			lastSig = end - 1
			hasItems = true
			i = end - 1
		default:
			lastSig = i
			if c != ',' {
				hasItems = true
			}
		}
	}
	trailingComma = lastSig >= 0 && sc.src[lastSig] == ','
	return lastSig, hasItems, trailingComma
}

// skipComment returns the offset of the newline ending the comment at i.
func (sc tomlScanner) skipComment(i int) int {
	if nl := bytes.IndexByte(sc.src[i:], '\n'); nl >= 0 {
		return i + nl
	}
	return len(sc.src)
}

// skipString returns the offset just past the string opening at i: basic or
// literal, one-line or multi-line.
func (sc tomlScanner) skipString(i int) int {
	q := sc.src[i]
	triple := []byte{q, q, q}
	if bytes.HasPrefix(sc.src[i:], triple) {
		if end := bytes.Index(sc.src[i+3:], triple); end >= 0 {
			return i + 3 + end + 3
		}
		return len(sc.src)
	}
	for j := i + 1; j < len(sc.src); j++ {
		switch sc.src[j] {
		case '\\':
			if q == '"' {
				j++
			}
		case q:
			return j + 1
		case '\n':
			return j
		}
	}
	return len(sc.src)
}
