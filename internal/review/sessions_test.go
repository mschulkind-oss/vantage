package review

import (
	"strings"
	"sync"
	"testing"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/stretchr/testify/require"
)

func sessionDoc(t *testing.T, s *Store) {
	t.Helper()
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "original", 3), cmdDoc)
	require.NoError(t, err)
}

func TestBeginSessionSnapshotsBaselineAndReplaysIt(t *testing.T) {
	s := NewStore(t.TempDir())
	sessionDoc(t, s)
	_, a, err := s.BeginSession("a.md", "", "c1", "s1", "")
	require.NoError(t, err)
	require.Equal(t, "original", a.Baseline.Text)
	require.NotEmpty(t, a.RootTextVersion)
	require.True(t, a.Stale, "client showed no version, server has one")

	_, err = s.EditCommentTextIn("a.md", "", "c1", "typed", cmdDoc, "s1")
	require.NoError(t, err)
	// A lost ack: the retry gets the ORIGINAL baseline, not the typed text.
	_, a2, err := s.BeginSession("a.md", "", "c1", "s1", a.RootTextVersion)
	require.NoError(t, err)
	require.Equal(t, "original", a2.Baseline.Text)
	require.Equal(t, a.Baseline.RootTextVersion, a2.Baseline.RootTextVersion)
	require.True(t, a2.Stale, "shown the old version, root has moved on")
}

func TestSessionWritesNeedAnOpenSessionAndFinishClosesTheBarrier(t *testing.T) {
	s := NewStore(t.TempDir())
	sessionDoc(t, s)
	_, _, err := s.BeginSession("a.md", "", "c1", "s1", "")
	require.NoError(t, err)
	_, err = s.EditCommentTextIn("a.md", "", "c1", "x", cmdDoc, "nope")
	require.ErrorIs(t, err, ErrSessionNotFound)

	data, err := s.EditCommentTextIn("a.md", "", "c1", "x", cmdDoc, "s1")
	require.NoError(t, err)
	v1 := data.Comments[0].RootTextVersion
	data, err = s.EditCommentTextIn("a.md", "", "c1", "y", cmdDoc, "s1")
	require.NoError(t, err)
	require.NotEqual(t, v1, data.Comments[0].RootTextVersion)
	require.Equal(t, int64(3), data.Comments[0].MutationCounter) // create + 2 edits

	_, a, err := s.FinishSession("a.md", "", "c1", "s1")
	require.NoError(t, err)
	require.Equal(t, model.SessionKept, a.Outcome)
	_, err = s.EditCommentTextIn("a.md", "", "c1", "z", cmdDoc, "s1")
	require.ErrorIs(t, err, ErrSessionNotFound, "closed-session barrier")
	_, err = s.AddCommentWith("a.md", "", anchoredComment("c1", "z", 3), cmdDoc, CreateOptions{SessionID: "s1"})
	require.ErrorIs(t, err, ErrSessionNotFound)
	_, a, err = s.FinishSession("a.md", "", "c1", "s1")
	require.NoError(t, err, "finish replays")
	require.Equal(t, model.SessionKept, a.Outcome)
}

