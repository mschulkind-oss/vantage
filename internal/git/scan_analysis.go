package git

import (
	"bufio"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/mschulkind-oss/vantage/internal/gitenv"
	"github.com/mschulkind-oss/vantage/internal/ignore"
)

// Diagnostic limits are fixed so callers cannot choose a filesystem budget.
// The deadline is cooperative: blocked kernel filesystem calls cannot be
// forcibly interrupted. The queue keeps at most one directory descriptor open.
const (
	scanAnalysisBudget       = 5 * time.Second
	scanAnalysisEntryLimit   = 10000
	scanAnalysisDirectoryCap = 1024
	scanAnalysisBatchSize    = 128
	scanAnalysisDirResults   = 20
	scanAnalysisExamples     = 3
	scanCompareEntryLimit    = 10000
	scanComparePathByteLimit = 64 * 1024
	scanCompareOutputLimit   = 16 * 1024 * 1024
)

// ScanAnalysisResult is a bounded filesystem-enumeration approximation. Its
// timings describe this diagnostic run, not the earlier Git subprocess.
type ScanAnalysisResult struct {
	Method          string                  `json:"method"`
	Partial         bool                    `json:"partial"`
	Reason          string                  `json:"reason"`
	ElapsedMs       int64                   `json:"elapsedMs"`
	Entries         int                     `json:"entries"`
	Directories     []ScanAnalysisDirectory `json:"directories"`
	Comparison      ScanAnalysisComparison  `json:"comparison"`
	Recommendations []ScanAnalysisRecommend `json:"recommendations"`
}

type ScanAnalysisDirectory struct {
	Path      string   `json:"path"`
	ElapsedMs int64    `json:"elapsedMs"`
	Entries   int      `json:"entries"`
	Examples  []string `json:"examples"`
}

type ScanAnalysisComparison struct {
	Status    string `json:"status"`
	ElapsedMs int64  `json:"elapsedMs"`
	Entries   int    `json:"entries"`
	Reason    string `json:"reason"`
}

type ScanAnalysisRecommend struct {
	Path     string   `json:"path"`
	Reason   string   `json:"reason"`
	Examples []string `json:"examples"`
}

type measuredDirectory struct {
	path    string
	elapsed time.Duration
	entries int
}

