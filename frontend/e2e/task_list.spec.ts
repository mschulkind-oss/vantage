/**
 * Where the task-list stylesheet puts a checkbox, measured over the real app.
 * The rules are in `packages/vantage-md/src/styles/task-list.css`; jsdom does
 * no layout, so none of this is observable under vitest.
 *
 * Run it with `just e2e`, or `cd frontend && npx playwright test task_list`,
 * after anything that touches that file.
 */
import { test, expect, type Page } from "@playwright/test";

const FIXTURE = "/task-list.md";

async function open(page: Page) {
  await page.goto(FIXTURE);
  await expect(page.locator(".prose li.task-list-item").first()).toBeVisible({
    timeout: 10000,
  });
}

test.describe("task-list checkbox", () => {
  test("draws the checkbox in the item's gutter, on its first line", async ({
    page,
  }) => {
    await open(page);
    const items = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          ".prose ul:not(#user-content-boxless) li.task-list-item",
        ),
        (li) => {
          const input = li.querySelector(":scope > input")!;
          const text = Array.from(li.childNodes).find(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent!.trim(),
          )!;
          const range = document.createRange();
          range.selectNodeContents(text);
          const glyphs = Array.from(range.getClientRects()).filter(
            (rect) => rect.width > 0,
          );
          const item = li.getBoundingClientRect();
          const box = input.getBoundingClientRect();
          return {
            label: text.textContent!.trim(),
            em: parseFloat(getComputedStyle(li).fontSize),
            item: { x: item.x, y: item.y },
            box: { x: box.x, y: box.y, width: box.width, height: box.height },
            textX: glyphs[0].x,
          };
        },
      ),
    );
    expect(items.map((item) => item.label)).toEqual([
      "open task",
      "done task",
      "nested open",
      "nested done",
    ]);
    for (const { label, em, item, box, textX } of items) {
      // A 1.05em square at the item's left edge, 0.2em below its top, and
      // the text after it starting 1.75em in, where the item's padding ends.
      expect(box.width, label).toBeCloseTo(1.05 * em, 0);
      expect(box.height, label).toBeCloseTo(1.05 * em, 0);
      expect(box.x, label).toBeCloseTo(item.x, 0);
      expect(box.y, label).toBeCloseTo(item.y + 0.2 * em, 0);
      expect(textX, label).toBeCloseTo(item.x + 1.75 * em, 0);
    }
  });

  test("keeps the checkbox in the scroll container when its item has no box", async ({
    page,
  }) => {
    // An item written with `display: contents` generates no box, so it is no
    // containing block for anything it holds. When the stylesheet positioned
    // the checkbox absolutely, the checkbox was placed against an ancestor
    // outside the scroll container instead: measured at 1280x800, the
    // fixture's 600px font size made it a 630px green square over the content
    // pane that stayed put when the document scrolled.
    await open(page);
    const checkbox = page.locator("#user-content-boxless input");
    await expect(checkbox).toHaveCount(1);
    const measure = () =>
      page.evaluate(() => {
        const scroller = document.querySelector("[data-content-scroll]")!;
        const input = document.querySelector("#user-content-boxless input")!;
        const pane = scroller.getBoundingClientRect();
        // Every point of the viewport, on a 20px grid, that hits the checkbox.
        const hits: [number, number][] = [];
        for (let x = 0; x < innerWidth; x += 20) {
          for (let y = 0; y < innerHeight; y += 20) {
            if (document.elementFromPoint(x, y) === input) hits.push([x, y]);
          }
        }
        return {
          y: input.getBoundingClientRect().y,
          pane: {
            left: pane.left,
            top: pane.top,
            right: pane.right,
            bottom: pane.bottom,
          },
          hits,
        };
      });

    await checkbox.scrollIntoViewIfNeeded();
    const before = await measure();
    for (const [x, y] of before.hits) {
      expect(x).toBeGreaterThanOrEqual(before.pane.left);
      expect(x).toBeLessThan(before.pane.right);
      expect(y).toBeGreaterThanOrEqual(before.pane.top);
      expect(y).toBeLessThan(before.pane.bottom);
    }

    // It scrolls with the document, as everything in the document does. The
    // fixture's spacer leaves room below to scroll into.
    await page.evaluate(() => {
      document.querySelector("[data-content-scroll]")!.scrollTop += 100;
    });
    const after = await measure();
    expect(before.y - after.y).toBeCloseTo(100, 0);
  });
});
