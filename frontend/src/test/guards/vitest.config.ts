import { defineConfig } from "vitest/config";

// The files here break the rules src/test/setup.ts enforces, one rule each, so
// that src/test/setup.test.ts can run them under it and see each one fail with
// its cause named. They are fixtures, not tests: the suite's own `include`
// matches `*.test.*`, never `*.fixture.*`, so only this config runs them.
export default defineConfig({
  // Vite's caches go beside the root by default, which would put a
  // node_modules in src/; frontend's own is where they belong.
  cacheDir: "../../../node_modules/.vite-guards",
  test: {
    root: import.meta.dirname,
    globals: true,
    environment: "jsdom",
    setupFiles: ["../setup.ts"],
    include: ["*.fixture.ts"],
  },
});
