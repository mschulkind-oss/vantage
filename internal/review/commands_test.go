package review

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/model"
)

// cmdDoc is the document used by the command tests. Line 3 holds the first
// paragraph, line 5 the second; blockTextAt canonicalizes (lowercases,
// collapses whitespace) what it captures.
const cmdDoc = "# Title\n\nFirst Paragraph text.\n\nSecond Paragraph HERE.\n"

// anchoredComment builds a comment anchored at sourceLine.
func anchoredComment(id, text string, sourceLine int) model.ReviewComment {
	c := model.NewReviewComment(id, text, 1700000000)
	c.Anchor = &model.CommentAnchor{SourceLine: sourceLine}
	return c
}

func TestAddCommentCreatesReviewAndCapturesBlock(t *testing.T) {
	s := NewStore(t.TempDir())

	data, err := s.AddComment("a.md", "", anchoredComment("c1", "tighten", 3), cmdDoc)
	require.NoError(t, err)
	require.Len(t, data.Comments, 1)
	require.Equal(t, "first paragraph text.", data.Comments[0].CapturedBlock)

	// The command persisted: a fresh Get sees the same comment.
	stored, err := s.Get("a.md", "")
	require.NoError(t, err)
	require.NotNil(t, stored)
	require.Len(t, stored.Comments, 1)
	require.Equal(t, "first paragraph text.", stored.Comments[0].CapturedBlock)
	require.NotNil(t, stored.Comments[0].Reactions, "reactions must round-trip as []")
}

func TestAddCommentAppendsToExistingReview(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "one", 3), cmdDoc)
	require.NoError(t, err)

	data, err := s.AddComment("a.md", "", anchoredComment("c2", "two", 5), cmdDoc)
	require.NoError(t, err)
	require.Len(t, data.Comments, 2)
	require.Equal(t, "second paragraph here.", data.Comments[1].CapturedBlock)
}

func TestAddCommentAnchorlessCapturesEmpty(t *testing.T) {
	s := NewStore(t.TempDir())
	data, err := s.AddComment("a.md", "", model.NewReviewComment("c1", "doc-level", 1700000000), cmdDoc)
	require.NoError(t, err)
	require.Empty(t, data.Comments[0].CapturedBlock)
}

func TestAddCommentIgnoresClientCapturedBlock(t *testing.T) {
	s := NewStore(t.TempDir())
	c := anchoredComment("c1", "x", 3)
	// CapturedBlock is server-owned: whatever the caller put there is replaced
	// by the capture from the document.
	c.CapturedBlock = "client-supplied lie"
	data, err := s.AddComment("a.md", "", c, cmdDoc)
	require.NoError(t, err)
	require.Equal(t, "first paragraph text.", data.Comments[0].CapturedBlock)
}

func TestEditCommentTextStampsEditedAt(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "old wording", 3), cmdDoc)
	require.NoError(t, err)

	data, err := s.EditCommentText("a.md", "", "c1", "new wording", cmdDoc)
	require.NoError(t, err)
	require.Equal(t, "new wording", data.Comments[0].Comment)
	require.Greater(t, data.Comments[0].EditedAt, float64(0))
}

func TestEditCommentTextUnknownID(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "x", 3), cmdDoc)
	require.NoError(t, err)

	_, err = s.EditCommentText("a.md", "", "nope", "text", cmdDoc)
	require.ErrorIs(t, err, ErrCommentNotFound)
}

func TestCommandsOnAbsentReviewReturnNotFound(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.EditCommentText("ghost.md", "", "c1", "x", cmdDoc)
	require.ErrorIs(t, err, ErrCommentNotFound)
	_, err = s.SetResolved("ghost.md", "", "c1", true)
	require.ErrorIs(t, err, ErrCommentNotFound)
	_, err = s.Reply("ghost.md", "", "c1", "hi", cmdDoc)
	require.ErrorIs(t, err, ErrCommentNotFound)
	_, err = s.Accept("ghost.md", "", "c1")
	require.ErrorIs(t, err, ErrCommentNotFound)
	_, err = s.DeleteComment("ghost.md", "", "c1")
	require.ErrorIs(t, err, ErrCommentNotFound)
	_, err = s.DismissMany("ghost.md", "", nil)
	require.ErrorIs(t, err, ErrReviewNotFound)
}

