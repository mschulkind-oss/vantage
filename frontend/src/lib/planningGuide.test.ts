/**
 * What each planning section means and who acts on it, and the agent requests
 * (`docs/reference/planning-index.md` §6.2, §13.2): `vantage-md`'s guide
 * module, the one copy the page and `vantage-check index` both read.
 * `packages/vantage-check/test/index.test.ts` holds `--request` to the same
 * function, byte for byte.
 */
import { describe, expect, it } from "vitest";
import { ANSWER_PROCESSING_GUIDE, COMPACTION_RULE } from "vantage-md";
import {
  PLANNING_AGENT_SECTION_IDS,
  PLANNING_NOTICES,
  PLANNING_REQUEST_IDS,
  PLANNING_REQUEST_TITLES,
  PLANNING_SECTION_GUIDE,
  PLANNING_SECTION_IDS,
  PLANNING_SECTION_TITLES,
  agentSectionCount,
  agentSectionsWithEntries,
  answeredQuestions,
  derivePlanningSections,
  isPlanningAgentSectionId,
  isPlanningRequestId,
  planningAgentRequest,
  planningRequestCount,
  planningRequestsWithEntries,
  planningSectionGuide,
  sectionExplanation,
  type PlanningConfig,
  type PlanningIndex,
} from "vantage-md/planning";
import { SECTION_IDS } from "./planningPages";
import { indexOf, questionDirective } from "../test/planning";

const OPEN = "\u{1F4AC}";

/** One open question, `**<id>: <title>**`, with its directive. */
const question = (id: string, title = `Question ${id}?`) =>
  [
    `1. ${OPEN} **${id}: ${title}**`,
    "",
    `   ${questionDirective(OPEN, id, "Yes.")}`,
    "",
    "   _Leaning:_ yes.",
    "",
  ].join("\n");

const doc = (header: string, body = "") =>
  `---\n${header}\n---\n\n# Title\n\n${body}\n`;

const STAGES: PlanningConfig["stages"] = {
  SKETCH: "open",
  DESIGN: "open",
  DECIDED: "ready",
  BUILT: "built",
  SUPERSEDED: "done",
  GRADUATED: "done",
};

/** A tree with one entry in each agent section. */
const TREE: Record<string, string> = {
  "roadmap.md": "# Roadmap\n\n- [A's first](docs/a.md#OQ-A1)\n",
  "docs/a.md": doc(
    "status: draft\nstage: DESIGN",
    [question("OQ-A1"), question("OQ-A2")].join("\n"),
  ),
  "docs/c.md": doc("status: accepted\nstage: DECIDED"),
  "docs/d.md": doc("status: accepted\nstage: BUILT"),
  "docs/e.md": doc("status: accepted\nstage: BUILT", question("OQ-E1")),
};

const REPO = "/home/me/project";

function request(
  index: PlanningIndex,
  ids?: Parameters<typeof planningAgentRequest>[2]["ids"],
): string | null {
  return planningAgentRequest(index, derivePlanningSections(index), {
    repository: REPO,
    ...(ids === undefined ? {} : { ids }),
  });
}

