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
