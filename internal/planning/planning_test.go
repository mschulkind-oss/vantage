package planning

import (
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
		// No listed roadmap, so only include and exclude decide.
		m := NewMatcher(repoconfig.Planning{Roadmaps: []string{}, Include: tc.Include, Exclude: tc.Exclude})
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

// The candidate half of internal/repoconfig/testdata/planning-roadmaps.json:
// a listed roadmap is a candidate whatever the patterns say, and a roadmap
// found by name is not. The roadmap half is repoconfig's IsRoadmap, asserted in
// its own suite; vantage-md's candidateMatcher is held to the same rows.
func TestMatcherGivesTheRoadmapsFixturesAnswers(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "repoconfig", "testdata", "planning-roadmaps.json"))
	require.NoError(t, err)
	var f struct {
		Cases []struct {
			Roadmaps  []string `json:"roadmaps"`
			Include   []string `json:"include"`
			Exclude   []string `json:"exclude"`
			Path      string   `json:"path"`
			Candidate bool     `json:"candidate"`
		} `json:"cases"`
	}
	require.NoError(t, json.Unmarshal(data, &f))
	require.NotEmpty(t, f.Cases)
	for _, tc := range f.Cases {
		m := NewMatcher(repoconfig.Planning{Roadmaps: tc.Roadmaps, Include: tc.Include, Exclude: tc.Exclude})
		require.Equal(t, tc.Candidate, m.IsCandidate(tc.Path),
			"roadmaps %q, include %q, exclude %q, path %q", tc.Roadmaps, tc.Include, tc.Exclude, tc.Path)
	}
}

// A listed roadmap is a candidate whatever include and exclude say
// (docs/reference/planning-index.md §3.1, Plan Q2, now per entry), and only a listed one: the rule is an exact
// path, not a pattern.
func TestAListedRoadmapIsAlwaysACandidate(t *testing.T) {
	m := NewMatcher(repoconfig.Planning{
		Roadmaps: []string{"plans/roadmap.md", "notes/PLAN.md"},
		Include:  []string{"docs/**"},
		Exclude:  []string{"plans/**", "notes/**"},
	})
	require.True(t, m.IsCandidate("plans/roadmap.md"))
	require.True(t, m.IsCandidate("notes/PLAN.md"), "every entry, not only the first")
	require.False(t, m.IsCandidate("plans/other.md"))
	require.False(t, m.IsCandidate("x/plans/roadmap.md"))
	require.False(t, m.IsCandidate("roadmap.md"))
	require.False(t, m.IsCandidate("plans/ROADMAP.md"), "compared exactly")

	none := NewMatcher(repoconfig.Planning{Roadmaps: []string{"roadmap.md"}, Include: []string{}, Exclude: []string{}})
	require.True(t, none.IsCandidate("roadmap.md"), "not even an empty include rules it out")
	require.False(t, none.IsCandidate("a.md"))
}

// A roadmap found by its name is a roadmap because it is a candidate, so the
// patterns are how a reader hides one (§3.1): with roadmaps null nothing
// is exempt, and with [] nothing is either.
func TestARoadmapFoundByNameHasNoExemption(t *testing.T) {
	for _, roadmaps := range [][]string{nil, {}} {
		m := NewMatcher(repoconfig.Planning{
			Roadmaps: roadmaps,
			Include:  []string{"**/*.md"},
			Exclude:  []string{"archive/**"},
		})
		require.True(t, m.IsCandidate("roadmap.md"), "roadmaps %q", roadmaps)
		require.False(t, m.IsCandidate("archive/roadmap.md"), "roadmaps %q", roadmaps)
		require.False(t, m.IsCandidate("ROADMAP.MD"), "roadmaps %q: **/*.md is case-sensitive", roadmaps)
	}
}

// A literal line is a pattern too. starred.Promote treats it as a path, and
// doing so here would make it mean something vantage-md's port does not.
func TestALiteralLineIsMatchedAsAPattern(t *testing.T) {
	m := NewMatcher(repoconfig.Planning{Roadmaps: []string{}, Include: []string{"notes.md"}})
	require.True(t, m.IsCandidate("notes.md"))
	require.True(t, m.IsCandidate("docs/notes.md"))
}

