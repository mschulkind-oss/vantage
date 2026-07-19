package model

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// keySet decodes JSON into a generic map and returns its top-level keys.
func keySet(t *testing.T, v any) map[string]bool {
	t.Helper()
	b, err := json.Marshal(v)
	require.NoError(t, err)
	var m map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(b, &m))
	keys := make(map[string]bool, len(m))
	for k := range m {
		keys[k] = true
	}
	return keys
}

// rawField marshals v and returns the verbatim JSON text of a named top-level
// field, so tests can assert exact encodings like null / [] / {} / a literal.
func rawField(t *testing.T, v any, field string) string {
	t.Helper()
	b, err := json.Marshal(v)
	require.NoError(t, err)
	var m map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(b, &m))
	raw, ok := m[field]
	require.Truef(t, ok, "field %q present", field)
	return string(raw)
}

func TestGitCommitRoundTrip(t *testing.T) {
	in := GitCommit{
		Hexsha:      "abc1234def5678",
		AuthorName:  "Ada",
		AuthorEmail: "ada@example.com",
		Date:        time.Date(2026, 5, 30, 12, 0, 0, 0, time.UTC),
		Message:     "initial",
	}
	b, err := json.Marshal(in)
	require.NoError(t, err)
	var out GitCommit
	require.NoError(t, json.Unmarshal(b, &out))
	require.Equal(t, in, out)

	require.Equal(t, map[string]bool{
		"hexsha": true, "author_name": true, "author_email": true,
		"date": true, "message": true,
	}, keySet(t, in))
	// Dates emit RFC3339, parseable by the frontend's new Date().
	require.Equal(t, `"2026-05-30T12:00:00Z"`, rawField(t, in, "date"))
}

func TestFileStatusNullFields(t *testing.T) {
	// A clean file: both fields are null, never omitted.
	clean := FileStatus{}
	require.Equal(t, "null", rawField(t, clean, "last_commit"))
	require.Equal(t, "null", rawField(t, clean, "git_status"))

	status := "modified"
	dirty := FileStatus{
		LastCommit: &GitCommit{Hexsha: "deadbeef"},
		GitStatus:  &status,
	}
	require.Equal(t, `"modified"`, rawField(t, dirty, "git_status"))
}

func TestFileNodeHasMarkdownNonOmitempty(t *testing.T) {
	// A no-markdown directory must send has_markdown:false, not omit it.
	dir := FileNode{Name: "docs", Path: "docs", IsDir: true, HasMarkdown: false}
	require.Equal(t, "false", rawField(t, dir, "has_markdown"))

	keys := keySet(t, dir)
	require.True(t, keys["has_markdown"])
	require.True(t, keys["name"])
	require.True(t, keys["path"])
	require.True(t, keys["is_dir"])
	// Optional fields are omitted when zero.
	require.False(t, keys["git_status"])
	require.False(t, keys["children"])
	require.False(t, keys["last_commit"])
	require.False(t, keys["is_symlink"])
	require.False(t, keys["symlink_target"])
}

func TestFileNodeRecursiveChildren(t *testing.T) {
	root := FileNode{
		Name:        "root",
		Path:        "",
		IsDir:       true,
		HasMarkdown: true,
		GitStatus:   "contains_changes",
		Children: []*FileNode{
			{Name: "a.md", Path: "a.md", IsDir: false, HasMarkdown: true, GitStatus: "modified"},
		},
	}
	b, err := json.Marshal(root)
	require.NoError(t, err)
	var out FileNode
	require.NoError(t, json.Unmarshal(b, &out))
	require.Len(t, out.Children, 1)
	require.Equal(t, "a.md", out.Children[0].Path)
	require.Equal(t, `"contains_changes"`, rawField(t, root, "git_status"))
}

func TestDiffLineLineNumbersAlwaysPresent(t *testing.T) {
	n := 7
	// Added line: old side absent (null), new side present.
	add := DiffLine{Type: "add", Content: "+x", NewLineNo: &n}
	require.Equal(t, "null", rawField(t, add, "old_line_no"))
	require.Equal(t, "7", rawField(t, add, "new_line_no"))

	keys := keySet(t, add)
	require.True(t, keys["old_line_no"], "old_line_no always present (no omitempty)")
	require.True(t, keys["new_line_no"], "new_line_no always present (no omitempty)")

	// Round-trip preserves the *int distinction.
	var out DiffLine
	bts, err := json.Marshal(add)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(bts, &out))
	require.Nil(t, out.OldLineNo)
	require.NotNil(t, out.NewLineNo)
	require.Equal(t, 7, *out.NewLineNo)
}

func TestFileDiffWorkingSentinel(t *testing.T) {
	d := FileDiff{
		CommitHexsha:  "working",
		CommitMessage: "Uncommitted changes (modified)",
		CommitAuthor:  "Working directory",
		CommitDate:    time.Date(2026, 5, 30, 0, 0, 0, 0, time.UTC),
		FilePath:      "a.md",
		Hunks:         []DiffHunk{},
		RawDiff:       "",
	}
	require.Equal(t, `"working"`, rawField(t, d, "commit_hexsha"))
	require.Equal(t, map[string]bool{
		"commit_hexsha": true, "commit_message": true, "commit_author": true,
		"commit_date": true, "file_path": true, "hunks": true, "raw_diff": true,
	}, keySet(t, d))
}

func TestRecentFileKeys(t *testing.T) {
	r := RecentFile{
		Path:       "notes.md",
		Date:       time.Date(2026, 5, 30, 0, 0, 0, 0, time.UTC),
		AuthorName: "Ada",
		Message:    "edit",
		Hexsha:     "abc",
	}
	keys := keySet(t, r)
	for _, k := range []string{"path", "date", "author_name", "message", "hexsha"} {
		require.Truef(t, keys[k], "key %q present", k)
	}
	// untracked is omitempty and false here.
	require.False(t, keys["untracked"])

	untracked := RecentFile{Path: "x.md", Untracked: true}
	require.Equal(t, "true", rawField(t, untracked, "untracked"))
}

