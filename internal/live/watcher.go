package live

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	iofs "io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/mschulkind-oss/vantage/internal/config"
	fssvc "github.com/mschulkind-oss/vantage/internal/fs"
	gitsvc "github.com/mschulkind-oss/vantage/internal/git"
	"github.com/mschulkind-oss/vantage/internal/ignore"
	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/repoconfig"
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
// for live reload. It returns keep=true for Markdown files, for one-level .git
// state files, and for the repository's own `.vantage.toml`, and
// isGitState=true only for the .git state files. Ignore filtering is applied
// separately by the Watcher (classify is pure for testability).
//
// `.vantage.toml` is kept at the root only, which is the one place anything
// reads it: the viewer rescans its planning index when it changes. A copy
// further down — `docs/.vantage.toml` — configures nothing, so it stays dropped.
// Every consumer of the push sees the path; none clears a cache for it.
func classify(rel string) (keep bool, isGitState bool) {
	norm := filepath.ToSlash(rel)
	parts := strings.Split(norm, "/")

	// Only one-level .git state files (.git/<state>) are relevant; deeper
	// paths like .git/logs/HEAD are pruned from the watch set and never kept.
	if len(parts) == 2 && parts[0] == ".git" {
		_, ok := gitStateFiles[parts[1]]
		return ok, ok
	}
	if norm == repoconfig.FileName {
		return true, false
	}
	if strings.HasSuffix(strings.ToLower(norm), ".md") {
		return true, false
	}
	return false, false
}

// shouldPruneDir reports whether a directory (repo-relative, slash-separated)
// should be excluded from the recursive watch set. The .git subtree is pruned
// except for its immediate top level (so one-level state files remain watched);
// a nested repository's .git is pruned whole;
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
	// A .git anywhere below the root belongs to a repository nested inside this
	// one — a clone in a directory of clones, a vendored checkout. Nothing reads
	// its state files (classify keeps only the root's), and its objects, refs
	// and logs are hundreds of directories per repository: watching them is
	// what used to run a parent of many clones out of inotify watches.
	if slices.Contains(parts[1:], ".git") {
		return true
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

	// mu guards fsw, closed and stats.
	mu sync.Mutex
	// fsw is assigned by Start and read by Close. Both take mu: a Watcher is
	// started from one goroutine and closed from another (Shutdown, or the
	// refresh loop retiring its repository), and those two can overlap.
	fsw *fsnotify.Watcher
	// addWatch registers one directory. It is normally fsw.Add and is replaceable
	// in tests so failed registrations can be exercised without exhausting
	// inotify.
	addWatch func(string) error
	// removeWatch drops one directory's watch. Nil means fsw.Remove; tests
	// replace it to observe which watches are dropped.
	removeWatch func(string)
	// stopAtRepos makes every repository below the root a boundary the watch
	// set never enters; see [Watcher.SetStopAtRepos].
	stopAtRepos bool
	// onDegraded, when set, hears every watch the system's watch limit
	// refused; see [Watcher.SetDegradedHandler].
	onDegraded func(model.Degradation)
	// watchLimit, when positive, caps how many watches this watcher registers;
	// see [Watcher.SetWatchLimit]. watched counts the ones it has.
	watchLimit int
	watched    int
	// limitFailures counts watches refused by the watch limit, and
	// firstLimitPath is the repo-relative folder the first one was for.
	limitFailures  int
	firstLimitPath string
	// dirs is every directory with a registered watch, by repo-relative slash
	// path, the root excepted. It is what lets a Rename or Remove event be told
	// apart as a directory going away, which by then can no longer be stat'ed.
	dirs map[string]struct{}
	// closed records a Close that arrived before Start. Without it that Close
	// found a nil fsw, did nothing, and left the watcher running for the life
	// of the process — a repository retired in the same breath as it was
	// discovered would have kept watching a directory that is gone.
	closed bool
	stats  watcherStats
	// watchFailedDirs is the lifetime count of directories whose watch could not
	// be registered. It makes startup and heartbeat logs honest when the watcher
	// is only partially armed.
	watchFailedDirs int
	// gitStateFP is the last content fingerprint seen for each watched .git
	// state file, keyed by repo-relative slash path. It is what lets the
	// watcher tell a real repo-state change from a rewrite that changed
	// nothing: `git status` refreshes .git/index by writing a whole new file
	// and renaming it over the old one, and it does that even when the bytes
	// come out identical. Every such rewrite is an fsnotify Write, so without
	// this gate any tool on the machine running `git status` — an editor's git
	// panel polling every second, an agent, a shell — reloads every open
	// browser for nothing.
	gitStateFP map[string]string
	// rescan carries the directories [Watcher.Rescan] hands the event loop.
	rescan chan string
}

