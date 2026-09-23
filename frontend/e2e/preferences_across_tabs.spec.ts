/**
 * A reader with two tabs open is one reader, and a preference changed in either
 * one has to reach the other.
 *
 * `src/lib/preferences.test.ts` holds the wiring: it refuses a key nothing
 * follows and a `vantage:` literal that is not registered, and it exercises the
 * dispatch by handing a synthesized `StorageEvent` to the module. What it cannot
 * do is prove the loop closes. jsdom has one window, so the second tab in those
 * tests is a call to a handler — the browser's own delivery is assumed, and so is
 * every step between the handler and the page actually changing.
 *
 * That gap is where this breaks silently. Adopting a color theme is not copying
 * a string: the subscription has to run the real apply path, swap the `<link>`,
 * wait for the sheet, and leave the picker naming what is now on the page. Any
 * one of those can rot while every unit test stays green, and the failure looks
 * like "my other tab is stale", which nobody reports.
 *
 * So: two pages in one browser context — one origin, therefore one
 * `localStorage` and real `storage` events between them — driven through the
 * controls a reader uses. The second page is never touched after it opens.
 *
 * Each preference here stands for a way of adopting one, rather than for itself:
 * a theme (apply an effect and swap a stylesheet), light/dark (a class on
 * `<html>` whose writer is also a keyboard shortcut), a zustand store's filter
 * (state outside React), and a `usePersistentFlag` in the page (state inside it).
 * `repoSortMode` is the one the set cannot reach: its control only renders with
 * more than one repository, and this fixture serves one.
 */

import { test, expect, type Page } from "@playwright/test";

const THEME_ATTRIBUTE = "data-vantage-theme";

function settingsMenu(page: Page) {
  return page.getByRole("menu", { name: "Settings" });
}

async function openSettings(page: Page): Promise<void> {
  const menu = settingsMenu(page);
  if (await menu.isVisible()) return;
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(menu).toBeVisible();
}

/** A second tab on the same origin: same storage, real events between them. */
async function openSecondTab(page: Page): Promise<Page> {
  const second = await page.context().newPage();
  await second.goto("/");
  await expect(second.getByTestId("sidebar")).toBeVisible();
  return second;
}

/** The value of one CSS custom property, resolved rather than as written. */
function resolved(page: Page, property: string): Promise<string> {
  return page.evaluate(
    (name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    property,
  );
}

test.describe("a preference changed in one tab reaches the other", () => {
  test("the color theme, its stylesheet, and the picker that names it", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("sidebar")).toBeVisible();
    const other = await openSecondTab(page);

    // Both tabs start on the app's own look, so the assertions below cannot pass
    // on a theme that was already there.
    await expect(other.locator("html")).not.toHaveAttribute(
      THEME_ATTRIBUTE,
      /./,
    );
    const before = await resolved(other, "--color-slate-800");

    await openSettings(page);
    await settingsMenu(page).getByLabel("Colors").selectOption("gruvbox");
    await expect(page.locator("html")).toHaveAttribute(
      THEME_ATTRIBUTE,
      "gruvbox",
    );

    // The attribute is set in the stylesheet's load handler, so waiting for it in
    // the *other* tab is waiting for that tab to have fetched and applied the
    // sheet itself — not merely to have heard about the change.
    await expect(other.locator("html")).toHaveAttribute(
      THEME_ATTRIBUTE,
      "gruvbox",
    );
    await expect
      .poll(() => resolved(other, "--color-slate-800"))
      .not.toBe(before);

    // One sheet, and it is the palette's own asset: adopting must swap the link
    // rather than stack a second one over the old colors.
    await expect(other.locator("link#vantage-color-theme")).toHaveCount(1);
    await expect(other.locator("link#vantage-color-theme")).toHaveAttribute(
      "href",
      /gruvbox/,
    );

    // The picker, in the tab that never chose anything. It is driven by the
    // attribute, so this also asserts it never names a theme before the page
    // wears it.
    await openSettings(other);
    await expect(settingsMenu(other).getByLabel("Colors")).toHaveValue(
      "gruvbox",
    );
  });

  test("light and dark, including from the keyboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("sidebar")).toBeVisible();
    const other = await openSecondTab(page);

    await openSettings(page);
    await settingsMenu(page).getByRole("button", { name: "Dark" }).click();
    await expect(other.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);

    // Shift+D is the other writer, and it used to change the class and the
    // storage without telling the menu — so this asserts both tabs' pages and
    // the *open* menu in the tab that pressed nothing.
    await openSettings(other);
    await page.keyboard.press("Shift+D");
    await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(other.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(
      settingsMenu(other).getByRole("button", { name: "Light" }),
    ).toHaveClass(/bg-slate-100/);
  });

  test("a tree filter held in the store, and a flag held in the page", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("sidebar")).toBeVisible();
    const other = await openSecondTab(page);

    // A store-backed preference: the checkbox in the other tab's own open menu
    // has to move, which means the store adopted rather than just storage.
    await openSettings(other);
    const hiddenIn = (p: Page) =>
      settingsMenu(p).getByRole("checkbox", { name: /hidden/i });
    await expect(hiddenIn(other)).not.toBeChecked();

    await openSettings(page);
    await hiddenIn(page).click();
    await expect(hiddenIn(page)).toBeChecked();
    await expect(hiddenIn(other)).toBeChecked();

    // And a `usePersistentFlag` held in the page rather than in a store: the
    // sidebar, collapsed with its keyboard shortcut in one tab. Escape first, so
    // the shortcut is not swallowed by the open menu.
    //
    // Collapsing translates the sidebar off-screen rather than unmounting it, so
    // the signal is the control that reopens it: "Open sidebar" exists only while
    // it is collapsed. Asserting on the transform class would be asserting on
    // Tailwind instead of on the app.
    const reopen = (p: Page) => p.getByRole("button", { name: "Open sidebar" });
    await page.keyboard.press("Escape");
    await expect(reopen(other)).toHaveCount(0);
    await page.keyboard.press("b");
    await expect(reopen(page)).toBeVisible();
    await expect(reopen(other)).toBeVisible();
  });
});
