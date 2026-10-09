import { test, expect, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveFixture } from "./ownServer";

// A question card's fold in a real browser (docs/reference/planning-index.md
// §6.6): the fade at the cut and Show full question directly under it, only
// on a card that hides something; Show less after the question; the page's
// Expand all / Collapse all and the default it leaves for every card rendered
// later; and none of it moving what is painted (§12). jsdom lays nothing out
// and paints nothing, so where the control sits, what the fade looks like and
// what the browser scores as a layout shift are measured here.
//
// The fixture is `fixtures/card_fold/`, served by a server of this spec's own:
// Needs you holds fold.md's twelve questions — OQ-F1 and OQ-F11
// run past the lines a folded card shows, OQ-F1 with a link in what it cuts
// off, OQ-F2 fits with its options folded away after it, the rest fit and fold
// nothing — then later.md's long OQ-L1 and short OQ-L2, below OQ-F11, then
// aside.md's long OQ-A1, in a list, and OQ-A2, a paragraph outside one, which
// is one block the card cuts short itself. The page opens at twenty cards a
// page, so every question is a card; at ten, those past OQ-F10 are not
// (docs/design/planning-to-do-list.md §3.3).

const here = path.dirname(fileURLToPath(import.meta.url));
const EXPANDED = "vantage:planningCardsExpanded";

const card = (page: Page, id: string) =>
  page.getByRole("article", { name: new RegExp(`^${id}:`) });
const clampOf = (card: Locator) =>
  card.locator('[data-planning-card-part="clamp"]');
const expand = (card: Locator) =>
  card.getByRole("button", { name: "Show full question" });
const collapse = (card: Locator) =>
  card.getByRole("button", { name: "Show less" });
const pane = (page: Page) => page.locator("[data-content-scroll]");
const bodyOf = (card: Locator) => card.locator(".planning-card-body");
/** How far below the pane's top `el` is. */
const belowPaneTop = (page: Page, el: Locator) =>
  el.evaluate((node) => {
    const scroller = node.closest("[data-content-scroll]")!;
    return (
      node.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    );
  });
/** Whether any of the focused element is inside the pane's visible rows. */
const focusInPane = (page: Page) =>
  page.evaluate(() => {
    const focused = document.activeElement!;
    const view = document
      .querySelector("[data-content-scroll]")!
      .getBoundingClientRect();
    const box = focused.getBoundingClientRect();
    return box.bottom > view.top && box.top < view.bottom;
  });
/** Choose a page size on Needs you's end line. */
const chooseSize = (page: Page, size: string) =>
  page
    .getByTestId("needs-you-end")
    .getByRole("button", { name: size, exact: true })
    .click();
const maskOf = (el: Locator) =>
  el.evaluate((node) => {
    const style = getComputedStyle(node);
    return style.maskImage || style.webkitMaskImage;
  });

/** The page size this browser remembers for the next visit. */
const PAGE_SIZE = "vantage:planningPageSize";

async function open(page: Page, height = 900, size = 20): Promise<void> {
  await page.addInitScript(
    ([key, n]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, n);
    },
    [PAGE_SIZE, String(size)] as const,
  );
  await page.setViewportSize({ width: 1280, height });
  await page.goto("/.vantage/planning");
  await expect(card(page, "OQ-F1")).toBeVisible({ timeout: 30_000 });
}

/**
 * Every layout shift after the page's first paint that no input excuses, and
 * each question card's height in the frame that first paints it, both
 * recorded from before the app's own scripts run.
 */
