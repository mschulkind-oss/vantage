package ignore

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// writeIgnore writes ignore-file content under root and returns the matcher
// rooted there with no user layer.
func newWorkspaceMatcher(t *testing.T, content string, enabled bool) (string, *Matcher) {
	t.Helper()
	root := t.TempDir()
	if content != "" {
		require.NoError(t, os.WriteFile(filepath.Join(root, workspaceIgnoreName), []byte(content), 0o644))
	}
	return root, NewMatcher(root, enabled, "")
}

func TestIsIgnored(t *testing.T) {
	const content = "" +
		".yolo/\n" +
		"node_modules\n" +
		"*.log\n" +
		"secret\n" +
		"!secret/keep\n" +
		"# a comment\n" +
		"\n"

	tests := []struct {
		name  string
		rel   string
		isDir bool
		want  bool
	}{
		{"dir-only pattern matches a directory entry", ".yolo", true, true},
		{"dir-only pattern does not match a file of the same name", ".yolo", false, false},
		{"plain name matches a directory", "node_modules", true, true},
		{"plain name matches a nested path", "node_modules/pkg/index.js", false, true},
		{"glob matches an extension", "logs/app.log", false, true},
		{"unmatched path is not ignored", "src/main.go", false, false},
		{"negation un-ignores a re-included path", "secret/keep", false, false},
		{"sibling under ignored dir stays ignored", "secret/other", false, true},
		{"leading ./ is normalized", "./node_modules", true, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, m := newWorkspaceMatcher(t, content, true)
			require.Equal(t, tc.want, m.IsIgnored(tc.rel, tc.isDir))
		})
	}
}

func TestVantageAlwaysIgnored(t *testing.T) {
	// .vantage is vantage-owned machine traffic (the review inbox): hidden
	// even with ignore files disabled, and no negation can resurface it.
	_, disabled := newWorkspaceMatcher(t, "", false)
	require.True(t, disabled.IsIgnored(".vantage", true))
	require.True(t, disabled.IsIgnored(".vantage/inbox", true))
	require.True(t, disabled.IsIgnored(".vantage/inbox/x.jsonl", false))

	_, negated := newWorkspaceMatcher(t, "!.vantage\n!.vantage/**\n", true)
	require.True(t, negated.IsIgnored(".vantage", true))
	require.True(t, negated.IsIgnored(".vantage/inbox/x.jsonl", false))
	require.Equal(t, "builtin:.vantage", negated.Explain(".vantage/inbox/x.jsonl"))

	require.True(t, IsAlwaysIgnored("./.vantage/inbox"), "leading ./ normalizes")
	require.False(t, IsAlwaysIgnored(".vantageignore"), "prefix must not swallow siblings")
}

func TestDisabledMatcherIgnoresNothing(t *testing.T) {
	_, m := newWorkspaceMatcher(t, ".yolo/\nnode_modules\n*.log\n", false)
	require.False(t, m.IsIgnored(".yolo", true))
	require.False(t, m.IsIgnored("node_modules", true))
	require.False(t, m.IsIgnored("app.log", false))
	require.Equal(t, "", m.Explain("node_modules"))
}

func TestUserLayerThenWorkspaceOverride(t *testing.T) {
	dir := t.TempDir()
	userPath := filepath.Join(dir, "user-ignore")
	require.NoError(t, os.WriteFile(userPath, []byte("build/\n"), 0o644))

	root := t.TempDir()
	require.NoError(t, os.WriteFile(
		filepath.Join(root, workspaceIgnoreName),
		[]byte("!build/keep\n"), // workspace re-includes one path the user file ignored
		0o644,
	))

	m := NewMatcher(root, true, userPath)
	// The user file ignores everything under build/...
	require.True(t, m.IsIgnored("build/out.o", false))
	// ...but the workspace negation (applied last) wins for the re-included path.
	require.False(t, m.IsIgnored("build/keep", false))
}

