package api

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/mschulkind-oss/vantage/internal/model"
)

// themeID is what a user theme's file stem must look like to be served. The id
// is also the URL segment and the value the frontend stores, so it is kept to a
// charset that needs no escaping anywhere. Refusing a dot is what closes
// traversal: no "..", no ".css" doubled into the id, no dotfiles.
//
// Lowercase only, because macOS's filesystem folds case and Linux's does not.
// With capitals allowed, `Catppuccin.css` listed as a second "Catppuccin" beside
// the built-in it was meant to replace, `Default.css` slipped past the reserved
// `default`, and /themes/OCEAN served ocean.css on a Mac and 404'd on Linux —
// one file answering to two ids on one platform only. The class of bug 976ed93
// fixed for starred files.
var themeID = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// ValidThemeID reports whether id could name a theme at all.
//
// Exported because the server validates the theme a repository offers before it
// reaches the browser, and the charset has to be the one this package serves
// under: an id outside it can never resolve to a stylesheet, so the frontend
// would store it and request a /themes/{id} that is a permanent 404.
func ValidThemeID(id string) bool { return themeID.MatchString(id) }

// maxThemeRead caps how much of a stylesheet is read to answer has_dark. The
// shipped built-ins are about 20 KB, so a mebibyte is far past any real theme,
// and the cap is what keeps a huge file parked in the themes directory from
// being slurped once per theme per request.
const maxThemeRead = 1 << 20

// ThemesList handles GET /themes: the user themes found in the themes
// directory, the reader's configured default, and the default each repository
// offers. The built-in themes are not listed — they ship in the frontend bundle,
// which already knows them.
//
// The directory is read on every request rather than at startup, so a theme
// dropped into ~/.config/vantage/themes appears on the next page load without
// restarting the server.
//
// Three defaults arrive here, and their precedence is the frontend's to apply:
// the choice stored in this browser wins, then Default from the reader's own
// config, then RepoDefaults. A repository only ever offers.
func (h *Handlers) ThemesList(w http.ResponseWriter, _ *http.Request) {
	// A nil hook is what the tests that construct Deps directly get, and a nil
	// map is what a hook returns when no repository offers a theme; both have to
	// become {} rather than null, because the frontend indexes this.
	repoDefaults := map[string]string{}
	if h.deps.ThemeDefaults != nil {
		if got := h.deps.ThemeDefaults(); got != nil {
			repoDefaults = got
		}
	}
	writeJSON(w, http.StatusOK, model.ThemeList{
		Default:      h.deps.DefaultTheme,
		Themes:       listThemes(h.deps.ThemesDir),
		RepoDefaults: repoDefaults,
	})
}

// ThemeCSS handles GET /themes/{id}: the raw stylesheet of one user theme. It
// answers 404 for any id that is not a theme file in the directory, including
// every id that could name a path outside it.
//
// It serves only an id the listing would show, compared byte for byte, rather
// than opening `<id>.css` and letting the filesystem decide: on a
// case-insensitive disk that open succeeds for `OCEAN` and for `ocean` when the
// file is `Ocean.css`, which the listing never offered.
func (h *Handlers) ThemeCSS(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !themeListed(h.deps.ThemesDir, id) {
		writeError(w, http.StatusNotFound, "theme not found")
		return
	}
	data, err := os.ReadFile(filepath.Join(h.deps.ThemesDir, id+".css"))
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			slog.Warn("api: reading theme", "id", id, "error", err)
		}
		writeError(w, http.StatusNotFound, "theme not found")
		return
	}
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(data); err != nil {
		slog.Debug("api: failed to write theme body", "error", err)
	}
}

// themeListed reports whether id is exactly one of the themes listThemes finds.
//
// It shares that scan rather than re-deriving the rules, because the property it
// is here to keep is that a stylesheet is served only under an id the listing
// offered. It skips the dark-half read: serving one theme would otherwise read
// every theme in the directory, and the answer is not used.
func themeListed(dir, id string) bool {
	if !themeID.MatchString(id) {
		return false
	}
	for _, t := range scanThemes(dir, false) {
		if t.ID == id {
			return true
		}
	}
	return false
}

