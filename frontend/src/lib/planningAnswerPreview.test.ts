import { afterEach, describe, expect, it, vi } from "vitest";
import {
  previewAnswerText,
  answerPreviewOf,
  answerPreviews,
} from "./planningAnswerPreview";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("inspector text previews", () => {
  it("moves the visible title, not a hidden duplicate left by question folding", () => {
    const parent = document.createElement("div");
    parent.innerHTML =
      "<article><p hidden><strong>Question?</strong></p><p><strong>Question?</strong></p></article><div data-planning-row-content><span data-planning-row-title>Question?</span></div>";
    document.body.appendChild(parent);
    const copy = parent.querySelector("article")!;
    const compact = parent.querySelector<HTMLElement>(
      "[data-planning-row-content]",
    )!;
    const hidden = copy.querySelector("strong")!;
    const visible = copy.querySelectorAll("strong")[1]!;
    visible.style.fontSize = "16px";
    const target = compact.querySelector<HTMLElement>("span")!;
    target.style.fontSize = "14px";
    const box = (left: number, top: number, width: number, height: number) =>
      ({
        left,
        top,
        width,
        height,
        x: left,
        y: top,
        right: left + width,
        bottom: top + height,
        toJSON: () => ({}),
      }) as DOMRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this === hidden) return box(0, 0, 0, 0);
        if (this === visible) return box(40, 180, 220, 24);
        if (this === target) return box(100, 64, 140, 20);
        return box(20, 60, 300, 60);
      },
    );
    const old = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = (() => ({
      onfinish: null,
      oncancel: null,
    })) as unknown as typeof HTMLElement.prototype.animate;
    try {
      previewAnswerText("title-glide", copy, compact, vi.fn());
      const title = parent.querySelector<HTMLElement>(
        "[data-planning-gliding-title]",
      )!;
      expect(title.style.left).toBe("20px");
      expect(title.style.top).toBe("120px");
      expect(title.style.width).toBe("220px");
      expect(title.textContent).toBe("Question?");
    } finally {
      if (old === undefined)
        delete (HTMLElement.prototype as { animate?: unknown }).animate;
      else HTMLElement.prototype.animate = old;
    }
  });

  it("uses the real headline's words without its status marker", () => {
    const parent = document.createElement("div");
    parent.innerHTML =
      '<article><h3 data-planning-card-headline><span aria-hidden="true">💬 </span>Question?</h3><p hidden><strong>Question?</strong></p></article><div><span data-planning-row-title>Question?</span></div>';
    document.body.appendChild(parent);
    const copy = parent.querySelector("article")!;
    const compact = parent.lastElementChild as HTMLElement;
    const heading = copy.querySelector("h3")!;
    const box = (left: number, top: number, width: number, height: number) =>
      ({
        left,
        top,
        width,
        height,
        x: left,
        y: top,
        right: left + width,
        bottom: top + height,
        toJSON: () => ({}),
      }) as DOMRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return this === heading
          ? box(40, 180, 220, 24)
          : this.tagName === "STRONG"
            ? box(0, 0, 0, 0)
            : box(20, 60, 300, 60);
      },
    );
    const old = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = (() => ({
      onfinish: null,
      oncancel: null,
    })) as unknown as typeof HTMLElement.prototype.animate;
    try {
      previewAnswerText("title-glide", copy, compact, vi.fn());
      const title = parent.querySelector<HTMLElement>(
        "[data-planning-gliding-title]",
      )!;
      expect(title).not.toBeNull();
      expect(title.textContent).toBe("Question?");
      expect(title.style.top).toBe("120px");
    } finally {
      if (old === undefined)
        delete (HTMLElement.prototype as { animate?: unknown }).animate;
      else HTMLElement.prototype.animate = old;
    }
  });

  it("defines five distinct labels and safely rejects unknown deep-link values", () => {
    expect(new Set(answerPreviews.map((p) => p.value)).size).toBe(5);
    for (const preview of answerPreviews)
      expect(answerPreviewOf(preview.value)).toBe(preview.value);
    expect(answerPreviewOf("current")).toBeNull();
    expect(answerPreviewOf("no-such-effect")).toBeNull();
    expect(answerPreviewOf(null)).toBeNull();
  });
});
