package planning

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/config"
	fssvc "github.com/mschulkind-oss/vantage/internal/fs"
	"github.com/mschulkind-oss/vantage/internal/ignore"
	"github.com/mschulkind-oss/vantage/internal/repoconfig"
)

// patternsCase is one row of internal/repoconfig/testdata/planning-patterns.json.
// Every expected value there is this matcher's own answer, produced by running
// go-gitignore; vantage-md's port is tested against the same rows.
type patternsCase struct {
	Include   []string `json:"include"`
	Exclude   []string `json:"exclude"`
	Path      string   `json:"path"`
	Candidate bool     `json:"candidate"`
}

func loadPatterns(t *testing.T) []patternsCase {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "repoconfig", "testdata", "planning-patterns.json"))
	require.NoError(t, err)
	var f struct {
		Cases []patternsCase `json:"cases"`
	}
	require.NoError(t, json.Unmarshal(data, &f))
	require.NotEmpty(t, f.Cases)
	return f.Cases
}

func TestMatcherGivesThePatternsFixturesAnswers(t *testing.T) {
	for _, tc := range loadPatterns(t) {
		// A roadmap no path can equal, so only include and exclude decide.
		m := NewMatcher(repoconfig.Planning{Roadmap: "\x00", Include: tc.Include, Exclude: tc.Exclude})
		require.Equal(t, tc.Candidate, m.IsCandidate(tc.Path),
			"include %q, exclude %q, path %q", tc.Include, tc.Exclude, tc.Path)
	}
}

// The fixture's rows for the quirks this matcher has and git's does not are the
// reason the fixture exists; losing one would leave the port untested exactly
// where it is most likely to be wrong.
func TestThePatternsFixtureKeepsItsQuirks(t *testing.T) {
	lines := map[string]bool{}
	for _, tc := range loadPatterns(t) {
		for _, l := range append(append([]string{}, tc.Include...), tc.Exclude...) {
			lines[l] = true
		}
	}
	for _, want := range []string{"a?.md", "docs/gallery/**", "[[:upper:]]*.md", "(?=x)", "a+b.md", "{a,b}.md", "dir/"} {
		require.True(t, lines[want], "planning-patterns.json lost its %q rows", want)
	}
}

// The roadmap is a candidate whatever include and exclude say (design §3.1,
// Plan Q2), and only the roadmap: the rule is an exact path, not a pattern.
func TestTheRoadmapIsAlwaysACandidate(t *testing.T) {
	m := NewMatcher(repoconfig.Planning{
		Roadmap: "plans/roadmap.md",
		Include: []string{"docs/**"},
		Exclude: []string{"plans/**"},
	})
	require.True(t, m.IsCandidate("plans/roadmap.md"))
	require.False(t, m.IsCandidate("plans/other.md"))
	require.False(t, m.IsCandidate("x/plans/roadmap.md"))
	require.False(t, m.IsCandidate("roadmap.md"))

	none := NewMatcher(repoconfig.Planning{Roadmap: "roadmap.md", Include: []string{}, Exclude: []string{}})
	require.True(t, none.IsCandidate("roadmap.md"), "not even an empty include rules it out")
	require.False(t, none.IsCandidate("a.md"))
}

// A literal line is a pattern too. starred.Promote treats it as a path, and
// doing so here would make it mean something vantage-md's port does not.
func TestALiteralLineIsMatchedAsAPattern(t *testing.T) {
	m := NewMatcher(repoconfig.Planning{Roadmap: "\x00", Include: []string{"notes.md"}})
	require.True(t, m.IsCandidate("notes.md"))
	require.True(t, m.IsCandidate("docs/notes.md"))
}

// The single-path mode answers every pushed Markdown path, so it must not
// compile the table's lines again for each one.
func TestOneTableIsCompiledOnce(t *testing.T) {
	cfg := repoconfig.Planning{Roadmap: "roadmap.md", Include: []string{"docs/**"}, Exclude: []string{"docs/x/**"}}
	same := cfg
	same.Include = append([]string(nil), cfg.Include...)
	require.Same(t, matcherFor(cfg), matcherFor(same))

	other := cfg
	other.Exclude = []string{"docs/y/**"}
	require.NotSame(t, matcherFor(cfg), matcherFor(other))
	require.False(t, matcherFor(other).IsCandidate("docs/y/a.md"))
	require.True(t, matcherFor(other).IsCandidate("docs/x/a.md"))
}

