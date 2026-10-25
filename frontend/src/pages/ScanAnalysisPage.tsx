import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { AlertCircle, ArrowLeft, LoaderCircle, X } from "lucide-react";
import { useLocation } from "react-router-dom";
import { AppLink } from "../components/AppLink";
import { useRepoStore } from "../stores/useRepoStore";
import { useShellPage } from "../hooks/useShellPage";
import { isStaticMode } from "../lib/staticMode";
import { scanAnalysisRepoFromPath } from "../lib/scanAnalysisRoute";
import { scanAnalysisIgnoreRule } from "../lib/scanAnalysisIgnoreRule";
import type { ScanAnalysisResponse } from "../types/scanAnalysis";

interface PageState {
  scope: string;
  status: "loading" | "ready" | "diagnosing" | "error" | "cancelled";
  response: ScanAnalysisResponse | null;
  error: string | null;
  errorKind?: "evidence" | "diagnostic";
}

function requestError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.error;
    if (typeof detail === "string" && detail.length > 0) return detail;
    if (error.response?.status === 429) {
      return "Another scan analysis is already running for this server. Try again shortly.";
    }
  }
  return error instanceof Error
    ? error.message
    : "The scan analysis request failed.";
}

function elapsed(value: number): string {
  return `${value.toLocaleString()} ms`;
}

