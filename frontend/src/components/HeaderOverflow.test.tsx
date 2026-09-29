import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HeaderOverflow } from "./HeaderOverflow";

// jsdom applies none of index.css, so every button here is "drawn": what is
// tested is the disclosure's own behavior, and which of its halves the reader
// sees at a given width is the header e2e spec's to check.
function renderOverflow() {
  return render(
    <div>
      <HeaderOverflow extra={<button type="button">Show contents</button>}>
        <button type="button">Path</button>
        <a href="/history/notes.md">2 commits</a>
      </HeaderOverflow>
      <button type="button">After</button>
    </div>,
  );
}

const more = () => screen.getByRole("button", { name: "Toolbar actions" });

describe("HeaderOverflow", () => {
  it("renders the actions once, and what folds in with them only when open", () => {
    renderOverflow();
    expect(screen.getAllByRole("button", { name: "Path" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Show contents" })).toBeNull();
    expect(more()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(more());
    expect(more()).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getAllByRole("button", { name: "Show contents" }),
    ).toHaveLength(1);
    expect(more().closest(".hdr-overflow")).toHaveAttribute("data-open");
  });

  it("puts focus on the first control, and moves with the arrow keys", () => {
    renderOverflow();
    fireEvent.click(more());
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Show contents" }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Path" }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "2 commits" }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Show contents" }),
    );
  });

  it("closes on Escape with focus back on the ⋯", () => {
    renderOverflow();
    fireEvent.click(more());
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(more()).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(more());
  });

  it("closes when focus leaves it, or a click lands outside it", () => {
    renderOverflow();
    fireEvent.click(more());
    const after = screen.getByRole("button", { name: "After" });
    fireEvent.blur(screen.getByRole("button", { name: "Path" }), {
      relatedTarget: after,
    });
    expect(more()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(more());
    fireEvent.mouseDown(after);
    expect(more()).toHaveAttribute("aria-expanded", "false");
  });

  it("stays open for a button, which may be a confirm, and closes for a link", () => {
    renderOverflow();
    fireEvent.click(more());
    fireEvent.click(screen.getByRole("button", { name: "Path" }));
    expect(more()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("link", { name: "2 commits" }));
    expect(more()).toHaveAttribute("aria-expanded", "false");
  });
});