async function watchPaint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __shifts: { at: number; value: number; sources: string[] }[];
      __painted: Record<string, number>;
    };
    w.__shifts = [];
    w.__painted = {};
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
        sources?: { node?: Node | null }[];
      })[]) {
        if (entry.hadRecentInput) continue;
        const sources = (entry.sources ?? []).map((source) => {
          const node = source.node as HTMLElement | null | undefined;
          const el =
            node instanceof Element ? node : (node?.parentElement ?? null);
          const where = el?.closest('[data-testid="sidebar"]')
            ? "sidebar:"
            : "";
          return node ? `${where}${node.nodeName}` : "?";
        });
        // The app shell's file tree filling a folder late is a shift of the
        // shell's own (stable_paint.spec.ts), not the planning page's.
        if (
          sources.length > 0 &&
          sources.every((s) => s.startsWith("sidebar:"))
        )
          continue;
        w.__shifts.push({ at: entry.startTime, value: entry.value, sources });
      }
    }).observe({ type: "layout-shift", buffered: true });
    // A card's height as the frame that first shows it paints it: read in the
    // animation frame after it is inserted, after every microtask of the
    // commit that inserted it, which is where its fold is measured.
    new MutationObserver(() => {
      requestAnimationFrame(() => {
        for (const el of document.querySelectorAll<HTMLElement>(
          "[data-planning-question]",
        )) {
          if (!(el.id in w.__painted)) {
            w.__painted[el.id] = el.getBoundingClientRect().height;
          }
        }
      });
    }).observe(document, { childList: true, subtree: true });
  });
}
const shiftsSince = (page: Page, since: number) =>
  page.evaluate(
    (since) =>
      (
        window as unknown as {
          __shifts: { at: number; value: number; sources: string[] }[];
        }
      ).__shifts.filter((s) => s.at >= since),
    since,
  );
/** Each card on screen whose height is not the one it first painted with. */
const movedCards = (page: Page) =>
  page.evaluate(() => {
    const painted = (window as unknown as { __painted: Record<string, number> })
      .__painted;
    return Array.from(
      document.querySelectorAll<HTMLElement>("[data-planning-question]"),
    )
      .map((el) => ({
        id: el.id,
        painted: painted[el.id],
        now: el.getBoundingClientRect().height,
      }))
      .filter(
        (c) => c.painted === undefined || Math.abs(c.painted - c.now) > 0.5,
      );
  });

type Rgb = [number, number, number];
type Clip = { x: number; y: number; width: number; height: number };

/** The pixels of `clip` as the page paints them, decoded in the page. */
async function pixelsOf(
  page: Page,
  clip: Clip,
): Promise<{ data: number[]; width: number }> {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const image = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    return { data: Array.from(data), width: image.width };
  }, png.toString("base64"));
}
/** The mean color of `clip`. */
async function colorOf(page: Page, clip: Clip): Promise<Rgb> {
  const { data } = await pixelsOf(page, clip);
  const sum: Rgb = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) sum[c as 0 | 1 | 2] += data[i + c]!;
  }
  const n = data.length / 4;
  return sum.map((v) => v / n) as Rgb;
}
/** How far the farthest pixel of `clip` is from `background`: its ink. */
async function inkOf(page: Page, clip: Clip, background: Rgb): Promise<number> {
  const { data } = await pixelsOf(page, clip);
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    ink = Math.max(
      ink,
      ...[0, 1, 2].map((c) => Math.abs(data[i + c]! - background[c]!)),
    );
  }
  return ink;
}

