import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The viewer header gives up room in a fixed order as it narrows, and the file
// name is the last thing to give any: the commit subject shrinks and then
// hides, then the absolute date, then the toolbar's text labels, then the
// breadcrumb's folders, then the relative time, then the repository's name,
// then the toolbar's actions fold into a "⋯", and only then does the name
// truncate. Before this the name was the only box in the row allowed to shrink
// at all, so at a 2000px window it was already "dur…" while every label stayed.
//
// The fixture document is real (fixtures/test_repo/docs/design/…); what the
// header shows about it is not. Its commit, its history and its review are
// routed here, because the fixture repository commits only page1.md and a
// review with answered comments can only be written by an agent's delivery.

const DIRS = ["docs", "design"];
const NAME = "durable-agent-storage-classes.md";
const PATH = [...DIRS, NAME].join("/");
const SUBJECT =
  "docs(design): storage classes for durable agent state, and why none is a tier";
const LABELS = ["2 commits", "Path", "Raw", "Review", "Dismiss 3 answered"];
const MINUTE = 60_000;

async function routeHeaderData(page: Page) {
  const now = Date.now();
  const commit = (i: number, message: string) => ({
    hexsha: String(i + 1).repeat(40),
    author_name: "Vantage e2e",
    author_email: "e2e@vantage.local",
    date: new Date(now - 12 * MINUTE - i * 90 * MINUTE).toISOString(),
    message,
  });
  const answered = (i: number) => ({
    id: `0000000${i}-0000-4000-8000-000000000000`,
    comment: `comment ${i}`,
    created_at: 1,
    anchor: null,
    fallback_text: "One paragraph for the review comments to anchor on.",
    reactions: [
      {
        actor: "agent",
        kind: "addressed",
        summary: "Done",
        before_text: "",
        after_text: "",
        timestamp: 2,
      },
    ],
  });
  const forPath = (pathname: string) => (url: URL) =>
    url.pathname === pathname && url.searchParams.get("path") === PATH;

  await page.route(forPath("/api/git/status"), (route) =>
    route.fulfill({
      json: { last_commit: commit(0, SUBJECT), git_status: null },
    }),
  );
  await page.route(forPath("/api/git/history"), (route) =>
    route.fulfill({
      json: [commit(0, SUBJECT), commit(1, "docs(design): first draft")],
    }),
  );
  await page.route(forPath("/api/review"), (route) =>
    route.fulfill({
      json: { file_path: PATH, comments: [1, 2, 3].map(answered) },
    }),
  );
}

/** What the header shows at the current width, read in one layout. */
interface Snapshot {
  headerWidth: number;
  headerHeight: number;
  /** The free width left in the row: header content box minus the items. */
  slack: number;
  name: { rendered: number; full: number; truncated: boolean };
  /** Present at all: an untracked file has no commit, so no subject. */
  subject: {
    present: boolean;
    shown: boolean;
    truncated: boolean;
    rendered: number;
  };
  /** The absolute date: drawn, not drawn, or not in the header (null). */
  date: boolean | null;
  /** The relative time beside the clock, likewise. */
  time: boolean | null;
  /** Each toolbar label, and whether it is drawn (not merely in the DOM). */
  labels: Record<string, boolean>;
  /** Each folder segment, and whether it is drawn as its own link. */
  dirs: Record<string, boolean>;
  /** The "…" that stands for collapsed folders. */
  collapsed: boolean;
  /** The repository's name at the head of the breadcrumb, drawn. */
  repo: boolean;
  /** The "⋯" the toolbar's actions fold into: drawn, or no toolbar (null). */
  more: boolean | null;
  /** Pairs of drawn header items whose boxes overlap, by their text. */
  overlaps: string[];
  /** Drawn items taller than one line, or poking out of the header. */
  escapes: string[];
}

