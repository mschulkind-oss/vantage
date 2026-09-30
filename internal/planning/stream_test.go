package planning

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/repoconfig"
)

// streamLog is a [Flusher] that keeps the body and the order of what happened
// to it: each write, each flush, and — through [logOpens] — each file opened.
type streamLog struct {
	buf    bytes.Buffer
	events []string
}

func (s *streamLog) Write(p []byte) (int, error) {
	s.events = append(s.events, "write")
	return s.buf.Write(p)
}

func (s *streamLog) Flush() error {
	s.events = append(s.events, "flush")
	return nil
}

// logOpens records every file opened into s's events, as "open <rel>".
func logOpens(t *testing.T, s *streamLog, root string) {
	t.Helper()
	orig := openFile
	openFile = func(name string) (*os.File, error) {
		rel, _ := filepath.Rel(root, name)
		s.events = append(s.events, "open "+filepath.ToSlash(rel))
		return orig(name)
	}
	t.Cleanup(func() { openFile = orig })
}

func (s *streamLog) lines(t *testing.T) []map[string]any {
	t.Helper()
	return decodeLines(t, s.buf.String())
}

// decodeLines is body split into its lines, each decoded, with the check that
// every line ends in a newline and the body has nothing after the last one.
func decodeLines(t *testing.T, body string) []map[string]any {
	t.Helper()
	require.True(t, strings.HasSuffix(body, "\n"), "the last line ends too: %q", body)
	out := []map[string]any{}
	for _, raw := range strings.SplitAfter(strings.TrimSuffix(body, "\n"), "\n") {
		var line map[string]any
		require.NoError(t, json.Unmarshal([]byte(raw), &line), "line: %q", raw)
		out = append(out, line)
	}
	return out
}

func writeStream(t *testing.T, listing Listing, cfg repoconfig.Planning, have map[string]string) *streamLog {
	t.Helper()
	var s streamLog
	require.NoError(t, NewStream(listing, cfg).Write(context.Background(), &s, have))
	return &s
}

// kinds is each line's kind and path, as "kind path" ("kind" alone for the
// header and end), so a test can state the order of a whole stream in one list.
func kinds(lines []map[string]any) []string {
	out := []string{}
	for _, l := range lines {
		k := l["kind"].(string)
		if p, ok := l["path"].(string); ok {
			k += " " + p
		}
		out = append(out, k)
	}
	return out
}

// Every kind of line, in the listing's order, between the header and end. The
// header carries the effective table, so the browser scans with the rules the
// server listed by.
func TestTheStreamWritesEveryKindInListingOrder(t *testing.T) {
	svc, _ := repo(t, map[string]string{
		"roadmap.md":        "# Roadmap\n",
		"docs/a.md":         "---\nstatus: draft\n---\n",
		"docs/big.md":       strings.Repeat("x", 65),
		"docs/latin1.md":    "caf\xe9\n",
		"docs/new.md":       "# New\n",
		"docs/gallery/g.md": "# Excluded\n",
	})
	cfg := repoconfig.DefaultPlanning()
	cfg.MaxFileBytes = 64
	cfg.Exclude = []string{"docs/gallery/**"}
	cfg.Stages = map[string]string{"DESIGN": "open"}

	lines := writeStream(t, svc, cfg, map[string]string{"docs/a.md": draftHash}).lines(t)
	require.Equal(t, []string{
		"header",
		"same docs/a.md",
		"skipped docs/big.md",
		"unreadable docs/latin1.md",
		"file docs/new.md",
		"file roadmap.md",
		"end",
	}, kinds(lines))

	config, err := json.Marshal(cfg)
	require.NoError(t, err)
	header, err := json.Marshal(lines[0])
	require.NoError(t, err)
	require.JSONEq(t, `{"kind":"header","config":`+string(config)+`,"candidate_count":5,"refused":false}`, string(header))
	require.Equal(t, map[string]any{"kind": "same", "path": "docs/a.md", "hash": draftHash}, lines[1])
	require.Equal(t, map[string]any{"kind": "skipped", "path": "docs/big.md", "size": 65.0}, lines[2])
	require.Equal(t, map[string]any{"kind": "unreadable", "path": "docs/latin1.md", "reason": "not UTF-8"}, lines[3])
	require.Equal(t, map[string]any{
		"kind": "file", "path": "docs/new.md", "hash": "f676b43bd55f91451babc1663739064a", "content": "# New\n",
	}, lines[4])
	require.Equal(t, map[string]any{"kind": "end", "candidates": 5.0}, lines[6])
}

