package review

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// captureRecords is a minimal slog.Handler that records every emitted record,
// used to assert that an otherwise-silent code path logs. It captures all
// levels so a test can look for a specific message and level.
type captureRecords struct {
	records []slog.Record
}

func (h *captureRecords) Enabled(context.Context, slog.Level) bool { return true }
func (h *captureRecords) Handle(_ context.Context, r slog.Record) error {
	h.records = append(h.records, r)
	return nil
}
func (h *captureRecords) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *captureRecords) WithGroup(string) slog.Handler      { return h }

// hasRecord reports whether any captured record has the given level and a
// message containing substr.
func (h *captureRecords) hasRecord(level slog.Level, substr string) bool {
	for _, r := range h.records {
		if r.Level == level && strings.Contains(r.Message, substr) {
			return true
		}
	}
	return false
}

// captureSlog redirects the default slog logger to a capturing handler for the
// duration of the test, restoring the previous default on cleanup.
func captureSlog(t *testing.T) *captureRecords {
	t.Helper()
	h := &captureRecords{}
	prev := slog.Default()
	slog.SetDefault(slog.New(h))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return h
}

// writeInboxFile writes content under root's inbox (creating it) and returns
// the file's path.
func writeInboxFile(t *testing.T, root, name, content string) string {
	t.Helper()
	dir := InboxDir(root)
	require.NoError(t, os.MkdirAll(dir, 0o755))
	p := filepath.Join(dir, name)
	require.NoError(t, os.WriteFile(p, []byte(content), 0o644))
	return p
}

// seedDocWithComment writes docContent to rel under root and creates a review
// with one comment (id, anchored at line) whose CapturedBlock reflects
// docContent — the state after a reviewer commented on the doc as it stood.
func seedDocWithComment(t *testing.T, s *Store, root, rel, id, docContent string, line int) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
	require.NoError(t, os.WriteFile(full, []byte(docContent), 0o644))
	_, err := s.AddComment(rel, "", anchoredComment(id, "please tighten", line), docContent)
	require.NoError(t, err)
}

// inboxEntries lists the names currently in root's inbox.
func inboxEntries(t *testing.T, root string) []string {
	t.Helper()
	ents, err := os.ReadDir(InboxDir(root))
	require.NoError(t, err)
	names := make([]string, 0, len(ents))
	for _, e := range ents {
		names = append(names, e.Name())
	}
	return names
}

func TestConsumeInboxEndToEnd(t *testing.T) {
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "docs/a.md", "c1a2b3c4deadbeef", cmdDoc, 3)

	// The agent edits the doc on disk, then delivers its response.
	edited := strings.Replace(cmdDoc, "First Paragraph text.", "First paragraph, tightened.", 1)
	require.NoError(t, os.WriteFile(filepath.Join(root, "docs", "a.md"), []byte(edited), 0o644))
	writeInboxFile(t, root, "docs__a.md.jsonl",
		`{"path":"docs/a.md","id":"c1a2b3c4","summary":"tightened the intro","nonce":"n-1"}`+"\n")

	require.Equal(t, []string{"docs/a.md"}, s.ConsumeInbox(root, ""))

	data, err := s.Get("docs/a.md", "")
	require.NoError(t, err)
	require.Len(t, data.Comments[0].Reactions, 1)
	r := data.Comments[0].Reactions[0]
	require.Equal(t, "agent", r.Actor)
	require.Equal(t, "addressed", r.Kind)
	require.Equal(t, "tightened the intro", r.Summary)
	require.Equal(t, "first paragraph text.", r.BeforeText, "before = block captured at comment time")
	require.Equal(t, "first paragraph, tightened.", r.AfterText, "after = block from the doc on disk")
	require.Equal(t, []string{"n-1"}, data.Nonces)

	require.Empty(t, inboxEntries(t, root), "consumed file is deleted")
}

