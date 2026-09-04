/**
 * A toned section draws ONE continuous vertical rule. Measured in pixels.
 *
 * This is the only test in the repo that can see the tone rule at all. Under
 * vitest/jsdom `getComputedStyle(el, "::before")` throws, so the geometry is
 * unobservable there (A22); and every computed-style probe that *is* possible
 * answers the wrong question. The rule is a `::before` on each member, offset
 * out of the member's own box, and its computed `left` is identical whether the
 * slice paints or is clipped to nothing — which is exactly how two members came
 * to paint no rule at all while a comment in `directives.css` vouched that "all
 * eight block types land on the same pixel". They did. Two of them landed there
 * invisibly.
 *
 * The two defects this pins, both of which read on screen as one section broken
 * into two:
 *
 *   1. `pre` (typography's `overflow-x: auto`) and `hr` (the UA sheet's
 *      `overflow: hidden`) are scroll/clip boxes, and `[data-vantage-tone] {
 *      position: relative }` makes each one the containing block for the very
 *      pseudo it then clips. Measured before the fix: a contiguous 100px
 *      unpainted stretch for a three-line fence, against a 40px bleed.
 *   2. `$$…$$` reaches rehype as a `<pre>`, gets stamped as a run member, and is
 *      then *replaced* by `rehype-katex` with a `<span class="katex-display">`
 *      that carries none of the stamps. Measured before the fix: a 58px hole for
 *      a one-line fraction.
 *   3. A raw-HTML `<figure>` was not stamped at all: the range used to be gated
 *      by `VANTAGE_STYLE_TARGETS`, the list of tags a directive may *target*.
 *      Measured before the fix: a 44px hole for a one-line figure, against the
 *      40px a neighbour can bleed upward, and taller for a taller block.
 *
 * The `Justfile` never invokes playwright, so this documents rather than guards —
 * run it by hand (`cd frontend && npx playwright test directive_tone_rule`) after
 * anything that touches `directives.css`, the prose classes in
 * `MarkdownViewer.tsx`, or the rehype order around `rehypeKatex`.
 *
 * Pixels come back through the browser rather than a PNG decoder: screenshot,
 * hand the bytes back as a data URL, and let the page draw them into a canvas it
 * never attaches. That keeps this file free of image-format code and free of
 * committed baseline images.
 */
import { test, expect } from "@playwright/test";

const FIXTURE = "/toned-section.md";

/** Bands of a member's own box, plus what the rule column looks like in each. */
interface Member {
  tag: string;
  run: string | null;
  top: number;
  bottom: number;
  /** Rows inside this member's box where the rule column is painted. */
  painted: number;
  height: number;
}

interface Scan {
  members: Member[];
  /** Unpainted runs of rows strictly between the run's first and last paint. */
  gaps: [number, number][];
  first: number;
  last: number;
  /** The content panel scrolled, so the image is short and the scan is void. */
  overflowed: boolean;
}

/**
 * Tall enough that the whole fixture fits the content panel without scrolling.
 * The panel scrolls, not the page, so anything past the fold is missing from a
 * screenshot — see `scanRuleColumn`.
 */
const TALL_VIEWPORT = { width: 1280, height: 1600 };

async function scanRuleColumn(page: import("@playwright/test").Page) {
  // The app never scrolls the page: content lives in a `flex-1 overflow-y-auto`
  // panel, so a "full page" screenshot is one viewport tall and everything below
  // the fold is simply absent from the image. `TALL_VIEWPORT` is what makes the
  // whole run fit that one viewport; the assertion below is what turns a
  // fixture that outgrows it into a clear failure instead of a phantom gap.
  const shot = (await page.screenshot()).toString("base64");
  return page.evaluate(async (dataUrl: string): Promise<Scan> => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    // The screenshot may be taken at a device pixel ratio; the CSS coordinates
    // below are what `getBoundingClientRect` speaks.
    const scale = image.width / window.innerWidth;

    const stamped = Array.from(
      document.querySelectorAll<HTMLElement>("[data-vantage-tone]"),
    );
    if (stamped.length === 0) throw new Error("nothing is stamped");

    // The rule is one column for the whole run: 3px wide, `--vantage-tone-rule-
    // offset` (12px) left of the content edge, with toned headings shifted back
    // by the app's `--vantage-tone-heading-gutter` so every member shares it.
    // Read it off a member that is not a heading, then allow a couple of pixels
    // of slack for anti-aliasing on the rounded ends.
    const body = stamped.find((el) => !/^H[1-6]$/.test(el.tagName))!;
    const rule = getComputedStyle(body, "::before");
    const columnLeft =
      body.getBoundingClientRect().left +
      window.scrollX +
      parseFloat(rule.left);
    const target = (rule.backgroundColor.match(/\d+/g) ?? [])
      .slice(0, 3)
      .map(Number);
    if (target.length !== 3) {
      throw new Error(`no accent colour: ${rule.backgroundColor}`);
    }

    const xFrom = Math.round((columnLeft - 3) * scale);
    const xTo = Math.round((columnLeft + 6) * scale);
    const rows = Math.min(
      Math.round(window.innerHeight),
      Math.floor(image.height / scale),
    );
    const painted: boolean[] = [];
    for (let y = 0; y < rows; y++) {
      const strip = context.getImageData(
        xFrom,
        Math.round(y * scale),
        Math.max(1, xTo - xFrom),
        1,
      ).data;
      let hit = false;
      for (let i = 0; i < strip.length && !hit; i += 4) {
        hit = target.every(
          (channel, c) => Math.abs(strip[i + c] - channel) < 45,
        );
      }
      painted.push(hit);
    }

    const first = painted.indexOf(true);
    const last = painted.lastIndexOf(true);
    const gaps: [number, number][] = [];
    for (let y = first; y <= last; y++) {
      if (painted[y]) continue;
      const start = y;
      while (y <= last && !painted[y]) y++;
      gaps.push([start, y - 1]);
    }

    const members: Member[] = stamped.map((element) => {
      const box = element.getBoundingClientRect();
      const top = Math.round(box.top);
      const bottom = Math.round(box.bottom);
      let hits = 0;
      for (let y = top; y < bottom; y++) if (painted[y]) hits++;
      return {
        tag: element.tagName,
        run: element.getAttribute("data-vantage-run"),
        top,
        bottom,
        painted: hits,
        height: bottom - top,
      };
    });

    // If the content panel had to scroll, the rows below the fold were never in
    // the image and every "gap" below them is an artefact. Report it as one.
    const panel = stamped[0].closest<HTMLElement>(".overflow-y-auto");
    const overflowed =
      panel !== null && panel.scrollHeight > panel.clientHeight + 1;

    return { members, gaps, first, last, overflowed };
  }, `data:image/png;base64,${shot}`);
}