// `same` stands for exactly one version of a file. A hash that differs by a
// digit, a path spelled another way, and a file have does not name are each
// sent whole; a path in have that is no candidate is ignored.
func TestSameIsOnlyForAnEqualHash(t *testing.T) {
	svc, _ := repo(t, map[string]string{
		"a.md": "test", "b.md": "test", "c.md": "test", "d.md": "test", "notes.txt": "test",
	})
	lines := writeStream(t, svc, repoconfig.DefaultPlanning(), map[string]string{
		"a.md":      testHash,
		"b.md":      testHash[:31] + "6",
		"./c.md":    testHash,
		"notes.txt": testHash,
		"gone.md":   testHash,
	}).lines(t)
	require.Equal(t, []string{"header", "same a.md", "file b.md", "file c.md", "file d.md", "end"}, kinds(lines))
	require.Equal(t, testHash, lines[1]["hash"])
	require.Equal(t, testHash, lines[2]["hash"], "a file line carries the hash the server read")
	require.Equal(t, "test", lines[2]["content"])
}

// A roadmap is never `same`, so whether a file is a roadmap never has to be
// part of what the browser keeps under a hash (design §8.1).
func TestTheRoadmapIsSentWholeWhateverHaveSays(t *testing.T) {
	svc, _ := repo(t, map[string]string{"roadmap.md": "# Roadmap\n", "plans/road.md": "test"})
	cfg := repoconfig.DefaultPlanning()
	have := map[string]string{"roadmap.md": roadmapHash, "plans/road.md": testHash}

	lines := writeStream(t, svc, cfg, have).lines(t)
	require.Equal(t, []string{"header", "same plans/road.md", "file roadmap.md", "end"}, kinds(lines))
	require.Equal(t, "# Roadmap\n", lines[2]["content"])

	cfg.Roadmaps = []string{"plans/road.md"}
	lines = writeStream(t, svc, cfg, have).lines(t)
	require.Equal(t, []string{"header", "file plans/road.md", "same roadmap.md", "end"}, kinds(lines),
		"the listed roadmap, and roadmap.md, which the list leaves out, is an ordinary file")
}

// Every roadmap is sent whole, not only one: each file found by its name, in
// any directory and any case, or each one listed. A path the roadmap test does
// not pick is `same` as any other file is (planning-index-at-scale.md §6.1).
func TestEveryRoadmapIsSentWhole(t *testing.T) {
	svc, _ := repo(t, map[string]string{
		"roadmap.md":            "# Roadmap\n",
		"docs/plans/roadmap.md": "test",
		"docs/Roadmap.md":       "test",
		"docs/a.md":             "test",
	})
	have := map[string]string{
		"roadmap.md": roadmapHash, "docs/plans/roadmap.md": testHash, "docs/Roadmap.md": testHash, "docs/a.md": testHash,
	}
	for _, tc := range []struct {
		name     string
		roadmaps []string
		want     []string
	}{
		{"found by name", nil, []string{"file docs/Roadmap.md", "same docs/a.md", "file docs/plans/roadmap.md", "file roadmap.md"}},
		{"listed, both", []string{"roadmap.md", "docs/plans/roadmap.md"}, []string{"same docs/Roadmap.md", "same docs/a.md", "file docs/plans/roadmap.md", "file roadmap.md"}},
		{"listed, one", []string{"docs/plans/roadmap.md"}, []string{"same docs/Roadmap.md", "same docs/a.md", "file docs/plans/roadmap.md", "same roadmap.md"}},
		{"none", []string{}, []string{"same docs/Roadmap.md", "same docs/a.md", "same docs/plans/roadmap.md", "same roadmap.md"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := repoconfig.DefaultPlanning()
			cfg.Roadmaps = tc.roadmaps
			lines := writeStream(t, svc, cfg, have).lines(t)
			require.Equal(t, append(append([]string{"header"}, tc.want...), "end"), kinds(lines))
			for _, l := range lines {
				if l["kind"] == KindFile {
					require.NotEmpty(t, l["content"], l["path"])
				}
			}
		})
	}
}

