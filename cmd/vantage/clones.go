package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/fs"
	"github.com/mschulkind-oss/vantage/internal/fsname"
	"github.com/mschulkind-oss/vantage/internal/git"
)

// clonesPlan records how `serve` split a directory of clones, for the startup
// line and the service tip. A directory of clones — a term docs/design/
// serve-clones-directory.md §2 coins — is a directory that is not inside a git
// work tree and has at least one immediate child that is a repository.
type clonesPlan struct {
	// Dir is the absolute, resolved directory being served.
	Dir string
	// Repos is how many projects discovery made from its children.
	Repos int
	// Loose is the name of the project serving the Markdown outside every
	// clone, or "" when there is none.
	Loose string
	// LooseEmpty is true when the loose project is served only because there
	// would otherwise be nothing to serve: it has no Markdown outside the
	// children.
	LooseEmpty bool
	// OtherCheckouts is true when a child whose .git is a file is not a linked
	// worktree — a repository made with --separate-git-dir, or a moved
	// submodule checkout. No mode serves those either, but the startup line
	// must not call them worktrees.
	OtherCheckouts bool
}

// splitClonesDirectory turns cfg — a resolved serve-mode config — into the
// multi-repo config the daemon would build for a `source_dirs` entry, when
// cfg.TargetRepo is a directory of clones. It reports false, leaving cfg
// untouched, for anything else: a file, a directory inside a repository, or a
// directory with no repository among its immediate children.
//
// The projects come from [config.Config.DiscoverReposFromSourceDirs], the
// daemon's own discovery, so the two modes cannot drift; and because
// SourceDirs is set, the server's refresh loop picks up a clone made after
// startup exactly as the daemon's does. The loose project, when there is one,
// is named after the clones are, so every clone gets the name the daemon would
// give it and a link to one means the same project in both; a clone sharing
// the directory's name leaves the loose project the "-2" suffix. It is still
// listed first.
func splitClonesDirectory(cfg *config.Config) (*clonesPlan, bool) {
	dir := cfg.TargetRepo
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return nil, false
	}
	// The cheap test first: most directories served have no repository among
	// their children, and then git is never asked anything.
	if !holdsRepositories(dir) {
		return nil, false
	}
	if git.NewService(dir, git.Options{}).InWorkTree() {
		return nil, false
	}

	cfg.MultiRepo = true
	cfg.SourceDirs = []string{dir}
	cfg.Repos = nil

	plan := &clonesPlan{Dir: dir}
	wantLoose := hasLooseMarkdown(cfg, dir)
	plan.Repos = len(cfg.DiscoverReposFromSourceDirs())
	// With no clone to serve — every child is a linked worktree, which no
	// mode serves — serving nothing at all would be worse than serving what is
	// beside them.
	if wantLoose || len(cfg.Repos) == 0 {
		loose := config.RepoConfig{Name: freeRepoName(runtime.GOOS, looseProjectName(dir), cfg.Repos), Path: dir, Loose: true}
		cfg.Repos = append([]config.RepoConfig{loose}, cfg.Repos...)
		plan.Loose = loose.Name
		plan.LooseEmpty = !wantLoose
	}
	plan.OtherCheckouts = holdsOtherGitfileCheckouts(dir)
	return plan, true
}

// freeRepoName is name, or — when one of repos already has it — name with the
// first "-2", "-3", … suffix none of them has: the daemon's rule for a
// collision, which compares names as goos's filesystem does (see
// [config.Config.DiscoverReposFromSourceDirs]).
func freeRepoName(goos, name string, repos []config.RepoConfig) string {
	taken := make(map[string]bool, len(repos))
	for _, r := range repos {
		taken[fsname.Key(goos, r.Name)] = true
	}
	candidate := name
	for n := 2; taken[fsname.Key(goos, candidate)]; n++ {
		candidate = fmt.Sprintf("%s-%d", name, n)
	}
	return candidate
}

