/**
 * The scanner id's source half, and the build guard that keeps it honest
 * (`docs/reference/planning-index.md` §11.2).
 *
 * A Vite plugin serving `virtual:planning-scanner-id`, whose one export,
 * `sourceHash`, is SHA-256 over every file the scan worker's code comes from:
 * `packages/vantage-md/src/`, this directory, and `package-lock.json`, which
 * stands for every package under `node_modules`. The cache joins it with a
 * schema number and the user agent (`scannerIdOf` in `cache.ts`), and a
 * stored result of any other id is never read.
 *
 * - **A production build computes it once.** The dev server computes it again
 *   whenever one of those files changes, and invalidates the module, so a dev
 *   session never trusts results from the code before an edit and still keeps
 *   a warm cache between edits.
 * - **The worker's bundle may hold nothing else.** The instance in
 *   `worker.plugins` fails the build when a module of the worker's build
 *   sits outside those roots and outside `node_modules`, because a change to
 *   such a module would change what the scan produces without changing the id.
 *   It looks at the build's whole module graph for that, since a module whose
 *   one export is a constant is inlined and is then in no chunk's module
 *   list.
 *   It fails it too when the bundle holds a package the scan never needs
 *   (KaTeX, highlight.js, React, Mermaid): `pipeline.ts` imports the first two
 *   beside the remark plugins the scan does use, and the worker
 *   carries none of them (§10.1). And when it holds a package's DOM build
 *   (`*.dom.js`), which throws in a worker the moment it loads, as
 *   `decode-named-character-reference`'s did until `vite.config.ts` pointed it
 *   at its worker build.
 *
 * This file runs in Node, under `vite.config.ts`, and never in a browser, so
 * `tsconfig.node.json` checks it and `tsconfig.app.json` leaves it out:
 * compiled with the app, its `vite` import would pull Node's types into the
 * app's whole program.
 * `vitest.config.ts` does not load the plugin, so the virtual module does not
 * resolve in a unit test: only `worker.ts` and `main.tsx` import it.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";

export const SCANNER_ID_MODULE = "virtual:planning-scanner-id";
const RESOLVED_ID = `\0${SCANNER_ID_MODULE}`;

/** Where the scan worker's code may come from. Absolute paths. */
export interface ScannerRoots {
  /** Paths are hashed relative to this, so a moved checkout keeps its id. */
  base: string;
  /** Directories, every file of which is hashed. */
  dirs: string[];
  /** Single files hashed as well. */
  files: string[];
}

export function scannerRoots(repoRoot: string): ScannerRoots {
  return {
    base: repoRoot,
    dirs: [
      path.join(repoRoot, "packages/vantage-md/src"),
      path.join(repoRoot, "frontend/src/planningScan"),
    ],
    files: [path.join(repoRoot, "package-lock.json")],
  };
}

/** A unit test is never part of the worker, so editing one keeps the id. */
const isTest = (file: string): boolean => /\.test\.tsx?$/.test(file);

const within = (file: string, dir: string): boolean =>
  file.startsWith(`${dir}${path.sep}`);

/** Whether `file` is one of the files the id is computed from. */
export function isHashed(file: string, roots: ScannerRoots): boolean {
  const resolved = path.resolve(file);
  if (roots.files.includes(resolved)) return true;
  return !isTest(resolved) && roots.dirs.some((dir) => within(resolved, dir));
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full);
    return entry.isFile() && !isTest(full) ? [full] : [];
  });
}

/** SHA-256 over each hashed file's path and bytes, as 32 hex digits. */
export function sourceHash(roots: ScannerRoots): string {
  const hash = createHash("sha256");
  const files = [...roots.dirs.flatMap(filesUnder), ...roots.files]
    .map((file) => path.relative(roots.base, file).split(path.sep).join("/"))
    .sort();
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(path.join(roots.base, file)));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 32);
}

/** Packages the worker's bundle must not hold, however they were reached. */
export const WORKER_FORBIDDEN_PACKAGES = [
  "katex",
  "highlight.js",
  "react",
  "react-dom",
  "mermaid",
];

/**
 * Modules of the bundler's own, which it writes into every bundle and which a
 * lockfile change already covers: Rolldown's runtime and Vite's helpers.
 */
const isBundlerModule = (id: string): boolean =>
  /^\0(rolldown\/|vite\/)/.test(id);