func TestCandidatesKeepsTheListingsOrder(t *testing.T) {
	m := NewMatcher(repoconfig.Planning{Roadmap: "roadmap.md", Include: []string{"docs/**"}})
	require.Equal(t,
		[]string{"docs/a.md", "docs/b.md", "roadmap.md"},
		Candidates([]string{"README.md", "docs/a.md", "docs/b.md", "roadmap.md", "src/x.md"}, m))
	require.NotNil(t, Candidates(nil, m))
}

// --- reading ---------------------------------------------------------------

// repo is a listing over a fresh tree, with the user ignore file isolated so a
// developer's ~/.config/vantage/ignore cannot change what is listed.
func repo(t *testing.T, tree map[string]string) (*fssvc.FileSystemService, string) {
	t.Helper()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	ignore.ClearCache()
	t.Cleanup(ignore.ClearCache)

	root := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}
	for rel, content := range tree {
		full := filepath.Join(root, filepath.FromSlash(rel))
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
		require.NoError(t, os.WriteFile(full, []byte(content), 0o644))
	}
	svc := fssvc.New(fssvc.Config{RootPath: root, ExcludeDirs: config.DefaultExcludeDirs, UseIgnoreFiles: true})
	return svc, root
}

// countOpens wraps openFile, recording every path opened.
func countOpens(t *testing.T) *[]string {
	t.Helper()
	var opened []string
	orig := openFile
	openFile = func(name string) (*os.File, error) {
		opened = append(opened, name)
		return orig(name)
	}
	t.Cleanup(func() { openFile = orig })
	return &opened
}

// lockFile makes rel unreadable, skipping the test when the running user is
// exempt from file modes — as root is, in a container.
func lockFile(t *testing.T, root, rel string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	require.NoError(t, os.Chmod(full, 0o000))
	t.Cleanup(func() { _ = os.Chmod(full, 0o644) })
	if _, err := os.ReadFile(full); err == nil {
		t.Skip("file modes are not enforced for this user")
	}
}

// batch is the decoded batch body.
type batch struct {
	Config         repoconfig.Planning `json:"config"`
	CandidateCount int                 `json:"candidate_count"`
	Refused        bool                `json:"refused"`
	Files          []file              `json:"files"`
	Skipped        []Skipped           `json:"skipped"`
	Unreadable     []Unreadable        `json:"unreadable"`
}

func writeBatch(t *testing.T, listing Listing, cfg repoconfig.Planning) (batch, string) {
	t.Helper()
	var buf bytes.Buffer
	require.NoError(t, WriteBatch(&buf, listing, cfg))
	var b batch
	require.NoError(t, json.Unmarshal(buf.Bytes(), &b), "body: %s", buf.String())
	return b, buf.String()
}

func paths(files []file) []string {
	out := []string{}
	for _, f := range files {
		out = append(out, f.Path)
	}
	return out
}

func TestTheBatchHasTheContractsShape(t *testing.T) {
	svc, _ := repo(t, map[string]string{})
	b, body := writeBatch(t, svc, repoconfig.DefaultPlanning())

	require.JSONEq(t, `{
		"config": {"roadmap": "roadmap.md", "include": ["**/*.md"], "exclude": [],
			"max_file_bytes": 1048576, "max_candidates": 5000, "stages": null},
		"candidate_count": 0, "refused": false,
		"files": [], "skipped": [], "unreadable": []
	}`, body, "every list is [] and never null")
	require.Equal(t, repoconfig.DefaultPlanning(), b.Config)
}

