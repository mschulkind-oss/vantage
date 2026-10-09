/**
 * The movement rule of the planning page, as pure functions
 * (`docs/design/planning-to-do-list.md` §4): what *Needs you* lists and how,
 * what the reader changed in place since, and what late data marks and holds
 * back.
 *
 * - A **layout** (the design's term) is the page's arrangement of items:
 *   which it lists, in what order, as rows or as cards. Only the reader's own
 *   actions and opening the page make one (§4.1). `layoutNeedsYou` makes
 *   *Needs you*'s: the answered rows first, then the first page size of the
 *   questions that need you as cards, then what is left beyond them (§3.3).
 * - **In place** (a term this module coins) is what the reader did to a
 *   layout without making a new one: a card answered here shrinks to a row
 *   where it was and the next question joins the cards; a row shown, or a
 *   take undone, opens into a card where it stands; *… N more answered*
 *   shows the rest (§4.1). `InPlace` holds it.
 * - **Late data** is everything after a layout (§4.2). It never changes an
 *   item's height, position or presence: it marks the item (`marksOf`), and
 *   is counted as a **held update** (§4.3) until the reader's next layout
 *   (`heldUpdates`).
 *
 * An item is known across index versions by `itemKey`, its card's id
 * (`planningCardId`): the question's `id=` where it has one, so a line added
 * above it does not make it another item.
 */
import type { PlanningQuestion } from "vantage-md/planning";
import { isPendingForAgent } from "../stores/useReviewStore";
import type { ReviewComment } from "../types";
import { planningCardId } from "./planningCardId";
import { questionKey } from "./planningAnswers";
import {
  placeComment,
  type CardEntry,
  type MaintenanceKind,
  type PlanningLayout,
  type QuestionEntry,
} from "./planningPages";

/** An item's key on the page, the same in every index version. */
export const itemKey = (question: {
  path: string;
  id: string | null;
  unitLine: number;
}): string => planningCardId(question.path, question.id, question.unitLine);

/** *Needs you*, laid out (§3.3). */
export interface NeedsYouLayout {
  /** The questions a comment of yours answers, in the roadmap's order. */
  answered: readonly QuestionEntry[];
  /** The first page size of the questions that need you: the full cards. */
  cards: readonly QuestionEntry[];
  /** The questions that need you past the page size, in order. */
  more: readonly QuestionEntry[];
}

/**
 * Lay *Needs you* out from its open questions in the roadmap's order,
 * `answered` saying which a pending comment answers (`questionKey`s).
 */
export function layoutNeedsYou(
  entries: readonly QuestionEntry[],
  answered: ReadonlySet<string>,
  pageSize: number,
): NeedsYouLayout {
  const rows: QuestionEntry[] = [];
  const needing: QuestionEntry[] = [];
  for (const entry of entries) {
    if (answered.has(questionKey(entry.question))) rows.push(entry);
    else needing.push(entry);
  }
  return {
    answered: rows,
    cards: needing.slice(0, pageSize),
    more: needing.slice(pageSize),
  };
}

/** What the reader changed in place since the layout (§4.1). */
export interface InPlace {
  /** Cards answered here, now rows where they were. */
  shrunk: ReadonlySet<string>;
  /** Rows opened into their cards where they stand: Show, Undo, New reply. */
  opened: ReadonlySet<string>;
  /** How many of the layout's `more` joined the end of the cards. */
  joined: number;
  /** *… N more answered · Show* was pressed. */
  allAnswered: boolean;
}

export const NOTHING_IN_PLACE: InPlace = Object.freeze({
  shrunk: new Set<string>(),
  opened: new Set<string>(),
  joined: 0,
  allAnswered: false,
});

/**
 * A card answered here: it shrinks to a row where it is, and the first
 * question beyond the cards, if any, joins their end (§4.1). A card already a
 * row changes nothing.
 */
export function shrinkCard(
  inPlace: InPlace,
  layout: NeedsYouLayout,
  key: string,
): InPlace {
  const isCard =
    layout.cards.some((e) => itemKey(e.question) === key) ||
    layout.more
      .slice(0, inPlace.joined)
      .some((e) => itemKey(e.question) === key);
  if (!isCard || (inPlace.shrunk.has(key) && !inPlace.opened.has(key))) {
    return inPlace;
  }
  const opened = new Set(inPlace.opened);
  opened.delete(key);
  return {
    ...inPlace,
    shrunk: new Set(inPlace.shrunk).add(key),
    opened,
    joined: Math.min(layout.more.length, inPlace.joined + 1),
  };
}

/**
 * A row opened into its card where it stands: Show, Undo on a take, or a
 * mark's own control. The card that joined for it stays (§4.1).
 */
