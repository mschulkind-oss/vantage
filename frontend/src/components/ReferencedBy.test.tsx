/**
 * The Referenced by line and the list behind it
 * (`docs/design/planning-index.md` §7), rendered from summaries the planning
 * module derives from real trees. Where it sits in a document, and when it is
 * shown at all, is `MarkdownViewerPlanning.test.tsx`'s.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { referenceSummary, type ReferenceSummary } from "vantage-md/planning";
import {
  HEADINGS_SHOWN,
  REFERENCED_BY_ATTR,
  ReferencedBy,
  summaryLine,
} from "./ReferencedBy";
import { indexOf } from "../test/planning";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

beforeEach(() => navigate.mockClear());

const OPEN = "\u{1F4AC}";

/** Open questions `OQ-<prefix>1`, `OQ-<prefix>2`, …, as a list. */
const questions = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) =>
    [
      `${i + 1}. ${OPEN} **OQ-${prefix}${i + 1}: Question ${i + 1}?**`,
      "",
      `   <!-- vantage: oq id=OQ-${prefix}${i + 1} leaning="Yes." -->`,
      "",
      "   _Leaning:_ yes.",
      "",
    ].join("\n"),
  ).join("\n");

const planning = (body: string) => `---\nstatus: draft\n---\n\n${body}\n`;

/** A source that links to `target` once under each of `headings`. */
const citing = (target: string, headings: string[]) =>
  planning(
    headings.map((h) => `## ${h}\n\nSee [the target](${target}).\n`).join("\n"),
  );

const TARGET = "docs/design/target.md";

const summaryOf = (tree: Record<string, string>, path = TARGET) =>
  referenceSummary(indexOf(tree), path);

const renderLine = (summary: ReferenceSummary) =>
  render(
    <MemoryRouter>
      <ReferencedBy summary={summary} hrefFor={(path) => `/${path}`} />
    </MemoryRouter>,
  );

const surface = () =>
  document.querySelector<HTMLElement>(`[${REFERENCED_BY_ATTR}]`);
const toggle = () => screen.getByRole("button", { name: /Referenced by/ });
const rows = () =>
  screen
    .getAllByRole("listitem")
    .map((row) => row.textContent?.replace(/\s+/g, " ").trim());

describe("the line (§7)", () => {
  it("names the roadmap heading when the roadmap routes the document", () => {
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 1)),
      "roadmap.md":
        "# Roadmap\n\n## Building\n\n- [it](docs/design/target.md)\n",
      "docs/design/other.md": citing("target.md", ["Uses"]),
    });
    // The roadmap links here, so it is one of the two documents.
    expect(summaryLine(summary)).toEqual({
      count: "Referenced by 2 documents",
      status: "on the roadmap under Building",
      warning: false,
    });
    renderLine(summary);
    expect(toggle()).toHaveTextContent(
      "Referenced by 2 documents · on the roadmap under Building",
    );
  });

  it("says it is not on the roadmap, and how many questions, in the warning tone", () => {
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 2)),
      "roadmap.md": "# Roadmap\n",
      "docs/design/other.md": citing("target.md", ["Uses"]),
    });
    expect(summaryLine(summary)).toEqual({
      count: "Referenced by 1 document",
      status: "not on the roadmap (2 open questions)",
      warning: true,
    });
    renderLine(summary);
    const status = screen.getByText("not on the roadmap (2 open questions)");
    expect(status.className).toContain("--vantage-tone-warning-ink");
    expect(
      screen.getByText(/Referenced by 1 document/).className,
    ).not.toContain("warning");
  });

  it("still says so when nothing links to it, as plain text with nothing to open", () => {
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 1)),
      "roadmap.md": "# Roadmap\n",
    });
    expect(summaryLine(summary)).toEqual({
      count: null,
      status: "Not on the roadmap (1 open question)",
      warning: true,
    });
    renderLine(summary);
    expect(surface()).toHaveTextContent(
      /^Not on the roadmap \(1 open question\)$/,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("gives only the count when the roadmap has nothing to say", () => {
    const summary = summaryOf({
      [TARGET]: planning("No questions here."),
      "roadmap.md": "# Roadmap\n",
      "docs/design/other.md": citing("target.md", ["Uses"]),
    });
    expect(summaryLine(summary)).toEqual({
      count: "Referenced by 1 document",
      status: null,
      warning: false,
    });
    renderLine(summary);
    expect(toggle()).toHaveTextContent(/^Referenced by 1 document$/);
  });

  it("is not drawn when nothing links here and nothing is unrouted", () => {
    const summary = summaryOf({
      [TARGET]: planning("No questions here."),
      "roadmap.md": "# Roadmap\n",
    });
    expect(summaryLine(summary)).toBeNull();
    const { container } = renderLine(summary);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts documents, not links", () => {
    const summary = summaryOf({
      [TARGET]: planning(""),
      "docs/design/other.md": citing("target.md", ["A", "B", "C", "D", "E"]),
      "roadmap.md": [
        "## Now",
        "",
        "- [it](docs/design/target.md)",
        "",
        "## Later",
        "",
        "- [it again](docs/design/target.md)",
        "",
      ].join("\n"),
    });
    expect(summaryLine(summary)?.count).toBe("Referenced by 2 documents");
    // The first routing link names the heading.
    expect(summaryLine(summary)?.status).toBe("on the roadmap under Now");
  });

  it("names no heading for a roadmap link above every heading", () => {
    const summary = summaryOf({
      [TARGET]: planning(""),
      "roadmap.md": "Start with [it](docs/design/target.md).\n",
    });
    expect(summaryLine(summary)).toMatchObject({
      count: "Referenced by 1 document",
      status: "on the roadmap",
    });
  });
});

