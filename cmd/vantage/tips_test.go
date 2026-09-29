package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// fakeLister answers the service probe without a socket, recording the URL it
// was asked for.
type fakeLister struct {
	names []string
	err   error
	asked []string
}

func (f *fakeLister) list(_ context.Context, url string) ([]string, error) {
	f.asked = append(f.asked, url)
	return f.names, f.err
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
	require.Equal(t,
		"A Vantage service is installed but not running. Start it with: launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.github.mschulkind-oss.vantage.plist",
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
		running.tip(plan))

	windows := base
	windows.GOOS = "windows"
	require.Equal(t, "", windows.tip(plan), "install-service does nothing there, so there is nothing to suggest")
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

func TestProbeServiceFindsAClonesDirectoryAmongItsSourceDirs(t *testing.T) {
	home := isolateHome(t)
	code := clonesDir(t)
	writeUserConfig(t, home, "source_dirs = [\""+code+"\"]\n")
	plan := &clonesPlan{Dir: code, Repos: 3, Loose: "code"}

	st := probeService(context.Background(), "linux", home, code, plan, (&fakeLister{names: []string{"alpha", "beta", "gamma"}}).list)
	require.True(t, st.Running)
	require.Equal(t, "/", st.OpenPath)
}

func TestProbeServiceIgnoresAForegroundServe(t *testing.T) {
	home := isolateHome(t)
	st := probeService(context.Background(), "linux", home, "/x", nil, (&fakeLister{names: []string{""}}).list)
	require.False(t, st.Running, "a single-project serve answers with the sentinel, and is not the service")
}

// Startup never waits longer than the probe's own timeout, however slow the
// other end is.
func TestProbeServiceIsBoundedByItsTimeout(t *testing.T) {
	home := isolateHome(t)
	var deadline time.Time
	slow := func(ctx context.Context, _ string) ([]string, error) {
		deadline, _ = ctx.Deadline()
		<-ctx.Done()
		return nil, ctx.Err()
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
		_, _ = w.Write([]byte(`[{"name":"code","last_activity":null,"pinned":true},{"name":"alpha","last_activity":null}]`))
	}))
	defer srv.Close()
	names, err := httpRepoLister(context.Background(), srv.URL+"/api/repos")
	require.NoError(t, err)
	require.Equal(t, []string{"code", "alpha"}, names)

	missing := httptest.NewServer(http.NotFoundHandler())
	defer missing.Close()
	_, err = httpRepoLister(context.Background(), missing.URL+"/api/repos")
	require.Error(t, err)
}
