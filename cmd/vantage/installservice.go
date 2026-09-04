package main

import (
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/spf13/cobra"
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
Restart=on-failure
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
		<string>%[3]s</string>
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
	return &cobra.Command{
		Use:   "install-service",
		Short: "Install vantage as a per-user background service (Linux, macOS)",
		Args:  cobra.NoArgs,
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

			return installService(cmd.OutOrStdout(), runtime.GOOS, home, exe)
		},
	}
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

// installSystemdUnit writes ~/.config/systemd/user/vantage.service.
func installSystemdUnit(out io.Writer, home, exe string) error {
	serviceDir := filepath.Join(home, ".config", "systemd", "user")
	if err := os.MkdirAll(serviceDir, 0o755); err != nil {
		return fmt.Errorf("creating service directory: %w", err)
	}
	serviceFile := filepath.Join(serviceDir, "vantage.service")

	unit := fmt.Sprintf(serviceUnitTemplate, exe)
	if err := os.WriteFile(serviceFile, []byte(unit), 0o644); err != nil {
		return fmt.Errorf("writing service file: %w", err)
	}

	fmt.Fprintf(out, "Created systemd service: %s\n", serviceFile)
	fmt.Fprintln(out, "\nTo enable and start the service:")
	fmt.Fprintln(out, "  systemctl --user daemon-reload")
	fmt.Fprintln(out, "  systemctl --user enable vantage")
	fmt.Fprintln(out, "  systemctl --user start vantage")
	fmt.Fprintln(out, "\nTo check status:")
	fmt.Fprintln(out, "  systemctl --user status vantage")
	fmt.Fprintln(out, "  journalctl --user -u vantage -f")
	return nil
}

// installLaunchAgent writes ~/Library/LaunchAgents/<label>.plist and prints the
// launchctl commands that load, inspect, restart and remove it.
func installLaunchAgent(out io.Writer, home, exe string) error {
	agentDir := filepath.Join(home, "Library", "LaunchAgents")
	if err := os.MkdirAll(agentDir, 0o755); err != nil {
		return fmt.Errorf("creating LaunchAgents directory: %w", err)
	}

	// launchd will not create the log file's parent, and a StandardOutPath it
	// cannot open takes the whole job down with it.
	logPath := filepath.Join(home, "Library", "Logs", "vantage.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return fmt.Errorf("creating log directory: %w", err)
	}

	plistPath := filepath.Join(agentDir, launchAgentLabel+".plist")
	if err := os.WriteFile(plistPath, []byte(launchAgentPlist(exe, home, logPath)), 0o644); err != nil {
		return fmt.Errorf("writing launch agent: %w", err)
	}

	fmt.Fprintf(out, "Created launchd agent: %s\n", plistPath)
	fmt.Fprintln(out, "\nTo start it now and at every login:")
	fmt.Fprintf(out, "  launchctl bootstrap gui/$(id -u) %s\n", plistPath)
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
func launchAgentPlist(exe, workingDir, logPath string) string {
	return fmt.Sprintf(launchAgentTemplate,
		xmlString(launchAgentLabel),
		xmlString(exe),
		xmlString(launchAgentPATH),
		xmlString(workingDir),
		xmlString(logPath),
	)
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
