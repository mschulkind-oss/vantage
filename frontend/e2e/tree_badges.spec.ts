import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";

/**
 * The file tree's planning badges never cost a file name any width
 * (`docs/reference/planning-index.md` §7).
 *
 * The rules, each checked on every row of `fixtures/test_repo/tree-badges/`, a
 * directory of long planning-document names like a real `docs/design/`, at
 * three sidebar widths in both modes:
 *
 * 1. A name is exactly as wide as it is with the badge taken out of the row,
 *    and so is the row's height.
 * 2. A badge that is drawn is drawn whole, inside its row. One that would not
 *    fit is not drawn, and the name's tooltip says what it would have said.
 * 3. A badge is drawn whenever the room the name leaves is enough for it, so a
 *    wide sidebar shows them.
 * 4. A row with no planning badge has no badge and no tooltip.
 * 5. The git-change dot stays exactly where it is without the badge, at the
 *    row's end, and a badge never overlaps it.
 *
 * "Taken out" is literal: the measurement detaches the badge's element from
 * the row, measures again, and puts it back. That is the row as it was before
 * the tree had badges, so no second implementation of "no badge" is needed.
 *
 * This has to be a browser: jsdom lays nothing out, and every rule here is a
 * width.
 */

const DIR = "tree-badges";

/** Sidebar widths, px: narrow, the default's neighborhood, and wide. */
const WIDTHS = [220, 280, 360] as const;
const MODES = ["light", "dark"] as const;

/** Planning documents in the fixture: every one has something to show. */
const PLANNING_ROWS = [
  "agent-bootstrap.md",
  "agent-directory-contract.md",
  "api-keys.md",
  "backend-selection.md",
  "bake-images.md",
  "base-home-layout.md",
  "base-home.md",
  "bedrock-credentials.md",
  "cerebras.md",
  "compose.md",
  "csv.md",
  "deprecated-flow.md",
  "questions-only.md",
];
const PLAIN_ROWS = [
  "attach-skew-and-contention.md",
  "boundary-broker.md",
  "README.md",
];

/**
 * Rows whose tooltip is not their spoken words: an undeclared stage keeps its
 * own spelling there, where it is the only text the row shows of it.
 */
const TITLE_UNLIKE_LABEL: Record<string, string> = {
  "csv.md": "stage \u201cDECIEDD\u201d is not a declared stage",
};

/**
 * Git changes the tree is told about. The fixture's files have none the tree
 * shows, so the directory's listing is answered with these added: a long
 * planning name, a short one, and a row with no badge.
 */
const GIT_STATUS: Record<string, string> = {
  "agent-directory-contract.md": "modified",
  "cerebras.md": "untracked",
  "boundary-broker.md": "modified",
};

interface Edges {
  left: number;
  right: number;
}

interface Row {
  file: string;
  /** The name's rendered width with the badge in the row, and without it. */
  nameWith: number;
  nameWithout: number;
  /** The row's height with the badge in the row, and without it. */
  heightWith: number;
  heightWithout: number;
  /** The tooltips of the row itself, of its name, and of the badge's slot. */
  title: { row: string | null; name: string | null; slot: string | null };
  /** The git-change dot, with the badge in the row and without it. */
  dotWith: Edges | null;
  dotWithout: Edges | null;
  /** Where the row's content box ends. */
  contentRight: number;
  badge: {
    label: string | null;
    /** Some part of it is painted. */
    visible: boolean;
    /** No part of it is cut off by the row or anything that clips inside it. */
    whole: boolean;
    right: number;
    /** Its width with its margins: the room it needs. */
    need: number;
    /** The room the name leaves, measured with the badge taken out. */
    room: number;
  } | null;
}

