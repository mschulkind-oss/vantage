/**
 * The viewer's planning index (`docs/design/planning-index.md` §3.4, §3.6): the
 * batch, the per-file refresh through the endpoint's single-path mode, the
 * numbering that decides which answer wins, and the rescans.
 *
 * The endpoint is mocked at axios, one deferred answer per request, so every
 * race is written out in the order the test resolves them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import axios from "axios";
import {
  buildPlanningIndex,
  findDocument,
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
import { sourcesOf } from "../test/planning";

vi.mock("axios");

/* ------------------------------------------------------------------ *
 * A fake endpoint: every GET waits until the test answers it.
 * ------------------------------------------------------------------ */

interface Request {
  url: string;
  answer(data: unknown): void;
  fail(error?: unknown): void;
}

let requests: Request[] = [];

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

const BATCH = "/api/planning/sources";
const one = (path: string, base = "/api") =>
  `${base}/planning/sources?path=${encodeURIComponent(path)}`;

/** Let every answered request run through the store's async chain. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
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
const TREE: Record<string, string> = {
  "roadmap.md": "# Roadmap\n\n1. [Design](docs/design.md)\n",
  "docs/design.md": DESIGN,
  "docs/old/legacy.md": "---\nstatus: draft\n---\n\n# Legacy\n",
  "docs/plain.md": "# Plain\n",
};

/** The batch body as the server sends it: snake_case. */
function batchBody(
  tree: Record<string, string> = TREE,
  overrides: Record<string, unknown> = {},
) {
  return {
    config: {
      roadmap: "roadmap.md",
      include: ["**/*.md"],
      exclude: [],
      max_file_bytes: 1048576,
      max_candidates: 5000,
      stages: null,
    },
    candidate_count: Object.keys(tree).length,
    refused: false,
    files: Object.entries(tree).map(([path, content]) => ({ path, content })),
    skipped: [],
    unreadable: [],
    ...overrides,
  };
}

const load = (repo = ""): PlanningLoad =>
  usePlanningStore.getState().byRepo[repo] ?? PLANNING_IDLE;

function readyIndex(repo = ""): PlanningIndex {
  const current = load(repo);
  if (current.status !== "ready") {
    throw new Error(`expected a ready index, got ${current.status}`);
  }
  return current.index;
}

const paths = (repo = "") => readyIndex(repo).documents.map((d) => d.path);
const store = () => usePlanningStore.getState();

/** Ensure the single repo and land the batch. */
async function readyWith(tree: Record<string, string> = TREE): Promise<void> {
  store().ensure("");
  take(BATCH).answer(batchBody(tree));
  await flush();
  expect(load().status).toBe("ready");
}

