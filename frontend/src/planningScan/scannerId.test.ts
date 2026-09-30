/**
 * The scanner id's Vite plugin (`docs/design/planning-index-at-scale.md`
 * §8.2): the source hash, the virtual module, the dev server's invalidation,
 * and the build guard over the worker's bundle.
 *
 * The hash is proven over a scratch tree of a few small files, never over a
 * copy of the repository.
 */
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SCANNER_ID_MODULE,
  isHashed,
  planningScannerId,
  scannerRoots,
  sourceHash,
  workerBundleProblems,
} from "./scannerId";
import { repoPath } from "../test/planning";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A repository root holding just the hashed roots, one small file each. */
function scratchRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "scanner-id-"));
  scratch.push(root);
  const write = (rel: string, text: string) => {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  write("packages/vantage-md/src/planning/scan.ts", "export const a = 1;\n");
  write("frontend/src/planningScan/core.ts", "export const b = 2;\n");
  write("frontend/src/planningScan/core.test.ts", "it('x', () => {});\n");
  write("frontend/src/other.ts", "export const c = 3;\n");
  write("package-lock.json", '{"lockfileVersion":3}\n');
  return root;
}

type Hook = ((...args: unknown[]) => unknown) | { handler: Hook };
const call = (hook: unknown, context: unknown, ...args: unknown[]) => {
  const fn = (
    typeof hook === "function" ? hook : (hook as { handler: Hook }).handler
  ) as (...a: unknown[]) => unknown;
  return fn.call(context, ...args);
};

describe("the source hash", () => {
  it("is 32 lowercase hex digits, and the same for the same files", () => {
    const root = scratchRepo();
    const hash = sourceHash(scannerRoots(root));
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(sourceHash(scannerRoots(root))).toBe(hash);
  });

  it("changes with any file under the roots, and with the lockfile", () => {
    const root = scratchRepo();
    const roots = scannerRoots(root);
    const before = sourceHash(roots);
    writeFileSync(
      path.join(root, "packages/vantage-md/src/planning/scan.ts"),
      "export const a = 2;\n",
    );
    const afterSource = sourceHash(roots);
    expect(afterSource).not.toBe(before);
    writeFileSync(path.join(root, "package-lock.json"), "{}\n");
    expect(sourceHash(roots)).not.toBe(afterSource);
  });

  it("keeps its value when a file outside the roots or a unit test changes", () => {
    const root = scratchRepo();
    const roots = scannerRoots(root);
    const before = sourceHash(roots);
    writeFileSync(path.join(root, "frontend/src/other.ts"), "changed\n");
    writeFileSync(
      path.join(root, "frontend/src/planningScan/core.test.ts"),
      "changed\n",
    );
    expect(sourceHash(roots)).toBe(before);
  });

  it("names the files it is computed from", () => {
    const roots = scannerRoots("/repo");
    expect(isHashed("/repo/packages/vantage-md/src/pipeline.ts", roots)).toBe(
      true,
    );
    expect(isHashed("/repo/frontend/src/planningScan/core.ts", roots)).toBe(
      true,
    );
    expect(isHashed("/repo/package-lock.json", roots)).toBe(true);
    expect(
      isHashed("/repo/frontend/src/planningScan/core.test.ts", roots),
    ).toBe(false);
    expect(isHashed("/repo/frontend/src/lib/utils.ts", roots)).toBe(false);
    expect(isHashed("/repo/packages/vantage-md/srcx/a.ts", roots)).toBe(false);
  });
});

