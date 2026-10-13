package git

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/mschulkind-oss/vantage/internal/gitenv"
	"github.com/mschulkind-oss/vantage/internal/model"
)

const (
	planningCommitLimit = 50
	planningPairLimit   = 50
	planningBlobLimit   = 64 * 1024
	planningTextLimit   = 2 * 1024 * 1024
	planningPathLimit   = 2 * 1024 * 1024
)

type boundedOutput struct {
	bytes.Buffer
	limit     int
	truncated bool
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	remaining := b.limit - b.Len()
	if remaining > 0 {
		if remaining > len(p) {
			remaining = len(p)
		}
		_, _ = b.Buffer.Write(p[:remaining])
	}
	if remaining < len(p) {
		b.truncated = true
	}
	return len(p), nil
}

func (s *GitService) runBounded(cwd string, timeout time.Duration, limit int, args ...string) ([]byte, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append(append([]string{}, readOnlyArgs...), args...)...)
	cmd.Dir = cwd
	cmd.Env = gitenv.Scrubbed()
	out := &boundedOutput{limit: limit}
	cmd.Stdout = out
	if err := cmd.Run(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return out.Bytes(), out.truncated, ctxErr
		}
		return out.Bytes(), out.truncated, err
	}
	return out.Bytes(), out.truncated, nil
}

func unavailableSnapshots(reason string) model.PlanningSnapshots {
	return model.PlanningSnapshots{
		Status:    "unavailable",
		Reason:    reason,
		Snapshots: []model.PlanningSnapshot{},
	}
}

