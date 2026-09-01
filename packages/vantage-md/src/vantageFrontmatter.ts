/**
 * The `vantage:` frontmatter key — file-scoped chrome (`inline-markup.md` §4.5).
 *
 * One reserved key at the top level of a document's frontmatter, holding the
 * chrome that belongs to the *file* rather than to a section. Today that is one
 * thing: whether the document's lifecycle `status:` is shown as a chip above the
 * metadata card, instead of being buried as one row inside it.
 *
 * Read only at the top level, and **inert on every failure** (P3): an unknown
 * key, a value outside the closed set, or a `vantage:` that is not a table
 * produces no chrome, no throw and no console output. The reasons are returned
 * as data in `issues`, for anything that wants to report them — `vantage-check`
 * does, and it is the only signal an author gets. That split is exactly the one
 * `FrontmatterProblem` already uses in `frontmatter.ts`: the viewer reads the
 * value, the checker reads the reasons.
 *
 * Like `vantageDirectives.ts`, this module is imported by the CLI checker **by
 * relative path**, so it must stay a pure function of already-parsed data: no
 * hast, no React, no filesystem.
 */

import { VANTAGE_TONES } from "./vantageDirectives.js";

/**
 * The document lifecycle vocabulary. Closed; extending it is a code change.
 *
 * This is the repo's own existing set, not a new one — `styleGuide.ts` tells
 * every agent to write `status: in-review # draft | in-review | accepted |
 * deprecated`, and every document under `docs/` follows it. It is deliberately
 * *not* the `badge` set (`draft stale blocked done wip`): `badge` is
 * section-scoped workflow state, `status` is document lifecycle state, and
 * `in-review` — the design doc's own only example of a chip — is not a badge
 * word at all. Only `draft` is a member of both, and a token set is per key.
 */
export const DOC_STATUSES = [
  "draft",
  "in-review",
  "accepted",
  "deprecated",
] as const;

export type DocStatus = (typeof DOC_STATUSES)[number];

/** Every key this build knows under `vantage:`. Closed. */
export const VANTAGE_FRONTMATTER_KEYS = ["status-chip"] as const;

/**
 * Which tone each status borrows its colours from.
 *
 * The chip has no palette of its own: it reuses the tone chips
 * (`.vantage-chip--<tone>` in `styles/directives.css`), which is also what makes
 * a `draft` chip and a `badge=draft` chip the same visual object. A map rather
 * than a computed class name, so the whole status→tone relation is one readable
 * table and a test can assert it covers the vocabulary.
 */
export const DOC_STATUS_TONES: Readonly<
  Record<DocStatus, (typeof VANTAGE_TONES)[number]>
> = {
  draft: "muted",
  "in-review": "warning",
  accepted: "tip",
  deprecated: "caution",
};

/**
 * Why something under `vantage:` produced no chrome.
 *
 * `status-chip-orphan` and `status-chip-disagrees` are not vocabulary errors —
 * both values are legal — but both are the markup rot R3 is about: a chip that
 * says something the document's own `status:` does not.
 */
export type VantageFrontmatterIssue =
  | { kind: "not-a-table"; value: unknown }
  | { kind: "unknown-key"; key: string }
  | { kind: "bad-value"; key: string; value: unknown; legal: readonly string[] }
  | { kind: "status-chip-orphan"; status: unknown }
  | { kind: "status-chip-disagrees"; chip: DocStatus; status: unknown };

export interface VantageFrontmatter {
  /** The chip's text, or `undefined` for no chip. */
  statusChip?: DocStatus;
  /** Why something was dropped. A viewer must never read this (P3). */
  issues: VantageFrontmatterIssue[];
}

/** The legal `status-chip` values, in the order a message should list them. */
const STATUS_CHIP_VALUES: readonly string[] = [
  ...DOC_STATUSES,
  "true",
  "false",
];

/** Narrowing helper the chip and the checker both use. */
export function isDocStatus(value: unknown): value is DocStatus {
  return (
    typeof value === "string" &&
    (DOC_STATUSES as readonly string[]).includes(value)
  );
}

function isTable(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/**
 * Read the `vantage:` key out of parsed frontmatter.
 *
 * Pure: no module state, no mutation of the input, no logging. The same object
 * in twice gives equal results out.
 */
export function readVantageFrontmatter(
  frontmatter: Record<string, unknown>,
): VantageFrontmatter {
  const issues: VantageFrontmatterIssue[] = [];
  if (!Object.hasOwn(frontmatter, "vantage")) return { issues };

  const value = frontmatter["vantage"];
  // A `Date` is an object and would otherwise pass for a table: `yaml` parses
  // `vantage: 2026-08-31` into one, which `Object.keys` reports as empty.
  if (!isTable(value)) {
    issues.push({ kind: "not-a-table", value });
    return { issues };
  }

  let statusChip: DocStatus | undefined;

  for (const key of Object.keys(value)) {
    // D2 is per key: an unknown key drops that key and nothing else, so a newer
    // document keeps working in an older build.
    if (!(VANTAGE_FRONTMATTER_KEYS as readonly string[]).includes(key)) {
      issues.push({ kind: "unknown-key", key });
      continue;
    }
    if (key === "status-chip") {
      statusChip = readStatusChip(frontmatter, value[key], issues);
    }
  }

  return { ...(statusChip === undefined ? {} : { statusChip }), issues };
}

/**
 * `status-chip` takes two shapes, and the boolean one is the recommended shape.
 *
 * `true` **inherits** the document's own top-level `status:`, so the chip cannot
 * disagree with it — which is the entire point of §5.3 ("makes `status: draft`
 * visible rather than buried in a metadata card"). A literal token is kept
 * because the design doc's only example uses one, and the disagreement it makes
 * possible is turned into a checker finding rather than banned.
 *
 * Discrimination is on `typeof`, never truthiness: `true` is a YAML boolean and
 * `2026-08-31` is a `Date`, and both would sail through a truthy test.
 */
function readStatusChip(
  frontmatter: Record<string, unknown>,
  raw: unknown,
  issues: VantageFrontmatterIssue[],
): DocStatus | undefined {
  const status = frontmatter["status"];

  // Explicitly off. Not an issue: saying so is the point of a token vocabulary
  // that can be cancelled (the same reason `collapsed` has a `false`).
  if (raw === false) return undefined;

  if (raw === true) {
    if (isDocStatus(status)) return status;
    issues.push({ kind: "status-chip-orphan", status });
    return undefined;
  }

  // Exact match, no case folding and no trimming — the same all-or-nothing
  // posture as the directive grammar and the sanitiser. `status-chip: Draft`
  // is dropped, and the checker is what says so.
  if (isDocStatus(raw)) {
    if (isDocStatus(status) && status !== raw) {
      issues.push({ kind: "status-chip-disagrees", chip: raw, status });
    }
    return raw;
  }

  issues.push({
    kind: "bad-value",
    key: "status-chip",
    value: raw,
    legal: STATUS_CHIP_VALUES,
  });
  return undefined;
}
