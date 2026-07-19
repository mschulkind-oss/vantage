package review

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/model"
)

const nl = "\n"

func TestSplitLines(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []string
	}{
		{"empty", "", nil},
		{"single-no-newline", "abc", []string{"abc"}},
		{"trailing-newline-dropped", "a\nb\n", []string{"a", "b"}},
		{"crlf", "a\r\nb", []string{"a", "b"}},
		{"cr", "a\rb", []string{"a", "b"}},
		{"mixed", "a\r\nb\rc\nd", []string{"a", "b", "c", "d"}},
		{"blank-lines-preserved", "a\n\nb", []string{"a", "", "b"}},
		{"only-newline", "\n", []string{""}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, splitLines(tc.in))
		})
	}
}

func TestParseChangelogLastMarkerWins(t *testing.T) {
	content := strings.Join([]string{
		"<!-- changelog -->",
		"- [aaaa1111] first block bullet",
		"",
		"some prose",
		"<!-- changelog -->",
		"- [bbbb2222] second block bullet",
	}, nl)

	entries := parseChangelog(content)
	require.Len(t, entries, 1)
	require.Equal(t, "bbbb2222", entries[0].shortID)
	require.Equal(t, "second block bullet", entries[0].summary)
}

func TestParseChangelogLenientSkip(t *testing.T) {
	// A leading prose line, a blank line, and a nested bullet must NOT terminate
	// the block: every well-formed bullet after them is still collected.
	content := strings.Join([]string{
		"<!-- changelog -->",
		"What I did this iteration:",
		"",
		"- [aaaa1111] addressed the typo",
		"  - nested note that is not a real bullet",
		"- [bbbb2222] clarified the wording",
		"- [short] too short an id is skipped",
		"- [ccc] also too short",
		"- [dddd4444] ",
		"- [eeee5555] final change",
	}, nl)

	entries := parseChangelog(content)
	require.Len(t, entries, 3)
	require.Equal(t, "aaaa1111", entries[0].shortID)
	require.Equal(t, "bbbb2222", entries[1].shortID)
	require.Equal(t, "eeee5555", entries[2].shortID)
}

func TestParseBullet(t *testing.T) {
	cases := []struct {
		name        string
		line        string
		wantID      string
		wantSummary string
		wantOK      bool
	}{
		{"basic", "- [abcd1234] fixed it", "abcd1234", "fixed it", true},
		{"lowercased-id", "- [ABCD1234] fixed it", "abcd1234", "fixed it", true},
		{"leading-ws", "   -   [abcd] note", "abcd", "note", true},
		{"trailing-ws", "- [abcd] note   ", "abcd", "note", true},
		// A model rendering a Markdown list may normalize the marker; the inbox
		// door has no such restriction, so neither should the paste door.
		{"asterisk-marker", "* [abcd1234] fixed it", "abcd1234", "fixed it", true},
		{"plus-marker", "+ [abcd1234] fixed it", "abcd1234", "fixed it", true},
		// The inbox door accepts a full id (resolveCommentID prefix-matches it
		// exactly); the hyphens must not disqualify it here.
		{"full-uuid", "- [11112222-3333-4444-5555-666677778888] fixed it",
			"11112222-3333-4444-5555-666677778888", "fixed it", true},
		{"too-short-id", "- [abc] note", "", "", false},
		{"non-hex-id", "- [zzzz] note", "", "", false},
		{"task-list-unchecked", "- [ ] note", "", "", false},
		{"task-list-checked", "- [x] task", "", "", false},
		{"hyphens-only-id", "- [----] note", "", "", false},
		{"empty-summary", "- [abcd] ", "", "", false},
		{"no-bracket", "- abcd note", "", "", false},
		{"not-a-bullet", "abcd note", "", "", false},
		{"no-close-bracket", "- [abcd note", "", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id, summary, ok := parseBullet(tc.line)
			require.Equal(t, tc.wantOK, ok)
			if tc.wantOK {
				require.Equal(t, tc.wantID, id)
				require.Equal(t, tc.wantSummary, summary)
			}
		})
	}
}

func TestResolveCommentID(t *testing.T) {
	comments := []model.ReviewComment{
		{ID: "abcd1234-5678-90ab-cdef-000000000001"},
		{ID: "abcd9999-5678-90ab-cdef-000000000002"},
		{ID: "ffff0000-5678-90ab-cdef-000000000003"},
	}

	// Unique short prefix (the canonical id[:8] form).
	id, ok := resolveCommentID(comments, "ffff0000")
	require.True(t, ok)
	require.Equal(t, "ffff0000-5678-90ab-cdef-000000000003", id)

	// Full-id prefix also resolves.
	id, ok = resolveCommentID(comments, "ffff0000-5678")
	require.True(t, ok)
	require.Equal(t, "ffff0000-5678-90ab-cdef-000000000003", id)

	// Ambiguous prefix is rejected.
	_, ok = resolveCommentID(comments, "abcd")
	require.False(t, ok)

	// No match.
	_, ok = resolveCommentID(comments, "deadbeef")
	require.False(t, ok)
}

