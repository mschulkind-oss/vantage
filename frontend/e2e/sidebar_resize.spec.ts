import { test, expect } from "@playwright/test";

/**
 * E2E tests for resizable sidebar.
 *
 * Selector contract:
 *   [data-testid="sidebar"]              — the sidebar container
 *   [data-testid="sidebar-resize-handle"] — the drag handle on the right edge
 *
 * Persistence contract:
 *   localStorage key  "vantage:sidebarWidth"  holds the px width as a string.
 *
 * Range contract:
 *   width clamped to [200, 800].
 */

const MIN_WIDTH = 200;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 288;

async function getSidebarWidth(page: import("@playwright/test").Page) {
  const sidebar = page.locator('[data-testid="sidebar"]');
  await expect(sidebar).toBeVisible();
  const box = await sidebar.boundingBox();
  if (!box) throw new Error("sidebar has no bounding box");
  return Math.round(box.width);
}

async function dragHandleBy(
  page: import("@playwright/test").Page,
  deltaX: number,
) {
  const handle = page.locator('[data-testid="sidebar-resize-handle"]');
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error("resize handle has no bounding box");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const widthBefore = await getSidebarWidth(page);
  const viewport = page.viewportSize();
  const maxX = viewport ? viewport.width - 1 : 1280;
  // Clamp final target to viewport — pointermove events outside the viewport
  // aren't reliably delivered. Drags that push past the clamp boundary
  // still trigger the implementation's own min/max clamp.
  const targetX = Math.max(1, Math.min(maxX, startX + deltaX));
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Drag in small steps so each pointermove listener fires.
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + ((targetX - startX) * i) / steps, startY);
  }
  await page.mouse.up();
  // Wait for the sidebar's width to actually reflect the drag before returning.
  if (deltaX !== 0) {
    await page.locator('[data-testid="sidebar"]').evaluate(
      (el, prev) =>
        new Promise<void>((resolve) => {
          const start = Date.now();
          const check = () => {
            const w = Math.round(el.getBoundingClientRect().width);
            if (w !== prev || Date.now() - start > 500) resolve();
            else requestAnimationFrame(check);
          };
          check();
        }),
      widthBefore,
    );
  }
}

// Tests run serially within this describe so the small drag windows aren't
// disturbed by the dev server's slower response under heavy parallel load.
test.describe.configure({ mode: "serial" });

test.describe("Sidebar resize", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      try {
        localStorage.removeItem("vantage:sidebarWidth");
      } catch {
        /* ignore */
      }
    });
    await page.reload();
    await expect(page.getByText("Loading...")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="sidebar-resize-handle"]'),
    ).toBeVisible();
  });

  test("renders sidebar at the default width", async ({ page }) => {
    const width = await getSidebarWidth(page);
    expect(width).toBe(DEFAULT_WIDTH);
  });

  test("exposes a resize handle on the right edge of the sidebar", async ({
    page,
  }) => {
    const sidebar = page.locator('[data-testid="sidebar"]');
    const handle = page.locator('[data-testid="sidebar-resize-handle"]');
    await expect(sidebar).toBeVisible();
    await expect(handle).toBeVisible();

    const sidebarBox = await sidebar.boundingBox();
    const handleBox = await handle.boundingBox();
    if (!sidebarBox || !handleBox)
      throw new Error("missing bounding box for sidebar or handle");

    const sidebarRight = sidebarBox.x + sidebarBox.width;
    const handleCenter = handleBox.x + handleBox.width / 2;
    expect(Math.abs(handleCenter - sidebarRight)).toBeLessThanOrEqual(4);
  });

  test("dragging the handle right grows the sidebar", async ({ page }) => {
    const before = await getSidebarWidth(page);
    await dragHandleBy(page, 100);
    const after = await getSidebarWidth(page);
    expect(after).toBeGreaterThanOrEqual(before + 100 - 2);
    expect(after).toBeLessThanOrEqual(before + 100 + 2);
  });

  test("dragging the handle left shrinks the sidebar", async ({ page }) => {
    const before = await getSidebarWidth(page);
    await dragHandleBy(page, -50);
    const after = await getSidebarWidth(page);
    expect(after).toBeGreaterThanOrEqual(before - 50 - 2);
    expect(after).toBeLessThanOrEqual(before - 50 + 2);
  });

  test("width clamps to MIN when dragged too far left", async ({ page }) => {
    await dragHandleBy(page, -1000);
    const after = await getSidebarWidth(page);
    expect(after).toBe(MIN_WIDTH);
  });

  test("width clamps to MAX when dragged too far right", async ({ page }) => {
    await dragHandleBy(page, 2000);
    const after = await getSidebarWidth(page);
    expect(after).toBe(MAX_WIDTH);
  });

  test("width persists across reload via localStorage", async ({ page }) => {
    await dragHandleBy(page, 80);
    const after = await getSidebarWidth(page);
    const stored = await page.evaluate(() =>
      localStorage.getItem("vantage:sidebarWidth"),
    );
    expect(stored).not.toBeNull();
    expect(parseInt(stored as string, 10)).toBe(after);

    await page.reload();
    await expect(page.getByText("Loading...")).toHaveCount(0, {
      timeout: 10_000,
    });
    const reloaded = await getSidebarWidth(page);
    expect(reloaded).toBe(after);
  });
});
