package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
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

// portScanLimit is how many consecutive ports are tried before giving up when
// the configured one is taken. A machine with a hundred busy ports in a row is
// not one where quietly picking the hundred-and-first is helpful.
const portScanLimit = 100

// newServeCmd builds the `serve` command: serve a single repository. It is also
// the default command — a bare path argument is rewritten to `serve <path>` by
// serveByDefault before cobra parses argv.
func newServeCmd() *cobra.Command {
	var (
		host           string
		allowedOrigins []string
		port           int
		showHidden     bool
		excludeDirs    []string
		useIgnore      bool
		walkDepth      int
		walkTimeout    float64
		noOpen         bool
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
			if flags.Changed("allowed-origins") {
				cfg.AllowedOrigins = allowedOrigins
			}
			if flags.Changed("port") {
				cfg.Port = port
				cfg.PortExplicit = true
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

			listeners, boundPort, err := listenAll(cfg.Host, cfg.Port, cfg.PortExplicit)
			if err != nil {
				return err
			}
			return runServers(cmd.Context(), s, listeners, boundPort, cfg.Host, !noOpen)
		},
	}

	f := cmd.Flags()
	f.StringVar(&host, "host", "", "Server host (default 127.0.0.1)")
	f.StringSliceVar(&allowedOrigins, "allowed-origins", nil, "Extra hostnames allowed to open the live-reload WebSocket (loopback is always allowed)")
	f.IntVar(&port, "port", 0, "Server port (default 8000; an explicitly set port must be free, only the default falls forward)")
	f.BoolVar(&showHidden, "show-hidden", true, "Show hidden files/directories")
	f.StringSliceVar(&excludeDirs, "exclude-dirs", nil, "Directory names to exclude from listings (replaces defaults)")
	f.BoolVar(&useIgnore, "use-ignore-files", true, "Honor .vantageignore and the user ignore file")
	f.IntVar(&walkDepth, "walk-max-depth", 0, "Maximum depth for untracked-file discovery (0 = unlimited)")
	f.Float64Var(&walkTimeout, "walk-timeout", 30, "Timeout in seconds for untracked-file discovery")
	f.BoolVar(&noOpen, "no-open", false, "Do not open the browser on start")

	return cmd
}

// runServers runs one http.Server per already-bound listener sharing the
// assembled handler, runs the server's background lifecycle, and shuts
// everything down gracefully on SIGINT/SIGTERM. It returns the first
// non-shutdown error.
//
// It takes listeners rather than hosts and a port so that a caller who wants
// to report the bound port — daemon's startup banner names it before this
// function starts logging its own "Serving on" lines — can resolve it first
// with listenAll and print that report before handing the listeners over.
func runServers(parent context.Context, s *server.Server, listeners []net.Listener, port int, hosts []string, open bool) error {
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

	httpServers := make([]*http.Server, 0, len(listeners))
	for range listeners {
		httpServers = append(httpServers, &http.Server{Handler: handler})
	}

	g, gctx := errgroup.WithContext(ctx)

	// Background lifecycle (watchers + activity loop). It blocks until gctx is
	// canceled and returns gctx.Err() then, which we treat as clean shutdown.
	g.Go(func() error {
		if err := s.Run(gctx); err != nil && !errors.Is(err, context.Canceled) {
			return err
		}
		return nil
	})

	for i, hs := range httpServers {
		hs, ln := hs, listeners[i]
		g.Go(func() error {
			fmt.Fprintf(os.Stderr, "Serving on http://%s\n", ln.Addr().String())
			if err := hs.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
				return err
			}
			return nil
		})
	}

	// Shutdown coordinator: when the group context is canceled (signal or a
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

// listenAll binds every host in hosts to one shared port and returns the
// listeners with the port they share.
//
// When strict is false — the caller left the port at its default — a busy
// port is walked upwards until one is free on all bind addresses. When
// strict is true, the port was named by the operator (a flag, an env var, or
// a config file), and a port someone chose is a promise: it binds exactly or
// the run fails, with no falling forward to a port nobody asked for.
//
// Either way the listeners are opened here rather than left to
// http.Server.ListenAndServe: a port is only usable if every bind address can
// take it, and that is not knowable without trying. A partial bind is undone
// before moving on, so the run either owns the port everywhere or nowhere —
// otherwise two Vantage instances could end up interleaved across addresses on
// the same port, each answering for some of them.
func listenAll(hosts []string, port int, strict bool) ([]net.Listener, int, error) {
	if len(hosts) == 0 {
		return nil, port, fmt.Errorf("no bind address configured")
	}
	// Port 0 asks the kernel for an arbitrary free port, which cannot be shared
	// across bind addresses and has no "next port" to walk to; a negative port
	// is nonsense on its own, but worth calling out separately because the
	// walk below would otherwise count up through it and silently land on the
	// port-0 behavior once it reached zero, handing back an ephemeral port
	// under a different host than the one that "found" it.
	if port <= 0 {
		return nil, 0, fmt.Errorf("port %d is not supported; configure a positive port to start scanning from", port)
	}

	if strict {
		lns, err := bindAll(hosts, port)
		if err != nil {
			return nil, 0, fmt.Errorf("port %d is configured explicitly and could not be bound: %w", port, err)
		}
		return lns, port, nil
	}

	first := port
	for p := first; p < first+portScanLimit && p <= 65535; p++ {
		lns, bindErr := bindAll(hosts, p)
		if bindErr != nil {
			// Only "someone else is already listening" is a reason to try the
			// next port. Anything else — an invalid host, a permission error
			// on a privileged port, a system out of file descriptors — will
			// fail identically on every remaining candidate, so scanning
			// through the rest of the range would just spend a hundred
			// failures to arrive at a misleading "no free port found" instead
			// of the real reason.
			if !errors.Is(bindErr, syscall.EADDRINUSE) {
				return nil, 0, bindErr
			}
			continue
		}
		if p != first {
			fmt.Fprintf(os.Stderr, "Port %d is in use; serving on %d instead.\n", first, p)
		}
		return lns, p, nil
	}
	return nil, 0, fmt.Errorf("no free port found in %d..%d", first, first+portScanLimit-1)
}

// bindAll binds every host in hosts to the same port, undoing any partial
// bind before returning the failure, so a candidate port is owned everywhere
// or nowhere.
func bindAll(hosts []string, port int) ([]net.Listener, error) {
	lns := make([]net.Listener, 0, len(hosts))
	for _, h := range hosts {
		ln, err := net.Listen("tcp", net.JoinHostPort(h, strconv.Itoa(port)))
		if err != nil {
			for _, l := range lns {
				_ = l.Close()
			}
			return nil, err
		}
		lns = append(lns, ln)
	}
	return lns, nil
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
