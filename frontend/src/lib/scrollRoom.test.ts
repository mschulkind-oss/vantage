import { describe, expect, it } from "vitest";
import { heldScrollRoom, holdScrollRoom } from "./scrollRoom";

/**
 * A pane jsdom cannot lay out, laid out here: `content` px of content plus
 * its padding-bottom, `view` px of it on screen, and the browser's clamp of
 * the scroll to what it holds.
 */
function pane(content: number, view: number, scrollTop: number) {
  const el = document.createElement("div");
  let top = scrollTop;
  const state = { content };
  const height = () =>
    state.content + (parseFloat(el.style.paddingBottom) || 0);
  Object.defineProperties(el, {
    scrollHeight: { get: height },
    clientHeight: { get: () => view },
    scrollTop: {
      get: () => Math.min(top, Math.max(0, height() - view)),
      set: (v: number) => {
        top = v;
      },
    },
  });
  document.body.appendChild(el);
  const scrollTo = (v: number) => {
    el.scrollTop = v;
    el.dispatchEvent(new Event("scroll"));
  };
  return { el, state, scrollTo };
}

describe("holdScrollRoom", () => {
  it("keeps the scroll of a pane at its end while its content gets shorter", () => {
    const { el, state } = pane(2000, 600, 1400);
    holdScrollRoom(el, 300);
    state.content -= 300;
    expect(el.scrollTop).toBe(1400);
    expect(heldScrollRoom(el)).toBe(300);
  });

  it("holds only what the content below the screen cannot cover", () => {
    const { el, state } = pane(2000, 600, 1300);
    holdScrollRoom(el, 300);
    expect(heldScrollRoom(el)).toBe(200);
    state.content -= 300;
    expect(el.scrollTop).toBe(1300);
  });

  it("holds nothing far from the end", () => {
    const { el } = pane(2000, 600, 200);
    holdScrollRoom(el, 300);
    expect(heldScrollRoom(el)).toBe(0);
    expect(el.style.paddingBottom).toBe("");
  });

  it("gives the room back as it scrolls out of view, moving nothing", () => {
    const { el, state, scrollTo } = pane(2000, 600, 1400);
    holdScrollRoom(el, 300);
    state.content -= 300;
    scrollTo(1250);
    expect(heldScrollRoom(el)).toBe(150);
    expect(el.scrollTop).toBe(1250);
    scrollTo(900);
    expect(heldScrollRoom(el)).toBe(0);
    expect(el.style.paddingBottom).toBe("");
    expect(el.scrollTop).toBe(900);
  });

  it("adds the room of a second shrink to the first", () => {
    const { el, state } = pane(2000, 600, 1400);
    holdScrollRoom(el, 300);
    state.content -= 300;
    holdScrollRoom(el, 200);
    state.content -= 200;
    expect(heldScrollRoom(el)).toBe(500);
    expect(el.scrollTop).toBe(1400);
  });
});
