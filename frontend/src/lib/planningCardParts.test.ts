/**
 * The planning card's layout of its question (`planningCardParts.ts`), over
 * hand-built DOM in the shapes the viewer renders: which element is which
 * part, what the pass leaves untouched, and that the stylesheet has a rule for
 * every part it names. The card's own suite holds the same pass over real
 * renders, and holds its answers equal to the in-page button's.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  CARD_CUT_ATTR,
  CARD_OVERFLOW_ATTR,
  CARD_PARTS,
  CARD_PART_ATTR,
  afterClampMeasures,
  cutSlot,
  cutState,
  flushClampMeasures,
  headlineMarker,
  markCardParts,
  measureClampSoon,
  overflowsClamp,
  unmarkCardParts,
} from "./planningCardParts";
import { REVIEW_UI_SELECTOR, blockVisibleText } from "./reviewAnchor";

const root = document.createElement("div");
afterEach(() => {
  root.replaceChildren();
});

/** `html` as the card's body, and its unit and host. */
function card(html: string): { unit: HTMLElement; host: HTMLElement } {
  root.innerHTML = html;
  document.body.appendChild(root);
  return {
    unit: root.querySelector<HTMLElement>("[data-unit]")!,
    host: root.querySelector<HTMLElement>("[data-host]")!,
  };
}

const partOf = (selector: string) =>
  root.querySelector(selector)?.getAttribute(CARD_PART_ATTR) ?? null;

const CONVENTION = `
<li data-unit>
<p id="lede">💬 <strong>OQ-1: Which way?</strong> Some background.</p>
<p id="more">More of it.</p>
<p id="leaning" data-host><em>Leaning:</em> this way.</p>
<p id="label"><strong>Answer:</strong></p>
<blockquote id="empty"><p><em>(empty — fill in when decided)</em></p></blockquote>
</li>`;

