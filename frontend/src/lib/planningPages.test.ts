/**
 * The planning page's pages (`docs/design/planning-index-at-scale.md` §10.2),
 * laid out from the index alone. Every limit is proven by configuring it down
 * in the limits module, never by growing a tree to a default.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { PlanningConfig } from "vantage-md/planning";
import {
  isPreview,
  layoutPlanningPage,
  listedQuestions,
  pageSearch,
  readPageRequest,
  sectionsOf,
  withPage,
  type CardEntry,
  type LaidOutSection,
  type PageRequest,
} from "./planningPages";
import { setPlanningLimitsForTests } from "../planningScan/limits";
import { indexOf } from "../test/planning";

afterEach(() => setPlanningLimitsForTests(null));

const OPEN = "\u{1F4AC}";
const BLOCKED = "\u{1F512}";

/**
 * `count` open questions, `${prefix}1` on, each a one-item list under a
 * heading of its own, so each is a root-level block and a card of its own.
 * `pad` lines of prose make a card longer.
 */
function separate(prefix: string, count: number, pad = 0, marker = OPEN) {
  return Array.from({ length: count }, (_, i) =>
    [
      `## Part ${prefix}${i + 1}`,
      "",
      `1. ${marker} **${prefix}${i + 1}: Question ${prefix}${i + 1}?**`,
      "",
      `   <!-- vantage: oq id=${prefix}${i + 1} -->`,
      "",
      "   _Leaning:_ yes.",
      ...Array.from({ length: pad }, (_, j) => `   Line ${j} of the question.`),
      "",
    ].join("\n"),
  ).join("\n");
}

const doc = (front: string, ...body: string[]) =>
  [`---\n${front}\n---`, "", "# Doc", "", ...body].join("\n");

const STAGES: PlanningConfig["stages"] = {
  DESIGN: "open",
  DECIDED: "ready",
  BUILT: "built",
};

/** Every tree has a roadmap that routes nothing, so its questions are Unrouted. */
const ROADMAP = { "roadmap.md": "# Roadmap\n" };

function layoutOf(
  tree: Record<string, string>,
  request: PageRequest = {},
  config: Partial<PlanningConfig> = { stages: STAGES },
) {
  const index = indexOf({ ...ROADMAP, ...tree }, config);
  return layoutPlanningPage(index, sectionsOf(index), request);
}

const section = (
  layout: ReturnType<typeof layoutOf>,
  id: LaidOutSection["id"],
): LaidOutSection => {
  const found = layout.sections.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found;
};

const titles = (s: LaidOutSection) =>
  (s.items as CardEntry[]).map((e) =>
    e.kind === "question" ? e.question.id : `doc ${e.path}`,
  );

describe("a card section's pages", () => {
  const TREE = {
    "a.md": doc("stage: DESIGN", separate("OQ-A", 5)),
  };

  it("holds pageEntries cards a page, and the rest on the last", () => {
    setPlanningLimitsForTests({ pageEntries: 2 });
    const unrouted = section(layoutOf(TREE), "unrouted");
    expect(unrouted).toMatchObject({
      total: 5,
      pageCount: 3,
      page: 1,
      start: 0,
      end: 2,
    });
    expect(titles(unrouted)).toEqual(["OQ-A1", "OQ-A2"]);
    const last = section(layoutOf(TREE, { unrouted: "3" }), "unrouted");
    expect(last).toMatchObject({ page: 3, start: 4, end: 5 });
    expect(titles(last)).toEqual(["OQ-A5"]);
  });

  it("puts a whole section on one page under the defaults", () => {
    const unrouted = section(layoutOf(TREE), "unrouted");
    expect(unrouted.pageCount).toBe(1);
    expect(unrouted.items).toHaveLength(5);
  });

  it("stops a page early before its cards' Markdown passes the budget", () => {
    const index = indexOf({ ...ROADMAP, ...TREE }, { stages: STAGES });
    const sizes = listedQuestions(index, sectionsOf(index)).map(
      (q) => q.cardChars,
    );
    // Room for two cards and not three.
    setPlanningLimitsForTests({
      pageMarkdownChars: sizes[0]! + sizes[1]! + sizes[2]! - 1,
    });
    const unrouted = section(layoutOf(TREE), "unrouted");
    expect(unrouted.end).toBe(2);
    expect(unrouted.pageCount).toBe(3);
  });

  it("always holds at least one entry, however large its card", () => {
    setPlanningLimitsForTests({ pageMarkdownChars: 1 });
    const unrouted = section(layoutOf(TREE), "unrouted");
    expect(unrouted.pageCount).toBe(5);
    expect(unrouted.items).toHaveLength(1);
  });

  it("counts a preview card as no Markdown, and as one entry", () => {
    const tree = {
      "a.md": doc(
        "stage: DESIGN",
        separate("OQ-A", 1, 40),
        separate("OQ-B", 3),
      ),
    };
    const index = indexOf({ ...ROADMAP, ...tree }, { stages: STAGES });
    const [big, ...rest] = listedQuestions(index, sectionsOf(index));
    // The first card is a preview; the budget fits the other three and not it.
    setPlanningLimitsForTests({
      cardChars: big!.cardChars - 1,
      pageMarkdownChars: rest.reduce((n, q) => n + q.cardChars, 0),
      pageEntries: 4,
    });
    expect(isPreview(big!)).toBe(true);
    const unrouted = section(layoutOf(tree), "unrouted");
    expect(unrouted.pageCount).toBe(1);
    expect(
      (unrouted.items[0] as CardEntry & { preview: boolean }).preview,
    ).toBe(true);
    expect(unrouted.items).toHaveLength(4);
  });

  it("counts a Waiting document row as one entry and no Markdown", () => {
    const tree = {
      "blocked.md": doc("stage: DESIGN", separate("OQ-B", 2, 0, BLOCKED)),
      "open.md": doc("stage: DESIGN", separate("OQ-O", 1)),
      "waits.md": doc("stage: DESIGN\ndepends-on:\n  - open.md", "Waits."),
    };
    setPlanningLimitsForTests({ pageMarkdownChars: 1, pageEntries: 2 });
    const waiting = section(layoutOf(tree), "waiting");
    // Each blocked card fills a page of its own; the row, with no Markdown,
    // joins the last card's page.
    expect(waiting.total).toBe(3);
    expect(waiting.pageCount).toBe(2);
    expect(titles(waiting)).toEqual(["OQ-B1"]);
    expect(
      titles(section(layoutOf(tree, { waiting: "2" }), "waiting")),
    ).toEqual(["OQ-B2", "doc waits.md"]);
  });
});

