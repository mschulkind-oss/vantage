package repoconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// write puts a config file in a fresh repository root and returns the root.
//
// The fixture is written with this package's real FileName, which is safe *here*
// because nothing walks up out of a temp directory looking for one. Fixtures that
// live in the repository tree must never be called that: `vantage-check` finds
// `.vantage.toml` by walking up from any document below it, so a committed one
// would silently retune the documentation gate.
func write(t *testing.T, body string) string {
	t.Helper()
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, FileName), []byte(body), 0o644))
	return root
}

func TestParseReadsTheStarredTable(t *testing.T) {
	s, err := Parse([]byte("[starred]\npromote = [\"roadmap.md\", \"docs/*.md\"]\n"))
	require.NoError(t, err)
	require.Equal(t, []string{"roadmap.md", "docs/*.md"}, s.Starred.Promote)
	require.False(t, s.IsZero())
}

// The theme a repository offers is a top-level key, so a file that says only
// that is still a file the server acts on.
func TestParseReadsTheThemeKey(t *testing.T) {
	s, err := Parse([]byte("theme = \"catppuccin\"\n"))
	require.NoError(t, err)
	require.Equal(t, "catppuccin", s.Theme)
	require.False(t, s.IsZero(),
		"a repository offering a theme and nothing else must not read as empty")
}

// TOML puts a bare key after a table header *inside* that table, so a theme
// written below `[check]` is `check.theme` and not ours at all. That trap is
// pinned here because it is the mistake a reader of this file will make, and
// because the other reader of the file is what catches it: `vantage-check`
// polices its own table's keys, so `check.theme` fails a run loudly rather than
// doing nothing.
func TestAThemeUnderTheCheckersTableIsNotOurs(t *testing.T) {
	s, err := Parse([]byte("[check]\nstrict = true\ntheme = \"catppuccin\"\n"))
	require.NoError(t, err, "another tool's keys are not ours to reject")
	require.Empty(t, s.Theme)
}

// Guessing at a shape that does not exist has to be an error rather than a key
// that quietly does nothing, which is the discipline the `[starred]` table holds.
// Here it is the decoder's type check that says so, not the unknown-key branch,
// because `theme` is a scalar the decoder consumes either way.
func TestParseRejectsAThemeTable(t *testing.T) {
	for name, body := range map[string]string{
		"table":  "[theme]\nname = \"catppuccin\"\n",
		"dotted": "theme.name = \"catppuccin\"\n",
	} {
		t.Run(name, func(t *testing.T) {
			s, err := Parse([]byte(body))
			require.Error(t, err)
			require.True(t, s.IsZero(), "a rejected file must yield nothing, not half")
		})
	}
}

// The whole point of sharing the file: the checker's table is not ours to read,
// and it is not ours to reject either.
func TestParseReadsPastTheCheckersTable(t *testing.T) {
	s, err := Parse([]byte("[check]\nstrict = true\n\n[check.rules]\n\"link/x\" = \"off\"\n"))
	require.NoError(t, err)
	require.True(t, s.IsZero())
}

// Nor another tool's.
func TestParseReadsPastAnotherToolsTable(t *testing.T) {
	s, err := Parse([]byte("[tool.ruff]\nline-length = 100\n\n[starred]\npromote = [\"a.md\"]\n"))
	require.NoError(t, err)
	require.Equal(t, []string{"a.md"}, s.Starred.Promote)
}

// Inside our own table, a typo is an error. `promotes = [...]` doing nothing at
// all with no way to find out is the silence this package exists to break.
func TestParseRejectsAnUnknownKeyInOurTable(t *testing.T) {
	_, err := Parse([]byte("[starred]\npromotes = [\"roadmap.md\"]\n"))
	require.Error(t, err)
	require.Contains(t, err.Error(), "unknown key")
	require.Contains(t, err.Error(), "starred.promotes")
}