function snapshot(page: Page, labels: string[], dirs: string[]) {
  return page.evaluate(
    ({ labels, dirs }): Snapshot => {
      const header = document.querySelector<HTMLElement>(
        '[data-testid="viewer-header"]',
      )!;
      const box = (el: Element) => el.getBoundingClientRect();
      // Drawn, as the reader sees it: a label moved off screen for assistive
      // technology keeps a 1px box, which is not the label being shown.
      const shown = (el: Element | null | undefined): boolean =>
        !!el &&
        box(el).width > 1 &&
        getComputedStyle(el).visibility !== "hidden";
      // What is drawn: the name's screen-reader copy is a 1px clipped box
      // that always "overflows", and is not text anyone sees.
      const drawn = (el: Element) => !el.classList.contains("sr-only");
      const overflows = (el: Element) =>
        [el, ...el.querySelectorAll("*")]
          .filter(drawn)
          .some((e) => e.scrollWidth > e.clientWidth + 0.5);
      const textWidth = (el: HTMLElement) => {
        const ctx = document.createElement("canvas").getContext("2d")!;
        const cs = getComputedStyle(el);
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const text = el.children.length
          ? [...el.children]
              .filter(drawn)
              .map((c) => c.textContent)
              .join("")
          : el.textContent;
        return ctx.measureText(text ?? "").width;
      };
      const byText = (text: string) =>
        [...header.querySelectorAll("span, a, button")].find(
          (el) => el.textContent?.trim() === text && el.children.length === 0,
        );

      const nameEl = header.querySelector<HTMLElement>(
        '[data-testid="breadcrumb-name"]',
      )!;
      const subjectEl = header.querySelector<HTMLElement>(
        '[data-testid="commit-subject"]',
      );
      const dateEl = header.querySelector('[data-testid="header-date"]');
      const timeEl = header.querySelector('[data-testid="header-time"]');
      const nav = header.querySelector("nav")!;

      // The row's items, in order: every direct child of the two halves.
      const [lead, tools] = [...header.children] as HTMLElement[];
      const items = [...lead.children, ...(tools ? tools.children : [])]
        .filter((el) => shown(el))
        .map((el) => ({ el, r: box(el) }));
      const h = box(header);
      const cs = getComputedStyle(header);
      const contentRight = h.right - parseFloat(cs.paddingRight);
      // What justify-between spreads between the halves is the room nobody
      // is using; the halves' own gap is not room anybody could have.
      const gap = parseFloat(cs.columnGap) || 0;
      const slack = tools
        ? box(tools).left - box(lead).right - gap
        : contentRight - box(lead).right;

      const label = (el: Element) =>
        (
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          el.textContent ||
          el.tagName
        ).slice(0, 40);
      const overlaps: string[] = [];
      for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1];
        const cur = items[i];
        if (cur.r.left < prev.r.right - 0.5) {
          overlaps.push(`${label(prev.el)} | ${label(cur.el)}`);
        }
      }
      // An item's room ends at its margin box: the commit button's `-mx-2`
      // bleeds its hover background into the header's padding on purpose.
      const roomRight = (el: Element, r: DOMRect) =>
        r.right + (parseFloat(getComputedStyle(el).marginRight) || 0);
      const escapes = items
        .filter(
          ({ el, r }) =>
            r.height > 40 ||
            r.top < h.top ||
            r.bottom > h.bottom ||
            r.left < h.left ||
            roomRight(el, r) > contentRight + 0.5,
        )
        .map(({ el }) => label(el));

      return {
        headerWidth: Math.round(h.width),
        headerHeight: Math.round(h.height),
        slack: Math.round(slack),
        name: {
          rendered: Math.round(box(nameEl).width),
          full: Math.round(textWidth(nameEl)),
          truncated: overflows(nameEl),
        },
        subject: {
          present: !!subjectEl,
          shown: shown(subjectEl),
          truncated: !!subjectEl && overflows(subjectEl),
          rendered: subjectEl ? Math.round(box(subjectEl).width) : 0,
        },
        date: dateEl ? shown(dateEl) : null,
        time: timeEl ? shown(timeEl) : null,
        labels: Object.fromEntries(labels.map((t) => [t, shown(byText(t))])),
        dirs: Object.fromEntries(
          dirs.map((d) => [
            d,
            shown(
              [...nav.querySelectorAll("a")].find(
                (a) => a.textContent?.trim() === d,
              ),
            ),
          ]),
        ),
        collapsed: shown(
          [...nav.querySelectorAll("button, span")].find(
            (el) => el.textContent?.trim() === "…",
          ),
        ),
        repo: shown(nav.querySelector(".hdr-repo")),
        more: header.querySelector(".hdr-more")
          ? shown(header.querySelector(".hdr-more"))
          : null,
        overlaps,
        escapes,
      };
    },
    { labels, dirs },
  );
}

/** The yield steps, first to be taken first. */
const STEPS = [
  "subject",
  "date",
  "labels",
  "dirs",
  "time",
  "repo",
  "actions",
  "name",
] as const;

