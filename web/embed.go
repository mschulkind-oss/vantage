// Package web embeds the built frontend single-page application.
//
// The real assets are produced by `just bundle-frontend` (Vite build copied
// into web/dist). A placeholder index.html is committed so the module always
// compiles; a production build overwrites web/dist with the real bundle.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// Dist returns the embedded frontend bundle rooted at the dist directory.
func Dist() fs.FS {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic("web: embedded dist is malformed: " + err.Error())
	}
	return sub
}

// IndexHTML returns the contents of the bundle's index.html.
func IndexHTML() ([]byte, error) {
	return fs.ReadFile(Dist(), "index.html")
}
