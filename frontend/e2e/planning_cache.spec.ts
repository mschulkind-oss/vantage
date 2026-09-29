import { test, expect, type Page } from "@playwright/test";

// The scan worker and its cache in a real browser: the worker over the real
// planning stream, and the scan cache over the real IndexedDB, which no unit
// test can reach (docs/design/planning-index-at-scale.md §8, §19).
//
// Every build here is the app's own: the planning store asks the tab's
// scanner client for the index as soon as a surface needs it. Each test gets a
// fresh browser context, so IndexedDB starts empty, and a warm load is a
// reload inside one test.
//
// Other specs rewrite files of the same fixture while this one runs, so no
// assertion names an exact list of changed files.

const ROADMAP = "plans/roadmap.md";
/** planning.spec.ts rewrites it, so its hash may move under this spec. */
const REWRITTEN = "plans/design.md";
/** The planning page's one unrouted question, whose card every test awaits. */
const UNROUTED_CARD = "OQ-U1: Is anyone tracking this?";

interface Line {
  kind: string;
  path?: string;
  hash?: string;
  refused?: boolean;
}

interface Stream {
  have: Record<string, string>;
  lines: Line[];
}

/**
 * Every stream request the page's workers send, with the lines the server
 * answered, read on the way through. A worker's response body cannot be read
 * back over the protocol, so the route fetches it, keeps a copy, and hands it
 * on whole.
 */
async function recordStreams(page: Page): Promise<Stream[]> {
  const streams: Stream[] = [];
  await page.route("**/api/planning/stream", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const sent = JSON.parse(route.request().postData() ?? "{}") as {
      have?: Record<string, string>;
    };
    streams.push({
      have: sent.have ?? {},
      lines: body
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Line),
    });
    await route.fulfill({ response, body });
  });
  return streams;
}

/** Record every single-path request the page or its workers send. */
function pathRequests(page: Page): string[] {
  const paths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.searchParams.get("path");
    if (url.pathname.endsWith("/planning/sources") && path !== null) {
      paths.push(path);
    }
  });
  return paths;
}

/** Open the planning page, and wait for its cards: the index is built. */
async function planningPage(page: Page, reload = false): Promise<void> {
  if (reload) await page.reload();
  else await page.goto("/.vantage/planning");
  await expect(
    page.getByRole("article", { name: UNROUTED_CARD }),
  ).toBeVisible();
}

/** The documents whose cards the planning page shows. */
const cardPaths = async (page: Page): Promise<Set<string>> =>
  new Set(
    await page
      .locator("[data-planning-question]")
      .evaluateAll((cards) =>
        cards.map(
          (card) =>
            (card.getAttribute("data-planning-question") ?? "").split("#")[0],
        ),
      ),
  );

const hashes = (lines: Line[]) =>
  Object.fromEntries(
    lines.flatMap((line) =>
      line.path !== undefined && line.hash !== undefined
        ? [[line.path, line.hash]]
        : [],
    ),
  );

/** The keys each of the scan cache's record stores holds, by path. */
const storedPaths = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Record<string, string[]>>((resolve, reject) => {
        const opening = indexedDB.open("vantage-planning");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const names = ["stamps", "documents", "cards"];
          const tx = db.transaction(names, "readonly");
          const out: Record<string, string[]> = {};
          for (const name of names) {
            const read = tx.objectStore(name).getAllKeys();
            read.onsuccess = () => {
              out[name] = (read.result as [string, string][]).map(
                ([, path]) => path,
              );
            };
          }
          tx.oncomplete = () => {
            db.close();
            resolve(out);
          };
        };
      }),
  );

