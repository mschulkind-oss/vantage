/**
 * The planning index as a whole: the batch it is built from, the limits, and
 * the per-path updates that keep it fresh (`docs/design/planning-index.md`
 * §3.4–§3.6, and the rules the plan's shared contracts spell out).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLANNING_CONFIG,
  applyScanned,
  applySource,
  buildPlanningIndex,
  findDocument,
  parsePlanningSources,
  parseSourceEntry,
  planningIndexBuilder,
  withoutDirectory,
  type PlanningIndex,
  type PlanningSources,
} from "vantage-md/planning";
import {
  contentHash,
  indexOf,
  planningConfig,
  readRepoFile,
  scannedOf,
  sourcesOf,
} from "../test/planning";

const DRAFT = "---\nstatus: draft\n---\n\n# A\n";
const PLAIN = "# Not planning\n";
const BROKEN = "---\nstatus: [draft\n---\n";

/** The batch endpoint's example body, from the plan's shared contracts. */
const ENDPOINT_EXAMPLE = {
  config: {
    roadmap: "roadmap.md",
    include: ["**/*.md"],
    exclude: ["docs/gallery/**"],
    max_file_bytes: 1048576,
    max_candidates: 5000,
    stages: { DECIDED: "ready", DESIGN: "open" },
  },
  candidate_count: 55,
  refused: false,
  files: [{ path: "docs/design/planning-index.md", content: "---\ntitle: x" }],
  skipped: [{ path: "docs/huge.md", size: 2097152 }],
  unreadable: [{ path: "docs/latin1.md", reason: "not UTF-8" }],
};

describe("parsePlanningSources", () => {
  it("maps the endpoint's body field by field", () => {
    expect(parsePlanningSources(ENDPOINT_EXAMPLE)).toEqual({
      config: {
        roadmap: "roadmap.md",
        include: ["**/*.md"],
        exclude: ["docs/gallery/**"],
        maxFileBytes: 1048576,
        maxCandidates: 5000,
        stages: { DECIDED: "ready", DESIGN: "open" },
      },
      candidateCount: 55,
      refused: false,
      files: [
        { path: "docs/design/planning-index.md", content: "---\ntitle: x" },
      ],
      skipped: [{ path: "docs/huge.md", size: 2097152 }],
      unreadable: [{ path: "docs/latin1.md", reason: "not UTF-8" }],
    });
  });

  it("reads undeclared stages, and an empty table, as no stages", () => {
    for (const stages of [null, {}]) {
      const parsed = parsePlanningSources({
        ...ENDPOINT_EXAMPLE,
        config: { ...ENDPOINT_EXAMPLE.config, stages },
      });
      expect(parsed?.config.stages).toBeNull();
    }
  });

  // The server keeps any word; assigning `__proto__` would drop it and leave
  // a declared-but-empty table, which cannot exist (§9).
  it("keeps a stage word spelled __proto__", () => {
    const parsed = parsePlanningSources(
      JSON.parse(
        JSON.stringify({
          ...ENDPOINT_EXAMPLE,
          config: { ...ENDPOINT_EXAMPLE.config, stages: {} },
        }).replace('"stages":{}', '"stages":{"__proto__":"open"}'),
      ),
    );
    expect(Object.keys(parsed?.config.stages ?? {})).toEqual(["__proto__"]);
    expect(Object.hasOwn(parsed?.config.stages ?? {}, "__proto__")).toBe(true);
  });

  it.each([
    ["the static host's index.html", "<!doctype html><html></html>"],
    ["null", null],
    ["a body without files", { ...ENDPOINT_EXAMPLE, files: undefined }],
    ["a body without config", { ...ENDPOINT_EXAMPLE, config: undefined }],
    ["files as null", { ...ENDPOINT_EXAMPLE, files: null }],
    [
      "a role outside the four",
      {
        ...ENDPOINT_EXAMPLE,
        config: { ...ENDPOINT_EXAMPLE.config, stages: { X: "shipped" } },
      },
    ],
    [
      "a file without content",
      { ...ENDPOINT_EXAMPLE, files: [{ path: "a.md" }] },
    ],
    [
      "a count that is not a number",
      { ...ENDPOINT_EXAMPLE, candidate_count: "55" },
    ],
  ])("refuses %s", (_, body) => {
    expect(parsePlanningSources(body)).toBeNull();
  });
});