/** Open the fixture directory at `width` px in `mode`, once its badges are in. */
async function openTree(
  page: Page,
  width: number,
  mode: (typeof MODES)[number],
): Promise<void> {
  await page.addInitScript(
    ([w, m]) => {
      localStorage.setItem("vantage:sidebarWidth", String(w));
      localStorage.setItem("vantage:theme", m);
    },
    [width, mode] as const,
  );
  await page.route("**/api/tree?*", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch();
    if (url.searchParams.get("path") !== DIR) {
      await route.fulfill({ response });
      return;
    }
    const nodes = (await response.json()) as { name: string }[];
    await route.fulfill({
      response,
      json: nodes.map((n) =>
        GIT_STATUS[n.name] ? { ...n, git_status: GIT_STATUS[n.name] } : n,
      ),
    });
  });
  // Tall enough that every row of the fixture is on screen, so nothing is
  // clipped by the sidebar's scroll rather than by its row.
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto(`/${DIR}`);
  const sidebar = page.getByTestId("sidebar");
  // The width the preference asked for, not the default.
  await expect(sidebar).toHaveJSProperty("offsetWidth", width);
  await expect(
    sidebar.locator(`a[href^="/${DIR}/"] [data-vantage-planning-badge]`),
  ).toHaveCount(PLANNING_ROWS.length, { timeout: 15000 });
}

/** Measure every row of the fixture directory, with its badge and without. */
function measure(page: Page): Promise<Row[]> {
  return page.evaluate((dir) => {
    // The directory's own subtree: the sidebar's Recent list links the same
    // files, with markup of its own.
    const subtree = document
      .querySelector('[data-testid="sidebar"]')!
      .querySelector(`a[href="/${dir}"]`)!.parentElement!;
    const rows = [
      ...subtree.querySelectorAll<HTMLAnchorElement>(`a[href^="/${dir}/"]`),
    ];

    type Box = { left: number; right: number; top: number; bottom: number };
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const edges = (el: Element | null) =>
      el === null ? null : { left: box(el).left, right: box(el).right };
    const within = (inner: Box, outer: Box) =>
      inner.left >= outer.left - 0.01 &&
      inner.right <= outer.right + 0.01 &&
      inner.top >= outer.top - 0.01 &&
      inner.bottom <= outer.bottom + 0.01;

    /** What of `el` is left once every clipping ancestor up to `row` cuts it. */
    const painted = (el: HTMLElement, row: HTMLElement): Box => {
      const b = box(el);
      for (let a = el.parentElement; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        const r = box(a);
        if (s.overflowX !== "visible") {
          b.left = Math.max(b.left, r.left);
          b.right = Math.min(b.right, r.right);
        }
        if (s.overflowY !== "visible") {
          b.top = Math.max(b.top, r.top);
          b.bottom = Math.min(b.bottom, r.bottom);
        }
        if (a === row) break;
      }
      return b;
    };

    const measured = rows.map((row) => {
      const file = decodeURIComponent(row.getAttribute("href")!)
        .split("/")
        .pop()!;
      const name = [...row.children].find(
        (c) => c.textContent === file,
      ) as HTMLElement;
      if (!name) throw new Error(`no name span in the row for ${file}`);
      const badge = row.querySelector<HTMLElement>(
        "[data-vantage-planning-badge]",
      );
      // The row's direct child the badge lives in: what "taking it out" takes.
      const slot = badge ? (badge.closest("a > *") as HTMLElement) : null;
      // The git-change dot is whatever follows the name and is not the badge.
      const last = row.lastElementChild!;
      const dot = last !== name && last !== slot ? last : null;
      const clip = badge ? painted(badge, row) : null;
      const visible =
        badge !== null &&
        clip !== null &&
        badge.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
        }) &&
        clip.right - clip.left > 0.01 &&
        clip.bottom - clip.top > 0.01;
      const style = badge ? getComputedStyle(badge) : null;
      return {
        row,
        file,
        name,
        slot,
        dot,
        nameWith: name.getBoundingClientRect().width,
        heightWith: row.getBoundingClientRect().height,
        dotWith: edges(dot),
        title: {
          row: row.getAttribute("title"),
          name: name.getAttribute("title"),
          slot: slot?.getAttribute("title") ?? null,
        },
        badge:
          badge === null
            ? null
            : {
                label: badge.getAttribute("aria-label"),
                visible,
                whole:
                  within(box(badge), painted(badge, row)) &&
                  within(box(badge), box(row)),
                right: box(badge).right,
                need:
                  badge.getBoundingClientRect().width +
                  parseFloat(style!.marginLeft) +
                  parseFloat(style!.marginRight),
              },
      };
    });

    // Take every badge out at once, and measure the rows as they were before
    // the tree had badges.
    const placed = measured.map((m) =>
      m.slot ? { slot: m.slot, next: m.slot.nextSibling } : null,
    );
    for (const m of measured) m.slot?.remove();
    const result = measured.map((m) => {
      const s = getComputedStyle(m.row);
      const contentRight =
        m.row.getBoundingClientRect().right -
        parseFloat(s.paddingRight) -
        parseFloat(s.borderRightWidth);
      const nameRight = m.name.getBoundingClientRect().right;
      // The room the name leaves ends where the dot begins, or with the row.
      const end = m.dot ? m.dot.getBoundingClientRect().left : contentRight;
      return {
        file: m.file,
        nameWith: m.nameWith,
        nameWithout: m.name.getBoundingClientRect().width,
        heightWith: m.heightWith,
        heightWithout: m.row.getBoundingClientRect().height,
        title: m.title,
        dotWith: m.dotWith,
        dotWithout: edges(m.dot),
        contentRight,
        badge: m.badge === null ? null : { ...m.badge, room: end - nameRight },
      };
    });
    measured.forEach((m, i) => {
      const p = placed[i];
      if (p) m.row.insertBefore(p.slot, p.next);
    });
    return result;
  }, DIR);
}

