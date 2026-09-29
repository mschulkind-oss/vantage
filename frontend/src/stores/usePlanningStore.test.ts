/**
 * The viewer's planning index (`docs/design/planning-index.md` §3.4, §3.6, and
 * §5 and §9 of `docs/design/planning-index-at-scale.md`, "the scale design"
 * in the names below): the build through the scanner client, the per-file
 * refresh through it, the numbering that decides which answer wins, and the
 * rescans.
 *
 * The store runs over the real inline client, the real scan core and the scan
 * cache over `memoryScanStore()`. The network under them is mocked at `fetch`,
 * one deferred answer per request: the stream's body is fed line by line and
 * the `?path=` answers are resolved when the test says, so every race is
 * written out in the order the test resolves them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  buildPlanningIndex,
  findDocument,
  type PlanningConfig,
  type PlanningIndex,
} from "vantage-md/planning";
import {
  PLANNING_IDLE,
  SHAPE_MESSAGE,
  STATIC_MESSAGE,
  resetPlanningTrackers,
  usePlanningIndex,
  usePlanningStore,
  type PlanningLoad,
} from "./usePlanningStore";
import { useRepoStore } from "./useRepoStore";
import {
  inlineScannerClient,
  setPlanningScannerForTests,
  type BuildEvent,
  type InlineScannerClient,
  type ScannerClient,
} from "../planningScan/client";
import { setPlanningLimitsForTests } from "../planningScan/limits";
import { memoryScanStore } from "../planningScan/memoryStore";
import {
  contentHash,
  planningConfig,
  scannedOf,
  sourcesOf,
} from "../test/planning";
import { streamLines } from "../test/planningStream";

/* ------------------------------------------------------------------ *
 * A fake server: every request waits until the test answers it.
 * ------------------------------------------------------------------ */

/** The stream's body, fed by the test one line at a time. */
interface Feed {
  /** Each line a JSON value, or a raw string sent as it is. */
  send(...lines: unknown[]): void;
  close(): void;
}

interface Request {
  method: string;
  url: string;
  /** A POST's parsed body; `undefined` for a GET. */
  body: unknown;
  signal: AbortSignal | undefined;
  /** Answer with this JSON. */
  answer(data: unknown): void;
  /** Answer with an error status. */
  status(code: number): void;
  /** Fail, as a dropped connection does. */
  fail(error?: unknown): void;
  /** Answer `200` with a body the test then feeds. */
  open(): Feed;
}

let requests: Request[] = [];

const fakeFetch: typeof fetch = (input, init) =>
  new Promise<Response>((resolve, reject) => {
    const text = typeof init?.body === "string" ? init.body : undefined;
    const json = (data: unknown, status = 200) =>
      resolve(
        new Response(JSON.stringify(data), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    requests.push({
      method: init?.method ?? "GET",
      url: String(input),
      body: text === undefined ? undefined : JSON.parse(text),
      signal: init?.signal ?? undefined,
      answer: (data) => json(data),
      status: (code) => json({ detail: "no" }, code),
      fail: (error = new Error("Network Error")) => reject(error),
      open() {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start: (c) => {
            controller = c;
          },
        });
        resolve(
          new Response(body, {
            headers: { "Content-Type": "application/x-ndjson" },
          }),
        );
        const encoder = new TextEncoder();
        // A reader the scanner cancelled takes nothing more; the test may
        // still be feeding it, as a server would.
        const quietly = (write: () => void) => {
          try {
            write();
          } catch {
            // closed
          }
        };
        return {
          send: (...lines) => {
            for (const line of lines) {
              const text =
                typeof line === "string" ? line : JSON.stringify(line);
              quietly(() => controller.enqueue(encoder.encode(`${text}\n`)));
            }
          },
          close: () => quietly(() => controller.close()),
        };
      },
    });
  });

function take(url: string): Request {
  const at = requests.findIndex((r) => r.url === url);
  if (at === -1) {
    throw new Error(
      `no request for ${url}; pending: ${requests.map((r) => r.url).join(", ")}`,
    );
  }
  const [request] = requests.splice(at, 1);
  return request;
}

const STREAM = "/api/planning/stream";
const one = (path: string, base = "/api") =>
  `${base}/planning/sources?path=${encodeURIComponent(path)}`;

/** Let every answered request run through the scanner and the store. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
}

/* ------------------------------------------------------------------ *
 * Documents
 * ------------------------------------------------------------------ */