// Finding by name looks only among candidates, so `exclude` hides a roadmap
// found by its name, from the stream and from the single-path mode alike. A
// listed one is read whatever the patterns say (Plan Q2, per entry), but only
// if the listing yields it: in a hidden directory it is not read, whatever the
// list says (design §3.1).
func TestExcludeHidesAFoundRoadmapAndNotAListedOne(t *testing.T) {
	svc, _ := repo(t, map[string]string{
		"roadmap.md":          "# Roadmap\n",
		"archive/roadmap.md":  "# Archived\n",
		"plans/roadmap.md":    "# Plans\n",
		".private/roadmap.md": "# Hidden\n",
	})
	cfg := repoconfig.DefaultPlanning()
	cfg.Exclude = []string{"archive/**", "plans/**"}

	lines := writeStream(t, svc, cfg, nil).lines(t)
	require.Equal(t, []string{"header", "file roadmap.md", "end"}, kinds(lines), "found by name, so hidden by exclude")
	require.Equal(t, KindAbsent, Lookup(svc, cfg, "archive/roadmap.md").Kind)
	require.Equal(t, KindAbsent, Lookup(svc, cfg, "plans/roadmap.md").Kind)
	require.Equal(t, KindFile, Lookup(svc, cfg, "roadmap.md").Kind)

	cfg.Roadmaps = []string{"plans/roadmap.md", ".private/roadmap.md"}
	lines = writeStream(t, svc, cfg, nil).lines(t)
	require.Equal(t, []string{"header", "file plans/roadmap.md", "file roadmap.md", "end"}, kinds(lines),
		"listed, so read despite exclude; roadmap.md is still an ordinary candidate; the hidden one is never listed")
	require.Equal(t, 2.0, lines[0]["candidate_count"])
	require.Equal(t, KindFile, Lookup(svc, cfg, "plans/roadmap.md").Kind)
	require.Equal(t, KindAbsent, Lookup(svc, cfg, "archive/roadmap.md").Kind, "not listed, so excluded")
	require.Equal(t, KindAbsent, Lookup(svc, cfg, ".private/roadmap.md").Kind, "listed, but the listing leaves it out")
}

// The header's config is the stream's whole roadmap marking, so `roadmaps` has
// to reach the browser as the resolved table spells it: null, a list, or [],
// each as itself (planning-index-at-scale.md §6.1). No other line gains a field.
func TestTheHeaderCarriesTheRoadmapsAsResolved(t *testing.T) {
	svc, _ := repo(t, map[string]string{"roadmap.md": "# Roadmap\n", "b/roadmap.md": "# B\n"})
	for _, tc := range []struct {
		roadmaps []string
		want     string
	}{
		{nil, `null`},
		{[]string{"b/roadmap.md", "a.md"}, `["b/roadmap.md","a.md"]`},
		{[]string{}, `[]`},
	} {
		cfg := repoconfig.DefaultPlanning()
		cfg.Roadmaps = tc.roadmaps
		body := writeStream(t, svc, cfg, nil).buf.String()
		first, _, _ := strings.Cut(body, "\n")
		var h struct {
			Config map[string]json.RawMessage `json:"config"`
		}
		require.NoError(t, json.Unmarshal([]byte(first), &h))
		require.JSONEq(t, tc.want, string(h.Config["roadmaps"]), "roadmaps %q", tc.roadmaps)
		require.NotContains(t, h.Config, "roadmap", "the one roadmap is gone from the wire")

		for _, l := range decodeLines(t, body)[1:] {
			for key := range l {
				require.Contains(t, []string{"kind", "path", "hash", "content", "size", "reason", "candidates"}, key)
			}
		}
	}
}

