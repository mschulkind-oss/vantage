/**
 * The Referenced by line and the list behind it
 * (`docs/reference/planning-index.md` §7), and the line's link to the planning
 * page filtered to the document (§7.1), rendered
 * from summaries the planning module derives from real trees. Where it sits in
 * a document, the link's address, and when it is shown at all, is
 * `MarkdownViewerPlanning.test.tsx`'s.
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
import { indexOf, questionDirective } from "../test/planning";

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

/** Settled questions `OQ-<prefix>1`, …, one per marker: none of them open. */
const settled = (prefix: string, ...markers: string[]) =>
  markers
    .map((marker, i) =>
      [
        `${i + 1}. ${marker} **OQ-${prefix}${i + 1}: Question ${i + 1}?**`,
        "",
        `   ${questionDirective(marker, `OQ-${prefix}${i + 1}`)}`,
        "",
        "   Settled.",
        "",
      ].join("\n"),
    )
    .join("\n");

const planning = (body: string) => `---\nstatus: draft\n---\n\n${body}\n`;

/** A source that links to `target` once under each of `headings`. */
const citing = (target: string, headings: string[]) =>
  planning(
    headings.map((h) => `## ${h}\n\nSee [the target](${target}).\n`).join("\n"),
  );

const TARGET = "docs/design/target.md";

const summaryOf = (tree: Record<string, string>, path = TARGET) =>
  referenceSummary(indexOf(tree), path);

/**
 * The address the viewer hands the line for TARGET. Its form is the viewer's
 * to build and `MarkdownViewerPlanning.test.tsx`'s to pin; here it only has
 * to come back out as the link's.
 */
const PLANNING_HREF = "/.vantage/planning?filter=path:docs/design/target.md";
/** The words of that link. */
const PLANNING_PART = "its questions on the planning page";

/** The line as the viewer asks for it, where there is a planning page. */
const lineOf = (summary: ReferenceSummary) =>
  summaryLine(summary, PLANNING_HREF);

const renderLine = (
  summary: ReferenceSummary,
  options: { planningHref?: string | null; oneLine?: boolean } = {},
) =>
  render(
    <MemoryRouter>
      <ReferencedBy
        summary={summary}
        hrefFor={(path) => `/${path}`}
        planningHref={
          options.planningHref === undefined
            ? PLANNING_HREF
            : options.planningHref
        }
        oneLine={options.oneLine}
      />
    </MemoryRouter>,
  );

const surface = () =>
  document.querySelector<HTMLElement>(`[${REFERENCED_BY_ATTR}]`);
/** The line itself, without the list behind it, which is in the DOM, hidden. */
const lineRow = () => surface()?.firstElementChild ?? null;
const toggle = () => screen.getByRole("button", { name: /Referenced by/ });
const planningLinkOf = () => screen.getByRole("link", { name: PLANNING_PART });
/**
 * Each row's text as the screen shows it: without what Tailwind's `hidden`
 * keeps off it, the headings past "+M more" that only print shows.
 */
const rows = () =>
  screen.getAllByRole("listitem").map((row) => {
    const shown = row.cloneNode(true) as HTMLElement;
    shown.querySelectorAll(".hidden").forEach((el) => el.remove());
    return shown.textContent?.replace(/\s+/g, " ").trim();
  });

