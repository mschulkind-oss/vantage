/**
 * One question on the planning page (`docs/design/planning-index.md` §6.3).
 *
 * The question is rendered exactly as the viewer renders it in its document:
 * an embedded `MarkdownViewer` over its card block, the root-level block that
 * holds it as the scan cut it (`docs/design/planning-index-at-scale.md` §7.4),
 * at the document's own source lines. That block usually holds
 * the question's siblings too — an Open Questions list is one block — so once
 * it renders, everything outside the question's own unit (its `<li>`, or its
 * host block outside a list) is hidden, and every list item on the way keeps
 * the number it has in the document.
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
 * A question whose block is too large to render unasked is a **preview card**
 * (`docs/design/planning-index-at-scale.md` §10.4): its file name and badge,
 * the question's marker, title, state and leaning, and Show question and Open
 * document. Take this leaning and Answer… need the rendered host block for
 * their anchor, so they appear once Show question has rendered the whole card
 * in place — the reader's own action, so the page may grow.
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

interface PlanningQuestionCardProps {
  question: PlanningQuestion;
  /**
   * The question's card block, from the scanner client: `undefined` while it
   * is on its way, and `null` when the document no longer has it. A preview
   * card has none until Show question fetches it.
   */
  card: CardBlock | null | undefined;
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
  /** The viewer URL of the document, without a fragment. */
  href: string;
  /** Called before Open document follows its link. */
  onOpenDocument?: () => void;
  /** File a comment on `path`; rejects when it could not be saved. */
  onFile: (path: string, comment: ReviewComment) => Promise<void>;
  /** The ids of the document's comments that are on this question. */
  onScoped?: (ids: readonly string[]) => void;
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

/** Undo what `isolate` did: every mark and every list number it set. */
function sweep(root: HTMLElement): void {
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
}

const EMPTY_STATE: CardState = { found: false, scoped: [], takenId: null };

const sameState = (a: CardState, b: CardState): boolean =>
  a.found === b.found &&
  a.takenId === b.takenId &&
  a.scoped.length === b.scoped.length &&
  a.scoped.every((id, i) => b.scoped[i] === id);

/** How a question's state reads on a preview card. */
const STATE_LABEL: Record<PlanningQuestion["state"], string> = {
  open: "Open",
  answered: "Answered",
  blocked: "Blocked",
};

/** A preview card's body: the question as the index knows it, and no more. */
const PreviewBody: React.FC<{ question: PlanningQuestion }> = ({
  question,
}) => (
  <div data-planning-preview className="text-sm">
    <p className="font-medium text-slate-800 dark:text-slate-100">
      {question.marker !== "" && (
        <span aria-hidden="true">{question.marker} </span>
      )}
      {question.title}
    </p>
    <p className="mt-0.5 text-[13px] text-slate-600 dark:text-slate-400">
      {STATE_LABEL[question.state]}
      {question.leaning !== null && <> · Leaning: {question.leaning}</>}
    </p>
    <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
      Too long to show here unasked:{" "}
      {question.cardChars.toLocaleString("en-US")} characters.
    </p>
  </div>
);

export const PlanningQuestionCard: React.FC<PlanningQuestionCardProps> = ({
  question,
  card: given,
  preview = false,
  onShowQuestion,
  badge,
  comments,
  href,
  onOpenDocument,
  onFile,
  onScoped,
}) => {
  // Show question's answer, for the question it was fetched for.
  const [shown, setShown] = useState<{
    question: PlanningQuestion;
    block: CardBlock | null | "loading";
  } | null>(null);
  const full = shown?.question === question ? shown.block : null;
  const previewing = preview && (full === null || full === "loading");
  const card = preview ? (previewing ? undefined : (full as CardBlock)) : given;
  const [showFailed, setShowFailed] = useState(false);
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
      },
      () => {
        setShown(null);
        setShowFailed(true);
      },
    );
  }, [onShowQuestion, question]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CardState>(EMPTY_STATE);
  const [answering, setAnswering] = useState<{
    rect: DOMRect;
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markdown = card?.markdown ?? null;

  // After the embedded viewer has rendered and its own passes have run — a
  // child's effects run before its parent's. Layout, so the question's
  // siblings are never painted.
  useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!root || markdown === null) return;
    sweep(root);
    const host = hostIn(root, question);
    if (host === undefined) {
      setState((prev) => (sameState(prev, EMPTY_STATE) ? prev : EMPTY_STATE));
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
    const next: CardState = {
      found: built !== null,
      scoped,
      takenId: taken?.id ?? null,
    };
    setState((prev) => (sameState(prev, next) ? prev : next));
  }, [markdown, question, comments]);

  // Reported from an effect of its own, so the page hears only real changes.
  const scopedKey = state.scoped.join("\n");
  const onScopedRef = useRef(onScoped);
  useLayoutEffect(() => {
    onScopedRef.current = onScoped;
  });
  useLayoutEffect(() => {
    onScopedRef.current?.(scopedKey === "" ? [] : scopedKey.split("\n"));
  }, [scopedKey]);
  useLayoutEffect(() => () => onScopedRef.current?.([]), []);

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

  return (
    <article
      {...{ [CARD_ATTR]: `${question.path}#${question.line}` }}
      aria-label={question.title}
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

      <div ref={bodyRef} className="planning-card-body">
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

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {previewing && onShowQuestion !== undefined && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            disabled={full === "loading"}
            onClick={showQuestion}
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
      </div>

      {listed.length > 0 && (
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
};