func TestSetResolvedBothWays(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "x", 3), cmdDoc)
	require.NoError(t, err)

	data, err := s.SetResolved("a.md", "", "c1", true)
	require.NoError(t, err)
	require.True(t, data.Comments[0].Resolved)
	// A dismissal records no reaction — it is not a conversation turn.
	require.Empty(t, data.Comments[0].Reactions)

	data, err = s.SetResolved("a.md", "", "c1", false)
	require.NoError(t, err)
	require.False(t, data.Comments[0].Resolved)
}

func TestReplyAppendsReactionAndRecaptures(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "x", 3), cmdDoc)
	require.NoError(t, err)

	// The document changed since the comment was created; the follow-up
	// re-captures because the reviewer is looking at the current text.
	edited := "# Title\n\nRewritten paragraph.\n\nSecond Paragraph HERE.\n"
	data, err := s.Reply("a.md", "", "c1", "still unclear", edited)
	require.NoError(t, err)

	c := data.Comments[0]
	require.Len(t, c.Reactions, 1)
	require.Equal(t, "reviewer", c.Reactions[0].Actor)
	require.Equal(t, "needs_clarification", c.Reactions[0].Kind)
	require.Equal(t, "still unclear", c.Reactions[0].Summary)
	require.Greater(t, c.Reactions[0].Timestamp, float64(0))
	require.Equal(t, "rewritten paragraph.", c.CapturedBlock)
	require.False(t, c.Resolved)
}

func TestReopenReplyClearsResolved(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "x", 3), cmdDoc)
	require.NoError(t, err)
	_, err = s.SetResolved("a.md", "", "c1", true)
	require.NoError(t, err)

	data, err := s.ReopenReply("a.md", "", "c1", "not fixed", cmdDoc)
	require.NoError(t, err)
	require.False(t, data.Comments[0].Resolved)
	require.Len(t, data.Comments[0].Reactions, 1)
	require.Equal(t, "needs_clarification", data.Comments[0].Reactions[0].Kind)
}

func TestAcceptAppendsAcceptedAndResolves(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "x", 3), cmdDoc)
	require.NoError(t, err)

	data, err := s.Accept("a.md", "", "c1")
	require.NoError(t, err)
	c := data.Comments[0]
	require.True(t, c.Resolved)
	require.Len(t, c.Reactions, 1)
	require.Equal(t, "reviewer", c.Reactions[0].Actor)
	require.Equal(t, "noted", c.Reactions[0].Kind)
	require.Equal(t, "Accepted", c.Reactions[0].Summary)
}

func TestDismissManyAllResolvesEveryComment(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "one", 3), cmdDoc)
	require.NoError(t, err)
	_, err = s.AddComment("a.md", "", anchoredComment("c2", "two", 5), cmdDoc)
	require.NoError(t, err)

	data, err := s.DismissMany("a.md", "", nil)
	require.NoError(t, err)
	for _, c := range data.Comments {
		require.True(t, c.Resolved, "comment %s", c.ID)
		require.Empty(t, c.Reactions, "dismissal must not record reactions")
	}
}

func TestDismissManyByIDsTargetsOnlyListed(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "one", 3), cmdDoc)
	require.NoError(t, err)
	_, err = s.AddComment("a.md", "", anchoredComment("c2", "two", 5), cmdDoc)
	require.NoError(t, err)

	// Unknown ids are ignored, listed ones resolved, others untouched.
	data, err := s.DismissMany("a.md", "", []string{"c2", "ghost"})
	require.NoError(t, err)
	require.False(t, data.Comments[0].Resolved)
	require.True(t, data.Comments[1].Resolved)
}

func TestDeleteCommentRemoves(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "one", 3), cmdDoc)
	require.NoError(t, err)
	_, err = s.AddComment("a.md", "", anchoredComment("c2", "two", 5), cmdDoc)
	require.NoError(t, err)

	data, err := s.DeleteComment("a.md", "", "c1")
	require.NoError(t, err)
	require.Len(t, data.Comments, 1)
	require.Equal(t, "c2", data.Comments[0].ID)

	_, err = s.DeleteComment("a.md", "", "c1")
	require.ErrorIs(t, err, ErrCommentNotFound)
}

