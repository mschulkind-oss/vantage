import { describe, it, expect, afterEach } from "vitest";
import {
  ANCHORABLE_BLOCK_SELECTOR,
  anchorBlockWithin,
  blockVisibleText,
  buildWholeBlockAnchor,
  canonicalOffsetsFromRange,
  commentCardHost,
  hashBlockText,
  rangeFromCanonicalOffsets,
  stripBlockText,
} from "./reviewAnchor";

let container: HTMLDivElement;

const mount = (html: string) => {
  container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
};

/**
 * `useReviewHighlights`' index, rebuilt locally at its *fallback* tie-break:
 * every anchorable block in document order keyed by source line, last write
 * winning. The real one prefers the candidate whose hash the anchor names and
 * falls back to this, which is the same answer for every shape here — a block
 * and its first child are the only things that share a line in prose, and
 * `anchorBlockWithin` stores the hash of whichever it returns. The point of
 * pinning `anchorBlockWithin` against this rather than against a hand-copied
 * expectation is that the two rules stay tied to each other — an anchor built on
 * a block the highlighter does not resolve for that line renders divergent.
 */
const highlighterIndex = (el: HTMLElement): Map<number, HTMLElement> => {
  const byLine = new Map<number, HTMLElement>();
  for (const block of el.querySelectorAll<HTMLElement>(
    ANCHORABLE_BLOCK_SELECTOR,
  )) {
    byLine.set(
      Number.parseInt(block.getAttribute("data-source-line")!, 10),
      block,
    );
  }
  return byLine;
};

afterEach(() => {
  container?.remove();
});

describe("anchorBlockWithin", () => {
  it("picks the block useReviewHighlights indexes for the line", () => {
    // Every shape a stamped `oq` directive can produce, with the source lines
    // the real pipeline emits (a container and its first child share a line).
    const cases: Array<[string, string, string]> = [
      [
        "a stamped paragraph",
        `<p data-source-line="3" id="want">Bare question?</p>`,
        "want",
      ],
      [
        "a stamped heading",
        `<h2 data-source-line="3" id="want">A heading</h2>`,
        "want",
      ],
      [
        "a multi-paragraph blockquote",
        `<blockquote data-source-line="3"><p data-source-line="3" id="want">One.</p><p data-source-line="5">Two.</p></blockquote>`,
        "want",
      ],
      [
        "a loose list item",
        `<li data-source-line="3"><p data-source-line="3" id="want">One.</p><p data-source-line="5">Two.</p></li>`,
        "want",
      ],
      [
        "a tight list item",
        `<li data-source-line="3" id="want">Item text</li>`,
        "want",
      ],
      [
        "a table",
        `<table data-source-line="3" id="want"><tbody><tr data-source-line="5"><td>1</td></tr></tbody></table>`,
        "want",
      ],
    ];

    for (const [label, html, wantId] of cases) {
      const el = mount(`<div>${html}</div>`);
      const scope = el.firstElementChild!.firstElementChild as HTMLElement;
      const want = el.querySelector(`#${wantId}`);
      const got = anchorBlockWithin(scope);
      expect(got, label).toBe(want);
      // The same element the highlighter would resolve for that line.
      const line = Number.parseInt(got!.getAttribute("data-source-line")!, 10);
      expect(highlighterIndex(el).get(line), label).toBe(got);
      el.remove();
    }
  });

  it("returns null for a scope with no anchorable block in it", () => {
    const el = mount(
      `<div data-source-line="3"><span>Not a block</span></div>`,
    );
    expect(anchorBlockWithin(el.firstElementChild as HTMLElement)).toBeNull();
  });

  it("ignores an anchorable block with no parsable source line", () => {
    const el = mount(`<div><p data-source-line="x">No line.</p></div>`);
    expect(anchorBlockWithin(el.firstElementChild as HTMLElement)).toBeNull();
  });
});

describe("buildWholeBlockAnchor", () => {
  it("matches what a whole-block click produces", () => {
    const el = mount(`<p data-source-line="7">Second Paragraph.</p>`);
    const block = el.firstElementChild as HTMLElement;

    // Field for field what MarkdownViewer.buildCapturedSelection assembles when
    // there is no selection, including the lowercased display text it passes to
    // addComment as fallback_text.
    expect(buildWholeBlockAnchor(block)).toEqual({
      anchor: {
        source_line: 7,
        block_text_hash: hashBlockText(blockVisibleText(block)),
        selection_offset: 0,
        selection_length: 0,
      },
      fallbackText: stripBlockText(blockVisibleText(block)),
    });
    expect(buildWholeBlockAnchor(block)!.fallbackText).toBe(
      "second paragraph.",
    );
  });

  it("returns null for a block with no source line", () => {
    const el = mount(`<p>No line here.</p>`);
    expect(
      buildWholeBlockAnchor(el.firstElementChild as HTMLElement),
    ).toBeNull();
  });
});

