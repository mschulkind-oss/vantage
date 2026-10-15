import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import {
  deriveWorkBoard,
  documentFilter,
  filterWorkDocuments,
  planningLink,
  questionState,
  waitingDependsOn,
  type PlanningDocument,
  type PlanningIndex,
} from "vantage-md/planning";
import { AppLink } from "../components/AppLink";
import { PlanningViewsHeader } from "../components/PlanningViewsHeader";
import { useShellPage } from "../hooks/useShellPage";
import { useHeaderFit } from "../hooks/useHeaderFit";
import { useWebSocket } from "../hooks/useWebSocket";
import { copyTextOrWarn } from "../lib/clipboard";
import { isStaticMode } from "../lib/staticMode";
import { planningPath } from "../lib/planningRoute";
import { workPath, workRepoFromPath } from "../lib/workRoute";
import { loadWorkHistory } from "../lib/workHistory";
import type { WorkHistory, WorkTransition } from "../lib/workTransitions";
import { PLANNING_IDLE, usePlanningStore } from "../stores/usePlanningStore";
import { useRepoStore } from "../stores/useRepoStore";

const INITIAL_EVENTS = 5;

interface AppliedIndex {
  repo: string;
  version: number;
  index: PlanningIndex;
}

interface WorkPageUi {
  repoKey: string | null;
  filter: string;
  terminalOpen: boolean;
  collapsedStages: ReadonlySet<string>;
  showMoreEvents: boolean;
}