func TestParseRejectsBadSyntaxAndTypes(t *testing.T) {
	for name, body := range map[string]string{
		"syntax":         "[starred\npromote = []\n",
		"wrong type":     "[starred]\npromote = \"roadmap.md\"\n",
		"duplicate key":  "[starred]\npromote = [\"a\"]\npromote = [\"b\"]\n",
		"element type":   "[starred]\npromote = [1, 2]\n",
		"table not list": "[starred]\n[starred.promote]\na = 1\n",
		"theme type":     "theme = 7\n",
		"theme list":     "theme = [\"catppuccin\"]\n",
	} {
		t.Run(name, func(t *testing.T) {
			s, err := Parse([]byte(body))
			require.Error(t, err)
			require.True(t, s.IsZero(), "a rejected file must yield nothing, not half")
		})
	}
}

func TestMissingFileIsNotAnError(t *testing.T) {
	c := New(t.TempDir())
	s, err := c.Settings()
	require.NoError(t, err)
	require.True(t, s.IsZero())
}

func TestSettingsSurfacesTheParseError(t *testing.T) {
	c := New(write(t, "[starred]\npromotes = [\"a.md\"]\n"))
	s, err := c.Settings()
	require.Error(t, err)
	require.True(t, s.IsZero(),
		"a repository with a bad config is served as if it had none")
}

// A directory, a symlink, or a device where the config should be. os.ReadFile
// would follow the symlink and read whatever it points at.
func TestReadRefusesWhatIsNotARegularFile(t *testing.T) {
	t.Run("directory", func(t *testing.T) {
		root := t.TempDir()
		require.NoError(t, os.MkdirAll(filepath.Join(root, FileName), 0o755))
		_, err := New(root).Settings()
		require.Error(t, err)
		require.Contains(t, err.Error(), "not a regular file")
	})

	t.Run("symlink", func(t *testing.T) {
		root := t.TempDir()
		secret := filepath.Join(t.TempDir(), "secret.toml")
		require.NoError(t, os.WriteFile(secret, []byte("[starred]\npromote = [\"leaked.md\"]\n"), 0o600))
		require.NoError(t, os.Symlink(secret, filepath.Join(root, FileName)))

		s, err := New(root).Settings()
		require.Error(t, err)
		require.Contains(t, err.Error(), "not a regular file")
		require.True(t, s.IsZero(), "a symlinked config must not be read through")
	})
}

func TestReadRefusesAnOversizedFile(t *testing.T) {
	root := t.TempDir()
	body := "[starred]\npromote = [\"" + strings.Repeat("x", maxSize) + "\"]\n"
	require.NoError(t, os.WriteFile(filepath.Join(root, FileName), []byte(body), 0o644))

	_, err := New(root).Settings()
	require.Error(t, err)
	require.Contains(t, err.Error(), "larger than")
}

// The throttle exists so /starred does not stat once per repository per request.
// It has to be a throttle and not a cache: an edit must land eventually.
func TestReloadIsThrottledThenPicksTheEditUp(t *testing.T) {
	root := write(t, "[starred]\npromote = [\"first.md\"]\n")
	c := New(root)

	clock := time.Unix(1700000000, 0)
	c.now = func() time.Time { return clock }

	s, err := c.Settings()
	require.NoError(t, err)
	require.Equal(t, []string{"first.md"}, s.Starred.Promote)

	require.NoError(t, os.WriteFile(filepath.Join(root, FileName),
		[]byte("[starred]\npromote = [\"second.md\"]\n"), 0o644))

	// Inside the interval: the edit is not looked for.
	s, err = c.Settings()
	require.NoError(t, err)
	require.Equal(t, []string{"first.md"}, s.Starred.Promote)

	clock = clock.Add(reloadInterval + time.Second)
	s, err = c.Settings()
	require.NoError(t, err)
	require.Equal(t, []string{"second.md"}, s.Starred.Promote)
}

// A file that appears after the server started, and one that is deleted.
func TestReloadNoticesTheFileAppearingAndVanishing(t *testing.T) {
	root := t.TempDir()
	c := New(root)
	clock := time.Unix(1700000000, 0)
	c.now = func() time.Time { return clock }

	s, err := c.Settings()
	require.NoError(t, err)
	require.True(t, s.IsZero())

	path := filepath.Join(root, FileName)
	require.NoError(t, os.WriteFile(path, []byte("[starred]\npromote = [\"a.md\"]\n"), 0o644))
	clock = clock.Add(reloadInterval + time.Second)
	s, err = c.Settings()
	require.NoError(t, err)
	require.Equal(t, []string{"a.md"}, s.Starred.Promote)

	require.NoError(t, os.Remove(path))
	clock = clock.Add(reloadInterval + time.Second)
	s, err = c.Settings()
	require.NoError(t, err)
	require.True(t, s.IsZero(), "removing the file must clear what it said")
}