// The single-path mode answers every pushed Markdown path, so it must not
// compile the table's lines again for each one.
func TestOneTableIsCompiledOnce(t *testing.T) {
	cfg := repoconfig.Planning{Roadmaps: []string{"roadmap.md"}, Include: []string{"docs/**"}, Exclude: []string{"docs/x/**"}}
	same := cfg
	same.Include = append([]string(nil), cfg.Include...)
	same.Roadmaps = append([]string(nil), cfg.Roadmaps...)
	require.Same(t, matcherFor(cfg), matcherFor(same))

	other := cfg
	other.Exclude = []string{"docs/y/**"}
	require.NotSame(t, matcherFor(cfg), matcherFor(other))
	require.False(t, matcherFor(other).IsCandidate("docs/y/a.md"))
	require.True(t, matcherFor(other).IsCandidate("docs/x/a.md"))

	listed := cfg
	listed.Roadmaps = []string{"plans/roadmap.md"}
	require.NotSame(t, matcherFor(cfg), matcherFor(listed), "the roadmaps are part of the key")
	require.True(t, matcherFor(listed).IsCandidate("plans/roadmap.md"))
}

// null finds roadmaps by name and [] names none, so the two are two tables to
// the matcher cache, as they are on the wire. One key for both would hand a
// table the other's matcher, and with it the other's listed exemptions.
func TestTheMatcherCacheTellsNullFromEmpty(t *testing.T) {
	byName := repoconfig.Planning{Roadmaps: nil, Include: []string{"docs/**"}, Exclude: []string{}}
	none := byName
	none.Roadmaps = []string{}
	require.NotSame(t, matcherFor(byName), matcherFor(none))
	require.Same(t, matcherFor(byName), matcherFor(byName))
	require.Same(t, matcherFor(none), matcherFor(none))
}

