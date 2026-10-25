package git

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/mschulkind-oss/vantage/internal/ignore"
	"github.com/mschulkind-oss/vantage/internal/perf"
	"github.com/stretchr/testify/require"
)

func TestScanAnalysisUsesBoundedFilesystemWalkAndGitignoredComparison(t *testing.T) {
	repo := initRepo(t)
	for i := 0; i < 60; i++ {
		writeFile(t, repo, filepath.Join("large", "doc-"+string(rune('a'+i%26))+"-"+string(rune('A'+i/26))+".md"), "# doc\n")
	}
	writeFile(t, repo, ".gitignore", "ignored/\n")
	writeFile(t, repo, "ignored/secret.md", "# hidden\n")
	writeFile(t, repo, "small/readme.md", "# visible\n")

	svc := NewService(repo, Options{ExcludeDirs: []string{"excluded"}, WalkTimeout: time.Second})
	beforePerf := perf.Default.Diagnostics()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	got := svc.ScanAnalysis(ctx)
	afterPerf := perf.Default.Diagnostics()

	require.Equal(t, beforePerf.Services.Total, afterPerf.Services.Total, "diagnostic enumeration is not added to the global perf store")
	for operation := range afterPerf.Services.ByOperation {
		require.NotContains(t, operation, repo, "global perf operation names contain no project paths")
	}
	require.Equal(t, "filesystem_directory_entries_and_readdir_time", got.Method)
	require.LessOrEqual(t, got.Entries, scanAnalysisEntryLimit)
	require.LessOrEqual(t, len(got.Directories), scanAnalysisDirResults)
	require.Equal(t, "completed", got.Comparison.Status)
	require.Equal(t, 61, got.Comparison.Entries, "ignored/secret.md is omitted; Markdown pathspecs are counted")
	require.NotContains(t, got.Comparison.Reason, repo)
	require.Contains(t, got.Comparison.Reason, "core.fsmonitor=false")
	require.Contains(t, got.Comparison.Reason, "not comparable")
	require.Contains(t, got.Reason, "Complete means this filtered scope completed")
	large, ok := findScanDirectory(got.Directories, "large")
	require.True(t, ok)
	require.Len(t, large.Examples, scanAnalysisExamples)
	for _, example := range large.Examples {
		require.True(t, strings.HasPrefix(example, "large/"))
		require.True(t, strings.HasSuffix(example, ".md"))
		require.NotContains(t, example, repo)
	}
	require.NotEmpty(t, got.Recommendations)
	for _, recommendation := range got.Recommendations {
		require.NotEmpty(t, recommendation.Examples)
		require.Contains(t, recommendation.Reason, "untracked")
		require.Contains(t, strings.ToLower(recommendation.Reason), "tracked files are not shown")
	}
	encoded, err := json.Marshal(got)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), repo, "responses contain no absolute repository paths")
}

func TestScanAnalysisScopesComparisonToServiceRoot(t *testing.T) {
	repo := initRepo(t)
	project := filepath.Join(repo, "project")
	writeFile(t, repo, "root-only.md", "root\n")
	writeFile(t, project, "inside.md", "inside\n")
	writeFile(t, project, "nested/inside-too.md", "nested\n")

	analysis := NewService(project, Options{}).ScanAnalysis(context.Background())
	require.Equal(t, "completed", analysis.Comparison.Status)
	require.Equal(t, 2, analysis.Comparison.Entries)
	rootDir, ok := findScanDirectory(analysis.Directories, ".")
	require.True(t, ok)
	require.Equal(t, []string{"inside.md", "nested/inside-too.md"}, rootDir.Examples)
	nestedDir, ok := findScanDirectory(analysis.Directories, "nested")
	require.True(t, ok)
	require.Equal(t, []string{"nested/inside-too.md"}, nestedDir.Examples)
}

