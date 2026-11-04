import {
  cardBlockFor,
  scanPlanningDocument,
  type CardBlock,
  type PlanningQuestion,
} from "vantage-md/planning";

/** One fixture question with the card block the scanner cut for it. */
export interface MotionQuestion {
  question: PlanningQuestion;
  card: CardBlock;
}

/**
 * A question as a repository writes one that has been around a while: a list
 * item whose title opens a paragraph of background, a second paragraph, a
 * leaning and an empty Answer. `extra` more sentences make a taller one.
 */
function source(id: string, title: string, extra: number): string {
  return [
    `# Motion fixture ${id}`,
    "",
    `1. \u{1F4AC} **${id}: ${title}** The broker hands every jail one session`,
    "   today, which [the auth design](accepted.md) settled for a single",
    "   profile, and its history shows two jails racing one single-use token.",
    "   It has come up three times since the first draft, each time deferred.",
    "",
    "   The options are one session per jail, or one per profile." +
      " Each option below changes who can read a refreshed token first.".repeat(
        extra,
      ),
    "",
    `   <!-- vantage: oq id=${id} leaning="Per profile, narrowed before it crosses." -->`,
    "",
    "   _Leaning:_ per profile, narrowed before it crosses into the jail.",
    "",
    "   **Answer:**",
    "",
    "   > _(empty — fill in when decided)_",
    "",
  ].join("\n");
}

function scanned(
  id: string,
  title: string,
  extra: number,
  path: string,
): MotionQuestion {
  const result = scanPlanningDocument(path, source(id, title, extra), false);
  if (result.kind !== "planning") throw new Error(`${path} is not planning`);
  const question = result.document.questions[0];
  const card = cardBlockFor(result.cards, question);
  if (card === undefined) throw new Error(`${path} has no card block`);
  return { question, card };
}

/**
 * The inspector's questions, from the scanner the planning page uses: one
 * above the answered one (unchanged), the answered one, one below it
 * (unchanged, which the shrink carries up), and the one that joins the end.
 */
export function motionFixture(): {
  above: MotionQuestion;
  answered: MotionQuestion;
  below: MotionQuestion;
  arriving: MotionQuestion;
} {
  return {
    above: scanned(
      "OQ-M1",
      "Should the broker mint per profile?",
      2,
      "motion/above.md",
    ),
    answered: scanned(
      "OQ-M2",
      "Should a refresh be serialized per host?",
      4,
      "motion/answered.md",
    ),
    below: scanned(
      "OQ-M3",
      "Who reads a refreshed token first?",
      1,
      "motion/below.md",
    ),
    arriving: scanned(
      "OQ-M4",
      "Is the incident log kept with the design?",
      3,
      "motion/arriving.md",
    ),
  };
}
