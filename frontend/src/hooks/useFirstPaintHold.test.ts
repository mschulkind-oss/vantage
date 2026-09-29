/**
 * The hold (`docs/design/planning-index-at-scale.md` §11.3): a document's
 * first paint waits, at most `holdMs` after its content arrives, for data
 * already on its way, and the previous document stays up while it does.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFirstPaintHold, type ViewedPath } from "./useFirstPaintHold";
import { setPlanningLimitsForTests } from "../planningScan/limits";
import type { FileContent } from "../types";

const doc = (path: string): FileContent =>
  ({ path, content: `# ${path}\n`, encoding: "utf-8" }) as FileContent;

const EMPTY: ViewedPath = {
  fileContent: null,
  currentPath: null,
  currentDirectory: null,
  error: null,
  isLoading: false,
};

/** The repo store's view once `path`'s content has landed. */
const showing = (path: string): ViewedPath => ({
  ...EMPTY,
  fileContent: doc(path),
  currentPath: path,
});

/** A load of another path under way, with `from` still in the store. */
const leaving = (from: ViewedPath): ViewedPath => ({
  ...from,
  isLoading: true,
});

function mount(initial: ViewedPath, waiting = false) {
  return renderHook(
    ({ live, waiting }: { live: ViewedPath; waiting: boolean }) =>
      useFirstPaintHold(live, waiting),
    { initialProps: { live: initial, waiting } },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  setPlanningLimitsForTests({ holdMs: 40 });
});

afterEach(() => {
  vi.useRealTimers();
  setPlanningLimitsForTests(null);
});

describe("moving between documents", () => {
  it("keeps the previous document up while the next one's data is on its way", () => {
    const a = showing("a.md");
    const view = mount(a);
    view.rerender({ live: leaving(a), waiting: false });

    const b = showing("b.md");
    view.rerender({ live: b, waiting: true });
    expect(view.result.current.currentPath).toBe("a.md");
    expect(view.result.current.fileContent).toBe(a.fileContent);

    // The data lands: the document paints with it, not before it.
    view.rerender({ live: b, waiting: false });
    expect(view.result.current).toBe(b);
  });

  it("waits no longer than the deadline, counted from the content's arrival", () => {
    const view = mount(showing("a.md"));
    const b = showing("b.md");
    view.rerender({ live: b, waiting: true });

    act(() => vi.advanceTimersByTime(39));
    expect(view.result.current.currentPath).toBe("a.md");
    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current).toBe(b);

    // And stays shown when what it waited for lands later.
    view.rerender({ live: b, waiting: false });
    expect(view.result.current).toBe(b);
  });

  it("waits for nothing when everything is already in hand", () => {
    const view = mount(showing("a.md"));
    const b = showing("b.md");
    view.rerender({ live: b, waiting: false });
    expect(view.result.current).toBe(b);
  });

  it("gives a document that arrives during another's hold a deadline of its own", () => {
    const view = mount(showing("a.md"));
    view.rerender({ live: showing("b.md"), waiting: true });
    act(() => vi.advanceTimersByTime(30));

    const c = showing("c.md");
    view.rerender({ live: c, waiting: true });
    act(() => vi.advanceTimersByTime(30));
    // b's deadline would have passed by now; c's has not.
    expect(view.result.current.currentPath).toBe("a.md");
    act(() => vi.advanceTimersByTime(10));
    expect(view.result.current).toBe(c);
  });
});

describe("on a first load", () => {
  it("keeps the app's shell up, then shows the document", () => {
    const loading = { ...EMPTY, isLoading: true };
    const view = mount(EMPTY);
    view.rerender({ live: loading, waiting: false });

    const a = showing("a.md");
    view.rerender({ live: a, waiting: true });
    expect(view.result.current).toEqual(loading);

    view.rerender({ live: a, waiting: false });
    expect(view.result.current).toBe(a);
  });
});

describe("what is never held", () => {
  it("a live reload of the document on screen", () => {
    const a = showing("a.md");
    const view = mount(a);
    const reloaded = { ...a, fileContent: doc("a.md") };
    view.rerender({ live: reloaded, waiting: true });
    expect(view.result.current).toBe(reloaded);
  });

  it("a directory, an error, or a load starting", () => {
    const view = mount(showing("a.md"));
    const dir = { ...EMPTY, currentPath: "docs", currentDirectory: [] };
    view.rerender({ live: dir, waiting: true });
    expect(view.result.current).toBe(dir);

    const failed = { ...EMPTY, currentPath: "gone.md", error: "Failed" };
    view.rerender({ live: failed, waiting: true });
    expect(view.result.current).toBe(failed);

    const started = { ...failed, isLoading: true };
    view.rerender({ live: started, waiting: true });
    expect(view.result.current).toBe(started);
  });
});