// An edit that keeps the same mtime — a coarse-timestamped filesystem, or two
// writes inside one tick — must still be noticed when the length changes.
func TestReloadNoticesASameMtimeEdit(t *testing.T) {
	root := write(t, "[starred]\npromote = [\"a.md\"]\n")
	path := filepath.Join(root, FileName)
	c := New(root)
	clock := time.Unix(1700000000, 0)
	c.now = func() time.Time { return clock }

	_, err := c.Settings()
	require.NoError(t, err)

	info, err := os.Stat(path)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, []byte("[starred]\npromote = [\"a.md\", \"b.md\"]\n"), 0o644))
	require.NoError(t, os.Chtimes(path, info.ModTime(), info.ModTime()))

	clock = clock.Add(reloadInterval + time.Second)
	s, err := c.Settings()
	require.NoError(t, err)
	require.Len(t, s.Starred.Promote, 2)
}

func TestGetCachesPerRootAndClearCacheDrops(t *testing.T) {
	t.Cleanup(ClearCache)
	root := t.TempDir()

	a := Get(root)
	require.Same(t, a, Get(root), "the throttle is per-Config, so it must be shared")
	require.Same(t, a, Get(root+string(filepath.Separator)+"."), "keyed by the cleaned path")
	require.NotSame(t, a, Get(t.TempDir()))

	ClearCache()
	require.NotSame(t, a, Get(root))
}

func TestPathNamesTheSharedFile(t *testing.T) {
	root := t.TempDir()
	require.Equal(t, filepath.Join(root, ".vantage.toml"), New(root).Path())
}

// The Go half of the shared-file conformance check. Its sibling lives in
// packages/vantage-check/test/config.test.ts and parses the same bytes.
//
// One fixture rather than two copies, because the property under test is that the
// two readers agree about one file. Two fixtures would let them drift apart while
// both suites stayed green, which is exactly the failure sharing a file invites.
func TestSharedFixtureIsReadableByThisReader(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "shared-config.toml"))
	require.NoError(t, err)

	s, err := Parse(data)
	require.NoError(t, err, "the checker's own sections, and its target, must not make this file unreadable")
	require.Contains(t, string(data), "\ntarget = \"0.8\"\n", "the fixture must hold the checker's top-level key")
	require.Equal(t, []string{"roadmap.md", "docs/design/*.md"}, s.Starred.Promote)

	// [planning] is the table both readers parse, so this half asserts all of
	// it, not only the keys the server acts on.
	// Its roadmap is written as a string, which is a list of one.
	require.Equal(t, Planning{
		Roadmaps:      []string{"plans/ROADMAP.md"},
		Include:       []string{"docs/**", "plans/**"},
		Exclude:       []string{"docs/gallery/**"},
		MaxFileBytes:  65536,
		MaxCandidates: 250,
		Stages: map[string]string{
			"DRAFTED": "open", "SETTLED": "ready", "SHIPPED": "built", "RETIRED": "done",
		},
	}, s.Planning.Resolved())
}

// planningConfigCase is one row of testdata/planning-config.json. `planning` is
// vantage-md's PlanningConfig, camelCased, which is the checker's shape; the
// server's own [Planning] carries the same values under snake_case names.
//
// `roadmaps` is kept raw, so that a case which forgot the key cannot pass for
// one that says `null`: decoded straight into a slice, both would be nil.
type planningConfigCase struct {
	Name     string `json:"name"`
	TOML     string `json:"toml"`
	OK       bool   `json:"ok"`
	Planning *struct {
		Roadmaps      json.RawMessage   `json:"roadmaps"`
		Include       []string          `json:"include"`
		Exclude       []string          `json:"exclude"`
		MaxFileBytes  int64             `json:"maxFileBytes"`
		MaxCandidates int               `json:"maxCandidates"`
		Stages        map[string]string `json:"stages"`
	} `json:"planning"`
}