beforeEach(() => {
  requests = [];
  vi.mocked(axios.get).mockImplementation(
    (url: string) =>
      new Promise((resolve, reject) => {
        requests.push({
          url,
          answer: (data) => resolve({ data }),
          fail: (error = new Error("Network Error")) => reject(error),
        });
      }),
  );
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
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * The batch
 * ------------------------------------------------------------------ */

describe("the batch (§3.4, full scan)", () => {
  it("fills the index, and holds each planning document's text", async () => {
    await readyWith();
    const current = load();
    if (current.status !== "ready") throw new Error("not ready");
    expect(current.rescanning).toBe(false);
    expect(paths()).toEqual([
      "docs/design.md",
      "docs/old/legacy.md",
      "roadmap.md",
    ]);
    expect(current.sources).toEqual({
      "docs/design.md": DESIGN,
      "docs/old/legacy.md": TREE["docs/old/legacy.md"],
      "roadmap.md": TREE["roadmap.md"],
    });
  });

  it("builds the index buildPlanningIndex builds from the same batch", async () => {
    const tree = {
      ...TREE,
      "docs/broken.md": "---\nstatus: [unterminated\n---\n",
    };
    await readyWith(tree);
    const expected = buildPlanningIndex(
      sourcesOf(tree, { unreadable: [{ path: "a.md", reason: "not UTF-8" }] }),
    );
    store().rescan("");
    take(BATCH).answer(
      batchBody(tree, {
        unreadable: [{ path: "a.md", reason: "not UTF-8" }],
      }),
    );
    await flush();
    expect(readyIndex()).toEqual(expected);
  });

  it("is started once, however often it is ensured", async () => {
    store().ensure("");
    store().ensure("");
    expect(requests.map((r) => r.url)).toEqual([BATCH]);
    expect(load().status).toBe("loading");
    take(BATCH).answer(batchBody());
    await flush();
    store().ensure("");
    expect(requests).toEqual([]);
  });

  it("waits for the repo store, and in daemon mode for a repository", () => {
    useRepoStore.setState({ reposLoaded: false });
    store().ensure("");
    expect(requests).toEqual([]);
    expect(load().status).toBe("idle");

    useRepoStore.setState({ reposLoaded: true, isMultiRepo: true });
    store().ensure("");
    expect(requests).toEqual([]);

    store().ensure("alpha");
    expect(requests.map((r) => r.url)).toEqual([
      "/api/r/alpha/planning/sources",
    ]);
  });

  it("logs the time to ready once", async () => {
    await readyWith();
    store().rescan("");
    take(BATCH).answer(batchBody());
    await flush();
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.info).mock.calls[0][0]).toContain(
      "[planning] index ready in",
    );
  });

  it("carries a refusal through with no documents", async () => {
    store().ensure("");
    take(BATCH).answer(
      batchBody(
        {},
        { refused: true, candidate_count: 6000, files: [], skipped: [] },
      ),
    );
    await flush();
    expect(readyIndex()).toMatchObject({
      refused: true,
      candidateCount: 6000,
      documents: [],
    });
  });
});

describe("failure (§3.6)", () => {
  it("gives error when the batch fails", async () => {
    store().ensure("");
    take(BATCH).fail();
    await flush();
    expect(load()).toEqual({
      status: "error",
      message: "Could not load the planning index: Network Error",
    });
  });

  it("gives error for a body of any other shape, such as index.html", async () => {
    store().ensure("");
    take(BATCH).answer("<!doctype html><html></html>");
    await flush();
    expect(load()).toEqual({ status: "error", message: SHAPE_MESSAGE });
  });

  it("gives error at once in a static export, with no request", () => {
    window.__VANTAGE_STATIC__ = true;
    store().ensure("");
    expect(requests).toEqual([]);
    expect(load()).toEqual({ status: "error", message: STATIC_MESSAGE });
    store().rescan("");
    expect(requests).toEqual([]);
    expect(load().status).toBe("error");
  });

  it("stays failed until a rescan: ensure does not retry", async () => {
    store().ensure("");
    take(BATCH).fail();
    await flush();
    store().ensure("");
    expect(requests).toEqual([]);
    store().rescan("");
    expect(load().status).toBe("loading");
    take(BATCH).answer(batchBody());
    await flush();
    expect(load().status).toBe("ready");
  });
});

/* ------------------------------------------------------------------ *
 * Per-file refresh
 * ------------------------------------------------------------------ */