// PlanningSnapshots returns bounded historical Markdown source pairs. Markdown
// is deliberately interpreted by the shared TypeScript scanner, not GitService.
func (s *GitService) PlanningSnapshots() model.PlanningSnapshots {
	if s.workingDir == "" {
		return unavailableSnapshots("This repository has no local Git history.")
	}

	out, cut, err := s.runBounded(s.workingDir, timeoutDefault, 16*1024,
		"log", "--max-count=51", "--format=%H%x00%ct")
	if err != nil {
		return unavailableSnapshots("Local Git history could not be read.")
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) == 1 && lines[0] == "" {
		return model.PlanningSnapshots{Status: "complete", Snapshots: []model.PlanningSnapshot{}}
	}
	commits := make([]snapshotCommit, 0, planningCommitLimit)
	for _, line := range lines {
		fields := strings.SplitN(line, "\x00", 2)
		if len(fields) != 2 || len(fields[0]) != 40 || !ValidateSHA(fields[0]) {
			return unavailableSnapshots("Git returned an unreadable commit list.")
		}
		seconds, parseErr := strconv.ParseInt(fields[1], 10, 64)
		if parseErr != nil {
			return unavailableSnapshots("Git returned an unreadable commit date.")
		}
		commits = append(commits, snapshotCommit{sha: fields[0], date: time.Unix(seconds, 0).UTC()})
	}
	partial := cut || len(commits) > planningCommitLimit
	reason := ""
	if partial {
		addSnapshotReason(&reason, "The local history exceeded the 50-commit inspection limit.")
	}
	if len(commits) > planningCommitLimit {
		commits = commits[:planningCommitLimit]
	}
	shallow, shallowErr := s.run(s.workingDir, timeoutDefault, "rev-parse", "--is-shallow-repository")
	shallowCommits := map[string]struct{}{}
	boundaryKnown := shallowErr == nil
	if shallowErr != nil {
		partial = true
		addSnapshotReason(&reason, "Git could not establish whether local history is shallow.")
	} else if strings.TrimSpace(string(shallow)) == "true" {
		partial = true
		addSnapshotReason(&reason, "The local repository is shallow; older history may be unavailable.")
		shallowCommits, err = s.readShallowCommits()
		if err != nil {
			boundaryKnown = false
			addSnapshotReason(&reason, "The shallow boundary list was unavailable.")
		}
	}

	result := model.PlanningSnapshots{
		Status:    "complete",
		Snapshots: []model.PlanningSnapshot{},
	}
	textBytes := 0
	consideredPairs := 0
	stop := false
	for _, commit := range commits {
		if stop {
			break
		}
		if !boundaryKnown {
			partial, stop = true, true
			addSnapshotReason(&reason, "Git could not verify whether the first commit is a root or shallow boundary.")
			break
		}
		result.CommitsExamined++
		commitObject, objectCut, objectErr := s.runBounded(s.workingDir, timeoutDefault, 64*1024, "cat-file", "commit", commit.sha)
		if objectErr != nil || objectCut {
			partial, stop = true, true
			addSnapshotReason(&reason, "A commit's parent information was unavailable.")
			break
		}
		parents := rawCommitParents(commitObject)
		root := len(parents) == 0
		_, atShallowBoundary := shallowCommits[commit.sha]
		if !root {
			if len(parents[0]) != 40 || !ValidateSHA(parents[0]) {
				partial, stop = true, true
				addSnapshotReason(&reason, "A commit's first-parent identifier was malformed.")
				break
			}
			if atShallowBoundary {
				partial, stop = true, true
				addSnapshotReason(&reason, "A first parent is unavailable at a shallow boundary.")
				break
			}
			if _, _, parentErr := s.runBounded(s.workingDir, timeoutDefault, 1024,
				"cat-file", "-e", parents[0]+"^{commit}"); parentErr != nil {
				partial, stop = true, true
				addSnapshotReason(&reason, "A first parent is unavailable, including at a shallow boundary.")
				break
			}
		}
		var changed []byte
		var changedCut bool
		if root {
			changed, changedCut, err = s.runBounded(s.workingDir, timeoutDefault, planningPathLimit,
				"diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", "--no-renames", commit.sha)
		} else {
			changed, changedCut, err = s.runBounded(s.workingDir, timeoutDefault, planningPathLimit,
				"diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--no-renames", parents[0], commit.sha)
		}
		if err != nil {
			partial, stop = true, true
			addSnapshotReason(&reason, "Git could not enumerate a commit's changed paths.")
			break
		}
		if changedCut {
			partial = true
			addSnapshotReason(&reason, "A commit's changed-path list exceeded its inspection limit.")
			if end := bytes.LastIndexByte(changed, 0); end >= 0 {
				changed = changed[:end+1]
			} else {
				changed = nil
			}
		}
		paths := strings.Split(string(changed), "\x00")
		filtered := make([]string, 0, len(paths))
		for _, path := range paths {
			if !markdownSnapshotPath(path) {
				continue
			}
			if local, ok := s.snapshotLocalPath(path); ok {
				filtered = append(filtered, local)
			}
		}
		sort.Slice(filtered, func(i, j int) bool { return codeUnitLess(filtered[i], filtered[j]) })
		for _, localPath := range filtered {
			if consideredPairs == planningPairLimit {
				partial = true
				addSnapshotReason(&reason, "The history exceeded the 50 source-pair inspection limit.")
				stop = true
				break
			}
			consideredPairs++
			beforeRev := ""
			if !root {
				beforeRev = parents[0]
			}
			before, beforeExists, beforeErr := s.snapshotBlob(beforeRev, localPath, root)
			after, afterExists, afterErr := s.snapshotBlob(commit.sha, localPath, false)
			if beforeErr != nil || afterErr != nil {
				partial = true
				addSnapshotReason(&reason, "A changed source blob was unavailable or exceeded 64 KiB.")
				continue
			}
			pairBytes := len(before) + len(after)
			if pairBytes+textBytes > planningTextLimit {
				partial = true
				addSnapshotReason(&reason, "The history exceeded the 2 MiB source-text limit.")
				stop = true
				break
			}
			textBytes += pairBytes
			result.Snapshots = append(result.Snapshots, model.PlanningSnapshot{
				Path: localPath, CommitHexsha: commit.sha, CommitDate: commit.date,
				Before: string(before), After: string(after),
				BeforeExists: beforeExists, AfterExists: afterExists,
			})
		}
	}
	if partial {
		result.Status = "partial"
		result.Truncated = true
		result.Reason = reason
	}
	return result
}

func rawCommitParents(commit []byte) []string {
	header := string(commit)
	if end := strings.Index(header, "\n\n"); end >= 0 {
		header = header[:end]
	}
	var parents []string
	for _, line := range strings.Split(header, "\n") {
		if strings.HasPrefix(line, "parent ") {
			parents = append(parents, strings.TrimPrefix(line, "parent "))
		}
	}
	return parents
}