// watcherStats are reset every heartbeat so they describe the most recent
// interval rather than the lifetime of the process.
type watcherStats struct {
	eventsTotal    int
	kept           int
	droppedExt     int
	droppedIgnore  int
	droppedOutside int
	droppedSameFP  int
}

// NewWatcher constructs a Watcher rooted at the repository at root. repoName is
// echoed in broadcast payloads (empty for single-repo mode). store consumes
// review inbox deliveries; it may be nil to disable that. useIgnoreFiles
// toggles .vantageignore/user-ignore pruning.
// If logger is nil the default slog logger is used.
func NewWatcher(root, repoName string, mgr *Manager, store *review.Store, useIgnoreFiles bool, logger *slog.Logger, watcherIgnoreDefaults ...[]string) (*Watcher, error) {
	if logger == nil {
		logger = slog.Default()
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	defaults := config.DefaultWatcherIgnoreDefaults
	if len(watcherIgnoreDefaults) > 0 {
		defaults = watcherIgnoreDefaults[0]
	}
	return &Watcher{
		root:       filepath.Clean(abs),
		repoName:   repoName,
		manager:    mgr,
		store:      store,
		matcher:    ignore.GetMatcherWithDefaults(abs, useIgnoreFiles, defaults),
		logger:     logger.With("component", "watcher", "repo", repoName),
		gitStateFP: map[string]string{},
		dirs:       map[string]struct{}{},
		rescan:     make(chan string, 16),
	}, nil
}

// RepoName is the project name the watcher reports under.
func (w *Watcher) RepoName() string { return w.repoName }

// Rescan asks the running watcher to watch dir, a directory below its root, as
// though it had just been created, reporting the Markdown already inside it.
// It is for a directory that has stopped being a repository while the loose
// project's watcher, which never entered it, heard nothing from inside: the
// server calls it when it retires a clone that lost its .git
// (docs/design/serve-clones-directory.md §3). It does not block; a request the
// loop has no room for is dropped and logged.
func (w *Watcher) Rescan(dir string) {
	select {
	case w.rescan <- dir:
	default:
		w.logger.Warn("watcher: too many directories to rescan at once; skipping one", "path", dir)
	}
}

// rescanDir is [Watcher.Rescan]'s work, run on the event loop: dir is watched
// afresh, and found hears each content path already in it, unless dir is
// outside the root, gone, pruned, already watched, or still a boundary.
func (w *Watcher) rescanDir(dir string, found func(rel string)) {
	rel, err := filepath.Rel(w.root, dir)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return
	}
	if gitsvc.IsWorktree(dir) || (w.stopAtRepos && gitsvc.IsRepoBoundary(dir)) || shouldPruneDir(rel, w.matcher) {
		return
	}
	w.mu.Lock()
	_, watched := w.dirs[filepath.ToSlash(rel)]
	w.mu.Unlock()
	if watched {
		return
	}
	w.watchTree(dir, found)
}

// SetStopAtRepos makes every repository below the root — a directory holding a
// .git directory, or a linked worktree — a boundary the watch set never enters,
// including one that becomes a repository while the watcher runs. It is set for
// the project holding the Markdown beside a directory of clones, whose clones
// each have a watcher of their own (docs/design/serve-clones-directory.md §3).
// Call it before Start.
func (w *Watcher) SetStopAtRepos(stop bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.stopAtRepos = stop
}

// SetDegradedHandler registers fn to hear, as a [model.Degradation], every
// watch the system's watch limit refuses — the case where live reload silently
// misses changes, which used to reach only the log. Each call carries the first
// folder refused and the count so far. Call it before Start.
func (w *Watcher) SetDegradedHandler(fn func(model.Degradation)) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.onDegraded = fn
}

// SetWatchLimit caps the watches this watcher registers at n (0, the default,
// means no cap of its own): the ones past it fail the way the kernel's
// ENOSPC does, and are reported the same way. It is how a test reaches the
// watch limit without building a tree big enough to exhaust the real one.
// Call it before Start.
func (w *Watcher) SetWatchLimit(n int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.watchLimit = n
}

