package api

import (
	"github.com/mschulkind-oss/vantage/internal/fs"
	"github.com/mschulkind-oss/vantage/internal/git"
	"github.com/mschulkind-oss/vantage/internal/model"
)

// This file holds the pure response builders shared by the live HTTP handlers
// and the static site builder. Each takes explicit services and parameters and
// returns model types (plus an error where one is meaningful). Keeping the
// response-shaping logic here — rather than inline in the handlers — guarantees
// the live API and the no-backend static export cannot drift in shape (the R2
// mitigation from the port spec). The builders never write HTTP; the caller
// maps any returned error to a status code.
//
// Git-derived builders (history, status, diff, working diff, recents) inherit
// the git service's "errors degrade to empty" contract: a failed git call
// yields an empty slice / nil diff, never a builder error. Filesystem builders
// surface *fs.PathError (validation) so the handler can map it to a 400.

// HistoryLimit is the fixed number of commits GET /git/history returns.
const HistoryLimit = 10

// RecentDefaultLimit is the default limit for the recent-files endpoints.
const RecentDefaultLimit = 10

// recentLimitMin and recentLimitMax bound the caller-supplied recents limit.
const (
	recentLimitMin = 1
	recentLimitMax = 1000
)

// BuildTree returns the file-tree listing of path within the repository served
// by svc. opts controls git annotation and hidden/gitignored inclusion. A path
// that fails validation returns a *fs.PathError (→ 400); a permission error
// degrades to an empty listing.
func BuildTree(svc *fs.FileSystemService, path string, opts fs.Options) ([]model.FileNode, error) {
	return svc.ListDirectory(path, opts)
}

// BuildContent reads path and returns its [model.FileContent] (utf-8 text or a
// binary marker). A path that fails validation or is not a regular file returns
// a *fs.PathError (→ 400). This is the JSON branch of the dual-mode /content
// endpoint; raw-image serving is handled in the handler, not here.
func BuildContent(svc *fs.FileSystemService, path string) (*model.FileContent, error) {
	return svc.ReadFile(path)
}

// BuildFilesAll returns every Markdown file under the repository as
// repo-relative, slash-separated paths, sorted. It never errors.
func BuildFilesAll(svc *fs.FileSystemService) []string {
	return svc.ListAllFiles()
}

// BuildHistory returns up to [HistoryLimit] commits touching path, newest
// first. Git errors degrade to an empty slice (the endpoint is HTTP 200 even on
// failure), so this never returns a non-nil slice as nil — callers can marshal
// the result directly.
func BuildHistory(svc *git.GitService, path string) []model.GitCommit {
	return svc.History(path, HistoryLimit)
}

// BuildStatus returns the [model.FileStatus] for path: its most recent commit
// (or nil) and its working-tree status enum (or nil when clean). Both git
// probes degrade to empty on failure.
func BuildStatus(svc *git.GitService, path string) model.FileStatus {
	last := svc.LastCommit(path)
	var status *string
	if s, ok := svc.Status()[path]; ok && s != "" {
		status = &s
	}
	return model.FileStatus{LastCommit: last, GitStatus: status}
}

// BuildDiff returns the diff of path at commit, or nil when the commit does not
// touch the file. commit must already be a validated hex SHA; [git.ValidateSHA]
// is enforced defensively. A nil result with a nil error means "no diff" and the
// handler maps it to 404.
func BuildDiff(svc *git.GitService, path, commit string) (*model.FileDiff, error) {
	return svc.FileDiff(path, commit)
}

// BuildWorkingDiff returns the uncommitted (working-tree vs HEAD) diff of path,
// or nil when the file has no working changes. The returned diff carries the
// sentinel commit metadata the frontend keys on (hexsha "working"). A nil
// result with a nil error maps to 404.
func BuildWorkingDiff(svc *git.GitService, path string) (*model.FileDiff, error) {
	return svc.WorkingDiff(path)
}

// BuildRecent returns the most recently changed Markdown files in the
// repository, newest first, after clamping limit to [1,1000]. Git errors
// degrade to whatever could be gathered (possibly empty).
func BuildRecent(svc *git.GitService, limit int, showHidden, showGitignored bool) []model.RecentFile {
	limit = clampRecentLimit(limit)
	return svc.Recents(limit, nil, showHidden, showGitignored)
}

// BuildInfo returns the [model.RepoInfoResponse] for the repository: its
// directory name (from the git service) and absolute root path (from the fs
// service, which holds the resolved root).
func BuildInfo(g *git.GitService, f *fs.FileSystemService) model.RepoInfoResponse {
	return model.RepoInfoResponse{
		Name:     g.RepoName(),
		RootPath: f.RootPath(),
	}
}

// BuildVersion returns the [model.VersionInfo] for the repository: the short
// HEAD SHA (or "unknown") and whether the working tree is dirty.
func BuildVersion(svc *git.GitService) model.VersionInfo {
	hash := svc.HeadHash()
	if hash == "" {
		hash = "unknown"
	}
	return model.VersionInfo{CommitHash: hash, IsDirty: svc.IsDirty()}
}

// BuildReposList returns the single-repo sentinel [{"name":""}]. Multi-repo
// daemon mode fans out across repositories and attaches last-activity in the
// server, which owns the repo-activity cache; this builder only covers the
// single-repo case shared with the static builder.
func BuildReposList() []model.RepoInfo {
	return []model.RepoInfo{{Name: ""}}
}

// BuildFilesAllScoped pairs each Markdown path from BuildFilesAll with repo,
// producing the GET /files/all element shape ([]{repo,path}). In single-repo
// mode repo is "".
func BuildFilesAllScoped(svc *fs.FileSystemService, repo string) []model.RepoFile {
	paths := BuildFilesAll(svc)
	out := make([]model.RepoFile, 0, len(paths))
	for _, p := range paths {
		out = append(out, model.RepoFile{Repo: repo, Path: p})
	}
	return out
}

// RecentAllItem is one element of GET /recent/all: a [model.RecentFile] flat
// with an added repo name. The embedded RecentFile contributes its keys
// (path, date, …); repo is the originating repository ("" in single-repo mode).
type RecentAllItem struct {
	Repo string `json:"repo"`
	model.RecentFile
}

// BuildRecentAll returns the repository's recent files tagged with repo, for
// the GET /recent/all global. The server merges and re-sorts these across
// repositories in multi-repo mode.
func BuildRecentAll(svc *git.GitService, repo string, limit int, showHidden, showGitignored bool) []RecentAllItem {
	files := BuildRecent(svc, limit, showHidden, showGitignored)
	out := make([]RecentAllItem, 0, len(files))
	for _, f := range files {
		out = append(out, RecentAllItem{Repo: repo, RecentFile: f})
	}
	return out
}

// clampRecentLimit constrains a recents limit to the contract's [1,1000] range.
func clampRecentLimit(limit int) int {
	return clamp(limit, recentLimitMin, recentLimitMax)
}
