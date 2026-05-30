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
