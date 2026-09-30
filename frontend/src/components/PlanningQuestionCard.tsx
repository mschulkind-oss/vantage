/**
 * One question on the planning page (`docs/design/planning-index.md` §6.3).
 *
 * The question is rendered by the viewer's own pipeline: an embedded
 * `MarkdownViewer` over its card block, the root-level block that holds it as
 * the scan cut it (`docs/design/planning-index-at-scale.md` §7.4), at the
 * document's own source lines. That block usually holds the question's
 * siblings too — an Open Questions list is one block — so once it renders,
 * everything outside the question's own unit (its `<li>`, or its host block
 * outside a list) is hidden, and every list item on the way keeps the number
 * it has in the document, which a card shows when it has no headline.
 *
 * The card then lays the unit out to be read (`planningCardParts.ts`): the
 * question's bold title becomes the card's headline, its leaning a block of
 * its own, an empty `Answer:` placeholder is not shown, and the rest of the
 * question is cut to `CARD_CLAMP_LINES` lines behind Show full question. All
 * of it is decided in the same layout pass that isolates the unit, before the
 * card paints, and Show full question has a slot of fixed width in the control
 * row whether or not there is anything to unfold, so nothing the card paints
 * moves later (§11). Unfolding is the reader's own action, so it may.
 *
 * Answering files a comment that is indistinguishable from one filed with the
 * in-page button: the anchor is built from the card's own rendered host with
 * `buildWholeBlockAnchor`, and a take's text is `leaningComment` over the
 * stamped element — the two calls the in-page pass makes, over the same
 * rendered block. Nothing comes from the index's `leaning`, which only says
 * whether there is one.
 *
 * Its controls follow its state (Plan Q5): an open question offers Take this
 * leaning (when it has a leaning), Answer… and Open document; an answered one
 * Answer… and Open document; a blocked one, which only Waiting lists, Open
 * document alone.
 *
 * Every card keeps a fixed-width *N comments* count in its control row
 * (`docs/design/planning-index-at-scale.md` §11.2), which toggles the list of
 * comments on the question. Comments in hand when the page painted are listed
 * at once; comments that came later go only into the count until the reader
 * opens it, so their arrival moves nothing. A Mermaid diagram that was not
 * drawn when the card painted draws into a fixed frame, scaled to fit.
 *
 * A question whose block is too large to render unasked is a **preview card**
 * (`docs/design/planning-index-at-scale.md` §10.4): its file name and badge,
 * the question's marker, title, state and leaning, and Show question and Open
 * document. Take this leaning and Answer… need the rendered host block for
 * their anchor, so they appear once Show question has rendered the whole card
 * in place — the reader's own action, so the page may grow. Show question goes
 * with it, so the focus it had goes to the card.
 */
import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import type {
  CardBlock,
  PlanningBadge,
  PlanningQuestion,
} from "vantage-md/planning";
import { ExternalLink, MessageSquarePlus } from "lucide-react";
import { MarkdownViewer } from "./MarkdownViewer";
import { PlanningBadgeChip } from "./PlanningBadge";
import { ReviewCommentPopover } from "./ReviewCommentPopover";
import { AppLink } from "./AppLink";
import {
  OQ_LABEL,
  OQ_TAKEN_LABEL,
  answerableOpenQuestions,
  findTaken,
  leaningComment,
  type AnswerableOpenQuestion,
} from "../hooks/useOpenQuestionButtons";
import {
  NEIGHBOR_RADIUS,
  blockAtLine,
  buildWholeBlockAnchor,
  findHashNeighbor,
  indexBlocks,
} from "../lib/reviewAnchor";
import { isStaticMode } from "../lib/staticMode";
import {
  CARD_CLAMP_LINES,
  CARD_OVERFLOW_ATTR,
  headlineMarker,
  markCardParts,
  measureClampSoon,
  overflowsClamp,
  unmarkCardParts,
} from "../lib/planningCardParts";
import { focusIsIdle } from "../hooks/useShellPage";
import { planningCardId } from "../lib/planningCardId";
import { planningLimits } from "../planningScan/limits";
import {
  commandErrorMessage,
  isPendingForAgent,
  latestAgentReaction,
  newReviewComment,
} from "../stores/useReviewStore";
import type { ReviewComment } from "../types";

