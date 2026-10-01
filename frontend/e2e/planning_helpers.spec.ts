import { test, expect, type Page } from "@playwright/test";
import { planningIndexReady } from "./planningIndex";

// A cold build's helpers in a real browser (docs/reference/planning-index.md
// §10.5): workers the main thread makes at the scan worker's request, from the
// scan worker's own chunk, joined to it by real transferred MessagePorts. No
// unit test reaches any of that, since jsdom has no Worker.
//
// The fixture is far short of the 2 MiB of content a helper waits for, and no
// input grows to a default, so the build here runs in a scan worker of its
// own whose limits are configured down through the `limits` message the dev
// build's worker takes. The tab's own scan worker keeps the defaults.

interface Document {
  path: string;
}

type BuildEvent =
  | { type: "documents"; docs: { document: Document; hash: string }[] }
  | { type: "ready" | "failed" | "started" | "header" | "progress" };

/** The scan worker's URL on the dev server, read from the tab's own. */
async function scanWorkerUrl(page: Page): Promise<string> {
  await expect.poll(() => page.workers().length).toBeGreaterThan(0);
  const url = page.workers()[0]?.url() ?? "";
  expect(url).toContain("/planningScan/worker");
  return url;
}

test.describe("a cold build's helpers", () => {
  test("share a build past its threshold, give the tab's index, and end with it", async ({
    page,
  }) => {
    await page.goto("/");
    await planningIndexReady(page);
    const url = await scanWorkerUrl(page);

    // Every worker the page makes from here on, and how many of them end.
    const made: string[] = [];
    let ended = 0;
    page.on("worker", (worker) => {
      made.push(worker.url());
      worker.on("close", () => (ended += 1));
    });

    const { events, cores, tab } = await page.evaluate(async (url) => {
      const clientPath = "/src/planningScan/client.ts";
      const { workerScannerClient } = await import(
        /* @vite-ignore */ clientPath
      );
      // A scan worker of this test's own, with its limits configured down;
      // its helpers are made the way the app makes them.
      const client = workerScannerClient(() => {
        const worker = new Worker(url, { type: "module" });
        worker.postMessage({
          type: "limits",
          limits: {
            helperThresholdBytes: 1024,
            helperQueueBytes: 1024,
            maxHelpers: 2,
            helperReservedCores: 0,
          },
        });
        return worker;
      });
      const events = await new Promise<BuildEvent[]>((resolve) => {
        const seen: BuildEvent[] = [];
        // Past the cache, so the build is cold whatever the tab stored.
        client.build(
          { repo: "", seq: 1, bypassCache: true },
          (event: BuildEvent) => {
            seen.push(event);
            if (event.type === "ready" || event.type === "failed") {
              resolve(seen);
            }
          },
        );
      });
      const storePath = "/src/stores/usePlanningStore.ts";
      const { usePlanningStore } = await import(/* @vite-ignore */ storePath);
      const load = usePlanningStore.getState().byRepo[""];
      return {
        events,
        cores: navigator.hardwareConcurrency,
        tab:
          load?.status === "ready"
            ? {
                documents: load.index.documents as Document[],
                hashes: load.hashes as Record<string, string>,
              }
            : null,
      };
    }, url);

    expect(events.at(-1)).toEqual({ type: "ready" });
    // This test's scan worker, then its helpers, all of the one chunk.
    const helpers = Math.min(2, cores);
    expect(made).toHaveLength(1 + helpers);
    for (const workerUrl of made) {
      expect(workerUrl).toContain("/planningScan/worker");
    }
    // The helpers ended with the build; the scan worker lives on.
    await expect.poll(() => ended).toBe(helpers);

    // The facts are the tab's own build's, for every file both read alike.
    // (Other specs rewrite files of this fixture, so a hash may have moved.)
    expect(tab).not.toBeNull();
    const built = events.flatMap((event) =>
      event.type === "documents" ? event.docs : [],
    );
    const same = built.filter(
      ({ document, hash }) => tab?.hashes[document.path] === hash,
    );
    expect(same.length).toBeGreaterThan(10);
    for (const { document } of same) {
      expect(document).toEqual(
        tab?.documents.find((doc) => doc.path === document.path),
      );
    }
  });

  test("scan part of the build themselves, and what they answer is used", async ({
    page,
  }) => {
    await page.goto("/");
    await planningIndexReady(page);
    const url = await scanWorkerUrl(page);

    const { events, answered } = await page.evaluate(async (url) => {
      const clientPath = "/src/planningScan/client.ts";
      const { workerScannerClient } = await import(
        /* @vite-ignore */ clientPath
      );
      /** Per helper, the answers it sent the scan worker. */
      const answered: number[] = [];
      const client = workerScannerClient(
        () => {
          const worker = new Worker(url, { type: "module" });
          worker.postMessage({
            type: "limits",
            limits: {
              helperThresholdBytes: 1024,
              helperQueueBytes: 1024,
              maxHelpers: 2,
              helperReservedCores: 0,
            },
          });
          return worker;
        },
        // A helper whose channel runs through a relay on this thread, so the
        // test can count what it answers. The app's own passes it straight.
        () => {
          const worker = new Worker(url, { type: "module" });
          const at = answered.push(0) - 1;
          return {
            postMessage(message: { type: string; port: MessagePort }) {
              const toScanWorker = message.port;
              const relay = new MessageChannel();
              worker.postMessage({ type: "helper", port: relay.port1 }, [
                relay.port1,
              ]);
              toScanWorker.onmessage = (event) =>
                relay.port2.postMessage(event.data);
              relay.port2.onmessage = (event) => {
                answered[at] = (answered[at] ?? 0) + 1;
                toScanWorker.postMessage(event.data);
              };
            },
            addEventListener: (
              type: string,
              listener: (event: Event) => void,
            ) => worker.addEventListener(type, listener),
            terminate: () => worker.terminate(),
          };
        },
      );
      const events = await new Promise<BuildEvent[]>((resolve) => {
        const seen: BuildEvent[] = [];
        client.build(
          { repo: "", seq: 1, bypassCache: true },
          (event: BuildEvent) => {
            seen.push(event);
            if (event.type === "ready" || event.type === "failed") {
              resolve(seen);
            }
          },
        );
      });
      return { events, answered };
    }, url);

    expect(events.at(-1)).toEqual({ type: "ready" });
    // Both helpers scanned files of the build, and the scan worker the rest.
    expect(answered).toHaveLength(2);
    for (const count of answered) expect(count).toBeGreaterThan(0);
    const built = events.flatMap((event) =>
      event.type === "documents" ? event.docs : [],
    );
    const paths = built.map(({ document }) => document.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("plans/unrouted.md");
  });

  test("a build goes on without a helper whose code cannot be loaded", async ({
    page,
  }) => {
    await page.goto("/");
    await planningIndexReady(page);
    const url = await scanWorkerUrl(page);
    // The first helper's script never arrives; the rest are the real chunk.
    await page.route(/[?&]helper-that-never-loads/, (route) => route.abort());

    const { events, tab } = await page.evaluate(async (url) => {
      const clientPath = "/src/planningScan/client.ts";
      const { workerScannerClient } = await import(
        /* @vite-ignore */ clientPath
      );
      let helpers = 0;
      const client = workerScannerClient(
        () => {
          const worker = new Worker(url, { type: "module" });
          worker.postMessage({
            type: "limits",
            limits: {
              helperThresholdBytes: 1024,
              helperQueueBytes: 1024,
              maxHelpers: 2,
              helperReservedCores: 0,
            },
          });
          return worker;
        },
        () =>
          new Worker(helpers++ === 0 ? `${url}&helper-that-never-loads` : url, {
            type: "module",
          }),
      );
      const events = await new Promise<BuildEvent[]>((resolve) => {
        const seen: BuildEvent[] = [];
        client.build(
          { repo: "", seq: 1, bypassCache: true },
          (event: BuildEvent) => {
            seen.push(event);
            if (event.type === "ready" || event.type === "failed") {
              resolve(seen);
            }
          },
        );
      });
      const storePath = "/src/stores/usePlanningStore.ts";
      const { usePlanningStore } = await import(/* @vite-ignore */ storePath);
      const load = usePlanningStore.getState().byRepo[""];
      return {
        events,
        tab:
          load?.status === "ready"
            ? { documents: (load.index.documents as Document[]).length }
            : null,
      };
    }, url);

    expect(events.at(-1)).toEqual({ type: "ready" });
    // As many planning documents as the tab's own build found. (Other specs
    // rewrite files of this fixture, never into or out of being one.)
    const paths = events
      .flatMap((event) => (event.type === "documents" ? event.docs : []))
      .map(({ document }) => document.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("plans/unrouted.md");
    expect(tab).not.toBeNull();
    expect(paths).toHaveLength(tab?.documents ?? -1);
  });

  test("a worker of the scan worker's chunk, started as a helper, scans what its port sends", async ({
    page,
  }) => {
    await page.goto("/");
    const url = await scanWorkerUrl(page);
    const answer = await page.evaluate(async (url) => {
      const worker = new Worker(url, { type: "module" });
      const channel = new MessageChannel();
      worker.postMessage({ type: "helper", port: channel.port1 }, [
        channel.port1,
      ]);
      const reply = await new Promise((resolve) => {
        channel.port2.onmessage = (event) => resolve(event.data);
        channel.port2.postMessage({
          id: 7,
          config: {
            roadmaps: null,
            include: ["**/*.md"],
            exclude: [],
            maxFileBytes: 1048576,
            maxCandidates: 5000,
            stages: null,
          },
          path: "plans/helped.md",
          content:
            "---\nstatus: draft\n---\n\n# Helped\n\n1. 💬 **OQ-H1: Does it scan?**\n\n   <!-- vantage: oq id=OQ-H1 -->\n\n   _Leaning:_ it does.\n",
        });
      });
      worker.terminate();
      return reply;
    }, url);
    expect(answer).toMatchObject({
      id: 7,
      result: {
        kind: "planning",
        document: {
          path: "plans/helped.md",
          questions: [expect.objectContaining({ id: "OQ-H1" })],
        },
        cards: [expect.objectContaining({ markdown: expect.any(String) })],
      },
    });
  });
});