// ScanAnalysis enumerates a bounded portion of the service root. The walk is
// deliberately separate from recents: it neither changes settings nor reuses
// the Git subprocess elapsed time as filesystem attribution.
func (s *GitService) ScanAnalysis(ctx context.Context) ScanAnalysisResult {
	started := time.Now()
	result := ScanAnalysisResult{
		Method:          "filesystem_directory_entries_and_readdir_time",
		Directories:     []ScanAnalysisDirectory{},
		Recommendations: []ScanAnalysisRecommend{},
		Comparison:      ScanAnalysisComparison{Status: "unknown", Reason: "The project is not a Git work tree; initialize or select a Git repository to compare ignored files."},
	}
	if ctx == nil {
		ctx = context.Background()
	}
	walkCtx, cancel := context.WithTimeout(ctx, scanAnalysisBudget)
	defer cancel()
	matcher := s.matcher()
	measured := make([]measuredDirectory, 0, 128)
	visitedDirs := 0
	partialReason := ""
	setPartial := func(reason string) {
		result.Partial = true
		if partialReason == "" {
			partialReason = reason
		}
	}
	setContextPartial := func() {
		if errors.Is(walkCtx.Err(), context.Canceled) {
			setPartial("The diagnostic was cancelled; reopen scan analysis to run it again.")
		} else {
			setPartial("The cooperative time budget expired; exclude large generated directories and retry. A blocked filesystem system call may not return until the operating system releases it.")
		}
	}
	if walkCtx.Err() != nil {
		setContextPartial()
	}
	var root *os.Root
	if s.repoPath != "" && walkCtx.Err() == nil {
		openedRoot, err := os.OpenRoot(s.repoPath)
		if err != nil {
			setPartial("The repository root could not be opened; select a readable project directory and retry.")
		} else if walkCtx.Err() != nil {
			setContextPartial()
			_ = openedRoot.Close()
		} else {
			root = openedRoot
			defer root.Close()
		}
	}

	type directoryTask struct{ path string }
	queue := make([]directoryTask, 0, scanAnalysisDirectoryCap)
	if root != nil {
		queue = append(queue, directoryTask{path: "."})
	}
	stop := false
	for len(queue) > 0 && !stop {
		if err := walkCtx.Err(); err != nil {
			setContextPartial()
			break
		}
		if visitedDirs >= scanAnalysisDirectoryCap {
			setPartial("The diagnostic reached its directory limit; add large generated directories to exclude_dirs and retry.")
			break
		}
		task := queue[0]
		queue = queue[1:]
		visitedDirs++
		if task.path != "." {
			info, err := root.Lstat(filepath.FromSlash(task.path))
			if err != nil {
				setPartial("A directory changed or could not be inspected during enumeration; retry scan analysis.")
				continue
			}
			if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
				continue
			}
		}
		f, err := root.Open(filepath.FromSlash(task.path))
		if err != nil {
			setPartial("Some directories could not be read; check repository permissions and retry.")
			continue
		}
		record := measuredDirectory{path: task.path}
		children := make([]directoryTask, 0)
		for {
			if err := walkCtx.Err(); err != nil {
				setContextPartial()
				stop = true
				break
			}
			readdirStarted := time.Now()
			batch, readErr := f.ReadDir(scanAnalysisBatchSize)
			record.elapsed += time.Since(readdirStarted)
			if walkCtx.Err() != nil {
				setContextPartial()
				stop = true
				break
			}
			readFailed := readErr != nil && !errors.Is(readErr, io.EOF)
			if readFailed {
				setPartial("Some directories could not be read; check repository permissions and retry.")
			}
			for _, entry := range batch {
				if walkCtx.Err() != nil {
					setContextPartial()
					stop = true
					break
				}
				if result.Entries >= scanAnalysisEntryLimit {
					setPartial("The diagnostic reached its entry limit; add large generated directories to exclude_dirs and retry.")
					stop = true
					break
				}
				name := entry.Name()
				childRel := name
				if task.path != "." {
					childRel = task.path + "/" + name
				}
				if !safeRepoRelative(childRel) || ignore.IsAlwaysIgnored(childRel) {
					continue
				}
				result.Entries++
				record.entries++
				if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
					continue
				}
				info, statErr := root.Lstat(filepath.FromSlash(childRel))
				if walkCtx.Err() != nil {
					setContextPartial()
					stop = true
					break
				}
				if statErr != nil {
					setPartial("A directory changed or could not be inspected during enumeration; retry scan analysis.")
					continue
				}
				if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
					continue
				}
				linkedWorktree := scanLinkedWorktree(root, childRel)
				if walkCtx.Err() != nil {
					setContextPartial()
					stop = true
					break
				}
				if name == ".git" || s.isExcludedDir(name) || linkedWorktree {
					continue
				}
				if s.opts.StopAtRepos && scanRepoBoundary(root, childRel) {
					continue
				}
				if matcher != nil && matcher.IsIgnored(childRel, true) && walkCtx.Err() == nil {
					continue
				}
				if walkCtx.Err() != nil {
					setContextPartial()
					stop = true
					break
				}
				if s.opts.WalkMaxDepth != nil && strings.Count(childRel, "/") >= *s.opts.WalkMaxDepth {
					continue
				}
				if visitedDirs+len(queue)+len(children) >= scanAnalysisDirectoryCap {
					setPartial("The diagnostic reached its directory limit; add large generated directories to exclude_dirs and retry.")
					continue
				}
				children = append(children, directoryTask{path: childRel})
			}
			if walkCtx.Err() != nil {
				setContextPartial()
				stop = true
			}
			if stop || readFailed || errors.Is(readErr, io.EOF) || len(batch) == 0 {
				break
			}
		}
		_ = f.Close()
		measured = append(measured, record)
		queue = append(queue, children...)
	}
	if s.repoPath == "" {
		setPartial("The repository root is unavailable; select a readable project directory and retry.")
	} else if root == nil && partialReason == "" {
		setPartial("The repository root could not be opened; select a readable project directory and retry.")
	}

	result.Directories = rankedDirectoryResults(measured)
	showHidden := true
	if previous, ok := s.LastWalkReport(); ok {
		showHidden = previous.ShowHidden
	}
	comparison, samples := s.compareGitignored(walkCtx, result.Directories, root, matcher, showHidden)
	result.Comparison = comparison
	if comparison.Status == "partial" || comparison.Status == "unavailable" {
		result.Partial = true
		if partialReason == "" {
			partialReason = comparison.Reason
		}
	}
	for i := range result.Directories {
		if examples := samples[result.Directories[i].Path]; len(examples) > 0 {
			result.Directories[i].Examples = examples
		} else {
			result.Directories[i].Examples = []string{}
		}
	}
	result.Recommendations = scanRecommendations(result.Directories, s.opts.UseIgnoreFiles)
	result.ElapsedMs = time.Since(started).Milliseconds()
	result.Reason = "Measured only the configured diagnostic scope: .vantage internal state, symlinks, .git, linked worktrees, configured excludes, configured Vantage-ignore matches, and paths beyond walk_max_depth are not enumerated. Nested repositories are boundaries when stop_at_repos is enabled. Complete means this filtered scope completed, not that the raw tree was fully traversed. The 5-second deadline is cooperative; blocked filesystem system calls cannot be forcibly interrupted."
	if partialReason != "" {
		result.Reason += " " + partialReason
	}
	return result
}