// --- ApplyResponses ---

// seedForResponses creates a review with one comment anchored at line 3 whose
// captured block is cmdDoc's first paragraph.
func seedForResponses(t *testing.T, s *Store) {
	t.Helper()
	c := model.NewReviewComment("abcd1234", "please fix", 1700000000)
	c.Anchor = &model.CommentAnchor{SourceLine: 3}
	_, err := s.AddComment("a.md", "", c, cmdDoc)
	require.NoError(t, err)
}

func TestApplyResponsesRecordsReactionWithHonestCapture(t *testing.T) {
	s := NewStore(t.TempDir())
	seedForResponses(t, s)

	after := "# Title\n\nFixed paragraph text.\n\nSecond Paragraph HERE.\n"
	data, applied, err := s.ApplyResponses("a.md", "",
		[]ResponseEntry{{ShortID: "abcd", Summary: "Fixed it", Nonce: "n1"}}, after)
	require.NoError(t, err)
	require.Equal(t, 1, applied)

	c := data.Comments[0]
	require.Len(t, c.Reactions, 1)
	r := c.Reactions[0]
	require.Equal(t, "agent", r.Actor)
	require.Equal(t, "addressed", r.Kind)
	require.Equal(t, "Fixed it", r.Summary)
	// before = what the reviewer was looking at when commenting; after = the
	// delivered document's block.
	require.Equal(t, "first paragraph text.", r.BeforeText)
	require.Equal(t, "fixed paragraph text.", r.AfterText)
	require.Equal(t, []string{"n1"}, data.Nonces)

	// Persisted, not just returned.
	stored, err := s.Get("a.md", "")
	require.NoError(t, err)
	require.Len(t, stored.Comments[0].Reactions, 1)
	require.Equal(t, []string{"n1"}, stored.Nonces)
}

func TestApplyResponsesNonceDedupAcrossBatches(t *testing.T) {
	s := NewStore(t.TempDir())
	seedForResponses(t, s)

	entries := []ResponseEntry{{ShortID: "abcd", Summary: "Fixed it", Nonce: "n1"}}
	_, applied, err := s.ApplyResponses("a.md", "", entries, cmdDoc)
	require.NoError(t, err)
	require.Equal(t, 1, applied)

	// A replayed delivery (crash between persist and inbox delete) is a no-op.
	data, applied, err := s.ApplyResponses("a.md", "", entries, cmdDoc)
	require.NoError(t, err)
	require.Equal(t, 0, applied)
	require.Len(t, data.Comments[0].Reactions, 1)
	require.Equal(t, []string{"n1"}, data.Nonces)
}

func TestApplyResponsesSharedNonceWithinBatchAppliesAll(t *testing.T) {
	s := NewStore(t.TempDir())
	seedForResponses(t, s)
	c2 := model.NewReviewComment("ef567890", "also this", 1700000001)
	c2.Anchor = &model.CommentAnchor{SourceLine: 5}
	_, err := s.AddComment("a.md", "", c2, cmdDoc)
	require.NoError(t, err)

	// One paste = one content-derived nonce shared by every bullet. Both
	// entries must land; the nonce is recorded once.
	entries := []ResponseEntry{
		{ShortID: "abcd", Summary: "Fixed one", Nonce: "paste-nonce"},
		{ShortID: "ef56", Summary: "Fixed two", Nonce: "paste-nonce"},
	}
	data, applied, err := s.ApplyResponses("a.md", "", entries, cmdDoc)
	require.NoError(t, err)
	require.Equal(t, 2, applied)
	require.Len(t, data.Comments[0].Reactions, 1)
	require.Len(t, data.Comments[1].Reactions, 1)
	require.Equal(t, []string{"paste-nonce"}, data.Nonces)

	// The double-paste is then fully deduped.
	_, applied, err = s.ApplyResponses("a.md", "", entries, cmdDoc)
	require.NoError(t, err)
	require.Equal(t, 0, applied)
}

