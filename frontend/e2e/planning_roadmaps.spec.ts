import { test, expect, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openWithIndex } from "./planningIndex";

// Several roadmaps on the planning page, in a real browser, against a real
// server (docs/reference/planning-index.md §6.8, §7). The fixture is
// `fixtures/multi_roadmap/`, which no other spec reads: its .vantage.toml sets
// no roadmap, so the server and the scan worker both find `roadmap.md` and
// `docs/plans/roadmap.md` by name. roadmap.md routes alpha.md's two questions;
// docs/plans/roadmap.md routes beta.md's three and alpha.md's second; nothing
// routes gamma.md's one.
//
// Every other spec keeps test_repo and its one listed roadmap, so this one
// starts a server of its own over the fixture, on a free port, and sends the
// page's API requests to it, the scan worker's included. The live-reload
// socket is answered here and never opened: nothing this spec does needs a
// push, and test_repo's server must not send it one.

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");
const FIXTURE = path.join(here, "fixtures/multi_roadmap");
const NESTED = "docs/plans/roadmap.md";

let server: ChildProcess | null = null;
let home = "";
let backend = "";

/** A port nothing is listening on, as the kernel hands one out. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

test.describe("several roadmaps", () => {
  // One server for the file, started once: its tests share a worker.
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    // Its own home, as playwright.config.ts gives the suite's server, so the
    // review store it may write goes nowhere the developer keeps anything.
    home = mkdtempSync(path.join(tmpdir(), "vantage-e2e-roadmaps-"));
    const binary = path.join(home, "vantage");
    // Built and run as a binary rather than with `go run`, so stopping it
    // stops the server itself and not only the go command in front of it.
    const built = spawnSync("go", ["build", "-o", binary, "./cmd/vantage"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (built.status !== 0) throw new Error(`go build: ${built.stderr}`);
    const port = await freePort();
    backend = `http://127.0.0.1:${port}`;
    server = spawn(
      binary,
      ["serve", FIXTURE, "--port", String(port), "--no-open"],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          XDG_CONFIG_HOME: path.join(home, ".config"),
          VANTAGE_NO_TIPS: "1",
        },
        stdio: "ignore",
      },
    );
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`${backend}/api/health`)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 60_000 },
      )
      .toBe(200);
  });

  test.afterAll(() => {
    server?.kill();
    server = null;
    if (home) rmSync(home, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.route(
      (url) => url.pathname.startsWith("/api/"),
      async (route) => {
        const url = new URL(route.request().url());
        const response = await route.fetch({
          url: `${backend}${url.pathname}${url.search}`,
        });
        await route.fulfill({ response });
      },
    );
    await page.routeWebSocket(/\/api\/ws$/, () => {});
  });

  // An API request still in flight when a test ends would otherwise fail it
  // from inside the route handler: closing the page disposes the response the
  // handler fetched, and its fulfill throws "Fetch response has been disposed".
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  const picker = (page: Page) =>
    page.getByRole("combobox", { name: "Roadmap" });
  /** The questions a section's cards render, in order, once they settle. */
  const cardsIn = (page: Page, name: string) =>
    expect.poll(() =>
      page
        .getByRole("region", { name: new RegExp(`^${name}`) })
        .getByRole("article")
        .evaluateAll((cards) => cards.map((c) => c.getAttribute("aria-label"))),
    );
  const roadmapParam = (page: Page) =>
    new URL(page.url()).searchParams.get("roadmap");

  test("offers each roadmap, follows a pick, and a later visit reopens it", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    await expect(picker(page)).toHaveValue("roadmap.md");
    await expect(picker(page).locator("option")).toHaveText([
      "roadmap.md (2 need you)",
      `${NESTED} (4 need you)`,
    ]);
    await cardsIn(page, "Needs you").toEqual([
      "OQ-A1: Which way does alpha go?",
      "OQ-A2: How soon does alpha ship?",
    ]);
    // Beta's three are routed, by the other roadmap: counted, not Not on a roadmap.
    await expect(page.getByTestId("other-roadmaps")).toHaveText(
      "3 more questions need you on other roadmaps.",
    );
    await cardsIn(page, "Not on a roadmap").toEqual([
      "OQ-G1: Is anyone tracking gamma?",
    ]);
    // The address says which roadmap is shown, written in place.
    await expect.poll(() => roadmapParam(page)).toBe("roadmap.md");
    const entries = await page.evaluate(() => history.length);

    await picker(page).selectOption(NESTED);
    await cardsIn(page, "Needs you").toEqual([
      "OQ-B1: Which way does beta go?",
      "OQ-B2: Who builds beta?",
      "OQ-B3: Does beta need a flag?",
      "OQ-A2: How soon does alpha ship?",
    ]);
    await expect(page.getByTestId("other-roadmaps")).toHaveText(
      "1 more question needs you on another roadmap.",
    );
    expect(roadmapParam(page)).toBe(NESTED);
    expect(await page.evaluate(() => history.length)).toBe(entries);

    // The address keeps it across a reload, and this browser for a visit
    // whose address names none.
    await page.reload();
    await expect(picker(page)).toHaveValue(NESTED);
    await page.goto("/.vantage/planning");
    await expect(picker(page)).toHaveValue(NESTED);
    await cardsIn(page, "Needs you").toEqual([
      "OQ-B1: Which way does beta go?",
      "OQ-B2: Who builds beta?",
      "OQ-B3: Does beta need a flag?",
      "OQ-A2: How soon does alpha ship?",
    ]);
    await expect.poll(() => roadmapParam(page)).toBe(NESTED);
  });

  // Late data never moves painted content (planning-index.md §12):
  // the roadmap line arrives with the index, above the box that held the
  // progress line, so a section bar drawn in that box was pushed down on
  // every cold load, at every width.
  for (const width of [1280, 375]) {
    test(`fills the frame on a cold load with no layout shift, at ${width} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript(() => {
        interface Entry extends PerformanceEntry {
          value: number;
          hadRecentInput: boolean;
          sources: { node: Node | null }[];
        }
        const shifts: { value: number; nodes: string[] }[] = [];
        (window as unknown as { __shifts: typeof shifts }).__shifts = shifts;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Entry[]) {
            if (entry.hadRecentInput) continue;
            shifts.push({
              value: entry.value,
              nodes: entry.sources.map((source) => {
                const el =
                  source.node instanceof Element
                    ? source.node
                    : (source.node?.parentElement ?? null);
                return el === null
                  ? "(none)"
                  : `${el.tagName} ${el.className} "${(el.textContent ?? "").slice(0, 40)}"`;
              }),
            });
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      // Registered after beforeEach's proxy, so it runs first and hands the
      // stream on to it once released.
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/api/planning/stream", async (route) => {
        await released;
        await route.fallback();
      });

      await page.goto("/.vantage/planning");
      // The progress line's, not the degradation banner's live region, which
      // the app shell keeps mounted beside the page.
      await expect(page.getByRole("main").getByRole("status")).toContainText(
        /Reading planning documents|Scanning planning documents/,
      );
      release();
      await expect(picker(page)).toHaveValue("roadmap.md");
      await cardsIn(page, "Needs you").toEqual([
        "OQ-A1: Which way does alpha go?",
        "OQ-A2: How soon does alpha ship?",
      ]);
      // Two frames, so the observer has reported the last paint.
      const shifts = await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                resolve((window as unknown as { __shifts: unknown }).__shifts),
              ),
            ),
          ),
      );
      expect(shifts).toEqual([]);
    });
  }

  // §6.8: the path is the only name that tells two roadmap.md files apart, so
  // the closed control never cuts it off, however narrow the screen.
  test("shows the chosen path whole on a narrow screen, wrapped inside the control", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/.vantage/planning?roadmap=${NESTED}`);
    await expect(picker(page)).toHaveValue(NESTED);
    await expect(picker(page)).toHaveAttribute("title", NESTED);
    const shown = page.getByTestId("roadmap-shown");
    await expect(shown).toHaveText(`${NESTED} (4 need you)`);
    const fit = await shown.evaluate((el) => {
      const text = el.getBoundingClientRect();
      const control = el.parentElement!.getBoundingClientRect();
      return {
        // At 320 px the path and its count take two lines, which a closed
        // native select, one line clipped to its box, cannot show.
        wrapped: text.height > parseFloat(getComputedStyle(el).lineHeight),
        inView: text.right <= document.documentElement.clientWidth,
        inControl: text.right <= control.right && text.bottom <= control.bottom,
        unclipped: el.scrollWidth <= el.clientWidth,
      };
    });
    expect(fit).toEqual({
      wrapped: true,
      inView: true,
      inControl: true,
      unclipped: true,
    });
    // Still the native select over it, so a pick goes through.
    await picker(page).selectOption("roadmap.md");
    await expect(shown).toHaveText("roadmap.md (2 need you)");
  });

  // One picker (planning-index.md §6.9): at the head of the planning
  // outline while the contents column is shown, and not above the sections.
  test("puts the picker at the head of the planning outline, and only there", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("vantage:tocOpen", "true");
    });
    await page.goto("/.vantage/planning");
    const outline = page.getByRole("navigation", { name: "Planning outline" });
    await expect(
      outline.getByRole("combobox", { name: "Roadmap" }),
    ).toBeVisible();
    await expect(picker(page)).toHaveCount(1);
    await expect(
      page.getByRole("main").getByRole("combobox", { name: "Roadmap" }),
    ).toHaveCount(0);
    await picker(page).selectOption(NESTED);
    await cardsIn(page, "Needs you").toEqual([
      "OQ-B1: Which way does beta go?",
      "OQ-B2: Who builds beta?",
      "OQ-B3: Does beta need a flag?",
      "OQ-A2: How soon does alpha ship?",
    ]);
    // The outline follows the pick, with the section bar.
    await expect(
      outline.getByRole("link", { name: /^Needs you \d/ }),
    ).toHaveText("Needs you 4");
  });

  // §6.8 in the outline's 256 px: the path is the only name that tells two
  // roadmap.md files apart, so the closed control wraps it rather than cut
  // it or its count off, as on its line.
  test("shows the chosen path whole at the head of the outline, wrapped in the column", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.addInitScript(() => {
      localStorage.setItem("vantage:tocOpen", "true");
    });
    await page.goto(`/.vantage/planning?roadmap=${NESTED}`);
    const outline = page.getByRole("navigation", { name: "Planning outline" });
    const shown = outline.getByTestId("roadmap-shown");
    await expect(shown).toHaveText(`${NESTED} (4 need you)`);
    await expect(picker(page)).toHaveAttribute("title", NESTED);
    const fit = await shown.evaluate((el) => {
      const text = el.getBoundingClientRect();
      const control = el.parentElement!.getBoundingClientRect();
      const column = el
        .closest('[data-testid="planning-outline"]')!
        .getBoundingClientRect();
      return {
        column: Math.round(column.width),
        wrapped: text.height > parseFloat(getComputedStyle(el).lineHeight),
        inControl: text.right <= control.right && text.bottom <= control.bottom,
        inColumn: control.right <= column.right + 0.5,
        unclipped: el.scrollWidth <= el.clientWidth,
      };
    });
    expect(fit).toEqual({
      column: 256,
      wrapped: true,
      inControl: true,
      inColumn: true,
      unclipped: true,
    });
    // Still the native select over it, so a pick goes through.
    await picker(page).selectOption("roadmap.md");
    await expect(shown).toHaveText("roadmap.md (2 need you)");
  });

  // Late data never moves painted content: the picker arrives with the
  // index, so the outline's head is drawn only with it. A Contents label
  // painted first was pushed down by it, about 110 px, on every cold load.
  for (const width of [1440, 1024]) {
    test(`fills the outline on a cold load with no layout shift, at ${width} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript(() => {
        localStorage.setItem("vantage:tocOpen", "true");
        interface Entry extends PerformanceEntry {
          value: number;
          hadRecentInput: boolean;
          sources: { node: Node | null }[];
        }
        const shifts: { value: number; nodes: string[] }[] = [];
        (window as unknown as { __shifts: typeof shifts }).__shifts = shifts;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Entry[]) {
            if (entry.hadRecentInput) continue;
            const nodes = entry.sources.map((source) => {
              const el =
                source.node instanceof Element
                  ? source.node
                  : (source.node?.parentElement ?? null);
              // The sidebar's file tree filling a folder late is the shell's
              // own layout-shift source, as stable_paint.spec.ts records it.
              if (el?.closest('[data-testid="sidebar"]')) return "sidebar";
              return el === null
                ? "(none)"
                : `${el.tagName} ${el.className} "${(el.textContent ?? "").slice(0, 40)}"`;
            });
            if (nodes.length > 0 && nodes.every((n) => n === "sidebar")) {
              continue;
            }
            shifts.push({ value: entry.value, nodes });
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/api/planning/stream", async (route) => {
        await released;
        await route.fallback();
      });

      await page.goto("/.vantage/planning");
      await expect(page.getByRole("main").getByRole("status")).toContainText(
        /Reading planning documents|Scanning planning documents/,
      );
      release();
      const outline = page.getByRole("navigation", {
        name: "Planning outline",
      });
      await expect(
        outline.getByRole("combobox", { name: "Roadmap" }),
      ).toHaveValue("roadmap.md");
      await expect(outline.getByText("Contents")).toBeVisible();
      await cardsIn(page, "Needs you").toEqual([
        "OQ-A1: Which way does alpha go?",
        "OQ-A2: How soon does alpha ship?",
      ]);
      const shifts = await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                resolve((window as unknown as { __shifts: unknown }).__shifts),
              ),
            ),
          ),
      );
      expect(shifts).toEqual([]);
    });
  }

  test("Referenced by names the roadmap that routes a document", async ({
    page,
  }) => {
    const surface = page.locator("[data-vantage-referenced-by]");
    // The line, and not the list behind it, which is in the DOM, hidden.
    const line = surface.getByRole("button", { name: /Referenced by/ });
    await openWithIndex(page, "/designs/beta.md");
    await expect(line).toHaveText(
      "Referenced by 1 document · on plans/roadmap.md under Later",
    );
    await openWithIndex(page, "/designs/alpha.md");
    await expect(line).toHaveText(
      "Referenced by 2 documents · on roadmap.md under Now and 1 other roadmap",
    );
    // Nothing links here, so the line is text with nothing to open.
    await openWithIndex(page, "/designs/gamma.md");
    await expect(surface).toHaveText(
      "1 open question not on any roadmap",
    );
  });

  /** A comment typed on `id`'s title in `doc`, filed on the real server. */
  const fileOnTitle = async (doc: string, id: string) => {
    const lines = readFileSync(path.join(FIXTURE, doc), "utf8").split("\n");
    const line = lines.findIndex((l) => l.includes(`**${id}:`)) + 1;
    const response = await fetch(
      `${backend}/api/review/comments?path=${encodeURIComponent(doc)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `typed-${id}`,
          comment: `My answer to ${id}.`,
          fallback_text: "",
          created_at: 0,
          anchor: {
            source_line: line,
            block_text_hash: "00000000",
            selection_offset: 0,
            selection_length: 0,
          },
        }),
      },
    );
    expect(response.ok).toBe(true);
  };
  const clear = (doc: string) =>
    fetch(`${backend}/api/review?path=${encodeURIComponent(doc)}`, {
      method: "DELETE",
    });

  // A comment on a question is its answer (planning-index.md §6.7): it comes
  // off the picker's counts and the other-roadmaps line, and its card is
  // marked, while the question stays listed. The counts change in room kept
  // for them, so nothing painted moves.
  test("takes a question answered by a comment off the need-you counts, moving nothing", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      interface Entry extends PerformanceEntry {
        value: number;
        hadRecentInput: boolean;
        sources: { node: Node | null }[];
      }
      const shifts: { value: number; nodes: string[] }[] = [];
      (window as unknown as { __shifts: typeof shifts }).__shifts = shifts;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Entry[]) {
          if (entry.hadRecentInput) continue;
          const nodes = entry.sources.map((source) => {
            const el =
              source.node instanceof Element
                ? source.node
                : (source.node?.parentElement ?? null);
            if (el?.closest('[data-testid="sidebar"]')) return "sidebar";
            return el === null
              ? "(none)"
              : `${el.tagName} ${el.className} "${(el.textContent ?? "").slice(0, 40)}"`;
          });
          if (nodes.length > 0 && nodes.every((n) => n === "sidebar")) {
            continue;
          }
          shifts.push({ value: entry.value, nodes });
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    try {
      await fileOnTitle("designs/alpha.md", "OQ-A1");
      await fileOnTitle("designs/beta.md", "OQ-B1");
      await page.goto(`/.vantage/planning?roadmap=roadmap.md`);
      const a1 = page.getByRole("article", { name: /^OQ-A1:/ });
      await expect(a1.getByText("Answered — waiting on the agent")).toBeVisible();
      // Still listed where it was.
      await cardsIn(page, "Needs you").toEqual([
        "OQ-A1: Which way does alpha go?",
        "OQ-A2: How soon does alpha ship?",
      ]);
      // Both comments came with the sections, so both roadmaps' counts drop.
      await expect(picker(page).locator("option")).toHaveText([
        "roadmap.md (1 needs you)",
        `${NESTED} (3 need you)`,
      ]);
      // Beta is on no page this roadmap shows, and its comment counts all
      // the same: its questions need you on the other roadmap, so its reviews
      // come with the sections.
      await expect(page.getByTestId("pending-answers")).toHaveText("2");
      await expect(page.getByTestId("other-roadmaps")).toHaveText(
        "2 more questions need you on other roadmaps.",
      );
      const shifts = await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                resolve((window as unknown as { __shifts: unknown }).__shifts),
              ),
            ),
          ),
      );
      expect(shifts).toEqual([]);

      await picker(page).selectOption(NESTED);
      await expect(
        page
          .getByRole("article", { name: /^OQ-B1:/ })
          .getByText("Answered — waiting on the agent"),
      ).toBeVisible();
      await expect(picker(page).locator("option")).toHaveText([
        "roadmap.md (1 needs you)",
        `${NESTED} (3 need you)`,
      ]);
      // OQ-A1, answered, was the one question only roadmap.md routes.
      await expect(page.getByTestId("other-roadmaps")).toHaveText(
        "No more questions need you on other roadmaps.",
      );
    } finally {
      await clear("designs/alpha.md");
      await clear("designs/beta.md");
    }
  });

  // A cold visit: every answer filed before the page was ever opened, on
  // questions of both roadmaps and of none. Each need-you number is right from
  // the first paint, under either roadmap, with nothing picked in between.
  for (const chosen of ["roadmap.md", NESTED]) {
    test(`counts every answer on a cold visit to ${chosen}`, async ({
      page,
    }) => {
      const all: [string, string][] = [
        ["designs/alpha.md", "OQ-A1"],
        ["designs/alpha.md", "OQ-A2"],
        ["designs/beta.md", "OQ-B1"],
        ["designs/beta.md", "OQ-B2"],
        ["designs/beta.md", "OQ-B3"],
        ["designs/gamma.md", "OQ-G1"],
      ];
      try {
        for (const [doc, id] of all) await fileOnTitle(doc, id);
        await page.goto(
          `/.vantage/planning?roadmap=${encodeURIComponent(chosen)}`,
        );
        await expect(page.getByTestId("pending-answers")).toHaveText("6");
        await expect(picker(page).locator("option")).toHaveText([
          "roadmap.md (0 need you)",
          `${NESTED} (0 need you)`,
        ]);
        await expect(page.getByTestId("other-roadmaps")).toHaveText(
          "No more questions need you on other roadmaps.",
        );
        await expect(page.getByTestId("nothing-needs-you")).toContainText(
          "Every open question has your answer, waiting on the agent.",
        );
      } finally {
        for (const doc of new Set(all.map(([doc]) => doc))) await clear(doc);
      }
    });
  }
});
