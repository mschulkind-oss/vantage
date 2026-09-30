// Package fsname says when two spellings of a file name open one file.
//
// Vantage refuses every path through ".git" and ".vantage", and the refusal
// is only as good as its idea of which names those are. macOS's filesystems,
// APFS and HFS+, ignore case by default, so ".GIT/config" opens ".git/config"
// there. HFS+ also ignores a handful of invisible code points inside a name, so
// ".g\u200cit" (with a zero-width non-joiner) opens it too. A check that compares bytes lets both through.
package fsname

import "strings"

// Same reports whether a and b, two single path segments, can name one
// directory entry: they differ at most in case and in the code points HFS+
// ignores.
//
// The rule is applied on every platform, although Linux's filesystems tell
// these spellings apart. That costs nothing real: git's own path check refuses
// ".git" spelled in any case on every platform, and on macOS also with those
// code points in it (verify_path and is_hfs_dotgit, the fix for
// CVE-2014-9390), so no checkout holds such a name. One rule is also one fewer
// thing to get wrong on the platform that needs it.
func Same(a, b string) bool {
	return strings.EqualFold(withoutHFSIgnorable(a), withoutHFSIgnorable(b))
}

// withoutHFSIgnorable is s without the code points HFS+ leaves out when it
// compares names: the list git's next_hfs_char skips, which are zero-width
// joiners and direction and shaping controls.
func withoutHFSIgnorable(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r >= 0x200c && r <= 0x200f, r >= 0x202a && r <= 0x202e, r >= 0x206a && r <= 0x206f, r == 0xfeff:
			return -1
		}
		return r
	}, s)
}
