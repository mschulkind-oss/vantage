package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/server"
)

// fakeLister answers the service probe without a socket, recording the URL it
// was asked for. mode is the server's X-Vantage-Mode; the zero value is
// "daemon", the answer most tests want.
type fakeLister struct {
	names []string
	mode  string
	err   error
	asked []string
}

func (f *fakeLister) list(_ context.Context, url string) (serviceAnswer, error) {
	f.asked = append(f.asked, url)
	mode := f.mode
	if mode == "" {
		mode = "daemon"
	}
	if mode == "none" {
		mode = ""
	}
	return serviceAnswer{Names: f.names, Mode: mode}, f.err
}

func writeUserConfig(t *testing.T, home, body string) {
	t.Helper()
	dir := filepath.Join(home, ".config", "vantage")
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "config.toml"), []byte(body), 0o644))
}

func TestServiceTipWording(t *testing.T) {
	plan := &clonesPlan{Dir: "/home/matt/code", Repos: 23, Loose: "code"}
	base := serviceState{GOOS: "linux", Home: "/home/matt", URL: "http://localhost:8000"}

	require.Equal(t,
		"To keep them all in the background at http://localhost:8000: vantage install-service --source-dir ~/code",
		base.tip(plan))
	require.Equal(t,
		"Tip: vantage install-service runs Vantage in the background for all your projects.",
		base.tip(nil))

	installed := base
	installed.Installed = true
	require.Equal(t,
		"A Vantage service is installed but not running. Start it with: systemctl --user start vantage",
		installed.tip(nil))
	mac := installed
	mac.GOOS = "darwin"
	// Installed but not answering is usually loaded and stopped — the daemon
	// exited cleanly, or every login loads the agent — and bootstrap refuses a
	// loaded agent, so kickstart comes first.
	require.Equal(t,
		"A Vantage service is installed but not running. Start it with: launchctl kickstart gui/$(id -u)/io.github.mschulkind-oss.vantage "+
			"(or, if it is not loaded, launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.github.mschulkind-oss.vantage.plist)",
		mac.tip(plan))

	running := installed
	running.Running = true
	require.Equal(t, "A Vantage service is already running at http://localhost:8000.", running.tip(nil))
	running.OpenPath = "/vantage"
	require.Equal(t,
		"A Vantage service is already running at http://localhost:8000. This project is open there: http://localhost:8000/vantage",
		running.tip(nil))
	running.OpenPath = "/"
	require.Equal(t,
		"A Vantage service is already running at http://localhost:8000. This directory's projects are open there: http://localhost:8000/",
		running.tip(&clonesPlan{Dir: "/home/matt/code", Repos: 23}))
	// The daemon never serves the loose project: only `serve` makes one.
	require.Equal(t,
		"A Vantage service is already running at http://localhost:8000. Its clones are open there, but not the Markdown outside them: http://localhost:8000/",
		running.tip(plan))

	windows := base
	windows.GOOS = "windows"
	require.Equal(t, "", windows.tip(plan), "install-service does nothing there, so there is nothing to suggest")
}

// What serve prints before it binds: the startup line for a directory of
// clones always, then the tip. The probe behind the tip costs up to its whole
// timeout when something on the service's port is slow, so it runs only when
// a tip can be printed — on a terminal, and on a platform install-service
// supports.
func TestAnnounceServe(t *testing.T) {
	home := isolateHome(t)
	t.Setenv("VANTAGE_NO_TIPS", "")
	plan := &clonesPlan{Dir: filepath.Join(home, "code"), Repos: 2}

	var out bytes.Buffer
	lister := &fakeLister{err: errors.New("connection refused")}
	announceServe(context.Background(), &out, "linux", home, true, plan.Dir, plan, lister.list)
	require.Equal(t, plan.describe(home)+"\n"+
		"To keep them all in the background at http://localhost:8000: vantage install-service --source-dir ~/code\n", out.String())
	require.Len(t, lister.asked, 1)

	for _, c := range []struct {
		goos string
		tty  bool
	}{{"linux", false}, {"windows", true}} {
		out.Reset()
		lister = &fakeLister{err: errors.New("connection refused")}
		announceServe(context.Background(), &out, c.goos, home, c.tty, plan.Dir, plan, lister.list)
		require.Equal(t, plan.describe(home)+"\n", out.String(), c.goos)
		require.Empty(t, lister.asked, "no tip to print, so no probe: %+v", c)
	}

	out.Reset()
	announceServe(context.Background(), &out, "linux", home, false, "/x", nil, lister.list)
	require.Empty(t, out.String(), "a single project has no startup line")
}

// `2>/dev/null` is how a script says it wants none of this, and /dev/null is a
// character device just as a terminal is.
func TestIsTerminalIsFalseForDevNull(t *testing.T) {
	null, err := os.Open(os.DevNull)
	require.NoError(t, err)
	defer null.Close()
	require.False(t, isTerminal(null))
	file, err := os.Create(filepath.Join(t.TempDir(), "log"))
	require.NoError(t, err)
	defer file.Close()
	require.False(t, isTerminal(file))
}