describe("parseSourceEntry", () => {
  it.each([
    [
      { path: "docs/x.md", kind: "file", content: "…" },
      { kind: "file", path: "docs/x.md", content: "…" },
    ],
    [
      { path: "docs/huge.md", kind: "skipped", size: 2097152 },
      { kind: "skipped", path: "docs/huge.md", size: 2097152 },
    ],
    [
      {
        path: "docs/locked.md",
        kind: "unreadable",
        reason: "permission denied",
      },
      {
        kind: "unreadable",
        path: "docs/locked.md",
        reason: "permission denied",
      },
    ],
    [
      { path: ".github/pull_request_template.md", kind: "absent" },
      { kind: "absent", path: ".github/pull_request_template.md" },
    ],
  ])("reads %j", (body, entry) => {
    expect(parseSourceEntry(body)).toEqual(entry);
  });

  it.each([
    ["an unknown kind", { path: "a.md", kind: "moved" }],
    ["a file without content", { path: "a.md", kind: "file" }],
    ["no path", { kind: "absent" }],
    ["html", "<!doctype html>"],
  ])("refuses %s", (_, body) => {
    expect(parseSourceEntry(body)).toBeNull();
  });
});

describe("buildPlanningIndex", () => {
  it("keeps planning documents, drops the rest, and sorts by path", () => {
    const index = indexOf({
      "b.md": DRAFT,
      "plain.md": PLAIN,
      "a.md": DRAFT,
    });
    expect(index.documents.map((d) => d.path)).toEqual(["a.md", "b.md"]);
    expect(index.unreadable).toEqual([]);
  });

  it("lists the server's read failures with the files whose header does not parse", () => {
    const index = buildPlanningIndex(
      sourcesOf(
        { "z-broken.md": BROKEN },
        { unreadable: [{ path: "m-latin1.md", reason: "not UTF-8" }] },
      ),
    );
    expect(index.unreadable.map((u) => u.path)).toEqual([
      "m-latin1.md",
      "z-broken.md",
    ]);
    expect(index.unreadable[1]?.reason).toContain("does not parse");
  });

  it("carries skipped files through, sorted", () => {
    const skipped = [
      { path: "z.md", size: 3_000_000 },
      { path: "a.md", size: 2_000_000 },
    ];
    const index = buildPlanningIndex(sourcesOf({}, { skipped }));
    expect(index.skipped).toEqual([skipped[1], skipped[0]]);
  });

  it("makes the roadmap a document even with nothing in it, and only the roadmap", () => {
    const index = indexOf(
      { "plans/ROADMAP.md": PLAIN, "roadmap.md": PLAIN },
      { roadmap: "plans/ROADMAP.md" },
    );
    expect(index.documents.map((d) => d.path)).toEqual(["plans/ROADMAP.md"]);
  });

  it("scans at max-candidates and refuses one past it (§3.5)", () => {
    const tree = { "a.md": DRAFT, "b.md": DRAFT };
    const at = buildPlanningIndex(sourcesOf(tree, {}, { maxCandidates: 2 }));
    expect(at.refused).toBe(false);
    expect(at.documents).toHaveLength(2);

    const over = buildPlanningIndex(
      sourcesOf(tree, { candidateCount: 3 }, { maxCandidates: 2 }),
    );
    expect(over).toMatchObject({
      refused: true,
      candidateCount: 3,
      documents: [],
      skipped: [],
      unreadable: [],
    });
  });

  it("holds nothing when the batch says it was refused", () => {
    const index = buildPlanningIndex(
      sourcesOf(
        {},
        {
          refused: true,
          candidateCount: 6000,
          skipped: [{ path: "a.md", size: 1 }],
        },
      ),
    );
    expect(index).toEqual({
      config: DEFAULT_PLANNING_CONFIG,
      candidateCount: 6000,
      refused: true,
      documents: [],
      skipped: [],
      unreadable: [],
    });
  });
});