func TestAnchoredIgnorePatternEscapesOnlyVerifiedStars(t *testing.T) {
	pattern, ok := anchoredIgnorePattern("docs/vendor-old/part*.md")
	require.True(t, ok)
	require.Equal(t, "/docs/vendor-old/part\\*.md/", pattern)
	for _, unsafe := range []string{
		"../outside",
		"docs/vendor[old]/part.md",
		"docs/vendor-old/part?.md",
		"docs/group+one",
		"docs/group(one)",
		"docs/group{one}",
		"docs/group|one",
		"docs/group^one",
		"docs/group$one",
		"docs/#$~sentinel",
		"docs/vendor\\old/part.md",
		"docs/vendor-old/part.md ",
		"docs/vendor-old/part\n.md",
		string([]byte{'d', 'o', 'c', 's', '/', 0xff, '/', 'p', '.', 'm', 'd'}),
		"docs/\uFFFD/part.md",
	} {
		_, ok := anchoredIgnorePattern(unsafe)
		require.Falsef(t, ok, "no copyable rule for %q", unsafe)
	}

	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, ".vantageignore"), []byte(pattern+"\n"), 0o644))
	matcher := ignore.NewMatcher(root, true, "")
	require.True(t, matcher.IsIgnored("docs/vendor-old/part*.md", true))
	require.False(t, matcher.IsIgnored("docs/vendor-old/partX.md", true))
	require.False(t, matcher.IsIgnored("docs/vendor-old/parta.md", true))
}

func TestScanRecommendationsWithholdsRegexOperatorsAndRetainsEvidence(t *testing.T) {
	for _, path := range []string{
		"docs/group+one",
		"docs/group(one)",
		"docs/group)one",
		"docs/group{one}",
		"docs/group}one",
		"docs/group|one",
		"docs/group^one",
		"docs/group$one",
		"docs/#$~sentinel",
	} {
		t.Run(path, func(t *testing.T) {
			examples := []string{path + "/example.md"}
			recommendations := scanRecommendations([]ScanAnalysisDirectory{{
				Path: path, ElapsedMs: 5, Entries: 50, Examples: examples,
			}}, true)
			if path == "docs/group+one" {
				if pattern, ok := anchoredIgnorePattern(path); ok {
					root := t.TempDir()
					require.NoError(t, os.WriteFile(filepath.Join(root, ".vantageignore"), []byte(pattern+"\n"), 0o644))
					matcher := ignore.NewMatcher(root, true, "")
					require.True(t, matcher.IsIgnored(path, true), "a suggested rule must match the measured literal directory")
					require.False(t, matcher.IsIgnored("docs/groupone", true), "a suggested rule must not match its neighboring name")
				}
			}
			require.Len(t, recommendations, 1)
			require.Equal(t, path, recommendations[0].Path)
			require.Equal(t, examples, recommendations[0].Examples)
			require.Contains(t, recommendations[0].Reason, "No copyable .vantageignore pattern")
			require.Contains(t, recommendations[0].Reason, "Manually inspect")
			require.NotContains(t, recommendations[0].Reason, "Add `")
		})
	}
}

func TestScanRecommendationIgnoreRuleStaysAnchoredToMeasuredPrefix(t *testing.T) {
	path := "docs/vendor-old"
	examples := []string{path + "/one.md"}
	recommendations := scanRecommendations([]ScanAnalysisDirectory{{
		Path: path, ElapsedMs: 5, Entries: 50, Examples: examples,
	}}, true)
	require.Len(t, recommendations, 1)
	require.Equal(t, examples, recommendations[0].Examples)
	require.Contains(t, recommendations[0].Reason, "Add `/docs/vendor-old/`")

	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, ".vantageignore"), []byte("/docs/vendor-old/\n"), 0o644))
	matcher := ignore.NewMatcher(root, true, "")
	require.True(t, matcher.IsIgnored("docs/vendor-old", true))
	require.True(t, matcher.IsIgnored("docs/vendor-old/child.md", false))
	require.False(t, matcher.IsIgnored("docs/vendor-oldish/child.md", false))
	require.False(t, matcher.IsIgnored("archive/docs/vendor-old/child.md", false))
}

func TestGoGitignoreTreatsPlusAsRegexpOperator(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, ".vantageignore"), []byte("/group+one/\n"), 0o644))
	matcher := ignore.NewMatcher(root, true, "")
	require.False(t, matcher.IsIgnored("group+one", true), "the unescaped plus does not match the literal directory")
	require.True(t, matcher.IsIgnored("groupone", true), "the unescaped plus matches the neighboring name")
}

