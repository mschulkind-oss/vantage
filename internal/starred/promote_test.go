package starred

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// repoWith builds a repository containing the given repo-relative files.
func repoWith(t *testing.T, files ...string) string {
	t.Helper()
	root := t.TempDir()
	for _, f := range files {
		p := filepath.Join(root, filepath.FromSlash(f))
		require.NoError(t, os.MkdirAll(filepath.Dir(p), 0o755))
		require.NoError(t, os.WriteFile(p, []byte("# doc\n"), 0o644))
	}
	return root
}

// A literal line must resolve with NO filesystem listing. The motivating case is
// one roadmap, and the viewer refetches the whole list on mount, on reconnect and
// on every change push — so a walk per literal would be a walk per star click,
// times every repository a daemon serves.
func TestPromoteLiteralNeverListsCandidates(t *testing.T) {
	root := repoWith(t, "roadmap.md")
	rows, rejected := Promote(PromoteRequest{
		Root:   root,
		Lines:  []string{"roadmap.md"},
		Source: SourceRepo,
		Candidates: func() []string {
			t.Fatal("a literal promote line must not trigger a file listing")
			return nil
		},
	})

	require.Empty(t, rejected)
	require.Len(t, rows, 1)
	require.Equal(t, "roadmap.md", rows[0].Path)
	require.Equal(t, SourceRepo, rows[0].Source)
	require.True(t, rows[0].StarredAt.IsZero(), "a promoted row was never starred")
}

// A literal is not checked for existence, deliberately: the store's whole
// contract is that a listed target may be gone, and a config naming a document
// that has not been written yet is a normal state rather than an error.
func TestPromoteLiteralNeedNotExist(t *testing.T) {
	rows, rejected := Promote(PromoteRequest{
		Root:   t.TempDir(),
		Lines:  []string{"roadmap.md"},
		Source: SourceRepo,
	})
	require.Empty(t, rejected)
	require.Len(t, rows, 1)
}

func TestPromoteExpandsPatterns(t *testing.T) {
	root := repoWith(t, "docs/a.md", "docs/b.md", "docs/sub/c.md", "other.md")
	candidates := []string{"docs/a.md", "docs/b.md", "docs/sub/c.md", "other.md"}
	calls := 0

	rows, rejected := Promote(PromoteRequest{
		Root:   root,
		Lines:  []string{"docs/*.md"},
		Source: SourceRepo,
		Candidates: func() []string {
			calls++
			return candidates
		},
	})

	require.Empty(t, rejected)
	require.Equal(t, []string{"docs/a.md", "docs/b.md"}, PromotedPaths(rows))
	require.Equal(t, 1, calls, "the candidate list is built at most once per request")
}

// Several patterns in one request still list once.
func TestPromoteListsOnceForManyPatterns(t *testing.T) {
	root := repoWith(t, "docs/a.md", "guides/b.md")
	calls := 0
	rows, _ := Promote(PromoteRequest{
		Root:   root,
		Lines:  []string{"docs/*.md", "guides/*.md"},
		Source: SourceRepo,
		Candidates: func() []string {
			calls++
			return []string{"docs/a.md", "guides/b.md"}
		},
	})
	require.Equal(t, 1, calls)
	require.Len(t, rows, 2)
}

func TestPromotePatternWithoutCandidatesYieldsNothing(t *testing.T) {
	rows, rejected := Promote(PromoteRequest{
		Root:   t.TempDir(),
		Lines:  []string{"docs/*.md"},
		Source: SourceRepo,
	})
	require.Empty(t, rows)
	require.Empty(t, rejected)
}

// A trailing slash is how a config declares a directory, and it is the one shape
// ValidateEntry's cleaned-form rule refuses — so the intent has to move into
// IsDir rather than being rejected.
func TestPromoteAcceptsADeclaredDirectory(t *testing.T) {
	root := repoWith(t, "docs/a.md")
	rows, rejected := Promote(PromoteRequest{
		Root:   root,
		Lines:  []string{"docs/"},
		Source: SourceRepo,
	})

	require.Empty(t, rejected)
	require.Len(t, rows, 1)
	require.Equal(t, "docs", rows[0].Path)
	require.True(t, rows[0].IsDir)
}

// Promotion is held to a stricter standard than a bookmark: config-driven paths
// have no round-trip to protect, so containment is proved as well.
func TestPromoteRefusesWhatEscapesTheRepository(t *testing.T) {
	root := repoWith(t, "docs/a.md")
	outside := filepath.Join(t.TempDir(), "secret.md")
	require.NoError(t, os.WriteFile(outside, []byte("secret\n"), 0o600))
	require.NoError(t, os.Symlink(outside, filepath.Join(root, "leak.md")))

	for _, line := range []string{
		"../escape.md",
		"/etc/passwd",
		".git/config",
		".vantage/state.json",
		"leak.md", // a symlink pointing out of the tree
		"",        // skipped rather than refused
	} {
		rows, rejected := Promote(PromoteRequest{
			Root:   root,
			Lines:  []string{line},
			Source: SourceRepo,
		})
		require.Empty(t, rows, "line %q must promote nothing", line)
		if line != "" {
			require.Len(t, rejected, 1, "line %q must be reported, not dropped silently", line)
		}
	}
}