// A nil have and an empty one are both a cold build: every text is sent.
func TestWithoutHaveEveryFileIsSentWhole(t *testing.T) {
	svc, _ := repo(t, map[string]string{"a.md": "test", "b.md": "# B\n"})
	for _, have := range []map[string]string{nil, {}} {
		lines := writeStream(t, svc, repoconfig.DefaultPlanning(), have).lines(t)
		require.Equal(t, []string{"header", "file a.md", "file b.md", "end"}, kinds(lines))
	}
}

// Past the limit: the header, then end, and nothing opened — not merely
// nothing sent. A locked candidate proves it where modes are enforced, and
// counting opens proves it everywhere.
func TestARefusedStreamIsTheHeaderThenEndAndOpensNothing(t *testing.T) {
	svc, root := repo(t, map[string]string{"a.md": "test", "b.md": "# B\n", "c.md": "# C\n"})
	require.NoError(t, os.Chmod(filepath.Join(root, "c.md"), 0o000))
	t.Cleanup(func() { _ = os.Chmod(filepath.Join(root, "c.md"), 0o644) })
	cfg := repoconfig.DefaultPlanning()
	cfg.MaxCandidates = 2
	opened := countOpens(t)

	s := writeStream(t, svc, cfg, map[string]string{"a.md": testHash})
	lines := s.lines(t)
	require.Equal(t, []string{"header", "end"}, kinds(lines))
	require.Equal(t, true, lines[0]["refused"])
	require.Equal(t, 3.0, lines[0]["candidate_count"])
	require.Equal(t, 3.0, lines[1]["candidates"])
	require.Empty(t, *opened)
	require.Equal(t, []string{"write", "flush", "write"}, s.events, "the header is flushed even when refused")
}

// At the limit the stream is served.
func TestAtMaxCandidatesTheStreamIsServed(t *testing.T) {
	svc, _ := repo(t, map[string]string{"a.md": "# A\n", "b.md": "# B\n"})
	cfg := repoconfig.DefaultPlanning()
	cfg.MaxCandidates = 2
	lines := writeStream(t, svc, cfg, nil).lines(t)
	require.Equal(t, []string{"header", "file a.md", "file b.md", "end"}, kinds(lines))
	require.Equal(t, false, lines[0]["refused"])
}

// A candidate deleted between the listing and its read has no line: nothing is
// wrong with a file that is gone, and the watcher reports its removal. It still
// counts as a candidate, since the listing named it.
func TestACandidateThatVanishesHasNoLine(t *testing.T) {
	svc, root := repo(t, map[string]string{"a.md": "# A\n", "gone.md": "# Gone\n"})
	listing := vanishing{svc, filepath.Join(root, "gone.md")}

	lines := writeStream(t, listing, repoconfig.DefaultPlanning(), nil).lines(t)
	require.Equal(t, []string{"header", "file a.md", "end"}, kinds(lines))
	require.Equal(t, 2.0, lines[0]["candidate_count"])
}

// The header reaches the client before the first file is even opened, so the
// browser has the config and the candidate count while the server reads.
func TestTheHeaderIsFlushedBeforeAnyFileIsRead(t *testing.T) {
	svc, root := repo(t, map[string]string{"a.md": "# A\n", "b.md": "# B\n"})
	var s streamLog
	logOpens(t, &s, root)

	require.NoError(t, NewStream(svc, repoconfig.DefaultPlanning()).Write(context.Background(), &s, nil))
	require.Equal(t, []string{"write", "flush", "open a.md", "write", "open b.md", "write", "write"}, s.events,
		"header, flush, then one read and one line per file, then end")
	first, _, _ := strings.Cut(s.buf.String(), "\n")
	require.True(t, strings.HasPrefix(first, `{"kind":"header",`), first)
}