/** Marks the elements between the card and the question's unit. */
export const CARD_PATH_ATTR = "data-planning-card-path";
/** Marks the question's unit, which is shown whole. */
export const CARD_UNIT_ATTR = "data-planning-card-unit";
/** Marks a list item whose `value` the card set, so a later pass can undo it. */
const CARD_VALUE_ATTR = "data-planning-card-value";

/** Marks a card, with its question's `path` and `line`. */
export const CARD_ATTR = "data-planning-question";

/** The text shown beside a comment the agent has not answered yet. */
export const WAITING_LABEL = "waiting on the agent";

/**
 * Which of a document's comments are on one question, as its card read them
 * from the rendered question, and what it read them from: the question and
 * the document's comments, as the card was given them. The report stands for
 * the rest of the visit, after the card has left the page too, and is true
 * while both are still the page's (`docs/design/planning-index-at-scale.md`
 * §10.5).
 */
export interface ScopedReport {
  /** The ids of the comments on the question, in the document's order. */
  ids: readonly string[];
  question: PlanningQuestion;
  comments: readonly ReviewComment[] | undefined;
}

interface PlanningQuestionCardProps {
  question: PlanningQuestion;
  /**
   * The question's card block, from the scanner client: `null` when the
   * document no longer has it. A preview card has none until Show question
   * fetches it.
   */
  card: CardBlock | null;
  /** The block is past the size a card renders unasked (§10.4). */
  preview?: boolean;
  /**
   * Fetch the whole block of a preview card's question, for Show question;
   * `null` when it could not be had.
   */
  onShowQuestion?: (question: PlanningQuestion) => Promise<CardBlock | null>;
  /** The document's own badge, or `null` when it has nothing to show. */
  badge: PlanningBadge | null;
  /** The document's review comments, or `undefined` until they load. */
  comments: readonly ReviewComment[] | undefined;
  /**
   * The comments were not in hand when the card painted, so they are listed
   * only once the reader opens the count.
   */
  commentsLate?: boolean;
  /** The viewer URL of the document, without a fragment. */
  href: string;
  /** Called before Open document follows its link. */
  onOpenDocument?: () => void;
  /** File a comment on `path`; rejects when it could not be saved. */
  onFile: (path: string, comment: ReviewComment) => Promise<void>;
  /** The card's key on its page, which `onScoped` reports it by. */
  cardKey?: string;
  /**
   * The comments on this question, by the card's key, read from the rendered
   * question, each time the question or its document's comments change;
   * `null` while the card has no rendered question to read them from (a
   * preview, a block without its host, a document gone from the index), so
   * the page places them by line instead (§10.5). A card that leaves the page
   * says nothing: what it reported last is still true of what it read. One
   * callback for every card, so a card's props stay equal from one render of
   * its page to the next.
   */
  onScoped?: (key: string, report: ScopedReport | null) => void;
}

const lineOf = (el: Element): number =>
  Number.parseInt(el.getAttribute("data-source-line") ?? "", 10);

/** The question's host in `root`: the block the in-page button anchors on. */
function hostIn(
  root: HTMLElement,
  question: PlanningQuestion,
): AnswerableOpenQuestion | undefined {
  return answerableOpenQuestions(root).find(
    ({ block }) => lineOf(block) === question.line,
  );
}

/**
 * The question's unit: the list item holding it, or its host outside a list —
 * the element the contents column scrolls to, which the planning index's
 * `unitLine` names (`planningAgreement.test.tsx` holds the two equal).
 */
function unitOf(root: HTMLElement, host: AnswerableOpenQuestion): HTMLElement {
  const item = host.stamped.closest<HTMLElement>("li");
  return item !== null && root.contains(item) ? item : host.stamped;
}

