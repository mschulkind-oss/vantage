package review

import (
	"os"
	"path/filepath"
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

	// A later pass leaves the still-partial file alone instead of shuttling it
	// through rename-and-rewrite forever.
	require.Empty(t, s.ConsumeInbox(root, ""))
	require.Equal(t, names, inboxEntries(t, root))
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