func TestConsumeInboxNonceDedupAcrossConsumingLeftover(t *testing.T) {
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)

	line := `{"path":"a.md","id":"c1a2b3c4","summary":"done","nonce":"n-dup"}` + "\n"
	writeInboxFile(t, root, "a.jsonl", line)
	require.Equal(t, []string{"a.md"}, s.ConsumeInbox(root, ""))

	// Crash replay: the same delivery reappears as a *.consuming leftover
	// (crash between apply and delete). The nonce must make it a no-op.
	writeInboxFile(t, root, "a.jsonl"+consumingSuffix, line)
	require.Empty(t, s.ConsumeInbox(root, ""))

	data, err := s.Get("a.md", "")
	require.NoError(t, err)
	require.Len(t, data.Comments[0].Reactions, 1, "replayed delivery must not double-record")
	require.Equal(t, []string{"n-dup"}, data.Nonces)
	require.Empty(t, inboxEntries(t, root), "no-op leftover is still deleted")
}

func TestConsumeInboxConsumingLeftoverStillApplies(t *testing.T) {
	// A crash after rename but before apply leaves a *.consuming file whose
	// delivery never landed; the next pass consumes it like any other file.
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)

	writeInboxFile(t, root, "a.jsonl"+consumingSuffix,
		`{"path":"a.md","id":"c1a2b3c4","summary":"landed","nonce":"n-new"}`+"\n")
	require.Equal(t, []string{"a.md"}, s.ConsumeInbox(root, ""))

	data, err := s.Get("a.md", "")
	require.NoError(t, err)
	require.Len(t, data.Comments[0].Reactions, 1)
	require.Empty(t, inboxEntries(t, root))
}

func TestConsumeInboxIgnoresUncommittedNames(t *testing.T) {
	// The consumer allowlists committed deliveries (*.jsonl) and its own
	// mid-consumption leftovers (*.consuming). Everything else in this live
	// directory is left strictly alone: a scratch file the agent is still
	// writing, and — the regression that motivated the allowlist — another
	// tool's atomic-save temp, whose name we cannot predict. Claiming and
	// deleting such a temp pulls it out from under its writer.
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)

	line := `{"path":"a.md","id":"c1a2b3c4","summary":"not yet","nonce":"n-1"}` + "\n"
	untouched := []string{
		"a.jsonl.writing",              // agent's recommended scratch name
		"a.jsonl.tmp.2.00b78cf5e200",   // an editor's atomic-save temp
		"a.jsonl.writing.tmp.deadbeef", // a temp for the scratch file itself
	}
	for _, name := range untouched {
		writeInboxFile(t, root, name, line)
	}

	require.Empty(t, s.ConsumeInbox(root, ""), "no uncommitted name is consumed")
	require.ElementsMatch(t, untouched, inboxEntries(t, root), "and all are left in place")

	data, err := s.Get("a.md", "")
	require.NoError(t, err)
	require.Empty(t, data.Comments[0].Reactions)
}

func TestConsumeInboxCommittedAfterRename(t *testing.T) {
	// The agent commits by renaming its scratch file to a *.jsonl name. Only
	// then does the delivery land.
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)

	scratch := writeInboxFile(t, root, "a.jsonl.writing",
		`{"path":"a.md","id":"c1a2b3c4","summary":"done","nonce":"n-1"}`+"\n")
	require.Empty(t, s.ConsumeInbox(root, ""))

	require.NoError(t, os.Rename(scratch, filepath.Join(InboxDir(root), "a.jsonl")))
	require.Equal(t, []string{"a.md"}, s.ConsumeInbox(root, ""))

	data, err := s.Get("a.md", "")
	require.NoError(t, err)
	require.Len(t, data.Comments[0].Reactions, 1)
	require.Empty(t, inboxEntries(t, root))
}