/**
 * Undo what `isolate` and `markCardParts` did: every mark, every list number
 * and every text node they set, so the card reads its question as its
 * document has it.
 */
function sweep(root: HTMLElement): void {
  unmarkCardParts(root);
  for (const el of root.querySelectorAll(`[${CARD_PATH_ATTR}]`)) {
    el.removeAttribute(CARD_PATH_ATTR);
  }
  for (const el of root.querySelectorAll(`[${CARD_UNIT_ATTR}]`)) {
    el.removeAttribute(CARD_UNIT_ATTR);
  }
  for (const el of root.querySelectorAll(`[${CARD_VALUE_ATTR}]`)) {
    el.removeAttribute("value");
    el.removeAttribute(CARD_VALUE_ATTR);
  }
}

/**
 * Show only `unit`: mark it and every element between it and `root`, and let
 * the stylesheet hide every child of a marked element that is neither. A rule
 * rather than a hidden attribute on each sibling, so a node another pass adds
 * later (a link badge) is hidden or shown by where it is, not by when.
 *
 * A hidden list item does not advance its list's counter, so the third item
 * would read `1.` alone. Each list item on the way gets its number in the
 * document as an explicit `value` first.
 */
function isolate(root: HTMLElement, unit: HTMLElement): void {
  unit.setAttribute(CARD_UNIT_ATTR, "");
  for (let el: HTMLElement | null = unit; el && el !== root;) {
    const parent: HTMLElement | null = el.parentElement;
    if (el.tagName === "LI" && parent?.tagName === "OL") {
      const list = parent as HTMLOListElement;
      const items = Array.from(list.children).filter((c) => c.tagName === "LI");
      el.setAttribute("value", String(list.start + items.indexOf(el)));
      el.setAttribute(CARD_VALUE_ATTR, "");
    }
    if (parent === null || parent === root) break;
    parent.setAttribute(CARD_PATH_ATTR, "");
    el = parent;
  }
}

/**
 * The block a comment's anchor resolves to, as the highlighter resolves it:
 * the block at its line when the hash agrees, else a block with its hash
 * within `NEIGHBOR_RADIUS` lines, else the block at its line anyway.
 */
function resolveAnchor(
  index: ReturnType<typeof indexBlocks>,
  comment: ReviewComment,
): HTMLElement | null {
  const anchor = comment.anchor;
  if (!anchor) return null;
  const atLine = blockAtLine(index, anchor.source_line, anchor.block_text_hash);
  if (atLine?.getAttribute("data-block-hash") === anchor.block_text_hash) {
    return atLine;
  }
  return (
    findHashNeighbor(
      index,
      anchor.block_text_hash,
      anchor.source_line,
      NEIGHBOR_RADIUS,
    ) ?? atLine
  );
}

interface CardState {
  /** Whether the question's host is in the card: without it, nothing files. */
  found: boolean;
  /** The ids of the comments on this question, in the document's order. */
  scoped: readonly string[];
  /** The comment an earlier take filed, if the leaning has been taken. */
  takenId: string | null;
  /** The unit was laid out (`markCardParts`): false leaves it as rendered. */
  laidOut: boolean;
  /** The bold title is hidden in the unit, for the headline to show. */
  titled: boolean;
  /** The unit has a leaning block of its own. */
  leaning: boolean;
  /** Some of the unit is hidden while the card is folded. */
  more: boolean;
}

const EMPTY_STATE: CardState = {
  found: false,
  scoped: [],
  takenId: null,
  laidOut: false,
  titled: false,
  leaning: false,
  more: false,
};

const sameState = (a: CardState, b: CardState): boolean =>
  a.found === b.found &&
  a.takenId === b.takenId &&
  a.laidOut === b.laidOut &&
  a.titled === b.titled &&
  a.leaning === b.leaning &&
  a.more === b.more &&
  a.scoped.length === b.scoped.length &&
  a.scoped.every((id, i) => b.scoped[i] === id);