func TestScanAnalysisUncertainIgnoreSnapshotSkipsWalkAndGitProbe(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake Git shell requires a POSIX process environment")
	}
	repo := initRepo(t)
	require.NoError(t, os.Mkdir(filepath.Join(repo, ".vantageignore"), 0o700))

	svc := NewService(repo, Options{UseIgnoreFiles: true})
	bin := filepath.Join(t.TempDir(), "bin")
	require.NoError(t, os.MkdirAll(bin, 0o755))
	marker := filepath.Join(t.TempDir(), "git-ran")
	require.NoError(t, os.WriteFile(filepath.Join(bin, "git"), []byte("#!/bin/sh\ntouch "+marker+"\n"), 0o755))
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	got := svc.ScanAnalysis(context.Background())
	require.True(t, got.Partial)
	require.Equal(t, "partial", got.Comparison.Status)
	require.Empty(t, got.Directories, "visibility is unknown, so no filesystem sample is safe")
	require.Empty(t, got.Recommendations)
	require.Contains(t, got.Reason, "workspace .vantageignore")
	require.Contains(t, got.Reason, "configured user ignore file")
	require.Contains(t, got.Reason, "shrink")
	require.Contains(t, got.Reason, "retry")
	require.Contains(t, got.Reason, "blocked filesystem system calls")
	require.NotContains(t, got.Reason, repo)
	_, err := os.Stat(marker)
	require.True(t, os.IsNotExist(err), "unknown ignore visibility must skip the Git probe")
}

func TestScanAnalysisLossyUTF8DirectoryNamesRequireManualGuidance(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX filenames may contain invalid UTF-8 bytes")
	}
	repo := initRepo(t)
	lossyNames := []string{string([]byte{0xff}), "\uFFFD"}
	for _, name := range lossyNames {
		invalidDir := filepath.Join(repo, name)
		require.NoError(t, os.Mkdir(invalidDir, 0o755))
		for i := 0; i < 50; i++ {
			path := filepath.Join(invalidDir, fmt.Sprintf("doc-%02d.md", i))
			require.NoError(t, os.WriteFile(path, []byte("# document\n"), 0o644))
		}
	}

	got := NewService(repo, Options{}).ScanAnalysis(context.Background())
	for _, name := range lossyNames {
		var recommendation *ScanAnalysisRecommend
		for i := range got.Recommendations {
			if got.Recommendations[i].Path == name {
				recommendation = &got.Recommendations[i]
				break
			}
		}
		require.NotNilf(t, recommendation, "lossy name %q should still be reported as manual-only", name)
		require.Contains(t, recommendation.Reason, "No copyable .vantageignore pattern")
		require.Contains(t, recommendation.Reason, "Manually inspect")
		require.NotContains(t, recommendation.Reason, "Add `")
	}
}

func TestScanAnalysisHonorsSymlinkRepositoryIgnoreExcludeAndDepthBoundaries(t *testing.T) {
	repo := initRepo(t)
	outside := t.TempDir()
	writeFile(t, outside, "escaped/secret.md", "outside\n")
	writeFile(t, repo, ".vantageignore", "private/\n")
	writeFile(t, repo, "private/hidden.md", "ignored by vantage\n")
	writeFile(t, repo, "excluded/skip.md", "excluded\n")
	writeFile(t, repo, "nested/deep.md", "depth\n")
	writeFile(t, repo, "nested/second/deeper.md", "depth two\n")
	childRepo := filepath.Join(repo, "nested-repo")
	require.NoError(t, os.MkdirAll(childRepo, 0o755))
	runGit(t, childRepo, "init", "-q")
	writeFile(t, childRepo, "child.md", "child\n")
	link := filepath.Join(repo, "linked")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	worktree := filepath.Join(repo, "linked-worktree")
	require.NoError(t, os.MkdirAll(worktree, 0o755))
	writeFile(t, worktree, "escaped.md", "linked worktree\n")
	require.NoError(t, os.WriteFile(filepath.Join(worktree, ".git"), []byte("gitdir: ../.git/worktrees/linked\n"), 0o644))
	svc := NewService(repo, Options{ExcludeDirs: []string{"excluded"}, UseIgnoreFiles: true, StopAtRepos: true})
	got := svc.ScanAnalysis(context.Background())
	for _, directory := range got.Directories {
		require.NotContains(t, directory.Path, "private")
		require.NotContains(t, directory.Path, "excluded")
		require.NotContains(t, directory.Path, "nested-repo")
		require.NotContains(t, directory.Path, "linked")
		require.NotContains(t, directory.Path, "linked-worktree")
	}
	require.NotContains(t, got.Reason, outside)
}