describe("markCardParts", () => {
  it("sorts a question written by the convention into its parts", () => {
    const { unit, host } = card(CONVENTION);
    const parts = markCardParts(root, unit, host, "OQ-1: Which way?", "💬");
    expect(parts).toEqual({
      titled: true,
      leaning: true,
      clamp: root.querySelector("#lede"),
      more: true,
    });
    expect(partOf("strong")).toBe("title");
    expect(partOf("#lede")).toBe("clamp");
    expect(partOf("#more")).toBe("more");
    expect(partOf("#leaning")).toBe("leaning");
    expect(partOf("#label")).toBe("placeholder");
    expect(partOf("#empty")).toBe("placeholder");
    // The marker is the headline's now.
    expect(root.querySelector("#lede")!.firstChild!.nodeValue).toBe("");
  });

  it("puts back the marker and takes off every mark", () => {
    const { unit, host } = card(CONVENTION);
    const before = root.innerHTML;
    markCardParts(root, unit, host, "OQ-1: Which way?", "💬");
    root.querySelector("#lede")!.setAttribute(CARD_OVERFLOW_ATTR, "");
    unmarkCardParts(root);
    expect(root.innerHTML).toBe(before);
  });

  it("leaves a marker React has written to since", () => {
    const { unit, host } = card(CONVENTION);
    markCardParts(root, unit, host, "OQ-1: Which way?", "💬");
    const marker = root.querySelector("#lede")!.firstChild!;
    marker.nodeValue = "✅ ";
    unmarkCardParts(root);
    expect(marker.nodeValue).toBe("✅ ");
  });

  it("marks again from scratch, so a second pass is the first's", () => {
    const { unit, host } = card(CONVENTION);
    markCardParts(root, unit, host, "OQ-1: Which way?", "💬");
    const once = root.innerHTML;
    markCardParts(root, unit, host, "OQ-1: Which way?", "💬");
    expect(root.innerHTML).toBe(once);
  });

  it("finds the title by the index's text, badges aside", () => {
    const { unit, host } = card(`
<li data-unit>
<p id="lede">💬 <strong>OQ-2: See <a href="x">x</a><span data-vantage-planning-badge="document">draft</span>?</strong></p>
<p data-host><em>Leaning:</em> yes.</p>
</li>`);
    const parts = markCardParts(root, unit, host, "OQ-2: See x?", "💬");
    expect(parts.titled).toBe(true);
    expect(partOf("#lede")).toBe("lede");
  });

  it("gets no headline when the title the index read is not in the unit", () => {
    const { unit, host } = card(CONVENTION);
    const parts = markCardParts(root, unit, host, "OQ-1: Another way?", "💬");
    expect(parts.titled).toBe(false);
    expect(partOf("strong")).toBeNull();
    // The paragraph the title opens is then simply the question's first block.
    expect(partOf("#lede")).toBe("clamp");
    expect(root.querySelector("#lede")!.firstChild!.nodeValue).toBe("💬 ");
  });

  it("keeps a title whose marker is text of the block an answer anchors on", () => {
    const { unit, host } = card(
      `<p data-unit data-host>💬 <strong>OQ-3: Here?</strong> More.</p>`,
    );
    const parts = markCardParts(root, unit, host, "OQ-3: Here?", "💬");
    expect(parts.titled).toBe(false);
    expect(unit.textContent).toBe("💬 OQ-3: Here? More.");
    expect(partOf("[data-unit]")).toBe("clamp");
  });

  it("keeps a title that is all its question has", () => {
    const { unit, host } = card(
      `<p data-unit data-host><strong>OQ-4: Alone?</strong></p>`,
    );
    const parts = markCardParts(root, unit, host, "OQ-4: Alone?", "");
    expect(parts.titled).toBe(false);
    expect(partOf("strong")).toBeNull();
  });

  it("reads a leaning written after the title in the title's own paragraph", () => {
    const { unit, host } = card(`
<li data-unit>
<p id="lede" data-host><strong>OQ-5: Short?</strong> <em>Leaning:</em> yes.</p>
</li>`);
    const parts = markCardParts(root, unit, host, "OQ-5: Short?", "");
    expect(parts.leaning).toBe(true);
    expect(partOf("#lede")).toBe("leaning");
    expect(parts.clamp).toBeNull();
  });

  it("takes a dash after Leaning, and only the first leaning", () => {
    const { unit, host } = card(`
<li data-unit>
<p id="a" data-host>Leaning — one way.</p>
<p id="b">Leaning: and another.</p>
</li>`);
    markCardParts(root, unit, host, "", "");
    expect(partOf("#a")).toBe("leaning");
    expect(partOf("#b")).toBe("clamp");
  });

  // One marker with the checker's length rule and oq-missing
  // (vantage-md's LEANING_MARKER), which real documents write with a note in
  // parentheses before the colon.
  it("takes a note in parentheses before the leaning's colon", () => {
    const { unit, host } = card(`
<li data-unit>
<p id="q"><strong>OQ-9: Which?</strong> Some background.</p>
<p id="a" data-host><em>Leaning (revised 2026-09-04, as filed):</em> one way.</p>
</li>`);
    const parts = markCardParts(root, unit, host, "", "");
    expect(parts.leaning).toBe(true);
    expect(partOf("#a")).toBe("leaning");
  });

  it("hides an empty answer however it is written, and keeps a filled one", () => {
    const { unit, host } = card(`
<li data-unit>
<p id="q" data-host>Which?</p>
<p id="inline"><strong>Answer:</strong> <em>(empty)</em></p>
<p id="filled"><strong>Answer:</strong> this one.</p>
<p id="label">Answer</p>
</li>`);
    markCardParts(root, unit, host, "", "");
    expect(partOf("#inline")).toBe("placeholder");
    expect(partOf("#filled")).toBe("answer");
    // A label with nothing after it is a placeholder too.
    expect(partOf("#label")).toBe("placeholder");
  });

  it("keeps display math, a block beside the item's paragraphs, in the question", () => {
    const { unit, host } = card(`
<li data-unit>
<p data-host><em>Leaning:</em> x.</p>
<span id="math" class="katex-display">a+b</span>
</li>`);
    const parts = markCardParts(root, unit, host, "", "");
    expect(parts.clamp).toBe(root.querySelector("#math"));
  });

  it("cuts a tight list item, whose text is its own, as one block", () => {
    const { unit, host } = card(
      `<li data-unit>💬 <strong>OQ-6: Tight?</strong> text<p data-host>x</p></li>`,
    );
    const parts = markCardParts(root, unit, host, "OQ-6: Tight?", "💬");
    expect(parts.clamp).toBe(unit);
    expect(parts.more).toBe(false);
  });
});