const question = (id: string, marker = "\u{1F4AC}") =>
  [
    `1. ${marker} **${id}: A question?**`,
    "",
    `   <!-- vantage: oq id=${id} leaning="Yes." -->`,
    "",
    "   _Leaning:_ yes.",
    "",
  ].join("\n");

const DESIGN = `---\nstatus: in-review\nstage: DESIGN\n---\n\n# Design\n\n${question("OQ-1")}`;
const DESIGN_ANSWERED = `---\nstatus: in-review\nstage: DESIGN\n---\n\n# Design\n\n${question("OQ-1", "✅")}`;
const LEGACY = "---\nstatus: draft\n---\n\n# Legacy\n";
const ROADMAP = "# Roadmap\n\n1. [Design](docs/design.md)\n";
const TREE: Record<string, string> = {
  "roadmap.md": ROADMAP,
  "docs/design.md": DESIGN,
  "docs/old/legacy.md": LEGACY,
  "docs/plain.md": "# Plain\n",
};

/** The `have` a stream request sent: `{}` for none. */
const haveOf = (request: Request): Record<string, string> =>
  (request.body as { have?: Record<string, string> } | undefined)?.have ?? {};

/**
 * Answer a stream request as the server would for `tree`: a header, one line
 * per candidate, answering its `have`, then `end`.
 */
function answerStream(
  request: Request,
  tree: Record<string, string> = TREE,
  options: {
    config?: Partial<PlanningConfig>;
    unreadable?: Record<string, string>;
  } = {},
): void {
  const feed = request.open();
  feed.send(...streamLines(tree, haveOf(request), options));
  feed.close();
}

/** The server's config object: snake_case. */
const snakeConfig = (config: Partial<PlanningConfig> = {}) => {
  const full = planningConfig(config);
  return {
    roadmap: full.roadmap,
    include: full.include,
    exclude: full.exclude,
    max_file_bytes: full.maxFileBytes,
    max_candidates: full.maxCandidates,
    stages: full.stages,
  };
};

/** A refused stream: its header, then `end`, and nothing opened. */
function answerRefused(
  request: Request,
  candidates = 6000,
  config: Record<string, unknown> = snakeConfig(),
): void {
  const feed = request.open();
  feed.send(
    { kind: "header", config, candidate_count: candidates, refused: true },
    { kind: "end", candidates },
  );
  feed.close();
}

/** A `?path=` answer for a readable file, with its content hash. */
const fileAnswer = (path: string, content: string) => ({
  path,
  kind: "file",
  content,
  hash: contentHash(content),
});

const load = (repo = ""): PlanningLoad =>
  usePlanningStore.getState().byRepo[repo] ?? PLANNING_IDLE;

function readyLoad(repo = ""): Extract<PlanningLoad, { status: "ready" }> {
  const current = load(repo);
  if (current.status !== "ready") {
    throw new Error(`expected a ready index, got ${current.status}`);
  }
  return current;
}

const readyIndex = (repo = ""): PlanningIndex => readyLoad(repo).index;
const paths = (repo = "") => readyIndex(repo).documents.map((d) => d.path);
const store = () => usePlanningStore.getState();

/** Ensure the single repo and land its build. */
async function readyWith(tree: Record<string, string> = TREE): Promise<void> {
  store().ensure("");
  await flush();
  answerStream(take(STREAM), tree);
  await flush();
  expect(load().status).toBe("ready");
}

let client: InlineScannerClient;

