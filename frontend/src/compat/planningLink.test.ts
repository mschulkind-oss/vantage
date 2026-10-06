/**
 * What a 0.8.x viewer makes of a planning link
 * (`docs/reference/planning-index.md` §6.19): a written model of its URL
 * handling, following the `questionOffersTake` precedent in `notation.ts`,
 * which models 0.7.1's review mode. UNMEASURED: no 0.8.x build is run.
 *
 * 0.8.0 and 0.8.1 rewrite the query once the sections are in, with
 * `planningSearch` (PlanningPage.tsx at v0.8.1, lines 1155-1166), and that is
 * all they do with it. Below are that function and `pageSearch`, copied from
 * `git show v0.8.1:frontend/src/lib/planningPages.ts`, with only their types
 * narrowed to what they read. The model asserts that every link the checker
 * prints for a filter the fixture of forms reads passes that rewrite with
 * `filter` untouched, and holds no page parameter for 0.8.x to read against
 * its unfiltered sections.
 */
import { describe, expect, it } from "vitest";
import {
  PLANNING_SECTION_IDS,
  derivePlanningSections,
  planningLink,
  type PlanningRoadmap,
} from "vantage-md/planning";
import { filterForms, filterFormsIndex } from "../test/planning";

/* ---- v0.8.1, frontend/src/lib/planningPages.ts ---- */

const SECTION_IDS = PLANNING_SECTION_IDS;
const ROADMAP_PARAM = "roadmap";

interface PlanningLayout {
  roadmap: string | null;
  sections: readonly { id: string; page: number }[];
}

const routingRoadmaps = (
  roadmaps: readonly PlanningRoadmap[],
): PlanningRoadmap[] => roadmaps.filter((r) => r.state === "routes");

function planningSearch(
  search: URLSearchParams,
  layout: PlanningLayout,
  sections: { roadmaps: readonly PlanningRoadmap[] },
): URLSearchParams | null {
  const paged = pageSearch(search, layout);
  const base = paged ?? search;
  const want =
    routingRoadmaps(sections.roadmaps).length >= 2 ? layout.roadmap : null;
  if (
    base.get(ROADMAP_PARAM) === want &&
    base.getAll(ROADMAP_PARAM).length <= 1
  ) {
    return paged;
  }
  const next = new URLSearchParams(base);
  if (want === null) next.delete(ROADMAP_PARAM);
  else next.set(ROADMAP_PARAM, want);
  return next;
}

function pageSearch(
  search: URLSearchParams,
  layout: PlanningLayout,
): URLSearchParams | null {
  const shown = new Map(layout.sections.map((s) => [s.id, s.page]));
  const next = new URLSearchParams(search);
  let changed = false;
  for (const id of SECTION_IDS) {
    const page = shown.get(id) ?? 1;
    const want = page > 1 ? String(page) : null;
    if (search.get(id) === want && search.getAll(id).length <= 1) continue;
    changed = true;
    if (want === null) next.delete(id);
    else next.set(id, want);
  }
  return changed ? next : null;
}

/* ---- end of v0.8.1 ---- */

/**
 * The query 0.8.x shows once it has rewritten `query`: what it opens with
 * when the rewrite finds nothing to change. Its page parameters are read
 * from the URL, so with none every section is on its first page.
 */
function afterOpen(
  query: string,
  sections: {
    roadmaps: readonly PlanningRoadmap[];
    chosenRoadmap: string | null;
  },
): URLSearchParams {
  const search = new URLSearchParams(query);
  const layout: PlanningLayout = {
    roadmap: sections.chosenRoadmap,
    sections: SECTION_IDS.map((id) => ({
      id,
      page: Number(search.get(id) ?? "1") || 1,
    })),
  };
  return planningSearch(search, layout, sections) ?? search;
}

describe("a 0.8.x viewer given a planning link (§6.19)", () => {
  const forms = filterForms();
  const index = filterFormsIndex(forms);
  const sections = derivePlanningSections(index);
  const routing = routingRoadmaps(sections.roadmaps).length;

  it("is modeled over a tree where two roadmaps route", () => {
    expect(routing).toBe(2);
  });

  it.each(forms.read.map((entry) => entry.canonical))(
    "keeps filter=%s, and reads no page parameter",
    (canonical) => {
      // As the checker prints it: `roadmap=` whenever two or more route.
      const link = planningLink(canonical, {
        roadmap: routing >= 2 ? sections.chosenRoadmap : null,
      });
      const query = link.slice(link.indexOf("?") + 1);
      const before = new URLSearchParams(query);
      for (const id of SECTION_IDS) expect(before.has(id), id).toBe(false);
      const after = afterOpen(query, sections);
      expect(after.getAll("filter")).toEqual([canonical]);
      expect(after.get(ROADMAP_PARAM)).toBe(sections.chosenRoadmap);
      // Nothing to rewrite, so 0.8.x opens the link as it is.
      expect(after.toString()).toBe(before.toString());
    },
  );

  it("keeps filter= through a rewrite it does make", () => {
    // A single routing roadmap: 0.8.x removes `roadmap=`, and re-encodes the
    // rest as a form, which reads back to the same filter.
    const one = {
      roadmaps: sections.roadmaps.slice(0, 1),
      chosenRoadmap: "roadmap.md",
    };
    const canonical = 'path:"docs/my notes.md" path:docs/*.md is:open';
    const link = planningLink(canonical, { roadmap: "roadmap.md" });
    const after = afterOpen(link.slice(link.indexOf("?") + 1), one);
    expect(after.has(ROADMAP_PARAM)).toBe(false);
    expect(after.getAll("filter")).toEqual([canonical]);
  });
});
