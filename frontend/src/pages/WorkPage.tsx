import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AlertCircle, BriefcaseBusiness, RefreshCw } from "lucide-react";
import {
  deriveWorkBoard,
  documentFilter,
  filterWorkDocuments,
  planningLink,
  questionState,
  waitingDependsOn,
  type PlanningDocument,
  type PlanningIndex,
  type WorkStageGroup,
} from "vantage-md/planning";
import { AppLink } from "../components/AppLink";
import { OpenSidebarButton } from "../components/AppShell";
import { useShellPage } from "../hooks/useShellPage";
import { useWebSocket } from "../hooks/useWebSocket";
import { copyTextOrWarn } from "../lib/clipboard";
import { isStaticMode } from "../lib/staticMode";
import { planningPath } from "../lib/planningRoute";
import { workPath, workRepoFromPath } from "../lib/workRoute";
import { loadWorkHistory } from "../lib/workHistory";
import type { WorkHistory, WorkTransition } from "../lib/workTransitions";
import { PLANNING_IDLE, usePlanningStore } from "../stores/usePlanningStore";
import { useRepoStore } from "../stores/useRepoStore";

const INITIAL_CARDS = 10;
const INITIAL_EVENTS = 5;

interface AppliedIndex {
  repo: string;
  version: number;
  index: PlanningIndex;
}

interface WorkPageUi {
  repoKey: string | null;
  filter: string;
  expandedStages: Record<string, number>;
  terminalOpen: boolean;
  showMoreEvents: boolean;
}

function initialWorkPageUi(repoKey: string | null): WorkPageUi {
  return {
    repoKey,
    filter: "",
    expandedStages: {},
    terminalOpen: false,
    showMoreEvents: false,
  };
}

function cardTitle(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function evidenceDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(date) + " UTC"
    : value;
}