describe("cutState", () => {
  const hides = (more: boolean, overflows: boolean) => ({ more, overflows });

  it("fades the cut and offers Show full question while a folded card hides anything", () => {
    for (const hidden of [
      hides(true, false),
      hides(false, true),
      hides(true, true),
    ]) {
      expect(cutState(hidden, false)).toEqual({
        fade: true,
        control: "expand",
      });
    }
  });

  it("offers Show less, and fades nothing, once the card is unfolded", () => {
    for (const hidden of [hides(true, false), hides(false, true)]) {
      expect(cutState(hidden, true)).toEqual({
        fade: false,
        control: "collapse",
      });
    }
  });

  it("shows neither a fade nor a control for a question that fits its lines", () => {
    expect(cutState(hides(false, false), false)).toEqual({
      fade: false,
      control: null,
    });
    expect(cutState(hides(false, false), true)).toEqual({
      fade: false,
      control: null,
    });
  });
});

describe("overflowsClamp", () => {
  /** A block `tall` px high, showing `shown` of it, in lines of `line`. */
  function block(tall: number, shown: number, line = "20px"): HTMLElement {
    const el = document.createElement("p");
    el.style.lineHeight = line;
    document.body.appendChild(el);
    Object.defineProperty(el, "scrollHeight", { value: tall });
    Object.defineProperty(el, "clientHeight", { value: shown });
    return el;
  }
  afterEach(() => document.body.replaceChildren());

  it("measures a folded block against the clamp, past a pixel of rounding", () => {
    expect(overflowsClamp(block(61, 60), true)).toBe(false);
    expect(overflowsClamp(block(62, 60), true)).toBe(true);
  });

  it("measures an unfolded block against the lines it would fold to", () => {
    expect(overflowsClamp(block(61, 61), false)).toBe(false);
    expect(overflowsClamp(block(80, 80), false)).toBe(true);
  });

  it("says nothing overflows where there is no line height to measure by", () => {
    expect(overflowsClamp(block(500, 500, "normal"), false)).toBe(false);
  });
});

describe("afterClampMeasures", () => {
  afterEach(() => flushClampMeasures());

  it("runs once the pending measurements are written, after every write", () => {
    const order: string[] = [];
    measureClampSoon({
      read: () => true,
      write: () => order.push("write"),
    });
    expect(afterClampMeasures(() => order.push("then"))).toBe(true);
    expect(order).toEqual([]);
    flushClampMeasures();
    expect(order).toEqual(["write", "then"]);
    // Once.
    flushClampMeasures();
    expect(order).toEqual(["write", "then"]);
  });

  it("runs nothing, and says so, when no measurement is pending", () => {
    let ran = false;
    expect(afterClampMeasures(() => (ran = true))).toBe(false);
    flushClampMeasures();
    expect(ran).toBe(false);
  });

  it("runs at the end of the task, with the measurements, when nothing flushes them sooner", async () => {
    const order: string[] = [];
    measureClampSoon({ read: () => false, write: () => order.push("write") });
    afterClampMeasures(() => order.push("then"));
    await Promise.resolve();
    expect(order).toEqual(["write", "then"]);
  });
});

