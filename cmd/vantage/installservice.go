package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"

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

// newInstallServiceCmd builds the `install-service` command: install a systemd
// --user unit on Linux. On every other platform it prints a clear unsupported
// message and exits 0.
func newInstallServiceCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "install-service",
		Short: "Install vantage as a systemd user service (Linux only)",
		Args:  cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			if runtime.GOOS != "linux" {
				fmt.Printf(
					"install-service is systemd-specific and only supported on Linux "+
						"(detected: %s).\nOn macOS, run vantage-md directly or set up a "+
						"launchd agent manually.\n", runtime.GOOS)
				return nil
			}

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
			serviceDir := filepath.Join(home, ".config", "systemd", "user")
			if err := os.MkdirAll(serviceDir, 0o755); err != nil {
				return fmt.Errorf("creating service directory: %w", err)
			}
			serviceFile := filepath.Join(serviceDir, "vantage.service")

			unit := fmt.Sprintf(serviceUnitTemplate, exe)
			if err := os.WriteFile(serviceFile, []byte(unit), 0o644); err != nil {
				return fmt.Errorf("writing service file: %w", err)
			}

			fmt.Printf("Created systemd service: %s\n", serviceFile)
			fmt.Println("\nTo enable and start the service:")
			fmt.Println("  systemctl --user daemon-reload")
			fmt.Println("  systemctl --user enable vantage")
			fmt.Println("  systemctl --user start vantage")
			fmt.Println("\nTo check status:")
			fmt.Println("  systemctl --user status vantage")
			fmt.Println("  journalctl --user -u vantage -f")
			return nil
		},
	}
}