beforeEach(() => {
  requests = [];
  client = inlineScannerClient({
    store: memoryScanStore(),
    scannerId: "test",
    fetch: fakeFetch,
  });
  setPlanningScannerForTests(client);
  resetPlanningTrackers();
  usePlanningStore.setState({ byRepo: {}, reviewEpoch: {} });
  useRepoStore.setState({
    reposLoaded: true,
    isMultiRepo: false,
    currentRepo: null,
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  delete window.__VANTAGE_STATIC__;
  setPlanningScannerForTests(null);
  setPlanningLimitsForTests(null);
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * The build
 * ------------------------------------------------------------------ */

describe("the build (§3.4, full scan; scale design §5.2)", () => {
  it("fills the index, and holds each planning document's content hash", async () => {
    await readyWith();
    const current = readyLoad();
    expect(current.rescanning).toBe(false);
    expect(paths()).toEqual([
      "docs/design.md",
      "docs/old/legacy.md",
      "roadmap.md",
    ]);
    expect(current.hashes).toEqual({
      "docs/design.md": contentHash(DESIGN),
      "docs/old/legacy.md": contentHash(LEGACY),
      "roadmap.md": contentHash(ROADMAP),
    });
  });

  it("holds no document's text (S2)", async () => {
    await readyWith();
    const held = JSON.stringify(load());
    for (const content of Object.values(TREE)) {
      expect(held).not.toContain(JSON.stringify(content).slice(1, -1));
    }
    expect(readyLoad()).not.toHaveProperty("sources");
  });

  it("asks the planning stream, cold, with no `have`", async () => {
    store().ensure("");
    await flush();
    expect(requests).toMatchObject([{ method: "POST", url: STREAM }]);
    expect(requests[0]?.body).toEqual({});
  });

  it("builds the index buildPlanningIndex builds from the same files", async () => {
    const tree = {
      ...TREE,
      "docs/broken.md": "---\nstatus: [unterminated\n---\n",
    };
    const big = `---\nstatus: draft\n---\n\n${"x".repeat(600)}\n`;
    await readyWith(tree);
    store().rescan("");
    await flush();
    answerStream(
      take(STREAM),
      { ...tree, "a.md": "latin-1", "docs/big.md": big },
      {
        config: { maxFileBytes: 512 },
        unreadable: { "a.md": "not UTF-8" },
      },
    );
    await flush();
    const expected = buildPlanningIndex(
      sourcesOf(
        tree,
        {
          candidateCount: Object.keys(tree).length + 2,
          unreadable: [{ path: "a.md", reason: "not UTF-8" }],
          skipped: [{ path: "docs/big.md", size: big.length }],
        },
        { maxFileBytes: 512 },
      ),
    );
    expect(readyIndex()).toEqual(expected);
  });

  it("builds the same index warm, from what the scan cache kept", async () => {
    await readyWith();
    const cold = readyIndex();
    const coldHashes = readyLoad().hashes;
    await client.idle();

    // A new page load: the store starts over, the tab's cache does not.
    resetPlanningTrackers();
    usePlanningStore.setState({ byRepo: {} });
    store().ensure("");
    await flush();
    const warm = take(STREAM);
    // Every file but the roadmap, which is never stored.
    expect(haveOf(warm)).toEqual(
      Object.fromEntries(
        Object.entries(TREE)
          .filter(([path]) => path !== "roadmap.md")
          .map(([path, content]) => [path, contentHash(content)]),
      ),
    );
    answerStream(warm);
    await flush();
    expect(readyIndex()).toEqual(cold);
    expect(readyLoad().hashes).toEqual(coldHashes);
  });

  it("sets the store once at ready, however many chunks the documents come in", async () => {
    setPlanningLimitsForTests({ chunkEntries: 1, progressMs: 60_000 });
    const tree = Object.fromEntries(
      ["a", "b", "c", "d", "e", "f"].map((name) => [
        `plans/${name}.md`,
        `---\nstatus: draft\n---\n\n# ${name}\n`,
      ]),
    );
    const seen: PlanningLoad[] = [];
    const unsubscribe = usePlanningStore.subscribe((state) => {
      const current = state.byRepo[""];
      if (current !== undefined && current !== seen.at(-1)) seen.push(current);
    });
    try {
      await readyWith(tree);
    } finally {
      unsubscribe();
    }
    expect(seen.map((s) => s.status)).toEqual(["loading", "ready"]);
    expect(paths()).toHaveLength(6);
  });

  it("is started once, however often it is ensured", async () => {
    store().ensure("");
    store().ensure("");
    await flush();
    expect(requests.map((r) => r.url)).toEqual([STREAM]);
    expect(load().status).toBe("loading");
    answerStream(take(STREAM));
    await flush();
    store().ensure("");
    await flush();
    expect(requests).toEqual([]);
  });

  it("waits for the repo store, and in daemon mode for a repository", async () => {
    useRepoStore.setState({ reposLoaded: false });
    store().ensure("");
    await flush();
    expect(requests).toEqual([]);
    expect(load().status).toBe("idle");

    useRepoStore.setState({ reposLoaded: true, isMultiRepo: true });
    store().ensure("");
    await flush();
    expect(requests).toEqual([]);

    store().ensure("alpha");
    await flush();
    expect(requests.map((r) => r.url)).toEqual([
      "/api/r/alpha/planning/stream",
    ]);
  });

  it("logs the time to ready once", async () => {
    await readyWith();
    store().rescan("");
    await flush();
    answerStream(take(STREAM));
    await flush();
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.info).mock.calls[0][0]).toContain(
      "[planning] index ready in",
    );
  });

  it("carries a refusal through with no documents", async () => {
    store().ensure("");
    await flush();
    answerRefused(take(STREAM));
    await flush();
    expect(readyIndex()).toMatchObject({
      refused: true,
      candidateCount: 6000,
      documents: [],
    });
    expect(readyLoad().hashes).toEqual({});
  });
});

describe("a refused index (§3.5)", () => {
  // Only a rescan can change a refused index, so one path's answer would be
  // read and thrown away.
  it("asks nothing about a pushed path", async () => {
    store().ensure("");
    await flush();
    answerRefused(take(STREAM));
    await flush();
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    expect(requests).toEqual([]);
  });

  // The build a rescan sends may not be refused, and what was pushed while it
  // was out is newer than what it read.
  it("still asks while a rescan's build is out", async () => {
    store().ensure("");
    await flush();
    answerRefused(take(STREAM));
    await flush();
    store().rescan("");
    await flush();
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    // The refresh is scanned under the rescan's config, so it waits for the
    // rescan's header before it asks.
    expect(requests.map((r) => r.url)).toEqual([STREAM]);
    const feed = take(STREAM).open();
    const [header] = streamLines(TREE, {});
    feed.send(header);
    await flush();
    expect(requests.map((r) => r.url)).toEqual([one("docs/design.md")]);
  });
});

describe("failure (§3.6; scale design §12)", () => {
  it("gives error when the stream request fails", async () => {
    store().ensure("");
    await flush();
    take(STREAM).fail();
    await flush();
    expect(load()).toEqual({
      status: "error",
      message: "Could not load the planning index: Network Error",
    });
  });

  it("gives error when the server answers with an error status", async () => {
    store().ensure("");
    await flush();
    take(STREAM).status(500);
    await flush();
    expect(load()).toEqual({
      status: "error",
      message:
        "Could not load the planning index: Request failed with status code 500",
    });
  });

  it("gives error for a body of any other shape, such as index.html", async () => {
    store().ensure("");
    await flush();
    const feed = take(STREAM).open();
    feed.send("<!doctype html><html></html>");
    feed.close();
    await flush();
    expect(load()).toEqual({ status: "error", message: SHAPE_MESSAGE });
  });

  it("gives error for a stream cut short, never a smaller index", async () => {
    store().ensure("");
    await flush();
    const feed = take(STREAM).open();
    feed.send(...streamLines(TREE, {}).slice(0, -1));
    feed.close();
    await flush();
    expect(load()).toEqual({
      status: "error",
      message:
        "Could not load the planning index: The planning stream ended before its end line",
    });
  });

  it("gives error at once in a static export, with no request", async () => {
    window.__VANTAGE_STATIC__ = true;
    store().ensure("");
    await flush();
    expect(requests).toEqual([]);
    expect(load()).toEqual({ status: "error", message: STATIC_MESSAGE });
    store().rescan("");
    await flush();
    expect(requests).toEqual([]);
    expect(load().status).toBe("error");
  });

  it("stays failed until a rescan: ensure does not retry", async () => {
    store().ensure("");
    await flush();
    take(STREAM).fail();
    await flush();
    store().ensure("");
    await flush();
    expect(requests).toEqual([]);
    store().rescan("");
    expect(load().status).toBe("loading");
    await flush();
    answerStream(take(STREAM));
    await flush();
    expect(load().status).toBe("ready");
  });
});

/* ------------------------------------------------------------------ *
 * Per-file refresh
 * ------------------------------------------------------------------ */

describe("a pushed path (§3.4, incremental; scale design §5.3)", () => {
  it("re-scans a changed candidate from the single-path mode", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    expect(requests.map((r) => r.url)).toEqual([one("docs/design.md")]);
    take(one("docs/design.md")).answer(
      fileAnswer("docs/design.md", DESIGN_ANSWERED),
    );
    await flush();
    const doc = findDocument(readyIndex(), "docs/design.md");
    expect(doc?.questions.map((q) => q.state)).toEqual(["answered"]);
  });

  it("follows the refreshed file's content hash", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    take(one("docs/design.md")).answer(
      fileAnswer("docs/design.md", DESIGN_ANSWERED),
    );
    await flush();
    expect(readyLoad().hashes["docs/design.md"]).toBe(
      contentHash(DESIGN_ANSWERED),
    );

    // A planning document that stops being one has no hash any more.
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    take(one("docs/design.md")).answer(
      fileAnswer("docs/design.md", "# Just notes now\n"),
    );
    await flush();
    expect(readyLoad().hashes).not.toHaveProperty("docs/design.md");

    // And a new one gains one.
    const fresh = "---\nstage: SKETCH\n---\n";
    store().noteFilesChanged("", ["docs/new.md"], []);
    await flush();
    take(one("docs/new.md")).answer(fileAnswer("docs/new.md", fresh));
    await flush();
    expect(readyLoad().hashes["docs/new.md"]).toBe(contentHash(fresh));
  });

  it("bumps the version on every change", async () => {
    await readyWith();
    const before = readyLoad();
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    take(one("docs/design.md")).answer(
      fileAnswer("docs/design.md", DESIGN_ANSWERED),
    );
    await flush();
    expect(readyLoad().version).toBeGreaterThan(before.version);
  });

  it("keeps the load, version included, when a save changes nothing", async () => {
    await readyWith();
    const before = load();
    store().noteFilesChanged("", ["docs/notes.md"], []);
    await flush();
    take(one("docs/notes.md")).answer(
      fileAnswer("docs/notes.md", "# Just notes\n"),
    );
    await flush();
    expect(load()).toBe(before);
  });

  it("adds a new file the server answers as a file", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/new.md"], []);
    await flush();
    take(one("docs/new.md")).answer(
      fileAnswer("docs/new.md", "---\nstage: SKETCH\n---\n"),
    );
    await flush();
    expect(paths()).toContain("docs/new.md");
  });

  it("never adds a path the server answers absent, whatever it holds", async () => {
    // `.github/x.md` is under a hidden directory the listing prunes. The
    // watcher pushes it anyway, and only the server can say it is no candidate.
    await readyWith();
    store().noteFilesChanged("", [".github/x.md"], []);
    await flush();
    take(one(".github/x.md")).answer({ path: ".github/x.md", kind: "absent" });
    await flush();
    expect(paths()).not.toContain(".github/x.md");
  });

  it("drops a deleted file, and its hash", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    take(one("docs/design.md")).answer({
      path: "docs/design.md",
      kind: "absent",
    });
    await flush();
    expect(paths()).not.toContain("docs/design.md");
    expect(readyLoad().hashes).not.toHaveProperty("docs/design.md");
  });

  it("moves a file the server answers skipped to skipped", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    take(one("docs/design.md")).answer({
      path: "docs/design.md",
      kind: "skipped",
      size: 2097152,
    });
    await flush();
    expect(paths()).not.toContain("docs/design.md");
    expect(readyIndex().skipped).toEqual([
      { path: "docs/design.md", size: 2097152 },
    ]);
  });

  it("keeps the previous entry when a refresh fails, and asks again on the next push", async () => {
    await readyWith();
    const before = readyIndex();
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    take(one("docs/design.md")).fail();
    await flush();
    expect(readyIndex()).toBe(before);

    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    take(one("docs/design.md")).answer({
      path: "docs/design.md",
      kind: "absent",
    });
    await flush();
    expect(paths()).not.toContain("docs/design.md");
  });

  it("keeps the previous entry when the server's answer has no hash", async () => {
    await readyWith();
    const before = readyIndex();
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    take(one("docs/design.md")).answer({
      path: "docs/design.md",
      kind: "file",
      content: DESIGN_ANSWERED,
    });
    await flush();
    expect(readyIndex()).toBe(before);
  });

  it("asks nothing for a path that cannot be a candidate", async () => {
    await readyWith();
    store().noteFilesChanged("", [".git/HEAD", "img/logo.png"], []);
    await flush();
    expect(requests).toEqual([]);
  });

  it("drops a removed directory's documents and hashes, and keeps its prefix's neighbors", async () => {
    await readyWith({ ...TREE, "docs/older.md": "---\nstatus: draft\n---\n" });
    store().noteFilesChanged("", [], ["docs/old"]);
    await flush();
    expect(requests).toEqual([]);
    expect(paths()).toEqual(["docs/design.md", "docs/older.md", "roadmap.md"]);
    expect(Object.keys(readyLoad().hashes).sort()).toEqual([
      "docs/design.md",
      "docs/older.md",
      "roadmap.md",
    ]);
  });

  it("ignores another repository's push", async () => {
    useRepoStore.setState({ isMultiRepo: true, currentRepo: "alpha" });
    store().ensure("alpha");
    await flush();
    answerStream(take("/api/r/alpha/planning/stream"));
    await flush();
    const before = readyIndex("alpha");
    store().noteFilesChanged("beta", ["docs/design.md"], ["docs"]);
    await flush();
    expect(requests).toEqual([]);
    expect(readyIndex("alpha")).toBe(before);
    expect(load("beta").status).toBe("idle");
  });

  it("asks the repository's own endpoint in daemon mode", async () => {
    useRepoStore.setState({ isMultiRepo: true, currentRepo: "alpha" });
    store().ensure("alpha");
    await flush();
    answerStream(take("/api/r/alpha/planning/stream"));
    await flush();
    store().noteFilesChanged("alpha", ["docs/design.md"], []);
    await flush();
    expect(requests.map((r) => r.url)).toEqual([
      one("docs/design.md", "/api/r/alpha"),
    ]);
  });

  it("does nothing for an index nobody has asked for", async () => {
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    expect(requests).toEqual([]);
    expect(load().status).toBe("idle");
  });
});

