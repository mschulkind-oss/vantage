import { copyFileSync, mkdirSync, readdirSync } from "node:fs";

import { defineConfig } from "tsdown";

/**
 * Build the published package.
 *
 * Nothing in this repo consumes `dist/` — the frontend resolves vantage-md to
 * its TypeScript source through a Vite alias and vantage-check imports it by
 * relative path — so this exists purely for npm consumers, and runs at
 * `prepublishOnly`.
 *
 * tsdown rather than tsup, since 2026-09-01. tsup bundles rollup-plugin-dts,
 * which crashes on TypeScript 7 with `Cannot read properties of undefined
 * (reading 'useCaseSensitiveFileName…')` while `tsc --noEmit` passes cleanly —
 * so the failure only appears when generating declarations, i.e. at publish.
 * tsup's last release was 2025-11-12 and its peer range still claims
 * `typescript: >=4.5.0`. tsdown is the maintained successor on the same
 * lineage; its peer range names 7.x explicitly.
 */
const shared = {
  format: ["esm", "cjs"] as const,
  dts: true,
  sourcemap: true,
  treeshake: true,
  // tsdown defaults this to true on the node platform, which emits `.mjs` and
  // `.d.mts`. The published `exports` map has always named `.js` and `.d.ts`
  // for the ESM half, and renaming those would break every consumer resolving
  // through it. Keep the layout tsup produced; only the tool changed.
  fixedExtension: false,
};

export default defineConfig([
  // Main entry — framework-agnostic.
  {
    ...shared,
    entry: { index: "src/index.ts" },
    clean: true,
    deps: {
      neverBundle: ["react", "react-dom", "mermaid", "yaml", "smol-toml"],
    },
  },
  // React entry — requires the React peer dep.
  {
    ...shared,
    entry: { react: "src/react.ts" },
    deps: {
      neverBundle: [
        "react",
        "react-dom",
        "mermaid",
        "yaml",
        "smol-toml",
        "react-markdown",
        "remark-gfm",
        "remark-math",
        "rehype-raw",
        "rehype-sanitize",
        "rehype-highlight",
        "rehype-katex",
        "rehype-slug",
        "katex",
      ],
    },
    // The CSS ships as-is rather than through the bundler, so every stylesheet
    // in `src/styles/` is copied beside the others: `index.css`, published as
    // `styles.css`, is made of relative `@import`s of its siblings. tsup ran
    // the CSS through esbuild, which inlined them; the first tsdown build
    // copied `index.css` alone, and `vantage-md/styles` shipped four imports
    // of files that were not in the package. `scripts/check-published-css.mjs`
    // follows every import in the built `dist/` and fails the gate on a
    // missing one.
    hooks: {
      "build:done": () => {
        mkdirSync("dist", { recursive: true });
        for (const name of readdirSync("src/styles")) {
          if (!name.endsWith(".css")) continue;
          const published = name === "index.css" ? "styles.css" : name;
          copyFileSync(`src/styles/${name}`, `dist/${published}`);
        }
      },
    },
  },
]);