describe("the section guide", () => {
  it("titles each section as the user direction of 2026-10-01 has it", () => {
    expect(PLANNING_SECTION_TITLES).toEqual({
      "needs-you": "Needs you",
      unrouted: "Not on a roadmap",
      waiting: "Blocked",
      ready: "Ready to build",
      graduate: "Ready to graduate",
      disagrees: "Stage conflict",
      skipped: "Too large",
      "could-not-read": "Unreadable",
    });
  });

  // The ids are URL parameters and heading anchors (P0): a title may change,
  // an id may not.
  it("keeps the section ids the page's URLs carry, in page order", () => {
    expect(PLANNING_SECTION_IDS).toEqual([
      "needs-you",
      "unrouted",
      "waiting",
      "ready",
      "graduate",
      "disagrees",
      "skipped",
      "could-not-read",
    ]);
    expect([...SECTION_IDS]).toEqual([...PLANNING_SECTION_IDS]);
    for (const id of PLANNING_SECTION_IDS) {
      expect(PLANNING_SECTION_GUIDE[id].id).toBe(id);
    }
  });

  it("says who acts on each, and an agent's sections are the ones with a request", () => {
    expect(
      Object.fromEntries(
        PLANNING_SECTION_IDS.map((id) => [
          id,
          PLANNING_SECTION_GUIDE[id].actor,
        ]),
      ),
    ).toEqual({
      "needs-you": "you",
      unrouted: "agent",
      waiting: "nobody",
      ready: "agent",
      graduate: "agent",
      disagrees: "agent",
      skipped: "you",
      "could-not-read": "you",
    });
    expect(PLANNING_AGENT_SECTION_IDS).toEqual(
      PLANNING_SECTION_IDS.filter(
        (id) => PLANNING_SECTION_GUIDE[id].actor === "agent",
      ),
    );
    expect(isPlanningAgentSectionId("graduate")).toBe(true);
    expect(isPlanningAgentSectionId("needs-you")).toBe(false);
    expect(isPlanningAgentSectionId("Ready to graduate")).toBe(false);
  });

  it("names, for each section, the field of the sections that holds it", () => {
    const sections = derivePlanningSections(indexOf(TREE, { stages: STAGES }));
    for (const id of PLANNING_SECTION_IDS) {
      expect(sections).toHaveProperty(PLANNING_SECTION_GUIDE[id].key);
    }
    expect(PLANNING_SECTION_GUIDE["could-not-read"].key).toBe("unreadable");
  });

  it("explains each section in one line", () => {
    for (const id of PLANNING_SECTION_IDS) {
      const { explanation } = PLANNING_SECTION_GUIDE[id];
      expect(explanation, id).not.toContain("\n");
      expect(explanation, id).toMatch(/^[A-Z].*\.$/);
    }
    expect(PLANNING_SECTION_GUIDE.graduate.explanation).toBe(
      "Built, with no questions left. An agent turns it into a reference doc.",
    );
  });

  // With no roadmap, Needs you is every open question by document (§6.2),
  // and "on this roadmap" would be false.
  it("explains Needs you without a roadmap as what it then holds", () => {
    const routed = derivePlanningSections(indexOf(TREE));
    const none = derivePlanningSections(
      indexOf({ "a.md": doc("status: draft", question("OQ-A1")) }),
    );

    expect(sectionExplanation("needs-you", routed)).toBe(
      "Open or answered questions on this roadmap, in its order. Rule each open one, then Copy answers.",
    );
    expect(sectionExplanation("needs-you", none)).toBe(
      "Open questions, by document. Rule each, then Copy answers.",
    );
    expect(sectionExplanation("waiting", none)).toBe(
      PLANNING_SECTION_GUIDE.waiting.explanation,
    );
    expect(planningSectionGuide(none).map((g) => g.id)).toEqual([
      ...PLANNING_SECTION_IDS,
    ]);
    expect(planningSectionGuide(none)[0]?.explanation).toBe(
      sectionExplanation("needs-you", none),
    );
  });

  it("names the stage sections by their titles in the no-stages notice", () => {
    expect(PLANNING_NOTICES.noStages).toBe(
      "No stages are declared, so Ready to build, Ready to graduate and Stage conflict are not shown. Declare them under [planning.stages] in .vantage.toml.",
    );
  });
});

