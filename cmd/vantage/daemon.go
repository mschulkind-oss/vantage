package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/mschulkind-oss/vantage/internal/buildinfo"
	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/server"
)

// newDaemonCmd builds the `daemon` command: serve multiple repositories from a
// TOML config file. Each configured bind address gets its own http.Server,
// fanned out via the shared runServers helper.
func newDaemonCmd() *cobra.Command {
	var (
		configPath string
		hosts      []string
		port       int
	)

	cmd := &cobra.Command{
		Use:   "daemon",
		Short: "Serve multiple repositories from a config file",
		Long: "Start the Vantage daemon to serve multiple directories.\n\n" +
			"Reads a TOML configuration file listing repositories to serve. Each\n" +
			"repository appears as a top-level item in the sidebar. Generate a\n" +
			"starter config with `vantage init-config`.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			path := configPath
			if path == "" {
				p, err := config.DefaultConfigPath()
				if err != nil {
					return err
				}
				path = p
			}

			if _, err := os.Stat(path); err != nil {
				fmt.Fprintf(os.Stderr, "Config file not found: %s\n", path)
				fmt.Fprintln(os.Stderr, "Create one with: vantage init-config")
				return fmt.Errorf("config file not found: %s", path)
			}

			cfg, err := config.LoadDaemonFile(path)
			if err != nil {
				return fmt.Errorf("loading config: %w", err)
			}

			// Command-line overrides on top of the file.
			flags := cmd.Flags()
			if flags.Changed("host") {
				cfg.Host = hosts
			}
			if flags.Changed("port") {
				cfg.Port = port
			}

			if errs := cfg.Validate(); len(errs) > 0 {
				fmt.Fprintln(os.Stderr, "Configuration errors:")
				for _, e := range errs {
					fmt.Fprintf(os.Stderr, "  - %s\n", e)
				}
				return fmt.Errorf("invalid configuration: %d error(s)", len(errs))
			}

			warnNonLocal(cfg.Host)

			fmt.Fprintf(os.Stderr, "Starting Vantage daemon %s on %v:%d\n",
				buildinfo.Version(), cfg.Host, cfg.Port)
			fmt.Fprintf(os.Stderr, "Serving %d repositories:\n", len(cfg.Repos))
			for _, repo := range cfg.Repos {
				fmt.Fprintf(os.Stderr, "  - %s: %s\n", repo.Name, repo.Path)
			}

			s, err := server.NewServer(cfg)
			if err != nil {
				return err
			}

			// Daemon mode serves many repos headlessly; never open a browser.
			return runServers(cmd.Context(), s, cfg.Host, cfg.Port, false)
		},
	}

	f := cmd.Flags()
	f.StringVarP(&configPath, "config", "c", "", "Path to config file (default: per-user config dir)")
	f.StringSliceVar(&hosts, "host", nil, "Override server host(s) from config (repeatable / comma-separated)")
	f.IntVar(&port, "port", 0, "Override server port from config")

	return cmd
}
