package server

import (
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strings"

	"github.com/mschulkind-oss/vantage/web"
)

// securityHeaders sets the response headers the frontend is served with on every
// request, mirroring the historical middleware: nosniff, frame-deny, and a
// strict referrer policy.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

// spaHandler serves the embedded single-page application for every non-/api
// route. An existing static asset (favicon, hashed JS/CSS, images) is served
// directly with the correct content type; anything else falls back to the
// config-injected index.html so the React router can handle client-side routes.
func (s *Server) spaHandler() http.HandlerFunc {
	dist := web.Dist()
	index := indexHTML(dist)

	return func(w http.ResponseWriter, r *http.Request) {
		// /api paths reaching here did not match a real API route. Never serve
		// the SPA for them; report a clean 404 so missing endpoints are visible.
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
			writeJSONError(w, http.StatusNotFound, "Not found")
			return
		}

		// Only GET/HEAD serve the SPA; other methods on a non-API path are 404.
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeJSONError(w, http.StatusNotFound, "Not found")
			return
		}

		rel := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if rel != "" && rel != "." {
			if serveStaticAsset(w, r, dist, rel) {
				return
			}
		}

		// SPA fallback: serve index.html for client-side routes.
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(index)
	}
}

// serveStaticAsset serves rel from dist when it names an existing regular file,
// reporting whether it did. Directories and missing files are not served (they
// fall through to the index.html SPA fallback).
func serveStaticAsset(w http.ResponseWriter, r *http.Request, dist fs.FS, rel string) bool {
	f, err := dist.Open(rel)
	if err != nil {
		return false
	}
	defer func() { _ = f.Close() }()

	info, err := f.Stat()
	if err != nil || info.IsDir() {
		return false
	}

	seeker, ok := f.(io.ReadSeeker)
	if !ok {
		// Embedded files always implement io.ReadSeeker; defensively fall back to
		// the SPA index if one ever does not.
		return false
	}

	http.ServeContent(w, r, info.Name(), info.ModTime(), seeker)
	return true
}

// indexHTML reads the bundle's index.html, computed once at construction; the
// embedded bundle is immutable for the process lifetime, so re-reading per
// request would be wasted work. On failure it returns a minimal placeholder so
// the server still serves something rather than a blank 500.
func indexHTML(dist fs.FS) []byte {
	raw, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		slog.Warn("server: embedded index.html missing; serving placeholder", "error", err)
		return []byte("<!doctype html><html><head><title>Vantage</title></head><body>Frontend bundle not found.</body></html>")
	}
	return raw
}
