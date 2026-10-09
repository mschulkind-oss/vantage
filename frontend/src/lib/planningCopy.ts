/**
 * Copy answers + maintenance (`docs/design/planning-to-do-list.md` §5): the
 * planning page's second copy button, which copies what Copy answers copies,
 * byte for byte, and then the agent request for the kinds of *Maintenance*
 * its panel has checked.
 *
 * Pure functions of the kinds' counts and the reader's choice, so the page,
 * the panel and the tests read one rule.
 */
import type { PlanningRequestId } from "vantage-md/planning";

/**
 * The kinds the panel offers, in the order it lists them (§5.1): each of
 * *Maintenance*'s kinds that has an agent request. *Too large* and
 * *Unreadable* have none, so they are not offered.
 */
export const COPY_KINDS: readonly PlanningRequestId[] = [
  "unrouted",
  "disagrees",
  "compact",
  "graduate",
  "ready",
];

/**
 * The kinds left out until the reader chooses: *Ready to build*, whose
 * request, sent by accident, starts the most expensive work there is (§5.1).
 */
export const COPY_LEFT_OUT_DEFAULT: ReadonlySet<PlanningRequestId> = new Set([
  "ready",
]);

const isCopyKind = (value: string): value is PlanningRequestId =>
  (COPY_KINDS as readonly string[]).includes(value);

/**
 * The kinds left out, from the stored preference: its ids, comma-separated,
 * `""` for none. Nothing stored is the default. An id this release does not
 * offer is ignored, so a later release's choice reads here as what it can.
 */
export function parseLeftOut(
  raw: string | null,
): ReadonlySet<PlanningRequestId> {
  if (raw === null) return COPY_LEFT_OUT_DEFAULT;
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter(isCopyKind),
  );
}

/** The preference's text for `leftOut`, in `COPY_KINDS` order. */
export function serializeLeftOut(
  leftOut: ReadonlySet<PlanningRequestId>,
): string {
  return COPY_KINDS.filter((id) => leftOut.has(id)).join(",");
}

/** The kinds checked: every kind offered but those left out, in order. */
export const checkedKinds = (
  leftOut: ReadonlySet<PlanningRequestId>,
): PlanningRequestId[] => COPY_KINDS.filter((id) => !leftOut.has(id));

/**
 * What the button copies, counted (§5.1): the answers, and every checked
 * kind's items.
 */
export function copyTotal(
  answers: number,
  counts: ReadonlyMap<string, number>,
  leftOut: ReadonlySet<PlanningRequestId>,
): number {
  return checkedKinds(leftOut).reduce(
    (n, id) => n + (counts.get(id) ?? 0),
    answers,
  );
}

/**
 * Whether the button is greyed out (§5.1): with no kind checked it would copy
 * nothing Copy answers does not, and with a total of 0 nothing at all.
 */
export const copyGreyed = (
  total: number,
  leftOut: ReadonlySet<PlanningRequestId>,
): boolean => total === 0 || checkedKinds(leftOut).length === 0;

/**
 * The text it copies: Copy answers' payload, byte for byte, then the agent
 * request, after a blank line; either alone when the other is empty, and
 * `null` when both are.
 */
export function maintenancePayload(
  answers: string | null,
  request: string | null,
): string | null {
  if (answers === null) return request;
  if (request === null) return answers;
  return `${answers}\n\n${request}`;
}