/** Marks a Mermaid diagram that was not drawn when its card painted. */
const LATE_DIAGRAM_ATTR = "data-planning-mermaid-frame";
/** Marks one that was, so it keeps its own size. */
const DRAWN_DIAGRAM_ATTR = "data-planning-mermaid-drawn";

/**
 * Mark each diagram in `root` the first time it is seen: drawn, or late. A
 * late one is laid out in a fixed frame by the stylesheet, so what it draws
 * into, or the error it becomes, moves nothing.
 */
function markDiagrams(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>(
    '[data-testid="mermaid-container"]',
  )) {
    if (
      el.hasAttribute(LATE_DIAGRAM_ATTR) ||
      el.hasAttribute(DRAWN_DIAGRAM_ATTR)
    ) {
      continue;
    }
    el.setAttribute(
      el.querySelector("svg") === null ? LATE_DIAGRAM_ATTR : DRAWN_DIAGRAM_ATTR,
      "",
    );
  }
}

/** How a question's state reads on a preview card. */
const STATE_LABEL: Record<PlanningQuestion["state"], string> = {
  open: "Open",
  answered: "Answered",
  blocked: "Blocked",
};

/**
 * The card's headline: the question's status marker and its bold title, as
 * the planning index read them, so it is there at first paint.
 */
const Headline: React.FC<{ question: PlanningQuestion }> = ({ question }) => {
  const marker = headlineMarker(question.marker);
  return (
    <h3
      data-planning-card-headline
      className="mt-0 mb-1.5 text-[17px] leading-snug font-semibold text-slate-900 dark:text-slate-100"
    >
      {marker !== "" && <span aria-hidden="true">{marker} </span>}
      {question.title}
    </h3>
  );
};

/** A preview card's body: the question as the index knows it, and no more. */
const PreviewBody: React.FC<{ question: PlanningQuestion }> = ({
  question,
}) => (
  <div data-planning-preview className="text-sm">
    <p className="text-[13px] text-slate-600 dark:text-slate-400">
      {STATE_LABEL[question.state]}
      {question.leaning !== null && <> · Leaning: {question.leaning}</>}
    </p>
    <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
      Too long to show here unasked:{" "}
      {question.cardChars.toLocaleString("en-US")} characters.
    </p>
  </div>
);

/**
 * Memoized: a card renders again only when its own question, block, badge or
 * document's comments change (§10.4), so a review answer for one document
 * renders none of another's cards. Every prop its page passes is stable for
 * that reason.
 */
