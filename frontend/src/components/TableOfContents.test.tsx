/**
 * The table of contents panel and the heading collection behind it.
 *
 * The headings are read out of the rendered DOM rather than re-derived from the
 * Markdown source, so the fixtures here are shaped like what `MarkdownViewer`
 * actually emits: an `id` on every heading and a literal `#` anchor link inside
 * it. That anchor is why `headingText` exists — plain `textContent` on a
 * rendered heading reads "#Overview".
 */

import React, { useRef } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TableOfContents } from "./TableOfContents";
import {
  activeHeadingId,
  collectHeadings,
  measureHeadingOffsets,
} from "../hooks/useDocumentHeadings";

/** A rendered document, as `MarkdownViewer` leaves it in the DOM. */
function documentHTML(): string {
  return `
    <h1 id="title" class="group relative"><a href="#title" class="heading-anchor">#</a>Title</h1>
    <p>Intro</p>
    <h2 id="first" class="group relative"><a href="#first" class="heading-anchor">#</a>First section</h2>
    <h3 id="nested" class="group relative"><a href="#nested" class="heading-anchor">#</a>Nested</h3>
    <h2 id="second" class="group relative"><a href="#second" class="heading-anchor">#</a>Second section</h2>
    <h2>Unlinkable</h2>
  `;
}

function Harness({ open = true }: { open?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <TableOfContents containerRef={ref} open={open} />
      <div ref={ref} dangerouslySetInnerHTML={{ __html: documentHTML() }} />
    </div>
  );
}

describe("collectHeadings", () => {
  it("reads level, id and text, dropping the anchor link", () => {
    const container = document.createElement("div");
    container.innerHTML = documentHTML();

    expect(collectHeadings(container)).toEqual([
      { id: "title", text: "Title", level: 1 },
      { id: "first", text: "First section", level: 2 },
      { id: "nested", text: "Nested", level: 3 },
      { id: "second", text: "Second section", level: 2 },
    ]);
  });

  it("skips a heading with no id, which nothing could link to", () => {
    const container = document.createElement("div");
    container.innerHTML = documentHTML();
    expect(collectHeadings(container).map((h) => h.text)).not.toContain(
      "Unlinkable",
    );
  });

  it("does not invent headings from a fenced code block", () => {
    // The rendered form of ```\n# not a heading\n``` — text, not an <h1>.
    const container = document.createElement("div");
    container.innerHTML = `<pre><code># not a heading</code></pre>`;
    expect(collectHeadings(container)).toEqual([]);
  });
});

describe("measureHeadingOffsets", () => {
  /**
   * jsdom has no layout engine, so a plain node's `getBoundingClientRect`
   * and `offsetParent` are stubbed by hand here to stand in for what a real
   * browser would compute — a rendered heading at some position, or one
   * `display: none` has taken out of flow.
   */
  function stubRendered(el: HTMLElement, top: number) {
    el.getBoundingClientRect = () => ({ top }) as unknown as DOMRect;
    Object.defineProperty(el, "offsetParent", {
      configurable: true,
      get: () => document.body,
    });
  }
  function stubHidden(el: HTMLElement) {
    el.getBoundingClientRect = () => ({ top: 0 }) as unknown as DOMRect;
    Object.defineProperty(el, "offsetParent", {
      configurable: true,
      get: () => null,
    });
  }

  it("measures each heading's offset from the container's top", () => {
    const container = document.createElement("div");
    stubRendered(container, 0);
    const h1 = document.createElement("h1");
    h1.id = "a";
    stubRendered(h1, 140);
    container.append(h1);

    expect(
      measureHeadingOffsets(container, [{ id: "a", text: "A", level: 1 }]),
    ).toEqual([{ id: "a", top: 140 }]);
  });

  it("resolves an id within the container, not the whole document", () => {
    // A collision this is specifically guarding against: id="root" also
    // names the app's own mount point, which sits outside — and, in
    // document order, before — the content container.
    const outer = document.createElement("div");
    outer.id = "root";
    document.body.append(outer);

    const container = document.createElement("div");
    stubRendered(container, 0);
    const heading = document.createElement("h1");
    heading.id = "root";
    stubRendered(heading, 64);
    container.append(heading);
    document.body.append(container);

    try {
      expect(
        measureHeadingOffsets(container, [
          { id: "root", text: "Root", level: 1 },
        ]),
      ).toEqual([{ id: "root", top: 64 }]);
    } finally {
      outer.remove();
      container.remove();
    }
  });

  it("excludes a heading that is not rendered (a closed collapsed section)", () => {
    const container = document.createElement("div");
    stubRendered(container, 0);
    const visible = document.createElement("h1");
    visible.id = "visible";
    stubRendered(visible, 50);
    const hidden = document.createElement("h2");
    hidden.id = "hidden";
    stubHidden(hidden);
    container.append(visible, hidden);

    expect(
      measureHeadingOffsets(container, [
        { id: "visible", text: "Visible", level: 1 },
        { id: "hidden", text: "Hidden", level: 2 },
      ]),
    ).toEqual([{ id: "visible", top: 50 }]);
  });

  it("skips an id with no matching element", () => {
    const container = document.createElement("div");
    stubRendered(container, 0);
    expect(
      measureHeadingOffsets(container, [
        { id: "missing", text: "Missing", level: 1 },
      ]),
    ).toEqual([]);
  });
});