// The design's D13 bound, proven with both of its numbers configured down: no
// more than 64 KiB and one line is ever written and not flushed, so the server
// never buffers the corpus, whatever its size. Here the 64 KiB is 1 KiB and
// max-file-bytes is 256 B, so a dozen small files force several flushes.
func TestTheStreamFlushesEachTimeItHasWrittenFlushEvery(t *testing.T) {
	prev := flushEvery
	flushEvery = 1 << 10
	t.Cleanup(func() { flushEvery = prev })

	tree := map[string]string{"big.md": strings.Repeat("b", 257)}
	for _, n := range "abcdefghijkl" {
		tree["docs/"+string(n)+".md"] = strings.Repeat(string(n), 200+int(n-'a')*5)
	}
	svc, _ := repo(t, tree)
	cfg := repoconfig.DefaultPlanning()
	cfg.MaxFileBytes = 256

	s := writeStream(t, svc, cfg, nil)
	lines := strings.SplitAfter(s.buf.String(), "\n")
	longest := 0
	for _, l := range lines {
		longest = max(longest, len(l))
	}
	require.Less(t, longest, 256+128, "a line is one file's text and a little more")

	// Replay the events, measuring what was written between flushes.
	unflushed, flushes, next := 0, 0, 0
	for _, e := range s.events {
		switch e {
		case "write":
			unflushed += len(lines[next])
			next++
			require.LessOrEqual(t, unflushed, flushEvery+longest, "written and not flushed")
		case "flush":
			unflushed = 0
			flushes++
		}
	}
	require.Equal(t, len(lines)-1, next, "one write per line")
	require.GreaterOrEqual(t, flushes, 3, "the header's flush and at least two for the files")
	require.Equal(t, `{"kind":"skipped","path":"big.md","size":257}`+"\n", lines[1])
}

// A client that goes away stops the stream: the error is returned, and no
// further file is read for nobody.
func TestTheStreamStopsWhenTheClientGoesAway(t *testing.T) {
	svc, root := repo(t, map[string]string{"a.md": "# A\n", "b.md": "# B\n", "c.md": "# C\n"})
	opened := countOpens(t)

	// The header and a.md are delivered; b.md is read and cannot be.
	err := NewStream(svc, repoconfig.DefaultPlanning()).Write(context.Background(), &failingFlusher{failingWriter{after: 2}}, nil)
	require.Error(t, err)
	require.Equal(t, []string{filepath.Join(root, "a.md"), filepath.Join(root, "b.md")}, *opened,
		"the stream stopped at the first line it could not deliver")
}

// A flush that fails is the client going away too.
func TestTheStreamStopsWhenAFlushFails(t *testing.T) {
	svc, _ := repo(t, map[string]string{"a.md": "# A\n"})
	opened := countOpens(t)
	err := NewStream(svc, repoconfig.DefaultPlanning()).Write(context.Background(), brokenFlush{}, nil)
	require.Error(t, err)
	require.Empty(t, *opened, "nothing is read after the header could not be flushed")
}

// cancelAtFlush is a streamLog that ends the request's context at its first
// flush, as a client does that leaves once it has the header.
type cancelAtFlush struct {
	streamLog
	cancel context.CancelFunc
}

func (c *cancelAtFlush) Flush() error {
	c.cancel()
	return c.streamLog.Flush()
}

// The request's context ending stops the reading before the next candidate,
// however many lines the writer below would still accept. Behind gzip no write
// fails until the next 64 KiB flush, so a failed write alone would read a small
// repository's whole corpus for a client that has gone (design §6.1).
func TestTheStreamStopsWhenItsContextEnds(t *testing.T) {
	svc, root := repo(t, map[string]string{"a.md": "# A\n", "b.md": "# B\n", "c.md": "# C\n"})
	have := map[string]string{"b.md": testHash}

	// Gone once the header is flushed: nothing is opened at all.
	ctx, cancel := context.WithCancel(context.Background())
	s := &cancelAtFlush{cancel: cancel}
	logOpens(t, &s.streamLog, root)
	err := NewStream(svc, repoconfig.DefaultPlanning()).Write(ctx, s, have)
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, []string{"write", "flush"}, s.events, "the header, and no file opened after it")

	// Gone while a.md is read: its line is written, and b.md is never opened.
	ctx, cancel = context.WithCancel(context.Background())
	var mid streamLog
	logOpens(t, &mid, root)
	logged := openFile
	openFile = func(name string) (*os.File, error) {
		cancel()
		return logged(name)
	}
	t.Cleanup(func() { openFile = logged })
	err = NewStream(svc, repoconfig.DefaultPlanning()).Write(ctx, &mid, have)
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, []string{"write", "flush", "open a.md", "write"}, mid.events)
}

