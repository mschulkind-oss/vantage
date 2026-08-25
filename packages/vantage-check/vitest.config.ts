import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve vantage-md to the package's TypeScript source, exactly like
  // frontend/vitest.config.ts does — the CLI validates against the same code
  // the viewer renders with, with no dependency on dist/.
  resolve: {
    alias: [
      {
        find: /^vantage-md$/,
        replacement: path.resolve(import.meta.dirname, "../vantage-md/src/index.ts"),
      },
    ],
  },
  test: {
    // Headless checker: no browser, no jsdom.
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
