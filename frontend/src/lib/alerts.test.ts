/**
 * GFM alerts through the real chain.
 *
 * `vantage-md` has no tests of its own — its behaviour is covered from here
 * through the source alias — so this file drives `renderMarkdown`, the same
 * entry point the CLI checker uses. That matters more than usual for alerts:
 * the treatment is a *pipeline* plugin rather than app JS, and its whole claim
 * is that all four renderers agree (D5).
 */

import { describe, it, expect } from "vitest";
import { renderMarkdown, VANTAGE_ALERTS, VANTAGE_TONES } from "vantage-md";

const render = async (md: string) => (await renderMarkdown(md)).html;

describe("GFM alerts compile to data-vantage-alert", () => {
  for (const kind of VANTAGE_ALERTS) {
    it(`recognises [!${kind.toUpperCase()}]`, async () => {
      const html = await render(`> [!${kind.toUpperCase()}]\n> Body text.\n`);
      expect(html).toContain(`data-vantage-alert="${kind}"`);
      // The marker is markup, not prose: it must not survive as text.
      expect(html).not.toContain(`[!${kind.toUpperCase()}]`);
      expect(html).toContain("Body text.");
    });
  }

  it("gives the alert a title element", async () => {
    const html = await render("> [!WARNING]\n> Mind the gap.\n");
    expect(html).toContain('<div class="vantage-alert-title">Warning</div>');
  });

  it("puts the title first, ahead of the body", async () => {
    const html = await render("> [!TIP]\n> Body.\n");
    expect(html.indexOf("vantage-alert-title")).toBeLessThan(
      html.indexOf("Body."),
    );
  });

  it("keeps the body's own markup", async () => {
    const html = await render("> [!NOTE]\n> A **bold** word and `code`.\n");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("handles a multi-paragraph alert", async () => {
    const html = await render("> [!CAUTION]\n> First.\n>\n> Second.\n");
    expect(html).toContain('data-vantage-alert="caution"');
    expect(html).toContain("First.");
    expect(html).toContain("Second.");
  });

  it("handles an alert whose only content is the marker", async () => {
    // Degenerate, and it must not leave an empty <p> that typography still
    // gives a margin to — the callout would open with a blank line.
    const html = await render("> [!NOTE]\n");
    expect(html).toContain('data-vantage-alert="note"');
    expect(html).not.toMatch(/<p[^>]*>\s*<\/p>/);
  });
});

describe("GFM alerts leave everything else alone", () => {
  it("does not touch a plain blockquote", async () => {
    const html = await render("> Just a quotation.\n");
    expect(html).not.toContain("data-vantage-alert");
    expect(html).not.toContain("vantage-alert-title");
  });

  it("leaves an unknown marker visible", async () => {
    // `[!HINT]` is not an alert on GitHub either. Swallowing it would hide a
    // typo that reads as a callout on no renderer at all.
    const html = await render("> [!HINT]\n> Not an alert.\n");
    expect(html).not.toContain("data-vantage-alert");
    expect(html).toContain("[!HINT]");
  });

  it("ignores a marker that is not alone on the first line", async () => {
    // GFM puts the marker on its own line. Holding to that is what keeps a
    // paragraph merely *beginning* with bracketed text from being eaten.
    const html = await render("> [!NOTE] and then more on the same line.\n");
    expect(html).not.toContain("data-vantage-alert");
    expect(html).toContain("[!NOTE]");
  });

  it("ignores a marker that is not the first thing in the quote", async () => {
    const html = await render("> A first line.\n>\n> [!NOTE]\n> Too late.\n");
    expect(html).not.toContain("data-vantage-alert");
  });

  it("is case-sensitive, as GitHub is", async () => {
    const html = await render("> [!note]\n> Lowercase marker.\n");
    expect(html).not.toContain("data-vantage-alert");
    expect(html).toContain("[!note]");
  });
});

describe("the alert vocabulary and the tone vocabulary", () => {
  it("is a strict subset of the tones", async () => {
    // The five that coincide share a palette, which is the point — one theme
    // block, and `[!WARNING]` cannot drift from `tone=warning`. They stay two
    // lists because they are closed by different authorities: `muted` is ours
    // and is not an alert word.
    for (const alert of VANTAGE_ALERTS) {
      expect(VANTAGE_TONES).toContain(alert);
    }
    expect(VANTAGE_ALERTS).toHaveLength(5);
    expect(VANTAGE_TONES).toHaveLength(6);
    expect(VANTAGE_TONES).toContain("muted");
    expect(VANTAGE_ALERTS as readonly string[]).not.toContain("muted");
  });
});

describe("an alert survives the sanitiser", () => {
  it("keeps the attribute the plugin stamps", async () => {
    // The plugin runs before `rehype-sanitize`, so the attribute is only on the
    // page because the schema allowlists it by name and value.
    expect(await render("> [!TIP]\n> x\n")).toContain(
      'data-vantage-alert="tip"',
    );
  });

  it("refuses a forged kind written as raw HTML", async () => {
    const html = await render(
      '<blockquote data-vantage-alert="evil">x</blockquote>',
    );
    expect(html).not.toContain("evil");
  });

  it("accepts a real kind written as raw HTML, since it names a real tone", async () => {
    // Value-allowlisted, not name-allowlisted: a document may say `note`
    // because `note` is in the vocabulary, and cannot invent a sixth.
    const html = await render(
      '<blockquote data-vantage-alert="note">x</blockquote>',
    );
    expect(html).toContain('data-vantage-alert="note"');
  });
});

describe("an alert inside a toned section", () => {
  it("carries both facts without either overwriting the other", async () => {
    // The bug this pins: resolving alerts onto `--vantage-tone-*` made the
    // alert's kind win on a stamped member, because custom properties inherit
    // — so the section's own vertical rule turned the alert's colour for the
    // height of the alert plus its upward bleed, and the section read as three
    // colours.
    const html = await render(
      "<!-- vantage: section tone=important -->\n\n" +
        "## A section\n\n" +
        "> [!CAUTION]\n> Body.\n",
    );
    expect(html).toContain('data-vantage-alert="caution"');
    expect(html).toContain('data-vantage-tone="important"');
  });

  it("is still a run member, so the rule has no hole at it", async () => {
    const html = await render(
      "<!-- vantage: section tone=note -->\n\n" +
        "## A section\n\n" +
        "Before.\n\n" +
        "> [!TIP]\n> Body.\n\n" +
        "After.\n",
    );
    // The blockquote is stamped and counted, which is what makes the counted
    // member the painting member.
    expect(html).toMatch(
      /<blockquote[^>]*data-vantage-alert="tip"[^>]*data-vantage-run="middle"|<blockquote[^>]*data-vantage-run="middle"[^>]*data-vantage-alert="tip"/,
    );
  });
});
