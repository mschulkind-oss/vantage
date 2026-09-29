/**
 * A planning badge: what a link's target says about its own state
 * (`docs/design/planning-index.md` §5).
 *
 * Two renderings of one markup. `PlanningBadgeChip` is the React element, for
 * surfaces React draws (the planning page); `planningBadgeElement` is the same
 * markup as a detached DOM node, for the post-render pass that hangs a badge
 * after a rendered link, where React does not own the insertion point. Both read
 * `badgeMarkup`, so the two cannot drift apart. The file tree has no room for
 * this chip and draws a compact form of its own (`PlanningTreeBadge`, §7).
 *
 * What the markup promises, each for a reason in §5.3:
 *
 * - `role="img"` with `aria-label` set to `badgeSpeech`: a screen reader reads
 *   the badge after the link as one phrase ("in review, design, 5 open
 *   questions"), never as the glyphs, and its children are presentational.
 * - A document badge's status is the status chip itself (`.vantage-chip` and
 *   `DOC_STATUS_TONES`), so the chip reads the same beside a link as in the
 *   document's own header.
 * - No text node outside the element. The gap between a link and its badge is a
 *   CSS margin on the badge, because the badge is stripped from every text a
 *   review anchor, the contents column or a copy reads, and a space left beside
 *   it would survive the strip: `x.` would become `x .`, and a comment filed
 *   before the index was ready would hash differently once badges appeared.
 */
import { DOC_STATUS_TONES, VANTAGE_OQ_STATUS } from "vantage-md";
import {
  badgeSpeech,
  badgeText,
  type PlanningBadge,
} from "vantage-md/planning";

/**
 * Marks every badge, whichever way it was drawn. `REVIEW_UI_SELECTOR` names it,
 * so no hash, outline entry or snapshot reads a badge's text, and the review
 * click handler bails on it: clicking a badge does nothing (§5.3).
 */
export const PLANNING_BADGE_ATTR = "data-vantage-planning-badge";

const WARNING = "vantage-planning-badge__part--warning";

interface BadgeMarkup {
  /** The value of `PLANNING_BADGE_ATTR`: the badge's kind. */
  kind: PlanningBadge["kind"];
  label: string;
  parts: { text: string; className: string }[];
}

const part = (text: string, ...classes: (string | false)[]) => ({
  text,
  className: ["vantage-planning-badge__part", ...classes]
    .filter(Boolean)
    .join(" "),
});

/** The most of a stage a badge draws, in characters. */
const STAGE_SHOWN = 32;

/** Bidi embeddings, overrides and isolates (U+202A–U+202E, U+2066–U+2069). */
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/g;

/**
 * A stage as a badge draws it. `stage` is one word by design (§4), but
 * nothing bounds what a document writes, and a badge does not wrap, so a long
 * one is cut short, whole in the badge's tooltip. A bidi control would draw
 * the stored word as another, which only the badge would show, so it is left
 * out. `badgeText` keeps the word as written, for the CLI and the checker.
 */
function shownStage(stage: string): string {
  const chars = Array.from(stage.replace(BIDI_CONTROLS, ""));
  return chars.length <= STAGE_SHOWN
    ? chars.join("")
    : `${chars.slice(0, STAGE_SHOWN - 1).join("")}…`;
}

function badgeMarkup(badge: PlanningBadge): BadgeMarkup {
  const label = badgeSpeech(badge);
  if (badge.kind !== "document") {
    const tone =
      badge.kind === "question"
        ? `vantage-planning-badge__part--${badge.state}`
        : badge.kind === "not-found" || badge.kind === "not-a-question"
          ? WARNING
          : "vantage-planning-badge__part--answered";
    return { kind: badge.kind, label, parts: [part(badgeText(badge), tone)] };
  }
  // Each part is one of badgeText's, so the badge reads as the CLI prints it;
  // only an overlong or bidi-laden stage is drawn otherwise (`shownStage`).
  const parts: BadgeMarkup["parts"] = [];
  if (badge.status !== null) {
    parts.push(
      part(
        badge.status,
        "vantage-chip",
        `vantage-chip--${DOC_STATUS_TONES[badge.status]}`,
      ),
    );
  }
  if (badge.stage !== null) {
    // A word outside the declared stages is drawn in the warning tone (§4).
    parts.push(
      part(shownStage(badge.stage), !badge.stageInVocabulary && WARNING),
    );
  }
  if (badge.open > 0) {
    parts.push(part(`${VANTAGE_OQ_STATUS.open} ${badge.open}`));
  }
  if (badge.blocked > 0) {
    parts.push(part(`${VANTAGE_OQ_STATUS.blocked} ${badge.blocked}`));
  }
  return { kind: badge.kind, label, parts };
}

/** The badge as a React element. */
export function PlanningBadgeChip({ badge }: { badge: PlanningBadge }) {
  const markup = badgeMarkup(badge);
  return (
    <span
      {...{ [PLANNING_BADGE_ATTR]: markup.kind }}
      role="img"
      aria-label={markup.label}
      title={markup.label}
      className="vantage-planning-badge"
    >
      {markup.parts.map((p, i) => (
        <span key={i} className={p.className}>
          {p.text}
        </span>
      ))}
    </span>
  );
}

/** The same badge as a detached node, for a pass over rendered DOM. */
// eslint-disable-next-line react-refresh/only-export-components -- the DOM twin of the chip above: one markup, so one file
export function planningBadgeElement(badge: PlanningBadge): HTMLElement {
  const markup = badgeMarkup(badge);
  const root = document.createElement("span");
  root.setAttribute(PLANNING_BADGE_ATTR, markup.kind);
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", markup.label);
  root.title = markup.label;
  root.className = "vantage-planning-badge";
  for (const p of markup.parts) {
    const child = document.createElement("span");
    child.className = p.className;
    child.textContent = p.text;
    root.appendChild(child);
  }
  return root;
}
