import { test, expect, type Page } from "@playwright/test";

// The scan worker and its cache in a real browser: the worker over the real
// planning stream, and the scan cache over the real IndexedDB, which no unit
// test can reach (docs/design/planning-index-at-scale.md §8, §19).
//
// The planning store does not ask the scanner for its index yet, so these
// drive the tab's scanner client directly, through the dev server's module
// graph: `/src/planningScan/client.ts` imported in the page is the module
// the app itself imports. Each test gets a fresh browser context, so
// IndexedDB starts empty, and a warm load is a reload inside one test.
//
// Other specs rewrite files of the same fixture while this one runs, so no
// assertion names an exact list of changed files.

const CLIENT = "/src/planningScan/client.ts";
const ROADMAP = "plans/roadmap.md";
/** planning.spec.ts rewrites it, so its hash may move under this spec. */
const REWRITTEN = "plans/design.md";

interface Line {
  kind: string;
  path?: string;
  hash?: string;
  refused?: boolean;
}

interface Event {
  type: string;
  warm?: boolean;
  docs?: {
    hash: string;
    document: {
      path: string;
      questions: { title: string; block: { startLine: number } }[];
    };
  }[];
}

/** Load the tab's scanner client into the page as `window.__scanner`. */
async function loadScanner(page: Page): Promise<void> {
  await page.evaluate(
    `import(${JSON.stringify(CLIENT)}).then((m) => { window.__scanner = m; })`,
  );
}

/** Run one build in the page, and settle with its events at ready or failed. */
async function build(
  page: Page,
  seq: number,
  bypassCache = false,
): Promise<Event[]> {
  return page.evaluate(
    ({ seq, bypassCache }) =>
      new Promise<Event[]>((resolve) => {
        const events: Event[] = [];
        const scanner = (
          window as unknown as {
            __scanner: {
              planningScanner(): {
                build(request: object, on: (event: Event) => void): void;
              };
            };
          }
        ).__scanner;
        scanner
          .planningScanner()
          .build({ repo: "", seq, bypassCache }, (event) => {
            events.push(event);
            if (event.type === "ready" || event.type === "failed") {
              resolve(events);
            }
          });
      }),
    { seq, bypassCache },
  );
}

/**
 * Every stream request the page's workers send, with the lines the server
 * answered, read on the way through. A worker's response body cannot be read
 * back over the protocol, so the route fetches it, keeps a copy, and hands it
 * on whole.
 */
