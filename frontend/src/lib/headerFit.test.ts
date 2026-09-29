import { describe, expect, it, vi } from "vitest";

import {
  SUBJECT_FLOOR_PX,
  YIELD_STEPS,
  fewestSteps,
  fitHeader,
  splitExtension,
  yieldAttribute,
} from "./headerFit";

describe("yieldAttribute", () => {
  it("lists the steps taken, first to be taken first", () => {
    expect(yieldAttribute(0)).toBe("");
    expect(yieldAttribute(2)).toBe("subject date");
    expect(yieldAttribute(YIELD_STEPS.length)).toBe(
      "subject date labels dirs time name",
    );
  });
});

describe("fewestSteps", () => {
  it("takes the first count that fits", () => {
    expect(fewestSteps((n) => n >= 2)).toBe(2);
    expect(fewestSteps(() => true)).toBe(0);
  });

  it("ends at the name when nothing short of it fits, without trying it", () => {
    const fits = vi.fn(() => false);
    expect(fewestSteps(fits)).toBe(YIELD_STEPS.length);
    expect(fits.mock.calls.map(([n]) => n)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("splitExtension", () => {
  it("keeps a file's extension apart from its stem", () => {
    expect(splitExtension("durable-agent-storage-classes.md")).toEqual([
      "durable-agent-storage-classes",
      ".md",
    ]);
    expect(splitExtension("archive.tar.gz")).toEqual(["archive.tar", ".gz"]);
  });

  it("treats a leading dot, a trailing dot and no dot as all name", () => {
    expect(splitExtension(".env")).toEqual([".env", ""]);
    expect(splitExtension("notes.")).toEqual(["notes.", ""]);
    expect(splitExtension("Makefile")).toEqual(["Makefile", ""]);
  });

  it("does not keep a 'suffix' longer than an extension is", () => {
    expect(splitExtension("v1.release-candidate")).toEqual([
      "v1.release-candidate",
      "",
    ]);
  });
});

/**
 * A header with the structure `fitHeader` reads, laid out by `layout` rather
 * than by a browser: jsdom does no layout, so the right edges and the subject's
 * widths are whatever `layout` says for the steps currently taken.
 */
function fakeHeader(
  width: number,
  layout: (taken: string[]) => {
    lead: number;
    tools: number;
    subject?: { shown: number; full: number };
  },
) {
  const header = document.createElement("div");
  header.innerHTML =
    '<div class="hdr-lead"></div>' +
    '<div class="hdr-tools"><span class="hdr-subject-text"></span><button></button></div>';
  const lead = header.querySelector(".hdr-lead")!;
  const subject = header.querySelector(".hdr-subject-text")!;
  const lastTool = header.querySelector("button")!;
  const now = () =>
    layout((header.dataset.yield ?? "").split(" ").filter(Boolean));
  const right = (r: number) => () => ({ right: r }) as DOMRect;
  const box = { width };
  header.getBoundingClientRect = () => right(box.width)();
  lead.getBoundingClientRect = () => right(now().lead)();
  subject.getBoundingClientRect = right(0);
  lastTool.getBoundingClientRect = () => right(now().tools)();
  Object.defineProperty(subject, "clientWidth", {
    get: () => now().subject?.shown ?? 0,
  });
  Object.defineProperty(subject, "scrollWidth", {
    get: () => now().subject?.full ?? 0,
  });
  return { header, box };
}

/** How much each step gives back, in this made-up header. */
const SAVES = {
  subject: 150,
  date: 120,
  labels: 300,
  dirs: 80,
  time: 90,
  name: 0,
};

/** A header needing `need` px with nothing taken, and the steps' savings off it. */
const needing =
  (need: number, lead = 400) =>
  (taken: string[]) => {
    const saved = taken.reduce(
      (sum, step) => sum + SAVES[step as keyof typeof SAVES],
      0,
    );
    const dirs = taken.includes("dirs") ? SAVES.dirs : 0;
    return { lead: lead - dirs, tools: need - saved };
  };

describe("fitHeader", () => {
  it("takes nothing when everything fits", () => {
    const { header } = fakeHeader(1000, needing(900));
    expect(fitHeader(header)).toBe(0);
    expect(header.dataset.yield).toBe("");
  });

  it("takes the fewest steps that fit, in order", () => {
    // 1200 needed in 1000: the subject (150) is not enough, the date (120)
    // on top of it is.
    const { header } = fakeHeader(1000, needing(1200));
    expect(fitHeader(header)).toBe(2);
    expect(header.dataset.yield).toBe("subject date");
  });

  it("lets the name go only when every other step is not enough", () => {
    const { header } = fakeHeader(500, needing(1400));
    expect(fitHeader(header)).toBe(YIELD_STEPS.length);
    expect(header.dataset.yield).toBe("subject date labels dirs time name");
  });

  it("notices the leading half overflowing as much as the toolbar", () => {
    // The toolbar would fit, but the breadcrumb alone is past the edge until
    // its folders collapse.
    const { header } = fakeHeader(1000, (taken) => ({
      lead: taken.includes("dirs") ? 950 : 1050,
      tools: 0,
    }));
    expect(fitHeader(header)).toBe(4);
  });

  it("hides the subject once it would be narrower than its floor", () => {
    const { header } = fakeHeader(1000, (taken) => ({
      lead: 400,
      tools: 990,
      subject: taken.includes("subject")
        ? undefined
        : { shown: SUBJECT_FLOOR_PX - 10, full: 300 },
    }));
    expect(fitHeader(header)).toBe(1);
  });

  it("leaves a subject shorter than the floor alone when it is whole", () => {
    const { header } = fakeHeader(1000, () => ({
      lead: 400,
      tools: 990,
      subject: { shown: 40, full: 40 },
    }));
    expect(fitHeader(header)).toBe(0);
  });

  it("gives steps back when the header widens", () => {
    const { header, box } = fakeHeader(800, needing(1200));
    expect(fitHeader(header)).toBe(3);
    box.width = 1300;
    expect(fitHeader(header)).toBe(0);
    expect(header.dataset.yield).toBe("");
  });
});