func TestContainsChangelogBlock(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{"empty", "", false},
		{"plain prose", "# Title\n\nA paragraph.\n", false},
		{"marker alone", "<!-- changelog -->", true},
		{"marker mid-document", "intro\n\n<!-- changelog -->\n- [abcd1234] did it\n", true},
		{"marker with surrounding whitespace", "  \t<!-- changelog -->  \n", true},
		{"marker with CRLF endings", "line one\r\n<!-- changelog -->\r\n", true},
		// Prose merely mentioning the marker inline is not a marker line.
		{"inline mention is not a marker", "the `<!-- changelog -->` marker is retired\n", false},
		{"similar comment is not the marker", "<!-- changelog: notes -->\n", false},
		// Documentation quoting the retired format — this project's own design
		// docs do exactly this — must not read as a delivery attempt.
		{"marker inside a fenced example", "See:\n\n```markdown\n<!-- changelog -->\n- [abcd1234] did it\n```\n", false},
		{"marker inside a tilde fence", "~~~\n<!-- changelog -->\n~~~\n", false},
		{"real marker after a fenced example", "```\n<!-- changelog -->\n```\n\n<!-- changelog -->\n- [abcd1234] did it\n", true},
		{"unterminated fence swallows the rest", "```\n<!-- changelog -->\n", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, ContainsChangelogBlock(tc.in))
		})
	}
}

func TestSplitBlocksFenceHandling(t *testing.T) {
	content := strings.Join([]string{
		"para one",
		"",
		"```go",
		"func main() {",
		"", // blank line inside a fence must be kept
		"}",
		"```",
		"",
		"para two",
	}, nl)

	blocks := splitBlocks(content)
	require.Len(t, blocks, 3)

	require.Equal(t, 1, blocks[0].Line)
	require.Equal(t, "para one", blocks[0].Text)

	// The fenced block starts at line 3 and keeps its inner blank line.
	require.Equal(t, 3, blocks[1].Line)
	require.Contains(t, blocks[1].Text, "func main() {")
	require.Contains(t, blocks[1].Text, "```go")
	require.Contains(t, blocks[1].Text, nl+nl, "inner blank line preserved")

	require.Equal(t, 9, blocks[2].Line)
	require.Equal(t, "para two", blocks[2].Text)
}

func TestSplitBlocksUnterminatedFenceStillFlushes(t *testing.T) {
	content := strings.Join([]string{
		"intro",
		"",
		"```",
		"code line",
		"more code",
	}, nl)

	blocks := splitBlocks(content)
	require.Len(t, blocks, 2)
	require.Equal(t, "intro", blocks[0].Text)
	require.Equal(t, 3, blocks[1].Line)
	require.Contains(t, blocks[1].Text, "code line")
	require.Contains(t, blocks[1].Text, "more code")
}

func TestSplitBlocksTildeFence(t *testing.T) {
	content := strings.Join([]string{
		"~~~",
		"a",
		"",
		"b",
		"~~~",
	}, nl)
	blocks := splitBlocks(content)
	require.Len(t, blocks, 1)
	require.Equal(t, 1, blocks[0].Line)
	require.Contains(t, blocks[0].Text, nl+nl)
}

func TestFindBlockAtLineNearestMatch(t *testing.T) {
	// Blocks start at lines 1, 4, 7.
	content := strings.Join([]string{
		"block a", // line 1
		"",
		"",
		"block b", // line 4
		"",
		"",
		"block c", // line 7
	}, nl)

	// radius==0 is NEAREST, not exact-only: line 5 is closest to block b (4).
	b, ok := findBlockAtLine(content, 5, 0)
	require.True(t, ok)
	require.Equal(t, "block b", b.Text)

	// Exact start line.
	b, ok = findBlockAtLine(content, 7, 0)
	require.True(t, ok)
	require.Equal(t, "block c", b.Text)

	// radius windows the search: line 100 with radius 2 finds nothing.
	_, ok = findBlockAtLine(content, 100, 2)
	require.False(t, ok)

	// radius windows the search: line 6 with radius 1 reaches block c (7).
	b, ok = findBlockAtLine(content, 6, 1)
	require.True(t, ok)
	require.Equal(t, "block c", b.Text)
}

func TestFindBlockAtLineTieGoesToLowestStart(t *testing.T) {
	// Blocks at lines 2 and 4; line 3 is equidistant — lowest start (2) wins.
	content := strings.Join([]string{
		"",
		"block a", // line 2
		"",
		"block b", // line 4
	}, nl)
	b, ok := findBlockAtLine(content, 3, 0)
	require.True(t, ok)
	require.Equal(t, "block a", b.Text)
}

func TestFindBlockAtLineEmptyContent(t *testing.T) {
	_, ok := findBlockAtLine("", 1, 0)
	require.False(t, ok)
}

func TestBlockTextAtFalsyLine(t *testing.T) {
	require.Equal(t, "", blockTextAt("some content", 0))
}

func TestBlockTextAtCanonicalizes(t *testing.T) {
	content := "Hello   WORLD"
	require.Equal(t, "hello world", blockTextAt(content, 1))
}