// Wants accepts only an entry that could make a line `same`, so a have kept to
// what it accepts writes the very stream the whole have writes. That is what
// lets the handler drop the rest as it reads the body (design §6.4).
func TestWantsKeepsOnlyWhatCouldBeSame(t *testing.T) {
	svc, _ := repo(t, map[string]string{
		"roadmap.md": "# Roadmap\n", "a.md": "test", "b.md": "test", "notes.txt": "test",
	})
	cfg := repoconfig.DefaultPlanning()
	stream := NewStream(svc, cfg)
	require.True(t, stream.Wants("a.md", testHash))
	require.True(t, stream.Wants("b.md", draftHash), "a hash that does not match is still a hash")
	for _, entry := range [][2]string{
		{"roadmap.md", roadmapHash},         // the roadmap is never same
		{"notes.txt", testHash},             // not a candidate
		{"gone.md", testHash},               // not listed
		{"./a.md", testHash},                // spelled another way
		{"a.md", testHash[:31]},             // too short
		{"a.md", testHash + "0"},            // too long
		{"a.md", strings.ToUpper(testHash)}, // not lowercase
		{"a.md", testHash[:31] + "g"},       // not hex
	} {
		require.False(t, stream.Wants(entry[0], entry[1]), "%q: %q", entry[0], entry[1])
	}

	refusing := cfg
	refusing.MaxCandidates = 2
	require.False(t, NewStream(svc, refusing).Wants("a.md", testHash), "a refused stream reads no have")

	have := map[string]string{
		"a.md": testHash, "b.md": testHash[:31] + "6", "roadmap.md": roadmapHash,
		"notes.txt": testHash, "gone.md": testHash, "./b.md": testHash, "a.MD": "X",
	}
	kept := map[string]string{}
	for path, hash := range have {
		if stream.Wants(path, hash) {
			kept[path] = hash
		}
	}
	require.Equal(t, map[string]string{"a.md": testHash, "b.md": testHash[:31] + "6"}, kept)
	require.Equal(t, writeStream(t, svc, cfg, have).buf.String(), writeStream(t, svc, cfg, kept).buf.String())
}

// Wants refuses every roadmap, found by name or listed, since no roadmap is
// ever `same`: its `have` entry could change nothing the stream writes. A path
// the roadmap test does not pick is wanted as any candidate is.
func TestWantsRefusesEveryRoadmap(t *testing.T) {
	svc, _ := repo(t, map[string]string{
		"roadmap.md": "# Roadmap\n", "docs/plans/ROADMAP.md": "test", "notes/next.md": "test", "a.md": "test",
	})
	for _, tc := range []struct {
		name     string
		roadmaps []string
		exclude  []string
		refused  []string
		wanted   []string
	}{
		{"found by name", nil, []string{}, []string{"roadmap.md", "docs/plans/ROADMAP.md"}, []string{"notes/next.md", "a.md"}},
		// Excluded, so a candidate only because it is listed.
		{"listed", []string{"notes/next.md"}, []string{"notes/**"}, []string{"notes/next.md"}, []string{"roadmap.md", "docs/plans/ROADMAP.md", "a.md"}},
		{"none", []string{}, []string{}, nil, []string{"roadmap.md", "docs/plans/ROADMAP.md", "notes/next.md", "a.md"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := repoconfig.DefaultPlanning()
			cfg.Roadmaps = tc.roadmaps
			cfg.Exclude = tc.exclude
			stream := NewStream(svc, cfg)
			for _, path := range tc.refused {
				require.False(t, stream.Wants(path, testHash), "%q is a roadmap", path)
			}
			for _, path := range tc.wanted {
				require.True(t, stream.Wants(path, testHash), "%q is no roadmap", path)
			}
		})
	}
}

