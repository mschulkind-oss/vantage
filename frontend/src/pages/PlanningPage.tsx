/**
 * The planning page (`docs/design/planning-index.md` §6): every section the
 * planning index derives for one repository, top to bottom, with each question
 * rendered as its document renders it and answerable where it stands.
 *
 * Built entirely from the index and the review comments Vantage already keeps,
 * and storing nothing of its own — no snooze, no assignment, no read state.
 * The order is `derivePlanningSections`' alone, so filing an answer never
 * reorders the page; the page changes only when the documents do.
 *
 * Paged (`docs/design/planning-index-at-scale.md` §10.2): a section bar names
 * every section with its exact count, and each section shows one page of its
 * entries, with the page in the URL (`lib/planningPages.ts`). A flip replaces
 * the history entry, so Back from a document returns to the same pages.
 *
 * Its URL is `/.vantage/planning`, and `/.vantage/planning/<repo>` in daemon
 * mode. Viewer URLs are `/<path>` and `/<repo>/<path>`, and the server never
 * serves a `.vantage` path as a document, so this URL hides nothing (Plan Q13).
 *
 * It mounts the socket as a page that is not the viewer: the planning index
 * and the review epochs follow every push, and nothing reloads a document
 * that is not on screen.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ClipboardCopy,
  ListChecks,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  PLANNING_NOTICES,
  badgeFor,
  findDocument,
  type CardBlock,
  type DependsOn,
  type PlanningBadge,
  type PlanningIndex,
  type PlanningQuestion,
  type PlanningSections,
  type QuestionRef,
} from "vantage-md/planning";
import { AppLink } from "../components/AppLink";
import { PlanningBadgeChip } from "../components/PlanningBadge";
import { PlanningPager, type PagerPlace } from "../components/PlanningPager";
import { PlanningQuestionCard } from "../components/PlanningQuestionCard";
import { useWebSocket } from "../hooks/useWebSocket";
import { usePlanningReviews } from "../hooks/usePlanningReviews";
import { copyTextOrWarn } from "../lib/clipboard";
import {
  blockKey as pageBlockKey,
  predrawDiagrams,
  prefetchPlanningPage,
  usePlanningPageInputs,
} from "../hooks/usePlanningPageInputs";
import {
  layoutPlanningPage,
  listedQuestions as listedQuestionsOf,
  pageSearch,
  readPageRequest,
  requestWithPage,
  sectionsOf,
  withPage,
  type CardEntry,
  type LaidOutSection,
  type PlanningLayout,
  type SectionId,
} from "../lib/planningPages";
import {
  planningScanner,
  type QuoteWant,
  type Quotes,
} from "../planningScan/client";
import { planningLimits } from "../planningScan/limits";
import { useRepoStore } from "../stores/useRepoStore";
import {
  usePlanningIndex,
  usePlanningRepo,
  usePlanningStore,
} from "../stores/usePlanningStore";
import {
  answersPayload,
  isPendingForAgent,
  postCommentTo,
  type LineLookup,
} from "../stores/useReviewStore";
import type { ReviewComment } from "../types";

/**
 * Each visit's scroll position, by history entry. Module state, so it outlives
 * the page's own unmount: going Back from a document the page opened returns
 * to the same entry, with the same key, and the page restores it (§6.3). The
 * router keeps no scroll position of its own.
 */
const scrollPositions = new Map<string, number>();

/** How long after a restore the page keeps re-applying it while it grows. */
const RESTORE_SETTLE_MS = 2000;

/**
 * Save this visit's scroll position as the reader scrolls, and put it back
 * when the page is returned to.
 *
 * Restored once the sections render, and again while the page grows for a
 * short while after — the comments load after the cards, and a Mermaid
 * diagram or KaTeX changes a card's height after it paints — until the
 * reader scrolls for themselves. While it restores, nothing it causes is
 * saved: a restore clamped by a page that is still short would otherwise
 * overwrite the position it is restoring.
 *
 * Once per visit: a flip replaces the history entry, and a replaced entry has
 * a key of its own, so the position carries over to the new key rather than
 * being restored there (`docs/design/planning-index-at-scale.md` §10.2). Back
 * from a document opened after the flip then finds it.
 */