func safeRepoRelative(path string) bool {
	if path == "" || filepath.IsAbs(path) || strings.ContainsRune(path, '\x00') {
		return false
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(path)))
	return clean == path && clean != ".." && !strings.HasPrefix(clean, "../")
}

func rankedDirectoryResults(measured []measuredDirectory) []ScanAnalysisDirectory {
	sort.Slice(measured, func(i, j int) bool {
		if measured[i].elapsed == measured[j].elapsed {
			if measured[i].entries == measured[j].entries {
				return measured[i].path < measured[j].path
			}
			return measured[i].entries > measured[j].entries
		}
		return measured[i].elapsed > measured[j].elapsed
	})
	limit := len(measured)
	if limit > scanAnalysisDirResults {
		limit = scanAnalysisDirResults
	}
	out := make([]ScanAnalysisDirectory, 0, limit)
	for _, d := range measured[:limit] {
		out = append(out, ScanAnalysisDirectory{Path: d.path, ElapsedMs: d.elapsed.Milliseconds(), Entries: d.entries, Examples: []string{}})
	}
	return out
}

func scanRecommendations(dirs []ScanAnalysisDirectory, useIgnoreFiles bool) []ScanAnalysisRecommend {
	out := make([]ScanAnalysisRecommend, 0, 3)
	for _, d := range dirs {
		if len(out) == 3 {
			break
		}
		if (d.Entries < 50 && d.ElapsedMs < 5) || len(d.Examples) == 0 || d.Path == "." {
			continue
		}
		pattern, ok := anchoredIgnorePattern(d.Path)
		reason := ""
		if ok {
			reason = "Add `" + pattern + "` to the repository's .vantageignore to exclude only this subtree from recent-file discovery. Examples are untracked Markdown paths that pass Git's standard ignore rules; tracked files are not shown, but .vantageignore also filters tracked recent documents."
			if !useIgnoreFiles {
				reason += " This pattern takes effect only after enabling use_ignore_files."
			}
		} else {
			reason = "No copyable .vantageignore pattern is offered because this directory name contains syntax the matcher cannot safely escape. Manually inspect the name and neighboring documents, or rename the directory, before writing a rule."
		}
		out = append(out, ScanAnalysisRecommend{
			Path:     d.Path,
			Reason:   reason,
			Examples: append([]string{}, d.Examples...),
		})
	}
	return out
}

func anchoredIgnorePattern(path string) (string, bool) {
	if !safeRepoRelative(path) {
		return "", false
	}
	for _, segment := range strings.Split(path, "/") {
		if strings.HasSuffix(segment, " ") {
			return "", false
		}
	}
	for _, r := range path {
		if unicode.IsControl(r) || strings.ContainsRune("?[]\\", r) {
			return "", false
		}
	}
	return "/" + strings.ReplaceAll(path, "*", `\*`) + "/", true
}