export const ScanAnalysisPage: React.FC = () => {
  const location = useLocation();
  const routeRepo = scanAnalysisRepoFromPath(location.pathname);
  const staticMode = isStaticMode();
  const {
    isMultiRepo,
    currentRepo,
    setCurrentRepo,
    reposLoaded,
    repos,
    loadRepos,
  } = useRepoStore();
  const repoIsKnown =
    routeRepo === null || repos.some((repo) => repo.name === routeRepo);
  const routeIsValid =
    reposLoaded &&
    repoIsKnown &&
    (isMultiRepo ? routeRepo !== null : routeRepo === null);
  const contentRef = useRef<HTMLDivElement>(null);
  const shell = useShellPage({
    contentRef,
    showSidebar: !isMultiRepo || (routeRepo !== null && repoIsKnown),
    routeKey: `${location.pathname}${location.search}`,
    currentPath: null,
  });
  const apiBase = useMemo(
    () =>
      routeRepo === null ? "/api" : `/api/r/${encodeURIComponent(routeRepo)}`,
    [routeRepo],
  );
  const endpoint = `${apiBase}/git/scan-analysis`;
  const scope = routeRepo ?? "";
  const [pageState, setPageState] = useState<PageState | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const current = pageState?.scope === scope ? pageState : null;

  useLayoutEffect(() => {
    if (!reposLoaded || !isMultiRepo) return;
    const requestedRepo = routeRepo !== null && repoIsKnown ? routeRepo : null;
    if (currentRepo !== requestedRepo) {
      setCurrentRepo(requestedRepo, { refreshTree: false });
    }
  }, [
    currentRepo,
    isMultiRepo,
    repoIsKnown,
    reposLoaded,
    routeRepo,
    setCurrentRepo,
  ]);

  useEffect(() => {
    if (staticMode || reposLoaded) return;
    void loadRepos();
  }, [loadRepos, reposLoaded, staticMode]);

  useEffect(() => {
    if (!routeIsValid || staticMode) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const sequence = ++requestSequence.current;
    void axios
      .get<ScanAnalysisResponse>(endpoint, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted || sequence !== requestSequence.current)
          return;
        setPageState({ scope, status: "ready", response: data, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || sequence !== requestSequence.current)
          return;
        setPageState({
          scope,
          status: "error",
          response: null,
          error: requestError(error),
          errorKind: "evidence",
        });
      });
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [endpoint, loadRepos, routeIsValid, scope, staticMode]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const retryEvidence = () => {
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    const sequence = ++requestSequence.current;
    setPageState({ scope, status: "loading", response: null, error: null });
    void axios
      .get<ScanAnalysisResponse>(endpoint, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted || sequence !== requestSequence.current)
          return;
        setPageState({ scope, status: "ready", response: data, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || sequence !== requestSequence.current)
          return;
        setPageState({
          scope,
          status: "error",
          response: null,
          error: requestError(error),
          errorKind: "evidence",
        });
      });
  };

  const startDiagnostic = () => {
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    const sequence = ++requestSequence.current;
    setPageState({
      scope,
      status: "diagnosing",
      response: current?.response ?? null,
      error: null,
    });
    void axios
      .post<ScanAnalysisResponse>(endpoint, {}, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted || sequence !== requestSequence.current)
          return;
        setPageState({ scope, status: "ready", response: data, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || sequence !== requestSequence.current)
          return;
        setPageState({
          scope,
          status: "error",
          response: current?.response ?? null,
          error: requestError(error),
          errorKind: "diagnostic",
        });
      });
  };

  const cancelDiagnostic = () => {
    const controller = activeRequest.current;
    if (!controller) return;
    requestSequence.current++;
    activeRequest.current = null;
    controller.abort();
    setPageState((previous) =>
      previous?.scope === scope
        ? { ...previous, status: "cancelled", error: null }
        : previous,
    );
  };

  const diagnosticRunning = current?.status === "diagnosing";
  const evidenceLoading =
    !staticMode &&
    ((routeIsValid && current === null) || current?.status === "loading");
  const response = current?.response ?? null;
  const evidence = response?.evidence ?? null;
  const diagnostic = response?.diagnostic ?? null;
  const backPath =
    routeIsValid && routeRepo !== null
      ? `/${encodeURIComponent(routeRepo)}`
      : "/";

  return (
    <div
      ref={contentRef}
      tabIndex={-1}
      data-content-scroll
      data-testid="scan-analysis-content"
      className="min-h-0 min-w-0 w-full flex-1 overflow-y-auto bg-slate-50 text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
    >
      <main
        style={{ paddingBottom: shell.bannerSpace }}
        className="mx-auto min-w-0 w-full max-w-4xl space-y-6 px-5 py-8 sm:px-8"
      >
        <AppLink
          to={backPath}
          className="inline-flex items-center gap-2 text-sm text-blue-700 hover:underline dark:text-blue-400"
        >
          <ArrowLeft size={16} aria-hidden /> Back to project
        </AppLink>
        <header>
          <h1 className="text-2xl font-semibold">Recent-file scan analysis</h1>
          {routeRepo !== null && (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Project: {routeRepo}
            </p>
          )}
          <p className="mt-3 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            This page first reads the recorded command and settings only. A
            diagnostic is an optional, bounded filesystem probe; its directory
            timings approximate enumeration work and do not explain or reproduce
            the original git command's elapsed time. It can use disk and CPU
            while it runs, and Cancel stops the request. Results show
            repository-relative paths here and are not part of anonymized
            performance reports.
          </p>
        </header>

        {!reposLoaded && <p role="status">Loading project scope…</p>}
        {reposLoaded && !routeIsValid && (
          <p
            role="alert"
            className="rounded border border-amber-300 p-3 text-sm"
          >
            This analysis URL does not identify an available project. Return to
            the project list and choose an available project, then open analysis
            from its walk-timeout warning.
          </p>
        )}
        {routeIsValid && staticMode && (
          <p
            role="status"
            className="rounded border border-amber-300 p-3 text-sm"
          >
            Scan analysis needs a live server. Open this project with{" "}
            <code>vantage serve</code> to read its evidence and run the
            diagnostic.
          </p>
        )}
        {routeIsValid && evidenceLoading && (
          <p
            role="status"
            className="flex items-center gap-2 break-words [overflow-wrap:anywhere]"
          >
            <LoaderCircle className="animate-spin" size={16} aria-hidden />
            Loading recorded scan evidence…
          </p>
        )}
        {!staticMode && routeIsValid && current?.status === "error" && (
          <div
            role="alert"
            className="rounded border border-red-300 bg-slate-50 p-4 text-sm text-[color:var(--vantage-tone-caution-ink)] dark:bg-slate-800"
          >
            <p className="flex items-center gap-2 break-words [overflow-wrap:anywhere]">
              <AlertCircle size={16} aria-hidden />
              {current.error}
            </p>
            {current.response === null ? (
              <button
                type="button"
                onClick={retryEvidence}
                className="mt-3 rounded border px-3 py-1.5"
              >
                Retry evidence
              </button>
            ) : current.errorKind === "diagnostic" ? (
              <button
                type="button"
                onClick={startDiagnostic}
                className="mt-3 rounded border px-3 py-1.5"
              >
                Retry diagnostic
              </button>
            ) : null}
          </div>
        )}

        {routeIsValid && evidence && (
          <section
            aria-labelledby="recorded-evidence"
            className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800"
          >
            <h2 id="recorded-evidence" className="font-semibold">
              Recorded recent-file scan evidence
            </h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium">
                  Recorded command (configured paths redacted)
                </dt>
                <dd className="mt-1 break-all font-mono text-xs">
                  {evidence.command}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Elapsed</dt>
                <dd>{elapsed(evidence.elapsedMs)}</dd>
              </div>
              <div>
                <dt className="font-medium">Timeout limit</dt>
                <dd>{elapsed(evidence.timeoutMs)}</dd>
              </div>
              <div>
                <dt className="font-medium">Gitignored entries included</dt>
                <dd>{evidence.gitignored ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="font-medium">Timed out</dt>
                <dd>{evidence.timedOut ? "Yes" : "No"}</dd>
              </div>
              {evidence.directory && (
                <div>
                  <dt className="font-medium">Affected scan directory</dt>
                  <dd className="break-all font-mono text-xs">
                    {evidence.directory}
                  </dd>
                </div>
              )}
              {evidence.settings && (
                <>
                  <div>
                    <dt className="font-medium">Show hidden files</dt>
                    <dd>{evidence.settings.show_hidden ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Ignore files enabled</dt>
                    <dd>{evidence.settings.use_ignore_files ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">
                      Configured excluded directory names
                    </dt>
                    <dd>
                      {evidence.settings.exclude_dir_count.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">Walk maximum depth</dt>
                    <dd>
                      {evidence.settings.walk_max_depth === null
                        ? "Unlimited"
                        : evidence.settings.walk_max_depth.toLocaleString()}
                    </dd>
                  </div>
                </>
              )}
            </dl>
            {evidence.error && (
              <p className="mt-3 break-words [overflow-wrap:anywhere] text-sm text-[color:var(--vantage-tone-warning-ink)]">
                Previous scan error: {evidence.error} Try the bounded diagnostic
                below for current evidence.
              </p>
            )}
            {!!evidence.unknown_failures && evidence.unknown_failures > 0 && (
              <p className="mt-3 break-words [overflow-wrap:anywhere] text-sm text-[color:var(--vantage-tone-warning-ink)]">
                {evidence.unknown_failures.toLocaleString()}{" "}
                {evidence.unknown_failures === 1
                  ? "failure record was"
                  : "failure records were"}{" "}
                omitted because the evidence cache was full; this page may not
                represent every recent walk failure. Refresh this page later to
                reread the cache.
              </p>
            )}
          </section>
        )}

        {routeIsValid && response !== null && evidence === null && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No past scan evidence is available; original command, timing and
            settings are unknown.
          </p>
        )}

        {!staticMode && routeIsValid && current?.status === "cancelled" && (
          <p role="status" className="text-sm">
            Diagnostic cancelled. No new results were applied.
          </p>
        )}
        {!staticMode &&
          routeIsValid &&
          current?.status !== "loading" &&
          (current?.status !== "error" || response !== null) && (
            <section
              aria-labelledby="diagnostic-controls"
              className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800"
            >
              <h2 id="diagnostic-controls" className="font-semibold">
                Bounded diagnostic
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                The filesystem sample includes gitignored entries. Vantage
                ignore files (when enabled), configured excluded directories,
                maximum walk depth, and repository boundaries still apply. Each
                ranked timing measures that directory's direct read only, not
                recursive subtree totals or per-entry metadata checks. Total
                elapsed time includes other bounded work, so it need not equal
                the sum of the ranked rows.
              </p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                The comparison excludes gitignored content and counts Markdown
                pathspec matches, not filesystem entries. This ranking is an
                approximation of enumeration work, not attribution of the
                original git command's elapsed time or a disk-size measure.
                Recommendations are examples supported by observed paths; no
                ignore file is changed.
              </p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                This probe can run for up to 5 seconds and visit at most 10,000
                filesystem entries or 1,024 directories, whichever bound is hit
                first. The gitignored-excluding comparison can use up to 2
                seconds within that total. Only one analysis runs globally at a
                time; if the slot is occupied, retry after the other run ends.
              </p>
              <p
                data-testid="scan-analysis-snapshot-limits"
                className="mt-2 text-sm text-slate-600 dark:text-slate-300"
              >
                The diagnostic ignore-file snapshot is bounded to 1 MiB of
                combined file bytes, 4,096 lines combined, and 4 KiB per line.
                The overall 5-second deadline is cooperative, not a hard
                real-time guarantee; a blocked filesystem call can take longer
                to return.
              </p>
              {!diagnostic && (
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                  No diagnostic has run. Start one when you are ready to spend
                  the bounded scan cost.
                </p>
              )}
              {diagnosticRunning ? (
                <div
                  className="mt-4 flex flex-wrap items-center gap-3"
                  role="status"
                >
                  <span className="inline-flex items-center gap-2 text-sm">
                    <LoaderCircle
                      className="animate-spin"
                      size={16}
                      aria-hidden
                    />
                    Diagnostic running…
                  </span>
                  <button
                    type="button"
                    onClick={cancelDiagnostic}
                    className="inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm"
                  >
                    <X size={14} aria-hidden />
                    Cancel diagnostic
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={evidenceLoading || !current?.response}
                  onClick={startDiagnostic}
                  className="mt-4 rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {diagnostic
                    ? "Run diagnostic again"
                    : "Run bounded diagnostic"}
                </button>
              )}
              {diagnostic && (
                <DiagnosticResults
                  diagnostic={diagnostic}
                  useIgnoreFiles={evidence?.settings?.use_ignore_files ?? null}
                />
              )}
            </section>
          )}
      </main>
    </div>
  );
};

function IgnoreRuleSuggestion({
  path,
  useIgnoreFiles,
}: {
  path: string;
  useIgnoreFiles: boolean | null;
}) {
  if (useIgnoreFiles === false) {
    return (
      <p
        data-testid="scan-analysis-ignore-suggestion"
        className="mt-1 text-xs text-slate-600 dark:text-slate-300"
      >
        No <code>.vantageignore</code> rule is offered because recorded{" "}
        <code>use_ignore_files</code> is off. Enable that setting or configure
        the measured directory in <code>exclude_dirs</code> instead.
      </p>
    );
  }
  if (useIgnoreFiles === null) {
    return (
      <p
        data-testid="scan-analysis-ignore-suggestion"
        className="mt-1 text-xs text-slate-600 dark:text-slate-300"
      >
        No copyable rule is offered because the recorded{" "}
        <code>use_ignore_files</code> setting is unknown. Check the live
        configuration first.
      </p>
    );
  }
  const rule = scanAnalysisIgnoreRule(path);
  if (rule === null) {
    return (
      <p
        data-testid="scan-analysis-ignore-suggestion"
        className="mt-1 text-xs text-[color:var(--vantage-tone-warning-ink)]"
      >
        A safe literal <code>.vantageignore</code> rule cannot be generated for
        this name because its reported path may be lossy or unsafe to quote;
        inspect or rename the directory, or configure a verified exclusion
        manually.
      </p>
    );
  }
  return (
    <>
      <p
        data-testid="scan-analysis-ignore-suggestion"
        className="mt-1 text-xs text-slate-600 dark:text-slate-300"
      >
        Suggested repository-root <code>.vantageignore</code> rule (not
        applied): <code>{rule}</code>
      </p>
      <p
        data-testid="scan-analysis-ignore-impact"
        className="mt-1 text-xs text-slate-600 dark:text-slate-300"
      >
        Examples are not exhaustive. This rule can also hide tracked or
        Gitignored documents in this directory that are not listed above.
      </p>
    </>
  );
}

function DiagnosticResults({
  diagnostic,
  useIgnoreFiles,
}: {
  diagnostic: NonNullable<ScanAnalysisResponse["diagnostic"]>;
  useIgnoreFiles: boolean | null;
}) {
  const directories = [...diagnostic.directories].sort(
    (left, right) => right.elapsedMs - left.elapsedMs,
  );
  const comparison = diagnostic.comparison;
  const comparisonSummary =
    comparison.status === "completed"
      ? `Completed: ${elapsed(comparison.elapsedMs)} · ${comparison.entries.toLocaleString()} Markdown pathspec matches`
      : comparison.status === "partial"
        ? `Partial comparison: ${elapsed(comparison.elapsedMs)} · ${comparison.entries.toLocaleString()} Markdown pathspec matches`
        : "Unknown — comparison could not be completed. Run the diagnostic again to retry it.";
  return (
    <div className="mt-6 space-y-5 border-t border-slate-200 pt-5 dark:border-slate-700">
      <div>
        <h3 className="font-semibold">Diagnostic results</h3>
        <p className="mt-1 break-words [overflow-wrap:anywhere] text-sm">
          Diagnostic method:{" "}
          <code className="break-all">{diagnostic.method}</code> ·{" "}
          {elapsed(diagnostic.elapsedMs)} ·{" "}
          {diagnostic.entries.toLocaleString()} entries
          {diagnostic.partial
            ? " · Partial result"
            : " · Complete within diagnostic bound"}
        </p>
        {(diagnostic.partial || diagnostic.reason) && (
          <p className="mt-1 break-words [overflow-wrap:anywhere] text-sm text-[color:var(--vantage-tone-warning-ink)]">
            {diagnostic.reason ||
              "The diagnostic stopped before visiting the full scope."}
          </p>
        )}
      </div>
      <div>
        <h4 className="font-medium">
          Slowest enumerated directories (approximate)
        </h4>
        {directories.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            No directory timing is available. Run the diagnostic again to retry
            the bounded probe.
          </p>
        ) : (
          <ol className="mt-2 space-y-2">
            {directories.map((directory) => (
              <li
                key={directory.path}
                className="rounded border border-slate-200 p-3 text-sm dark:border-slate-700"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <code className="break-all">{directory.path}</code>
                  <span>
                    {elapsed(directory.elapsedMs)} ·{" "}
                    {directory.entries.toLocaleString()} entries
                  </span>
                </div>
                {directory.examples.length > 0 && (
                  <p
                    data-testid="scan-analysis-directory-examples"
                    className="mt-1 break-all text-xs text-slate-500 dark:text-slate-400"
                  >
                    Examples: {directory.examples.join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div>
        <h4 className="font-medium">Gitignored-excluding comparison</h4>
        <p className="mt-1 break-words [overflow-wrap:anywhere] text-sm">
          {comparisonSummary}
        </p>
        {diagnostic.comparison.reason && (
          <p className="break-words [overflow-wrap:anywhere] text-sm text-slate-500 dark:text-slate-400">
            {diagnostic.comparison.reason}
          </p>
        )}
      </div>
      <div>
        <h4 className="font-medium">Evidence-backed exclusion ideas</h4>
        {diagnostic.recommendations.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            No exclusion suggestions are supported by this result. Run the
            diagnostic again if it was partial; otherwise, keep the current
            settings.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {diagnostic.recommendations.map((recommendation) => (
              <li
                key={recommendation.path}
                className="rounded border border-slate-200 p-3 text-sm dark:border-slate-700"
              >
                <code className="break-all">{recommendation.path}</code>
                <p className="mt-1 break-words [overflow-wrap:anywhere]">
                  {recommendation.reason}
                </p>
                <IgnoreRuleSuggestion
                  path={recommendation.path}
                  useIgnoreFiles={useIgnoreFiles}
                />
                {recommendation.examples.length > 0 && (
                  <p
                    data-testid="scan-analysis-affected-paths"
                    className="mt-1 break-all text-xs text-slate-500 dark:text-slate-400"
                  >
                    Affected untracked, non-gitignored Markdown paths observed:{" "}
                    {recommendation.examples.join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
