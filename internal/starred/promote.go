package starred

import (
	"fmt"
	"os"
	"path"
	"runtime"
	"sort"
	"strings"

	gitignore "github.com/sabhiram/go-gitignore"

	"github.com/mschulkind-oss/vantage/internal/pathsafe"
)

// MaxPromoted caps the rows one source contributes to one repository.
//
// Applied AFTER glob expansion, which is the only place it means anything: a
// config with three lines can name a thousand documents, and the sidebar renders
// the whole section inline with no scroller of its own.
const MaxPromoted = 100

// promoteGlobChars are what make a line a pattern rather than a path.
//
// A line without them costs no filesystem access at all, and that is a
// requirement rather than an optimization — see [Promote].
const promoteGlobChars = "*?["

// PromoteRequest is one repository's promotion, from one source.
type PromoteRequest struct {
	// Repo is the {repo} URL segment, "" in single-repo mode — the same sentinel
	// [Entry] uses.
	Repo string
	// Root is the repository's absolute, resolved root. Containment is proved
	// against it.
	Root string
	// Lines are the config's `promote` entries, in the author's order.
	Lines []string
	// Source labels every row this produces.
	Source Source
	// Candidates lists repo-relative, slash-separated document paths. It is
	// called at most once, and ONLY if some line is a pattern — see [Promote].
	// May be nil, in which case patterns resolve to nothing.
	Candidates func() []string
	// RequireExists drops a literal line whose target is not in the repository.
	//
	// Off for a repository's own config, where a named document is an assertion
	// about this project and may legitimately not be written yet. On for the
	// reader's user-level list, which is applied to EVERY repository they open:
	// "always star my roadmap" means "if there is one", and without this a reader
	// with one such line would carry a phantom row into every project that has
	// no roadmap.
	//
	// Costs one stat per literal line per repository, which is a handful — not a
	// walk. Patterns are unaffected: a candidate list is existing files already.
	RequireExists bool
}

// Promote resolves one source's promote lines into rows.
//
// Returns the rows and the lines it refused, so the caller can report them once.
// A refused line is never fatal: the rest of the list still promotes, because one
// typo should not cost a reader the other documents their project named.
//
// # A literal costs nothing
//
// A line with no glob character is taken as a path and resolved with no
// filesystem access whatsoever. That is load-bearing. The viewer refetches the
// whole list on mount, on reconnect, and on every change push, all ungated, so a
// ten-repository daemon would otherwise perform ten full document walks per star
// click — and the motivating case, one roadmap, is exactly the case that must stay
// free.
//
// Only a pattern calls Candidates, and then at most once for the whole request.
//
// # Promoted paths are held to a stricter standard than bookmarks
//
// [ValidateEntry] is lexical on purpose: a bookmark whose target was deleted has
// to round-trip so the viewer can offer to remove it, which is why that function
// says not to consolidate it with [pathsafe]. A promoted path has no such
// requirement — nobody typed it, and a broken one is a config error rather than a
// reader's stale bookmark. So it clears physical containment too, which is what
// catches a promoted `docs/notes.md` that is a symlink pointing out of the tree.
func Promote(req PromoteRequest) (rows []Listed, rejected []string) {
	return promote(runtime.GOOS, req)
}

