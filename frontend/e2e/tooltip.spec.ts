import { test, expect } from "@playwright/test";

/**
 * The styled tooltip (`frontend/src/components/TooltipLayer.tsx`), in the app:
 * what a reader gets where a header control has no label left, and where the
 * browser's own `title` would have been.
 */
test.describe("the styled tooltip", () => {
  test("describes the sidebar Questions link on hover and keyboard focus", async ({
    page,
  }) => {
    await page.goto("/.vantage/work");
    const decisions = page
      .getByTestId("sidebar")
      .getByRole("link", { name: "Questions", exact: true })
      .and(page.locator('[aria-label="Questions"]'));
    await expect(decisions).toBeVisible();
    await decisions.hover();
    const tip = page.getByRole("tooltip");
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText("Questions (g p)");
    await expect(decisions).not.toHaveAttribute("title");
    await expect(decisions).toHaveAttribute(
      "aria-describedby",
      (await tip.getAttribute("id"))!,
    );

    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    await decisions.focus();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText("Questions (g p)");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Questions" }),
    ).toBeVisible();
  });

  test("answers a hover on an icon-only control, on this side of the window", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/docs/design/durable-agent-storage-classes.md");
    const settings = page.getByRole("button", { name: "Settings" });
    await expect(settings).toBeVisible();
    // The control gives up its native tooltip for the styled one.
    await expect(settings).not.toHaveAttribute("title");

    await settings.hover();
    const tip = page.getByRole("tooltip");
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText("Settings");
    const box = (await tip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y).toBeGreaterThanOrEqual(0);

    // A click takes it down; it is not a thing that outlives the pointer.
    await settings.click();
    await expect(tip).toBeHidden();
  });

  test("reaches a control that is disabled, which sends no events of its own", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    // Nothing is waiting on the agent in a fresh review store, so this one is
    // `disabled` — and a disabled control dispatches no pointer events: the
    // layer finds it by hit test. Its tooltip is the one place that says why.
    const answers = page.getByRole("button", { name: /Review answers/ });
    await expect(answers).toBeDisabled({ timeout: 30_000 });
    await expect(answers).not.toHaveAttribute("title");
    await answers.hover({ force: true });

    const tip = page.getByRole("tooltip");
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText(
      "See the documents and comments included in Copy answers",
    );
  });
});
