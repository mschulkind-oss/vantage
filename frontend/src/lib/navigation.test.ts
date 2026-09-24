import { describe, it, expect, vi } from "vitest";
import {
  isNewTabEnter,
  openInNewTab,
  shouldHandleInternalNavigation,
} from "./navigation";

describe("shouldHandleInternalNavigation", () => {
  const createMouseEvent = (
    overrides: Partial<MouseEvent> = {},
  ): MouseEvent => {
    return {
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...overrides,
    } as MouseEvent;
  };

  it("returns true for regular left click", () => {
    const event = createMouseEvent();
    expect(shouldHandleInternalNavigation(event)).toBe(true);
  });

  it("returns false when Ctrl key is pressed (open in new tab)", () => {
    const event = createMouseEvent({ ctrlKey: true });
    expect(shouldHandleInternalNavigation(event)).toBe(false);
  });

  it("returns false when Meta/Cmd key is pressed (open in new tab on Mac)", () => {
    const event = createMouseEvent({ metaKey: true });
    expect(shouldHandleInternalNavigation(event)).toBe(false);
  });

  it("returns false when Shift key is pressed (open in new window)", () => {
    const event = createMouseEvent({ shiftKey: true });
    expect(shouldHandleInternalNavigation(event)).toBe(false);
  });

  it("returns false for middle mouse button click (button=1)", () => {
    const event = createMouseEvent({ button: 1 });
    expect(shouldHandleInternalNavigation(event)).toBe(false);
  });

  it("returns false for right mouse button click (button=2)", () => {
    const event = createMouseEvent({ button: 2 });
    expect(shouldHandleInternalNavigation(event)).toBe(false);
  });

  it("returns false when multiple modifier keys are pressed", () => {
    const event = createMouseEvent({ ctrlKey: true, shiftKey: true });
    expect(shouldHandleInternalNavigation(event)).toBe(false);
  });
});

describe("isNewTabEnter", () => {
  const key = (overrides: Partial<KeyboardEvent> = {}): KeyboardEvent =>
    ({
      key: "Enter",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...overrides,
    }) as KeyboardEvent;

  it("is false for a plain Enter", () => {
    expect(isNewTabEnter(key())).toBe(false);
  });

  it.each(["altKey", "ctrlKey", "metaKey"] as const)(
    "is true for Enter with %s",
    (mod) => {
      expect(isNewTabEnter(key({ [mod]: true }))).toBe(true);
    },
  );

  it("is false for a modified key that is not Enter", () => {
    expect(isNewTabEnter(key({ key: "t", ctrlKey: true }))).toBe(false);
  });
});

describe("openInNewTab", () => {
  it("opens the route in a new tab without an opener", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openInNewTab("/repo/docs/a.md");
    expect(open).toHaveBeenCalledWith("/repo/docs/a.md", "_blank", "noopener");
    open.mockRestore();
  });
});