func (s *GitService) compareGitignored(parent context.Context, directories []ScanAnalysisDirectory, root *os.Root, matcher *ignore.Matcher, showHidden bool) (ScanAnalysisComparison, map[string][]string) {
	started := time.Now()
	out := ScanAnalysisComparison{Status: "unknown", Reason: "The project is not a Git work tree; initialize or select a Git repository to compare ignored files."}
	if s.workingDir == "" {
		return out, map[string][]string{}
	}
	if parent == nil {
		parent = context.Background()
	}
	if parent.Err() != nil {
		out.Status = "partial"
		if errors.Is(parent.Err(), context.Canceled) {
			out.Reason = "The excluding-gitignored comparison was cancelled; reopen scan analysis to run it again."
		} else {
			out.Reason = "The overall cooperative time budget expired before comparison; exclude large generated directories and retry."
		}
		return out, map[string][]string{}
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	args := []string{"--no-optional-locks", "-c", "core.fsmonitor=false", "ls-files", "--others", "-z", "--exclude-standard"}
	args = append(args, s.walkExcludeArgs()...)
	args = append(args, "--exclude=.vantage", "--", "*.md")
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = s.repoPath
	cmd.Env = gitenv.Scrubbed()
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		out.Status, out.Reason = "unavailable", "Git could not provide comparison output; check Git availability and repository access, then retry."
		return out, map[string][]string{}
	}
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		out.Status, out.Reason = "unavailable", "Git could not start the excluding-gitignored comparison; check Git availability and repository access, then retry."
		return out, map[string][]string{}
	}
	closed := make(chan struct{})
	stopClose := context.AfterFunc(ctx, func() {
		_ = stdout.Close()
		close(closed)
	})
	defer func() {
		if !stopClose() {
			<-closed
		}
	}()
	limitedOutput := &io.LimitedReader{R: stdout, N: scanCompareOutputLimit + 1}
	reader := bufio.NewReader(limitedOutput)
	count := 0
	readCount := 0
	samples := map[string][]string{}
	dirs := map[string]struct{}{}
	for _, d := range directories {
		dirs[d.Path] = struct{}{}
	}
	stopPartial := func(reason string) (ScanAnalysisComparison, map[string][]string) {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		out.Status = "partial"
		out.Reason = reason
		out.ElapsedMs = time.Since(started).Milliseconds()
		out.Entries = count
		return out, samples
	}
	token := make([]byte, 0, scanComparePathByteLimit)
	capturedBytes := int64(0)
	for {
		fragment, readErr := reader.ReadSlice(0)
		capturedBytes += int64(len(fragment))
		if capturedBytes > scanCompareOutputLimit {
			return stopPartial("The excluding-gitignored comparison reached its 16 MiB output limit; exclude large generated Markdown directories and retry.")
		}
		if len(token)+len(fragment) > scanComparePathByteLimit {
			return stopPartial("The excluding-gitignored comparison output contained a path over 64 KiB; exclude directories containing unusually long Markdown paths and retry.")
		}
		token = append(token, fragment...)
		if errors.Is(readErr, bufio.ErrBufferFull) {
			continue
		}
		if errors.Is(readErr, io.EOF) {
			if len(token) != 0 {
				return stopPartial("Git returned malformed comparison output with an unterminated path; check Git output and repository access, then retry.")
			}
			break
		}
		if readErr != nil {
			if errors.Is(ctx.Err(), context.Canceled) {
				return stopPartial("The excluding-gitignored comparison was cancelled; reopen scan analysis to run it again.")
			}
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				return stopPartial("The excluding-gitignored comparison reached its time budget; exclude large generated directories and retry.")
			}
			return stopPartial("The excluding-gitignored comparison was interrupted; check repository access and retry.")
		}
		readCount++
		if readCount > scanCompareEntryLimit {
			return stopPartial("The excluding-gitignored comparison reached its entry limit; exclude generated Markdown directories and retry.")
		}
		if ctx.Err() != nil {
			if errors.Is(ctx.Err(), context.Canceled) {
				return stopPartial("The excluding-gitignored comparison was cancelled; reopen scan analysis to run it again.")
			}
			return stopPartial("The excluding-gitignored comparison reached its time budget; exclude large generated directories and retry.")
		}
		gitPath := string(token[:len(token)-1])
		token = token[:0]
		rel := filepath.ToSlash(filepath.Clean(filepath.FromSlash(gitPath)))
		if !safeRepoRelative(rel) || ignore.IsAlwaysIgnored(rel) || !strings.EqualFold(filepath.Ext(rel), ".md") {
			continue
		}
		count++
		if !s.visibleUntrackedMarkdown(root, matcher, rel, showHidden) {
			continue
		}
		parentDir := filepath.ToSlash(filepath.Dir(filepath.FromSlash(rel)))
		if parentDir == "" {
			parentDir = "."
		}
		for dir := parentDir; ; dir = filepath.ToSlash(filepath.Dir(filepath.FromSlash(dir))) {
			if _, exists := dirs[dir]; exists && len(samples[dir]) < scanAnalysisExamples {
				samples[dir] = append(samples[dir], rel)
			}
			if dir == "." || dir == "" {
				break
			}
		}
	}
	waitErr := cmd.Wait()
	out.ElapsedMs = time.Since(started).Milliseconds()
	out.Entries = count
	if ctx.Err() != nil {
		out.Status = "partial"
		out.Reason = "The excluding-gitignored comparison reached its time budget or was cancelled; rerun scan analysis."
	} else if waitErr != nil {
		out.Status = "unavailable"
		out.Reason = "Git could not complete the excluding-gitignored comparison; check repository access and retry."
	} else {
		out.Status = "completed"
		out.Reason = "Git ls-files --others --exclude-standard runs with core.fsmonitor=false to avoid invoking a repository-configured filesystem-monitor helper. It reports raw untracked Markdown pathspec matches from this project root after Git and configured Vantage ignore rules; these file counts are not comparable to the filtered filesystem directory-entry count or its elapsed time. Examples additionally apply hidden, symlink, repository-boundary, and depth visibility filters."
	}
	return out, samples
}

