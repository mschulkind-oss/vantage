import { expect, type Page } from "@playwright/test";

// Helpers for specs whose documents must paint with the planning index in
// hand. Since docs/reference/planning-index.md §12, an index that lands
// after a document's first paint badges only the blocks the reader has not
// seen, and Referenced by fills only a line reserved for it: a spec that opens
// a short document cold and waits for its badges waits for nothing. These
// build the index first, then open the document the way a reader moving
// through the app does.

/**
 * Wait until this tab's planning index for `repo` (`""` in single-repo mode)
 * is ready, read from the app's own store. The suite runs on the Vite dev
 * server, which serves every source module at its own path, so importing it
 * here reaches the instance the app is using.
 */
export async function planningIndexReady(page: Page, repo = ""): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async (repo) => {
          const path = "/src/stores/usePlanningStore.ts";
          const { usePlanningStore } = await import(/* @vite-ignore */ path);
          return usePlanningStore.getState().byRepo[repo]?.status ?? "idle";
        }, repo),
      { timeout: 20_000 },
    )
    .toBe("ready");
}

/**
 * Move the page to `path` in-app, as following a link does: a history entry
 * the router follows, with no reload, so the stores and the index stay.
 */
export async function openInApp(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

/**
 * Open `path` with the index already built: load another page first, wait
 * for the index there, then move to `path` in-app, so its first paint has it.
 * The repository's root, by default, whose file tree starts the index: the
 * dev server answers a path it holds a file at itself, such as `/README.md`,
 * with that file rather than the app.
 */
export async function openWithIndex(
  page: Page,
  path: string,
  from = "/",
): Promise<void> {
  await page.goto(from);
  await planningIndexReady(page);
  await openInApp(page, path);
}
