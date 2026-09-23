package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/stretchr/testify/require"
)

// themeEnv is a testEnv whose handlers read user themes from a temp directory,
// so no test ever lists the developer's real ~/.config/vantage/themes.
func themeEnv(t *testing.T, defaultTheme string) (*testEnv, string) {
	t.Helper()
	e := newTestEnv(t, false)
	dir := filepath.Join(t.TempDir(), "themes")
	require.NoError(t, os.MkdirAll(dir, 0o755))
	e.h.deps.ThemesDir = dir
	e.h.deps.DefaultTheme = defaultTheme
	return e, dir
}

func writeTheme(t *testing.T, dir, name, css string) {
	t.Helper()
	require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte(css), 0o644))
}

func getTheme(e *testEnv, id string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, "/themes/"+id, nil)
	r.SetPathValue("id", id)
	w := httptest.NewRecorder()
	e.h.ThemeCSS(w, r)
	return w
}

func TestThemesListsCSSFilesSortedByID(t *testing.T) {
	e, dir := themeEnv(t, "")
	writeTheme(t, dir, "zenburn.css", ":root{}")
	writeTheme(t, dir, "catppuccin-mauve.css", ":root{}")
	// Not themes: another extension, a name the id rule refuses, a directory.
	writeTheme(t, dir, "notes.txt", "")
	writeTheme(t, dir, "has space.css", ":root{}")
	require.NoError(t, os.Mkdir(filepath.Join(dir, "folder.css"), 0o755))

	w := e.do(e.h.ThemesList, http.MethodGet, "/themes", "", false)
	require.Equal(t, http.StatusOK, w.Code)

	var got model.ThemeList
	decode(t, w, &got)
	require.Equal(t, []model.ThemeInfo{
		{ID: "catppuccin-mauve", Name: "catppuccin-mauve"},
		{ID: "zenburn", Name: "zenburn"},
	}, got.Themes)
	require.Equal(t, "", got.Default)
}

func TestThemesListReportsConfiguredDefault(t *testing.T) {
	e, _ := themeEnv(t, "catppuccin")
	w := e.do(e.h.ThemesList, http.MethodGet, "/themes", "", false)
	require.Equal(t, http.StatusOK, w.Code)
	// No user themes still marshals as [], and no repository default as {},
	// never null: the frontend spreads the one and indexes the other.
	require.JSONEq(t, `{"default":"catppuccin","themes":[],"repo_defaults":{}}`,
		w.Body.String())
}

func TestThemesListWithNoThemesDirectory(t *testing.T) {
	e, dir := themeEnv(t, "")
	require.NoError(t, os.Remove(dir))
	w := e.do(e.h.ThemesList, http.MethodGet, "/themes", "", false)
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t, `{"default":"","themes":[],"repo_defaults":{}}`, w.Body.String())

	e.h.deps.ThemesDir = "" // no user config directory at all
	w = e.do(e.h.ThemesList, http.MethodGet, "/themes", "", false)
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t, `{"default":"","themes":[],"repo_defaults":{}}`, w.Body.String())
}

func TestThemeCSSServesTheFile(t *testing.T) {
	e, dir := themeEnv(t, "")
	css := ":root { --color-slate-900: #1e1e2e; }\n"
	writeTheme(t, dir, "mocha.css", css)

	w := getTheme(e, "mocha")
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "text/css; charset=utf-8", w.Header().Get("Content-Type"))
	// A theme is edited in place and picked up on reload, so it must not be
	// served from a browser cache.
	require.Equal(t, "no-cache", w.Header().Get("Cache-Control"))
	require.Equal(t, css, w.Body.String())
}

func TestThemeCSSRejectsIDsOutsideTheDirectory(t *testing.T) {
	e, dir := themeEnv(t, "")
	secret := filepath.Join(filepath.Dir(dir), "secret.css")
	require.NoError(t, os.WriteFile(secret, []byte("nope"), 0o644))

	for _, id := range []string{"../secret", "..", "a/b", `a\b`, ".hidden", "", "x.css"} {
		w := getTheme(e, id)
		require.Equal(t, http.StatusNotFound, w.Code, "id %q", id)
		require.NotContains(t, w.Body.String(), "nope", "id %q", id)
	}
}

