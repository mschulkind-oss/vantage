/**
 * The review-mode hover hit-test.
 *
 * jsdom has no layout engine, so every rect it reports is zero-sized at the
 * origin; the geometry here is placed by hand (`src/test/layout`), which is the
 * whole reason this hit-test lives in a module of its own rather than inside
 * `MarkdownViewer`'s effect.
 */
import { describe, it, expect, afterEach } from "vitest";
import { hoverTargetAt } from "./reviewHover";
import { layout, place } from "../test/layout";

let container: HTMLDivElement;

function mount(html: string): HTMLDivElement {
  container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

afterEach(() => {
  container?.remove();
});

/**
 * One prose paragraph and one two-column table below it.
 *
 * The table spans x 0–400 inside a 0–800 prose column, so there is a strip to
 * the right of it that is inside the table's Y band and inside no cell.
 */
const TABLE_DOC = `
  <p data-source-line="1">A paragraph above the table.</p>
  <table data-source-line="3">
    <thead><tr data-source-line="3">
      <th data-source-line="3">Engine</th><th data-source-line="3">Latency</th>
    </tr></thead>
    <tbody><tr data-source-line="5">
      <td data-source-line="5">whisper.cpp</td><td data-source-line="5">120ms</td>
    </tr></tbody>
  </table>
`;

function tableLayout(root: HTMLElement): void {
  layout(root, {
    p: { top: 0, bottom: 40, left: 0, right: 800 },
    table: { top: 60, bottom: 160, left: 0, right: 400 },
    tr: [
      { top: 60, bottom: 110, left: 0, right: 400 },
      { top: 110, bottom: 160, left: 0, right: 400 },
    ],
    th: [
      { top: 60, bottom: 110, left: 0, right: 200 },
      { top: 60, bottom: 110, left: 200, right: 400 },
    ],
    td: [
      { top: 110, bottom: 160, left: 0, right: 200 },
      { top: 110, bottom: 160, left: 200, right: 400 },
    ],
  });
}

describe("hoverTargetAt — table cells", () => {
  it("resolves the cell under the cursor, not the row it shares a Y band with", () => {
    // The regression this whole hit-test exists for: cells were absent from the
    // hover selector, so pointing at one highlighted nothing and clicking it
    // opened no popover. A Y-only test cannot fix that — both cells of a row
    // occupy the same band.
    const el = mount(TABLE_DOC);
    tableLayout(el);

    const first = hoverTargetAt(el, 100, 135);
    const second = hoverTargetAt(el, 300, 135);

    expect(first?.tagName).toBe("TD");
    expect(first?.textContent).toBe("whisper.cpp");
    expect(second?.textContent).toBe("120ms");
  });

  it("resolves a header cell the same way as a body cell", () => {
    const el = mount(TABLE_DOC);
    tableLayout(el);

    const cell = hoverTargetAt(el, 300, 80);

    expect(cell?.tagName).toBe("TH");
    expect(cell?.textContent).toBe("Latency");
  });

  it("answers with the table where the cursor is inside no cell", () => {
    // The strip to the right of a table narrower than the prose column. Left
    // dead, it reads as the feature being broken rather than as a boundary.
    const el = mount(TABLE_DOC);
    tableLayout(el);

    expect(hoverTargetAt(el, 600, 135)?.tagName).toBe("TABLE");
  });

  it("answers with the table for an empty cell", () => {
    // A cell with no text has no hash worth anchoring to — every empty cell in
    // the document would share it — so the table is what the click can mean.
    const el = mount(`
      <table data-source-line="3"><tbody><tr data-source-line="5">
        <td data-source-line="5">whisper.cpp</td><td data-source-line="5"></td>
      </tr></tbody></table>
    `);
    layout(el, {
      table: { top: 60, bottom: 160, left: 0, right: 400 },
      tr: { top: 110, bottom: 160, left: 0, right: 400 },
      td: [
        { top: 110, bottom: 160, left: 0, right: 200 },
        { top: 110, bottom: 160, left: 200, right: 400 },
      ],
    });

    expect(hoverTargetAt(el, 300, 135)?.tagName).toBe("TABLE");
  });

  it("keeps a one-character cell as its own target", () => {
    // Prose needs three characters to be worth commenting on; a cell reading
    // `3` does not, because the column heading says what it means.
    const el = mount(`
      <table data-source-line="3"><tbody><tr data-source-line="5">
        <td data-source-line="5">3</td>
      </tr></tbody></table>
    `);
    layout(el, {
      table: { top: 60, bottom: 160, left: 0, right: 200 },
      tr: { top: 110, bottom: 160, left: 0, right: 200 },
      td: { top: 110, bottom: 160, left: 0, right: 200 },
    });

    const cell = hoverTargetAt(el, 100, 135);
    expect(cell?.tagName).toBe("TD");
    expect(cell?.textContent).toBe("3");
  });

  it("prefers the cell over a paragraph written inside it", () => {
    // Hand-written HTML can nest a block in a cell, and a plain deepest-match
    // would then hand back the `<p>` — anchoring the comment to a block that
    // carries no `data-source-line` and losing the cell the reviewer pointed at.
    const el = mount(`
      <table data-source-line="3"><tbody><tr data-source-line="5">
        <td data-source-line="5"><p>Nested prose in a cell.</p></td>
      </tr></tbody></table>
    `);
    layout(el, {
      table: { top: 60, bottom: 160, left: 0, right: 400 },
      tr: { top: 110, bottom: 160, left: 0, right: 400 },
      td: { top: 110, bottom: 160, left: 0, right: 400 },
      p: { top: 115, bottom: 155, left: 5, right: 395 },
    });

    expect(hoverTargetAt(el, 100, 135)?.tagName).toBe("TD");
  });

  it("resolves the innermost cell of a nested table", () => {
    const el = mount(`
      <table data-source-line="3"><tbody><tr data-source-line="4">
        <td data-source-line="4">
          <table data-source-line="5"><tbody><tr data-source-line="6">
            <td data-source-line="6">inner</td>
          </tr></tbody></table>
        </td>
      </tr></tbody></table>
    `);
    const outer = el.querySelector("table")!;
    const inner = outer.querySelector("table")!;
    place(outer, { top: 0, bottom: 200, left: 0, right: 400 });
    place(inner, { top: 20, bottom: 180, left: 20, right: 380 });
    place(outer.querySelector("td")!, {
      top: 0,
      bottom: 200,
      left: 0,
      right: 400,
    });
    place(inner.querySelector("td")!, {
      top: 20,
      bottom: 180,
      left: 20,
      right: 380,
    });

    expect(hoverTargetAt(el, 100, 100)?.textContent?.trim()).toBe("inner");
  });
});

describe("hoverTargetAt — prose", () => {
  it("matches a paragraph on Y alone, out past the end of its text", () => {
    // The generosity that makes hover-to-comment feel like pointing at prose
    // rather than at text. Deliberately not applied to cells.
    const el = mount(TABLE_DOC);
    tableLayout(el);

    expect(hoverTargetAt(el, 780, 20)?.tagName).toBe("P");
  });

  it("prefers the deepest list item over the one wrapping it", () => {
    const el = mount(`
      <ul><li data-source-line="1">Outer item
        <ul><li data-source-line="2">Inner item</li></ul>
      </li></ul>
    `);
    const [outer, inner] = Array.from(el.querySelectorAll("li"));
    place(outer, { top: 0, bottom: 60, left: 0, right: 800 });
    place(inner, { top: 30, bottom: 60, left: 20, right: 800 });

    expect(hoverTargetAt(el, 400, 45)).toBe(inner);
    expect(hoverTargetAt(el, 400, 10)).toBe(outer);
  });

  it("skips a block too short to be worth commenting on", () => {
    const el = mount(`<p data-source-line="1">ab</p>`);
    layout(el, { p: { top: 0, bottom: 40, left: 0, right: 800 } });

    expect(hoverTargetAt(el, 400, 20)).toBeNull();
  });

  it("ignores review UI rendered into the prose container", () => {
    // An inline comment card holds paragraphs of its own, and the reviewer
    // pointing at one is pointing at the review layer, not at the document.
    const el = mount(`
      <p data-source-line="1">A paragraph.</p>
      <div data-review-inline-comment="c1"><p>The comment body.</p></div>
    `);
    layout(el, {
      "p[data-source-line]": { top: 0, bottom: 40, left: 0, right: 800 },
      "[data-review-inline-comment] p": {
        top: 50,
        bottom: 90,
        left: 0,
        right: 800,
      },
    });

    expect(hoverTargetAt(el, 400, 70)).toBeNull();
  });

  it("is null where nothing lies under the cursor", () => {
    const el = mount(TABLE_DOC);
    tableLayout(el);

    expect(hoverTargetAt(el, 400, 500)).toBeNull();
  });
});