describe("the other sections' pages", () => {
  it("holds pageRows document rows a page", () => {
    const tree = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [
        `r${i}.md`,
        doc("status: accepted\nstage: DECIDED", "Decided."),
      ]),
    );
    setPlanningLimitsForTests({ pageRows: 2 });
    const ready = section(layoutOf(tree, { ready: "2" }), "ready");
    expect(ready).toMatchObject({ total: 5, pageCount: 3, page: 2 });
    expect(ready.items).toEqual(["r2.md", "r3.md"]);
  });

  it("holds pageLines lines a page of Skipped and Could not read", () => {
    const index = indexOf({});
    const skipped = Array.from({ length: 3 }, (_, i) => ({
      path: `big${i}.md`,
      size: 2_000_000,
    }));
    const unreadable = [{ path: "bad.md", reason: "not UTF-8" }];
    setPlanningLimitsForTests({ pageLines: 2 });
    const withLists = { ...index, skipped, unreadable };
    const layout = layoutPlanningPage(withLists, sectionsOf(withLists), {
      skipped: "2",
    });
    expect(section(layout, "skipped")).toMatchObject({
      pageCount: 2,
      page: 2,
      items: [skipped[2]],
    });
    expect(section(layout, "could-not-read").pageCount).toBe(1);
  });
});

describe("the page the URL asks for", () => {
  const TREE = { "a.md": doc("stage: DESIGN", separate("OQ-A", 5)) };

  it("clamps a page past the end to the last one", () => {
    setPlanningLimitsForTests({ pageEntries: 2 });
    expect(section(layoutOf(TREE, { unrouted: "9" }), "unrouted").page).toBe(3);
  });

  it.each(["0", "-1", "2.5", "abc", "", "02", "1e1"])(
    "reads %j as page 1",
    (raw) => {
      setPlanningLimitsForTests({ pageEntries: 2 });
      expect(section(layoutOf(TREE, { unrouted: raw }), "unrouted").page).toBe(
        1,
      );
    },
  );

  it("names its pages canonically, page 1 left out", () => {
    setPlanningLimitsForTests({ pageEntries: 2 });
    expect(layoutOf(TREE).pages).toBe("");
    expect(layoutOf(TREE, { unrouted: "2" }).pages).toBe("unrouted=2");
    expect(layoutOf(TREE, { unrouted: "99" }).pages).toBe("unrouted=3");
  });

  it("reads each section's parameter from the URL", () => {
    expect(
      readPageRequest(new URLSearchParams("needs-you=3&waiting=x&other=1")),
    ).toMatchObject({ "needs-you": "3", waiting: "x", unrouted: null });
  });
});

describe("rewriting the URL", () => {
  const TREE = { "a.md": doc("stage: DESIGN", separate("OQ-A", 5)) };
  const rewrite = (query: string) => {
    const search = new URLSearchParams(query);
    const layout = layoutOf(TREE, readPageRequest(search));
    return pageSearch(search, layout)?.toString() ?? null;
  };

  it("leaves a URL that names its pages alone", () => {
    setPlanningLimitsForTests({ pageEntries: 2 });
    expect(rewrite("")).toBeNull();
    expect(rewrite("unrouted=2")).toBeNull();
    expect(rewrite("q=1&unrouted=3")).toBeNull();
  });

  it("clamps, drops a malformed page, an explicit page 1 and a section not shown", () => {
    setPlanningLimitsForTests({ pageEntries: 2 });
    expect(rewrite("unrouted=9")).toBe("unrouted=3");
    expect(rewrite("unrouted=abc")).toBe("");
    expect(rewrite("unrouted=1")).toBe("");
    expect(rewrite("ready=2&unrouted=2")).toBe("unrouted=2");
  });

  it("keeps every other parameter where it was", () => {
    setPlanningLimitsForTests({ pageEntries: 2 });
    expect(rewrite("a=1&unrouted=9&b=2")).toBe("a=1&unrouted=3&b=2");
  });

  it("moves one section to a page", () => {
    const search = new URLSearchParams("a=1&unrouted=3");
    expect(withPage(search, "unrouted", 2).toString()).toBe("a=1&unrouted=2");
    expect(withPage(search, "unrouted", 1).toString()).toBe("a=1");
    expect(withPage(search, "waiting", 4).toString()).toBe(
      "a=1&unrouted=3&waiting=4",
    );
  });
});