func TestTheBatchServesEveryCandidateSortedAndNoOtherFile(t *testing.T) {
	svc, _ := repo(t, map[string]string{
		"roadmap.md":             "# Roadmap\n",
		"docs/b.md":              "---\nstatus: draft\n---\n",
		"docs/a.md":              "# A\n",
		"docs/gallery/status.md": "# Excluded\n",
		".github/x.md":           "---\nstatus: draft\n---\n",
		"node_modules/p/x.md":    "# Not listed\n",
		"notes.txt":              "not Markdown\n",
	})
	cfg := repoconfig.DefaultPlanning()
	cfg.Exclude = []string{"docs/gallery/**", "roadmap.md"}
	cfg.Stages = map[string]string{"DESIGN": "open"}

	b, _ := writeBatch(t, svc, cfg)
	require.Equal(t, cfg, b.Config, "config is the effective table, stages included")
	require.Equal(t, 3, b.CandidateCount)
	require.False(t, b.Refused)
	require.Equal(t, []string{"docs/a.md", "docs/b.md", "roadmap.md"}, paths(b.Files),
		"sorted; the excluded roadmap is still a candidate")
	require.Equal(t, "---\nstatus: draft\n---\n", b.Files[1].Content)
}

// Past the limit nothing is opened — not merely nothing returned. A locked
// candidate proves it where modes are enforced, and counting opens proves it
// everywhere.
func TestPastMaxCandidatesNothingIsOpened(t *testing.T) {
	svc, root := repo(t, map[string]string{"a.md": "# A\n", "b.md": "# B\n", "c.md": "# C\n"})
	cfg := repoconfig.DefaultPlanning()
	cfg.MaxCandidates = 2
	opened := countOpens(t)
	require.NoError(t, os.Chmod(filepath.Join(root, "c.md"), 0o000))
	t.Cleanup(func() { _ = os.Chmod(filepath.Join(root, "c.md"), 0o644) })

	b, _ := writeBatch(t, svc, cfg)
	require.True(t, b.Refused)
	require.Equal(t, 3, b.CandidateCount)
	require.Empty(t, b.Files)
	require.Empty(t, b.Skipped)
	require.Empty(t, b.Unreadable, "the locked candidate was never opened, so it caused no error")
	require.Empty(t, *opened)
}

func TestAtMaxCandidatesTheBatchIsServed(t *testing.T) {
	svc, _ := repo(t, map[string]string{"a.md": "# A\n", "b.md": "# B\n"})
	cfg := repoconfig.DefaultPlanning()
	cfg.MaxCandidates = 2

	b, _ := writeBatch(t, svc, cfg)
	require.False(t, b.Refused)
	require.Equal(t, 2, b.CandidateCount)
	require.Equal(t, []string{"a.md", "b.md"}, paths(b.Files))
}

// The limit counts candidates, not listed files: a file include rules out does
// not bring the project closer to refusal.
func TestMaxCandidatesCountsOnlyCandidates(t *testing.T) {
	svc, _ := repo(t, map[string]string{"docs/a.md": "# A\n", "x.md": "# X\n", "y.md": "# Y\n"})
	cfg := repoconfig.DefaultPlanning()
	cfg.Include = []string{"docs/**"}
	cfg.MaxCandidates = 1

	b, _ := writeBatch(t, svc, cfg)
	require.False(t, b.Refused)
	require.Equal(t, 1, b.CandidateCount)
}

func TestAnOversizedCandidateIsSkippedUnopened(t *testing.T) {
	svc, root := repo(t, map[string]string{"big.md": strings.Repeat("x", 11), "small.md": "0123456789"})
	cfg := repoconfig.DefaultPlanning()
	cfg.MaxFileBytes = 10
	opened := countOpens(t)

	b, _ := writeBatch(t, svc, cfg)
	require.Equal(t, []Skipped{{Path: "big.md", Size: 11}}, b.Skipped)
	require.Equal(t, []string{"small.md"}, paths(b.Files), "exactly the limit is not over it")
	require.Equal(t, []string{filepath.Join(root, "small.md")}, *opened)
}