/**
 * Whether the header would fit with only the first `count` steps taken: laid
 * out that way, read, and put back within one task, so it is never painted.
 * "Fits" is what the reader would see: no item past the header's content edge,
 * and a commit subject, if shown, no narrower than a dozen-character stub.
 */
function layoutWith(page: Page, count: number) {
  return page.evaluate(
    ({ steps, count }) => {
      const header = document.querySelector<HTMLElement>(
        '[data-testid="viewer-header"]',
      )!;
      const saved = header.dataset.yield ?? "";
      header.dataset.yield = steps.slice(0, count).join(" ");
      try {
        const edge =
          header.getBoundingClientRect().right -
          parseFloat(getComputedStyle(header).paddingRight);
        const [lead, tools] = [...header.children];
        const past = [lead, ...(tools ? tools.children : [])].filter(
          (el) =>
            el.getBoundingClientRect().right +
              (parseFloat(getComputedStyle(el).marginRight) || 0) >
            edge + 0.5,
        );
        const subject = header.querySelector('[data-testid="commit-subject"]');
        // Drawn at all, however narrow: a display:none box has no rects.
        const stub =
          !!subject &&
          subject.getClientRects().length > 0 &&
          subject.clientWidth < Math.min(subject.scrollWidth, 96) - 0.5;
        return { fits: past.length === 0 && !stub };
      } finally {
        header.dataset.yield = saved;
      }
    },
    { steps: [...STEPS], count },
  );
}

type Step = (typeof STEPS)[number];

/** Which of the steps this header has at all have been taken. */
function yielded(s: Snapshot): Partial<Record<Step, boolean>> {
  const labels = Object.values(s.labels);
  const dirs = Object.values(s.dirs);
  const out: Partial<Record<Step, boolean>> = {};
  if (s.subject.present) out.subject = !s.subject.shown;
  if (s.date !== null) out.date = !s.date;
  if (labels.length) out.labels = labels.every((v) => !v);
  if (dirs.length) out.dirs = dirs.every((v) => !v) && s.collapsed;
  if (s.time !== null) out.time = !s.time;
  out.repo = !s.repo;
  if (s.more !== null) out.actions = s.more;
  out.name = s.name.truncated;
  return out;
}

/**
 * How many steps have been taken, checking they were taken in order. Steps
 * the header has nothing for (no subject on an untracked file, no folders at
 * the root) are left out of both the count and the check.
 */
function level(s: Snapshot): number {
  const y = yielded(s);
  const present = STEPS.filter((step) => step in y);
  const n = present.findIndex((step) => !y[step]);
  const taken = n === -1 ? present.length : n;
  const out = present.slice(taken).filter((step) => y[step]);
  expect(out, `yielded out of order: ${JSON.stringify(s)}`).toEqual([]);
  return taken;
}

function checkInvariants(s: Snapshot) {
  expect(s.headerHeight, "the header grew a second line").toBe(56);
  expect(s.overlaps, "header items overlap").toEqual([]);
  expect(s.escapes, "header items wrap or leave the header").toEqual([]);
  // Each step is all-or-nothing: no half the labels, no one folder of two.
  const labels = Object.values(s.labels);
  if (labels.length) {
    expect(new Set(labels).size, `labels: ${JSON.stringify(s.labels)}`).toBe(1);
  }
  const dirs = Object.values(s.dirs);
  if (dirs.length) {
    expect(new Set(dirs).size, `dirs: ${JSON.stringify(s.dirs)}`).toBe(1);
    expect(dirs[0] && s.collapsed, "folders and their … both drawn").toBe(
      false,
    );
    expect(dirs[0] || s.collapsed, "folders neither drawn nor collapsed").toBe(
      true,
    );
  } else {
    // At the root the "…" stands for the repository, once it has folded.
    expect(s.collapsed, "a … with nothing behind it").toBe(!s.repo);
  }
  expect(s.repo || s.collapsed, "the repository neither drawn nor folded").toBe(
    true,
  );
  // The subject shrinks before anything else yields at all.
  if (s.subject.truncated && s.subject.shown) {
    expect(level(s), "something yielded while the subject still showed").toBe(
      0,
    );
  }
  level(s);
}