test.describe("a toned section's rule is one continuous line", () => {
  test("paints every row of every member, with no gap between them", async ({
    page,
  }) => {
    await page.setViewportSize(TALL_VIEWPORT);
    await page.goto(FIXTURE);
    await expect(page.locator("[data-vantage-tone]").first()).toBeVisible();
    // KaTeX replaces the `$$` block, and the replacement is a run member: wait
    // for it, or the scan can race a section that is still one block short.
    await expect(page.locator(".katex-display")).toHaveCount(1);

    const scan = await scanRuleColumn(page);
    expect(scan.overflowed, "the fixture outgrew TALL_VIEWPORT").toBe(false);

    // The whole point: no unpainted row anywhere inside the run.
    expect(
      scan.gaps.map(([from, to]) => `${from}-${to} (${to - from + 1}px)`),
    ).toEqual([]);

    // And per member, so a failure names the tag that stopped painting rather
    // than a row number. `PRE` and `SPAN` are the two that used to read 0.
    for (const member of scan.members) {
      expect(
        member.painted,
        `${member.tag}[run=${member.run}] painted ${member.painted} of its ${member.height} rows`,
      ).toBe(member.height);
    }
    // `FIGURE` is the one member the stampable-tag list would have skipped, so
    // name it: a regression there paints nothing rather than painting wrongly,
    // and the row scan above would blame whichever member follows it.
    expect(
      scan.members.some((member) => member.tag === "FIGURE"),
      "the raw-HTML figure is not in the run at all",
    ).toBe(true);

    // The fixture is one run over every stampable block type.
    expect(scan.members.map((member) => member.tag)).toEqual([
      "H2",
      "P",
      "UL",
      "PRE",
      "P",
      "FIGURE",
      "SPAN",
      "BLOCKQUOTE",
      "TABLE",
      "HR",
      "P",
    ]);
    expect(scan.members.map((member) => member.run)).toEqual([
      "start",
      ...Array(9).fill("middle"),
      "end",
    ]);
  });

  test("stops at the run, bleeding over nothing outside it", async ({
    page,
  }) => {
    await page.setViewportSize(TALL_VIEWPORT);
    await page.goto(FIXTURE);
    await expect(page.locator(".katex-display")).toHaveCount(1);

    const scan = await scanRuleColumn(page);
    expect(scan.overflowed, "the fixture outgrew TALL_VIEWPORT").toBe(false);
    const members = scan.members;

    // Bleeding is upward only (plus the `hr`'s own margin downward), which is
    // what makes the run terminate exactly at its first and last member with no
    // `:last-of-run` selector — D3, and the reason the run selectors are
    // positive rather than negated.
    expect(scan.first).toBeGreaterThanOrEqual(members[0].top);
    expect(scan.last).toBeLessThanOrEqual(members[members.length - 1].bottom);
  });

  test("scrolls wide code inside the fence rather than on it", async ({
    page,
  }) => {
    await page.goto(FIXTURE);
    await expect(page.locator("pre[data-vantage-tone]").first()).toBeVisible();

    const boxes = await page.evaluate(() => {
      const pre = document.querySelector<HTMLElement>(
        "pre[data-vantage-tone]",
      )!;
      const code = pre.querySelector<HTMLElement>("code")!;
      code.scrollLeft = 10_000;
      return {
        preOverflow: getComputedStyle(pre).overflowX,
        preScrolls: pre.scrollWidth > pre.clientWidth,
        codeScrolls: code.scrollWidth > code.clientWidth,
        codeScrolled: code.scrollLeft,
      };
    });

    // The fence must not be a scroll container — that is what clipped the rule —
    // and wide code must still scroll, which is a real feature and the whole
    // cost of the fix.
    expect(boxes.preOverflow).toBe("visible");
    expect(boxes.preScrolls).toBe(false);
    expect(boxes.codeScrolls).toBe(true);
    expect(boxes.codeScrolled).toBeGreaterThan(0);
  });
});