// The Go half of the [planning] conformance check. vantage-check's config test
// reads the same file, so the two readers accept and refuse exactly the same
// tables and resolve an accepted one to the same values.
func TestPlanningFixtureResolvesAsTheCheckerDoes(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "planning-config.json"))
	require.NoError(t, err)
	var fixture struct {
		Cases []planningConfigCase `json:"cases"`
	}
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.NotEmpty(t, fixture.Cases)

	for _, tc := range fixture.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			s, err := Parse([]byte(tc.TOML))
			if !tc.OK {
				require.Error(t, err)
				require.True(t, s.IsZero(), "a rejected file must yield nothing, not half")
				return
			}
			require.NoError(t, err)
			require.NotNil(t, tc.Planning, "an accepted case must say what it resolves to")
			require.NotEmpty(t, tc.Planning.Roadmaps, "an accepted case must say what roadmaps resolves to, null included")
			// null decodes to a nil slice and [] to an empty one, and the
			// comparison below tells the two apart, as the wire does.
			var roadmaps []string
			require.NoError(t, json.Unmarshal(tc.Planning.Roadmaps, &roadmaps))
			require.Equal(t, Planning{
				Roadmaps:      roadmaps,
				Include:       tc.Planning.Include,
				Exclude:       tc.Planning.Exclude,
				MaxFileBytes:  tc.Planning.MaxFileBytes,
				MaxCandidates: tc.Planning.MaxCandidates,
				Stages:        tc.Planning.Stages,
			}, s.Planning.Resolved())
		})
	}
}

// The fixture's rows that pin the edges this reader is most likely to get wrong
// are asserted to be there, so trimming the fixture cannot quietly drop them.
func TestPlanningFixtureKeepsItsEdgeCases(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "planning-config.json"))
	require.NoError(t, err)
	var fixture struct {
		Cases []planningConfigCase `json:"cases"`
	}
	require.NoError(t, json.Unmarshal(data, &fixture))
	names := map[string]bool{}
	for _, tc := range fixture.Cases {
		names[tc.Name] = true
	}
	for _, want := range []string{
		"an empty [planning.stages] table is no stages",
		"an explicitly empty include is kept, not defaulted",
		"stages that are not a table",
		"a role outside the four",
		"a limit of zero",
		"no [planning] table",
		"a list of roadmaps, in the order written",
		"an empty list names no roadmap",
		"paths that differ only in case are two roadmaps",
		"a list holding a number",
		"a list holding a list",
		"a list naming one path twice",
		"a roadmap written as a table",
		"roadmaps written as an array of tables",
	} {
		require.True(t, names[want], "planning-config.json lost the case %q", want)
	}
}

// versionSkewCase is one row of testdata/version-skew-config.json: how each
// reader answers a file written for another release. Only `server`, and
// `planning` where the server accepts the file, are this reader's half.
type versionSkewCase struct {
	Name     string `json:"name"`
	TOML     string `json:"toml"`
	Server   string `json:"server"`
	Checker  string `json:"checker"`
	Planning *struct {
		Roadmaps      json.RawMessage   `json:"roadmaps"`
		Include       []string          `json:"include"`
		Exclude       []string          `json:"exclude"`
		MaxFileBytes  int64             `json:"maxFileBytes"`
		MaxCandidates int               `json:"maxCandidates"`
		Stages        map[string]string `json:"stages"`
	} `json:"planning"`
}