export function openRow(inPlace: InPlace, key: string): InPlace {
  if (inPlace.opened.has(key)) return inPlace;
  return { ...inPlace, opened: new Set(inPlace.opened).add(key) };
}

/** One item of *Needs you* as it is drawn. */
export interface NeedsYouItem {
  key: string;
  entry: QuestionEntry;
  as: "row" | "card";
  /** Where the layout put it: an answered row, a card, or one that joined. */
  from: "answered" | "card" | "joined";
}

/** *Needs you* as it is drawn: the layout, with what the reader did to it. */
export interface NeedsYouView {
  /** The answered rows at the top that are drawn. */
  top: NeedsYouItem[];
  /** Answered rows behind *… N more answered · Show*. */
  hiddenAnswered: number;
  /** The cards, and the rows answered in place where their cards were. */
  list: NeedsYouItem[];
  /** Questions that need you past the list: the end line's *M more*. */
  more: number;
  /** Rows drawn or behind *… N more answered*: the heading's *N answered*. */
  rows: number;
}

export function viewNeedsYou(
  layout: NeedsYouLayout,
  inPlace: InPlace,
  rowsShown: number,
): NeedsYouView {
  const top = layout.answered.map((entry): NeedsYouItem => {
    const key = itemKey(entry.question);
    return {
      key,
      entry,
      as: inPlace.opened.has(key) ? "card" : "row",
      from: "answered",
    };
  });
  const shown = inPlace.allAnswered ? top : top.slice(0, rowsShown);
  const list = [
    ...layout.cards.map((entry) => ({ entry, from: "card" as const })),
    ...layout.more
      .slice(0, inPlace.joined)
      .map((entry) => ({ entry, from: "joined" as const })),
  ].map(({ entry, from }): NeedsYouItem => {
    const key = itemKey(entry.question);
    return {
      key,
      entry,
      as: inPlace.shrunk.has(key) && !inPlace.opened.has(key) ? "row" : "card",
      from,
    };
  });
  const rows =
    top.filter((item) => item.as === "row").length +
    list.filter((item) => item.as === "row").length;
  return {
    top: shown,
    hiddenAnswered: top.length - shown.length,
    list,
    more: layout.more.length - inPlace.joined,
    rows,
  };
}

/**
 * Every comment of `byPath` on one of `questions`, by `questionKey`, placed by
 * its anchor's line as Copy answers places a comment with no card's report
 * (`placeComment`, the innermost unit winning).
 */
export function commentsByQuestion(
  questions: readonly PlanningQuestion[],
  byPath: Readonly<Record<string, readonly ReviewComment[]>>,
): Map<string, ReviewComment[]> {
  const byDocument = new Map<string, PlanningQuestion[]>();
  for (const question of questions) {
    const list = byDocument.get(question.path);
    if (list === undefined) byDocument.set(question.path, [question]);
    else list.push(question);
  }
  const out = new Map<string, ReviewComment[]>();
  for (const [path, listed] of byDocument) {
    for (const comment of byPath[path] ?? []) {
      const line = comment.anchor?.source_line;
      const placed = line ? placeComment(listed, line) : undefined;
      if (placed === undefined) continue;
      const key = questionKey(placed);
      const list = out.get(key);
      if (list === undefined) out.set(key, [comment]);
      else list.push(comment);
    }
  }
  return out;
}

/** How many replies the agent has made on `comments`. */
export const agentReplies = (
  comments: readonly ReviewComment[] | undefined,
): number =>
  (comments ?? []).reduce(
    (n, c) => n + (c.reactions ?? []).filter((r) => r.actor === "agent").length,
    0,
  );

/** What an answered row's chip says (§3.3): the card's own chip. */
export type RowAnswer =
  | { kind: "taken"; comment: ReviewComment }
  | { kind: "answered" }
  | { kind: "retake"; comment: ReviewComment; replied: boolean }
  | null;

/**
 * The chip of an answered row, from the comments placed on its question:
 * `take` is the text Take this leaning files for it. A row has no rendered
 * block to read the take's anchor from, so a take is the comment on it that
 * selects nothing and says `take`.
 */
export function rowAnswer(
  comments: readonly ReviewComment[] | undefined,
  take: string,
): RowAnswer {
  const on = comments ?? [];
  const taken = on.find(
    (c) => c.comment === take && (c.anchor?.selection_length ?? 0) === 0,
  );
  if (taken !== undefined && isPendingForAgent(taken)) {
    return { kind: "taken", comment: taken };
  }
  if (on.some(isPendingForAgent)) return { kind: "answered" };
  if (taken !== undefined) {
    return {
      kind: "retake",
      comment: taken,
      replied: (taken.reactions ?? []).some((r) => r.actor === "agent"),
    };
  }
  return null;
}