func TestThemeCSSUnknownTheme(t *testing.T) {
	e, _ := themeEnv(t, "")
	require.Equal(t, http.StatusNotFound, getTheme(e, "missing").Code)

	e.h.deps.ThemesDir = ""
	require.Equal(t, http.StatusNotFound, getTheme(e, "missing").Code)
}

// On macOS's case-folding filesystem a capitalized file used to list under its
// capitalized id — a second "Catppuccin" beside the built-in it was meant to
// replace, and a "Default" past the reserved id — and to be served under any
// spelling. The same files 404'd on Linux.
func TestThemesAreLowercaseAndServedOnlyUnderTheirListedID(t *testing.T) {
	e, dir := themeEnv(t, "")
	writeTheme(t, dir, "Catppuccin.css", ":root{}")
	writeTheme(t, dir, "Default.css", ":root{}")
	writeTheme(t, dir, "Ocean.css", ":root{}")
	writeTheme(t, dir, "mine.css", ":root{}")

	w := e.do(e.h.ThemesList, http.MethodGet, "/themes", "", false)
	var got model.ThemeList
	decode(t, w, &got)
	require.Equal(t, []model.ThemeInfo{{ID: "mine", Name: "mine"}}, got.Themes)

	// Every other spelling is a 404 on every platform, including the ones a
	// case-insensitive open would have resolved.
	for _, id := range []string{"MINE", "Mine", "ocean", "Ocean", "catppuccin", "default"} {
		require.Equal(t, http.StatusNotFound, getTheme(e, id).Code, "id %q", id)
	}
	require.Equal(t, http.StatusOK, getTheme(e, "mine").Code)
}

// The dirent type does not follow symlinks, so filtering on it listed a FIFO
// named x.css — whose read then blocked the request for good — and a symlink
// to a directory. A symlink to a regular file is a theme: that is how a
// dotfiles manager installs one.
func TestThemesAreRegularFilesFollowingSymlinks(t *testing.T) {
	e, dir := themeEnv(t, "")
	outside := t.TempDir()
	linked := filepath.Join(outside, "linked.css")
	require.NoError(t, os.WriteFile(linked, []byte(":root{--x:1}"), 0o644))
	require.NoError(t, os.Symlink(linked, filepath.Join(dir, "linked.css")))
	require.NoError(t, os.Symlink(outside, filepath.Join(dir, "dirlink.css")))
	require.NoError(t, syscall.Mkfifo(filepath.Join(dir, "fifo.css"), 0o644))

	w := e.do(e.h.ThemesList, http.MethodGet, "/themes", "", false)
	var got model.ThemeList
	decode(t, w, &got)
	require.Equal(t, []model.ThemeInfo{{ID: "linked", Name: "linked"}}, got.Themes)

	require.Equal(t, http.StatusNotFound, getTheme(e, "dirlink").Code)
	// Would hang in os.ReadFile if the FIFO were not refused first.
	require.Equal(t, http.StatusNotFound, getTheme(e, "fifo").Code)
	w = getTheme(e, "linked")
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, ":root{--x:1}", w.Body.String())
}

// hasDarkByID is the listing reduced to the one field these tests are about.
func hasDarkByID(t *testing.T, e *testEnv) map[string]bool {
	t.Helper()
	w := e.do(e.h.ThemesList, http.MethodGet, "/themes", "", false)
	require.Equal(t, http.StatusOK, w.Code)

	var got model.ThemeList
	decode(t, w, &got)
	out := map[string]bool{}
	for _, th := range got.Themes {
		out[th.ID] = th.HasDark
	}
	return out
}

