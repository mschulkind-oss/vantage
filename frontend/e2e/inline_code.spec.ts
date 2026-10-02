/**
 * How inline code is drawn when its lines wrap, measured over the real app:
 * jsdom does no layout, so none of this is observable under vitest.
 *
 * A code span is a chip with a background, a border and padding. Two things
 * went wrong in a table cell, where lines sit closer than in a paragraph: a
 * chip was taller than the line it sat on, so the chips on one line drew over
 * those on the next; and a chip that wrapped was cut open at the break, its
 * two halves each missing a rounded end. The fix may not change the density
 * of the text, so the lines' spacing is held here too.
 *
 * Run it with `just e2e`, or `cd frontend && npx playwright test inline_code`.
 */
import { test, expect, type Page } from "@playwright/test";

const FIXTURE = "/inline-code.md";

async function open(page: Page) {
  // Narrow enough that the table's first column wraps its chips, as in the
  // report this comes from.
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(FIXTURE);
  await expect(page.locator(".prose table code").first()).toBeVisible({
    timeout: 10000,
  });
}

interface Chip {
  where: "td" | "p";
  /** The chip's border boxes, one per line it is on. */
  boxes: { top: number; bottom: number; left: number; right: number }[];
  /** The line-height of the block the chip sits in, in px. */
  lineHeight: number;
  decorationBreak: string;
}

async function chips(page: Page): Promise<Chip[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(".prose td code, .prose p code"),
      (code) => {
        const block = code.closest("td, p") as HTMLElement;
        const style = getComputedStyle(code);
        return {
          where: block.tagName === "TD" ? ("td" as const) : ("p" as const),
          boxes: Array.from(code.getClientRects(), (r) => ({
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
          })),
          lineHeight: parseFloat(getComputedStyle(block).lineHeight),
          decorationBreak:
            style.getPropertyValue("box-decoration-break") ||
            style.getPropertyValue("-webkit-box-decoration-break"),
        };
      },
    ),
  );
}

test.describe("inline code that wraps", () => {
  test("no chip is taller than the line it sits on, so lines never overlap", async ({
    page,
  }) => {
    await open(page);
    const all = await chips(page);
    expect(all.some((c) => c.where === "td" && c.boxes.length > 0)).toBe(true);
    for (const chip of all) {
      for (const box of chip.boxes) {
        // A chip no taller than its line cannot reach the next line's chips.
        // A cell's lines are the close ones, where a chip at the paragraph's
        // padding overlapped them by a pixel; there it keeps a pixel's gap.
        const room =
          chip.where === "td" ? chip.lineHeight - 1 : chip.lineHeight;
        expect(box.bottom - box.top).toBeLessThanOrEqual(room);
      }
    }
    // And no two chips on consecutive lines of one block overlap.
    const boxes = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".prose td, .prose p"), (block) =>
        Array.from(block.querySelectorAll("code"), (code) =>
          Array.from(code.getClientRects(), (r) => [r.top, r.bottom]),
        ).flat(),
      ),
    );
    for (const block of boxes) {
      const lines = [...block].sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < lines.length; i++) {
        // On the same line (tops within a pixel) or strictly below.
        if (Math.abs(lines[i][0] - lines[i - 1][0]) < 1) continue;
        expect(lines[i][0]).toBeGreaterThanOrEqual(lines[i - 1][1]);
      }
    }
  });

  test("a chip that wraps keeps its rounded ends on every line", async ({
    page,
  }) => {
    await open(page);
    const all = await chips(page);
    const wrapped = all.filter((c) => c.boxes.length > 1);
    // The fixture is written to wrap at least one chip at this width.
    expect(wrapped.length).toBeGreaterThan(0);
    for (const chip of all) expect(chip.decorationBreak).toBe("clone");
  });

  test("the lines keep their spacing", async ({ page }) => {
    await open(page);
    const heights = await page.evaluate(() => ({
      td: parseFloat(
        getComputedStyle(document.querySelector(".prose td")!).lineHeight,
      ),
      p: parseFloat(
        getComputedStyle(document.querySelector(".prose p")!).lineHeight,
      ),
      code: parseFloat(
        getComputedStyle(document.querySelector(".prose p code")!).fontSize,
      ),
      text: parseFloat(
        getComputedStyle(document.querySelector(".prose p")!).fontSize,
      ),
    }));
    // The density of the text is the reader's, not this fix's: the code stays
    // at 85% of its text, and a cell's lines stay as close as they were.
    expect(heights.code / heights.text).toBeCloseTo(0.85, 2);
    expect(heights.td).toBeLessThan(heights.p);
  });
});
