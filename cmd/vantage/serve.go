package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
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
		addr           *addressFlags
		allowedOrigins []string
		showHidden     bool
		excludeDirs    []string
		useIgnore      bool
		walkDepth      int
		walkTimeout    float64
		noOpen         bool
		oneProject     bool
	)

	cmd := &cobra.Command{
		Use:   "serve [path]",
		Short: "Serve a single repository (default command)",
		Long: "Start the Vantage development server (default command).\n\n" +
			"PATH may be a directory (served as the repo root) or a single Markdown\n" +
			"file (its parent becomes the repo root). When omitted the current\n" +
			"directory is served.\n\n" +
			"A directory of clones - one that is not inside a git repository and\n" +
			"has git repositories among its immediate children - is served the way\n" +
			"the daemon serves a source_dirs entry: one project per repository,\n" +
			"named after its directory, plus one project named after PATH for any\n" +
			"Markdown outside them. Clones made while it runs appear within 30\n" +
			"seconds. --one-project serves PATH as a single project instead.\n\n" +
			"When stderr is a terminal, one line about the background service\n" +
			"(see install-service) is printed at startup. VANTAGE_NO_TIPS=1, or\n" +
			"tips = false in the user config, turns it off.",
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg := config.Defaults()
			if err := cfg.ApplyEnv(); err != nil {
				return err
			}

			// Flag overrides sit at the top of the precedence chain
			// (flag > env > default). Only changed flags take effect.
			flags := cmd.Flags()
			if err := addr.apply(flags, cfg); err != nil {
				return err
			}
			if flags.Changed("allowed-origins") {
				cfg.AllowedOrigins = allowedOrigins
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

			plan := planServe(cfg, oneProject)
			ctx := cmd.Context()
			if ctx == nil {
				ctx = context.Background()
			}
			// Before binding: the probe asks the configured service port, and
			// must not find this process there.
			announceServe(ctx, os.Stderr, runtime.GOOS, displayHome(), isTerminal(os.Stderr), cfg.TargetRepo, plan, httpRepoLister)

			warnNonLocal(bindHosts(cfg))

			s, err := server.NewServer(cfg)
			if err != nil {
				return err
			}

			listeners, bound, err := bindConfigured(cfg)
			if err != nil {
				return err
			}
			openURL := ""
			if !noOpen {
				openURL = browserURL(bound[0].Host, bound[0].Port)
			}
			return runServers(cmd.Context(), s, listeners, openURL)
		},
	}

	f := cmd.Flags()
	addr = registerAddressFlags(f)
	f.StringSliceVar(&allowedOrigins, "allowed-origins", nil, "Extra hostnames allowed to open the live-reload WebSocket (loopback is always allowed)")
	f.BoolVar(&showHidden, "show-hidden", true, "Show hidden files/directories")
	f.StringSliceVar(&excludeDirs, "exclude-dirs", nil, "Directory names to exclude from listings (replaces defaults)")
	f.BoolVar(&useIgnore, "use-ignore-files", true, "Honor .vantageignore and the user ignore file")
	f.IntVar(&walkDepth, "walk-max-depth", 0, "Maximum depth for untracked-file discovery (0 = unlimited)")
	f.Float64Var(&walkTimeout, "walk-timeout", 30, "Timeout in seconds for untracked-file discovery")
	f.BoolVar(&noOpen, "no-open", false, "Do not open the browser on start")
	f.BoolVar(&oneProject, "one-project", false, "Serve PATH as one project even when it is a directory of git clones")

	return cmd
}

// announceServe prints what `serve` says before it binds its port: the line
// for a directory of clones (plan non-nil), always, and then the one service
// tip when tips are on. The probe behind the tip runs only when a tip can be
// printed — tty, on a platform install-service supports — because something
// slow on the service's port costs it its whole timeout.
func announceServe(ctx context.Context, w io.Writer, goos, home string, tty bool, target string, plan *clonesPlan, list repoLister) {
	if plan != nil {
		fmt.Fprintln(w, plan.describe(home))
	}
	if serviceDefinitionPath(goos, home) == "" || !tipsEnabled(tty) {
		return
	}
	st := probeService(ctx, goos, home, target, plan, list)
	if line := st.tip(plan); line != "" {
		fmt.Fprintln(w, line)
	}
}

// planServe applies the directory-of-clones split to a resolved serve config
// unless oneProject asks for the single-project behavior, returning what it did
// for the startup line, or nil when PATH is served as one project.
func planServe(cfg *config.Config, oneProject bool) *clonesPlan {
	if oneProject {
		return nil
	}
	plan, ok := splitClonesDirectory(cfg)
	if !ok {
		return nil
	}
	return plan
}

// displayHome is the home directory paths are abbreviated against in startup
// output, symlink-resolved like every path the config holds; "" when unknown.
func displayHome() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(home); err == nil {
		return resolved
	}
	return home
}

// addressFlags are the --host, --port and --listen flags `serve` and
// `daemon` share. --listen names whole addresses, so it replaces --host and
// --port rather than combining with them.
type addressFlags struct {
	hosts  []string
	port   int
	listen []string
}