export const PlanningQuestionCard = React.memo(function PlanningQuestionCard({
  question,
  card: given,
  preview = false,
  onShowQuestion,
  badge,
  comments,
  commentsLate = false,
  href,
  onOpenDocument,
  onFile,
  cardKey = "",
  onScoped,
}: PlanningQuestionCardProps) {
  // Show question's answer, for the question it was fetched for.
  const [shown, setShown] = useState<{
    question: PlanningQuestion;
    block: CardBlock | null | "loading";
  } | null>(null);
  const full = shown?.question === question ? shown.block : null;
  const previewing = preview && (full === null || full === "loading");
  const card: CardBlock | null | undefined = previewing
    ? undefined
    : preview
      ? (full as CardBlock)
      : given;
  const [showFailed, setShowFailed] = useState(false);
  // Folded unless the reader unfolds it; a question shown from its preview was
  // asked for whole, so it arrives unfolded.
  const [unfolded, setUnfolded] = useState(false);
  const showQuestion = useCallback(() => {
    if (onShowQuestion === undefined) return;
    setShowFailed(false);
    setShown({ question, block: "loading" });
    void onShowQuestion(question).then(
      (block) => {
        setShown((prev) =>
          prev?.question === question ? { question, block } : prev,
        );
        if (block === null) setShowFailed(true);
        else setUnfolded(true);
      },
      () => {
        setShown(null);
        setShowFailed(true);
      },
    );
  }, [onShowQuestion, question]);

  const articleRef = useRef<HTMLElement>(null);
  /** Show question had the focus, which the card takes once it is shown. */
  const refocusRef = useRef(false);
  useLayoutEffect(() => {
    if (previewing || !refocusRef.current) return;
    refocusRef.current = false;
    if (focusIsIdle(document.activeElement)) {
      articleRef.current?.focus({ preventScroll: true });
    }
  }, [previewing]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CardState>(EMPTY_STATE);
  /** The block `markCardParts` cut short, which Show full question measures. */
  const clampRef = useRef<HTMLElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [answering, setAnswering] = useState<{
    rect: DOMRect;
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The comment list is open unless its comments came late; the reader's own
  // toggle, or an answer filed here, wins.
  const [open, setOpen] = useState<boolean | null>(null);

  const markdown = card?.markdown ?? null;

  // After the embedded viewer has rendered and its own passes have run — a
  // child's effects run before its parent's. Layout, so the question's
  // siblings are never painted, and the page hears the scoping before it
  // paints its count.
  useLayoutEffect(() => {
    const root = bodyRef.current;
    clampRef.current = null;
    if (!root || markdown === null) {
      setState((prev) => (sameState(prev, EMPTY_STATE) ? prev : EMPTY_STATE));
      onScoped?.(cardKey, null);
      return;
    }
    sweep(root);
    const host = hostIn(root, question);
    if (host === undefined) {
      setState((prev) => (sameState(prev, EMPTY_STATE) ? prev : EMPTY_STATE));
      onScoped?.(cardKey, null);
      return;
    }
    const unit = unitOf(root, host);

    // Before the siblings are hidden, so every block hashes as it does in its
    // document, where nothing is.
    const index = indexBlocks(root);
    const scoped = (comments ?? [])
      .filter((c) => {
        const block = resolveAnchor(index, c);
        return block !== null && unit.contains(block);
      })
      .map((c) => c.id);

    isolate(root, unit);

    const built = buildWholeBlockAnchor(host.block);
    const taken =
      built === null
        ? undefined
        : findTaken(
            (comments ?? []).filter((c) => scoped.includes(c.id)),
            built.anchor,
            leaningComment(host.stamped),
          );
    // Last, once everything above has read the unit as its document has it.
    const parts = markCardParts(
      root,
      unit,
      host.block,
      question.title,
      question.marker,
    );
    clampRef.current = parts.clamp;
    const next: CardState = {
      found: built !== null,
      scoped,
      takenId: taken?.id ?? null,
      laidOut: true,
      titled: parts.titled,
      leaning: parts.leaning,
      more: parts.more,
    };
    setState((prev) => (sameState(prev, next) ? prev : next));
    // Without an anchor the card has nothing exact to say.
    onScoped?.(
      cardKey,
      built === null ? null : { ids: scoped, question, comments },
    );
  }, [markdown, question, comments, cardKey, onScoped]);

  // Every diagram as the card first painted it, and every one it becomes: a
  // diagram MarkdownViewer draws late replaces its element's content, and one
  // that cannot be drawn replaces the element itself.
  useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!root || markdown === null) return;
    markDiagrams(root);
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => markDiagrams(root));
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [markdown]);

  // Whether the cut-short block runs past its lines, which decides whether
  // Show full question is offered: measured before the card paints, and again
  // whenever the block's size changes (a wider page, a font that loaded). Its
  // slot is always there, so the answer changing later moves nothing.
  //
  // The first measurement waits for the end of the task, with every other
  // card committed alongside (`measureClampSoon`), so a page of cards is laid
  // out once rather than once a card; it is still made before the paint.
  useLayoutEffect(() => {
    const el = clampRef.current;
    if (el === null || !el.isConnected) {
      setOverflowing(false);
      return;
    }
    let live = true;
    const read = () => live && el.isConnected && overflowsClamp(el, !unfolded);
    const write = (over: boolean) => {
      if (!live) return;
      el.toggleAttribute(CARD_OVERFLOW_ATTR, over && !unfolded);
      setOverflowing(over);
    };
    measureClampSoon({ read, write });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => write(read()));
    observer?.observe(el);
    return () => {
      live = false;
      observer?.disconnect();
    };
    // The layout pass's own inputs, since each run of it marks the block anew.
  }, [markdown, question, comments, cardKey, onScoped, unfolded]);

  /** The anchor and fallback text the in-page button would send, from the card. */
  const anchorNow = useCallback(() => {
    const root = bodyRef.current;
    if (!root) return null;
    const host = hostIn(root, question);
    if (host === undefined) return null;
    const built = buildWholeBlockAnchor(host.block);
    return built === null ? null : { host, ...built };
  }, [question]);

  const file = useCallback(
    async (text: (host: AnswerableOpenQuestion) => string) => {
      const now = anchorNow();
      if (now === null) return;
      setBusy(true);
      setError(null);
      try {
        await onFile(
          question.path,
          newReviewComment(now.anchor, text(now.host), now.fallbackText),
        );
        setOpen(true);
      } catch (e) {
        setError(commandErrorMessage(e, "Could not save the comment"));
      } finally {
        setBusy(false);
      }
    },
    [anchorNow, onFile, question.path],
  );

  const writable = !isStaticMode() && state.found;
  const canTake =
    writable && question.state === "open" && question.leaning !== null;
  const canAnswer =
    writable && (question.state === "open" || question.state === "answered");

  const listed = (comments ?? []).filter((c) => state.scoped.includes(c.id));
  const listOpen = open ?? !commentsLate;

  const id = planningCardId(question.path, question.id, question.unitLine);
  const bodyId = `${id}-body`;
  // The rendered question leads with its title only once the layout pass has
  // taken it out of the unit; the index's question is all a card without a
  // rendered question has.
  const headed = card === undefined || card === null || state.titled;
  // Take this leaning files the directive's leaning, so a question whose unit
  // writes none out shows the one it would file.
  const leaningAside =
    state.laidOut && !state.leaning && question.leaning !== null
      ? question.leaning
      : null;
  const foldable = state.laidOut && (state.more || overflowing);

  return (
    <article
      ref={articleRef}
      id={id}
      {...{ [CARD_ATTR]: `${question.path}#${question.line}` }}
      aria-label={question.title}
      // Where Show question's focus goes once the card is shown.
      tabIndex={preview ? -1 : undefined}
      className="rounded-xl border border-slate-200 bg-white px-5 pt-3 pb-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500 dark:text-slate-400">
        <AppLink
          to={href}
          onBeforeNavigate={() => {
            onOpenDocument?.();
          }}
          className="font-medium text-blue-600 no-underline hover:underline dark:text-blue-400"
        >
          {question.path}
        </AppLink>
        {badge !== null && <PlanningBadgeChip badge={badge} />}
      </div>

      {headed && <Headline question={question} />}

      <div
        ref={bodyRef}
        id={bodyId}
        className="planning-card-body"
        data-planning-card-headed={state.titled ? "" : undefined}
        data-planning-card-unfolded={unfolded ? "" : undefined}
        style={
          {
            "--planning-mermaid-frame": `${planningLimits.mermaidFramePx}px`,
            "--planning-card-clamp-lines": CARD_CLAMP_LINES,
          } as React.CSSProperties
        }
      >
        {previewing ? (
          <PreviewBody question={question} />
        ) : card === undefined ? null : card === null ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            This question's document is not in the planning index any more.
          </p>
        ) : (
          <MarkdownViewer
            content={card.markdown}
            currentPath={question.path}
            sourceLineOffset={card.lineOffset}
            embedded
          />
        )}
      </div>

      {leaningAside !== null && (
        <p
          data-planning-card-leaning-aside
          className="planning-card-leaning mt-2 mb-0 text-sm text-slate-700 dark:text-slate-300"
        >
          <em>Leaning:</em> {leaningAside}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {previewing && onShowQuestion !== undefined && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 aria-disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            // Inert while it loads, not disabled, which would drop the focus.
            aria-disabled={full === "loading" ? "true" : undefined}
            onClick={(e) => {
              if (full === "loading") return;
              refocusRef.current = document.activeElement === e.currentTarget;
              showQuestion();
            }}
          >
            <Eye size={12} aria-hidden="true" />
            Show question
          </button>
        )}
        {canTake &&
          (state.takenId !== null ? (
            <span className="review-oq-taken">{OQ_TAKEN_LABEL}</span>
          ) : (
            <button
              type="button"
              className="review-oq-take"
              disabled={busy}
              onClick={() => {
                if (busy) return;
                void file((host) => leaningComment(host.stamped));
              }}
            >
              {OQ_LABEL}
            </button>
          ))}
        {canAnswer && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            disabled={busy}
            onClick={(e) => {
              const now = anchorNow();
              if (now === null) return;
              setAnswering({
                rect: e.currentTarget.getBoundingClientRect(),
                text: now.fallbackText,
              });
            }}
          >
            <MessageSquarePlus size={12} aria-hidden="true" />
            Answer…
          </button>
        )}
        <AppLink
          to={href}
          onBeforeNavigate={() => {
            onOpenDocument?.();
          }}
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 no-underline transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <ExternalLink size={12} aria-hidden="true" />
          Open document
        </AppLink>
        {error !== null && (
          <span
            role="alert"
            className="text-[11px] text-red-600 dark:text-red-400"
          >
            Not saved: {error}
          </span>
        )}
        {showFailed && (
          <span
            role="alert"
            className="text-[11px] text-red-600 dark:text-red-400"
          >
            Could not load the question.
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-2">
          {/* Always there, at a fixed width, so whether the question runs
              past its lines, which is known only once it is laid out, moves
              nothing (§11). */}
          <span
            data-planning-fold-slot
            className="inline-flex w-32 justify-end"
          >
            {foldable && (
              <button
                type="button"
                aria-expanded={unfolded}
                aria-controls={bodyId}
                data-planning-card-fold
                onClick={() => setUnfolded(!unfolded)}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                {unfolded ? "Show less" : "Show full question"}
              </button>
            )}
          </span>
          {/* Always there, at a fixed width, so a count that arrives late
              moves nothing (§11.2). */}
          <span
            data-planning-comment-slot
            className="inline-flex w-28 justify-end"
          >
            {listed.length > 0 && (
              <button
                type="button"
                aria-expanded={listOpen}
                data-planning-comment-count
                onClick={() => setOpen(!listOpen)}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 tabular-nums transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                {listed.length === 1
                  ? "1 comment"
                  : `${listed.length} comments`}
              </button>
            )}
          </span>
        </span>
      </div>

      {listOpen && listed.length > 0 && (
        <ul
          aria-label="Comments on this question"
          className="mt-3 space-y-1.5 border-t border-slate-100 pt-2 text-[13px] dark:border-slate-700"
        >
          {listed.map((c) => {
            const reply = latestAgentReaction(c);
            return (
              <li
                key={c.id}
                className={
                  c.resolved
                    ? "text-slate-500 dark:text-slate-400"
                    : "text-slate-700 dark:text-slate-300"
                }
              >
                <span className="whitespace-pre-wrap">{c.comment}</span>
                {isPendingForAgent(c) ? (
                  <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    {WAITING_LABEL}
                  </span>
                ) : c.resolved ? (
                  <span className="ml-2 text-[11px]">dismissed</span>
                ) : null}
                {reply !== undefined && !c.resolved && (
                  <div className="mt-0.5 pl-3 text-[12px] text-slate-500 dark:text-slate-400">
                    Agent: {reply.summary}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {answering !== null && (
        <ReviewCommentPopover
          selectedText={answering.text}
          rect={answering.rect}
          onSave={(typed) => {
            setAnswering(null);
            void file(() => typed);
          }}
          onCancel={() => setAnswering(null)}
        />
      )}
    </article>
  );
});