describe("cutSlot", () => {
  it("is outside the prose's typography, and no block's text", () => {
    const slot = cutSlot();
    expect(slot.hasAttribute(CARD_CUT_ATTR)).toBe(true);
    expect(slot.classList.contains("not-prose")).toBe(true);
    expect(slot.matches(REVIEW_UI_SELECTOR)).toBe(true);
    const p = document.createElement("p");
    p.textContent = "The question.";
    slot.textContent = "Show full question";
    p.append(slot);
    expect(blockVisibleText(p)).toBe("The question.");
  });

  it("is a new element for each card", () => {
    expect(cutSlot()).not.toBe(cutSlot());
  });
});

describe("headlineMarker", () => {
  it("keeps a status marker and drops anything with words in it", () => {
    expect(headlineMarker("💬 🤷")).toBe("💬 🤷");
    expect(headlineMarker("")).toBe("");
    expect(headlineMarker("Background first. 💬")).toBe("");
  });
});

describe("the stylesheet", () => {
  // A variable, not a literal: Vite rewrites a literal
  // `new URL("./x", import.meta.url)` into an asset URL `fs` cannot open.
  const stylesheet = "../index.css";
  const css = readFileSync(new URL(stylesheet, import.meta.url), "utf8");

  it("has a rule for every part the pass names", () => {
    // A filled-in answer is marked only so that folding passes it by, which
    // takes no rule of its own.
    for (const part of CARD_PARTS.filter((p) => p !== "answer")) {
      expect(css.includes(`[${CARD_PART_ATTR}="${part}"]`), part).toBe(true);
    }
    expect(css.includes(`[${CARD_OVERFLOW_ATTR}]`)).toBe(true);
  });

  it("cuts the clamp at the card's own line count", () => {
    expect(css.includes("var(--planning-card-clamp-lines, 3) * 1lh")).toBe(
      true,
    );
  });

  /** Every rule whose selector names `needle`, with its declarations. */
  const rulesNaming = (needle: string) =>
    Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
      .filter((m) => m[1]!.includes(needle))
      .map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));

  it("fades the cut with a mask, which restates no color of the card's", () => {
    const [fade] = rulesNaming(`[${CARD_OVERFLOW_ATTR}]`).filter((r) =>
      r.body.includes("mask-image"),
    );
    expect(fade).toBeDefined();
    // From opaque to nearly clear over the last line, and nothing painted
    // over it.
    expect(fade!.body.replace(/\s+/g, " ")).toContain(
      "#000 calc(100% - 1lh), rgb(0 0 0 / 0.15)",
    );
    expect(fade!.body).not.toMatch(/background|var\(--color/);
  });

  it("keeps the cut shown where the card hides its unit's siblings, and draws it only with a control in it", () => {
    const [hide] = rulesNaming(":not([data-planning-card-unit])");
    expect(hide!.selector.replace(/\s+/g, "")).toContain(
      `:not([${CARD_CUT_ATTR}])`,
    );
    const empty = rulesNaming(`[${CARD_CUT_ATTR}]:empty`);
    expect(empty.map((r) => r.body.trim())).toEqual([
      "display: none !important;",
    ]);
  });

  it("drops the fade in forced colors, where it would dim the reader's own contrast", () => {
    const forced = css.slice(
      css.indexOf(
        "@media (forced-colors: active)",
        css.indexOf("Forced colors (Windows High Contrast) keep"),
      ),
    );
    const block = forced.slice(0, forced.indexOf("\n}\n"));
    expect(block).toContain('[data-planning-card-part="clamp"]');
    expect(block).toContain("-webkit-mask-image: none !important");
    expect(block).toMatch(/[^-]mask-image: none !important/);
  });

  it("prints every card unfolded, with no fade and no fold's control", () => {
    const print = css.slice(
      css.indexOf(
        "@media print",
        css.indexOf("Paper has no Show full question"),
      ),
    );
    const block = print.slice(0, print.indexOf("\n}\n"));
    expect(block).toContain('[data-planning-card-part="more"]');
    expect(block).toContain("max-height: none !important");
    expect(block).toContain("mask-image: none !important");
    expect(block).toMatch(
      new RegExp(
        `\\[${CARD_CUT_ATTR}\\],\\s*\\[data-planning-card-fold\\]\\s*\\{\\s*display: none !important`,
      ),
    );
  });
});
