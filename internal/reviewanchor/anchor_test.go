package reviewanchor

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Golden vectors pinned from the live frontend implementation. Inputs are built
// from explicit rune values so the source carries no fragile escape sequences.
func TestHashBlockTextGoldenVectors(t *testing.T) {
	nl := string(rune(10))     // newline
	tab := string(rune(9))     // tab
	nbsp := string(rune(0xA0)) // non-breaking space
	emoji := string(rune(0x1F600))

	cases := []struct {
		name     string
		input    string
		stripped string
		hash     string
	}{
		{"empty", "", "", "811c9dc5"},
		{"collapse-trim-lower", "  Hello   World  ", "hello world", "d58b3fa7"},
		{"blank-lines", "Line1" + nl + nl + "Line2", "line1 line2", "09fcf13a"},
		{"tab", "Tab" + tab + "Sep", "tab sep", "caae00a0"},
		{"accented", "É", "é", "6c0b6c44"},
		{"nbsp-equals-ascii", "a" + nbsp + "b", "a b", "10a3f9f2"},
		{"trailing-newline", "Hello   World" + nl, "hello world", "d58b3fa7"},
		{"astral-utf16", "a" + emoji + "b", "a" + emoji + "b", "f58c5701"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.stripped, StripBlockText(tc.input), "StripBlockText")
			require.Equal(t, tc.hash, HashBlockText(tc.input), "HashBlockText")
		})
	}
}

func TestFNV1aEmptyIsOffsetBasis(t *testing.T) {
	require.Equal(t, "811c9dc5", FNV1a(""))
}

// Guards the single most expensive mistake: rune iteration instead of UTF-16.
func TestAstralRequiresUTF16(t *testing.T) {
	emoji := string(rune(0x1F600))
	require.Equal(t, "f58c5701", HashBlockText("a"+emoji+"b"))
	require.NotEqual(t, "10f3abd2", HashBlockText("a"+emoji+"b"), "rune-based hashing would be wrong")
}
