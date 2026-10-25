package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mschulkind-oss/vantage/internal/git"
	"github.com/stretchr/testify/require"
)

func TestGitScanAnalysisGetReadsEvidenceWithoutScanning(t *testing.T) {
	e := newTestEnv(t, true)
	w := e.do(e.h.GitScanAnalysisEvidence, http.MethodGet, "/git/scan-analysis", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	require.JSONEq(t, `{"evidence":null,"diagnostic":null}`, w.Body.String())
	if _, ok := e.git.LastWalkReport(); ok {
		t.Fatal("GET must not start a recent-files scan")
	}

	e.git.Recents(10, nil, true, false)
	w = e.do(e.h.GitScanAnalysisEvidence, http.MethodGet, "/git/scan-analysis", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var body scanAnalysisResponse
	decode(t, w, &body)
	require.NotNil(t, body.Evidence)
	require.Nil(t, body.Diagnostic)
	require.Contains(t, body.Evidence.Command, "git --no-optional-locks ls-files --others")
	require.False(t, body.Evidence.Gitignored)
	require.Equal(t, ".", body.Evidence.Directory)
	require.NotZero(t, body.Evidence.Settings)
}

func TestGitScanAnalysisPostReturnsBoundedDiagnostic(t *testing.T) {
	e := newTestEnv(t, true)
	writeFile(t, e.dir, "docs/readme.md", "# doc\n")
	writeFile(t, e.dir, "docs/other.txt", "not a doc\n")
	e.git.Recents(10, nil, true, true)

	w := e.do(e.h.GitScanAnalysis, http.MethodPost, "/git/scan-analysis", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var body scanAnalysisResponse
	decode(t, w, &body)
	require.NotNil(t, body.Diagnostic)
	require.Equal(t, "filesystem_directory_entries_and_readdir_time", body.Diagnostic.Method)
	require.Equal(t, "completed", body.Diagnostic.Comparison.Status)
	require.LessOrEqual(t, body.Diagnostic.Entries, 10000)
	require.LessOrEqual(t, len(body.Diagnostic.Directories), 20)
	require.NotNil(t, body.Diagnostic.Directories)
	require.NotNil(t, body.Diagnostic.Recommendations)
	require.NotContains(t, w.Body.String(), e.dir)
}

func TestSafeEvidenceDirectoryRejectsAbsoluteAndTraversalPaths(t *testing.T) {
	require.Equal(t, ".", safeEvidenceDirectory("/outside/project"))
	require.Equal(t, ".", safeEvidenceDirectory("../outside"))
	require.Equal(t, ".", safeEvidenceDirectory("child/../outside"))
	require.Equal(t, ".", safeEvidenceDirectory("C:/outside/project"))
	require.Equal(t, "child/docs", safeEvidenceDirectory("child/docs"))
}

func TestGitScanAnalysisEvidenceIncludesSafeDelegatedDirectory(t *testing.T) {
	e := newTestEnv(t, false)
	child := filepath.Join(e.dir, "child")
	require.NoError(t, os.MkdirAll(child, 0o755))
	runGit(t, child, "init", "-q")
	writeFile(t, child, "doc.md", "# child\n")
	e.git = git.NewService(e.dir, git.Options{WalkTimeout: time.Nanosecond})
	e.git.Recents(10, nil, true, true)
	w := e.do(e.h.GitScanAnalysisEvidence, http.MethodGet, "/git/scan-analysis", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var body scanAnalysisResponse
	decode(t, w, &body)
	require.Equal(t, "child", body.Evidence.Directory)
	require.Equal(t, "timeout", body.Evidence.Error)
	require.NotContains(t, w.Body.String(), e.dir)
	limitedEvidence := evidenceFromWalkReport(git.WalkReport{UnknownFailures: 3})
	require.Equal(t, 3, limitedEvidence.UnknownFailures)
}

func TestGitScanAnalysisConcurrentRequestGets429AndRetryStep(t *testing.T) {
	e := newTestEnv(t, true)
	scanAnalysisSlots <- struct{}{}
	defer func() { <-scanAnalysisSlots }()

	w := e.do(e.h.GitScanAnalysis, http.MethodPost, "/git/scan-analysis", "", true)
	require.Equal(t, http.StatusTooManyRequests, w.Code)
	require.JSONEq(t, `{"error":"A scan analysis is already running; retry after it completes."}`, w.Body.String())
}

func TestGitScanAnalysisPostHonorsRequestCancellation(t *testing.T) {
	e := newTestEnv(t, true)
	request := httptest.NewRequest(http.MethodPost, "/git/scan-analysis", nil)
	ctx, cancel := context.WithCancel(request.Context())
	cancel()
	request = request.WithContext(WithRepoServices(ctx, RepoServices{Git: e.git, FS: e.fs}))
	w := httptest.NewRecorder()
	e.h.GitScanAnalysis(w, request)
	require.Equal(t, http.StatusOK, w.Code)
	var body scanAnalysisResponse
	decode(t, w, &body)
	require.NotNil(t, body.Diagnostic)
	require.True(t, body.Diagnostic.Partial)
	require.Contains(t, body.Diagnostic.Reason, "cancelled")
}

func TestGitScanAnalysisRoutesAreRepoScoped(t *testing.T) {
	e := newTestEnv(t, false)
	want := map[string]string{
		"GET /git/scan-analysis":  "/git/scan-analysis",
		"POST /git/scan-analysis": "/git/scan-analysis",
	}
	for _, route := range e.h.Routes() {
		key := route.Method + " " + route.Pattern
		if _, ok := want[key]; ok {
			require.Equal(t, ScopeRepo, route.Scope, key)
			delete(want, key)
		}
	}
	require.Empty(t, want)
}

func TestGitScanAnalysisNoRepoUsesExistingErrorEnvelope(t *testing.T) {
	e := newTestEnv(t, false)
	request := httptest.NewRequest(http.MethodGet, "/git/scan-analysis", nil)
	w := httptest.NewRecorder()
	e.h.GitScanAnalysisEvidence(w, request)
	require.Equal(t, http.StatusBadRequest, w.Code)
	var envelope map[string]string
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &envelope))
	require.NotEmpty(t, envelope["error"])
	require.NotContains(t, strings.ToLower(envelope["error"]), e.dir)
}