func TestRestoreExistingRootKeepsRepliesAndReadoptsBaseline(t *testing.T) {
	s := NewStore(t.TempDir())
	sessionDoc(t, s)
	before, _ := s.Get("a.md", "")
	baseVersion := before.Comments[0].RootTextVersion
	_, _, err := s.BeginSession("a.md", "", "c1", "s1", baseVersion)
	require.NoError(t, err)
	_, err = s.EditCommentTextIn("a.md", "", "c1", "typed", cmdDoc, "s1")
	require.NoError(t, err)
	_, err = s.SetResolved("a.md", "", "c1", true)
	require.NoError(t, err)
	_, err = s.Reply("a.md", "", "c1", "r1", "follow-up", cmdDoc)
	require.NoError(t, err)
	// The agent answered the typed wording, echoing the version it read.
	cur, _ := s.Get("a.md", "")
	typedVersion := cur.Comments[0].RootTextVersion
	_, n, err := s.ApplyResponses("a.md", "", []ResponseEntry{
		{ShortID: "c1", Summary: "done", Nonce: "n1", Round: RoundUnknown, RootVersion: typedVersion},
		{ShortID: "c1", Summary: "legacy", Nonce: "n2", Round: RoundUnknown},
	}, cmdDoc)
	require.NoError(t, err)
	require.Equal(t, 2, n)
	counter := cur.Comments[0].MutationCounter

	data, a, err := s.RestoreSession("a.md", "", "c1", "s1")
	require.NoError(t, err)
	c := data.Comments[0]
	require.Equal(t, model.SessionRestored, a.Outcome)
	require.Equal(t, "original", c.Comment)
	require.Equal(t, baseVersion, c.RootTextVersion)
	require.Greater(t, c.MutationCounter, counter)
	require.True(t, c.Resolved)
	require.Len(t, c.Reactions, 3, "reply and agent reactions untouched")
	// Coverage is version-aware: the first answer is to discarded wording, the
	// legacy one is unknown. The reviewer's reply is not an agent answer.
	require.Equal(t, []model.ReplyCoverage{
		{ReactionIndex: 1, RootTextVersion: typedVersion, Covers: "other"},
		{ReactionIndex: 2, Covers: "unknown"},
	}, c.ReplyCoverage)

	// Replay after the fact is idempotent, even for a later edit elsewhere.
	_, err = s.EditCommentText("a.md", "", "c1", "later", cmdDoc)
	require.NoError(t, err)
	data, a, err = s.RestoreSession("a.md", "", "c1", "s1")
	require.NoError(t, err)
	require.Equal(t, model.SessionRestored, a.Outcome)
	require.Equal(t, "later", data.Comments[0].Comment, "replay writes nothing")
}

func TestRestoreIsRefusedAfterAnExternalEditAndWritesNothing(t *testing.T) {
	s := NewStore(t.TempDir())
	sessionDoc(t, s)
	_, _, err := s.BeginSession("a.md", "", "c1", "s1", "")
	require.NoError(t, err)
	_, err = s.EditCommentTextIn("a.md", "", "c1", "mine", cmdDoc, "s1")
	require.NoError(t, err)
	// A legacy client (no session) edits.
	_, err = s.EditCommentText("a.md", "", "c1", "theirs", cmdDoc)
	require.NoError(t, err)

	rev := mustGet(t, s).MutationRevision
	_, _, err = s.RestoreSession("a.md", "", "c1", "s1")
	require.ErrorIs(t, err, ErrSessionConflict)
	after := mustGet(t, s)
	require.Equal(t, rev, after.MutationRevision, "no write")
	require.Equal(t, "theirs", after.Comments[0].Comment)
	require.Equal(t, model.SessionOpen, after.Sessions[0].State, "session stays open")
	// And the session can no longer write.
	_, err = s.EditCommentTextIn("a.md", "", "c1", "mine2", cmdDoc, "s1")
	require.ErrorIs(t, err, ErrSessionConflict)
}

func TestRestoreNewRootDeletesItWithRepliesAndRecordsTheID(t *testing.T) {
	s := NewStore(t.TempDir())
	_, a, err := s.BeginSession("a.md", "", "n1", "s1", "")
	require.NoError(t, err)
	require.True(t, a.Baseline.DidNotExist)
	_, err = s.AddCommentWith("a.md", "", anchoredComment("n1", "draft", 3), cmdDoc, CreateOptions{SessionID: "s1"})
	require.NoError(t, err)
	_, err = s.Reply("a.md", "", "n1", "r1", "hm", cmdDoc)
	require.NoError(t, err)

	data, a, err := s.RestoreSession("a.md", "", "n1", "s1")
	require.NoError(t, err)
	require.Equal(t, model.SessionDiscarded, a.Outcome)
	require.Empty(t, data.Comments)
	require.Contains(t, data.DeletedIDs, "n1")
	// A late retried create is refused; a replay still succeeds.
	_, err = s.AddCommentWith("a.md", "", anchoredComment("n1", "draft", 3), cmdDoc, CreateOptions{SessionID: "s1"})
	require.ErrorIs(t, err, ErrCommentNotFound)
	_, a, err = s.RestoreSession("a.md", "", "n1", "s1")
	require.NoError(t, err)
	require.Equal(t, model.SessionDiscarded, a.Outcome)
}

