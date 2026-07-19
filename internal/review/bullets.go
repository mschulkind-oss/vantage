package review

// Bullet parsing and block capture: the text-shaped half of agent response
// handling. The "- [<short_id>] <summary>" bullet grammar survives as the
// paste-box input format ([ParseResponses] in commands.go); the block helpers
// (splitBlocks/blockTextAt) locate the Markdown block at a comment's anchor
// line for before/after capture.
//
// The changelog marker below is NOT a protocol anymore. Agents used to deliver
// responses by writing "<!-- changelog -->" blocks into the reviewed document;
// that protocol is retired (docs/design/review-state-architecture.md §8 phase
// 4). [ContainsChangelogBlock] exists solely so the watcher can warn when a
// stale clipboard payload drives an agent to write one anyway.

import (
	"log/slog"
	"strings"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/reviewanchor"
)

// changelogMarker is the exact comment that opened a changelog block under the
// retired protocol. The line must equal this token modulo surrounding
// whitespace. Kept only for the stale-payload warning.
const changelogMarker = "<!-- changelog -->"

// ContainsChangelogBlock reports whether content carries a changelog marker
// line — evidence that an agent is still following the retired
// document-embedded response protocol. The watcher warns and broadcasts when a
// saved document tests true; nothing is ever parsed out of the block anymore.
func ContainsChangelogBlock(content string) bool {
	for _, line := range splitLines(content) {
		if isChangelogMarker(line) {
			return true
		}
	}
	return false
}

// changelogEntry is one parsed bullet: a comment short id and its summary.
type changelogEntry struct {
	shortID string
	summary string
}

// commentByID returns the comment with the given id, or nil. comments is
// addressed by value but its elements carry slices/maps, so the returned
// pointer mutates the slice element in place.
func commentByID(comments []model.ReviewComment, id string) *model.ReviewComment {
	for i := range comments {
		if comments[i].ID == id {
			return &comments[i]
		}
	}
	return nil
}

// parseChangelog finds the last "<!-- changelog -->" marker and returns the
// bullets that follow it.
//
// The marker-scoped parse survives the protocol retirement because pasted
// responses may still carry a marker line ([ParseResponses] skips it as a
// non-bullet); this function itself is now exercised only by tests. Multiple
// blocks: the last one is authoritative. Within the block, lines that are not
// well-formed bullets are skipped rather than ending the block, so a leading
// prose line or blank line does not silently drop every bullet after it.
func parseChangelog(content string) []changelogEntry {
	lines := splitLines(content)

	lastMarker := -1
	for i, raw := range lines {
		if isChangelogMarker(raw) {
			lastMarker = i
		}
	}
	if lastMarker < 0 {
		return nil
	}

	var out []changelogEntry
	for j := lastMarker + 1; j < len(lines); j++ {
		line := lines[j]
		if isChangelogMarker(line) {
			break
		}
		shortID, summary, ok := parseBullet(line)
		if !ok {
			continue
		}
		out = append(out, changelogEntry{shortID: shortID, summary: summary})
	}
	return out
}

// isChangelogMarker reports whether line is the changelog marker, ignoring
// leading and trailing ASCII whitespace.
func isChangelogMarker(line string) bool {
	return strings.TrimSpace(line) == changelogMarker
}

// parseBullet parses a "- [<short_id>] <summary>" line. The short id is a hex
// run of at least 4 characters and is lowercased; the summary is trimmed and
// must be non-empty. ok is false for any line that does not match.
func parseBullet(line string) (shortID, summary string, ok bool) {
	rest := strings.TrimLeft(line, " \t")
	if !strings.HasPrefix(rest, "-") {
		return "", "", false
	}
	rest = strings.TrimLeft(rest[1:], " \t")
	if !strings.HasPrefix(rest, "[") {
		return "", "", false
	}
	close := strings.IndexByte(rest, ']')
	if close < 0 {
		return "", "", false
	}
	id := rest[1:close]
	if len(id) < 4 || !isHex(id) {
		return "", "", false
	}
	summary = strings.TrimSpace(rest[close+1:])
	if summary == "" {
		return "", "", false
	}
	return strings.ToLower(id), summary, true
}

// isHex reports whether s is a non-empty run of ASCII hex digits.
func isHex(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= '0' && c <= '9':
		case c >= 'a' && c <= 'f':
		case c >= 'A' && c <= 'F':
		default:
			return false
		}
	}
	return true
}

// resolveCommentID returns the single comment id that has shortID as a prefix.
// ok is false when no comment matches or when the prefix is ambiguous (the
// agent should then use a longer prefix). A short id is matched against the full
// id by prefix, which also covers the canonical id[:8] form.
func resolveCommentID(comments []model.ReviewComment, shortID string) (string, bool) {
	var match string
	count := 0
	for _, c := range comments {
		if strings.HasPrefix(c.ID, shortID) {
			match = c.ID
			count++
		}
	}
	if count == 0 {
		return "", false
	}
	if count > 1 {
		slog.Warn("review: ambiguous response short id; skipping", "short_id", shortID, "matches", count)
		return "", false
	}
	return match, true
}

