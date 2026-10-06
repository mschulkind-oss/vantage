/**
 * The answers waiting on the agent, on the planning page
 * (`docs/reference/planning-index.md` §6.7), and what they take off the
 * human's plate.
 *
 * **A comment on a question is its answer** (the user's ruling of
 * 2026-10-01): a comment still pending for the agent anywhere in a question's
 * unit — Take this leaning, Answer…, or any comment typed on one of its blocks
 * in its document — is the human's answer to it. It is what Copy answers
 * hands the agent, and it stops the question counting as one that needs the
 * human: the roadmap picker's *(N need you)*, the line counting questions that
 * need you on other roadmaps, and *Nothing needs you*. The question stays
 * listed in its section, its card marked answered, so the human sees what
 * they answered.
 *
 * Not the planning index's to say, which reads documents and no reviews, so
 * `vantage-check index` counts from the index alone; the page holds the
 * reviews, so the page subtracts.
 *
 * Under a planning filter (§6.7, §6.15) they follow it: Copy answers covers
 * the questions it keeps, and the need-you numbers count them. Comments are
 * still placed over every listed question, and only then narrowed to the
 * kept ones, so a comment on a question the filter hides is never credited
 * to a kept one around it.
 *
 * Pure functions of the index, the sections and the reviews, so the page and
 * its tests read them alike.
 */
import {
  questionFor,
  routeQuestions,
  type PlanningIndex,
  type PlanningQuestion,
  type PlanningSections,
  type QuestionRef,
} from "vantage-md/planning";
import { isPendingForAgent } from "../stores/useReviewStore";
import type { ReviewComment } from "../types";
import { listedQuestions, placeComment } from "./planningPages";

/** A question's key on the page: its document and its host block's line. */
export const questionKey = (ref: { path: string; line: number }): string =>
  `${ref.path}\n${ref.line}`;

/**
 * Which of a document's comments are on one question, as a card read them
 * from its rendered question (`PlanningQuestionCard`'s `ScopedReport`), and
 * what it read them from. True while both are still the page's.
 */
export interface QuestionReport {
  ids: readonly string[];
  question: PlanningQuestion;
  comments: readonly ReviewComment[] | undefined;
}

/** One document's comments pending for the agent on its listed questions. */
export interface PendingGroup {
  path: string;
  comments: ReviewComment[];
}

export interface PendingAnswers {
  /** Copy answers' groups, by path, each comment once. */
  groups: PendingGroup[];
  /** The keys (`questionKey`) of the listed questions a pending comment answers. */
  answered: ReadonlySet<string>;
  /**
   * The pending comments on listed questions that `keeps` leaves out: what
   * Copy answers' tooltip says the filter leaves out. `0` with no filter.
   */
  leftOut: number;
}

/** Whether a question is kept: by a planning filter, or by none, every one. */
export type KeepsQuestion = (question: PlanningQuestion) => boolean;

/**
 * Every comment still pending for the agent on a listed question, grouped by
 * document — built from the reviews, never from the cards, so a comment two
 * cards could both see appears once — and the questions they answer.
 *
 * Which question a comment is on is decided two ways, never both for one
 * question (§6.7): a card rendered this visit reports its exact scoping, from
 * its rendered block (`reports`, by `questionKey`), which holds while the
 * question and its document's comments are the ones it read; every other
 * question takes the comments its unit holds by line (`placeComment`, the
 * innermost unit winning).
 *
 * `keeps` narrows the result to the questions a planning filter keeps, once
 * every comment is placed over all of `questions` (§6.7): a comment on a
 * hidden ✅ question nested in a kept open one is that hidden question's, and
 * is left out, never the kept one's.
 */
