package main

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/mschulkind-oss/vantage/internal/config"
)

// serviceUnitTemplate is the systemd --user unit written by install-service.
// ExecStart is filled with the running binary's absolute path so the installed
// service launches this exact build.
const serviceUnitTemplate = `[Unit]
Description=Vantage Markdown Viewer Daemon
After=network.target

[Service]
Type=simple
ExecStart=%s daemon
%sRestart=on-failure
RestartSec=5

# Optional: Increase file descriptor limits for watching many files
# LimitNOFILE=65536

[Install]
WantedBy=default.target
`

// launchAgentLabel is the launchd job label, and — with ".plist" appended —
// the filename under ~/Library/LaunchAgents. Every launchctl subcommand takes
// the label as its handle, so it is user-facing contract: changing it orphans
// whatever an earlier install bootstrapped, under a name the new instructions
// no longer mention.
const launchAgentLabel = "io.github.mschulkind-oss.vantage"

// launchAgentPATH is the PATH given to the agent. launchd hands a job a
// minimal PATH that has no /opt/homebrew/bin or /usr/local/bin in it, and the
// backend shells out to the `git` CLI for everything it serves — so a daemon
// whose git came from Homebrew starts fine under launchd and then fails on
// every request. The Homebrew prefixes lead, Apple's own directories follow.
const launchAgentPATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

// launchAgentTemplate is the LaunchAgent property list written by
// install-service on macOS. KeepAlive is conditioned on SuccessfulExit so the
// agent is restarted after a crash but stays down after a clean exit, matching
// the unit's Restart=on-failure.
const launchAgentTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>%[1]s</string>
	<key>ProgramArguments</key>
	<array>
		<string>%[2]s</string>
		<string>daemon</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>%[3]s</string>%[6]s
	</dict>
	<key>WorkingDirectory</key>
	<string>%[4]s</string>
	<key>StandardOutPath</key>
	<string>%[5]s</string>
	<key>StandardErrorPath</key>
	<string>%[5]s</string>
