import { describe, it, expect, afterEach } from "vitest";
import {
  hashBlockText,
  blockVisibleText,
  indexBlocks,
  resolveCommentBlock,
} from "./reviewAnchor";

let container: HTMLDivElement;
afterEach(() => container?.remove());

const mountAt = (blocks: Array<[number, string]>) => {
  container = document.createElement("div");
  container.innerHTML = blocks
    .map(([line, text]) => `<p data-source-line="${line}">${text}</p>`)
    .join("");
  document.body.appendChild(container);
  return indexBlocks(container);
};

const anchorFor = (line: number, text: string) => {
  const p = document.createElement("p");
  p.textContent = text;
  return {
    source_line: line,
    block_text_hash: hashBlockText(blockVisibleText(p)),
    selection_offset: 0,
    selection_length: 0,
  };
};

describe("resolveCommentBlock never resolves a hash-mismatched block", () => {
  it("does not return the replacement question at the old line", () => {
    const anchor = anchorFor(10, "Original question A");
    const index = mountAt([
      [10, "New question B"],
      [35, "Original question A"],
    ]);
    const block = resolveCommentBlock(index, anchor);
    expect(block?.textContent).not.toBe("New question B");
    expect(block).toBeNull();
  });

  it("returns null for ambiguous repeated text in the neighborhood", () => {
    const anchor = anchorFor(10, "Repeated");
    const index = mountAt([
      [8, "Repeated"],
      [12, "Repeated"],
      [10, "Other"],
    ]);
    expect(resolveCommentBlock(index, anchor)).toBeNull();
  });

  it("still resolves exact and unique-neighbor anchors", () => {
    const anchor = anchorFor(10, "Original question A");
    expect(
      resolveCommentBlock(mountAt([[10, "Original question A"]]), anchor)
        ?.textContent,
    ).toBe("Original question A");
    expect(
      resolveCommentBlock(mountAt([[13, "Original question A"]]), anchor)
        ?.textContent,
    ).toBe("Original question A");
  });
});

describe("resolveCommentBlock needs a document-wide unique hash", () => {
  it("does not paint an identical block that took over the old line", () => {
    // The old A sat at line 10 and moved to 35; an identical B now sits at 10.
    // The hash agrees at the old line, but it agrees at 35 as well.
    const anchor = anchorFor(10, "Choose option A");
    const index = mountAt([
      [10, "Choose option A"],
      [35, "Choose option A"],
    ]);
    expect(resolveCommentBlock(index, anchor)).toBeNull();
  });

  it("does not resolve an identical block far outside the neighbor radius", () => {
    const anchor = anchorFor(10, "Choose option A");
    const index = mountAt([
      [10, "Choose option A"],
      [400, "Choose option A"],
    ]);
    expect(resolveCommentBlock(index, anchor)).toBeNull();
  });
});
