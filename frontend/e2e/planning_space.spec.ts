import { test, expect, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A planning link naming a space, in daemon mode, in a real browser, against
// a real server (docs/reference/planning-index.md §13.6). The space id is one
// random id per checkout, kept in its .vantage/space, which the checker
// writes into its link as `space=`: a root-relative link has no project
// segment, so the page asks the server which project holds the id and opens
// that project's page instead of *Choose a project*.
//
// `vantage serve` on a directory of clones serves each clone as a project of
// its own (docs/reference/serve-clones-directory.md). This spec makes one in
// the temporary directory, outside every git work tree as that mode needs,
// with two clones, alpha and beta, each holding a space id of its own, and
// serves it on a free port, sending the page's API requests there, the scan
// worker's included. The live-reload socket is answered here and never
// opened.

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");

const ALPHA = "alphaspace234567";
const BETA = "betaspace2345677";
/** A space id neither clone holds: a link made in a checkout not served. */
const ELSEWHERE = "elsewhere2345677";
/**
 * The id gamma and its whole copy, gamma-copy, both hold: a checkout copied
 * with its .vantage keeps the original's id.
 */
const COPIED = "gammaspace234567";

const FILTER = "path:/designs/beta.md is:open";
const QUERY = "filter=path:/designs/beta.md+is:open";

/** A clone's files: a roadmap routing its two designs, and their questions. */
function cloneFiles(name: string): Record<string, string> {
  const question = (id: string, title: string) =>
    [
      `1. 💬 **${id}: ${title}**`,
      "",
      `   <!-- vantage: oq id=${id} leaning="Yes." -->`,
      "",
      "   _Leaning:_ yes.",
      "",
    ].join("\n");
  const design = (title: string, ...questions: string[]) =>
    [
      "---",
      "status: draft",
      "stage: DESIGN",
      "---",
      "",
      `# ${title}`,
      "",
      "## Open Questions",
      "",
      ...questions,
    ].join("\n");
  const upper = name.toUpperCase().slice(0, 1);
  return {
    ".vantage.toml": '[planning.stages]\nDESIGN = "open"\n',
    "roadmap.md": [
      "# Roadmap",
      "",
      "## Now",
      "",
      `1. [${name}](designs/${name}.md) comes first.`,
      "2. [Its sequel](designs/sequel.md) comes next.",
      "",
    ].join("\n"),
    // A handoff note holding the checker's planning links, as an agent
    // leaves one for the human to click.
    "handoff.md": [
      "# Handoff",
      "",
      `- [Beta's questions](/.vantage/planning?${QUERY}&space=${BETA})`,
      `- [Elsewhere's questions](/.vantage/planning?${QUERY}&space=${ELSEWHERE})`,
      "",
    ].join("\n"),
    [`designs/${name}.md`]: design(
      name,
      question(`OQ-${upper}1`, `Which way does ${name} go?`),
      question(`OQ-${upper}2`, `How soon does ${name} ship?`),
    ),
    "designs/sequel.md": design(
      "Sequel",
      question(`OQ-${upper}9`, "What comes after it?"),
    ),
  };
}

/** Make `dir` a git clone holding `files`, committed, with its space id. */
function makeClone(dir: string, files: Record<string, string>, id: string) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  // As vantage-check makes them: the id and a newline, and an ignore file
  // so no clone commits its id.
  mkdirSync(path.join(dir, ".vantage"), { recursive: true });
  writeFileSync(path.join(dir, ".vantage/space"), `${id}\n`);
  writeFileSync(path.join(dir, ".vantage/.gitignore"), "*\n");
  const git = (...args: string[]) => {
    const ran = spawnSync(
      "git",
      ["-c", "user.name=e2e", "-c", "user.email=e2e@example.com", ...args],
      { cwd: dir, encoding: "utf8" },
    );
    if (ran.status !== 0) throw new Error(`git ${args[0]}: ${ran.stderr}`);
  };
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "fixture");
}

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

/**
 * Record every layout shift from the first paint, with what moved, and every
 * node inserted that is or holds *Choose a project* or the projects' list,
 * read as it was inserted, so one drawn and taken away again is seen too. A
 * shift whose every source is in the sidebar is the sidebar's, which loads its
 * tree on its own time.
 */