func TestRestoreOfARootDeletedElsewhereIsNotFound(t *testing.T) {
	s := NewStore(t.TempDir())
	sessionDoc(t, s)
	_, _, err := s.BeginSession("a.md", "", "c1", "s1", "")
	require.NoError(t, err)
	_, err = s.DeleteComment("a.md", "", "c1")
	require.NoError(t, err)
	_, _, err = s.RestoreSession("a.md", "", "c1", "s1")
	require.ErrorIs(t, err, ErrCommentNotFound)
	_, _, err = s.FinishSession("a.md", "", "c1", "s1")
	require.ErrorIs(t, err, ErrCommentNotFound, "finish cannot revive a deleted root")
	_, _, err = s.RestoreSession("a.md", "", "c1", "unknown")
	require.ErrorIs(t, err, ErrSessionNotFound)
}

func mustGet(t *testing.T, s *Store) *model.ReviewData {
	t.Helper()
	d, err := s.Get("a.md", "")
	require.NoError(t, err)
	return d
}

func TestMutationRevisionOnlyIncreases(t *testing.T) {
	s := NewStore(t.TempDir())
	sessionDoc(t, s)
	last := mustGet(t, s).MutationRevision
	require.Positive(t, last)
	for _, step := range []func() error{
		func() error { _, e := s.EditCommentText("a.md", "", "c1", "b", cmdDoc); return e },
		func() error { _, e := s.SetResolved("a.md", "", "c1", true); return e },
		func() error { _, e := s.DeleteComment("a.md", "", "c1"); return e },
	} {
		require.NoError(t, step())
		now := mustGet(t, s).MutationRevision
		require.Greater(t, now, last)
		last = now
	}
}

func TestAgentReplyIsNeverStampedWithTheCurrentVersion(t *testing.T) {
	s := NewStore(t.TempDir())
	sessionDoc(t, s)
	data, _, err := s.ApplyResponses("a.md", "", []ResponseEntry{{ShortID: "c1", Summary: "ok", Nonce: "n", Round: RoundUnknown}}, cmdDoc)
	require.NoError(t, err)
	require.Empty(t, data.Comments[0].Reactions[0].RootTextVersion)
	require.Equal(t, "unknown", data.Comments[0].ReplyCoverage[0].Covers)
}

func bindPre(s *Store, ev Evidence) BindPreconditions {
	return BindPreconditions{BootID: ev.BootID, DocumentGeneration: ev.DocumentGeneration, ContentHash: ev.ContentHash,
		MutationRevision: mustGetRev(s)}
}

func mustGetRev(s *Store) int64 {
	d, _ := s.Get("a.md", "")
	return d.MutationRevision
}

// scannedDoc is a DocSource whose scanner reports exactly units for content.
func scannedDoc(s *Store, content string, units map[string]Unit) DocSource {
	return func() *Observation {
		return &Observation{
			Evidence: s.ObserveDocument("", "a.md", ContentHash(content)),
			Content:  content,
			LoadScan: func() *Scan { return scanOf(units) },
		}
	}
}

// scanOf is the scan a checker would report for exactly these unique units.
func scanOf(units map[string]Unit) *Scan {
	sc := &Scan{Units: units}
	for _, u := range units {
		sc.Spans = append(sc.Spans, Span{StartLine: u.StartLine, EndLine: u.EndLine})
	}
	return sc
}