func TestACandidateThatIsNotUTF8IsUnreadable(t *testing.T) {
	svc, _ := repo(t, map[string]string{"latin1.md": "caf\xe9\n", "ok.md": "café\n"})

	b, _ := writeBatch(t, svc, repoconfig.DefaultPlanning())
	require.Equal(t, []Unreadable{{Path: "latin1.md", Reason: "not UTF-8"}}, b.Unreadable)
	require.Equal(t, []string{"ok.md"}, paths(b.Files))
}

func TestALockedCandidateIsUnreadable(t *testing.T) {
	svc, root := repo(t, map[string]string{"locked.md": "# Locked\n", "ok.md": "# OK\n"})
	lockFile(t, root, "locked.md")

	b, _ := writeBatch(t, svc, repoconfig.DefaultPlanning())
	require.Equal(t, []Unreadable{{Path: "locked.md", Reason: "permission denied"}}, b.Unreadable)
	require.Equal(t, []string{"ok.md"}, paths(b.Files))
}

// A named pipe is listed, since the listing looks only at the name and type, and
// opening one would block the request until something wrote to it. It is
// refused from its stat, before any open.
func TestANamedPipeIsUnreadableAndNeverOpened(t *testing.T) {
	svc, root := repo(t, map[string]string{"ok.md": "# OK\n"})
	if err := syscall.Mkfifo(filepath.Join(root, "pipe.md"), 0o644); err != nil {
		t.Skipf("cannot make a named pipe here: %v", err)
	}
	opened := countOpens(t)

	b, _ := writeBatch(t, svc, repoconfig.DefaultPlanning())
	require.Equal(t, []Unreadable{{Path: "pipe.md", Reason: "not a regular file"}}, b.Unreadable)
	require.Equal(t, []string{filepath.Join(root, "ok.md")}, *opened)
}

// A symlink out of the repository is never read: the listing does not yield
// one, and the reader refuses one even when asked for it by name.
func TestASymlinkOutOfTheRootIsNeverRead(t *testing.T) {
	svc, root := repo(t, map[string]string{"ok.md": "# OK\n"})
	secret := filepath.Join(t.TempDir(), "secret.md")
	require.NoError(t, os.WriteFile(secret, []byte("---\nstatus: draft\n---\nsecret\n"), 0o644))
	require.NoError(t, os.Symlink(secret, filepath.Join(root, "leak.md")))
	require.NoError(t, os.Symlink(filepath.Join(root, "ok.md"), filepath.Join(root, "inside.md")))
	opened := countOpens(t)

	b, body := writeBatch(t, svc, repoconfig.DefaultPlanning())
	require.Equal(t, []string{"ok.md"}, paths(b.Files))
	require.NotContains(t, body, "secret")

	r := newReader(root, 1<<20)
	require.Equal(t, KindUnreadable, r.read("leak.md").kind)
	require.Equal(t, KindUnreadable, r.read("inside.md").kind, "not even one that stays inside")
	require.Equal(t, []string{filepath.Join(root, "ok.md")}, *opened)
}

// On POSIX a backslash is an ordinary character in a file name, so the listing
// yields `x\..\.private\notes.md` as one root-level file. pathsafe reads a
// backslash as a separator, and cleaning then resolved that name to
// .private/notes.md: the batch served a hidden file's text under the decoy's
// name. A name that resolves anywhere but itself is unreadable.
func TestANameThatResolvesToAnotherFileIsNeverReadAsIt(t *testing.T) {
	decoy := `x\..\.private\notes.md`
	svc, root := repo(t, map[string]string{
		".private/notes.md": "# PRIVATE\n",
		decoy:               "# decoy\n",
		"ok.md":             "# OK\n",
	})
	opened := countOpens(t)

	b, body := writeBatch(t, svc, repoconfig.DefaultPlanning())
	require.NotContains(t, body, "PRIVATE")
	require.Equal(t, []string{"ok.md"}, paths(b.Files))
	require.Equal(t, []Unreadable{{Path: decoy, Reason: "its name reads as a different path"}}, b.Unreadable)
	require.Equal(t, []string{filepath.Join(root, "ok.md")}, *opened)

	entry := Lookup(svc, repoconfig.DefaultPlanning(), decoy)
	require.Equal(t, KindUnreadable, entry.Kind)
}

