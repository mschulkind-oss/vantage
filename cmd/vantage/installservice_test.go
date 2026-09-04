package main

import (
	"bytes"
	"encoding/xml"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// plistStrings returns the text of every <string> element in doc, decoded — so
// an assertion against it is an assertion about what launchd will actually
// read, not about the bytes on disk.
func plistStrings(t *testing.T, doc string) []string {
	t.Helper()
	dec := xml.NewDecoder(strings.NewReader(doc))
	var (
		out      []string
		cur      strings.Builder
		inString bool
	)
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		require.NoError(t, err, "plist is not well-formed XML")
		switch v := tok.(type) {
		case xml.StartElement:
			if v.Name.Local == "string" {
				inString = true
				cur.Reset()
			}
		case xml.CharData:
			if inString {
				cur.Write(v)
			}
		case xml.EndElement:
			if v.Name.Local == "string" {
				out = append(out, cur.String())
				inString = false
			}
		}
	}
	return out
}

func TestLaunchAgentPlistNamesTheBinaryAndLabel(t *testing.T) {
	doc := launchAgentPlist("/usr/local/bin/vantage", "/Users/matt", "/Users/matt/Library/Logs/vantage.log")

	strs := plistStrings(t, doc)
	require.Contains(t, strs, launchAgentLabel)
	require.Contains(t, strs, "/usr/local/bin/vantage")
	require.Contains(t, strs, "/Users/matt")
	require.Contains(t, strs, "/Users/matt/Library/Logs/vantage.log")
	// ProgramArguments is [exe, "daemon"] — the agent must start the daemon,
	// not the single-repo server.
	require.Contains(t, doc, "<string>daemon</string>")
	require.Contains(t, doc, "<key>RunAtLoad</key>")
}

// launchd gives a job a minimal PATH, and the backend shells out to `git` for
// everything it serves. Without the Homebrew prefixes an agent on a Mac whose
// git is Homebrew's starts clean and then fails every request, which is the
// least debuggable shape this bug has.
func TestLaunchAgentPlistCarriesHomebrewOnPATH(t *testing.T) {
	strs := plistStrings(t, launchAgentPlist("/opt/homebrew/bin/vantage", "/Users/matt", "/tmp/v.log"))
	require.Contains(t, strs, launchAgentPATH)
	require.Contains(t, launchAgentPATH, "/opt/homebrew/bin")
	require.Contains(t, launchAgentPATH, "/usr/local/bin")
}

// A home directory is user-chosen text dropped into XML. An unescaped "&" or
// "<" makes the plist unparseable, and launchd's only report of that is a job
// that never runs.
func TestLaunchAgentPlistEscapesPaths(t *testing.T) {
	exe := "/Users/matt & co/bin/vantage"
	logPath := "/Users/matt & co/Library/Logs/<vantage>.log"
	doc := launchAgentPlist(exe, "/Users/matt & co", logPath)

	require.NotContains(t, doc, "matt & co", "raw ampersand left in the plist")
	require.Contains(t, doc, "&amp;")

	// Well-formed, and the escaping round-trips to the original paths.
	strs := plistStrings(t, doc)
	require.Contains(t, strs, exe)
	require.Contains(t, strs, logPath)
}

func TestInstallLaunchAgentWritesPlistAndInstructions(t *testing.T) {
	home := t.TempDir()
	var out bytes.Buffer
	require.NoError(t, installService(&out, "darwin", home, "/usr/local/bin/vantage"))

	plistPath := filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
	body, err := os.ReadFile(plistPath)
	require.NoError(t, err)
	require.Contains(t, plistStrings(t, string(body)), "/usr/local/bin/vantage")

	// launchd refuses to start a job whose StandardOutPath it cannot open, and
	// it will not create the parent itself.
	require.DirExists(t, filepath.Join(home, "Library", "Logs"))

	printed := out.String()
	require.Contains(t, printed, plistPath)
	for _, cmd := range []string{
		"launchctl bootstrap gui/$(id -u) " + plistPath,
		"launchctl print gui/$(id -u)/" + launchAgentLabel,
		"launchctl kickstart -k gui/$(id -u)/" + launchAgentLabel,
		"launchctl bootout gui/$(id -u)/" + launchAgentLabel,
	} {
		require.Contains(t, printed, cmd)
	}
	// `launchctl load -w` is deprecated and silently does the wrong thing under
	// a modern launchd; the bootstrap/bootout pair replaced it.
	require.NotContains(t, printed, "launchctl load")
	require.NotContains(t, printed, "launchctl unload")
}

func TestInstallSystemdUnitWritesUnitAndInstructions(t *testing.T) {
	home := t.TempDir()
	var out bytes.Buffer
	require.NoError(t, installService(&out, "linux", home, "/home/matt/go/bin/vantage"))

	unitPath := filepath.Join(home, ".config", "systemd", "user", "vantage.service")
	body, err := os.ReadFile(unitPath)
	require.NoError(t, err)
	require.Contains(t, string(body), "ExecStart=/home/matt/go/bin/vantage daemon")
	require.Contains(t, string(body), "WantedBy=default.target")

	printed := out.String()
	require.Contains(t, printed, unitPath)
	require.Contains(t, printed, "systemctl --user enable vantage")

	// Linux gets no launchd agent, whatever the home directory looks like.
	require.NoDirExists(t, filepath.Join(home, "Library", "LaunchAgents"))
}

func TestInstallServiceOnUnsupportedPlatform(t *testing.T) {
	home := t.TempDir()
	var out bytes.Buffer
	require.NoError(t, installService(&out, "windows", home, `C:\vantage.exe`))

	require.Contains(t, out.String(), "detected: windows")
	require.Contains(t, out.String(), "vantage daemon")

	entries, err := os.ReadDir(home)
	require.NoError(t, err)
	require.Empty(t, entries, "unsupported platform wrote something into home")
}
