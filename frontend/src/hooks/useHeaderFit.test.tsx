import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHeaderFit } from "./useHeaderFit";

/**
 * jsdom does no layout, so the header here is laid out by hand: its content
 * edge is `layout.width`, and the breadcrumb's right edge is 10px a character
 * of the name until the folders collapse. That is enough for the one question
 * this file asks — whether the hook re-fits when it should.
 */
const layout = { width: 1000 };
let resizeCallbacks: Array<() => void> = [];

function Header({ name }: { name: string }) {
  const ref = useHeaderFit();
  return (
    <div ref={ref} data-testid="header">
      <div className="hdr-lead" data-name={name}>
        {name}
      </div>
      <div className="hdr-tools" />
    </div>
  );
}

beforeEach(() => {
  resizeCallbacks = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        resizeCallbacks.push(cb);
      }
      observe() {}
      disconnect() {
        resizeCallbacks = [];
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset.testid === "header") {
        return { right: layout.width } as DOMRect;
      }
      if (this.classList.contains("hdr-lead")) {
        const header = this.parentElement!;
        const collapsed = (header.dataset.yield ?? "").includes("dirs");
        const width = (this.textContent ?? "").length * 10;
        return { right: collapsed ? width / 2 : width } as DOMRect;
      }
      return { right: 0 } as DOMRect;
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  layout.width = 1000;
});

const yieldOf = (el: HTMLElement) => el.dataset.yield;

describe("useHeaderFit", () => {
  it("fits the header the moment it is attached", () => {
    layout.width = 150;
    const { getByTestId } = render(<Header name={"x".repeat(20)} />);
    expect(yieldOf(getByTestId("header"))).toBe("subject date labels dirs");
  });

  it("re-fits when what the header holds changes", async () => {
    const { getByTestId, rerender } = render(<Header name="short" />);
    expect(yieldOf(getByTestId("header"))).toBe("");

    // A longer name is a DOM change, not a resize: the header's own box is
    // the same size, so only the mutation observer can see it.
    rerender(<Header name={"x".repeat(150)} />);
    await act(async () => {});
    expect(yieldOf(getByTestId("header"))).toBe("subject date labels dirs");
  });

  it("re-fits when the header is resized", () => {
    layout.width = 150;
    const { getByTestId } = render(<Header name={"x".repeat(20)} />);
    expect(yieldOf(getByTestId("header"))).not.toBe("");

    layout.width = 1000;
    act(() => resizeCallbacks.forEach((cb) => cb()));
    expect(yieldOf(getByTestId("header"))).toBe("");
  });

  it("stops observing once the header is gone", () => {
    const { unmount } = render(<Header name="short" />);
    expect(resizeCallbacks).toHaveLength(1);
    unmount();
    expect(resizeCallbacks).toHaveLength(0);
  });
});
