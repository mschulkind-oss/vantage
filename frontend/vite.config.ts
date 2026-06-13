import type { Plugin } from "vite";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { changelogPlugin } from "./vite-changelog-plugin";

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

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname, "..");
  const env = loadEnv(mode, envDir, "");
  const port = parseInt(env.VITE_PORT || "8201");

  return {
    plugins: [react(), dropLegacyFonts(), changelogPlugin()],
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
            __dirname,
            "../packages/vantage-md/src/react.ts",
          ),
        },
        {
          find: /^vantage-md$/,
          replacement: path.resolve(
            __dirname,
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
          manualChunks: {
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
          },
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
