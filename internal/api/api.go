// Package api implements the Vantage HTTP API: the request handlers behind
// every /api route and the pure response builders they share with the static
// site builder.
//
// # The api↔server boundary
//
// This package deliberately owns no routing, no chi, and no per-repo service
// construction. It exposes a small, stable surface the server package wires up:
//
//   - [RepoServices] plus [WithRepoServices] / [RepoServicesFromContext] carry
//     the resolved [git.GitService] and [fs.FileSystemService] for the current
//     request. The server's resolve middleware populates the context; handlers
//     read it. Routes that need a repo but find none in the context respond 400
//     (multi-repo mode requires a {repo}) — that resolution is the server's job,
//     not this package's.
//   - [Deps] and [NewHandlers] inject the process-wide singletons (review store,
//     perf store, config).
//   - [Handlers.Routes] returns a flat [Route] table the server mounts. Each
//     route declares a [Scope]: ScopeRepo routes are mounted twice (legacy
//     "/api{Pattern}" and multi "/api/r/{repo}{Pattern}") sharing one handler;
//     ScopeGlobal routes are mounted once. The /api/ws route is intentionally
//     absent — the live package owns it.
//
// # Response builders
//
// [responses.go] holds exported, pure builder functions (BuildTree,
// BuildContent, BuildHistory, …) that take explicit services and return model
// types. Both the live handlers here and the static builder call them, so the
// two code paths cannot drift in shape (the R2 mitigation from the port spec).
//
// # Error envelopes
//
// Two envelopes are used, per the port spec §4. Filesystem validation 400s
// (tree/content bad path) emit {"detail":…} because the frontend reads detail.
// Everything else — git 400/404, review delete-miss, repo-required — emits
// {"error":…}, where the frontend only checks the status code. Service-layer
// git errors never surface: they degrade to empty results at HTTP 200.
package api

import (
	"context"

	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/fs"
	"github.com/mschulkind-oss/vantage/internal/git"
	"github.com/mschulkind-oss/vantage/internal/perf"
	"github.com/mschulkind-oss/vantage/internal/review"
)

// RepoServices bundles the per-request, repo-scoped services a handler needs.
// The server's resolve middleware constructs one for the target repository and
// attaches it to the request context with [WithRepoServices]; handlers recover
// it with [RepoServicesFromContext].
//
// Repo is the repository's name as it appears in URLs and review keys: the
// empty string in single-repo mode (the sentinel), or the {repo} path segment
// in multi-repo mode. Git and FS are never nil in a populated RepoServices.
type RepoServices struct {
	// Repo is the repository name ("" in single-repo mode).
	Repo string
	// Git answers git queries for this repository.
	Git *git.GitService
	// FS answers file-tree and file-content queries for this repository.
	FS *fs.FileSystemService
}

// repoServicesKey is the unexported context key under which RepoServices is
// stored, so no other package can collide with or overwrite it.
type repoServicesKey struct{}

// WithRepoServices returns a copy of ctx carrying svc. The server calls this in
// its resolve middleware once the target repository's services are built.
func WithRepoServices(ctx context.Context, svc RepoServices) context.Context {
	return context.WithValue(ctx, repoServicesKey{}, svc)
}

// RepoServicesFromContext recovers the RepoServices attached by
// [WithRepoServices], reporting false when none is present (e.g. a repo-scoped
// route reached in multi-repo mode without a resolved repo). Handlers treat the
// false case as "multi-repo mode requires a {repo}" and respond 400.
func RepoServicesFromContext(ctx context.Context) (RepoServices, bool) {
	svc, ok := ctx.Value(repoServicesKey{}).(RepoServices)
	return svc, ok
}

// Deps are the process-wide singletons the handlers depend on. The server
// constructs these once and passes them to [NewHandlers]. All fields are
// required (non-nil) for the corresponding routes to function.
type Deps struct {
	// Reviews is the persistence store backing the GET/PUT/DELETE review routes.
	Reviews *review.Store
	// Perf is the timing store the perf diagnostics/reset routes read and clear.
	Perf *perf.Store
	// Config is the resolved server configuration. Handlers consult MultiRepo to
	// shape the /repos and /files/all globals.
	Config *config.Config
	// ReviewChanged, when non-nil, is called after every successful review
	// command with the repo name ("" in single-repo mode) and document path.
	// The server wires it to the live hub so connected browsers reload the
	// review; a nil value (tests, static builds) silently skips the push.
	ReviewChanged func(repo, path string)
}

// Handlers holds the dependency-injected state for every API handler. Construct
// it with [NewHandlers]; its methods are [net/http.HandlerFunc] values listed
// by [Handlers.Routes].
type Handlers struct {
	deps Deps
}

// NewHandlers returns a Handlers wired to deps. The returned value is safe for
// concurrent use: handlers hold no per-request mutable state, reading per-repo
// services from the request context instead.
func NewHandlers(deps Deps) *Handlers {
	return &Handlers{deps: deps}
}
