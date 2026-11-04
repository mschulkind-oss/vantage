package review

import (
	"testing"
	"time"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/stretchr/testify/require"
)

// A create names the evidence it read; another box opening, an autosave in
// another tab or an agent's reply moves the review's mutation revision in
// between. None of that makes the server's own proof of the id unsafe, so the
// answer stays bound. A moved document, boot or hash still does.
func TestCreateIsBoundDespiteAMovedReviewMutationRevision(t *testing.T) {
	s := NewStore(t.TempDir())
	doc := scannedDoc(s, cmdDoc, map[string]Unit{"q1": unitAt(cmdDoc, 3, 3)})
	ev := doc().Evidence
	_, err := s.AddComment("a.md", "", anchoredComment("other", "t", 5), cmdDoc)
	require.NoError(t, err)
	pre := BindPreconditions{BootID: ev.BootID, DocumentGeneration: ev.DocumentGeneration, ContentHash: ev.ContentHash,
		MutationRevision: mustGetRev(s)}
	_, _, err = s.BeginSession("a.md", "", "other", "s9", "") // independent review mutation
	require.NoError(t, err)
	require.NotEqual(t, pre.MutationRevision, mustGetRev(s))

	c := anchoredComment("c1", "t", 3)
	c.QuestionID = "q1"
	data, err := s.AddCommentWith("a.md", "", c, cmdDoc, CreateOptions{Doc: doc, Preconditions: &pre})
	require.NoError(t, err)
	got := commentByID(data.Comments, "c1")
	require.Equal(t, "q1", got.QuestionID)
	require.Equal(t, model.OwnershipProven, got.Ownership)

	for name, mutate := range map[string]func(*BindPreconditions){
		"boot":       func(p *BindPreconditions) { p.BootID = "other-boot" },
		"generation": func(p *BindPreconditions) { p.DocumentGeneration-- },
		"hash":       func(p *BindPreconditions) { p.ContentHash = "stale" },
	} {
		p := pre
		mutate(&p)
		c := anchoredComment(name, "t", 3)
		c.QuestionID = "q1"
		data, err = s.AddCommentWith("a.md", "", c, cmdDoc, CreateOptions{Doc: doc, Preconditions: &p})
		require.NoError(t, err, name)
		require.Empty(t, commentByID(data.Comments, name).QuestionID, name)
	}
}

// Restoring a session gives back the verdict that went with the restored text.
func TestRestoreSessionRestoresTheOwnershipVerdict(t *testing.T) {
	s := NewStore(t.TempDir())
	at3 := scannedDoc(s, cmdDoc, map[string]Unit{"q1": unitAt(cmdDoc, 3, 3)})
	at5 := scannedDoc(s, cmdDoc, map[string]Unit{"q1": unitAt(cmdDoc, 5, 5)})
	c := anchoredComment("c1", "original", 3)
	c.QuestionID = "q1"
	_, err := s.AddCommentWith("a.md", "", c, cmdDoc, CreateOptions{Doc: at3})
	require.NoError(t, err)
	require.Equal(t, model.OwnershipProven, mustGet(t, s).Comments[0].Ownership)
	_, _, err = s.BeginSession("a.md", "", "c1", "s1", "")
	require.NoError(t, err)
	data, err := s.EditCommentTextFrom("a.md", "", "c1", "typed", at5, "s1")
	require.NoError(t, err)
	require.Equal(t, model.ReasonQuestionMoved, data.Comments[0].OwnershipReason)

	data, _, err = s.RestoreSession("a.md", "", "c1", "s1")
	require.NoError(t, err)
	require.Equal(t, "original", data.Comments[0].Comment)
	require.Equal(t, model.OwnershipProven, data.Comments[0].Ownership)
	require.Empty(t, data.Comments[0].OwnershipReason)
}

// A scan the checker refused is named so, not as a missing checker.
func TestRefusedScanIsRecordedAsScanRefused(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.AddComment("a.md", "", anchoredComment("c1", "t", 3), cmdDoc)
	require.NoError(t, err)
	refused := func() *Observation {
		return &Observation{Content: cmdDoc, LoadScan: func() *Scan { return nil },
			ScanFailure: func() string { return model.ReasonScanRefused }}
	}
	data, err := s.EditCommentTextFrom("a.md", "", "c1", "x", refused, "")
	require.NoError(t, err)
	require.Equal(t, model.ReasonScanRefused, data.Comments[0].OwnershipReason)
}

// The evidence and the revision are read with the review's lock held, so a
// write cannot land between them.
func TestObserveWithRevisionReadsTheDocumentUnderTheReviewLock(t *testing.T) {
	s := NewStore(t.TempDir())
	sessionDoc(t, s)
	var held bool
	done := make(chan struct{})
	src := func() *Observation {
		go func() {
			defer close(done)
			_, _, _ = s.BeginSession("a.md", "", "c1", "s1", "") // needs the lock
		}()
		select {
		case <-done:
			held = false
		case <-time.After(50 * time.Millisecond):
			held = true
		}
		return &Observation{Content: cmdDoc}
	}
	_, rev, err := s.ObserveWithRevision("a.md", "", src)
	require.NoError(t, err)
	<-done // the racing write finishes before the temp dir is removed
	require.True(t, held, "the document was read with the lock held")
	require.Equal(t, int64(1), rev, "the revision is the one before the racing write")
}
