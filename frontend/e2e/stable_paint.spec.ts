import { test, expect, type Page } from "@playwright/test";
import { planningIndexReady } from "./planningIndex";

// Late data never moves painted content, on a document's page
// (docs/design/planning-index-at-scale.md §11, and D12 of §19: no layout
// shift after first paint from planning decorations or the header on warm
// loads). Measured the way the browser scores it, with a `layout-shift`
// PerformanceObserver installed before any of the app's scripts run.
//
// Only shifts in the header and the document are held to zero. The file
// tree filling a folder late and review mode's 4px bar are the design's
// "other layout-shift sources" (§11.2, §15), each a fix of its own; they are
// recorded, and printed when an assertion fails, but not asserted.

/** One layout-shift entry, with where each of its sources was. */
interface Shift {
  value: number;
  startTime: number;
  hadRecentInput: boolean;
  sources: { region: string; node: string; from: number[]; to: number[] }[];
}

/** Record every layout shift of every load of this page. */
async function observeShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface Source {
      node: Node | null;
      previousRect: DOMRectReadOnly;
      currentRect: DOMRectReadOnly;
    }
    interface Entry extends PerformanceEntry {
      value: number;
      hadRecentInput: boolean;
      sources: Source[];
    }
    const shifts: Shift[] = [];
    (window as unknown as { __shifts: Shift[] }).__shifts = shifts;
    const elementOf = (node: Node | null) =>
      node instanceof Element ? node : (node?.parentElement ?? null);
    const regionOf = (node: Node | null) => {
      const el = elementOf(node);
      if (!el || !el.isConnected) return "gone";
      if (el.closest('[data-testid="viewer-header"]')) return "header";
      if (el.closest("[data-content-scroll]")) return "document";
      if (el.closest('[data-testid="sidebar"]')) return "sidebar";
      return "other";
    };
    const describe = (node: Node | null) => {
      const el = elementOf(node);
      if (!el) return "(none)";
      const text = (el.textContent ?? "").trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join(".")} "${text}"`;
    };
    const box = (r: DOMRectReadOnly) =>
      [r.x, r.y, r.width, r.height].map(Math.round);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Entry[]) {
        shifts.push({
          value: entry.value,
          startTime: entry.startTime,
          hadRecentInput: entry.hadRecentInput,
          sources: entry.sources.map((source) => ({
            region: regionOf(source.node),
            node: describe(source.node),
            from: box(source.previousRect),
            to: box(source.currentRect),
          })),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

/**
 * The shifts since first contentful paint (the app's shell, on a load), or
 * since `since` (ms on the page's clock), leaving out any the reader's own
 * input caused.
 */
function shiftsAfter(page: Page, since?: number): Promise<Shift[]> {
  return page.evaluate((since) => {
    const fcp =
      performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
    const from = since ?? fcp;
    return (window as unknown as { __shifts: Shift[] }).__shifts.filter(
      (s) => s.startTime >= from && !s.hadRecentInput,
    );
  }, since);
}

/** The page's clock now, for `shiftsAfter`. */
function now(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

/** Every shift with a source in the header or the document must be none. */
function expectNoneInHeaderOrDocument(shifts: Shift[]): void {
  const held = shifts.filter((s) =>
    s.sources.some(
      (src) => src.region === "header" || src.region === "document",
    ),
  );
  const score = held.reduce((sum, s) => sum + s.value, 0);
  expect(
    held,
    `layout shift in the header or the document (${score}); every shift: ${JSON.stringify(shifts, null, 1)}`,
  ).toEqual([]);
}

/** Hold every planning stream until `release` is called. */
async function holdTheStream(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/planning/stream", async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

const prose = (page: Page) => page.locator("[data-content-scroll] .prose");
const header = (page: Page) => page.getByTestId("viewer-header");

test.beforeEach(async ({ page }) => {
  // The size the design's measurements were taken at (§19).
  await page.setViewportSize({ width: 1440, height: 900 });
  await observeShifts(page);
});

// D12: warm loads of the roadmap and of a planning document. The first load
// fills the scan cache; the reload is the warm one, measured from its own first
// paint. The fixture commits only page1.md, so both are untracked files, whose
// header waits on git status before it says so.
test.describe("a warm load moves nothing in the header or the document", () => {
  for (const [path, title] of [
    ["plans/roadmap.md", "Roadmap"],
    ["plans/hub.md", "The hub"],
  ] as const) {
    test(path, async ({ page }) => {
      await page.goto(`/${path}`);
      await planningIndexReady(page);

      await page.reload();
      await expect(
        prose(page).getByRole("heading", { name: title, level: 1 }),
      ).toBeVisible();
      await planningIndexReady(page);
      await expect(header(page).getByText("Untracked file")).toHaveCount(1);
      // Whatever else is still on its way — a tree folder, a late badge —
      // has had its chance to move something.
      await page.waitForTimeout(1000);

      const shifts = await shiftsAfter(page);
      const badges = await prose(page)
        .locator("[data-vantage-planning-badge]")
        .count();
      // Whether the hold caught the warm index, for whoever reads the run.
      console.log(`${path}: ${shifts.length} shifts, ${badges} badges drawn`);
      expectNoneInHeaderOrDocument(shifts);
    });
  }
});

// L3: nothing is shown on a guess.
test("the header says nothing of git before git has answered", async ({
  page,
}) => {
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  await page.route(
    (url) =>
      url.pathname === "/api/git/status" &&
      url.searchParams.get("path") === "page2.md",
    async (route) => {
      await answered;
      await route.continue();
    },
  );
  await page.goto("/page2.md");
  // The hold waits for the answer no longer than its deadline.
  await expect(
    prose(page).getByRole("heading", { name: "Page 2" }),
  ).toBeVisible();
  await expect(header(page).getByTestId("breadcrumb-name")).toHaveAttribute(
    "title",
    "page2.md",
  );
  await expect(header(page).getByText("Untracked file")).toHaveCount(0);
  await expect(header(page).getByTestId("header-time")).toHaveCount(0);

  answer();
  await expect(header(page).getByText("Untracked file")).toHaveCount(1);
});

// §11.2: link badges when the index lands after the document painted.
test("an index that lands late badges only what has not been on screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  const release = await holdTheStream(page);
  await page.goto("/plans/hub-citations.md");
  await expect(
    prose(page).getByRole("heading", { name: "Citations of the hub" }),
  ).toBeVisible();
  // The reader has read down to the first link to the hub, a screen down.
  await prose(page)
    .getByText("Before any section")
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );

  const landed = await now(page);
  release();
  await planningIndexReady(page);

  const links = () =>
    page.evaluate(() => {
      const scroller = document.querySelector("[data-content-scroll]")!;
      const view = scroller.getBoundingClientRect();
      return [
        ...scroller.querySelectorAll(
          '.prose a[data-vantage-link-target="plans/hub.md"]',
        ),
      ].map((a) => {
        const r = a.getBoundingClientRect();
        return {
          text: a.closest("p")?.textContent?.slice(0, 30),
          onScreen: r.bottom > view.top && r.top < view.bottom,
          below: r.top >= view.bottom,
          badged:
            a.nextElementSibling?.hasAttribute("data-vantage-planning-badge") ??
            false,
        };
      });
    });
  const report = await links();
  expect(report.filter((l) => l.onScreen).length).toBeGreaterThan(0);
  expect(
    report.filter((l) => l.onScreen && l.badged),
    JSON.stringify(report),
  ).toEqual([]);
  expect(
    report.filter((l) => l.below && l.badged).length,
    JSON.stringify(report),
  ).toBeGreaterThan(0);
  expectNoneInHeaderOrDocument(await shiftsAfter(page, landed));

  // Reading on, the badges below were there before the reader got to them.
  const last = prose(page)
    .locator('a[data-vantage-link-target="plans/hub.md"]')
    .last();
  await last.scrollIntoViewIfNeeded();
  await expect(
    last.locator("xpath=following-sibling::*[1][@data-vantage-planning-badge]"),
  ).toBeVisible();
});

// §11.2: Referenced by, reserved at first paint and filled when the index
// lands, for a document that is a planning document by its own text.
test.describe("Referenced by fills the line reserved for it", () => {
  const reserved = (page: Page) =>
    page.locator("[data-vantage-referenced-by-reserved]");
  const line = (page: Page) => page.locator("[data-vantage-referenced-by]");

  for (const [path, title, says] of [
    [
      "plans/hub.md",
      "The hub",
      "Referenced by 3 documents · on the roadmap under Later",
    ],
    // No frontmatter: its `oq` directives alone say what it is.
    [
      "tree-badges/questions-only.md",
      "Questions only",
      /open questions not routed by the roadmap$/,
    ],
  ] as const) {
    test(path, async ({ page }) => {
      const release = await holdTheStream(page);
      await page.goto(`/${path}`);
      const title1 = prose(page).getByRole("heading", {
        name: title,
        level: 1,
      });
      await expect(title1).toBeVisible();
      const slot = await reserved(page).boundingBox();
      expect(slot?.height).toBeGreaterThan(0);
      const before = await title1.boundingBox();

      const landed = await now(page);
      release();
      await planningIndexReady(page);
      await expect(line(page)).toBeVisible();
      await expect(line(page).locator("button, div").first()).toHaveText(says);
      await expect(reserved(page)).toHaveCount(0);

      expect(await title1.boundingBox()).toEqual(before);
      expectNoneInHeaderOrDocument(await shiftsAfter(page, landed));
    });
  }
});