func TestRepoInfoLastActivityExplicitNull(t *testing.T) {
	// last_activity must emit null (not be omitted) when absent.
	r := RepoInfo{Name: ""}
	require.Equal(t, "null", rawField(t, r, "last_activity"))
	require.Equal(t, map[string]bool{"name": true, "last_activity": true}, keySet(t, r))

	ts := time.Date(2026, 5, 30, 9, 0, 0, 0, time.UTC)
	withTime := RepoInfo{Name: "repo", LastActivity: &ts}
	require.Equal(t, `"2026-05-30T09:00:00Z"`, rawField(t, withTime, "last_activity"))
}

func TestRepoFileKeys(t *testing.T) {
	f := RepoFile{Repo: "repo", Path: "a/b.md"}
	require.Equal(t, map[string]bool{"repo": true, "path": true}, keySet(t, f))
}

func TestRepoInfoResponseKeys(t *testing.T) {
	r := RepoInfoResponse{Name: "repo", RootPath: "/tmp/repo"}
	require.Equal(t, map[string]bool{"name": true, "root_path": true}, keySet(t, r))
}

func TestVersionInfoKeys(t *testing.T) {
	v := VersionInfo{CommitHash: "abc1234", IsDirty: true}
	require.Equal(t, map[string]bool{"commit_hash": true, "is_dirty": true}, keySet(t, v))
}

func TestFileContentEncoding(t *testing.T) {
	c := FileContent{Path: "a.md", Content: "hi", Encoding: "binary"}
	require.Equal(t, `"binary"`, rawField(t, c, "encoding"))
	require.Equal(t, map[string]bool{"path": true, "content": true, "encoding": true}, keySet(t, c))
}

func TestReviewTimestampsAreEpochFloats(t *testing.T) {
	// Review timestamps are JSON numbers, NOT RFC3339 strings.
	c := ReviewComment{ID: "1", CreatedAt: 1717000000.5}
	require.Equal(t, "1717000000.5", rawField(t, c, "created_at"))

	s := ReviewSnapshot{ID: "s", Timestamp: 1717000000}
	require.Equal(t, "1717000000", rawField(t, s, "timestamp"))

	r := CommentReaction{Actor: "agent", Kind: "addressed", Timestamp: 1717000001}
	require.Equal(t, "1717000001", rawField(t, r, "timestamp"))
}

func TestCommentReactionKeys(t *testing.T) {
	r := CommentReaction{
		Actor:      "agent",
		Kind:       "addressed",
		Summary:    "fixed",
		BeforeText: "old",
		AfterText:  "new",
		Timestamp:  1717000000,
	}
	require.Equal(t, map[string]bool{
		"actor": true, "kind": true, "summary": true,
		"before_text": true, "after_text": true, "timestamp": true,
	}, keySet(t, r))
}

func TestCommentAnchorKeys(t *testing.T) {
	a := CommentAnchor{SourceLine: 3, BlockTextHash: "d58b3fa7", SelectionOffset: 0, SelectionLength: 0}
	require.Equal(t, map[string]bool{
		"source_line": true, "block_text_hash": true,
		"selection_offset": true, "selection_length": true,
	}, keySet(t, a))
}

// TestEmptyReviewDataMarshalsWithBrackets is the load-bearing policy test:
// an empty ReviewData built via the constructor must serialize slices/maps as
// []/{} rather than null, so the frontend always gets iterable values. The
// deprecated snapshots field is omitted entirely (the frontend tolerates its
// absence).
func TestEmptyReviewDataMarshalsWithBrackets(t *testing.T) {
	rd := NewReviewData("a.md")
	require.Equal(t, "[]", rawField(t, rd, "comments"))
	require.Equal(t, map[string]bool{
		"file_path": true, "comments": true,
	}, keySet(t, rd))

	// And a constructed empty comment marshals reactions/[].
	c := NewReviewComment("id-1", "looks good", 1717000000)
	require.Equal(t, "[]", rawField(t, c, "reactions"))
	keys := keySet(t, c)
	require.True(t, keys["reactions"])
	// Optional legacy/anchor fields stay omitted when zero.
	require.False(t, keys["anchor"])
	require.False(t, keys["fallback_text"])
	require.False(t, keys["selected_text"])
	require.False(t, keys["resolved"])
}

// TestReviewDataFullRoundTrip exercises a populated record end to end. It
// includes a legacy snapshot to pin the tolerance contract: files written
// before snapshots were retired must keep parsing and round-tripping.
func TestReviewDataFullRoundTrip(t *testing.T) {
	in := ReviewData{
		FilePath: "doc.md",
		Snapshots: []ReviewSnapshot{
			{ID: "s1", Content: "v1", Timestamp: 1717000000},
		},
		Comments: []ReviewComment{
			{
				ID:        "c1",
				Comment:   "tighten this",
				CreatedAt: 1717000001,
				Resolved:  true,
				Anchor: &CommentAnchor{
					SourceLine: 4, BlockTextHash: "d58b3fa7",
				},
				FallbackText: "the original line",
				Reactions: []CommentReaction{
					{Actor: "agent", Kind: "addressed", Summary: "done", Timestamp: 1717000002},
				},
				SelectedText: "legacy text",
			},
		},
	}
	b, err := json.Marshal(in)
	require.NoError(t, err)
	var out ReviewData
	require.NoError(t, json.Unmarshal(b, &out))
	require.Equal(t, in, out)
}
