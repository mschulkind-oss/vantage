package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/review"
)

// ScannedQuestion is one question of the shared planning scanner's index: its
// directive id (empty when the scanner assigned it to no question, which is how
// it treats an id two question runs both claim) and the file lines of its unit.
type ScannedQuestion struct {
	ID          string
	UnitLine    int
	UnitEndLine int
	// UnitText is the unit as the rendered page reads it (`unitText`), "" from a
	// checker that does not report it.
	UnitText string
}

// QuestionScanner lists the questions the shared planning scanner finds in the
// repository rooted at root, by repository-relative document path. It is the
// bridge to the one scanner the viewer and the checker share: the server has no
// Markdown parser of its own.
type QuestionScanner interface {
	Scan(ctx context.Context, root string) (map[string][]ScannedQuestion, error)
}

// CLIQuestionScanner runs `vantage-check index --format json` in the repository
// root and reads each document's questions from its index.
type CLIQuestionScanner struct {
	// Command is the checker's argv prefix, for example ["vantage-check"].
	Command []string
}

// scanTimeout bounds one scan so a wedged checker cannot hold a review lock.
const scanTimeout = 30 * time.Second

// Scan implements [QuestionScanner].
func (c CLIQuestionScanner) Scan(ctx context.Context, root string) (map[string][]ScannedQuestion, error) {
	if len(c.Command) == 0 {
		return nil, fmt.Errorf("no checker command")
	}
	ctx, cancel := context.WithTimeout(ctx, scanTimeout)
	defer cancel()
	args := append(append([]string{}, c.Command[1:]...), "index", "--format", "json")
	cmd := exec.CommandContext(ctx, c.Command[0], args...)
	cmd.Dir = root
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	if err := cmd.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && indexRefused(out.Bytes()) {
			return nil, ErrScanRefused
		}
		return nil, fmt.Errorf("%w: %s", err, errOut.String())
	}
	var parsed struct {
		Index struct {
			Documents []struct {
				Path      string `json:"path"`
				Questions []struct {
					ID          *string `json:"id"`
					UnitLine    int     `json:"unitLine"`
					UnitEndLine int     `json:"unitEndLine"`
					UnitText    string  `json:"unitText"`
				} `json:"questions"`
			} `json:"documents"`
		} `json:"index"`
	}
	if err := json.Unmarshal(out.Bytes(), &parsed); err != nil {
		return nil, err
	}
	result := map[string][]ScannedQuestion{}
	for _, d := range parsed.Index.Documents {
		for _, q := range d.Questions {
			id := ""
			if q.ID != nil {
				id = *q.ID
			}
			result[d.Path] = append(result[d.Path], ScannedQuestion{ID: id, UnitLine: q.UnitLine, UnitEndLine: q.UnitEndLine, UnitText: q.UnitText})
		}
	}
	return result, nil
}

// indexRefused reports whether the checker's JSON says the project was refused.
func indexRefused(out []byte) bool {
	var parsed struct {
		Index struct {
			Refused bool `json:"refused"`
		} `json:"index"`
	}
	return json.Unmarshal(out, &parsed) == nil && parsed.Index.Refused
}

// maxUnitCache bounds the unit cache: one entry per (repository, document,
// content hash), oldest dropped first.
const maxUnitCache = 128

type unitKey struct{ repo, path, hash string }

// DocumentObserver reads a document for a review command and, only when a
// command asks for it, its unique question units from the scanner. Units are
// cached per (repository, path, content hash) — not per card or comment — so a
// document is scanned once per distinct content however many comments are bound.
type DocumentObserver struct {
	reviews *review.Store
	scanner QuestionScanner
	now     func() time.Time // the clock of the failed-scan memory; tests replace it

	scanMu  sync.Mutex // serializes scans, so a burst of binds scans once
	mu      sync.Mutex
	cache   map[unitKey]*review.Scan
	ordered []unitKey
	failed  map[unitKey]failedScan
}

// failedScanMemory is how long a failed scan of one (repository, path, content
// hash) is remembered, so a checker that keeps failing is not run again on every
// write under the review lock.
const failedScanMemory = 5 * time.Second

type failedScan struct {
	until  time.Time
	reason string
}

// ErrScanRefused is the checker's answer that it would not scan the project
// (more candidate documents than its limit); a refusal, not a missing checker.
var ErrScanRefused = errors.New("the checker refused the scan: over its document limit")

// NewDocumentObserver returns an observer; a nil scanner proves nothing.
func NewDocumentObserver(reviews *review.Store, scanner QuestionScanner) *DocumentObserver {
	return &DocumentObserver{reviews: reviews, scanner: scanner, now: time.Now,
		cache: map[unitKey]*review.Scan{}, failed: map[unitKey]failedScan{}}
}

// readDocument returns the document's text and content hash, both "" when it
// cannot be read as text.
func readDocument(svc RepoServices, path string) (content, hash string) {
	fc, err := BuildContent(svc.FS, path)
	if err != nil || fc == nil || fc.Encoding == "binary" {
		return "", ""
	}
	return fc.Content, review.ContentHash(fc.Content)
}

