/**
 * One question on the planning page (`docs/reference/planning-index.md` §6.6).
 *
 * The question is rendered by the viewer's own pipeline: an embedded
 * `MarkdownViewer` over its card block, the root-level block that holds it as
 * the scan cut it (`docs/reference/planning-index.md` §10.4), at the
 * document's own source lines. That block usually holds the question's
 * siblings too — an Open Questions list is one block — so once it renders,
 * everything outside the question's own unit (its `<li>`, or its host block
 * outside a list) is hidden, and every list item on the way keeps the number
 * it has in the document, which a card shows when it has no headline.
 *
 * The card then lays the unit out to be read (`planningCardParts.ts`): the
 * question's bold title becomes the card's headline, its leaning a block of
 * its own, an empty `Answer:` placeholder is not shown, and the rest of the
 * question is cut to `CARD_CLAMP_LINES` lines. All of it is decided in the
 * same layout pass that isolates the unit, before the card paints, so nothing
 * the card paints moves later (§12).
 *
 * **The fold.** A question that hides something while folded — its first
 * block runs past its lines, or later blocks are folded away — fades at the
 * cut, the last line shown, and offers Show full question directly under it,
 * in an element the card keeps at the cut inside the rendered question
 * (`cutSlot`); unfolded, it offers Show less after the question instead. A
 * question that fits shows neither. Whether it hides anything is measured
 * before the card paints, as the fold it opens with is chosen: the page's
 * Expand all / Collapse all preference (`unfoldedByDefault`), unless the
 * reader set this card's own fold earlier in the visit (`folds`). Folding and
 * unfolding are the reader's own action, so they may move what is below the
 * card, and they keep the card's top where it was on screen — unless folding
 * would leave all of the card above the pane, when its top comes into view.
 * The focus a control had goes to what its press revealed: unfolding, the
 * question itself, where reading goes on into what was hidden; folding, Show
 * full question at the cut. A link the folded card cuts off that the reader
 * tabs to unfolds the card, so the focus is never on text it hides.
 *
 * Answering files a comment that is indistinguishable from one filed with the
 * in-page button: the anchor is built from the card's own rendered host with
 * `buildWholeBlockAnchor`, and a take's text is `leaningComment` over the
 * stamped element — the two calls the in-page pass makes, over the same
 * rendered block. Nothing comes from the index's `leaning`, which only says
 * whether there is one.
 *
 * Its controls follow its state (Plan Q5): an open question offers Take this
 * leaning, Answer… and Open document; an answered one (✅) Answer… and Open
 * document; a blocked one, which only Blocked lists, Open document alone.
 * Whichever name declared it: the state is the marker's. Take this leaning
 * files the directive's leaning, or the in-page row's default text when the
 * question states none, exactly as the row does.
 *
 * **A comment on the question is its answer.** What the question offers next
 * is the in-page row's own rule (`questionOffer`), over the comments the row
 * reads as on it (`commentsOnQuestions`), so the card and the row never offer
 * different controls for one question: while its take is pending for the
 * agent, *Leaning taken* and Undo (while the take is the whole thread); while
 * any other comment on it is, *Answered — waiting on the agent* alone; once a
 * take is no longer pending, a chip saying what became of it, with Answer…
 * and, while it is the whole thread, Undo.
 *
 * Open document opens the document in a new tab, as its icon says, so the
 * planning page stays where it is in its own and saves nothing on the way
 * out. The document's name above the question is the way to open it in this
 * tab: it calls `onOpenHere` first, so the page saves its place for Back.
 *
 * Every card keeps a fixed-width *N comments* count in its control row
 * (`docs/reference/planning-index.md` §12.2), which toggles the list of
 * comments on the question. Comments in hand when the page painted are listed
 * at once; comments that came later go only into the count until the reader
 * opens it, so their arrival moves nothing. A Mermaid diagram that was not
 * drawn when the card painted draws into a fixed frame, scaled to fit.
 *
 * A question whose block is too large to render unasked is a **preview card**
 * (`docs/reference/planning-index.md` §6.6): its file name and badge,
 * the question's marker, title, state and leaning, and Show question and Open
 * document. Take this leaning and Answer… need the rendered host block for
 * their anchor, so they appear once Show question has rendered the whole card
 * in place — the reader's own action, so the page may grow. Show question goes
 * with it, so the focus it had goes to the card.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";
import type {
  CardBlock,
  PlanningBadge,
  PlanningQuestion,
} from "vantage-md/planning";
import { ExternalLink, MessageSquarePlus } from "lucide-react";
import { MarkdownViewer } from "./MarkdownViewer";
import { PlanningBadgeChip } from "./PlanningBadge";
import { ReviewCommentPopover } from "./ReviewCommentPopover";
import type { CommentBox, ReviewTarget } from "../lib/commentAutosave";
import { newCommentBox, type OnSaved } from "../lib/reviewBoxes";
import { AppLink } from "./AppLink";
import {
  OQ_ANSWERED_HINT,
  OQ_ANSWERED_LABEL,
  OQ_ANSWERED_TITLE,
  OQ_ANSWER_LABEL,
  OQ_LABEL,
  OQ_TAKEN_DISMISSED_HINT,
  OQ_TAKEN_DISMISSED_LABEL,
  OQ_TAKEN_LABEL,
  OQ_TAKEN_REPLIED_LABEL,
  OQ_UNDO_LABEL,
  commentsOnQuestions,
  documentQuestions,
  leaningComment,
  questionOffer,
  questionUnitBlocks,
  takeUndoable,
  type DocumentQuestion,
  type QuestionOffer,
} from "../hooks/useOpenQuestionButtons";
import { buildWholeBlockAnchor, indexBlocks } from "../lib/reviewAnchor";
import { isStaticMode } from "../lib/staticMode";
import {
  CARD_CLAMP_LINES,
  CARD_OVERFLOW_ATTR,
  cutSlot,
  cutState,
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
  reviewTarget,
} from "../stores/useReviewStore";
import type { CommentAnchor, ReviewComment } from "../types";
import type { Mark } from "../lib/planningLayout";
import { ItemMarks, NewReplyBar } from "./PlanningNeedsYou";

/** No marks: one object, so a card's props stay equal render to render. */
const NO_MARKS: readonly Mark[] = Object.freeze([]);

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
 * The folds the reader set on this visit's cards, by card key, so a card that
 * mounts again — its page flipped away and back — opens as it was left. The
 * page replaces it on each Expand all and Collapse all, which is what tells
 * every card on screen to drop its own fold for the page's.
 */