func TestConsumeInboxConsumesUnterminatedFinalLine(t *testing.T) {
	// A committed file is complete and immutable, so its final line is a whole
	// line even without a trailing newline — there is no mid-append tail to fear
	// once the agent has renamed the file into place.
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)

	writeInboxFile(t, root, "a.jsonl",
		`{"path":"a.md","id":"c1a2b3c4","summary":"no trailing newline","nonce":"n-1"}`)

	require.Equal(t, []string{"a.md"}, s.ConsumeInbox(root, ""))

	data, err := s.Get("a.md", "")
	require.NoError(t, err)
	require.Len(t, data.Comments[0].Reactions, 1)
	require.Equal(t, "no trailing newline", data.Comments[0].Reactions[0].Summary)
	require.Empty(t, inboxEntries(t, root))
}

func TestConsumeInboxDedupsNonceLessLineAcrossConsumingLeftover(t *testing.T) {
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)

	// The payload documents "one fresh nonce per line", but that is prompt text
	// to an LLM. An agent that skips the field must still not double-record when
	// an at-least-once replay re-delivers its line.
	line := `{"path":"a.md","id":"c1a2b3c4","summary":"done"}` + "\n"
	writeInboxFile(t, root, "a.jsonl", line)
	require.Equal(t, []string{"a.md"}, s.ConsumeInbox(root, ""))

	writeInboxFile(t, root, "a.jsonl"+consumingSuffix, line)
	require.Empty(t, s.ConsumeInbox(root, ""))

	data, err := s.Get("a.md", "")
	require.NoError(t, err)
	require.Len(t, data.Comments[0].Reactions, 1, "replayed keyless delivery must not double-record")
	require.Len(t, data.Nonces, 1)
	require.True(t, strings.HasPrefix(data.Nonces[0], "auto-"),
		"the synthesized key is recorded so the next replay is a lookup")
}

func TestConsumeInboxResolvesUppercaseID(t *testing.T) {
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)

	// Comment ids are generated lowercase and resolveCommentID prefix-matches
	// case-sensitively, so an inbox line must lowercase its id or an agent that
	// upper-cased the one it copied delivers into nothing, silently.
	writeInboxFile(t, root, "a.jsonl",
		`{"path":"a.md","id":"C1A2B3C4","summary":"done","nonce":"n-up"}`+"\n")
	require.Equal(t, []string{"a.md"}, s.ConsumeInbox(root, ""))

	data, err := s.Get("a.md", "")
	require.NoError(t, err)
	require.Len(t, data.Comments[0].Reactions, 1)
}

func TestConsumeInboxQuarantinesOversizeFile(t *testing.T) {
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)

	writeInboxFile(t, root, "a.jsonl",
		`{"path":"a.md","id":"c1a2b3c4","summary":"`+strings.Repeat("x", maxInboxFileBytes)+`","nonce":"n"}`+"\n")

	require.Empty(t, s.ConsumeInbox(root, ""))
	parked := []string{"a.jsonl" + oversizeSuffix}
	require.Equal(t, parked, inboxEntries(t, root),
		"an oversize delivery is parked for inspection, never parsed and never deleted")

	// Parked means parked: the watcher re-runs ConsumeInbox on every inbox
	// event, so a file left under its own name would be re-read forever.
	require.Empty(t, s.ConsumeInbox(root, ""))
	require.Equal(t, parked, inboxEntries(t, root))

	data, err := s.Get("a.md", "")
	require.NoError(t, err)
	require.Empty(t, data.Comments[0].Reactions)
}

func TestReadLines(t *testing.T) {
	dir := t.TempDir()
	write := func(name, content string) string {
		t.Helper()
		p := filepath.Join(dir, name)
		require.NoError(t, os.WriteFile(p, []byte(content), 0o644))
		return p
	}

	// A committed file is complete, so its final line counts whether or not it
	// ends in a newline.
	lines, err := readLines(write("tail.jsonl", "a\nb"))
	require.NoError(t, err)
	require.Equal(t, []string{"a", "b"}, lines)

	lines, err = readLines(write("clean.jsonl", "a\nb\n"))
	require.NoError(t, err)
	require.Equal(t, []string{"a", "b"}, lines)

	lines, err = readLines(write("empty.jsonl", ""))
	require.NoError(t, err)
	require.Empty(t, lines)
}