// The Go half of the version-skew conformance check. vantage-check's config
// test reads the same cases and asserts its own answer to each, which differs
// from this one where the fixture says so: the checker ignores a key it does
// not know with a warning, and the server still refuses the whole file over
// one in a table it owns. The top-level `target` is the checker's, and the
// server steps over it in every form, a malformed one included.
func TestVersionSkewFixtureIsAnsweredAsTheServerShould(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "version-skew-config.json"))
	require.NoError(t, err)
	var fixture struct {
		Cases []versionSkewCase `json:"cases"`
	}
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.NotEmpty(t, fixture.Cases)

	answers := map[string]bool{}
	for _, tc := range fixture.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			answers[tc.Server] = true
			s, err := Parse([]byte(tc.TOML))
			switch tc.Server {
			case "accepts":
				require.NoError(t, err)
			case "refuses":
				require.Error(t, err)
				require.True(t, s.IsZero(), "a rejected file must yield nothing, not half")
				return
			default:
				t.Fatalf("server must be accepts or refuses, not %q", tc.Server)
			}
			if tc.Planning == nil {
				return
			}
			var roadmaps []string
			require.NoError(t, json.Unmarshal(tc.Planning.Roadmaps, &roadmaps))
			require.Equal(t, Planning{
				Roadmaps:      roadmaps,
				Include:       tc.Planning.Include,
				Exclude:       tc.Planning.Exclude,
				MaxFileBytes:  tc.Planning.MaxFileBytes,
				MaxCandidates: tc.Planning.MaxCandidates,
				Stages:        tc.Planning.Stages,
			}, s.Planning.Resolved())
		})
	}
	require.True(t, answers["accepts"] && answers["refuses"], "the fixture must hold both answers")
}

// The cases the version-skew fixture exists for are asserted to be there, so
// trimming it cannot quietly drop one.
func TestVersionSkewFixtureKeepsItsEdgeCases(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "version-skew-config.json"))
	require.NoError(t, err)
	var fixture struct {
		Cases []versionSkewCase `json:"cases"`
	}
	require.NoError(t, json.Unmarshal(data, &fixture))
	byName := map[string]versionSkewCase{}
	for _, tc := range fixture.Cases {
		byName[tc.Name] = tc
	}
	for name, want := range map[string]string{
		"a target above every table":       "accepts",
		"a target written as a number":     "accepts",
		"a target below [check]":           "accepts",
		"a target below [planning]":        "refuses",
		"a target below [planning.stages]": "refuses",
		"an unknown [check] key":           "accepts",
		"an unknown rule":                  "accepts",
		"an unknown key":                   "refuses",
		"an unknown sub-table":             "refuses",
		"an unknown [starred] key":         "refuses",
	} {
		tc, ok := byName[name]
		require.True(t, ok, "version-skew-config.json lost the case %q", name)
		require.Equal(t, want, tc.Server, name)
	}
}

// The top-level `target` is the checker's key (docs/design/checker-version-skew.md
// §4.1): the server accepts a file that holds one, in any form, and reads
// nothing from it. A misplaced one is another matter, and the fixture above
// pins that.
func TestParseStepsOverTheTarget(t *testing.T) {
	for _, body := range []string{
		"target = \"0.8\"\n",
		"target = \"0.8.1\"\n",
		"target = 0.8\n",
		"target = \"latest\"\n",
		"[target]\nversion = \"0.8\"\n",
	} {
		s, err := Parse([]byte(body))
		require.NoError(t, err, body)
		require.True(t, s.IsZero(), "%q: the server acts on nothing in it", body)
	}

	s, err := Parse([]byte("target = \"0.9\"\ntheme = \"catppuccin\"\n\n[starred]\npromote = [\"a.md\"]\n"))
	require.NoError(t, err)
	require.Equal(t, "catppuccin", s.Theme)
	require.Equal(t, []string{"a.md"}, s.Starred.Promote)
}

// A rejected [planning] table takes the rest of the file with it, [starred] and
// `theme` included: whole-or-nothing is this file's discipline, and a planning
// typo is no exception to it.
func TestABadPlanningTableRejectsTheWholeFile(t *testing.T) {
	s, err := Parse([]byte("theme = \"catppuccin\"\n\n[starred]\npromote = [\"a.md\"]\n\n[planning]\nmax-candidates = 0\n"))
	require.Error(t, err)
	require.Contains(t, err.Error(), "planning.max-candidates")
	require.True(t, s.IsZero())
	require.Equal(t, DefaultPlanning(), s.Planning.Resolved(),
		"a refused file is served with the defaults")
}