/**
 * Every module of the worker's build the guard refuses, with why: one outside
 * the hashed roots and `node_modules`, or a rendered one of a forbidden
 * package or a package's DOM build. Empty when the bundle is sound.
 *
 * `rendered` are the modules whose code is in the bundle, and `graph` every
 * module the build loaded, which is more, in two ways. A module whose one
 * export is a constant is inlined into its importer and rendered nowhere, yet
 * its value is in the worker's code, so the source check covers the graph. A
 * package the scan's imports reach and never call, as they reach KaTeX
 * through `micromark-extension-math`, is dropped whole and puts nothing
 * there, so the package checks cover only what is rendered.
 */
export function workerBundleProblems(
  rendered: Iterable<string>,
  roots: ScannerRoots,
  graph: Iterable<string> = [],
): string[] {
  const problems: string[] = [];
  const inBundle = new Set(rendered);
  for (const raw of new Set([...inBundle, ...graph])) {
    const id = raw.split("?")[0] ?? raw;
    if (id === RESOLVED_ID || isBundlerModule(id)) continue;
    // The innermost `node_modules` names the package.
    const parts = id.split(`${path.sep}node_modules${path.sep}`);
    if (parts.length > 1) {
      if (!inBundle.has(raw)) continue;
      const [scopeOrName = "", name = ""] = (parts.at(-1) ?? "").split(
        path.sep,
      );
      const pkg = scopeOrName.startsWith("@")
        ? `${scopeOrName}/${name}`
        : scopeOrName;
      if (WORKER_FORBIDDEN_PACKAGES.includes(pkg)) {
        problems.push(`${raw}: the scan never needs ${pkg}`);
      } else if (id.endsWith(".dom.js")) {
        problems.push(
          `${raw}: a package's DOM build, which needs a document the worker does not have`,
        );
      }
      continue;
    }
    if (id.startsWith("\0") || !isHashed(id, roots)) {
      problems.push(`${raw}: outside the files the scanner id hashes`);
    }
  }
  return problems;
}

export interface ScannerIdOptions {
  repoRoot: string;
  /** Fail a bundle that fails {@link workerBundleProblems}: the worker's instance. */
  guard?: boolean;
}

/**
 * The plugin. One instance goes in `plugins`, which serves the module to the
 * app and, in dev, to the worker; another in `worker.plugins`, with `guard`,
 * serves it to the worker's bundle and checks that bundle.
 */
export function planningScannerId(options: ScannerIdOptions): Plugin {
  const roots = scannerRoots(options.repoRoot);
  let hash: string | null = null;
  const current = (): string => (hash ??= sourceHash(roots));

  return {
    name: "vantage-planning-scanner-id",

    resolveId(id) {
      return id === SCANNER_ID_MODULE ? RESOLVED_ID : undefined;
    },

    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      return `export const sourceHash = ${JSON.stringify(current())};\n`;
    },

    configureServer(server: ViteDevServer) {
      server.watcher.add([...roots.dirs, ...roots.files]);
      const changed = (file: string) => {
        if (!isHashed(file, roots)) return;
        hash = null;
        for (const environment of Object.values(server.environments)) {
          const graph = environment.moduleGraph;
          const node = graph.getModuleById(RESOLVED_ID);
          if (node !== undefined) graph.invalidateModule(node);
        }
      };
      server.watcher.on("add", changed);
      server.watcher.on("change", changed);
      server.watcher.on("unlink", changed);
    },

    generateBundle(_output, bundle) {
      if (options.guard !== true) return;
      const rendered = Object.values(bundle).flatMap((chunk) =>
        chunk.type === "chunk" ? chunk.moduleIds : [],
      );
      // The build's whole graph too: Rolldown inlines a constant another
      // module exports and then leaves that module out of `moduleIds`.
      const problems = workerBundleProblems(rendered, roots, [
        ...this.getModuleIds(),
      ]);
      if (problems.length > 0) {
        this.error(
          [
            "The planning scan worker's bundle holds code its scanner id does not hash,",
            "so a change to it would not change the id, and a stale result would be trusted",
            "(docs/reference/planning-index.md §11.2). Move it under",
            "packages/vantage-md/src/ or frontend/src/planningScan/, or out of the worker:",
            ...problems.map((problem) => `  ${problem}`),
          ].join("\n"),
        );
      }
    },
  };
}