func TestConsumeInboxHandlesEmptyCommittedFile(t *testing.T) {
	// An empty committed file has no lines to apply; it is claimed and deleted
	// like any other, never left to be re-examined forever.
	root := t.TempDir()
	s := NewStore(t.TempDir())
	writeInboxFile(t, root, "empty.jsonl", "")

	require.Empty(t, s.ConsumeInbox(root, ""))
	require.Empty(t, inboxEntries(t, root), "an empty committed file is consumed, not parked")
}

func TestConsumeInboxGroupsByDoc(t *testing.T) {
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "docs/a.md", "aaaa1111c0ffee00", cmdDoc, 3)
	seedDocWithComment(t, s, root, "docs/b.md", "bbbb2222c0ffee00", cmdDoc, 5)

	// One file, lines interleaved across two documents.
	writeInboxFile(t, root, "mixed.jsonl",
		`{"path":"docs/a.md","id":"aaaa1111","summary":"first for a","nonce":"n1"}`+"\n"+
			`{"path":"docs/b.md","id":"bbbb2222","summary":"for b","nonce":"n2"}`+"\n"+
			`{"path":"docs/a.md","id":"aaaa1111","summary":"second for a","nonce":"n3"}`+"\n")

	require.Equal(t, []string{"docs/a.md", "docs/b.md"}, s.ConsumeInbox(root, ""))

	a, err := s.Get("docs/a.md", "")
	require.NoError(t, err)
	require.Len(t, a.Comments[0].Reactions, 2, "both a-lines land in one grouped apply")
	require.Equal(t, []string{"n1", "n3"}, a.Nonces)

	b, err := s.Get("docs/b.md", "")
	require.NoError(t, err)
	require.Len(t, b.Comments[0].Reactions, 1)
	require.Empty(t, inboxEntries(t, root))
}

func TestConsumeInboxSkipsBadLines(t *testing.T) {
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)

	writeInboxFile(t, root, "a.jsonl",
		"this is not json\n"+
			`{"path":"../evil.md","id":"c1a2b3c4","summary":"traversal","nonce":"nx"}`+"\n"+
			`{"path":"a.md","id":"","summary":"no id","nonce":"ny"}`+"\n"+
			`{"path":"a.md","id":"c1a2b3c4","summary":"good","nonce":"nz"}`+"\n")

	require.Equal(t, []string{"a.md"}, s.ConsumeInbox(root, ""))

	data, err := s.Get("a.md", "")
	require.NoError(t, err)
	require.Len(t, data.Comments[0].Reactions, 1, "only the good line lands")
	require.Equal(t, "good", data.Comments[0].Reactions[0].Summary)
	require.Equal(t, []string{"nz"}, data.Nonces)
	require.Empty(t, inboxEntries(t, root), "bad lines never block the file")
}

func TestConsumeInboxMissingDocCapturesEmptyAfter(t *testing.T) {
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)
	require.NoError(t, os.Remove(filepath.Join(root, "a.md")))

	writeInboxFile(t, root, "a.jsonl",
		`{"path":"a.md","id":"c1a2b3c4","summary":"done","nonce":"n1"}`+"\n")
	require.Equal(t, []string{"a.md"}, s.ConsumeInbox(root, ""))

	data, err := s.Get("a.md", "")
	require.NoError(t, err)
	require.Len(t, data.Comments[0].Reactions, 1)
	require.Equal(t, "first paragraph text.", data.Comments[0].Reactions[0].BeforeText)
	require.Empty(t, data.Comments[0].Reactions[0].AfterText, "unreadable doc tolerated as empty after")
}

