import { test, expect } from "@playwright/test";

/**
 * A project too big for one of the server's limits says so in the browser
 * (docs/design/serve-clones-directory.md §7). The server side — a watch budget
 * configured down, a walk timeout of a nanosecond — is covered by the Go
 * suite; this spec pins what the reader sees, with the list the server would
 * return stubbed in, since reaching a real limit here would mean building a
 * tree too big to serve.
 */
const degraded = [
  {
    repo: "",
    kind: "watch_limit",
    path: "node_modules",
    count: 12,
    message:
      "Live reload is off below node_modules and 11 more folders: the system's limit on watched folders was reached.",
  },
];

test("a degraded project shows a banner that moves nothing and can be dismissed", async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/degraded", async (route) => {
    // Answer only once the page has painted, the way a report that arrives
    // late does.
    await held;
    await route.fulfill({ json: degraded });
  });

  await page.goto("/page1.md");
  const heading = page.getByRole("heading", { name: "Page 1" });
  await expect(heading).toBeVisible();
  const before = await heading.boundingBox();

  release();
  const banner = page.getByRole("status", {
    name: "Project too big to serve fully",
  });
  await expect(banner).toContainText(
    "Live reload is off below node_modules and 11 more folders",
  );

  // Late data never moves painted content.
  expect(await heading.boundingBox()).toEqual(before);
  expect(
    await banner.evaluate((el) => getComputedStyle(el).position),
  ).toBe("fixed");

  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toBeHidden();
});

test("nothing degraded, no banner", async ({ page }) => {
  await page.route("**/api/degraded", (route) => route.fulfill({ json: [] }));
  await page.goto("/page1.md");
  await expect(page.getByRole("heading", { name: "Page 1" })).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Project too big to serve fully" }),
  ).toHaveCount(0);
});