// A tree listing still in flight when a test ends would otherwise fail it from
// inside the route handler, after the page has gone.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

for (const mode of MODES) {
  for (const width of WIDTHS) {
    test(`tree badges at ${width}px, ${mode}: the name keeps its width`, async ({
      page,
    }, testInfo) => {
      await openTree(page, width, mode);
      await page.getByTestId("sidebar").screenshot({
        path: testInfo.outputPath(`sidebar-${width}-${mode}.png`),
      });
      const rows = await measure(page);
      expect(rows.map((r) => r.file).sort()).toEqual(
        [...PLANNING_ROWS, ...PLAIN_ROWS].sort(),
      );
      // Every row's numbers, to read a failure (or a pass) by.
      const numbers = testInfo.outputPath("rows.json");
      fs.writeFileSync(numbers, JSON.stringify(rows, null, 2));
      await testInfo.attach("rows", {
        path: numbers,
        contentType: "application/json",
      });

      for (const row of rows) {
        // 1: the name, and the row, are exactly as they are with no badge.
        expect
          .soft(row.nameWith, `${row.file}: name width`)
          .toBe(row.nameWithout);
        expect
          .soft(row.heightWith, `${row.file}: row height`)
          .toBe(row.heightWithout);
        // 5: the dot is where it is with no badge, at the row's end.
        expect.soft(row.dotWith, `${row.file}: git dot`).toEqual(row.dotWithout);
        expect
          .soft(row.dotWith !== null, `${row.file}: git dot drawn`)
          .toBe(row.file in GIT_STATUS);
        if (row.dotWith) {
          expect
            .soft(row.dotWith.right, `${row.file}: git dot at the row's end`)
            .toBeCloseTo(row.contentRight, 1);
        }
        if (row.badge === null) {
          // 4: a row with nothing to show is the row it always was.
          expect
            .soft(PLAIN_ROWS, `${row.file} has no badge`)
            .toContain(row.file);
          expect
            .soft(row.title, `${row.file}: tooltip`)
            .toEqual({ row: null, name: null, slot: null });
          continue;
        }
        expect.soft(PLANNING_ROWS).toContain(row.file);
        // 2: whole or not at all, and the row says it either way.
        if (row.badge.visible) {
          expect
            .soft(row.badge.whole, `${row.file}: badge is whole`)
            .toBe(true);
          if (row.dotWith) {
            expect
              .soft(row.badge.right, `${row.file}: badge clears the git dot`)
              .toBeLessThanOrEqual(row.dotWith.left);
          }
        }
        expect.soft(row.badge.label, `${row.file}: badge label`).toBeTruthy();
        // The words are on the name and the badge's slot, not on the row,
        // where they would be read a second time, as its description.
        const words = TITLE_UNLIKE_LABEL[row.file] ?? row.badge.label;
        expect
          .soft(row.title, `${row.file}: tooltip`)
          .toEqual({ row: null, name: words, slot: words });
        // 3: drawn whenever the room left over is enough for it. Within half a
        // pixel either way, rounding decides, and either answer is right.
        if (row.badge.room >= row.badge.need + 0.5) {
          expect
            .soft(row.badge.visible, `${row.file}: badge fits, so it shows`)
            .toBe(true);
        } else if (row.badge.room < row.badge.need - 0.5) {
          expect
            .soft(
              row.badge.visible,
              `${row.file}: badge does not fit, so it is not shown`,
            )
            .toBe(false);
        }
      }

      if (width === 360) {
        // A wide sidebar has room for nearly all of them, and shows them.
        const shown = rows.filter((r) => r.badge?.visible).length;
        expect(shown).toBeGreaterThanOrEqual(PLANNING_ROWS.length - 2);
      }
    });
  }
}

