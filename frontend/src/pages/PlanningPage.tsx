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
import { useLocation, useParams } from "react-router-dom";
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
  derivePlanningSections,
  findDocument,
  questionFor,
  type CardBlock,
  type DependsOn,
  type PlanningIndex,
  type PlanningQuestion,
  type PlanningSections,
  type QuestionRef,
} from "vantage-md/planning";
import { AppLink } from "../components/AppLink";
import { PlanningBadgeChip } from "../components/PlanningBadge";
import { PlanningQuestionCard } from "../components/PlanningQuestionCard";
import { useWebSocket } from "../hooks/useWebSocket";
import { usePlanningReviews } from "../hooks/usePlanningReviews";
import { copyTextOrWarn } from "../lib/clipboard";
import {
  planningScanner,
  type CardWant,
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
 */
function useScrollRestore(
  key: string,
  ready: boolean,
  rootRef: React.RefObject<HTMLElement | null>,
): () => void {
  const restoringRef = useRef(false);

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
    if (!ready) return;
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

/** A key for one card block of one repository's document. */
const blockKey = (repo: string, path: string, startLine: number): string =>
  `${repo}\n${path}\n${startLine}`;

interface HeldBlock {
  /** The content hash of the document version the block was asked for. */
  hash: string;
  /** `null`: that version has no such block, or it could not be had. */
  block: CardBlock | null;
}

/**
 * The blocks the page last held, kept past its unmount as `scrollPositions`
 * is: Back from a document the page opened then renders the same cards at
 * once, and the scroll position is restored over them.
 */
let lastBlocks: ReadonlyMap<string, HeldBlock> = new Map();

/**
 * The card block of every listed question, from the scanner client, which
 * cut it in the scan (`docs/design/planning-index-at-scale.md` §7.4): asked
 * for in full, once per document version, by the content hash the index
 * holds, and kept on screen while the next version's is on its way. No
 * document's text reaches this thread (S2).
 *
 * `complete` says every listed question has its current version's answer.
 *
 * An interim for the planning page as it stands, which renders every card:
 * the paged page asks for the shown pages' blocks alone, as part of their
 * inputs, and keeps the last few sets of them (§10.3).
 */
function useCardBlocks(
  repo: string | null,
  hashes: Readonly<Record<string, string>> | null,
  questions: readonly PlanningQuestion[],
): {
  blockFor(question: PlanningQuestion): CardBlock | null | undefined;
  complete: boolean;
} {
  const [held, setHeld] = useState(() => lastBlocks);
  useEffect(() => {
    lastBlocks = held;
  }, [held]);

  // Each block once, by the version of its document the index read.
  const wanted = useMemo(() => {
    const out = new Map<string, CardWant>();
    if (repo === null || hashes === null) return out;
    for (const q of questions) {
      const hash = hashes[q.path];
      if (hash === undefined) continue;
      const { startLine } = q.block;
      out.set(blockKey(repo, q.path, startLine), {
        path: q.path,
        hash,
        startLine,
      });
    }
    return out;
  }, [repo, hashes, questions]);

  useEffect(() => {
    if (repo === null) return;
    const missing = [...wanted].filter(
      ([key, want]) => held.get(key)?.hash !== want.hash,
    );
    if (missing.length === 0) return;
    let live = true;
    const take = (answerOf: (at: number) => CardBlock | null) => {
      if (!live) return;
      setHeld((prev) => {
        // Only the listed questions' blocks are kept.
        const next = new Map<string, HeldBlock>();
        for (const key of wanted.keys()) {
          const had = prev.get(key);
          if (had !== undefined) next.set(key, had);
        }
        missing.forEach(([key, want], at) => {
          // A block from another version keeps the one on screen until a
          // push refreshes the path (§10.3).
          const block = answerOf(at) ?? prev.get(key)?.block ?? null;
          next.set(key, { hash: want.hash, block });
        });
        return next;
      });
    };
    planningScanner()
      .cards(
        repo,
        missing.map(([, want]) => want),
        { full: true },
      )
      .then(
        (answers) =>
          take((at) => {
            const answer = answers[at];
            return answer !== undefined && "block" in answer
              ? answer.block
              : null;
          }),
        () => take(() => null),
      );
    return () => {
      live = false;
    };
  }, [repo, wanted, held]);

  const blockFor = useCallback(
    (question: PlanningQuestion) =>
      repo === null
        ? undefined
        : held.get(blockKey(repo, question.path, question.block.startLine))
            ?.block,
    [repo, held],
  );
  const complete = [...wanted].every(
    ([key, want]) => held.get(key)?.hash === want.hash,
  );
  return { blockFor, complete };
}

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

/** A size in the units the limits are written in. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}

const Section: React.FC<{
  id: string;
  title: string;
  count?: number;
  children: React.ReactNode;
}> = ({ id, title, count, children }) => (
  <section aria-labelledby={id} className="mb-10">
    <h2
      id={id}
      className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
    >
      {title}
      {count !== undefined && (
        <span className="ml-2 font-normal tabular-nums">{count}</span>
      )}
    </h2>
    <div className="space-y-3">{children}</div>
  </section>
);

const Notice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{children}</p>
);

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
    () =>
      index === null || index.refused ? null : derivePlanningSections(index),
    [index],
  );

  // Every question with a card, in page order: what the reviews are for.
  const listedQuestions = useMemo(() => {
    if (index === null || sections === null) return [];
    const refs: QuestionRef[] = [
      ...sections.needsYou,
      ...(sections.unrouted ?? []),
      ...sections.waiting.flatMap((w) =>
        w.kind === "question" ? [w.question] : [],
      ),
    ];
    return refs.flatMap((ref) => {
      const q = questionFor(index, ref);
      return q === undefined ? [] : [q];
    });
  }, [index, sections]);
  const listedPaths = useMemo(
    () => [...new Set(listedQuestions.map((q) => q.path))],
    [listedQuestions],
  );
  // Each visit reads every listed document's review afresh, in one request;
  // what an earlier visit read is shown meanwhile.
  const [visitStart] = useState(() => performance.now());
  const reviews = usePlanningReviews(onThisRepo ? repo : null, listedPaths, {
    since: visitStart,
  });
  const hashes = ready?.hashes ?? null;
  const blocks = useCardBlocks(
    onThisRepo ? repo : null,
    hashes,
    listedQuestions,
  );
  // The sections wait for their cards the first time only; after that a new
  // version's block replaces the one on screen when it lands.
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (blocks.complete && ready !== null && repo !== null && shownFor !== repo) {
    setShownFor(repo);
  }
  const cardsShown = shownFor !== null && shownFor === repo;

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
  const [copied, setCopied] = useState(false);
  const copyAnswers = useCallback(() => {
    if (quotesLoading) return;
    const payload = answersPayload(pending);
    if (payload === null) return;
    void copyTextOrWarn(payload).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [pending, quotesLoading]);

  const { adopt } = reviews;
  const fileComment = useCallback(
    async (path: string, comment: ReviewComment) => {
      adopt(path, await postCommentTo(path, comment));
    },
    [adopt],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const saveScroll = useScrollRestore(
    location.key,
    sections !== null && cardsShown,
    rootRef,
  );

  const card = (question: PlanningQuestion) => {
    const key = refKey(question);
    return (
      <PlanningQuestionCard
        key={key}
        question={question}
        card={blocks.blockFor(question)}
        badge={
          index === null
            ? null
            : badgeFor(index, "", { path: question.path, fragment: null })
        }
        comments={reviews.byPath[question.path]}
        href={buildPath(question.path)}
        onOpenDocument={saveScroll}
        onFile={fileComment}
        onScoped={(ids) => reportScoped(key, ids)}
      />
    );
  };

  const cards = (refs: readonly QuestionRef[]) =>
    index === null
      ? null
      : refs.map((ref) => {
          const q = questionFor(index, ref);
          return q === undefined ? null : card(q);
        });

  const documentRow = (path: string, extra?: React.ReactNode) => (
    <DocumentRow
      key={path}
      path={path}
      index={index!}
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
            disabled={pendingCount === 0 || quotesLoading}
            title={
              pendingCount === 0
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
            <span
              data-testid="pending-answers"
              className="tabular-nums text-slate-500 dark:text-slate-400"
            >
              {pendingCount}
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
        ) : index === null || (sections !== null && !cardsShown) ? (
          <div className="flex items-center justify-center py-20">
            <Loader2
              size={32}
              className="animate-spin text-blue-600"
              aria-label="Scanning the planning documents"
            />
          </div>
        ) : index.refused ? (
          <Notice>
            {PLANNING_NOTICES.refused(
              index.candidateCount,
              index.config.maxCandidates,
            )}
          </Notice>
        ) : sections !== null ? (
          <Sections
            sections={sections}
            index={index}
            cards={cards}
            documentRow={documentRow}
            buildPath={buildPath}
          />
        ) : null}
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
  sections: PlanningSections;
  index: PlanningIndex;
  cards: (refs: readonly QuestionRef[]) => React.ReactNode;
  documentRow: (path: string, extra?: React.ReactNode) => React.ReactNode;
  buildPath: (path: string) => string;
}> = ({ sections, index, cards, documentRow, buildPath }) => {
  const {
    needsYou,
    unrouted,
    waiting,
    ready,
    graduate,
    disagrees,
    skipped,
    unreadable,
  } = sections;
  return (
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

      {needsYou.length > 0 && (
        <Section id="needs-you" title="Needs you" count={needsYou.length}>
          {cards(needsYou)}
        </Section>
      )}
      {unrouted !== null && unrouted.length > 0 && (
        <Section id="unrouted" title="Unrouted" count={unrouted.length}>
          {cards(unrouted)}
        </Section>
      )}
      {waiting.length > 0 && (
        <Section id="waiting" title="Waiting" count={waiting.length}>
          {waiting.map((entry) =>
            entry.kind === "question" ? (
              <React.Fragment key={`question\n${refKey(entry.question)}`}>
                {cards([entry.question])}
              </React.Fragment>
            ) : (
              <React.Fragment key={`doc\n${entry.path}`}>
                {documentRow(
                  entry.path,
                  <WaitingOn
                    from={entry.path}
                    entries={entry.waitingOn}
                    index={index}
                    buildPath={buildPath}
                  />,
                )}
              </React.Fragment>
            ),
          )}
        </Section>
      )}
      {ready !== null && ready.length > 0 && (
        <Section id="ready" title="Ready" count={ready.length}>
          {ready.map((path) => documentRow(path))}
        </Section>
      )}
      {graduate !== null && graduate.length > 0 && (
        <Section id="graduate" title="Graduate" count={graduate.length}>
          {graduate.map((path) => documentRow(path))}
        </Section>
      )}
      {disagrees !== null && disagrees.length > 0 && (
        <Section id="disagrees" title="Disagrees" count={disagrees.length}>
          {disagrees.map((path) =>
            documentRow(
              path,
              <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">
                Its stage says it is {builtOrDecided(index, path)}, and it still
                has open questions.
              </p>,
            ),
          )}
        </Section>
      )}
      {skipped.length > 0 && (
        <Section id="skipped" title="Skipped" count={skipped.length}>
          <ul className="space-y-1 text-sm">
            {skipped.map(({ path, size }) => (
              <li key={path}>
                <code>{path}</code>{" "}
                <span className="text-slate-500 dark:text-slate-400">
                  {formatSize(size)}, over max-file-bytes (
                  {formatSize(index.config.maxFileBytes)})
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {unreadable.length > 0 && (
        <Section
          id="could-not-read"
          title="Could not read"
          count={unreadable.length}
        >
          <ul className="space-y-1 text-sm">
            {unreadable.map(({ path, reason }) => (
              <li key={path}>
                <code>{path}</code>{" "}
                <span className="text-slate-500 dark:text-slate-400">
                  {reason}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
};