function useScrollRestore(
  key: string,
  ready: boolean,
  rootRef: React.RefObject<HTMLElement | null>,
): () => void {
  const restoringRef = useRef(false);
  /** This visit has restored its position, or had none to restore. */
  const restoredRef = useRef(false);
  const keyRef = useRef(key);

  useLayoutEffect(() => {
    const previous = keyRef.current;
    keyRef.current = key;
    if (previous === key) return;
    // Before the restore, what is carried is the position it will restore;
    // after it, where the reader is.
    const carried =
      restoredRef.current && !restoringRef.current
        ? window.scrollY
        : scrollPositions.get(previous);
    if (carried !== undefined) scrollPositions.set(key, carried);
  }, [key]);

  const save = useCallback(() => {
    if (!restoringRef.current) scrollPositions.set(key, window.scrollY);
  }, [key]);

  useEffect(() => {
    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        save();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [save]);

  useLayoutEffect(() => {
    if (!ready || restoredRef.current) return;
    restoredRef.current = true;
    const target = scrollPositions.get(key);
    if (target === undefined) return;
    restoringRef.current = true;
    const restore = () => window.scrollTo(0, target);
    restore();

    const stop = () => {
      restoringRef.current = false;
      observer?.disconnect();
      clearTimeout(timer);
      for (const type of USER_SCROLL_EVENTS) {
        window.removeEventListener(type, stop, true);
      }
    };
    const observer =
      typeof ResizeObserver === "undefined" || !rootRef.current
        ? null
        : new ResizeObserver(restore);
    if (observer && rootRef.current) observer.observe(rootRef.current);
    const timer = setTimeout(stop, RESTORE_SETTLE_MS);
    for (const type of USER_SCROLL_EVENTS) {
      window.addEventListener(type, stop, true);
    }
    return stop;
  }, [key, ready, rootRef]);

  return save;
}

/** What says the reader has taken the scrolling over. */
const USER_SCROLL_EVENTS = [
  "wheel",
  "touchstart",
  "keydown",
  "mousedown",
] as const;

/**
 * What a Disagrees row's stage claims, in the checker's word for the same
 * finding (`planning/stage-disagrees`): Disagrees holds both the `ready` and
 * the `built` role (§6.2).
 */
function builtOrDecided(index: PlanningIndex | null, path: string): string {
  const stages = index?.config.stages;
  const stage = index ? findDocument(index, path)?.stage : undefined;
  if (!stages || !stage || !Object.hasOwn(stages, stage)) return "decided";
  return stages[stage] === "built" ? "built" : "decided";
}

/** A key for one question, stable across index versions. */
const refKey = (ref: QuestionRef): string => `${ref.path}\n${ref.line}`;

/**
 * The lines Copy answers quotes, for each pending group: each anchor line and
 * the context either side, from the scanner client, which drops the rest of
 * the document (`docs/design/planning-index-at-scale.md` §10.5). A group's
 * payload is what its document's whole text would give.
 *
 * Asked for when the pending set changes, so a click copies at once; while
 * the lines are on their way, `loading` says so.
 */
function useQuotedText(
  repo: string | null,
  hashes: Readonly<Record<string, string>> | null,
  groups: readonly { path: string; comments: readonly ReviewComment[] }[],
): { linesOf(path: string): LineLookup | null; loading: boolean } {
  const asked = useMemo((): QuoteWant[] => {
    const context = planningLimits.quoteContextLines;
    return groups.flatMap(({ path, comments }) => {
      const lines = new Set<number>();
      for (const c of comments) {
        const line = c.anchor?.source_line;
        if (!line) continue;
        for (let n = line - context; n <= line + context; n++) {
          if (n >= 1) lines.add(n);
        }
      }
      if (lines.size === 0) return [];
      return [
        {
          path,
          hash: hashes?.[path] ?? "",
          lines: [...lines].sort((a, b) => a - b),
        },
      ];
    });
  }, [groups, hashes]);
  // By value, so a new list of the same lines (the reviews answering again)
  // asks nothing more.
  const wantKey = repo === null ? "" : JSON.stringify([repo, asked]);
  const want = useMemo(
    () => (wantKey === "" ? [] : (JSON.parse(wantKey)[1] as QuoteWant[])),
    [wantKey],
  );
  const [answered, setAnswered] = useState<{
    key: string;
    quotes: Quotes;
  } | null>(null);

  useEffect(() => {
    if (repo === null || want.length === 0) return;
    let live = true;
    const take = (quotes: Quotes) => {
      if (live) setAnswered({ key: wantKey, quotes });
    };
    planningScanner()
      .quotes(repo, want)
      .then(take, () => take({}));
    return () => {
      live = false;
    };
  }, [repo, want, wantKey]);

  const quotes = answered?.key === wantKey ? answered.quotes : null;
  const linesOf = useCallback(
    (path: string): LineLookup | null => {
      const lines = quotes?.[path];
      return lines === undefined ? null : (n) => lines[n];
    },
    [quotes],
  );
  return { linesOf, loading: want.length > 0 && quotes === null };
}

/**
 * A document's badge, drawn once per index version: the same object every
 * render, so a memoized card that shows it renders again only when its index
 * does (§10.4).
 */
const badges = new WeakMap<PlanningIndex, Map<string, PlanningBadge | null>>();
function badgeOf(index: PlanningIndex, path: string): PlanningBadge | null {
  let byPath = badges.get(index);
  if (byPath === undefined) {
    byPath = new Map();
    badges.set(index, byPath);
  }
  let badge = byPath.get(path);
  if (badge === undefined) {
    badge = badgeFor(index, "", { path, fragment: null });
    byPath.set(path, badge);
  }
  return badge;
}

/** A size in the units the limits are written in. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}

/** Flip a section to a page, from the pager at `place`. */
type OnFlip = (id: SectionId, page: number, place: PagerPlace) => void;
/** Ask for the inputs of a section's page ahead of a flip to it. */
type OnPrefetch = (id: SectionId, page: number) => void;

const Section: React.FC<{
  section: LaidOutSection;
  onFlip: OnFlip;
  onPrefetch?: OnPrefetch;
  /** A flip of this section is still waiting for its page. */
  busy?: boolean;
  children: React.ReactNode;
}> = ({ section, onFlip, onPrefetch, busy, children }) => {
  const { id, title, total, pageCount } = section;
  const pager = (place: PagerPlace) =>
    pageCount > 1 && (
      <PlanningPager
        title={title}
        page={section.page}
        pageCount={pageCount}
        start={section.start}
        end={section.end}
        total={total}
        place={place}
        onFlip={(page, from) => onFlip(id, page, from)}
        onPrefetch={onPrefetch && ((page) => onPrefetch(id, page))}
        busy={busy}
      />
    );
  return (
    <section aria-labelledby={id} className="mb-10">
      <h2
        id={id}
        className="mb-3 scroll-mt-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
      >
        {title}
        <span className="ml-2 font-normal tabular-nums">{total}</span>
      </h2>
      {pager("top")}
      <div className="space-y-3">{children}</div>
      {pager("bottom")}
    </section>
  );
};

/**
 * One line naming each non-empty section with its exact count, from the index
 * (`docs/design/planning-index-at-scale.md` §10.1). Each entry scrolls to its
 * section, and adds no history entry.
 */
const SectionBar: React.FC<{ layout: PlanningLayout }> = ({ layout }) => (
  <nav
    aria-label="Sections"
    className="flex flex-wrap items-center gap-x-2 text-sm text-slate-600 dark:text-slate-300"
  >
    {layout.sections.map((section, at) => (
      <React.Fragment key={section.id}>
        {at > 0 && (
          <span
            aria-hidden="true"
            className="text-slate-500 dark:text-slate-400"
          >
            ·
          </span>
        )}
        <a
          href={`#${section.id}`}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(section.id)?.scrollIntoView?.({
              block: "start",
            });
          }}
          className="text-blue-600 no-underline hover:underline dark:text-blue-400"
        >
          {section.title}{" "}
          <span className="tabular-nums">
            {section.total.toLocaleString("en-US")}
          </span>
        </a>
      </React.Fragment>
    ))}
  </nav>
);

