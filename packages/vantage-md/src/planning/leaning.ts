/**
 * The marker the Open Questions convention puts on a question's leaning,
 * matched against the start of a paragraph's rendered text, so the emphasis
 * around it does not matter: `_Leaning:_`, `**Leaning:**` and a bare
 * `Leaning:` all match, and so do the two variants real documents write — a
 * note in parentheses before the colon (`_Leaning (revised 2026-09-04, as
 * filed):_`) and a dash in place of it (`Leaning —`). Anchored, because a
 * paragraph that merely mentions the word is prose about leanings rather than
 * a leaning.
 *
 * One marker for every reader of it: the planning page's card lays the
 * paragraph out as its leaning block, `planning/question-length` leaves it out
 * of a question's length, and `vantage/oq-missing` finds an open question with
 * a stated leaning by it.
 */
export const LEANING_MARKER = /^\s*leaning\s*(?:\([^)]*\)\s*)?(?::|—|–)/i;

/**
 * How a question is written, in one sentence of Markdown: the parts the page
 * and the planning card lay a question out by, each a block of its own.
 *
 * The two `vantage-check` findings about a question's text quote it —
 * `vantage/question-layout`, where a leaning runs into other text, and
 * `planning/question-length`, where a question runs long, which is most often
 * the same mistake — and the style guide teaches the same parts at length, in
 * its Open questions section. `styleGuidePlanning.test.ts` holds the two
 * together.
 */
export const QUESTION_SHAPE =
  "Write a question in parts, each a block of its own with a blank line between: a title line with its marker, its id and the question in bold (`💬 **OQ-9: Where does a job go when it re-enters the queue?**`), then context in short paragraphs, the options as a list, `_Leaning:_ …` as a paragraph of its own, and `**Answer:**` as a paragraph of its own — never one run-together paragraph.";
