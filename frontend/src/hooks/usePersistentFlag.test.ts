/**
 * Cross-tab sync for the viewer's remembered boolean preferences.
 *
 * jsdom gives us exactly the half of the browser contract that matters here: a
 * `setItem` in this window raises no `storage` event (so the hook cannot hear
 * its own writes, just as in Chrome), while a hand-dispatched `StorageEvent`
 * carries `storageArea` through faithfully. So "another tab wrote this" is
 * modelled the only way it can be — by dispatching the event a real second tab
 * would have caused, after putting the value in storage the way that tab did.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { usePersistentFlag } from "./usePersistentFlag";

const KEY = "vantage:testFlag";

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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePersistentFlag", () => {
  describe("reading the stored value", () => {
    it("falls back when the key is absent", () => {
      const { result } = renderHook(() => usePersistentFlag(KEY));
      expect(result.current[0]).toBe(false);

      const { result: withTrue } = renderHook(() =>
        usePersistentFlag(KEY, true),
      );
      expect(withTrue.current[0]).toBe(true);
    });

    it("reads the string format the viewer already wrote", () => {
      localStorage.setItem(KEY, "true");
      expect(renderHook(() => usePersistentFlag(KEY)).result.current[0]).toBe(
        true,
      );

      localStorage.setItem(KEY, "false");
      expect(
        renderHook(() => usePersistentFlag(KEY, true)).result.current[0],
      ).toBe(false);
    });

    it("treats an unrecognised value as the fallback, not as true", () => {
      localStorage.setItem(KEY, "yes please");
      expect(
        renderHook(() => usePersistentFlag(KEY, true)).result.current[0],
      ).toBe(true);
      expect(renderHook(() => usePersistentFlag(KEY)).result.current[0]).toBe(
        false,
      );
    });
  });

  describe("writing", () => {
    it("persists the new value", () => {
      const { result } = renderHook(() => usePersistentFlag(KEY));

      act(() => result.current[1](true));

      expect(result.current[0]).toBe(true);
      expect(localStorage.getItem(KEY)).toBe("true");
    });

    it("composes updater functions within one tick", () => {
      const { result } = renderHook(() => usePersistentFlag(KEY));
      const toggle = result.current[1];

      act(() => {
        toggle((v) => !v);
        toggle((v) => !v);
        toggle((v) => !v);
      });

      expect(result.current[0]).toBe(true);
      expect(localStorage.getItem(KEY)).toBe("true");
    });

    it("still honours the preference in-tab when storage cannot be written", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

      const { result } = renderHook(() => usePersistentFlag(KEY));
      act(() => result.current[1](true));

      expect(result.current[0]).toBe(true);
    });

    it("falls back rather than throwing when storage cannot be read", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });

      expect(
        renderHook(() => usePersistentFlag(KEY, true)).result.current[0],
      ).toBe(true);
    });
  });

  describe("another tab changing the value", () => {
    it("adopts the incoming value", () => {
      const { result } = renderHook(() => usePersistentFlag(KEY));

      act(() => writeFromAnotherTab(KEY, "true"));
      expect(result.current[0]).toBe(true);

      act(() => writeFromAnotherTab(KEY, "false"));
      expect(result.current[0]).toBe(false);
    });

    it("leaves a later local toggle working from the adopted value", () => {
      const { result } = renderHook(() => usePersistentFlag(KEY));

      act(() => writeFromAnotherTab(KEY, "true"));
      act(() => result.current[1]((v) => !v));

      expect(result.current[0]).toBe(false);
      expect(localStorage.getItem(KEY)).toBe("false");
    });

    it("ignores writes to a different key", () => {
      const { result } = renderHook(() => usePersistentFlag(KEY, true));

      act(() => writeFromAnotherTab("vantage:somethingElse", "false"));

      expect(result.current[0]).toBe(true);
    });

    it("ignores sessionStorage writes, which raise the same event", () => {
      const { result } = renderHook(() => usePersistentFlag(KEY, true));

      act(() =>
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: KEY,
            newValue: "false",
            storageArea: sessionStorage,
          }),
        ),
      );

      expect(result.current[0]).toBe(true);
    });

    it("returns to the fallback when the key is removed", () => {
      localStorage.setItem(KEY, "false");
      const { result } = renderHook(() => usePersistentFlag(KEY, true));
      expect(result.current[0]).toBe(false);

      act(() => writeFromAnotherTab(KEY, null));

      expect(result.current[0]).toBe(true);
    });

    it("returns to the fallback on a clear(), which reports a null key", () => {
      localStorage.setItem(KEY, "true");
      const { result } = renderHook(() => usePersistentFlag(KEY));
      expect(result.current[0]).toBe(true);

      act(() => {
        localStorage.clear();
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: null,
            newValue: null,
            storageArea: localStorage,
          }),
        );
      });

      expect(result.current[0]).toBe(false);
    });

    it("stops listening once unmounted", () => {
      const { result, unmount } = renderHook(() => usePersistentFlag(KEY));
      const before = result.current[0];

      unmount();
      act(() => writeFromAnotherTab(KEY, "true"));

      expect(result.current[0]).toBe(before);
    });
  });

  it("keeps two mounted readers of one key in step", () => {
    const a = renderHook(() => usePersistentFlag(KEY));
    const b = renderHook(() => usePersistentFlag(KEY));

    // A local write is deliberately not broadcast to same-document listeners —
    // the browser does not raise `storage` for them either. Only a real second
    // tab's event syncs, which is what the hook promises.
    act(() => writeFromAnotherTab(KEY, "true"));

    expect(a.result.current[0]).toBe(true);
    expect(b.result.current[0]).toBe(true);
  });
});
