import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drawnIn, sameBox } from "./drawnIn";
import { planningIndexReady } from "./planningIndex";

// The planning page in a real browser, against the real planning endpoint and
// the real review store (docs/reference/planning-index.md §6, and
// docs/design/planning-to-do-list.md). The fixture is
// `fixtures/test_repo/plans/`, whose roadmap `.vantage.toml` names: it routes
// design.md's two questions and paged.md's twelve, so Needs you holds more
// than the ten cards it shows, and not unrouted.md's one, or oversized.md's,
// which *Maintenance* lists as Not on a roadmap.
test.describe("the planning page", () => {
  // Tests file comments on the same document and delete them afterwards.
  test.describe.configure({ mode: "serial" });

  const PAGED = "plans/paged.md";
  const here = path.dirname(fileURLToPath(import.meta.url));
  const REPO = path.join(here, "fixtures", "test_repo");

  test.afterEach(async ({ request }) => {
    // Filed comments live in this run's review store; take them back out so
    // the next test, and the next run, start from none.
    await request.delete(`/api/review?path=${encodeURIComponent(PAGED)}`);
  });

  const card = (page: Page, title: string) =>
    page.getByRole("article", { name: title });
  const row = (page: Page, title: string) =>
    page.getByRole("group", { name: title });
  const section = (page: Page, name: string) =>
    page.getByRole("region", { name: new RegExp(`^${name}`) });
  // The pane, which is what scrolls in the app shell.
  const pane = (page: Page) => page.locator("[data-content-scroll]");
  const paneTop = (page: Page) => pane(page).evaluate((el) => el.scrollTop);
  // The document's name at the top of a card, which opens the document in
  // this tab; Open document opens a new one.
  const nameLink = (page: Page, title: string, path: string) =>
    card(page, title).getByRole("link", { name: path, exact: true });
  /** Open a folded group: its heading line is a button. */
  const openGroup = async (page: Page, name: "Blocked" | "Maintenance") => {
    await page
      .getByRole("button", { name: new RegExp(`^${name}`), expanded: false })
      .click();
  };
  const LAST = "OQ-P8: Which way for part 8?";

  for (const width of [1280, 375]) {
    test(`reviews pending sources without copying at ${width}px`, async ({
      page,
    }) => {
      await page.goto("/.vantage/planning");
      await card(page, LAST)
        .getByRole("button", { name: "Take this leaning" })
        .click();
      await expect(page.getByTestId("pending-answers")).toHaveText("1");
      await page.setViewportSize({ width, height: 900 });
      const review = page.getByRole("button", {
        name: "Review answers",
        exact: true,
      });
      if (!(await review.isVisible())) {
        await page
          .getByRole("button", { name: "Toolbar actions", exact: true })
          .click();
      }
      await review.click();
      const answers = page.getByRole("menu", {
        name: "Answers waiting on the agent",
      });
      await expect(answers).toBeVisible();
      await expect(answers.getByText(PAGED, { exact: true })).toBeVisible();
      const source = answers.getByRole("menuitem", {
        name: /^Open plans\/paged\.md at line/,
      });
      await expect(source).toBeFocused();
      const box = await answers.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: test.info().outputPath(`review-answers-${width}.png`),
      });
      await source.click();
      await expect(page).toHaveURL(/\/plans\/paged\.md#L\d+$/);
      await expect(
        page.locator("[data-content-scroll] .prose h1"),
      ).toBeVisible();
    });
  }

  test("loads by its URL: ten cards of Needs you, and the rest folded, Not on a roadmap among it", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
    // Ten of the fourteen, and the end line counts the rest.
    await expect(section(page, "Needs you").getByRole("article")).toHaveCount(
      10,
    );
    await expect(page.getByTestId("needs-you-end")).toContainText(
      "4 more need you",
    );
    // Maintenance is folded until opened.
    await expect(
      page.getByRole("listitem", { name: "OQ-U1: Is anyone tracking this?" }),
    ).toHaveCount(0);
    await openGroup(page, "Maintenance");
    await expect(
      section(page, "Not on a roadmap").getByRole("listitem", {
        name: "OQ-U1: Is anyone tracking this?",
      }),
    ).toBeVisible();
    await expect(
      section(page, "Ready to graduate").getByRole("link", {
        name: "plans/shipped.md",
      }),
    ).toBeVisible();
    // The card is the question as its document renders it, and only it: the
    // second question's card holds the first too, in the same list, hidden,
    // and keeps the number the document gives it.
    const second = card(page, "OQ-E2: How soon?");
    await expect(second.getByText("Leaning: soon.")).toBeVisible();
    await expect(second.getByText("Which way does it go?")).toBeHidden();
    await expect(second.locator("li[data-planning-card-unit]")).toHaveAttribute(
      "value",
      "2",
    );
  });

  test("opens with g p from the viewer, and Back costs no second scan", async ({
    page,
  }) => {
    // Each build is one planning stream, which the scan worker asks for; a
    // dedicated worker's requests reach the page's own network events.
    const builds: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/planning/stream")) {
        builds.push(request.url());
      }
    });

    await page.goto("/plans/roadmap.md");
    await planningIndexReady(page);

    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    await expect(card(page, LAST)).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/plans\/roadmap\.md$/);
    await expect(
      page
        .locator("[data-content-scroll] [data-vantage-planning-badge]")
        .first(),
    ).toBeVisible();
    // Long enough for a socket each page opened, React's StrictMode double
    // included, to connect: none of them is a reconnect, so none rescans.
    await page.waitForTimeout(2000);
    expect(builds).toHaveLength(1);
  });

  // The usual way onto the page is g p from a document. The viewer a card's
  // link mounts in this tab, its document's name, used to reload the document
  // the store still named on its socket's first connection, which superseded
  // the route's load: the URL was right and the content was still the
  // roadmap's. It was found through Open document, which opened its document
  // in this tab until 2026-10-01.
  test("a card's document name after g p from a document shows the card's document", async ({
    page,
  }) => {
    const title = page.locator("[data-content-scroll] .prose h1");
    await page.goto("/plans/roadmap.md");
    await expect(title).toContainText("Roadmap");
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    // Hold the document back until the new viewer's socket has connected,
    // which is the order a slower document or a busy machine gives.
    await page.route("**/api/content?path=plans%2Fpaged.md*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });
    await nameLink(page, LAST, PAGED).click();
    await expect(page).toHaveURL(/\/plans\/paged\.md$/);
    // Long enough for the held document, and a reload the socket triggered,
    // to land.
    await page.waitForTimeout(2000);
    await expect(title).toContainText("The paged plan");
  });

  test("takes a leaning that its document, opened from the card, shows as the in-page button's own", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    await card(page, LAST)
      .getByRole("button", { name: "Take this leaning" })
      .click();
    // Answered here, the card is a row where it stood
    // (planning-to-do-list.md §4.1).
    const answered = row(page, LAST);
    await expect(answered.getByText("Leaning taken")).toBeVisible();
    await expect(page.getByTestId("pending-answers")).toHaveText("1");
    // Shown again, the card lists what it filed.
    await answered.getByRole("button", { name: /^Show/ }).click();
    const comments = card(page, LAST).getByRole("list", {
      name: "Comments on this question",
    });
    await expect(comments).toContainText("The plain way.");
    await expect(comments).toContainText("waiting on the agent");

    await nameLink(page, LAST, PAGED).click();
    await expect(page).toHaveURL(/\/plans\/paged\.md$/);
    const prose = page.locator("[data-content-scroll] .prose");
    // The document opens in review mode by the existing rule for a document
    // with comments, and shows the same comment, anchored where it was filed.
    await expect(
      prose.locator("[data-review-inline-comment]").filter({
        hasText: "The plain way.",
      }),
    ).toBeVisible();
    await expect(prose.locator(".review-highlight-block")).toHaveCount(1);
    await expect(
      prose.locator(".review-highlight-block-divergent"),
    ).toHaveCount(0);
    // And the in-page button recognizes it as its own take: the same anchor
    // and the same text, measured by this browser's layout.
    await expect(prose.locator(".review-oq-taken")).toHaveText("Leaning taken");
  });

  test("a card's document name lands at the top, and Back returns to the same scroll position", async ({
    page,
  }) => {
    // Short enough that both the page and the document scroll.
    await page.setViewportSize({ width: 1280, height: 360 });
    await page.goto("/.vantage/planning");
    await expect(card(page, LAST)).toBeVisible();

    // The reader scrolls to the very bottom.
    await pane(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => paneTop(page)).toBeGreaterThan(100);
    // The page saves as the reader scrolls, one frame behind.
    await page.waitForTimeout(100);
    const before = await paneTop(page);

    // Followed where it stands: a real click would scroll the link into view
    // first, and the reader would then be returning somewhere else.
    await nameLink(page, "OQ-E2: How soon?", "plans/design.md").dispatchEvent(
      "click",
    );
    await expect(page).toHaveURL(/\/plans\/design\.md$/);
    await expect(
      page.getByRole("heading", { name: "The fixture design" }),
    ).toBeVisible();
    // The top of the document, not the question: no fragment, no scroll.
    expect(new URL(page.url()).hash).toBe("");
    const scroller = page.locator("[data-content-scroll]");
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);

    await page.goBack();
    await expect(card(page, LAST)).toBeVisible();
    await expect.poll(() => paneTop(page)).toBeCloseTo(before, 0);
  });

  // Its icon is the one for a link that opens elsewhere, and a reader who
  // clicked it expected a new tab (user direction, 2026-10-01).
  test("Open document opens its document in a new tab, at its top, and leaves the page as it was", async ({
    page,
    context,
  }) => {
    // Short enough that the page scrolls.
    await page.setViewportSize({ width: 1280, height: 360 });
    await page.goto("/.vantage/planning");
    const open = card(page, "OQ-E2: How soon?").getByRole("link", {
      name: "Open document (opens in a new tab)",
      exact: true,
    });
    // Brought into view first, so that the click itself scrolls nothing.
    await open.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    const before = await paneTop(page);
    const at = page.url();

    const opened = context.waitForEvent("page");
    await open.click();
    const tab = await opened;
    await expect(
      tab.getByRole("heading", { name: "The fixture design" }),
    ).toBeVisible();
    // The top of the document, not the question: no fragment, no scroll.
    const url = new URL(tab.url());
    expect(url.pathname).toBe("/plans/design.md");
    expect(url.hash).toBe("");
    await expect
      .poll(() =>
        tab.locator("[data-content-scroll]").evaluate((el) => el.scrollTop),
      )
      .toBe(0);
    // With no handle on the planning page's tab.
    expect(await tab.evaluate(() => window.opener)).toBeNull();

    // And the planning page is where it was, in its own tab.
    expect(page.url()).toBe(at);
    await expect(card(page, "OQ-E2: How soon?")).toBeVisible();
    expect(await paneTop(page)).toBe(before);
    await tab.close();
  });

  /**
   * Every layout shift after the page's first paint, as it happens. Each
   * source says whether it is in the app shell's sidebar, whose file tree
   * filling a folder late is a layout-shift source of the shell's own
   * (`stable_paint.spec.ts` records it and holds it to nothing either).
   * Shifts the browser forgives after an input are recorded too, marked, so
   * a late change landing after a click is still caught.
   */
  async function watchShifts(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const shifts: { value: number; input: boolean; sources: string[] }[] =
        [];
      (window as unknown as { __shifts: typeof shifts }).__shifts = shifts;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: { node?: Node | null }[];
        })[]) {
          shifts.push({
            value: entry.value,
            input: entry.hadRecentInput,
            sources: (entry.sources ?? []).map((source) => {
              const node = source.node as HTMLElement | null | undefined;
              const el =
                node instanceof Element ? node : (node?.parentElement ?? null);
              const where = el?.closest('[data-testid="sidebar"]')
                ? "sidebar:"
                : "";
              const item =
                el?.closest("[data-planning-item]")?.getAttribute(
                  "data-planning-item",
                ) ?? "";
              return node
                ? `${where}${item}:${node.nodeName}.${String(node.className).slice(0, 60)}`
                : "?";
            }),
          });
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
  }
  /** The shifts with a source anywhere but the sidebar, input or not. */
  const shifted = (page: Page, withInput = false) =>
    page.evaluate(
      (withInput) =>
        (
          window as unknown as {
            __shifts: { value: number; input: boolean; sources: string[] }[];
          }
        ).__shifts.filter(
          (shift) =>
            (withInput || !shift.input) &&
            (shift.sources.length === 0 ||
              shift.sources.some((source) => !source.startsWith("sidebar:"))),
        ),
      withInput,
    );
  /** Forget the shifts recorded so far. */
  const resetShifts = (page: Page) =>
    page.evaluate(() => {
      (window as unknown as { __shifts: unknown[] }).__shifts.length = 0;
    });

  test("shows ten cards and the rest counted, in two review requests at most, and Back from a document returns to the same scroll", async ({
    page,
  }) => {
    // The page's review requests, and any one document's.
    const reads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/planning/reviews")) reads.push("POST");
      if (pathname.endsWith("/api/review")) reads.push(`GET ${pathname}`);
    });
    await watchShifts(page);
    // Short enough that the page scrolls.
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.goto("/.vantage/planning");
    const needsYou = section(page, "Needs you");
    await expect(needsYou.getByRole("article")).toHaveCount(10);
    await expect(page.getByTestId("needs-you-count")).toHaveText("14");

    // A visit reads its reviews in two requests at most, and no document's
    // alone.
    await expect.poll(() => reads.length).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(reads.length).toBeLessThanOrEqual(2);
    expect(reads.filter((read) => read !== "POST")).toEqual([]);

    // D12: nothing painted moved.
    const shifts = await shifted(page);
    expect(shifts, JSON.stringify(shifts)).toEqual([]);

    // A larger page size: the setting and its effect, and no history entry.
    await page.getByTestId("needs-you-end").getByRole("button", { name: "20" }).click();
    const last = card(page, "OQ-P12: Which way for part 12?");
    await expect(last).toBeVisible();
    await expect(needsYou.getByRole("article")).toHaveCount(14);
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);

    // The reader scrolls, then opens a card's document where it stands, in
    // this tab, by its name.
    await pane(page).evaluate((el) => el.scrollTo(0, 200));
    await expect.poll(() => paneTop(page)).toBe(200);
    // The page saves as the reader scrolls, one frame behind.
    await page.waitForTimeout(100);
    await last
      .getByRole("link", { name: PAGED, exact: true })
      .dispatchEvent("click");
    await expect(page).toHaveURL(/\/plans\/paged\.md$/);
    await expect(
      page.getByRole("heading", { name: "The paged plan" }),
    ).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    // The size chosen is remembered: the same cards, at the same scroll.
    await expect(last).toBeVisible();
    await expect.poll(() => paneTop(page)).toBe(200);
  });

  // planning-to-do-list.md §11, items 1 to 3 and 5: answering moves only
  // what was answered, and an agent's reply arriving marks its row and moves
  // nothing, until Refresh.
  test("shrinks an answered card to a row in place, marks a late reply, and lays it out on Refresh, moving nothing painted", async ({
    page,
    request,
  }) => {
    await watchShifts(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/.vantage/planning");
    const needsYou = section(page, "Needs you");
    await expect(needsYou.getByRole("article")).toHaveCount(10);
    const first = card(page, "OQ-E1: Which way does it go?");
    const second = card(page, "OQ-E2: How soon?");
    const third = card(page, "OQ-P1: Which way for part 1?");
    const before = {
      first: await first.boundingBox(),
      second: await second.boundingBox(),
    };

    // Answering the third card: it shrinks where it stands, and the eleventh
    // question joins the end of the cards.
    await third.getByRole("button", { name: "Take this leaning" }).click();
    const answered = row(page, "OQ-P1: Which way for part 1?");
    await expect(answered.getByText("Leaning taken")).toBeVisible();
    await expect(
      card(page, "OQ-P9: Which way for part 9?"),
    ).toBeVisible();
    await expect(needsYou.getByRole("article")).toHaveCount(10);
    // Nothing above it moved.
    expect(await first.boundingBox()).toEqual(before.first);
    expect(await second.boundingBox()).toEqual(before.second);

    // The agent replies, as it does, through the review inbox.
    const review = (await (
      await request.get(`/api/review?path=${encodeURIComponent(PAGED)}`)
    ).json()) as { comments: { id: string }[] };
    const [take] = review.comments;
    expect(take).toBeTruthy();
    await page.waitForTimeout(300);
    await resetShifts(page);
    const rowBox = await answered.boundingBox();
    const inbox = path.join(REPO, ".vantage", "inbox");
    mkdirSync(inbox, { recursive: true });
    const scratch = path.join(inbox, "e2e-reply.writing");
    writeFileSync(
      scratch,
      `${JSON.stringify({
        path: PAGED,
        id: take!.id,
        summary: "Which part do you mean?",
        nonce: `e2e-${Date.now()}`,
      })}\n`,
    );
    renameSync(scratch, path.join(inbox, "e2e-reply.jsonl"));

    // Marked, counted, and nothing moved: not the row, not anything else.
    await expect(
      answered.getByRole("button", { name: "New reply" }),
    ).toBeVisible();
    await expect(page.locator("[data-planning-updates]")).toBeVisible();
    expect(await answered.boundingBox()).toEqual(rowBox);
    await page.waitForTimeout(500);
    const late = await shifted(page, true);
    expect(late, JSON.stringify(late)).toEqual([]);

    // Refresh lays it out: the take answered, it needs you again, a card.
    await page.locator("[data-planning-updates]").click();
    await expect(row(page, "OQ-P1: Which way for part 1?")).toHaveCount(0);
    await expect(third).toBeVisible();
    await expect(page.locator("[data-planning-updates]")).toBeHidden();
  });

  test("explains each section, and copies an agent request from the real index, moving nothing and printing no button", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/.vantage/planning");
    await openGroup(page, "Maintenance");
    const unrouted = section(page, "Not on a roadmap");
    await expect(unrouted.getByRole("listitem").first()).toBeVisible();
    // The line under each heading, with the section.
    await expect(unrouted).toHaveAccessibleDescription(
      "Open questions no roadmap links to. An agent proposes where each goes; you confirm.",
    );
    await expect(
      section(page, "Ready to graduate").getByText(
        "Built, with no questions left. An agent turns it into a reference doc.",
      ),
    ).toBeVisible();
    // An agent's kinds have the button, and Needs you has none.
    await expect(
      section(page, "Needs you").locator("[data-planning-agent-request]"),
    ).toHaveCount(0);

    const copy = page.getByRole("button", {
      name: "Copy agent request for Not on a roadmap",
    });
    const about = unrouted.locator("[data-planning-section-about]");
    // Measured where the click will find it, so the click scrolls nothing.
    await copy.scrollIntoViewIfNeeded();
    const before = {
      copy: await copy.boundingBox(),
      about: await about.boundingBox(),
      first: await unrouted.getByRole("listitem").first().boundingBox(),
    };
    await copy.click();
    await expect(copy).toHaveText("Copied");
    // Copied stands in the label's own room: nothing moved.
    expect({
      copy: await copy.boundingBox(),
      about: await about.boundingBox(),
      first: await unrouted.getByRole("listitem").first().boundingBox(),
    }).toEqual(before);
    // For every one of the kind's 27, and the repository by the root the
    // server reports.
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^Repository: \/\S*test_repo\n/);
    expect(copied.match(/^- \S+:\d+ /gm)).toHaveLength(27);
    expect(copied).toContain("plans/unrouted.md:");
    expect(copied).toMatch(/Verify: .*vantage-check index/);
    await expect(copy).toHaveText("Copy agent request", { timeout: 4000 });

    // Copy answers + maintenance, with every kind checked, copies every
    // request (planning-to-do-list.md §5).
    await page
      .getByRole("button", {
        name: "Choose what Copy answers + maintenance copies",
      })
      .click();
    await page
      .getByRole("group", { name: "What Copy answers + maintenance copies" })
      .getByRole("button", { name: "All" })
      .click();
    await page
      .getByRole("button", { name: /^Copy answers \+ maintenance / })
      .click();
    const all = await page.evaluate(() => navigator.clipboard.readText());
    expect(all).toContain("Not on a roadmap (27)");
    expect(all).toContain("Ready to graduate (1)");
    expect(all).toContain("- plans/shipped.md");

    await page.emulateMedia({ media: "print" });
    await expect(
      page.locator("[data-planning-agent-request]:visible"),
    ).toHaveCount(0);
    await expect(about).toBeVisible();
  });

  // A copy button keeps the room of its longer label, so Copied moves
  // nothing, and draws what it says centered in that room: its icon, its
  // label and, on Copy answers, the count, with as much room before them as
  // after. Copy answers once left its count outside that room, so "Copied"
  // centered its icon and label in the room and drew the count at the end,
  // with three times as much room before the icon as after the count.
  test("draws Copy answers and Copy agent request centered in their room, before the click and after it", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    // Wide enough for the header's labels beside the sidebar, now that it
    // holds Copy answers + maintenance too (planning-to-do-list.md §3.1).
    await page.setViewportSize({ width: 1440, height: 720 });
    await page.goto("/.vantage/planning");
    // An answer waiting on the agent, so Copy answers has one to copy.
    await card(page, LAST)
      .getByRole("button", { name: "Take this leaning" })
      .click();
    const count = page.getByTestId("pending-answers");
    await expect(count).toHaveText("1");
    await expect(page.getByTestId("planning-header")).not.toHaveAttribute(
      "data-yield",
      /\blabels\b/,
    );

    await openGroup(page, "Maintenance");
    const request = page.getByRole("button", {
      name: "Copy agent request for Not on a roadmap",
    });
    // Measured where the click will find it, so the click scrolls nothing.
    await request.scrollIntoViewIfNeeded();
    for (const [button, rest] of [
      [page.locator("button", { has: count }), "Copy answers1"],
      [request, "Copy agent request"],
    ] as const) {
      const handle = (await button.elementHandle())!;
      const was = await drawnIn(handle);
      expect(was.text).toBe(rest);
      expect(
        Math.abs(was.before - was.after),
        `${rest}: ${JSON.stringify(was)}`,
      ).toBeLessThanOrEqual(1);

      await handle.click();
      await expect(button).toContainText("Copied");
      const now = await drawnIn(handle);
      expect(
        sameBox(now.box, was.box),
        `${rest} → Copied: ${JSON.stringify(was.box)} → ${JSON.stringify(now.box)}`,
      ).toBe(true);
      expect(
        Math.abs(now.before - now.after),
        `${rest} → Copied: ${JSON.stringify(now)}`,
      ).toBeLessThanOrEqual(1);
      // Copied is the shorter label by far, so it has room either side.
      expect(now.before, JSON.stringify(now)).toBeGreaterThan(now.padding + 5);
    }
  });

  // planning-to-do-list.md §5.1 and §11, item 7: the panel opens on hover
  // after a rest and from its ▾, its checkboxes are remembered, and none of
  // it moves anything painted.
  test("opens Copy answers + maintenance's panel on hover and from its ▾, remembers its checkboxes, and moves nothing painted", async ({
    page,
  }) => {
    await watchShifts(page);
    await page.goto("/.vantage/planning");
    await expect(section(page, "Needs you").getByRole("article")).toHaveCount(
      10,
    );
    await resetShifts(page);
    const button = page.getByRole("button", {
      name: /^Copy answers \+ maintenance /,
    });
    const toggle = page.getByRole("button", {
      name: "Choose what Copy answers + maintenance copies",
    });
    const panel = page.getByRole("group", {
      name: "What Copy answers + maintenance copies",
    });
    // Focus alone never opens it.
    await button.focus();
    await page.waitForTimeout(400);
    await expect(panel).toHaveCount(0);
    // Hover opens it once the pointer has rested on the button.
    await button.hover();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(
      "Your answers, the same as Copy answers, plus the maintenance this page found for the agent.",
    );
    // It stays while the pointer is on the panel, and goes once it leaves
    // both.
    await panel.hover();
    await page.waitForTimeout(500);
    await expect(panel).toBeVisible();
    await page.mouse.move(5, 700);
    await expect(panel).toHaveCount(0);

    // Ready to build starts unchecked; None greys the button out, and the ▾
    // still opens the panel.
    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("checkbox", { name: /Ready to build/ })).not.toBeChecked();
    await expect(
      panel.getByRole("checkbox", { name: /Not on a roadmap/ }),
    ).toBeChecked();
    await panel.getByRole("button", { name: "None" }).click();
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(panel).toBeVisible();
    const shifts = await shifted(page);
    expect(shifts, JSON.stringify(shifts)).toEqual([]);

    // A reload keeps the checkboxes.
    await page.reload();
    await expect(section(page, "Needs you").getByRole("article")).toHaveCount(
      10,
    );
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await toggle.click();
    await expect(
      panel.getByRole("checkbox", { name: /Not on a roadmap/ }),
    ).not.toBeChecked();
  });

  test("moves nothing painted on a load that has to build the index first", async ({
    page,
  }) => {
    await watchShifts(page);
    await page.goto("/.vantage/planning");
    await expect(section(page, "Needs you").getByRole("article")).toHaveCount(
      10,
    );
    // Long enough for the second reviews request, and anything late.
    await page.waitForTimeout(1500);
    const shifts = await shifted(page);
    expect(shifts, JSON.stringify(shifts)).toEqual([]);
  });
});