// promote is [Promote] with the platform passed in, the seam [normalizeRoot]
// uses, and here it is what makes case-folding testable on any host.
//
// On darwin and windows the filesystem treats two spellings of one name as one
// file, so `promote = ["roadmap.md", "ROADMAP.md"]` — the shape the
// documentation recommends, because it lets one list match whichever spelling a
// project uses — finds the SAME file twice there and would list it twice under
// two names. Folding the dedupe key makes the answer identical on every
// platform: the first spelling wins, and a project that spells it the other way
// still matches.
func promote(goos string, req PromoteRequest) (rows []Listed, rejected []string) {
	var patterns []string
	seen := map[string]bool{}
	key := func(p string) string {
		if foldsCase(goos) {
			return strings.ToLower(p)
		}
		return p
	}

	add := func(p string, isDir bool) {
		if seen[key(p)] {
			return
		}
		seen[key(p)] = true
		rows = append(rows, Listed{
			// StarredAt is deliberately the zero time: a promoted row was never
			// starred, so there is no honest moment to report. Nothing renders
			// it, and inventing "now" would make the row look freshly chosen.
			Entry:  Entry{Repo: req.Repo, Path: p, IsDir: isDir},
			Source: req.Source,
		})
	}

	for _, raw := range req.Lines {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		if strings.ContainsAny(line, promoteGlobChars) {
			patterns = append(patterns, line)
			continue
		}

		// A trailing slash is how a config says "this is a directory", and it is
		// also the one thing ValidateEntry's cleaned-form rule refuses. Strip it
		// and carry the intent in IsDir, which is what the icon reads.
		isDir := strings.HasSuffix(line, "/")
		clean := strings.TrimSuffix(line, "/")

		if err := promotable(req.Root, clean); err != nil {
			rejected = append(rejected, fmt.Sprintf("%q: %v", raw, err))
			continue
		}
		if req.RequireExists && !exists(req.Root, clean) {
			// Not rejected: absence is the expected answer in most repositories
			// for a list written once and applied everywhere. Reporting it would
			// warn on every project that simply has no roadmap.
			continue
		}
		add(clean, isDir)
	}

	if len(patterns) > 0 && req.Candidates != nil {
		matcher := gitignore.CompileIgnoreLines(patterns...)
		for _, candidate := range req.Candidates() {
			if !matcher.MatchesPath(candidate) {
				continue
			}
			// A candidate comes from the server's own walk, so it is already
			// inside the tree — but it is validated anyway rather than trusted,
			// because "the walk only yields safe paths" is an invariant in
			// another package that this one would be silently depending on.
			if err := promotable(req.Root, candidate); err != nil {
				continue
			}
			add(candidate, false)
		}
	}

	SortListed(rows)
	if len(rows) > MaxPromoted {
		rejected = append(rejected, fmt.Sprintf(
			"%d promoted documents exceeds the limit of %d; the rest were dropped",
			len(rows), MaxPromoted))
		rows = rows[:MaxPromoted]
	}
	return rows, rejected
}

// exists reports whether p is present in the repository at root.
//
// Resolved through [pathsafe] rather than joined by hand, so the check cannot be
// tricked into stat'ing outside the tree by a path that passed the lexical rules.
func exists(root, p string) bool {
	resolved, err := pathsafe.Resolve(root, p)
	if err != nil {
		return false
	}
	_, err = os.Stat(resolved)
	return err == nil
}

// promotable reports whether p may be promoted in the repository at root: the
// lexical shape every bookmark must have, plus physical containment.
func promotable(root, p string) error {
	if err := ValidateEntry(Entry{Path: p}); err != nil {
		return err
	}
	if root == "" {
		// No root to prove containment against. Refuse rather than assume: a
		// promotion is config-driven, so silently skipping the check would make
		// the strictness depend on how the caller was wired.
		return fmt.Errorf("no repository root to resolve against")
	}
	if _, err := pathsafe.Resolve(root, p); err != nil {
		return fmt.Errorf("outside the repository: %w", err)
	}
	return nil
}

// MergeListed combines the reader's own bookmarks with promoted rows, resolving
// collisions and ordering the result.
//
// Sources are given in decreasing precedence, which is the only place precedence
// means anything: two promotion *lists* union, because "these matter in this
// project" and "these matter to me everywhere" have no coherent winner — but two
// claims on one row do. The reader's own bookmark wins, since it is the only one
// with an honest timestamp and the only one they can remove; between the two
// promotions the user's own config wins, because that is the one they chose.
//
// Deduplication is correctness rather than tidiness: the sidebar keys each row on
// its repository and path, so two rows with one key is a duplicate-key warning and
// a visibly doubled row.
func MergeListed(sources ...[]Listed) []Listed {
	return mergeListed(runtime.GOOS, sources...)
}

// mergeListed is [MergeListed] with the platform passed in. The key folds case
// where the filesystem does, so a bookmark the reader stored as `roadmap.md` and
// a promotion spelled `ROADMAP.md` are one row on darwin — otherwise the sidebar
// shows one document twice, under two names, and only one of them is theirs.
func mergeListed(goos string, sources ...[]Listed) []Listed {
	type key struct{ repo, path string }
	fold := func(p string) string {
		if foldsCase(goos) {
			return strings.ToLower(p)
		}
		return p
	}
	seen := map[key]bool{}
	var out []Listed

	for _, rows := range sources {
		for _, row := range rows {
			k := key{fold(row.Repo), fold(row.Path)}
			if seen[k] {
				continue
			}
			seen[k] = true
			out = append(out, row)
		}
	}

	SortListed(out)
	return out
}

// PromotedPaths is the promoted set as a sorted path list, for logging and tests.
func PromotedPaths(rows []Listed) []string {
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, path.Join(r.Repo, r.Path))
	}
	sort.Strings(out)
	return out
}
