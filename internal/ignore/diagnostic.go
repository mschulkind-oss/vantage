package ignore

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	gitignore "github.com/sabhiram/go-gitignore"
)

const (
	diagnosticIgnoreByteLimit = 1 << 20
	diagnosticIgnoreLineLimit = 4096
	diagnosticIgnoreLineBytes = 4 << 10
)

// DiagnosticMatcher is an immutable, one-run snapshot of the ignore rules.
// Unlike Matcher, it never stats or reloads its source files during matching.
type DiagnosticMatcher struct {
	combined *gitignore.GitIgnore
}

// NewDiagnosticMatcher loads only the same user and workspace sources used by
// Matcher, with hard input bounds suitable for a time-limited diagnostic. A
// missing source is empty; any unreadable, non-regular, oversized, or cancelled
// source returns an error so callers do not guess at path visibility.
func NewDiagnosticMatcher(ctx context.Context, root string, enabled bool, userIgnorePath string) (*DiagnosticMatcher, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	matcher := &DiagnosticMatcher{}
	if !enabled {
		return matcher, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	budget := diagnosticIgnoreBudget{}
	user, err := readDiagnosticIgnoreLines(ctx, userIgnorePath, &budget)
	if err != nil {
		return nil, fmt.Errorf("configured user ignore file: %w", err)
	}
	workspace, err := readDiagnosticIgnoreLines(ctx, filepath.Join(filepath.Clean(root), workspaceIgnoreName), &budget)
	if err != nil {
		return nil, fmt.Errorf("workspace .vantageignore: %w", err)
	}
	userCompiled, err := compileDiagnosticLines(ctx, user)
	if err != nil {
		return nil, fmt.Errorf("configured user ignore file: %w", err)
	}
	workspaceCompiled, err := compileDiagnosticLines(ctx, workspace)
	if err != nil {
		return nil, fmt.Errorf("workspace .vantageignore: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(userCompiled.raw)+len(workspaceCompiled.raw))
	lines = append(lines, userCompiled.raw...)
	lines = append(lines, workspaceCompiled.raw...)
	matcher.combined = gitignore.CompileIgnoreLines(lines...)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return matcher, nil
}

// IsIgnored applies the same path normalization, directory handling, and
// built-in always-ignored rule as Matcher.IsIgnored, against this fixed snapshot.
func (m *DiagnosticMatcher) IsIgnored(rel string, isDir bool) bool {
	if IsAlwaysIgnored(rel) {
		return true
	}
	return matchPath(m.combined, rel, isDir)
}

type diagnosticIgnoreBudget struct {
	bytes int
	lines int
}

func readDiagnosticIgnoreLines(ctx context.Context, path string, budget *diagnosticIgnoreBudget) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil
	}
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, errors.New("ignore source could not be inspected")
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("ignore source is not a regular file")
	}
	remaining := diagnosticIgnoreByteLimit - budget.bytes
	if info.Size() > int64(remaining) {
		return nil, errors.New("ignore sources exceed the 1 MiB combined diagnostic limit")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, errors.New("ignore source could not be read")
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil || !openedInfo.Mode().IsRegular() {
		return nil, errors.New("ignore source is not a readable regular file")
	}
	if openedInfo.Size() > int64(remaining) {
		return nil, errors.New("ignore sources exceed the 1 MiB combined diagnostic limit")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(file, int64(remaining)+1))
	if err != nil {
		return nil, errors.New("ignore source could not be read")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(data) > remaining {
		return nil, errors.New("ignore sources exceed the 1 MiB combined diagnostic limit")
	}
	if err := validateDiagnosticIgnoreLines(ctx, data, budget); err != nil {
		return nil, err
	}
	budget.bytes += len(data)
	return strings.Split(string(data), "\n"), nil
}

func validateDiagnosticIgnoreLines(ctx context.Context, data []byte, budget *diagnosticIgnoreBudget) error {
	lineCount := 0
	lineBytes := 0
	for _, b := range data {
		if b == '\n' {
			if lineBytes > diagnosticIgnoreLineBytes {
				return errors.New("ignore source contains a line over the 4 KiB diagnostic limit")
			}
			lineCount++
			lineBytes = 0
			if err := ctx.Err(); err != nil {
				return err
			}
			continue
		}
		lineBytes++
		if lineBytes > diagnosticIgnoreLineBytes {
			return errors.New("ignore source contains a line over the 4 KiB diagnostic limit")
		}
	}
	if len(data) > 0 && data[len(data)-1] != '\n' {
		lineCount++
	}
	if budget.lines+lineCount > diagnosticIgnoreLineLimit {
		return errors.New("ignore sources exceed the 4096-line combined diagnostic limit")
	}
	budget.lines += lineCount
	return ctx.Err()
}

func compileDiagnosticLines(ctx context.Context, raw []string) (*compiledLines, error) {
	compiled := &compiledLines{raw: append([]string(nil), raw...)}
	for _, line := range raw {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if pattern, ok := compilePattern(line); ok {
			compiled.patterns = append(compiled.patterns, pattern)
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return compiled, nil
}