func TestExplainReportsSourceAndPattern(t *testing.T) {
	dir := t.TempDir()
	userPath := filepath.Join(dir, "user-ignore")
	require.NoError(t, os.WriteFile(userPath, []byte(".yolo/\n"), 0o644))

	root := t.TempDir()
	require.NoError(t, os.WriteFile(
		filepath.Join(root, workspaceIgnoreName),
		[]byte("dist\n!dist/keep\n"),
		0o644,
	))

	m := NewMatcher(root, true, userPath)

	require.Equal(t, "user:.yolo/", m.ExplainDir(".yolo"))
	require.Equal(t, "workspace:dist", m.Explain("dist/bundle.js"))
	// Negation clears the explanation for the re-included path.
	require.Equal(t, "", m.Explain("dist/keep"))
	// Not ignored ⇒ empty explanation.
	require.Equal(t, "", m.Explain("src/main.go"))
}

func TestMissingIgnoreFiles(t *testing.T) {
	root := t.TempDir()
	m := NewMatcher(root, true, filepath.Join(root, "does-not-exist"))
	require.False(t, m.IsIgnored("anything", false))
	require.Equal(t, "", m.Explain("anything"))
}

func TestReloadOnMtimeChange(t *testing.T) {
	root := t.TempDir()
	wsPath := filepath.Join(root, workspaceIgnoreName)
	require.NoError(t, os.WriteFile(wsPath, []byte("first\n"), 0o644))

	m := NewMatcher(root, true, "")
	require.True(t, m.IsIgnored("first", false))
	require.False(t, m.IsIgnored("second", false))

	// Rewrite with a different pattern and a newer mtime, then force the
	// throttle window open so the next call re-stats.
	require.NoError(t, os.WriteFile(wsPath, []byte("second\n"), 0o644))
	future := time.Now().Add(time.Hour)
	require.NoError(t, os.Chtimes(wsPath, future, future))

	m.mu.Lock()
	m.lastCheck = time.Now().Add(-2 * reloadInterval)
	m.mu.Unlock()

	require.False(t, m.IsIgnored("first", false))
	require.True(t, m.IsIgnored("second", false))
}

func TestReloadDropsRemovedFile(t *testing.T) {
	root := t.TempDir()
	wsPath := filepath.Join(root, workspaceIgnoreName)
	require.NoError(t, os.WriteFile(wsPath, []byte("gone\n"), 0o644))

	m := NewMatcher(root, true, "")
	require.True(t, m.IsIgnored("gone", false))

	require.NoError(t, os.Remove(wsPath))
	m.mu.Lock()
	m.lastCheck = time.Now().Add(-2 * reloadInterval)
	m.mu.Unlock()

	require.False(t, m.IsIgnored("gone", false))
}

func TestConcurrentIsIgnoredRaceClean(t *testing.T) {
	root := t.TempDir()
	wsPath := filepath.Join(root, workspaceIgnoreName)
	require.NoError(t, os.WriteFile(wsPath, []byte(".yolo/\nnode_modules\n*.log\n"), 0o644))

	m := NewMatcher(root, true, "")
	// Force every call past the throttle window so reload races are exercised.
	m.mu.Lock()
	m.lastCheck = time.Time{}
	m.mu.Unlock()

	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				m.IsIgnored(".yolo", true)
				m.IsIgnored("node_modules/x", false)
				m.IsIgnored("app.log", false)
				_ = m.Explain("node_modules/x")
			}
		}()
	}
	wg.Wait()
}

func TestGetMatcherCaching(t *testing.T) {
	t.Cleanup(ClearCache)
	root := t.TempDir()

	a := GetMatcher(root, true)
	b := GetMatcher(root, true)
	require.Same(t, a, b, "same (root, enabled) key returns the cached matcher")

	c := GetMatcher(root, false)
	require.NotSame(t, a, c, "differing enabled flag is a distinct cache entry")
	require.False(t, c.IsIgnored("anything", true))

	ClearCache()
	d := GetMatcher(root, true)
	require.NotSame(t, a, d, "ClearCache drops cached matchers")
}

func TestGetMatcherUsesDefaultUserPath(t *testing.T) {
	// Point the user-ignore resolver at a temp file so the cached matcher
	// honors a user layer without touching the real home directory.
	dir := t.TempDir()
	userPath := filepath.Join(dir, "user-ignore")
	require.NoError(t, os.WriteFile(userPath, []byte("from-user\n"), 0o644))

	orig := defaultUserFn
	defaultUserFn = func() string { return userPath }
	t.Cleanup(func() { defaultUserFn = orig; ClearCache() })
	ClearCache()

	m := GetMatcher(t.TempDir(), true)
	require.True(t, m.IsIgnored("from-user", false))
}
