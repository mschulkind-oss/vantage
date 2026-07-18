// Package gitenv sanitizes the process environment before the codebase shells
// out to the git binary.
//
// Every git invocation here passes an explicit working directory and relies on
// git discovering the repository from there. The environment variables git uses
// to locate a repo, work tree, index, or object store override that discovery,
// so any inherited from the ambient environment would silently redirect the
// command at a different repository. This bites hardest when the process runs
// inside a git hook — e.g. the pre-commit gate running the test suite — where
// git exports GIT_DIR and GIT_INDEX_FILE, pointing child git commands at the
// outer repo and producing "index.lock.lock" / "invalid object" failures.
package gitenv

import (
	"os"
	"strings"
)

// locationVars are the environment variables git consults to locate the
// repository, work tree, index, and object store — the ones that override
// working-directory-based repo discovery.
var locationVars = map[string]bool{
	"GIT_DIR":                          true,
	"GIT_WORK_TREE":                    true,
	"GIT_INDEX_FILE":                   true,
	"GIT_OBJECT_DIRECTORY":             true,
	"GIT_ALTERNATE_OBJECT_DIRECTORIES": true,
	"GIT_COMMON_DIR":                   true,
	"GIT_PREFIX":                       true,
	"GIT_NAMESPACE":                    true,
}

// Scrubbed returns os.Environ() with the repo-location variables in locationVars
// removed, so git resolves the repository from the command's working directory
// rather than from whatever the ambient environment points at. Intentional git
// config (credentials, SSL, http settings) is left untouched. Callers may append
// their own GIT_* identity/config vars to the result.
func Scrubbed() []string {
	environ := os.Environ()
	out := make([]string, 0, len(environ))
	for _, kv := range environ {
		if name, _, ok := strings.Cut(kv, "="); ok && locationVars[name] {
			continue
		}
		out = append(out, kv)
	}
	return out
}
