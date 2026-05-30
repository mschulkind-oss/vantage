// Package buildinfo exposes version metadata for the running binary.
//
// Release builds stamp [version] and [commit] via the linker
// (-ldflags "-X .../internal/buildinfo.version=1.2.3 -X .../internal/buildinfo.commit=abc1234").
// Unstamped builds fall back to the Go module build info embedded by the
// toolchain, and finally to sensible dev defaults.
package buildinfo

import (
	"runtime/debug"
	"strconv"
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