describe("a pushed path (§3.4, incremental)", () => {
  it("re-scans a changed candidate from the single-path mode", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/design.md"], []);
    expect(requests.map((r) => r.url)).toEqual([one("docs/design.md")]);
    take(one("docs/design.md")).answer({
      path: "docs/design.md",
      kind: "file",
      content: DESIGN_ANSWERED,
    });
    await flush();
    const doc = findDocument(readyIndex(), "docs/design.md");
    expect(doc?.questions.map((q) => q.state)).toEqual(["answered"]);
    const current = load();
    if (current.status !== "ready") throw new Error("not ready");
    expect(current.sources["docs/design.md"]).toBe(DESIGN_ANSWERED);
  });

  it("bumps the version on every change", async () => {
    await readyWith();
    const before = load();
    store().noteFilesChanged("", ["docs/design.md"], []);
    take(one("docs/design.md")).answer({
      path: "docs/design.md",
      kind: "file",
      content: DESIGN_ANSWERED,
    });
    await flush();
    const after = load();
    if (before.status !== "ready" || after.status !== "ready") {
      throw new Error("not ready");
    }
    expect(after.version).toBeGreaterThan(before.version);
  });

  it("keeps the load, version included, when a save changes nothing", async () => {
    await readyWith();
    const before = load();
    store().noteFilesChanged("", ["docs/notes.md"], []);
    take(one("docs/notes.md")).answer({
      path: "docs/notes.md",
      kind: "file",
      content: "# Just notes\n",
    });
    await flush();
    expect(load()).toBe(before);
  });

  it("adds a new file the server answers as a file", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/new.md"], []);
    take(one("docs/new.md")).answer({
      path: "docs/new.md",
      kind: "file",
      content: "---\nstage: SKETCH\n---\n",
    });
    await flush();
    expect(paths()).toContain("docs/new.md");
  });

  it("never adds a path the server answers absent, whatever it holds", async () => {
    // `.github/x.md` is under a hidden directory the listing prunes. The
    // watcher pushes it anyway, and only the server can say it is no candidate.
    await readyWith();
    store().noteFilesChanged("", [".github/x.md"], []);
    take(one(".github/x.md")).answer({ path: ".github/x.md", kind: "absent" });
    await flush();
    expect(paths()).not.toContain(".github/x.md");
  });

  it("drops a deleted file", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/design.md"], []);
    take(one("docs/design.md")).answer({
      path: "docs/design.md",
      kind: "absent",
    });
    await flush();
    expect(paths()).not.toContain("docs/design.md");
    const current = load();
    if (current.status !== "ready") throw new Error("not ready");
    expect(current.sources).not.toHaveProperty("docs/design.md");
  });

  it("moves a file the server answers skipped to skipped", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/design.md"], []);
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
    take(one("docs/design.md")).fail();
    await flush();
    expect(readyIndex()).toBe(before);

    store().noteFilesChanged("", ["docs/design.md"], []);
    take(one("docs/design.md")).answer({
      path: "docs/design.md",
      kind: "absent",
    });
    await flush();
    expect(paths()).not.toContain("docs/design.md");
  });

  it("asks nothing for a path that cannot be a candidate", async () => {
    await readyWith();
    store().noteFilesChanged("", [".git/HEAD", "img/logo.png"], []);
    expect(requests).toEqual([]);
  });

  it("drops a removed directory's documents, and keeps its prefix's neighbors", async () => {
    await readyWith({ ...TREE, "docs/older.md": "---\nstatus: draft\n---\n" });
    store().noteFilesChanged("", [], ["docs/old"]);
    expect(requests).toEqual([]);
    expect(paths()).toEqual(["docs/design.md", "docs/older.md", "roadmap.md"]);
    const current = load();
    if (current.status !== "ready") throw new Error("not ready");
    expect(current.sources).not.toHaveProperty("docs/old/legacy.md");
  });

  it("ignores another repository's push", async () => {
    useRepoStore.setState({ isMultiRepo: true, currentRepo: "alpha" });
    store().ensure("alpha");
    take("/api/r/alpha/planning/sources").answer(batchBody());
    await flush();
    const before = readyIndex("alpha");
    store().noteFilesChanged("beta", ["docs/design.md"], ["docs"]);
    expect(requests).toEqual([]);
    expect(readyIndex("alpha")).toBe(before);
    expect(load("beta").status).toBe("idle");
  });

  it("asks the repository's own endpoint in daemon mode", async () => {
    useRepoStore.setState({ isMultiRepo: true, currentRepo: "alpha" });
    store().ensure("alpha");
    take("/api/r/alpha/planning/sources").answer(batchBody());
    await flush();
    store().noteFilesChanged("alpha", ["docs/design.md"], []);
    expect(requests.map((r) => r.url)).toEqual([
      one("docs/design.md", "/api/r/alpha"),
    ]);
  });

  it("does nothing for an index nobody has asked for", () => {
    store().noteFilesChanged("", ["docs/design.md"], []);
    expect(requests).toEqual([]);
    expect(load().status).toBe("idle");
  });
});