func (s *GitService) readShallowCommits() (map[string]struct{}, error) {
	pathOut, pathCut, err := s.runBounded(s.workingDir, timeoutDefault, 4096, "rev-parse", "--git-path", "shallow")
	if err != nil {
		return nil, err
	}
	if pathCut {
		return nil, errors.New("shallow metadata path exceeded its limit")
	}
	path := strings.TrimSpace(string(pathOut))
	if !filepath.IsAbs(path) {
		path = filepath.Join(s.workingDir, path)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	contents, err := io.ReadAll(io.LimitReader(file, 1024*1024+1))
	if err != nil || len(contents) > 1024*1024 {
		return nil, errors.New("shallow boundary list exceeds 1 MiB")
	}
	result := make(map[string]struct{})
	for _, sha := range strings.Fields(string(contents)) {
		result[sha] = struct{}{}
	}
	return result, nil
}

func addSnapshotReason(reason *string, message string) {
	if *reason == "" {
		*reason = message
		return
	}
	if !strings.Contains(*reason, message) {
		*reason += " " + message
	}
}

func codeUnitLess(a, b string) bool {
	aUnits := utf16.Encode([]rune(a))
	bUnits := utf16.Encode([]rune(b))
	for i := 0; i < len(aUnits) && i < len(bUnits); i++ {
		if aUnits[i] != bUnits[i] {
			return aUnits[i] < bUnits[i]
		}
	}
	return len(aUnits) < len(bUnits)
}

type snapshotCommit struct {
	sha  string
	date time.Time
}

func markdownSnapshotPath(path string) bool {
	if path == "" || strings.HasPrefix(path, "/") || strings.Contains(path, "\\") {
		return false
	}
	for _, part := range strings.Split(path, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return strings.EqualFold(filepath.Ext(path), ".md")
}

func (s *GitService) snapshotLocalPath(gitPath string) (string, bool) {
	repoInTree, err := filepath.Rel(s.workingDir, s.repoPath)
	if err != nil || repoInTree == ".." || strings.HasPrefix(repoInTree, ".."+string(filepath.Separator)) {
		return "", false
	}
	if repoInTree == "." {
		return gitPath, true
	}
	prefix := filepath.ToSlash(repoInTree) + "/"
	if !strings.HasPrefix(gitPath, prefix) {
		return "", false
	}
	return strings.TrimPrefix(gitPath, prefix), true
}

func (s *GitService) snapshotBlob(revision, path string, empty bool) ([]byte, bool, error) {
	if empty {
		return []byte{}, false, nil
	}
	entries, cut, err := s.runBounded(s.workingDir, timeoutDefault, 4096,
		"ls-tree", "-z", revision, "--", ":(literal)"+s.repoRelativePath(path))
	if err != nil || cut {
		return nil, false, errUnavailableBlob
	}
	if len(entries) == 0 {
		return []byte{}, false, nil
	}
	entry := strings.SplitN(strings.TrimSuffix(string(entries), "\x00"), "\t", 2)[0]
	fields := strings.Fields(entry)
	if len(fields) != 3 || fields[1] != "blob" || len(fields[2]) != 40 || !ValidateSHA(fields[2]) {
		return nil, false, errUnavailableBlob
	}
	sizeOut, _, err := s.runBounded(s.workingDir, timeoutDefault, 64,
		"cat-file", "-s", fields[2])
	if err != nil {
		return nil, false, errUnavailableBlob
	}
	size, err := strconv.Atoi(strings.TrimSpace(string(sizeOut)))
	if err != nil || size > planningBlobLimit {
		return nil, false, errUnavailableBlob
	}
	blob, cut, err := s.runBounded(s.workingDir, timeoutDefault, planningBlobLimit,
		"cat-file", "blob", fields[2])
	if err != nil || cut || !utf8.Valid(blob) {
		return nil, false, errUnavailableBlob
	}
	return blob, true, nil
}

var errUnavailableBlob = snapshotError("unavailable source blob")

type snapshotError string

func (e snapshotError) Error() string { return string(e) }
