import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { prefetchPlanningPage } from "./usePlanningPageInputs";
import React from "react";

vi.mock("./usePlanningPageInputs", () => ({ prefetchPlanningPage: vi.fn() }));

describe("useKeyboardShortcuts", () => {
  const mockCallbacks = {
    onOpenFilePicker: vi.fn(),
    onOpenRecentFiles: vi.fn(),
    onOpenGlobalRecentFiles: vi.fn(),
    onToggleSidebar: vi.fn(),
    onNavigate: vi.fn(),
    onViewDiff: vi.fn(),
    onViewHistory: vi.fn(),
    onCopyPath: vi.fn(),
    onEscape: vi.fn(),
    contentScrollRef: {
      current: null,
    } as React.RefObject<HTMLDivElement | null>,
    isMultiRepo: false,
    currentRepo: null,
    enabled: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const fireKey = (key: string, opts: Partial<KeyboardEventInit> = {}) => {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, ...opts }),
      );
    });
  };

  it("opens shortcuts modal on ? key", () => {
    const { result } = renderHook(() => useKeyboardShortcuts(mockCallbacks));
    expect(result.current.shortcutsOpen).toBe(false);
    fireKey("?");
    expect(result.current.shortcutsOpen).toBe(true);
  });

  it("fires onEscape when nothing of its own is open", () => {
    // Raw view is the caller's to close, and it reads as a mode even though it
    // is a toggle — Escape has to leave it.
    renderHook(() => useKeyboardShortcuts(mockCallbacks));
    fireKey("Escape");
    expect(mockCallbacks.onEscape).toHaveBeenCalledTimes(1);
  });

  it("closes its own modal on Escape instead of firing onEscape", () => {
    // One Escape must not close the modal *and* leave raw view underneath it.
    const { result } = renderHook(() => useKeyboardShortcuts(mockCallbacks));
    fireKey("?");
    expect(result.current.shortcutsOpen).toBe(true);

    fireKey("Escape");
    expect(result.current.shortcutsOpen).toBe(false);
    expect(mockCallbacks.onEscape).not.toHaveBeenCalled();

    // And the next one reaches the caller, now that the modal is gone.
    fireKey("Escape");
    expect(mockCallbacks.onEscape).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenFilePicker on t key", () => {
    // The caller refetches the file list in this callback, so the key has to
    // reach it on every press — a picker that only ever loaded its list once
    // could not find a file created after the tab was opened.
    renderHook(() => useKeyboardShortcuts(mockCallbacks));
    fireKey("t");
    fireKey("t");
    expect(mockCallbacks.onOpenFilePicker).toHaveBeenCalledTimes(2);
  });

  it("opens this project's recents on r and every project's on Shift+R", () => {
    renderHook(() => useKeyboardShortcuts(mockCallbacks));
    fireKey("r");
    expect(mockCallbacks.onOpenRecentFiles).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onOpenGlobalRecentFiles).not.toHaveBeenCalled();

    fireKey("R", { shiftKey: true });
    expect(mockCallbacks.onOpenGlobalRecentFiles).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onOpenRecentFiles).toHaveBeenCalledTimes(1);
  });

  it("toggles sidebar on b key", () => {
    renderHook(() => useKeyboardShortcuts(mockCallbacks));
    fireKey("b");
    expect(mockCallbacks.onToggleSidebar).toHaveBeenCalled();
  });

  it("calls onViewDiff on d key", () => {
    renderHook(() => useKeyboardShortcuts(mockCallbacks));
    fireKey("d");
    expect(mockCallbacks.onViewDiff).toHaveBeenCalled();
  });

  it("calls onViewHistory on h key", () => {
    renderHook(() => useKeyboardShortcuts(mockCallbacks));
    fireKey("h");
    expect(mockCallbacks.onViewHistory).toHaveBeenCalled();
  });

  it("calls onCopyPath on y key", () => {
    renderHook(() => useKeyboardShortcuts(mockCallbacks));
    fireKey("y");
    expect(mockCallbacks.onCopyPath).toHaveBeenCalled();
  });

  it("navigates home on g then h sequence", async () => {
    renderHook(() => useKeyboardShortcuts(mockCallbacks));
    fireKey("g");
    fireKey("h");
    expect(mockCallbacks.onNavigate).toHaveBeenCalledWith("/");
  });

  it("navigates to recents on g then r sequence", () => {
    renderHook(() => useKeyboardShortcuts(mockCallbacks));
    fireKey("g");
    fireKey("r");
    expect(mockCallbacks.onNavigate).toHaveBeenCalledWith("/recent");
  });

  // docs/reference/planning-index.md §6: `g p`, beside `g h` and `g r`.
  it("navigates to the planning page on g then p sequence", () => {
    renderHook(() => useKeyboardShortcuts(mockCallbacks));
    fireKey("g");
    fireKey("p");
    expect(mockCallbacks.onNavigate).toHaveBeenCalledWith("/.vantage/planning");
  });

  it("navigates to the current repository's planning page in daemon mode", () => {
    renderHook(() =>
      useKeyboardShortcuts({
        ...mockCallbacks,
        isMultiRepo: true,
        currentRepo: "alpha",
      }),
    );
    fireKey("g");
    fireKey("p");
    expect(mockCallbacks.onNavigate).toHaveBeenCalledWith(
      "/.vantage/planning/alpha",
    );
  });

  // planning-index.md §6.4: page 1's inputs are asked for on the
  // `g`, and the gap before the `p` hides the requests.
  it("asks for the planning page's first page on the g of a chord", () => {
    renderHook(() => useKeyboardShortcuts(mockCallbacks));
    fireKey("g");
    expect(prefetchPlanningPage).toHaveBeenCalledWith("");
    fireKey("p");
    expect(prefetchPlanningPage).toHaveBeenCalledTimes(1);
  });

  it("asks for the current repository's in daemon mode, and nothing without one", () => {
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts({
        ...mockCallbacks,
        isMultiRepo: true,
        currentRepo: "alpha",
      }),
    );
    fireKey("g");
    expect(prefetchPlanningPage).toHaveBeenCalledWith("alpha");
    fireKey("Escape");
    unmount();
    vi.mocked(prefetchPlanningPage).mockClear();
    renderHook(() =>
      useKeyboardShortcuts({ ...mockCallbacks, isMultiRepo: true }),
    );
    fireKey("g");
    expect(prefetchPlanningPage).not.toHaveBeenCalled();
  });

  it("ignores shortcuts when modifier keys are held", () => {
    renderHook(() => useKeyboardShortcuts(mockCallbacks));
    fireKey("b", { ctrlKey: true });
    expect(mockCallbacks.onToggleSidebar).not.toHaveBeenCalled();
  });

  it("ignores shortcuts when input is focused", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    renderHook(() => useKeyboardShortcuts(mockCallbacks));
    fireKey("b");
    expect(mockCallbacks.onToggleSidebar).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  // docs/reference/planning-index.md §6.17: `/` focuses the planning page's
  // Filter box, and on any other page is left to the browser, which opens
  // Firefox's quick find with it.
  const slash = () => {
    const event = new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(event);
    });
    return event;
  };

  it("focuses a page's filter box on /, which it keeps from the browser", () => {
    const onFocusFilter = vi.fn();
    renderHook(() => useKeyboardShortcuts({ ...mockCallbacks, onFocusFilter }));
    expect(slash().defaultPrevented).toBe(true);
    expect(onFocusFilter).toHaveBeenCalledTimes(1);
  });

  it("closes the shortcuts help before focusing the filter box on /, so the focus is never behind it", () => {
    // The help lists `/` on the planning page, and is a modal over it: what
    // the reader typed next went into a box they could not see.
    const onFocusFilter = vi.fn();
    const { result } = renderHook(() =>
      useKeyboardShortcuts({ ...mockCallbacks, onFocusFilter }),
    );
    fireKey("?");
    expect(result.current.shortcutsOpen).toBe(true);
    expect(slash().defaultPrevented).toBe(true);
    expect(result.current.shortcutsOpen).toBe(false);
    expect(onFocusFilter).toHaveBeenCalledTimes(1);
  });

  it("leaves / to the browser on a page with no filter box", () => {
    renderHook(() => useKeyboardShortcuts(mockCallbacks));
    expect(slash().defaultPrevented).toBe(false);
  });

  it("leaves / alone while an input has the focus, or with the shortcuts off", () => {
    const onFocusFilter = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts({ ...mockCallbacks, onFocusFilter, enabled: false }),
    );
    expect(slash().defaultPrevented).toBe(false);
    unmount();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    renderHook(() => useKeyboardShortcuts({ ...mockCallbacks, onFocusFilter }));
    // Typed in a text field, `/` is a path character.
    expect(slash().defaultPrevented).toBe(false);
    document.body.removeChild(input);
    expect(onFocusFilter).not.toHaveBeenCalled();
  });

  it("does not fire shortcuts when disabled", () => {
    renderHook(() =>
      useKeyboardShortcuts({ ...mockCallbacks, enabled: false }),
    );
    fireKey("b");
    fireKey("?");
    expect(mockCallbacks.onToggleSidebar).not.toHaveBeenCalled();
  });
});
