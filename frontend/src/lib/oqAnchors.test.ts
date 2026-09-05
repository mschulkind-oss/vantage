/**
 * An Open Question's id, end to end, as a navigable anchor.
 *
 * The code under test lives in `packages/vantage-md`, which has no test runner
 * of its own; the frontend resolves `vantage-md` to that package's TypeScript
 * source (see `vite.config.ts`), so these run against the real thing.
 *
 * The reason this file exists at all is one failure mode that is invisible
 * without it. `rehypeVantageDirectives` runs before `rehypeSanitize`, and the
 * sanitiser's default schema clobbers `id` with the prefix `user-content-`. An
 * implementation that writes `id` in the directive plugin renders a perfectly
 * valid page, passes every other test in the suite, and puts `user-content-OQ-4`
 * on the element — so every `#OQ-4` link in every document lands nowhere and
 * nothing anywhere errors. The first assertion below is that exact string.
 */
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "vantage-md";

const render = async (markdown: string) =>
  (await renderMarkdown(markdown + "\n")).html;

describe("open question anchors", () => {
  it("promotes the directive's id to a real id on the target", async () => {
    const html = await render(
      `<!-- vantage: oq id=OQ-4 leaning="Back of the queue." -->\n\nA question written as a paragraph.`,
    );

    expect(html).toContain('id="OQ-4"');
    // The trap. A bare `id` stamped before the sanitiser arrives like this.
    expect(html).not.toContain("user-content-OQ-4");
  });

  it("keeps the id verbatim, case intact", async () => {
    const html = await render(
      `<!-- vantage: oq id=OQ-TP6 leaning="Keep the gate fatal." -->\n\nA prefixed question.`,
    );

    expect(html).toContain('id="OQ-TP6"');
    // Heading slugs are lowercased; these are not, which is what keeps the two
    // id namespaces from colliding.
    expect(html).not.toContain('id="oq-tp6"');
  });

  it("leaves no carrier attribute behind", async () => {
    const html = await render(
      `<!-- vantage: oq id=OQ-4 leaning="A leaning." -->\n\nA question.`,
    );

    expect(html).not.toContain("data-vantage-oq-id");
    // The attributes the review button actually reads are untouched.
    expect(html).toContain('data-vantage-oq="true"');
    expect(html).toContain("data-vantage-leaning=");
  });

  it("wins over the heading slug when the question is a heading", async () => {
    const html = await render(
      `<!-- vantage: oq id=OQ-7 leaning="Yes." -->\n\n## Should the gate stay fatal?`,
    );

    expect(html).toContain('id="OQ-7"');
    expect(html).not.toContain('id="should-the-gate-stay-fatal"');
  });

  it("still slugs headings that carry no open question", async () => {
    const html = await render(`## Should the gate stay fatal?`);

    expect(html).toContain('id="should-the-gate-stay-fatal"');
  });

  it("stamps no anchor for a directive with no id", async () => {
    const html = await render(
      `<!-- vantage: oq leaning="A leaning with no id." -->\n\nA question.`,
    );

    expect(html).toContain('data-vantage-oq="true"');
    expect(html).not.toContain(' id="');
  });

  // The sanitiser's value allowlist is the backstop on a value that is about to
  // be written into the document's id namespace. The renderer stamps a
  // malformed id rather than dropping it silently — naming it is
  // `vantage/oq-id-format`'s job — so the schema is what stops it reaching the
  // page.
  it("refuses an id outside the grammar", async () => {
    const html = await render(
      `<!-- vantage: oq id=OQ-not-an-id leaning="A leaning." -->\n\nA question.`,
    );

    expect(html).not.toContain('id="OQ-not-an-id"');
    expect(html).not.toContain("data-vantage-oq-id");
    // The question is still an open question; only the anchor is refused.
    expect(html).toContain('data-vantage-oq="true"');
  });
});
