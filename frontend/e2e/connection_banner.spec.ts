import { test, expect, type Page } from "@playwright/test";

// The Disconnected banner, going between a document and the planning page, in
// a real browser against the suite's server. Each page that takes live pushes
// opens a socket of its own, so the move closes one and opens the next. Until
// 1302abd the closing page left its handlers on the socket it closed, and the
// close event the browser fires a moment later marked the app disconnected:
// the banner flashed until the next page's socket opened. A page's own close
// is not the backend going away, so the banner must never show.

const BANNER = "Disconnected from backend";

/** Every socket the page opens to the push endpoint, as it goes. */
type Socket = { hello: boolean; closed: boolean };

/**
 * Follow the page's push sockets, and record every node inserted that is or
 * holds the banner, read as it was inserted, so one drawn and taken away again
 * in the same task is seen too. Installed before the app's first script runs.
 */
async function watch(page: Page): Promise<Socket[]> {
  const sockets: Socket[] = [];
  page.on("websocket", (socket) => {
    if (!socket.url().endsWith("/api/ws")) return;
    const seen: Socket = { hello: false, closed: false };
    sockets.push(seen);
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload === "string" && payload.includes('"hello"')) {
        seen.hello = true;
      }
    });
    socket.on("close", () => {
      seen.closed = true;
    });
  });
  await page.addInitScript((banner) => {
    const shown: string[] = [];
    Object.assign(window, { __banner: shown });
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          const text = node.textContent ?? "";
          if (text.includes(banner)) shown.push(text.slice(0, 120));
        }
      }
    }).observe(document, { childList: true, subtree: true });
  }, BANNER);
  return sockets;
}

/**
 * Wait until the page that just opened is connected and every socket before
 * it has closed, so the close events that once raised the banner have all
 * been delivered: a socket made after the first `made`, its hello received,
 * and none other open.
 */
async function connectedAfter(sockets: Socket[], made: number): Promise<void> {
  await expect
    .poll(
      () =>
        sockets.length > made &&
        sockets.at(-1)!.hello &&
        !sockets.at(-1)!.closed &&
        sockets.slice(0, -1).every((s) => s.closed),
      { timeout: 15_000 },
    )
    .toBe(true);
}

/** What the banner observer recorded, once two frames have let it report. */
const bannerShown = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve((window as unknown as { __banner: string[] }).__banner),
          ),
        ),
      ),
  );

test("going between a document and the planning page never shows the Disconnected banner", async ({
  page,
}) => {
  const sockets = await watch(page);
  await page.goto("/page1.md");
  await expect(
    page.getByRole("heading", { level: 1, name: "Page 1" }),
  ).toBeVisible();
  await connectedAfter(sockets, 0);
  for (let round = 0; round < 4; round++) {
    let made = sockets.length;
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Planning" }),
    ).toBeVisible();
    await connectedAfter(sockets, made);
    expect(await bannerShown(page)).toEqual([]);

    made = sockets.length;
    await page.goBack();
    await expect(page).toHaveURL(/\/page1\.md$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Page 1" }),
    ).toBeVisible();
    await connectedAfter(sockets, made);
    expect(await bannerShown(page)).toEqual([]);
  }
  await expect(page.getByText(BANNER)).toHaveCount(0);
});
