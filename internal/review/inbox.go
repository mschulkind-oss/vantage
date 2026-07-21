package review

// Inbox consumption: the file-drop half of agent response delivery. An agent
// answers review comments by writing one delivery to a *.writing scratch file
// and then renaming it to a committed *.jsonl name; the file watcher calls
// ConsumeInbox at startup and on every event beneath the inbox. Because the
// commit is a same-directory rename — atomic on every supported filesystem — a
// committed file is, by construction, complete and never appended to again.
// That is what lets consumption stay simple: there is no "is the writer done?"
// to infer, because the writer states it by renaming.
//
// Consumption is still at-least-once — claim by renaming to *.consuming, apply,
// then delete — so a crash at any point re-consumes rather than loses, and a
// per-line nonce makes the replay a no-op. A line that arrives without one
// still gets a nonce (see deliveryNonce): the replay guarantee must not depend
// on the agent remembering an optional field.

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
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

// committedSuffix is the extension a delivery carries once the agent has
// committed it. The agent writes its whole delivery to some scratch name and
// then renames it to end in ".jsonl"; only a file bearing this suffix is
// consumable. ConsumeInbox allowlists this suffix (and consumingSuffix) rather
// than denylisting known scratch names, because the inbox is a live directory
// other tools also write into — an editor's atomic-save temp
// ("<name>.jsonl.tmp.XXXX"), for instance — and their temp names are not ours
// to predict. Grabbing anything we do not recognize is what deleted a writer's
// temp file out from under it; consuming only what we minted avoids that whole
// class.
const committedSuffix = ".jsonl"

// consumingSuffix marks an inbox file mid-consumption. A crash between rename
// and delete leaves the suffix behind; the next pass re-consumes the file. It
// is appended to a committed name, so a claimed file ends in ".jsonl.consuming".
const consumingSuffix = ".consuming"

// oversizeSuffix quarantines a delivery file larger than maxInboxFileBytes.
// Renaming beats skipping in place: the watcher re-runs ConsumeInbox on every
// inbox event, so a file left under its original name would be re-examined
// forever. Renaming also beats deleting, which would discard real deliveries.
// The result no longer ends in committedSuffix, so the allowlist skips it.
const oversizeSuffix = ".oversize"

// maxInboxFileBytes bounds how much of one delivery file is parsed. The inbox
// is written by the local agent, so this is a runaway guard (a summary carrying
// a whole diff), not a trust boundary.
const maxInboxFileBytes = 8 << 20

// InboxDir returns the delivery inbox directory for the repo rooted at root.
func InboxDir(root string) string {
	return filepath.Join(root, filepath.FromSlash(InboxRel))
}

