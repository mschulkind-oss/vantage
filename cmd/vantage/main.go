// Command vantage is a local Markdown viewer with live reload and Git
// awareness. Run with a path to serve that directory; run a subcommand for
// everything else.
package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/mschulkind-oss/vantage/internal/buildinfo"
	"github.com/spf13/cobra"
)

func newRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:           "vantage-md",
		Short:         "A beautiful local Markdown viewer with live reload and Git awareness",
		SilenceUsage:  true,
		SilenceErrors: true,
		Version:       buildinfo.Version(),
	}
	root.SetVersionTemplate("vantage-md, version {{.Version}}\n")
	root.AddCommand(
		newServeCmd(),
		newDaemonCmd(),
		newInitConfigCmd(),
		newInstallServiceCmd(),
		newBuildCmd(),
		newPerfReportCmd(),
	)
	return root
}

func main() {
	root := newRootCmd()
	os.Args = serveByDefault(os.Args, root)
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

// serveByDefault rewrites argv so that invoking the binary with a bare path
// (anything that is not a known subcommand or a flag) runs `serve` against it.
func serveByDefault(argv []string, root *cobra.Command) []string {
	if len(argv) < 2 {
		return argv
	}
	first := argv[1]
	if strings.HasPrefix(first, "-") {
		return argv // a root flag such as --version or --help
	}
	for _, c := range root.Commands() {
		if c.Name() == first || c.HasAlias(first) {
			return argv // an explicit subcommand
		}
	}
	rewritten := make([]string, 0, len(argv)+1)
	rewritten = append(rewritten, argv[0], "serve")
	return append(rewritten, argv[1:]...)
}