describe("activeHeadingId", () => {
  it("is the last heading at or above the band", () => {
    expect(
      activeHeadingId([
        { id: "a", top: -400 },
        { id: "b", top: -20 },
        { id: "c", top: 500 },
      ]),
    ).toBe("b");
  });

  it("is the first heading when the reader is above all of them", () => {
    expect(
      activeHeadingId([
        { id: "a", top: 300 },
        { id: "b", top: 900 },
      ]),
    ).toBe("a");
  });

  it("is null with no headings", () => {
    expect(activeHeadingId([])).toBeNull();
  });
});

/**
 * A single real JSX heading, not `dangerouslySetInnerHTML`: re-rendering this
 * with a new `text`/`id` goes through React's own reconciler, which patches
 * the existing DOM node's `id` attribute and text node in place rather than
 * replacing it — exactly what live reload does to a heading whose position
 * in the tree is unchanged, and exactly the case a MutationObserver
 * listening only for childList mutations cannot see.
 */
function LiveHeading({ text, id }: { text: string; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <TableOfContents containerRef={ref} open />
      <div ref={ref}>
        <h2 id={id}>{text}</h2>
      </div>
    </div>
  );
}

describe("TableOfContents", () => {
  beforeEach(() => {
    // jsdom has no MutationObserver callback scheduling worth waiting on here;
    // the initial scan is what these assertions are about.
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback) =>
        setTimeout(() => cb(0), 0) as unknown as number,
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders nothing when closed", () => {
    render(<Harness open={false} />);
    expect(screen.queryByTestId("table-of-contents")).toBeNull();
  });

  it("lists the document's headings when open", () => {
    render(<Harness />);
    expect(screen.getByTestId("table-of-contents")).toBeTruthy();
    expect(screen.getByRole("link", { name: "First section" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Nested" })).toBeTruthy();
  });

  it("indents by depth, relative to the document's shallowest heading", () => {
    render(<Harness />);
    const h1 = screen.getByRole("link", { name: "Title" });
    const h2 = screen.getByRole("link", { name: "First section" });
    const h3 = screen.getByRole("link", { name: "Nested" });
    expect(h1.style.paddingLeft).toBe("8px");
    expect(h2.style.paddingLeft).toBe("20px");
    expect(h3.style.paddingLeft).toBe("32px");
  });

  it("scrolls to a heading and puts it in the URL", () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    render(<Harness />);

    act(() => {
      fireEvent.click(screen.getByRole("link", { name: "Second section" }));
    });

    expect(replaceState).toHaveBeenCalledWith(null, "", "#second");
    replaceState.mockRestore();
  });

  it("carries no surface of its own — no panel, border or background", () => {
    render(<Harness />);
    const toc = screen.getByTestId("table-of-contents");
    const classes = `${toc.className} ${toc.querySelector("nav")?.className ?? ""}`;
    expect(classes).not.toMatch(/\bbg-|\bborder\b|\bborder-[rltb]\b|shadow/);
  });

  it("picks up a heading whose text and id changed in place", async () => {
    const { rerender } = render(
      <LiveHeading text="Old Heading" id="old-heading" />,
    );
    await screen.findByRole("link", { name: "Old Heading" });

    act(() => {
      rerender(<LiveHeading text="New Heading" id="new-heading" />);
    });

    await screen.findByRole("link", { name: "New Heading" });
    expect(screen.queryByRole("link", { name: "Old Heading" })).toBeNull();
    expect(screen.getByRole("link", { name: "New Heading" })).toHaveAttribute(
      "href",
      "#new-heading",
    );
  });

  it("says so when the document has no headings", () => {
    function Empty() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div>
          <TableOfContents containerRef={ref} open />
          <div ref={ref}>
            <p>Just prose.</p>
          </div>
        </div>
      );
    }
    render(<Empty />);
    expect(screen.getByText("No headings in this document.")).toBeTruthy();
  });
});
