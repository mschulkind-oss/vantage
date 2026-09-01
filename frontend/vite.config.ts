import type { Plugin } from "vite";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Drop legacy font formats (.ttf, .woff) from the build.
 * Modern browsers all support .woff2 which is smaller.
 * KaTeX CSS lists fallback formats that we don't need.
 */
function dropLegacyFonts(): Plugin {
  return {
    name: "drop-legacy-fonts",
    generateBundle(_options, bundle) {
      for (const key of Object.keys(bundle)) {
        if (/\.(ttf|woff)$/.test(key) && !/\.woff2$/.test(key)) {
          delete bundle[key];
        }
      }
    },
  };
}

/**
 * Vendor chunking, as a function because Rollup 5 (via Vite 8) removed the
 * object form this used to use.
 *
 * The object form took `{ "vendor-react": ["react", ...] }` and did the id
 * matching itself. The function gets a resolved module id instead, so the
 * matching is ours: a package owns a chunk when the id sits under its
 * directory in node_modules. The trailing slash is load-bearing — without it
 * `react` would also claim `react-dom` and `react-router-dom`.
 *
 * One npm workspace means one hoisted node_modules at the repo root, so these
 * ids look like `<root>/node_modules/react/index.js` no matter which workspace
 * pulled them in.
 */
const VENDOR_CHUNKS: Record<string, string[]> = {
  "vendor-react": ["react", "react-dom", "react-router-dom"],
  "vendor-katex": ["katex"],
  "vendor-markdown": [
    "react-markdown",
    "remark-gfm",
    "remark-math",
    "rehype-raw",
    "rehype-slug",
    "rehype-highlight",
    "rehype-katex",
  ],
};

function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  for (const [chunk, packages] of Object.entries(VENDOR_CHUNKS)) {
    if (packages.some((pkg) => id.includes(`node_modules/${pkg}/`))) {
      return chunk;
    }
  }
  return undefined;
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const envDir = path.resolve(import.meta.dirname, "..");
  const env = loadEnv(mode, envDir, "");
  const port = parseInt(env.VITE_PORT || "8201");

  return {
    plugins: [react(), dropLegacyFonts()],
    envDir: envDir,
    resolve: {
      dedupe: ["react", "react-dom"],
      // Resolve the in-repo vantage-md package to its TypeScript source, not
      // its built dist/. Vite/esbuild compiles the TS on the fly, so editing
      // the package is picked up instantly with HMR and no separate build
      // step. dist/ is only produced at `npm publish` time (prepublishOnly).
      alias: [
        {
          find: /^vantage-md\/react$/,
          replacement: path.resolve(
            import.meta.dirname,
            "../packages/vantage-md/src/react.ts",
          ),
        },
        {
          find: /^vantage-md$/,
          replacement: path.resolve(
            import.meta.dirname,
            "../packages/vantage-md/src/index.ts",
          ),
        },
      ],
    },
    build: {
      // The heavy diagram/markdown libs are lazy-loaded separate chunks and the
      // app is served locally, so large chunks are fine here. Silence the nudge.
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
    server: {
      port: port,
      proxy: {
        "/api": {
          target: process.env.VITE_API_TARGET || "http://localhost:8200",
          changeOrigin: true,
        },
        "/api/ws": {
          target: process.env.VITE_WS_TARGET || "ws://localhost:8200",
          ws: true,
        },
      },
    },
  };
});