// One bad line does not cost the reader the other documents their project named.
func TestPromoteKeepsGoingPastABadLine(t *testing.T) {
	root := repoWith(t, "roadmap.md")
	rows, rejected := Promote(PromoteRequest{
		Root:   root,
		Lines:  []string{"../escape.md", "roadmap.md"},
		Source: SourceRepo,
	})
	require.Len(t, rejected, 1)
	require.Equal(t, []string{"roadmap.md"}, PromotedPaths(rows))
}

// Bounded AFTER expansion, which is the only place the bound means anything: three
// lines can name a thousand documents and the sidebar has no scroller of its own.
func TestPromoteBoundsTheExpandedSet(t *testing.T) {
	root := t.TempDir()
	candidates := make([]string, 0, MaxPromoted*2)
	for i := 0; i < MaxPromoted*2; i++ {
		candidates = append(candidates, filepath.ToSlash(filepath.Join("docs", string(rune('a'+i%26))+"-"+itoa(i)+".md")))
	}

	rows, rejected := Promote(PromoteRequest{
		Root:       root,
		Lines:      []string{"docs/*.md"},
		Source:     SourceRepo,
		Candidates: func() []string { return candidates },
	})

	require.Len(t, rows, MaxPromoted)
	require.Len(t, rejected, 1)
	require.Contains(t, rejected[0], "exceeds the limit")
}

func TestPromoteDedupesWithinOneSource(t *testing.T) {
	root := repoWith(t, "roadmap.md")
	rows, _ := Promote(PromoteRequest{
		Root:       root,
		Lines:      []string{"roadmap.md", "roadmap.md", "*.md"},
		Source:     SourceRepo,
		Candidates: func() []string { return []string{"roadmap.md"} },
	})
	require.Len(t, rows, 1, "one document, one row, however many lines name it")
}

func TestPromoteSkipsBlanksAndComments(t *testing.T) {
	root := repoWith(t, "roadmap.md")
	rows, rejected := Promote(PromoteRequest{
		Root:   root,
		Lines:  []string{"", "   ", "# a note", "roadmap.md"},
		Source: SourceRepo,
	})
	require.Empty(t, rejected)
	require.Len(t, rows, 1)
}

// The reader's own bookmark beats any promotion; between the two promotions the
// user's own config wins. Two promotion LISTS union — precedence is only ever
// decided on a collision.
func TestMergeListedResolvesCollisions(t *testing.T) {
	user := []Listed{{Entry: Entry{Path: "a.md"}, Source: SourceUser}}
	userCfg := []Listed{
		{Entry: Entry{Path: "a.md"}, Source: SourceUserConfig},
		{Entry: Entry{Path: "b.md"}, Source: SourceUserConfig},
	}
	repo := []Listed{
		{Entry: Entry{Path: "a.md"}, Source: SourceRepo},
		{Entry: Entry{Path: "b.md"}, Source: SourceRepo},
		{Entry: Entry{Path: "c.md"}, Source: SourceRepo},
	}

	got := MergeListed(user, userCfg, repo)

	require.Equal(t, []string{"a.md", "b.md", "c.md"}, PromotedPaths(got),
		"the two promotion lists union rather than one replacing the other")
	bySource := map[string]Source{}
	for _, r := range got {
		bySource[r.Path] = r.Source
	}
	require.Equal(t, SourceUser, bySource["a.md"], "the reader's own row wins")
	require.Equal(t, SourceUserConfig, bySource["b.md"], "their config beats the repository's")
	require.Equal(t, SourceRepo, bySource["c.md"])
}

// Two rows with one (repo, path) is a React duplicate key and a doubled row in
// the sidebar, so deduplication is correctness.
func TestMergeListedKeysOnRepoAndPath(t *testing.T) {
	got := MergeListed(
		[]Listed{{Entry: Entry{Repo: "a", Path: "x.md"}, Source: SourceUser}},
		[]Listed{{Entry: Entry{Repo: "b", Path: "x.md"}, Source: SourceRepo}},
	)
	require.Len(t, got, 2, "the same path in two repositories is two rows")
}

func TestMergeListedOrdersLikeTheStore(t *testing.T) {
	got := MergeListed([]Listed{
		{Entry: Entry{Repo: "b", Path: "a.md"}, Source: SourceRepo},
		{Entry: Entry{Repo: "a", Path: "z.md"}, Source: SourceUser},
		{Entry: Entry{Repo: "a", Path: "a.md"}, Source: SourceRepo},
	})
	require.Equal(t, []string{"a/a.md", "a/z.md", "b/a.md"}, PromotedPaths(got),
		"promoted rows sort in with the rest rather than into a block of their own")
}

// itoa avoids pulling strconv in for one call in one test.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