describe("planningIndexBuilder", () => {
  /** A tree with every kind of file in it, the roadmap and real documents. */
  const TREE = {
    "b.md": DRAFT,
    "plain.md": PLAIN,
    "a.md": DRAFT,
    "z-broken.md": BROKEN,
    "roadmap.md": PLAIN,
    "docs/gallery/open-questions.md": readRepoFile(
      "docs/gallery/open-questions.md",
    ),
    "docs/design/agent-bootstrap.md": readRepoFile(
      "docs/design/agent-bootstrap.md",
    ),
  };
  const SERVER: Partial<PlanningSources> = {
    skipped: [{ path: "huge.md", size: 3_000_000 }],
    unreadable: [{ path: "m-latin1.md", reason: "not UTF-8" }],
  };
  /** The batch of `TREE` with no files in it: the builder is given those. */
  const header = (overrides: Partial<PlanningSources> = {}) => ({
    ...sourcesOf(TREE, { ...SERVER, ...overrides }),
    files: [],
  });

  it("builds from results scanned elsewhere the index a batch builds", () => {
    const builder = planningIndexBuilder(header());
    // In any order: the lists are sorted once, at the end.
    for (const { path, result } of scannedOf(TREE).entries.reverse()) {
      builder.addResult(path, result);
    }
    expect(builder.finish()).toEqual(
      buildPlanningIndex(sourcesOf(TREE, SERVER)),
    );
  });

  it("returns the document of a planning result, and nothing for the rest", () => {
    const builder = planningIndexBuilder(header());
    const added = scannedOf(TREE).entries.map(({ path, result }) => [
      path,
      builder.addResult(path, result)?.path ?? null,
    ]);
    expect(added).toEqual([
      ["a.md", "a.md"],
      ["b.md", "b.md"],
      ["docs/design/agent-bootstrap.md", "docs/design/agent-bootstrap.md"],
      ["docs/gallery/open-questions.md", "docs/gallery/open-questions.md"],
      ["plain.md", null],
      ["roadmap.md", "roadmap.md"],
      ["z-broken.md", null],
    ]);
  });

  it("takes each kind of scanned answer into its own list", () => {
    const builder = planningIndexBuilder(
      header({ skipped: [], unreadable: [] }),
    );
    for (const entry of scannedOf(TREE).entries) builder.addScanned(entry);
    builder.addScanned({
      kind: "unreadable",
      path: "m-latin1.md",
      reason: "not UTF-8",
    });
    builder.addScanned({ kind: "skipped", path: "huge.md", size: 3_000_000 });
    builder.addScanned({ kind: "absent", path: "gone.md" });
    expect(builder.finish()).toEqual(
      buildPlanningIndex(sourcesOf(TREE, SERVER)),
    );
  });

  it("takes nothing once refused, whatever it is given", () => {
    const builder = planningIndexBuilder(
      header({ refused: true, candidateCount: 6000 }),
    );
    const [first] = scannedOf({ "a.md": DRAFT }).entries;
    if (first === undefined) throw new Error("no entry");
    expect(builder.addResult(first.path, first.result)).toBeNull();
    expect(builder.addScanned(first)).toBeNull();
    builder.addScanned({ kind: "skipped", path: "huge.md", size: 9 });
    builder.addScanned({ kind: "unreadable", path: "x.md", reason: "no" });
    expect(builder.finish()).toMatchObject({
      refused: true,
      documents: [],
      skipped: [],
      unreadable: [],
    });
  });
});