// blockTextAt returns the canonicalized text of the block at sourceLine. A
// falsy (zero) line yields "". It first looks for the nearest block, then
// widens to a ±10-line window; the result is run through StripBlockText so the
// stored before/after text is canonical.
func blockTextAt(content string, sourceLine int) string {
	if sourceLine == 0 {
		return ""
	}
	block, ok := findBlockAtLine(content, sourceLine, 0)
	if !ok {
		block, ok = findBlockAtLine(content, sourceLine, 10)
	}
	if !ok {
		return ""
	}
	return reviewanchor.StripBlockText(block.Text)
}

// block is one logical Markdown block: its 1-based start line and joined text.
type block struct {
	Line int
	Text string
}

// splitLines splits content the way the bullet parser needs: on "\n",
// "\r\n", and "\r", dropping a single trailing empty element so that a
// final newline does not create a spurious blank line. Only these three
// terminators are recognized (no full Unicode line-boundary set).
func splitLines(content string) []string {
	if content == "" {
		return nil
	}
	var lines []string
	var cur strings.Builder
	for i := 0; i < len(content); i++ {
		c := content[i]
		switch c {
		case '\n':
			lines = append(lines, cur.String())
			cur.Reset()
		case '\r':
			lines = append(lines, cur.String())
			cur.Reset()
			if i+1 < len(content) && content[i+1] == '\n' {
				i++ // consume the \n of a \r\n pair
			}
		default:
			cur.WriteByte(c)
		}
	}
	// A non-empty trailing segment (no terminator) is its own line.
	if cur.Len() > 0 {
		lines = append(lines, cur.String())
	}
	return lines
}

// splitBlocks splits a Markdown document into blocks at blank lines. This is a
// deliberately rough split — it does not mirror a real Markdown parser — but it
// is enough to locate the block at a comment's anchor line for before/after
// capture.
//
// Fenced code blocks (opened by a left-stripped "```" or "~~~") keep their
// inner blank lines together; the fence closes on a line whose stripped form
// begins with the same 3-character marker. An unterminated fence still flushes
// at end of input. Each block's text is the "\n"-joined lines, trimmed; empty
// blocks are dropped.
func splitBlocks(content string) []block {
	lines := splitLines(content)

	var blocks []block
	var buf []string
	bufStart := 0 // 1-based; 0 means "no open block"
	inFence := false
	fenceMarker := ""

	flush := func() {
		if len(buf) > 0 && bufStart != 0 {
			text := strings.TrimSpace(strings.Join(buf, "\n"))
			if text != "" {
				blocks = append(blocks, block{Line: bufStart, Text: text})
			}
		}
		buf = buf[:0]
	}

	for idx, raw := range lines {
		lineNo := idx + 1
		stripped := strings.TrimLeft(raw, " \t\v\f\r\n")

		if !inFence && (strings.HasPrefix(stripped, "```") || strings.HasPrefix(stripped, "~~~")) {
			if bufStart == 0 {
				bufStart = lineNo
			}
			buf = append(buf, raw)
			inFence = true
			fenceMarker = stripped[:3]
			continue
		}
		if inFence {
			buf = append(buf, raw)
			if strings.HasPrefix(stripped, fenceMarker) {
				inFence = false
				fenceMarker = ""
			}
			continue
		}

		if strings.TrimSpace(raw) == "" {
			flush()
			bufStart = 0
		} else {
			if bufStart == 0 {
				bufStart = lineNo
			}
			buf = append(buf, raw)
		}
	}

	flush()
	return blocks
}

// findBlockAtLine returns the block whose start line is nearest to sourceLine.
//
// When radius > 0 the search is windowed to ±radius lines and ok is false if no
// block falls inside it. radius == 0 means nearest (NOT exact-only): the closest
// block by absolute start-line distance is returned. A distance of 0 wins
// immediately, and the lowest start line breaks ties (strictly-closer
// comparison preserves the first/lowest candidate).
func findBlockAtLine(content string, sourceLine, radius int) (block, bool) {
	blocks := splitBlocks(content)
	if len(blocks) == 0 {
		return block{}, false
	}

	var best block
	bestDist := -1
	for _, b := range blocks {
		dist := b.Line - sourceLine
		if dist < 0 {
			dist = -dist
		}
		if radius > 0 && dist > radius {
			continue
		}
		if bestDist < 0 || dist < bestDist {
			best = b
			bestDist = dist
		}
		if dist == 0 {
			break
		}
	}
	if bestDist < 0 {
		return block{}, false
	}
	return best, true
}