// listThemes returns the regular *.css files in dir whose stem is a valid theme
// id, sorted by id. A missing or unreadable directory is simply no themes: most
// readers never create one.
//
// "Regular" is decided by os.Stat, which follows a symlink — so a theme kept in
// a dotfiles repository and linked in works — and not by the dirent type,
// which does not: that listed a FIFO named x.css, whose read then blocked the
// request forever, and a symlink to a directory, which could only ever 404.
func listThemes(dir string) []model.ThemeInfo { return scanThemes(dir, true) }

// scanThemes is listThemes, with the one read that only the listing needs made
// optional. See [themeListed] for why that read is worth skipping.
func scanThemes(dir string, withDark bool) []model.ThemeInfo {
	out := []model.ThemeInfo{}
	if dir == "" {
		return out
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			slog.Warn("api: listing themes", "dir", dir, "error", err)
		}
		return out
	}
	for _, e := range entries {
		stem, ok := strings.CutSuffix(e.Name(), ".css")
		if !ok || !themeID.MatchString(stem) {
			continue
		}
		path := filepath.Join(dir, e.Name())
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		// One small read per theme, on a listing that is already re-read per
		// request. That is affordable because a themes directory holds a handful
		// of files of a few kilobytes each, and it is the only way to answer
		// has_dark: nothing but the stylesheet knows whether it has a dark half.
		// The regular-file check above is what keeps this read off a FIFO.
		dark := false
		if withDark {
			dark = themeHasDark(path)
		}
		out = append(out, model.ThemeInfo{ID: stem, Name: stem, HasDark: dark})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// themeHasDark reports whether the stylesheet at path declares a dark-mode rule.
//
// The app toggles a `dark` class on the root element, so a theme's dark palette
// is written on `:root.dark` (or `.dark:root`, the same selector spelled the
// other way round). `:root` alone applies in both modes, which is why a theme
// that sets only that one silently shows its light colors in dark mode, and why
// this is worth detecting at all.
//
// The test is textual rather than a parse: a CSS parser is a dependency and a
// much larger surface for a file that is here only to be labeled in a picker.
// The one thing a plain search gets wrong is a comment — a theme's header
// typically explains the very selectors it uses — so comments come out first.
//
// An unreadable or oversized file is reported as having no dark half. The
// listing is cosmetic and must not fail on it; a file that genuinely cannot be
// read is answered for by [Handlers.ThemeCSS], which 404s.
func themeHasDark(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		slog.Debug("api: reading theme for dark-mode detection", "path", path, "error", err)
		return false
	}
	defer func() { _ = f.Close() }()

	// One byte past the cap, so a file over the limit is refused rather than
	// truncated: a truncated read could miss a dark half that sits past the cut
	// and report the opposite of the truth with no way to tell.
	data, err := io.ReadAll(io.LimitReader(f, maxThemeRead+1))
	if err != nil {
		slog.Debug("api: reading theme for dark-mode detection", "path", path, "error", err)
		return false
	}
	if len(data) > maxThemeRead {
		slog.Debug("api: theme too large to scan for a dark half",
			"path", path, "limit", maxThemeRead)
		return false
	}

	css := stripCSSComments(string(data))
	return strings.Contains(css, ":root.dark") || strings.Contains(css, ".dark:root")
}

// stripCSSComments removes every `/* … */` span, so that prose mentioning a
// selector is not mistaken for the selector.
//
// An unterminated `/*` swallows the rest of the file, which is what a browser
// does with it too: everything after it is comment, so there is no rule left
// there to find.
func stripCSSComments(css string) string {
	if !strings.Contains(css, "/*") {
		return css
	}
	var b strings.Builder
	b.Grow(len(css))
	for {
		open := strings.Index(css, "/*")
		if open < 0 {
			b.WriteString(css)
			return b.String()
		}
		b.WriteString(css[:open])
		rest := css[open+2:]
		end := strings.Index(rest, "*/")
		if end < 0 {
			return b.String()
		}
		css = rest[end+2:]
	}
}
