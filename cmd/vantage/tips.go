package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/server"
)

// serviceProbeTimeout bounds the one request `serve` makes to find out whether
// a background service is running. Startup never waits longer than this on it.
const serviceProbeTimeout = 200 * time.Millisecond

// serviceState is what `serve` learns about the per-user background service
// that install-service sets up, for its startup tip.
type serviceState struct {
	// GOOS decides the start command; a platform install-service does not
	// support gets no tip at all.
	GOOS string
	// Home is the user's home directory, for paths shown with ~.
	Home string
	// Installed reports whether the unit file or launchd plist install-service
	// writes exists.
	Installed bool
	// Running reports whether the service's configured address answered GET
	// /api/repos as the service: a `vantage daemon`.
	Running bool
	// Foreground reports whether that address answered as a foreground
	// `vantage serve` instead — someone's other terminal holding the port the
	// service would use.
	Foreground bool
	// URL is the service's address as a reader would type it, e.g.
	// http://localhost:8000.
	URL string
	// OpenPath is the path under URL at which what `serve` is serving is
	// already open — "/<project>", or "/" for a directory of clones the
	// service scans — or "" when the service does not serve it.
	OpenPath string
}

// tipsEnabled reports whether `serve` may print its startup tip: stderr is a
// terminal (tty — passed in, so tests can say either), VANTAGE_NO_TIPS is unset
// or "0", and the user config does not say `tips = false`.
func tipsEnabled(tty bool) bool {
	if v, ok := os.LookupEnv("VANTAGE_NO_TIPS"); ok && v != "" && v != "0" {
		return false
	}
	if !tty {
		return false
	}
	// A config that cannot be read is the daemon's to report; the tip is not
	// worth an error of its own, so the default (on) stands.
	on, _ := config.LoadUserTips()
	return on
}

// serviceAnswer is what a running Vantage said to GET /api/repos.
type serviceAnswer struct {
	// Names are the projects it listed.
	Names []string
	// Mode is its [server.ModeHeader]: "daemon", "serve", or "" from a version
	// that predates the header.
	Mode string
}

// isDaemon reports whether a is the background service's answer. A version
// without the mode header is judged by its names: a single-project `vantage
// serve` answers with the one-element sentinel [""], and anything else was
// the daemon, since only it listed projects by name before `serve` could
// split a directory.
func (a serviceAnswer) isDaemon() bool {
	switch a.Mode {
	case "daemon":
		return true
	case "":
		return len(a.Names) > 0 && !(len(a.Names) == 1 && a.Names[0] == "")
	default:
		return false
	}
}

// repoLister asks a running Vantage for /api/repos. It is a parameter so tests
// never open a socket to a real service.
type repoLister func(ctx context.Context, url string) (serviceAnswer, error)

// httpRepoLister is the production [repoLister]: one GET, bounded by ctx.
func httpRepoLister(ctx context.Context, url string) (serviceAnswer, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return serviceAnswer{}, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return serviceAnswer{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return serviceAnswer{}, fmt.Errorf("status %d", resp.StatusCode)
	}
	var repos []model.RepoInfo
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&repos); err != nil {
		return serviceAnswer{}, err
	}
	names := make([]string, 0, len(repos))
	for _, r := range repos {
		names = append(names, r.Name)
	}
	return serviceAnswer{Names: names, Mode: resp.Header.Get(server.ModeHeader)}, nil
}

// probeService gathers [serviceState] for target, the resolved path `serve`
// is about to serve (plan non-nil when it is a directory of clones). The
// service's address and what it serves come from the user config the daemon
// reads; with none, the daemon's defaults. It makes at most one request, and
// must run before `serve` binds its own port so it cannot find itself.
func probeService(ctx context.Context, goos, home, target string, plan *clonesPlan, list repoLister) serviceState {
	st := serviceState{GOOS: goos, Home: home}
	if def := serviceDefinitionPath(goos, home); def != "" {
		if _, err := os.Stat(def); err == nil {
			st.Installed = true
		}
	}

	host, port := "127.0.0.1", 8000
	var daemon *config.Config
	if path, err := config.DefaultConfigPath(); err == nil {
		if _, err := os.Stat(path); err == nil {
			if cfg, err := config.LoadDaemonFile(path); err == nil {
				daemon = cfg
				if len(cfg.Host) > 0 {
					host = cfg.Host[0]
				}
				port = cfg.Port
			}
		}
	}
	st.URL = "http://" + net.JoinHostPort(displayServiceHost(host), strconv.Itoa(port))

	ctx, cancel := context.WithTimeout(ctx, serviceProbeTimeout)
	defer cancel()
	probeURL := browserURL(host, port) + "/api/repos"
	answer, err := list(ctx, probeURL)
	if err != nil {
		return st
	}
	if !answer.isDaemon() {
		// Somebody's foreground server, not the background service.
		st.Foreground = true
		return st
	}
	st.Running = true
	if daemon != nil {
		st.OpenPath = openPathFor(daemon, target, plan, answer.Names)
	}
	return st
}

