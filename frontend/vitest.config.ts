import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    // Match vite.config.ts: resolve vantage-md to package source so tests run
    // against the same code the app builds, with no dependency on dist/.
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
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/test/**",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
      ],
    },
  },
});
