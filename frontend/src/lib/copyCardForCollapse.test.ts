import { afterEach, describe, expect, it, vi } from "vitest";
import { copyCardForCollapse } from "./copyCardForCollapse";

afterEach(() => vi.restoreAllMocks());

describe("copyCardForCollapse", () => {
  it("preserves each control's painted font metrics instead of inheriting the compact row's line height", () => {
    const article = document.createElement("article");
    article.innerHTML = "<button>Answer…</button>";
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = computed(element);
      return new Proxy(style, {
        get(target, key) {
          if (key === "font")
            return element.tagName === "BUTTON"
              ? "11px / 16.5px sans-serif"
              : "16px / 24px sans-serif";
          return Reflect.get(target, key);
        },
      });
    });
    const copy = copyCardForCollapse(article)!;
    expect(copy.querySelector("button")!.style.lineHeight).toBe("16.5px");
    expect(copy.querySelector("button")!.style.fontSize).toBe("11px");
  });

  it("removes the item's identity and interaction while preserving referenced SVG IDs", () => {
    const article = document.createElement("article");
    article.id = "question";
    article.dataset.planningItem = "owned-question";
    article.innerHTML =
      '<svg><defs><marker id="arrow" /></defs><path marker-end="url(#arrow)" /></svg>';
    const copy = copyCardForCollapse(article)!;
    expect(copy.id).toBe("");
    expect(copy.dataset.planningItem).toBeUndefined();
    expect(copy.hasAttribute("inert")).toBe(true);
    expect(copy.getAttribute("aria-hidden")).toBe("true");
    expect(copy.querySelector("#arrow")).not.toBeNull();
    expect(copy.querySelector("path")!.getAttribute("marker-end")).toBe(
      "url(#arrow)",
    );
    expect(article.id).toBe("question");
    expect(copyCardForCollapse(null)).toBeNull();
  });
});
