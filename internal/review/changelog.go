package review

import (
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/reviewanchor"
)

// changelogMarker is the exact comment that opens a changelog block. The line
// must equal this token modulo surrounding whitespace.
const changelogMarker = "<!-- changelog -->"

// cacheKey identifies a reviewed document for the prev-content cache. A repo of
// "" is the single-repo sentinel.
type cacheKey struct {
	repo string
	path string
}

// prevContent caches the previously-seen content of each reviewed document so a
// reaction can capture the block's "before" text when a file changes. It is a
// server-only mechanism: it lets the watcher record reactions even when no
// browser is connected. Guarded by prevContentMu.
var (
	prevContentMu sync.Mutex
	prevContent   = map[cacheKey]string{}
)

// changelogEntry is one parsed bullet: a comment short id and its summary.
type changelogEntry struct {
	shortID string
	summary string
}

// ApplyChangelog parses newContent for the last "<!-- changelog -->" block and
// persists a reaction for every new, resolvable bullet. It returns the number
// of reactions written.
//
// This is invoked by the file watcher, never on PUT — applying it on PUT would
// double-record reactions that the client already holds.
//
// Behavior:
//   - The last changelog marker wins; only bullets after it are considered.
//   - Bullets are "- [<short_id>] <summary>" with a hex short id of >=4 chars.
//     Malformed lines are skipped, not treated as terminators.
//   - A bullet's short id must uniquely resolve to one comment; ambiguous or
//     unknown ids are skipped.
//   - Idempotency: a bullet whose (comment_id, summary) already has an
//     agent/addressed reaction is skipped, so re-running on unchanged content
//     writes nothing.
//   - The reaction's before text is the cached previous content's block at the
//     comment's anchor line; the after text is the new content's block. Both
//     are canonicalized via reviewanchor.StripBlockText.
//
// The prev-content cache is always updated to newContent before returning,
// including the early-exit paths, so the next edit has a "before" to compare.
func (s *Store) ApplyChangelog(filePath, newContent, repo string) int {
	key := cacheKey{repo: repo, path: filePath}

	review, err := s.Get(filePath, repo)
	if err != nil {
		slog.Warn("review: failed to read review for changelog", "path", filePath, "error", err)
	}
	if review == nil || len(review.Comments) == 0 {
		setPrevContent(key, newContent)
		return 0
	}

	entries := parseChangelog(newContent)
	if len(entries) == 0 {
		setPrevContent(key, newContent)
		return 0
	}

	prev := getPrevContent(key)

	written := 0
	now := float64(time.Now().Unix())
	for _, entry := range entries {
		cid, ok := resolveCommentID(review.Comments, entry.shortID)
		if !ok {
			slog.Debug("review: no comment matches changelog short id", "short_id", entry.shortID, "path", filePath)
			continue
		}
		comment := commentByID(review.Comments, cid)
		if comment == nil {
			continue
		}

		// Idempotency: dedup by (comment_id, summary).
		if hasAddressedReaction(comment, entry.summary) {
			continue
		}

		var anchorLine int
		if comment.Anchor != nil {
			anchorLine = comment.Anchor.SourceLine
		}
		var before string
		if prev != "" {
			before = blockTextAt(prev, anchorLine)
		}
		after := blockTextAt(newContent, anchorLine)

		comment.Reactions = append(comment.Reactions, model.CommentReaction{
			Actor:      "agent",
			Kind:       "addressed",
			Summary:    entry.summary,
			BeforeText: before,
			AfterText:  after,
			Timestamp:  now,
		})
		written++

		short := cid
		if len(short) > 8 {
			short = short[:8]
		}
		slog.Info("review: recorded changelog reaction", "comment", short, "path", filePath, "summary", entry.summary)
	}

	if written > 0 {
		if err := s.Save(filePath, repo, review); err != nil {
			slog.Warn("review: failed to save changelog reactions", "path", filePath, "error", err)
		}
	}
	setPrevContent(key, newContent)
	return written
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

// hasAddressedReaction reports whether comment already carries an
// agent/addressed reaction with the given summary — the idempotency key.
func hasAddressedReaction(comment *model.ReviewComment, summary string) bool {
	for _, r := range comment.Reactions {
		if r.Actor == "agent" && r.Kind == "addressed" && r.Summary == summary {
			return true
		}
	}
	return false
}

// parseChangelog finds the last "<!-- changelog -->" marker and returns the
// bullets that follow it.
//
// Multiple blocks: the last one is authoritative (agents append a fresh block
// each iteration). Within the block, lines that are not well-formed bullets are
// skipped rather than ending the block, so a leading prose line or blank line
// does not silently drop every bullet after it. A later marker would terminate
// the block, but since the last marker was chosen that is only a defensive
// guard.
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
		slog.Warn("review: ambiguous changelog short id; skipping", "short_id", shortID, "matches", count)
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

// splitLines splits content the way the changelog parser needs: on "\n",
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

// SeedPrevContent primes the prev-content cache for a document, e.g. when the
// watcher starts, so the first edit after startup has a "before" to compare
// against instead of being treated as never-seen. It is cheap and idempotent.
func SeedPrevContent(filePath, content, repo string) {
	setPrevContent(cacheKey{repo: repo, path: filePath}, content)
}

// ResetCacheForTests clears the prev-content cache. It exists for tests, which
// must not leak state between cases.
func ResetCacheForTests() {
	prevContentMu.Lock()
	defer prevContentMu.Unlock()
	prevContent = map[cacheKey]string{}
}

func setPrevContent(key cacheKey, content string) {
	prevContentMu.Lock()
	defer prevContentMu.Unlock()
	prevContent[key] = content
}

func getPrevContent(key cacheKey) string {
	prevContentMu.Lock()
	defer prevContentMu.Unlock()
	return prevContent[key]
}
