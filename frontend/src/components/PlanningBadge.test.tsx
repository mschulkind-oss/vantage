/**
 * A planning badge's markup (`docs/design/planning-index.md` §5.2, §5.3): the
 * words it shows, what a screen reader hears, and that the React element and
 * the DOM node a post-render pass inserts are the same markup.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  badgeSpeech,
  badgeText,
  type PlanningBadge,
} from "vantage-md/planning";
import {
  PLANNING_BADGE_ATTR,
  PlanningBadgeChip,
  planningBadgeElement,
} from "./PlanningBadge";

const DOCUMENT: PlanningBadge = {
  kind: "document",
  path: "docs/a.md",
  status: "in-review",
  stage: "DESIGN",
  stageInVocabulary: true,
  open: 5,
  blocked: 2,
};

const BADGES: PlanningBadge[] = [
  DOCUMENT,
  { ...DOCUMENT, status: null, blocked: 0 },
  { ...DOCUMENT, stage: null, open: 0, blocked: 0 },
  { kind: "question", path: "docs/a.md", id: "OQ-1", state: "open" },
  { kind: "question", path: "docs/a.md", id: "OQ-2", state: "blocked" },
  { kind: "question", path: "docs/a.md", id: "OQ-3", state: "answered" },
  { kind: "ruled", path: "docs/a.md", id: "OQ-4" },
  { kind: "not-found", path: "docs/a.md", id: "OQ-5" },
  { kind: "not-a-question", path: "docs/a.md", id: "OQ-6" },
];

/** The badge's words, joined as badgeText joins them. */
const words = (el: Element) =>
  Array.from(el.children, (child) => child.textContent).join(" · ");

describe("PlanningBadgeChip", () => {
  it.each(BADGES.map((badge) => [badgeText(badge), badge] as const))(
    "reads %s, and speaks it in words",
    (_, badge) => {
      render(<PlanningBadgeChip badge={badge} />);
      const el = screen.getByRole("img", { name: badgeSpeech(badge) });
      expect(el).toHaveAttribute(PLANNING_BADGE_ATTR, badge.kind);
      expect(words(el)).toBe(badgeText(badge));
    },
  );

  it("draws a document's status as the status chip", () => {
    render(<PlanningBadgeChip badge={DOCUMENT} />);
    const chip = screen.getByText("in-review");
    expect(chip).toHaveClass("vantage-chip", "vantage-chip--warning");
  });

  it("draws a stage outside the declared words in the warning tone", () => {
    const badge: PlanningBadge = {
      ...DOCUMENT,
      stage: "DECIEDD",
      stageInVocabulary: false,
    };
    render(<PlanningBadgeChip badge={badge} />);
    expect(screen.getByText("DECIEDD")).toHaveClass(
      "vantage-planning-badge__part--warning",
    );
    // Where the page says it with a color, a screen reader hears it in words.
    expect(
      screen.getByRole("img", { name: badgeSpeech(badge) }),
    ).toHaveAccessibleName(/deciedd, not a declared stage/);
  });

  it("draws a declared stage in the badge's own tone", () => {
    render(<PlanningBadgeChip badge={DOCUMENT} />);
    expect(screen.getByText("DESIGN")).not.toHaveClass(
      "vantage-planning-badge__part--warning",
    );
  });

  // `stage` is one word by design (§4), but nothing bounds what a document
  // writes there, and a badge does not wrap: a stage of thousands of
  // characters would widen every page that links to its document.
  it("shows a long stage cut short, whole in its tooltip", () => {
    const stage = "X".repeat(200);
    render(<PlanningBadgeChip badge={{ ...DOCUMENT, stage }} />);
    const shown = screen.getByText(/^X+…$/);
    expect(Array.from(shown.textContent ?? "").length).toBe(32);
    expect(screen.getByRole("img").getAttribute("title")).toContain(
      stage.toLowerCase(),
    );
  });

  // A bidi override would draw the stored word as another, and only the badge
  // would show it: the checker reads the characters as they are.
  it("shows a stage without its bidi controls", () => {
    render(
      <PlanningBadgeChip
        badge={{ ...DOCUMENT, stage: "\u202eNGISED\u202c" }}
      />,
    );
    expect(screen.getByText("NGISED")).toBeTruthy();
  });

  it("leaves no text node beside its parts, so the spacing is CSS", () => {
    const { container } = render(<PlanningBadgeChip badge={DOCUMENT} />);
    const el = container.firstElementChild!;
    for (const node of el.childNodes) {
      expect(node.nodeType).toBe(Node.ELEMENT_NODE);
    }
  });
});

describe("planningBadgeElement", () => {
  it.each(BADGES.map((badge) => [badgeText(badge), badge] as const))(
    "is the chip's markup for %s",
    (_, badge) => {
      const { container } = render(<PlanningBadgeChip badge={badge} />);
      expect(planningBadgeElement(badge).outerHTML).toBe(container.innerHTML);
    },
  );
});
