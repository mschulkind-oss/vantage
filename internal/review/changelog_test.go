package review

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/model"
)

const nl = "\n"

// reviewWithComment builds a stored review carrying one anchored comment, and a
// Store rooted at a temp dir, ready for ApplyChangelog tests.
func reviewWithComment(t *testing.T, id string, sourceLine int) *Store {
	t.Helper()
	ResetCacheForTests()
	s := NewStore(t.TempDir())
	data := model.NewReviewData("doc.md")
	c := model.NewReviewComment(id, "please fix", 1700000000)
	c.Anchor = &model.CommentAnchor{SourceLine: sourceLine}
	data.Comments = append(data.Comments, c)
	require.NoError(t, s.Save("doc.md", "", data))
	return s
}

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
		{"too-short-id", "- [abc] note", "", "", false},
		{"non-hex-id", "- [zzzz] note", "", "", false},
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

func TestApplyChangelogWritesReaction(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	s := reviewWithComment(t, id, 1)

	content := strings.Join([]string{
		"Updated heading",
		"",
		"<!-- changelog -->",
		"- [abcd1234] fixed the heading",
	}, nl)

	n := s.ApplyChangelog("doc.md", content, "")
	require.Equal(t, 1, n)

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Len(t, got.Comments[0].Reactions, 1)
	r := got.Comments[0].Reactions[0]
	require.Equal(t, "agent", r.Actor)
	require.Equal(t, "addressed", r.Kind)
	require.Equal(t, "fixed the heading", r.Summary)
	require.NotZero(t, r.Timestamp)
}

func TestApplyChangelogIdempotent(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	s := reviewWithComment(t, id, 1)

	content := strings.Join([]string{
		"Heading",
		"<!-- changelog -->",
		"- [abcd1234] fixed the heading",
	}, nl)

	require.Equal(t, 1, s.ApplyChangelog("doc.md", content, ""))
	// Re-running the same content writes no second reaction.
	require.Equal(t, 0, s.ApplyChangelog("doc.md", content, ""))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Len(t, got.Comments[0].Reactions, 1, "no double reaction")
}

func TestApplyChangelogDedupByCommentAndSummary(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	s := reviewWithComment(t, id, 1)

	// Two bullets in the same block: same comment, distinct summaries → two
	// reactions. A repeated summary is deduped.
	content := strings.Join([]string{
		"<!-- changelog -->",
		"- [abcd1234] first change",
		"- [abcd1234] second change",
		"- [abcd1234] first change",
	}, nl)

	require.Equal(t, 2, s.ApplyChangelog("doc.md", content, ""))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	summaries := []string{}
	for _, r := range got.Comments[0].Reactions {
		summaries = append(summaries, r.Summary)
	}
	require.ElementsMatch(t, []string{"first change", "second change"}, summaries)
}

func TestApplyChangelogNoComments(t *testing.T) {
	ResetCacheForTests()
	s := NewStore(t.TempDir())
	require.NoError(t, s.Save("doc.md", "", model.NewReviewData("doc.md")))

	content := "<!-- changelog -->" + nl + "- [abcd1234] something"
	require.Equal(t, 0, s.ApplyChangelog("doc.md", content, ""))
}

func TestApplyChangelogNoReviewSeedsCache(t *testing.T) {
	ResetCacheForTests()
	s := NewStore(t.TempDir())
	// No review on disk: nothing written, but the prev-content cache is seeded.
	require.Equal(t, 0, s.ApplyChangelog("doc.md", "fresh content", ""))
	require.Equal(t, "fresh content", getPrevContent(cacheKey{path: "doc.md"}))
}

func TestApplyChangelogBeforeAfterCapture(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	s := reviewWithComment(t, id, 1)

	// Seed the cache with the "before" content via a first (no-changelog) apply.
	require.Equal(t, 0, s.ApplyChangelog("doc.md", "The OLD heading text", ""))

	after := strings.Join([]string{
		"The new heading text",
		"",
		"<!-- changelog -->",
		"- [abcd1234] rewrote the heading",
	}, nl)
	require.Equal(t, 1, s.ApplyChangelog("doc.md", after, ""))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	r := got.Comments[0].Reactions[0]
	require.Equal(t, "the old heading text", r.BeforeText)
	require.Equal(t, "the new heading text", r.AfterText)
}

func TestSeedPrevContent(t *testing.T) {
	ResetCacheForTests()
	SeedPrevContent("seeded.md", "seed body", "repoX")
	require.Equal(t, "seed body", getPrevContent(cacheKey{repo: "repoX", path: "seeded.md"}))
}

func TestApplyChangelogUnknownShortIDSkipped(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	s := reviewWithComment(t, id, 1)

	content := "<!-- changelog -->" + nl + "- [ffffffff] unrelated"
	require.Equal(t, 0, s.ApplyChangelog("doc.md", content, ""))
}