describe("the line (§7)", () => {
  it("names the roadmap heading when the roadmap routes the document", () => {
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 1)),
      "roadmap.md":
        "# Roadmap\n\n## Building\n\n- [it](docs/design/target.md)\n",
      "docs/design/other.md": citing("target.md", ["Uses"]),
    });
    // The roadmap links here, so it is one of the two documents.
    expect(lineOf(summary)).toEqual({
      count: "Referenced by 2 documents",
      roadmap: "on the roadmap under Building",
      unrouted: null,
      planning: PLANNING_PART,
    });
    renderLine(summary);
    expect(toggle()).toHaveTextContent(
      /^Referenced by 2 documents · on the roadmap under Building$/,
    );
    expect(lineRow()).toHaveTextContent(
      /^Referenced by 2 documents · on the roadmap under Building · its questions on the planning page$/,
    );
  });

  it("counts the open questions the roadmap does not route, in the warning tone", () => {
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 2)),
      "roadmap.md": "# Roadmap\n",
      "docs/design/other.md": citing("target.md", ["Uses"]),
    });
    expect(lineOf(summary)).toEqual({
      count: "Referenced by 1 document",
      roadmap: null,
      unrouted: "2 open questions not on the roadmap",
      planning: PLANNING_PART,
    });
    renderLine(summary);
    const status = screen.getByText("2 open questions not on the roadmap");
    expect(status.className).toContain("--vantage-tone-warning-ink");
    expect(
      screen.getByText(/Referenced by 1 document/).className,
    ).not.toContain("warning");
  });

  it("still counts them when nothing links to it, as plain text with nothing to open", () => {
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 1)),
      "roadmap.md": "# Roadmap\n",
    });
    expect(lineOf(summary)).toEqual({
      count: null,
      roadmap: null,
      unrouted: "1 open question not on the roadmap",
      planning: PLANNING_PART,
    });
    renderLine(summary);
    expect(surface()).toHaveTextContent(
      /^1 open question not on the roadmap · its questions on the planning page$/,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("says a partly routed document is on the roadmap and still counts what is not", () => {
    // The roadmap routed OQ-T1, and OQ-T2 was written after it: the planning
    // page lists OQ-T2 under Not on a roadmap, and so does this line.
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 2)),
      "roadmap.md":
        "# Roadmap\n\n## Now\n\n- [it](docs/design/target.md#OQ-T1)\n",
    });
    expect(lineOf(summary)).toEqual({
      count: "Referenced by 1 document",
      roadmap: "on the roadmap under Now",
      unrouted: "1 open question not on the roadmap",
      planning: PLANNING_PART,
    });
    renderLine(summary);
    expect(toggle()).toHaveTextContent(
      /^Referenced by 1 document · on the roadmap under Now · 1 open question not on the roadmap$/,
    );
    expect(
      screen.getByText("on the roadmap under Now").className,
    ).not.toContain("warning");
    expect(
      screen.getByText("1 open question not on the roadmap").className,
    ).toContain("--vantage-tone-warning-ink");
  });

  it("does not say a document the roadmap links only by heading is off the roadmap", () => {
    // A heading link routes nothing (§4.3), so the question is unrouted, but
    // the roadmap does list the document, and the line must not deny it.
    const summary = summaryOf({
      [TARGET]: planning(`## Details\n\n${questions("T", 1)}`),
      "roadmap.md":
        "# Roadmap\n\n## Up Next\n\n- [it](docs/design/target.md#details)\n",
    });
    const line = lineOf(summary);
    expect(line).toEqual({
      count: "Referenced by 1 document",
      roadmap: null,
      unrouted: "1 open question not on the roadmap",
      planning: PLANNING_PART,
    });
  });

  it("does not put the roadmap on or off itself", () => {
    // It is never "on the roadmap", and the questions it does not route still
    // count, without the line claiming the roadmap is not on itself. Its own
    // link to OQ-R2 routes nothing, since a document's links are its links to
    // another candidate (§3.2), so both of its questions are unrouted.
    const summary = summaryOf(
      {
        "roadmap.md": planning(
          [
            "## Now",
            "",
            "- [the target](docs/design/target.md)",
            "- [its own](#OQ-R2)",
            "",
            questions("R", 2),
          ].join("\n"),
        ),
        [TARGET]: planning(""),
        "docs/design/other.md": citing("../../roadmap.md", ["Uses"]),
      },
      "roadmap.md",
    );
    expect(lineOf(summary)).toEqual({
      count: "Referenced by 1 document",
      roadmap: null,
      unrouted: "2 open questions not on the roadmap",
      planning: PLANNING_PART,
    });
  });

  it("gives only the count when the roadmap has nothing to say", () => {
    const summary = summaryOf({
      [TARGET]: planning("No questions here."),
      "roadmap.md": "# Roadmap\n",
      "docs/design/other.md": citing("target.md", ["Uses"]),
    });
    // It holds no question, so it has no link either.
    expect(lineOf(summary)).toEqual({
      count: "Referenced by 1 document",
      roadmap: null,
      unrouted: null,
      planning: null,
    });
    renderLine(summary);
    expect(toggle()).toHaveTextContent(/^Referenced by 1 document$/);
    expect(lineRow()).toHaveTextContent(/^Referenced by 1 document$/);
    expect(
      screen.queryByRole("link", {
        name: "its questions on the planning page",
      }),
    ).toBeNull();
  });

  it("is not drawn when nothing links here and nothing is unrouted", () => {
    const summary = summaryOf({
      [TARGET]: planning("No questions here."),
      "roadmap.md": "# Roadmap\n",
    });
    expect(lineOf(summary)).toBeNull();
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
    expect(lineOf(summary)?.count).toBe("Referenced by 2 documents");
    // The first routing link names the heading.
    expect(lineOf(summary)?.roadmap).toBe("on the roadmap under Now");
  });

  it("names no heading for a roadmap link above every heading", () => {
    const summary = summaryOf({
      [TARGET]: planning(""),
      "roadmap.md": "Start with [it](docs/design/target.md).\n",
    });
    expect(lineOf(summary)).toMatchObject({
      count: "Referenced by 1 document",
      roadmap: "on the roadmap",
    });
  });
});