export type CardFolds = Map<string, boolean>;

/**
 * Which of a document's comments are on one question, as its card read them
 * from the rendered question, and what it read them from: the question and
 * the document's comments, as the card was given them. The report stands for
 * the rest of the visit, after the card has left the page too, and is true
 * while both are still the page's (`docs/reference/planning-index.md`
 * §6.7).
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
  /** The block is past the size a card renders unasked (§6.6). */
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
  /**
   * Called before the document's name opens the document in this tab, so the
   * page can save its place for Back. Open document, which opens a new tab,
   * never calls it.
   */
  onOpenHere?: () => void;
  /** File a comment on `path`, as a take does; rejects when it could not be saved. */
  onFile: (path: string, comment: ReviewComment) => Promise<void>;
  /**
   * Told of the answer to every save of the box **Answer…** opens, which
   * saves as the reader types to the document and repository it was opened
   * on (`lib/reviewBoxes.ts`), wherever the page is by then: the page adopts
   * the review the server answered with when it is the page's own.
   */
  onBoxSaved?: OnSaved;
  /**
   * The box **Answer…** opened closed holding text: what this card answered
   * with is filed, or on its way. Called once per box, after the card has
   * drawn what the box's saves did to it.
   */
  onAnswerClosed?: (path: string, commentId: string) => void;
  /**
   * Delete the comment `id` from `path`'s review: Undo on a take this card's
   * question still holds. Rejects when it could not be deleted. Without it
   * the card offers no Undo.
   */
  onUndo?: (path: string, id: string) => Promise<void>;
  /** The card's key on its page, which `onScoped` reports it by. */
  cardKey?: string;
  /**
   * The comments on this question, by the card's key, read from the rendered
   * question, each time the question or its document's comments change;
   * `null` while the card has no rendered question to read them from (a
   * preview, a block without its host, a document gone from the index), so
   * the page places them by line instead (§6.7). A card that leaves the page
   * says nothing: what it reported last is still true of what it read. One
   * callback for every card, so a card's props stay equal from one render of
   * its page to the next.
   */
  onScoped?: (key: string, report: ScopedReport | null) => void;
  /**
   * The comments its list shows until the reader opens or toggles it: the
   * document's comments as the layout painted them, so a reply arriving
   * later changes no card's height (`docs/design/planning-to-do-list.md`
   * P2). Its count, its chip and the page's scoping read `comments`, live.
   * Without it, the list shows `comments`.
   */
  listComments?: readonly ReviewComment[];
  /** Late data's marks on it, as text in its top line (§4.2). */
  marks?: readonly Mark[];
  /** The agent replied since it painted: the New reply mark (§4.2). */
  newReply?: boolean;
  /** New reply pressed: the list opens on the reply, and the page is told. */
  onNewReply?: (key: string) => void;
  /**
   * A comment filed from this card landed, its box closed holding text or a
   * leaning taken: the page shrinks the card to a row (§4.1).
   */
  onAnswered?: (key: string) => void;
  /**
   * Whether a card opens unfolded: the page's remembered Expand all /
   * Collapse all. Read as the card mounts, and again only when `folds` is
   * replaced, so a change from another tab opens later cards its way and
   * moves none on screen.
   */
  unfoldedByDefault?: boolean;
  /** This visit's per-card folds; replaced to bring every card to the page's. */
  folds?: CardFolds;
}