func unitAt(content string, start, end int) Unit {
	u, _ := BuildUnit(content, start, end)
	return u
}

func TestBindQuestionNeedsEveryPreconditionAndProofAndNeverRewritesABoundComment(t *testing.T) {
	s := NewStore(t.TempDir())
	sessionDoc(t, s)
	u := unitAt(cmdDoc, 3, 3)
	doc := scannedDoc(s, cmdDoc, map[string]Unit{"q1": u, "q2": unitAt(cmdDoc, 5, 5)})
	ev := doc().Evidence
	req := BindRequest{CommentID: "c1", QuestionID: "q1", Preconditions: bindPre(s, ev), Doc: doc,
		Evidence: &model.QuestionEvidence{UnitFingerprint: u.Fingerprint, SelectedQuote: "First Paragraph"}}

	for name, mut := range map[string]func(*BindRequest){
		"boot_id":             func(r *BindRequest) { r.Preconditions.BootID = "other" },
		"document_generation": func(r *BindRequest) { r.Preconditions.DocumentGeneration++ },
		"content_hash":        func(r *BindRequest) { r.Preconditions.ContentHash = "x" },
		"mutation_revision":   func(r *BindRequest) { r.Preconditions.MutationRevision-- },
		"question_id":         func(r *BindRequest) { r.QuestionID = "absent" },
		"unit_fingerprint":    func(r *BindRequest) { r.Evidence = &model.QuestionEvidence{UnitFingerprint: "stale"} },
		"selected_quote":      func(r *BindRequest) { r.Evidence = &model.QuestionEvidence{SelectedQuote: "not in the unit"} },
		"scanner_unavailable": func(r *BindRequest) { r.Doc = StaticDoc(cmdDoc) },
	} {
		bad := req
		mut(&bad)
		if name == "scanner_unavailable" {
			bad.Doc = func() *Observation { o := doc(); o.LoadScan = nil; return o }
		}
		_, err := s.BindQuestion("a.md", "", bad)
		var pe *PreconditionError
		require.ErrorAs(t, err, &pe, name)
		require.Equal(t, name, pe.Reason)
	}
	require.Empty(t, mustGet(t, s).Comments[0].QuestionID)

	data, err := s.BindQuestion("a.md", "", req)
	require.NoError(t, err)
	require.Equal(t, "q1", data.Comments[0].QuestionID)
	require.Equal(t, u.Fingerprint, data.Comments[0].QuestionEvidence.UnitFingerprint)

	other := req
	other.QuestionID = "q2"
	other.Evidence = nil
	other.Preconditions = bindPre(s, ev)
	_, err = s.BindQuestion("a.md", "", other)
	require.ErrorIs(t, err, ErrQuestionBound)
	other.AllowRebind = true
	data, err = s.BindQuestion("a.md", "", other)
	require.NoError(t, err)
	require.Equal(t, "q2", data.Comments[0].QuestionID)
	require.Equal(t, unitAt(cmdDoc, 5, 5).Fingerprint, data.Comments[0].QuestionEvidence.UnitFingerprint, "the server computed the fingerprint")
}

func TestDocumentGenerationIncreasesOnlyWhenTheHashChanges(t *testing.T) {
	s := NewStore(t.TempDir())
	a := s.ObserveDocument("", "a.md", "h1")
	b := s.ObserveDocument("", "a.md", "h1")
	c := s.ObserveDocument("", "a.md", "h2")
	d := s.ObserveDocument("", "a.md", "h1") // back to old contents: still moves forward
	require.Equal(t, a.DocumentGeneration, b.DocumentGeneration)
	require.Greater(t, c.DocumentGeneration, b.DocumentGeneration)
	require.Greater(t, d.DocumentGeneration, c.DocumentGeneration)
	require.Equal(t, a.BootID, d.BootID)
	require.NotEqual(t, NewStore(t.TempDir()).BootID(), s.BootID())
}