/** A mark late data puts on an item (§4.2). */
export type Mark = "done" | "answered-elsewhere" | "changed";

/** What a mark says, in the item's own line. */
export const MARK_LABELS: Readonly<Record<Mark, string>> = {
  done: "Done",
  "answered-elsewhere": "Answered elsewhere",
  changed: "Changed in the document",
};

/** The New reply mark's words (§4.2, *The New reply mark*). */
export const NEW_REPLY_LABEL = "New reply";

/** What the page knows of one question at the layout and now. */
export interface QuestionFacts {
  /** The question as the layout painted it. */
  painted: PlanningQuestion;
  /** The question in the index in hand, by `itemKey`, if it is still there. */
  now: PlanningQuestion | undefined;
  /** A pending comment answered it when the layout was made. */
  answeredThen: boolean;
  /** A pending comment answers it now. */
  answeredNow: boolean;
  /** The agent's replies on it as the layout painted them, or as last opened. */
  repliesSeen: number;
  /** The agent's replies on it now. */
  repliesNow: number;
  /**
   * How many questions its root-level block held at the layout and now: a
   * block is cut whole for its card, so a sibling added or removed changes
   * its length without changing this question's text.
   */
  siblingsThen?: number;
  siblingsNow?: number;
}

/** How many of `questions` share `question`'s root-level block. */
export function blockSiblings(
  questions: Iterable<PlanningQuestion>,
  question: PlanningQuestion,
): number {
  let n = 0;
  for (const other of questions) {
    if (
      other.path === question.path &&
      other.block.startLine === question.block.startLine
    ) {
      n++;
    }
  }
  return n;
}

/**
 * The parts of a question its card shows, to tell a changed one: its title,
 * leaning, marker and state, its unit's length, and its block's length while
 * the block holds the same questions. The index holds no text of a
 * question's own, so an edit inside its unit that keeps all of these is not
 * seen until the next layout renders it.
 */
const textOf = (q: PlanningQuestion, withBlock: boolean): string =>
  [
    q.title,
    q.leaning ?? "",
    q.marker,
    q.state,
    q.unitEndLine - q.unitLine,
    ...(withBlock ? [q.cardChars, q.block.endLine - q.block.startLine] : []),
  ].join("\n");

/** Whether a question is gone, ✅, or no longer one that needs a ruling. */
const isDone = (facts: QuestionFacts): boolean =>
  facts.now === undefined || facts.now.state === "answered";

/**
 * The marks on one item of *Needs you* drawn `as` a row or a card (§4.2):
 * *Done* when it became ✅ or left the index; *Answered elsewhere* on a card
 * a comment now answers that this page did not file; *Changed in the
 * document* when the text its card painted is not the document's now. And
 * whether it carries the New reply mark: the agent replied since it painted.
 */
export function marksOf(
  facts: QuestionFacts,
  as: "row" | "card",
): { marks: Mark[]; newReply: boolean } {
  const marks: Mark[] = [];
  if (isDone(facts)) marks.push("done");
  else {
    if (as === "card" && facts.answeredNow && !facts.answeredThen) {
      marks.push("answered-elsewhere");
    }
    const withBlock = facts.siblingsThen === facts.siblingsNow;
    if (
      facts.now !== undefined &&
      textOf(facts.now, withBlock) !== textOf(facts.painted, withBlock)
    ) {
      marks.push("changed");
    }
  }
  return { marks, newReply: facts.repliesNow > facts.repliesSeen };
}

/** The kinds of held update, as Refresh's title lists them (§4.3). */
export type UpdateKind =
  | "new reply"
  | "new question"
  | "answered elsewhere"
  | "done"
  | "changed"
  | "needs you again"
  | "moved"
  | "roadmap reordered"
  | "new under Blocked"
  | "gone from Blocked"
  | "new under Maintenance"
  | "gone from Maintenance";

/** Held updates, counted by kind. */
export type HeldUpdates = ReadonlyMap<UpdateKind, number>;

/** The held updates' total: the *N* of *N updates*. */
export const updatesTotal = (updates: HeldUpdates): number =>
  [...updates.values()].reduce((n, k) => n + k, 0);

const PLURALS: Partial<Record<UpdateKind, string>> = {
  "new reply": "new replies",
  "new question": "new questions",
};

/** The updates slot's title: *2 new replies, 1 new question, 1 done*. */
export function updatesTitle(updates: HeldUpdates): string {
  return [...updates]
    .filter(([, n]) => n > 0)
    .map(
      ([kind, n]) =>
        `${n.toLocaleString("en-US")} ${n === 1 ? kind : (PLURALS[kind] ?? kind)}`,
    )
    .join(", ");
}