describe("applyScanned (§3.4)", () => {
  const base = (): PlanningIndex =>
    buildPlanningIndex(
      sourcesOf(
        { "a.md": DRAFT, "c.md": DRAFT },
        {
          candidateCount: 9,
          skipped: [{ path: "big.md", size: 2_000_000 }],
          unreadable: [{ path: "locked.md", reason: "permission denied" }],
        },
      ),
    );

  /** `path` holding `content`, scanned as the scan worker scans it. */
  const scannedFile = (path: string, content: string) => {
    const [entry] = scannedOf({ [path]: content }).entries;
    if (entry === undefined) throw new Error("no entry");
    return entry;
  };

  it.each([
    ["a new planning document", "b.md", DRAFT],
    ["a document that is no longer planning", "a.md", PLAIN],
    ["a document whose header stops parsing", "a.md", BROKEN],
    ["a skipped file that now reads", "big.md", DRAFT],
    ["an unreadable file that now reads", "locked.md", DRAFT],
    ["the roadmap, whatever it holds", "roadmap.md", PLAIN],
  ])("applies %s as applySource applies its text", (_, path, content) => {
    expect(applyScanned(base(), scannedFile(path, content))).toEqual(
      applySource(base(), { kind: "file", path, content }),
    );
  });

  it("files a skipped or unreadable answer where it belongs", () => {
    let next = applyScanned(base(), { kind: "skipped", path: "a.md", size: 5 });
    next = applyScanned(next, {
      kind: "unreadable",
      path: "c.md",
      reason: "gone",
    });
    expect(next.documents).toEqual([]);
    expect(next.skipped.map((s) => s.path)).toEqual(["a.md", "big.md"]);
    expect(next.unreadable.map((u) => u.path)).toEqual(["c.md", "locked.md"]);
  });

  // The store's per-row selectors depend on it: every pushed Markdown path is
  // asked about, and a save that changes nothing must not read as a new index.
  it("returns the index itself when the answer changes nothing", () => {
    const index = base();
    expect(applyScanned(index, scannedFile("notes.md", PLAIN))).toBe(index);
    expect(applyScanned(index, { kind: "absent", path: "gone.md" })).toBe(
      index,
    );
  });

  it("returns a refused index unchanged", () => {
    const refused = buildPlanningIndex(
      sourcesOf({}, { refused: true, candidateCount: 6000 }),
    );
    expect(applyScanned(refused, scannedFile("a.md", DRAFT))).toBe(refused);
  });

  it("reads nothing from the hash", () => {
    const entry = scannedFile("b.md", DRAFT);
    // SHA-256 of "test" opens 9f86d081…, cut to its first 128 bits.
    expect(contentHash("test")).toBe("9f86d081884c7d659a2feaa0c55ad015");
    expect(entry.hash).toBe(contentHash(DRAFT));
    expect(applyScanned(base(), { ...entry, hash: "0".repeat(32) })).toEqual(
      applyScanned(base(), entry),
    );
  });

  it("leaves its argument alone", () => {
    const index = base();
    const before = JSON.stringify(index);
    applyScanned(index, scannedFile("a.md", PLAIN));
    applyScanned(index, { kind: "absent", path: "c.md" });
    expect(JSON.stringify(index)).toBe(before);
  });
});

