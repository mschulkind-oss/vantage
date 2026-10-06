/**
 * The planning page (`docs/reference/planning-index.md` §6): every section the
 * planning index derives for one repository, top to bottom, with each question
 * rendered as its document renders it and answerable where it stands.
 *
 * Built entirely from the index and the review comments Vantage already keeps,
 * and storing nothing of its own — no snooze, no assignment, no read state.
 * The order is `derivePlanningSections`' alone, so filing an answer never
 * reorders the page; the page changes only when the documents do.
 *
 * Paged (`docs/reference/planning-index.md` §6.4): a section bar names
 * every section with its exact count, and each section shows one page of its
 * entries, with the page in the URL (`lib/planningPages.ts`). A flip replaces
 * the history entry, so Back from a document returns to the same pages.
 *
 * Every section says under its heading what its entries are and who acts on
 * them, in the shared planning module's words (`vantage-md/planning`'s guide),
 * which `vantage-check index` prints too. A section that is an agent's work
 * has Copy agent request, and the section bar's line Copy all agent requests:
 * the request for every entry of the section, or of every such section, on
 * every page, generated from the index on screen when it is pressed.
 *
 * Filtered (`docs/design/planning-filter.md`): a filter line at the top of the
 * column holds the Filter box, whose text is the URL's `filter=`, read and
 * applied by the shared planning module to the sections derived from the
 * whole index (F1, F2). Enter, ✕ and a pasted planning link apply it in one
 * replace navigation; the filter notice, first of the frame's notices, says
 * what it hides. A filter this release does not understand is applied not at
 * all, and the notice names its term (F3).
 *
 * Several roadmaps (`planning-index.md` §6.8): when two or more route, the
 * roadmap line above the section bar offers a picker, and *Needs you* follows
 * the chosen one. The choice is in the URL as `?roadmap=`, and a pick is
 * remembered for the repository in this browser; picking is a flip of
 * *Needs you* to its first page.
 *
 * Frame first (§6.3, §6.5): the route's first render is the header, the
 * section bar and the notices, with no card in it. The sections fill the
 * region below in one later commit, from a complete set of page inputs —
 * blocks, reviews and diagrams (`hooks/usePlanningPageInputs.ts`) — and a set
 * stays on screen until the next one is complete. Nothing that arrives after
 * that moves what is painted: late comments go into each card's reserved
 * count, a late diagram into a fixed frame, and the pending count into a slot
 * kept for four digits (§12.2).
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
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardCopy,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  PLANNING_NOTICES,
  badgeFor,
  filterKeepsQuestion,
  findDocument,
  isPlanningAgentSectionId,
  parsePlanningFilter,
  planningAgentRequest,
  type CardBlock,
  type DependsOn,
  type NotUnderstoodPlanningFilter,
  type PlanningBadge,
  type PlanningAgentSectionId,
  type PlanningConfig,
  type PlanningFilterSummary,
  type PlanningIndex,
  type PlanningNoticeLine,
  type PlanningQuestion,
  type PlanningRoadmap,
  type PlanningSections,
  type QuestionRef,
} from "vantage-md/planning";
import { AppLink } from "../components/AppLink";
import {
  OpenSidebarButton,
  ViewToggles,
  ViewTogglesPanel,
} from "../components/AppShell";
import { CollapsedFolders } from "../components/CollapsedFolders";
import { HeaderOverflow } from "../components/HeaderOverflow";
import { PlanningBadgeChip } from "../components/PlanningBadge";
import { PlanningFilterLine } from "../components/PlanningFilterLine";
import { PlanningOutline } from "../components/PlanningOutline";
import { PlanningPager, type PagerPlace } from "../components/PlanningPager";
import {
  PlanningQuestionCard,
  type CardFolds,
  type ScopedReport,
} from "../components/PlanningQuestionCard";
import { RESERVED_ICON_SIZE, ReservedLabel } from "../components/ReservedLabel";
import { useWebSocket } from "../hooks/useWebSocket";
import { focusIsIdle, useShellPage } from "../hooks/useShellPage";
import { useHeaderFit } from "../hooks/useHeaderFit";
import {
  usePlanningOutlineActive,
  type OutlineTarget,
} from "../hooks/usePlanningOutlineActive";
import { CONTENTS_COLUMN_QUERY, useMediaQuery } from "../hooks/useMediaQuery";
import { usePersistentFlag } from "../hooks/usePersistentFlag";
import { usePlanningReviews } from "../hooks/usePlanningReviews";
import { repoLabel, useRepoRoot } from "../hooks/useRepoRoot";
import { scrollToAnchorElement } from "../lib/anchorScroll";
import { copyTextOrWarn } from "../lib/clipboard";
import { planningCardId } from "../lib/planningCardId";
import { afterClampMeasures } from "../lib/planningCardParts";
import {
  outlineTargetId,
  planningOutline,
  planningRowId,
  type OutlineDocument,
} from "../lib/planningOutline";
import { cn } from "../lib/utils";
import {
  blockKey as pageBlockKey,
  predrawDiagrams,
  prefetchPlanningPage,
  usePlanningPageInputs,
} from "../hooks/usePlanningPageInputs";
import {
  chooseRoadmap,
  filterSummaryOf,
  filterValue,
  layoutPlanningPage,
  listedDocuments,
  listedQuestions as listedQuestionsOf,
  planningQuery,
  planningSearch,
  readFilterRequest,
  readPageRequest,
  readRememberedRoadmap,
  readRoadmapRequest,
  rememberRoadmap,
  requestWithPage,
  routingRoadmaps,
  sectionsOf,
  understoodFilter,
  withFilter,
  withPage,
  withRoadmap,
  type CardEntry,
  type LaidOutSection,
  type PlanningLayout,
  type SectionId,
} from "../lib/planningPages";
import { planningPath } from "../lib/planningRoute";
import { isStaticMode } from "../lib/staticMode";
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
  deleteCommentFrom,
  postCommentTo,
  type LineLookup,
} from "../stores/useReviewStore";
import { VIEWER_RELEASE } from "../lib/viewerRelease";
import {
  answeredPerSection,
  needYou,
  pendingAnswers,
  type KeepsQuestion,
} from "../lib/planningAnswers";
import type { ReviewComment } from "../types";

/**
 * Each visit's scroll position, by history entry. Module state, so it outlives
 * the page's own unmount: going Back from a document the page opened returns
 * to the same entry, with the same key, and the page restores it (§6.6). The
 * router keeps no scroll position of its own.
 */
const scrollPositions = new Map<string, number>();

/** How long after a restore the page keeps re-applying it while it grows. */
const RESTORE_SETTLE_MS = 2000;

/**
 * Save this visit's scroll position as the reader scrolls, and put it back
 * when the page is returned to. The position is the pane's, `scroller`,
 * which is what scrolls in the app shell (`components/AppShell.tsx`), and
 * which is not there until the shell is.
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
 * being restored there (`docs/reference/planning-index.md` §6.4). Back
 * from a document opened after the flip then finds it.
 */
function useScrollRestore(
  key: string,
  ready: boolean,
  rootRef: React.RefObject<HTMLElement | null>,
  scroller: HTMLElement | null,
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
        ? scroller?.scrollTop
        : scrollPositions.get(previous);
    if (carried !== undefined) scrollPositions.set(key, carried);
    // Only a new key carries a position; the scroller is read as it stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const save = useCallback(() => {
    if (!restoringRef.current && scroller !== null) {
      scrollPositions.set(key, scroller.scrollTop);
    }
  }, [key, scroller]);

  useEffect(() => {
    if (scroller === null) return;
    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        save();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [save, scroller]);

  useLayoutEffect(() => {
    // Not before the pane is there to be scrolled: it arrives with the
    // shell, in a commit of its own before the first paint.
    if (!ready || scroller === null || restoredRef.current) return;
    restoredRef.current = true;
    const target = scrollPositions.get(key);
    if (target === undefined) return;
    restoringRef.current = true;
    const restore = () => {
      if (scroller !== null) scrollPaneTo(scroller, target);
    };
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
  }, [key, ready, rootRef, scroller]);

  return save;
}

/**
 * Scroll the pane to `top`, by its `scrollTop`: what every browser has, and
 * what a test environment without layout keeps.
 */
function scrollPaneTo(pane: HTMLElement, top: number): void {
  pane.scrollTop = top;
}

/** What says the reader has taken the scrolling over. */
const USER_SCROLL_EVENTS = [
  "wheel",
  "touchstart",
  "keydown",
  "mousedown",
] as const;

/**
 * What a Stage conflict row's stage claims, in the checker's word for the same
 * finding (`planning/stage-disagrees`): Stage conflict holds both the `ready`
 * and the `built` role (§6.2).
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
 * the document (`docs/reference/planning-index.md` §6.7). A group's
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
 * does (§6.6).
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
/**
 * The agent request for the agent sections `ids` names, every one when it is
 * absent, generated from the index on screen at the moment it is asked for;
 * `null` when none of them holds an entry.
 */