// errWatchBudget is what a registration past [Watcher.SetWatchLimit] fails
// with. It wraps ENOSPC — what inotify says when the real limit is reached —
// so everything that recognizes one recognizes the other.
var errWatchBudget = fmt.Errorf("watch budget spent: %w", syscall.ENOSPC)

// Start begins watching. It adds the recursive watch set, then runs the event
// loop until ctx is canceled or Close is called. Start blocks; run it in its
// own goroutine.
func (w *Watcher) Start(ctx context.Context) error {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		_ = fsw.Close()
		return nil
	}
	w.fsw = fsw
	w.addWatch = fsw.Add
	w.mu.Unlock()

	added := w.addRecursive(w.root)
	w.seedGitStateFingerprints()
	w.logStartup(added)

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

		case dir := <-w.rescan:
			w.rescanDir(dir, func(found string) {
				w.mu.Lock()
				w.stats.kept++
				w.mu.Unlock()
				co.add(found)
			})

		case <-heartbeat.C:
			w.logHeartbeat()
		}
	}
}

// Close stops watching and releases the inotify handle. It is safe to call once
// Start has returned, to unblock a running Start (which also closes on ctx
// cancellation), and before Start — a Start that runs afterwards returns
// immediately without watching anything.
func (w *Watcher) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.closed = true
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
	return w.watchTree(dir, nil)
}

