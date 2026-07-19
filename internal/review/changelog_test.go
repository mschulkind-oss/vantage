package review

import (
	"encoding/json"
	"os"
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

// reviewWithReactions is reviewWithComment for a comment that already carries a
// reaction history — the multi-round cases.
func reviewWithReactions(t *testing.T, id string, sourceLine int, reactions ...model.CommentReaction) *Store {
	t.Helper()
	ResetCacheForTests()
	s := NewStore(t.TempDir())
	data := model.NewReviewData("doc.md")
	c := model.NewReviewComment(id, "please fix", 1700000000)
	c.Anchor = &model.CommentAnchor{SourceLine: sourceLine}
	c.Reactions = append(c.Reactions, reactions...)
	data.Comments = append(data.Comments, c)
	// A review that already carries agent reactions has been through
	// ApplyChangelog, so in practice it also carries a marker. Setting one keeps
	// these fixtures on the post-upgrade path; the legacy (absent) case has its
	// own test. The digest is deliberately not the fixture document's, so the
	// content under test still reads as a new round.
	data.AppliedChangelog = "1:some-earlier-block-digest"
	require.NoError(t, s.Save("doc.md", "", data))
	return s
}

// reviewWithEditedComment is reviewWithReactions for a comment the reviewer has
// since reworded. editComment stamps EditedAt and appends NO reaction, so the
// edit is invisible in the reaction history — the timestamp is the only record.
func reviewWithEditedComment(t *testing.T, id string, editedAt float64, reactions ...model.CommentReaction) *Store {
	t.Helper()
	ResetCacheForTests()
	s := NewStore(t.TempDir())
	data := model.NewReviewData("doc.md")
	c := model.NewReviewComment(id, "please fix (reworded)", 1700000000)
	c.Anchor = &model.CommentAnchor{SourceLine: 1}
	c.EditedAt = editedAt
	c.Reactions = append(c.Reactions, reactions...)
	data.Comments = append(data.Comments, c)
	// A review that already carries agent reactions has been through
	// ApplyChangelog, so in practice it also carries a marker. Setting one keeps
	// these fixtures on the post-upgrade path; the legacy (absent) case has its
	// own test. The digest is deliberately not the fixture document's, so the
	// content under test still reads as a new round.
	data.AppliedChangelog = "1:some-earlier-block-digest"
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

func TestApplyChangelogSecondRoundMayReuseSummary(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	// The agent answered once; the reviewer pushed back. That push-back opens a
	// new round, so the agent's next response counts even when it happens to be
	// worded exactly like the first one.
	s := reviewWithReactions(t, id, 1,
		model.CommentReaction{Actor: "agent", Kind: "addressed", Summary: "Fixed it", Timestamp: 1700000100},
		model.CommentReaction{Actor: "reviewer", Kind: "needs_clarification", Summary: "still wrong", Timestamp: 1700000200},
	)

	// The agent appends a fresh block per round, so the document carries the
	// first round's block as well as the new one.
	content := strings.Join([]string{
		"Updated heading",
		"",
		"<!-- changelog -->",
		"- [abcd1234] Fixed it",
		"",
		"<!-- changelog -->",
		"- [abcd1234] Fixed it",
	}, nl)

	require.Equal(t, 1, s.ApplyChangelog("doc.md", content, ""))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Len(t, got.Comments[0].Reactions, 3, "the second-round response must not be dropped as a replay")
	last := got.Comments[0].Reactions[2]
	require.Equal(t, "agent", last.Actor)
	require.Equal(t, "addressed", last.Kind)
	require.Equal(t, "Fixed it", last.Summary)
	require.Greater(t, last.Timestamp, 1700000200.0)

	// Idempotency still holds within the round: re-running the same content with
	// no intervening reviewer reaction writes nothing more.
	require.Equal(t, 0, s.ApplyChangelog("doc.md", content, ""))

	got, err = s.Get("doc.md", "")
	require.NoError(t, err)
	require.Len(t, got.Comments[0].Reactions, 3, "no double reaction within a round")
}

func TestApplyChangelogDedupWindowStartsAtLastReviewerReaction(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	// "first pass" belongs to the previous round; "second pass" is this round's
	// answer. Only the latter is a replay.
	s := reviewWithReactions(t, id, 1,
		model.CommentReaction{Actor: "agent", Kind: "addressed", Summary: "first pass", Timestamp: 1700000100},
		model.CommentReaction{Actor: "reviewer", Kind: "needs_clarification", Summary: "not quite", Timestamp: 1700000200},
		model.CommentReaction{Actor: "agent", Kind: "addressed", Summary: "second pass", Timestamp: 1700000300},
	)

	content := strings.Join([]string{
		"Updated heading",
		"",
		"<!-- changelog -->",
		"- [abcd1234] a previous round",
		"",
		"<!-- changelog -->",
		"- [abcd1234] first pass",
		"- [abcd1234] second pass",
	}, nl)

	require.Equal(t, 1, s.ApplyChangelog("doc.md", content, ""))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	summaries := []string{}
	for _, r := range got.Comments[0].Reactions {
		summaries = append(summaries, r.Summary)
	}
	require.Equal(t, []string{"first pass", "not quite", "second pass", "first pass"}, summaries)
}

func TestApplyChangelogDedupWindowUsesTheLastReviewerReactionNotTheFirst(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	// Three rounds. The current round opens at the SECOND reviewer reaction, so
	// only "round two" is a replay; "round one" predates the window and is new
	// again even though it appears in the history.
	s := reviewWithReactions(t, id, 1,
		model.CommentReaction{Actor: "reviewer", Kind: "needs_clarification", Summary: "start here", Timestamp: 1700000100},
		model.CommentReaction{Actor: "agent", Kind: "addressed", Summary: "round one", Timestamp: 1700000200},
		model.CommentReaction{Actor: "reviewer", Kind: "needs_clarification", Summary: "still not it", Timestamp: 1700000300},
		model.CommentReaction{Actor: "agent", Kind: "addressed", Summary: "round two", Timestamp: 1700000400},
	)

	content := strings.Join([]string{
		"<!-- changelog -->",
		"- [abcd1234] a previous round",
		"",
		"<!-- changelog -->",
		"- [abcd1234] round one",
		"- [abcd1234] round two",
	}, nl)

	require.Equal(t, 1, s.ApplyChangelog("doc.md", content, ""))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	summaries := []string{}
	for _, r := range got.Comments[0].Reactions {
		summaries = append(summaries, r.Summary)
	}
	require.Equal(t,
		[]string{"start here", "round one", "still not it", "round two", "round one"},
		summaries)
}

func TestApplyChangelogAnyReviewerReactionKindOpensANewRound(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	// Accepting a response appends {reviewer, noted} rather than
	// needs_clarification. That still closes the round, so a later agent response
	// reusing the earlier wording is a genuine answer, not a replay.
	s := reviewWithReactions(t, id, 1,
		model.CommentReaction{Actor: "agent", Kind: "addressed", Summary: "Fixed it", Timestamp: 1700000100},
		model.CommentReaction{Actor: "reviewer", Kind: "noted", Summary: "thanks", Timestamp: 1700000200},
	)

	content := "<!-- changelog -->" + nl + "- [abcd1234] a previous round" + nl + nl +
		"<!-- changelog -->" + nl + "- [abcd1234] Fixed it"
	require.Equal(t, 1, s.ApplyChangelog("doc.md", content, ""))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Len(t, got.Comments[0].Reactions, 3)
	require.Equal(t, "agent", got.Comments[0].Reactions[2].Actor)
	require.Equal(t, "Fixed it", got.Comments[0].Reactions[2].Summary)
}

func TestApplyChangelogDedupIgnoresReviewerReactionsBeforeTheAgentsFirst(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	// A reviewer reaction as the newest entry (e.g. a reply on a thread the agent
	// never answered) leaves an empty current round, so any bullet is new.
	s := reviewWithReactions(t, id, 1,
		model.CommentReaction{Actor: "reviewer", Kind: "needs_clarification", Summary: "bumping this", Timestamp: 1700000100},
	)

	content := "<!-- changelog -->" + nl + "- [abcd1234] done now"
	require.Equal(t, 1, s.ApplyChangelog("doc.md", content, ""))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Len(t, got.Comments[0].Reactions, 2)
	require.Equal(t, "agent", got.Comments[0].Reactions[1].Actor)
	require.Equal(t, "done now", got.Comments[0].Reactions[1].Summary)
}

// EditedAt persistence: the frontend's "an edit re-queues the comment for the
// agent" rule compares edited_at against the agent's last response time, so the
// field is worthless unless it survives the store's JSON round trip.

func TestEditedAtRoundTrips(t *testing.T) {
	ResetCacheForTests()
	s := NewStore(t.TempDir())
	data := model.NewReviewData("doc.md")

	edited := model.NewReviewComment("edited-1", "please fix (reworded)", 1700000000)
	edited.EditedAt = 1700000500.5
	untouched := model.NewReviewComment("untouched-1", "please fix", 1700000000)
	data.Comments = append(data.Comments, edited, untouched)

	require.NoError(t, s.Save("doc.md", "", data))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Len(t, got.Comments, 2)
	require.Equal(t, 1700000500.5, got.Comments[0].EditedAt)
	require.Zero(t, got.Comments[1].EditedAt)

	// A never-edited comment must not emit the key at all, so existing review
	// files stay byte-identical after a rewrite.
	raw, err := os.ReadFile(s.reviewFile("doc.md", ""))
	require.NoError(t, err)
	var probe struct {
		Comments []map[string]any `json:"comments"`
	}
	require.NoError(t, json.Unmarshal(raw, &probe))
	require.Len(t, probe.Comments, 2)
	require.Contains(t, probe.Comments[0], "edited_at")
	require.NotContains(t, probe.Comments[1], "edited_at")
	require.Equal(t, 1, strings.Count(string(raw), `"edited_at"`),
		"only the edited comment may carry the key in the file bytes")
}

func TestApplyChangelogEditOpensANewRoundWithoutAReviewerReaction(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	// The reviewer reworded the comment instead of replying, so there is no
	// reviewer reaction to open the round — only EditedAt. Without the edit
	// clause the agent's answer to the NEW wording is dropped as a replay of its
	// answer to the old wording, and the thread deadlocks: the reviewer keeps
	// seeing an unanswered comment the agent believes it answered.
	s := reviewWithEditedComment(t, id, 1700000200,
		model.CommentReaction{Actor: "agent", Kind: "addressed", Summary: "Fixed it", Timestamp: 1700000100},
	)

	// The agent appends a fresh block for the new round.
	content := strings.Join([]string{
		"Updated heading",
		"",
		"<!-- changelog -->",
		"- [abcd1234] a previous round",
		"",
		"<!-- changelog -->",
		"- [abcd1234] Fixed it",
	}, nl)

	require.Equal(t, 1, s.ApplyChangelog("doc.md", content, ""))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Len(t, got.Comments[0].Reactions, 2,
		"the response to the reworded comment must not be dropped as a replay")
	last := got.Comments[0].Reactions[1]
	require.Equal(t, "agent", last.Actor)
	require.Equal(t, "addressed", last.Kind)
	require.Equal(t, "Fixed it", last.Summary)
	require.Greater(t, last.Timestamp, 1700000200.0)
}

func TestApplyChangelogEditBeforeTheResponseStillDedups(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	// The converse guard: the edit PREDATES the agent's response, so that
	// response already answered the current wording. Re-running the same
	// changelog must still dedup — otherwise the edit clause degenerates into
	// "never dedup" and every watcher pass appends a duplicate reaction.
	s := reviewWithEditedComment(t, id, 1700000050,
		model.CommentReaction{Actor: "agent", Kind: "addressed", Summary: "Fixed it", Timestamp: 1700000100},
	)

	content := strings.Join([]string{
		"Updated heading",
		"",
		"<!-- changelog -->",
		"- [abcd1234] Fixed it",
	}, nl)

	require.Equal(t, 0, s.ApplyChangelog("doc.md", content, ""))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Len(t, got.Comments[0].Reactions, 1, "no duplicate reaction")
	require.Equal(t, 1700000100.0, got.Comments[0].Reactions[0].Timestamp)
}

func TestApplyChangelogPreservesEditedAt(t *testing.T) {
	ResetCacheForTests()
	s := NewStore(t.TempDir())
	data := model.NewReviewData("doc.md")
	c := model.NewReviewComment("abcd1234-0000-0000-0000-000000000001", "please fix (reworded)", 1700000000)
	c.EditedAt = 1700000500
	c.Anchor = &model.CommentAnchor{SourceLine: 1}
	data.Comments = append(data.Comments, c)
	require.NoError(t, s.Save("doc.md", "", data))

	content := "<!-- changelog -->" + nl + "- [abcd1234] handled the reworded ask"
	require.Equal(t, 1, s.ApplyChangelog("doc.md", content, ""))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Equal(t, 1700000500.0, got.Comments[0].EditedAt,
		"the watcher's rewrite must not drop edited_at")
}

// A changelog block stays in the document, so every later save re-parses it.
// Re-applying it would append the agent's old answer after the reviewer's
// follow-up and mark that follow-up answered — the reply silently swallowed by
// an unrelated edit somewhere else in the file.
func TestApplyChangelogIgnoresAReReadOfTheSameBlock(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	s := reviewWithReactions(t, id, 1)

	withChangelog := strings.Join([]string{
		"Heading",
		"",
		"<!-- changelog -->",
		"- [abcd1234] Fixed it",
	}, "\n")
	require.Equal(t, 1, s.ApplyChangelog("doc.md", withChangelog, ""))

	// The reviewer is not satisfied and replies.
	data, err := s.Get("doc.md", "")
	require.NoError(t, err)
	data.Comments[0].Reactions = append(data.Comments[0].Reactions,
		model.CommentReaction{Actor: "reviewer", Kind: "needs_clarification", Summary: "still wrong", Timestamp: 1700000300})
	require.NoError(t, s.Save("doc.md", "", data))

	// An edit elsewhere in the document re-triggers the watcher.
	unrelated := withChangelog + "\n\nAn unrelated new paragraph.\n"
	require.Equal(t, 0, s.ApplyChangelog("doc.md", unrelated, ""),
		"re-reading the same changelog block must not record another answer")

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	last := got.Comments[0].Reactions[len(got.Comments[0].Reactions)-1]
	require.Equal(t, "reviewer", last.Actor,
		"the reviewer's follow-up must remain the last turn, i.e. still owed to the agent")
}

// The converse: a genuine second round whose summary repeats the first round's
// verbatim. The agent appends a fresh block, so the document's changelog region
// changes even though the bullets read identically — fingerprinting only the
// parsed bullets would drop this real answer and deadlock the thread.
func TestApplyChangelogAcceptsANewBlockRepeatingTheSameSummary(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	s := reviewWithReactions(t, id, 1)

	round1 := strings.Join([]string{
		"Heading",
		"",
		"<!-- changelog -->",
		"- [abcd1234] Reworded for clarity",
	}, "\n")
	require.Equal(t, 1, s.ApplyChangelog("doc.md", round1, ""))

	data, err := s.Get("doc.md", "")
	require.NoError(t, err)
	data.Comments[0].Reactions = append(data.Comments[0].Reactions,
		model.CommentReaction{Actor: "reviewer", Kind: "needs_clarification", Summary: "still wrong", Timestamp: 1700000300})
	require.NoError(t, s.Save("doc.md", "", data))

	// Same wording, but a new block: the agent answered again.
	round2 := round1 + "\n\n<!-- changelog -->\n- [abcd1234] Reworded for clarity\n"
	require.Equal(t, 1, s.ApplyChangelog("doc.md", round2, ""),
		"a fresh block is a real answer even when its summary repeats verbatim")

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	rs := got.Comments[0].Reactions
	require.Len(t, rs, 3)
	require.Equal(t, "agent", rs[2].Actor, "round two must land as the newest turn")
}

// A review stored before AppliedChangelog existed carries no record of what it
// already consumed. On the first watcher pass after an upgrade the block in the
// document has already been applied — possibly months ago — and the reviewer
// may have replied since. Re-applying it would append the stale answer on top
// of that follow-up and mark it answered, across every existing review at once.
func TestApplyChangelogDoesNotReapplyToALegacyReview(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	// Pre-upgrade shape: the answer is already recorded, the reviewer has since
	// replied, and there is no AppliedChangelog fingerprint.
	ResetCacheForTests()
	s := NewStore(t.TempDir())
	data := model.NewReviewData("doc.md")
	c := model.NewReviewComment(id, "please fix", 1700000000)
	c.Anchor = &model.CommentAnchor{SourceLine: 1}
	c.Reactions = append(c.Reactions,
		model.CommentReaction{Actor: "agent", Kind: "addressed", Summary: "Fixed it", Timestamp: 1700000100},
		model.CommentReaction{Actor: "reviewer", Kind: "needs_clarification", Summary: "still wrong", Timestamp: 1700000200},
	)
	data.Comments = append(data.Comments, c)
	require.NoError(t, s.Save("doc.md", "", data)) // note: no AppliedChangelog
	before, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Empty(t, before.AppliedChangelog, "fixture must look like a pre-upgrade review")

	content := strings.Join([]string{
		"Heading",
		"",
		"<!-- changelog -->",
		"- [abcd1234] Fixed it",
	}, "\n")
	require.Equal(t, 0, s.ApplyChangelog("doc.md", content, ""),
		"the already-consumed answer must not be re-applied on the first pass after upgrade")

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	rs := got.Comments[0].Reactions
	require.Len(t, rs, 2)
	require.Equal(t, "reviewer", rs[len(rs)-1].Actor,
		"the reviewer's follow-up must remain the last turn")
	require.NotEmpty(t, got.AppliedChangelog,
		"the pass should record a fingerprint so later passes use the scoped window")
}

// The upgrade path in its plainest form: a legacy review (no AppliedChangelog)
// whose comment already carries the exact reaction the block in the document
// would produce, and no reviewer has replied since. The block was consumed
// before the fingerprint field existed, so the first pass after the upgrade has
// nothing but the reaction history to tell it so. Duplicating here would double
// every answer in every existing review the moment the new build starts.
func TestApplyChangelogDoesNotDuplicateAReactionALegacyReviewAlreadyHas(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	ResetCacheForTests()
	s := NewStore(t.TempDir())
	data := model.NewReviewData("doc.md")
	c := model.NewReviewComment(id, "please fix", 1700000000)
	c.Anchor = &model.CommentAnchor{SourceLine: 1}
	c.Reactions = append(c.Reactions,
		model.CommentReaction{Actor: "agent", Kind: "addressed", Summary: "Fixed it", Timestamp: 1700000100})
	data.Comments = append(data.Comments, c)
	require.NoError(t, s.Save("doc.md", "", data)) // note: no AppliedChangelog

	before, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Empty(t, before.AppliedChangelog, "fixture must look like a pre-upgrade review")

	content := strings.Join([]string{
		"Heading",
		"",
		"<!-- changelog -->",
		"- [abcd1234] Fixed it",
	}, nl)

	require.Equal(t, 0, s.ApplyChangelog("doc.md", content, ""),
		"a block already consumed before the fingerprint existed must not be consumed again")

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Len(t, got.Comments[0].Reactions, 1,
		"the reaction the legacy review already holds must not be duplicated")
	require.Equal(t, 1700000100.0, got.Comments[0].Reactions[0].Timestamp,
		"the original reaction must survive untouched, not be replaced by a fresh stamp")
	require.NotEmpty(t, got.AppliedChangelog,
		"the upgrade pass must record a fingerprint so the review stops being legacy")
}

// The agent adds a bullet to the EXISTING block rather than appending a fresh
// one — a second comment answered in the same round. The document's changelog
// region changed, so the block is not a re-read: the new bullet must land. The
// bullet that was already applied must not land a second time, or the first
// comment collects a duplicate answer every time the agent touches the block.
func TestApplyChangelogAppliesABulletAddedToTheBlockInPlace(t *testing.T) {
	const idA = "aaaa1111-0000-0000-0000-000000000001"
	const idB = "bbbb2222-0000-0000-0000-000000000002"

	ResetCacheForTests()
	s := NewStore(t.TempDir())
	data := model.NewReviewData("doc.md")
	for _, id := range []string{idA, idB} {
		c := model.NewReviewComment(id, "please fix", 1700000000)
		c.Anchor = &model.CommentAnchor{SourceLine: 1}
		data.Comments = append(data.Comments, c)
	}
	require.NoError(t, s.Save("doc.md", "", data))

	round1 := strings.Join([]string{
		"Heading",
		"",
		"<!-- changelog -->",
		"- [aaaa1111] fixed the heading",
	}, nl)
	require.Equal(t, 1, s.ApplyChangelog("doc.md", round1, ""))

	// Same block, edited in place to answer the second comment too.
	round2 := round1 + nl + "- [bbbb2222] fixed the table"
	require.Equal(t, 1, s.ApplyChangelog("doc.md", round2, ""),
		"a bullet added to the block in place is a new answer, not a re-read")

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Len(t, got.Comments[0].Reactions, 1,
		"the bullet applied in round one must not be applied again")
	require.Equal(t, "fixed the heading", got.Comments[0].Reactions[0].Summary)
	require.Len(t, got.Comments[1].Reactions, 1)
	require.Equal(t, "fixed the table", got.Comments[1].Reactions[0].Summary)
	require.Equal(t, "agent", got.Comments[1].Reactions[0].Actor)
}

// Prose is not an answer. Editing the document around an already-consumed block
// — appending a paragraph after it, or inserting one before it — must read as
// the same block seen again. Otherwise the reviewer's follow-up gets buried
// under a replay of the agent's old answer by an edit that said nothing.
func TestApplyChangelogTreatsProseAroundTheBlockAsAReRead(t *testing.T) {
	id := "abcd1234-0000-0000-0000-000000000001"
	s := reviewWithReactions(t, id, 1)

	block := strings.Join([]string{
		"Heading",
		"",
		"<!-- changelog -->",
		"- [abcd1234] Fixed it",
	}, nl)
	require.Equal(t, 1, s.ApplyChangelog("doc.md", block, ""))

	// The reviewer pushes back, so a replay would be visibly destructive: it
	// would land after this turn and mark it answered.
	data, err := s.Get("doc.md", "")
	require.NoError(t, err)
	data.Comments[0].Reactions = append(data.Comments[0].Reactions,
		model.CommentReaction{Actor: "reviewer", Kind: "needs_clarification", Summary: "still wrong", Timestamp: 1700000300})
	require.NoError(t, s.Save("doc.md", "", data))

	require.Equal(t, 0, s.ApplyChangelog("doc.md", block+nl+nl+"A paragraph written after the block."+nl, ""),
		"prose appended after the block is a re-read")
	require.Equal(t, 0, s.ApplyChangelog("doc.md", "An introduction written before the block."+nl+nl+block, ""),
		"prose inserted before the block is a re-read")

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Len(t, got.Comments[0].Reactions, 2, "neither prose edit may record an answer")
	last := got.Comments[0].Reactions[1]
	require.Equal(t, "reviewer", last.Actor,
		"the reviewer's follow-up must remain the last turn, i.e. still owed to the agent")
}

// Only the LAST changelog block is ever applied, so editing or removing an
// earlier one is not a new answer. Treating it as one replays the live round's
// answer on top of the reviewer's follow-up and marks that follow-up answered.
func TestApplyChangelogIgnoresEditsToEarlierBlocks(t *testing.T) {
	const round1 = "Heading\n\n<!-- changelog -->\n- [abcd1234] Round one\n"
	const both = round1 + "\n<!-- changelog -->\n- [abcd1234] Round two\n"

	// Two rounds answered, and the reviewer has pushed back on the second.
	// Built per subtest: each is an alternative branch, not a continuation.
	twoRoundsThenFollowUp := func(t *testing.T) *Store {
		t.Helper()
		s := reviewWithComment(t, "abcd1234-0000-0000-0000-000000000001", 1)
		require.Equal(t, 1, s.ApplyChangelog("doc.md", round1, ""))
		appendReviewerFollowUp(t, s, "not enough", 1700000200)
		require.Equal(t, 1, s.ApplyChangelog("doc.md", both, ""))
		appendReviewerFollowUp(t, s, "still not enough", 1700000400)
		return s
	}

	for _, tc := range []struct {
		name    string
		content string
	}{
		// The agent tidies up: the superseded first block goes away. The live
		// block — the last one — is untouched, so there is nothing new to apply.
		{"earlier block pruned", "Heading\n\n<!-- changelog -->\n- [abcd1234] Round two\n"},
		// Same, for a reworded earlier bullet.
		{"earlier block reworded", "Heading\n\n<!-- changelog -->\n- [abcd1234] Round ONE (typo fixed)\n\n<!-- changelog -->\n- [abcd1234] Round two\n"},
		// And prose churn around the blocks is likewise not an answer.
		{"prose appended after the block", both + "\nAn unrelated new paragraph.\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := twoRoundsThenFollowUp(t)
			require.Equal(t, 0, s.ApplyChangelog("doc.md", tc.content, ""))

			got, err := s.Get("doc.md", "")
			require.NoError(t, err)
			rs := got.Comments[0].Reactions
			require.Equal(t, "reviewer", rs[len(rs)-1].Actor,
				"the reviewer's follow-up must remain the last turn, i.e. still owed to the agent")
		})
	}

	t.Run("a genuine next round still lands after the housekeeping", func(t *testing.T) {
		s := twoRoundsThenFollowUp(t)
		pruned := "Heading\n\n<!-- changelog -->\n- [abcd1234] Round two\n"
		require.Equal(t, 0, s.ApplyChangelog("doc.md", pruned, ""))
		require.Equal(t, 1, s.ApplyChangelog("doc.md",
			pruned+"\n<!-- changelog -->\n- [abcd1234] Round three\n", ""))
	})
}

// appendReviewerFollowUp records a reviewer reply straight into the store, the
// way a browser PUT would.
func appendReviewerFollowUp(t *testing.T, s *Store, summary string, ts float64) {
	t.Helper()
	data, err := s.Get("doc.md", "")
	require.NoError(t, err)
	data.Comments[0].Reactions = append(data.Comments[0].Reactions,
		model.CommentReaction{Actor: "reviewer", Kind: "needs_clarification", Summary: summary, Timestamp: ts})
	require.NoError(t, s.Save("doc.md", "", data))
}

// The agent edits the LIVE block in place — typically to add a bullet for
// another comment — rather than appending a fresh one. The bullets already
// applied from that block are not new answers: replaying them lands the old
// response on top of their reviewers' follow-ups and marks those answered.
func TestApplyChangelogEditedBlockDoesNotReplayItsAppliedBullets(t *testing.T) {
	ResetCacheForTests()
	s := NewStore(t.TempDir())
	data := model.NewReviewData("doc.md")
	for _, id := range []string{
		"aaaa1111-0000-0000-0000-000000000001",
		"bbbb2222-0000-0000-0000-000000000002",
	} {
		c := model.NewReviewComment(id, "please fix", 1700000000)
		c.Anchor = &model.CommentAnchor{SourceLine: 1}
		data.Comments = append(data.Comments, c)
	}
	require.NoError(t, s.Save("doc.md", "", data))

	one := "Head\n\n<!-- changelog -->\n- [aaaa1111] Fixed A\n"
	require.Equal(t, 1, s.ApplyChangelog("doc.md", one, ""))
	appendReviewerFollowUp(t, s, "not good enough", 1700000200)

	// Same block, one bullet added for B. Only B's is new.
	two := "Head\n\n<!-- changelog -->\n- [aaaa1111] Fixed A\n- [bbbb2222] Fixed B\n"
	require.Equal(t, 1, s.ApplyChangelog("doc.md", two, ""))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)

	a := got.Comments[0].Reactions
	require.Equal(t, "reviewer", a[len(a)-1].Actor,
		"A's follow-up must still be the last turn — its bullet was already applied")
	require.Len(t, a, 2)

	b := got.Comments[1].Reactions
	require.Len(t, b, 1, "B's bullet is new and must land")
	require.Equal(t, "Fixed B", b[0].Summary)
}
