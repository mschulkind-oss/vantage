/**
 * The planning page's layout (`docs/design/planning-to-do-list.md` §3),
 * laid out from the index alone. Every limit is proven by configuring it down
 * in the limits module, never by growing a tree to a default.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  PLANNING_SECTION_GUIDE,
  PLANNING_SECTION_IDS,
  PLANNING_SECTION_TITLES,
  planningLink,
  sectionExplanation,
  readPastedPlanningLink,
  type PlanningConfig,
} from "vantage-md/planning";
import {
  SECTION_IDS,
  SECTION_TITLES,
  chooseRoadmap,
  filterSummaryOf,
  filterValue,
  filteredSectionsOf,
  MAINTENANCE_TITLES,
  layoutPlanningPage,
  listedDocuments,
  placeComment,
  listedQuestions,
  planningQuery,
  planningSearch,
  readFilterRequest,
  readRememberedRoadmap,
  readRoadmapRequest,
  rememberRoadmap,
  sectionsOf,
  understoodFilter,
  withFilter,
  withoutPages,
  withRoadmap,
  type CardEntry,
} from "./planningPages";
import { setPlanningLimitsForTests } from "../planningScan/limits";
import {
  filterForms,
  filterFormsIndex,
  indexOf,
  questionDirective,
  sectionEntryKeys,
} from "../test/planning";

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
      `   ${questionDirective(marker, `${prefix}${i + 1}`)}`,
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

/** Every tree has a roadmap that routes nothing, so none of its questions is on a roadmap. */
const ROADMAP = { "roadmap.md": "# Roadmap\n" };

function layoutOf(
  tree: Record<string, string>,
  config: Partial<PlanningConfig> = { stages: STAGES },
  pageSize = 10,
) {
  const index = indexOf({ ...ROADMAP, ...tree }, config);
  return layoutPlanningPage(index, sectionsOf(index), pageSize);
}

const ids = (entries: readonly CardEntry[]) =>
  entries.map((e) => (e.kind === "question" ? e.question.id : `doc ${e.path}`));

describe("each section's title", () => {
  it("is the shared planning module's, which vantage-check index prints", () => {
    expect(SECTION_IDS).toBe(PLANNING_SECTION_IDS);
    expect(SECTION_TITLES).toBe(PLANNING_SECTION_TITLES);
    expect(SECTION_TITLES.graduate).toBe(PLANNING_SECTION_GUIDE.graduate.title);
  });
});