// registerAddressFlags adds the address flags to f.
func registerAddressFlags(f *pflag.FlagSet) *addressFlags {
	a := &addressFlags{}
	f.StringSliceVar(&a.hosts, "host", nil, "Server host(s), all on one port (default 127.0.0.1; repeatable / comma-separated)")
	f.IntVar(&a.port, "port", 0, "Server port (default 8000; an explicitly set port must be free, only the default falls forward)")
	f.StringSliceVar(&a.listen, "listen", nil, "Whole host:port address(es) to serve on, each with its own port, e.g. --listen localhost:8001 --listen myhost.tail:8000; replaces --host and --port")
	return a
}

// apply overlays the changed address flags onto cfg, the top of the
// precedence chain: --listen replaces a lower tier's host and port, and
// --host or --port replaces a lower tier's listen.
func (a *addressFlags) apply(f *pflag.FlagSet, cfg *config.Config) error {
	hostOrPort := f.Changed("host") || f.Changed("port")
	if f.Changed("listen") {
		if hostOrPort {
			return fmt.Errorf("--listen names whole addresses; it cannot be combined with --host or --port")
		}
		addrs, err := config.ParseListen(a.listen)
		if err != nil {
			return fmt.Errorf("--listen: %w", err)
		}
		cfg.Listen = addrs
		return nil
	}
	if hostOrPort {
		cfg.Listen = nil
	}
	if f.Changed("host") {
		cfg.Host = a.hosts
	}
	if f.Changed("port") {
		cfg.Port = a.port
		cfg.PortExplicit = true
	}
	return nil
}

// bindHosts are the hosts cfg binds, for the non-localhost warning.
func bindHosts(cfg *config.Config) []string {
	if len(cfg.Listen) == 0 {
		return cfg.Host
	}
	hosts := make([]string, 0, len(cfg.Listen))
	for _, a := range cfg.Listen {
		hosts = append(hosts, a.Host)
	}
	return hosts
}

// bindConfigured opens every listener cfg asks for and returns them with the
// addresses they hold. Listen entries are bound exactly, each on its own
// port, all or none; without them every host shares one port, as
// [listenAll] describes.
func bindConfigured(cfg *config.Config) ([]net.Listener, []config.ListenAddr, error) {
	if len(cfg.Listen) > 0 {
		addrs := make([]string, 0, len(cfg.Listen))
		for _, a := range cfg.Listen {
			addrs = append(addrs, a.String())
		}
		lns, err := bindAll(addrs)
		if err != nil {
			return nil, nil, fmt.Errorf("listen addresses are explicit and could not all be bound: %w", err)
		}
		return lns, cfg.Listen, nil
	}
	lns, port, err := listenAll(cfg.Host, cfg.Port, cfg.PortExplicit)
	if err != nil {
		return nil, nil, err
	}
	bound := make([]config.ListenAddr, 0, len(cfg.Host))
	for _, h := range cfg.Host {
		bound = append(bound, config.ListenAddr{Host: h, Port: port})
	}
	return lns, bound, nil
}

// runServers runs one http.Server per already-bound listener sharing the
// assembled handler, runs the server's background lifecycle, and shuts
// everything down gracefully on SIGINT/SIGTERM. It returns the first
// non-shutdown error. A non-empty openURL is opened in the browser once the
// listeners are up.
//
// It takes listeners rather than addresses so that a caller who wants to
// report the bound port — daemon's startup banner names it before this
// function starts logging its own "Serving on" lines — can resolve it first
// with bindConfigured and print that report before handing the listeners over.
func runServers(parent context.Context, s *server.Server, listeners []net.Listener, openURL string) error {
	if parent == nil {
		parent = context.Background()
	}
	ctx, stop := signal.NotifyContext(parent, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if openURL != "" {
		url := openURL
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
		lns, err := bindAll(joinPort(hosts, port))
		if err != nil {
			return nil, 0, fmt.Errorf("port %d is configured explicitly and could not be bound: %w", port, err)
		}
		return lns, port, nil
	}

	first := port
	for p := first; p < first+portScanLimit && p <= 65535; p++ {
		lns, bindErr := bindAll(joinPort(hosts, p))
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

// joinPort pairs every host with port as a net.Listen address.
func joinPort(hosts []string, port int) []string {
	addrs := make([]string, 0, len(hosts))
	for _, h := range hosts {
		addrs = append(addrs, net.JoinHostPort(h, strconv.Itoa(port)))
	}
	return addrs
}

// bindAll binds every address, undoing any partial bind before returning the
// failure, so a set of addresses is owned everywhere or nowhere.
func bindAll(addrs []string) ([]net.Listener, error) {
	lns := make([]net.Listener, 0, len(addrs))
	for _, a := range addrs {
		ln, err := net.Listen("tcp", a)
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
		return "::1"
	default:
		return host
	}
}

// browserURL is the http:// address a local client reaches a server bound to
// host and port at, an IPv6 address bracketed once.
func browserURL(host string, port int) string {
	return "http://" + net.JoinHostPort(browserHost(host), strconv.Itoa(port))
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