func TestCreateBindsOnlyWhatTheScannerProves(t *testing.T) {
	s := NewStore(t.TempDir())
	doc := scannedDoc(s, cmdDoc, map[string]Unit{"q1": unitAt(cmdDoc, 3, 3)})
	ev := doc().Evidence
	mk := func(id, qid string) model.ReviewComment {
		c := anchoredComment(id, "t", 3)
		c.QuestionID = qid
		c.QuestionEvidence = &model.QuestionEvidence{UnitFingerprint: "client-claim"}
		return c
	}
	good := BindPreconditions{BootID: ev.BootID, DocumentGeneration: ev.DocumentGeneration, ContentHash: ev.ContentHash}
	stale := good
	stale.ContentHash = "stale"

	// A bare id the scanner proves is bound, with the server's evidence — not the client's.
	bare := mk("bare", "q1")
	bare.QuestionEvidence = nil
	data, err := s.AddCommentWith("a.md", "", bare, cmdDoc, CreateOptions{Doc: doc})
	require.NoError(t, err)
	require.Equal(t, "q1", data.Comments[0].QuestionID)
	require.Equal(t, unitAt(cmdDoc, 3, 3).Fingerprint, data.Comments[0].QuestionEvidence.UnitFingerprint)
	// Every other create is stored unbound: wrong fingerprint claim, a stale document hash (a stale
	// mutation revision is NOT a reason on create, see TestCreateIsBoundDespiteAMovedReviewMutationRevision), unknown id,
	// a scanner-less server, and a create carrying only a bare id with no scanner.
	for name, opts := range map[string]CreateOptions{
		"fingerprint": {Doc: doc},
		"stale":       {Doc: doc, Preconditions: &stale},
		"noscanner":   {Doc: StaticDoc(cmdDoc)},
		"nodoc":       {},
	} {
		qid := "q1"
		data, err = s.AddCommentWith("a.md", "", mk(name, qid), cmdDoc, opts)
		require.NoError(t, err, name)
		got := commentByID(data.Comments, name)
		require.Empty(t, got.QuestionID, name)
		require.Nil(t, got.QuestionEvidence, name)
	}
	data, err = s.AddCommentWith("a.md", "", mk("ghost", "nope"), cmdDoc, CreateOptions{Doc: doc, Preconditions: &good})
	require.NoError(t, err)
	require.Empty(t, commentByID(data.Comments, "ghost").QuestionID)
	// A repeated create never rewrites the bound id.
	again := mk("bare", "q9")
	again.Comment = "new text"
	data, err = s.AddComment("a.md", "", again, cmdDoc)
	require.NoError(t, err)
	require.Equal(t, "q1", commentByID(data.Comments, "bare").QuestionID)
}

func TestMovePreservesBindingsSessionsAndDeletedIDs(t *testing.T) {
	s := NewStore(t.TempDir())
	c := anchoredComment("c1", "t", 3)
	c.QuestionID = "q1"
	_, err := s.AddCommentWith("old/a.md", "", c, cmdDoc, CreateOptions{Doc: scannedDoc(s, cmdDoc, map[string]Unit{"q1": unitAt(cmdDoc, 3, 3)})})
	require.NoError(t, err)
	_, _, err = s.BeginSession("old/a.md", "", "c1", "s1", "")
	require.NoError(t, err)
	// Deleting an absent comment still records the id, and answers not-found.
	_, err = s.DeleteComment("old/a.md", "", "gone")
	require.ErrorIs(t, err, ErrCommentNotFound)

	moved, ok, err := s.Move("old/a.md", "new/a.md", "")
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, "q1", moved.Comments[0].QuestionID)
	require.Equal(t, unitAt(cmdDoc, 3, 3).Fingerprint, moved.Comments[0].QuestionEvidence.UnitFingerprint)
	require.Equal(t, "s1", moved.Sessions[0].ID)
	require.Contains(t, moved.DeletedIDs, "gone")
	// The session still works at the new address.
	_, err = s.EditCommentTextIn("new/a.md", "", "c1", "x", cmdDoc, "s1")
	require.NoError(t, err)
}