/* ------------------------------------------------------------------ *
 * Ordering
 * ------------------------------------------------------------------ */

describe("ordering (§3.4; scale design §5.4)", () => {
  const answered = fileAnswer("docs/design.md", DESIGN_ANSWERED);
  const gone = { path: "docs/design.md", kind: "absent" };
  const state = () =>
    findDocument(readyIndex(), "docs/design.md")?.questions[0].state;

  it("lets the newer request win when the older answer lands last", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    const older = take(one("docs/design.md"));
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    const newer = take(one("docs/design.md"));
    newer.answer(answered);
    await flush();
    older.answer(gone);
    await flush();
    expect(state()).toBe("answered");
  });

  it("lets the newer request win when the older answer lands first", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    const older = take(one("docs/design.md"));
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    const newer = take(one("docs/design.md"));
    older.answer(gone);
    await flush();
    newer.answer(answered);
    await flush();
    expect(state()).toBe("answered");
  });

  it("lands a push made while loading on top of the build", async () => {
    store().ensure("");
    await flush();
    const feed = take(STREAM).open();
    const lines = streamLines(TREE, {});
    feed.send(lines[0]);
    store().noteFilesChanged("", ["docs/design.md", "docs/new.md"], []);
    await flush();
    take(one("docs/design.md")).answer(answered);
    take(one("docs/new.md")).answer(
      fileAnswer("docs/new.md", "---\nstatus: draft\n---\n"),
    );
    await flush();
    expect(load().status).toBe("loading");
    feed.send(...lines.slice(1));
    feed.close();
    await flush();
    expect(state()).toBe("answered");
    expect(paths()).toContain("docs/new.md");
    // The held answer's hash, not the build's.
    expect(readyLoad().hashes["docs/design.md"]).toBe(
      contentHash(DESIGN_ANSWERED),
    );
  });

  it("applies a push's answer that lands after the build it was newer than", async () => {
    store().ensure("");
    await flush();
    const stream = take(STREAM);
    store().noteFilesChanged("", ["docs/design.md"], []);
    answerStream(stream);
    await flush();
    const refresh = take(one("docs/design.md"));
    expect(state()).toBe("open");
    refresh.answer(answered);
    await flush();
    expect(state()).toBe("answered");
  });

  it("discards an answer to a request older than the latest build", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/design.md"], []);
    await flush();
    const stale = take(one("docs/design.md"));
    store().rescan("");
    await flush();
    answerStream(take(STREAM));
    await flush();
    stale.answer(gone);
    await flush();
    expect(paths()).toContain("docs/design.md");
  });

  it("keeps a directory removed while loading out of the build", async () => {
    store().ensure("");
    await flush();
    const stream = take(STREAM);
    store().noteFilesChanged("", [], ["docs/old"]);
    answerStream(stream);
    await flush();
    expect(paths()).not.toContain("docs/old/legacy.md");
    expect(readyLoad().hashes).not.toHaveProperty("docs/old/legacy.md");
  });

  it("does not let an answer older than a removal bring its file back", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/old/legacy.md"], []);
    await flush();
    const stale = take(one("docs/old/legacy.md"));
    store().noteFilesChanged("", [], ["docs/old"]);
    stale.answer(fileAnswer("docs/old/legacy.md", LEGACY));
    await flush();
    expect(paths()).not.toContain("docs/old/legacy.md");
  });

  it("cancels a build a later rescan supersedes, aborting its request", async () => {
    store().ensure("");
    await flush();
    const first = take(STREAM);
    expect(first.signal?.aborted).toBe(false);
    store().rescan("");
    await flush();
    expect(first.signal?.aborted).toBe(true);
    expect(requests.map((r) => r.url)).toEqual([STREAM]);
  });

  it("discards a build superseded by a later rescan whole", async () => {
    store().ensure("");
    await flush();
    const first = take(STREAM);
    store().rescan("");
    await flush();
    const second = take(STREAM);
    answerStream(second);
    await flush();
    const settled = readyIndex();
    answerRefused(first, 9999, {
      roadmap: "elsewhere.md",
      include: [],
      exclude: [],
      max_file_bytes: 1,
      max_candidates: 1,
      stages: { X: "open" },
    });
    await flush();
    expect(readyIndex()).toBe(settled);
    expect(settled.config.roadmap).toBe("roadmap.md");
    expect(settled.refused).toBe(false);
  });

  it("discards a superseded build that lands first, too", async () => {
    store().ensure("");
    await flush();
    const first = take(STREAM);
    store().rescan("");
    await flush();
    const second = take(STREAM);
    answerStream(first, { "other.md": "---\nstatus: draft\n---\n" });
    await flush();
    expect(load().status).toBe("loading");
    answerStream(second);
    await flush();
    expect(paths()).not.toContain("other.md");
  });
});