describe("the build guard", () => {
  const roots = scannerRoots("/repo");
  const SOUND = [
    "/repo/frontend/src/planningScan/worker.ts",
    "/repo/frontend/src/planningScan/core.ts",
    "/repo/packages/vantage-md/src/planning/scan.ts",
    "/repo/packages/vantage-md/src/pipeline.ts",
    "/repo/node_modules/unified/lib/index.js",
    "/repo/node_modules/@types/x/index.js",
    "/repo/node_modules/remark-parse/node_modules/mdast/index.js",
    `\0${SCANNER_ID_MODULE}`,
    "\0rolldown/runtime.js",
  ];

  it("passes a bundle of the hashed roots and node_modules only", () => {
    expect(workerBundleProblems(SOUND, roots)).toEqual([]);
  });

  it("fails a bundle holding one module outside the hashed roots", () => {
    expect(
      workerBundleProblems(
        [...SOUND, "/repo/frontend/src/lib/utils.ts"],
        roots,
      ),
    ).toEqual([
      "/repo/frontend/src/lib/utils.ts: outside the files the scanner id hashes",
    ]);
  });

  it("fails a bundle holding a virtual module it does not know", () => {
    expect(
      workerBundleProblems([...SOUND, "\0other:thing"], roots),
    ).toHaveLength(1);
  });

  it("fails a bundle holding a package the scan never needs", () => {
    const problems = workerBundleProblems(
      [
        ...SOUND,
        "/repo/node_modules/katex/dist/katex.mjs",
        "/repo/node_modules/highlight.js/lib/core.js",
        "/repo/node_modules/rehype-katex/node_modules/katex/dist/katex.mjs",
      ],
      roots,
    );
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("never needs katex");
  });

  it("fails a module of the build's graph outside the roots, though no chunk renders it", () => {
    // A module whose one export is a constant, inlined into its importer.
    expect(
      workerBundleProblems(SOUND, roots, [
        ...SOUND,
        "/repo/frontend/src/constants.ts",
      ]),
    ).toEqual([
      "/repo/frontend/src/constants.ts: outside the files the scanner id hashes",
    ]);
  });

  it("passes a package the graph reaches and the bundle leaves out", () => {
    // As the scan's imports reach KaTeX through micromark-extension-math,
    // and tree-shaking drops it whole.
    expect(
      workerBundleProblems(SOUND, roots, [
        ...SOUND,
        "/repo/node_modules/micromark-extension-math/node_modules/katex/dist/katex.mjs",
        "/repo/node_modules/decode-named-character-reference/index.dom.js",
      ]),
    ).toEqual([]);
  });

  it("fails a bundle holding a package's DOM build", () => {
    expect(
      workerBundleProblems(
        [
          ...SOUND,
          "/repo/node_modules/decode-named-character-reference/index.dom.js",
        ],
        roots,
      ),
    ).toEqual([
      "/repo/node_modules/decode-named-character-reference/index.dom.js: a package's DOM build, which needs a document the worker does not have",
    ]);
  });

  /**
   * A plugin context over a build whose graph is `graph`: what
   * `generateBundle` reads besides the bundle, and how it fails a build.
   */
  const buildContext = (graph: string[]) => ({
    getModuleIds: () => graph[Symbol.iterator](),
    error: (message: string) => {
      throw new Error(message);
    },
  });

  it("fails the worker's build, and not the app's", () => {
    const plugin = planningScannerId({ repoRoot: "/repo", guard: true });
    const moduleIds = [...SOUND, "/repo/frontend/src/lib/utils.ts"];
    const bundle = {
      "worker.js": { type: "chunk", moduleIds },
      "worker.css": { type: "asset" },
    };
    const context = buildContext(moduleIds);
    expect(() =>
      call(plugin.generateBundle, context, {}, bundle, false),
    ).toThrow(/frontend\/src\/lib\/utils\.ts/);

    const app = planningScannerId({ repoRoot: "/repo" });
    expect(() =>
      call(app.generateBundle, context, {}, bundle, false),
    ).not.toThrow();
  });

  it("fails the worker's build over a module whose constant was inlined, which no chunk lists", () => {
    // `export const LIMIT = 7`, imported by a hashed module: Rolldown writes
    // the 7 into the importer and drops the module from `moduleIds`, so only
    // the build's graph still names it.
    const plugin = planningScannerId({ repoRoot: "/repo", guard: true });
    const bundle = { "worker.js": { type: "chunk", moduleIds: SOUND } };
    const graph = [...SOUND, "/repo/frontend/src/constants.ts"];
    expect(() =>
      call(plugin.generateBundle, buildContext(graph), {}, bundle, false),
    ).toThrow(
      /\/repo\/frontend\/src\/constants\.ts: outside the files the scanner id hashes/,
    );
    expect(() =>
      call(plugin.generateBundle, buildContext(SOUND), {}, bundle, false),
    ).not.toThrow();
  });

  it("passes the real roots' own files", () => {
    const real = scannerRoots(repoPath(""));
    expect(
      workerBundleProblems(
        [
          repoPath("frontend/src/planningScan/core.ts"),
          repoPath("packages/vantage-md/src/planning/index.ts"),
        ],
        real,
      ),
    ).toEqual([]);
  });
});

describe("the virtual module", () => {
  it("serves the source hash", () => {
    const root = scratchRepo();
    const plugin = planningScannerId({ repoRoot: root });
    const id = call(plugin.resolveId, {}, SCANNER_ID_MODULE) as string;
    expect(id).toBe(`\0${SCANNER_ID_MODULE}`);
    expect(call(plugin.resolveId, {}, "virtual:other")).toBeUndefined();
    expect(call(plugin.load, {}, id)).toBe(
      `export const sourceHash = ${JSON.stringify(sourceHash(scannerRoots(root)))};\n`,
    );
    expect(call(plugin.load, {}, "/elsewhere.ts")).toBeUndefined();
  });

  it("is invalidated on the dev server when a hashed file changes", () => {
    const root = scratchRepo();
    const plugin = planningScannerId({ repoRoot: root });
    const id = `\0${SCANNER_ID_MODULE}`;
    const invalidated: unknown[] = [];
    const node = { id };
    const watched: string[] = [];
    const watcher = Object.assign(new EventEmitter(), {
      add: (paths: string[]) => watched.push(...paths),
    });
    const server = {
      watcher,
      environments: {
        client: {
          moduleGraph: {
            getModuleById: (wanted: string) =>
              wanted === id ? node : undefined,
            invalidateModule: (module: unknown) => invalidated.push(module),
          },
        },
      },
    };
    call(plugin.configureServer, {}, server);
    expect(watched).toContain(path.join(root, "package-lock.json"));

    const first = call(plugin.load, {}, id);
    watcher.emit("change", path.join(root, "frontend/src/other.ts"));
    expect(invalidated).toEqual([]);
    expect(call(plugin.load, {}, id)).toBe(first);

    const scan = path.join(root, "packages/vantage-md/src/planning/scan.ts");
    writeFileSync(scan, "export const a = 99;\n");
    watcher.emit("change", scan);
    expect(invalidated).toEqual([node]);
    expect(call(plugin.load, {}, id)).not.toBe(first);
  });
});