test.describe("the planning scan cache", () => {
  test("the scan worker starts at boot, and builds the index a document needs", async ({
    page,
  }) => {
    const streams = await recordStreams(page);
    await page.goto("/plans/roadmap.md");
    // Started beside the app's first requests (§7.1).
    await expect.poll(() => page.workers().length).toBe(1);
    expect(page.workers()[0]?.url()).toContain("/planningScan/worker");
    // The index is ready once a badge is drawn, and one stream built it.
    await expect(
      page
        .locator("[data-content-scroll] [data-vantage-planning-badge]")
        .first(),
    ).toBeVisible();
    expect(streams).toHaveLength(1);
    expect(page.workers()).toHaveLength(1);
  });

  test("a reload streams only the roadmap and what changed, and its cards come from the cache", async ({
    page,
  }) => {
    const streams = await recordStreams(page);
    await planningPage(page);
    expect(streams).toHaveLength(1);
    const cold = streams[0] ?? { have: {}, lines: [] };
    expect(cold.have).toEqual({});
    expect(cold.lines.filter((line) => line.kind === "same")).toEqual([]);
    const first = hashes(cold.lines);

    const asked = pathRequests(page);
    await planningPage(page, true);
    expect(streams).toHaveLength(2);
    const warm = streams[1] ?? { have: {}, lines: [] };

    // Every file the first load read went back as `have`, but the roadmap,
    // which is never stored (§8.1).
    const readable = cold.lines.filter((line) => line.kind === "file");
    for (const line of readable) {
      if (line.path === ROADMAP) continue;
      expect(warm.have[line.path ?? ""]).toBe(line.hash);
    }
    expect(warm.have[ROADMAP]).toBeUndefined();

    // D8: no `file` line but the roadmap's, and whatever changed meanwhile.
    const sent = warm.lines.filter((line) => line.kind === "file");
    expect(sent.map((line) => line.path)).toContain(ROADMAP);
    for (const line of sent) {
      if (line.path === ROADMAP) continue;
      expect(line.hash).not.toBe(first[line.path ?? ""]);
    }
    expect(
      warm.lines.filter((line) => line.kind === "same").length,
    ).toBeGreaterThan(10);

    // Every card of a document nobody rewrites came from the cache, with no
    // request for its file.
    const shown = await cardPaths(page);
    expect(shown).toContain("plans/unrouted.md");
    expect(
      asked.filter((path) => shown.has(path) && path !== REWRITTEN),
    ).toEqual([]);
  });

  test("a different scanner id in the database makes the next load cold", async ({
    page,
  }) => {
    const streams = await recordStreams(page);
    await planningPage(page);

    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const opening = indexedDB.open("vantage-planning");
          opening.onerror = () => reject(opening.error);
          opening.onsuccess = () => {
            const db = opening.result;
            const tx = db.transaction("meta", "readwrite");
            tx.objectStore("meta").put("a scanner of other code", "scanner");
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );

    await planningPage(page, true);
    expect(streams).toHaveLength(2);
    const cold = streams[1] ?? { have: {}, lines: [] };
    expect(cold.have).toEqual({});
    // Every readable candidate is sent whole.
    expect(cold.lines.filter((line) => line.kind === "same")).toEqual([]);
    expect(
      cold.lines.filter((line) => line.kind === "file").length,
    ).toBeGreaterThan(10);

    // And the database now holds this scanner's results under its own id.
    const stored = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const opening = indexedDB.open("vantage-planning");
          opening.onerror = () => reject(opening.error);
          opening.onsuccess = () => {
            const db = opening.result;
            const read = db
              .transaction("meta", "readonly")
              .objectStore("meta")
              .get("scanner");
            read.onsuccess = () => {
              db.close();
              resolve(String(read.result));
            };
          };
        }),
    );
    expect(stored).not.toBe("a scanner of other code");
  });

  test("a build collects the records its stream no longer names", async ({
    page,
  }) => {
    await planningPage(page);

    // A record of a file the repository no longer has, as a deletion leaves.
    const GONE = "gone/removed.md";
    await page.evaluate(
      (gone) =>
        new Promise<void>((resolve, reject) => {
          const opening = indexedDB.open("vantage-planning");
          opening.onerror = () => reject(opening.error);
          opening.onsuccess = () => {
            const db = opening.result;
            const tx = db.transaction(
              ["stamps", "documents", "cards"],
              "readwrite",
            );
            const key = ["", gone];
            const hash = "0".repeat(32);
            tx.objectStore("stamps").put(
              { path: gone, hash, kind: "planning" },
              key,
            );
            tx.objectStore("documents").put(
              { hash, document: { path: gone } },
              key,
            );
            tx.objectStore("cards").put({ hash, blocks: [] }, key);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      GONE,
    );
    expect((await storedPaths(page))["stamps"]).toContain(GONE);

    // The next load's build collects it from every store; the rest is kept.
    await planningPage(page, true);
    await expect
      .poll(async () => {
        const held = await storedPaths(page);
        return Object.values(held).some((paths) => paths.includes(GONE));
      })
      .toBe(false);
    const held = await storedPaths(page);
    for (const name of ["stamps", "documents", "cards"]) {
      expect(held[name]).toContain("plans/unrouted.md");
    }
    expect(held["stamps"]).not.toContain(ROADMAP);
  });

  test("a tab whose IndexedDB cannot be opened builds cold every time, and still has its cards", async ({
    page,
  }) => {
    // The database already exists at a later version than the scanner asks
    // for, so the worker's open fails with a VersionError: the real
    // IndexedDB refusing it, with nothing stubbed.
    await page.addInitScript(() => {
      const opening = indexedDB.open("vantage-planning", 999);
      (window as unknown as { __refused: Promise<boolean> }).__refused =
        new Promise((resolve) => {
          opening.onsuccess = () => {
            opening.result.close();
            resolve(true);
          };
          opening.onerror = () => resolve(false);
        });
    });
    const streams = await recordStreams(page);
    const asked = pathRequests(page);
    await planningPage(page);
    expect(
      await page.evaluate(
        () => (window as unknown as { __refused: Promise<boolean> }).__refused,
      ),
    ).toBe(true);
    expect(streams).toHaveLength(1);
    expect(streams[0]?.have).toEqual({});

    // The blocks of this tab's build are held in the worker's memory, so the
    // cards needed no request for their files.
    const shown = await cardPaths(page);
    expect(shown).toContain("plans/unrouted.md");
    expect(
      asked.filter((path) => shown.has(path) && path !== REWRITTEN),
    ).toEqual([]);

    // Without a cache, the next load is as cold, and still has its cards.
    await planningPage(page, true);
    expect(streams).toHaveLength(2);
    const second = streams[1] ?? { have: {}, lines: [] };
    expect(second.have).toEqual({});
    expect(second.lines.filter((line) => line.kind === "same")).toEqual([]);
  });
});
