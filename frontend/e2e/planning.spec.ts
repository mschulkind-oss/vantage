import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import { openWithIndex } from "./planningIndex";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Link badges in a real browser, against the real planning endpoint
// (docs/reference/planning-index.md §5, §8.3). The fixture is
// `fixtures/test_repo/plans/`, whose roadmap `.vantage.toml` names.
//
// Each test opens the roadmap with the index already built, as a reader who
// arrives at it from another page does: an index that lands after a document
// painted badges only what has not been on screen
// (planning-index.md §12.2), and the whole roadmap is.
test.describe("planning badges", () => {
  // One test edits a fixture the others read, so they run one at a time.
  test.describe.configure({ mode: "serial" });

  // No other spec opens plans/design.md, because this one rewrites it: under
  // fullyParallel, a spec reading it would see the edit whenever the two
  // overlapped. referenced_by.spec.ts did, until its long-named document
  // cited shipped.md instead. Keep it that way.

  const designPath = path.join(__dirname, "fixtures/test_repo/plans/design.md");
  let originalDesign: string;

  test.beforeEach(() => {
    originalDesign = fs.readFileSync(designPath, "utf-8");
  });

  test.afterEach(() => {
    fs.writeFileSync(designPath, originalDesign);
  });

  const badgeAfter = (page: Page, name: string) =>
    page
      .locator("[data-content-scroll] .prose")
      .getByRole("link", { name, exact: true })
      .locator("xpath=following-sibling::*[1][@data-vantage-planning-badge]");

  test("the roadmap shows a badge on every link to a plan or question", async ({
    page,
  }) => {
    await openWithIndex(page, "/plans/roadmap.md");
    await expect(badgeAfter(page, "The fixture design")).toHaveAccessibleName(
      "in review, design, 2 open questions",
    );
    await expect(badgeAfter(page, "Which way it goes")).toHaveText(
      "💬 open",
    );
    await expect(badgeAfter(page, "The shipped plan")).toHaveAccessibleName(
      "accepted, built",
    );
  });

  // §5.2 and §8.3: answering a question and letting the agent compact it
  // turns its badge to ruled without a reload. Compaction deletes the
  // directive and keeps the id in the text.
  test("a compacted question's badge turns to ruled without a reload", async ({
    page,
  }) => {
    await openWithIndex(page, "/plans/roadmap.md");
    const badge = badgeAfter(page, "Which way it goes");
    await expect(badge).toHaveText("💬 open");
    const marker = `e2e-${Date.now()}`;
    await page.evaluate((m) => {
      (window as unknown as Record<string, string>).__planningMarker = m;
    }, marker);

    fs.writeFileSync(
      designPath,
      originalDesign.replace(
        '   <!-- vantage: oq id=OQ-E1 leaning="The first way." -->\n\n',
        "",
      ),
    );

    await expect(badge).toHaveText("✅ ruled", { timeout: 15000 });
    await expect(badgeAfter(page, "The fixture design")).toHaveAccessibleName(
      "in review, design, 1 open question",
    );
    // The same page, not a reload that would have got there anyway.
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, string>).__planningMarker,
      ),
    ).toBe(marker);
  });

  test("a top-level planning/ directory is still served as documents", async ({
    page,
  }) => {
    await page.goto("/planning/notes.md");
    await expect(
      page.getByRole("heading", { name: "Planning notes" }),
    ).toBeVisible();
  });

  test("a copied selection holds no badge text", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openWithIndex(page, "/plans/roadmap.md");
    const badge = badgeAfter(page, "The fixture design");
    await expect(badge).toBeVisible();

    // Select the whole list, which crosses every badged line, and copy it the
    // way a reader does.
    await page.evaluate(() => {
      const list = document.querySelector("[data-content-scroll] .prose ol")!;
      const range = document.createRange();
      range.selectNodeContents(list);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press("ControlOrMeta+c");
    const copied = await page.evaluate(() => navigator.clipboard.readText());

    // Nor any break where a badge sat: a badge laid out as its own box reads
    // as a line of its own to a copy.
    expect(copied).toContain(
      "The fixture design — its questions need rulings first.",
    );
    expect(copied).toContain(
      "Which way it goes — the ruling everything else waits on.",
    );
    expect(copied).not.toContain("in-review");
    expect(copied).not.toContain("DESIGN");
    expect(copied).not.toContain("💬");
  });
});