export const WorkPage: React.FC = () => {
  const location = useLocation();
  const routeRepo = workRepoFromPath(location.pathname);
  const { isMultiRepo, currentRepo, setCurrentRepo, repos, reposLoaded } =
    useRepoStore();
  const routeNamesRepo = isMultiRepo ? routeRepo : "";
  const repoExists =
    !isMultiRepo || repos.some((repo) => repo.name === routeNamesRepo);
  const canReadRepo =
    reposLoaded &&
    repoExists &&
    (!isMultiRepo || (routeNamesRepo !== null && routeNamesRepo !== ""));
  const repoKey = canReadRepo ? (routeNamesRepo ?? "") : null;
  const ensure = usePlanningStore((state) => state.ensure);
  const load = usePlanningStore((state) =>
    repoKey === null ? PLANNING_IDLE : (state.byRepo[repoKey] ?? PLANNING_IDLE),
  );
  const rescan = usePlanningStore((state) => state.rescan);
  const ready = load.status === "ready" ? load : null;
  const [applied, setApplied] = useState<AppliedIndex | null>(null);
  const [uiState, setUiState] = useState(() => initialWorkPageUi(repoKey));
  const ui = uiState.repoKey === repoKey ? uiState : initialWorkPageUi(repoKey);
  const updateUi = useCallback(
    (update: (current: WorkPageUi) => WorkPageUi) =>
      setUiState((current) =>
        update(
          current.repoKey === repoKey ? current : initialWorkPageUi(repoKey),
        ),
      ),
    [repoKey],
  );
  const [historyState, setHistoryState] = useState<{
    key: string;
    history: WorkHistory;
  }>();
  const filterRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (repoKey !== null) ensure(repoKey);
  }, [ensure, repoKey]);
  useEffect(() => {
    if (
      isMultiRepo &&
      routeNamesRepo &&
      repoExists &&
      routeNamesRepo !== currentRepo
    ) {
      setCurrentRepo(routeNamesRepo);
    }
  }, [currentRepo, isMultiRepo, repoExists, routeNamesRepo, setCurrentRepo]);
  useWebSocket({ viewer: false });

  useEffect(() => {
    document.title = "Vantage: Work";
    return () => {
      document.title = "Vantage";
    };
  }, []);

  if (uiState.repoKey !== repoKey) {
    setUiState(initialWorkPageUi(repoKey));
  }
  if (ready !== null && repoKey !== null && applied?.repo !== repoKey) {
    setApplied({ repo: repoKey, version: ready.version, index: ready.index });
  }

  const visibleIndex = applied?.repo === repoKey ? applied : null;
  const pendingUpdates =
    ready !== null &&
    visibleIndex !== null &&
    ready.version !== visibleIndex.version;
  const index = visibleIndex?.index ?? null;
  const board = useMemo(
    () => (index === null ? null : deriveWorkBoard(index)),
    [index],
  );
  const decisionsUrl = planningPath(isMultiRepo, routeNamesRepo);
  const showSidebar = !isMultiRepo || (routeNamesRepo !== null && repoExists);
  const focusFilter = useCallback(() => {
    filterRef.current?.focus();
    filterRef.current?.select();
  }, []);
  const shell = useShellPage({
    contentRef,
    showSidebar,
    routeKey: `${location.pathname}${location.search}`,
    currentPath: null,
    onFocusFilter: focusFilter,
  });

  const historyKey =
    visibleIndex === null
      ? null
      : `${visibleIndex.repo}:${visibleIndex.version}`;
  useEffect(() => {
    if (visibleIndex === null || historyKey === null) return;
    let active = true;
    void loadWorkHistory(
      visibleIndex.repo,
      isMultiRepo,
      visibleIndex.index,
    ).then((history) => {
      if (active) setHistoryState({ key: historyKey, history });
    });
    return () => {
      active = false;
    };
  }, [historyKey, isMultiRepo, visibleIndex]);

  const applyRefresh = () => {
    if (ready === null || repoKey === null) return;
    setApplied({ repo: repoKey, version: ready.version, index: ready.index });
    updateUi((current) => ({
      ...current,
      expandedStages: {},
      showMoreEvents: false,
    }));
  };

  const buildPath = (path: string): string =>
    isMultiRepo && routeNamesRepo
      ? `/${encodeURIComponent(routeNamesRepo)}/${path}`
      : `/${path}`;
  const documentDecisionsUrl = (path: string): string => {
    const scoped = documentFilter(path);
    return planningLink(scoped ?? "", { path: decisionsUrl });
  };
  const historyPath = (path: string): string =>
    isMultiRepo && routeNamesRepo
      ? `/history/${encodeURIComponent(routeNamesRepo)}/${path}`
      : `/history/${path}`;

  const renderCard = (
    document: PlanningDocument,
    indexForFacts: PlanningIndex,
  ) => {
    const openQuestions = document.questions.filter(
      (question) => questionState(indexForFacts, question) === "open",
    ).length;
    const blockedQuestions = document.questions.filter(
      (question) => questionState(indexForFacts, question) === "blocked",
    ).length;
    const answeredQuestions = document.questions.filter(
      (question) => questionState(indexForFacts, question) === "answered",
    ).length;
    const role =
      document.stage === null
        ? null
        : indexForFacts.config.stages?.[document.stage];
    const conflict =
      (role === "ready" || role === "built") && openQuestions > 0;
    const dependencies = waitingDependsOn(indexForFacts, document).filter(
      (entry) =>
        entry.target !== null &&
        indexForFacts.documents.some(
          (candidate) => candidate.path === entry.target,
        ),
    );
    const nextQuestion = document.next?.match(/\bOQ-[A-Za-z0-9]*\d\b/)?.[0];
    const nextHasQuestion =
      nextQuestion !== undefined &&
      document.questions.some((question) => question.id === nextQuestion);
    const proposal = [
      `Please review the saved planning claims in ${document.path} for the Work overview.`,
      "",
      "This is a request to update the document only if the intended saved stage or next step has changed. Do not infer implementation progress; Work reflects only the resulting Markdown.",
    ].join("\n");

    return (
      <article
        key={document.path}
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
        data-work-document={document.path}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="font-semibold text-slate-900 dark:text-slate-100">
              <AppLink
                to={buildPath(document.path)}
                className="break-words text-blue-700 hover:underline dark:text-blue-400"
              >
                {cardTitle(document.path)}
              </AppLink>
            </h4>
            <p className="mt-1 break-all font-mono text-xs text-slate-500 dark:text-slate-400">
              {document.path}
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            {document.stage ?? "No saved stage"}
          </span>
        </div>
        {document.next !== null && (
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
            <span className="font-medium">Next:</span>{" "}
            {nextHasQuestion ? (
              <AppLink
                to={documentDecisionsUrl(document.path)}
                className="text-blue-700 hover:underline dark:text-blue-400"
              >
                {document.next}
              </AppLink>
            ) : (
              document.next
            )}
          </p>
        )}
        {document.questions.length > 0 && (
          <p className="mt-3 text-sm">
            <AppLink
              to={documentDecisionsUrl(document.path)}
              className="text-blue-700 hover:underline dark:text-blue-400"
            >
              {document.questions.length} question
              {document.questions.length === 1 ? "" : "s"} on Decisions
            </AppLink>
            <span className="ml-2 text-slate-500 dark:text-slate-400">
              {openQuestions} open · {blockedQuestions} waiting ·{" "}
              {answeredQuestions} answered
            </span>
          </p>
        )}
        {conflict && (
          <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            Stage conflict: a ready/built stage has an open question.
          </p>
        )}
        {dependencies.length > 0 && (
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
            <span className="font-medium">Waiting on:</span>{" "}
            {dependencies.map((dependency, depIndex) => (
              <span key={`${dependency.target}:${dependency.fragment ?? ""}`}>
                {depIndex > 0 && ", "}
                <AppLink
                  to={buildPath(dependency.target!)}
                  className="text-blue-700 hover:underline dark:text-blue-400"
                >
                  {dependency.target}
                  {dependency.fragment ? `#${dependency.fragment}` : ""}
                </AppLink>
              </span>
            ))}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <AppLink
            to={buildPath(document.path)}
            className="text-blue-700 hover:underline dark:text-blue-400"
          >
            Open document to comment
          </AppLink>
          <button
            type="button"
            className="text-left text-blue-700 hover:underline dark:text-blue-400"
            onClick={() => void copyTextOrWarn(proposal)}
          >
            Copy change request
          </button>
        </div>
      </article>
    );
  };

  const stageCards = (
    groupKey: string,
    documents: readonly PlanningDocument[],
  ) => {
    const filtered =
      index === null ? [] : filterWorkDocuments(documents, ui.filter);
    const shownCount = ui.expandedStages[groupKey] ?? INITIAL_CARDS;
    const more = filtered.length > shownCount;
    return (
      <>
        <div className="grid grid-cols-1 gap-3">
          {filtered
            .slice(0, shownCount)
            .map((document) => renderCard(document, index!))}
        </div>
        {more && (
          <button
            type="button"
            className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm text-blue-700 hover:bg-slate-50 dark:border-slate-600 dark:text-blue-400 dark:hover:bg-slate-800"
            onClick={() =>
              updateUi((current) => ({
                ...current,
                expandedStages: {
                  ...current.expandedStages,
                  [groupKey]: shownCount + INITIAL_CARDS,
                },
              }))
            }
          >
            Show more ({filtered.length - shownCount} remaining)
          </button>
        )}
      </>
    );
  };

  const history =
    historyState?.key === historyKey ? historyState.history : null;
  const historyEvents = history?.events ?? [];
  const shownEvents = ui.showMoreEvents
    ? historyEvents
    : historyEvents.slice(0, INITIAL_EVENTS);
  const currentDocuments = new Set(
    index?.documents.map((document) => document.path) ?? [],
  );
  const eventLink = (event: WorkTransition) =>
    currentDocuments.has(event.path)
      ? buildPath(event.path)
      : historyPath(event.path);

  let unavailableMessage: string | null = null;
  if (!reposLoaded) unavailableMessage = "Loading repositories…";
  else if (isMultiRepo && routeNamesRepo === null)
    unavailableMessage = "Choose a repository to see its Work overview.";
  else if (isMultiRepo && !repoExists)
    unavailableMessage = `Repository “${routeNamesRepo}” is not available; no other repository's index is shown.`;

  return (
    <div
      ref={contentRef}
      tabIndex={-1}
      data-content-scroll
      className="h-full overflow-y-auto bg-slate-50 px-4 py-5 text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-slate-100 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center gap-3">
          {showSidebar && <OpenSidebarButton shell={shell} />}
          <BriefcaseBusiness
            aria-hidden="true"
            size={24}
            className="text-blue-600 dark:text-blue-400"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">Work</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              A read-only overview of saved planning documents
            </p>
          </div>
          <AppLink
            to={decisionsUrl}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-blue-700 hover:bg-white dark:border-slate-600 dark:text-blue-400 dark:hover:bg-slate-800"
          >
            Decisions
          </AppLink>
          {pendingUpdates && (
            <button
              type="button"
              onClick={applyRefresh}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <RefreshCw size={15} aria-hidden="true" /> Refresh saved index
              updates
            </button>
          )}
        </header>

        <aside className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
          Work is derived from saved planning documents maintained by their
          owners or agents. Vantage does not verify implementation or write
          source files. Stage labels are the documents’ claims, not proof that
          work was done.
        </aside>

        {unavailableMessage !== null && (
          <section
            className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
            role="status"
          >
            <h2 className="font-semibold">{unavailableMessage}</h2>
            {isMultiRepo && routeNamesRepo === null && reposLoaded && (
              <ul className="mt-3 space-y-2">
                {repos.map((repo) => (
                  <li key={repo.name}>
                    <AppLink
                      className="text-blue-700 hover:underline dark:text-blue-400"
                      to={workPath(true, repo.name)}
                    >
                      {repo.name}
                    </AppLink>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {unavailableMessage === null && load.status !== "ready" && (
          <section
            className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
            role={load.status === "error" ? "alert" : "status"}
          >
            {load.status === "error" ? (
              <>
                <h2 className="font-semibold">Planning index unavailable</h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {load.message}
                </p>
                {!isStaticMode() && (
                  <button
                    type="button"
                    onClick={() => rescan(repoKey ?? "")}
                    className="mt-3 rounded-lg border px-3 py-2 text-sm"
                  >
                    Retry index
                  </button>
                )}
              </>
            ) : (
              <p>Loading the current planning index…</p>
            )}
          </section>
        )}
        {unavailableMessage === null &&
          load.status === "ready" &&
          index === null && (
            <section
              className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
              role="status"
            >
              Applying the first complete planning index…
            </section>
          )}
        {unavailableMessage === null && index !== null && board !== null && (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Saved stage overview</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Role groups organize exact saved stage names; they are not a
                  lifecycle sequence.
                </p>
              </div>
              <label className="flex min-w-[16rem] flex-col gap-1 text-sm font-medium">
                Filter by path, stage, or next step
                <input
                  ref={filterRef}
                  value={ui.filter}
                  onChange={(event) =>
                    updateUi((current) => ({
                      ...current,
                      filter: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal dark:border-slate-600 dark:bg-slate-800"
                  type="search"
                />
              </label>
            </div>
            {pendingUpdates && (
              <p
                className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950/50 dark:text-amber-100"
                role="status"
              >
                Saved index updates are waiting. The displayed board stays
                unchanged until you refresh it.
              </p>
            )}
            {(index.refused ||
              index.skipped.length > 0 ||
              index.unreadable.length > 0) && (
              <section
                className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30"
                aria-label="Planning index coverage"
              >
                <h3 className="font-semibold">
                  Planning index coverage is incomplete
                </h3>
                {index.refused && (
                  <p>
                    The index refused this repository’s candidate count; no
                    smaller board is substituted.
                  </p>
                )}
                {index.skipped.length > 0 && (
                  <p>
                    {index.skipped.length} candidate file(s) were skipped by the
                    index.
                  </p>
                )}
                {index.unreadable.length > 0 && (
                  <p>
                    {index.unreadable.length} candidate file(s) were unreadable.
                  </p>
                )}
              </section>
            )}
            {index.documents.length === 0 && (
              <p className="mb-5 rounded-xl bg-white p-5 text-sm dark:bg-slate-800">
                No planning documents are currently indexed. This is a statement
                about this index only; see coverage above for omissions.
              </p>
            )}
            <div className="space-y-6">
              {board.roles.map((roleGroup) => (
                <section
                  key={roleGroup.role}
                  aria-label={`${roleGroup.role} stage groups`}
                >
                  <h3 className="mb-3 text-lg font-semibold capitalize">
                    {roleGroup.role}
                  </h3>
                  <div className="grid grid-cols-1 gap-5">
                    {roleGroup.stages.map((stageGroup: WorkStageGroup) => {
                      const filtered = filterWorkDocuments(
                        stageGroup.documents,
                        ui.filter,
                      );
                      if (filtered.length === 0) return null;
                      return (
                        <section
                          key={stageGroup.stage}
                          aria-label={`${stageGroup.stage} stage`}
                        >
                          <div className="mb-2 flex items-baseline justify-between">
                            <h4 className="font-semibold">
                              {stageGroup.stage}
                            </h4>
                            <span className="text-xs text-slate-500 dark:text-slate-300">
                              {filtered.length}
                            </span>
                          </div>
                          {stageCards(
                            `${roleGroup.role}:${stageGroup.stage}`,
                            stageGroup.documents,
                          )}
                        </section>
                      );
                    })}
                  </div>
                </section>
              ))}
              {(board.missingStage.length > 0 || board.unmapped.length > 0) && (
                <section aria-label="Needs classification">
                  <h3 className="mb-3 text-lg font-semibold">
                    Needs classification
                  </h3>
                  {board.missingStage.length > 0 && (
                    <section className="mb-4" aria-label="Missing stage">
                      <h4 className="mb-2 font-medium">
                        Missing stage{" "}
                        <span className="text-xs text-slate-500 dark:text-slate-300">
                          {
                            filterWorkDocuments(board.missingStage, ui.filter)
                              .length
                          }
                        </span>
                      </h4>
                      {stageCards("missing", board.missingStage)}
                    </section>
                  )}
                  {board.unmapped.length > 0 && (
                    <section
                      className="space-y-4"
                      aria-label={
                        board.stagesDeclared
                          ? "Unknown stages"
                          : "Unmapped saved stages"
                      }
                    >
                      <h4 className="font-medium">
                        {board.stagesDeclared
                          ? "Unknown stages"
                          : "Unmapped saved stages"}
                      </h4>
                      {board.unmapped.map((group) => {
                        const filtered = filterWorkDocuments(
                          group.documents,
                          ui.filter,
                        );
                        if (filtered.length === 0) return null;
                        return (
                          <section
                            key={group.stage}
                            aria-label={`${group.stage} unmapped stage`}
                          >
                            <div className="mb-2 flex items-baseline justify-between">
                              <h5 className="font-medium">{group.stage}</h5>
                              <span className="text-xs text-slate-500 dark:text-slate-300">
                                {filtered.length}
                              </span>
                            </div>
                            {stageCards(
                              `unmapped:${group.stage}`,
                              group.documents,
                            )}
                          </section>
                        );
                      })}
                    </section>
                  )}
                </section>
              )}
              {board.terminal.length > 0 && (
                <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                  <button
                    type="button"
                    aria-expanded={ui.terminalOpen}
                    onClick={() =>
                      updateUi((current) => ({
                        ...current,
                        terminalOpen: !current.terminalOpen,
                      }))
                    }
                    className="flex w-full items-center justify-between p-4 text-left font-semibold"
                  >
                    Terminal/reference{" "}
                    <span className="text-sm font-normal text-slate-500 dark:text-slate-300">
                      {filterWorkDocuments(board.terminal, ui.filter).length} ·{" "}
                      {ui.terminalOpen ? "Hide" : "Show"}
                    </span>
                  </button>
                  {ui.terminalOpen && (
                    <div className="px-4 pb-4">
                      {stageCards("terminal", board.terminal)}
                    </div>
                  )}
                </section>
              )}
            </div>
            {ui.filter.trim() !== "" &&
              !index.documents.some(
                (document) =>
                  filterWorkDocuments([document], ui.filter).length > 0,
              ) && (
                <p
                  className="mt-5 rounded-lg border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-800"
                  role="status"
                >
                  No documents match “{ui.filter}”.{" "}
                  <button
                    type="button"
                    className="text-blue-700 underline dark:text-blue-400"
                    onClick={() =>
                      updateUi((current) => ({ ...current, filter: "" }))
                    }
                  >
                    Clear filter
                  </button>
                </p>
              )}
            <section
              className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-700"
              aria-labelledby="work-history-heading"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="work-history-heading" className="text-xl font-semibold">
                  Recent stage transitions
                </h2>
                <span className="text-xs text-slate-500 dark:text-slate-300">
                  Rolling 168-hour window · evidence dates, not implementation
                  dates
                </span>
              </div>
              {history === null ? (
                <p
                  className="mt-3 text-sm text-slate-500 dark:text-slate-300"
                  role="status"
                >
                  Loading bounded transition evidence…
                </p>
              ) : (
                <>
                  {history.status !== "complete" && (
                    <p
                      className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
                      role="status"
                    >
                      <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      {history.reason ??
                        "Local Git evidence is partial or unavailable."}{" "}
                      Metadata evidence, if present, is still shown separately.
                    </p>
                  )}
                  {historyEvents.length === 0 && (
                    <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
                      {history.status === "complete"
                        ? "No recent stage transitions were found in the inspected window."
                        : "No transitions can be confirmed from the available evidence."}
                    </p>
                  )}
                  {shownEvents.length > 0 && (
                    <ol className="mt-3 space-y-2">
                      {shownEvents.map((event) => (
                        <li
                          key={event.key}
                          className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                        >
                          <AppLink
                            to={eventLink(event)}
                            className="font-medium text-blue-700 hover:underline dark:text-blue-400"
                          >
                            {event.path}
                          </AppLink>
                          <p className="mt-1">
                            {event.source === "document-metadata"
                              ? `Document metadata evidence: stage entered ${event.to}`
                              : `${event.from} → ${event.to}${event.conflict ? " · conflicts with current document metadata" : ""}`}
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {event.source === "document-metadata"
                              ? "Document metadata evidence"
                              : `Git commit evidence${event.commit ? ` · ${event.commit.slice(0, 8)}` : ""}`}{" "}
                            ·{" "}
                            <time dateTime={event.evidenceAt}>
                              {evidenceDate(event.evidenceAt)}
                            </time>
                          </p>
                          {event.source === "git" && (
                            <AppLink
                              to={historyPath(event.path)}
                              className="mt-1 inline-block text-xs text-blue-700 hover:underline dark:text-blue-400"
                            >
                              View file history
                            </AppLink>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  {!ui.showMoreEvents &&
                    historyEvents.length > INITIAL_EVENTS && (
                      <button
                        type="button"
                        onClick={() =>
                          updateUi((current) => ({
                            ...current,
                            showMoreEvents: true,
                          }))
                        }
                        className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm text-blue-700 dark:border-slate-600 dark:text-blue-400"
                      >
                        Show more ({historyEvents.length - INITIAL_EVENTS}{" "}
                        remaining)
                      </button>
                    )}
                </>
              )}
            </section>
          </>
        )}
        {isStaticMode() && (
          <p className="sr-only">
            Transition history is unavailable in a static export.
          </p>
        )}
      </div>
    </div>
  );
};