test("a badge with no room is still in the name's tooltip and the row's accessible name", async ({
  page,
}) => {
  await openTree(page, 220, "light");
  const row = page
    .getByTestId("sidebar")
    .locator(`a[href="/${DIR}/agent-directory-contract.md"]`)
    .first();
  const badge = row.locator("[data-vantage-planning-badge]");
  // The name fills the row at this width, so the badge is not drawn...
  await expect(badge).not.toBeInViewport({ ratio: 0.01 });
  // ...and its words are still the row's, once: in its name, and not again
  // as its description, nor as the badge's.
  await expect(row).toHaveAccessibleName(
    "agent-directory-contract.md in review, 1 open question",
  );
  await expect(row).toHaveAccessibleDescription("");
  await expect(badge).toHaveAccessibleDescription("");
  // Hovering the name, which is all of the row there is room for, says them.
  await expect(
    row.getByText("agent-directory-contract.md", { exact: true }),
  ).toHaveAttribute("title", "in review, 1 open question");
});

test("a drawn badge is part of the row's click target, and looks it", async ({
  page,
}) => {
  await openTree(page, 360, "light");
  const row = page
    .getByTestId("sidebar")
    .locator(`a[href="/${DIR}/api-keys.md"]`)
    .first();
  const badge = row.locator("[data-vantage-planning-badge]");
  await expect(badge).toBeInViewport();
  // The badge is inside the row's link, so the pointer over it says what
  // clicking does: open the file, as anywhere else on the row.
  const cursor = (l: typeof row) =>
    l.evaluate((el) => getComputedStyle(el).cursor);
  expect(await cursor(row)).toBe("pointer");
  expect(await cursor(badge)).toBe("pointer");
  await badge.click();
  await expect(page).toHaveURL(new RegExp(`/${DIR}/api-keys\\.md$`));
});

test("in forced colors every dot and ring is still drawn", async ({ page }) => {
  // Windows High Contrast replaces every background with Canvas and drops
  // box shadows, which would leave a gap where each status was.
  await page.emulateMedia({ forcedColors: "active" });
  await openTree(page, 360, "light");
  const marks = await page
    .getByTestId("sidebar")
    .locator(".vantage-tree-badge__dot")
    .evaluateAll((dots) => {
      const canvas = getComputedStyle(
        document.querySelector("[data-testid=sidebar]")!,
      ).backgroundColor;
      return dots.map((dot) => {
        const s = getComputedStyle(dot);
        const fill =
          s.backgroundColor !== "rgba(0, 0, 0, 0)" &&
          s.backgroundColor !== canvas;
        const ring = parseFloat(s.borderTopWidth) > 0;
        const ringDistinct = ring && s.borderTopColor !== canvas;
        return {
          file: dot.closest("a")!.getAttribute("href"),
          undeclared: dot.classList.contains(
            "vantage-tree-badge__dot--undeclared",
          ),
          fill,
          ring: ringDistinct,
        };
      });
    });
  expect(marks.length).toBeGreaterThan(0);
  for (const m of marks) {
    // A ring stays a ring and a dot stays a dot, so the undeclared stage is
    // still told apart from in-review.
    expect
      .soft(m, `${m.file}`)
      .toEqual(
        m.undeclared
          ? { ...m, fill: false, ring: true }
          : { ...m, fill: true, ring: false },
      );
  }
});
