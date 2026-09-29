import { defineConfig } from "vitest/config";

// The files here break the rules src/test/setup.ts enforces, one rule each, so
// that src/test/setup.test.ts can run them under it and see each one fail with
// its cause named. They are fixtures, not tests: the suite's own `include`
// matches `*.test.*`, never `*.fixture.*`, so only this config runs them.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    globals: true,
    environment: "jsdom",
    setupFiles: ["../setup.ts"],
    include: ["*.fixture.ts"],
  },
});