// `stages` has to be a table whatever TOML spelling reaches it. The fixture pins
// the array case, which the decoder accepts silently; an array of tables is the
// other shape a guess could take, and an inline table is simply a table.
func TestPlanningStagesMustBeATable(t *testing.T) {
	for name, body := range map[string]string{
		"array":           "[planning]\nstages = [\"DESIGN\"]\n",
		"array of tables": "[[planning.stages]]\nDESIGN = \"open\"\n",
		"empty array":     "[planning]\nstages = []\n",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := Parse([]byte(body))
			require.Error(t, err)
		})
	}

	s, err := Parse([]byte("[planning]\nstages = { DESIGN = \"open\" }\n"))
	require.NoError(t, err)
	require.Equal(t, map[string]string{"DESIGN": "open"}, s.Planning.Resolved().Stages)
}

// A file that says only [planning] is a file the server acts on.
func TestAPlanningTableAloneIsNotEmpty(t *testing.T) {
	s, err := Parse([]byte("[planning]\nexclude = [\"docs/gallery/**\"]\n"))
	require.NoError(t, err)
	require.False(t, s.IsZero())

	s, err = Parse([]byte("[planning]\n\n[planning.stages]\n"))
	require.NoError(t, err)
	require.True(t, s.IsZero(), "an empty table resolves to the defaults, so it said nothing")
}

// The endpoint marshals the resolved table directly, and its contract is that
// lists are `[]` and never `null`, and that one caller cannot edit another's
// defaults through the slices it was handed.
func TestResolvedPlanningListsAreFreshAndNeverNil(t *testing.T) {
	a := PlanningSettings{}.Resolved()
	require.NotNil(t, a.Include)
	require.NotNil(t, a.Exclude)
	a.Include[0] = "edited"
	require.Equal(t, []string{"**/*.md"}, PlanningSettings{}.Resolved().Include)

	empty := []string{}
	b := PlanningSettings{Include: &empty}.Resolved()
	require.NotNil(t, b.Include)
	require.Empty(t, b.Include)

	body, err := json.Marshal(PlanningSettings{}.Resolved())
	require.NoError(t, err)
	require.JSONEq(t, `{"roadmaps":null,"include":["**/*.md"],"exclude":[],
		"max_file_bytes":1048576,"max_candidates":5000,"stages":null}`, string(body))
}

// `roadmaps` has three meanings on the wire, and each keeps its own spelling
// through Resolved: null finds roadmaps by name, [] names none, and a list names
// exactly those. Turning [] into null would switch finding by name back on for
// a repository that asked for no roadmap at all.
func TestResolvedRoadmapsKeepNullEmptyAndAListApart(t *testing.T) {
	for toml, want := range map[string]string{
		"[planning]\n":                                           `null`,
		"[planning]\nroadmap = []\n":                             `[]`,
		"[planning]\nroadmap = \"./plans/roadmap.md\"\n":         `["plans/roadmap.md"]`,
		"[planning]\nroadmap = [\"b.md\", \"./a/roadmap.md\"]\n": `["b.md","a/roadmap.md"]`,
	} {
		s, err := Parse([]byte(toml))
		require.NoError(t, err, toml)
		body, err := json.Marshal(s.Planning.Resolved().Roadmaps)
		require.NoError(t, err)
		require.JSONEq(t, want, string(body), toml)
	}

	s, err := Parse([]byte("[planning]\nroadmap = []\n"))
	require.NoError(t, err)
	require.False(t, s.IsZero(), "naming no roadmap is not saying nothing")

	listed, err := Parse([]byte("[planning]\nroadmap = [\"a.md\"]\n"))
	require.NoError(t, err)
	first := listed.Planning.Resolved()
	first.Roadmaps[0] = "edited.md"
	require.Equal(t, []string{"a.md"}, listed.Planning.Resolved().Roadmaps, "a caller cannot edit another's list")
}