func TestConsumeInboxNoReviewIsNoop(t *testing.T) {
	root := t.TempDir()
	s := NewStore(t.TempDir())
	writeInboxFile(t, root, "x.jsonl",
		`{"path":"ghost.md","id":"c1a2b3c4","summary":"s","nonce":"n"}`+"\n")

	require.Empty(t, s.ConsumeInbox(root, ""))
	require.Empty(t, inboxEntries(t, root), "delivery into nothing is consumed and dropped")
}

func TestConsumeInboxNoReviewWarnsNotSilent(t *testing.T) {
	// A delivery whose path has no review used to vanish silently: dropped,
	// file deleted, nothing logged. That is the failure this warning exists to
	// make visible, so assert it is actually emitted.
	rec := captureSlog(t)
	root := t.TempDir()
	s := NewStore(t.TempDir())
	writeInboxFile(t, root, "x.jsonl",
		`{"path":"ghost.md","id":"c1a2b3c4","summary":"s","nonce":"n"}`+"\n")

	require.Empty(t, s.ConsumeInbox(root, ""))
	require.True(t, rec.hasRecord(slog.LevelWarn, "no review"),
		"a delivery into a document with no review must warn, not drop silently")
}

func TestConsumeInboxLogsOutcome(t *testing.T) {
	// Every consumed file logs its outcome so a consumed-but-applied-nothing
	// file is visible rather than silent once it is deleted.
	rec := captureSlog(t)
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)
	writeInboxFile(t, root, "a.jsonl",
		`{"path":"a.md","id":"c1a2b3c4","summary":"done","nonce":"n-1"}`+"\n")

	require.Equal(t, []string{"a.md"}, s.ConsumeInbox(root, ""))
	require.True(t, rec.hasRecord(slog.LevelInfo, "consumed inbox file"),
		"consuming a file must log its outcome")
}

func TestConsumeInboxMissingInboxDir(t *testing.T) {
	s := NewStore(t.TempDir())
	require.Empty(t, s.ConsumeInbox(t.TempDir(), ""))
}

func TestConsumeInboxCarriesTheRound(t *testing.T) {
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)

	// The reviewer replied while the agent was working, so the delivery lands
	// after a follow-up it never saw. The round it names is what lets the
	// reader tell that apart from an answer to the follow-up itself.
	_, _, err := s.ApplyResponses("a.md", "",
		[]ResponseEntry{{ShortID: "c1a2b3c4", Summary: "round one", Nonce: "n1", Round: 0}}, cmdDoc)
	require.NoError(t, err)
	_, err = s.Reply("a.md", "", "c1a2b3c4deadbeef", "not quite, also X", cmdDoc)
	require.NoError(t, err)

	writeInboxFile(t, root, "a.jsonl",
		`{"path":"a.md","id":"c1a2b3c4","round":0,"summary":"also fixed spelling","nonce":"n2"}`+"\n")
	require.Equal(t, []string{"a.md"}, s.ConsumeInbox(root, ""))

	data, err := s.Get("a.md", "")
	require.NoError(t, err)
	last := data.Comments[0].Reactions[2]
	require.Equal(t, "also fixed spelling", last.Summary)
	require.NotNil(t, last.AnswersRound)
	require.Equal(t, 0, *last.AnswersRound)
}

func TestConsumeInboxWithoutRoundRecordsNone(t *testing.T) {
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)

	// An omitted round is distinguishable from round 0, so a payload predating
	// the field keeps behaving exactly as it did.
	writeInboxFile(t, root, "a.jsonl",
		`{"path":"a.md","id":"c1a2b3c4","summary":"done","nonce":"n1"}`+"\n")
	require.Equal(t, []string{"a.md"}, s.ConsumeInbox(root, ""))

	data, err := s.Get("a.md", "")
	require.NoError(t, err)
	require.Nil(t, data.Comments[0].Reactions[0].AnswersRound)
}
