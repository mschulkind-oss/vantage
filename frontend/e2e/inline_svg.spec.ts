/**
 * How the stylesheet sizes an `<svg>` a document writes inline, measured over
 * the real app. The rules are in `packages/vantage-md/src/styles/inline-svg.css`;
 * jsdom does no layout, so none of this is observable under vitest.
 *
 * Run it with `just e2e`, or `cd frontend && npx playwright test inline_svg`,
 * after anything that touches that file or the prose classes in
 * `MarkdownViewer.tsx`.
 */
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const FIXTURE = "/inline-svg.md";
const INLINE_SVG_CSS = new URL(
  "../../packages/vantage-md/src/styles/inline-svg.css",
  import.meta.url,
);

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
    // auto` only shrank the viewport: measured at 58px of a declared 100, with
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
    // Both Mermaid diagrams, one at the top level and one in a list item.
    await expect(page.locator(".prose svg[aria-roledescription]")).toHaveCount(
      2,
      { timeout: 15000 },
    );
    // The maximized view of the one in the list item. It is not a portal: the
    // dialog and its toolbar render inside the `li`, where the rule for an svg
    // in a sentence reaches them.
    await page
      .locator('.prose li button[aria-label="Maximize diagram"]')
      .click({ force: true });
    await expect(page.locator('.prose [role="dialog"]')).toBeVisible();
    // Every svg the document did not write — Mermaid's diagrams, the copy in
    // the dialog, KaTeX's radicals and arrows in a block, a paragraph, a list
    // item and a table cell, and the icons on the diagram's buttons — and
    // every button those icons sit in. Measured with the inline-SVG rules in
    // place, then again with them deleted from the live stylesheet; nothing
    // may move or change size. (An svg's computed `max-width` does change —
    // the rule reaches it — but it caps nothing it was drawn at. All of this
    // comes before the document's own drawings, which do move.)
    const measure = () =>
      page.evaluate(() => {
        const boxOf = (el: Element) => {
          const { x, y, width, height } = el.getBoundingClientRect();
          return { x, y, width, height };
        };
        const svgs = Array.from(
          document.querySelectorAll<SVGSVGElement>(".prose svg"),
        )
          .filter((svg) => svg.getAttribute("role") !== "img")
          .map((svg) => {
            const style = getComputedStyle(svg);
            return {
              where: svg.closest(".katex")
                ? "katex"
                : svg.closest("button")
                  ? "icon"
                  : "mermaid",
              ...boxOf(svg),
              display: style.display,
              verticalAlign: style.verticalAlign,
            };
          });
        const buttons = Array.from(
          document.querySelectorAll(".prose button"),
          (button) => ({
            label:
              button.getAttribute("aria-label") ?? button.getAttribute("title"),
            ...boxOf(button),
          }),
        );
        return { svgs, buttons };
      });
    const withRules = await measure();
    const count = (where: string) =>
      withRules.svgs.filter((m) => m.where === where).length;
    expect(count("katex")).toBeGreaterThan(4);
    // Two diagrams and the dialog's copy.
    expect(count("mermaid")).toBe(3);
    // Two Maximize icons, and the dialog's Close, Zoom out, Zoom in and Reset.
    expect(count("icon")).toBe(6);
    expect(withRules.buttons.map((b) => b.label)).toEqual([
      "Maximize diagram",
      "Maximize diagram",
      "Close modal",
      "Zoom out",
      "Reset zoom (or double-click)",
      "Zoom in",
      "Reset view",
    ]);

    // The rules to delete are read from the file itself, so this deletes all
    // of them however they are split up, and cannot pass by missing one.
    const css = readFileSync(INLINE_SVG_CSS, "utf8");
    const { declared, deleted } = await page.evaluate((text) => {
      const key = (selector: string) =>
        selector.replace(/\s+/g, "").toLowerCase();
      const selectors = new Set<string>();
      const collect = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
          if (rule instanceof CSSStyleRule) selectors.add(key(rule.selectorText));
          else if (rule instanceof CSSGroupingRule) collect(rule.cssRules);
        }
      };
      const own = new CSSStyleSheet();
      own.replaceSync(text);
      collect(own.cssRules);

      let count = 0;
      const prune = (
        list: CSSRuleList,
        owner: CSSGroupingRule | CSSStyleSheet,
      ) => {
        for (let i = list.length - 1; i >= 0; i--) {
          const rule = list[i];
          if (rule instanceof CSSStyleRule) {
            if (selectors.has(key(rule.selectorText))) {
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
      return { declared: selectors.size, deleted: count };
    }, css);
    expect(declared).toBeGreaterThan(0);
    expect(deleted).toBe(declared);
    expect(await measure()).toEqual(withRules);
  });

  test("keeps a drawing in a div of its own a block", async ({ page }) => {
    // The sentence rule is scoped to the blocks that hold phrasing content, so
    // the recommended shape — a `<div>` around the `<svg>` — is untouched.
    await open(page);
    const display = await page
      .locator('svg[aria-label="Wide with viewBox"]')
      .evaluate((svg) => getComputedStyle(svg).display);
    expect(display).toBe("block");
  });

  for (const where of [
    "a paragraph",
    "a list item",
    "a cell",
    "a heading",
    "a summary",
    "a term",
    "a definition",
    "a figure caption",
  ]) {
    test(`keeps an icon in ${where} on its line of text`, async ({ page }) => {
      // Preflight's `svg { display: block }` put a 16px icon on a line of its
      // own: "Inline icon", the dot, "in text." rendered as three lines.
      await open(page);
      const lines = await page.evaluate((label) => {
        const svg = document.querySelector(
          `svg[aria-label="Dot in ${label}"]`,
        )!;
        const rectOf = (node: Node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getBoundingClientRect();
        };
        const before = rectOf(svg.previousSibling!);
        const after = rectOf(svg.nextSibling!);
        const icon = svg.getBoundingClientRect();
        return {
          display: getComputedStyle(svg).display,
          beforeTop: before.top,
          afterTop: after.top,
          iconMiddle: icon.top + icon.height / 2,
          textTop: before.top,
          textBottom: before.bottom,
        };
      }, where);
      expect(lines.display).toBe("inline-block");
      expect(Math.abs(lines.afterTop - lines.beforeTop)).toBeLessThan(1);
      // `vertical-align: middle`: the icon sits within the text's line box.
      expect(lines.iconMiddle).toBeGreaterThan(lines.textTop);
      expect(lines.iconMiddle).toBeLessThan(lines.textBottom);
    });
  }
});
