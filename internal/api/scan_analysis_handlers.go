package api

import (
	"net/http"
	"path"
	"path/filepath"
	"strings"

	"github.com/mschulkind-oss/vantage/internal/git"
)

var scanAnalysisSlots = make(chan struct{}, 1)

type scanAnalysisResponse struct {
	Evidence   *scanEvidence           `json:"evidence"`
	Diagnostic *git.ScanAnalysisResult `json:"diagnostic"`
}

type scanEvidence struct {
	Command    string `json:"command"`
	Directory  string `json:"directory"`
	ElapsedMs  int64  `json:"elapsedMs"`
	TimeoutMs  int64  `json:"timeoutMs"`
	Gitignored bool   `json:"gitignored"`
	TimedOut   bool   `json:"timedOut"`
	Error      string `json:"error,omitempty"`
	// UnknownFailures counts failure reports omitted when the bounded per-walk
	// evidence cache fills; their completion state is unknown.
	UnknownFailures int                  `json:"unknown_failures"`
	Settings        scanEvidenceSettings `json:"settings"`
}

type scanEvidenceSettings struct {
	ShowHidden      bool `json:"show_hidden"`
	UseIgnoreFiles  bool `json:"use_ignore_files"`
	ExcludeDirCount int  `json:"exclude_dir_count"`
	WalkMaxDepth    *int `json:"walk_max_depth"`
}

// GitScanAnalysisEvidence handles GET /git/scan-analysis. It only reads the
// last report captured by the normal recents query; it never starts a scan.
func (h *Handlers) GitScanAnalysisEvidence(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	var evidence *scanEvidence
	if report, ok := svc.Git.LastWalkReport(); ok {
		evidence = evidenceFromWalkReport(report)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, scanAnalysisResponse{Evidence: evidence, Diagnostic: nil})
}

// GitScanAnalysis handles POST /git/scan-analysis. A process-wide slot bounds
// deliberate scans so multiple repository requests cannot multiply their cost.
func (h *Handlers) GitScanAnalysis(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	select {
	case scanAnalysisSlots <- struct{}{}:
		defer func() { <-scanAnalysisSlots }()
	default:
		writeError(w, http.StatusTooManyRequests, "A scan analysis is already running; retry after it completes.")
		return
	}
	diagnostic := svc.Git.ScanAnalysis(r.Context())
	var evidence *scanEvidence
	if report, ok := svc.Git.LastWalkReport(); ok {
		evidence = evidenceFromWalkReport(report)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, scanAnalysisResponse{Evidence: evidence, Diagnostic: &diagnostic})
}

func safeEvidenceDirectory(dir string) string {
	if dir == "" {
		return "."
	}
	slash := filepath.ToSlash(dir)
	if filepath.IsAbs(dir) || filepath.VolumeName(dir) != "" || strings.HasPrefix(slash, "//") || isWindowsAbsolute(slash) || strings.ContainsAny(dir, "\x00\r\n") {
		return "."
	}
	for _, segment := range strings.Split(slash, "/") {
		if segment == ".." {
			return "."
		}
	}
	clean := strings.TrimPrefix(path.Clean(slash), "./")
	if clean == ".." || strings.HasPrefix(clean, "../") || path.IsAbs(clean) {
		return "."
	}
	return clean
}

func isWindowsAbsolute(path string) bool {
	return len(path) >= 3 && ((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z')) && path[1] == ':' && path[2] == '/'
}

func evidenceFromWalkReport(report git.WalkReport) *scanEvidence {
	depth := report.WalkMaxDepth
	if depth != nil {
		value := *depth
		depth = &value
	}
	return &scanEvidence{
		Command:         report.Command,
		Directory:       safeEvidenceDirectory(report.Dir),
		ElapsedMs:       report.Elapsed.Milliseconds(),
		TimeoutMs:       report.Timeout.Milliseconds(),
		Gitignored:      report.Gitignored,
		TimedOut:        report.TimedOut,
		Error:           report.Error,
		UnknownFailures: report.UnknownFailures,
		Settings: scanEvidenceSettings{
			ShowHidden:      report.ShowHidden,
			UseIgnoreFiles:  report.UseIgnoreFiles,
			ExcludeDirCount: report.ExcludeDirCount,
			WalkMaxDepth:    depth,
		},
	}
}