describe("agent requests", () => {
  const index = indexOf(TREE, { stages: STAGES });

  it("covers every agent section with an entry, then says how to verify", () => {
    expect(request(index)).toBe(
      [
        `Repository: ${REPO}`,
        "",
        "Not on a roadmap (2): open questions no roadmap links to. For each, propose its place on roadmap.md, with a one-clause reason. Do not decide priority: show the proposals to the human, and edit a roadmap only once they confirm the order. An entry is a link to the question's #OQ- anchor, or to its document with no fragment, which places every question in it.",
        "- docs/a.md:14  OQ-A2: Question OQ-A2?",
        "- docs/e.md:8  OQ-E1: Question OQ-E1?",
        "",
        "Ready to build (1): decided, with no open questions. Build each from its plan, then set its stage to BUILT. If one should not be built, ask the human, and only with their agreement retire it with the stage they choose among those with the done role (GRADUATED, SUPERSEDED).",
        "- docs/c.md  (stage DECIDED)",
        "",
        "Ready to graduate (1): built, with no questions left. For each, write a reference document of the system as built, where the repository keeps those: verify every claim against the code, and say what it covers and the commit it was verified at (if you use a system-doc skill, use it). Give it the stage the repository's other reference documents carry (one with the done role: GRADUATED, SUPERSEDED), or none. Then delete the design document and any plan written for it, repoint every link to them and citation of them, in documents, code comments and tests, at the new one, and keep every question id other documents cite resolvable.",
        "- docs/d.md  (stage BUILT)",
        "",
        "Stage conflict (1): the stage says ready or built, but questions are open. For each, find which is wrong, from the document and the code. If the stage is wrong, set it to DESIGN or SKETCH. If a question is a follow-up, propose moving it to a new document. Rule and answer nothing: where a question looks settled, tell the human what you found and ask for a ruling.",
        "- docs/e.md  (stage BUILT; open: OQ-E1)",
        "",
        "Verify: in the repository, run `vantage-check` on every Markdown file you changed, then `vantage-check index`. If the command cannot run, or exits 2 (a configuration error or a refusal), leave `.vantage.toml` as it is: the check is a quality gate, not part of the work.",
      ].join("\n"),
    );
  });

  // Each button's text stands alone: an agent handed one section's request
  // knows the repository and how to check its work.
  it("makes one section's request self-contained", () => {
    const text = request(index, ["graduate"]);

    expect(text?.split("\n")).toEqual([
      `Repository: ${REPO}`,
      "",
      expect.stringMatching(/^Ready to graduate \(1\): built, /),
      "- docs/d.md  (stage BUILT)",
      "",
      expect.stringMatching(/^Verify: /),
    ]);
  });

  it("names a release viewer's release in its checker command, and only then", () => {
    // A request is text an agent acts on, frozen into the viewer that ships
    // it, so a release viewer names itself as the review payload does
    // (docs/design/checker-version-skew.md §5); the CLI and a development
    // build name none, and stay byte-identical.
    const sections = derivePlanningSections(index);
    const last = (viewer?: string) =>
      planningAgentRequest(index, sections, {
        repository: REPO,
        ids: ["graduate"],
        ...(viewer === undefined ? {} : { viewer }),
      })
        ?.split("\n")
        .at(-1);
    expect(last("0.8.0")).toBe(
      "Verify: in the repository, run `VANTAGE_VIEWER=0.8.0 uvx vantage-check` on every Markdown file you changed, then `VANTAGE_VIEWER=0.8.0 uvx vantage-check index`. If the command cannot run, or exits 2 (a configuration error or a refusal), leave `.vantage.toml` as it is: the check is a quality gate, not part of the work.",
    );
    expect(last()).toBe(request(index, ["graduate"])?.split("\n").at(-1));
    expect(last()).toMatch(/^Verify: in the repository, run `vantage-check` /);
  });

  it("covers the asked sections in page order, each once", () => {
    const heads = (text: string | null) =>
      (text ?? "")
        .split("\n")
        .filter((line) => /^[A-Z][a-z][^:]* \(\d+\): /.test(line))
        .map((line) => line.slice(0, line.indexOf(" (")));

    expect(
      heads(request(index, ["disagrees", "unrouted", "disagrees"])),
    ).toEqual(["Not on a roadmap", "Stage conflict"]);
    expect(request(index, ["disagrees", "unrouted"])).toBe(
      request(index, ["unrouted", "disagrees"]),
    );
    expect(heads(request(index))).toEqual(
      PLANNING_AGENT_SECTION_IDS.map((id) => PLANNING_SECTION_TITLES[id]),
    );
  });

  it("is null when no asked section has an entry, and leaves an empty one out", () => {
    const quiet = indexOf(
      {
        "roadmap.md": "# Roadmap\n\n- [A](a.md)\n",
        "a.md": doc("status: draft\nstage: DESIGN", question("OQ-A1")),
        "d.md": doc("status: accepted\nstage: BUILT"),
      },
      { stages: STAGES },
    );
    const sections = derivePlanningSections(quiet);

    expect(agentSectionsWithEntries(sections)).toEqual(["graduate"]);
    expect(agentSectionCount(sections, "graduate")).toBe(1);
    expect(agentSectionCount(sections, "ready")).toBe(0);
    expect(request(quiet, ["ready", "disagrees", "unrouted"])).toBeNull();
    expect(request(quiet)).toContain("Ready to graduate (1)");
    expect(request(quiet)).not.toContain("Ready to build");
    // No stages and no roadmap: nothing for an agent at all.
    expect(
      request(indexOf({ "a.md": doc("status: draft", question("OQ-A1")) })),
    ).toBeNull();
  });

  // The page reads the config through the server's JSON, which sorts the
  // stage table's keys; the CLI reads it in the order the file wrote it.
  it("names stage words in one order, however the table was written", () => {
    const reversed = Object.fromEntries(Object.entries(STAGES ?? {}).reverse());

    expect(request(indexOf(TREE, { stages: reversed }))).toBe(request(index));
  });

  // Ready to build and Ready to graduate keep a document Blocked also lists
  // (§6.2), and `sections.ready` keeps that meaning in the JSON (P0), so the
  // request is where an agent learns not to build ahead of a ruling.
  it("marks a document Blocked also lists, and says to skip it", () => {
    const LOCKED = "\u{1F512}";
    const blocked = indexOf(
      {
        "roadmap.md": "# Roadmap\n\n- [A](docs/a.md)\n",
        "docs/a.md": doc("status: draft\nstage: DESIGN", question("OQ-A1")),
        "docs/b.md": doc(
          "status: accepted\nstage: DECIDED\ndepends-on: a.md#OQ-A1",
          [
            `1. ${LOCKED} **OQ-B1: Upstream first?**`,
            "",
            `   ${questionDirective(LOCKED, "OQ-B1")}`,
            "",
            "   Waits on an upstream release.",
            "",
          ].join("\n"),
        ),
        "docs/c.md": doc("status: accepted\nstage: DECIDED"),
        "docs/d.md": doc("status: accepted\nstage: BUILT\ndepends-on: a.md"),
      },
      { stages: STAGES },
    );
    const sections = derivePlanningSections(blocked);
    expect(sections.ready).toEqual(["docs/b.md", "docs/c.md"]);
    expect(sections.waiting.map((w) => w.kind)).toEqual([
      "document",
      "question",
      "document",
    ]);

    const text = request(blocked, ["ready", "graduate"]) ?? "";
    const lines = text.split("\n");
    expect(lines).toContain(
      "- docs/b.md  (stage DECIDED; blocked on docs/a.md#OQ-A1, \u{1F512} OQ-B1)",
    );
    expect(lines).toContain("- docs/c.md  (stage DECIDED)");
    expect(lines).toContain("- docs/d.md  (stage BUILT; blocked on docs/a.md)");
    for (const head of ["Ready to build (2): ", "Ready to graduate (1): "]) {
      expect(lines.find((line) => line.startsWith(head))).toMatch(
        / Skip any entry marked blocked: it waits on something else first\.$/,
      );
    }
    // With nothing blocked, the clause has nothing to say.
    expect(request(index)).not.toContain("Skip any entry");
  });

  // The done role holds words that differ in meaning (a current reference, a
  // superseded design), so the request never offers them as one choice.
  it("lets the human pick the word a retired design gets, and a reference follows precedent", () => {
    const one = request(
      indexOf(TREE, { stages: { ...STAGES, GRADUATED: "open" } }),
      ["ready", "graduate"],
    );
    expect(one).toContain(
      "only with their agreement retire it by setting its stage to SUPERSEDED.",
    );
    expect(one).toContain(
      "Give it the stage the repository's other reference documents carry (one with the done role: SUPERSEDED), or none.",
    );

    const none = request(
      indexOf(TREE, {
        stages: { DESIGN: "open", DECIDED: "ready", BUILT: "built" },
      }),
      ["ready", "graduate"],
    );
    expect(none).toContain(
      "only with their agreement retire it with a stage that has the done role (declare one under [planning.stages] in .vantage.toml).",
    );
    expect(none).toContain(
      "Give it the stage the repository's other reference documents carry, or none.",
    );
  });

  it("says how to declare a stage word for a role none has", () => {
    const text = request(
      indexOf(TREE, { stages: { DESIGN: "open", DECIDED: "ready" } }),
      ["ready"],
    );

    expect(text).toContain(
      "then set its stage to a word with the built role (declare one under [planning.stages] in .vantage.toml).",
    );
  });

  // A request covers the whole section, never only the page on screen: 30
  // documents is more than one page of rows (`pageRows`, 25).
  it("lists every entry, on every page", () => {
    const tree: Record<string, string> = {};
    for (let i = 10; i < 40; i++) {
      tree[`docs/d${i}.md`] = doc("status: accepted\nstage: BUILT");
    }
    const text = request(indexOf(tree, { stages: STAGES }), ["graduate"]);

    expect(text).toContain("Ready to graduate (30)");
    expect(
      text?.match(/^- docs\/d\d\d\.md {2}\(stage BUILT\)$/gm),
    ).toHaveLength(30);
  });

  it("names a question with no id by its line, and cuts a long title", () => {
    const long = "word ".repeat(40).trim();
    const tree = {
      "roadmap.md": "# Roadmap\n\n- [Other](other.md)\n",
      "other.md": doc("status: draft"),
      "e.md": doc(
        "status: accepted\nstage: BUILT",
        [
          `1. ${OPEN} **${long}?**`,
          "",
          '   <!-- vantage: oq leaning="Yes." -->',
          "",
          "   _Leaning:_ yes.",
          "",
          question("OQ-E2"),
        ].join("\n"),
      ),
    };
    const text = request(indexOf(tree, { stages: STAGES })) ?? "";

    expect(text).toContain("- e.md  (stage BUILT; open: line 8, OQ-E2)");
    // With no bold id, a question is titled by its whole item, its marker
    // aside, cut to one line of 100 characters.
    const item = text.split("\n").find((line) => line.startsWith("- e.md:8"));
    expect(item).toBe(`- e.md:8  ${"word ".repeat(20).trim()}…`);
  });
});