// The read is capped one byte past the limit, and at the largest limit the
// config accepts that byte overflowed: LimitReader read nothing, and every
// candidate was served as an empty file.
func TestTheLargestLimitStillReadsTheFile(t *testing.T) {
	_, root := repo(t, map[string]string{"a.md": "# A\n"})
	got := newReader(root, math.MaxInt64).read("a.md")
	require.Equal(t, KindFile, got.kind)
	require.Equal(t, "# A\n", got.content)
}

// A candidate deleted between the listing and its read is left out, not
// reported as unreadable: nothing is wrong with a file that is gone.
func TestACandidateThatVanishesIsLeftOut(t *testing.T) {
	svc, root := repo(t, map[string]string{"a.md": "# A\n", "gone.md": "# Gone\n"})
	listing := vanishing{svc, filepath.Join(root, "gone.md")}

	b, _ := writeBatch(t, listing, repoconfig.DefaultPlanning())
	require.Equal(t, 2, b.CandidateCount)
	require.Equal(t, []string{"a.md"}, paths(b.Files))
	require.Empty(t, b.Unreadable)
}

// vanishing deletes one file right after listing it.
type vanishing struct {
	*fssvc.FileSystemService
	victim string
}

func (v vanishing) ListAllFiles() []string {
	out := v.FileSystemService.ListAllFiles()
	_ = os.Remove(v.victim)
	return out
}

// Streamed: each file is written on its own, so the body is never held whole.
func TestTheBatchIsStreamedOneFileAtATime(t *testing.T) {
	tree := map[string]string{}
	for _, n := range []string{"a", "b", "c", "d"} {
		tree[n+".md"] = strings.Repeat(n, 4096)
	}
	svc, _ := repo(t, tree)

	var w recordingWriter
	require.NoError(t, WriteBatch(&w, svc, repoconfig.DefaultPlanning()))
	require.Less(t, w.largest, 2*4096, "no write carries more than one file")
	var b batch
	require.NoError(t, json.Unmarshal(w.buf.Bytes(), &b))
	require.Len(t, b.Files, 4)
}

type recordingWriter struct {
	buf     bytes.Buffer
	largest int
}

func (w *recordingWriter) Write(p []byte) (int, error) {
	w.largest = max(w.largest, len(p))
	return w.buf.Write(p)
}

// A client that goes away stops the stream: the error is returned, and no
// further file is read for nobody.
func TestTheBatchStopsWhenTheClientGoesAway(t *testing.T) {
	svc, root := repo(t, map[string]string{"a.md": "# A\n", "b.md": "# B\n", "c.md": "# C\n"})
	opened := countOpens(t)

	// The head and a.md are delivered; b.md is read and cannot be.
	err := WriteBatch(&failingWriter{after: 2}, svc, repoconfig.DefaultPlanning())
	require.Error(t, err)
	require.Equal(t, []string{filepath.Join(root, "a.md"), filepath.Join(root, "b.md")}, *opened,
		"the stream stopped at the first file it could not deliver")
}

// failingWriter accepts `after` writes and refuses every one after that.
type failingWriter struct{ after int }

func (w *failingWriter) Write(p []byte) (int, error) {
	if w.after == 0 {
		return 0, errors.New("client went away")
	}
	w.after--
	return len(p), nil
}

// --- the single-path mode ----------------------------------------------------

