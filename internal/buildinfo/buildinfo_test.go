package buildinfo

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestVersionFallsBackToDev(t *testing.T) {
	// No ldflags in test builds, and the test binary has no Main.Version.
	require.Equal(t, "dev", Version())
}

func TestShortCommitNeverEmpty(t *testing.T) {
	// Either a VCS revision (test binary built in the repo) or "unknown",
	// but never empty — callers embed it in API responses.
	require.NotEmpty(t, ShortCommit())
}

func TestBuildVersionStableAndNonEmpty(t *testing.T) {
	got := BuildVersion()
	require.NotEmpty(t, got)
	require.Equal(t, got, BuildVersion(), "BuildVersion must be stable within a process")
}

// A test binary is a development build, so it names no release.
func TestReleaseIsEmptyForADevelopmentBuild(t *testing.T) {
	require.Empty(t, Release())
}

// Only a plain X.Y.Z is a release, with or without the "v" a module version
// carries. A Go pseudo-version, a dirty build, a pre-release and "dev" are all
// development builds (docs/design/checker-version-skew.md §4.2, §5).
func TestReleaseOfTakesOnlyAPlainVersion(t *testing.T) {
	for version, want := range map[string]string{
		"0.8.0":                                "0.8.0",
		"v0.8.0":                               "0.8.0",
		"10.20.3":                              "10.20.3",
		"v0.8.1-0.20260930120000-abcdef123456": "",
		"v0.8.1-0.20260930120000-abcdef123456+dirty": "",
		"v0.8.0+dirty": "",
		"0.9.0-rc.1":   "",
		"vv0.8.0":      "",
		"0.08.0":       "",
		"0.8":          "",
		"0.8.0.1":      "",
		"dev":          "",
		"(devel)":      "",
		"":             "",
	} {
		require.Equal(t, want, releaseOf(version), version)
	}
}