/**
 * A scanner client the test drives by hand: it records each build and
 * cancel, and reports only what the test tells it to. It is how the store's
 * own guards are seen, apart from the scanner's, which already stops a build
 * that a later one of its repository supersedes.
 */
function handScanner() {
  const builds: {
    request: Parameters<ScannerClient["build"]>[0];
    on: (event: BuildEvent) => void;
  }[] = [];
  const cancels: [string, number][] = [];
  const scanner: ScannerClient = {
    build: (request, on) => builds.push({ request, on }),
    cancel: (repo, seq) => cancels.push([repo, seq]),
    refresh: async () => null,
    cards: async () => [],
    quotes: async () => ({}),
  };
  setPlanningScannerForTests(scanner);
  return { builds, cancels };
}

/** What a scanner reports for a whole build of `tree`. */
function eventsOf(tree: Record<string, string>): BuildEvent[] {
  const { entries } = scannedOf(tree);
  return [
    { type: "started", warm: false },
    {
      type: "header",
      config: planningConfig(),
      candidateCount: entries.length,
      refused: false,
    },
    {
      type: "documents",
      docs: entries.flatMap(({ hash, result }) =>
        result.kind === "planning" ? [{ document: result.document, hash }] : [],
      ),
      unreadable: [],
      skipped: [],
    },
    { type: "ready" },
  ];
}

