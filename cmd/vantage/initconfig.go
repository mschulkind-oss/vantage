package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/mschulkind-oss/vantage/internal/config"
)

// newInitConfigCmd builds the `init-config` command: write the embedded
// annotated daemon-config template to disk so the user can edit it and run
// `vantage daemon`.
func newInitConfigCmd() *cobra.Command {
	var (
		path  string
		force bool
	)

	cmd := &cobra.Command{
		Use:   "init-config",
		Short: "Write an example multi-repo configuration file",
		Long:  "Create an example configuration file for daemon mode.",
		Args:  cobra.NoArgs,
		RunE: func(_ *cobra.Command, _ []string) error {
			target := path
			if target == "" {
				p, err := config.DefaultConfigPath()
				if err != nil {
					return err
				}
				target = p
			}

			if _, err := os.Stat(target); err == nil && !force {
				fmt.Fprintf(os.Stderr, "Config file already exists: %s\n", target)
				fmt.Fprintln(os.Stderr, "Use --force to overwrite")
				return fmt.Errorf("config file already exists: %s", target)
			}

			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return fmt.Errorf("creating config directory: %w", err)
			}
			if err := os.WriteFile(target, []byte(config.ExampleConfig), 0o644); err != nil {
				return fmt.Errorf("writing config: %w", err)
			}

			fmt.Printf("Created example config: %s\n", target)
			fmt.Println("\nEdit this file to configure your repositories, then run:")
			fmt.Println("  vantage daemon")
			return nil
		},
	}

	f := cmd.Flags()
	f.StringVarP(&path, "path", "p", "", "Path for config file (default: per-user config dir)")
	// -o/--output mirrors the smoke-test invocation and other write commands.
	f.StringVarP(&path, "output", "o", "", "Alias for --path")
	f.BoolVarP(&force, "force", "f", false, "Overwrite an existing config file")

	return cmd
}