func TestScanAnalysisAlwaysExcludesVantageStateWhenIgnoreFilesAreDisabled(t *testing.T) {
	repo := initRepo(t)
	writeFile(t, repo, ".VANTAGE/state/private.md", "private\n")
	writeFile(t, repo, "visible.md", "visible\n")
	got := NewService(repo, Options{UseIgnoreFiles: false, ExcludeDirs: []string{}}).ScanAnalysis(context.Background())
	for _, directory := range got.Directories {
		require.NotContains(t, strings.ToLower(directory.Path), ".vantage")
		for _, example := range directory.Examples {
			require.NotContains(t, strings.ToLower(example), ".vantage")
		}
	}
	require.Empty(t, got.Recommendations)
	require.Equal(t, 1, got.Comparison.Entries, "the state path is not included in Git comparison counts")
}

func TestScanAnalysisHonorsWalkMaxDepthForDirectoryResultsAndExamples(t *testing.T) {
	repo := initRepo(t)
	writeFile(t, repo, "first/one.md", "one\n")
	writeFile(t, repo, "first/second/two.md", "two\n")
	depth := 1
	got := NewService(repo, Options{WalkMaxDepth: &depth}).ScanAnalysis(context.Background())
	first, ok := findScanDirectory(got.Directories, "first")
	require.True(t, ok)
	require.Equal(t, []string{"first/one.md"}, first.Examples)
	for _, directory := range got.Directories {
		require.NotContains(t, directory.Path, "second")
	}
}

func TestScanAnalysisCapsDirectoryQueue(t *testing.T) {
	root := t.TempDir()
	for i := 0; i <= scanAnalysisDirectoryCap; i++ {
		name := fmt.Sprintf("directory-%04d", i)
		require.NoError(t, os.Mkdir(filepath.Join(root, name), 0o755))
	}
	got := NewService(root, Options{}).ScanAnalysis(context.Background())
	require.True(t, got.Partial)
	require.Contains(t, got.Reason, "directory limit")
	require.LessOrEqual(t, len(got.Directories), scanAnalysisDirResults)
}

func TestScanAnalysisMalformedComparisonIsPartial(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake Git shell requires a POSIX process environment")
	}
	for _, tc := range []struct {
		name   string
		script string
	}{
		{
			name:   "unterminated path",
			script: "printf 'prefix.md\\000unterminated.md'\n",
		},
		{
			name:   "oversized path",
			script: "printf 'prefix.md\\000'; printf '%070000d.md\\000' 0\n",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := initRepo(t)
			writeFile(t, repo, "prefix.md", "# prefix\n")
			bin := filepath.Join(t.TempDir(), "bin")
			require.NoError(t, os.MkdirAll(bin, 0o755))
			require.NoError(t, os.WriteFile(filepath.Join(bin, "git"), []byte("#!/bin/sh\n"+tc.script), 0o755))
			t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

			got := NewService(repo, Options{}).ScanAnalysis(context.Background())
			require.Equal(t, "partial", got.Comparison.Status)
			require.Contains(t, got.Comparison.Reason, "comparison output")
			require.Equal(t, 1, got.Comparison.Entries, "the valid prefix remains measurable")
			root, ok := findScanDirectory(got.Directories, ".")
			require.True(t, ok)
			require.Equal(t, []string{"prefix.md"}, root.Examples, "the valid prefix sample remains visible")
		})
	}
}

func TestScanAnalysisComparisonCapsTotalOutput(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake Git shell requires a POSIX process environment")
	}
	repo := initRepo(t)
	writeFile(t, repo, "prefix.md", "# prefix\n")
	bin := filepath.Join(t.TempDir(), "bin")
	require.NoError(t, os.MkdirAll(bin, 0o755))
	paddingRecords := scanCompareOutputLimit/2049 + 10
	fakeGit := fmt.Sprintf("#!/bin/sh\nprintf 'prefix.md\\000'\ni=0\nwhile [ \"$i\" -lt %d ]; do\n  printf '%%2048s\\000' x\n  i=$((i + 1))\ndone\n", paddingRecords)
	require.NoError(t, os.WriteFile(filepath.Join(bin, "git"), []byte(fakeGit), 0o755))
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	got := NewService(repo, Options{}).ScanAnalysis(context.Background())
	require.Equal(t, "partial", got.Comparison.Status)
	require.Contains(t, got.Comparison.Reason, "output limit")
	require.Equal(t, 1, got.Comparison.Entries, "the valid prefix remains measurable")
	root, ok := findScanDirectory(got.Directories, ".")
	require.True(t, ok)
	require.Equal(t, []string{"prefix.md"}, root.Examples, "the valid prefix sample remains visible")
}