/** Where a fold left the card's top on screen, and what it was asked from. */
interface FoldAnchor {
  /** The card's top in the viewport, before the fold. */
  top: number;
  /** What scrolls the card: the app shell's pane. */
  pane: HTMLElement | null;
  /** The control that was pressed had the focus. */
  focused: boolean;
}

/** Room left above a card that folding brings back into view. */
const FOLD_TOP_MARGIN_PX = 16;

/**
 * Put the card's top back where the fold found it: the browser's own scroll
 * anchoring would keep the first block on screen instead, which, from a cut
 * near the top of the viewport, is a block below the card's top. Folding a
 * card read far down, which would leave the card — Show full question and all
 * — above the pane, brings its top into view instead.
 */
function keepCardTop(
  article: HTMLElement | null,
  before: FoldAnchor,
  unfolded: boolean,
): void {
  const pane = before.pane;
  if (pane === null) return;
  if (article !== null) {
    const top = article.getBoundingClientRect().top;
    let by = top - before.top;
    if (!unfolded) {
      const paneTop = pane.getBoundingClientRect().top;
      const control = article.querySelector("[data-planning-card-fold]");
      const controlTop =
        control === null ? null : control.getBoundingClientRect().top - by;
      if (controlTop !== null && controlTop < paneTop) {
        by = top - (paneTop + FOLD_TOP_MARGIN_PX);
      }
    }
    if (by !== 0) pane.scrollTop += by;
  }
  // The browser anchors again once the fold has painted.
  const resume = () => {
    pane.style.removeProperty("overflow-anchor");
  };
  if (typeof requestAnimationFrame !== "function") resume();
  else requestAnimationFrame(() => requestAnimationFrame(resume));
}

/** Whether any of `el` is inside the pane's visible rows. */
function inPane(el: Element, pane: HTMLElement): boolean {
  const box = el.getBoundingClientRect();
  const view = pane.getBoundingClientRect();
  return box.bottom > view.top && box.top < view.bottom;
}

/**
 * Give the focus the pressed control had to what the fold revealed. Unfolded,
 * that is the question, `body`: the control at the cut went with the cut, and
 * Show less at the end of the question would put reading on past the text it
 * just showed — and, with the card's top kept, often below the pane. It takes
 * the focus for as long as it holds it, and no longer, so a click in it does
 * not. Folded, it is Show full question, at the cut. Either one is kept in
 * the pane: brought into it, the nearest way, if the fold left all of it out.
 */
function focusAfterFold(
  article: HTMLElement | null,
  body: HTMLElement | null,
  unfolded: boolean,
  pane: HTMLElement | null,
): void {
  let target: HTMLElement | null | undefined;
  if (unfolded && body !== null) {
    target = body;
    body.setAttribute("tabindex", "-1");
    body.addEventListener("blur", () => body.removeAttribute("tabindex"), {
      once: true,
    });
  } else {
    target = article?.querySelector<HTMLElement>("[data-planning-card-fold]");
  }
  if (target == null) return;
  target.focus({ preventScroll: true });
  if (pane !== null && !inPane(target, pane)) {
    target.scrollIntoView?.({ block: "nearest" });
  }
}