func TestLookupAnswersEachKind(t *testing.T) {
	svc, _ := repo(t, map[string]string{
		"docs/a.md":         "---\nstatus: draft\n---\n",
		"docs/empty.md":     "",
		"docs/big.md":       strings.Repeat("x", 64),
		"docs/latin1.md":    "caf\xe9\n",
		"docs/gallery/g.md": "# Excluded\n",
		".github/x.md":      "---\nstatus: draft\n---\n",
		"roadmap.md":        "# Roadmap\n",
	})
	cfg := repoconfig.DefaultPlanning()
	cfg.MaxFileBytes = 32
	cfg.Exclude = []string{"docs/gallery/**", "roadmap.md"}

	for rel, want := range map[string]Entry{
		"docs/a.md":         {Path: "docs/a.md", Kind: KindFile, Content: "---\nstatus: draft\n---\n"},
		"docs/empty.md":     {Path: "docs/empty.md", Kind: KindFile},
		"docs/big.md":       {Path: "docs/big.md", Kind: KindSkipped, Size: 64},
		"docs/latin1.md":    {Path: "docs/latin1.md", Kind: KindUnreadable, Reason: "not UTF-8"},
		"docs/gallery/g.md": {Path: "docs/gallery/g.md", Kind: KindAbsent},
		".github/x.md":      {Path: ".github/x.md", Kind: KindAbsent},
		"docs/missing.md":   {Path: "docs/missing.md", Kind: KindAbsent},
		"roadmap.md":        {Path: "roadmap.md", Kind: KindFile, Content: "# Roadmap\n"},
		"../escape.md":      {Path: "../escape.md", Kind: KindAbsent},
		"./docs/a.md":       {Path: "./docs/a.md", Kind: KindAbsent},
	} {
		require.Equal(t, want, Lookup(svc, cfg, rel), "Lookup(%q)", rel)
	}
}

// The watcher pushes an edit under `.github/`, which no listing shows. Carrying
// `status:` makes it a planning document to the scan, so if this answered
// `file` it would join the index until the next rescan.
func TestLookupKeepsAPathTheListingPrunesAbsent(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "repoconfig", "testdata", "planning-candidates.json"))
	require.NoError(t, err)
	var f struct {
		Tree   map[string]string `json:"tree"`
		Listed []string          `json:"listed"`
	}
	require.NoError(t, json.Unmarshal(data, &f))
	svc, _ := repo(t, f.Tree)
	cfg := repoconfig.DefaultPlanning()
	cfg.Include = []string{"**"}

	require.Contains(t, f.Tree[".github/x.md"], "status:")
	for rel := range f.Tree {
		listed := false
		for _, l := range f.Listed {
			listed = listed || l == rel
		}
		got := Lookup(svc, cfg, rel)
		if listed {
			require.Equal(t, KindFile, got.Kind, "Lookup(%q)", rel)
		} else {
			require.Equal(t, KindAbsent, got.Kind, "Lookup(%q)", rel)
		}
	}
}

func TestLookupSkipsAnOversizedFileUnopened(t *testing.T) {
	svc, _ := repo(t, map[string]string{"big.md": strings.Repeat("x", 64)})
	cfg := repoconfig.DefaultPlanning()
	cfg.MaxFileBytes = 32
	opened := countOpens(t)

	require.Equal(t, Entry{Path: "big.md", Kind: KindSkipped, Size: 64}, Lookup(svc, cfg, "big.md"))
	require.Empty(t, *opened)
}

// A file that exists and cannot be read is unreadable, never absent: absent
// would drop it from the index silently, where unreadable lists it.
func TestLookupReportsALockedFileUnreadable(t *testing.T) {
	svc, root := repo(t, map[string]string{"locked.md": "# Locked\n"})
	lockFile(t, root, "locked.md")

	require.Equal(t,
		Entry{Path: "locked.md", Kind: KindUnreadable, Reason: "permission denied"},
		Lookup(svc, repoconfig.DefaultPlanning(), "locked.md"))
}

func TestEntryMarshalsOnlyItsKindsFields(t *testing.T) {
	for want, e := range map[string]Entry{
		`{"path":"a.md","kind":"file","content":""}`:               {Path: "a.md", Kind: KindFile},
		`{"path":"a.md","kind":"skipped","size":2097152}`:          {Path: "a.md", Kind: KindSkipped, Size: 2097152},
		`{"path":"a.md","kind":"unreadable","reason":"not UTF-8"}`: {Path: "a.md", Kind: KindUnreadable, Reason: "not UTF-8"},
		`{"path":"a.md","kind":"absent"}`:                          {Path: "a.md", Kind: KindAbsent, Content: "ignored"},
	} {
		body, err := json.Marshal(e)
		require.NoError(t, err)
		require.JSONEq(t, want, string(body))
	}
}
