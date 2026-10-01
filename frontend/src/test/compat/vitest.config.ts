import { defineConfig } from "vitest/config";
import base from "../../../vitest.config.ts";

// `just compat-previous`, and nothing else, runs the suite here: it fetches the
// previous release's vantage-md from npm, so it has no place in a gate that
// must pass offline. The main config's `include` matches `*.test.*`, never
// `*.compat.ts`, which is what keeps it out of `npm run test`.
//
// The vantage-md aliases are the main config's, so `src/compat/notation.ts`
// reads this tree's source here exactly as its unit tests do there.
export default defineConfig({
  resolve: base.resolve,
  // Beside frontend's own node_modules, not in src/ (see the guards' config).
  cacheDir: "../../../node_modules/.vite-compat",
  test: {
    root: import.meta.dirname,
    globals: true,
    environment: "jsdom",
    include: ["*.compat.ts"],
    // One line per example, so a green run lists what it read.
    reporters: ["verbose"],
    testTimeout: 30_000,
  },
});
