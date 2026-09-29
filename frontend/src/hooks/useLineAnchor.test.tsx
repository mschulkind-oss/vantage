import { describe, it, expect, beforeAll, vi } from "vitest";
import { useRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { useLineAnchor } from "./useLineAnchor";

beforeAll(() => {
  // jsdom has no scrollTo; the hook smooth-scrolls to the first match.
  Element.prototype.scrollTo = vi.fn();
});

/** Renders four anchorable blocks plus a probe for the router's location. */
function Harness({ to, doc = "doc" }: { to: string; doc?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLineAnchor(ref, doc);
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <span data-testid="loc">{location.pathname + location.hash}</span>
      <button data-testid="go" onClick={() => navigate(to)}>
        go
      </button>
      <div ref={ref} data-doc={doc}>
        <p data-source-line="2">alpha</p>
        <p data-source-line="4">beta</p>
        <p data-source-line="6">gamma</p>
        <p data-source-line="40">delta</p>
      </div>
    </>
  );
}

function renderAt(entry: string, to = "/other.md") {
  const { container } = render(
    <MemoryRouter initialEntries={[entry]}>
      <Harness to={to} />
    </MemoryRouter>,
  );
  const highlighted = () =>
    container.querySelectorAll(".line-anchor-highlight").length;
  const navigateAway = () => fireEvent.click(screen.getByTestId("go"));
  return { container, highlighted, navigateAway };
}

describe("useLineAnchor", () => {
  it("highlights every block inside the anchored range", () => {
    const { highlighted } = renderAt("/doc.md#L1-L10");
    expect(highlighted()).toBe(3); // lines 2, 4, 6 — not 40
  });

  it("clears highlights when the anchor leaves the URL", () => {
    const { highlighted, navigateAway } = renderAt("/doc.md#L1-L10");
    expect(highlighted()).toBe(3);

    navigateAway();

    expect(highlighted()).toBe(0);
  });

  it("strips the anchor from the router's location on Escape", () => {
    const { highlighted } = renderAt("/doc.md#L1-L10");
    expect(highlighted()).toBe(3);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(highlighted()).toBe(0);
    // Left in the URL, the dismissed anchor would re-apply on the next render.
    expect(screen.getByTestId("loc")).toHaveTextContent("/doc.md");
    expect(screen.getByTestId("loc").textContent).not.toContain("#");
  });

  it("leaves a non-line hash alone on Escape", () => {
    renderAt("/doc.md#some-heading");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByTestId("loc").textContent).toBe("/doc.md#some-heading");
  });

  it("waits for the document a new path names before applying its anchor", () => {
    // The viewer keeps showing the previous document until the next one has
    // loaded, so for that while the URL names a document the container is not
    // showing. Applied then, `#L40` highlighted and scrolled the old document,
    // and the one it named arrived with no highlight, wherever the old scroll
    // had left it.
    const scrollTo = vi.mocked(Element.prototype.scrollTo);
    const { container, rerender } = render(
      <MemoryRouter initialEntries={["/a.md"]}>
        <Harness to="/b.md#L40" doc="a" />
      </MemoryRouter>,
    );
    scrollTo.mockClear();
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => {
        cb(0);
        return 0;
      });
    try {
      fireEvent.click(screen.getByTestId("go"));
      expect(container.querySelectorAll(".line-anchor-highlight")).toHaveLength(
        0,
      );
      expect(scrollTo).not.toHaveBeenCalled();

      rerender(
        <MemoryRouter initialEntries={["/a.md"]}>
          <Harness to="/b.md#L40" doc="b" />
        </MemoryRouter>,
      );
      const marked = container.querySelectorAll(".line-anchor-highlight");
      expect(marked).toHaveLength(1);
      expect(marked[0].closest("[data-doc]")).toHaveAttribute("data-doc", "b");
      expect(marked[0]).toHaveTextContent("delta");
      expect(scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      raf.mockRestore();
    }
  });

  it("does not scroll again when the document it is showing updates", () => {
    // A live edit re-renders the same document; the reader keeps their place.
    const scrollTo = vi.mocked(Element.prototype.scrollTo);
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => {
        cb(0);
        return 0;
      });
    try {
      const { rerender } = render(
        <MemoryRouter initialEntries={["/doc.md#L40"]}>
          <Harness to="/other.md" doc="v1" />
        </MemoryRouter>,
      );
      expect(scrollTo).toHaveBeenCalledTimes(1);
      scrollTo.mockClear();
      rerender(
        <MemoryRouter initialEntries={["/doc.md#L40"]}>
          <Harness to="/other.md" doc="v2" />
        </MemoryRouter>,
      );
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
    }
  });

  it("strips the anchor when a highlighted block is clicked", () => {
    const { container, highlighted } = renderAt("/doc.md#L1-L10");
    const block = container.querySelector(".line-anchor-highlight")!;

    fireEvent.click(block);

    expect(highlighted()).toBe(0);
    expect(screen.getByTestId("loc").textContent).not.toContain("#");
  });
});
