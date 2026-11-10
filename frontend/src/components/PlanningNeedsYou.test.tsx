import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AnsweredRow } from "./PlanningNeedsYou";
import { motionFixture } from "../lib/planningMotionFixture";

const TINT = "inset 0 0 0 100vmax rgb(34 197 94 / 0.14)";
const question = motionFixture().answered.question;
let reduce = false;
let played: {
  target: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: Animation;
}[];
const proto = Element.prototype as Element & {
  animate?: typeof Element.prototype.animate;
};
const originalAnimate = proto.animate;

beforeEach(() => {
  reduce = false;
  played = [];
  vi.stubGlobal("matchMedia", () => ({
    matches: reduce,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const top = this.matches("[data-planning-card-headline]") ? 100 : 0;
      return {
        x: 0,
        y: top,
        left: 0,
        top,
        right: 320,
        width: 320,
        height: 24,
        bottom: top + 24,
        toJSON: () => ({}),
      } as DOMRect;
    },
  );
  proto.animate = function (frames, options) {
    const animation = {
      onfinish: null,
      oncancel: null,
      cancel: vi.fn(),
    } as unknown as Animation;
    played.push({
      target: this,
      frames: frames as Keyframe[],
      options: options as KeyframeAnimationOptions,
      animation,
    });
    return animation;
  };
});
afterEach(() => {
  cleanup();
  if (originalAnimate === undefined) delete proto.animate;
  else proto.animate = originalAnimate;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function copy() {
  const article = document.createElement("article");
  article.dataset.planningDepartingCard = "";
  const headline = document.createElement("h3");
  headline.dataset.planningCardHeadline = "";
  headline.style.fontSize = "17px";
  const marker = document.createElement("span");
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = "💬 ";
  headline.append(marker, question.title);
  article.append(headline);
  return article;
}
function view(shrinking = true, key = "first", entry = "/fixture") {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <AnsweredRow
        key={key}
        question={question}
        itemKey="fixture"
        href="/fixture"
        answers={null}
        marks={[]}
        newReply={false}
        opening={false}
        onShow={() => {}}
        onNewReply={() => {}}
        shrinkFrom={shrinking ? 240 : undefined}
        cardBeforeShrink={shrinking ? copy() : undefined}
      />
    </MemoryRouter>
  );
}
const row = () => screen.getByRole("group", { name: question.title });

describe("production answered-card handoff", () => {
  it("glides the visible title by default and completes after the text handoff, not at height finish", () => {
    render(view());
    expect(row().querySelector("[data-planning-gliding-title]")).not.toBeNull();
    const compact = row().querySelector("[data-planning-row-content]")!;
    expect(compact).not.toHaveStyle({ visibility: "hidden" });
    expect(compact).toHaveAttribute("inert");
    expect(
      played.some((p) => p.target === compact && p.frames[0]?.opacity === 0),
    ).toBe(true);
    const height = played.find(
      (p) => p.target === row() && p.frames[0]?.height !== undefined,
    )!;
    act(() =>
      height.animation.onfinish?.call(
        height.animation,
        new Event("finish") as AnimationPlaybackEvent,
      ),
    );
    expect(
      row().querySelector("[data-planning-departing-card]"),
    ).not.toBeNull();
    const outgoing = played.find(
      (p) =>
        p.target.matches("[data-planning-departing-card]") &&
        p.frames[0]?.opacity === 1,
    )!;
    expect(outgoing.options.duration).toBe(400);
    act(() =>
      outgoing.animation.onfinish?.call(
        outgoing.animation,
        new Event("finish") as AnimationPlaybackEvent,
      ),
    );
    expect(row().querySelector("[data-planning-departing-card]")).toBeNull();
    expect(compact).not.toHaveAttribute("inert");
    expect(row().style.boxShadow).toBe(TINT);
  });

  it("has one production version and ignores a demo-style query option", () => {
    render(view(true, "fixed", "/fixture?effect=slide-up"));
    expect(row().querySelector("[data-planning-gliding-title]")).not.toBeNull();
    expect(screen.queryByRole("combobox", { name: "Text handoff" })).toBeNull();
  });

  it("ramps once to a lower tint and keeps that final tint without an animation fill", () => {
    render(view());
    const color = played.find((p) => p.frames[0]?.boxShadow !== undefined)!;
    expect(color.options.duration).toBe(128);
    expect(color.frames).toEqual([{ boxShadow: "none" }, { boxShadow: TINT }]);
    expect(color.options.fill).toBeUndefined();
    expect(row().style.boxShadow).toBe(TINT);
    act(() =>
      color.animation.onfinish?.call(
        color.animation,
        new Event("finish") as AnimationPlaybackEvent,
      ),
    );
    expect(row().style.boxShadow).toBe(TINT);
  });

  it("keeps the same green on an ordinary remount, without replaying the departure", () => {
    const mounted = render(view());
    mounted.rerender(view(false, "fresh-layout"));
    expect(row().style.boxShadow).toBe(TINT);
    expect(row().querySelector("[data-planning-departing-card]")).toBeNull();
  });

  it("shows the final row and tint immediately for reduced motion", () => {
    reduce = true;
    render(view());
    expect(played).toEqual([]);
    expect(row().querySelector("[data-planning-departing-card]")).toBeNull();
    expect(row().style.boxShadow).toBe(TINT);
  });

  it("reveals the final row if native animation disappears before capture", () => {
    const measure = vi
      .mocked(Element.prototype.getBoundingClientRect)
      .getMockImplementation()!;
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(
      function (this: Element) {
        if (this.hasAttribute("data-planning-row"))
          Object.defineProperty(this, "animate", {
            value: undefined,
            configurable: true,
          });
        return measure.call(this);
      },
    );
    render(view());
    expect(
      row().querySelector("[data-planning-row-content]"),
    ).not.toHaveAttribute("inert");
    expect(row().querySelector("[data-planning-departing-card]")).toBeNull();
    expect(row().style.boxShadow).toBe(TINT);
  });

  it("shows the final row and tint when native animation is unavailable", () => {
    delete proto.animate;
    render(view());
    expect(row().querySelector("[data-planning-departing-card]")).toBeNull();
    expect(row().style.boxShadow).toBe(TINT);
  });
});