describe("applySource (§3.4)", () => {
  const base = (): PlanningIndex =>
    buildPlanningIndex(
      sourcesOf(
        { "a.md": DRAFT, "c.md": DRAFT },
        {
          candidateCount: 9,
          skipped: [{ path: "big.md", size: 2_000_000 }],
          unreadable: [{ path: "locked.md", reason: "permission denied" }],
        },
      ),
    );

  it("returns a refused index unchanged", () => {
    const refused = buildPlanningIndex(
      sourcesOf({}, { refused: true, candidateCount: 6000 }),
    );
    expect(
      applySource(refused, { kind: "file", path: "a.md", content: DRAFT }),
    ).toBe(refused);
  });

  it("adds a new planning document in path order", () => {
    const next = applySource(base(), {
      kind: "file",
      path: "b.md",
      content: DRAFT,
    });
    expect(next.documents.map((d) => d.path)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("drops a document that is no longer planning", () => {
    const next = applySource(base(), {
      kind: "file",
      path: "a.md",
      content: PLAIN,
    });
    expect(next.documents.map((d) => d.path)).toEqual(["c.md"]);
  });

  it("moves a rescanned path out of skipped and unreadable", () => {
    let next = applySource(base(), {
      kind: "file",
      path: "big.md",
      content: DRAFT,
    });
    next = applySource(next, {
      kind: "file",
      path: "locked.md",
      content: DRAFT,
    });
    expect(next.skipped).toEqual([]);
    expect(next.unreadable).toEqual([]);
    expect(next.documents.map((d) => d.path)).toEqual([
      "a.md",
      "big.md",
      "c.md",
      "locked.md",
    ]);
  });

  it("sends a file whose header stops parsing to unreadable", () => {
    const next = applySource(base(), {
      kind: "file",
      path: "a.md",
      content: BROKEN,
    });
    expect(next.documents.map((d) => d.path)).toEqual(["c.md"]);
    expect(next.unreadable.map((u) => u.path)).toEqual(["a.md", "locked.md"]);
  });

  it("files a skipped or unreadable answer where it belongs", () => {
    let next = applySource(base(), { kind: "skipped", path: "a.md", size: 5 });
    next = applySource(next, {
      kind: "unreadable",
      path: "c.md",
      reason: "gone",
    });
    expect(next.documents).toEqual([]);
    expect(next.skipped.map((s) => s.path)).toEqual(["a.md", "big.md"]);
    expect(next.unreadable.map((u) => u.path)).toEqual(["c.md", "locked.md"]);
  });

  it("takes an absent path out of every list", () => {
    let next = base();
    for (const path of ["a.md", "big.md", "locked.md"]) {
      next = applySource(next, { kind: "absent", path });
    }
    expect(next.documents.map((d) => d.path)).toEqual(["c.md"]);
    expect(next.skipped).toEqual([]);
    expect(next.unreadable).toEqual([]);
  });

  it("never moves the candidate count or the refusal", () => {
    const next = applySource(base(), {
      kind: "file",
      path: "new.md",
      content: DRAFT,
    });
    expect(next.candidateCount).toBe(9);
    expect(next.refused).toBe(false);
  });

  it("decides the roadmap from the path, not from the caller", () => {
    const index = buildPlanningIndex(sourcesOf({}));
    const roadmap = applySource(index, {
      kind: "file",
      path: "roadmap.md",
      content: PLAIN,
    });
    const other = applySource(index, {
      kind: "file",
      path: "notes.md",
      content: PLAIN,
    });
    expect(roadmap.documents.map((d) => d.path)).toEqual(["roadmap.md"]);
    expect(other.documents).toEqual([]);
  });

  // Every pushed Markdown path is asked about, planning or not, so an answer
  // that changes nothing must say so, or every save re-renders the page.
  it("returns the index itself when the answer changes nothing", () => {
    const index = base();
    expect(
      applySource(index, { kind: "file", path: "notes.md", content: PLAIN }),
    ).toBe(index);
    expect(applySource(index, { kind: "absent", path: "gone.md" })).toBe(index);
  });

  it("keeps the lists the answer does not touch", () => {
    const index = base();
    const next = applySource(index, {
      kind: "file",
      path: "b.md",
      content: DRAFT,
    });
    expect(next.skipped).toBe(index.skipped);
    expect(next.unreadable).toBe(index.unreadable);
  });

  it("leaves its argument alone", () => {
    const index = base();
    const before = JSON.stringify(index);
    applySource(index, { kind: "absent", path: "a.md" });
    expect(JSON.stringify(index)).toBe(before);
  });
});

describe("withoutDirectory", () => {
  const index = buildPlanningIndex(
    sourcesOf(
      { "docs/a/x.md": DRAFT, "docs/ab.md": DRAFT, "docs/a.md": DRAFT },
      {
        skipped: [{ path: "docs/a/big.md", size: 9 }],
        unreadable: [{ path: "docs/a/sub/locked.md", reason: "no" }],
      },
    ),
  );

  it("drops everything under the directory and nothing beside it", () => {
    const next = withoutDirectory(index, "docs/a");
    expect(next.documents.map((d) => d.path)).toEqual([
      "docs/a.md",
      "docs/ab.md",
    ]);
    expect(next.skipped).toEqual([]);
    expect(next.unreadable).toEqual([]);
  });

  it("reads a trailing slash the same way", () => {
    expect(withoutDirectory(index, "docs/a/")).toEqual(
      withoutDirectory(index, "docs/a"),
    );
  });

  it("returns a refused index unchanged", () => {
    const refused = buildPlanningIndex(sourcesOf({}, { refused: true }));
    expect(withoutDirectory(refused, "docs")).toBe(refused);
  });
});

describe("findDocument", () => {
  it("finds a document by path, and nothing for any other path", () => {
    const tree = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [
        `d/${String(i).padStart(2, "0")}.md`,
        DRAFT,
      ]),
    );
    const index = indexOf(tree);
    for (const path of Object.keys(tree)) {
      expect(findDocument(index, path)?.path).toBe(path);
    }
    expect(findDocument(index, "d/99.md")).toBeUndefined();
    expect(findDocument(index, "")).toBeUndefined();
  });

  it("holds the config the batch carried", () => {
    const index = indexOf({}, { exclude: ["docs/gallery/**"] });
    expect(index.config).toEqual(
      planningConfig({ exclude: ["docs/gallery/**"] }),
    );
  });
});
