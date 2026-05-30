package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"golang.org/x/sync/errgroup"

	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/server"
)

// localHosts are the bind addresses that do not trigger the non-localhost
// access warning, mirroring the historical set.
var localHosts = map[string]struct{}{
	"127.0.0.1": {},
	"localhost": {},
	"::1":       {},
}

// shutdownTimeout bounds the graceful HTTP shutdown after a signal arrives.
const shutdownTimeout = 10 * time.Second

// newServeCmd builds the `serve` command: serve a single repository. It is also
// the default command — a bare path argument is rewritten to `serve <path>` by
// serveByDefault before cobra parses argv.
func newServeCmd() *cobra.Command {
	var (
		host        string
		port        int
		showHidden  bool
		excludeDirs []string
		useIgnore   bool
		walkDepth   int
		walkTimeout float64
		noOpen      bool
	)

	cmd := &cobra.Command{
		Use:   "serve [path]",
		Short: "Serve a single repository (default command)",
		Long: "Start the Vantage development server (default command).\n\n" +
			"PATH may be a directory (served as the repo root) or a single Markdown\n" +
			"file (its parent becomes the repo root). When omitted the current\n" +
			"directory is served.",
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg := config.Defaults()
			if err := cfg.ApplyEnv(); err != nil {
				return err
			}

			// Flag overrides sit at the top of the precedence chain
			// (flag > env > default). Only changed flags take effect.
			flags := cmd.Flags()
			if flags.Changed("host") {
				cfg.Host = []string{host}
			}
			if flags.Changed("port") {
				cfg.Port = port
			}
			if flags.Changed("show-hidden") {
				cfg.ShowHidden = showHidden
			}
			if flags.Changed("exclude-dirs") {
				cfg.SetExcludeDirs(excludeDirs)
			}
			if flags.Changed("use-ignore-files") {
				cfg.UseIgnoreFiles = useIgnore
			}
			if flags.Changed("walk-max-depth") {
				d := walkDepth
				cfg.WalkMaxDepth = &d
			}
			if flags.Changed("walk-timeout") {
				cfg.WalkTimeout = time.Duration(walkTimeout * float64(time.Second))
			}

			if len(args) == 1 {
				cfg.TargetRepo = args[0]
			}
			if err := cfg.Resolve(); err != nil {
				return err
			}

			warnNonLocal(cfg.Host)

			s, err := server.NewServer(cfg)
			if err != nil {
				return err
			}

			return runServers(cmd.Context(), s, cfg.Host, cfg.Port, !noOpen)
		},
	}

	f := cmd.Flags()
	f.StringVar(&host, "host", "", "Server host (default 127.0.0.1)")
	f.IntVar(&port, "port", 0, "Server port (default 8000)")
	f.BoolVar(&showHidden, "show-hidden", true, "Show hidden files/directories")
	f.StringSliceVar(&excludeDirs, "exclude-dirs", nil, "Directory names to exclude from listings (replaces defaults)")
	f.BoolVar(&useIgnore, "use-ignore-files", true, "Honor .vantageignore and the user ignore file")
	f.IntVar(&walkDepth, "walk-max-depth", 0, "Maximum depth for untracked-file discovery (0 = unlimited)")
	f.Float64Var(&walkTimeout, "walk-timeout", 30, "Timeout in seconds for untracked-file discovery")
	f.BoolVar(&noOpen, "no-open", false, "Do not open the browser on start")

	return cmd
}

// runServers starts one http.Server per bind address sharing the assembled
// handler, runs the server's background lifecycle, and shuts everything down
// gracefully on SIGINT/SIGTERM. It returns the first non-shutdown error.
func runServers(parent context.Context, s *server.Server, hosts []string, port int, open bool) error {
	if parent == nil {
		parent = context.Background()
	}
	ctx, stop := signal.NotifyContext(parent, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if open && len(hosts) > 0 {
		url := fmt.Sprintf("http://%s:%d", browserHost(hosts[0]), port)
		go func() {
			// Give the listener a moment to come up before launching the browser.
			time.Sleep(500 * time.Millisecond)
			_ = openInBrowser(url) // best-effort; headless/CI environments simply skip
		}()
	}

	handler := s.Handler()

	httpServers := make([]*http.Server, 0, len(hosts))
	for _, h := range hosts {
		httpServers = append(httpServers, &http.Server{
			Addr:    fmt.Sprintf("%s:%d", h, port),
			Handler: handler,
		})
	}

	g, gctx := errgroup.WithContext(ctx)

	// Background lifecycle (watchers + activity loop). It blocks until gctx is
	// cancelled and returns gctx.Err() then, which we treat as clean shutdown.
	g.Go(func() error {
		if err := s.Run(gctx); err != nil && !errors.Is(err, context.Canceled) {
			return err
		}
		return nil
	})

	for _, hs := range httpServers {
		hs := hs
		g.Go(func() error {
			fmt.Fprintf(os.Stderr, "Serving on http://%s\n", hs.Addr)
			if err := hs.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				return err
			}
			return nil
		})
	}

	// Shutdown coordinator: when the group context is cancelled (signal or a
	// fatal serve error) tear down every HTTP listener and the server.
	g.Go(func() error {
		<-gctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		for _, hs := range httpServers {
			_ = hs.Shutdown(sctx)
		}
		_ = s.Shutdown(sctx)
		return nil
	})

	if err := g.Wait(); err != nil {
		return err
	}
	return nil
}

// warnNonLocal prints a warning to stderr when any bind address is not a
// loopback address, since Vantage has no authentication.
func warnNonLocal(hosts []string) {
	var nonLocal []string
	for _, h := range hosts {
		if _, ok := localHosts[h]; !ok {
			nonLocal = append(nonLocal, h)
		}
	}
	if len(nonLocal) == 0 {
		return
	}
	fmt.Fprintf(os.Stderr,
		"WARNING: Binding to non-localhost address(es): %v. "+
			"Vantage has no authentication — all files in the served directory will be accessible.\n",
		nonLocal)
}

// browserHost maps a bind address to a host usable in a browser URL: wildcard
// binds become loopback so the opened tab actually connects.
func browserHost(host string) string {
	switch host {
	case "0.0.0.0", "":
		return "127.0.0.1"
	case "::":
		return "[::1]"
	default:
		return host
	}
}

// openInBrowser launches the platform's default browser at url. It returns
// immediately and any error is the caller's to ignore (headless environments
// have no opener).
func openInBrowser(url string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", url).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}
