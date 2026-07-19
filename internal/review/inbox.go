package review

// Inbox consumption: the file-drop half of agent response delivery. An agent
// answers review comments by appending JSON lines to files under
// <root>/.vantage/inbox/; the file watcher calls ConsumeInbox at startup and
// on every event beneath the inbox. Consumption is at-least-once — rename to
// *.consuming, apply, then delete — so a crash at any point re-consumes
// rather than loses, and the nonce each line carries makes the replay a no-op.

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// InboxRel is the repo-relative inbox directory, slash-separated. The watcher
// compares event paths against it; InboxDir resolves it against a root.
const InboxRel = ".vantage/inbox"

// consumingSuffix marks an inbox file mid-consumption. A crash between rename
// and delete leaves the suffix behind; the next pass re-consumes the file.
const consumingSuffix = ".consuming"

// InboxDir returns the delivery inbox directory for the repo rooted at root.
func InboxDir(root string) string {
	return filepath.Join(root, filepath.FromSlash(InboxRel))
}

// inboxLine is one delivery: which document, which comment (short id), what
// the agent did, and the dedup nonce. Filenames are advisory only — every
// fact lives on the line.
type inboxLine struct {
	Path    string `json:"path"`
	ID      string `json:"id"`
	Summary string `json:"summary"`
	Nonce   string `json:"nonce"`
}

// ConsumeInbox drains every delivery file under root's inbox and returns the
// sorted repo-relative paths of documents whose review actually changed, so
// the caller can push one review_changed per document. A missing inbox is the
// common case and returns nil without logging.
//
// Concurrent calls for the same root are safe — ApplyResponses re-reads the
// nonce set under the per-file store lock, so a delivery two passes race over
// still lands exactly once — but the watcher's event loop serializes them in
// practice.
func (s *Store) ConsumeInbox(root, repo string) []string {
	entries, err := os.ReadDir(InboxDir(root))
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			slog.Warn("review: failed to read inbox", "dir", InboxDir(root), "error", err)
		}
		return nil
	}

	changed := map[string]struct{}{}
	for _, ent := range entries {
		if !ent.Type().IsRegular() {
			continue
		}
		for _, p := range s.consumeInboxFile(root, repo, ent.Name()) {
			changed[p] = struct{}{}
		}
	}
	if len(changed) == 0 {
		return nil
	}
	out := make([]string, 0, len(changed))
	for p := range changed {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

// consumeInboxFile processes one inbox file and returns the document paths it
// changed. Protocol: claim by renaming to *.consuming (crash leftovers arrive
// already suffixed and skip the rename), read, group lines by document, apply,
// delete. An unterminated final line — an agent caught mid-append — is written
// to a fresh inbox file before the delete so it cannot be dropped; a file that
// is nothing but such a tail is left in place entirely, which both waits for
// the append to finish and keeps the write-back from cycling one partial line
// through rename-and-rewrite forever.
func (s *Store) consumeInboxFile(root, repo, name string) []string {
	dir := InboxDir(root)
	path := filepath.Join(dir, name)

	if !strings.HasSuffix(name, consumingSuffix) {
		peek, err := os.ReadFile(path)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				slog.Warn("review: failed to read inbox file", "file", path, "error", err)
			}
			return nil
		}
		if !strings.ContainsRune(string(peek), '\n') {
			// Empty, or one unfinished line: nothing consumable yet.
			return nil
		}
		claimed := path + consumingSuffix
		if err := os.Rename(path, claimed); err != nil {
			slog.Warn("review: failed to claim inbox file", "file", path, "error", err)
			return nil
		}
		path = claimed
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		slog.Warn("review: failed to read inbox file", "file", path, "error", err)
		return nil
	}
	lines, partial := splitCompleteLines(string(raw))

	// Group entries by document so each review is locked, loaded and saved
	// once per file regardless of how the agent interleaved its lines.
	byDoc := map[string][]ResponseEntry{}
	var docs []string
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		var l inboxLine
		if err := json.Unmarshal([]byte(trimmed), &l); err != nil {
			slog.Warn("review: unparseable inbox line; skipped", "file", name, "line", i+1, "error", err)
			continue
		}
		// A non-local path would let a delivery read files outside the repo
		// for its after-capture; an empty id would prefix-match any comment.
		if l.ID == "" || !filepath.IsLocal(filepath.FromSlash(l.Path)) {
			slog.Warn("review: inbox line lacks a usable id or path; skipped",
				"file", name, "line", i+1, "id", l.ID, "doc", l.Path)
			continue
		}
		if _, ok := byDoc[l.Path]; !ok {
			docs = append(docs, l.Path)
		}
		byDoc[l.Path] = append(byDoc[l.Path], ResponseEntry{ShortID: l.ID, Summary: l.Summary, Nonce: l.Nonce})
	}

	var changed []string
	applied := true
	for _, doc := range docs {
		content := readDocForCapture(root, doc)
		_, n, err := s.ApplyResponses(doc, repo, byDoc[doc], content)
		if err != nil {
			// Keep the .consuming file so a later pass retries; the nonces of
			// the documents that DID land make their replay a no-op.
			slog.Warn("review: failed to apply inbox delivery", "file", name, "doc", doc, "error", err)
			applied = false
			continue
		}
		if n > 0 {
			changed = append(changed, doc)
		}
	}

	if partial != "" {
		preservePartialLine(dir, partial)
	}
	if applied {
		if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			slog.Warn("review: failed to delete consumed inbox file", "file", path, "error", err)
		}
	}
	return changed
}

// splitCompleteLines splits raw into newline-terminated lines plus the
// unterminated tail ("" when raw ends in \n). Only complete lines are safe to
// parse: the tail may still be mid-append.
func splitCompleteLines(raw string) (complete []string, partial string) {
	for {
		i := strings.IndexByte(raw, '\n')
		if i < 0 {
			return complete, raw
		}
		complete = append(complete, raw[:i])
		raw = raw[i+1:]
	}
}

// preservePartialLine writes an unterminated tail to a fresh inbox file —
// never the one about to be deleted. The writer's descriptor points at the
// consumed file, so the line will likely never be completed, but preserving
// the bytes for inspection beats silently dropping a delivery.
func preservePartialLine(dir, partial string) {
	f, err := os.CreateTemp(dir, "partial-*.jsonl")
	if err != nil {
		slog.Warn("review: failed to preserve partial inbox line", "dir", dir, "error", err)
		return
	}
	_, werr := f.WriteString(partial)
	cerr := f.Close()
	if werr != nil || cerr != nil {
		slog.Warn("review: failed to preserve partial inbox line", "file", f.Name(), "error", errors.Join(werr, cerr))
	}
}

// readDocForCapture returns the document's current content for after-text
// capture. Missing or unreadable is tolerated as "": the delivery still
// lands, just without an after snapshot.
func readDocForCapture(root, rel string) string {
	b, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		return ""
	}
	return string(b)
}