// --- conditional capture -------------------------------------------------

const captureDoc = "# T\n\nAlpha question about caching layers.\n\nBeta question about retries.\n\nGamma tail.\n"

// boundComment creates c1 bound to q1, whose unit is captureDoc line 3.
func boundComment(t *testing.T, s *Store) {
	t.Helper()
	doc := scannedDoc(s, captureDoc, map[string]Unit{"q1": unitAt(captureDoc, 3, 3)})
	c := anchoredComment("c1", "x", 3)
	c.QuestionID = "q1"
	data, err := s.AddCommentWith("a.md", "", c, captureDoc, CreateOptions{Doc: doc})
	require.NoError(t, err)
	require.Equal(t, "q1", data.Comments[0].QuestionID)
}

func TestUnboundCommentRecapturesTheBlockAtItsAnchorAsEverBefore(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "x", 3), captureDoc)
	require.NoError(t, err)
	rewritten := strings.Replace(captureDoc, "Alpha question about caching layers.", "Rewritten paragraph.", 1)
	data, err := s.ReplyFrom("a.md", "", "c1", "r1", "more", scannedDoc(s, rewritten, map[string]Unit{}), false)
	require.NoError(t, err)
	require.Equal(t, "rewritten paragraph.", data.Comments[0].CapturedBlock)

	// With no scanner the capture stays and the comment says why.
	data, err = s.Reply("a.md", "", "c1", "r2", "again", strings.Replace(rewritten, "Rewritten", "Third", 1))
	require.NoError(t, err)
	require.Equal(t, "rewritten paragraph.", data.Comments[0].CapturedBlock)
	require.Equal(t, model.OwnershipUnknown, data.Comments[0].Ownership)
	require.Equal(t, model.ReasonScannerUnavailable, data.Comments[0].OwnershipReason)
}

// A replaces-by-B in the same slot, with the same neighbouring blocks and many
// shared words, is the case no similarity can tell from an edit. Only the
// scanner can: question q1's unit is gone, and the block now at the line is q2's.
func TestBoundRecaptureKeepsAWhenBTakesAsSlotWithSameNeighbours(t *testing.T) {
	const alpha = "alpha question about caching layers."
	swappedDoc := strings.Replace(captureDoc, "Alpha question about caching layers.", "Beta question about caching layers today.", 1)
	for name, steps := range map[string]func(s *Store) (*model.ReviewData, error){
		"edit": func(s *Store) (*model.ReviewData, error) {
			return s.EditCommentTextFrom("a.md", "", "c1", "edited", scannedDoc(s, swappedDoc, map[string]Unit{"q2": unitAt(swappedDoc, 3, 3)}), "")
		},
		"reply": func(s *Store) (*model.ReviewData, error) {
			return s.ReplyFrom("a.md", "", "c1", "r1", "more", scannedDoc(s, swappedDoc, map[string]Unit{"q2": unitAt(swappedDoc, 3, 3)}), false)
		},
		"moved": func(s *Store) (*model.ReviewData, error) {
			// q1 still exists but now lies elsewhere than the anchor line.
			return s.ReplyFrom("a.md", "", "c1", "r1", "more", scannedDoc(s, swappedDoc, map[string]Unit{"q1": unitAt(swappedDoc, 5, 5)}), false)
		},
		"no scanner": func(s *Store) (*model.ReviewData, error) {
			return s.Reply("a.md", "", "c1", "r1", "more", swappedDoc)
		},
	} {
		s := NewStore(t.TempDir())
		boundComment(t, s)
		data, err := steps(s)
		require.NoError(t, err, name)
		require.Equal(t, alpha, data.Comments[0].CapturedBlock, name)
	}
}