describe("the compact request", () => {
  const DONE = "✅";
  /** One ruled (✅) question, with its directive. */
  const ruled = (id: string) =>
    [
      `1. ${DONE} **${id}: Question ${id}?**`,
      "",
      `   ${questionDirective(OPEN, id, "Yes.")}`,
      "",
      "   _Leaning:_ yes.",
      "",
    ].join("\n");
  const TREE_WITH_RULED: Record<string, string> = {
    ...TREE,
    "docs/b.md": doc(
      "status: draft\nstage: DESIGN",
      [ruled("OQ-B1"), ruled("OQ-B2")].join("\n"),
    ),
  };
  const index = indexOf(TREE_WITH_RULED, { stages: STAGES });
  const sections = derivePlanningSections(index);

  it("is a request, not a section: the section ids and the agent sections are as they were", () => {
    expect(PLANNING_REQUEST_IDS).toEqual([
      "unrouted",
      "ready",
      "graduate",
      "disagrees",
      "compact",
    ]);
    expect(PLANNING_AGENT_SECTION_IDS).not.toContain("compact");
    expect(PLANNING_SECTION_IDS).not.toContain("compact");
    expect(isPlanningAgentSectionId("compact")).toBe(false);
    expect(isPlanningRequestId("compact")).toBe(true);
    expect(isPlanningRequestId("needs-you")).toBe(false);
    expect(PLANNING_REQUEST_TITLES.compact).toBe("Compact");
    expect(PLANNING_REQUEST_TITLES.ready).toBe("Ready to build");
  });

  it("counts each request's items, ✅ questions for compact", () => {
    expect(
      Object.fromEntries(
        PLANNING_REQUEST_IDS.map((id) => [
          id,
          planningRequestCount(index, sections, id),
        ]),
      ),
    ).toEqual({ unrouted: 2, ready: 1, graduate: 1, disagrees: 1, compact: 2 });
    expect(answeredQuestions(index).map((ref) => ref.id)).toEqual([
      "OQ-B1",
      "OQ-B2",
    ]);
    expect(planningRequestsWithEntries(index, sections)).toEqual([
      ...PLANNING_REQUEST_IDS,
    ]);
    expect(
      planningRequestsWithEntries(index, sections, ["compact", "ready"]),
    ).toEqual(["ready", "compact"]);
    // The ✅ questions stay in Needs you, which the sections never hand over.
    expect(sections.needsYou.map((q) => q.id)).not.toContain("OQ-B1");
  });

  it("lists every ✅ question by document, line, id and title, and restates the style guide's compaction rule", () => {
    const text = planningAgentRequest(index, sections, {
      repository: REPO,
      ids: ["compact"],
    });

    expect(text?.split("\n").slice(0, -1).join("\n")).toBe(
      [
        `Repository: ${REPO}`,
        "",
        `Compact (2): questions the human has ruled (✅), whose rulings are still in their question directives. Compact each in its document. ${COMPACTION_RULE} An entry is where the question's item starts.`,
        "- docs/b.md:8  OQ-B1: Question OQ-B1?",
        "- docs/b.md:14  OQ-B2: Question OQ-B2?",
        "",
      ].join("\n"),
    );
    expect(text?.split("\n").at(-1)).toMatch(/^Verify: /);
    // One copy: the style guide's bullet says exactly what the request says.
    expect(ANSWER_PROCESSING_GUIDE).toContain(COMPACTION_RULE);
    for (const part of [
      "Decision Ledger row",
      "exact ID",
      "Remove the question's directive",
      "repair inbound Markdown links",
      "`depends-on` fragments",
    ]) {
      expect(text).toContain(part);
    }
  });

  it("comes after the sections in the default request, and ends with the same verification line", () => {
    const all = planningAgentRequest(index, sections, { repository: REPO });
    const only = planningAgentRequest(index, sections, {
      repository: REPO,
      ids: ["graduate", "compact"],
    });

    expect(all?.indexOf("Stage conflict (")).toBeLessThan(
      all?.indexOf("Compact (") ?? -1,
    );
    expect(all?.split("\n").at(-1)).toBe(only?.split("\n").at(-1));
    expect(only).toMatch(/Ready to graduate \(1\)[^]*\nCompact \(2\)/);
  });

  it("is left out when no question is ✅, as an empty section is", () => {
    const none = indexOf(TREE, { stages: STAGES });
    const noneSections = derivePlanningSections(none);

    expect(planningRequestCount(none, noneSections, "compact")).toBe(0);
    expect(request(none)).not.toContain("Compact");
    expect(request(none, ["compact"])).toBeNull();
  });

  it("lists the ✅ questions a filter's test keeps, and keeps the Filter: line", () => {
    const keeps = (q: { id: string | null }) => q.id === "OQ-B2";
    const text = planningAgentRequest(index, sections, {
      repository: REPO,
      ids: ["compact"],
      filter: { text: "OQ-B2", unfiltered: sections, keeps },
    });

    expect(text).toContain("Filter: `OQ-B2`.");
    expect(text).toContain("Compact (1):");
    expect(text).toContain("- docs/b.md:14  OQ-B2");
    expect(text).not.toContain("OQ-B1");
    expect(planningRequestCount(index, sections, "compact", keeps)).toBe(1);
  });
});