func TestApplyResponsesExactDuplicateEntryInBatchSkipped(t *testing.T) {
	s := NewStore(t.TempDir())
	seedForResponses(t, s)

	// An agent re-appending its identical inbox line lands in one batch; the
	// byte-identical duplicate is applied once. The non-zero Round is load
	// bearing: ResponseEntry is the map key here, so making Round a pointer
	// would silently stop collapsing duplicates.
	e := ResponseEntry{ShortID: "abcd", Summary: "Fixed it", Nonce: "n1", Round: 2}
	data, applied, err := s.ApplyResponses("a.md", "", []ResponseEntry{e, e}, cmdDoc)
	require.NoError(t, err)
	require.Equal(t, 1, applied)
	require.Len(t, data.Comments[0].Reactions, 1)
}

func TestApplyResponsesUnknownShortIDSkippedWithoutConsumingNonce(t *testing.T) {
	s := NewStore(t.TempDir())
	seedForResponses(t, s)

	data, applied, err := s.ApplyResponses("a.md", "",
		[]ResponseEntry{{ShortID: "ffff", Summary: "went nowhere", Nonce: "n1"}}, cmdDoc)
	require.NoError(t, err)
	require.Equal(t, 0, applied)
	require.Empty(t, data.Comments[0].Reactions)
	require.Empty(t, data.Nonces, "a dropped response must not burn its nonce")
}

func TestApplyResponsesAmbiguousShortIDSkipped(t *testing.T) {
	s := NewStore(t.TempDir())
	seedForResponses(t, s)
	c2 := model.NewReviewComment("abcdffff", "second", 1700000001)
	_, err := s.AddComment("a.md", "", c2, cmdDoc)
	require.NoError(t, err)

	_, applied, err := s.ApplyResponses("a.md", "",
		[]ResponseEntry{{ShortID: "abcd", Summary: "which one?", Nonce: "n1"}}, cmdDoc)
	require.NoError(t, err)
	require.Equal(t, 0, applied)
}

func TestApplyResponsesEmptyNonceAlwaysApplies(t *testing.T) {
	s := NewStore(t.TempDir())
	seedForResponses(t, s)

	// A missing nonce means "no dedup key": it must neither be recorded nor
	// cause later empty-nonce deliveries to be swallowed.
	for i := 0; i < 2; i++ {
		_, applied, err := s.ApplyResponses("a.md", "",
			[]ResponseEntry{{ShortID: "abcd", Summary: fmt.Sprintf("round %d", i)}}, cmdDoc)
		require.NoError(t, err)
		require.Equal(t, 1, applied)
	}
	data, err := s.Get("a.md", "")
	require.NoError(t, err)
	require.Len(t, data.Comments[0].Reactions, 2)
	require.Empty(t, data.Nonces)
}

func TestApplyResponsesNonceCapDropsOldest(t *testing.T) {
	s := NewStore(t.TempDir())
	seedForResponses(t, s)

	data, err := s.Get("a.md", "")
	require.NoError(t, err)
	for i := 0; i < maxNonces; i++ {
		data.Nonces = append(data.Nonces, fmt.Sprintf("n%03d", i))
	}
	require.NoError(t, s.Save("a.md", "", data))

	got, applied, err := s.ApplyResponses("a.md", "",
		[]ResponseEntry{{ShortID: "abcd", Summary: "one more", Nonce: "fresh"}}, cmdDoc)
	require.NoError(t, err)
	require.Equal(t, 1, applied)
	require.Len(t, got.Nonces, maxNonces)
	require.Equal(t, "n001", got.Nonces[0], "oldest nonce must be dropped")
	require.Equal(t, "fresh", got.Nonces[maxNonces-1])
}

func TestApplyResponsesNoReviewIsNoop(t *testing.T) {
	s := NewStore(t.TempDir())
	data, applied, err := s.ApplyResponses("ghost.md", "",
		[]ResponseEntry{{ShortID: "abcd", Summary: "x", Nonce: "n1"}}, cmdDoc)
	require.NoError(t, err)
	require.Nil(t, data)
	require.Zero(t, applied)

	// No review file was created as a side effect.
	stored, err := s.Get("ghost.md", "")
	require.NoError(t, err)
	require.Nil(t, stored)
}

