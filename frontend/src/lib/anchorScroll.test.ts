/**
 * The reveal-then-measure order, and the guard that keeps a fourth caller from
 * re-deriving it.
 *
 * jsdom has no layout, so the geometry these functions compute is untestable
 * here (measured in Chrome instead: a `display: none` target's rect is all
 * zeros, and the reveal below makes it real without a `requestAnimationFrame`).
 * What is testable is the half that was actually missing — that the collapsed
 * section is opened *before* the box is read, and that no caller resolves an
 * anchor id on its own.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import {
  anchorTarget,
  scrollToAnchor,
  scrollToAnchorElement,
} from "./anchorScroll";
import {
  COLLAPSED_ATTR,
  COLLAPSE_GROUP_ATTR,
  COLLAPSE_READY_ATTR,
  COLLAPSE_TOGGLE_ATTR,
} from "./collapseSections";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

/**
 * A prose container with one collapsed section the toggle JS has armed.
 *
 * The body is cleared first because jsdom resolves a scoped `querySelector("#x")`
 * through the document's id map and then checks containment, so a leftover
 * fixture with the same ids makes the fresh one unfindable.
 */
function collapsedSection(): { scroller: HTMLElement; target: HTMLElement } {
  document.body.innerHTML = "";
  const scroller = document.createElement("div");
  scroller.setAttribute("data-content-scroll", "");
  scroller.scrollTo = vi.fn() as unknown as HTMLElement["scrollTo"];
  scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  scroller.innerHTML = `
    <div ${COLLAPSE_READY_ATTR}="true">
      <h2 ${COLLAPSE_TOGGLE_ATTR}="1" id="outer">Outer</h2>
      <h3 ${COLLAPSED_ATTR}="true" ${COLLAPSE_GROUP_ATTR}="1" id="inner">Inner</h3>
    </div>`;
  document.body.append(scroller);
  return { scroller, target: scroller.querySelector<HTMLElement>("#inner")! };
}

describe("anchorTarget", () => {
  it("prefers the plain id and falls back to the sanitiser's clobbered one", () => {
    document.body.innerHTML = `
      <p id="plain">a</p>
      <p id="user-content-clobbered">b</p>`;

    expect(anchorTarget("plain")!.id).toBe("plain");
    expect(anchorTarget("clobbered")!.id).toBe("user-content-clobbered");
    expect(anchorTarget("missing")).toBeNull();
    expect(anchorTarget("")).toBeNull();
  });
});

describe("scrollToAnchorElement", () => {
  it("opens the collapsed section BEFORE it measures the target", () => {
    // The ordering is the defect. Reading the box first measures zero and the
    // reader is scrolled somewhere unrelated, with the target still hidden.
    const { target } = collapsedSection();
    let collapsedWhenMeasured: string | null = "unmeasured";
    target.getBoundingClientRect = () => {
      collapsedWhenMeasured = target.getAttribute(COLLAPSED_ATTR);
      return { top: 300 } as DOMRect;
    };

    scrollToAnchorElement(target);

    expect(collapsedWhenMeasured).toBe("false");
    expect(target.getAttribute(COLLAPSED_ATTR)).toBe("false");
  });

  it("scrolls the container the caller passed, offset by the anchor margin", () => {
    const { scroller, target } = collapsedSection();
    target.getBoundingClientRect = () => ({ top: 300 }) as DOMRect;

    scrollToAnchorElement(target, scroller);

    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 284 });
  });

  it("leaves a target nothing is hiding alone", () => {
    const { scroller } = collapsedSection();
    const open = scroller.querySelector<HTMLElement>("#outer")!;
    open.getBoundingClientRect = () => ({ top: 40 }) as DOMRect;

    scrollToAnchorElement(open);

    expect(open.hasAttribute(COLLAPSED_ATTR)).toBe(false);
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 24 });
  });
});

describe("scrollToAnchor", () => {
  it("reports whether the document had anything at that id", () => {
    const { target } = collapsedSection();
    target.getBoundingClientRect = () => ({ top: 10 }) as DOMRect;

    expect(scrollToAnchor("inner")).toBe(true);
    expect(target.getAttribute(COLLAPSED_ATTR)).toBe("false");
    expect(scrollToAnchor("nothing-here")).toBe(false);
  });
});

describe("no caller resolves an anchor id on its own", () => {
  // This is the guard, not the decoration. Three sites each had their own copy
  // of "resolve the id, measure the box, scroll" and each copy independently
  // omitted the reveal; the fix is only durable if a fourth one cannot be
  // written the same way. `user-content-` is the tell — it appears wherever
  // someone is resolving a document anchor by hand.
  for (const path of [
    "../components/MarkdownViewer.tsx",
    "../pages/ViewerPage.tsx",
  ]) {
    it(`${path} goes through \`scrollToAnchor\``, () => {
      const source = read(path);
      expect(source).toContain("scrollToAnchor(");
      expect(source).not.toContain("user-content-");
    });
  }
});
