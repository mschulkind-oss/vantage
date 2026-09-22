package api

import (
	"errors"
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

// ThemesList handles GET /themes: the user themes found in the themes
// directory, and the reader's configured default. The built-in themes are not
// listed — they ship in the frontend bundle, which already knows them.
//
// The directory is read on every request rather than at startup, so a theme
// dropped into ~/.config/vantage/themes appears on the next page load without
// restarting the server.
func (h *Handlers) ThemesList(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, model.ThemeList{
		Default: h.deps.DefaultTheme,
		Themes:  listThemes(h.deps.ThemesDir),
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
func themeListed(dir, id string) bool {
	if !themeID.MatchString(id) {
		return false
	}
	for _, t := range listThemes(dir) {
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
func listThemes(dir string) []model.ThemeInfo {
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
		info, err := os.Stat(filepath.Join(dir, e.Name()))
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		out = append(out, model.ThemeInfo{ID: stem, Name: stem})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