// watchTree is [Watcher.addRecursive], also handing found every kept content
// path it walks past — the Markdown files already inside a directory that has
// just appeared.
//
// Those files produce no event of their own. A directory moved into the tree
// arrives whole, as a single Create, and a file written into a new directory
// before its watch exists is never seen by inotify at all. So the walk that
// registers the watches is the only thing that can report them. The watch on a
// directory is registered before the walk reads its entries, so a file written
// in between is found by one or the other, and the coalescer folds the two.
func (w *Watcher) watchTree(dir string, found func(rel string)) int {
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
			if found != nil {
				if rel, relErr := filepath.Rel(w.root, path); relErr == nil {
					if rel = filepath.ToSlash(rel); w.isContent(rel) {
						found(rel)
					}
				}
			}
			return nil
		}
		if path != w.root && (gitsvc.IsWorktree(path) || (w.stopAtRepos && gitsvc.IsRepoBoundary(path))) {
			return iofs.SkipDir
		}
		rel, relErr := filepath.Rel(w.root, path)
		if relErr != nil {
			return nil
		}
		if shouldPruneDir(rel, w.matcher) {
			return iofs.SkipDir
		}
		if addErr := w.registerWatch(path); addErr != nil {
			w.logAddWatchFailure(path, addErr)
			return nil
		}
		// A .git that git wrote between the check above and the watch's
		// registration sent no event this watch could hear, so the check is
		// made again now that anything later will be heard.
		if w.stopAtRepos && path != w.root && gitsvc.IsRepoBoundary(path) {
			for _, gone := range w.forgetDir(filepath.ToSlash(rel)) {
				w.unregisterWatch(filepath.Join(w.root, filepath.FromSlash(gone)))
			}
			return iofs.SkipDir
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

	// A .git appearing is a directory becoming a repository — `git clone` or
	// `git worktree add` into the tree. When repositories are boundaries, the
	// watches registered under it before git got that far are dropped. A
	// worktree's .git is a file git opens before it writes "gitdir:" into it,
	// so its Create can find it empty, and the Write after is what counts.
	if (ev.Has(fsnotify.Create) || ev.Has(fsnotify.Write)) && w.stopAtRepos && filepath.Base(ev.Name) == ".git" {
		parent := filepath.Dir(ev.Name)
		if rel, relErr := filepath.Rel(w.root, parent); relErr == nil && rel != "." && gitsvc.IsRepoBoundary(parent) {
			for _, dir := range w.forgetDir(filepath.ToSlash(rel)) {
				w.unregisterWatch(filepath.Join(w.root, filepath.FromSlash(dir)))
			}
			w.logger.Debug("watcher: directory became a repository; no longer watched", "path", rel)
			return
		}
	}

	// Newly created directories must be added to the (non-recursive) watch set,
	// and the Markdown already inside one reported: nothing else will report it.
	if ev.Has(fsnotify.Create) {
		if info, err := os.Stat(ev.Name); err == nil && info.IsDir() {
			rel, relErr := filepath.Rel(w.root, ev.Name)
			if relErr == nil && !shouldPruneDir(rel, w.matcher) {
				w.watchTree(ev.Name, func(found string) {
					w.mu.Lock()
					w.stats.kept++
					w.mu.Unlock()
					co.add(found)
				})
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

	// A watched directory renamed away or removed yields no file paths at all:
	// its files move or vanish without an event of their own. It is reported
	// as a removed directory instead, so a consumer holding paths under it can
	// drop them. The old name can no longer be stat'ed, so the watch set is
	// what says it was a directory.
	if ev.Has(fsnotify.Rename) || ev.Has(fsnotify.Remove) {
		if gone := w.forgetDir(rel); len(gone) > 0 {
			if ev.Has(fsnotify.Rename) {
				// inotify watches follow the inode, and fsnotify names each event
				// by the path it registered, so the watches below a renamed
				// directory would go on reporting its old name. Dropping them
				// lets the new name's Create register them afresh. A removed
				// directory's watches are gone already.
				for _, dir := range gone {
					w.unregisterWatch(filepath.Join(w.root, filepath.FromSlash(dir)))
				}
			}
			if top, _, _ := strings.Cut(rel, "/"); top == ".git" || top == ".vantage" {
				// git's and Vantage's own state: no consumer holds a path there.
				return
			}
			w.mu.Lock()
			w.stats.kept++
			w.mu.Unlock()
			w.logger.Debug("watcher event kept: directory gone", "op", ev.Op.String(), "path", rel)
			co.add(rel + removedDirSuffix)
			return
		}
	}

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

	keep, isGitState := classify(rel)
	if !keep {
		w.mu.Lock()
		w.stats.droppedExt++
		w.mu.Unlock()
		return
	}
	// A .git state file whose contents are byte-for-byte what they were is not
	// a state change, however many times it is rewritten.
	if isGitState && !w.gitStateDidChange(rel) {
		w.mu.Lock()
		w.stats.droppedSameFP++
		w.mu.Unlock()
		w.logger.Debug("watcher event dropped: git state file rewritten unchanged", "path", rel)
		return
	}
	// Ignore filtering applies to .md content paths. The .git state files and
	// the repository's own config are never user-ignored: they are not content,
	// and a rule meant to hide documents must not stop the viewer hearing that
	// its configuration changed.
	if w.matcher != nil && !strings.HasPrefix(rel, ".git/") && rel != repoconfig.FileName && w.matcher.IsIgnored(rel, false) {
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

// flush processes a coalesced change set: invalidate caches and broadcast
// files_changed.
func (w *Watcher) flush(batch []string) {
	if len(batch) == 0 {
		return
	}
	paths, removedDirs := splitBatch(batch)

	gitsvc.ClearStatusCache()

	// A directory that went away takes its Markdown with it, so which
	// directories hold Markdown has changed although no .md path was pushed.
	hasMarkdown := len(removedDirs) > 0
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

	msg := filesChangedMessage{Type: "files_changed", Paths: paths, RemovedDirs: removedDirs}
	if w.repoName != "" {
		msg.Repo = w.repoName
	}
	w.logger.Info("files changed", "count", len(paths), "removed_dirs", len(removedDirs))
	w.manager.Broadcast(msg)
}

// removedDirSuffix marks a removed directory in the coalescer's batch, whose
// entries are plain strings. A file path never ends in "/", so the mark cannot
// collide with one, and a directory that goes away twice inside one window is
// folded like any repeated path.
const removedDirSuffix = "/"

// splitBatch separates a coalesced batch into its file paths and its removed
// directories, each sorted and never nil. A removed directory inside another
// removed directory is dropped: `rm -rf docs/old` removes `docs/old/sub` first,
// and naming both says nothing the outer one does not.
func splitBatch(batch []string) (paths, removedDirs []string) {
	paths, removedDirs = []string{}, []string{}
	for _, p := range batch {
		if dir, ok := strings.CutSuffix(p, removedDirSuffix); ok {
			removedDirs = append(removedDirs, dir)
		} else {
			paths = append(paths, p)
		}
	}
	sort.Strings(paths)
	sort.Strings(removedDirs)

	outer := removedDirs[:0]
	for _, dir := range removedDirs {
		inside := false
		for _, o := range outer {
			if strings.HasPrefix(dir, o+"/") {
				inside = true
				break
			}
		}
		if !inside {
			outer = append(outer, dir)
		}
	}
	return paths, outer
}

// filesChangedMessage is the broadcast payload for a coalesced change set.
//
// RemovedDirs names each watched directory that was renamed away or removed,
// by the path it had: everything a consumer holds under it is gone, and no path
// in Paths says so. It is omitted when empty, so the message older consumers
// know is unchanged. A path in Paths may lie under a removed directory — a file
// deleted along with it, or one written after the directory was replaced
// within the window — so a consumer drops the directories first and then
// refreshes each path, whose own answer says which it was.
type filesChangedMessage struct {
	Type        string   `json:"type"`
	Repo        string   `json:"repo,omitempty"`
	Paths       []string `json:"paths"`
	RemovedDirs []string `json:"removed_dirs,omitempty"`
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

// (A changelog_ignored push used to live here: the watcher scanned every saved
// .md for a retired-protocol changelog marker and warned that the agent's
// response was lost. It was removed because presence of a marker is not
// evidence of a lost turn — the same warning fired whether the response was
// dropped or delivered perfectly through the inbox seconds later, so it could
// never answer the question it asked. The frontend now derives "an agent is
// working on this document" from files_changed + unanswered comments instead,
// which is a claim the available signals actually support.)

// logStartup emits the watcher's startup line, spelling out the inbox
// situation so "which inbox is actually being watched" is answerable from the
// journal alone. This is the log whose absence made a review delivery that
// landed in an unwatched directory impossible to diagnose: without it, a repo
// that consumes no inbox and a repo whose inbox is watched-but-empty look
// identical. inbox_enabled is whether consumption runs at all (a nil store
// disables it); inbox_dir is the absolute path an agent must write into for
// this repo; inbox_exists is whether that directory is present right now.
func (w *Watcher) logStartup(watchedDirs int) {
	inboxDir := review.InboxDir(w.root)
	inboxExists := false
	if _, err := os.Stat(inboxDir); err == nil {
		inboxExists = true
	}
	w.mu.Lock()
	failedDirs := w.watchFailedDirs
	w.mu.Unlock()
	w.logger.Info("watcher started",
		"root", w.root,
		"watched_dirs", watchedDirs,
		"watch_failed_dirs", failedDirs,
		"inbox_enabled", w.store != nil,
		"inbox_dir", inboxDir,
		"inbox_exists", inboxExists,
	)
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

// seedGitStateFingerprints records the current contents of every watched .git
// state file, so the first event after startup is compared against reality
// rather than against nothing. Without it the first `git status` of the session
// always looks like a change.
func (w *Watcher) seedGitStateFingerprints() {
	for name := range gitStateFiles {
		rel := ".git/" + name
		fp := w.fingerprint(rel)
		w.mu.Lock()
		w.gitStateFP[rel] = fp
		w.mu.Unlock()
	}
}

// gitStateDidChange reports whether the .git state file at rel (repo-relative,
// slash-separated) holds different bytes than the last time it was looked at,
// recording the new fingerprint either way. An unreadable file — deleted, or
// caught mid-rename — fingerprints as empty, which differs from any real
// content and so errs towards broadcasting.
func (w *Watcher) gitStateDidChange(rel string) bool {
	fp := w.fingerprint(rel)
	w.mu.Lock()
	defer w.mu.Unlock()
	prev, seen := w.gitStateFP[rel]
	w.gitStateFP[rel] = fp
	return !seen || prev != fp
}

// fingerprint hashes the file at the repo-relative path rel. A missing or
// unreadable file yields "". The files this is used on are git's own state
// files: HEAD and friends are a line long, and .git/index is a few tens of KB
// in a typical repo, so hashing one is cheaper than the WebSocket broadcast and
// the round of API calls it saves.
func (w *Watcher) fingerprint(rel string) string {
	f, err := os.Open(filepath.Join(w.root, filepath.FromSlash(rel)))
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}

func (w *Watcher) registerWatch(path string) error {
	w.mu.Lock()
	overBudget := w.watchLimit > 0 && w.watched >= w.watchLimit
	w.mu.Unlock()
	if overBudget {
		return errWatchBudget
	}
	var err error
	switch {
	case w.addWatch != nil:
		err = w.addWatch(path)
	case w.fsw == nil:
		err = errors.New("watcher is not started")
	default:
		err = w.fsw.Add(path)
	}
	if err != nil {
		return err
	}
	w.mu.Lock()
	w.watched++
	w.mu.Unlock()
	if rel, relErr := filepath.Rel(w.root, path); relErr == nil && rel != "." {
		w.mu.Lock()
		w.dirs[filepath.ToSlash(rel)] = struct{}{}
		w.mu.Unlock()
	}
	return nil
}

// unregisterWatch drops the watch on one directory, if there still is one. A
// failure is not interesting: it means the kernel or fsnotify dropped it first.
func (w *Watcher) unregisterWatch(path string) {
	w.mu.Lock()
	fsw, remove := w.fsw, w.removeWatch
	w.mu.Unlock()
	if remove != nil {
		remove(path)
		return
	}
	if fsw != nil {
		_ = fsw.Remove(path)
	}
}

// forgetDir removes rel and every watched directory below it from the watch
// set's record, returning what it removed — nothing when rel was not a watched
// directory.
func (w *Watcher) forgetDir(rel string) []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, ok := w.dirs[rel]; !ok {
		return nil
	}
	gone := []string{rel}
	delete(w.dirs, rel)
	for dir := range w.dirs {
		if strings.HasPrefix(dir, rel+"/") {
			gone = append(gone, dir)
			delete(w.dirs, dir)
		}
	}
	sort.Strings(gone)
	return gone
}

// isContent reports whether a repo-relative slash path is one the watcher
// pushes as changed content: kept by classify, not a .git state file, not
// inbox traffic, and not ignored.
func (w *Watcher) isContent(rel string) bool {
	keep, isGitState := classify(rel)
	if !keep || isGitState || isInboxPath(rel) {
		return false
	}
	return rel == repoconfig.FileName || w.matcher == nil || !w.matcher.IsIgnored(rel, false)
}

func (w *Watcher) logAddWatchFailure(path string, err error) {
	w.mu.Lock()
	w.watchFailedDirs++
	w.mu.Unlock()
	if isWatchLimitError(err) {
		rel := "."
		if r, relErr := filepath.Rel(w.root, path); relErr == nil {
			rel = filepath.ToSlash(r)
		}
		w.reportWatchLimit(rel)
		w.logger.Error("watcher: failed to add watch; inotify watch limit may be reached — live reload will miss changes under this directory; "+
			"raise fs.inotify.max_user_watches (e.g. sysctl fs.inotify.max_user_watches=524288)",
			"path", path, "error", err)
		return
	}
	w.logger.Warn("watcher: failed to add watch", "path", path, "error", err)
}

// handleError surfaces an fsnotify error, adding a hint for the common inotify
// watch-exhaustion case (ENOSPC) which otherwise manifests as live reload
// silently failing for some files.
func (w *Watcher) handleError(err error) {
	if isWatchLimitError(err) {
		w.reportWatchLimit("")
		w.logger.Error("watcher: inotify watch limit reached — live reload will miss some changes; "+
			"raise fs.inotify.max_user_watches (e.g. sysctl fs.inotify.max_user_watches=524288)",
			"error", err)
		return
	}
	w.logger.Warn("watcher error", "error", err)
}

// reportWatchLimit counts one watch refused by the watch limit — for the
// folder rel, or "" when the kernel did not say which — and tells the
// degradation handler, if there is one.
func (w *Watcher) reportWatchLimit(rel string) {
	w.mu.Lock()
	w.limitFailures++
	if w.firstLimitPath == "" {
		w.firstLimitPath = rel
	}
	d := model.Degradation{
		Repo:  w.repoName,
		Kind:  model.DegradationWatchLimit,
		Path:  w.firstLimitPath,
		Count: w.limitFailures,
	}
	fn := w.onDegraded
	w.mu.Unlock()
	if fn != nil {
		fn(d)
	}
}

func isWatchLimitError(err error) bool {
	return errors.Is(err, fsnotify.ErrEventOverflow) || strings.Contains(err.Error(), "no space left")
}

// logHeartbeat emits and resets the interval stats so a stalled watcher is
// distinguishable from a quiet one.
func (w *Watcher) logHeartbeat() {
	w.mu.Lock()
	s := w.stats
	failedDirs := w.watchFailedDirs
	w.stats = watcherStats{}
	w.mu.Unlock()
	w.logger.Info("watcher heartbeat",
		"events", s.eventsTotal,
		"watch_failed_dirs", failedDirs,
		"kept", s.kept,
		"dropped_ext", s.droppedExt,
		"dropped_ignore", s.droppedIgnore,
		"dropped_outside", s.droppedOutside,
		"dropped_same_content", s.droppedSameFP,
	)
}
