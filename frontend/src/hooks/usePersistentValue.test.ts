/**
 * The non-boolean half of the persistent-preference hooks.
 *
 * `usePersistentFlag.test.ts` covers the storage traps in detail — jsdom raises
 * no `storage` event for this window's own writes, carries `storageArea` through
 * faithfully, and reports a null key on `clear()` — and both hooks now run the
 * same code for all of that. What is tested here is what only this hook has: a
 * value that is not a boolean, a `parse` that decides what an unusable stored
 * string means, and the stability contract that keeps the subscription from being
 * rebuilt on every render.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { usePersistentValue } from "./usePersistentValue";
import type { PreferenceName } from "../lib/preferences";

const KEY: PreferenceName = "vantage:sidebarWidth";

/** What a second tab's write looks like from in here. */
function writeFromAnotherTab(key: string, value: string | null) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key,
      newValue: value,
      storageArea: localStorage,
    }),
  );
}

/** A width preference, clamped the way ViewerPage's real one is. */
const parseWidth = (raw: string | null): number => {
  const width = raw === null ? NaN : parseInt(raw, 10);
  return Number.isFinite(width) && width >= 200 && width <= 800 ? width : 288;
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  // A leaked `setItem` mock does not fail the test that installed it; it fails
  // the next one, somewhere else entirely.
  vi.restoreAllMocks();
});

describe("usePersistentValue", () => {
  it("reads the stored string through parse", () => {
    localStorage.setItem(KEY, "420");
    expect(
      renderHook(() => usePersistentValue(KEY, parseWidth, String)).result
        .current[0],
    ).toBe(420);
  });

  it("lets parse decide what an unusable value means", () => {
    // Out of range is the default rather than a clamp: a width outside the
    // bounds this build enforces is not a preference the reader expressed.
    localStorage.setItem(KEY, "9999");
    expect(
      renderHook(() => usePersistentValue(KEY, parseWidth, String)).result
        .current[0],
    ).toBe(288);
  });

  it("writes the serialized form, which is the format older tabs read", () => {
    const { result } = renderHook(() =>
      usePersistentValue(KEY, parseWidth, String),
    );

    act(() => result.current[1](512));

    expect(result.current[0]).toBe(512);
    expect(localStorage.getItem(KEY)).toBe("512");
  });

  it("composes updater functions within one tick", () => {
    const { result } = renderHook(() =>
      usePersistentValue(KEY, parseWidth, String),
    );
    const widen = result.current[1];

    act(() => {
      widen((w) => w + 10);
      widen((w) => w + 10);
    });

    expect(result.current[0]).toBe(308);
    expect(localStorage.getItem(KEY)).toBe("308");
  });

  it("adopts another tab's value", () => {
    const { result } = renderHook(() =>
      usePersistentValue(KEY, parseWidth, String),
    );

    act(() => writeFromAnotherTab(KEY, "640"));

    expect(result.current[0]).toBe(640);
  });

  it("leaves a later local update working from the adopted value", () => {
    const { result } = renderHook(() =>
      usePersistentValue(KEY, parseWidth, String),
    );

    act(() => writeFromAnotherTab(KEY, "640"));
    act(() => result.current[1]((w) => w - 40));

    expect(result.current[0]).toBe(600);
    expect(localStorage.getItem(KEY)).toBe("600");
  });

  it("still honours the value in-tab when storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const { result } = renderHook(() =>
      usePersistentValue(KEY, parseWidth, String),
    );
    act(() => result.current[1](512));

    expect(result.current[0]).toBe(512);
  });

  it("does not re-read on re-render, which is what a stable parse buys", () => {
    // The bug this guards: with an unstable `parse` the effect re-runs every
    // render and re-adopts what storage holds — which, after a write storage
    // refused, is the *old* value, so the preference the hook promised to honour
    // in-tab would snap back on the next unrelated render.
    localStorage.setItem(KEY, "300");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const { result, rerender } = renderHook(() =>
      usePersistentValue(KEY, parseWidth, String),
    );
    act(() => result.current[1](512));
    rerender();

    expect(result.current[0]).toBe(512);
  });

  it("works for a string enum as readily as for a number", () => {
    const parseMode = (raw: string | null) =>
      raw === "recent" ? "recent" : "alphabetical";
    const key: PreferenceName = "vantage:repoSortMode";
    const { result } = renderHook(() =>
      usePersistentValue(key, parseMode, String),
    );

    act(() => result.current[1]("recent"));
    expect(localStorage.getItem(key)).toBe("recent");

    act(() => writeFromAnotherTab(key, "alphabetical"));
    expect(result.current[0]).toBe("alphabetical");
  });

  it("stops listening once unmounted", () => {
    const { result, unmount } = renderHook(() =>
      usePersistentValue(KEY, parseWidth, String),
    );
    const before = result.current[0];

    unmount();
    act(() => writeFromAnotherTab(KEY, "640"));

    expect(result.current[0]).toBe(before);
  });
});