func TestParseResponses(t *testing.T) {
	cases := []struct {
		name string
		text string
		want []ResponseEntry
	}{
		{"empty", "", nil},
		{"prose only", "I fixed everything.\nThanks!", nil},
		{"single bullet", "- [abcd1234] Fixed the thing",
			[]ResponseEntry{{ShortID: "abcd1234", Summary: "Fixed the thing", Round: RoundUnknown}}},
		{"bullets with junk and marker", "<!-- changelog -->\n- [abcd] One\nnot a bullet\n  - [EF56] Two\n- [xy] too short",
			[]ResponseEntry{{ShortID: "abcd", Summary: "One", Round: RoundUnknown}, {ShortID: "ef56", Summary: "Two", Round: RoundUnknown}}},
		{"fenced paste", "```\n- [abcd] Fixed\n```",
			[]ResponseEntry{{ShortID: "abcd", Summary: "Fixed", Round: RoundUnknown}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, ParseResponses(tc.text))
		})
	}
}

func TestEditCommentTextRecapturesBlock(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "please tighten", 3), cmdDoc)
	require.NoError(t, err)

	// Round 1: the agent rewrites the anchored block and delivers.
	v2 := strings.Replace(cmdDoc, "First Paragraph text.", "Version two text.", 1)
	_, applied, err := s.ApplyResponses("a.md", "",
		[]ResponseEntry{{ShortID: "c1", Summary: "round one", Nonce: "n1", Round: RoundUnknown}}, v2)
	require.NoError(t, err)
	require.Equal(t, 1, applied)

	// The reviewer rewords the comment while looking at v2 — the same situation
	// a reply puts them in, so the same capture point.
	data, err := s.EditCommentText("a.md", "", "c1", "still too long", v2)
	require.NoError(t, err)
	require.Equal(t, "version two text.", data.Comments[0].CapturedBlock)

	v3 := strings.Replace(v2, "Version two text.", "Version three text.", 1)
	data, _, err = s.ApplyResponses("a.md", "",
		[]ResponseEntry{{ShortID: "c1", Summary: "round two", Nonce: "n2", Round: RoundUnknown}}, v3)
	require.NoError(t, err)

	r2 := data.Comments[0].Reactions[1]
	require.Equal(t, "version two text.", r2.BeforeText,
		"round two's diff must not span round one's changes")
	require.Equal(t, "version three text.", r2.AfterText)
}

func TestEditAfterDeliveryOutranksItInTheSameSecond(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "please tighten", 3), cmdDoc)
	require.NoError(t, err)

	data, _, err := s.ApplyResponses("a.md", "",
		[]ResponseEntry{{ShortID: "c1", Summary: "done", Nonce: "n1", Round: RoundUnknown}}, cmdDoc)
	require.NoError(t, err)
	delivered := data.Comments[0].Reactions[0].Timestamp

	data, err = s.EditCommentText("a.md", "", "c1", "still too long", cmdDoc)
	require.NoError(t, err)

	// Both stamps come from the same server clock, and the frontend's pending
	// predicate compares them with a strict ">". At whole-second resolution
	// these two calls tie, and the tie reads as "already answered" — the
	// reviewer's re-queue disappears with no trace.
	require.Greater(t, data.Comments[0].EditedAt, delivered,
		"an edit that follows a delivery must outrank it, not tie with it")
}

func TestApplyResponsesRecordsTheRoundItAnswers(t *testing.T) {
	s := NewStore(t.TempDir())
	seedForResponses(t, s)

	data, _, err := s.ApplyResponses("a.md", "",
		[]ResponseEntry{{ShortID: "abcd", Summary: "answered turn 0", Nonce: "n1", Round: 0}}, cmdDoc)
	require.NoError(t, err)
	require.NotNil(t, data.Comments[0].Reactions[0].AnswersRound)
	require.Equal(t, 0, *data.Comments[0].Reactions[0].AnswersRound,
		"round 0 is a real round, not an absent one")

	// A delivery that names no round records none — the paste door and any
	// clipboard payload predating the field keep behaving exactly as before.
	data, _, err = s.ApplyResponses("a.md", "",
		[]ResponseEntry{{ShortID: "abcd", Summary: "no round", Nonce: "n2", Round: RoundUnknown}}, cmdDoc)
	require.NoError(t, err)
	require.Nil(t, data.Comments[0].Reactions[1].AnswersRound)
}