// holdsRepositories reports whether any immediate, non-hidden child of dir is a
// repository: it holds a .git directory, or it is a linked worktree. Only the
// first kind becomes a project (see docs/design/serve-clones-directory.md §2.1),
// but either one means dir is not a single project.
func holdsRepositories(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		full := filepath.Join(dir, e.Name())
		if info, err := os.Stat(full); err != nil || !info.IsDir() {
			continue
		}
		if git.IsRepoBoundary(full) {
			return true
		}
	}
	return false
}

// holdsOtherGitfileCheckouts reports whether an immediate, non-hidden child of
// dir has a .git file that does not make it a linked worktree (see
// [isLinkedWorktree]).
func holdsOtherGitfileCheckouts(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		full := filepath.Join(dir, e.Name())
		if git.IsWorktree(full) && !isLinkedWorktree(full) {
			return true
		}
	}
	return false
}

// isLinkedWorktree reports whether dir is a linked worktree in git's own sense:
// its .git file names a gitdir holding the commondir file `git worktree add`
// writes. A repository made with --separate-git-dir, or a submodule checkout,
// has a .git file too, and no commondir.
func isLinkedWorktree(dir string) bool {
	data, err := os.ReadFile(filepath.Join(dir, ".git"))
	if err != nil {
		return false
	}
	gitdir, ok := strings.CutPrefix(strings.TrimSpace(string(data)), "gitdir:")
	if !ok {
		return false
	}
	gitdir = strings.TrimSpace(gitdir)
	if !filepath.IsAbs(gitdir) {
		gitdir = filepath.Join(dir, gitdir)
	}
	_, err = os.Stat(filepath.Join(gitdir, "commondir"))
	return err == nil
}

// hasLooseMarkdown reports whether dir holds a Markdown file outside every
// repository below it. It is the tree's own has-Markdown walk with repository
// boundaries on, so it stops at the first file found and honors
// walk_max_depth, the exclude list and the ignore files.
func hasLooseMarkdown(cfg *config.Config, dir string) bool {
	return fs.New(fs.Config{
		RootPath:       dir,
		ExcludeDirs:    cfg.ExcludeDirs,
		UseIgnoreFiles: cfg.UseIgnoreFiles,
		WalkMaxDepth:   cfg.WalkMaxDepth,
		StopAtRepos:    true,
	}).HasMarkdown()
}

// looseProjectName names the loose project after the directory, as each clone
// is named after its own. The filesystem root has no name of its own.
func looseProjectName(dir string) string {
	name := filepath.Base(dir)
	if name == string(filepath.Separator) || name == "." || name == "" {
		return "root"
	}
	return name
}

// describe renders the startup line that says what serve did with a
// directory of clones.
func (p *clonesPlan) describe(home string) string {
	shown := tildePath(p.Dir, home)
	var b strings.Builder
	switch p.Repos {
	case 0:
		children := "linked worktrees"
		if p.OtherCheckouts {
			children = "repositories whose .git is a file, such as linked worktrees"
		}
		fmt.Fprintf(&b, "%s holds only %s, which Vantage does not serve as projects; ", shown, children)
		if p.LooseEmpty {
			fmt.Fprintf(&b, "serving the directory as %q, which has no Markdown outside them.", p.Loose)
		} else {
			fmt.Fprintf(&b, "serving the Markdown outside them as %q.", p.Loose)
		}
	case 1:
		fmt.Fprintf(&b, "%s holds 1 git repository; serving it as its own project", shown)
	default:
		fmt.Fprintf(&b, "%s holds %d git repositories; serving each as its own project", shown, p.Repos)
	}
	if p.Repos > 0 {
		if p.Loose != "" {
			outside := "them"
			if p.Repos == 1 {
				outside = "it"
			}
			fmt.Fprintf(&b, " (plus %q for the Markdown outside %s)", p.Loose, outside)
		}
		b.WriteString(".")
	}
	b.WriteString(" Use --one-project to serve it as a single project.")
	return b.String()
}

// tildePath abbreviates a path under home to ~/… for display.
func tildePath(p, home string) string {
	if home == "" {
		return p
	}
	if p == home {
		return "~"
	}
	if rest, ok := strings.CutPrefix(p, home+string(filepath.Separator)); ok {
		return "~" + string(filepath.Separator) + rest
	}
	return p
}