// openPathFor finds where, in a service configured by daemon and currently
// listing names, target is already open: the root for a directory of clones
// the service scans, "/<name>" for a project it serves, "" otherwise.
//
// Either way the service has to list the project, not only be configured to:
// a running daemon reads source_dirs only at startup, so a source dir added to
// the file by hand is not served until it restarts.
func openPathFor(daemon *config.Config, target string, plan *clonesPlan, names []string) string {
	if plan != nil {
		if !slices.Contains(daemon.SourceDirs, target) {
			return ""
		}
		for _, r := range daemon.Repos {
			if r.Discovered && filepath.Dir(r.Path) == target && slices.Contains(names, r.Name) {
				return "/"
			}
		}
		return ""
	}
	for _, r := range daemon.Repos {
		if r.Path == target && slices.Contains(names, r.Name) {
			// A name is a directory name, and may hold a space, "#" or "?".
			return "/" + url.PathEscape(r.Name)
		}
	}
	return ""
}

// displayServiceHost is the host a reader types to reach a service bound to
// host: loopback and wildcard binds read as localhost.
func displayServiceHost(host string) string {
	switch host {
	case "127.0.0.1", "::1", "localhost", "0.0.0.0", "::", "":
		return "localhost"
	default:
		return host
	}
}

// tip renders the one startup line for st, or "" when there is nothing to
// say. plan is non-nil when `serve` split a directory of clones, whose own
// startup line has already said what the directory holds.
func (st serviceState) tip(plan *clonesPlan) string {
	if serviceDefinitionPath(st.GOOS, st.Home) == "" {
		// install-service does nothing here, so there is nothing to suggest.
		return ""
	}
	switch {
	case st.Running:
		line := fmt.Sprintf("A Vantage service is already running at %s.", st.URL)
		switch {
		case st.OpenPath == "/" && plan != nil && plan.Loose != "":
			// The daemon never serves the loose project; only `serve` makes one.
			line += fmt.Sprintf(" Its clones are open there, but not the Markdown outside them: %s/", st.URL)
		case st.OpenPath == "/":
			line += fmt.Sprintf(" This directory's projects are open there: %s/", st.URL)
		case st.OpenPath != "":
			line += fmt.Sprintf(" This project is open there: %s%s", st.URL, st.OpenPath)
		}
		return line
	case st.Installed && st.Foreground:
		return fmt.Sprintf("A Vantage service is installed, but a foreground vantage serve is answering at its address, %s. "+
			"Stop that one, then start the service with: %s", st.URL, st.startHint())
	case st.Installed:
		return "A Vantage service is installed but not running. Start it with: " + st.startHint()
	case plan != nil:
		return fmt.Sprintf("To keep them all in the background at %s: vantage install-service --source-dir %s",
			st.URL, tildePath(plan.Dir, st.Home))
	default:
		return "Tip: vantage install-service runs Vantage in the background for all your projects."
	}
}

// startHint is the command that starts the installed service when it is not
// answering. On macOS that is kickstart first: the agent is usually loaded
// and stopped — the daemon exited cleanly, or a login loaded it — and
// bootstrap refuses an agent that is loaded, so bootstrap is the fallback for
// one that is not.
func (st serviceState) startHint() string {
	start := tildeCommand(serviceStartCommand(st.GOOS, st.Home), st.Home)
	if st.GOOS == "darwin" {
		return fmt.Sprintf("launchctl kickstart gui/$(id -u)/%s (or, if it is not loaded, %s)", launchAgentLabel, start)
	}
	return start
}

// tildeCommand abbreviates the home directory in the path a start command
// names, so the line reads the way the reader would type it.
func tildeCommand(cmd, home string) string {
	if home == "" {
		return cmd
	}
	plist := launchAgentPath(home)
	if rest, ok := strings.CutSuffix(cmd, plist); ok {
		return rest + tildePath(plist, home)
	}
	return cmd
}