func TestTipsEnabled(t *testing.T) {
	home := isolateHome(t)
	t.Setenv("VANTAGE_NO_TIPS", "")
	require.True(t, tipsEnabled(true))
	require.False(t, tipsEnabled(false), "no tip lands in a log or a pipe")

	t.Setenv("VANTAGE_NO_TIPS", "1")
	require.False(t, tipsEnabled(true))
	t.Setenv("VANTAGE_NO_TIPS", "0")
	require.True(t, tipsEnabled(true))
	// A variable named NO_TIPS set to false means tips, as the other boolean
	// settings read false.
	for _, keep := range []string{"false", "FALSE", "no", "off"} {
		t.Setenv("VANTAGE_NO_TIPS", keep)
		require.True(t, tipsEnabled(true), keep)
	}
	for _, off := range []string{"true", "yes", "anything"} {
		t.Setenv("VANTAGE_NO_TIPS", off)
		require.False(t, tipsEnabled(true), off)
	}

	writeUserConfig(t, home, "tips = false\n")
	require.False(t, tipsEnabled(true))
}

func TestProbeServiceWithNothingInstalled(t *testing.T) {
	home := isolateHome(t)
	lister := &fakeLister{err: errors.New("connection refused")}

	st := probeService(context.Background(), "linux", home, "/somewhere", nil, lister.list)
	require.Equal(t, serviceState{GOOS: "linux", Home: home, URL: "http://localhost:8000"}, st)
	require.Equal(t, []string{"http://127.0.0.1:8000/api/repos"}, lister.asked, "the daemon's default address, asked once")
}

func TestProbeServiceReadsInstalledFromTheFileInstallServiceWrites(t *testing.T) {
	home := isolateHome(t)
	for _, goos := range []string{"linux", "darwin"} {
		def := serviceDefinitionPath(goos, home)
		require.NoError(t, os.MkdirAll(filepath.Dir(def), 0o755))
		require.NoError(t, os.WriteFile(def, []byte("x"), 0o644))
		st := probeService(context.Background(), goos, home, "/x", nil, (&fakeLister{err: errors.New("down")}).list)
		require.True(t, st.Installed, goos)
		require.False(t, st.Running, goos)
	}
}

func TestProbeServiceFindsThisProjectInTheRunningService(t *testing.T) {
	home := isolateHome(t)
	project := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(project); err == nil {
		project = resolved
	}
	writeUserConfig(t, home, "host = \"0.0.0.0\"\nport = 9123\n\n[[repos]]\nname = \"notes\"\npath = \""+project+"\"\n")

	lister := &fakeLister{names: []string{"other", "notes"}}
	st := probeService(context.Background(), "linux", home, project, nil, lister.list)
	require.True(t, st.Running)
	require.Equal(t, "http://localhost:9123", st.URL)
	require.Equal(t, "/notes", st.OpenPath)
	require.Equal(t, []string{"http://127.0.0.1:9123/api/repos"}, lister.asked)

	// Configured but not (yet) listed by the running service: not open there.
	lister = &fakeLister{names: []string{"other"}}
	st = probeService(context.Background(), "linux", home, project, nil, lister.list)
	require.True(t, st.Running)
	require.Equal(t, "", st.OpenPath)
}

// A project's name is a directory name, and may hold a space, "#", "?" or
// "%". Unescaped, the link opens the wrong page: a terminal ends it at the
// space, and a browser reads "#" as the start of a fragment.
func TestProbeServiceEscapesTheProjectInItsLink(t *testing.T) {
	home := isolateHome(t)
	parent := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(parent); err == nil {
		parent = resolved
	}
	cases := []struct{ name, want string }{
		{"my notes", "/my%20notes"},
		{"c#", "/c%23"},
		{"a?b", "/a%3Fb"},
		{"100%", "/100%25"},
	}
	var body strings.Builder
	for _, c := range cases {
		dir := filepath.Join(parent, c.name)
		require.NoError(t, os.MkdirAll(dir, 0o755))
		fmt.Fprintf(&body, "[[repos]]\nname = %q\npath = %q\n\n", c.name, dir)
	}
	writeUserConfig(t, home, body.String())
	for _, c := range cases {
		st := probeService(context.Background(), "linux", home, filepath.Join(parent, c.name), nil,
			(&fakeLister{names: []string{c.name}}).list)
		require.Equal(t, c.want, st.OpenPath, c.name)
	}
}

// A service bound to the IPv6 wildcard is asked at ::1, bracketed once: the
// probe used to bracket an address that came back bracketed already, and
// "http://[[::1]]:8000" does not parse, so a running service was reported as
// not running.
func TestProbeServiceAsksAnIPv6WildcardServiceAtItsLoopback(t *testing.T) {
	home := isolateHome(t)
	writeUserConfig(t, home, "host = \"::\"\nport = 9123\n")
	lister := &fakeLister{names: []string{"notes"}}
	st := probeService(context.Background(), "linux", home, "/x", nil, lister.list)
	require.Equal(t, []string{"http://[::1]:9123/api/repos"}, lister.asked)
	require.True(t, st.Running)
	require.Equal(t, "http://localhost:9123", st.URL)
}