/* ------------------------------------------------------------------ *
 * Ordering
 * ------------------------------------------------------------------ */

describe("ordering (§3.4)", () => {
  const answered = {
    path: "docs/design.md",
    kind: "file",
    content: DESIGN_ANSWERED,
  };
  const gone = { path: "docs/design.md", kind: "absent" };

  it("lets the newer request win when the older answer lands last", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/design.md"], []);
    const older = take(one("docs/design.md"));
    store().noteFilesChanged("", ["docs/design.md"], []);
    const newer = take(one("docs/design.md"));
    newer.answer(answered);
    await flush();
    older.answer(gone);
    await flush();
    expect(
      findDocument(readyIndex(), "docs/design.md")?.questions[0].state,
    ).toBe("answered");
  });

  it("lets the newer request win when the older answer lands first", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/design.md"], []);
    const older = take(one("docs/design.md"));
    store().noteFilesChanged("", ["docs/design.md"], []);
    const newer = take(one("docs/design.md"));
    older.answer(gone);
    await flush();
    newer.answer(answered);
    await flush();
    expect(
      findDocument(readyIndex(), "docs/design.md")?.questions[0].state,
    ).toBe("answered");
  });

  it("lands a push made while loading on top of the batch", async () => {
    store().ensure("");
    const batch = take(BATCH);
    store().noteFilesChanged("", ["docs/design.md", "docs/new.md"], []);
    take(one("docs/design.md")).answer(answered);
    take(one("docs/new.md")).answer({
      path: "docs/new.md",
      kind: "file",
      content: "---\nstatus: draft\n---\n",
    });
    await flush();
    expect(load().status).toBe("loading");
    batch.answer(batchBody());
    await flush();
    expect(
      findDocument(readyIndex(), "docs/design.md")?.questions[0].state,
    ).toBe("answered");
    expect(paths()).toContain("docs/new.md");
  });

  it("applies a push's answer that lands after the batch it was newer than", async () => {
    store().ensure("");
    const batch = take(BATCH);
    store().noteFilesChanged("", ["docs/design.md"], []);
    const refresh = take(one("docs/design.md"));
    batch.answer(batchBody());
    await flush();
    expect(
      findDocument(readyIndex(), "docs/design.md")?.questions[0].state,
    ).toBe("open");
    refresh.answer(answered);
    await flush();
    expect(
      findDocument(readyIndex(), "docs/design.md")?.questions[0].state,
    ).toBe("answered");
  });

  it("discards an answer to a request older than the latest batch", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/design.md"], []);
    const stale = take(one("docs/design.md"));
    store().rescan("");
    take(BATCH).answer(batchBody());
    await flush();
    stale.answer(gone);
    await flush();
    expect(paths()).toContain("docs/design.md");
  });

  it("keeps a directory removed while loading out of the batch", async () => {
    store().ensure("");
    const batch = take(BATCH);
    store().noteFilesChanged("", [], ["docs/old"]);
    batch.answer(batchBody());
    await flush();
    expect(paths()).not.toContain("docs/old/legacy.md");
  });

  it("does not let an answer older than a removal bring its file back", async () => {
    await readyWith();
    store().noteFilesChanged("", ["docs/old/legacy.md"], []);
    const stale = take(one("docs/old/legacy.md"));
    store().noteFilesChanged("", [], ["docs/old"]);
    stale.answer({
      path: "docs/old/legacy.md",
      kind: "file",
      content: TREE["docs/old/legacy.md"],
    });
    await flush();
    expect(paths()).not.toContain("docs/old/legacy.md");
  });

  it("discards a batch superseded by a later rescan whole", async () => {
    store().ensure("");
    const first = take(BATCH);
    store().rescan("");
    const second = take(BATCH);
    second.answer(batchBody(TREE));
    await flush();
    const settled = readyIndex();
    first.answer(
      batchBody(
        { "other.md": "---\nstatus: draft\n---\n" },
        {
          refused: true,
          candidate_count: 9999,
          config: {
            roadmap: "elsewhere.md",
            include: [],
            exclude: [],
            max_file_bytes: 1,
            max_candidates: 1,
            stages: { X: "open" },
          },
        },
      ),
    );
    await flush();
    expect(readyIndex()).toBe(settled);
    expect(settled.config.roadmap).toBe("roadmap.md");
    expect(settled.refused).toBe(false);
  });

  it("discards a superseded batch that lands first, too", async () => {
    store().ensure("");
    const first = take(BATCH);
    store().rescan("");
    const second = take(BATCH);
    first.answer(batchBody({ "other.md": "---\nstatus: draft\n---\n" }));
    await flush();
    expect(load().status).toBe("loading");
    second.answer(batchBody());
    await flush();
    expect(paths()).not.toContain("other.md");
  });
});