</dict>
</plist>
`

// newInstallServiceCmd builds the `install-service` command: install a
// per-user service that runs `vantage daemon` at login — a systemd --user unit
// on Linux, a launchd agent on macOS. Neither is activated for you; both print
// the commands that do it. On every other platform it says so and exits 0.
func newInstallServiceCmd() *cobra.Command {
	var sourceDirs []string
	cmd := &cobra.Command{
		Use:   "install-service",
		Short: "Install vantage as a per-user background service (Linux, macOS)",
		Long: "Install a per-user service that runs `vantage daemon` at login: a\n" +
			"systemd --user unit on Linux, a launchd agent on macOS. On its own it\n" +
			"writes the service and prints the commands that start it.\n\n" +
			"--source-dir DIR (repeatable) also adds DIR to source_dirs in the user\n" +
			"config (~/.config/vantage/config.toml), creating the file if there is\n" +
			"none and keeping everything already in it, then installs, enables and\n" +
			"(re)starts the service, so every git repository in DIR is served in the\n" +
			"background. Relative paths and ~ are expanded; a directory already\n" +
			"listed is skipped.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			exe, err := os.Executable()
			if err != nil {
				return fmt.Errorf("locating executable: %w", err)
			}
			if resolved, rerr := filepath.EvalSymlinks(exe); rerr == nil {
				exe = resolved
			}

			home, err := os.UserHomeDir()
			if err != nil {
				return fmt.Errorf("locating home dir: %w", err)
			}

			if len(sourceDirs) == 0 {
				return installService(cmd.OutOrStdout(), runtime.GOOS, home, exe)
			}
			cfgPath, err := config.DefaultConfigPath()
			if err != nil {
				return err
			}
			return installServiceWithSourceDirs(cmd.OutOrStdout(), serviceInstall{
				goos:       runtime.GOOS,
				home:       home,
				exe:        exe,
				configPath: cfgPath,
				uid:        os.Getuid(),
				now:        time.Now(),
				run:        execRunner,
				list:       httpRepoLister,
				wait:       serviceStartWait,
			}, sourceDirs)
		},
	}
	cmd.Flags().StringArrayVar(&sourceDirs, "source-dir", nil,
		"Add a directory of git clones to source_dirs in the user config, then install and start the service (repeatable)")
	return cmd
}

// commandRunner runs one external command to completion. install-service
// --source-dir starts the service through it, and tests replace it with one
// that records the calls, so no test ever reaches a real systemctl or
// launchctl.
type commandRunner func(name string, args ...string) error

// execRunner is the production [commandRunner].
func execRunner(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		if msg := strings.TrimSpace(string(out)); msg != "" {
			return fmt.Errorf("%w: %s", err, msg)
		}
		return err
	}
	return nil
}

// serviceInstall is everything installServiceWithSourceDirs would otherwise
// look up, so every branch is reachable from a test on any host.
type serviceInstall struct {
	goos, home, exe, configPath string
	uid                         int
	now                         time.Time
	run                         commandRunner
	// list asks the service's address what answers there, and wait is how
	// long the service is given to start answering once it is started.
	list repoLister
	wait time.Duration
}

// serviceStartWait is how long install-service --source-dir waits for the
// service it started to answer before saying it does not.
const serviceStartWait = 3 * time.Second

// installServiceWithSourceDirs adds dirs to the user config's source_dirs,
// then writes the service definition and starts it — restarting it when it is
// already running, since the daemon reads source_dirs only at startup. It
// prints what it changed and what it ran. Architecture and invariants:
// docs/reference/serve-clones-directory.md §6.
func installServiceWithSourceDirs(out io.Writer, in serviceInstall, dirs []string) error {
	// The candidate is checked before it replaces anything, so a config the
	// daemon would refuse is never left behind.
	edit, err := config.AddSourceDirsChecked(in.configPath, dirs, in.now, func(candidate string) error {
		return daemonWouldStart(candidate, tildePath(in.configPath, in.home), dirs)
	})
	if err != nil {
		return err
	}
	shown := func(p string) string { return tildePath(p, in.home) }
	file := shown(edit.Path)
	if edit.Target != "" {
		file += " (a link to " + shown(edit.Target) + ")"
	}
	switch {
	case edit.Created:
		fmt.Fprintf(out, "Created %s with source_dirs = [%s]\n", file, strings.Join(edit.Added, ", "))
	case len(edit.Added) > 0:
		fmt.Fprintf(out, "Added to source_dirs in %s: %s\n", file, strings.Join(edit.Added, ", "))
	}
	if len(edit.Present) > 0 {
		fmt.Fprintf(out, "Already in source_dirs: %s\n", strings.Join(edit.Present, ", "))
	}
	if edit.Backup != "" {
		fmt.Fprintf(out, "%s could not be edited in place, so the original is saved as %s\n"+
			"and the file was rewritten from its settings. Its comments are only in the backup.\n",
			file, shown(edit.Backup))
	}

	cfg, err := config.LoadDaemonFile(in.configPath)
	if err != nil {
		return fmt.Errorf("reading the config back: %w", err)
	}
	if errs := cfg.Validate(); len(errs) > 0 {
		return fmt.Errorf("the service was not started, because %s would not start the daemon: %s",
			shown(in.configPath), strings.Join(errs, "; "))
	}
	host := "127.0.0.1"
	if len(cfg.Host) > 0 {
		host = cfg.Host[0]
	}
	probeURL := browserURL(host, cfg.Port) + "/api/repos"
	serviceURL := "http://" + net.JoinHostPort(displayServiceHost(host), strconv.Itoa(cfg.Port))
	// Asked before the start as well: a foreground serve holding the port
	// now — the one whose tip suggested this command, say — is what the
	// service will find there.
	_, heldByServe := askService(in.list, probeURL)

	switch in.goos {
	case "linux":
		unit, err := writeSystemdUnit(out, in.home, in.exe, in.now)
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "Wrote %s\n", shown(unit))
		for _, args := range [][]string{
			{"--user", "daemon-reload"},
			{"--user", "enable", "vantage"},
			{"--user", "restart", "vantage"},
		} {
			if err := runLogged(out, in.run, "systemctl", args...); err != nil {
				return fmt.Errorf("systemctl %s: %w", strings.Join(args, " "), err)
			}
		}
	case "darwin":
		plist, err := writeLaunchAgent(out, in.home, in.exe, in.now)
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "Wrote %s\n", shown(plist))
		// bootout fails when the agent is not loaded, which is the first-install
		// case; bootstrap then loads the plist just written. Its error is
		// printed rather than returned: if it meant something else, bootstrap
		// fails next, and this is what explains that failure.
		if err := runLogged(out, in.run, "launchctl", "bootout", fmt.Sprintf("gui/%d/%s", in.uid, launchAgentLabel)); err != nil {
			fmt.Fprintf(out, "  (it failed, as it does when the agent is not loaded yet: %v)\n", err)
		}
		if err := runLogged(out, in.run, "launchctl", "bootstrap", fmt.Sprintf("gui/%d", in.uid), plist); err != nil {
			return fmt.Errorf("launchctl bootstrap: %w", err)
		}
	default:
		return installService(out, in.goos, in.home, in.exe)
	}

	// A start command succeeds as soon as the process forks, whatever the
	// daemon does next, so "running" is only said of a daemon that answers.
	answer, running, laterServe := awaitService(in.list, probeURL, in.wait)
	switch {
	case running:
		fmt.Fprintf(out, "Vantage is running in the background at %s, serving %s.\n",
			serviceURL, countOf(len(answer.Names), "project"))
	case heldByServe || laterServe:
		if cfg.PortExplicit {
			fmt.Fprintf(out, "A foreground vantage serve is answering at %s, the service's address. "+
				"The service starts serving there once that one stops.\n", serviceURL)
		} else {
			fmt.Fprintf(out, "A foreground vantage serve is answering at %s, the service's address, so the service "+
				"may have moved to another port. Stop that one, then run: %s\n", serviceURL, serviceRestartCommand(in.goos))
		}
	default:
		fmt.Fprintf(out, "The service was started, but nothing answers at %s yet. Its log says why: %s\n",
			serviceURL, serviceLogCommand(in.goos, in.home))
	}
	return nil
}

// daemonWouldStart reports why the daemon would not start from the config at
// candidate — the edited config for shown, with dirs added — or nil.
func daemonWouldStart(candidate, shown string, dirs []string) error {
	cfg, err := config.LoadDaemonFile(candidate)
	if err != nil {
		return fmt.Errorf("nothing was changed or started: %s with %s added would not load: %w",
			shown, strings.Join(dirs, ", "), err)
	}
	if errs := cfg.Validate(); len(errs) > 0 {
		return fmt.Errorf("nothing was changed or started, because %s with %s added would not start the daemon: %s",
			shown, strings.Join(dirs, ", "), strings.Join(errs, "; "))
	}
	return nil
}

// askService asks url once, within the probe's timeout, whether the service
// answers there: running when a daemon does, heldByServe when a foreground
// `vantage serve` does instead.
func askService(list repoLister, url string) (answer serviceAnswer, heldByServe bool) {
	ctx, cancel := context.WithTimeout(context.Background(), serviceProbeTimeout)
	defer cancel()
	a, err := list(ctx, url)
	if err != nil {
		return serviceAnswer{}, false
	}
	return a, !a.isDaemon()
}

// awaitService asks url until a daemon answers or wait has passed, reporting
// the daemon's answer, whether one came, and whether a foreground serve
// answered meanwhile.
func awaitService(list repoLister, url string, wait time.Duration) (answer serviceAnswer, running, heldByServe bool) {
	deadline := time.Now().Add(wait)
	for {
		a, serve := askService(list, url)
		heldByServe = heldByServe || serve
		if a.isDaemon() {
			return a, true, heldByServe
		}
		if time.Now().After(deadline) {
			return serviceAnswer{}, false, heldByServe
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// countOf spells n of noun, "1 project" or "2 projects".
func countOf(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}
	return fmt.Sprintf("%d %ss", n, noun)
}

// serviceRestartCommand restarts the running service on goos.
func serviceRestartCommand(goos string) string {
	if goos == "darwin" {
		return "launchctl kickstart -k gui/$(id -u)/" + launchAgentLabel
	}
	return "systemctl --user restart vantage"
}

// serviceLogCommand shows the service's log on goos.
func serviceLogCommand(goos, home string) string {
	if goos == "darwin" {
		return "tail " + tildePath(launchAgentLogPath(home), home)
	}
	return "journalctl --user -u vantage"
}

// runLogged prints a command, then runs it.
func runLogged(out io.Writer, run commandRunner, name string, args ...string) error {
	fmt.Fprintf(out, "Ran: %s %s\n", name, strings.Join(args, " "))
	return run(name, args...)
}

// installService writes the service definition goos uses and prints the
// commands that load it. The platform, home directory and binary path are
// arguments rather than lookups so every branch is reachable from a test on
// any host.
func installService(out io.Writer, goos, home, exe string) error {
	switch goos {
	case "linux":
		return installSystemdUnit(out, home, exe)
	case "darwin":
		return installLaunchAgent(out, home, exe)
	default:
		fmt.Fprintf(out,
			"install-service supports Linux (systemd) and macOS (launchd) only "+
				"(detected: %s).\nRun `vantage daemon` directly instead.\n", goos)
		return nil
	}
}

// systemdUnitPath is where install-service writes the systemd --user unit.
// `serve`'s service tip reads the same path to tell whether one is installed.
func systemdUnitPath(home string) string {
	return filepath.Join(home, ".config", "systemd", "user", "vantage.service")
}

// launchAgentPath is where install-service writes the launchd agent on macOS,
// and what `serve`'s service tip checks for.
func launchAgentPath(home string) string {
	return filepath.Join(home, "Library", "LaunchAgents", launchAgentLabel+".plist")
}

// serviceDefinitionPath is the file install-service writes on goos, or "" on a
// platform it does not support.
func serviceDefinitionPath(goos, home string) string {
	switch goos {
	case "linux":
		return systemdUnitPath(home)
	case "darwin":
		return launchAgentPath(home)
	default:
		return ""
	}
}

// serviceStartCommand is the one command that starts an installed service on
// goos — the same line install-service prints — or "" where it has none.
func serviceStartCommand(goos, home string) string {
	switch goos {
	case "linux":
		return "systemctl --user start vantage"
	case "darwin":
		return "launchctl bootstrap gui/$(id -u) " + launchAgentPath(home)
	default:
		return ""
	}
}

// writeSystemdUnit writes ~/.config/systemd/user/vantage.service and returns
// its path, keeping any edits of the user's in a backup (see
// [writeServiceDefinition]).
func writeSystemdUnit(out io.Writer, home, exe string, now time.Time) (string, error) {
	serviceFile := systemdUnitPath(home)
	if err := os.MkdirAll(filepath.Dir(serviceFile), 0o755); err != nil {
		return "", fmt.Errorf("creating service directory: %w", err)
	}
	env := ""
	if v := configHomeEnv(home); v != "" {
		env = systemdEnvironment("XDG_CONFIG_HOME", v)
	}
	unit := fmt.Sprintf(serviceUnitTemplate, exe, env)
	if err := writeServiceDefinition(out, serviceFile, unit, exe, home, now); err != nil {
		return "", fmt.Errorf("writing service file: %w", err)
	}
	return serviceFile, nil
}

// writeServiceDefinition writes body to path, the unit or plist install-service
// owns. Re-running install-service is how a directory is added and how an
// upgrade points the service at a new binary, so the file is rewritten every
// time; an existing one that differs from body in anything but the binary it
// runs holds edits of the user's own, and is first kept in
// "<path>.bak-<now>", which the command names. The backup's suffix is neither
// ".service" nor ".plist", so neither service manager loads it.
func writeServiceDefinition(out io.Writer, path, body, exe, home string, now time.Time) error {
	if old, err := os.ReadFile(path); err == nil && handEdited(string(old), body, exe) {
		backup := fmt.Sprintf("%s.bak-%s", path, now.Format("20060102-150405"))
		if err := os.WriteFile(backup, old, 0o644); err != nil {
			return fmt.Errorf("keeping the edited %s: %w", path, err)
		}
		fmt.Fprintf(out, "%s had edits of its own; they are kept in %s\n", tildePath(path, home), tildePath(backup, home))
	}
	return os.WriteFile(path, []byte(body), 0o644)
}

// handEdited reports whether old, a service definition on disk, differs from
// next — the one about to be written for exe — in more than the binary it
// runs: the single line where next names exe, which an upgrade changes, may
// name another binary in old, with nothing else on it different.
func handEdited(old, next, exe string) bool {
	o, n := strings.Split(old, "\n"), strings.Split(next, "\n")
	if len(o) != len(n) {
		return true
	}
	for i := range o {
		if o[i] != n[i] && !otherBinary(o[i], n[i], exe) {
			return true
		}
	}
	return false
}

// otherBinary reports whether line is next with exe, as next spells it
// (plain, or escaped for a plist), replaced by some other path.
func otherBinary(line, next, exe string) bool {
	for _, spelled := range []string{exe, xmlString(exe)} {
		before, after, ok := strings.Cut(next, spelled)
		if ok && len(line) > len(before)+len(after) && strings.HasPrefix(line, before) && strings.HasSuffix(line, after) &&
			!strings.ContainsAny(line[len(before):len(line)-len(after)], " \t") {
			return true
		}
	}
	return false
}

// installSystemdUnit writes ~/.config/systemd/user/vantage.service and prints
// the commands that start it.
func installSystemdUnit(out io.Writer, home, exe string) error {
	serviceFile, err := writeSystemdUnit(out, home, exe, time.Now())
	if err != nil {
		return err
	}

	fmt.Fprintf(out, "Created systemd service: %s\n", serviceFile)
	fmt.Fprintln(out, "\nTo enable and start the service:")
	fmt.Fprintln(out, "  systemctl --user daemon-reload")
	fmt.Fprintln(out, "  systemctl --user enable vantage")
	fmt.Fprintln(out, "  "+serviceStartCommand("linux", home))
	fmt.Fprintln(out, "\nTo check status:")
	fmt.Fprintln(out, "  systemctl --user status vantage")
	fmt.Fprintln(out, "  journalctl --user -u vantage -f")
	return nil
}

// launchAgentLogPath is the file the agent's stdout and stderr go to.
func launchAgentLogPath(home string) string {
	return filepath.Join(home, "Library", "Logs", "vantage.log")
}

// writeLaunchAgent writes ~/Library/LaunchAgents/<label>.plist, and the log
// directory it names, and returns the plist's path, keeping any edits of the
// user's in a backup (see [writeServiceDefinition]).
func writeLaunchAgent(out io.Writer, home, exe string, now time.Time) (string, error) {
	plistPath := launchAgentPath(home)
	if err := os.MkdirAll(filepath.Dir(plistPath), 0o755); err != nil {
		return "", fmt.Errorf("creating LaunchAgents directory: %w", err)
	}

	// launchd will not create the log file's parent, and a StandardOutPath it
	// cannot open takes the whole job down with it.
	logPath := launchAgentLogPath(home)
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return "", fmt.Errorf("creating log directory: %w", err)
	}

	if err := writeServiceDefinition(out, plistPath, launchAgentPlist(exe, home, logPath, configHomeEnv(home)), exe, home, now); err != nil {
		return "", fmt.Errorf("writing launch agent: %w", err)
	}
	return plistPath, nil
}

// installLaunchAgent writes ~/Library/LaunchAgents/<label>.plist and prints the
// launchctl commands that load, inspect, restart and remove it.
func installLaunchAgent(out io.Writer, home, exe string) error {
	plistPath, err := writeLaunchAgent(out, home, exe, time.Now())
	if err != nil {
		return err
	}
	logPath := launchAgentLogPath(home)

	fmt.Fprintf(out, "Created launchd agent: %s\n", plistPath)
	fmt.Fprintln(out, "\nTo start it now and at every login:")
	fmt.Fprintln(out, "  "+serviceStartCommand("darwin", home))
	fmt.Fprintln(out, "\nTo check status:")
	fmt.Fprintf(out, "  launchctl print gui/$(id -u)/%s\n", launchAgentLabel)
	fmt.Fprintf(out, "  tail -f %s\n", logPath)
	fmt.Fprintln(out, "\nTo restart after changing the config:")
	fmt.Fprintf(out, "  launchctl kickstart -k gui/$(id -u)/%s\n", launchAgentLabel)
	fmt.Fprintln(out, "\nTo stop and unload:")
	fmt.Fprintf(out, "  launchctl bootout gui/$(id -u)/%s\n", launchAgentLabel)
	// kickstart restarts the job as launchd already holds it, from the plist it
	// read at bootstrap time. A rewritten plist reaches launchd only by being
	// booted out and back in, which is exactly the case after an upgrade.
	fmt.Fprintln(out, "\nAfter re-running install-service, bootout and bootstrap again —")
	fmt.Fprintln(out, "kickstart re-runs the plist launchd already loaded.")
	return nil
}

// launchAgentPlist renders the LaunchAgent property list for the binary at exe.
// configHome, when not "", is given to the agent as XDG_CONFIG_HOME (see
// [configHomeEnv]).
func launchAgentPlist(exe, workingDir, logPath, configHome string) string {
	env := ""
	if configHome != "" {
		env = "\n\t\t<key>XDG_CONFIG_HOME</key>\n\t\t<string>" + xmlString(configHome) + "</string>"
	}
	return fmt.Sprintf(launchAgentTemplate,
		xmlString(launchAgentLabel),
		xmlString(exe),
		xmlString(launchAgentPATH),
		xmlString(workingDir),
		xmlString(logPath),
		env,
	)
}

// configHomeEnv is the XDG_CONFIG_HOME the service must be given to read the
// config this process reads: the caller's, when it is set, absolute, and not
// the default home/.config it would find anyway; "" otherwise. A service
// manager hands its service none of the shell's environment, so a
// XDG_CONFIG_HOME set only in a shell's startup files would otherwise leave the
// service looking for its config — and its themes, bookmarks and ignore file —
// where install-service did not write it.
func configHomeEnv(home string) string {
	v := os.Getenv("XDG_CONFIG_HOME")
	if !filepath.IsAbs(v) || strings.ContainsAny(v, "\r\n") {
		return ""
	}
	if v = filepath.Clean(v); v == filepath.Join(home, ".config") {
		return ""
	}
	return v
}

// systemdEnvironment renders an Environment= line setting key to value, quoted
// so a space survives, with the backslash, quote and % escaped as systemd
// reads them (% begins a specifier).
func systemdEnvironment(key, value string) string {
	value = strings.NewReplacer(`\`, `\\`, `"`, `\"`, "%", "%%").Replace(value)
	return fmt.Sprintf("Environment=\"%s=%s\"\n", key, value)
}

// xmlString escapes s for use as the text of a plist <string> element. Home
// directories and repo paths are user-chosen and may hold "&" or "<", either
// of which turns the plist into a file launchd refuses to parse.
func xmlString(s string) string {
	var b strings.Builder
	if err := xml.EscapeText(&b, []byte(s)); err != nil {
		return s
	}
	return b.String()
}
