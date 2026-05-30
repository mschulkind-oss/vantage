package git

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// ptr is a test helper returning a pointer to an int.
func ptr(n int) *int { return &n }

func TestParseDiff(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		raw     string
		want    []wantHunk
		nHunks  int
		comment string
	}{
		{
			name: "single hunk add and delete and context",
			raw: "diff --git a/file.md b/file.md\n" +
				"index 1111111..2222222 100644\n" +
				"--- a/file.md\n" +
				"+++ b/file.md\n" +
				"@@ -1,3 +1,4 @@\n" +
				" context line\n" +
				"-deleted line\n" +
				"+added line one\n" +
				"+added line two\n" +
				" trailing context\n",
			nHunks: 1,
			want: []wantHunk{
				{
					header: "@@ -1,3 +1,4 @@",
					lines: []wantLine{
						{typ: "header", content: "@@ -1,3 +1,4 @@", old: nil, new: nil},
						{typ: "context", content: "context line", old: ptr(1), new: ptr(1)},
						{typ: "delete", content: "deleted line", old: ptr(2), new: nil},
						{typ: "add", content: "added line one", old: nil, new: ptr(2)},
						{typ: "add", content: "added line two", old: nil, new: ptr(3)},
						{typ: "context", content: "trailing context", old: ptr(3), new: ptr(4)},
						// Real git output ends in "\n"; Split produces a final ""
						// element that the parser classifies as context — part of
						// the contract (the original parser did the same).
						{typ: "context", content: "", old: ptr(4), new: ptr(5)},
					},
				},
			},
			comment: "line numbers advance from the header start; *int null on the absent side",
		},
		{
			name: "two hunks flush the first on the second header",
			raw: "@@ -1,1 +1,1 @@\n" +
				"-old\n" +
				"+new\n" +
				"@@ -10,2 +10,2 @@\n" +
				" ctx\n" +
				"+addition\n",
			nHunks: 2,
			want: []wantHunk{
				{
					header: "@@ -1,1 +1,1 @@",
					lines: []wantLine{
						{typ: "header", content: "@@ -1,1 +1,1 @@", old: nil, new: nil},
						{typ: "delete", content: "old", old: ptr(1), new: nil},
						{typ: "add", content: "new", old: nil, new: ptr(1)},
					},
				},
				{
					header: "@@ -10,2 +10,2 @@",
					lines: []wantLine{
						{typ: "header", content: "@@ -10,2 +10,2 @@", old: nil, new: nil},
						{typ: "context", content: "ctx", old: ptr(10), new: ptr(10)},
						{typ: "add", content: "addition", old: nil, new: ptr(11)},
						{typ: "context", content: "", old: ptr(11), new: ptr(12)},
					},
				},
			},
			comment: "starting line numbers come from each hunk's own header",
		},
		{
			name: "header without comma single-line counts",
			raw: "@@ -5 +5 @@\n" +
				"-x\n" +
				"+y\n",
			nHunks: 1,
			want: []wantHunk{
				{
					header: "@@ -5 +5 @@",
					lines: []wantLine{
						{typ: "header", content: "@@ -5 +5 @@", old: nil, new: nil},
						{typ: "delete", content: "x", old: ptr(5), new: nil},
						{typ: "add", content: "y", old: nil, new: ptr(5)},
						{typ: "context", content: "", old: ptr(6), new: ptr(6)},
					},
				},
			},
			comment: "headers may omit the ,count; start numbers still parse",
		},
		{
			name: "empty line treated as context with bumped numbers",
			raw: "@@ -1,2 +1,2 @@\n" +
				" first\n" +
				"\n" +
				" third\n",
			nHunks: 1,
			want: []wantHunk{
				{
					header: "@@ -1,2 +1,2 @@",
					lines: []wantLine{
						{typ: "header", content: "@@ -1,2 +1,2 @@", old: nil, new: nil},
						{typ: "context", content: "first", old: ptr(1), new: ptr(1)},
						{typ: "context", content: "", old: ptr(2), new: ptr(2)},
						{typ: "context", content: "third", old: ptr(3), new: ptr(3)},
						{typ: "context", content: "", old: ptr(4), new: ptr(4)},
					},
				},
			},
			comment: "a bare empty line is context (the original parser's behavior)",
		},
		{
			name: "untracked file all-additions form",
			raw: "@@ -0,0 +1,2 @@\n" +
				"+line one\n" +
				"+line two",
			nHunks: 1,
			want: []wantHunk{
				{
					header: "@@ -0,0 +1,2 @@",
					lines: []wantLine{
						{typ: "header", content: "@@ -0,0 +1,2 @@", old: nil, new: nil},
						{typ: "add", content: "line one", old: nil, new: ptr(1)},
						{typ: "add", content: "line two", old: nil, new: ptr(2)},
					},
				},
			},
			comment: "the synthetic untracked diff begins numbering at 1",
		},
		{
			name:    "preamble before any header is ignored",
			raw:     "diff --git a/x b/x\nindex aaa..bbb\n--- a/x\n+++ b/x\n",
			nHunks:  0,
			want:    nil,
			comment: "no hunk header means no lines collected",
		},
		{
			name:    "empty input",
			raw:     "",
			nHunks:  0,
			want:    nil,
			comment: "empty diff yields no hunks",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := parseDiff(tt.raw)
			require.Len(t, got, tt.nHunks, tt.comment)
			for i := range tt.want {
				require.Equal(t, tt.want[i].header, got[i].Header, "hunk %d header", i)
				require.Len(t, got[i].Lines, len(tt.want[i].lines), "hunk %d line count", i)
				for j, wl := range tt.want[i].lines {
					gl := got[i].Lines[j]
					require.Equal(t, wl.typ, gl.Type, "hunk %d line %d type", i, j)
					require.Equal(t, wl.content, gl.Content, "hunk %d line %d content", i, j)
					require.Equal(t, wl.old, gl.OldLineNo, "hunk %d line %d old_line_no", i, j)
					require.Equal(t, wl.new, gl.NewLineNo, "hunk %d line %d new_line_no", i, j)
				}
			}
		})
	}
}