describe("the store's own guards, whatever the scanner reports", () => {
  it("cancels the build a rescan supersedes", () => {
    const hand = handScanner();
    store().ensure("");
    store().rescan("");
    expect(hand.cancels).toEqual([["", 1]]);
    expect(hand.builds.map((b) => b.request)).toEqual([
      { repo: "", seq: 1, bypassCache: false },
      { repo: "", seq: 2, bypassCache: false },
    ]);
  });

  it("discards whatever a superseded build still reports", () => {
    const hand = handScanner();
    store().ensure("");
    store().rescan("");
    const [first, second] = hand.builds;
    act(() => eventsOf(TREE).forEach((event) => second?.on(event)));
    const settled = readyLoad();
    expect(settled.index).toEqual(buildPlanningIndex(sourcesOf(TREE)));

    act(() => {
      first?.on({
        type: "header",
        config: planningConfig({ roadmap: "elsewhere.md" }),
        candidateCount: 9999,
        refused: true,
      });
      first?.on({ type: "ready" });
      first?.on({ type: "failed", message: "late", shape: false });
    });
    expect(load()).toBe(settled);
  });

  it("reads a ready with no header before it as no planning index", () => {
    const hand = handScanner();
    store().ensure("");
    act(() => hand.builds[0]?.on({ type: "ready" }));
    expect(load()).toEqual({ status: "error", message: SHAPE_MESSAGE });
  });
});