describe("an injected OQ button is not part of the document", () => {
  // jsdom has no innerText, so blockVisibleText falls back to textContent and
  // every element inside a block contributes to its hash unless it is stripped.
  // The button lands *inside* the question's own block, so without the strip
  // every comment anchored there would read as drifted the moment it appeared.
  const withButton = (block: HTMLElement) => {
    const btn = document.createElement("button");
    btn.setAttribute("data-vantage-oq-button", "take");
    btn.textContent = "Take this leaning";
    block.appendChild(btn);
  };

  it("leaves the block's hash unchanged", () => {
    const el = mount(`<p data-source-line="3">The question itself.</p>`);
    const block = el.firstElementChild as HTMLElement;
    const before = hashBlockText(blockVisibleText(block));
    withButton(block);
    expect(hashBlockText(blockVisibleText(block))).toBe(before);
  });

  it("stays out of canonical offset space, in both TreeWalker filters", () => {
    // Two more acceptNode filters, each its own code path: patching only
    // blockVisibleText would leave every substring highlight on the block
    // pointing a label's worth of characters past where the reviewer selected.
    const el = mount(`<p data-source-line="3">The question itself.</p>`);
    const block = el.firstElementChild as HTMLElement;
    const canonical = stripBlockText(blockVisibleText(block));
    withButton(block);

    // The whole block, and not one character more.
    expect(
      rangeFromCanonicalOffsets(block, 0, canonical.length)!.toString(),
    ).toBe("The question itself.");
    expect(
      rangeFromCanonicalOffsets(block, 0, canonical.length + 1),
    ).toBeNull();
    expect(rangeFromCanonicalOffsets(block, 4, 8)!.toString()).toBe("question");

    // And a selection inside the label maps to no document offsets at all.
    const label = block.querySelector("button")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(label, 0);
    range.setEnd(label, 4);
    expect(canonicalOffsetsFromRange(block, range)).toBeNull();
  });
});

describe("table cells as anchor blocks", () => {
  const TABLE = `
    <table data-source-line="3">
      <thead><tr data-source-line="3">
        <th data-source-line="3">Engine</th><th data-source-line="3">Latency</th>
      </tr></thead>
      <tbody><tr data-source-line="5">
        <td data-source-line="5">whisper.cpp</td><td data-source-line="5">120ms</td>
      </tr></tbody>
    </table>
  `;

  it("indexes every cell, and the table, but never the row", () => {
    // `tr` is stamped by `rehypeSourceLines` and deliberately not anchorable: a
    // reviewer points at a cell, never at "the row".
    const el = mount(TABLE);
    const tags = Array.from(
      el.querySelectorAll<HTMLElement>(ANCHORABLE_BLOCK_SELECTOR),
    ).map((b) => b.tagName);

    expect(tags).toEqual(["TABLE", "TH", "TH", "TD", "TD"]);
  });

  it("hashes each cell to its own text, so one edited cell drifts alone", () => {
    const el = mount(TABLE);
    const [first, second] = Array.from(el.querySelectorAll<HTMLElement>("td"));

    expect(buildWholeBlockAnchor(first)!.anchor.block_text_hash).not.toBe(
      buildWholeBlockAnchor(second)!.anchor.block_text_hash,
    );
    expect(buildWholeBlockAnchor(first)!.fallbackText).toBe("whisper.cpp");
  });

  it("carries the row's source line onto every cell in it", () => {
    // Which is why a line no longer names one block, and why the highlighter
    // has to break the tie by hash.
    const el = mount(TABLE);
    const lines = Array.from(el.querySelectorAll<HTMLElement>("td, th")).map(
      (c) => buildWholeBlockAnchor(c)!.anchor.source_line,
    );

    expect(lines).toEqual([3, 3, 5, 5]);
  });
});

describe("commentCardHost", () => {
  it("sends a cell's card to the table, which is where HTML will allow it", () => {
    // A `<div>` between two `<td>`s is hoisted out of the table by the parser:
    // the card would render above the table, detached from its row.
    const el = mount(`
      <table data-source-line="3"><tbody><tr data-source-line="5">
        <td data-source-line="5">whisper.cpp</td>
      </tr></tbody></table>
    `);

    expect(commentCardHost(el.querySelector("td")!)).toBe(
      el.querySelector("table"),
    );
  });

  it("leaves every other block hosting its own card", () => {
    const el = mount(`
      <p data-source-line="1">A paragraph.</p>
      <table data-source-line="3"><tbody><tr data-source-line="4">
        <td data-source-line="4">cell</td>
      </tr></tbody></table>
    `);
    const p = el.querySelector("p")!;
    const table = el.querySelector("table")!;

    expect(commentCardHost(p)).toBe(p);
    expect(commentCardHost(table)).toBe(table);
  });
});