func TestBoundRecaptureFollowsAnInPlaceEditOfTheSameQuestion(t *testing.T) {
	s := NewStore(t.TempDir())
	boundComment(t, s)
	edited := strings.Replace(captureDoc, "caching layers", "caching layers and TTLs", 1)
	data, err := s.EditCommentTextFrom("a.md", "", "c1", "edited", scannedDoc(s, edited, map[string]Unit{"q1": unitAt(edited, 3, 3)}), "")
	require.NoError(t, err)
	require.Equal(t, "alpha question about caching layers and ttls.", data.Comments[0].CapturedBlock)
	rewritten := strings.Replace(edited, "Alpha question about caching layers and TTLs.", "Totally different wording.", 1)
	data, err = s.ReplyFrom("a.md", "", "c1", "r1", "ok", scannedDoc(s, rewritten, map[string]Unit{"q1": unitAt(rewritten, 3, 3)}), false)
	require.NoError(t, err)
	require.Equal(t, "totally different wording.", data.Comments[0].CapturedBlock, "same owner, per-round recapture")
}

func TestInboxEchoesTheRootTextVersionTheAgentNamed(t *testing.T) {
	root := t.TempDir()
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1a2b3c4", "x", 3), cmdDoc)
	require.NoError(t, err)
	writeInboxFile(t, root, "a.jsonl",
		`{"path":"a.md","id":"c1a2b3c4","summary":"with","nonce":"n1","root_text_version":"v-old"}`+"\n"+
			`{"path":"a.md","id":"c1a2b3c4","summary":"without","nonce":"n2"}`+"\n")
	require.Equal(t, []string{"a.md"}, s.ConsumeInbox(root, ""))
	c := mustGet(t, s).Comments[0]
	require.Equal(t, "v-old", c.Reactions[0].RootTextVersion)
	require.Empty(t, c.Reactions[1].RootTextVersion)
	require.Equal(t, []string{"other", "unknown"}, []string{c.ReplyCoverage[0].Covers, c.ReplyCoverage[1].Covers})
}

// --- §7 invariants -------------------------------------------------------

func TestDiscardingANewRootRecordsItsRepliesInDeletedIDs(t *testing.T) {
	s := NewStore(t.TempDir())
	_, _, err := s.BeginSession("a.md", "", "n1", "s1", "")
	require.NoError(t, err)
	_, err = s.AddCommentWith("a.md", "", anchoredComment("n1", "draft", 3), cmdDoc, CreateOptions{SessionID: "s1"})
	require.NoError(t, err)
	_, err = s.Reply("a.md", "", "n1", "r1", "follow-up", cmdDoc)
	require.NoError(t, err)
	data, _, err := s.RestoreSession("a.md", "", "n1", "s1")
	require.NoError(t, err)
	require.Empty(t, data.Comments)
	require.ElementsMatch(t, []string{"n1", "r1"}, data.DeletedIDs)
}

func TestRestoreOfAnExistingRootKeepsRepliesReactionsResolvedAndOthersWork(t *testing.T) {
	s := NewStore(t.TempDir())
	sessionDoc(t, s)
	_, err := s.Reply("a.md", "", "c1", "r1", "keep me", cmdDoc)
	require.NoError(t, err)
	before := mustGet(t, s).Comments[0]
	_, _, err = s.BeginSession("a.md", "", "c1", "s1", before.RootTextVersion)
	require.NoError(t, err)
	_, err = s.EditCommentTextIn("a.md", "", "c1", "typed", cmdDoc, "s1")
	require.NoError(t, err)
	// Other work lands during the session: a reply, a resolve and an agent answer.
	_, err = s.Reply("a.md", "", "c1", "r2", "added meanwhile", cmdDoc)
	require.NoError(t, err)
	_, err = s.SetResolved("a.md", "", "c1", true)
	require.NoError(t, err)

	data, a, err := s.RestoreSession("a.md", "", "c1", "s1")
	require.NoError(t, err)
	require.Equal(t, model.SessionRestored, a.Outcome)
	c := data.Comments[0]
	require.Equal(t, "original", c.Comment)
	require.Equal(t, before.RootTextVersion, c.RootTextVersion)
	require.True(t, c.Resolved)
	require.Len(t, c.Reactions, 2)
	require.Greater(t, c.MutationCounter, before.MutationCounter)
}