export function pendingAnswers(
  questions: readonly PlanningQuestion[],
  byPath: Readonly<Record<string, readonly ReviewComment[]>>,
  reports: Readonly<Record<string, QuestionReport>>,
  keeps?: KeepsQuestion,
): PendingAnswers {
  const byDocument = new Map<string, PlanningQuestion[]>();
  for (const question of questions) {
    const list = byDocument.get(question.path);
    if (list === undefined) byDocument.set(question.path, [question]);
    else list.push(question);
  }
  const groups: PendingGroup[] = [];
  const answered = new Set<string>();
  /** Each listed question's key, kept or not. */
  const kept = new Map<string, boolean>();
  for (const question of questions) {
    kept.set(questionKey(question), keeps?.(question) ?? true);
  }
  let leftOut = 0;
  for (const path of [...byDocument.keys()].sort()) {
    const listed = byDocument.get(path) ?? [];
    const comments = byPath[path];
    if (comments === undefined) continue;
    /** The questions whose own report decides for them. */
    const reported = new Set<string>();
    /** A reported comment's question. */
    const owner = new Map<string, string>();
    for (const question of listed) {
      const key = questionKey(question);
      const report = reports[key];
      // A report read from another version of the question, or before its
      // document's comments last changed, says nothing of them now.
      if (
        report === undefined ||
        report.question !== question ||
        report.comments !== comments
      ) {
        continue;
      }
      reported.add(key);
      for (const id of report.ids) if (!owner.has(id)) owner.set(id, key);
    }
    const pending: ReviewComment[] = [];
    for (const comment of comments) {
      if (!isPendingForAgent(comment)) continue;
      let key = owner.get(comment.id);
      if (key === undefined) {
        const line = comment.anchor?.source_line;
        const placed = line ? placeComment(listed, line) : undefined;
        if (placed !== undefined && !reported.has(questionKey(placed))) {
          key = questionKey(placed);
        }
      }
      if (key === undefined) continue;
      if (kept.get(key) === false) {
        leftOut++;
        continue;
      }
      pending.push(comment);
      answered.add(key);
    }
    if (pending.length > 0) groups.push({ path, comments: pending });
  }
  return { groups, answered, leftOut };
}

/** What the page says needs the human, less what they have answered. */
export interface NeedYou {
  /**
   * Each roadmap that routes, by path: its routed questions that are open or
   * answered (✅), as the index counts them (`needsYouCount`), less those a
   * pending comment answers.
   */
  roadmaps: ReadonlyMap<string, number>;
  /** The questions that need you only on other roadmaps, less those answered. */
  others: number;
  /**
   * No open question outside the `done` role is left unanswered: the index's
   * *Nothing needs you*, or every open question answered by a comment.
   */
  nothing: boolean;
}

/** A routed question that needs a ruling, or an answer compacted (§6.2). */
const needs = (question: PlanningQuestion | undefined): boolean =>
  question?.state === "open" || question?.state === "answered";

/**
 * The page's need-you numbers for `sections`, with every question `answered`
 * holds (by `questionKey`) taken off. With nothing answered they are the
 * index's own, and nothing is routed again.
 *
 * Under a planning filter, `sections` are the filtered ones, whose counts
 * are already over kept questions alone, and `keeps` is the filter's: the
 * recount routes each roadmap again from the index, so it applies the same
 * predicate (§6.15).
 */
export function needYou(
  index: PlanningIndex,
  sections: PlanningSections,
  answered: ReadonlySet<string>,
  keeps?: KeepsQuestion,
): NeedYou {
  const routing = sections.roadmaps.filter((r) => r.state === "routes");
  if (answered.size === 0) {
    return {
      roadmaps: new Map(routing.map((r) => [r.path, r.needsYouCount])),
      others: sections.onOtherRoadmaps.length,
      nothing: sections.nothingNeedsYou,
    };
  }
  const isAnswered = (ref: QuestionRef) => answered.has(questionKey(ref));
  const roadmaps = new Map<string, number>();
  for (const roadmap of routing) {
    roadmaps.set(
      roadmap.path,
      routeQuestions(index, roadmap.path).filter((ref) => {
        const question = questionFor(index, ref);
        return (
          question !== undefined &&
          needs(question) &&
          !isAnswered(ref) &&
          (keeps?.(question) ?? true)
        );
      }).length,
    );
  }
  // Every open question outside the `done` role is listed: routed by the
  // chosen roadmap, by another, or by none (§6.2).
  const open = listedQuestions(index, sections).filter(
    (q) => q.state === "open",
  );
  return {
    roadmaps,
    others: sections.onOtherRoadmaps.filter((ref) => !isAnswered(ref)).length,
    nothing: sections.nothingNeedsYou || open.every(isAnswered),
  };
}

/**
 * How many of each question section's entries a pending comment answers, by
 * section id, for the sections that list questions: the count the section's
 * heading and the section bar show beside the section's own, which counts
 * entries, so the two never read as a contradiction of *Nothing needs you*.
 * A section with none answered is left out.
 */
export function answeredPerSection(
  sections: PlanningSections,
  answered: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  if (answered.size === 0) return out;
  const lists: [string, readonly QuestionRef[]][] = [
    ["needs-you", sections.needsYou],
    ["unrouted", sections.unrouted ?? []],
    [
      "waiting",
      sections.waiting.flatMap((w) =>
        w.kind === "question" ? [w.question] : [],
      ),
    ],
  ];
  for (const [id, refs] of lists) {
    const n = refs.filter((ref) => answered.has(questionKey(ref))).length;
    if (n > 0) out.set(id, n);
  }
  return out;
}