async function setHeaderWidth(page: Page, width: number) {
  const header = page.getByTestId("viewer-header");
  const viewport = page.viewportSize()!;
  const current = (await header.boundingBox())!.width;
  await page.setViewportSize({
    width: Math.round(viewport.width + width - current),
    height: viewport.height,
  });
  // A resize is laid out, observed and re-fitted before the next paint; two
  // frames is that paint and one more.
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  expect(Math.abs((await header.boundingBox())!.width - width)).toBeLessThan(1);
}

/**
 * Narrows the header into the middle of the widths at which `step` is the last
 * step it has taken, and returns that width.
 *
 * Where a step falls depends on how wide the header's text is drawn, so it is
 * found here, never assumed: a width names a step only for one set of fonts.
 * The two collapsed-folder tests once opened the "…" at a 900px header. Drawn
 * in DejaVu Sans the folders collapse from about 930px down, so there was a
 * "…" to open; drawn in Liberation Sans they wait until about 890px, so there
 * was none, and the tests failed wherever the browser had the narrower face,
 * CI's Chromium among them.
 *
 * The widest such width is found in 50px strides and then by halving the last
 * one, which holds because steps are only taken as the header narrows (the
 * second test below pins that); the narrowest in 10px strides on from there, to
 * the width that takes the next step or to `floor`, below which the window
 * would reach the tablet layout. The middle of the two is where a pixel of text
 * drawn a little differently cannot carry the header across either edge.
 */
async function narrowInto(page: Page, step: Step, floor = 500) {
  const header = page.getByTestId("viewer-header");
  const want = STEPS.indexOf(step) + 1;
  const countAt = async (width: number) => {
    await setHeaderWidth(page, width);
    const taken = (await header.getAttribute("data-yield")) ?? "";
    return taken.split(" ").filter(Boolean).length;
  };

  let wide = 2000;
  expect(await countAt(wide), `${step} taken at ${wide}px`).toBeLessThan(want);
  let narrow = wide - 50;
  while ((await countAt(narrow)) < want) {
    wide = narrow;
    narrow -= 50;
    expect(narrow, `${step} never taken`).toBeGreaterThanOrEqual(floor);
  }
  while (wide - narrow > 1) {
    const mid = Math.floor((wide + narrow) / 2);
    if ((await countAt(mid)) < want) wide = mid;
    else narrow = mid;
  }
  expect(
    await countAt(narrow),
    `the step after ${step} taken with it, at ${narrow}px`,
  ).toBe(want);

  let end = narrow;
  while (end - 10 >= floor && (await countAt(end - 10)) === want) end -= 10;
  const width = Math.round((narrow + end) / 2);
  expect(await countAt(width), `at ${width}px`).toBe(want);
  return width;
}

/**
 * A 700px sidebar, the widest there is, so the header can be made far
 * narrower than a phone's while the window stays a desktop one. `loaded` is
 * text the header shows once the reloaded page has everything it acts on.
 */
async function widenSidebar(page: Page, loaded = "Dismiss 3 answered") {
  await page.evaluate(() =>
    localStorage.setItem("vantage:sidebarWidth", "700"),
  );
  await page.reload();
  await expect(page.getByTestId("viewer-header").getByText(loaded)).toHaveCount(
    1,
  );
}

/** The name's extension: its text, and whether it is drawn whole. */
function extension(page: Page) {
  return page.evaluate(() => {
    const name = document.querySelector('[data-testid="breadcrumb-name"]')!;
    const ext = name.lastElementChild!;
    const nav = name.closest("nav")!.getBoundingClientRect();
    const r = ext.getBoundingClientRect();
    const more = name
      .closest("nav")!
      .querySelector(".hdr-dirs-collapsed")!
      .getBoundingClientRect();
    return {
      text: ext.textContent,
      whole:
        r.width > 0 && r.left >= nav.left - 0.5 && r.right <= nav.right + 0.5,
      width: r.width,
      nav: nav.width,
      stem: (name.children[1] as HTMLElement).getBoundingClientRect().width,
      /** The "…" starts left of the breadcrumb, cut off. */
      moreClipped: more.width > 0 && more.left < nav.left - 0.5,
    };
  });
}