func TestScanAnalysisComparisonCancelsWhenHelperKeepsStdoutOpen(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake Git shell requires a POSIX process environment")
	}
	repo := initRepo(t)
	svc := NewService(repo, Options{})
	bin := filepath.Join(t.TempDir(), "bin")
	require.NoError(t, os.MkdirAll(bin, 0o755))
	pidFile := filepath.Join(t.TempDir(), "helper.pid")
	fakeGit := "#!/bin/sh\nsleep 30 &\necho $! > \"$FAKE_GIT_PID_FILE\"\nwait\n"
	require.NoError(t, os.WriteFile(filepath.Join(bin, "git"), []byte(fakeGit), 0o755))
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("FAKE_GIT_PID_FILE", pidFile)

	var helperPID int
	t.Cleanup(func() {
		if helperPID != 0 {
			process, err := os.FindProcess(helperPID)
			if err == nil {
				_ = process.Kill()
			}
		}
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan ScanAnalysisResult, 1)
	go func() { result <- svc.ScanAnalysis(ctx) }()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(pidFile)
		if err == nil {
			helperPID, err = strconv.Atoi(strings.TrimSpace(string(data)))
			require.NoError(t, err)
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	require.NotZero(t, helperPID, "fake Git started a child holding the stdout pipe")
	cancel()
	select {
	case got := <-result:
		require.True(t, got.Partial)
		require.Contains(t, got.Comparison.Reason, "cancelled")
		require.Less(t, got.ElapsedMs, int64(1000), "closing the pipe must not wait for the helper to exit")
	case <-time.After(time.Second):
		t.Fatal("diagnostic hung after request cancellation while a child held stdout open")
	}
}

func TestScanAnalysisIsCancellableAndCapsEntries(t *testing.T) {
	repo := initRepo(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got := NewService(repo, Options{}).ScanAnalysis(ctx)
	require.True(t, got.Partial)
	require.Contains(t, got.Reason, "cancelled")
	require.Less(t, got.ElapsedMs, int64(1000))

	deadline, stopDeadline := context.WithTimeout(context.Background(), time.Nanosecond)
	defer stopDeadline()
	timed := NewService(repo, Options{}).ScanAnalysis(deadline)
	require.True(t, timed.Partial)
	require.Contains(t, timed.Reason, "time budget")
	require.Less(t, timed.ElapsedMs, int64(1000))

	large := filepath.Join(t.TempDir(), "large")
	require.NoError(t, os.MkdirAll(large, 0o755))
	for i := 0; i <= scanAnalysisEntryLimit; i++ {
		file := filepath.Join(large, fmt.Sprintf("entry-%05d", i))
		require.NoError(t, os.WriteFile(file, nil, 0o600))
	}
	capped := NewService(large, Options{}).ScanAnalysis(context.Background())
	require.True(t, capped.Partial)
	require.LessOrEqual(t, capped.Entries, scanAnalysisEntryLimit)
	require.Contains(t, capped.Reason, "entry limit")
}

func TestWalkEvidenceKeepsEveryOutstandingFailurePerChildAndSetting(t *testing.T) {
	svc := NewService(t.TempDir(), Options{})
	svc.recordWalk(WalkReport{Dir: "child-a", Gitignored: true, TimedOut: true, Error: "timeout"})
	svc.recordWalk(WalkReport{Dir: "child-b", Gitignored: false, TimedOut: true, Error: "timeout"})
	svc.recordWalk(WalkReport{Dir: "child-a", Gitignored: true})

	remaining, ok := svc.LastWalkReport()
	require.True(t, ok)
	require.Equal(t, "child-b", remaining.Dir)
	require.False(t, remaining.Gitignored)
	require.True(t, remaining.TimedOut)

	svc.recordWalk(WalkReport{Dir: "child-b", Gitignored: false})
	completed, ok := svc.LastWalkReport()
	require.True(t, ok)
	require.Equal(t, "child-b", completed.Dir)
	require.False(t, completed.TimedOut)
}

func TestWalkEvidenceReportsOverflowedFailureRecords(t *testing.T) {
	svc := NewService(t.TempDir(), Options{})
	for i := 0; i <= walkEvidenceFailureLimit; i++ {
		svc.recordWalk(WalkReport{Dir: fmt.Sprintf("child-%03d", i), Gitignored: true, TimedOut: true, Error: "timeout"})
	}
	last, ok := svc.LastWalkReport()
	require.True(t, ok)
	require.Equal(t, 1, last.UnknownFailures)
	require.True(t, last.TimedOut)
}

func TestWalkEvidenceRetainsFailureForDifferentDelegatedChild(t *testing.T) {
	svc := NewService(t.TempDir(), Options{})
	svc.recordWalk(WalkReport{Dir: "child-a", Gitignored: true, TimedOut: true, Error: "timeout"})
	svc.recordWalk(WalkReport{Dir: "child-b", Gitignored: true})
	retained, ok := svc.LastWalkReport()
	require.True(t, ok)
	require.Equal(t, "child-a", retained.Dir)
	require.True(t, retained.TimedOut)

	svc.recordWalk(WalkReport{Dir: "child-a", Gitignored: true})
	cleared, ok := svc.LastWalkReport()
	require.True(t, ok)
	require.Equal(t, "child-a", cleared.Dir)
	require.False(t, cleared.TimedOut)
}

func TestLooseProjectRetainsChildWalkFailureEvidence(t *testing.T) {
	ClearRecentFilesCache()
	t.Cleanup(ClearRecentFilesCache)
	root := t.TempDir()
	child := filepath.Join(root, "child")
	require.NoError(t, os.MkdirAll(child, 0o755))
	runGit(t, child, "init", "-q")
	writeFile(t, child, "doc.md", "# child\n")
	var reports []WalkReport
	svc := NewService(root, Options{WalkTimeout: time.Nanosecond, OnWalk: func(report WalkReport) { reports = append(reports, report) }})
	svc.Recents(10, nil, true, true)

	last, ok := svc.LastWalkReport()
	require.True(t, ok)
	require.True(t, last.TimedOut)
	require.Equal(t, "timeout", last.Error)
	require.Equal(t, "child", last.Dir)
	require.Equal(t, []WalkReport{{Dir: "child", Gitignored: true, TimedOut: true}}, reports)
}

func TestWalkEvidenceCapturesCommandSettingsAndPreservesTimeoutForOtherWalkKind(t *testing.T) {
	ClearRecentFilesCache()
	t.Cleanup(ClearRecentFilesCache)
	repo := initRepo(t)
	writeFile(t, repo, "doc.md", "# doc\n")
	depth := 3
	var reports []WalkReport
	svc := NewService(repo, Options{WalkTimeout: time.Nanosecond, WalkMaxDepth: &depth, UseIgnoreFiles: true, ExcludeDirs: []string{"vendor"}, OnWalk: func(report WalkReport) { reports = append(reports, report) }})

	svc.Recents(10, nil, true, false)
	first, ok := svc.LastWalkReport()
	require.True(t, ok)
	require.True(t, first.TimedOut)
	require.Equal(t, "timeout", first.Error)
	require.Contains(t, first.Command, "git --no-optional-locks ls-files --others")
	require.Equal(t, time.Nanosecond, first.Timeout)
	require.False(t, first.Gitignored)
	require.True(t, first.UseIgnoreFiles)
	require.Equal(t, 1, first.ExcludeDirCount)
	require.NotNil(t, first.WalkMaxDepth)
	require.Equal(t, 3, *first.WalkMaxDepth)
	require.Equal(t, WalkReport{Gitignored: false, TimedOut: true}, reports[0], "OnWalk exposes only its legacy callback identity fields")
	require.Empty(t, reports[0].Command)
	require.Zero(t, reports[0].Elapsed)
	require.Zero(t, reports[0].Timeout)

	svc.opts.WalkTimeout = 5 * time.Second
	ClearRecentFilesCache()
	svc.Recents(10, nil, true, true)
	retained, ok := svc.LastWalkReport()
	require.True(t, ok)
	require.True(t, retained.TimedOut)
	require.False(t, retained.Gitignored, "an unrelated successful walk does not erase evidence for the outstanding warning")

	ClearRecentFilesCache()
	svc.Recents(10, nil, true, false)
	cleared, ok := svc.LastWalkReport()
	require.True(t, ok)
	require.False(t, cleared.TimedOut, "a successful walk with the same gitignored setting clears its warning evidence")
	require.Empty(t, cleared.Error)
}

func findScanDirectory(directories []ScanAnalysisDirectory, path string) (ScanAnalysisDirectory, bool) {
	for _, directory := range directories {
		if directory.Path == path {
			return directory, true
		}
	}
	return ScanAnalysisDirectory{}, false
}
