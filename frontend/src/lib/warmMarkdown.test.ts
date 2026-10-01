/**
 * The Markdown pipeline's warm-up (`docs/reference/planning-index.md`
 * §6.10): the viewer's own chain, over samples that between them hold what a
 * card holds, one sample per task, once per page load.
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every call of the viewer's Markdown component, and what it returned. */
const calls = vi.hoisted(
  () =>
    [] as {
      options: {
        children?: string | null;
        remarkPlugins?: readonly unknown[] | null;
        rehypePlugins?: readonly unknown[] | null;
      };
      element?: ReactElement;
      error?: unknown;
    }[],
);
vi.mock("react-markdown", async () => {
  const actual =
    await vi.importActual<typeof import("react-markdown")>("react-markdown");
  return {
    ...actual,
    default: (options: Parameters<typeof actual.default>[0]) => {
      const call: (typeof calls)[number] = { options };
      calls.push(call);
      try {
        call.element = actual.default(options);
        return call.element;
      } catch (error) {
        call.error = error;
        throw error;
      }
    },
  };
});

import { WARM_SAMPLES, resetWarmMarkdown, warmMarkdown } from "./warmMarkdown";
import {
  rehypeCollectMarkdownLinks,
  rehypeMarkMarkdownLinks,
} from "../hooks/usePlanningLinkBadges";

beforeEach(() => {
  calls.length = 0;
  resetWarmMarkdown();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("warmMarkdown", () => {
  it("runs the viewer's chain over each sample, one sample per task", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const done = warmMarkdown();
    // Nothing in the caller's own task.
    expect(calls).toHaveLength(0);
    for (let n = 1; n <= WARM_SAMPLES.length; n++) {
      vi.advanceTimersToNextTimer();
      expect(calls).toHaveLength(n);
    }
    await done;
    expect(calls.map((c) => c.options.children)).toEqual(WARM_SAMPLES);
    // MarkdownViewer's plugins around the shared chain, as a card renders.
    const plugins = calls[0].options.rehypePlugins ?? [];
    expect(plugins[0]).toBe(rehypeCollectMarkdownLinks);
    expect(plugins.at(-1)).toBe(rehypeMarkMarkdownLinks);
    expect(plugins.length).toBeGreaterThan(2);
    expect(calls[0].options.remarkPlugins?.length).toBeGreaterThan(0);
  });

  it("runs once per page load: asking again waits for the same run", async () => {
    const first = warmMarkdown();
    await first;
    expect(warmMarkdown()).toBe(first);
    await warmMarkdown();
    expect(calls).toHaveLength(WARM_SAMPLES.length);
  });

  it("renders every sample, so each one runs the part of the chain it is there for", async () => {
    await warmMarkdown();
    expect(calls.map((c) => c.error)).toEqual(
      WARM_SAMPLES.map(() => undefined),
    );
    const html = calls.map((c) =>
      c.element === undefined ? "" : renderToStaticMarkup(c.element),
    );
    // A question in a list, with its directive compiled onto its item.
    expect(html[1]).toContain("<ol");
    expect(html[1]).toContain("data-vantage-");
    expect(html[1]).toContain("<del>");
    expect(html[1]).toContain('type="checkbox"');
    // A table, raw HTML and an alert.
    expect(html[2]).toContain("<table");
    expect(html[2]).toContain("<kbd>");
    expect(html[2]).toContain("data-vantage-alert");
    // Highlighted code.
    expect(html[3]).toContain("hljs");
  });
});