function initialWorkPageUi(repoKey: string | null): WorkPageUi {
  return {
    repoKey,
    filter: "",
    terminalOpen: false,
    collapsedStages: new Set(),
    showMoreEvents: false,
  };
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
  const headerRef = useHeaderFit();

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
    document.title = "Vantage: Work overview";
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
  const stageGroups = useMemo(() => {
    if (board === null) return [];
    const groups: {
      key: string;
      label: string;
      role: string;
      documents: readonly PlanningDocument[];
      terminal?: boolean;
    }[] = [];
    for (const roleGroup of board.roles) {
      for (const stageGroup of roleGroup.stages) {
        groups.push({
          key: JSON.stringify(["role", roleGroup.role, stageGroup.stage]),
          label: stageGroup.stage,
          role: roleGroup.role,
          documents: stageGroup.documents,
        });
      }
    }
    if (board.missingStage.length > 0) {
      groups.push({
        key: JSON.stringify(["missing"]),
        label: "Missing stage",
        role: "Needs classification",
        documents: board.missingStage,
      });
    }
    for (const stageGroup of board.unmapped) {
      groups.push({
        key: JSON.stringify(["unmapped", stageGroup.stage]),
        label: stageGroup.stage,
        role: board.stagesDeclared ? "Unknown stage" : "Unmapped saved stage",
        documents: stageGroup.documents,
      });
    }
    if (board.terminal.length > 0) {
      groups.push({
        key: JSON.stringify(["terminal"]),
        label: "Terminal/reference",
        role: "done",
        documents: board.terminal,
        terminal: true,
      });
    }
    return groups.map((group) => ({
      ...group,
      id: `work-stage-${encodeURIComponent(group.key)}`,
    }));
  }, [board]);
  const matchedPaths = useMemo(
    () =>
      new Set(
        index === null
          ? []
          : filterWorkDocuments(index.documents, ui.filter).map(
              (document) => document.path,
            ),
      ),
    [index, ui.filter],
  );
  const matchedCount = matchedPaths.size;
  const filteredDocuments = (documents: readonly PlanningDocument[]) =>
    documents.filter((document) => matchedPaths.has(document.path));
  const questionsPagePath = planningPath(isMultiRepo, routeNamesRepo);
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
      showMoreEvents: false,
      collapsedStages: new Set(),
    }));
  };

  const buildPath = (path: string): string =>
    isMultiRepo && routeNamesRepo
      ? `/${encodeURIComponent(routeNamesRepo)}/${path}`
      : `/${path}`;
  const documentQuestionsUrl = (path: string): string => {
    const scoped = documentFilter(path);
    return planningLink(scoped ?? "", { path: questionsPagePath });
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

    const disclosure = (
      <details className="text-xs">
        <summary
          aria-label={`Full details for ${document.title} — ${document.path}`}
          className="absolute right-2 top-2 cursor-pointer list-none rounded px-1 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <span aria-hidden="true">⋯</span>
          <span className="sr-only">Full details</span>
        </summary>
        <div className="mt-2 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-800">
          <p className="break-all font-mono text-xs text-slate-500 dark:text-slate-400">
            {document.path}
          </p>
          <p className="mt-2">
            <span className="font-medium">Stage:</span>{" "}
            {document.stage ?? "No saved stage"}
          </p>
          {document.next !== null && (
            <p className="mt-2 break-words">
              <span className="font-medium">Next:</span>{" "}
              {nextHasQuestion ? (
                <AppLink
                  to={documentQuestionsUrl(document.path)}
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
            <p className="mt-2">
              <AppLink
                to={documentQuestionsUrl(document.path)}
                className="text-blue-700 hover:underline dark:text-blue-400"
              >
                {document.questions.length} question
                {document.questions.length === 1 ? "" : "s"} on Questions
              </AppLink>
              <span className="ml-2 text-slate-500 dark:text-slate-400">
                {openQuestions} open · {blockedQuestions} waiting ·{" "}
                {answeredQuestions} answered
              </span>
            </p>
          )}
          {conflict && (
            <p className="mt-2 font-medium text-amber-700 dark:text-amber-400">
              Stage conflict: a ready/built stage has an open question.
            </p>
          )}
          {dependencies.length > 0 && (
            <p className="mt-2 break-words">
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
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
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
        </div>
      </details>
    );

    return (
      <article
        key={document.path}
        className="relative min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-800"
        data-work-document={document.path}
      >
        <div className="flex min-w-0 items-start gap-1.5">
          <h4 className="min-w-0 flex-1 pr-5 text-[12px] font-semibold leading-[14px] text-slate-900 dark:text-slate-100">
            <AppLink
              to={buildPath(document.path)}
              aria-label={`${document.title} — ${document.path}`}
              title={`${document.title} — ${document.path}`}
              className="line-clamp-2 break-words text-blue-700 hover:underline dark:text-blue-400"
            >
              {document.title}
            </AppLink>
          </h4>
        </div>
        <p
          className="mt-0 truncate font-mono text-[10px] leading-3 text-slate-500 dark:text-slate-400"
          title={document.path}
        >
          {document.path}
        </p>
        <div className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden text-[10px] leading-3">
          <span
            className="max-w-16 shrink-0 truncate rounded bg-slate-100 px-1 py-0.5 text-slate-600 dark:bg-slate-700 dark:text-slate-200"
            title={document.stage ?? "No saved stage"}
          >
            {document.stage ?? "No stage"}
          </span>
          {document.questions.length > 0 && (
            <AppLink
              to={documentQuestionsUrl(document.path)}
              aria-label={`${document.questions.length} questions on Questions`}
              className="shrink-0 rounded bg-blue-50 px-1 py-0.5 text-blue-700 hover:underline dark:bg-blue-950/60 dark:text-blue-300"
            >
              {document.questions.length}Q
            </AppLink>
          )}
          {conflict && (
            <span
              className="shrink-0 rounded bg-amber-50 px-1 py-0.5 font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-100"
              title="A ready/built stage has an open question"
            >
              Conflict
            </span>
          )}
          {document.next !== null && (
            <span
              className="min-w-0 truncate text-slate-600 dark:text-slate-300"
              title={`Next: ${document.next}`}
            >
              {document.next}
            </span>
          )}
        </div>
        {disclosure}
      </article>
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
    <div className="flex h-full min-h-0 flex-col bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <PlanningViewsHeader
        activeView="overview"
        isMultiRepo={isMultiRepo}
        repoName={routeNamesRepo ?? ""}
        showSidebar={showSidebar}
        shell={shell}
        title="Work overview"
        headerRef={headerRef}
        testId="work-header"
        tools={
          pendingUpdates && (
            <button
              type="button"
              onClick={applyRefresh}
              aria-label="Refresh saved index updates"
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <RefreshCw size={14} aria-hidden="true" /> Refresh
            </button>
          )
        }
      />
      <div
        ref={contentRef}
        tabIndex={-1}
        data-content-scroll
        className="min-h-0 flex-1 overflow-y-auto bg-slate-50 text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
      >
        <main className="mx-auto max-w-[90rem] px-4 py-2 sm:px-6 lg:px-8">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {index !== null && (
              <p
                data-testid="work-counts"
                className="text-xs text-slate-600 dark:text-slate-400"
              >
                {matchedCount} matching · {index.documents.length} in applied
                snapshot
              </p>
            )}
            <label className="flex min-w-0 items-center gap-2 text-xs font-medium">
              <span>Filter Overview</span>
              <input
                ref={filterRef}
                value={ui.filter}
                onChange={(event) =>
                  updateUi((current) => ({
                    ...current,
                    filter: event.target.value,
                  }))
                }
                className="w-48 rounded-md border border-slate-300 bg-white px-2 py-1.5 font-normal dark:border-slate-600 dark:bg-slate-800"
                type="search"
              />
            </label>
          </div>
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
              <nav
                aria-label="Stage count and jump summary"
                className="mb-2 flex flex-wrap gap-1.5 text-[11px]"
              >
                {stageGroups.map((group) => {
                  const count = filteredDocuments(group.documents).length;
                  const text = `${group.label} ${count}${ui.filter.trim() ? `/${group.documents.length}` : ""}`;
                  return group.terminal ? (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => {
                        updateUi((current) => ({
                          ...current,
                          terminalOpen: true,
                        }));
                        requestAnimationFrame(() =>
                          document.getElementById(group.id)?.scrollIntoView({
                            block: "start",
                          }),
                        );
                      }}
                      className="rounded border border-slate-300 bg-white px-1.5 py-1 text-slate-700 hover:border-blue-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                    >
                      {text}
                    </button>
                  ) : (
                    <a
                      key={group.key}
                      href={`#${group.id}`}
                      aria-label={`Jump to ${group.label}: ${count} matching of ${group.documents.length} applied documents`}
                      className="rounded border border-slate-300 bg-white px-1.5 py-1 text-slate-700 hover:border-blue-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                    >
                      {text}
                    </a>
                  );
                })}
                {ui.collapsedStages.size > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      updateUi((current) => ({
                        ...current,
                        collapsedStages: new Set(),
                      }))
                    }
                    className="rounded border border-slate-300 bg-white px-1.5 py-1 text-slate-700 hover:border-blue-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  >
                    Expand all active stages
                  </button>
                )}
              </nav>
              {pendingUpdates && (
                <p
                  className="mb-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:bg-amber-950/50 dark:text-amber-100"
                  role="status"
                >
                  Saved index updates are waiting; the Overview stays on its
                  applied snapshot until Refresh.
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
                      {index.skipped.length} candidate file(s) were skipped by
                      the index.
                    </p>
                  )}
                  {index.unreadable.length > 0 && (
                    <p>
                      {index.unreadable.length} candidate file(s) were
                      unreadable.
                    </p>
                  )}
                </section>
              )}
              {index.documents.length === 0 && (
                <p className="mb-5 rounded-xl bg-white p-5 text-sm dark:bg-slate-800">
                  No planning documents are currently indexed. This is a
                  statement about this index only; see coverage above for
                  omissions.
                </p>
              )}
              <div className="space-y-1">
                {stageGroups.map((group) => {
                  const filtered = filteredDocuments(group.documents);
                  if (group.terminal) {
                    return (
                      <section
                        key={group.key}
                        id={group.id}
                        aria-label="Terminal/reference stage group"
                        className="scroll-mt-2 rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
                      >
                        <button
                          type="button"
                          aria-expanded={ui.terminalOpen}
                          onClick={() =>
                            updateUi((current) => ({
                              ...current,
                              terminalOpen: !current.terminalOpen,
                            }))
                          }
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold"
                        >
                          Terminal/reference
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-300">
                            {filtered.length} matching ·{" "}
                            {group.documents.length} applied ·{" "}
                            {ui.terminalOpen ? "Hide" : "Show"}
                          </span>
                        </button>
                        {ui.terminalOpen && (
                          <div className="border-t border-slate-200 p-2 dark:border-slate-700">
                            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                              {filtered.map((document) =>
                                renderCard(document, index),
                              )}
                            </div>
                          </div>
                        )}
                      </section>
                    );
                  }
                  const collapsed = ui.collapsedStages.has(group.key);
                  return (
                    <section
                      key={group.key}
                      id={group.id}
                      aria-label={`${group.role}: ${group.label}`}
                      className="scroll-mt-2"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1">
                          <button
                            type="button"
                            aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.label} stage`}
                            aria-expanded={!collapsed}
                            aria-controls={`${group.id}-tiles`}
                            onClick={() =>
                              updateUi((current) => {
                                const collapsedStages = new Set(
                                  current.collapsedStages,
                                );
                                if (collapsedStages.has(group.key))
                                  collapsedStages.delete(group.key);
                                else collapsedStages.add(group.key);
                                return { ...current, collapsedStages };
                              })
                            }
                            className="shrink-0 rounded p-0.5 text-slate-600 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            {collapsed ? (
                              <ChevronRight size={16} aria-hidden="true" />
                            ) : (
                              <ChevronDown size={16} aria-hidden="true" />
                            )}
                          </button>
                          <h2 className="min-w-0 break-words text-sm font-semibold">
                            {group.label}
                          </h2>
                        </div>
                        <span className="shrink-0 text-[10px] text-slate-500 dark:text-slate-300">
                          {group.role} · {filtered.length}
                          {ui.filter.trim()
                            ? ` of ${group.documents.length}`
                            : ""}
                        </span>
                      </div>
                      <div
                        id={`${group.id}-tiles`}
                        hidden={collapsed}
                        className={
                          collapsed
                            ? undefined
                            : "grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5"
                        }
                      >
                        {!collapsed &&
                          filtered.map((document) =>
                            renderCard(document, index),
                          )}
                      </div>
                    </section>
                  );
                })}
              </div>
              {ui.filter.trim() !== "" && matchedCount === 0 && (
                <p
                  className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800"
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
                  <h2
                    id="work-history-heading"
                    className="text-xl font-semibold"
                  >
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
                      <div className="mt-3 text-xs text-slate-600 dark:text-slate-300">
                        <p className="flex items-center gap-1.5" role="status">
                          <AlertCircle size={14} className="shrink-0" />
                          {history.status === "partial"
                            ? "Recent Git evidence is limited"
                            : "Recent Git evidence is unavailable"}
                        </p>
                        <details className="mt-1" key={historyKey}>
                          <summary className="w-fit cursor-pointer hover:underline">
                            Coverage details
                          </summary>
                          <div className="mt-1 space-y-1">
                            <p>
                              {history.reason ??
                                (history.status === "partial"
                                  ? "Local Git evidence is partial."
                                  : "Local Git evidence is unavailable.")}
                            </p>
                            <p>
                              This limits automatic transition evidence only;
                              saved stage counts are unaffected.
                            </p>
                            <p>
                              Metadata evidence, if present, is still shown
                              separately.
                            </p>
                          </div>
                        </details>
                      </div>
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
        </main>
      </div>
    </div>
  );
};