// Source is the [review.DocSource] for path in svc: each call reads the
// document afresh, which the store makes after taking the review's lock.
func (d *DocumentObserver) Source(svc RepoServices, path string) review.DocSource {
	return func() *review.Observation {
		content, hash := readDocument(svc, path)
		obs := &review.Observation{Evidence: d.reviews.ObserveDocument(svc.Repo, path, hash), Content: content}
		if hash != "" && d.scanner != nil {
			key := unitKey{svc.Repo, path, hash}
			obs.LoadScan = func() *review.Scan { return d.units(svc, path, content, hash) }
			obs.ScanFailure = func() string { return d.failure(key) }
		}
		return obs
	}
}

// units returns what the scanner proves about content (whose hash is hash), or
// nil when the scan fails or the document changed while it ran. Concurrent
// callers for the same (repository, path, hash) share one scan: the cache is
// read again after taking scanMu.
func (d *DocumentObserver) units(svc RepoServices, path, content, hash string) *review.Scan {
	key := unitKey{svc.Repo, path, hash}
	if u, ok := d.cached(key); ok {
		return u
	}
	d.scanMu.Lock()
	defer d.scanMu.Unlock()
	if u, ok := d.cached(key); ok {
		return u
	}
	if d.failure(key) != "" {
		return nil
	}
	scanned, err := d.scanner.Scan(context.Background(), svc.FS.RootPath())
	if err != nil {
		reason := model.ReasonScannerFailed
		if errors.Is(err, ErrScanRefused) {
			reason = model.ReasonScanRefused
		}
		d.remember(key, reason)
		slog.Warn("api: question scan failed; no question ownership is proven", "path", path, "reason", reason, "error", err)
		return nil
	}
	// The scanner read the file itself: only a scan of the very contents we
	// hashed counts, so a write racing the scan proves nothing.
	if _, again := readDocument(svc, path); again != hash {
		d.remember(key, model.ReasonScanRaced)
		return nil
	}
	counts := map[string]int{}
	for _, q := range scanned[path] {
		if q.ID != "" {
			counts[q.ID]++
		}
	}
	units := &review.Scan{Units: map[string]review.Unit{}}
	for _, q := range scanned[path] {
		if q.UnitLine > 0 && q.UnitEndLine >= q.UnitLine {
			units.Spans = append(units.Spans, review.Span{StartLine: q.UnitLine, EndLine: q.UnitEndLine})
		}
		if q.ID == "" || counts[q.ID] != 1 {
			continue
		}
		if u, ok := review.BuildUnit(content, q.UnitLine, q.UnitEndLine); ok {
			u.PlainText = q.UnitText
			units.Units[q.ID] = u
		}
	}
	d.mu.Lock()
	d.cache[key] = units
	d.ordered = append(d.ordered, key)
	if len(d.ordered) > maxUnitCache {
		delete(d.cache, d.ordered[0])
		d.ordered = d.ordered[1:]
	}
	d.mu.Unlock()
	return units
}

// failure is why a recent scan of key failed, "" when none did (or the memory
// of it has expired).
func (d *DocumentObserver) failure(key unitKey) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	f, ok := d.failed[key]
	if !ok || !d.now().Before(f.until) {
		delete(d.failed, key)
		return ""
	}
	return f.reason
}

func (d *DocumentObserver) remember(key unitKey, reason string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.failed) >= maxUnitCache {
		clear(d.failed)
	}
	d.failed[key] = failedScan{until: d.now().Add(failedScanMemory), reason: reason}
}

func (d *DocumentObserver) cached(key unitKey) (*review.Scan, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	u, ok := d.cache[key]
	return u, ok
}

// checkerName is the checker's executable name; releases ship it beside the
// server binary.
const checkerName = "vantage-check"

// NewCLIQuestionScannerFromEnv returns the scanner for the checker found, in
// order, at $VANTAGE_CHECK, as an executable `vantage-check` beside the running
// server executable (where release archives put it), then on PATH; nil when
// there is none (a server-only install from go install or PyPI).
func NewCLIQuestionScannerFromEnv(getenv func(string) string, lookPath func(string) (string, error), executable func() (string, error)) QuestionScanner {
	if bin := getenv("VANTAGE_CHECK"); bin != "" {
		return CLIQuestionScanner{Command: []string{bin}}
	}
	if executable != nil {
		if self, err := executable(); err == nil {
			if resolved, err := filepath.EvalSymlinks(self); err == nil {
				self = resolved
			}
			name := checkerName
			if runtime.GOOS == "windows" {
				name += ".exe"
			}
			neighbour := filepath.Join(filepath.Dir(self), name)
			if info, err := os.Stat(neighbour); err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0 {
				return CLIQuestionScanner{Command: []string{neighbour}}
			}
		}
	}
	if bin, err := lookPath(checkerName); err == nil {
		return CLIQuestionScanner{Command: []string{bin}}
	}
	return nil
}

// ResolveQuestionScanner is [NewCLIQuestionScannerFromEnv] that says, once, at
// startup, what a server without a checker gives up.
func ResolveQuestionScanner(logger *slog.Logger, getenv func(string) string, lookPath func(string) (string, error), executable func() (string, error)) QuestionScanner {
	sc := NewCLIQuestionScannerFromEnv(getenv, lookPath, executable)
	if sc == nil {
		logger.Warn("api: no vantage-check found: question ownership cannot be proven, so per-round before/after " +
			"captures of review comments stop updating (their ownership reads Unknown; existing comments are kept). " +
			"Provide the checker: set VANTAGE_CHECK to its path, put vantage-check next to the vantage binary, or put it on PATH")
	}
	return sc
}