// A candidate whose name is not UTF-8, which Linux allows, is unreadable and
// never opened. JSON would carry its name with U+FFFD for each invalid byte, so
// as a file it would be kept under a path no lookup finds and never be `same`,
// and two such names would be one path. As unreadable it is listed under
// *Could not read* and nothing is kept for it.
func TestANameThatIsNotUTF8IsUnreadable(t *testing.T) {
	svc, root := repo(t, map[string]string{"a.md": "# A\n"})
	for _, name := range []string{"caf\xe9.md", "caf\xe8.md"} {
		// Text that is UTF-8, so the name is all that is wrong with the file.
		if err := os.WriteFile(filepath.Join(root, name), []byte("# One\n"), 0o644); err != nil {
			t.Skipf("this file system refuses a name that is not UTF-8: %v", err)
		}
	}
	cfg := repoconfig.DefaultPlanning()
	opened := countOpens(t)

	const shown = "caf\uFFFD.md"
	for _, have := range []map[string]string{nil, {shown: testHash}} {
		lines := writeStream(t, svc, cfg, have).lines(t)
		require.Equal(t, []string{"header", "file a.md", "unreadable " + shown, "unreadable " + shown, "end"}, kinds(lines))
		for _, line := range lines[2:4] {
			require.Equal(t, map[string]any{"kind": "unreadable", "path": shown, "reason": "its name is not UTF-8"}, line)
		}
		require.Equal(t, 3.0, lines[0]["candidate_count"])
	}
	require.Equal(t, []string{filepath.Join(root, "a.md"), filepath.Join(root, "a.md")}, *opened,
		"only a.md, once per stream")

	require.Equal(t, Entry{Path: "caf\xe9.md", Kind: KindUnreadable, Reason: "its name is not UTF-8"},
		Lookup(svc, cfg, "caf\xe9.md"))
	require.Equal(t, KindAbsent, Lookup(svc, cfg, shown).Kind, "the name the browser holds is no file")
}

// failingFlusher is a failingWriter whose flushes succeed, so only its writes fail.
type failingFlusher struct{ failingWriter }

func (f *failingFlusher) Flush() error { return nil }

type brokenFlush struct{}

func (brokenFlush) Write(p []byte) (int, error) { return len(p), nil }
func (brokenFlush) Flush() error                { return errors.New("client went away") }

// testdata/stream-lines.ndjson is one whole stream holding one line of every
// kind. The viewer's reader parses each of its lines (frontend
// planningScan tests), so this file holds the writer and the reader to one
// shape, as internal/repoconfig/testdata/planning-patterns.json holds the two
// matchers to one answer. It is compared byte for byte, so an edit to the
// writer that changes a byte on the wire has to change the file, and with it
// the reader's side of the contract.
//
// The tree mirrors the design's example (§6.1): AGENTS.md holds "test" and is
// named by the hash the design shows for it; docs/big.md is over a
// max-file-bytes configured down to 96; the roadmap is named in have by its
// true hash and is sent whole anyway. The file's text carries a newline, a quote, `<`, `>`, `&`
// and characters outside ASCII, so the file pins how each is written.
func TestTheStreamsLinesAreTheSharedExample(t *testing.T) {
	svc, _ := repo(t, map[string]string{
		"AGENTS.md":        "test",
		"docs/design/a.md": "---\nstatus: draft\n---\n\n# A & B\n\n> Café <b>\"quoted\"</b> → done\n",
		"docs/big.md":      strings.Repeat("x", 100),
		"docs/bad.md":      "caf\xe9\n",
		"roadmap.md":       "# Roadmap\n\n- [A](docs/design/a.md)\n",
	})
	cfg := repoconfig.DefaultPlanning()
	cfg.MaxFileBytes = 96
	cfg.Stages = map[string]string{"DECIDED": "ready", "DESIGN": "open"}
	cfg.Exclude = []string{"docs/gallery/**"}
	have := map[string]string{"AGENTS.md": testHash, "roadmap.md": "278a04e4b3509d785c9dbdbabfa4bbea"}

	got := writeStream(t, svc, cfg, have).buf.String()
	want, err := os.ReadFile(filepath.Join("testdata", "stream-lines.ndjson"))
	require.NoError(t, err)
	require.Equal(t, strings.Split(string(want), "\n"), strings.Split(got, "\n"))

	seen := map[string]bool{}
	for _, l := range decodeLines(t, got) {
		seen[l["kind"].(string)] = true
	}
	for _, kind := range []string{KindHeader, KindSame, KindFile, KindSkipped, KindUnreadable, KindEnd} {
		require.True(t, seen[kind], "the example lost its %q line", kind)
	}
}
