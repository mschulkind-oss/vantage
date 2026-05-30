package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/mschulkind-oss/vantage/internal/static"
)

// newBuildCmd builds the `build` command: render a self-contained static site
// from a Markdown repository via internal/static. The output directory is
// required; the repository defaults to the current directory.
func newBuildCmd() *cobra.Command {
	var (
		output       string
		name         string
		frontendDist string
	)

	cmd := &cobra.Command{
		Use:   "build [path]",
		Short: "Build a self-contained static site",
		Long: "Build a static site from a Markdown repository.\n\n" +
			"Generates a fully self-contained static site with pre-rendered API\n" +
			"data (content, git history, diffs, file metadata) that any static file\n" +
			"server can host. The frontend detects static mode automatically and\n" +
			"reads from these files instead of a live API.",
		Args: cobra.MaximumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			source := "."
			if len(args) == 1 {
				source = args[0]
			}
			src, err := filepath.Abs(source)
			if err != nil {
				return fmt.Errorf("resolving source: %w", err)
			}
			out, err := filepath.Abs(output)
			if err != nil {
				return fmt.Errorf("resolving output: %w", err)
			}

			if frontendDist != "" {
				fmt.Fprintln(os.Stderr,
					"note: --frontend-dist is ignored; the embedded frontend bundle is always used")
			}

			if err := static.Build(static.Config{
				Source:   src,
				Output:   out,
				RepoName: name,
			}); err != nil {
				return err
			}

			fmt.Println("\nStatic site built successfully!")
			fmt.Printf("Output: %s\n", out)
			fmt.Println("\nTo deploy to S3:")
			fmt.Printf("  aws s3 sync %s s3://your-bucket/path/\n", out)
			fmt.Println("  Note: navigate to .../index.html (S3 does not auto-serve index.html for subdirs)")
			fmt.Println("\nTo deploy to Cloudflare Pages:")
			fmt.Printf("  npx wrangler pages deploy %s\n", out)
			return nil
		},
	}

	f := cmd.Flags()
	f.StringVarP(&output, "output", "o", "", "Output directory for the static site (required)")
	f.StringVarP(&name, "name", "n", "", "Repository display name (defaults to source directory name)")
	f.StringVar(&frontendDist, "frontend-dist", "", "Pre-built frontend dist directory (override; currently ignored)")
	_ = cmd.MarkFlagRequired("output")

	return cmd
}
