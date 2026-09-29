/**
 * How the stylesheet sizes an `<svg>` a document writes inline, measured over
 * the real app. The rules are in `packages/vantage-md/src/styles/inline-svg.css`;
 * jsdom does no layout, so none of this is observable under vitest.
 *
 * Run it with `just e2e`, or `cd frontend && npx playwright test inline_svg`,
 * after anything that touches that file or the prose classes in
 * `MarkdownViewer.tsx`.
 */
import { test, expect, type Page } from "@playwright/test";

const FIXTURE = "/inline-svg.md";

async function open(page: Page) {
  await page.goto(FIXTURE);
  await expect(
    page.locator('.prose svg[aria-label="Wide with viewBox"]'),
  ).toBeVisible({ timeout: 10000 });
}

/** The border box of the first element matching `selector`, from the page. */
async function box(page: Page, selector: string) {
  const found = await page.locator(selector).first().boundingBox();
  expect(found, selector).not.toBeNull();
  return found!;
}

test.describe("inline SVG sizing", () => {
  test("shrinks a drawing with a viewBox to the column, keeping its shape", async ({
    page,
  }) => {
    await open(page);
    const drawing = await box(page, 'svg[aria-label="Wide with viewBox"]');
    const column = await box(page, ".prose");
    expect(drawing.width).toBeLessThanOrEqual(column.width + 0.5);
    expect(drawing.width).toBeLessThan(2400);
    // 2400x300: the height follows the width down.
    expect(drawing.height).toBeCloseTo(drawing.width / 8, 0);
  });

  test("keeps the height of a drawing with no viewBox, so it is not cropped", async ({
    page,
  }) => {
    // Without a viewBox nothing scales the drawing to its box, so `height:
    // auto` only shrank the viewport: measured at 64px of a declared 100, with
    // the text at y=90 cut off below it.
    await open(page);
    const selector = 'svg[aria-label="Wide without viewBox"]';
    const drawing = await box(page, selector);
    const column = await box(page, ".prose");
    expect(drawing.width).toBeLessThanOrEqual(column.width + 0.5);
    expect(drawing.height).toBe(100);
    const text = await box(page, `${selector} text`);
    expect(text.y + text.height).toBeLessThanOrEqual(
      drawing.y + drawing.height,
    );
  });

  test("leaves the SVG the page draws itself alone: Mermaid, KaTeX, icons", async ({
    page,
  }) => {
    await open(page);
    await expect(
      page.locator(".prose svg").filter({ hasText: "Start" }),
    ).toBeVisible({
      timeout: 15000,
    });
    // Every svg the document did not write: Mermaid's diagram and its toolbar
    // icon, and KaTeX's radicals and arrows in a block, a paragraph, a list
    // item and a table cell. Measured with the inline-SVG rules in place, then
    // again with them deleted from the live stylesheet; the box each one draws
    // may not move or change size. (Their computed `max-width` does change —
    // the rule reaches them — but it caps nothing they were drawn at. They all
    // come before the document's own drawings, which do move.)
    const measure = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll<SVGSVGElement>(".prose svg"))
          .filter((svg) => svg.getAttribute("role") !== "img")
          .map((svg) => {
            const { x, y, width, height } = svg.getBoundingClientRect();
            const style = getComputedStyle(svg);
            return {
              where: svg.closest(".katex") ? "katex" : "mermaid",
              x,
              y,
              width,
              height,
              display: style.display,
              verticalAlign: style.verticalAlign,
            };
          }),
      );
    const withRules = await measure();
    expect(withRules.filter((m) => m.where === "katex").length).toBeGreaterThan(
      4,
    );
    expect(
      withRules.filter((m) => m.where === "mermaid").length,
    ).toBeGreaterThan(1);

    const deleted = await page.evaluate(() => {
      let count = 0;
      const prune = (
        list: CSSRuleList,
        owner: CSSGroupingRule | CSSStyleSheet,
      ) => {
        for (let i = list.length - 1; i >= 0; i--) {
          const rule = list[i];
          if (rule instanceof CSSStyleRule) {
            if (rule.selectorText.includes(".vantage-prose) svg")) {
              owner.deleteRule(i);
              count++;
            }
          } else if (rule instanceof CSSGroupingRule) {
            prune(rule.cssRules, rule);
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        prune(sheet.cssRules, sheet);
      }
      return count;
    });
    expect(deleted).toBeGreaterThan(1);
    expect(await measure()).toEqual(withRules);
  });
});