async function recordStreams(page: Page) {
  const streams: { have: Record<string, string>; lines: Line[] }[] = [];
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

/** A build, with the `have` it sent and the lines it read. */
async function streamedBuild(
  page: Page,
  streams: { have: Record<string, string>; lines: Line[] }[],
  seq: number,
  bypassCache = false,
) {
  const before = streams.length;
  const events = await build(page, seq, bypassCache);
  expect(streams).toHaveLength(before + 1);
  const { have, lines } = streams[before] ?? { have: {}, lines: [] };
  return { events, lines, have };
}

/** Ask for every card of the given documents, as the planning page will. */
async function cards(page: Page, events: Event[], skip: string[] = []) {
  const want = events
    .flatMap((event) => event.docs ?? [])
    .filter(({ document }) => !skip.includes(document.path))
    .flatMap(({ document, hash }) =>
      document.questions.map((q) => ({
        path: document.path,
        hash,
        startLine: q.block.startLine,
      })),
    );
  const answers = await page.evaluate(
    (want) =>
      (
        window as unknown as {
          __scanner: {
            planningScanner(): {
              cards(repo: string, want: object[]): Promise<object[]>;
            };
          };
        }
      ).__scanner
        .planningScanner()
        .cards("", want),
    want,
  );
  return { want, answers };
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

const hashes = (lines: Line[]) =>
  Object.fromEntries(
    lines.flatMap((line) =>
      line.path !== undefined && line.hash !== undefined
        ? [[line.path, line.hash]]
        : [],
    ),
  );

test.describe("the planning scan cache", () => {
  test("the scan worker starts at boot, and serves the tab's builds", async ({
    page,
  }) => {
    const streams = await recordStreams(page);
    await page.goto("/page1.md");
    // Started beside the app's first requests (§7.1), asking nothing yet.
    await expect.poll(() => page.workers().length).toBe(1);
    expect(page.workers()[0]?.url()).toContain("/planningScan/worker");
    expect(streams).toHaveLength(0);

    await loadScanner(page);
    expect((await build(page, 1)).at(-1)).toEqual({ type: "ready" });
    expect(streams).toHaveLength(1);
    expect(page.workers()).toHaveLength(1);
  });

  test("a reload streams only the roadmap and what changed, and its cards come from the cache", async ({
    page,
  }) => {
    const streams = await recordStreams(page);
    await page.goto("/page1.md");
    await loadScanner(page);
    const cold = await streamedBuild(page, streams, 1);
    expect(cold.events[0]).toEqual({ type: "started", warm: false });
    expect(cold.events.at(-1)).toEqual({ type: "ready" });
    expect(cold.have).toEqual({});
    expect(cold.lines.filter((line) => line.kind === "same")).toEqual([]);
    const first = hashes(cold.lines);

    await page.reload();
    await loadScanner(page);
    const warm = await streamedBuild(page, streams, 1);
    expect(warm.events[0]).toEqual({ type: "started", warm: true });
    expect(warm.events.at(-1)).toEqual({ type: "ready" });

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

    // The warm build's documents are the cold build's.
    const docsOf = (events: Event[]) =>
      events
        .flatMap((event) => event.docs ?? [])
        .map(({ document }) => document.path)
        .sort();
    expect(docsOf(warm.events)).toEqual(docsOf(cold.events));
    expect(docsOf(warm.events)).toContain("plans/unrouted.md");

    // Every card of a document nobody rewrites comes from the cache, with no
    // request for its file.
    const asked = pathRequests(page);
    const { want, answers } = await cards(page, warm.events, [REWRITTEN]);
    expect(want.length).toBeGreaterThan(0);
    for (const answer of answers) expect(answer).toHaveProperty("block");
    const cardPaths = new Set(want.map((item) => item.path));
    expect(asked.filter((path) => cardPaths.has(path))).toEqual([]);

    await page.goto("/.vantage/planning");
    await expect(
      page.getByRole("article", { name: "OQ-U1: Is anyone tracking this?" }),
    ).toBeVisible();
  });

  test("a different scanner id in the database makes the next load cold", async ({
    page,
  }) => {
    const streams = await recordStreams(page);
    await page.goto("/page1.md");
    await loadScanner(page);
    expect((await build(page, 1)).at(-1)).toEqual({ type: "ready" });

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

    await page.reload();
    await loadScanner(page);
    const cold = await streamedBuild(page, streams, 1);
    expect(cold.events[0]).toEqual({ type: "started", warm: false });
    expect(cold.events.at(-1)).toEqual({ type: "ready" });
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

    await page.goto("/.vantage/planning");
    await expect(
      page.getByRole("article", { name: "OQ-U1: Is anyone tracking this?" }),
    ).toBeVisible();
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
    await page.goto("/page1.md");
    expect(
      await page.evaluate(
        () => (window as unknown as { __refused: Promise<boolean> }).__refused,
      ),
    ).toBe(true);
    await loadScanner(page);

    const first = await streamedBuild(page, streams, 1);
    expect(first.events[0]).toEqual({ type: "started", warm: false });
    expect(first.events.at(-1)).toEqual({ type: "ready" });
    // Without a cache, a second build in the same tab is as cold.
    const second = await streamedBuild(page, streams, 2);
    expect(second.events[0]).toEqual({ type: "started", warm: false });
    expect(second.have).toEqual({});
    expect(second.lines.filter((line) => line.kind === "same")).toEqual([]);

    // The blocks of this tab's builds are held in the worker's memory.
    const asked = pathRequests(page);
    const { want, answers } = await cards(page, second.events, [REWRITTEN]);
    expect(want.length).toBeGreaterThan(0);
    for (const answer of answers) expect(answer).toHaveProperty("block");
    const cardPaths = new Set(want.map((item) => item.path));
    expect(asked.filter((path) => cardPaths.has(path))).toEqual([]);

    await page.goto("/.vantage/planning");
    await expect(
      page.getByRole("article", { name: "OQ-U1: Is anyone tracking this?" }),
    ).toBeVisible();
  });
});