describe("the line with several roadmaps (§7)", () => {
  // Both found by name: roadmap.md at the root and plans/roadmap.md.
  const ROOT = "# Roadmap\n\n## Building\n\n- [it](docs/design/target.md)\n";
  const PLANS =
    "# Plans\n\n## Later\n\n- [it](../docs/design/target.md#OQ-T1)\n";

  it("names the first roadmap that routes it, by the fewest directories, and how many more do", () => {
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 2)),
      "roadmap.md": ROOT,
      "plans/roadmap.md": PLANS,
    });
    expect(lineOf(summary)).toEqual({
      count: "Referenced by 2 documents",
      roadmap: "on roadmap.md under Building and 1 other roadmap",
      unrouted: null,
      planning: PLANNING_PART,
    });
    renderLine(summary);
    expect(toggle()).toHaveTextContent(
      /^Referenced by 2 documents · on roadmap.md under Building and 1 other roadmap$/,
    );
  });

  it("names a roadmap below the root by its directory, beside roadmap.md", () => {
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 2)),
      "roadmap.md": "# Roadmap\n",
      "plans/roadmap.md": PLANS,
    });
    expect(lineOf(summary)).toEqual({
      count: "Referenced by 1 document",
      roadmap: "on plans/roadmap.md under Later",
      unrouted: "1 open question not on any roadmap",
      planning: PLANNING_PART,
    });
  });

  it("counts what no roadmap routes, not what one does not", () => {
    // roadmap.md routes OQ-T1 and plans/roadmap.md OQ-T2, so nothing is left.
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 2)),
      "roadmap.md":
        "# Roadmap\n\n## Now\n\n- [it](docs/design/target.md#OQ-T1)\n",
      "plans/roadmap.md":
        "# Plans\n\n## Later\n\n- [it](../docs/design/target.md#OQ-T2)\n",
    });
    expect(lineOf(summary)?.unrouted).toBeNull();
    expect(lineOf(summary)?.roadmap).toBe(
      "on roadmap.md under Now and 1 other roadmap",
    );
  });

  it("speaks of the roadmap again when only one of them routes", () => {
    // plans/roadmap.md is retired by a done stage, so it routes nothing.
    const summary = referenceSummary(
      indexOf(
        {
          [TARGET]: planning(questions("T", 2)),
          "roadmap.md": ROOT.replace("#OQ-T1", ""),
          "plans/roadmap.md": `---\nstage: DONE\n---\n\n${PLANS}`,
        },
        { stages: { DONE: "done" } },
      ),
      TARGET,
    );
    expect(lineOf(summary)?.roadmap).toBe("on the roadmap under Building");
  });

  it("puts the roadmaps that route first in the list, in roadmap order", () => {
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 1)),
      "roadmap.md": ROOT,
      "plans/roadmap.md": PLANS,
      "docs/a.md": citing("design/target.md", ["Uses"]),
    });
    renderLine(summary);
    fireEvent.click(toggle());
    expect(rows()).toEqual([
      "roadmap.md · Building",
      "plans/roadmap.md · Later",
      "a.md · Uses",
    ]);
  });

  it("names a roadmap's row as the line names it, told from every roadmap that routes", () => {
    // Only docs/roadmap.md links here, but roadmap.md at the root is a
    // roadmap too, so a row that said `roadmap.md` would read as that one.
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 1)),
      "roadmap.md": "# Roadmap\n\n## Now\n\n- [a](docs/a.md)\n",
      "docs/a.md": planning(questions("A", 1)),
      "docs/roadmap.md": "# Docs\n\n## Soon\n\n- [it](design/target.md)\n",
    });
    expect(lineOf(summary)?.roadmap).toBe("on docs/roadmap.md under Soon");
    renderLine(summary);
    fireEvent.click(toggle());
    expect(rows()).toEqual(["docs/roadmap.md · Soon"]);
  });

  it("tells roadmaps apart by their directories, never by the case of a letter", () => {
    // All three are found by the one name, compared case-insensitively.
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 2)),
      "roadmap.md": "# Roadmap\n\n## Now\n\n- [a](docs/a.md)\n",
      "docs/a.md": planning(questions("A", 1)),
      "docs/Roadmap.md":
        "# Docs\n\n## Soon\n\n- [it](design/target.md#OQ-T1)\n",
      "plans/ROADMAP.md":
        "# Plans\n\n## Later\n\n- [it](../docs/design/target.md#OQ-T2)\n",
    });
    expect(lineOf(summary)?.roadmap).toBe(
      "on docs/Roadmap.md under Soon and 1 other roadmap",
    );
    renderLine(summary);
    fireEvent.click(toggle());
    expect(rows()).toEqual([
      "docs/Roadmap.md · Soon",
      "plans/ROADMAP.md · Later",
    ]);
  });
});