func scanLinkedWorktree(root *os.Root, rel string) bool {
	gitPath := filepath.Join(filepath.FromSlash(rel), ".git")
	info, err := root.Lstat(gitPath)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || info.IsDir() || !info.Mode().IsRegular() {
		return false
	}
	f, err := root.Open(gitPath)
	if err != nil {
		return false
	}
	defer f.Close()
	buf := make([]byte, 64)
	n, _ := f.Read(buf)
	return strings.HasPrefix(strings.TrimSpace(string(buf[:n])), "gitdir:")
}

func scanRepoBoundary(root *os.Root, rel string) bool {
	gitPath := filepath.Join(filepath.FromSlash(rel), ".git")
	info, err := root.Lstat(gitPath)
	if err != nil || info.Mode()&os.ModeSymlink != 0 {
		return false
	}
	if info.IsDir() {
		return true
	}
	return scanLinkedWorktree(root, rel)
}

func (s *GitService) visibleUntrackedMarkdown(root *os.Root, matcher *ignore.Matcher, rel string, showHidden bool) bool {
	if root == nil || ignore.IsAlwaysIgnored(rel) || !strings.EqualFold(filepath.Ext(rel), ".md") || s.shouldSkip(rel, matcher) {
		return false
	}
	if !showHidden && hasHiddenParent(rel) {
		return false
	}
	if s.opts.WalkMaxDepth != nil && strings.Count(rel, "/") > *s.opts.WalkMaxDepth {
		return false
	}
	info, err := root.Lstat(filepath.FromSlash(rel))
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return false
	}
	for dir := filepath.ToSlash(filepath.Dir(filepath.FromSlash(rel))); dir != "." && dir != ""; dir = filepath.ToSlash(filepath.Dir(filepath.FromSlash(dir))) {
		info, err := root.Lstat(filepath.FromSlash(dir))
		if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return false
		}
		if scanLinkedWorktree(root, dir) || (s.opts.StopAtRepos && scanRepoBoundary(root, dir)) {
			return false
		}
	}
	return true
}
