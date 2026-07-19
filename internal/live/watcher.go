package live

import (
	"context"
	"errors"
	iofs "io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	fssvc "github.com/mschulkind-oss/vantage/internal/fs"
	gitsvc "github.com/mschulkind-oss/vantage/internal/git"
	"github.com/mschulkind-oss/vantage/internal/ignore"
	"github.com/mschulkind-oss/vantage/internal/review"
)

const (
	// quietPeriod is how long the watcher waits after the last change before
	// broadcasting, to coalesce rapid bursts (e.g. a branch switch).
	quietPeriod = 100 * time.Millisecond
	// maxWait caps the total batch window so a steady stream of changes still
	// flushes within a bounded time.
	maxWait = 1 * time.Second
	// heartbeatInterval is how often watcher stats are logged so a silently
	// dead inotify thread is visible in the journal.
	heartbeatInterval = 60 * time.Second
)

// gitStateFiles are the one-level .git files whose changes signal a repo-state
// change (commit, merge, checkout, rebase) even when no .md content changed.
var gitStateFiles = map[string]struct{}{
	"index":            {},
	"HEAD":             {},
	"MERGE_HEAD":       {},
	"REBASE_HEAD":      {},
	"CHERRY_PICK_HEAD": {},
}

// classify decides whether a repo-relative path (slash-separated) is relevant
// for live reload. It returns keep=true for Markdown files and for one-level
// .git state files, and isGitState=true only for the latter. Ignore filtering
// is applied separately by the Watcher (classify is pure for testability).
func classify(rel string) (keep bool, isGitState bool) {
	norm := filepath.ToSlash(rel)
	parts := strings.Split(norm, "/")

	// Only one-level .git state files (.git/<state>) are relevant; deeper
	// paths like .git/logs/HEAD are pruned from the watch set and never kept.
	if len(parts) == 2 && parts[0] == ".git" {
		_, ok := gitStateFiles[parts[1]]
		return ok, ok
	}
	if strings.HasSuffix(strings.ToLower(norm), ".md") {
		return true, false
	}
	return false, false
}

// shouldPruneDir reports whether a directory (repo-relative, slash-separated)
// should be excluded from the recursive watch set. The .git subtree is pruned
// except for its immediate top level (so one-level state files remain watched);
// .vantage is pruned except for its inbox (so review deliveries generate
// events even though the dir is always-ignored elsewhere); ignored/excluded
// directories are pruned via the ignore matcher.
func shouldPruneDir(rel string, matcher *ignore.Matcher) bool {
	norm := filepath.ToSlash(rel)
	if norm == "." || norm == "" {
		return false
	}
	parts := strings.Split(norm, "/")
	// Keep ".git" itself (depth 1) so its state files generate events; prune
	// anything deeper under .git (objects, refs, logs, …).
	if parts[0] == ".git" {
		return len(parts) > 1
	}
	// Keep ".vantage" and its inbox — checked before the matcher, which
	// always-ignores the dir. Anything deeper is vantage-owned state the
	// watcher has no business in.
	if parts[0] == ".vantage" {
		return len(parts) > 1 && norm != review.InboxRel
	}
	if matcher != nil && matcher.IsIgnored(norm, true) {
		return true
	}
	return false
}

// isInboxPath reports whether a repo-relative slash path is the review inbox
// directory or anything inside it. Inbox events trigger consumption instead of
// the files_changed pipeline (classify would drop them: they are not Markdown).
func isInboxPath(rel string) bool {
	return rel == review.InboxRel || strings.HasPrefix(rel, review.InboxRel+"/")
}

// Watcher recursively watches a repository for Markdown and git-state changes,
// coalesces them, invalidates caches, consumes review inbox deliveries, and
// broadcasts files_changed messages through a Manager.
type Watcher struct {
	root     string
	repoName string

	manager *Manager
	store   *review.Store
	matcher *ignore.Matcher
	logger  *slog.Logger

	fsw *fsnotify.Watcher

	mu    sync.Mutex
	stats watcherStats
}

// watcherStats are reset every heartbeat so they describe the most recent
// interval rather than the lifetime of the process.
type watcherStats struct {
	eventsTotal    int
	kept           int
	droppedExt     int
	droppedIgnore  int
	droppedOutside int
}

