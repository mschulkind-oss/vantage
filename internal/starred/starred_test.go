package starred

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestValidateEntry(t *testing.T) {
	long := strings.Repeat("a", MaxPathLen+1)

	cases := []struct {
		name  string
		entry Entry
		ok    bool
	}{
		{"a markdown file", Entry{Path: "docs/a.md"}, true},
		{"a directory", Entry{Path: "docs"}, true},
		{"a nested path", Entry{Path: "a/b/c/d.md"}, true},
		{"a unicode name", Entry{Path: "docs/diseño ñ.md"}, true},
		{"a dotfile that is not .git or .vantage", Entry{Path: ".github/workflows/ci.yml"}, true},
		{"a named repo", Entry{Repo: "alpha", Path: "a.md"}, true},

		{"empty", Entry{Path: ""}, false},
		{"the root", Entry{Path: "."}, false},
		{"absolute", Entry{Path: "/etc/passwd"}, false},
		{"a windows drive", Entry{Path: `C:/secrets`}, false},
		{"a backslash path", Entry{Path: `docs\a.md`}, false},
		{"traversal", Entry{Path: "a/../../b"}, false},
		{"a bare parent", Entry{Path: ".."}, false},
		{"an uncleaned prefix", Entry{Path: "./a.md"}, false},
		{"a trailing slash", Entry{Path: "docs/"}, false},
		{"a doubled slash", Entry{Path: "a//b"}, false},
		{"the .vantage dir", Entry{Path: ".vantage/inbox"}, false},
		{"a nested .vantage", Entry{Path: "sub/.vantage/inbox"}, false},
		{"the .git dir", Entry{Path: "a/.git/config"}, false},
		{"a NUL byte", Entry{Path: "a\x00b"}, false},
		{"an over-long path", Entry{Path: long}, false},
		{"an over-long repo", Entry{Repo: strings.Repeat("r", MaxRepoLen+1), Path: "a.md"}, false},
		{"a repo with a separator", Entry{Repo: "a/b", Path: "a.md"}, false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateEntry(c.entry)
			if c.ok {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			require.ErrorIs(t, err, ErrInvalid, "every rejection must unwrap to ErrInvalid")
		})
	}
}

// Sorting is by (repo, path) rather than by time on purpose: re-starring must
// not make an entry jump, and two browsers must agree after one broadcast.
func TestSortEntriesOrdersByRepoThenPath(t *testing.T) {
	now := time.Now()
	es := []Entry{
		{Repo: "beta", Path: "a.md", StarredAt: now},
		{Repo: "", Path: "z.md", StarredAt: now.Add(-time.Hour)},
		{Repo: "alpha", Path: "b.md", StarredAt: now},
		{Repo: "", Path: "a.md", StarredAt: now},
		{Repo: "alpha", Path: "a.md", StarredAt: now},
	}
	SortEntries(es)

	got := make([][2]string, 0, len(es))
	for _, e := range es {
		got = append(got, [2]string{e.Repo, e.Path})
	}
	require.Equal(t, [][2]string{
		{"", "a.md"},
		{"", "z.md"},
		{"alpha", "a.md"},
		{"alpha", "b.md"},
		{"beta", "a.md"},
	}, got)
}