/* ------------------------------------------------------------------ *
 * Rescans
 * ------------------------------------------------------------------ */

describe("rescans", () => {
  it("rescans on a .vantage.toml push, keeping the ready index until the batch lands", async () => {
    await readyWith();
    const shown = readyIndex();
    // The config push exists once the server names the root `.vantage.toml`;
    // this is that message, synthesized.
    store().noteFilesChanged("", [".vantage.toml", "docs/design.md"], []);
    expect(requests.map((r) => r.url)).toEqual([BATCH]);
    const during = load();
    expect(during).toMatchObject({ status: "ready", rescanning: true });
    if (during.status !== "ready") throw new Error("not ready");
    expect(during.index).toBe(shown);

    take(BATCH).answer(
      batchBody(TREE, {
        config: { ...batchBody().config, exclude: ["docs/old/**"] },
        files: Object.entries(TREE)
          .filter(([path]) => !path.startsWith("docs/old/"))
          .map(([path, content]) => ({ path, content })),
      }),
    );
    await flush();
    expect(load()).toMatchObject({ status: "ready", rescanning: false });
    expect(readyIndex().config.exclude).toEqual(["docs/old/**"]);
    expect(paths()).not.toContain("docs/old/legacy.md");
  });

  it("gives error when a rescan fails", async () => {
    await readyWith();
    store().rescan("");
    take(BATCH).fail();
    await flush();
    expect(load().status).toBe("error");
  });

  it("noteReconnect rescans a ready index and keeps it shown", async () => {
    await readyWith();
    store().noteReconnect();
    expect(requests.map((r) => r.url)).toEqual([BATCH]);
    expect(load()).toMatchObject({ status: "ready", rescanning: true });
  });

  it("noteReconnect does nothing for an idle, loading or failed index", async () => {
    store().noteReconnect();
    expect(requests).toEqual([]);

    store().ensure("");
    expect(requests).toHaveLength(1);
    store().noteReconnect();
    expect(requests).toHaveLength(1);

    take(BATCH).fail();
    await flush();
    store().noteReconnect();
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
    expect(result.current.status).toBe("idle");
    expect(requests).toEqual([]);

    act(() => useRepoStore.setState({ reposLoaded: true }));
    expect(requests.map((r) => r.url)).toEqual([BATCH]);
    expect(result.current.status).toBe("loading");

    take(BATCH).answer(batchBody());
    await flush();
    expect(result.current.status).toBe("ready");
  });

  it("follows the current repository in daemon mode", () => {
    useRepoStore.setState({ isMultiRepo: true, currentRepo: null });
    const { result } = renderHook(() => usePlanningIndex());
    expect(requests).toEqual([]);
    act(() => useRepoStore.setState({ currentRepo: "alpha" }));
    expect(requests.map((r) => r.url)).toEqual([
      "/api/r/alpha/planning/sources",
    ]);
    expect(result.current.status).toBe("loading");
    act(() => useRepoStore.setState({ currentRepo: "beta" }));
    expect(requests.map((r) => r.url)).toEqual([
      "/api/r/alpha/planning/sources",
      "/api/r/beta/planning/sources",
    ]);
  });
});