test.describe("a question card's fold", () => {
  test.describe.configure({ mode: "serial" });
  serveFixture(path.join(here, "fixtures/card_fold"));

  test("fades and offers Show full question only where the folded card hides something, directly at the cut", async ({
    page,
  }) => {
    await open(page);
    // OQ-F1 runs past its lines; OQ-F2 fits, with its options folded away.
    expect(
      await clampOf(card(page, "OQ-F1")).evaluate(
        (el) => el.scrollHeight > el.clientHeight + 1,
      ),
    ).toBe(true);
    expect(
      await clampOf(card(page, "OQ-F2")).evaluate(
        (el) => el.scrollHeight <= el.clientHeight + 1,
      ),
    ).toBe(true);
    await expect(card(page, "OQ-F2").getByText("A — Fold them.")).toBeHidden();

    for (const id of ["OQ-F1", "OQ-F2", "OQ-A1", "OQ-A2"]) {
      const question = card(page, id);
      const clamp = clampOf(question);
      expect(await maskOf(clamp), id).toContain("linear-gradient");
      const button = expand(question);
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute("aria-expanded", "false");
      // Directly under the faded line, from its left edge: where the reader
      // sees the question stop.
      const cut = (await clamp.boundingBox())!;
      const at = (await button.boundingBox())!;
      const gap = at.y - (cut.y + cut.height);
      expect(gap, id).toBeGreaterThanOrEqual(0);
      expect(gap, id).toBeLessThanOrEqual(6);
      expect(Math.abs(at.x - cut.x), id).toBeLessThanOrEqual(1);
      // In the question, and not in its row of controls.
      expect(
        await button.evaluate(
          (el) =>
            el.closest("[data-planning-card-cut]") !== null &&
            el.closest("[data-planning-card-controls]") === null,
        ),
      ).toBe(true);
    }

    // OQ-A2 is one block, which the card cuts short itself: its cut is the
    // one sibling the card keeps shown beside it.
    expect(
      await clampOf(card(page, "OQ-A2")).evaluate((el) => [
        el.hasAttribute("data-planning-card-unit"),
        el.nextElementSibling?.hasAttribute("data-planning-card-cut"),
      ]),
    ).toEqual([true, true]);

    // One that fits and folds nothing: no fade, no control, and no line kept
    // for one.
    const fits = card(page, "OQ-F3");
    expect(await maskOf(clampOf(fits))).toBe("none");
    await expect(
      fits.getByRole("button", { name: /^Show (full question|less)$/ }),
    ).toHaveCount(0);
    expect(
      await fits
        .locator("[data-planning-card-cut]")
        .evaluate((el) => getComputedStyle(el).display),
    ).toBe("none");
    // Every card on the page: a control exactly where there is a fade.
    const shapes = await page
      .locator("[data-planning-question]")
      .evaluateAll((cards) =>
        cards.map((el) => {
          const clamp = el.querySelector('[data-planning-card-part="clamp"]');
          const mask = clamp ? getComputedStyle(clamp).maskImage : "none";
          return {
            id: el.getAttribute("aria-label")!.split(":")[0],
            fade: mask !== "none" && mask !== "",
            control: el.querySelector("[data-planning-card-fold]") !== null,
          };
        }),
      );
    expect(shapes.filter((s) => s.fade !== s.control)).toEqual([]);
    expect(shapes.filter((s) => s.control).map((s) => s.id)).toEqual([
      "OQ-F1",
      "OQ-F2",
      "OQ-F11",
      "OQ-L1",
      "OQ-A1",
      "OQ-A2",
    ]);
  });

  test("unfolds from the cut and folds from the end, by keyboard too, keeping the card's top where it was on screen", async ({
    page,
  }) => {
    await open(page, 600);
    const question = card(page, "OQ-F2");
    // Scrolled so the card's top is above the pane, and its cut just inside.
    const paneTop = (await pane(page).boundingBox())!.y;
    const clamp = (await clampOf(question).boundingBox())!;
    await pane(page).evaluate(
      (el, by) => el.scrollBy(0, by),
      clamp.y + clamp.height - paneTop - 6,
    );
    const top = (await question.boundingBox())!.y;
    expect(top).toBeLessThan(paneTop);
    await expect(expand(question)).toBeInViewport();

    await expand(question).focus();
    await page.keyboard.press("Enter");
    await expect(question.getByText("A — Fold them.")).toBeVisible();
    expect(await maskOf(clampOf(question))).toBe("none");
    // The focus is on the question it revealed, which the control controls.
    const less = collapse(question);
    await expect(bodyOf(question)).toBeFocused();
    expect(await bodyOf(question).getAttribute("id")).toBe(
      await less.getAttribute("aria-controls"),
    );
    await expect(less).toHaveAttribute("aria-expanded", "true");
    expect((await question.boundingBox())!.y).toBeCloseTo(top, 0);
    // At the end of the question, its leaning included, above its controls.
    const leaning = (await question
      .locator('[data-planning-card-part="leaning"]')
      .boundingBox())!;
    const lessAt = (await less.boundingBox())!;
    const controls = (await question
      .locator("[data-planning-card-controls]")
      .boundingBox())!;
    expect(lessAt.y).toBeGreaterThanOrEqual(leaning.y + leaning.height);
    expect(lessAt.y + lessAt.height).toBeLessThanOrEqual(controls.y);

    await less.focus();
    await page.keyboard.press("Enter");
    await expect(question.getByText("A — Fold them.")).toBeHidden();
    await expect(expand(question)).toBeFocused();
    expect((await question.boundingBox())!.y).toBeCloseTo(top, 0);

    // And with the pointer, from a card read down to its end: folding it
    // would leave all of it above the pane, so its top comes into view.
    await expand(question).click();
    await expect(collapse(question)).toBeVisible();
    const unfolded = (await question.boundingBox())!;
    await pane(page).evaluate(
      (el, by) => el.scrollBy(0, by),
      unfolded.y + unfolded.height - paneTop - 80,
    );
    await expect(collapse(question)).toBeInViewport();
    await collapse(question).click();
    await expect(expand(question)).toBeInViewport();
    expect((await question.boundingBox())!.y).toBeCloseTo(paneTop + 16, 0);
  });

  test("keeps the focus in view when a control at the pane's bottom edge unfolds a long card", async ({
    page,
  }) => {
    await open(page);
    const question = card(page, "OQ-A1");
    const button = expand(question);
    // Tabbed to from above, which brings it to the pane's bottom edge.
    const paneBox = (await pane(page).boundingBox())!;
    const at = (await button.boundingBox())!;
    await pane(page).evaluate(
      (el, by) => el.scrollBy(0, by),
      at.y + at.height - (paneBox.y + paneBox.height) + 4,
    );
    await button.focus();
    await expect(button).toBeInViewport({ ratio: 1 });
    const top = (await question.boundingBox())!.y;
    await page.keyboard.press("Enter");
    await expect(collapse(question)).toBeAttached();
    // Show less is past the question, below the pane; the focus is on the
    // question, in view, with the card's top where it was.
    await expect(collapse(question)).not.toBeInViewport();
    await expect(bodyOf(question)).toBeFocused();
    expect(await focusInPane(page)).toBe(true);
    expect((await question.boundingBox())!.y).toBeCloseTo(top, 0);
  });

  test("unfolds a card whose cut-off link the reader tabs to, and never scrolls the clamp", async ({
    page,
  }) => {
    await open(page);
    const question = card(page, "OQ-F1");
    const link = question.getByRole("link", { name: "the roadmap" });
    // Below the last line the folded card shows.
    const clamp = (await clampOf(question).boundingBox())!;
    expect((await link.boundingBox())!.y).toBeGreaterThan(
      clamp.y + clamp.height,
    );
    await question.getByRole("link", { name: "fold.md" }).first().focus();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      if (await link.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(link).toBeFocused();
    await expect(bodyOf(question)).toHaveAttribute(
      "data-planning-card-unfolded",
      "",
    );
    await expect(link).toBeInViewport({ ratio: 1 });
    expect(await clampOf(question).evaluate((el) => el.scrollTop)).toBe(0);
    await expect(collapse(question)).toBeVisible();

    // Folded again, the card opens on the start of its question.
    await collapse(question).click();
    expect(await clampOf(question).evaluate((el) => el.scrollTop)).toBe(0);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    expect(await clampOf(question).evaluate((el) => el.scrollTop)).toBe(0);
  });

  for (const unfolded of [false, true]) {
    test(`lands a jump and a link on a card where the cards above it settle (${unfolded ? "unfolded" : "folded"})`, async ({
      page,
    }) => {
      await page.addInitScript(
        ([key, on]) => {
          localStorage.setItem("vantage:tocOpen", "true");
          localStorage.setItem(key, on);
        },
        [EXPANDED, String(unfolded)] as const,
      );
      await open(page, 600);
      const f5 = await card(page, "OQ-F1").evaluate((el) =>
        el.id.replace(/OQ-F1$/, "OQ-F5"),
      );
      const target = card(page, "OQ-L1");
      // The outline's jump to later.md goes past OQ-F11, above OQ-L1, which
      // has a cut of its own to draw.
      await page
        .getByRole("navigation", { name: "Planning outline" })
        .locator('[data-testid=outline-document][data-path="later.md"]')
        .click();
      await expect(target).toBeVisible();
      await expect(
        unfolded
          ? collapse(card(page, "OQ-F11"))
          : expand(card(page, "OQ-F11")),
      ).toBeVisible();
      await page.waitForTimeout(500);
      // ANCHOR_MARGIN in lib/anchorScroll.ts.
      expect(
        Math.abs((await belowPaneTop(page, target)) - 16),
      ).toBeLessThanOrEqual(1);

      // The same entry's link, opened afresh, and a card's below OQ-F1's and
      // OQ-F2's cuts.
      const href = await page
        .getByRole("navigation", { name: "Planning outline" })
        .locator('[data-testid=outline-document][data-path="later.md"]')
        .getAttribute("href");
      for (const [url, id] of [
        [href!, "OQ-L1"],
        [`/.vantage/planning#${f5}`, "OQ-F5"],
      ] as const) {
        await page.goto("about:blank");
        await page.goto(url);
        await expect(card(page, id)).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(500);
        expect(
          Math.abs((await belowPaneTop(page, card(page, id))) - 16),
          url,
        ).toBeLessThanOrEqual(1);
      }
    });
  }

  test("Expand all unfolds every card, opens a new layout's cards and the next visit unfolded, and a card's own fold lasts until the next press", async ({
    page,
  }) => {
    await open(page, 900, 10);
    const toggle = page.getByRole("button", { name: "Expand all" });
    // At the end of the section bar's line.
    const bar = (await page
      .getByRole("navigation", { name: "Sections" })
      .boundingBox())!;
    const at = (await toggle.boundingBox())!;
    expect(at.x).toBeGreaterThan(bar.x + bar.width);
    expect(
      Math.abs(at.y + at.height / 2 - (bar.y + bar.height / 2)),
    ).toBeLessThan(4);

    await toggle.click();
    await expect(
      page.getByRole("button", { name: "Collapse all" }),
    ).toBeVisible();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), EXPANDED),
    ).toBe("true");
    await expect(
      page.getByRole("button", { name: "Show full question" }),
    ).toHaveCount(0);
    await expect(card(page, "OQ-F2").getByText("A — Fold them.")).toBeVisible();

    // The reader folds one card back.
    await collapse(card(page, "OQ-F1")).click();
    await expect(expand(card(page, "OQ-F1"))).toBeVisible();

    // A larger page size brings cards in unfolded, and leaves the rest as
    // they were left.
    await chooseSize(page, "20");
    await expect(collapse(card(page, "OQ-F11"))).toBeVisible();
    await expect(collapse(card(page, "OQ-A1"))).toBeVisible();
    await expect(expand(card(page, "OQ-F1"))).toBeVisible();
    await expect(collapse(card(page, "OQ-F2"))).toBeVisible();

    // The next visit opens every card unfolded.
    await page.reload();
    await expect(collapse(card(page, "OQ-F1"))).toBeVisible({
      timeout: 30_000,
    });
    await expect(collapse(card(page, "OQ-F2"))).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Collapse all" }),
    ).toBeVisible();

    // Each press brings every card to the page's, the reader's own folds
    // included.
    await collapse(card(page, "OQ-F1")).click();
    await expect(expand(card(page, "OQ-F1"))).toBeVisible();
    await page.getByRole("button", { name: "Collapse all" }).click();
    await expect(page.getByRole("button", { name: "Show less" })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate((key) => localStorage.getItem(key), EXPANDED),
    ).toBe("false");
    await page.getByRole("button", { name: "Expand all" }).click();
    await expect(
      page.getByRole("button", { name: "Show full question" }),
    ).toHaveCount(0);
  });

  test("moves nothing painted on a load, folded or unfolded, or on a page size chosen", async ({
    page,
  }) => {
    await watchPaint(page);
    await open(page, 900, 10);
    // Long enough for the reviews, and anything late.
    await page.waitForTimeout(1500);
    expect(await shiftsSince(page, 0)).toEqual([]);
    expect(await movedCards(page)).toEqual([]);

    const flipped = await page.evaluate(() => performance.now());
    await chooseSize(page, "20");
    await expect(card(page, "OQ-F11")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await shiftsSince(page, flipped)).toEqual([]);
    expect(await movedCards(page)).toEqual([]);

    // Unfolded from the first paint.
    await page.evaluate((key) => localStorage.setItem(key, "true"), EXPANDED);
    await page.reload();
    await expect(collapse(card(page, "OQ-F11"))).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(1500);
    expect(await shiftsSince(page, 0)).toEqual([]);
    expect(await movedCards(page)).toEqual([]);
  });

  test("prints every card unfolded, with no fade and no controls", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: "Expand all" }).click();
    await collapse(card(page, "OQ-F1")).click();
    await page.emulateMedia({ media: "print" });
    for (const id of ["OQ-F1", "OQ-F2", "OQ-A1"]) {
      const clamp = clampOf(card(page, id));
      expect(await maskOf(clamp), id).toBe("none");
      expect(
        await clamp.evaluate((el) => getComputedStyle(el).maxHeight),
        id,
      ).toBe("none");
    }
    // The whole of the long block, to its last words.
    expect(
      await clampOf(card(page, "OQ-F1")).evaluate(
        (el) => el.scrollHeight <= el.clientHeight + 1,
      ),
    ).toBe(true);
    await expect(card(page, "OQ-F2").getByText("A — Fold them.")).toBeVisible();
    await expect(page.locator("[data-planning-card-fold]:visible")).toHaveCount(
      0,
    );
    await expect(
      page.locator("[data-planning-card-controls]:visible"),
    ).toHaveCount(0);
    await expect(page.locator("[data-planning-cards-toggle]")).toBeHidden();
  });

  test("draws no fade in forced colors, where it would dim the reader's own contrast", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await open(page);
    expect(await maskOf(clampOf(card(page, "OQ-F1")))).toBe("none");
    await expect(expand(card(page, "OQ-F1"))).toBeVisible();
  });

  for (const [label, mode, theme] of [
    ["light", "light", null],
    ["dark", "dark", null],
    ["Solarized, dark", "dark", "solarized"],
  ] as const) {
    test(`fades the cut into the card's own background (${label})`, async ({
      page,
    }) => {
      await page.addInitScript(
        ([mode, theme]) => {
          localStorage.setItem("vantage:theme", mode);
          if (theme !== null) localStorage.setItem("vantage:colorTheme", theme);
        },
        [mode, theme] as const,
      );
      await open(page);
      if (theme !== null) {
        await expect(page.locator("html")).toHaveAttribute(
          "data-vantage-theme",
          theme,
        );
      }
      const question = card(page, "OQ-F1");
      const clamp = clampOf(question);
      const box = (await clamp.boundingBox())!;
      const article = (await question.boundingBox())!;
      const line = await clamp.evaluate((el) =>
        Number.parseFloat(getComputedStyle(el).lineHeight),
      );
      // The card's own background, from its padding beside the question.
      const background = await colorOf(page, {
        x: article.x + 4,
        y: box.y,
        width: box.x - article.x - 8,
        height: box.height,
      });
      // The lower part of the last line shown, folded and then unfolded.
      const cut = {
        x: box.x,
        y: box.y + box.height - line * 0.6,
        width: box.width,
        height: line * 0.6,
      };
      const first = { ...cut, y: box.y, height: line };
      const folded = await inkOf(page, cut, background);
      const opaque = await inkOf(page, first, background);
      await expand(question).focus();
      await page.keyboard.press("Enter");
      await expect(collapse(question)).toBeVisible();
      // No focus ring over the line measured.
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      const whole = await inkOf(page, cut, background);
      // Unfolded, the line is ink like the first; folded, it dissolves into
      // the card, and toward nothing but the card's own color.
      expect(whole).toBeGreaterThan(opaque * 0.6);
      expect(folded).toBeLessThan(whole * 0.65);
    });
  }
});