const Notice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{children}</p>
);

/** The line that stands where the section bar will be, while the index builds. */
const ProgressLine: React.FC<{
  progress: { done: number; total: number } | null;
}> = ({ progress }) => (
  <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
    {progress === null
      ? "Reading planning documents…"
      : `Scanning planning documents: ${progress.done.toLocaleString("en-US")} of ${progress.total.toLocaleString("en-US")}`}
  </p>
);

/** The notices under the section bar (§6.2): each only when it applies. */
const Notices: React.FC<{ sections: PlanningSections }> = ({ sections }) => (
  <>
    {sections.nothingNeedsYou && (
      <p
        data-testid="nothing-needs-you"
        className="mb-6 text-base font-medium text-slate-700 dark:text-slate-200"
      >
        {PLANNING_NOTICES.nothingNeedsYou}
      </p>
    )}
    {!sections.roadmap.present && (
      <Notice>{PLANNING_NOTICES.noRoadmap(sections.roadmap.path)}</Notice>
    )}
    {!sections.stagesDeclared && <Notice>{PLANNING_NOTICES.noStages}</Notice>}
  </>
);

const NO_SECTIONS: ReadonlySet<SectionId> = new Set();

export const PlanningPage: React.FC = () => {
  const { "*": pathParam } = useParams();
  const location = useLocation();
  const {
    isMultiRepo,
    currentRepo,
    setCurrentRepo,
    repos,
    reposLoaded,
    loadRepos,
  } = useRepoStore();

  // The repository the URL names, in daemon mode.
  const repoName = isMultiRepo
    ? (pathParam?.split("/").filter(Boolean)[0] ?? "")
    : "";
  const repoExists = !isMultiRepo || repos.some((r) => r.name === repoName);

  useEffect(() => {
    if (!reposLoaded) loadRepos();
  }, [loadRepos, reposLoaded]);

  useEffect(() => {
    if (isMultiRepo && repoName && repoExists && repoName !== currentRepo) {
      setCurrentRepo(repoName);
    }
  }, [isMultiRepo, repoName, repoExists, currentRepo, setCurrentRepo]);

  useWebSocket({ viewer: false });

  useEffect(() => {
    document.title = "Vantage: Planning";
    return () => {
      document.title = "Vantage";
    };
  }, []);

  const repo = usePlanningRepo();
  const planning = usePlanningIndex();
  const rescan = usePlanningStore((s) => s.rescan);
  // In daemon mode the store's current repository must be the URL's before
  // anything it holds is shown as this page's.
  const onThisRepo =
    reposLoaded && (!isMultiRepo || (repoName !== "" && repo === repoName));
  const load = onThisRepo ? planning : ({ status: "idle" } as const);

  const buildPath = useCallback(
    (path: string): string =>
      isMultiRepo && currentRepo ? `/${currentRepo}/${path}` : `/${path}`,
    [isMultiRepo, currentRepo],
  );
  const backLink = isMultiRepo && currentRepo ? `/${currentRepo}` : "/";

  const ready = load.status === "ready" ? load : null;
  const index = ready?.index ?? null;
  const sections = useMemo(
    () => (index === null || index.refused ? null : sectionsOf(index)),
    [index],
  );

  // The pages, from the URL (§10.2).
  const [search, setSearch] = useSearchParams();
  const request = useMemo(() => readPageRequest(search), [search]);
  const layout = useMemo(
    () =>
      index === null || sections === null
        ? null
        : layoutPlanningPage(index, sections, request),
    [index, sections, request],
  );
  // A page past a section's end, a malformed page and an explicit page 1 are
  // rewritten in place.
  useEffect(() => {
    if (layout === null) return;
    const canonical = pageSearch(search, layout);
    if (canonical !== null) setSearch(canonical, { replace: true });
  }, [layout, search, setSearch]);

  /** A section to scroll to once its new page is on screen. */
  const scrollToRef = useRef<SectionId | null>(null);
  const flip = useCallback<OnFlip>(
    (id, page, place) => {
      // The bottom pager brings its section's heading back into view; the
      // top one leaves the scroll alone.
      scrollToRef.current = place === "bottom" ? id : null;
      setSearch((prev) => withPage(prev, id, page), { replace: true });
    },
    [setSearch],
  );
  // A pager the pointer or the focus reaches asks for the next page ahead.
  const prefetch = useCallback<OnPrefetch>(
    (id, page) => {
      if (onThisRepo && repo !== null) {
        prefetchPlanningPage(repo, requestWithPage(request, id, page));
      }
    },
    [onThisRepo, repo, request],
  );

  // The inputs of the pages shown (§10.3). The sections render only from a
  // complete set, and keep the last one on screen until the next is complete.
  const inputs = usePlanningPageInputs(onThisRepo ? repo : null, ready, layout);
  const shown =
    inputs.shown !== null && ready !== null && inputs.shown.inputs.repo === repo
      ? inputs.shown
      : null;
  // The sections whose page is still on its way, once that is worth saying.
  const busy = useMemo(() => {
    if (!inputs.slow || shown === null || layout === null) return NO_SECTIONS;
    const on = new Map(
      shown.inputs.layout.sections.map((s) => [s.id, s.page] as const),
    );
    return new Set(
      layout.sections.filter((s) => on.get(s.id) !== s.page).map((s) => s.id),
    );
  }, [inputs.slow, shown, layout]);

  // Opened while the index was still building: the progress line stays until
  // the section bar and the sections replace it in one commit (§10.6).
  const [openedBuilding, setOpenedBuilding] = useState(false);
  if (
    !openedBuilding &&
    onThisRepo &&
    (load.status === "loading" || load.status === "idle")
  ) {
    setOpenedBuilding(true);
  }
  const frameReady =
    index !== null && !index.refused && (!openedBuilding || shown !== null);

  // Every question with a card, on any page: what Copy answers covers.
  const listedQuestions = useMemo(
    () =>
      index === null || sections === null
        ? []
        : listedQuestionsOf(index, sections),
    [index, sections],
  );
  const listedPaths = useMemo(
    () => [...new Set(listedQuestions.map((q) => q.path))],
    [listedQuestions],
  );
  // The shown pages' documents come with their inputs, and every other
  // listed document in one more request once the sections have painted. Each
  // visit reads them afresh; what an earlier visit read is shown meanwhile.
  const [visitStart] = useState(() => performance.now());
  const reviews = usePlanningReviews(onThisRepo ? repo : null, listedPaths, {
    readRest: shown !== null,
    since: visitStart,
  });
  const hashes = ready?.hashes ?? null;

  // Which comments sit on a listed question: only a card, over its rendered
  // question, can say. Each reports its own, by question.
  const [scoped, setScoped] = useState<Readonly<Record<string, string[]>>>({});
  const reportScoped = useCallback(
    (key: string, ids: readonly string[]) =>
      setScoped((prev) => {
        const had = prev[key] ?? [];
        if (had.length === ids.length && had.every((id, i) => ids[i] === id)) {
          return prev;
        }
        const next = { ...prev };
        if (ids.length === 0) delete next[key];
        else next[key] = [...ids];
        return next;
      }),
    [],
  );

  // Copy answers (§6.3): every comment still pending for the agent on a
  // question listed here, grouped by document — built from the reviews, never
  // from the cards, so a comment two cards could both see appears once.
  const pendingGroups = useMemo(() => {
    const onPage = new Set(Object.values(scoped).flat());
    return listedPaths
      .slice()
      .sort()
      .map((path) => ({
        path,
        comments: (reviews.byPath[path] ?? []).filter(
          (c) => onPage.has(c.id) && isPendingForAgent(c),
        ),
      }))
      .filter((group) => group.comments.length > 0);
  }, [scoped, listedPaths, reviews.byPath]);
  const { linesOf, loading: quotesLoading } = useQuotedText(
    onThisRepo ? repo : null,
    hashes,
    pendingGroups,
  );
  const pending = useMemo(
    () =>
      pendingGroups.map((group) => ({
        ...group,
        lines: linesOf(group.path),
      })),
    [pendingGroups, linesOf],
  );
  const pendingCount = pending.reduce((n, g) => n + g.comments.length, 0);
  // Exact only once every listed document's reviews are in (§10.5).
  const countKnown = index !== null && reviews.known;
  const [copied, setCopied] = useState(false);
  const copyAnswers = useCallback(() => {
    if (quotesLoading || !countKnown) return;
    const payload = answersPayload(pending);
    if (payload === null) return;
    void copyTextOrWarn(payload).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [pending, quotesLoading, countKnown]);

  const { adopt } = reviews;
  const fileComment = useCallback(
    async (path: string, comment: ReviewComment) => {
      adopt(path, await postCommentTo(path, comment));
    },
    [adopt],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const saveScroll = useScrollRestore(location.key, shown !== null, rootRef);

  const shownPages = shown?.inputs.layout.pages ?? null;
  useLayoutEffect(() => {
    const id = scrollToRef.current;
    if (id === null || shownPages === null) return;
    scrollToRef.current = null;
    document.getElementById(id)?.scrollIntoView?.({ block: "start" });
  }, [shownPages]);

  // Show question on a preview card: the whole block, which only a request
  // naming it in full is answered with (§10.4), with its diagrams drawn.
  const shownHashes = shown?.inputs.hashes ?? null;
  const showQuestion = useCallback(
    async (question: PlanningQuestion): Promise<CardBlock | null> => {
      const hash = shownHashes?.[question.path];
      if (repo === null || hash === undefined) return null;
      const [answer] = await planningScanner().cards(
        repo,
        [{ path: question.path, hash, startLine: question.block.startLine }],
        { full: true },
      );
      if (answer === undefined || !("block" in answer)) return null;
      await predrawDiagrams([answer.block.markdown]);
      return answer.block;
    },
    [repo, shownHashes],
  );

  const shownIndex = shown?.inputs.index ?? null;
  const card = (question: PlanningQuestion, preview: boolean) => {
    const key = refKey(question);
    const at = pageBlockKey(question.path, question.block.startLine);
    const asPreview = preview || shown?.inputs.previews.has(at) === true;
    return (
      <PlanningQuestionCard
        key={key}
        question={question}
        card={asPreview ? null : (shown?.inputs.blocks.get(at) ?? null)}
        preview={asPreview}
        onShowQuestion={showQuestion}
        badge={shownIndex === null ? null : badgeOf(shownIndex, question.path)}
        comments={reviews.byPath[question.path]}
        commentsLate={shown?.reviewed.has(question.path) !== true}
        href={buildPath(question.path)}
        onOpenDocument={saveScroll}
        onFile={fileComment}
        cardKey={key}
        onScoped={reportScoped}
      />
    );
  };

  const documentRow = (path: string, extra?: React.ReactNode) => (
    <DocumentRow
      key={path}
      path={path}
      index={shownIndex!}
      href={buildPath(path)}
      onOpen={saveScroll}
    >
      {extra}
    </DocumentRow>
  );

  return (
    <div
      ref={rootRef}
      className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="border-b border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
          <AppLink
            to={backLink}
            className="rounded-lg p-2 text-slate-500 no-underline transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            title="Back"
          >
            <ArrowLeft size={20} />
          </AppLink>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600">
            <ListChecks size={18} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Planning
            </h1>
            {isMultiRepo && currentRepo && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {currentRepo}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={copyAnswers}
            disabled={!countKnown || pendingCount === 0 || quotesLoading}
            title={
              !countKnown
                ? "The answers waiting on the agent are still being counted"
                : pendingCount === 0
                  ? "No answers are waiting on the agent"
                  : "Copy every answer waiting on the agent, grouped by document, for one trip"
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {copied ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <ClipboardCopy size={14} aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy answers"}
            {/* Room for four digits, so the count arriving moves nothing. */}
            <span
              data-testid="pending-answers"
              className="inline-block text-right tabular-nums text-slate-500 dark:text-slate-400"
              style={{ minWidth: `${planningLimits.pendingCountDigits}ch` }}
            >
              {countKnown ? pendingCount : "–"}
            </span>
          </button>
        </div>
      </div>

      <main className="relative mx-auto max-w-4xl px-6 py-8">
        {ready?.rescanning && (
          <div className="absolute top-0 right-6 left-6 h-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div className="h-full w-full animate-pulse bg-blue-500" />
          </div>
        )}
        {isMultiRepo && reposLoaded && repoName === "" ? (
          <Notice>
            Choose a project to see its planning page.{" "}
            <AppLink to="/" className="text-blue-600 dark:text-blue-400">
              Projects
            </AppLink>
          </Notice>
        ) : isMultiRepo && reposLoaded && !repoExists ? (
          <Notice>Repository not found: {repoName}</Notice>
        ) : load.status === "error" ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertCircle size={16} className="shrink-0" />
            <span className="flex-1">{load.message}</span>
            <button
              type="button"
              onClick={() => {
                // Without the scan cache: Retry is how a reader gets past a
                // result it no longer trusts.
                if (repo !== null) rescan(repo, { bypassCache: true });
              }}
              className="flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/40"
            >
              <RefreshCw size={12} />
              Retry
            </button>
          </div>
        ) : index?.refused ? (
          <Notice>
            {PLANNING_NOTICES.refused(
              index.candidateCount,
              index.config.maxCandidates,
            )}
          </Notice>
        ) : (
          <>
            {/* The frame (§10.1): the section bar, or the progress line in
                its place, then the notices. It paints first; the sections
                fill the region below it in one later commit. */}
            <div className="mb-6 flex min-h-7 items-center">
              {frameReady && layout !== null ? (
                <SectionBar layout={layout} />
              ) : (
                <ProgressLine
                  progress={
                    load.status === "loading"
                      ? load.progress
                      : index !== null
                        ? {
                            done: index.candidateCount,
                            total: index.candidateCount,
                          }
                        : null
                  }
                />
              )}
            </div>
            {frameReady && sections !== null && <Notices sections={sections} />}
            <div data-planning-sections>
              {shown !== null && frameReady ? (
                <>
                  {shown.inputs.reviewsFailed && (
                    <p
                      role="alert"
                      className="mb-6 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400"
                    >
                      <AlertCircle size={14} className="shrink-0" />
                      Comments could not be loaded.
                    </p>
                  )}
                  <Sections
                    layout={shown.inputs.layout}
                    index={shown.inputs.index}
                    card={card}
                    documentRow={documentRow}
                    buildPath={buildPath}
                    onFlip={flip}
                    onPrefetch={prefetch}
                    busy={busy}
                  />
                </>
              ) : inputs.slow ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2
                    size={32}
                    className="animate-spin text-blue-600"
                    aria-label="Loading this page's cards"
                  />
                </div>
              ) : null}
            </div>
          </>
        )}
      </main>
    </div>
  );
};

/** One document, by name, with its badge and whatever the section adds. */
const DocumentRow: React.FC<{
  path: string;
  index: PlanningIndex;
  href: string;
  onOpen: () => void;
  children?: React.ReactNode;
}> = ({ path, index, href, onOpen, children }) => {
  const badge = badgeFor(index, "", { path, fragment: null });
  return (
    <div
      data-planning-document={path}
      className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <AppLink
          to={href}
          onBeforeNavigate={() => {
            onOpen();
          }}
          className="font-medium text-blue-600 no-underline hover:underline dark:text-blue-400"
        >
          {path}
        </AppLink>
        {badge !== null && <PlanningBadgeChip badge={badge} />}
      </div>
      {children}
    </div>
  );
};

/** What a waiting document waits on: each entry, linked, with its badge. */
const WaitingOn: React.FC<{
  from: string;
  entries: readonly DependsOn[];
  index: PlanningIndex;
  buildPath: (path: string) => string;
}> = ({ from, entries, index, buildPath }) => (
  <ul className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">
    {entries.map((entry) => {
      const badge =
        entry.target === null
          ? null
          : badgeFor(index, from, {
              path: entry.target,
              fragment: entry.fragment,
            });
      return (
        <li key={`${entry.raw}\n${entry.line}`}>
          waits on{" "}
          {entry.target === null ? (
            <code>{entry.raw}</code>
          ) : (
            <AppLink
              to={`${buildPath(entry.target)}${entry.fragment ? `#${entry.fragment}` : ""}`}
              className="text-blue-600 no-underline hover:underline dark:text-blue-400"
            >
              {entry.raw}
            </AppLink>
          )}
          {badge !== null && <PlanningBadgeChip badge={badge} />}
        </li>
      );
    })}
  </ul>
);

/** The sections, top to bottom (§6.2); an empty one is not shown. */
const Sections: React.FC<{
  layout: PlanningLayout;
  index: PlanningIndex;
  card: (question: PlanningQuestion, preview: boolean) => React.ReactNode;
  documentRow: (path: string, extra?: React.ReactNode) => React.ReactNode;
  buildPath: (path: string) => string;
  onFlip: OnFlip;
  onPrefetch?: OnPrefetch;
  busy: ReadonlySet<SectionId>;
}> = ({
  layout,
  index,
  card,
  documentRow,
  buildPath,
  onFlip,
  onPrefetch,
  busy,
}) => {
  const entry = (item: CardEntry) =>
    item.kind === "question" ? (
      <React.Fragment key={`question\n${refKey(item.question)}`}>
        {card(item.question, item.preview)}
      </React.Fragment>
    ) : (
      <React.Fragment key={`doc\n${item.path}`}>
        {documentRow(
          item.path,
          <WaitingOn
            from={item.path}
            entries={item.waitingOn}
            index={index}
            buildPath={buildPath}
          />,
        )}
      </React.Fragment>
    );
  return (
    <>
      {layout.sections.map((section) => (
        <Section
          key={section.id}
          section={section}
          onFlip={onFlip}
          onPrefetch={onPrefetch}
          busy={busy.has(section.id)}
        >
          {section.kind === "cards" ? (
            section.items.map(entry)
          ) : section.kind === "rows" ? (
            section.items.map((path) =>
              documentRow(
                path,
                section.id === "disagrees" ? (
                  <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">
                    Its stage says it is {builtOrDecided(index, path)}, and it
                    still has open questions.
                  </p>
                ) : undefined,
              ),
            )
          ) : section.kind === "skipped" ? (
            <ul className="space-y-1 text-sm">
              {section.items.map(({ path, size }) => (
                <li key={path}>
                  <code>{path}</code>{" "}
                  <span className="text-slate-500 dark:text-slate-400">
                    {formatSize(size)}, over max-file-bytes (
                    {formatSize(index.config.maxFileBytes)})
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-1 text-sm">
              {section.items.map(({ path, reason }) => (
                <li key={path}>
                  <code>{path}</code>{" "}
                  <span className="text-slate-500 dark:text-slate-400">
                    {reason}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ))}
    </>
  );
};