// A list applied to EVERY repository has to be existence-filtered, or one line
// carries a phantom row into every project that lacks the document. The
// repository's own list is not filtered, because there a named document is an
// assertion about this project and may not be written yet.
func TestPromoteRequireExistsOnlyDropsMissingLiterals(t *testing.T) {
	root := repoWith(t, "roadmap.md", "docs/a.md")

	withFilter, rejected := Promote(PromoteRequest{
		Root:          root,
		Lines:         []string{"roadmap.md", "ROADMAP.md", "docs/missing.md"},
		Source:        SourceUserConfig,
		RequireExists: true,
	})
	require.Equal(t, []string{"roadmap.md"}, PromotedPaths(withFilter))
	require.Empty(t, rejected,
		"a document this project simply does not have is not a config error")

	withoutFilter, _ := Promote(PromoteRequest{
		Root:   root,
		Lines:  []string{"roadmap.md", "docs/missing.md"},
		Source: SourceRepo,
	})
	require.Len(t, withoutFilter, 2,
		"a repository's own list still promotes a document it has not written yet")
}

// The filter must not turn into a walk, and must not reach outside the tree.
func TestPromoteRequireExistsStatsInsideTheRepositoryOnly(t *testing.T) {
	root := repoWith(t, "docs/a.md")
	outside := filepath.Join(t.TempDir(), "secret.md")
	require.NoError(t, os.WriteFile(outside, []byte("secret\n"), 0o600))
	require.NoError(t, os.Symlink(outside, filepath.Join(root, "leak.md")))

	rows, _ := Promote(PromoteRequest{
		Root:          root,
		Lines:         []string{"leak.md", "docs/a.md"},
		Source:        SourceUserConfig,
		RequireExists: true,
		Candidates: func() []string {
			t.Fatal("the existence filter must stat, not walk")
			return nil
		},
	})
	require.Equal(t, []string{"docs/a.md"}, PromotedPaths(rows),
		"a symlink out of the tree exists but is not promotable")
}

// A directory the reader always wants starred still works through the filter.
func TestPromoteRequireExistsAcceptsADirectory(t *testing.T) {
	root := repoWith(t, "docs/a.md")
	rows, _ := Promote(PromoteRequest{
		Root:          root,
		Lines:         []string{"docs/", "nope/"},
		Source:        SourceUserConfig,
		RequireExists: true,
	})
	require.Len(t, rows, 1)
	require.Equal(t, "docs", rows[0].Path)
	require.True(t, rows[0].IsDir)
}

// The macOS failure this exists to prevent, reproducible on any host.
//
// On a case-insensitive filesystem `os.Stat` answers yes for BOTH spellings, so
// the two-spelling list the documentation recommends found one file twice and
// listed it twice under two names. The dedupe key folds where the platform does,
// which makes the answer identical everywhere: one row, the first spelling.
func TestPromoteFoldsSpellingsWhereTheFilesystemDoes(t *testing.T) {
	// Both spellings "exist", which is what a case-insensitive filesystem
	// reports — so the difference here is the folding, not the stat.
	rows, _ := promote("darwin", PromoteRequest{
		Root:   t.TempDir(),
		Lines:  []string{"roadmap.md", "ROADMAP.md"},
		Source: SourceUserConfig,
	})
	require.Equal(t, []string{"roadmap.md"}, PromotedPaths(rows),
		"two spellings of one file must not be two rows on a folding platform")

	// Linux: genuinely two different files, so genuinely two rows.
	rows, _ = promote("linux", PromoteRequest{
		Root:   t.TempDir(),
		Lines:  []string{"roadmap.md", "ROADMAP.md"},
		Source: SourceUserConfig,
	})
	require.Len(t, rows, 2, "on a case-sensitive filesystem they are two documents")
}

// A pattern and a literal naming one file, spelled differently.
func TestPromoteFoldsAcrossLiteralAndPattern(t *testing.T) {
	rows, _ := promote("darwin", PromoteRequest{
		Root:       t.TempDir(),
		Lines:      []string{"ROADMAP.md", "*.md"},
		Source:     SourceRepo,
		Candidates: func() []string { return []string{"roadmap.md"} },
	})
	require.Len(t, rows, 1)
	require.Equal(t, "ROADMAP.md", rows[0].Path, "the first spelling written wins")
}

// The same question for the merge: a stored bookmark and a promotion that name
// one file with different spellings are one row, and it is the reader's.
func TestMergeListedFoldsSpellingsWhereTheFilesystemDoes(t *testing.T) {
	own := []Listed{{Entry: Entry{Path: "roadmap.md"}, Source: SourceUser}}
	promoted := []Listed{{Entry: Entry{Path: "ROADMAP.md"}, Source: SourceRepo}}

	got := mergeListed("darwin", own, promoted)
	require.Len(t, got, 1, "one document must not appear twice under two names")
	require.Equal(t, SourceUser, got[0].Source, "and the row is the reader's own")

	require.Len(t, mergeListed("linux", own, promoted), 2)
}