/* ------------------------------------------------------------------ *
 * Rescans
 * ------------------------------------------------------------------ */

describe("rescans", () => {
  it("rescans on a .vantage.toml push, keeping the ready index until the build lands", async () => {
    await readyWith();
    const shown = readyIndex();
    // The config push exists once the server names the root `.vantage.toml`;
    // this is that message, synthesized.
    store().noteFilesChanged("", [".vantage.toml", "docs/design.md"], []);
    await flush();
    expect(requests.map((r) => r.url)).toEqual([STREAM]);
    const during = load();
    expect(during).toMatchObject({ status: "ready", rescanning: true });
    if (during.status !== "ready") throw new Error("not ready");
    expect(during.index).toBe(shown);

    const kept = Object.fromEntries(
      Object.entries(TREE).filter(([path]) => !path.startsWith("docs/old/")),
    );
    answerStream(take(STREAM), kept, {
      config: { exclude: ["docs/old/**"] },
    });
    await flush();
    expect(load()).toMatchObject({ status: "ready", rescanning: false });
    expect(readyIndex().config.exclude).toEqual(["docs/old/**"]);
    expect(paths()).not.toContain("docs/old/legacy.md");
  });

  it("rescans with the scan cache: every file it holds goes as `have`", async () => {
    await readyWith();
    await client.idle();
    store().noteFilesChanged("", [".vantage.toml"], []);
    await flush();
    expect(Object.keys(haveOf(requests[0]!)).sort()).toEqual([
      "docs/design.md",
      "docs/old/legacy.md",
      "docs/plain.md",
    ]);
  });

  it("gives error when a rescan fails", async () => {
    await readyWith();
    store().rescan("");
    await flush();
    take(STREAM).fail();
    await flush();
    expect(load().status).toBe("error");
  });

  it("noteReconnect rescans a ready index and keeps it shown", async () => {
    await readyWith();
    store().noteReconnect();
    await flush();
    expect(requests.map((r) => r.url)).toEqual([STREAM]);
    expect(load()).toMatchObject({ status: "ready", rescanning: true });
  });

  it("noteReconnect does nothing for an idle, loading or failed index", async () => {
    store().noteReconnect();
    await flush();
    expect(requests).toEqual([]);

    store().ensure("");
    await flush();
    expect(requests).toHaveLength(1);
    store().noteReconnect();
    await flush();
    expect(requests).toHaveLength(1);

    take(STREAM).fail();
    await flush();
    store().noteReconnect();
    await flush();
    expect(requests).toEqual([]);
  });
});

