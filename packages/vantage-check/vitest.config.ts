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
      // Same headless stand-in the bun bundle uses (see the shim's header):
      // mermaid.parse sanitizes flowchart labels, which a method-less
      // DOMPurify stub cannot do without a DOM.
      {
        find: /^dompurify$/,
        replacement: path.resolve(import.meta.dirname, "src/shims/dompurify.ts"),
      },
    ],
  },
  test: {
    // Headless checker: no browser, no jsdom.
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Process mermaid through vite (not node's external resolver) so the
    // dompurify alias above reaches the import inside mermaid's dist.
    server: { deps: { inline: ["mermaid"] } },
  },
});