test.describe("viewer header under width pressure", () => {
  test.beforeEach(async ({ page }) => {
    await routeHeaderData(page);
    await page.setViewportSize({ width: 2400, height: 900 });
    await page.goto(`/${PATH}`);
    await expect(
      page.getByRole("heading", { name: "Durable agent storage classes" }),
    ).toBeVisible();
    // Everything the yield steps act on has arrived: the commit, the history, and
    // the review that puts "Dismiss 3 answered" in the toolbar.
    const header = page.getByTestId("viewer-header");
    await expect(header.getByTestId("commit-subject")).toHaveText(SUBJECT);
    await expect(header.getByText("2 commits")).toHaveCount(1);
    await expect(header.getByText("Dismiss 3 answered")).toHaveCount(1);
  });

  test("the file name is the last thing to give up room", async ({ page }) => {
    for (const width of [2000, 1600, 1200, 900]) {
      await setHeaderWidth(page, width);
      const s = await snapshot(page, LABELS, DIRS);
      console.log(`header ${width}px: ${JSON.stringify(s)}`);
      checkInvariants(s);
      // The name fits on its own at every one of these widths, so no part of
      // it may be elided at any of them.
      expect(s.name.truncated, `name truncated at ${width}px`).toBe(false);
      expect(s.name.rendered).toBeGreaterThanOrEqual(s.name.full - 1);
    }
  });

  test("steps are only taken as the header narrows, and given back as it widens", async ({
    page,
  }) => {
    const down: number[] = [];
    for (let width = 2000; width >= 700; width -= 50) {
      await setHeaderWidth(page, width);
      const s = await snapshot(page, LABELS, DIRS);
      checkInvariants(s);
      const taken = level(s);
      // Nothing is given up that the header had room for: one step fewer
      // would not have fitted.
      if (taken > 0) {
        const fewer = await layoutWith(page, taken - 1);
        expect(
          fewer.fits,
          `over-yielded at ${width}px: ${JSON.stringify(s)}`,
        ).toBe(false);
      }
      if (down.length) expect(taken).toBeGreaterThanOrEqual(down.at(-1)!);
      down.push(taken);
    }
    expect(down[0], "gave something up at 2000px").toBe(0);
    expect(down.at(-1), "never collapsed the folders").toBeGreaterThanOrEqual(
      4,
    );

    // Widening again gives every step back at the width it was taken.
    for (let i = down.length - 1, width = 700; i >= 0; i--, width += 50) {
      await setHeaderWidth(page, width);
      const s = await snapshot(page, LABELS, DIRS);
      checkInvariants(s);
      expect(level(s), `at ${width}px on the way back up`).toBe(down[i]);
    }
  });

  test("collapsed folders stay reachable from the …", async ({ page }) => {
    const width = await narrowInto(page, "dirs");
    const header = page.getByTestId("viewer-header");
    const more = header.getByRole("button", { name: /docs\/design/ });
    await expect(more, `no … at ${width}px`).toBeVisible();
    await expect(header.getByTestId("breadcrumb-name")).toHaveAttribute(
      "title",
      PATH,
    );
    await more.click();
    const menu = page.getByRole("menu", { name: "Folders" });
    await expect(menu.getByRole("menuitem", { name: "docs" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "design" }).click();
    await expect(page).toHaveURL(/\/docs\/design$/);
  });

  test("collapsed folders are reachable from the keyboard", async ({
    page,
  }) => {
    await narrowInto(page, "dirs");
    const more = page
      .getByTestId("viewer-header")
      .getByRole("button", { name: /docs\/design/ });
    await more.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Folders" });
    await expect(menu.getByRole("menuitem", { name: "root" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "docs" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();
  });

  test("the name truncates only when nothing else is left, keeping its extension", async ({
    page,
  }) => {
    // A 700px sidebar, so the header can narrow far past where the name
    // stops fitting without the window dropping below the phone breakpoint.
    await widenSidebar(page);
    // Narrow until the name is the only thing left to give; where that is
    // depends on the fonts, so it is found rather than assumed.
    let s: Snapshot | undefined;
    for (let width = 700; width >= 300; width -= 10) {
      await setHeaderWidth(page, width);
      s = await snapshot(page, LABELS, DIRS);
      if (s.name.truncated) break;
    }
    expect(s!.name.truncated, "the name never had to truncate").toBe(true);
    checkInvariants(s!);
    expect(level(s!)).toBe(STEPS.length);
    // Nothing is left but what the row cannot do without, and the name itself
    // is wider than the room those leave it.
    expect(s!.name.full, "truncated with room to spare").toBeGreaterThan(
      s!.name.rendered,
    );
    expect(await extension(page)).toMatchObject({ text: ".md", whole: true });
    await expect(page.getByTestId("breadcrumb-name")).toHaveAttribute(
      "title",
      PATH,
    );
  });

  // With the steps past the relative time it once lacked, the name was elided
  // with a dozen icons and the repository still at full width: at a 1050px
  // window with the sidebar open (a 762px header) it lost a fifth, and at an
  // 850px one (562px) all of it but ".m".
  test("at a laptop width with the sidebar open, the name keeps all of its width", async ({
    page,
  }) => {
    for (const width of [762, 562]) {
      await setHeaderWidth(page, width);
      const s = await snapshot(page, LABELS, DIRS);
      console.log(`header ${width}px: ${JSON.stringify(s)}`);
      checkInvariants(s);
      expect(s.name.truncated, `name truncated at ${width}px`).toBe(false);
      expect(s.name.rendered).toBeGreaterThanOrEqual(s.name.full - 1);
    }
  });

  test("the folded toolbar actions open as a panel, from the pointer or the keyboard", async ({
    page,
  }) => {
    await narrowInto(page, "actions");
    const header = page.getByTestId("viewer-header");
    await expect(header).toHaveAttribute("data-yield", /\bactions\b/);
    const more = header.getByRole("button", { name: "Toolbar actions" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    for (const name of ["Path", "Raw", "Review", "Dismiss 3 answered"]) {
      await expect(header.getByRole("button", { name })).toBeHidden();
    }
    await expect(header.getByRole("button", { name: /contents/ })).toBeHidden();

    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    // Every action, and the view toggles folded in with them, labels drawn.
    const starts: number[] = [];
    const panel = header.locator(".hdr-actions");
    const toc = panel.getByRole("button", { name: "Show contents" });
    await expect(toc).toBeFocused();
    for (const name of [
      "Use full width",
      "2 commits",
      "Path",
      "Raw",
      "Review",
      "Dismiss 3 answered",
      "Manage comments",
    ]) {
      const label = panel.getByText(name, { exact: true });
      await expect(label).toBeVisible();
      const box = (await label.boundingBox())!;
      expect(box.width, name).toBeGreaterThan(8);
      // Where the text itself starts, which a centered label in a wider box
      // would not share with its box.
      starts.push(
        await label.evaluate((el) => {
          const text = [...el.childNodes].find((n) => n.nodeType === 3)!;
          const range = document.createRange();
          range.selectNodeContents(text);
          return Math.round(range.getBoundingClientRect().x);
        }),
      );
    }
    // One column: a label reserving room for a longer one ("Path" for
    // "Copied!") starts where the rest do, rather than centered in its room.
    expect(new Set(starts).size, `label starts: ${starts}`).toBe(1);
    // Opening it moves nothing in the row.
    await expect(header).toHaveAttribute("data-yield", /\bactions\b/);
    const s = await snapshot(page, [], DIRS);
    expect(s.headerHeight).toBe(56);

    await page.keyboard.press("ArrowDown");
    await expect(
      panel.getByRole("button", { name: "Use full width" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(more).toBeFocused();
    await expect(panel.getByRole("button", { name: "Path" })).toBeHidden();

    // A click opens it too, and one outside closes it.
    await more.click();
    await expect(panel.getByRole("button", { name: "Raw" })).toBeVisible();
    await page
      .getByRole("heading", { name: "Durable agent storage classes" })
      .click();
    await expect(more).toHaveAttribute("aria-expanded", "false");
  });

  // The phone-sized end of it: one fixed icon too many and the name was 0px
  // wide, and at 400px the star itself was clipped.
  test("the extension is the last of the name to go", async ({ page }) => {
    await widenSidebar(page);
    // From a stem cut to its floor down to a breadcrumb with no room at all:
    // whenever the breadcrumb has the extension's width, the extension is
    // what it draws, and what it clips first is the "…" at its start.
    let clippedFirst = false;
    for (let width = 320; width >= 150; width -= 10) {
      await setHeaderWidth(page, width);
      const s = await snapshot(page, LABELS, DIRS);
      expect(level(s), `at ${width}px`).toBe(STEPS.length);
      const e = await extension(page);
      expect(e.text).toBe(".md");
      if (e.nav >= e.width) {
        expect(e.whole, `at ${width}px: ${JSON.stringify(e)}`).toBe(true);
      }
      // The "…" cut off while the stem still keeps its floor of a character
      // or two and an ellipsis: the name is drawn, not just its extension.
      if (e.moreClipped && e.stem > 10 && e.whole) clippedFirst = true;
    }
    expect(clippedFirst, "never clipped the … before the name").toBe(true);
  });

  // A click that lengthens a label ("Review" → "End review?", "Path" →
  // "Copied!") must not change the fit. At the narrowest width that still
  // showed labels it once did: every label vanished, the right-anchored
  // toolbar jumped, and the click meant to confirm "End review?" landed on the
  // commit button instead and opened the diff.
  test("a label that lengthens on click moves nothing under the pointer", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const header = page.getByTestId("viewer-header");
    // The narrowest width at which the labels still show, found rather than
    // assumed because it depends on the fonts.
    const iconsOnly = async (w: number) => {
      await setHeaderWidth(page, w);
      return (await header.getAttribute("data-yield"))!
        .split(" ")
        .includes("labels");
    };
    let width = 1700;
    expect(await iconsOnly(width), "no labels at 1700px").toBe(false);
    while (!(await iconsOnly(width - 20))) width -= 20;
    while (!(await iconsOnly(width - 1))) width -= 1;
    await setHeaderWidth(page, width);
    await expect(header).toHaveAttribute("data-yield", "subject date");

    for (const [name, after] of [
      ["Path", "Copied!"],
      ["Review", "End review?"],
    ]) {
      const button = (await header
        .getByRole("button", { name, exact: true })
        .elementHandle())!;
      const box = (await button.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.click(x, y);
      // Read at once: the longer label reverts after a couple of seconds, and
      // so would any step it made the header take.
      await expect(header.getByText(after, { exact: true })).toHaveCount(1);
      const now = await page.evaluate(
        ([x, y]) => ({
          yield: document.querySelector<HTMLElement>(
            '[data-testid="viewer-header"]',
          )!.dataset.yield,
          under: document.elementFromPoint(x, y)?.closest("button")
            ?.textContent,
        }),
        [x, y],
      );
      expect(now, `after clicking ${name}`).toEqual({
        yield: "subject date",
        under: after,
      });
      expect((await button.boundingBox())!.x).toBeCloseTo(box.x, 0);
      await expect(header.getByText(after, { exact: true })).toHaveCount(0, {
        timeout: 10_000,
      });
    }
  });

  test("icon-only buttons keep their names", async ({ page }) => {
    await narrowInto(page, "labels");
    const s = await snapshot(page, LABELS, DIRS);
    expect(Object.values(s.labels)).toEqual(LABELS.map(() => false));
    const header = page.getByTestId("viewer-header");
    for (const name of ["Path", "Raw", "Review", "Dismiss 3 answered"]) {
      await expect(header.getByRole("button", { name })).toBeVisible();
    }
    await expect(header.getByRole("link", { name: "2 commits" })).toBeVisible();
    // The name is drawn as two flex items, stem and extension, which a
    // screen reader would read as two words; it is given the name whole.
    const nav = await header.locator("nav").ariaSnapshot();
    expect(nav).toContain(NAME);
    // A sighted reader has only the tooltip once the label is gone, so the
    // count the label carried is in it too.
    await expect(
      header.getByRole("link", { name: "2 commits" }),
    ).toHaveAttribute("title", "View full history: 2 commits");
    await expect(
      header.getByRole("button", { name: "Dismiss 3 answered" }),
    ).toHaveAttribute("title", "Dismiss the 3 comments the agent has answered");
  });
});

// A folder's toolbar is its commit button alone, so the button is the last item
// in the row. Its `-mx-2` hover bleed puts its border box 8px past the room it
// takes, which the fit once read as overflow: with nothing after the button to
// hide that — no Path, because /api/info failed — the header took every step in
// a 2400px window and hid the subject, the date and the folders for nothing.
test.describe("a header whose toolbar ends at the commit button", () => {
  test("takes no step it has the room not to", async ({ page }) => {
    await page.route("**/api/info", (route) => route.fulfill({ status: 500 }));
    await page.route(
      (url) =>
        url.pathname === "/api/git/status" &&
        url.searchParams.get("path") === "docs/design",
      (route) =>
        route.fulfill({
          json: {
            last_commit: {
              hexsha: "1".repeat(40),
              author_name: "Vantage e2e",
              author_email: "e2e@vantage.local",
              date: new Date(Date.now() - 12 * MINUTE).toISOString(),
              message: SUBJECT,
            },
            git_status: null,
          },
        }),
    );
    await page.setViewportSize({ width: 2400, height: 900 });
    await page.goto("/docs/design");
    const header = page.getByTestId("viewer-header");
    await expect(header.getByTestId("commit-subject")).toHaveText(SUBJECT);
    await expect(header).toHaveAttribute("data-yield", "");
    const s = await snapshot(page, [], ["docs"]);
    checkInvariants(s);
    expect(s.subject.shown && s.date && s.time && s.dirs.docs).toBe(true);
  });
});

// An untracked file's header has no commit: an amber "Untracked file" button,
// and the file's modification time instead. The same steps govern it, less the
// ones it has nothing for.
//
// The file is this test's own, written before it and removed after it. It used
// to be the fixture's page2.md. The header takes an untracked file's time from
// the recent files list, which holds only the 30 newest files, and in a fresh
// checkout, on CI and in a new clone alike, page2.md is not among them, so
// there was no time for the test to find. Neither is this file: it is
// backdated three hours so that its relative time reads the same for the whole
// run, which makes it older than every file a fresh checkout wrote. So the list
// the header reads is routed to carry it, and the route has to stay however the
// server caches that list: it does cache it for up to 30 seconds, and a new
// Markdown file does not clear that, but no cache of any length would bring a
// file this old back into it.
test.describe("an untracked file's header", () => {
  const UNTRACKED = "header-fit-untracked.md";
  const file = path.join(__dirname, "fixtures/test_repo", UNTRACKED);

  test.beforeEach(async ({ page }) => {
    fs.writeFileSync(
      file,
      "# Untracked\n\nWritten by header_fit.spec.ts, and removed after it.\n",
    );
    // Hours old, so the relative time reads the same for the whole test.
    const mtime = new Date(Date.now() - 180 * MINUTE);
    fs.utimesSync(file, mtime, mtime);
    await page.route(
      (url) => url.pathname === "/api/git/recent",
      async (route) => {
        const response = await route.fetch();
        const recent = (await response.json()) as { path: string }[];
        await route.fulfill({
          response,
          json: [
            {
              path: UNTRACKED,
              date: mtime.toISOString(),
              author_name: "",
              message: "",
              hexsha: "",
              untracked: true,
            },
            ...recent.filter((f) => f.path !== UNTRACKED),
          ],
        });
      },
    );
  });

  test.afterEach(() => fs.rmSync(file, { force: true }));

  test("gives way in the same order, and keeps the name whole", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 2400, height: 900 });
    await page.goto(`/${UNTRACKED}`);
    const header = page.getByTestId("viewer-header");
    await expect(header.getByText("Untracked file")).toHaveCount(1);
    await widenSidebar(page, "Untracked file");
    await expect(header.getByTestId("header-time")).toHaveCount(1);

    // Narrowed until the toolbar's actions fold, the last step before the
    // name, wherever the fonts put that: every step this header has is taken
    // on the way, in order, and the name stays whole through all of them.
    let before = 0;
    let timeWent: number | null = null;
    for (let width = 1600; ; width -= 20) {
      expect(width, "the toolbar's actions never folded").toBeGreaterThan(200);
      await setHeaderWidth(page, width);
      const s = await snapshot(page, ["Untracked file", "Path", "Raw"], []);
      checkInvariants(s);
      const taken = level(s);
      expect(taken, `at ${width}px`).toBeGreaterThanOrEqual(before);
      before = taken;
      expect(s.name.truncated, `${UNTRACKED} truncated at ${width}px`).toBe(
        false,
      );
      if (s.time === false && timeWent === null) {
        timeWent = width;
        // Down to the clock alone, which is what kept the name whole: until
        // the relative time could go, a header this narrow elided the name
        // entirely.
        expect(
          await header.getByTestId("header-time").boundingBox(),
          `the relative time at ${width}px`,
        ).toMatchObject({ width: 1 });
      }
      const said = (await header.getAttribute("data-yield")) ?? "";
      if (said.split(" ").includes("actions")) {
        expect(s.more, `the ⋯ at ${width}px`).toBe(true);
        break;
      }
    }
    // Implied by the order check, and said so the clock's check above is
    // known to have run.
    expect(timeWent, "the relative time never went").not.toBeNull();
  });
});