// NewWatcher constructs a Watcher rooted at the repository at root. repoName is
// echoed in broadcast payloads (empty for single-repo mode). store consumes
// review inbox deliveries and backs the stale-changelog warning; it may be nil
// to disable both. useIgnoreFiles toggles .vantageignore/user-ignore pruning.
// If logger is nil the default slog logger is used.
func NewWatcher(root, repoName string, mgr *Manager, store *review.Store, useIgnoreFiles bool, logger *slog.Logger) (*Watcher, error) {
	if logger == nil {
		logger = slog.Default()
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	return &Watcher{
		root:     filepath.Clean(abs),
		repoName: repoName,
		manager:  mgr,
		store:    store,
		matcher:  ignore.GetMatcher(abs, useIgnoreFiles),
		logger:   logger.With("component", "watcher", "repo", repoName),
	}, nil
}

// Start begins watching. It adds the recursive watch set, then runs the event
// loop until ctx is cancelled or Close is called. Start blocks; run it in its
// own goroutine.
func (w *Watcher) Start(ctx context.Context) error {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	w.fsw = fsw

	added := w.addRecursive(w.root)
	w.logger.Info("watcher started", "root", w.root, "watched_dirs", added)

	// Deliveries that landed while the server was down are consumed before the
	// first event can arrive.
	w.consumeInbox()

	out := make(chan []string, 1)
	co := newCoalescer(quietPeriod, maxWait, func(paths []string) { out <- paths })

	heartbeat := time.NewTicker(heartbeatInterval)
	defer heartbeat.Stop()

	for {
		select {
		case <-ctx.Done():
			co.stop()
			_ = w.fsw.Close()
			return ctx.Err()

		case paths := <-out:
			w.flush(paths)

		case ev, ok := <-w.fsw.Events:
			if !ok {
				co.stop()
				return nil
			}
			w.handleEvent(ev, co)

		case err, ok := <-w.fsw.Errors:
			if !ok {
				continue
			}
			w.handleError(err)

		case <-heartbeat.C:
			w.logHeartbeat()
		}
	}
}

// Close stops watching and releases the inotify handle. It is safe to call once
// Start has returned or to unblock a running Start (which also closes on ctx
// cancellation).
func (w *Watcher) Close() error {
	if w.fsw == nil {
		return nil
	}
	return w.fsw.Close()
}

// addRecursive walks dir and adds a watch for every surviving directory,
// pruning the .git subtree (except its top level) and ignored directories.
// fsnotify is not recursive, so each directory is added individually. Returns
// the number of directories added.
func (w *Watcher) addRecursive(dir string) int {
	added := 0
	_ = filepath.WalkDir(dir, func(path string, d iofs.DirEntry, err error) error {
		if err != nil {
			// Unreadable entries (permissions, races) are skipped, not fatal.
			if d != nil && d.IsDir() {
				return iofs.SkipDir
			}
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(w.root, path)
		if relErr != nil {
			return nil
		}
		if shouldPruneDir(rel, w.matcher) {
			return iofs.SkipDir
		}
		if addErr := w.fsw.Add(path); addErr != nil {
			w.logger.Debug("watcher: failed to add watch", "path", path, "error", addErr)
			return nil
		}
		added++
		return nil
	})
	return added
}

// handleEvent classifies an fsnotify event and either feeds the coalescer a
// kept repo-relative path or, for newly created directories, extends the watch
// set. Removed paths are dropped from accounting by classify.
func (w *Watcher) handleEvent(ev fsnotify.Event, co *coalescer) {
	w.mu.Lock()
	w.stats.eventsTotal++
	w.mu.Unlock()

	// Newly created directories must be added to the (non-recursive) watch set.
	if ev.Has(fsnotify.Create) {
		if info, err := os.Stat(ev.Name); err == nil && info.IsDir() {
			rel, relErr := filepath.Rel(w.root, ev.Name)
			if relErr == nil && !shouldPruneDir(rel, w.matcher) {
				w.addRecursive(ev.Name)
				// A .vantage or inbox dir appearing after startup may already
				// hold deliveries written before its watch existed.
				if norm := filepath.ToSlash(rel); norm == ".vantage" || isInboxPath(norm) {
					w.consumeInbox()
				}
			}
			return
		}
	}

	rel, err := filepath.Rel(w.root, ev.Name)
	if err != nil || strings.HasPrefix(rel, "..") {
		w.mu.Lock()
		w.stats.droppedOutside++
		w.mu.Unlock()
		return
	}
	rel = filepath.ToSlash(rel)

	// Inbox traffic is consumed immediately; it never enters the coalesced
	// files_changed flow. Consumption's own renames and deletes re-trigger
	// this path, each a cheap pass over an empty directory.
	if isInboxPath(rel) {
		w.mu.Lock()
		w.stats.kept++
		w.mu.Unlock()
		w.logger.Debug("watcher inbox event", "op", ev.Op.String(), "path", rel)
		w.consumeInbox()
		return
	}

	keep, _ := classify(rel)
	if !keep {
		w.mu.Lock()
		w.stats.droppedExt++
		w.mu.Unlock()
		return
	}
	// Ignore filtering applies to .md content paths; .git state files are
	// never user-ignored.
	if w.matcher != nil && !strings.HasPrefix(rel, ".git/") && w.matcher.IsIgnored(rel, false) {
		w.mu.Lock()
		w.stats.droppedIgnore++
		w.mu.Unlock()
		return
	}

	w.mu.Lock()
	w.stats.kept++
	w.mu.Unlock()
	w.logger.Debug("watcher event kept", "op", ev.Op.String(), "path", rel)
	co.add(rel)
}

// flush processes a coalesced change set: invalidate caches, warn about saved
// documents still carrying retired-protocol changelog blocks, and broadcast
// files_changed.
func (w *Watcher) flush(paths []string) {
	if len(paths) == 0 {
		return
	}

	gitsvc.ClearStatusCache()

	hasMarkdown := false
	hasGitState := false
	for _, p := range paths {
		if strings.HasSuffix(strings.ToLower(p), ".md") {
			hasMarkdown = true
		}
		if _, isState := classify(p); isState {
			hasGitState = true
		}
	}
	if hasMarkdown {
		fssvc.ClearMarkdownDirCache()
	}
	if hasGitState {
		gitsvc.ClearRecentFilesCache()
		w.logger.Debug("cleared recent-files cache due to git state change")
	}

	if w.store != nil {
		for _, rel := range paths {
			if !strings.HasSuffix(strings.ToLower(rel), ".md") {
				continue
			}
			content, err := os.ReadFile(filepath.Join(w.root, filepath.FromSlash(rel)))
			if err != nil {
				continue
			}
			// The changelog protocol is retired: a marker in a saved document
			// means an agent is following a stale clipboard payload, and its
			// response was NOT recorded. Warn loudly (log + UI notice) instead of
			// silently reproducing the old lost-turn failure. Once per save.
			if review.ContainsChangelogBlock(string(content)) {
				w.logger.Warn("review: document contains a retired-protocol changelog block; "+
					"the agent's response was NOT recorded — copy the comments again to hand it "+
					"the current instructions", "path", rel)
				w.manager.Broadcast(changelogIgnoredMessage{Type: "changelog_ignored", Repo: w.repoName, Path: rel})
			}
		}
	}

	sorted := append([]string(nil), paths...)
	sort.Strings(sorted)
	msg := filesChangedMessage{Type: "files_changed", Paths: sorted}
	if w.repoName != "" {
		msg.Repo = w.repoName
	}
	w.logger.Info("files changed", "count", len(sorted))
	w.manager.Broadcast(msg)
}

// filesChangedMessage is the broadcast payload for a coalesced change set.
type filesChangedMessage struct {
	Type  string   `json:"type"`
	Repo  string   `json:"repo,omitempty"`
	Paths []string `json:"paths"`
}

// reviewChangedMessage mirrors the server's review_changed push so inbox
// deliveries and API commands look identical to the browser. Repo is
// intentionally not omitempty: the frontend matches it against its current
// repo, and the single-repo sentinel is the empty string, not an absent key.
type reviewChangedMessage struct {
	Type string `json:"type"`
	Repo string `json:"repo"`
	Path string `json:"path"`
}

// changelogIgnoredMessage is the stale-payload warning push: a saved document
// still carries a retired-protocol changelog block, so whatever the agent
// wrote there was ignored. Same repo semantics as reviewChangedMessage.
type changelogIgnoredMessage struct {
	Type string `json:"type"`
	Repo string `json:"repo"`
	Path string `json:"path"`
}

// consumeInbox drains the repo's review inbox and pushes review_changed for
// every document a delivery mutated, so open browsers reload that review. It
// runs at startup and on every event under the inbox; a missing or empty
// inbox is a cheap no-op.
func (w *Watcher) consumeInbox() {
	if w.store == nil {
		return
	}
	for _, p := range w.store.ConsumeInbox(w.root, w.repoName) {
		w.logger.Info("review: consumed inbox delivery", "path", p)
		w.manager.Broadcast(reviewChangedMessage{Type: "review_changed", Repo: w.repoName, Path: p})
	}
}

// handleError surfaces an fsnotify error, adding a hint for the common inotify
// watch-exhaustion case (ENOSPC) which otherwise manifests as live reload
// silently failing for some files.
func (w *Watcher) handleError(err error) {
	if errors.Is(err, fsnotify.ErrEventOverflow) || strings.Contains(err.Error(), "no space left") {
		w.logger.Error("watcher: inotify watch limit reached — live reload will miss some changes; "+
			"raise fs.inotify.max_user_watches (e.g. sysctl fs.inotify.max_user_watches=524288)",
			"error", err)
		return
	}
	w.logger.Warn("watcher error", "error", err)
}

// logHeartbeat emits and resets the interval stats so a stalled watcher is
// distinguishable from a quiet one.
func (w *Watcher) logHeartbeat() {
	w.mu.Lock()
	s := w.stats
	w.stats = watcherStats{}
	w.mu.Unlock()
	w.logger.Info("watcher heartbeat",
		"events", s.eventsTotal,
		"kept", s.kept,
		"dropped_ext", s.droppedExt,
		"dropped_ignore", s.droppedIgnore,
		"dropped_outside", s.droppedOutside,
	)
}