describe("the layout (planning-to-do-list.md §3)", () => {
  const routed = (ids: string[], marker = OPEN) => ({
    "roadmap.md": `# Roadmap\n\n${ids.map((id) => `- [It](a.md#${id})`).join("\n")}\n`,
    "a.md": doc("stage: DESIGN", separate("OQ-A", ids.length, 0, marker)),
  });

  it("lists Needs you's open questions in the roadmap's order, whatever the page size, and names the size", () => {
    const tree = routed(["OQ-A1", "OQ-A2", "OQ-A3"]);
    const index = indexOf(tree, { stages: STAGES });
    const layout = layoutPlanningPage(index, sectionsOf(index), 2);
    expect(ids(layout.needsYou)).toEqual(["OQ-A1", "OQ-A2", "OQ-A3"]);
    expect(layout.pageSize).toBe(2);
    expect(layout.needsYouExplanation).toBe(
      sectionExplanation("needs-you", sectionsOf(index)),
    );
  });

  it("puts a ✅ question under Maintenance, to fold into the ledger, by document and line", () => {
    const tree = {
      "roadmap.md": "# Roadmap\n\n- [B](b.md)\n- [A](a.md)\n",
      "a.md": doc("stage: DESIGN", separate("OQ-A", 2, 0, "✅")),
      "b.md": doc("stage: DESIGN", separate("OQ-B", 1, 0, "✅")),
    };
    const index = indexOf(tree, { stages: STAGES });
    const layout = layoutPlanningPage(index, sectionsOf(index), 10);
    expect(layout.needsYou).toEqual([]);
    const compact = layout.maintenance.find((k) => k.id === "compact")!;
    expect(compact.kind).toBe("questions");
    expect(ids(compact.items as CardEntry[])).toEqual([
      "OQ-A1",
      "OQ-A2",
      "OQ-B1",
    ]);
  });

  it("puts Blocked, and Maintenance's kinds in their order, leaving out an empty one", () => {
    const layout = layoutOf({
      "a.md": doc("stage: DESIGN", separate("OQ-A", 1)),
      "b.md": doc("stage: DESIGN", separate("OQ-B", 1, 0, BLOCKED)),
      "built.md": doc("stage: BUILT", "Built."),
      "ready.md": doc("stage: DECIDED", "Decided."),
    });
    expect(ids(layout.blocked)).toEqual(["OQ-B1"]);
    expect(layout.maintenance.map((k) => k.id)).toEqual([
      "unrouted",
      "ready",
      "graduate",
    ]);
    expect(MAINTENANCE_TITLES.compact).toBe("To fold into the ledger");
  });

  it("keeps every entry of a long list: the groups have no pages", () => {
    const layout = layoutOf(
      { "a.md": doc("stage: DESIGN", separate("OQ-A", 30)) },
      { stages: STAGES },
      10,
    );
    const unrouted = layout.maintenance.find((k) => k.id === "unrouted")!;
    expect(unrouted.items).toHaveLength(30);
  });

  it("drops every section-id parameter, which names no page any more (§7)", () => {
    expect(withoutPages(new URLSearchParams("a=1&b=2"))).toBeNull();
    expect(
      withoutPages(
        new URLSearchParams("needs-you=3&a=1&waiting=2&unrouted=x"),
      )?.toString(),
    ).toBe("a=1");
  });
});

describe("placement (planning-index.md §6.7)", () => {
  const NESTED = doc(
    "stage: DESIGN",
    [
      `1. ${OPEN} **OQ-O1: The outer question?**`,
      "",
      '   <!-- vantage: oq id=OQ-O1 leaning="Yes." -->',
      "",
      "   _Leaning:_ yes.",
      "",
      `   1. ${OPEN} **OQ-I1: The inner question?**`,
      "",
      '      <!-- vantage: oq id=OQ-I1 leaning="No." -->',
      "",
      "      _Leaning:_ no.",
      "",
      "   And the outer one goes on.",
      "",
      "Not in any question.",
      "",
    ].join("\n"),
  );
  const index = indexOf({ ...ROADMAP, "a.md": NESTED }, { stages: STAGES });
  const questions = listedQuestions(index, sectionsOf(index));
  const outer = questions.find((q) => q.id === "OQ-O1")!;
  const inner = questions.find((q) => q.id === "OQ-I1")!;

  it("puts a comment on the innermost unit that holds its line", () => {
    expect(inner.unitLine).toBeGreaterThan(outer.unitLine);
    expect(inner.unitEndLine).toBeLessThan(outer.unitEndLine);
    expect(placeComment(questions, inner.line)?.id).toBe("OQ-I1");
    expect(placeComment(questions, inner.unitEndLine)?.id).toBe("OQ-I1");
    expect(placeComment(questions, outer.line)?.id).toBe("OQ-O1");
    expect(placeComment(questions, outer.unitEndLine)?.id).toBe("OQ-O1");
  });

  it("puts a comment outside every unit on none", () => {
    expect(placeComment(questions, outer.unitEndLine + 2)).toBeUndefined();
    expect(placeComment(questions, 1)).toBeUndefined();
    expect(placeComment([inner], outer.line)).toBeUndefined();
  });
});

describe("the chosen roadmap (planning-index.md §6.8)", () => {
  // Both found by name. roadmap.md routes a.md's questions, and
  // docs/plans/roadmap.md b.md's and one of a.md's.
  const TWO = {
    "roadmap.md": "# Roadmap\n\n- [A](a.md)\n",
    "docs/plans/roadmap.md":
      "# Plans\n\n- [B](../../b.md)\n- [A2](../../a.md#OQ-A2)\n",
    "a.md": doc("stage: DESIGN", separate("OQ-A", 2)),
    "b.md": doc("stage: DESIGN", separate("OQ-B", 3)),
    "c.md": doc("stage: DESIGN", separate("OQ-C", 1)),
  };
  const NESTED = "docs/plans/roadmap.md";
  const index = indexOf(TWO, { stages: STAGES });
  const { roadmaps } = sectionsOf(index);

  it("is the URL's, else the remembered one, else the nearest the root, each while it routes", () => {
    expect(chooseRoadmap(roadmaps, null, null)).toBe("roadmap.md");
    expect(chooseRoadmap(roadmaps, NESTED, "roadmap.md")).toBe(NESTED);
    expect(chooseRoadmap(roadmaps, null, NESTED)).toBe(NESTED);
    expect(chooseRoadmap(roadmaps, "a.md", NESTED)).toBe(NESTED);
    expect(chooseRoadmap(roadmaps, "a.md", "gone/roadmap.md")).toBe(
      "roadmap.md",
    );
    expect(chooseRoadmap([], NESTED, NESTED)).toBeNull();
  });

  it("lays Needs you out in the chosen roadmap's order, and names it in the layout", () => {
    const chosen = sectionsOf(index, NESTED);
    const layout = layoutPlanningPage(index, chosen, 10);
    expect(layout.roadmap).toBe(NESTED);
    expect(ids(layout.needsYou)).toEqual(["OQ-B1", "OQ-B2", "OQ-B3", "OQ-A2"]);
    expect(layoutPlanningPage(index, sectionsOf(index), 10).roadmap).toBe(
      "roadmap.md",
    );
    // One derivation per index and chosen roadmap, the default's by name too.
    expect(sectionsOf(index, NESTED)).toBe(chosen);
    expect(sectionsOf(index, "roadmap.md")).toBe(sectionsOf(index));
    expect(sectionsOf(index, "c.md")).toBe(sectionsOf(index));
  });

  it("lists for Copy answers the questions of every roadmap, whichever is chosen", () => {
    const ids = (roadmap: string | null) =>
      listedQuestions(index, sectionsOf(index, roadmap))
        .map((q) => q.id)
        .sort();
    expect(ids(null)).toEqual(ids(NESTED));
    expect(ids(null)).toEqual([
      "OQ-A1",
      "OQ-A2",
      "OQ-B1",
      "OQ-B2",
      "OQ-B3",
      "OQ-C1",
    ]);
  });

  it("reads the URL's roadmap, dropping one leading ./", () => {
    expect(readRoadmapRequest(new URLSearchParams(""))).toBeNull();
    expect(readRoadmapRequest(new URLSearchParams("roadmap="))).toBeNull();
    expect(
      readRoadmapRequest(
        new URLSearchParams("roadmap=docs%2Fplans%2Froadmap.md"),
      ),
    ).toBe(NESTED);
    expect(
      readRoadmapRequest(
        new URLSearchParams("roadmap=./docs/plans/roadmap.md"),
      ),
    ).toBe(NESTED);
  });

  const rewrite = (query: string, tree: Record<string, string> = TWO) => {
    const search = new URLSearchParams(query);
    const at = indexOf(tree, { stages: STAGES });
    const chosen = chooseRoadmap(
      sectionsOf(at).roadmaps,
      readRoadmapRequest(search),
      null,
    );
    const sections = sectionsOf(at, chosen);
    const layout = layoutPlanningPage(at, sections, 10);
    return planningSearch(search, layout, sections)?.toString() ?? null;
  };

  it("writes the chosen roadmap into the URL with two or more, and leaves one that names it", () => {
    expect(rewrite("")).toBe("roadmap=roadmap.md");
    expect(rewrite("a=1")).toBe("a=1&roadmap=roadmap.md");
    expect(rewrite("roadmap=docs%2Fplans%2Froadmap.md")).toBeNull();
    expect(rewrite("roadmap=docs/plans/roadmap.md")).toBeNull();
    expect(rewrite("roadmap=c.md&a=1")).toBe("roadmap=roadmap.md&a=1");
    expect(rewrite("roadmap=roadmap.md&roadmap=roadmap.md")).toBe(
      "roadmap=roadmap.md",
    );
  });

  it("drops an old page parameter and rewrites the roadmap in one", () => {
    expect(rewrite("needs-you=9&roadmap=c.md")).toBe("roadmap=roadmap.md");
  });

  it("removes the roadmap from the URL with fewer than two", () => {
    const { [NESTED]: _, ...one } = TWO;
    void _;
    expect(rewrite("roadmap=roadmap.md&a=1", one)).toBe("a=1");
    expect(rewrite("a=1", one)).toBeNull();
  });

  it("picks a roadmap: replaced, an old Needs you page gone, the rest kept", () => {
    const search = new URLSearchParams(
      "a=1&needs-you=3&roadmap=roadmap.md&waiting=2",
    );
    expect(withRoadmap(search, NESTED).toString()).toBe(
      "a=1&roadmap=docs%2Fplans%2Froadmap.md&waiting=2",
    );
  });

  it("remembers a pick per repository", () => {
    localStorage.clear();
    expect(readRememberedRoadmap("")).toBeNull();
    rememberRoadmap("", NESTED);
    rememberRoadmap("alpha", "roadmap.md");
    expect(readRememberedRoadmap("")).toBe(NESTED);
    expect(readRememberedRoadmap("alpha")).toBe("roadmap.md");
    expect(localStorage.getItem("vantage:planningRoadmap:")).toBe(NESTED);
    expect(localStorage.getItem("vantage:planningRoadmap:alpha")).toBe(
      "roadmap.md",
    );
    localStorage.clear();
  });
});

describe("the planning filter (planning-index.md §6.16)", () => {
  const forms = filterForms();
  const index = filterFormsIndex(forms);
  const DESIGN = "path:/docs/design/a.md";

  it("derives the filtered sections once per index, roadmap and filter, from the whole index's", () => {
    const filtered = sectionsOf(index, null, DESIGN);
    expect(sectionsOf(index, null, DESIGN)).toBe(filtered);
    // Under the roadmap the default is, asked for by name or by none.
    expect(sectionsOf(index, "roadmap.md", DESIGN)).toBe(filtered);
    expect(sectionsOf(index, "x/roadmap.md", DESIGN)).not.toBe(filtered);
    expect(sectionsOf(index, null, "is:open")).not.toBe(filtered);
    // No filter, and one not understood, are the derivation itself.
    expect(sectionsOf(index, null, "")).toBe(sectionsOf(index));
    expect(sectionsOf(index, null, "is:closed")).toBe(sectionsOf(index));
    expect(filteredSectionsOf(index, null, "")).toBeNull();
    expect(filteredSectionsOf(index, null, 'a"b"')).toBeNull();
    // A word is a filter: it searches.
    expect(sectionEntryKeys(sectionsOf(index, null, "outer"))).toEqual([
      "needs-you docs/design/a.md#OQ-A3",
    ]);
    // What the fixture says the text keeps, with its notice's numbers.
    const read = forms.read.find((r) => r.text === DESIGN)!;
    expect(sectionEntryKeys(filtered)).toEqual(read.keeps);
    expect(filterSummaryOf(index, null, DESIGN)).toBe(
      filteredSectionsOf(index, null, DESIGN)!.summary,
    );
    expect(filterSummaryOf(index, null, DESIGN)?.canonical).toBe(DESIGN);
  });

  // Typing applies a text per keystroke (§6.16), so a derivation keeps only
  // the filters used last, and the one on screen, used with every layout,
  // stays among them.
  it("keeps the filtered sections of the last sixteen filters per derivation", () => {
    const shown = sectionsOf(index, null, DESIGN);
    const typed = sectionsOf(index, null, "w0");
    for (let i = 1; i <= 40; i++) {
      sectionsOf(index, null, `w${i}`);
      expect(sectionsOf(index, null, DESIGN)).toBe(shown);
    }
    const again = sectionsOf(index, null, "w0");
    expect(again).not.toBe(typed);
    expect(again).toEqual(typed);
    for (let i = 25; i <= 40; i++) {
      expect(filteredSectionsOf(index, null, `w${i}`)).not.toBeNull();
    }
  });

  it("keeps every fixture text's entries, under the default roadmap", () => {
    for (const { canonical, keeps } of forms.read) {
      expect(
        sectionEntryKeys(sectionsOf(index, null, canonical)),
        canonical,
      ).toEqual(keeps);
    }
  });

  it("parses each text once, so its matchers are compiled once", () => {
    const parsed = understoodFilter(DESIGN);
    expect(parsed?.canonical).toBe(DESIGN);
    expect(understoodFilter(DESIGN)).toBe(parsed);
    expect(understoodFilter("")).toBeNull();
    expect(understoodFilter("path:")).toBeNull();
  });

  it("names its filter in the layout, which a not understood or no filter leaves empty", () => {
    const layout = layoutPlanningPage(
      index,
      sectionsOf(index, null, DESIGN),
      10,
      DESIGN,
    );
    expect(layout.filter).toBe(DESIGN);
    expect(layout.needsYou.length).toBeGreaterThan(0);
    expect(layout.blocked.length).toBeGreaterThan(0);
    expect(layoutPlanningPage(index, sectionsOf(index), 10).filter).toBe("");
  });

  it("reads every filter value, joined with a space", () => {
    expect(readFilterRequest(new URLSearchParams(""))).toBe("");
    expect(
      readFilterRequest(
        new URLSearchParams("filter=path:a&x=1&filter=is%3Aopen"),
      ),
    ).toBe("path:a is:open");
    expect(readFilterRequest(new URLSearchParams("filter=path:a+b"))).toBe(
      "path:a b",
    );
  });

  it("writes a text as its canonical text, as typed when not understood, and as nothing when empty", () => {
    expect(filterValue("path:./docs/x.md  is:open")).toBe(
      "path:/docs/x.md is:open",
    );
    expect(filterValue(' a"b" ')).toBe(' a"b" ');
    expect(filterValue(' "OR" ')).toBe("OR");
    expect(filterValue(" \t ")).toBe("");
    expect(filterValue("")).toBe("");
  });

  describe("the in-place rewrite", () => {
    const rewrite = (query: string) => {
      const search = new URLSearchParams(query);
      const asked = filterValue(readFilterRequest(search));
      const applied = understoodFilter(asked) === null ? "" : asked;
      const sections = sectionsOf(index, null, applied);
      const layout = layoutPlanningPage(index, sections, 10, applied);
      const next = planningSearch(search, layout, sections);
      return next === null ? null : planningQuery(next);
    };

    it("leaves a canonical filter alone, however it is encoded", () => {
      expect(
        rewrite("filter=path:docs/design/a.md&roadmap=roadmap.md"),
      ).toBeNull();
      expect(
        rewrite("filter=path%3Adocs%2Fdesign%2Fa.md&roadmap=roadmap.md"),
      ).toBeNull();
    });

    it("writes an understood filter canonically, as one parameter where the first was", () => {
      expect(
        rewrite(
          "x=1&filter=path:./docs/design/a.md&roadmap=roadmap.md&filter=is:open",
        ),
      ).toBe("x=1&filter=path:/docs/design/a.md+is:open&roadmap=roadmap.md");
    });

    it("removes an empty filter", () => {
      expect(rewrite("filter=&roadmap=roadmap.md")).toBe("roadmap=roadmap.md");
      expect(rewrite("filter=+&filter=&roadmap=roadmap.md")).toBe(
        "roadmap=roadmap.md",
      );
    });

    it("leaves one it does not understand exactly as written", () => {
      expect(
        rewrite("filter=is:closed&roadmap=roadmap.md&filter=path:a.md"),
      ).toBeNull();
      expect(rewrite("filter=a%22b%22&roadmap=roadmap.md")).toBeNull();
      // A word is understood, and written canonically like any other term.
      expect(rewrite('filter=%22Path:a.md%22+"outer"&roadmap=roadmap.md')).toBe(
        "filter=%22Path:a.md%22+outer&roadmap=roadmap.md",
      );
    });

    it("drops the space id only when told to, and keeps it as written otherwise (planning-index.md §13.6)", () => {
      const keep = (query: string, dropSpace: boolean) => {
        const search = new URLSearchParams(query);
        const asked = filterValue(readFilterRequest(search));
        const applied = understoodFilter(asked) === null ? "" : asked;
        const sections = sectionsOf(index, null, applied);
        const layout = layoutPlanningPage(index, sections, 10, applied);
        const next = planningSearch(search, layout, sections, dropSpace);
        return next === null ? null : planningQuery(next);
      };
      const link =
        "filter=path:/docs/design/a.md&roadmap=roadmap.md&space=q4zmuykxw2a7hbne";
      expect(keep(link, false)).toBeNull();
      expect(keep(link, true)).toBe(
        "filter=path:/docs/design/a.md&roadmap=roadmap.md",
      );
      // Every one of them, with the rest of the rewrite in the same one.
      expect(
        keep(
          "space=a&filter=path:./docs/design/a.md&space=b&roadmap=roadmap.md",
          true,
        ),
      ).toBe("filter=path:/docs/design/a.md&roadmap=roadmap.md");
      expect(
        keep("filter=path:/docs/design/a.md&roadmap=roadmap.md", true),
      ).toBeNull();
    });

    it("drops the pages in the same rewrite as the filter", () => {
      expect(
        rewrite(
          "filter=path:/docs/design/a.md&needs-you=9&waiting=2&roadmap=roadmap.md",
        ),
      ).toBe("filter=path:/docs/design/a.md&roadmap=roadmap.md");
    });
  });

  it("applies a text: every page parameter gone, the roadmap and the rest kept", () => {
    const search = new URLSearchParams(
      "needs-you=2&x=1&roadmap=roadmap.md&waiting=3&filter=path:a.md",
    );
    expect(planningQuery(withFilter(search, "path:./docs/a.md is:open"))).toBe(
      "filter=path:/docs/a.md+is:open&x=1&roadmap=roadmap.md",
    );
    expect(planningQuery(withFilter(search, "  "))).toBe(
      "x=1&roadmap=roadmap.md",
    );
    expect(withFilter(search, 'a"b" OR').get("filter")).toBe('a"b" OR');
    // A pasted link's roadmap.
    expect(planningQuery(withFilter(search, "is:open", "x/roadmap.md"))).toBe(
      "filter=is:open&x=1&roadmap=x%2Froadmap.md",
    );
  });

  it("writes the filter first, so the address is the agent's link where a roadmap is named (criterion 3)", () => {
    // The page names the roadmap once two or more route, before any filter.
    for (const [search, roadmap] of [
      ["roadmap=roadmap.md", "roadmap.md"],
      ["roadmap=roadmap.md&filter=is:open", "roadmap.md"],
      ["", null],
    ] as const) {
      expect(
        `/.vantage/planning?${planningQuery(withFilter(new URLSearchParams(search), "path:docs/design/a.md is:open"))}`,
        search,
      ).toBe(planningLink("path:docs/design/a.md is:open", { roadmap }));
    }
  });

  it("never ends a query with a character a pasted link's end drops", () => {
    for (const [search, query] of [
      ["filter=path:docs/x_", "filter=path:docs/x%5F"],
      ["filter=path:docs/v1.", "filter=path:docs/v1%2E"],
      ["filter=path:docs/x_&needs-you=2", "filter=path:docs/x_&needs-you=2"],
      ["needs-you=2&filter=path:docs/x_", "needs-you=2&filter=path:docs/x%5F"],
    ] as const) {
      const written = planningQuery(new URLSearchParams(search));
      expect(written, search).toBe(query);
      expect(new URLSearchParams(written).get("filter")).toBe(
        new URLSearchParams(search).get("filter"),
      );
      expect(
        readPastedPlanningLink(`Open /.vantage/planning?${written}.`)?.filter,
      ).toBe(new URLSearchParams(search).get("filter"));
    }
  });

  it("writes the filter as a planning link does, and the rest as the page does", () => {
    const search = new URLSearchParams();
    search.append("roadmap", "docs/plans/roadmap.md");
    search.append("filter", 'path:docs/*.md path:"my notes.md" is:open');
    search.append("q", "a b&c");
    const query = planningQuery(search);
    expect(query).toBe(
      "roadmap=docs%2Fplans%2Froadmap.md&filter=path:docs/%2A.md+path:%22my+notes.md%22+is:open&q=a+b%26c",
    );
    // Both read back to the same values.
    expect([...new URLSearchParams(query)]).toEqual([...search]);
    expect(planningQuery(new URLSearchParams())).toBe("");
  });

  it("lists every document the sections list, rows included, for the second reviews request", () => {
    const sections = sectionsOf(index);
    const listed = listedDocuments(index, sections);
    // Question documents, then each Blocked and stage row's.
    expect(new Set(listed)).toEqual(
      new Set([
        ...listedQuestions(index, sections).map((q) => q.path),
        "docs/design/a-plan.md",
        "notes/b.md",
        "notes/e.md",
        "notes/f.md",
      ]),
    );
    expect(listed).toHaveLength(new Set(listed).size);
    // Too large and Unreadable are no documents with reviews.
    expect(listed).not.toContain("docs/big.md");
    expect(listed).not.toContain("notes/broken.md");
  });
});