type AgentRequestOf = (
  ids?: readonly PlanningAgentSectionId[],
) => string | null;

/** How long Copied stands in for a copy button's label. */
const COPIED_MS = 2000;

/**
 * Copy agent request, or Copy all agent requests: copies the text `request`
 * generates when pressed, from the index already on screen, so it needs no
 * network and nothing selected. Confirmed as Copy answers is, its label
 * turning to Copied for two seconds in room kept for the longer of the two,
 * so the confirmation moves nothing, and said once to a screen reader, since
 * a button's new label is not read out. Never printed.
 */
const CopyRequestButton: React.FC<{
  label: string;
  /** Its accessible name: the label, and what it copies. */
  name: string;
  /** Its tooltip. */
  hint: string;
  /** What a screen reader is told once it has copied. */
  done: string;
  request: () => string | null;
  className?: string;
}> = ({ label, name, hint, done, request, className }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <>
      <button
        type="button"
        data-planning-agent-request
        aria-label={name}
        title={hint}
        onClick={() => {
          const text = request();
          if (text === null) return;
          void copyTextOrWarn(text).then((ok) => {
            if (ok) setCopied(true);
          });
        }}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 print:hidden dark:text-slate-300 dark:hover:bg-slate-700",
          className,
        )}
      >
        {/* As wide as its label, so Copied moves nothing. */}
        <ReservedLabel
          icon={
            copied ? (
              <Check size={RESERVED_ICON_SIZE} aria-hidden="true" />
            ) : (
              <ClipboardCopy size={RESERVED_ICON_SIZE} aria-hidden="true" />
            )
          }
          label={copied ? "Copied" : label}
          reserve={[label, "Copied"]}
        />
      </button>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {copied && done}
      </span>
    </>
  );
};

const Section: React.FC<{
  /** The section as it is on screen. */
  section: LaidOutSection;
  /**
   * The same section as the URL asks for it, which its pagers' controls go
   * on from; the one on screen except while a flip waits for its page.
   */
  asked?: LaidOutSection;
  onFlip: OnFlip;
  onPrefetch?: OnPrefetch;
  /** A flip of this section is still waiting for its page. */
  busy?: boolean;
  /** The agent request of an agent section, which has Copy agent request. */
  requestOf?: AgentRequestOf;
  /** How many of its entries a pending comment answers (§6.7). */
  answered?: number;
  children: React.ReactNode;
}> = ({
  section,
  asked = section,
  onFlip,
  onPrefetch,
  busy,
  requestOf,
  answered = 0,
  children,
}) => {
  const { id, title, explanation, total, pageCount } = section;
  // Said once a flip of this section lands, and not for the page it opened
  // on: a reader who flipped hears where it went, and focus left on Next
  // says nothing of the entries that changed below it. A filter applied is
  // no flip: it draws the sections anew (keyed by `frameFilterKey`), and the
  // filter's own live region speaks its notice (planning-filter.md §7).
  const [landed, setLanded] = useState({ page: section.page, flipped: false });
  if (landed.page !== section.page) {
    setLanded({ page: section.page, flipped: true });
  }
  const pager = (place: PagerPlace) =>
    pageCount > 1 && (
      <PlanningPager
        title={title}
        page={asked.page}
        pageCount={asked.pageCount}
        start={section.start}
        end={section.end}
        total={total}
        place={place}
        onFlip={(page, from) => onFlip(id, page, from)}
        onPrefetch={onPrefetch && ((page) => onPrefetch(id, page))}
        busy={busy}
      />
    );
  const aboutId = `about-${id}`;
  return (
    <section aria-labelledby={id} aria-describedby={aboutId} className="mb-10">
      <div className="flex flex-wrap items-center gap-x-3">
        {/* Focusable from script alone: a jump from the section bar, or a
            flip from the bottom pager, brings the focus here with the
            scroll. */}
        <h2
          id={id}
          tabIndex={-1}
          className="scroll-mt-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
        >
          {title}{" "}
          <span className="ml-1 font-normal tabular-nums">
            {total.toLocaleString("en-US")}
          </span>
          {answered > 0 && (
            <>
              {" "}
              <span
                data-planning-section-answered
                className="font-normal tracking-normal normal-case tabular-nums"
              >
                {answeredCount(answered)}
              </span>
            </>
          )}
        </h2>
        {requestOf !== undefined && isPlanningAgentSectionId(id) && (
          <CopyRequestButton
            label="Copy agent request"
            name={`Copy agent request for ${title}`}
            hint={`Copy an instruction for an agent covering ${total === 1 ? "the 1 entry" : `all ${total.toLocaleString("en-US")} entries`} of ${title}, on every page`}
            done={`Copied the agent request for ${title}.`}
            request={() => requestOf([id])}
            // Taller than the heading, and kept from making its line so.
            className="-my-1 ml-auto"
          />
        )}
      </div>
      <p
        id={aboutId}
        data-planning-section-about
        className="mt-0.5 mb-3 text-[13px] text-slate-500 dark:text-slate-400"
      >
        {explanation}
      </p>
      {pageCount > 1 && (
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {landed.flipped &&
            `${title}, page ${section.page.toLocaleString("en-US")} of ${pageCount.toLocaleString("en-US")}, entries ${(section.start + 1).toLocaleString("en-US")}–${section.end.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`}
        </span>
      )}
      {pager("top")}
      <div className="space-y-3">{children}</div>
      {pager("bottom")}
    </section>
  );
};

/**
 * One line naming each non-empty section with its exact count, from the index
 * (`docs/reference/planning-index.md` §6.3), and the line under its heading
 * as its tooltip. Each entry scrolls to its
 * section and moves the focus to its heading, so Tab goes on from there, and
 * adds no history entry. Its link is still the section's `#id`, which a new
 * tab opened on it scrolls to once the sections are in.
 */
const SectionBar: React.FC<{
  layout: PlanningLayout;
  /** How many of each section's entries a pending comment answers, by id. */
  answered?: ReadonlyMap<string, number>;
}> = ({ layout, answered }) => (
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
          title={section.explanation}
          onClick={(e) => {
            e.preventDefault();
            bringSectionIntoView(section.id);
          }}
          className="text-blue-600 no-underline hover:underline dark:text-blue-400"
        >
          {section.title}{" "}
          <span className="tabular-nums">
            {section.total.toLocaleString("en-US")}
          </span>
          {(answered?.get(section.id) ?? 0) > 0 && (
            <>
              {" "}
              <span className="tabular-nums">
                {answeredCount(answered?.get(section.id) ?? 0)}
              </span>
            </>
          )}
        </a>
      </React.Fragment>
    ))}
  </nav>
);

/**
 * Expand all, or Collapse all: every question card on the page unfolded or
 * folded, and every card rendered after it opened the same way — on another
 * page, in another section, on the next visit — until it is pressed again
 * (§6.6). It sits at the end of the section bar's line, the page's own line of
 * controls over its sections, from the frame's first paint.
 *
 * `expanded` is what the last press here, or the page's opening, brought the
 * cards on screen to, so the label names what a press does to them. A screen
 * reader is told what a press did, since a button's new name is not read out.
 */
const CardsToggle: React.FC<{ expanded: boolean; onToggle: () => void }> = ({
  expanded,
  onToggle,
}) => {
  const [pressed, setPressed] = useState(false);
  return (
    <>
      <button
        type="button"
        data-planning-cards-toggle
        onClick={() => {
          setPressed(true);
          onToggle();
        }}
        title={
          expanded
            ? "Fold every question to its first lines, and open the cards shown later folded"
            : "Show every question in full, and open the cards shown later unfolded"
        }
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 print:hidden dark:text-slate-300 dark:hover:bg-slate-700"
      >
        {expanded ? (
          <ChevronsDownUp size={14} aria-hidden="true" />
        ) : (
          <ChevronsUpDown size={14} aria-hidden="true" />
        )}
        {expanded ? "Collapse all" : "Expand all"}
      </button>
      <span
        data-planning-cards-status
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {pressed &&
          (expanded
            ? "Every question is shown in full."
            : "Every question is folded to its first lines.")}
      </span>
    </>
  );
};

/** Scroll to a section's heading, and give the heading the focus. */
function bringSectionIntoView(id: SectionId): void {
  const heading = document.getElementById(id);
  heading?.scrollIntoView?.({ block: "start" });
  heading?.focus({ preventScroll: true });
}

/**
 * Bring an outline document's card or row into view the way the contents
 * column brings a heading (`lib/anchorScroll.ts`), and give it the focus —
 * or its first control, when it takes none itself — so Tab goes on from
 * there, as it does from a section the section bar jumps to.
 */
function bringTargetIntoView(id: string, scroller: HTMLElement | null): void {
  const el = document.getElementById(id);
  if (el === null) return;
  landOn(el, scroller);
  const focusable = el.hasAttribute("tabindex")
    ? el
    : el.querySelector<HTMLElement>("a[href], button:not([disabled])");
  focusable?.focus({ preventScroll: true });
}

