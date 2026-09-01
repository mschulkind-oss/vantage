import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { AnchoredMenu } from "./AnchoredMenu";

/**
 * A trigger plus a menu, wired the way the real callers wire it.
 *
 * `onClose` is a spy rather than real state so a test can tell "asked to close"
 * apart from "closed", which is the distinction the trigger-click case turns on.
 */
function Harness({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ overflow: "hidden" }}>
      <button ref={ref} onClick={() => setOpen(true)}>
        Open
      </button>
      <AnchoredMenu
        open={open}
        onClose={onClose}
        anchorRef={ref}
        width={224}
        aria-label="Test menu"
      >
        <button>Item</button>
      </AnchoredMenu>
    </div>
  );
}

describe("AnchoredMenu", () => {
  it("renders nothing until it is opened", () => {
    render(<Harness onClose={vi.fn()} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("portals the panel to the body, escaping the clipping ancestor", () => {
    // The whole reason this component exists: the sidebar's ancestors are
    // overflow-hidden, so a panel rendered in place gets its overflowing edge
    // clipped no matter how good the arithmetic is.
    const { container } = render(<Harness onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Open"));

    const menu = screen.getByRole("menu");
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
    // The class, not a computed style: jsdom loads no stylesheet, so Tailwind's
    // `fixed` never resolves to a real position value here.
    expect(menu.className).toContain("fixed");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText("Open"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on a click outside", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText("Open"));

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close on a click inside the panel", () => {
    // The panel is portaled out of the trigger's subtree, so a naive
    // "is it inside my container" test would treat its own items as outside
    // and close the menu before the click landed.
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText("Open"));

    fireEvent.mouseDown(screen.getByText("Item"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close on a click on its own trigger", () => {
    // Otherwise the trigger's own click closes and immediately reopens, and the
    // menu can never be dismissed by clicking the button again.
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText("Open"));

    fireEvent.mouseDown(screen.getByText("Open"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("places itself against the trigger and reveals itself once measured", () => {
    render(<Harness onClose={vi.fn()} />);
    const trigger = screen.getByText("Open");
    // jsdom reports a zero rect for everything, so the anchor is stubbed to give
    // the positioner something real to work from.
    trigger.getBoundingClientRect = () =>
      ({ left: 900, right: 928, top: 100, bottom: 128 }) as DOMRect;

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");

    // Right-aligned to the trigger, just below it — and visible, which only
    // happens after the measuring pass has run.
    expect(menu.style.left).toBe(`${928 - 224}px`);
    expect(menu.style.top).toBe("132px");
    expect(menu.style.visibility).toBe("visible");
  });
});
