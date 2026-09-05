/**
 * The render chain, defined once.
 *
 * `buildPipeline` lives in `packages/vantage-md`, which has no test runner of
 * its own; the frontend resolves `vantage-md` to that package's TypeScript
 * source (see `vite.config.ts`), so these run against the real thing.
 *
 * Plugins are identified by function *name*, not by identity: `frontend/` and
 * `packages/vantage-md/` have separate `node_modules`, so importing
 * `rehype-raw` here would yield a different module instance than the one
 * `pipeline.ts` imported and every `toBe` would fail for the wrong reason.
 * `sanitizeSchema` is the exception — it comes from the same source module
 * through the vitest alias, so its identity *is* comparable, and that is the
 * assertion that catches someone handing the sanitiser a fresh object.
 */
import { describe, it, expect } from "vitest";
import type { Pluggable, PluggableList } from "unified";
import { buildPipeline, buildRemarkPlugins, sanitizeSchema } from "vantage-md";

/** The plugin function's name, whether the entry is bare or a tuple. */
const nameOf = (entry: Pluggable): string => {
  const plugin = Array.isArray(entry) ? entry[0] : entry;
  return typeof plugin === "function" ? plugin.name : String(plugin);
};

const names = (list: PluggableList): string[] => list.map(nameOf);

/** The options object a tuple entry carries, or `undefined` for a bare entry. */
const optionsOf = (entry: Pluggable): unknown =>
  Array.isArray(entry) ? entry[1] : undefined;

const DEFAULT_REMARK = ["remarkGfm", "remarkMath"];
const DEFAULT_REHYPE = [
  "rehypeRaw",
  "rehypeSourceLines",
  "rehypeVantageAlerts",
  "rehypeVantageDirectives",
  "rehypeSanitize",
  "rehypeVantageAnchors",
  "rehypeSlug",
  "rehypeHighlight",
  "rehypeCaptureMathStamps",
  "rehypeKatex",
  "rehypeRestoreMathStamps",
];

describe("buildPipeline order", () => {
  it("produces the one canonical plugin order", () => {
    const { remarkPlugins, rehypePlugins } = buildPipeline();

    expect(names(remarkPlugins)).toEqual(DEFAULT_REMARK);
    expect(names(rehypePlugins)).toEqual(DEFAULT_REHYPE);
  });

  it("keeps rehypeSlug after rehypeSanitize", () => {
    // Not a preference. rehype-sanitize's default schema clobbers `id` with
    // the prefix `user-content-`, so slugging first turns every `#heading`
    // link in every document into a dead anchor.
    const order = names(buildPipeline().rehypePlugins);

    expect(order.indexOf("rehypeVantageAnchors", "rehypeSlug")).toBeGreaterThan(
      order.indexOf("rehypeSanitize"),
    );
  });

  it("keeps the comment-reading plugin in the one slot where comments exist", () => {
    // Anything that reads HTML comments has to sit between `rehypeRaw` (which
    // creates the comment nodes) and `rehypeSanitize` (which deletes them).
    // `rehypeVantageDirectives` is what occupies that gap: move it either way
    // and every directive in every document silently stops compiling.
    const order = names(buildPipeline().rehypePlugins);

    expect(order[0]).toBe("rehypeRaw");
    // Alerts share the same window for a different reason: the title element
    // must be stamped before the sanitiser sees it, and after
    // `rehypeSourceLines` so it carries no line and cannot become an anchor.
    expect(order.indexOf("rehypeVantageAlerts")).toBeGreaterThan(
      order.indexOf("rehypeSourceLines"),
    );
    expect(order.indexOf("rehypeVantageAlerts")).toBeLessThan(
      order.indexOf("rehypeSanitize"),
    );
    expect(order.indexOf("rehypeVantageDirectives")).toBeGreaterThan(
      order.indexOf("rehypeRaw"),
    );
    expect(order.indexOf("rehypeSanitize")).toBeGreaterThan(
      order.indexOf("rehypeVantageDirectives"),
    );
  });

  it("brackets rehypeKatex with the display-math stamp carry", () => {
    // `rehype-katex` *replaces* a display-math `<pre>` with a
    // `<span class="katex-display">`, and the `<pre>` is the element
    // `rehypeVantageDirectives` stamped and `rehypeSourceLines` numbered. The
    // pair around it copies those attributes onto the replacement; either half
    // on the wrong side of `rehypeKatex` is silently inert, and the symptom is a
    // hole in a toned section's vertical rule that no unit test can see.
    const order = names(buildPipeline().rehypePlugins);
    const capture = order.indexOf("rehypeCaptureMathStamps");
    const katex = order.indexOf("rehypeKatex");
    const restore = order.indexOf("rehypeRestoreMathStamps");

    expect(capture).toBeGreaterThan(-1);
    expect(katex).toBe(capture + 1);
    expect(restore).toBe(katex + 1);
    // And the capture has to see the tree the sanitiser rebuilt, not the one it
    // replaced: node identities taken earlier would all be stale.
    expect(capture).toBeGreaterThan(order.indexOf("rehypeSanitize"));
  });

  it("drops the stamp carry with math, since nothing replaces the block", () => {
    const order = names(buildPipeline({ math: false }).rehypePlugins);

    expect(order).not.toContain("rehypeCaptureMathStamps");
    expect(order).not.toContain("rehypeRestoreMathStamps");
  });

  it("registers the directive plugin unconditionally, with no options", () => {
    // No toggle: every renderer has to agree about what a document means, and a
    // flag is a way for them to disagree (D5). It is registered even with the
    // sanitiser off, so `renderMarkdown({ sanitize: false })` still compiles
    // directives.
    for (const options of [
      {},
      { sanitize: false },
      { sourceLines: false },
      { math: false, highlight: false },
    ]) {
      const entry = buildPipeline(options).rehypePlugins.find(
        (candidate) => nameOf(candidate) === "rehypeVantageDirectives",
      );

      expect(entry).toBeDefined();
      expect(optionsOf(entry!)).toBeUndefined();
    }
  });
});