describe("review epochs", () => {
  it("counts review_changed pushes per repository and document", () => {
    store().noteReviewChanged("", "docs/design.md");
    store().noteReviewChanged("", "docs/design.md");
    store().noteReviewChanged("alpha", "docs/design.md");
    expect(store().reviewEpoch).toEqual({
      "\ndocs/design.md": 2,
      "alpha\ndocs/design.md": 1,
    });
  });
});

describe("usePlanningIndex", () => {
  it("ensures the current repository on mount, once the repos load", async () => {
    useRepoStore.setState({ reposLoaded: false });
    const { result } = renderHook(() => usePlanningIndex());
    await flush();
    expect(result.current.status).toBe("idle");
    expect(requests).toEqual([]);

    act(() => useRepoStore.setState({ reposLoaded: true }));
    expect(result.current.status).toBe("loading");
    await flush();
    expect(requests.map((r) => r.url)).toEqual([STREAM]);

    answerStream(take(STREAM));
    await flush();
    expect(result.current.status).toBe("ready");
  });

  it("follows the current repository in daemon mode", async () => {
    useRepoStore.setState({ isMultiRepo: true, currentRepo: null });
    const { result } = renderHook(() => usePlanningIndex());
    await flush();
    expect(requests).toEqual([]);
    act(() => useRepoStore.setState({ currentRepo: "alpha" }));
    expect(result.current.status).toBe("loading");
    await flush();
    expect(requests.map((r) => r.url)).toEqual([
      "/api/r/alpha/planning/stream",
    ]);
    act(() => useRepoStore.setState({ currentRepo: "beta" }));
    await flush();
    expect(requests.map((r) => r.url)).toEqual([
      "/api/r/alpha/planning/stream",
      "/api/r/beta/planning/stream",
    ]);
  });
});
