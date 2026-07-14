// Package reviewanchor implements the canonicalization and hashing that anchor
// review comments to Markdown blocks.
//
// The hash MUST remain byte-identical to the frontend implementation in
// frontend/src/lib/reviewAnchor.ts: the browser computes a block's hash from
// its rendered text and the two sides compare hashes to detect drift. The
// golden vectors in the test pin this contract — treat the frontend as the
// authority if they ever disagree.
package reviewanchor

import (
	"fmt"
	"strings"
	"unicode/utf16"
)

// jsWhitespace reports whether r belongs to the ECMAScript /\s/u class. This
// set is spelled out explicitly because it differs from unicode.IsSpace in two
// load-bearing ways: it includes U+FEFF and excludes U+0085. Getting it wrong
// changes hashes, so it must mirror the JS engine exactly.
func jsWhitespace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ',
		0x00A0, 0x1680,
		0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
		0x2008, 0x2009, 0x200A,
		0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	default:
		return false
	}
}

// StripBlockText canonicalizes block text: collapse every run of JS-whitespace
// to a single ASCII space, drop leading/trailing runs, then lowercase.
func StripBlockText(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	pendingSpace := false
	for _, r := range s {
		if jsWhitespace(r) {
			pendingSpace = true
			continue
		}
		if pendingSpace && b.Len() > 0 {
			b.WriteByte(' ')
		}
		pendingSpace = false
		b.WriteRune(r)
	}
	return strings.ToLower(b.String())
}

// FNV1a hashes s with 32-bit FNV-1a over its UTF-16 code units, mixing only the
// low byte of each unit — matching the frontend's charCodeAt + Math.imul. It
// returns an 8-character zero-padded lowercase hex string.
//
// Do not substitute hash/fnv: that hashes UTF-8 bytes and diverges for any
// non-ASCII input. Iterating runes (not UTF-16 units) breaks astral characters.
func FNV1a(s string) string {
	h := uint32(0x811c9dc5)
	for _, u := range utf16.Encode([]rune(s)) {
		h ^= uint32(u & 0xff)
		h *= 0x01000193
	}
	return fmt.Sprintf("%08x", h)
}

// HashBlockText is the canonicalize-then-hash value stored in a comment
// anchor's block_text_hash.
func HashBlockText(s string) string {
	return FNV1a(StripBlockText(s))
}
