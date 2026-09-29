package main

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

// recordingRunner stands in for systemctl and launchctl: it records every
// call and fails the ones named in fail.
type recordingRunner struct {
	calls []string
	fail  map[string]error
}

func (r *recordingRunner) run(name string, args ...string) error {
	call := strings.Join(append([]string{name}, args...), " ")
	r.calls = append(r.calls, call)
	return r.fail[call]
}

// sourceDirInstall sets up an isolated home holding a directory of two clones
// and returns the inputs install-service --source-dir would gather.
func sourceDirInstall(t *testing.T, goos string) (serviceInstall, *recordingRunner, string) {
	t.Helper()
	home := isolateHome(t)
	code := filepath.Join(home, "code")
	gitRepo(t, filepath.Join(code, "alpha"), map[string]string{"a.md": "# a\n"})
	gitRepo(t, filepath.Join(code, "beta"), map[string]string{"b.md": "# b\n"})
	rec := &recordingRunner{}
	return serviceInstall{
		goos:       goos,
		home:       home,
		exe:        "/opt/bin/vantage",
		configPath: filepath.Join(home, ".config", "vantage", "config.toml"),
		uid:        501,
		now:        time.Date(2026, 9, 29, 1, 2, 3, 0, time.UTC),
		run:        rec.run,
	}, rec, code
}

func TestInstallServiceWithSourceDirsOnLinux(t *testing.T) {
	in, rec, _ := sourceDirInstall(t, "linux")
	var out bytes.Buffer
	require.NoError(t, installServiceWithSourceDirs(&out, in, []string{"~/code"}))

	body, err := os.ReadFile(in.configPath)
	require.NoError(t, err)
	require.Contains(t, string(body), `source_dirs = ["~/code"]`)
	unit, err := os.ReadFile(systemdUnitPath(in.home))
	require.NoError(t, err)
	require.Contains(t, string(unit), "ExecStart=/opt/bin/vantage daemon")

	require.Equal(t, []string{
		"systemctl --user daemon-reload",
		"systemctl --user enable vantage",
		"systemctl --user restart vantage",
	}, rec.calls, "restart, not start: a running daemon reads source_dirs only at startup")

	printed := out.String()
	require.Contains(t, printed, "Created ~/.config/vantage/config.toml with source_dirs = [~/code]")
	require.Contains(t, printed, "Wrote ~/.config/systemd/user/vantage.service")
	require.Contains(t, printed, "Ran: systemctl --user restart vantage")
	require.Contains(t, printed, "Vantage is running in the background at http://localhost:8000, serving 2 projects.")
}

func TestInstallServiceWithSourceDirsOnMacOS(t *testing.T) {
	in, rec, _ := sourceDirInstall(t, "darwin")
	rec.fail = map[string]error{
		"launchctl bootout gui/501/" + launchAgentLabel: errors.New("not loaded"),
	}
	var out bytes.Buffer
	require.NoError(t, installServiceWithSourceDirs(&out, in, []string{"~/code"}))

	plist := launchAgentPath(in.home)
	require.FileExists(t, plist)
	require.Equal(t, []string{
		"launchctl bootout gui/501/" + launchAgentLabel,
		"launchctl bootstrap gui/501 " + plist,
	}, rec.calls, "a failed bootout means the agent was not loaded yet, which is fine")
	require.NoDirExists(t, filepath.Join(in.home, ".config", "systemd"))
}

func TestInstallServiceWithSourceDirsKeepsAnExistingConfig(t *testing.T) {
	in, rec, code := sourceDirInstall(t, "linux")
	require.NoError(t, os.MkdirAll(filepath.Dir(in.configPath), 0o755))
	original := "# mine\nport = 8123 # not the default\ntheme = \"catppuccin\"\n"
	require.NoError(t, os.WriteFile(in.configPath, []byte(original), 0o644))

	var out bytes.Buffer
	require.NoError(t, installServiceWithSourceDirs(&out, in, []string{code, "~/code"}))
	body, err := os.ReadFile(in.configPath)
	require.NoError(t, err)
	require.Equal(t, original+"\nsource_dirs = [\"~/code\"]\n", string(body))
	require.Contains(t, out.String(), "Added to source_dirs in ~/.config/vantage/config.toml: ~/code")
	require.Contains(t, out.String(), "http://localhost:8123")
	require.Len(t, rec.calls, 3)

	// Again: nothing to add, and the service is still (re)started, since the
	// point of the command is a running service that serves this directory.
	out.Reset()
	rec.calls = nil
	require.NoError(t, installServiceWithSourceDirs(&out, in, []string{"~/code"}))
	require.Contains(t, out.String(), "Already in source_dirs: ~/code")
	require.NotContains(t, out.String(), "Added")
	require.Len(t, rec.calls, 3)
}

func TestInstallServiceWithSourceDirsReportsAFailedStart(t *testing.T) {
	in, rec, _ := sourceDirInstall(t, "linux")
	rec.fail = map[string]error{"systemctl --user restart vantage": errors.New("exit status 1: Failed to connect to bus")}
	var out bytes.Buffer
	err := installServiceWithSourceDirs(&out, in, []string{"~/code"})
	require.ErrorContains(t, err, "systemctl --user restart vantage")
	require.ErrorContains(t, err, "Failed to connect to bus")
}

func TestInstallServiceWithSourceDirsWillNotStartADaemonWithNothingToServe(t *testing.T) {
	in, rec, _ := sourceDirInstall(t, "linux")
	empty := filepath.Join(in.home, "empty")
	require.NoError(t, os.MkdirAll(empty, 0o755))
	var out bytes.Buffer
	err := installServiceWithSourceDirs(&out, in, []string{empty})
	require.ErrorContains(t, err, "No repositories configured")
	require.Empty(t, rec.calls)
	require.NoFileExists(t, systemdUnitPath(in.home))
}

func TestInstallServiceWithSourceDirsRejectsAMissingDirectory(t *testing.T) {
	in, rec, _ := sourceDirInstall(t, "linux")
	var out bytes.Buffer
	err := installServiceWithSourceDirs(&out, in, []string{"~/nope"})
	require.ErrorContains(t, err, "not a directory")
	require.NoFileExists(t, in.configPath)
	require.Empty(t, rec.calls)
}

func TestInstallServiceHasARepeatableSourceDirFlag(t *testing.T) {
	cmd, _, err := newRootCmd().Find([]string{"install-service"})
	require.NoError(t, err)
	flag := cmd.Flags().Lookup("source-dir")
	require.NotNil(t, flag)
	require.Equal(t, "stringArray", flag.Value.Type())
	require.Contains(t, cmd.Long, "--source-dir")
}
