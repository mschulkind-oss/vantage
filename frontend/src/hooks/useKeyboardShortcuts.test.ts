import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import React from "react";

describe("useKeyboardShortcuts", () => {
  const mockCallbacks = {
    onOpenFilePicker: vi.fn(),
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

  it("does not fire shortcuts when disabled", () => {
    renderHook(() =>
      useKeyboardShortcuts({ ...mockCallbacks, enabled: false }),
    );
    fireKey("b");
    fireKey("?");
    expect(mockCallbacks.onToggleSidebar).not.toHaveBeenCalled();
  });
});