func TestBrowserURL(t *testing.T) {
	for host, want := range map[string]string{
		"":          "http://127.0.0.1:8000",
		"0.0.0.0":   "http://127.0.0.1:8000",
		"127.0.0.1": "http://127.0.0.1:8000",
		"::":        "http://[::1]:8000",
		"::1":       "http://[::1]:8000",
		"myhost":    "http://myhost:8000",
	} {
		require.Equal(t, want, browserURL(host, 8000), host)
	}
}

func TestProbeServiceFindsAClonesDirectoryAmongItsSourceDirs(t *testing.T) {
	home := isolateHome(t)
	code := clonesDir(t)
	writeUserConfig(t, home, "source_dirs = [\""+code+"\"]\n")
	plan := &clonesPlan{Dir: code, Repos: 3, Loose: "code"}

	st := probeService(context.Background(), "linux", home, code, plan, (&fakeLister{names: []string{"alpha", "beta", "gamma"}}).list)
	require.True(t, st.Running)
	require.Equal(t, "/", st.OpenPath)

	// A running daemon reads source_dirs only at startup, so a config edited
	// by hand since is not what it serves: the directory is open there only
	// when the service lists a project discovery made from it.
	st = probeService(context.Background(), "linux", home, code, plan, (&fakeLister{names: []string{"something-else"}}).list)
	require.True(t, st.Running)
	require.Equal(t, "", st.OpenPath)

	// One clone of it, served on its own, is found among the discovered
	// projects by its path.
	st = probeService(context.Background(), "linux", home, filepath.Join(code, "beta"), nil,
		(&fakeLister{names: []string{"alpha", "beta", "gamma"}}).list)
	require.Equal(t, "/beta", st.OpenPath)
}

// A foreground `vantage serve` on the service's port is not the service,
// however it answers: a split one lists real project names, as the daemon
// does, and only its X-Vantage-Mode tells the two apart. So `vantage ~/code` in
// one terminal and `vantage ~/notes` in another is not "a service already
// running", and the second still hears how to install one.
func TestProbeServiceIgnoresAForegroundServe(t *testing.T) {
	home := isolateHome(t)
	st := probeService(context.Background(), "linux", home, "/x", nil,
		(&fakeLister{names: []string{"code", "alpha"}, mode: "serve"}).list)
	require.False(t, st.Running)
	require.True(t, st.Foreground)
	require.Equal(t, "Tip: vantage install-service runs Vantage in the background for all your projects.", st.tip(nil))

	// A version that predates the header: a single-project serve answers with
	// the one-element sentinel, and anything else is taken for the service.
	st = probeService(context.Background(), "linux", home, "/x", nil, (&fakeLister{names: []string{""}, mode: "none"}).list)
	require.False(t, st.Running, "a single-project serve answers with the sentinel, and is not the service")
	st = probeService(context.Background(), "linux", home, "/x", nil, (&fakeLister{names: []string{"notes"}, mode: "none"}).list)
	require.True(t, st.Running)

	// Installed, with a foreground serve holding its address: starting it is
	// not what fixes that.
	def := serviceDefinitionPath("linux", home)
	require.NoError(t, os.MkdirAll(filepath.Dir(def), 0o755))
	require.NoError(t, os.WriteFile(def, []byte("x"), 0o644))
	st = probeService(context.Background(), "linux", home, "/x", nil,
		(&fakeLister{names: []string{"code"}, mode: "serve"}).list)
	require.Equal(t, "A Vantage service is installed, but a foreground vantage serve is answering at its address, "+
		"http://localhost:8000. Stop that one, then start the service with: systemctl --user start vantage", st.tip(nil))
}

// Startup never waits longer than the probe's own timeout, however slow the
// other end is.
func TestProbeServiceIsBoundedByItsTimeout(t *testing.T) {
	home := isolateHome(t)
	var deadline time.Time
	slow := func(ctx context.Context, _ string) (serviceAnswer, error) {
		deadline, _ = ctx.Deadline()
		<-ctx.Done()
		return serviceAnswer{}, ctx.Err()
	}
	start := time.Now()
	st := probeService(context.Background(), "linux", home, "/x", nil, slow)
	require.False(t, st.Running)
	require.WithinDuration(t, start.Add(serviceProbeTimeout), deadline, 50*time.Millisecond)
	require.Less(t, time.Since(start), time.Second)
}

func TestHTTPRepoListerReadsTheRepoNames(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/api/repos", r.URL.Path)
		w.Header().Set(server.ModeHeader, "serve")
		_, _ = w.Write([]byte(`[{"name":"code","last_activity":null,"pinned":true},{"name":"alpha","last_activity":null}]`))
	}))
	defer srv.Close()
	answer, err := httpRepoLister(context.Background(), srv.URL+"/api/repos")
	require.NoError(t, err)
	require.Equal(t, serviceAnswer{Names: []string{"code", "alpha"}, Mode: "serve"}, answer)

	missing := httptest.NewServer(http.NotFoundHandler())
	defer missing.Close()
	_, err = httpRepoLister(context.Background(), missing.URL+"/api/repos")
	require.Error(t, err)
}
