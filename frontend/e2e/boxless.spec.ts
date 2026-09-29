/**
 * A document's element written with no box of its own, measured over the real
 * app. jsdom does no layout, so none of this is observable under vitest.
 *
 * The stylesheets place some boxes against an element of the document: a toned
 * block's rule is a `::before` positioned absolutely inside the block
 * (`packages/vantage-md/src/styles/directives.css`), and a heading's link anchor
 * is positioned absolutely inside the heading (`frontend/src/index.css`). An
 * element written with `display: contents` generates no box, so it is no
 * containing block, and what it holds is placed against an ancestor outside
 * the scroll container instead, which neither clips nor scrolls it. The
 * sanitizer refuses that `display` value; these tests measure that nothing the
 * fixture writes gets out.
 *
 * Run it with `just e2e`, or `cd frontend && npx playwright test boxless`, after
 * anything that touches `SAFE_STYLE` in `packages/vantage-md/src/sanitize.ts`
 * or a positioned rule in either stylesheet.
 */
import { test, expect, type Page } from "@playwright/test";

const FIXTURE = "/boxless.md";

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function open(page: Page) {
  await page.goto(FIXTURE);
  await expect(page.locator("#user-content-boxless-paragraph")).toBeAttached({
    timeout: 10000,
  });
  await expect(page.locator("#user-content-boxless-heading")).toBeAttached();
}

/** The content pane: the scroll container every document box belongs in. */
function pane(page: Page): Promise<Rect> {
  return page.evaluate(() => {
    const box = document
      .querySelector("[data-content-scroll]")!
      .getBoundingClientRect();
    return {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
    };
  });
}

/** Scroll the content pane by `by` CSS pixels. */
async function scroll(page: Page, by: number) {
  await page.evaluate((delta) => {
    document.querySelector("[data-content-scroll]")!.scrollTop += delta;
  }, by);
}

/**
 * The bounding box, in CSS pixels, of every pixel on screen painted in the
 * color of `selector`'s `::before`: the tone's rule. Read from a screenshot
 * rather than from the pseudo-element's computed style, which says where the
 * rule is placed but not what paints.
 */
async function ruleBox(page: Page, selector: string): Promise<Rect | null> {
  const shot = `data:image/png;base64,${(await page.screenshot()).toString("base64")}`;
  return page.evaluate(
    async ({ dataUrl, selector }) => {
      const element = document.querySelector(selector)!;
      const accent = (
        getComputedStyle(element, "::before").backgroundColor.match(/\d+/g) ??
        []
      )
        .slice(0, 3)
        .map(Number);
      if (accent.length !== 3) throw new Error("no accent color");
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const scale = image.width / window.innerWidth;
      const data = context.getImageData(0, 0, image.width, image.height).data;
      let box: { left: number; top: number; right: number; bottom: number } | null =
        null;
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const i = (y * image.width + x) * 4;
          if (!accent.every((channel, c) => Math.abs(data[i + c] - channel) < 12))
            continue;
          if (!box) box = { left: x, top: y, right: x + 1, bottom: y + 1 };
          box.left = Math.min(box.left, x);
          box.top = Math.min(box.top, y);
          box.right = Math.max(box.right, x + 1);
          box.bottom = Math.max(box.bottom, y + 1);
        }
      }
      if (!box) return null;
      return {
        left: box.left / scale,
        top: box.top / scale,
        right: box.right / scale,
        bottom: box.bottom / scale,
      };
    },
    { dataUrl: shot, selector },
  );
}

function expectInside(inner: Rect, outer: Rect, label: string) {
  expect(inner.left, label).toBeGreaterThanOrEqual(outer.left);
  expect(inner.right, label).toBeLessThanOrEqual(outer.right);
  expect(inner.top, label).toBeGreaterThanOrEqual(outer.top);
  expect(inner.bottom, label).toBeLessThanOrEqual(outer.bottom);
}

test.describe("an element written with no box", () => {
  for (const [label, selector] of [
    ["paragraph", "#user-content-boxless-paragraph"],
    ["heading", "#user-content-boxless-heading"],
  ] as const) {
    test(`keeps a toned ${label}'s rule in the scroll container`, async ({
      page,
    }) => {
      // Measured before the fix at 1280x800: the paragraph's rule was a 5px
      // bar the full height of the content pane, and it stayed put when the
      // document scrolled. The heading's rule was the same bar, moved 1.5em
      // of the heading's font size across the pane.
      await open(page);
      await page.locator(selector).scrollIntoViewIfNeeded();
      await scroll(page, -200);
      const bounds = await pane(page);
      const before = await ruleBox(page, selector);
      expect(before, "the rule paints").not.toBeNull();
      expectInside(before!, bounds, label);

      // It scrolls with the document, as everything in the document does, and
      // is as tall as the element it marks.
      const element = await page.locator(selector).boundingBox();
      expect(before!.bottom - before!.top).toBeLessThanOrEqual(
        element!.height + 2,
      );
      await scroll(page, 100);
      const after = await ruleBox(page, selector);
      expect(after).not.toBeNull();
      expect(before!.top - after!.top).toBeCloseTo(100, 0);
    });
  }

  test("keeps a heading's link anchor in the scroll container", async ({
    page,
  }) => {
    // The anchor is a link the app adds to every heading with an id, and it
    // takes clicks. Measured before the fix at 1280x800, the heading's 200px
    // font size made it a 300px-wide box placed against an ancestor outside
    // the scroll container.
    await open(page);
    const heading = page.locator("#user-content-boxless-heading");
    await heading.scrollIntoViewIfNeeded();
    await scroll(page, -200);
    const anchor = heading.locator(":scope > .heading-anchor");
    await expect(anchor).toHaveCount(1);
    const measure = () =>
      page.evaluate(() => {
        const anchor = document.querySelector(
          "#user-content-boxless-heading > .heading-anchor",
        )!;
        // Every point of the viewport, on a 20px grid, that hits the anchor.
        const hits: [number, number][] = [];
        for (let x = 0; x < innerWidth; x += 20) {
          for (let y = 0; y < innerHeight; y += 20) {
            const hit = document.elementFromPoint(x, y);
            if (hit && anchor.contains(hit)) hits.push([x, y]);
          }
        }
        return { y: anchor.getBoundingClientRect().y, hits };
      });
    const bounds = await pane(page);
    const before = await measure();
    expect(before.hits.length, "the anchor takes a click").toBeGreaterThan(0);
    for (const [x, y] of before.hits) {
      expectInside(
        { left: x, top: y, right: x, bottom: y },
        bounds,
        `a hit at ${x},${y}`,
      );
    }
    await scroll(page, 100);
    const after = await measure();
    expect(before.y - after.y).toBeCloseTo(100, 0);
  });
});