func TestCandidatesKeepsTheListingsOrder(t *testing.T) {
	m := NewMatcher(repoconfig.Planning{Roadmaps: []string{"roadmap.md"}, Include: []string{"docs/**"}})
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

// header is the stream's header line, decoded.
func header(t *testing.T, s *streamLog) headerLine {
	t.Helper()
	first, _, _ := strings.Cut(s.buf.String(), "\n")
	var h headerLine
	require.NoError(t, json.Unmarshal([]byte(first), &h), "first line: %s", first)
	return h
}

// An empty repository's stream is its header and end, and nothing else. The
// header's config is the effective table, spelled as the viewer reads it.
func TestAnEmptyRepositorysStreamIsItsHeaderThenEnd(t *testing.T) {
	svc, _ := repo(t, map[string]string{})
	s := writeStream(t, svc, repoconfig.DefaultPlanning(), nil)

	require.Equal(t,
		`{"kind":"header","config":{"roadmaps":null,"include":["**/*.md"],"exclude":[],`+
			`"max_file_bytes":1048576,"max_candidates":5000,"stages":null},"candidate_count":0,"refused":false}`+"\n"+
			`{"kind":"end","candidates":0}`+"\n",
		s.buf.String())
	require.Equal(t, repoconfig.DefaultPlanning(), header(t, s).Config)
}

func TestTheStreamSendsEveryCandidateSortedAndNoOtherFile(t *testing.T) {
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
	cfg.Roadmaps = []string{"roadmap.md"}
	cfg.Exclude = []string{"docs/gallery/**", "roadmap.md"}
	cfg.Stages = map[string]string{"DESIGN": "open"}

	s := writeStream(t, svc, cfg, nil)
	lines := s.lines(t)
	require.Equal(t, []string{"header", "file docs/a.md", "file docs/b.md", "file roadmap.md", "end"}, kinds(lines),
		"sorted; the excluded roadmap is listed, so still a candidate")
	h := header(t, s)
	require.Equal(t, cfg, h.Config, "config is the effective table, stages included")
	require.Equal(t, 3, h.CandidateCount)
	require.False(t, h.Refused)
	require.Equal(t, "---\nstatus: draft\n---\n", lines[2]["content"])
}

// The limit counts candidates, not listed files: a file include rules out does
// not bring the project closer to refusal.
func TestMaxCandidatesCountsOnlyCandidates(t *testing.T) {
	svc, _ := repo(t, map[string]string{"docs/a.md": "# A\n", "x.md": "# X\n", "y.md": "# Y\n"})
	cfg := repoconfig.DefaultPlanning()
	cfg.Include = []string{"docs/**"}
	cfg.MaxCandidates = 1

	s := writeStream(t, svc, cfg, nil)
	require.False(t, header(t, s).Refused)
	require.Equal(t, 1, header(t, s).CandidateCount)
	require.Equal(t, []string{"header", "file docs/a.md", "end"}, kinds(s.lines(t)))
}

func TestAnOversizedCandidateIsSkippedUnopened(t *testing.T) {
	svc, root := repo(t, map[string]string{"big.md": strings.Repeat("x", 11), "small.md": "0123456789"})
	cfg := repoconfig.DefaultPlanning()
	cfg.MaxFileBytes = 10
	opened := countOpens(t)

	lines := writeStream(t, svc, cfg, nil).lines(t)
	require.Equal(t, []string{"header", "skipped big.md", "file small.md", "end"}, kinds(lines),
		"exactly the limit is not over it")
	require.Equal(t, 11.0, lines[1]["size"])
	require.Equal(t, []string{filepath.Join(root, "small.md")}, *opened)
}

func TestACandidateThatIsNotUTF8IsUnreadable(t *testing.T) {
	svc, _ := repo(t, map[string]string{"latin1.md": "caf\xe9\n", "ok.md": "café\n"})

	lines := writeStream(t, svc, repoconfig.DefaultPlanning(), nil).lines(t)
	require.Equal(t, []string{"header", "unreadable latin1.md", "file ok.md", "end"}, kinds(lines))
	require.Equal(t, "not UTF-8", lines[1]["reason"])
}

func TestALockedCandidateIsUnreadable(t *testing.T) {
	svc, root := repo(t, map[string]string{"locked.md": "# Locked\n", "ok.md": "# OK\n"})
	lockFile(t, root, "locked.md")

	lines := writeStream(t, svc, repoconfig.DefaultPlanning(), nil).lines(t)
	require.Equal(t, []string{"header", "unreadable locked.md", "file ok.md", "end"}, kinds(lines))
	require.Equal(t, "permission denied", lines[1]["reason"])
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

	lines := writeStream(t, svc, repoconfig.DefaultPlanning(), nil).lines(t)
	require.Equal(t, []string{"header", "file ok.md", "unreadable pipe.md", "end"}, kinds(lines))
	require.Equal(t, "not a regular file", lines[2]["reason"])
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

	s := writeStream(t, svc, repoconfig.DefaultPlanning(), nil)
	require.Equal(t, []string{"header", "file ok.md", "end"}, kinds(s.lines(t)))
	require.NotContains(t, s.buf.String(), "secret")

	r := newReader(root, 1<<20)
	require.Equal(t, KindUnreadable, r.read("leak.md").kind)
	require.Equal(t, KindUnreadable, r.read("inside.md").kind, "not even one that stays inside")
	require.Equal(t, []string{filepath.Join(root, "ok.md")}, *opened)
}

// On POSIX a backslash is an ordinary character in a file name, so the listing
// yields `x\..\.private\notes.md` as one root-level file. pathsafe reads a
// backslash as a separator, and cleaning then resolved that name to
// .private/notes.md: the planning endpoint once served a hidden file's text
// under the decoy's name. A name that resolves anywhere but itself is
// unreadable.
func TestANameThatResolvesToAnotherFileIsNeverReadAsIt(t *testing.T) {
	decoy := `x\..\.private\notes.md`
	svc, root := repo(t, map[string]string{
		".private/notes.md": "# PRIVATE\n",
		decoy:               "# decoy\n",
		"ok.md":             "# OK\n",
	})
	opened := countOpens(t)

	s := writeStream(t, svc, repoconfig.DefaultPlanning(), nil)
	require.NotContains(t, s.buf.String(), "PRIVATE")
	lines := s.lines(t)
	require.Equal(t, []string{"header", "file ok.md", "unreadable " + decoy, "end"}, kinds(lines))
	require.Equal(t, "its name reads as a different path", lines[2]["reason"])
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

// Content hashes the tests spell out, each the first 32 hex digits of
// `printf '…' | sha256sum`, so the expected values do not come from the code
// under test.
const (
	emptyHash   = "e3b0c44298fc1c149afbf4c8996fb924" // ""
	testHash    = "9f86d081884c7d659a2feaa0c55ad015" // "test"
	draftHash   = "b55fe4e52335215e853f63ea6a91c8da" // "---\nstatus: draft\n---\n"
	roadmapHash = "eae710439b6ab1e8e034479e4785fddf" // "# Roadmap\n"
)

// The content hash is the reference's: the first 128 bits of SHA-256 over the
// file's bytes, as 32 lowercase hex digits. The browser computes none of its
// own, but it keys its scan cache by this string and sends it back as `have`,
// so its spelling is a contract.
func TestAFilesHashIsTheFirst128BitsOfItsSHA256(t *testing.T) {
	_, root := repo(t, map[string]string{"test.md": "test", "empty.md": "", "draft.md": "---\nstatus: draft\n---\n"})
	r := newReader(root, 1<<20)
	for rel, want := range map[string]string{"test.md": testHash, "empty.md": emptyHash, "draft.md": draftHash} {
		got := r.read(rel)
		require.Equal(t, KindFile, got.kind, rel)
		require.Equal(t, want, got.hash, rel)
	}
}

// Only a file read whole has a hash: a skipped file was never opened, and an
// unreadable one has no text to key a scan by.
func TestOnlyAFileReadWholeHasAHash(t *testing.T) {
	_, root := repo(t, map[string]string{"big.md": strings.Repeat("x", 11), "latin1.md": "caf\xe9\n"})
	r := newReader(root, 10)
	require.Equal(t, read{kind: KindSkipped, size: 11}, r.read("big.md"))
	require.Equal(t, read{kind: KindUnreadable, reason: "not UTF-8"}, r.read("latin1.md"))
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
	cfg.Roadmaps = []string{"roadmap.md"}
	cfg.MaxFileBytes = 32
	cfg.Exclude = []string{"docs/gallery/**", "roadmap.md"}

	for rel, want := range map[string]Entry{
		"docs/a.md":         {Path: "docs/a.md", Kind: KindFile, Hash: draftHash, Content: "---\nstatus: draft\n---\n"},
		"docs/empty.md":     {Path: "docs/empty.md", Kind: KindFile, Hash: emptyHash},
		"docs/big.md":       {Path: "docs/big.md", Kind: KindSkipped, Size: 64},
		"docs/latin1.md":    {Path: "docs/latin1.md", Kind: KindUnreadable, Reason: "not UTF-8"},
		"docs/gallery/g.md": {Path: "docs/gallery/g.md", Kind: KindAbsent},
		".github/x.md":      {Path: ".github/x.md", Kind: KindAbsent},
		"docs/missing.md":   {Path: "docs/missing.md", Kind: KindAbsent},
		"roadmap.md":        {Path: "roadmap.md", Kind: KindFile, Hash: roadmapHash, Content: "# Roadmap\n"},
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
		`{"path":"a.md","kind":"file","hash":"` + emptyHash + `","content":""}`: {Path: "a.md", Kind: KindFile, Hash: emptyHash},
		`{"path":"a.md","kind":"skipped","size":2097152}`:                       {Path: "a.md", Kind: KindSkipped, Size: 2097152, Hash: "ignored"},
		`{"path":"a.md","kind":"unreadable","reason":"not UTF-8"}`:              {Path: "a.md", Kind: KindUnreadable, Reason: "not UTF-8"},
		`{"path":"a.md","kind":"absent"}`:                                       {Path: "a.md", Kind: KindAbsent, Content: "ignored", Hash: "ignored"},
	} {
		body, err := json.Marshal(e)
		require.NoError(t, err)
		require.JSONEq(t, want, string(body))
	}
}