type wantHunk struct {
	header string
	lines  []wantLine
}

type wantLine struct {
	typ     string
	content string
	old     *int
	new     *int
}

func TestStatusFromXY(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		xy   string
		want string
	}{
		{"untracked wins", "??", "untracked"},
		{"deleted unstaged", " D", "deleted"},
		{"deleted staged", "D ", "deleted"},
		{"deleted both", "DD", "deleted"},
		{"added staged", "A ", "added"},
		{"added unstaged intent", " A", "added"},
		{"renamed staged is modified", "R ", "modified"},
		{"modified unstaged", " M", "modified"},
		{"modified staged", "M ", "modified"},
		{"copied is modified", "C ", "modified"},
		{"updated-unmerged is modified", "UU", "modified"},
		{"delete precedes add when both present", "AD", "deleted"},
		{"add when no delete present", "AM", "added"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			require.Equal(t, tt.want, statusFromXY(tt.xy))
		})
	}
}

func TestValidateSHA(t *testing.T) {
	t.Parallel()

	tests := []struct {
		in   string
		want bool
	}{
		{"abcd", true},
		{"0123456789abcdef0123456789abcdef01234567", true},
		{"ABCDEF12", true},
		{"abc", false},  // too short
		{"", false},     // empty
		{"xyz1", false}, // non-hex
		{"HEAD", false}, // ref name
		{"abc;rm -rf", false},
		{"0123456789abcdef0123456789abcdef012345678", false}, // 41 chars
	}
	for _, tt := range tests {
		require.Equalf(t, tt.want, ValidateSHA(tt.in), "ValidateSHA(%q)", tt.in)
	}
}

func TestSplitLinesNoTrailing(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		in   string
		want []string
	}{
		{"empty", "", nil},
		{"single no newline", "a", []string{"a"}},
		{"trailing newline dropped", "a\nb\n", []string{"a", "b"}},
		{"crlf normalized", "a\r\nb", []string{"a", "b"}},
		{"cr normalized", "a\rb", []string{"a", "b"}},
		{"interior blank kept", "a\n\nb", []string{"a", "", "b"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			require.Equal(t, tt.want, splitLinesNoTrailing(tt.in))
		})
	}
}