// Every refused roadmap names the key, the entry's position counted from 1 and
// its value, whether the path breaks a rule or the entry is no text at all
// (docs/reference/planning-index.md §14). The string form is a list of one,
// so it is entry 1.
func TestARefusedRoadmapNamesTheEntryAndItsValue(t *testing.T) {
	for toml, want := range map[string][]string{
		"[planning]\nroadmap = \"../r.md\"\n":                           {"planning.roadmap", "entry 1", `"../r.md"`, "must not leave the repository"},
		"[planning]\nroadmap = [\"roadmap.md\", \"\"]\n":                {"planning.roadmap", "entry 2", `""`, "must name a file"},
		"[planning]\nroadmap = [\"./\"]\n":                              {"planning.roadmap", "entry 1", `"./"`, "must name a file"},
		"[planning]\nroadmap = [\"a.md\", \"/roadmap.md\"]\n":           {"planning.roadmap", "entry 2", `"/roadmap.md"`, "relative to the repository root"},
		"[planning]\nroadmap = [\"a.md\", \"docs/../a.md\"]\n":          {"planning.roadmap", "entry 2", `"docs/../a.md"`, "must not leave the repository"},
		"[planning]\nroadmap = [\"plans/r.md\", \"./plans/r.md\"]\n":    {"planning.roadmap", "entry 2", `"./plans/r.md"`, "entry 1"},
		"[planning]\nroadmap = [\"roadmap.md\", 3]\n":                   {"planning.roadmap", "entry 2", "3", "not text"},
		"[planning]\nroadmap = [[\"roadmap.md\"]]\n":                    {"planning.roadmap", "entry 1", `["roadmap.md"]`, "not text"},
		"[planning]\nroadmap = [\"a.md\", { path = \"roadmap.md\" }]\n": {"planning.roadmap", "entry 2", "not text"},
		"[planning]\nroadmap = { path = \"roadmap.md\" }\n":             {"planning.roadmap", "a path or a list of paths", "table"},
		"[[planning.roadmap]]\npath = \"roadmap.md\"\n":                 {"planning.roadmap", "a path or a list of paths", "array of tables"},
		"[planning]\nroadmap = true\n":                                  {"planning.roadmap", "a path or a list of paths", "true"},
		"[planning]\nroadmap = 3\n":                                     {"planning.roadmap", "a path or a list of paths", "3"},
	} {
		s, err := Parse([]byte(toml))
		require.Error(t, err, toml)
		require.True(t, s.IsZero(), "a rejected file must yield nothing, not half: %s", toml)
		for _, fragment := range want {
			require.Contains(t, err.Error(), fragment, toml)
		}
	}
}

// roadmapsCase is one row of testdata/planning-roadmaps.json. `roadmaps` null
// decodes to a nil slice and [] to an empty one, which is the distinction the
// rows exist to pin.
type roadmapsCase struct {
	Roadmaps  []string `json:"roadmaps"`
	Include   []string `json:"include"`
	Exclude   []string `json:"exclude"`
	Path      string   `json:"path"`
	Candidate bool     `json:"candidate"`
	Roadmap   bool     `json:"roadmap"`
}

func loadRoadmapsFixture(t *testing.T) []roadmapsCase {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "planning-roadmaps.json"))
	require.NoError(t, err)
	var f struct {
		Cases []roadmapsCase `json:"cases"`
	}
	require.NoError(t, json.Unmarshal(data, &f))
	require.NotEmpty(t, f.Cases)
	return f.Cases
}

// The roadmap test's half of testdata/planning-roadmaps.json. The candidate
// half is the matcher's, and internal/planning asserts it; vantage-md's
// isRoadmapPath is held to the same rows.
func TestIsRoadmapGivesTheRoadmapsFixturesAnswers(t *testing.T) {
	for _, tc := range loadRoadmapsFixture(t) {
		cfg := Planning{Roadmaps: tc.Roadmaps, Include: tc.Include, Exclude: tc.Exclude}
		require.Equal(t, tc.Roadmap, cfg.IsRoadmap(tc.Path), "roadmaps %q, path %q", tc.Roadmaps, tc.Path)
	}
}

