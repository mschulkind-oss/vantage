import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashBlockText } from "./reviewAnchor";
import { anchorFromRange, resolveAnchorBlock } from "./selectionAnchor";

let root: HTMLDivElement;
beforeEach(() => {
  // jsdom lays nothing out and has no Range rectangles.
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10);
  root = document.createElement("div");
  root.innerHTML =
    '<p data-source-line="5">hello world</p>' +
    '<p data-source-line="7">second paragraph</p>' +
    '<div data-source-line="9"><span>no anchor tag</span></div>';
  document.body.append(root);
});
afterEach(() => root.remove());

function rangeOf(
  startNode: Node,
  start: number,
  endNode: Node,
  end: number,
): Range {
  const r = document.createRange();
  r.setStart(startNode, start);
  r.setEnd(endNode, end);
  return r;
}
const text = (i: number) => root.children[i]!.firstChild!;

describe("anchorFromRange", () => {
  it("anchors a selection by the block's source line, text hash and canonical offsets", () => {
    const got = anchorFromRange(root, rangeOf(text(0), 6, text(0), 11));
    expect(got?.anchor).toEqual({
      source_line: 5,
      block_text_hash: hashBlockText("hello world"),
      selection_offset: 6,
      selection_length: 5,
    });
    expect(got?.displayText).toBe("world");
    expect(got?.clamped).toBe(false);
  });

  it("ignores a selection under three characters instead of widening it", () => {
    expect(anchorFromRange(root, rangeOf(text(0), 0, text(0), 2))).toBeNull();
  });

  it("clamps a selection across blocks to the block it starts in, and says so", () => {
    const got = anchorFromRange(root, rangeOf(text(0), 6, text(1), 6));
    expect(got?.clamped).toBe(true);
    expect(got?.anchor.source_line).toBe(5);
  });

  it("returns nothing for a range with no source-backed block, or outside the container", () => {
    const span = root.querySelector("span")!.firstChild!;
    expect(anchorFromRange(root, rangeOf(span, 0, span, 6))).toBeNull();
    const other = document.createElement("p");
    other.setAttribute("data-source-line", "1");
    other.textContent = "elsewhere";
    document.body.append(other);
    expect(
      anchorFromRange(
        root,
        rangeOf(other.firstChild!, 0, other.firstChild!, 9),
      ),
    ).toBeNull();
    other.remove();
  });
});

describe("resolveAnchorBlock", () => {
  it("stops on the closest anchorable block with a source line", () => {
    expect(resolveAnchorBlock(root, text(1))).toBe(root.children[1]);
    expect(resolveAnchorBlock(root, root.querySelector("span"))).toBeNull();
  });
});