describe("buildPipeline plugin options", () => {
  it("disables single-tilde strikethrough and single-dollar math", () => {
    // Both are contracts the style guide and the user guide state: `~x~` is a
    // literal tilde and `$HOME` is literal text, not a broken formula.
    const { remarkPlugins } = buildPipeline();

    expect(optionsOf(remarkPlugins[0])).toEqual({ singleTilde: false });
    expect(optionsOf(remarkPlugins[1])).toEqual({
      singleDollarTextMath: false,
    });
  });

  it("hands the sanitiser Vantage's own schema, not a copy", () => {
    const { rehypePlugins } = buildPipeline();
    const sanitizeEntry = rehypePlugins.find(
      (entry) => nameOf(entry) === "rehypeSanitize",
    )!;

    expect(optionsOf(sanitizeEntry)).toBe(sanitizeSchema);
  });

  it("plumbs bodyLineOffset through to rehypeSourceLines", () => {
    const offsetOf = (options?: { bodyLineOffset?: number }) => {
      const { rehypePlugins } = buildPipeline(options);
      const entry = rehypePlugins.find(
        (e) => nameOf(e) === "rehypeSourceLines",
      )!;
      return optionsOf(entry);
    };

    expect(offsetOf()).toEqual({ offset: 0 });
    expect(offsetOf({ bodyLineOffset: 8 })).toEqual({ offset: 8 });
  });
});

describe("buildPipeline toggles", () => {
  it("drops both halves of math from one flag", () => {
    // The reason the builder returns both lists from one options object: a
    // rehype-only builder lets a caller parse `$$…$$` and never render it.
    const { remarkPlugins, rehypePlugins } = buildPipeline({ math: false });

    expect(names(remarkPlugins)).toEqual(["remarkGfm"]);
    expect(names(rehypePlugins)).toEqual([
      "rehypeRaw",
      "rehypeSourceLines",
      "rehypeVantageAlerts",
      "rehypeVantageDirectives",
      "rehypeSanitize",
      "rehypeVantageAnchors",
      "rehypeSlug",
      "rehypeHighlight",
    ]);
  });

  it("drops only remarkGfm for gfm: false", () => {
    const { remarkPlugins, rehypePlugins } = buildPipeline({ gfm: false });

    expect(names(remarkPlugins)).toEqual(["remarkMath"]);
    expect(names(rehypePlugins)).toEqual(DEFAULT_REHYPE);
  });

  it("drops only rehypeHighlight for highlight: false", () => {
    const { remarkPlugins, rehypePlugins } = buildPipeline({
      highlight: false,
    });

    expect(names(remarkPlugins)).toEqual(DEFAULT_REMARK);
    expect(names(rehypePlugins)).toEqual([
      "rehypeRaw",
      "rehypeSourceLines",
      "rehypeVantageAlerts",
      "rehypeVantageDirectives",
      "rehypeSanitize",
      "rehypeVantageAnchors",
      "rehypeSlug",
      "rehypeCaptureMathStamps",
      "rehypeKatex",
      "rehypeRestoreMathStamps",
    ]);
  });

  it("drops only rehypeSourceLines for sourceLines: false", () => {
    const { rehypePlugins } = buildPipeline({ sourceLines: false });

    expect(names(rehypePlugins)).toEqual([
      "rehypeRaw",
      "rehypeVantageAlerts",
      "rehypeVantageDirectives",
      "rehypeSanitize",
      "rehypeVantageAnchors",
      "rehypeSlug",
      "rehypeHighlight",
      "rehypeCaptureMathStamps",
      "rehypeKatex",
      "rehypeRestoreMathStamps",
    ]);
  });

  it("drops only rehypeSanitize for sanitize: false", () => {
    const { rehypePlugins } = buildPipeline({ sanitize: false });

    expect(names(rehypePlugins)).toEqual([
      "rehypeRaw",
      "rehypeSourceLines",
      "rehypeVantageAlerts",
      "rehypeVantageDirectives",
      "rehypeVantageAnchors",
      "rehypeSlug",
      "rehypeHighlight",
      "rehypeCaptureMathStamps",
      "rehypeKatex",
      "rehypeRestoreMathStamps",
    ]);
  });

  it("returns fresh arrays per call, and reads no shared state", () => {
    const first = buildPipeline();
    const second = buildPipeline();

    expect(first.rehypePlugins).not.toBe(second.rehypePlugins);
    expect(names(first.rehypePlugins)).toEqual(names(second.rehypePlugins));
  });
});

describe("buildRemarkPlugins", () => {
  it("is exactly the remark half buildPipeline returns", () => {
    // The CLI checker parses mdast without ever running rehype. It calls this,
    // so its parser cannot drift from the viewers'.
    for (const options of [{}, { gfm: false }, { math: false }]) {
      const half = buildRemarkPlugins(options);
      const whole = buildPipeline(options).remarkPlugins;

      expect(names(half)).toEqual(names(whole));
      expect(half.map(optionsOf)).toEqual(whole.map(optionsOf));
    }
  });
});