async function watchPaint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shifts: { value: number; sources: string[] }[] = [];
    const chooser: string[] = [];
    Object.assign(window, { __shifts: shifts, __chooser: chooser });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        sources?: {
          node?: Node | null;
          previousRect: DOMRectReadOnly;
          currentRect: DOMRectReadOnly;
        }[];
      })[]) {
        const rect = (r: DOMRectReadOnly) =>
          `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
        const sources = (entry.sources ?? []).map((source) => {
          const node = source.node ?? null;
          const el =
            node instanceof Element ? node : (node?.parentElement ?? null);
          const where = el?.closest('[data-testid="sidebar"]')
            ? "sidebar:"
            : "";
          return node === null
            ? "?"
            : `${where}${node.nodeName}.${String((node as Element).className ?? "").slice(0, 60)} "${(el?.textContent ?? "").slice(0, 40)}" ${rect(source.previousRect)} -> ${rect(source.currentRect)} at ${Math.round(entry.startTime)}`;
        });
        if (
          sources.length > 0 &&
          sources.every((s) => s.startsWith("sidebar:"))
        ) {
          continue;
        }
        shifts.push({ value: entry.value, sources });
      }
    }).observe({ type: "layout-shift", buffered: true });
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if ((node.textContent ?? "").includes("Choose a project")) {
            chooser.push("Choose a project");
          }
          if (
            node instanceof Element &&
            (node.matches("[data-testid=planning-projects]") ||
              node.querySelector("[data-testid=planning-projects]") !== null)
          ) {
            chooser.push("the projects' list");
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

/** What was recorded, once two frames have let the observers report. */
const recorded = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const w = window as unknown as {
              __shifts: unknown;
              __chooser: unknown;
            };
            resolve({ shifts: w.__shifts, chooser: w.__chooser });
          }),
        ),
      ),
  );

const cards = (page: Page) =>
  page
    .getByRole("region", { name: /^Needs you/ })
    .getByRole("article")
    .evaluateAll((all) => all.map((a) => a.getAttribute("aria-label")));

test.describe("a planning link naming a space, in daemon mode", () => {
  // One server for the file, started once: its tests share a worker.
  test.describe.configure({ mode: "serial" });

  let server: ChildProcess | null = null;
  let scratch = "";
  let backend = "";

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    scratch = mkdtempSync(path.join(tmpdir(), "vantage-e2e-spaces-"));
    const clones = path.join(scratch, "clones");
    makeClone(path.join(clones, "alpha"), cloneFiles("alpha"), ALPHA);
    makeClone(path.join(clones, "beta"), cloneFiles("beta"), BETA);
    makeClone(path.join(clones, "gamma"), cloneFiles("gamma"), COPIED);
    makeClone(path.join(clones, "gamma-copy"), cloneFiles("gamma"), COPIED);
    // Its own home, as playwright.config.ts gives the suite's server, so the
    // review store it may write goes nowhere the developer keeps anything.
    const home = path.join(scratch, "home");
    mkdirSync(home);
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
      ["serve", clones, "--port", String(port), "--no-open"],
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
            const repos = await fetch(`${backend}/api/repos`);
            if (!repos.ok) return [];
            return ((await repos.json()) as { name: string }[])
              .map((r) => r.name)
              .sort();
          } catch {
            return [];
          }
        },
        { timeout: 60_000 },
      )
      .toEqual(["alpha", "beta", "gamma", "gamma-copy"]);
  });

  test.afterAll(() => {
    server?.kill();
    server = null;
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
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
  // from inside the route handler.
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("opens the project holding the link's space, filtered, with no chooser, no layout shift and no history entry", async ({
    page,
  }) => {
    const asked: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith("/api/spaces/")) asked.push(pathname);
    });
    // A document first, so Back says whether the link left an entry.
    await page.goto("/alpha/designs/alpha.md");
    await expect(
      page.getByRole("heading", { level: 1, name: "alpha" }),
    ).toBeVisible();
    const before = await page.evaluate(() => history.length);
    await watchPaint(page);
    await page.goto(`/.vantage/planning?${QUERY}&space=${BETA}`);
    await expect(page).toHaveURL(
      new RegExp(`/\\.vantage/planning/beta\\?${QUERY.replace(/[.+?]/g, "\\$&")}$`),
    );
    await expect(
      page.getByRole("region", { name: /^Needs you/ }).getByRole("article"),
    ).toHaveCount(2);
    expect(await cards(page)).toEqual([
      "OQ-B1: Which way does beta go?",
      "OQ-B2: How soon does beta ship?",
    ]);
    await expect(page.getByRole("textbox", { name: "Filter" })).toHaveValue(
      FILTER,
    );
    // The project's own page: its name in the breadcrumb, its sidebar drawn.
    await expect(
      page.getByTestId("planning-header").getByRole("link", { name: "beta" }),
    ).toBeVisible();
    await expect(page.getByTestId("sidebar")).toBeVisible();
    expect(asked).toEqual([`/api/spaces/${BETA}`]);
    const seen = (await recorded(page)) as {
      shifts: unknown[];
      chooser: string[];
    };
    expect(seen.chooser).toEqual([]);
    expect(seen.shifts, JSON.stringify(seen.shifts)).toEqual([]);
    // One entry for the link, replaced in place: Back leaves it whole.
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    await page.goBack();
    await expect(page).toHaveURL(/\/alpha\/designs\/alpha\.md$/);
  });

  test("says a link made in a checkout this Vantage does not serve is one, and only then lists the projects with its filter", async ({
    page,
  }) => {
    await watchPaint(page);
    await page.goto(`/.vantage/planning?${QUERY}&space=${ELSEWHERE}`);
    const said = page.getByTestId("space-not-found");
    await expect(said).toContainText(
      "This link was made in a checkout this Vantage does not serve",
    );
    const links = page.getByTestId("planning-projects").getByRole("link");
    await expect(links).toHaveCount(4);
    expect(
      await links.evaluateAll((all) =>
        all.map((a) => [a.textContent, a.getAttribute("href")]),
      ),
    ).toEqual([
      ["alpha", `/.vantage/planning/alpha?${QUERY}`],
      ["beta", `/.vantage/planning/beta?${QUERY}`],
      ["gamma", `/.vantage/planning/gamma?${QUERY}`],
      ["gamma-copy", `/.vantage/planning/gamma-copy?${QUERY}`],
    ]);
    await expect(page.getByRole("textbox", { name: "Filter" })).toHaveValue(
      FILTER,
    );
    await expect(page.getByText(/Choose a project/)).toHaveCount(0);
    await expect(page).toHaveURL(
      new RegExp(`space=${ELSEWHERE}$`),
    );
  });

  // A checkout copied whole keeps the original's id, so two projects hold
  // it: the page opens neither, says so, and lists only those two.
  test("names both projects holding one space id, and opens neither", async ({
    page,
  }) => {
    await page.goto(`/.vantage/planning?${QUERY}&space=${COPIED}`);
    await expect(page.getByTestId("space-not-found")).toContainText(
      "2 projects here hold this link's space id",
    );
    const links = page.getByTestId("planning-projects").getByRole("link");
    expect(
      await links.evaluateAll((all) => all.map((a) => a.textContent)),
    ).toEqual(["gamma", "gamma-copy"]);
    await expect(page).toHaveURL(new RegExp(`space=${COPIED}$`));
  });

  // An answer slower than the hold paints the frame first: the sidebar's
  // column, the header's buttons and the filter line are drawn as the
  // answer will leave them, so nothing painted outside the sidebar moves
  // when it comes.
  test("moves nothing painted when the answer comes after the frame", async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname.startsWith("/api/spaces/"),
      async (route) => {
        const url = new URL(route.request().url());
        await new Promise((done) => setTimeout(done, 900));
        const response = await route.fetch({
          url: `${backend}${url.pathname}${url.search}`,
        });
        await route.fulfill({ response });
      },
    );
    await watchPaint(page);
    await page.goto(`/.vantage/planning?${QUERY}&space=${BETA}`);
    // The frame is painted while the answer is out.
    await expect(page.getByRole("textbox", { name: "Filter" })).toHaveValue(
      FILTER,
    );
    await expect(page).toHaveURL(/space=/);
    await expect(page).toHaveURL(
      new RegExp(`/\\.vantage/planning/beta\\?${QUERY.replace(/[.+?]/g, "\\$&")}$`),
      { timeout: 10_000 },
    );
    await expect(
      page.getByRole("region", { name: /^Needs you/ }).getByRole("article"),
    ).toHaveCount(2);
    const seen = (await recorded(page)) as {
      shifts: unknown[];
      chooser: string[];
    };
    expect(seen.chooser).toEqual([]);
    expect(seen.shifts, JSON.stringify(seen.shifts)).toEqual([]);
  });

  // A planning link a document holds, the checker's line in a handoff note,
  // opens as written when clicked, rather than as a path in the note's
  // project, and its answer moves nothing painted: found or not, the
  // sidebar's column the page had is kept.
  for (const [what, name, lands] of [
    ["the project holding it", "Beta's questions", "beta"],
    ["no project", "Elsewhere's questions", null],
  ] as const) {
    test(`a document's planning link naming ${what} opens it in place`, async ({
      page,
    }) => {
      await page.route(
        (url) => url.pathname.startsWith("/api/spaces/"),
        async (route) => {
          const url = new URL(route.request().url());
          await new Promise((done) => setTimeout(done, 400));
          const response = await route.fetch({
            url: `${backend}${url.pathname}${url.search}`,
          });
          await route.fulfill({ response });
        },
      );
      await watchPaint(page);
      await page.goto("/alpha/handoff.md");
      const link = page.getByRole("link", { name });
      await expect(link).toBeVisible();
      await page.evaluate(() => {
        const w = window as unknown as { __shifts: unknown[] };
        w.__shifts.length = 0;
      });
      await link.click();
      if (lands === null) {
        await expect(page.getByTestId("space-not-found")).toContainText(
          "This link was made in a checkout this Vantage does not serve",
        );
        await expect(page).toHaveURL(new RegExp(`space=${ELSEWHERE}$`));
      } else {
        await expect(page).toHaveURL(
          new RegExp(`/\\.vantage/planning/${lands}\\?${QUERY.replace(/[.+?]/g, "\\$&")}$`),
        );
        await expect(
          page.getByRole("region", { name: /^Needs you/ }).getByRole("article"),
        ).toHaveCount(2);
      }
      await expect(page.getByTestId("sidebar")).toBeVisible();
      const seen = (await recorded(page)) as {
        shifts: unknown[];
        chooser: string[];
      };
      expect(seen.shifts, JSON.stringify(seen.shifts)).toEqual([]);
    });
  }
});
