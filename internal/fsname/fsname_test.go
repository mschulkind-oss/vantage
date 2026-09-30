package fsname

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSameFoldsCaseAndTheCodePointsHFSIgnores(t *testing.T) {
	for _, spelled := range []string{
		".git", ".GIT", ".Git", ".gIT",
		".g\u200cit", "\u200d.git", ".git\ufeff", ".G\u202ai\u206ft",
	} {
		require.True(t, Same(spelled, ".git"), "%q opens .git on macOS", spelled)
		require.True(t, Same(".git", spelled), "the rule is symmetric")
	}
	require.True(t, Same(".VANTAGE", ".vantage"))

	// U+200B, a zero-width space, is not one of the code points HFS+ ignores.
	for _, other := range []string{".gitignore", "git", ".gi", ".git.", ".g t", ".g\u200bit", ".vantageignore"} {
		require.False(t, Same(other, ".git"), "%q is another name", other)
		require.False(t, Same(other, ".vantage"), "%q is another name", other)
	}
}