// inboxLine is one delivery: which document, which comment (short id), what
// the agent did, the dedup nonce, and which thread round the agent was
// answering. Filenames are advisory only — every fact lives on the line.
//
// Round is a pointer so an omitted field is distinguishable from round 0 (a
// comment with no reactions yet, i.e. every first round). Omitted means "not
// stated" and reproduces the pre-round behavior exactly, which is what keeps
// stale clipboard payloads already sitting in agent contexts working.
type inboxLine struct {
	Path    string `json:"path"`
	ID      string `json:"id"`
	Summary string `json:"summary"`
	Nonce   string `json:"nonce"`
	Round   *int   `json:"round"`
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
		name := ent.Name()
		// Allowlist, not denylist: consume only a committed delivery or our own
		// mid-consumption leftover. Anything else — a scratch file the agent is
		// still writing, an *.oversize quarantine, or some other tool's atomic-save
		// temp — is left strictly alone. Denylisting known scratch suffixes instead
		// would claim (and delete) any name we failed to anticipate, which is how a
		// writer's temp file got pulled out from under it.
		if !strings.HasSuffix(name, committedSuffix) && !strings.HasSuffix(name, consumingSuffix) {
			continue
		}
		for _, p := range s.consumeInboxFile(root, repo, name) {
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

// consumeInboxFile processes one committed inbox file and returns the document
// paths it changed. Protocol: claim by renaming to *.consuming (crash leftovers
// arrive already suffixed and skip the rename), read, group lines by document,
// apply, delete. The file is complete by the time it carries a committed name —
// the agent's rename is the completion signal — so every line can be read and
// parsed with no mid-append tail to preserve.
func (s *Store) consumeInboxFile(root, repo, name string) []string {
	dir := InboxDir(root)
	path := filepath.Join(dir, name)

	if info, err := os.Stat(path); err == nil && info.Size() > maxInboxFileBytes {
		slog.Warn("review: inbox file exceeds the size cap; quarantined",
			"file", path, "bytes", info.Size(), "cap", maxInboxFileBytes)
		if rerr := os.Rename(path, path+oversizeSuffix); rerr != nil {
			slog.Warn("review: failed to quarantine oversize inbox file", "file", path, "error", rerr)
		}
		return nil
	}

	if !strings.HasSuffix(name, consumingSuffix) {
		claimed := path + consumingSuffix
		if err := os.Rename(path, claimed); err != nil {
			slog.Warn("review: failed to claim inbox file", "file", path, "error", err)
			return nil
		}
		path = claimed
	}

	lines, err := readLines(path)
	if err != nil {
		slog.Warn("review: failed to read inbox file", "file", path, "error", err)
		return nil
	}

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
		// Lowercased because resolveCommentID prefix-matches case-sensitively
		// against ids that are generated lowercase: an agent that upper-cased the
		// id it copied would otherwise deliver into nothing, silently.
		shortID := strings.ToLower(l.ID)
		round := RoundUnknown
		if l.Round != nil {
			round = *l.Round
		}
		byDoc[l.Path] = append(byDoc[l.Path], ResponseEntry{
			ShortID: shortID,
			Summary: l.Summary,
			Nonce:   deliveryNonce(l.Nonce, l.Path, shortID, l.Summary),
			Round:   round,
		})
	}

	var changed []string
	applied := true
	for _, doc := range docs {
		content := readDocForCapture(root, doc)
		_, n, err := s.ApplyResponses(doc, repo, byDoc[doc], content)
		if err != nil {
			// Keep the .consuming file so a later pass retries; every delivery
			// carries a nonce, so the documents that DID land replay as no-ops.
			slog.Warn("review: failed to apply inbox delivery", "file", name, "doc", doc, "error", err)
			applied = false
			continue
		}
		if n > 0 {
			changed = append(changed, doc)
		}
	}

	if applied {
		if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			slog.Warn("review: failed to delete consumed inbox file", "file", path, "error", err)
		}
	}
	return changed
}

// deliveryNonce returns the delivery's dedup key, synthesizing one when the
// agent omitted the field. Consumption is at-least-once, so a keyless line
// double-records on any replay — a crash between apply and delete, or a retry
// after a sibling document's apply failed. The synthesized key is derived from
// the delivery's own identity, never from document content: content-as-identity
// is what the retired changelog protocol's dedup got wrong, whereas hashing the
// message itself keys on the thing actually being delivered. Two byte-identical
// keyless deliveries therefore collapse into one; they already do within a
// single batch, and only lines that ignored the documented nonce rule are
// affected at all.
func deliveryNonce(nonce, path, shortID, summary string) string {
	if nonce != "" {
		return nonce
	}
	sum := sha256.Sum256([]byte(path + "\x00" + shortID + "\x00" + summary))
	return "auto-" + hex.EncodeToString(sum[:])
}

// readLines streams path into its lines, dropping the trailing newline from
// each. A committed inbox file is complete and immutable — the agent renamed it
// into place — so a final line without a trailing newline is a whole line too,
// not a mid-append tail, and a [bufio.Scanner] yielding it as an ordinary token
// is exactly what we want here.
func readLines(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	var lines []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64<<10), maxInboxFileBytes)
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return lines, nil
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