/**
 * The fold's control, at the cut while folded and after the question while
 * not. Every card's has the same name, so it is described by its card's
 * headline, which a list of the page's buttons tells them apart by.
 */
const FoldButton: React.FC<{
  unfolded: boolean;
  controls: string;
  describedBy: string | undefined;
  onToggle: (e: React.MouseEvent<HTMLButtonElement>) => void;
}> = ({ unfolded, controls, describedBy, onToggle }) => (
  <button
    type="button"
    aria-expanded={unfolded}
    aria-controls={controls}
    aria-describedby={describedBy}
    data-planning-card-fold
    onClick={onToggle}
    className="inline-flex items-center gap-0.5 rounded text-[13px] leading-5 font-medium text-blue-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:text-blue-400"
  >
    {unfolded ? "Show less" : "Show full question"}
    {unfolded ? (
      <ChevronUp size={14} aria-hidden="true" />
    ) : (
      <ChevronDown size={14} aria-hidden="true" />
    )}
  </button>
);

const lineOf = (el: Element): number =>
  Number.parseInt(el.getAttribute("data-source-line") ?? "", 10);

/**
 * The question's host among `questions`, every question in the card's block:
 * the block the in-page button anchors on.
 */
function hostIn(
  questions: readonly DocumentQuestion[],
  question: PlanningQuestion,
): DocumentQuestion | undefined {
  return questions.find(({ block }) => lineOf(block) === question.line);
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
 * Show only the question's unit: mark each of its blocks and every element
 * between them and `root`, and let the stylesheet hide every child of a
 * marked element that is neither. A rule rather than a hidden attribute on
 * each sibling, so a node another pass adds later (a link badge) is hidden or
 * shown by where it is, not by when. A unit of several blocks — a question
 * outside a list, with its context, leaning and Answer after its title — marks
 * each one `block`, which the stylesheet spaces as the blocks of one unit.
 *
 * A hidden list item does not advance its list's counter, so the third item
 * would read `1.` alone. Each list item on the way gets its number in the
 * document as an explicit `value` first.
 */
function isolate(root: HTMLElement, blocks: readonly HTMLElement[]): void {
  const unit = blocks[0];
  if (unit === undefined) return;
  for (const block of blocks) {
    block.setAttribute(CARD_UNIT_ATTR, blocks.length > 1 ? "block" : "");
  }
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

interface CardState {
  /** Whether the question's host is in the card: without it, nothing files. */
  found: boolean;
  /** The ids of the comments on this question, in the document's order. */
  scoped: readonly string[];
  /**
   * What the question offers (`questionOffer`), from the comments on it, or
   * `null` while it has no host to anchor on.
   */
  offer: QuestionOffer | null;
  /**
   * What it offered by the comments the layout painted (`listComments`),
   * which it goes on showing until the reader acts on the card: a late
   * comment or reply changes no control under them
   * (`docs/design/planning-to-do-list.md` P2), it marks the card instead.
   */
  paintedOffer: QuestionOffer | null;
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
  offer: null,
  paintedOffer: null,
  laidOut: false,
  titled: false,
  leaning: false,
  more: false,
};

const sameState = (a: CardState, b: CardState): boolean =>
  a.found === b.found &&
  sameOffer(a.offer, b.offer) &&
  sameOffer(a.paintedOffer, b.paintedOffer) &&
  a.laidOut === b.laidOut &&
  a.titled === b.titled &&
  a.leaning === b.leaning &&
  a.more === b.more &&
  a.scoped.length === b.scoped.length &&
  a.scoped.every((id, i) => b.scoped[i] === id);

const sameOffer = (a: QuestionOffer | null, b: QuestionOffer | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.kind === b.kind &&
    ("comment" in a ? a.comment : null) ===
      ("comment" in b ? b.comment : null) &&
    ("replied" in a ? a.replied : null) ===
      ("replied" in b ? b.replied : null));

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
const Headline: React.FC<{ question: PlanningQuestion; id: string }> = ({
  question,
  id,
}) => {
  const marker = headlineMarker(question.marker);
  return (
    <h3
      id={id}
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
 * document's comments change (§6.6), so a review answer for one document
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
  onOpenHere,
  onFile,
  onBoxSaved,
  onAnswerClosed,
  onUndo,
  cardKey = "",
  onScoped,
  unfoldedByDefault = false,
  folds,
  listComments,
  marks = NO_MARKS,
  newReply = false,
  onNewReply,
  onAnswered,
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
  // The fold it opens with: the reader's own from earlier in the visit, else
  // the page's. Replaced `folds` is an Expand all or a Collapse all, which
  // every card takes, in the render that brings it, before anything paints.
  const foldFor = () => folds?.get(cardKey) ?? unfoldedByDefault;
  const [fold, setFold] = useState(() => ({ folds, unfolded: foldFor() }));
  let unfolded = fold.unfolded;
  if (fold.folds !== folds) {
    unfolded = foldFor();
    setFold({ folds, unfolded });
  }
  const showQuestion = useCallback(() => {
    if (onShowQuestion === undefined) return;
    setShowFailed(false);
    setShown({ question, block: "loading" });
    void onShowQuestion(question).then(
      (block) => {
        setShown((prev) =>
          prev?.question === question ? { question, block } : prev,
        );
        // Asked for whole, so it arrives unfolded.
        if (block === null) setShowFailed(true);
        else setFold((prev) => ({ ...prev, unfolded: true }));
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
  /** Blocks after it are folded away (`CardParts.more`). */
  const moreRef = useRef(false);
  const [overflowing, setOverflowing] = useState(false);
  /** The element at the cut, which Show full question is rendered into. */
  const [cut] = useState(cutSlot);
  /** A fold the reader just asked for, which the next layout settles. */
  const foldAnchorRef = useRef<FoldAnchor | null>(null);
  /** What the reader tabbed to past the cut, which unfolded the card. */
  const revealRef = useRef<HTMLElement | null>(null);
  const [answering, setAnswering] = useState<{
    rect: DOMRect;
    text: string;
    anchor: CommentAnchor;
    target: ReviewTarget;
  } | null>(null);
  /**
   * What the card showed when **Answer…** opened its box, which it goes on
   * showing until the box closes: the box saves as the reader types, and its
   * own saves must not change the card under them
   * (`docs/design/planning-to-do-list.md` §6.3). The page still hears of every
   * save (`onScoped`), so the numbers it shows stay live.
   */
  const [held, setHeld] = useState<{
    offer: QuestionOffer | null;
    listed: readonly ReviewComment[];
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
    moreRef.current = false;
    // Out of the question before anything reads it.
    cut.remove();
    if (!root || markdown === null) {
      setState((prev) => (sameState(prev, EMPTY_STATE) ? prev : EMPTY_STATE));
      onScoped?.(cardKey, null);
      return;
    }
    sweep(root);
    const questions = documentQuestions(root);
    const host = hostIn(questions, question);
    if (host === undefined) {
      setState((prev) => (sameState(prev, EMPTY_STATE) ? prev : EMPTY_STATE));
      onScoped?.(cardKey, null);
      return;
    }
    const unit = questionUnitBlocks(host.stamped, root, questions);

    // Before the siblings are hidden, so every block hashes as it does in its
    // document, where nothing is. Every question in the block, so a comment
    // on a question nested in this one's item is that question's.
    const index = indexBlocks(root);
    const onIt =
      commentsOnQuestions(root, questions, comments ?? [], index).get(host) ??
      [];
    const scoped = onIt.map((c) => c.id);
    const paintedOnIt =
      listComments === undefined || listComments === comments
        ? onIt
        : (commentsOnQuestions(root, questions, listComments, index).get(
            host,
          ) ?? []);

    isolate(root, unit);

    const built = buildWholeBlockAnchor(host.block);
    // Last, once everything above has read the unit as its document has it.
    const parts = markCardParts(
      root,
      unit,
      host.block,
      question.title,
      question.marker,
    );
    clampRef.current = parts.clamp;
    moreRef.current = parts.more;
    // The cut is the end of the block cut short. A rule of the stylesheet
    // keeps it shown where the card hides its unit's siblings.
    parts.clamp?.after(cut);
    const next: CardState = {
      found: built !== null,
      scoped,
      offer:
        built === null
          ? null
          : questionOffer(built.anchor, leaningComment(host.stamped), onIt),
      paintedOffer:
        built === null
          ? null
          : questionOffer(
              built.anchor,
              leaningComment(host.stamped),
              paintedOnIt,
            ),
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
  }, [markdown, question, comments, listComments, cardKey, onScoped, cut]);

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

  // Whether the cut-short block runs past its lines, which with the blocks
  // folded after it decides whether the card fades at the cut and offers Show
  // full question there: measured before the card paints, and again whenever
  // the block's size changes, which a reader's resize does.
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
    const read = () => {
      if (!live || !el.isConnected) return false;
      // Folded again, the block takes back the scroll it had as the clamp,
      // with no scroll event to say so (`unscroll`, below).
      if (!unfolded && el.scrollTop !== 0) el.scrollTop = 0;
      return overflowsClamp(el, !unfolded);
    };
    const write = (over: boolean) => {
      if (!live) return;
      const { fade } = cutState(
        { more: moreRef.current, overflows: over },
        unfolded,
      );
      el.toggleAttribute(CARD_OVERFLOW_ATTR, fade);
      setOverflowing(over);
    };
    measureClampSoon({ read, write });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => write(read()));
    observer?.observe(el);
    // The clamp clips what it cuts off, and nothing scrolls it there — not
    // the focus, not a search — so a folded card always opens on the start
    // of its question.
    const unscroll = () => {
      if (el.scrollTop !== 0) el.scrollTop = 0;
    };
    el.addEventListener("scroll", unscroll);
    return () => {
      live = false;
      observer?.disconnect();
      el.removeEventListener("scroll", unscroll);
    };
    // The layout pass's own inputs, since each run of it marks the block anew.
  }, [markdown, question, comments, cardKey, onScoped, unfolded]);

  // A fold the reader asked for, once it is laid out: the card's top back
  // where it was, and the focus the pressed control had on what the fold
  // revealed (`focusAfterFold`). Or, unfolded by a link tabbed to past the
  // cut, that link, whole, in view.
  useLayoutEffect(() => {
    const revealed = revealRef.current;
    revealRef.current = null;
    if (revealed !== null && unfolded && document.activeElement === revealed) {
      revealed.scrollIntoView?.({ block: "nearest" });
    }
    const anchor = foldAnchorRef.current;
    if (anchor === null) return;
    foldAnchorRef.current = null;
    const article = articleRef.current;
    keepCardTop(article, anchor, unfolded);
    if (anchor.focused) {
      focusAfterFold(article, bodyRef.current, unfolded, anchor.pane);
    }
  }, [unfolded]);

  // The focus on something the folded card cuts off — a link in its first
  // block, below its last line — unfolds it: the reader tabbed to text they
  // cannot see. Unfolding moves only what is below the card, and the focus
  // was their own. Where it lies is read as the block lays it out: the
  // browser may already have scrolled the clamp to it, which unfolding undoes.
  const revealFocused = (e: React.FocusEvent<HTMLDivElement>) => {
    const clamp = clampRef.current;
    const target = e.target;
    if (unfolded || clamp === null || target === clamp) return;
    if (!clamp.contains(target)) return;
    const cut = clamp.getBoundingClientRect().bottom;
    const bottom = target.getBoundingClientRect().bottom + clamp.scrollTop;
    if (bottom <= cut + 1) return;
    revealRef.current = target;
    folds?.set(cardKey, true);
    setFold({ folds, unfolded: true });
  };

  const toggleFold = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next = !unfolded;
    const article = articleRef.current;
    const pane = article?.closest<HTMLElement>("[data-content-scroll]") ?? null;
    foldAnchorRef.current = {
      top: article?.getBoundingClientRect().top ?? 0,
      pane,
      focused: document.activeElement === e.currentTarget,
    };
    // Until the fold has painted: `keepCardTop` places the card.
    pane?.style.setProperty("overflow-anchor", "none");
    folds?.set(cardKey, next);
    setFold({ folds, unfolded: next });
  };

  /** The anchor and fallback text the in-page button would send, from the card. */
  const anchorNow = useCallback(() => {
    const root = bodyRef.current;
    if (!root) return null;
    const host = hostIn(documentQuestions(root), question);
    if (host === undefined) return null;
    const built = buildWholeBlockAnchor(host.block);
    return built === null ? null : { host, ...built };
  }, [question]);

  const file = useCallback(
    async (text: (host: DocumentQuestion) => string) => {
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
        onAnswered?.(cardKey);
      } catch (e) {
        setError(commandErrorMessage(e, "Could not save the comment"));
      } finally {
        setBusy(false);
      }
    },
    [anchorNow, onFile, question.path, onAnswered, cardKey],
  );

  const writable = !isStaticMode() && state.found;
  // What the question offers is the in-page row's rule (`questionOffer`): an
  // open question, whichever name declared it, as the row offers the take
  // (`offersTake`), and Answer… on an open or an answered one; once a comment
  // answers it, the chip instead (`docs/reference/planning-index.md` §6.7).
  const answerable =
    writable && (question.state === "open" || question.state === "answered");
  // Until the reader acts on the card, the controls the layout painted.
  const painted = open === null && listComments !== undefined;
  const offer = answerable
    ? held
      ? held.offer
      : painted
        ? state.paintedOffer
        : state.offer
    : null;
  const canTake = offer?.kind === "take" && question.state === "open";
  const canAnswer =
    answerable && offer?.kind !== "taken" && offer?.kind !== "answered";
  const take =
    offer?.kind === "taken" || offer?.kind === "retake" ? offer : null;
  const canUndo =
    take !== null && onUndo !== undefined && takeUndoable(take.comment);
  const undo = useCallback(async () => {
    if (take === null || onUndo === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await onUndo(question.path, take.comment.id);
    } catch (e) {
      setError(commandErrorMessage(e, "Could not undo the take"));
    } finally {
      setBusy(false);
    }
  }, [take, onUndo, question.path]);

  // The count is the comments in hand. The list is what the box held while
  // it is open, and otherwise, until the reader opens or toggles it, the
  // comments the layout painted (planning-to-do-list.md P2).
  const liveListed = (comments ?? []).filter((c) =>
    state.scoped.includes(c.id),
  );
  const counted = held ? held.listed : liveListed;
  const listed = held
    ? held.listed
    : open === null && listComments !== undefined
      ? listComments.filter((c) => state.scoped.includes(c.id))
      : liveListed;

  // The box **Answer…** opens, made once when it opens: its first save files
  // the comment as the take does, its later ones edit it, and closing it empty
  // deletes what it filed. Saves go on after the card has gone, until they land.
  const boxRef = useRef<CommentBox | null>(null);
  const makeAnswerBox = (
    target: ReviewTarget,
    anchor: CommentAnchor,
    fallbackText: string,
  ) => {
    const box = newCommentBox(
      target,
      newReviewComment(anchor, "", fallbackText),
      { label: `Answer to ${question.title}`, onSaved: onBoxSaved },
    );
    boxRef.current = box;
    return box;
  };
  const closeAnswer = (box: CommentBox) => {
    if (boxRef.current !== box) return;
    boxRef.current = null;
    setAnswering(null);
    setHeld(null);
    // As after a take: the list opens on what was filed, and the page
    // shrinks the card to an answered row (planning-to-do-list.md §4.1).
    if (box.typed !== "") {
      setOpen(true);
      onAnswerClosed?.(question.path, box.subject.commentId);
      onAnswered?.(cardKey);
    }
  };
  // A box closed from outside the popover, as Refresh closes every open box
  // first (§4.3): the card stops drawing it, as its own Close does.
  const closeAnswerRef = useRef(closeAnswer);
  useLayoutEffect(() => {
    closeAnswerRef.current = closeAnswer;
  });
  const answeringOpen = answering !== null;
  useEffect(() => {
    const box = boxRef.current;
    if (!answeringOpen || box === null) return;
    return box.subscribe(() => {
      if (!box.getState().open) closeAnswerRef.current(box);
    });
  }, [answeringOpen]);
  const listOpen = open ?? !commentsLate;
  const pressNewReply = () => {
    setOpen(true);
    onNewReply?.(cardKey);
  };

  const id = planningCardId(question.path, question.id, question.unitLine);
  const bodyId = `${id}-body`;
  const headlineId = `${id}-title`;
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
  const { control } = state.laidOut
    ? cutState({ more: state.more, overflows: overflowing }, unfolded)
    : { control: null };

  return (
    <article
      ref={articleRef}
      id={id}
      {...{ [CARD_ATTR]: `${question.path}#${question.line}` }}
      aria-label={question.title}
      // Where Show question's focus goes once the card is shown.
      tabIndex={preview ? -1 : undefined}
      data-planning-item={id}
      className="relative rounded-xl border border-slate-200 bg-white px-5 pt-3 pb-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
    >
      {newReply && <NewReplyBar />}
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500 dark:text-slate-400">
        {/* This tab, which the page saves its place in first. */}
        <AppLink
          to={href}
          onBeforeNavigate={() => {
            onOpenHere?.();
          }}
          className="font-medium text-blue-600 no-underline hover:underline dark:text-blue-400"
        >
          {question.path}
        </AppLink>
        {badge !== null && <PlanningBadgeChip badge={badge} />}
        <ItemMarks
          marks={marks}
          newReply={newReply}
          onNewReply={pressNewReply}
        />
      </div>

      {headed && <Headline question={question} id={headlineId} />}

      <div
        ref={bodyRef}
        id={bodyId}
        className="planning-card-body rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500"
        onFocus={revealFocused}
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

      {/* At the cut, inside the rendered question, while folded. */}
      {createPortal(
        control === "expand" ? (
          <FoldButton
            unfolded={false}
            controls={bodyId}
            describedBy={headed ? headlineId : undefined}
            onToggle={toggleFold}
          />
        ) : null,
        cut,
      )}
      {/* After the question, while unfolded. */}
      {control === "collapse" && (
        <div data-planning-card-fold-end className="mt-1.5 flex print:hidden">
          <FoldButton
            unfolded
            controls={bodyId}
            describedBy={headed ? headlineId : undefined}
            onToggle={toggleFold}
          />
        </div>
      )}

      {/* Screen controls, which paper has no use for. */}
      <div
        data-planning-card-controls
        className="mt-2 flex flex-wrap items-center gap-2 print:hidden"
      >
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
        {offer?.kind === "answered" && (
          <span className="review-oq-answered" title={OQ_ANSWERED_HINT}>
            {OQ_ANSWERED_LABEL}
          </span>
        )}
        {take !== null && (
          <span
            className={
              take.kind === "taken"
                ? "review-oq-taken"
                : "review-oq-taken review-oq-taken--past"
            }
            title={
              !takeUndoable(take.comment)
                ? OQ_ANSWERED_TITLE
                : take.kind === "retake"
                  ? OQ_TAKEN_DISMISSED_HINT
                  : undefined
            }
          >
            {take.kind === "taken"
              ? OQ_TAKEN_LABEL
              : take.replied
                ? OQ_TAKEN_REPLIED_LABEL
                : OQ_TAKEN_DISMISSED_LABEL}
          </span>
        )}
        {canUndo && (
          <button
            type="button"
            className="review-oq-undo"
            title="Delete the review comment the take filed"
            disabled={busy}
            onClick={() => {
              if (busy) return;
              void undo();
            }}
          >
            {OQ_UNDO_LABEL}
          </button>
        )}
        {canTake && (
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
        )}
        {canAnswer && (
          <button
            type="button"
            className="review-oq-answer"
            disabled={busy}
            onClick={(e) => {
              const now = anchorNow();
              const target = reviewTarget(question.path);
              if (now === null || target === null) return;
              setHeld({ offer: state.offer, listed: liveListed });
              setAnswering({
                rect: e.currentTarget.getBoundingClientRect(),
                text: now.fallbackText,
                anchor: now.anchor,
                target,
              });
            }}
          >
            <MessageSquarePlus size={12} aria-hidden="true" />
            {OQ_ANSWER_LABEL}
          </button>
        )}
        {/* A new tab, as its icon says: the page stays where it is. */}
        <AppLink
          to={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 no-underline transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          {/* The icon says where it opens to the eye; the hidden text, to a
              screen reader. */}
          <ExternalLink size={12} aria-hidden="true" />
          Open document <span className="sr-only">(opens in a new tab)</span>
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
        {/* Always there, at a fixed width, so a count that arrives late
            moves nothing (§12.2). */}
        <span
          data-planning-comment-slot
          className="ml-auto inline-flex w-28 justify-end"
        >
          {counted.length > 0 && (
            <button
              type="button"
              aria-expanded={listOpen}
              data-planning-comment-count
              onClick={() => setOpen(!listOpen)}
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 tabular-nums transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {counted.length === 1
                ? "1 comment"
                : `${counted.length} comments`}
            </button>
          )}
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
          key={answering.anchor.block_text_hash + answering.rect.top}
          selectedText={answering.text}
          rect={answering.rect}
          makeBox={() =>
            makeAnswerBox(answering.target, answering.anchor, answering.text)
          }
          onClose={closeAnswer}
        />
      )}
    </article>
  );
});