// `:root` applies in both modes, so a theme that sets only that one renders its
// light palette in dark mode — an omission in the theme that looks like a bug in
// the app. Only the file can say which themes have a dark half.
func TestThemesReportWhetherTheyHaveADarkHalf(t *testing.T) {
	cases := []struct {
		id      string
		css     string
		hasDark bool
		why     string
	}{
		{"both", ":root { --color-white: #fff; }\n:root.dark { --color-white: #000; }\n",
			true, "the ordinary shape"},
		{"lightonly", ":root { --color-white: #fff; }\n",
			false, "the case this whole field exists to label"},
		{"grouped", ":root, :root.dark { --color-white: #fff; }\n",
			true, "one selector list declaring both halves at once"},
		{"reversed", ":root{--x:1}\n.dark:root { --x: 2; }\n",
			true, "the same selector spelled the other way round"},
		{"tight", ":root{--x:1}:root.dark{--x:2}", true, "no whitespace to lean on"},
		{"mentioned", "/* Light only for now; :root.dark is on the list. */\n:root{--x:1}\n",
			false, "prose about the selector is not the selector"},
		{"disabled", ":root{--x:1}\n/* :root.dark {\n  --x: 2;\n} */\n",
			false, "a commented-out dark half is not a dark half"},
		{"unterminated", ":root{--x:1}\n/* later: :root.dark {--x:2}\n",
			false, "an unterminated comment runs to the end of the file, as in a browser"},
		{"descendant", ":root .dark { --x: 2; }\n",
			false, "a descendant selector styles an element inside the root, not the root"},
	}

	e, dir := themeEnv(t, "")
	want := map[string]bool{}
	for _, c := range cases {
		writeTheme(t, dir, c.id+".css", c.css)
		want[c.id] = c.hasDark
	}

	got := hasDarkByID(t, e)
	for _, c := range cases {
		require.Equal(t, c.hasDark, got[c.id], "%s: %s", c.id, c.why)
	}
	require.Equal(t, want, got, "every fixture is listed exactly once")
}

// The read is capped because the themes directory is a directory of whatever the
// reader put there, and this runs once per theme per request. Past the cap the
// answer is "no dark half" rather than a guess from a truncated read, which could
// have reported the opposite of the truth.
func TestAnOversizedThemeIsListedWithoutADarkHalf(t *testing.T) {
	e, dir := themeEnv(t, "")
	writeTheme(t, dir, "huge.css",
		":root{--x:1}\n"+strings.Repeat(" ", maxThemeRead)+":root.dark{--x:2}\n")
	writeTheme(t, dir, "small.css", ":root.dark{--x:2}")

	require.Equal(t, map[string]bool{"huge": false, "small": true}, hasDarkByID(t, e),
		"the oversized theme is still a theme, just an unscannable one")
}

// A repository may offer a theme, and the reader's own default and their stored
// choice both outrank it — which is the frontend's job, so the response carries
// both levels side by side.
func TestThemesListReportsTheDefaultsRepositoriesOffer(t *testing.T) {
	e, _ := themeEnv(t, "lila")
	e.h.deps.ThemeDefaults = func() map[string]string {
		return map[string]string{"alpha": "catppuccin", "beta": "mine"}
	}

	w := e.do(e.h.ThemesList, http.MethodGet, "/themes", "", false)
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t,
		`{"default":"lila","themes":[],"repo_defaults":{"alpha":"catppuccin","beta":"mine"}}`,
		w.Body.String())
}

// Deps is constructed directly by plenty of tests, and a server with no
// repository offering anything answers with an empty map — so neither a nil hook
// nor a nil answer may reach the browser as `null`.
func TestRepoDefaultsAreNeverNull(t *testing.T) {
	e, _ := themeEnv(t, "")
	require.Nil(t, e.h.deps.ThemeDefaults, "the fixture leaves the hook unset")

	for name, hook := range map[string]func() map[string]string{
		"nil hook":   nil,
		"nil answer": func() map[string]string { return nil },
		"empty map":  func() map[string]string { return map[string]string{} },
	} {
		t.Run(name, func(t *testing.T) {
			e.h.deps.ThemeDefaults = hook
			w := e.do(e.h.ThemesList, http.MethodGet, "/themes", "", false)
			require.Equal(t, http.StatusOK, w.Code)
			require.JSONEq(t, `{"default":"","themes":[],"repo_defaults":{}}`, w.Body.String())
		})
	}
}