describe("the link to the filtered planning page (§7.1)", () => {
  const ROADMAP = "# Roadmap\n\n## Building\n\n- [it](docs/design/target.md)\n";
  const DONE = { stages: { DONE: "done", DESIGN: "open" } };
  /** TARGET at `stage`, holding one open question. */
  const staged = (stage: string) =>
    `---\nstage: ${stage}\n---\n\n${questions("T", 1)}\n`;

  it("is drawn for a live document holding a question, after the button and outside it", () => {
    renderLine(
      summaryOf({
        [TARGET]: planning(questions("T", 1)),
        "roadmap.md": ROADMAP,
      }),
    );
    const link = planningLinkOf();
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", PLANNING_HREF);
    // Nested interactive content is invalid, so never inside the button, and
    // never inside the list it opens either.
    expect(toggle()).not.toContainElement(link);
    expect(toggle().querySelector("a")).toBeNull();
    expect(
      toggle().compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      document.getElementById(toggle().getAttribute("aria-controls")!),
    ).not.toContainElement(link);
    // The button's words, and its title, are the line's without the link.
    expect(toggle()).toHaveAttribute(
      "title",
      "Referenced by 1 document · on the roadmap under Building",
    );
  });

  it("is drawn after the plain-text line, outside it", () => {
    renderLine(
      summaryOf({
        [TARGET]: planning(questions("T", 1)),
        "roadmap.md": "# Roadmap\n",
      }),
    );
    const words = screen.getByTitle("1 open question not on the roadmap");
    expect(words).not.toContainElement(planningLinkOf());
    expect(
      words.compareDocumentPosition(planningLinkOf()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is drawn for a document whose questions are all settled", () => {
    // `path:` keeps 🔒 and ✅ questions too, so the page has them to show.
    renderLine(
      summaryOf({
        [TARGET]: planning(settled("T", "\u{1F512}", "\u2705")),
        "roadmap.md": ROADMAP,
      }),
    );
    expect(planningLinkOf()).toHaveAttribute("href", PLANNING_HREF);
  });

  it("is a line of its own when it is all the line would say", () => {
    // Nothing links here, and with no roadmap nothing is unrouted: there was
    // no line before the link.
    const bare = summaryOf({ [TARGET]: planning(questions("T", 1)) });
    expect(lineOf(bare)).toEqual({
      count: null,
      roadmap: null,
      unrouted: null,
      planning: PLANNING_PART,
    });
    expect(summaryLine(bare)).toBeNull();
    renderLine(bare);
    expect(surface()).toHaveTextContent(/^its questions on the planning page$/);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();

    // Likewise with a roadmap, when no question it holds is open.
    const ruled = summaryOf({
      [TARGET]: planning(settled("T", "\u2705")),
      "roadmap.md": "# Roadmap\n",
    });
    expect(lineOf(ruled)).toEqual({
      count: null,
      roadmap: null,
      unrouted: null,
      planning: PLANNING_PART,
    });
  });

  it("is absent for a done stage, whatever it holds", () => {
    const summary = referenceSummary(
      indexOf({ [TARGET]: staged("DONE"), "roadmap.md": ROADMAP }, DONE),
      TARGET,
    );
    expect(lineOf(summary)).toEqual({
      count: "Referenced by 1 document",
      roadmap: null,
      unrouted: null,
      planning: null,
    });
    renderLine(summary);
    expect(screen.queryByRole("link", { name: PLANNING_PART })).toBeNull();
    expect(lineRow()).toHaveTextContent(/^Referenced by 1 document$/);

    // A stage without the done role is live.
    const open = referenceSummary(
      indexOf({ [TARGET]: staged("DESIGN"), "roadmap.md": ROADMAP }, DONE),
      TARGET,
    );
    expect(lineOf(open)?.planning).toBe(PLANNING_PART);
  });

  it("is absent where there is no planning page to link, leaving the rest of the line as it was", () => {
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 1)),
      "roadmap.md": "# Roadmap\n",
    });
    expect(summaryLine(summary, null)).toEqual({
      count: null,
      roadmap: null,
      unrouted: "1 open question not on the roadmap",
      planning: null,
    });
    renderLine(summary, { planningHref: null });
    expect(screen.queryByRole("link")).toBeNull();
    expect(surface()).toHaveTextContent(/^1 open question not on the roadmap$/);
    // And no line at all when the link was all it had.
    const { container } = renderLine(
      summaryOf({ [TARGET]: planning(questions("T", 1)) }),
      { planningHref: null },
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is a plain link: a click follows it in the app, a modified one is the browser's", () => {
    renderLine(
      summaryOf({
        [TARGET]: planning(questions("T", 1)),
        "roadmap.md": ROADMAP,
      }),
    );
    // Whether the app left each click to the browser, read once its own
    // handlers have run, and then stopped, since jsdom cannot open a tab.
    const leftToBrowser: boolean[] = [];
    const record = (e: MouseEvent) => {
      leftToBrowser.push(!e.defaultPrevented);
      e.preventDefault();
    };
    document.addEventListener("click", record);
    try {
      fireEvent.click(planningLinkOf(), { ctrlKey: true });
      fireEvent.click(planningLinkOf(), { button: 1 });
      expect(navigate).not.toHaveBeenCalled();
      fireEvent.click(planningLinkOf());
      expect(navigate).toHaveBeenCalledWith(PLANNING_HREF);
    } finally {
      document.removeEventListener("click", record);
    }
    expect(leftToBrowser).toEqual([true, true, false]);
    // Following it opens no list.
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("never shrinks: on one line the words before it are cut off instead", () => {
    const summary = summaryOf({
      [TARGET]: planning(questions("T", 1)),
      "roadmap.md": ROADMAP,
    });
    const { unmount } = renderLine(summary, { oneLine: true });
    // The link's part: the separator and the link, one flex item of the row.
    const part = () => planningLinkOf().parentElement!;
    expect(part()).toHaveClass("shrink-0", "whitespace-nowrap");
    expect(part()).not.toHaveClass("basis-full");
    expect(toggle()).toHaveClass("min-w-0");
    expect(toggle().querySelector("span.min-w-0")).toHaveClass("truncate");
    expect(part().parentElement).toBe(lineRow());
    expect(lineRow()).toHaveClass("flex", "flex-nowrap");
    unmount();

    // Otherwise from `sm` up only: below it the row wraps.
    renderLine(summary);
    expect(part()).toHaveClass("sm:shrink-0", "sm:whitespace-nowrap");
    expect(part()).not.toHaveClass("shrink-0");
    expect(lineRow()).toHaveClass("flex-wrap", "sm:flex-nowrap");
  });

  // Left to wrap item by item, the separator hung alone at the end of the
  // words' line or opened the link's, joining nothing, and the link started
  // under the chevron, left of the words.
  it("below `sm`, unless it fills a reservation, takes a line of its own under the words, with no separator", () => {
    const separatorOf = () => planningLinkOf().previousElementSibling;
    const withButton = summaryOf({
      [TARGET]: planning(questions("T", 1)),
      "roadmap.md": ROADMAP,
    });
    const { unmount } = renderLine(withButton);
    const part = planningLinkOf().parentElement!;
    // The separator and the link are one item, so neither wraps alone.
    expect(part.parentElement).toBe(lineRow());
    expect(separatorOf()?.tagName).toBe("SPAN");
    expect(separatorOf()?.textContent).toBe(" · ");
    expect(part).toHaveClass("basis-full", "sm:basis-auto");
    expect(separatorOf()).toHaveClass("hidden", "sm:inline");
    // Indented past the chevron, as the words and the list behind it are.
    expect(part).toHaveClass("pl-[18px]", "sm:pl-0");
    unmount();

    // A plain-text line has no chevron, so its words start at the edge.
    const { unmount: unmountPlain } = renderLine(
      summaryOf({
        [TARGET]: planning(questions("T", 1)),
        "roadmap.md": "# Roadmap\n",
      }),
    );
    expect(planningLinkOf().parentElement).toHaveClass("basis-full");
    expect(planningLinkOf().parentElement).not.toHaveClass("pl-[18px]");
    expect(separatorOf()).toHaveClass("hidden", "sm:inline");
    unmountPlain();

    // Filling a reservation it stays on the words' line, so the separator
    // shows at every width.
    renderLine(withButton, { oneLine: true });
    expect(planningLinkOf().parentElement).not.toHaveClass("basis-full");
    expect(planningLinkOf().parentElement).not.toHaveClass("pl-[18px]");
    expect(separatorOf()).not.toHaveClass("hidden");
  });

  it("builds no element the document's passes read as the document", () => {
    renderLine(
      summaryOf({
        [TARGET]: planning(questions("T", 1)),
        "roadmap.md": "# Roadmap\n",
      }),
    );
    expect(planningLinkOf()).toBeInTheDocument();
    expect(
      surface()?.querySelector("h1, h2, h3, h4, h5, h6, p, li"),
    ).toBeNull();
    expect(
      surface()?.querySelector("[data-source-line], [data-vantage-oq]"),
    ).toBeNull();
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

  it("tells sources with the same file name apart by the shortest path that does", () => {
    renderLine(
      summaryOf({
        [TARGET]: planning(""),
        "docs/brainstorm/x.md": citing("../design/target.md", ["Ideas"]),
        "docs/design/x.md": citing("target.md", ["Design"]),
        "a/deep/y.md": citing("../../docs/design/target.md", ["A"]),
        "b/deep/y.md": citing("../../docs/design/target.md", ["B"]),
        "docs/design/z.md": citing("target.md", ["Alone"]),
      }),
    );
    fireEvent.click(toggle());
    expect(rows()).toEqual([
      "a/deep/y.md · A",
      "b/deep/y.md · B",
      "brainstorm/x.md · Ideas",
      "design/x.md · Design",
      "z.md · Alone",
    ]);
    expect(screen.getByRole("link", { name: "design/x.md" })).toHaveAttribute(
      "title",
      "docs/design/x.md",
    );
  });

  it("links each heading to the first link under it, and the file name to a link above them all or else to the document", () => {
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
    // a.md's first link sits under Only, which already links there, so its
    // file name goes to the document instead of adding a second stop to the
    // same place.
    expect(screen.getByRole("link", { name: "a.md" })).toHaveAttribute(
      "href",
      "/docs/design/a.md",
    );
    expect(screen.getByRole("link", { name: "Only" })).toHaveAttribute(
      "href",
      "/docs/design/a.md#L7",
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
            planningHref={PLANNING_HREF}
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