func TestReplyCoverageNeverGuessesFromTimeOrFromAnUnversionedRoot(t *testing.T) {
	s := NewStore(t.TempDir())
	sessionDoc(t, s)
	root := mustGet(t, s).Comments[0].RootTextVersion
	// An unversioned root: coverage of every reply is unknown, whatever it echoed.
	data := mustGet(t, s)
	data.Comments[0].RootTextVersion = ""
	data.Comments[0].Reactions = []model.CommentReaction{
		{Actor: "agent", Kind: "addressed", Summary: "old", RootTextVersion: "x", Timestamp: 1},
		{Actor: "agent", Kind: "addressed", Summary: "unversioned", Timestamp: 9e9},
	}
	require.NoError(t, s.Save("a.md", "", data))
	for _, cov := range mustGet(t, s).Comments[0].ReplyCoverage {
		require.Equal(t, "unknown", cov.Covers)
	}
	// With a version, a reply covers the current text only by echoing it.
	data = mustGet(t, s)
	data.Comments[0].RootTextVersion = root
	data.Comments[0].Reactions[0].RootTextVersion = root
	data.Comments[0].Reactions[1].Timestamp = 9e9 // newer, but never stamped
	require.NoError(t, s.Save("a.md", "", data))
	cov := mustGet(t, s).Comments[0].ReplyCoverage
	require.Equal(t, []string{"current", "unknown"}, []string{cov[0].Covers, cov[1].Covers})
}

func TestConcurrentSessionWritesAndLegacyEditsLeaveOneConsistentRoot(t *testing.T) {
	s := NewStore(t.TempDir())
	sessionDoc(t, s)
	_, _, err := s.BeginSession("a.md", "", "c1", "s1", "")
	require.NoError(t, err)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if i%2 == 0 {
				_, _ = s.EditCommentTextIn("a.md", "", "c1", "session "+strings.Repeat("x", i), cmdDoc, "s1")
			} else {
				_, _ = s.EditCommentText("a.md", "", "c1", "legacy "+strings.Repeat("y", i), cmdDoc)
			}
		}(i)
	}
	wg.Wait()
	// A legacy write happened (or not); either way restore is never a silent overwrite of it.
	data, a, err := s.RestoreSession("a.md", "", "c1", "s1")
	if err != nil {
		require.ErrorIs(t, err, ErrSessionConflict)
		require.True(t, strings.HasPrefix(mustGet(t, s).Comments[0].Comment, "legacy ") ||
			strings.HasPrefix(mustGet(t, s).Comments[0].Comment, "session "))
		return
	}
	require.Equal(t, "original", data.Comments[0].Comment)
	require.Equal(t, model.SessionRestored, a.Outcome)
}

func TestLateAutosaveAfterFinishOrRestoreIsA404AndNeverResurrects(t *testing.T) {
	s := NewStore(t.TempDir())
	sessionDoc(t, s)
	_, _, err := s.BeginSession("a.md", "", "c1", "s1", "")
	require.NoError(t, err)
	_, _, err = s.FinishSession("a.md", "", "c1", "s1")
	require.NoError(t, err)
	_, err = s.EditCommentTextIn("a.md", "", "c1", "late", cmdDoc, "s1")
	require.ErrorIs(t, err, ErrSessionNotFound)
	_, _, err = s.RestoreSession("a.md", "", "c1", "s1")
	require.NoError(t, err, "a closed session replays its outcome")
	require.Equal(t, "original", mustGet(t, s).Comments[0].Comment)
}
