package review

// Block capture and comment-id resolution: the text-shaped half of agent
// response handling. The block helpers (splitBlocks/blockTextAt) locate the
// Markdown block at a comment's anchor line for before/after capture;
// resolveCommentID maps a delivery's short id onto a comment.
//
// The "- [<short_id>] <summary>" bullet grammar that used to live here is
// gone with the paste-box door: agent responses arrive only as .vantage/inbox
// JSONL now, which carries its ids and summaries as fields.
//
// A ContainsChangelogBlock helper also used to live here, detecting the
// "<!-- changelog -->" marker of the retired document-embedded protocol so the
// watcher could warn that an agent's response had been lost. Nothing detects
// the marker now: its presence never distinguished a lost turn from a delivered
// one, so the warning it fed was unfalsifiable. A document that still carries a
// changelog block is simply ignored, the same as any other prose.

import (
	"log/slog"
	"strings"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/reviewanchor"
)

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
