package review

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

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

func TestConsumeInboxPreservesPartialFinalLine(t *testing.T) {
	root := t.TempDir()
	s := NewStore(t.TempDir())
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)

	partial := `{"path":"a.md","id":"c1a2b3c4","summary":"unfini`
	writeInboxFile(t, root, "a.jsonl",
		`{"path":"a.md","id":"c1a2b3c4","summary":"finished","nonce":"n-1"}`+"\n"+partial)

	require.Equal(t, []string{"a.md"}, s.ConsumeInbox(root, ""))

	// The complete line applied; the tail was written to a fresh file.
	names := inboxEntries(t, root)
	require.Len(t, names, 1)
	require.NotEqual(t, "a.jsonl", names[0])
	got, err := os.ReadFile(filepath.Join(InboxDir(root), names[0]))
	require.NoError(t, err)
	require.Equal(t, partial, string(got))

	require.True(t, strings.HasSuffix(names[0], partialSuffix),
		"the preserved tail is parked under a name ConsumeInbox skips")

	// A later pass leaves the still-partial file alone instead of shuttling it
	// through rename-and-rewrite forever.
	require.Empty(t, s.ConsumeInbox(root, ""))
	require.Equal(t, names, inboxEntries(t, root))
}

// breakStore makes every load and save under dir fail the way a durable I/O
// fault would (a root-owned reviews directory, a read-only or full $HOME): dir
// becomes a regular file, so every path beneath it is ENOTDIR. It returns a
// repair func that restores the store's contents.
func breakStore(t *testing.T, dir string) (repair func()) {
	t.Helper()
	stashed := dir + ".stashed"
	require.NoError(t, os.Rename(dir, stashed))
	require.NoError(t, os.WriteFile(dir, []byte("not a directory"), 0o644))
	return func() {
		t.Helper()
		require.NoError(t, os.Remove(dir))
		require.NoError(t, os.Rename(stashed, dir))
	}
}

func TestConsumeInboxDoesNotRePreserveTailWhileApplyFails(t *testing.T) {
	root := t.TempDir()
	storeDir := filepath.Join(t.TempDir(), "reviews")
	s := NewStore(storeDir)
	seedDocWithComment(t, s, root, "a.md", "c1a2b3c4deadbeef", cmdDoc, 3)

	partial := `{"path":"a.md","id":"c1a2b3c4","summary":"unfini`
	writeInboxFile(t, root, "a.jsonl",
		`{"path":"a.md","id":"c1a2b3c4","summary":"finished","nonce":"n-1"}`+"\n"+partial)

	repair := breakStore(t, storeDir)

	// Every pass fails to apply and therefore keeps the claimed file. Preserving
	// the tail here too would mint a fresh file per pass — and since each new
	// inbox file is an event the watcher consumes synchronously, that is a loop
	// that fills the disk on its own.
	for range 5 {
		require.Empty(t, s.ConsumeInbox(root, ""))
	}
	require.Equal(t, []string{"a.jsonl" + consumingSuffix}, inboxEntries(t, root),
		"a failed apply keeps the claimed file, which still holds the tail verbatim, and preserves nothing")

	// Once the fault clears, the tail is preserved exactly once.
	repair()
	require.Equal(t, []string{"a.md"}, s.ConsumeInbox(root, ""))

	names := inboxEntries(t, root)
	require.Len(t, names, 1)
	require.True(t, strings.HasSuffix(names[0], partialSuffix))
	got, err := os.ReadFile(filepath.Join(InboxDir(root), names[0]))
	require.NoError(t, err)
	require.Equal(t, partial, string(got))
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
	// case-sensitively; the paste door lowercases what it parses, so an inbox
	// line must too or the same id works pasted and vanishes when delivered.
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

func TestHasCompleteLineDoesNotReadWholeFile(t *testing.T) {
	// The claim probe answers one boolean — "is anything consumable yet" — and
	// the bytes are read again anyway once the file is claimed. Reading the file
	// to answer it (os.ReadFile plus a string conversion) cost two more copies
	// of every delivery, on every watcher event, forever for a file that never
	// becomes consumable.
	const size = 8 << 20
	p := filepath.Join(t.TempDir(), "big.jsonl")
	require.NoError(t, os.WriteFile(p, []byte("{}\n"+strings.Repeat("x", size)), 0o644))

	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	require.True(t, hasCompleteLine(p))
	runtime.ReadMemStats(&after)

	require.Less(t, after.TotalAlloc-before.TotalAlloc, uint64(size/8),
		"probing for a newline must not pull the delivery into memory")
}

func TestReadCompleteLinesSeparatesUnterminatedTail(t *testing.T) {
	dir := t.TempDir()
	write := func(name, content string) string {
		t.Helper()
		p := filepath.Join(dir, name)
		require.NoError(t, os.WriteFile(p, []byte(content), 0o644))
		return p
	}

	// The distinction a bufio.Scanner cannot make: it yields the unterminated
	// tail as an ordinary token, which would have the consumer eat deliveries
	// the agent is still in the middle of appending.
	lines, partial, err := readCompleteLines(write("tail.jsonl", "a\nb"))
	require.NoError(t, err)
	require.Equal(t, []string{"a"}, lines)
	require.Equal(t, "b", partial)

	lines, partial, err = readCompleteLines(write("clean.jsonl", "a\nb\n"))
	require.NoError(t, err)
	require.Equal(t, []string{"a", "b"}, lines)
	require.Empty(t, partial)

	lines, partial, err = readCompleteLines(write("empty.jsonl", ""))
	require.NoError(t, err)
	require.Empty(t, lines)
	require.Empty(t, partial)
}

func TestConsumeInboxLeavesUnfinishedFiles(t *testing.T) {
	root := t.TempDir()
	s := NewStore(t.TempDir())
	writeInboxFile(t, root, "empty.jsonl", "")
	writeInboxFile(t, root, "partial.jsonl", `{"path":"a.md","id":"c1a2`)

	require.Empty(t, s.ConsumeInbox(root, ""))
	require.ElementsMatch(t, []string{"empty.jsonl", "partial.jsonl"}, inboxEntries(t, root),
		"files with no complete line wait for a later pass")
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