describe("the disclosure", () => {
  const summary = () =>
    summaryOf({
      [TARGET]: planning(""),
      "docs/design/other.md": citing("target.md", ["Uses"]),
    });

  it("is a collapsed button that controls the hidden list", () => {
    renderLine(summary());
    const button = toggle();
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    const list = document.getElementById(button.getAttribute("aria-controls")!);
    expect(list).not.toBeNull();
    // Hidden, so a screen reader skips it and it does not print.
    expect(list).toHaveAttribute("hidden");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("opens and closes on activation, keeping focus on itself", () => {
    renderLine(summary());
    const button = toggle();
    button.focus();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("navigation", { name: "Referenced by" }),
    ).not.toHaveAttribute("hidden");
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("is reachable from the keyboard", () => {
    renderLine(summary());
    // A native button: in the tab order, and Enter and Space activate it
    // (the e2e spec presses them in a real browser).
    expect(toggle().tabIndex).toBe(0);
    expect(toggle()).not.toBeDisabled();
  });
});

describe("the list behind it", () => {
  const TREE = {
    [TARGET]: planning(questions("T", 1)),
    "docs/design/b.md": planning(
      [
        "Before any heading, [the target](target.md).",
        "",
        "## Six",
        "",
        "[once](target.md) and [twice](target.md) under one heading.",
        "",
        "## Five",
        "",
        "[it](target.md#OQ-T1)",
        "",
        "## Four",
        "",
        "[it](target.md)",
        "",
        "## Three",
        "",
        "[it](target.md)",
        "",
        "## Two",
        "",
        "[it](target.md)",
        "",
        "## One",
        "",
        "[it](target.md)",
        "",
      ].join("\n"),
    ),
    "docs/design/a.md": citing("target.md", ["Only"]),
    "roadmap.md": "# Roadmap\n\n## Building\n\n- [it](docs/design/target.md)\n",
  };

  const open = () => {
    renderLine(summaryOf(TREE));
    fireEvent.click(toggle());
  };

  it("has one row per document, the roadmap first, then by path, by file name", () => {
    open();
    expect(rows()).toEqual([
      "roadmap.md · Building",
      "a.md · Only",
      `b.md · Six · Five · Four · Three · +2 more`,
    ]);
    const name = screen.getByRole("link", { name: "b.md" });
    expect(name).toHaveAttribute("title", "docs/design/b.md");
  });

  it("links the file name to its first link, and each heading to the first link under it", () => {
    open();
    // b.md's first link sits above every heading, so it has no heading to show.
    expect(screen.getByRole("link", { name: "b.md" })).toHaveAttribute(
      "href",
      "/docs/design/b.md#L5",
    );
    expect(screen.getByRole("link", { name: "Six" })).toHaveAttribute(
      "href",
      "/docs/design/b.md#L9",
    );
    fireEvent.click(screen.getByRole("link", { name: "Building" }));
    expect(navigate).toHaveBeenCalledWith("/roadmap.md#L5");
  });

  it(`shows ${HEADINGS_SHOWN} headings, and "+M more" opens that row alone`, () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /\+2 more/ }));
    expect(rows()).toEqual([
      "roadmap.md · Building",
      "a.md · Only",
      "b.md · Six · Five · Four · Three · Two · One",
    ]);
    // The button went with the press, so focus is on the first heading it
    // revealed rather than lost to the body.
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Two" }),
    );
  });

  it('names the row in "+M more"', () => {
    open();
    expect(
      screen.getByRole("button", { name: "+2 more headings in b.md" }),
    ).toHaveTextContent(/^\+2 more$/);
  });

  it("builds no element the document's passes read as the document", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /\+2 more/ }));
    expect(
      surface()?.querySelector("h1, h2, h3, h4, h5, h6, p, li"),
    ).toBeNull();
    expect(
      surface()?.querySelector("[data-source-line], [data-vantage-oq]"),
    ).toBeNull();
  });

  it("keeps what is open when the index changes under it", () => {
    const { rerender } = renderLine(summaryOf(TREE));
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: /\+2 more/ }));
    act(() => {
      rerender(
        <MemoryRouter>
          <ReferencedBy
            summary={summaryOf({
              ...TREE,
              "docs/design/c.md": citing("target.md", ["New"]),
            })}
            hrefFor={(path) => `/${path}`}
          />
        </MemoryRouter>,
      );
    });
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(toggle()).toHaveTextContent("Referenced by 4 documents");
    expect(rows()).toContain("b.md · Six · Five · Four · Three · Two · One");
    expect(rows()).toContain("c.md · New");
  });
});