// The fixture's rows are only worth what they cover, so the ones that pin the
// test's edges are asserted to be there: found by name with any case in the
// name, a directory named roadmap.md, a non-ASCII letter no ASCII fold
// reaches, a listed path compared exactly, and [] naming none.
func TestTheRoadmapsFixtureKeepsItsEdges(t *testing.T) {
	type key struct {
		mode string
		path string
	}
	seen := map[key]bool{}
	for _, tc := range loadRoadmapsFixture(t) {
		mode := "listed"
		switch {
		case tc.Roadmaps == nil:
			mode = "by name"
		case len(tc.Roadmaps) == 0:
			mode = "none"
		}
		seen[key{mode, tc.Path}] = tc.Roadmap
	}
	for k, want := range map[key]bool{
		{"by name", "ROADMAP.md"}:          true,
		{"by name", "docs/Roadmap.md"}:     true,
		{"by name", "ROADMAP.MD"}:          true,
		{"by name", "roadmap.md/notes.md"}: false,
		{"by name", "my-roadmap.md"}:       false,
		{"by name", "\u0280oadmap.md"}:     false,
		{"listed", "plans/ROADMAP.md"}:     false,
		{"listed", "docs/PLAN.md"}:         true,
		{"none", "roadmap.md"}:             false,
	} {
		got, ok := seen[k]
		require.True(t, ok, "planning-roadmaps.json lost its %s row for %q", k.mode, k.path)
		require.Equal(t, want, got, "%s, %q", k.mode, k.path)
	}
}

// The name is compared ASCII case-insensitively and nothing more, as the
// checker's port compares it: a letter outside ASCII is never folded onto one
// inside it, however alike the two look.
func TestIsRoadmapFoldsASCIIOnly(t *testing.T) {
	byName := Planning{}
	for path, want := range map[string]bool{
		"roadmap.md":       true,
		"RoadMap.MD":       true,
		"a/b/c/ROADMAP.md": true,
		"roadmap.md/":      false,
		"":                 false,
		"roadmap.m":        false,
		"xroadmap.md":      false,
		"roadmap.md.bak":   false,
		`docs\roadmap.md`:  false, // a backslash is a character of the name, as the listing spells it
		"roadmap\u2024md":  false, // ONE DOT LEADER, not a full stop
		"\uff52oadmap.md":  false, // FULLWIDTH LATIN SMALL LETTER R
		"roadmap.\u1e3fd":  false, // LATIN SMALL LETTER M WITH ACUTE
	} {
		require.Equal(t, want, byName.IsRoadmap(path), "%q", path)
	}
	require.Equal(t, "roadmap.md", RoadmapFileName)

	listed := Planning{Roadmaps: []string{"plans/roadmap.md", "docs/PLAN.md"}}
	require.True(t, listed.IsRoadmap("docs/PLAN.md"))
	require.False(t, listed.IsRoadmap("roadmap.md"), "listing turns finding by name off")
	require.False(t, listed.IsRoadmap("Plans/roadmap.md"), "a listed path is compared exactly")
	require.False(t, listed.IsRoadmap("./plans/roadmap.md"))
	require.False(t, Planning{Roadmaps: []string{}}.IsRoadmap("roadmap.md"), "[] names none")
}

// SettingsNow is for the caller answering a change to this very file, so it
// must see an edit that Settings, inside its throttle window, does not.
func TestSettingsNowSeesAnEditInsideTheThrottleWindow(t *testing.T) {
	root := write(t, "[planning]\nroadmap = \"first.md\"\n")
	c := New(root)
	clock := time.Unix(1700000000, 0)
	c.now = func() time.Time { return clock }

	s, err := c.Settings()
	require.NoError(t, err)
	require.Equal(t, []string{"first.md"}, s.Planning.Resolved().Roadmaps)

	require.NoError(t, os.WriteFile(filepath.Join(root, FileName),
		[]byte("[planning]\nroadmap = \"second.md\"\n"), 0o644))

	s, err = c.Settings()
	require.NoError(t, err)
	require.Equal(t, []string{"first.md"}, s.Planning.Resolved().Roadmaps, "Settings is still throttled")

	s, err = c.SettingsNow()
	require.NoError(t, err)
	require.Equal(t, []string{"second.md"}, s.Planning.Resolved().Roadmaps)

	s, err = c.Settings()
	require.NoError(t, err)
	require.Equal(t, []string{"second.md"}, s.Planning.Resolved().Roadmaps,
		"and what it read is what Settings serves from then on")
}
