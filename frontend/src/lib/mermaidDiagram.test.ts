/**
 * A diagram whose render fails says so twice: in the page, as a "Diagram syntax
 * error" box with the source to hand, and in the console, for whoever is
 * debugging the page. Both are for a reader of the diagram, so a render that
 * fails once the diagram is gone — the reader navigated away, or the fence
 * changed underneath it — has nobody to tell.
 *
 * That late log was not harmless in the suite, either: a test that rendered a
 * real diagram in jsdom, which cannot lay one out, ended before Mermaid gave
 * up, and the log landed after the file's last test, which can fail the whole
 * run (see src/test/setup.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render as renderComponent, screen } from "@testing-library/react";
import { createElement } from "react";

const initialize = vi.fn();
const render = vi.fn<(id: string, code: string) => Promise<{ svg: string }>>();

// The loader imports mermaid lazily, so a mock at the bare specifier is all it
// ever sees.
vi.mock("mermaid", () => ({ default: { initialize, render } }));

const cache = await import("../../../packages/vantage-md/src/mermaidCache");
const { MermaidDiagram } =
  await import("../../../packages/vantage-md/src/MermaidDiagram");

beforeEach(() => {
  cache.clearMermaidCache();
  render.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a diagram whose render fails", () => {
  it("says so, in the page and in the console, while it is on screen", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    render.mockRejectedValue(new Error("Parse error on line 1"));
    renderComponent(createElement(MermaidDiagram, { code: "graph ?" }));

    expect(await screen.findByText("Diagram syntax error")).toBeVisible();
    expect(logged).toHaveBeenCalledWith(
      "Mermaid render error:",
      expect.objectContaining({ message: "Parse error on line 1" }),
    );
  });

  it("logs nothing once the diagram is gone", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail!: (err: Error) => void;
    render.mockImplementation(
      () => new Promise((_, reject) => (fail = reject)),
    );
    const { unmount } = renderComponent(
      createElement(MermaidDiagram, { code: "graph ?" }),
    );
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));

    unmount();
    fail(new Error("Parse error on line 1"));
    // The failure settles in the render's own promise chain: past a macrotask,
    // every step of it has run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logged).not.toHaveBeenCalled();
  });
});