/** The keys of a *Blocked* list or a *Maintenance* kind, for the diff. */
export function groupKeys(entries: readonly CardEntry[]): string[] {
  return entries.map((entry) =>
    entry.kind === "question" ? itemKey(entry.question) : `doc\n${entry.path}`,
  );
}

/** The keys of every *Maintenance* item, kind by kind. */
export function maintenanceKeys(kinds: readonly MaintenanceKind[]): string[] {
  return kinds.flatMap((kind) =>
    kind.kind === "questions"
      ? kind.items.map((e) => `${kind.id}\n${itemKey(e.question)}`)
      : kind.kind === "documents"
        ? kind.items.map((path) => `${kind.id}\n${path}`)
        : kind.items.map(({ path }) => `${kind.id}\n${path}`),
  );
}

/** What the held-update count compares: the page as drawn, and fresh data. */
export interface UpdatesInput {
  /** The layout on screen, and its *Needs you*. */
  layout: PlanningLayout;
  needsYou: NeedsYouLayout;
  inPlace: InPlace;
  /** *Needs you* as a new layout would make it from the data in hand. */
  fresh: NeedsYouLayout;
  /** *Needs you*'s open questions in hand, in the roadmap's order. */
  freshOrder: readonly QuestionEntry[];
  /** *Blocked* and *Maintenance* in hand. */
  freshBlocked: readonly CardEntry[];
  freshMaintenance: readonly MaintenanceKind[];
  /** Each item's facts, by `itemKey`, for every item of either. */
  facts: (key: string) => QuestionFacts | undefined;
}

type Role = "row" | "card" | null;

/**
 * The held updates (§4.3): one per item a new layout would bring in, take
 * out, change between row and card, or render again, and one for a reordered
 * roadmap, counted by kind. A row the reader opened compares as whatever the
 * data in hand makes it, since opening it was their own action.
 */
export function heldUpdates(input: UpdatesInput): HeldUpdates {
  const { layout, needsYou, inPlace, fresh, facts } = input;
  const counts = new Map<UpdateKind, number>();
  const add = (kind: UpdateKind) =>
    counts.set(kind, (counts.get(kind) ?? 0) + 1);

  const drawn = new Map<string, Role>();
  const view = viewNeedsYou(needsYou, { ...inPlace, allAnswered: true }, 0);
  for (const item of [...view.top, ...view.list]) drawn.set(item.key, item.as);
  const opened = new Set(
    [...view.top, ...view.list]
      .filter((item) => inPlace.opened.has(item.key))
      .map((item) => item.key),
  );
  const freshRoles = new Map<string, Role>();
  for (const e of fresh.answered) freshRoles.set(itemKey(e.question), "row");
  for (const e of fresh.cards) freshRoles.set(itemKey(e.question), "card");
  const known = new Set(layout.needsYou.map((e) => itemKey(e.question)));

  for (const key of new Set([...drawn.keys(), ...freshRoles.keys()])) {
    const was = drawn.get(key) ?? null;
    const will = freshRoles.get(key) ?? null;
    const f = facts(key);
    const marks = f && was !== null ? marksOf(f, was) : null;
    if (was !== will && !(opened.has(key) && will !== null)) {
      if (was === null) add(known.has(key) ? "moved" : "new question");
      else if (will === null)
        add(marks?.marks.includes("done") ? "done" : "moved");
      else if (will === "card") {
        add(marks?.newReply ? "new reply" : "needs you again");
      } else add("answered elsewhere");
    } else if (was !== null && marks !== null) {
      if (marks.newReply) add("new reply");
      else if (marks.marks.includes("changed")) add("changed");
    }
  }

  // The roadmap's order, over the questions both hold.
  const before = layout.needsYou.map((e) => itemKey(e.question));
  const after = input.freshOrder.map((e) => itemKey(e.question));
  const both = new Set(before.filter((key) => after.includes(key)));
  const a = before.filter((key) => both.has(key));
  const b = after.filter((key) => both.has(key));
  if (a.some((key, i) => b[i] !== key)) add("roadmap reordered");

  const diff = (
    was: readonly string[],
    now: readonly string[],
    came: UpdateKind,
    went: UpdateKind,
  ) => {
    const had = new Set(was);
    const has = new Set(now);
    for (const key of has) if (!had.has(key)) add(came);
    for (const key of had) if (!has.has(key)) add(went);
  };
  diff(
    groupKeys(layout.blocked),
    groupKeys(input.freshBlocked),
    "new under Blocked",
    "gone from Blocked",
  );
  diff(
    maintenanceKeys(layout.maintenance),
    maintenanceKeys(input.freshMaintenance),
    "new under Maintenance",
    "gone from Maintenance",
  );
  return counts;
}
