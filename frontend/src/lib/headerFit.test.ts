import { describe, expect, it, vi } from "vitest";

import {
  LATE_CLASS,
  PLACED_ATTR,
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
      "subject date labels dirs time repo actions name",
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
    expect(fits.mock.calls.map(([n]) => n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
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
  { lastToolMarginRight = 0 } = {},
) {
  const header = document.createElement("div");
  header.innerHTML =
    '<div class="hdr-lead"></div>' +
    '<div class="hdr-tools"><span class="hdr-subject-text"></span><button></button></div>';
  const lead = header.querySelector(".hdr-lead")!;
  const subject = header.querySelector(".hdr-subject-text")!;
  const lastTool = header.querySelector("button")!;
  lastTool.style.marginRight = `${lastToolMarginRight}px`;
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
  repo: 40,
  actions: 250,
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
    const { header } = fakeHeader(500, needing(1600));
    expect(fitHeader(header)).toBe(YIELD_STEPS.length);
    expect(header.dataset.yield).toBe(
      "subject date labels dirs time repo actions name",
    );
  });

  // After the time, a dozen fixed-width icons and the repository's name still
  // stood between the name and its room: at a 1050px window with the sidebar
  // open the name was elided with all of them at full width.
  it("folds the repository and the toolbar's actions away before the name", () => {
    const { header } = fakeHeader(500, needing(1400));
    expect(fitHeader(header)).toBe(7);
    expect(header.dataset.yield).toBe(
      "subject date labels dirs time repo actions",
    );
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

  // The commit button bleeds its hover background 8px past its text with
  // `-mx-2`, so its border box ends 8px past the end of the room it takes up.
  // When it is the toolbar's last item — a folder, a file with no Markdown
  // actions, a server whose /api/info failed so there is no Path — that 8px
  // read as overflow at any width, and the header took every step at 2400px.
  it("measures an item by the room it takes, negative margin and all", () => {
    const { header } = fakeHeader(1000, () => ({ lead: 400, tools: 1008 }), {
      lastToolMarginRight: -8,
    });
    expect(fitHeader(header)).toBe(0);
  });

  it("still notices an item with a negative margin that does overflow", () => {
    const { header } = fakeHeader(
      1000,
      (taken) => ({ lead: 400, tools: taken.length ? 1000 : 1020 }),
      { lastToolMarginRight: -8 },
    );
    expect(fitHeader(header)).toBe(1);
  });

  it("gives steps back when the header widens", () => {
    const { header, box } = fakeHeader(800, needing(1200));
    expect(fitHeader(header)).toBe(3);
    box.width = 1300;
    expect(fitHeader(header)).toBe(0);
    expect(header.dataset.yield).toBe("");
  });
});

/**
 * A header whose toolbar holds one drawn button and one late item, laid out
 * the way the stylesheet lays it out: the toolbar packs against the far end
 * while its items fit, and runs off it when they do not. The late item takes
 * room only once placed; the subject and the date steps narrow it alone, the
 * labels step narrows the drawn button, and the dirs step the breadcrumb.
 */
function lateHeader(width: number) {
  const header = document.createElement("div");
  header.innerHTML =
    '<div class="hdr-lead"></div>' +
    `<div class="hdr-tools"><button class="${LATE_CLASS}"></button><button class="drawn"></button></div>`;
  const lead = header.querySelector<HTMLElement>(".hdr-lead")!;
  const late = header.querySelector<HTMLElement>(`.${LATE_CLASS}`)!;
  const drawn = header.querySelector<HTMLElement>(".drawn")!;
  const box = { width };
  const GAP = 8;
  const layout = () => {
    const taken = (header.dataset.yield ?? "").split(" ");
    const leadRight = taken.includes("dirs") ? 320 : 400;
    const drawnWidth = taken.includes("labels") ? 30 : 100;
    const lateWidth = taken.includes("date")
      ? 100
      : taken.includes("subject")
        ? 150
        : 300;
    const placed = late.hasAttribute(PLACED_ATTR);
    const content = drawnWidth + (placed ? GAP + lateWidth : 0);
    const start = leadRight + GAP;
    const end = Math.max(box.width, start + content);
    return {
      lead: { left: 0, right: leadRight },
      drawn: { left: end - drawnWidth, right: end },
      late: placed
        ? { left: end - content, right: end - drawnWidth - GAP }
        : { left: 0, right: 0 },
    };
  };
  const rect = (r: { left: number; right: number }) =>
    ({ ...r, top: 0, bottom: 20 }) as DOMRect;
  header.getBoundingClientRect = () => rect({ left: 0, right: box.width });
  lead.getBoundingClientRect = () => rect(layout().lead);
  drawn.getBoundingClientRect = () => rect(layout().drawn);
  late.getBoundingClientRect = () => rect(layout().late);
  const placed = () => late.hasAttribute(PLACED_ATTR);
  return { header, box, placed };
}

// Late data takes only the room the header has left
// (docs/design/planning-index-at-scale.md §11.2). A commit that arrived after
// the first paint once took the `dirs` step, collapsing painted folders and
// moving the file name 80px, or folded painted actions into the "⋯".
describe("fitHeader with a late item", () => {
  it("draws it in the room the header has left", () => {
    const { header, placed } = lateHeader(1000);
    expect(fitHeader(header)).toBe(0);
    expect(placed()).toBe(true);
  });

  it("takes a step for it that acts on it alone", () => {
    // 408px wanted in 392 at no steps; the subject, which only it has, is
    // enough.
    const { header, placed } = lateHeader(800);
    expect(fitHeader(header)).toBe(1);
    expect(header.dataset.yield).toBe("subject");
    expect(placed()).toBe(true);
  });

  it("leaves it undrawn rather than take a step that moves what is drawn", () => {
    // Only the labels step would make room, and it narrows the drawn button.
    const { header, placed } = lateHeader(600);
    expect(fitHeader(header)).toBe(0);
    expect(header.dataset.yield).toBe("");
    expect(placed()).toBe(false);
  });

  it("tries it again at the next fit, and draws it once there is room", () => {
    const { header, box, placed } = lateHeader(600);
    fitHeader(header);
    expect(placed()).toBe(false);
    box.width = 1000;
    expect(fitHeader(header)).toBe(0);
    expect(placed()).toBe(true);
  });

  it("fits it as an ordinary item once it is drawn", () => {
    const { header, box, placed } = lateHeader(800);
    expect(fitHeader(header)).toBe(1);
    // A narrower window is the reader's doing: the header gives way as it
    // always does, and what was drawn stays drawn.
    box.width = 600;
    expect(fitHeader(header)).toBe(3);
    expect(placed()).toBe(true);
  });

  it("drops the mark from an item that is no longer late", () => {
    const { header } = fakeHeader(1000, needing(900));
    const button = header.querySelector("button")!;
    button.setAttribute(PLACED_ATTR, "");
    fitHeader(header);
    expect(button.hasAttribute(PLACED_ATTR)).toBe(false);
  });
});
