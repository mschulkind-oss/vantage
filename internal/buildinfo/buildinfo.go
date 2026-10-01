// Package buildinfo exposes version metadata for the running binary.
//
// Release builds stamp [version] and [commit] via the linker
// (-ldflags "-X .../internal/buildinfo.version=1.2.3 -X .../internal/buildinfo.commit=abc1234").
// Unstamped builds fall back to the Go module build info embedded by the
// toolchain, and finally to sensible dev defaults.
package buildinfo

import (
	"regexp"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Injected at release build time via -ldflags -X. Empty in dev builds.
var (
	version = ""
	commit  = ""
)

// Version returns the human-facing release version (e.g. "1.2.3" or "dev").
func Version() string {
	if version != "" {
		return version
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		if v := info.Main.Version; v != "" && v != "(devel)" {
			return v
		}
	}
	return "dev"
}

// Release returns the Vantage release this binary is, as "X.Y.Z", or "" for a
// development build.
//
// A release is a [Version] that is a plain X.Y.Z once one leading "v" is
// dropped: publish.yml stamps "0.8.0" into a release archive, and a
// `go install …@v0.8.0` build reports the module version "v0.8.0". Everything
// else is a development build: `just build` and `just deploy` stamp no version,
// so they report a Go pseudo-version or "dev", and a pre-release is no release
// either (docs/design/checker-version-skew.md §4.2). A development build is at
// or ahead of every release, so a caller that would name a release names none.
func Release() string { return releaseOf(Version()) }

// releaseForm is X.Y.Z with no leading zeros, as a version is written.
var releaseForm = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)

func releaseOf(version string) string {
	v := strings.TrimPrefix(version, "v")
	if releaseForm.MatchString(v) {
		return v
	}
	return ""
}

// ShortCommit returns the short git SHA the binary was built from, or
// "unknown" when it cannot be determined.
func ShortCommit() string {
	if commit != "" {
		return commit
	}
	if rev, ok := vcsSetting("vcs.revision"); ok && rev != "" {
		if len(rev) > 7 {
			return rev[:7]
		}
		return rev
	}
	return "unknown"
}

// Dirty reports whether the binary was built from a modified working tree.
func Dirty() bool {
	v, _ := vcsSetting("vcs.modified")
	return v == "true"
}

// BuildVersion is the cache-busting token sent in the WebSocket "hello" frame.
// The frontend reloads whenever this value changes between connections.
//
// Release builds return the stamped commit/version (stable across restarts of
// the same binary). Dev builds return a per-process token so that restarting
// the server reliably reloads connected browsers.
var BuildVersion = sync.OnceValue(func() string {
	switch {
	case commit != "":
		return commit
	case version != "":
		return version
	default:
		return strconv.FormatInt(time.Now().Unix(), 10)
	}
})

func vcsSetting(key string) (string, bool) {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "", false
	}
	for _, s := range info.Settings {
		if s.Key == key {
			return s.Value, true
		}
	}
	return "", false
}