/**
 * Scroll `el` to the top of the pane, as the contents column brings a heading
 * (`scrollToAnchorElement`), and again once the cards committed with it have
 * measured their folds (`afterClampMeasures`), still before the paint: until
 * then each card above it that hides anything lacks the control at its cut,
 * and Show less, so `el` would land lower than they leave it.
 */
function landOn(el: HTMLElement, scroller: HTMLElement | null): void {
  scrollToAnchorElement(el, scroller);
  afterClampMeasures(() => {
    if (el.isConnected) scrollToAnchorElement(el, scroller);
  });
}

/**
 * The element a URL's fragment names: by the fragment as written, else as
 * percent-decoded, which is how a browser looks for it.
 */
function elementForFragment(fragment: string): HTMLElement | null {
  if (fragment === "") return null;
  const found = document.getElementById(fragment);
  if (found !== null) return found;
  try {
    return document.getElementById(decodeURIComponent(fragment));
  } catch {
    return null;
  }
}

const Notice: React.FC<{ children: React.ReactNode; testId?: string }> = ({
  children,
  testId,
}) => (
  <p
    data-testid={testId}
    className="mb-3 text-sm text-slate-500 dark:text-slate-400"
  >
    {children}
  </p>
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

/** A notice line's parts, its code parts drawn as code (§6.7). */
const NoticeLine: React.FC<{ line: PlanningNoticeLine }> = ({ line }) => (
  <>
    {line.map((part, i) =>
      typeof part === "string" ? (
        <React.Fragment key={i}>{part}</React.Fragment>
      ) : (
        <code key={i}>{part.code}</code>
      ),
    )}
  </>
);

/** A notice line as a screen reader is told it: its code parts as text. */
const spokenLine = (line: PlanningNoticeLine): string =>
  line.map((part) => (typeof part === "string" ? part : part.code)).join("");

/** What the filter's live region says after a clear, when there is no notice. */
const FILTER_CLEARED = "The filter is cleared. Every entry is shown.";

/**
 * The filter notice (`planning-filter.md` §6.7), the first of the frame's
 * notices: what an applied filter shows of the unfiltered total and the
 * clauses that apply, or, for a filter this release does not understand,
 * that nothing is filtered and why. It prints, so a printout always says it
 * is filtered and by how much. Its id is the Filter box's description.
 */
const FilterNotice: React.FC<{
  id: string;
  lines: readonly PlanningNoticeLine[];
  notUnderstood: boolean;
}> = ({ id, lines, notUnderstood }) => (
  <div
    id={id}
    data-testid="filter-notice"
    className={cn(
      "mb-3 space-y-0.5 text-sm",
      notUnderstood
        ? "text-amber-700 dark:text-amber-400"
        : "text-slate-600 dark:text-slate-300",
    )}
  >
    {lines.map((line, i) => (
      <p key={i}>
        <NoticeLine line={line} />
      </p>
    ))}
  </div>
);

/** The filter notice's lines for the frame's filter, or `null` for none. */
function filterNoticeLines(
  summary: PlanningFilterSummary | null,
  notUnderstood: NotUnderstoodPlanningFilter | null,
): PlanningNoticeLine[] | null {
  if (summary !== null) return PLANNING_NOTICES.filtered(summary, "page");
  if (notUnderstood !== null) {
    return [PLANNING_NOTICES.notFiltered(notUnderstood)];
  }
  return null;
}

/**
 * The notices under the section bar (§6.2): each only when it applies. The
 * filter notice comes first (`planning-filter.md` §6.7). The roadmap notice
 * names what the page looked for when no roadmap routes, or a listed roadmap
 * it could not read while another routes (§6.8).
 */
const Notices: React.FC<{
  sections: PlanningSections;
  config: PlanningConfig;
  /** The filter notice, drawn first, when a filter is applied or not understood. */
  filterNotice: React.ReactNode;
  /** A filter is applied: *Nothing needs you* takes its filtered words (§6.2). */
  filtered: boolean;
}> = ({ sections, config, filterNotice, filtered }) => {
  const roadmapNotice = PLANNING_NOTICES.roadmapNotice(
    config,
    sections.roadmaps,
  );
  return (
    <>
      {filterNotice}
      {sections.nothingNeedsYou && (
        <p
          data-testid="nothing-needs-you"
          className="mb-6 text-base font-medium text-slate-700 dark:text-slate-200"
        >
          {filtered
            ? PLANNING_NOTICES.nothingFilteredNeedsYou
            : PLANNING_NOTICES.nothingNeedsYou}
        </p>
      )}
      {roadmapNotice !== null && (
        <Notice testId="roadmap-notice">{roadmapNotice}</Notice>
      )}
      {!sections.stagesDeclared && <Notice>{PLANNING_NOTICES.noStages}</Notice>}
    </>
  );
};

/**
 * `(3 answered)`: beside a section's count of entries, how many of them a
 * comment pending for the agent answers, so a section that still lists them
 * does not read as saying they need you (§6.7).
 */
const answeredCount = (n: number): string =>
  `(${n.toLocaleString("en-US")} answered)`;

/** `1 answer`, `3 answers`: pending answers a filter leaves out of Copy answers. */
const leftOutAnswers = (n: number): string =>
  `${n.toLocaleString("en-US")} ${n === 1 ? "answer" : "answers"}`;

/** `(4 need you)`, or `(1 needs you)`: a roadmap's count in the picker. */
const needYouCount = (n: number): string =>
  `(${n.toLocaleString("en-US")} ${n === 1 ? "needs" : "need"} you)`;

/**
 * The widest a roadmap's count can read once answers are taken off it: its
 * count in the index, as `needs`, the longer word. Answers only ever lower a
 * count, so the room this reserves holds every count it can become, and a
 * count lowered after the line painted moves nothing (§12, L1).
 */
const needYouRoom = (n: number): string =>
  `(${n.toLocaleString("en-US")} needs you)`;

/** What the picker says of a roadmap: its full path, then its count. */
const roadmapOption = (roadmap: PlanningRoadmap, count: number): string =>
  `${roadmap.path} ${needYouCount(count)}`;

/**
 * The line after the picker, for `count` questions that need you only on
 * other roadmaps; with every one answered, that none is left.
 */
const otherRoadmapsLine = (count: number): string =>
  count === 0
    ? "No more questions need you on other roadmaps."
    : PLANNING_NOTICES.otherRoadmaps(count);

/**
 * The roadmap line (§6.8): above the section bar, and only when two or more
 * roadmaps route. A native select labelled Roadmap offers each by its full
 * path, never shortened, since every one is named roadmap.md, with its
 * *Needs you* count; after it, as text, how many questions need you only on
 * the others. Its options and that count are the frame's, drawn from the
 * index the sections on screen were laid out from; its value is the roadmap
 * asked for, at once, and a spinner beside it says when the swap has waited
 * longer than a flip may without one.
 *
 * - **The closed control wraps the path rather than cut it off.** A closed
 *   native select shows its option's text on one line, clipped to its box,
 *   so on a phone a deep path lost its file name and its count. The page
 *   draws that text itself, wrapping, and lays the select over it,
 *   transparent: the select still takes the pointer and the keyboard, opens
 *   the platform's own menu, and is what a screen reader hears, while the
 *   drawn text is hidden from it. Its title is the path, for a pointer.
 * - **The spinner has a slot of its own, always there,** beside the control
 *   and never wrapped away from it, so showing it never changes the line's
 *   height or moves anything under it.
 */
const RoadmapLine: React.FC<{
  roadmaps: readonly PlanningRoadmap[];
  /**
   * Each roadmap's count of questions that need you, less those a pending
   * comment answers (`lib/planningAnswers.ts`); the index's count where it
   * has none.
   */
  needYou?: ReadonlyMap<string, number>;
  value: string;
  /** Questions that need you only on other roadmaps, as the index counts them. */
  others: number;
  /** The same, less those a pending comment answers. */
  othersLeft?: number;
  busy: boolean;
  onPick: (path: string) => void;
  /**
   * Drawn at the head of the planning outline, its parts one under another,
   * rather than as a line above the section bar (§6.9).
   */
  stacked?: boolean;
}> = ({
  roadmaps,
  needYou,
  value,
  others,
  othersLeft = others,
  busy,
  onPick,
  stacked = false,
}) => {
  const id = React.useId();
  const chosen = roadmaps.find((roadmap) => roadmap.path === value);
  const countOf = (roadmap: PlanningRoadmap) =>
    needYou?.get(roadmap.path) ?? roadmap.needsYouCount;
  return (
    <div
      data-testid="roadmap-line"
      className={
        stacked
          ? "mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-600 dark:text-slate-300"
          : "mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-300"
      }
    >
      <label htmlFor={id} className="font-medium">
        Roadmap
      </label>
      <span
        className={cn(
          "flex max-w-full min-w-0 items-center gap-2",
          stacked && "w-full",
        )}
      >
        <span
          className={cn(
            "relative flex min-w-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-800 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
            stacked && "flex-1 justify-between",
          )}
        >
          <span
            aria-hidden="true"
            data-testid="roadmap-shown"
            className="min-w-0 [overflow-wrap:anywhere]"
          >
            {chosen === undefined ? (
              value
            ) : (
              <>
                {chosen.path}{" "}
                <span
                  className="hdr-reserve tabular-nums"
                  data-reserve={needYouRoom(chosen.needsYouCount)}
                >
                  {needYouCount(countOf(chosen))}
                </span>
              </>
            )}
          </span>
          <ChevronDown
            aria-hidden="true"
            size={14}
            className="shrink-0 text-slate-500 dark:text-slate-400"
          />
          <select
            id={id}
            value={value}
            title={value}
            onChange={(e) => onPick(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-white text-sm text-slate-800 opacity-0 dark:bg-slate-800 dark:text-slate-100"
          >
            {roadmaps.map((roadmap) => (
              <option key={roadmap.path} value={roadmap.path}>
                {roadmapOption(roadmap, countOf(roadmap))}
              </option>
            ))}
          </select>
        </span>
        <span
          data-testid="roadmap-spinner-slot"
          className="flex size-3.5 shrink-0 items-center justify-center"
        >
          {busy && (
            <Loader2
              size={14}
              className="animate-spin text-blue-600"
              aria-hidden="true"
            />
          )}
        </span>
      </span>
      {/* As wide as the index's count says, so answers lowering it after
          the line painted move nothing (§12, L1). */}
      {others > 0 && (
        <span
          data-testid="other-roadmaps"
          className="hdr-reserve"
          data-reserve={PLANNING_NOTICES.otherRoadmaps(others)}
        >
          {otherRoadmapsLine(othersLeft)}
        </span>
      )}
    </div>
  );
};

const NO_SECTIONS: ReadonlySet<SectionId> = new Set();

export const PlanningPage: React.FC = () => {
  const { "*": pathParam } = useParams();
  const location = useLocation();
  /**
   * The pane, which is what scrolls in the app shell: a ref for the shell's
   * scrolling keys, and the element itself for what follows its scroll,
   * since it arrives with the shell, after the page's first render.
   */
  const contentRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<HTMLDivElement | null>(null);
  const paneRef = useCallback((el: HTMLDivElement | null) => {
    contentRef.current = el;
    setPane(el);
  }, []);
  const { isMultiRepo, currentRepo, setCurrentRepo, repos, reposLoaded } =
    useRepoStore();

  // The repository the URL names, in daemon mode.
  const repoName = isMultiRepo
    ? (pathParam?.split("/").filter(Boolean)[0] ?? "")
    : "";
  const repoExists = !isMultiRepo || repos.some((r) => r.name === repoName);
  // The sidebar is the repository's, so it is drawn wherever the URL names
  // one that is served, as the viewer draws it, and not over a page asking
  // for a project or naming one that is not there.
  const showSidebar = !isMultiRepo || (repoName !== "" && repoExists);

  // The viewer's own two reading preferences, and the same ones: a reader who
  // keeps the contents column open, or reads at full width, does so here too,
  // and nothing about them is the planning page's to store.
  const [contentsOpen, setContentsOpen] = usePersistentFlag("vantage:tocOpen");
  const [fullWidth, setFullWidth] = usePersistentFlag("vantage:fullWidth");
  const toggleContents = useCallback(
    () => setContentsOpen((open) => !open),
    [setContentsOpen],
  );
  const toggleFullWidth = useCallback(
    () => setFullWidth((on) => !on),
    [setFullWidth],
  );
  // Whether question cards open unfolded: a display preference of the page's
  // own, kept like the two above. Each press brings every card on screen to
  // it and forgets the folds the reader set card by card, which until then
  // outlive a card's page being flipped away and back.
  const [cardsExpanded, setCardsExpanded] = usePersistentFlag(
    "vantage:planningCardsExpanded",
  );
  const [folds, setFolds] = useState<CardFolds>(() => new Map());
  // What this tab last brought its cards on screen to: the preference as the
  // page opened, then each press here. Another tab's press changes the
  // preference, which the cards rendered later open with, and moves none on
  // screen here, so the toggle goes on naming what a press does to them.
  const [cardsBrought, setCardsBrought] = useState(cardsExpanded);
  const toggleCards = useCallback(() => {
    const next = !cardsBrought;
    setCardsBrought(next);
    setCardsExpanded(next);
    setFolds(new Map());
  }, [cardsBrought, setCardsExpanded]);
  // The column is drawn only where there is room for it, as the table of
  // contents is; where it is not, the roadmap picker stays above the section
  // bar, so there is always exactly one.
  const wide = useMediaQuery(CONTENTS_COLUMN_QUERY, true);
  const outlineShown = contentsOpen && wide && showSidebar;

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

  const ready = load.status === "ready" ? load : null;
  const index = ready?.index ?? null;
  const [search, setSearch] = useSearchParams();

  // The roadmap this browser remembers for the repository, read once per
  // visit (§6.8): another tab's pick never changes a page already on screen.
  // Read again only when the page's repository changes, and set by a pick.
  const pageRepo = onThisRepo ? repo : null;
  const [remembered, setRemembered] = useState(() => ({
    repo: pageRepo,
    path: pageRepo === null ? null : readRememberedRoadmap(pageRepo),
  }));
  if (remembered.repo !== pageRepo) {
    setRemembered({
      repo: pageRepo,
      path: pageRepo === null ? null : readRememberedRoadmap(pageRepo),
    });
  }
  const rememberedRoadmap =
    remembered.repo === pageRepo ? remembered.path : null;

  // The chosen roadmap: the URL's, else the remembered one, else the
  // default, each only while it routes. A roadmap that stops routing under
  // an index update falls back the same way.
  const askedRoadmap = useMemo(() => readRoadmapRequest(search), [search]);
  const chosenRoadmap =
    index === null || index.refused
      ? null
      : chooseRoadmap(
          sectionsOf(index).roadmaps,
          askedRoadmap,
          rememberedRoadmap,
        );
  // The filter, from the URL (planning-filter.md §6.4): every `filter` value
  // joined with a space, applied only when it is understood (F3). Its
  // canonical text names what the page shows, as the roadmap does (§6.5); a
  // filter that is not understood shows what none does.
  const filterText = useMemo(() => readFilterRequest(search), [search]);
  const urlFilter = useMemo(
    () => parsePlanningFilter(filterText),
    [filterText],
  );
  const appliedFilter =
    urlFilter.kind === "understood" ? urlFilter.canonical : "";
  // The whole index's sections under the chosen roadmap (F2), and what the
  // filter keeps of them.
  const unfilteredSections = useMemo(
    () =>
      index === null || index.refused ? null : sectionsOf(index, chosenRoadmap),
    [index, chosenRoadmap],
  );
  const sections = useMemo(
    () =>
      index === null || index.refused
        ? null
        : sectionsOf(index, chosenRoadmap, appliedFilter),
    [index, chosenRoadmap, appliedFilter],
  );

  // The pages, from the URL (§6.4), read against the filtered sections.
  const request = useMemo(() => readPageRequest(search), [search]);
  const layout = useMemo(
    () =>
      index === null || sections === null
        ? null
        : layoutPlanningPage(index, sections, request, appliedFilter),
    [index, sections, request, appliedFilter],
  );
  // A page past a section's end, a malformed page and an explicit page 1 are
  // rewritten in place, and so is the roadmap: named when two or more route,
  // gone when fewer do; and an understood filter, as its canonical text, in
  // the link encoding (planning-filter.md §6.4). The fragment stays: a link
  // to a card or a section that needs its query rewritten still goes where
  // it points, once the sections are in (below). Setting the query alone
  // would drop it.
  const navigate = useNavigate();
  const { hash } = location;
  useEffect(() => {
    if (layout === null || sections === null) return;
    const canonical = planningSearch(search, layout, sections);
    if (canonical === null) return;
    const query = planningQuery(canonical);
    navigate(
      { search: query === "" ? "" : `?${query}`, hash },
      { replace: true },
    );
  }, [layout, sections, search, navigate, hash]);

  /** A section to bring into view once its new page is on screen. */
  const scrollToRef = useRef<SectionId | null>(null);
  /**
   * An outline document to bring into view once the page of its section that
   * holds it is on screen: the section, that page, and what to go to.
   */
  const jumpRef = useRef<{
    section: SectionId;
    page: number;
    target: string;
  } | null>(null);
  const flip = useCallback<OnFlip>(
    (id, page, place) => {
      // The bottom pager brings its section's heading back into view, and
      // the focus with it; the top one leaves both alone.
      scrollToRef.current = place === "bottom" ? id : null;
      jumpRef.current = null;
      setSearch((prev) => withPage(prev, id, page), { replace: true });
    },
    [setSearch],
  );
  // Picking a roadmap is a flip (§6.8): the URL's roadmap replaced with no
  // history entry, Needs you back on its first page, and the pick
  // remembered for the repository.
  const pickRoadmap = useCallback(
    (path: string) => {
      if (pageRepo !== null) rememberRoadmap(pageRepo, path);
      setRemembered({ repo: pageRepo, path });
      scrollToRef.current = null;
      jumpRef.current = null;
      setSearch((prev) => withRoadmap(prev, path), { replace: true });
    },
    [pageRepo, setSearch],
  );
  // A pager the pointer or the focus reaches asks for the next page ahead.
  const prefetch = useCallback<OnPrefetch>(
    (id, page) => {
      if (onThisRepo && repo !== null) {
        prefetchPlanningPage(
          repo,
          requestWithPage(request, id, page),
          chosenRoadmap,
          appliedFilter,
        );
      }
    },
    [onThisRepo, repo, request, chosenRoadmap, appliedFilter],
  );

  // The inputs of the pages shown (§6.5). The sections render only from a
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
  // Each section as the URL asks for it, which its pager goes on from.
  const asked = useMemo(
    () => new Map((layout?.sections ?? []).map((s) => [s.id, s] as const)),
    [layout],
  );
  // The filter the page on screen is laid out under: the shown set's, until
  // the next one is in, as the frame is (below), so what Copy answers and the
  // need-you numbers count is what is on screen (planning-filter.md §6.6).
  const frameFilter = (shown?.inputs.layout ?? layout)?.filter ?? "";
  const frameKeeps = useMemo((): KeepsQuestion | undefined => {
    const filter = understoodFilter(frameFilter);
    return filter === null
      ? undefined
      : (question) => filterKeepsQuestion(filter, question);
  }, [frameFilter]);

  // Opened while the index was still building: the progress line stays until
  // the section bar and the sections replace it in one commit (§6.10).
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

  // Every question with a card, on any page, unfiltered: what Copy answers
  // places comments over, before it narrows them to what the filter keeps
  // (planning-filter.md §6.6).
  const listedQuestions = useMemo(
    () =>
      index === null || unfilteredSections === null
        ? []
        : listedQuestionsOf(index, unfilteredSections),
    [index, unfilteredSections],
  );
  // Every document the unfiltered sections list, their rows' too, so that no
  // filter change, nor a flip to a later page of rows, asks for a third
  // request (§6.6).
  const listedPaths = useMemo(
    () =>
      index === null || unfilteredSections === null
        ? []
        : listedDocuments(index, unfilteredSections),
    [index, unfilteredSections],
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

  // Which comments sit on a listed question. A card rendered this visit
  // reads it from its rendered question and reports it, by question, and its
  // report outlives the card: flipped off the page, it still holds for as
  // long as the question and its document's comments are the ones it read.
  // Every other question places its document's comments by line (§6.7).
  const [scoped, setScoped] = useState<Readonly<Record<string, ScopedReport>>>(
    {},
  );
  const reportScoped = useCallback(
    (key: string, report: ScopedReport | null) =>
      setScoped((prev) => {
        const had = prev[key];
        if (report === null) {
          if (had === undefined) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        }
        if (
          had !== undefined &&
          had.question === report.question &&
          had.comments === report.comments &&
          had.ids.length === report.ids.length &&
          had.ids.every((id, i) => report.ids[i] === id)
        ) {
          return prev;
        }
        return { ...prev, [key]: report };
      }),
    [],
  );

  // Copy answers (§6.7): every comment still
  // pending for the agent on a question listed on any page, grouped by
  // document — built from the reviews, never from the cards, so a comment
  // two cards could both see appears once. A card's own report decides for
  // it; placement decides for a question with none, never both.
  // Under a filter, the comments are placed over every listed question and
  // then narrowed to those it keeps; how many it leaves out is said in the
  // button's tooltip and name, never in text that moves (§6.6).
  const { groups: pendingGroups, leftOut: pendingLeftOut } = useMemo(
    () => pendingAnswers(listedQuestions, reviews.byPath, scoped, frameKeeps),
    [scoped, listedQuestions, reviews.byPath, frameKeeps],
  );

  // The documents whose reviews the page's need-you numbers read (§6.7, §12):
  // those held when the page opened, then every one held when a set of
  // sections commits — the first, a flip, a roadmap picked, an index update —
  // and the document of an answer filed here. A document whose reviews first
  // arrive after its sections painted waits for the next such commit, so
  // what it answers moves nothing on screen (L1); a counted document's
  // reviews changing is a change of data, which applies at once (L2).
  // Kept per repository: another one's documents count for nothing here.
  const shownInputs = shown?.inputs ?? null;
  const [counted, setCounted] = useState<{
    repo: string | null;
    inputs: typeof shownInputs;
    paths: ReadonlySet<string>;
  }>(() => ({
    repo,
    inputs: shownInputs,
    paths: new Set(Object.keys(reviews.byPath)),
  }));
  if (counted.repo !== repo || counted.inputs !== shownInputs) {
    setCounted({
      repo,
      inputs: shownInputs,
      paths: new Set([
        ...(counted.repo === repo ? counted.paths : []),
        ...Object.keys(reviews.byPath),
      ]),
    });
  }
  const countedReviews = useMemo(() => {
    const out: Record<string, readonly ReviewComment[]> = {};
    for (const path of counted.paths) {
      const comments = reviews.byPath[path];
      if (comments !== undefined) out[path] = comments;
    }
    return out;
  }, [counted.paths, reviews.byPath]);
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
  // Exact only once every listed document's reviews are in (§6.7).
  const countKnown = index !== null && reviews.known;
  // The request for the listed documents no shown page holds failed after
  // the sections painted. A line above them would move them, so it is said
  // where nothing moves: the button's own icon and tooltip, and once to a
  // screen reader. A failure before they painted has its line (§15).
  const reviewsFailed = reviews.failed;
  const restFailed = reviewsFailed && shown?.inputs.reviewsFailed !== true;
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
      // Filed here, so the reader caused it: what it answers counts at once.
      setCounted((prev) =>
        prev.paths.has(path)
          ? prev
          : { ...prev, paths: new Set([...prev.paths, path]) },
      );
    },
    [adopt],
  );
  // Undo on a card's take: the same request the in-page Undo sends.
  const undoComment = useCallback(
    async (path: string, id: string) => {
      adopt(path, await deleteCommentFrom(path, id));
    },
    [adopt],
  );

  const rootRef = useRef<HTMLElement>(null);
  const saveScroll = useScrollRestore(
    location.key,
    shown !== null,
    rootRef,
    pane,
  );

  // The frame follows the sections on screen once there are any: an index
  // update, or a filter applied, changes the section bar and the notices in
  // the commit that changes the sections, not before it (§6.5;
  // planning-filter.md §6.4). Before, it is the index's.
  const frameLayout = shown?.inputs.layout ?? layout;
  const frameSections =
    shown !== null
      ? sectionsOf(
          shown.inputs.index,
          shown.inputs.layout.roadmap,
          shown.inputs.layout.filter,
        )
      : sections;
  // The same, unfiltered: what Copy answers places comments over, and what
  // an agent request reads every blocked-on fact from (planning-filter.md
  // §6.3).
  const frameUnfiltered =
    shown !== null
      ? sectionsOf(shown.inputs.index, shown.inputs.layout.roadmap)
      : unfilteredSections;
  const frameSummary =
    shown !== null
      ? filterSummaryOf(
          shown.inputs.index,
          shown.inputs.layout.roadmap,
          shown.inputs.layout.filter,
        )
      : index === null || index.refused
        ? null
        : filterSummaryOf(index, chosenRoadmap, appliedFilter);
  // The URL's filter as the frame reads it, for the Not filtered notice: the
  // URL's own once the page on screen is the one it asks for, and until then
  // the one the page on screen was laid out under, so the notice changes in
  // the commit that changes the sections.
  const [frameUrlFilter, setFrameUrlFilter] = useState(urlFilter);
  if ((shown === null || !inputs.waiting) && frameUrlFilter !== urlFilter) {
    setFrameUrlFilter(urlFilter);
  }
  const frameNotUnderstood =
    frameFilter === "" && frameUrlFilter.kind === "not-understood"
      ? frameUrlFilter
      : null;
  // What names the frame's filter and its notice: the section bar's box, the
  // notices and the sections below them are drawn anew when it changes, so a
  // filter applied removes and inserts them rather than moving them
  // (planning-filter.md §7). A canonical text holds no line break.
  const frameFilterKey =
    frameNotUnderstood === null ? frameFilter : `\n${frameNotUnderstood.text}`;
  const frameConfig = (shown?.inputs.index ?? index)?.config ?? null;
  // The roadmap line's options, from the frame; its value, the roadmap asked
  // for, as soon as it is asked for (§6.8).
  const frameRoutes =
    frameSections === null ? [] : routingRoadmaps(frameSections.roadmaps);
  const pickerValue =
    chosenRoadmap !== null && frameRoutes.some((r) => r.path === chosenRoadmap)
      ? chosenRoadmap
      : (frameSections?.chosenRoadmap ?? null);
  const roadmapSwapSlow =
    inputs.slow &&
    shown !== null &&
    layout !== null &&
    shown.inputs.layout.roadmap !== layout.roadmap;
  // The same for a filter applied: its spinner is the filter line's own.
  const filterSwapSlow =
    inputs.slow &&
    shown !== null &&
    layout !== null &&
    shown.inputs.layout.filter !== layout.filter;

  const shownPages = shown?.inputs.layout.pages ?? null;
  const shownLayout = shown?.inputs.layout ?? null;
  useLayoutEffect(() => {
    // An outline document, once its page is the one on screen.
    const jump = jumpRef.current;
    const landed =
      jump !== null &&
      shownLayout?.sections.find((s) => s.id === jump.section)?.page ===
        jump.page;
    if (jump !== null && landed) {
      jumpRef.current = null;
      bringTargetIntoView(jump.target, contentRef.current);
    }
    const id = scrollToRef.current;
    if (id === null || shownPages === null) return;
    scrollToRef.current = null;
    // The focus goes too, unless the reader has taken it somewhere else in
    // the meantime: left on the bottom pager, it would be far below the
    // viewport, and a second Enter would flip a page the reader cannot see.
    const active = document.activeElement;
    const section = document.getElementById(id)?.closest("section");
    if (focusIsIdle(active) || section?.contains(active) === true) {
      bringSectionIntoView(id);
    } else {
      document.getElementById(id)?.scrollIntoView?.({ block: "start" });
    }
    // The layout is what a landed flip changes, and `shownPages` says when.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownPages]);

  // A link to a section (`#graduate`, the section bar's own link), or to a
  // card or a row (an outline entry's), opened in a new tab or pasted: the
  // browser looked for it before it was rendered, so the page scrolls to it
  // once the sections are in. Once a visit, and not over a position the
  // visit is restoring.
  const sectionsIn = shown !== null && frameReady;
  const sectionsRef = useRef<HTMLDivElement>(null);
  const hashTriedRef = useRef(false);
  useLayoutEffect(() => {
    if (!sectionsIn || hashTriedRef.current) return;
    hashTriedRef.current = true;
    if (scrollPositions.has(location.key)) return;
    const target = elementForFragment(location.hash.slice(1));
    if (target !== null && sectionsRef.current?.contains(target)) {
      // Where the outline's own jump to it would land (`outlineHref`).
      landOn(target, contentRef.current);
    }
  }, [sectionsIn, location.hash, location.key]);

  // The planning outline (§6.9): drawn from the frame's index, so it paints
  // with the section bar and changes when it does.
  const frameIndex = shown?.inputs.index ?? index;

  // What still needs the human, on the frame's index: the counts the index
  // gives, less every question a pending comment answers (§6.7). The
  // picker's counts and the other-roadmaps line keep the room of the index's
  // count, which an answer only lowers, so they read every review held, the
  // moment it arrives; *Nothing needs you*, which adds a line, reads the
  // counted documents' reviews alone, so it changes only with the sections.
  //
  // Under a filter they count kept questions alone, from the filtered
  // sections, with the comments placed over the unfiltered listed questions
  // first (planning-filter.md §6.2, §6.6).
  const frameNeedYou = useMemo(() => {
    if (
      frameIndex === null ||
      frameSections === null ||
      frameUnfiltered === null
    ) {
      return null;
    }
    const listed = listedQuestionsOf(frameIndex, frameUnfiltered);
    const held = needYou(
      frameIndex,
      frameSections,
      pendingAnswers(listed, reviews.byPath, scoped, frameKeeps).answered,
      frameKeeps,
    );
    const countedAnswered = pendingAnswers(
      listed,
      countedReviews,
      scoped,
      frameKeeps,
    ).answered;
    const counted = needYou(
      frameIndex,
      frameSections,
      countedAnswered,
      frameKeeps,
    );
    return {
      ...held,
      nothing: counted.nothing,
      // Beside each section's count of entries: how many a comment answers.
      // Counted, as the line is, so a late answer moves nothing painted.
      sections: answeredPerSection(frameSections, countedAnswered),
    };
  }, [
    frameIndex,
    frameSections,
    frameUnfiltered,
    frameKeeps,
    reviews.byPath,
    countedReviews,
    scoped,
  ]);
  // *Nothing needs you* because every open question is answered: drawn at
  // the head of the sections, in the commit that draws them, rather than
  // among the notices the frame painted before them, which it would move.
  const answeredAll =
    frameSections !== null &&
    !frameSections.nothingNeedsYou &&
    frameNeedYou?.nothing === true;

  // The agent requests, generated when a Copy agent request button is
  // pressed, from the frame's index and sections, which are the ones on
  // screen. They name the repository by its root, which `/info` reports.
  useRepoRoot(onThisRepo ? repo : null, isMultiRepo);
  // Under a filter, a request lists the kept entries, says so in its
  // `Filter:` line, whose text leaves out the unmatched terms, and reads every
  // blocked-on fact from the unfiltered sections; with every `path:` term
  // unmatched nothing is kept, and there is no request (planning-filter.md
  // §6.6, §6.3).
  const requestOf = useCallback<AgentRequestOf>(
    (ids) => {
      if (frameIndex === null || frameSections === null || repo === null) {
        return null;
      }
      if (frameSummary !== null && frameSummary.requestText === null) {
        return null;
      }
      return planningAgentRequest(frameIndex, frameSections, {
        repository: repoLabel(repo),
        ids,
        viewer: VIEWER_RELEASE,
        ...(frameSummary !== null &&
        frameSummary.requestText !== null &&
        frameUnfiltered !== null
          ? {
              filter: {
                text: frameSummary.requestText,
                unfiltered: frameUnfiltered,
              },
            }
          : {}),
      });
    },
    [frameIndex, frameSections, frameSummary, frameUnfiltered, repo],
  );
  const outline = useMemo(
    () =>
      outlineShown &&
      frameReady &&
      frameIndex !== null &&
      frameSections !== null
        ? planningOutline(frameIndex, frameSections)
        : null,
    [outlineShown, frameReady, frameIndex, frameSections],
  );
  // What the outline follows as the page scrolls: each section's heading,
  // and the cards and rows on screen, in page order.
  const outlineTargets = useMemo(
    (): OutlineTarget[] =>
      !outlineShown || shownLayout === null
        ? []
        : shownLayout.sections.flatMap((section): OutlineTarget[] => [
            { section: section.id, path: null, id: section.id },
            ...(section.kind === "cards"
              ? section.items.map((item) =>
                  item.kind === "question"
                    ? {
                        section: section.id,
                        path: item.question.path,
                        id: planningCardId(
                          item.question.path,
                          item.question.id,
                          item.question.unitLine,
                        ),
                      }
                    : {
                        section: section.id,
                        path: item.path,
                        id: planningRowId(section.id, item.path),
                      },
                )
              : section.kind === "rows"
                ? section.items.map((path) => ({
                    section: section.id,
                    path,
                    id: planningRowId(section.id, path),
                  }))
                : []),
          ]),
    [outlineShown, shownLayout],
  );
  const outlineActive = usePlanningOutlineActive(
    pane,
    outlineTargets,
    outlineShown && sectionsIn,
  );
  // A document in the outline: its section flipped to the page holding its
  // first entry, with no history entry, as a flip is, and that entry brought
  // into view once the page is on screen — at once when it already is.
  const jumpToDocument = useCallback(
    (id: SectionId, document: OutlineDocument) => {
      const target = outlineTargetId(id, document);
      const onScreen = shownLayout?.sections.find((s) => s.id === id)?.page;
      const asked = layout?.sections.find((s) => s.id === id)?.page;
      scrollToRef.current = null;
      if (asked !== document.page) {
        setSearch((prev) => withPage(prev, id, document.page), {
          replace: true,
        });
      }
      if (onScreen === document.page) {
        jumpRef.current = null;
        bringTargetIntoView(target, contentRef.current);
      } else {
        jumpRef.current = { section: id, page: document.page, target };
      }
    },
    [shownLayout, layout, setSearch],
  );
  // Its link, for a modified click and a new tab: the page it flips to, and
  // the entry it goes to as the fragment.
  const outlineHref = useCallback(
    (id: SectionId, document: OutlineDocument): string => {
      const query = withPage(search, id, document.page).toString();
      return `${location.pathname}${query === "" ? "" : `?${query}`}#${outlineTargetId(id, document)}`;
    },
    [search, location.pathname],
  );

  // Show question on a preview card: the whole block, which only a request
  // naming it in full is answered with (§6.6), with its diagrams drawn.
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
        onOpenHere={saveScroll}
        onFile={fileComment}
        onUndo={undoComment}
        cardKey={key}
        onScoped={reportScoped}
        unfoldedByDefault={cardsExpanded}
        folds={folds}
      />
    );
  };

  const documentRow = (
    section: SectionId,
    path: string,
    extra?: React.ReactNode,
  ) => (
    <DocumentRow
      key={path}
      section={section}
      path={path}
      index={shownIndex!}
      href={buildPath(path)}
      onOpen={saveScroll}
    >
      {extra}
    </DocumentRow>
  );

  const headerRef = useHeaderFit();

  // The filter line (planning-filter.md §7), drawn in every state but a
  // static export, which has no planning page to filter.
  const filterLineShown = !isStaticMode();
  const filterInputRef = useRef<HTMLInputElement>(null);
  // `/` focuses the box and selects its text, so a paste replaces it.
  const focusFilter = useCallback(() => {
    const input = filterInputRef.current;
    if (input === null) return;
    input.focus();
    input.select();
  }, []);
  const leaveFilter = useCallback(() => {
    contentRef.current?.focus({ preventScroll: true });
  }, []);
  // The query a reader's Enter, ✕ or paste navigated to, until the page it
  // asks for is on screen, when the live region speaks its notice: after a
  // reader's change, never as the page opens (§7).
  const [announceFor, setAnnounceFor] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Enter, ✕ or a pasted link (§6.4): one replace navigation, written with
  // the link encoding for `filter`, every section back on its first page,
  // `roadmap` and every unknown parameter kept, the fragment dropped. The
  // text already applied, under the roadmap already shown, does nothing.
  const applyFilter = useCallback(
    (text: string, roadmap: string | null) => {
      const next = withFilter(search, text, roadmap);
      const sameRoadmap =
        roadmap === null ||
        readRoadmapRequest(next) === readRoadmapRequest(search);
      if (readFilterRequest(next) === filterValue(filterText) && sameRoadmap) {
        return;
      }
      const query = planningQuery(next);
      const target = query === "" ? "" : `?${query}`;
      setAnnounceFor(target);
      scrollToRef.current = null;
      jumpRef.current = null;
      navigate({ search: target }, { replace: true });
    },
    [search, filterText, navigate],
  );
  // The filter notice's lines, for the frame: what the page on screen shows.
  const filterNotice = useMemo(
    () => filterNoticeLines(frameSummary, frameNotUnderstood),
    [frameSummary, frameNotUnderstood],
  );
  const filterNoticeId = React.useId();
  const noticeShown = frameReady && filterNotice !== null;
  const spoken =
    filterNotice === null
      ? FILTER_CLEARED
      : filterNotice.map(spokenLine).join(" ");
  // Once the page the reader asked for is on screen, its frame settled.
  if (
    announceFor !== null &&
    location.search === announceFor &&
    (shown === null || !inputs.waiting) &&
    frameUrlFilter === urlFilter
  ) {
    setAnnounceFor(null);
    if (frameReady) setAnnouncement(spoken);
  }

  // The roadmap picker (§6.8), and only one of it: at the head of the
  // planning outline while the outline is drawn, else on its line above the
  // section bar (§6.9). Its options are the frame's.
  const picker =
    frameReady &&
    frameSections !== null &&
    frameRoutes.length >= 2 &&
    pickerValue !== null
      ? (stacked: boolean) => (
          <RoadmapLine
            roadmaps={frameRoutes}
            needYou={frameNeedYou?.roadmaps}
            value={pickerValue}
            others={frameSections.onOtherRoadmaps.length}
            othersLeft={frameNeedYou?.others}
            busy={roadmapSwapSlow}
            onPick={pickRoadmap}
            stacked={stacked}
          />
        )
      : null;

  // The header's breadcrumb: the repository, then the page.
  const crumbRoot = isMultiRepo
    ? repoName === ""
      ? { label: "Projects", href: "/" }
      : { label: repoName, href: `/${repoName}` }
    : { label: "root", href: "/" };
  // The contents column is the planning outline here, offered wherever the
  // page shows a repository's planning; full width, on every page.
  const contentsToggle = showSidebar
    ? { on: contentsOpen, onToggle: toggleContents }
    : null;
  const fullWidthToggle = { on: fullWidth, onToggle: toggleFullWidth };

  // Drawn in the app shell, as the viewer is, which shows its loading state
  // until the repositories are known: which sidebar to draw is not known
  // before.
  const shell = useShellPage({
    contentRef,
    showSidebar,
    routeKey: `planning\n${pathParam ?? ""}`,
    currentPath: null,
    onFocusFilter: filterLineShown ? focusFilter : undefined,
  });

  // The header is the viewer's, fitted by the same yield steps
  // (`lib/headerFit.ts`): the ways to the sidebar and the view toggles, the
  // breadcrumb with the page's name last to give up room, and the page's
  // one action, Copy answers, which folds into the "⋯" with the toggles.
  const header = (
    <div
      ref={headerRef}
      data-testid="planning-header"
      className="viewer-header h-14 border-b border-slate-200 dark:border-slate-700 flex items-center px-3 md:px-6 justify-between shrink-0 bg-white dark:bg-slate-800 gap-2"
    >
      <div className="hdr-lead flex items-center gap-2">
        {showSidebar && <OpenSidebarButton shell={shell} />}
        <ViewToggles contents={contentsToggle} fullWidth={fullWidthToggle} />
        <nav className="hdr-crumbs flex items-center text-sm gap-1 min-w-0 overflow-hidden">
          <AppLink
            to={crumbRoot.href}
            className="hdr-repo text-slate-500 dark:text-slate-400 hover:text-blue-600 font-medium transition-colors shrink-0 no-underline"
          >
            {crumbRoot.label}
          </AppLink>
          {/* The repository's "…", which only the `repo` step shows. */}
          <span className="hdr-dirs-collapsed hdr-no-dirs items-center gap-1 shrink-0">
            <ChevronRight
              size={14}
              className="hdr-sep text-slate-500 dark:text-slate-400 shrink-0"
            />
            <CollapsedFolders
              root={crumbRoot}
              dirs={[]}
              hrefFor={() => crumbRoot.href}
            />
          </span>
          <ChevronRight
            size={14}
            className="text-slate-500 dark:text-slate-400 shrink-0"
          />
          <h1 className="hdr-name flex min-w-0 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <span className="truncate">Planning</span>
          </h1>
        </nav>
      </div>
      <div className="hdr-tools flex items-center gap-2">
        <HeaderOverflow
          extra={
            <ViewTogglesPanel
              contents={contentsToggle}
              fullWidth={fullWidthToggle}
            />
          }
        >
          <button
            type="button"
            onClick={copyAnswers}
            disabled={!countKnown || pendingCount === 0 || quotesLoading}
            // Under a filter, how many pending answers it leaves out: in the
            // name and the tooltip, never in text that moves (§6.6).
            aria-label={
              countKnown && pendingLeftOut > 0
                ? `${copied ? "Copied" : "Copy answers"} ${pendingCount}, not counting ${leftOutAnswers(pendingLeftOut)} the filter leaves out`
                : undefined
            }
            title={
              reviewsFailed
                ? "Comments could not be loaded, so the answers waiting on the agent cannot be counted"
                : !countKnown
                  ? "The answers waiting on the agent are still being counted"
                  : pendingLeftOut > 0
                    ? pendingCount === 0
                      ? `No answers the filter keeps are waiting on the agent. It leaves out ${leftOutAnswers(pendingLeftOut)}: clear it to copy them`
                      : `Copy every answer waiting on the agent that the filter keeps, grouped by document, for one trip. It leaves out ${leftOutAnswers(pendingLeftOut)}: clear it to copy them too`
                    : pendingCount === 0
                      ? "No answers are waiting on the agent"
                      : "Copy every answer waiting on the agent, grouped by document, for one trip"
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {/* As wide as its longer label, so Copied moves nothing, and the
                count inside that room, so it centers with the icon and the
                label: room for four digits, so the count arriving moves
                nothing either. */}
            <ReservedLabel
              icon={
                copied ? (
                  <Check size={RESERVED_ICON_SIZE} aria-hidden="true" />
                ) : reviewsFailed ? (
                  <AlertCircle
                    size={RESERVED_ICON_SIZE}
                    aria-hidden="true"
                    data-testid="reviews-failed"
                    className="text-amber-600 dark:text-amber-400"
                  />
                ) : (
                  <ClipboardCopy size={RESERVED_ICON_SIZE} aria-hidden="true" />
                )
              }
              label={copied ? "Copied" : "Copy answers"}
              reserve={["Copy answers", "Copied"]}
              labelClassName="hdr-label"
              trailing={{
                text: countKnown ? String(pendingCount) : "–",
                testId: "pending-answers",
                className:
                  "inline-block text-right tabular-nums text-slate-500 dark:text-slate-400",
                style: { minWidth: `${planningLimits.pendingCountDigits}ch` },
              }}
            />
          </button>
        </HeaderOverflow>
      </div>
    </div>
  );

  return (
    <>
      {header}
      {restFailed && (
        <p role="alert" className="sr-only">
          Comments could not be loaded.
        </p>
      )}
      <div className="flex-1 flex min-h-0 relative">
        {/* Focusable, not in the tab order: the shell gives it the focus
                as the page opens (useShellPage), so the browser's scrolling
                keys scroll it. */}
        <div
          ref={paneRef}
          data-content-scroll
          tabIndex={-1}
          className="flex-1 overflow-y-auto bg-slate-50 outline-none dark:bg-slate-900"
        >
          {/* The viewer's band: the contents column, then the page's
                  column, glued to the pane's left. The cards keep a reading
                  measure until the reader asks for the full width. */}
          <div className="flex gap-12 py-4 px-4 sm:py-6 sm:px-8">
            {outlineShown && (
              <PlanningOutline
                // Replaced, not moved, by a filter applied, as the sections
                // are (below).
                key={frameFilterKey}
                outline={outline}
                active={outlineActive}
                picker={picker?.(true) ?? null}
                hrefOf={outlineHref}
                onSection={bringSectionIntoView}
                onDocument={jumpToDocument}
                onPrefetch={prefetch}
              />
            )}
            <main
              ref={rootRef}
              className={cn(
                "relative min-w-0 flex-1",
                fullWidth ? "max-w-none" : "max-w-4xl",
              )}
            >
              {/* The filter line (planning-filter.md §7): first, above every
                  state of the route, and the same height in each, so
                  nothing is ever inserted above it. */}
              {filterLineShown && (
                <PlanningFilterLine
                  urlText={filterText}
                  invalid={urlFilter.kind === "not-understood"}
                  busy={filterSwapSlow}
                  onApply={applyFilter}
                  onLeave={leaveFilter}
                  inputRef={filterInputRef}
                  describedBy={noticeShown ? filterNoticeId : undefined}
                  announcement={announcement}
                  printText={frameFilter}
                />
              )}
              {ready?.rescanning && (
                <div className="absolute top-0 right-0 left-0 h-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <div className="h-full w-full animate-pulse bg-blue-500" />
                </div>
              )}
              {isMultiRepo && reposLoaded && repoName === "" ? (
                <>
                  <Notice>
                    Choose a project to see its planning page.{" "}
                    <AppLink
                      to="/"
                      className="text-blue-600 dark:text-blue-400"
                    >
                      Projects
                    </AppLink>
                  </Notice>
                  <ProjectPlanningLinks
                    names={repos.map((r) => r.name)}
                    search={location.search}
                  />
                </>
              ) : isMultiRepo && reposLoaded && !repoExists ? (
                <>
                  <Notice>Repository not found: {repoName}</Notice>
                  <ProjectPlanningLinks
                    names={repos.map((r) => r.name)}
                    search={location.search}
                  />
                </>
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
                  {/* The frame (§6.3): the roadmap line when two or more
                roadmaps route, the section bar, or the progress line in
                their place, then the notices. It paints first; the
                sections fill the region below it in one later commit. */}
                  {!outlineShown && picker?.(false)}
                  {/* Keyed by what it holds: the progress line's box is
                          not the section bar's. Reused, it was the one
                          painted box the roadmap line, inserted above it,
                          moved down, which the browser scores as a layout
                          shift on every cold load of a page with a picker,
                          though nothing painted under it moved
                          (planning-index.md §6.10). Replaced, it is
                          a removal and an insertion, which score nothing.
                          So is it, and all below it, when a filter is
                          applied: a shorter bar, or one with no Copy all
                          agent requests, moved its controls, and the
                          notice the frame gains moved the sections
                          (planning-filter.md §7). */}
                  <div
                    key={
                      frameReady && frameLayout !== null
                        ? `bar\n${frameFilterKey}`
                        : "progress"
                    }
                    className="mb-6 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1"
                  >
                    {frameReady && frameLayout !== null ? (
                      <>
                        <SectionBar
                          layout={frameLayout}
                          answered={frameNeedYou?.sections}
                        />
                        {/* The page's controls over its sections, at the
                            end of the line, or of a line of their own when
                            the section bar leaves no room for them. */}
                        <div className="ml-auto flex shrink-0 items-center gap-1 print:hidden">
                          {frameLayout.sections.some((s) =>
                            isPlanningAgentSectionId(s.id),
                          ) && (
                            <CopyRequestButton
                              label="Copy all agent requests"
                              name="Copy all agent requests"
                              hint="Copy one instruction for an agent covering every entry of every section an agent works on, on every page"
                              done="Copied every agent request."
                              request={() => requestOf()}
                            />
                          )}
                          {frameLayout.sections.some(
                            (s) => s.kind === "cards",
                          ) && (
                            <CardsToggle
                              expanded={cardsBrought}
                              onToggle={toggleCards}
                            />
                          )}
                        </div>
                      </>
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
                  <React.Fragment key={frameFilterKey}>
                    {frameReady &&
                      frameSections !== null &&
                      frameConfig !== null && (
                        <Notices
                          sections={frameSections}
                          config={frameConfig}
                          filtered={frameFilter !== ""}
                          filterNotice={
                            filterNotice !== null && (
                              <FilterNotice
                                id={filterNoticeId}
                                lines={filterNotice}
                                notUnderstood={frameNotUnderstood !== null}
                              />
                            )
                          }
                        />
                      )}
                    <div ref={sectionsRef} data-planning-sections>
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
                          {answeredAll && (
                            <p
                              data-testid="nothing-needs-you"
                              className="mb-6 text-base font-medium text-slate-700 dark:text-slate-200"
                            >
                              {frameFilter !== ""
                                ? PLANNING_NOTICES.nothingFilteredNeedsYou
                                : PLANNING_NOTICES.nothingNeedsYou}{" "}
                              <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
                                Every open question has your answer, waiting on
                                the agent.
                              </span>
                            </p>
                          )}
                          <Sections
                            layout={shown.inputs.layout}
                            index={shown.inputs.index}
                            card={card}
                            documentRow={documentRow}
                            buildPath={buildPath}
                            asked={asked}
                            onFlip={flip}
                            onPrefetch={prefetch}
                            busy={busy}
                            requestOf={requestOf}
                            answered={frameNeedYou?.sections}
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
                  </React.Fragment>
                </>
              )}
            </main>
          </div>
          {/* Room below the page for the degradation banner, as the
                  viewer keeps it. */}
          {shell.bannerSpace > 0 && (
            <div aria-hidden="true" style={{ height: shell.bannerSpace }} />
          )}
        </div>
      </div>
    </>
  );
};

/**
 * Daemon mode's way on from *Choose a project* and *Repository not found*
 * (`planning-filter.md` §9.4): each served project's planning page, with the
 * same query, so a root-relative link with an address in front keeps its
 * filter and costs one click.
 */
const ProjectPlanningLinks: React.FC<{
  names: readonly string[];
  /** The URL's query, `?` and all, or `""`. */
  search: string;
}> = ({ names, search }) =>
  names.length === 0 ? null : (
    <ul data-testid="planning-projects" className="mb-3 space-y-1 text-sm">
      {names.map((name) => (
        <li key={name}>
          <AppLink
            to={`${planningPath(true, name)}${search}`}
            className="text-blue-600 no-underline hover:underline dark:text-blue-400"
          >
            {name}
          </AppLink>
        </li>
      ))}
    </ul>
  );

/** One document, by name, with its badge and whatever the section adds. */
const DocumentRow: React.FC<{
  /** The section it is a row of, which names it for the outline. */
  section: SectionId;
  path: string;
  index: PlanningIndex;
  href: string;
  onOpen: () => void;
  children?: React.ReactNode;
}> = ({ section, path, index, href, onOpen, children }) => {
  const badge = badgeFor(index, "", { path, fragment: null });
  return (
    <div
      id={planningRowId(section, path)}
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

/** What a blocked document waits on: each entry, linked, with its badge. */
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
          blocked on{" "}
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
  /** Each section as the URL asks for it, by id. */
  asked: ReadonlyMap<SectionId, LaidOutSection>;
  index: PlanningIndex;
  card: (question: PlanningQuestion, preview: boolean) => React.ReactNode;
  documentRow: (
    section: SectionId,
    path: string,
    extra?: React.ReactNode,
  ) => React.ReactNode;
  buildPath: (path: string) => string;
  onFlip: OnFlip;
  onPrefetch?: OnPrefetch;
  busy: ReadonlySet<SectionId>;
  requestOf: AgentRequestOf;
  /** How many of each section's entries a pending comment answers, by id. */
  answered?: ReadonlyMap<string, number>;
}> = ({
  layout,
  asked,
  index,
  card,
  documentRow,
  buildPath,
  onFlip,
  onPrefetch,
  busy,
  requestOf,
  answered,
}) => {
  const entry = (section: SectionId, item: CardEntry) =>
    item.kind === "question" ? (
      <React.Fragment key={`question\n${refKey(item.question)}`}>
        {card(item.question, item.preview)}
      </React.Fragment>
    ) : (
      <React.Fragment key={`doc\n${item.path}`}>
        {documentRow(
          section,
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
          asked={asked.get(section.id)}
          onFlip={onFlip}
          onPrefetch={onPrefetch}
          busy={busy.has(section.id)}
          requestOf={requestOf}
          answered={answered?.get(section.id)}
        >
          {section.kind === "cards" ? (
            section.items.map((item) => entry(section.id, item))
          ) : section.kind === "rows" ? (
            section.items.map((path) =>
              documentRow(
                section.id,
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
