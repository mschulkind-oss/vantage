# Recent scan analysis implementation plan

## Accepted behavior

The walk-timeout warning links to a project-specific analysis page. Opening it reads cheap evidence only; a deliberate button starts a bounded, cancellable diagnostic. No normal visibility settings or ignore files change. Repository-local paths never enter the intentionally anonymized performance report.

The diagnostic is explicitly an approximation of filesystem enumeration work, not attribution of git's past elapsed time. Rank measured enumeration time and entries, not disk size. Show incomplete/unknown results and evidence-backed exclusion examples. Compare a bounded gitignored-excluding probe where feasible, with unknown comparison explicit on failure.

## Exclusive lane ownership

- Backend writer: `internal/git/**`, `internal/api/**`, backend API/security tests; may extend WalkReport but does not edit server/model/frontend/docs.
- Frontend writer: `frontend/src/**` only, including permanent tests, route, banner and page.
- Integration owner (lead): docs, serial integration, server/model wiring only if necessary, integration tests and gate. No concurrent edits of writer-owned files.
- Independent reviewer: read-only final requirements review.

## Shared contract

Repo-scoped API registered through ScopeRepo: GET `/git/scan-analysis` reads evidence and never scans; POST `/git/scan-analysis` starts the diagnostic with request cancellation. No caller-controlled filesystem path or budget. Concurrent diagnostics are limited and rejected with HTTP 429. Errors use the existing JSON error convention.

Response (both methods): `evidence` nullable object with `command` string, `elapsedMs` number, `timeoutMs` number, `gitignored` boolean, `timedOut` boolean; `diagnostic` nullable object with `method` string, `partial` boolean, `reason` string, `elapsedMs` number, `entries` number, `directories` array of `{path, elapsedMs, entries, examples: string[]}`, `comparison` object `{status: string, elapsedMs: number, entries: number, reason: string}`, `recommendations` array of `{path, reason, examples: string[]}`. All arrays serialized as arrays, no absolute paths. Additional evidence settings may be added compatibly. Missing past evidence is unknown, not fabricated.

Frontend page route: `/.vantage/scan-analysis` single repo; `/.vantage/scan-analysis/:repo` multi-repo, encoded project segment. Determine explicit project from route, never use mutable current-project state to choose the request. API base `/api` single repo or `/api/r/${encodeURIComponent(repo)}` multi repo. GET on opening, POST only on explicit request; AbortController cancellation and stale response suppression. The page explains measurement limits and user-visible cost. Link only for walk_timeout warnings.

## Validation and delivery

Permanent backend tests cover timeout evidence, bounded/cancelled/concurrent diagnostics, path/symlink/repository boundaries and perf separation. Frontend tests cover scoped warning navigation, loading, partial, failure/retry and deliberate invocation. Integrate backend then frontend commits serially. Run format and coherent conventional commits without bypassing hooks. Independent high-effort review against original requirements, repair confirmed blockers/majors (at most two cycles); full `just done` on committed clean tree. Root owns landing onto main.
