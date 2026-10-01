/**
 * `<!-- vantage: … -->` directives: the grammar, the closed vocabulary, and what
 * the plugin stamps.
 *
 * The code under test lives in `packages/vantage-md`, which has no test runner
 * of its own; the frontend resolves `vantage-md` to that package's TypeScript
 * source (see `vite.config.ts`), so these run against the real thing — and
 * `renderMarkdown` runs the real chain, sanitizer included, which is the only
 * way to prove an attribute actually reaches a document rather than merely
 * being written onto a tree that the sanitizer then empties.
 *
 * Two properties are load-bearing and easy to lose by accident:
 *
 * - Every failure mode is **silent** (P3/D2/D6). A typo produces a plain
 *   document, never an exception, never a console line, never a half-stamped
 *   block. Most of the cases below assert an absence.
 * - The document is unchanged (P1/D8). Deleting every directive from a file
 *   changes attributes and nothing else — not the prose, not a
 *   `data-source-line`.
 */
import { describe, it, expect, vi } from "vitest";
import {
  DIRECTIVE_NAMES,
  DIRECTIVE_VOCABULARY,
  VANTAGE_BADGES,
  VANTAGE_EMPHASIS,
  VANTAGE_RUNS,
  VANTAGE_OQ_STATUS,
  VANTAGE_OQ_STATUS_LABEL,
  VANTAGE_QUESTION_NAMES,
  VANTAGE_SENTINEL,
  VANTAGE_TONES,
  hasVantageSentinel,
  isQuestionDirective,
  questionOffersTake,
  vantageOqStatus,
  VANTAGE_LEANING_ATTRIBUTE,
  VANTAGE_OQ_ATTRIBUTE,
  VANTAGE_QUESTION_ATTRIBUTE,
  VANTAGE_QUESTION_SELECTOR,
  parseVantageDirective,
  renderMarkdown,
  STYLE_GUIDE,
} from "vantage-md";

/** Render the real chain and hand back a queryable DOM. */
async function render(markdown: string): Promise<HTMLElement> {
  const { html } = await renderMarkdown(markdown);
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

const html = async (markdown: string) => (await renderMarkdown(markdown)).html;

/** Every `data-vantage-*` attribute on one element, name → value. */
function stamped(element: Element | null): Record<string, string> {
  const found: Record<string, string> = {};
  for (const attribute of Array.from(element?.attributes ?? [])) {
    if (attribute.name.startsWith("data-vantage-")) {
      found[attribute.name] = attribute.value;
    }
  }
  return found;
}

const runs = (host: HTMLElement, selector: string) =>
  Array.from(host.querySelectorAll(selector)).map((el) =>
    el.getAttribute("data-vantage-run"),
  );

const prose = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("the directive grammar", () => {
  it("parses a name and its pairs out of a comment's inner text", () => {
    // The value of a hast `comment` node: delimiters already stripped.
    const parsed = parseVantageDirective(" vantage: section tone=warning ");

    expect(parsed).toEqual({
      kind: "directive",
      name: "section",
      nameOffset: 10,
      pairs: [
        {
          key: "tone",
          value: "warning",
          keyOffset: 18,
          valueOffset: 23,
          quoted: false,
        },
      ],
    });
  });

  it("treats a newline as whitespace, so a directive may wrap", () => {
    // `ws` is undefined in the design's grammar. It has to include `\n`: a
    // wrapped directive is one comment node whose value contains the newlines.
    const parsed = parseVantageDirective(
      "\n  vantage:\n  section\n\ttone=warning\n  badge=stale\n",
    );

    expect(parsed).toMatchObject({
      kind: "directive",
      name: "section",
      pairs: [
        { key: "tone", value: "warning" },
        { key: "badge", value: "stale" },
      ],
    });
  });

  it("keeps the spaces inside a quoted value and strips the quotes", () => {
    const parsed = parseVantageDirective(
      ' vantage: oq leaning="Back of the queue — for now" ',
    );

    expect(parsed).toMatchObject({
      pairs: [
        {
          key: "leaning",
          value: "Back of the queue — for now",
          quoted: true,
        },
      ],
    });
  });

  it("allows `--` in a quoted value: there is no such restriction", () => {
    // Measured through the real chain: `tone="a--b"` reaches the tree intact,
    // because HTML5 closes a comment on `-->` or `--!>` and on nothing else.
    expect(
      parseVantageDirective(' vantage: section tone="a--b" '),
    ).toMatchObject({ pairs: [{ key: "tone", value: "a--b" }] });
  });

  it("keeps duplicate keys, in written order", () => {
    // The renderer resolves them last-one-wins; the checker reports them. Both
    // need to see that there were two.
    expect(
      parseVantageDirective(" vantage: section tone=note tone=warning "),
    ).toMatchObject({
      pairs: [
        { key: "tone", value: "note" },
        { key: "tone", value: "warning" },
      ],
    });
  });

  it("is not ours without the sentinel, and says so with null", () => {
    for (const comment of [
      " TODO: rewrite this ",
      " vantage said no ",
      " v: section tone=warning ",
      "- vantage: section ", // `<!--- vantage: … -->`
      " prefix vantage: section ",
      "",
    ]) {
      expect(hasVantageSentinel(comment)).toBe(false);
      expect(parseVantageDirective(comment)).toBeNull();
    }
  });

  it("reports the sentinel on a directive, before any parse attempt", () => {
    expect(hasVantageSentinel(" vantage: anything at all ")).toBe(true);
    expect(hasVantageSentinel("\n\tvantage:")).toBe(true);
    expect(VANTAGE_SENTINEL).toBe("vantage:");
  });

  it("calls a sentineled comment that does not parse malformed, with a reason", () => {
    const cases: [string, string][] = [
      [" vantage: ", "no directive name after `vantage:`"],
      [" vantage:", "no directive name after `vantage:`"],
      // Uppercase is a parse failure, not a case-insensitive match.
      [" vantage: Section ", "no directive name after `vantage:`"],
      [" vantage: section tone ", "`tone` is not followed by `=value`"],
      [
        " vantage: section Tone=warning ",
        "`Tone=warning` is not a `key=value` pair",
      ],
      // Single quotes are not a quoting form; `'` is outside `unquoted`.
      [" vantage: oq leaning='x' ", "`'x'` is not a valid value for `leaning`"],
      [" vantage: section tone= ", "`tone=` has no value"],
      // Two sentinels in one comment are one failed parse, never two directives.
      [
        " vantage: section tone=note vantage: block tone=warning ",
        "`vantage` is not followed by `=value`",
      ],
      // `=` is outside `unquoted`, so there is no space where one is required.
      [" vantage: section tone=notebadge=x ", "`=x` needs a space before it"],
    ];

    for (const [comment, reason] of cases) {
      expect(parseVantageDirective(comment)).toMatchObject({
        kind: "malformed",
        reason,
      });
    }
  });

  it("points a malformed parse at the character that broke", () => {
    const parsed = parseVantageDirective(" vantage: section tone ");

    // Offset 22 is the space after `tone`, where `=value` should have been.
    expect(parsed).toMatchObject({ kind: "malformed", offset: 22 });
  });

  it("accepts a name with no pairs — nothing to say is not a failure", () => {
    expect(parseVantageDirective(" vantage: section ")).toMatchObject({
      kind: "directive",
      name: "section",
      pairs: [],
    });
  });
});

describe("the closed vocabulary", () => {
  it("is exactly five names", () => {
    expect([...DIRECTIVE_NAMES]).toEqual([
      "section",
      "block",
      "oq",
      "question",
      "fallback",
    ]);
    expect(Object.keys(DIRECTIVE_VOCABULARY).sort()).toEqual(
      [...DIRECTIVE_NAMES].sort(),
    );
  });

  it("is the GFM alert set plus muted, and nothing else", () => {
    expect([...VANTAGE_TONES]).toEqual([
      "note",
      "tip",
      "important",
      "warning",
      "caution",
      "muted",
    ]);
    expect([...VANTAGE_EMPHASIS]).toEqual(["strong", "normal", "quiet"]);
    expect([...VANTAGE_BADGES]).toEqual([
      "draft",
      "stale",
      "blocked",
      "done",
      "wip",
    ]);
    expect([...VANTAGE_RUNS]).toEqual(["start", "middle", "end", "only"]);
  });

  it("gives `section` and `block` the same keys, and both question names free text", () => {
    // They differ in extent, not in what they can say.
    expect(Object.keys(DIRECTIVE_VOCABULARY.section ?? {})).toEqual(
      Object.keys(DIRECTIVE_VOCABULARY.block ?? {}),
    );
    expect(DIRECTIVE_VOCABULARY.section?.tone).toEqual(VANTAGE_TONES);
    // `id` and `leaning` are the design's only values with no closed set, which
    // is why they are the only ones the sanitizer cannot value-allowlist.
    expect(DIRECTIVE_VOCABULARY.oq).toEqual({ id: null, leaning: null });
    // Withholding a block is the whole of what `fallback` says.
    expect(DIRECTIVE_VOCABULARY.fallback).toEqual({});
    // `question` takes exactly `oq`'s keys: it replaces `oq`, in every state.
    expect(DIRECTIVE_VOCABULARY.question).toEqual(DIRECTIVE_VOCABULARY.oq);
  });

  it("names the two question directives, and offers a take by state alone", () => {
    expect([...VANTAGE_QUESTION_NAMES]).toEqual(["oq", "question"]);
    expect(DIRECTIVE_NAMES.filter(isQuestionDirective)).toEqual([
      ...VANTAGE_QUESTION_NAMES,
    ]);
    // Open, or unmarked, which counts as open; never 🔒 or ✅, whatever the
    // directive's name.
    expect(questionOffersTake("open")).toBe(true);
    expect(questionOffersTake(null)).toBe(true);
    expect(questionOffersTake("blocked")).toBe(false);
    expect(questionOffersTake("settled")).toBe(false);
  });

  it("names the attributes a question is found by in the rendered page", () => {
    // The contract the viewer reads, and the one a reader of this package's
    // markup has: every question, the `oq` ones, and the leaning.
    expect(VANTAGE_QUESTION_ATTRIBUTE).toBe("data-vantage-question");
    expect(VANTAGE_QUESTION_SELECTOR).toBe("[data-vantage-question]");
    expect(VANTAGE_OQ_ATTRIBUTE).toBe("data-vantage-oq");
    expect(VANTAGE_LEANING_ATTRIBUTE).toBe("data-vantage-leaning");
  });
});

describe("target resolution", () => {
  it("stamps the block after the comment, blank line or not", async () => {
    // A whitespace-only text node always sits between a block-level comment and
    // its target — measured, with and without a blank line in the source — so
    // skipping whitespace is required, not incidental.
    for (const markdown of [
      "<!-- vantage: block tone=note -->\n\nSpaced paragraph\n",
      "<!-- vantage: block tone=note -->\nTight paragraph\n",
    ]) {
      const host = await render(markdown);
      expect(stamped(host.querySelector("p"))).toEqual({
        "data-vantage-tone": "note",
        "data-vantage-run": "only",
      });
    }
  });

  it("walks past an unrelated comment to reach the target", async () => {
    // An editorial comment is invisible in every renderer and deleted by the
    // sanitizer. Letting it change a directive's meaning would make behavior
    // depend on something no reader can see.
    const host = await render(
      "<!-- vantage: block tone=note -->\n\n<!-- TODO: rewrite this -->\n\nParagraph\n",
    );

    expect(stamped(host.querySelector("p"))).toMatchObject({
      "data-vantage-tone": "note",
    });
  });

  it("is inert with nothing after it", async () => {
    const markup = await html(
      "Prose.\n\n<!-- vantage: section tone=warning -->\n",
    );

    expect(markup).not.toContain("data-vantage-");
    expect(prose(markup)).toBe("Prose.");
  });

  it("is inert when the next sibling is text rather than an element", async () => {
    const markup = await html(
      "Some prose <!-- vantage: block tone=warning --> more prose\n",
    );

    expect(markup).not.toContain("data-vantage-");
    expect(prose(markup)).toBe("Some prose more prose");
  });

  it("resolves inside a list item, which is where a question directive lives", async () => {
    // The design's own example puts the comment at column 0 between two list
    // items; measured, that splits one `<ol>` into two and visibly renumbers
    // the document, so the working form indents it inside the item. That is
    // also why the plugin walks the whole tree rather than the root's children.
    const host = await render(
      [
        "1. **OQ-B1: does the daemon retry?**",
        "",
        '   <!-- vantage: question id=OQ-B1 leaning="Back of the queue" -->',
        "",
        "   _Leaning:_ back of the queue.",
        "",
        "2. Question two",
      ].join("\n"),
    );

    expect(host.querySelectorAll("ol")).toHaveLength(1);
    const target = host.querySelectorAll("li")[0].querySelectorAll("p")[1];
    expect(stamped(target)).toEqual({
      "data-vantage-question": "true",
      "data-vantage-leaning": "Back of the queue",
    });
    // The stamped block is still an anchorable block with a line number.
    expect(target.getAttribute("data-source-line")).toBe("5");
  });

  it("cannot stamp outside its own parent's children", async () => {
    // A directive inside a blockquote stamps only nodes in that blockquote, and
    // the heading inside it does not end an enclosing section either.
    const host = await render(
      [
        "<!-- vantage: section tone=note -->",
        "",
        "## Outer",
        "",
        "> <!-- vantage: block tone=caution -->",
        ">",
        "> ### Quoted heading",
        ">",
        "> quoted body",
        "",
        "After the quote.",
      ].join("\n"),
    );

    const quote = host.querySelector("blockquote")!;
    expect(quote.getAttribute("data-vantage-tone")).toBe("note");
    // The `block` directive inside it stamps the quoted heading and stops.
    expect(quote.querySelector("h3")!.getAttribute("data-vantage-tone")).toBe(
      "caution",
    );
    expect(
      quote.querySelector("p")!.getAttribute("data-vantage-tone"),
    ).toBeNull();
    // The quoted `###` did not terminate the outer section.
    const paragraphs = Array.from(host.querySelectorAll("p"));
    const last = paragraphs[paragraphs.length - 1];
    expect(last.textContent).toBe("After the quote.");
    expect(last.getAttribute("data-vantage-tone")).toBe("note");
  });
});

describe("extent: position picks the target, the name picks how far", () => {
  const NESTED = [
    "<!-- vantage: section tone=warning emphasis=strong -->",
    "",
    "## Migration path",
    "",
    "The steps below predate the rewrite.",
    "",
    "<!-- vantage: section tone=note -->",
    "",
    "### Step one",
    "",
    "Run the importer.",
    "",
    "## Rollback",
    "",
    "Untouched.",
  ].join("\n");

  it("takes a heading's whole section, stopping at same-or-shallower depth", async () => {
    const host = await render(
      [
        "<!-- vantage: section tone=warning -->",
        "",
        "## Section",
        "",
        "Body.",
        "",
        "### Nested",
        "",
        "Nested body.",
        "",
        "## Next",
        "",
        "Outside.",
      ].join("\n"),
    );

    expect(host.querySelector("h2")!.getAttribute("data-vantage-tone")).toBe(
      "warning",
    );
    expect(host.querySelector("h3")!.getAttribute("data-vantage-tone")).toBe(
      "warning",
    );
    expect(runs(host, "[data-vantage-tone]")).toEqual([
      "start",
      "middle",
      "middle",
      "end",
    ]);
    // The terminating heading and everything after it are untouched.
    const headings = host.querySelectorAll("h2");
    expect(stamped(headings[1])).toEqual({});
    expect(stamped(host.querySelectorAll("p")[2])).toEqual({});
  });

  it("stops an `h1` section at the next `h1`, stamping through the `h2`", async () => {
    const host = await render(
      [
        // A run treatment, because the probe is what the stamp *reaches*: a
        // `badge` marks the target alone and would say nothing about the `h2`.
        "<!-- vantage: section tone=warning -->",
        "",
        "# Part one",
        "",
        "## Chapter",
        "",
        "Body.",
        "",
        "# Part two",
        "",
        "Fresh.",
      ].join("\n"),
    );

    expect(host.querySelector("h2")!.getAttribute("data-vantage-tone")).toBe(
      "warning",
    );
    expect(stamped(host.querySelectorAll("h1")[1])).toEqual({});
    expect(stamped(host.querySelectorAll("p")[1])).toEqual({});
  });

  it("stamps a sibling whose tag it could not have targeted", async () => {
    // The stampable-tag list (`VANTAGE_STYLE_TARGETS`) gates the *target* and
    // nothing else. It used to gate the range too, which left a raw-HTML
    // `<figure>` or `<dl>` unstamped between two stamped paragraphs — and since
    // the section's one continuous vertical rule is drawn per member, an
    // unstamped member is a hole the height of the block: measured at 44px for
    // a one-line figure, against the 40px a neighbor bleeds upward.
    const host = await render(
      [
        "<!-- vantage: section tone=warning -->",
        "",
        "## Section",
        "",
        "Para one.",
        "",
        "<figure><figcaption>Cap</figcaption></figure>",
        "",
        "Para two.",
        "",
        "<dl><dt>a</dt><dd>b</dd></dl>",
        "",
        "Para three.",
      ].join("\n"),
    );

    expect(
      host.querySelector("figure")!.getAttribute("data-vantage-tone"),
    ).toBe("warning");
    expect(host.querySelector("dl")!.getAttribute("data-vantage-tone")).toBe(
      "warning",
    );
    expect(
      Array.from(host.querySelectorAll("p")).map((p) =>
        p.getAttribute("data-vantage-tone"),
      ),
    ).toEqual(["warning", "warning", "warning"]);
    // Six members in one unbroken chain, the two raw-HTML blocks among them.
    expect(runs(host, "[data-vantage-tone]")).toEqual([
      "start",
      "middle",
      "middle",
      "middle",
      "middle",
      "end",
    ]);
  });

  it("hides a non-targetable sibling along with the rest of a collapsed section", async () => {
    // The same hole, the other way round: with the range restricted to the
    // stampable list, `collapsed=true` hid the paragraphs and left the figure
    // sitting on the page under a closed heading.
    const host = await render(
      [
        "<!-- vantage: section collapsed=true -->",
        "",
        "## Section",
        "",
        "Para one.",
        "",
        "<figure><figcaption>Cap</figcaption></figure>",
      ].join("\n"),
    );

    expect(
      host.querySelector("figure")!.getAttribute("data-vantage-collapsed"),
    ).toBe("true");
    expect(
      host.querySelector("figure")!.getAttribute("data-vantage-collapse-group"),
    ).toBe(
      host.querySelector("p")!.getAttribute("data-vantage-collapse-group"),
    );
  });

  it("is inert when the target itself is not a stampable tag", async () => {
    // The other half of the same list, and it behaves differently: a
    // non-stampable *target* drops the directive entirely — the walk does not
    // look past it for a candidate, so the section never starts.
    const host = await render(
      [
        "<!-- vantage: section tone=tip -->",
        "",
        "<section><p>Inner.</p></section>",
        "",
        "After.",
      ].join("\n"),
    );

    expect(stamped(host.querySelector("section"))).toEqual({});
    for (const paragraph of Array.from(host.querySelectorAll("p"))) {
      expect(stamped(paragraph)).toEqual({});
    }
  });

  it("gives a lone block the run value `only`", async () => {
    const host = await render(
      "<!-- vantage: block tone=important -->\n\nOne.\n",
    );

    expect(stamped(host.querySelector("p"))).toEqual({
      "data-vantage-tone": "important",
      "data-vantage-run": "only",
    });
  });

  it("keeps `block` to one block even in front of a heading", async () => {
    // The name is what picks the extent; it cannot disagree with position,
    // because position is still what picks the target.
    const host = await render(
      "<!-- vantage: block tone=note -->\n\n## Heading\n\nBody.\n",
    );

    expect(stamped(host.querySelector("h2"))).toEqual({
      "data-vantage-tone": "note",
      "data-vantage-run": "only",
    });
    expect(stamped(host.querySelector("p"))).toEqual({});
  });

  it("degrades `section` to one block when the target is not a heading", async () => {
    const host = await render(
      "<!-- vantage: section tone=note -->\n\nFirst.\n\nSecond.\n",
    );

    expect(stamped(host.querySelectorAll("p")[0])).toEqual({
      "data-vantage-tone": "note",
      "data-vantage-run": "only",
    });
    expect(stamped(host.querySelectorAll("p")[1])).toEqual({});
  });

  it("lets a nested section override one property and inherit the rest", async () => {
    // R5, on a real nested document rather than two adjacent headings: the
    // inner `###` is inside the outer `##`'s range, and its own directive sits
    // at a higher child index, so each property is last-write-wins.
    const host = await render(NESTED);

    expect(stamped(host.querySelector("h2"))).toMatchObject({
      "data-vantage-tone": "warning",
      "data-vantage-emphasis": "strong",
    });
    expect(stamped(host.querySelectorAll("p")[0])).toMatchObject({
      "data-vantage-tone": "warning",
      "data-vantage-emphasis": "strong",
    });
    // The inner section keeps the outer emphasis and takes its own tone.
    expect(stamped(host.querySelector("h3"))).toMatchObject({
      "data-vantage-tone": "note",
      "data-vantage-emphasis": "strong",
    });
    expect(stamped(host.querySelectorAll("p")[1])).toMatchObject({
      "data-vantage-tone": "note",
      "data-vantage-emphasis": "strong",
    });
    // And the section after the outer one is plain.
    expect(stamped(host.querySelectorAll("h2")[1])).toEqual({});
    expect(stamped(host.querySelectorAll("p")[2])).toEqual({});
  });

  it("restarts the run at a nested section, so its rule terminates", async () => {
    const host = await render(NESTED);

    expect(runs(host, "[data-vantage-tone]")).toEqual([
      "start",
      "middle",
      "start",
      "end",
    ]);
  });
});

describe("`badge` marks the target, not the run", () => {
  /** Every element carrying a badge, as `tag=value`. */
  const badges = (host: HTMLElement) =>
    Array.from(host.querySelectorAll("[data-vantage-badge]")).map(
      (el) =>
        `${el.tagName.toLowerCase()}=${el.getAttribute("data-vantage-badge")}`,
    );

  it("draws one chip beside the heading, not one per block in the section", async () => {
    // `tone` and `emphasis` are treatments of a run — a rule slice and a weight
    // on every member. `badge` is a single chip on one block ("a small chip
    // after the heading text", §4.3), and the CSS draws it as
    // `[data-vantage-badge]::after`, so stamping the run painted the word once
    // per paragraph, list, fence and table under the heading.
    const host = await render(
      [
        "<!-- vantage: section tone=warning emphasis=strong badge=stale -->",
        "",
        "## Migration path",
        "",
        "The steps below predate the rewrite.",
        "",
        "- One",
        "- Two",
        "",
        "```sh",
        "make",
        "```",
      ].join("\n"),
    );

    expect(badges(host)).toEqual(["h2=stale"]);
    // The run treatments still reach every member, which is the asymmetry.
    expect(runs(host, "[data-vantage-tone]")).toEqual([
      "start",
      "middle",
      "middle",
      "end",
    ]);
    expect(
      host.querySelectorAll("[data-vantage-emphasis='strong']"),
    ).toHaveLength(4);
  });

  it("stamps the one block a `section` degraded onto", async () => {
    // `section` before a non-heading is one block (A1), and that block is the
    // target — so the chip is drawn, once, rather than dropped.
    const host = await render(
      "<!-- vantage: section badge=stale -->\n\nFirst.\n\nSecond.\n",
    );

    expect(badges(host)).toEqual(["p=stale"]);
  });

  it("stamps a `block` heading, and only that heading", async () => {
    const host = await render(
      "<!-- vantage: block badge=draft -->\n\n## H\n\nBody.\n",
    );

    expect(badges(host)).toEqual(["h2=draft"]);
  });

  it("stamps a `block` paragraph — the chip is not heading-only", async () => {
    // Why the fix is in the plugin and not a `:is(h1,…,h6)[data-vantage-badge]`
    // selector: `badge` is in the keys `section` and `block` share, so a
    // heading-only chip would silently draw nothing for this document.
    const host = await render(
      "<!-- vantage: block badge=draft -->\n\nPara.\n\nNext.\n",
    );

    expect(badges(host)).toEqual(["p=draft"]);
  });

  it("stamps no run for a badge-only section", async () => {
    // Same reason a collapse-only section stamps none: `run` describes where a
    // tone's rule starts and stops, and a lone chip has no rule to join up. The
    // body blocks of this section carry nothing at all.
    const host = await render(
      "<!-- vantage: section badge=stale -->\n\n## H\n\nOne.\n\nTwo.\n",
    );

    expect(stamped(host.querySelector("h2"))).toEqual({
      "data-vantage-badge": "stale",
    });
    expect(stamped(host.querySelectorAll("p")[0])).toEqual({});
    expect(stamped(host.querySelectorAll("p")[1])).toEqual({});
  });

  it("still stamps the run when a range treatment rides along", async () => {
    const host = await render(
      "<!-- vantage: section emphasis=quiet badge=stale -->\n\n## H\n\nOne.\n",
    );

    expect(stamped(host.querySelector("h2"))).toEqual({
      "data-vantage-emphasis": "quiet",
      "data-vantage-badge": "stale",
      "data-vantage-run": "start",
    });
    expect(stamped(host.querySelector("p"))).toEqual({
      "data-vantage-emphasis": "quiet",
      "data-vantage-run": "end",
    });
  });
});

describe("merging", () => {
  const MERGED = [
    "<!-- vantage: section tone=note badge=draft -->",
    "<!-- vantage: section tone=warning -->",
    "",
    "## Heading",
    "",
    "Body.",
  ].join("\n");

  it("merges every directive before one target, last key wins", async () => {
    const host = await render(MERGED);

    expect(stamped(host.querySelector("h2"))).toMatchObject({
      "data-vantage-tone": "warning",
      "data-vantage-badge": "draft",
    });
  });

  it("does not care whether a blank line separates the two comments", async () => {
    // Measured: adjacent comments and comments separated by a blank line
    // produce byte-identical trees, so a rule that told them apart would have
    // to re-read line numbers to do it. This pins that it does not.
    const withGap = MERGED.replace(" -->\n<!--", " -->\n\n<!--");
    const withoutLineNumbers = (markup: string) =>
      markup.replace(/ data-source-line="\d+"/g, "");

    // Everything but the line numbers, which the extra line legitimately moves.
    expect(withoutLineNumbers(await html(withGap))).toBe(
      withoutLineNumbers(await html(MERGED)),
    );
  });

  it("merges across capabilities without one shadowing the other", async () => {
    const host = await render(
      [
        "<!-- vantage: section tone=note -->",
        '<!-- vantage: question leaning="Ship it" -->',
        "",
        "## Question",
        "",
        "Body.",
      ].join("\n"),
    );

    expect(stamped(host.querySelector("h2"))).toEqual({
      "data-vantage-tone": "note",
      "data-vantage-run": "start",
      "data-vantage-question": "true",
      "data-vantage-leaning": "Ship it",
    });
    // A question marks one block, so it does not follow the section.
    expect(stamped(host.querySelector("p"))).toEqual({
      "data-vantage-tone": "note",
      "data-vantage-run": "end",
    });
  });
});

describe("display math stays a member of the run it sits in", () => {
  /**
   * `$$…$$` reaches rehype as a `<pre>`, which is a style target, so the plugin
   * stamps it and counts it. `rehype-katex` then *replaces* that `<pre>` with a
   * `<span class="katex-display">` — `parent.children.splice(index, 1, …result)`
   * — and every attribute went with it. The section's rule is drawn per member
   * and bled upward a fixed 40px, so a lost member is a hole about the formula's
   * own height (measured in Chrome: 58px for a one-line fraction), and the
   * section reads as two. `rehypeVantageMathStamps` is the pair that brackets
   * `rehype-katex` to carry the attributes across; these are its guard.
   *
   * The DOM assertions here are the whole test. The gap itself is a pixel fact
   * that jsdom cannot see — `getComputedStyle(el, "::before")` throws — so the
   * geometry is in `frontend/e2e/directive_tone_rule.spec.ts` instead, which
   * documents rather than guards because the `Justfile` never runs playwright.
   */
  const SECTION = [
    "<!-- vantage: section tone=note -->",
    "",
    "## Toned",
    "",
    "Above.",
    "",
    "$$",
    "E = mc^2",
    "$$",
    "",
    "Below.",
  ].join("\n");

  it("carries the stamp onto the element KaTeX puts in the block's place", async () => {
    const host = await render(SECTION);
    const math = host.querySelector(".katex-display");

    expect(math).not.toBeNull();
    // No `<pre>` survives: this is a replacement, not a wrapping, which is why
    // the attributes have to be copied rather than inherited.
    expect(host.querySelector("pre")).toBeNull();
    expect(stamped(math)).toEqual({
      "data-vantage-tone": "note",
      "data-vantage-run": "middle",
    });
  });

  it("leaves the run markers an unbroken start→end chain", async () => {
    const host = await render(SECTION);

    expect(runs(host, "[data-vantage-tone]")).toEqual([
      "start",
      "middle",
      "middle",
      "end",
    ]);
  });

  it("carries `data-source-line`, so a `#L` anchor still finds the formula", async () => {
    const host = await render(SECTION);

    expect(
      host.querySelector(".katex-display")!.getAttribute("data-source-line"),
    ).toBe("7");
  });

  it("treats a ```math fence the same as `$$`", async () => {
    const host = await render(
      [
        "<!-- vantage: section tone=tip -->",
        "",
        "## Toned",
        "",
        "```math",
        "\\sum_i x_i",
        "```",
        "",
        "Below.",
      ].join("\n"),
    );

    expect(stamped(host.querySelector(".katex-display"))).toEqual({
      "data-vantage-tone": "tip",
      "data-vantage-run": "middle",
    });
  });

  it("gives a lone formula the wash marker, not a run slice", async () => {
    const host = await render(
      "<!-- vantage: block tone=note -->\n\n$$\nx\n$$\n",
    );

    expect(stamped(host.querySelector(".katex-display"))).toEqual({
      "data-vantage-tone": "note",
      "data-vantage-run": "only",
    });
  });

  it("carries the stamp onto a formula that failed to parse", async () => {
    // KaTeX's fallback emits `katex-error` rather than `katex-display`. A
    // formula the author got wrong is still a member of the section around it.
    const host = await render(
      "<!-- vantage: block tone=note -->\n\n$$\n\\frac{\n$$\n",
    );

    expect(stamped(host.querySelector(".katex-error"))).toEqual({
      "data-vantage-tone": "note",
      "data-vantage-run": "only",
    });
  });

  it("keeps three adjacent formulae in one chain", async () => {
    // The carry finds the replacement by the sibling before it, so consecutive
    // formulae are the case that would break if that sibling were itself a
    // replaced block. mdast-to-hast separates them with newline text nodes.
    const host = await render(
      [
        "<!-- vantage: section tone=note -->",
        "",
        "## Toned",
        "",
        "$$",
        "a",
        "$$",
        "$$",
        "b",
        "$$",
        "$$",
        "c",
        "$$",
        "",
        "End.",
      ].join("\n"),
    );

    expect(host.querySelectorAll(".katex-display")).toHaveLength(3);
    expect(runs(host, "[data-vantage-tone]")).toEqual([
      "start",
      "middle",
      "middle",
      "middle",
      "end",
    ]);
  });

  it("carries the stamp inside a list item and a blockquote", async () => {
    const inList = await render(
      "- item\n\n  <!-- vantage: block tone=tip -->\n\n  $$\n  x\n  $$\n",
    );
    const inQuote = await render(
      "> <!-- vantage: block tone=tip -->\n>\n> $$\n> x\n> $$\n",
    );

    for (const host of [inList, inQuote]) {
      expect(stamped(host.querySelector(".katex-display"))).toEqual({
        "data-vantage-tone": "tip",
        "data-vantage-run": "only",
      });
    }
  });

  it("makes `collapsed=true` reach a formula in the body", async () => {
    // Before the carry this was content on screen under a closed heading: the
    // paragraph hid and the formula did not, because the attribute the toggle
    // JS looks for died with the `<pre>`.
    const host = await render(
      [
        "<!-- vantage: section collapsed=true -->",
        "",
        "## Toned",
        "",
        "Above.",
        "",
        "$$",
        "E = mc^2",
        "$$",
      ].join("\n"),
    );

    expect(stamped(host.querySelector(".katex-display"))).toEqual({
      "data-vantage-collapsed": "true",
      "data-vantage-collapse-group": "1",
    });
    expect(
      host.querySelectorAll('[data-vantage-collapse-group="1"]'),
    ).toHaveLength(2);
  });

  it("stamps nothing extra on a formula outside any directive", async () => {
    const host = await render("Plain.\n\n$$\nx\n$$\n");

    expect(stamped(host.querySelector(".katex-display"))).toEqual({});
  });
});

describe("unknown is inert (P3/D2)", () => {
  it("drops one bad key and keeps its siblings", async () => {
    const host = await render(
      "<!-- vantage: section tone=warning bogus=zzz badge=stale -->\n\n## H\n\nBody.\n",
    );

    expect(stamped(host.querySelector("h2"))).toEqual({
      "data-vantage-tone": "warning",
      "data-vantage-badge": "stale",
      "data-vantage-run": "start",
    });
  });

  it("drops one bad value and keeps its siblings", async () => {
    const host = await render(
      "<!-- vantage: section tone=chartreuse badge=stale -->\n\n## H\n\nBody.\n",
    );

    // No run marker: dropping `tone` left a chip on the heading and nothing to
    // join the section's blocks up with.
    expect(stamped(host.querySelector("h2"))).toEqual({
      "data-vantage-badge": "stale",
    });
  });

  it("drops the whole directive for an unknown name", async () => {
    // There is no target semantics without a name, so this is per-directive
    // where a bad key is per-key. `callout` is the design doc's own first
    // example, and it is not in the name set.
    for (const markdown of [
      "<!-- vantage: callout tone=warning -->\n\n## H\n",
      "<!-- vantage: bogusname tone=warning -->\n\n## H\n",
    ]) {
      expect(await html(markdown)).not.toContain("data-vantage-");
    }
  });

  it("stamps nothing at all when a directive resolves to no attribute", async () => {
    // Not even a run marker: `<!-- vantage: section -->` and a directive whose
    // every value was a typo must both leave a plain document.
    for (const markdown of [
      "<!-- vantage: section -->\n\n## H\n\nBody.\n",
      "<!-- vantage: section tone=chartreuse -->\n\n## H\n\nBody.\n",
    ]) {
      expect(await html(markdown)).not.toContain("data-vantage-");
    }
  });

  it("drops `oq` on a target no review anchor can resolve", async () => {
    // `ol`/`ul` are in neither the viewer's ANCHOR_TAGS nor the review hook's
    // block map, so a button there would build an unresolvable anchor — the
    // mis-wired button D6 forbids. The style half of the same run still lands.
    for (const list of ["1. One\n2. Two\n", "- One\n- Two\n"]) {
      const host = await render(
        `<!-- vantage: oq leaning="No" -->\n<!-- vantage: block tone=note -->\n\n${list}`,
      );
      const target = host.querySelector("ol, ul")!;

      expect(target.hasAttribute("data-vantage-oq")).toBe(false);
      expect(target.hasAttribute("data-vantage-leaning")).toBe(false);
      expect(target.getAttribute("data-vantage-tone")).toBe("note");
    }
  });

  it("never throws and never logs, on anything", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "debug").mockImplementation(() => {}),
    ];
    try {
      for (const comment of [
        "vantage:",
        "vantage: ",
        "vantage: Section",
        "vantage: section tone",
        "vantage: section tone=",
        "vantage: oq leaning='x'",
        "vantage: section tone=note vantage: block",
        "vantage: section tone=notebadge=x",
        "vantage: -",
        "vantage: 1section",
        "vantage: section tone=warning",
        "TODO: rewrite this",
      ]) {
        await expect(
          html(`<!--${comment}-->\n\n## H\n\nBody.\n`),
        ).resolves.toBeTypeOf("string");
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

/**
 * `oq` — the name `question` replaces, deprecated and never removed. It renders
 * as it has since 0.7, and now carries the question stamp beside its own.
 */
describe("the `oq` directive", () => {
  it("marks the block with the string `true`, never a bare attribute", async () => {
    // `rehype-stringify` emits a bare `data-vantage-oq` for the boolean `true`
    // while react-markdown emits `="true"`. Different markup from the checker
    // and the app is a D5 violation with no error anywhere, so the plugin emits
    // the string and this test pins the serialization, not the tree.
    const markup = await html('<!-- vantage: oq leaning="Yes" -->\n\nBody.\n');

    expect(markup).toContain('data-vantage-oq="true"');
    expect(markup).not.toMatch(/data-vantage-oq[ >]/);
    expect(markup).toContain('data-vantage-question="true"');
    expect(markup).not.toMatch(/data-vantage-question[ >]/);
  });

  it("collapses the whitespace of a wrapped leaning", async () => {
    const host = await render(
      [
        "<!-- vantage: oq id=OQ-9",
        '     leaning="Back of the queue —',
        "               the fix may interact",
        '               with what merged." -->',
        "",
        "Body.",
      ].join("\n"),
    );

    expect(host.querySelector("p")!.getAttribute("data-vantage-leaning")).toBe(
      "Back of the queue — the fix may interact with what merged.",
    );
  });

  it("caps a runaway leaning rather than growing the attribute forever", async () => {
    const host = await render(
      `<!-- vantage: oq leaning="${"a".repeat(900)}" -->\n\nBody.\n`,
    );

    expect(
      host.querySelector("p")!.getAttribute("data-vantage-leaning"),
    ).toHaveLength(500);
  });

  it("emits no leaning attribute for a blank one", async () => {
    // D6: an empty comment body is worse than the default the button falls back
    // to, so an absent and a whitespace-only leaning behave identically.
    const host = await render('<!-- vantage: oq leaning="   " -->\n\nBody.\n');

    expect(stamped(host.querySelector("p"))).toEqual({
      "data-vantage-oq": "true",
      "data-vantage-question": "true",
    });
  });

  it("carries `--` all the way to the DOM", async () => {
    // Through the real chain, not just the parser: HTML5 closes a comment on
    // `-->` or `--!>` and on nothing else, so a bare `--` inside a value is
    // legal and there is no restriction on it anywhere in the pipeline.
    const host = await render(
      '<!-- vantage: oq leaning="a--b — em--dashes stay" -->\n\nBody.\n',
    );

    expect(host.querySelector("p")!.getAttribute("data-vantage-leaning")).toBe(
      "a--b — em--dashes stay",
    );
  });

  it("resolves `id` into the block's anchor", async () => {
    // The id used to stop at the source: nothing in the DOM read it, so
    // stamping it bought a sanitizer entry for nothing. A reference of the form
    // `[OQ-9](#OQ-9)` is what gave it a reader, and `ref/unlinked-oq` is what
    // requires references to take that form. See `oqAnchors.test.ts` for the
    // sanitizer trap that shape has to survive.
    const markup = await html("<!-- vantage: oq id=OQ-9 -->\n\nBody.\n");

    expect(markup).toContain('data-vantage-oq="true"');
    expect(markup).toContain('id="OQ-9"');
    // The carrier attribute does not outlive the promotion.
    expect(markup).not.toContain("data-vantage-oq-id");
  });
});

/**
 * `question` — a question in any state. It stamps `data-vantage-question`, the
 * attribute every question carries, and its leaning; `data-vantage-oq` stays
 * what it has meant since 0.7, "declared with `oq`".
 */
describe("the `question` directive", () => {
  it("anchors its block and carries its leaning, with no `oq` stamp", async () => {
    const host = await render(
      '<!-- vantage: question id=OQ-9 leaning="Yes." -->\n\nBody.\n',
    );

    expect(stamped(host.querySelector("p"))).toEqual({
      "data-vantage-question": "true",
      "data-vantage-leaning": "Yes.",
    });
    expect(host.querySelector("p")?.id).toBe("OQ-9");
  });

  it("stamps a 🔒 or ✅ question exactly as an open one: the state is the marker's", async () => {
    for (const marker of ["\u{1F512} ", "✅ ", "\u{1F4AC} ", ""]) {
      const host = await render(
        `<!-- vantage: question id=OQ-9 leaning="Yes." -->\n\n${marker}Body.\n`,
      );
      expect(stamped(host.querySelector("p")), marker).toEqual({
        "data-vantage-question": "true",
        "data-vantage-leaning": "Yes.",
      });
    }
  });

  it("is one question with an `oq` in the same run, read as a viewer before `question` reads it: the `oq` alone", async () => {
    // One run is one question, and a viewer that predates `question` drops it
    // and reads the `oq` alone. So the run carries the `oq` stamp and the
    // `oq`'s keys, whichever comes first, and none of the `question`'s: the
    // same bytes stamp the same leaning and the same anchor in 0.7 and 0.8.
    for (const run of [
      '<!-- vantage: question id=OQ-9 leaning="Q." -->\n<!-- vantage: oq leaning="O." -->',
      '<!-- vantage: oq leaning="O." -->\n<!-- vantage: question id=OQ-9 leaning="Q." -->',
    ]) {
      const host = await render(`${run}\n\nBody.\n`);
      expect(stamped(host.querySelector("p")), run).toEqual({
        "data-vantage-oq": "true",
        "data-vantage-question": "true",
        "data-vantage-leaning": "O.",
      });
      expect(host.querySelector("p")?.id, run).toBe("");
    }
    const host = await render(
      '<!-- vantage: question leaning="Q." -->\n<!-- vantage: oq id=OQ-9 -->\n\nBody.\n',
    );
    expect(stamped(host.querySelector("p"))).toEqual({
      "data-vantage-oq": "true",
      "data-vantage-question": "true",
    });
    expect(host.querySelector("p")?.id).toBe("OQ-9");
  });

  it("finds every question by one selector, under either name", async () => {
    const host = await render(
      [
        "<!-- vantage: oq id=OQ-1 -->",
        "",
        "One.",
        "",
        "<!-- vantage: question id=OQ-2 -->",
        "",
        "Two.",
        "",
      ].join("\n"),
    );
    expect(
      [...host.querySelectorAll(VANTAGE_QUESTION_SELECTOR)].map((el) => el.id),
    ).toEqual(["OQ-1", "OQ-2"]);
    expect(
      [...host.querySelectorAll(`[${VANTAGE_OQ_ATTRIBUTE}]`)].map(
        (el) => el.id,
      ),
    ).toEqual(["OQ-1"]);
  });

  it("lands only where an `oq` would", async () => {
    // Above a list it reaches the `<ul>`, which no review anchor resolves.
    const host = await render(
      "<!-- vantage: question id=OQ-9 -->\n\n- one\n- two\n",
    );
    expect(host.querySelector("[data-vantage-question]")).toBeNull();
    expect(host.querySelector("#OQ-9")).toBeNull();
  });

  it("is dropped whole by a viewer that does not know it", () => {
    // What a viewer before 0.8 does with it: an unknown name drops the whole
    // directive. Pinned against the parser, which hands every caller the name
    // unchanged, so only the vocabulary decides.
    const parsed = parseVantageDirective(" vantage: question id=OQ-9 ");
    expect(parsed).toMatchObject({ kind: "directive", name: "question" });
  });
});

describe("the `fallback` directive", () => {
  /** A drawing, then the block every other renderer shows in its place. */
  const DRAWING = [
    "Before.", // 1
    "", // 2
    "<div>", // 3
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" role="img" aria-label="A dot">', // 4
    '  <circle cx="10" cy="10" r="5" fill="currentColor"/>', // 5
    "</svg>", // 6
    "</div>", // 7
    "", // 8
    "<!-- vantage: fallback -->", // 9
    "", // 10
    "This drawing needs Vantage 0.8 or later.", // 11
    "", // 12
    "After.", // 13
  ].join("\n");

  it("withholds the block after it, and only that block", async () => {
    const host = await render(DRAWING);

    expect(host.textContent).not.toContain("needs Vantage");
    expect(host.querySelector("svg")).not.toBeNull();
    expect(
      Array.from(host.querySelectorAll("p")).map((p) => p.textContent),
    ).toEqual(["Before.", "After."]);
    // Every block that remains keeps its own line, so anchors elsewhere in
    // the document are untouched.
    expect(
      Array.from(host.querySelectorAll("[data-source-line]")).map((el) =>
        el.getAttribute("data-source-line"),
      ),
    ).toEqual(["1", "3", "13"]);
    expect(await html(DRAWING)).not.toContain("<!--");
  });

  it("is what P1 permits it to be: deleting it shows the block and changes nothing else", async () => {
    // The one directive that changes what Vantage shows, and only by
    // withholding a stand-in written for other renderers. Deleted, the
    // stand-in appears and the rest of the document is byte-identical.
    const deleted = DRAWING.replace("<!-- vantage: fallback -->", "");
    const withIt = await html(DRAWING);
    const without = await html(deleted);

    expect(prose(without)).toContain(
      "This drawing needs Vantage 0.8 or later.",
    );
    expect(
      without
        .replace(
          /<p data-source-line="11">This drawing needs Vantage 0\.8 or later\.<\/p>/,
          "",
        )
        .replace(/\s+/g, " ")
        .trim(),
    ).toBe(withIt.replace(/\s+/g, " ").trim());
  });

  it("withholds every block shape a stand-in is written as", async () => {
    for (const block of [
      "A paragraph with [a link](./chart.svg).",
      "- a list\n- of two",
      "> a quote",
      "> [!NOTE]\n> an alert",
      "```text\n+---+\n| A |\n+---+\n```",
      "| a | b |\n| - | - |\n| 1 | 2 |",
      "$$\nx^2\n$$",
      "<div>raw <em>HTML</em></div>",
      "---",
    ]) {
      const host = await render(
        `Kept.\n\n<!-- vantage: fallback -->\n\n${block}\n\nAlso kept.\n`,
      );
      expect(
        Array.from(host.children).map((el) => el.textContent?.trim()),
        block,
      ).toEqual(["Kept.", "Also kept."]);
    }
  });

  it("withholds a raw <div> that holds Markdown, nested ones and all, up to its closing tag", async () => {
    const host = await render(
      [
        "Kept.",
        "",
        "<!-- vantage: fallback -->",
        "",
        "<div>",
        "",
        "Inside, [a link](./plan.md).",
        "",
        "<div>",
        "",
        "Nested.",
        "",
        "</div>",
        "",
        "Still inside.",
        "",
        "</div>",
        "",
        "Also kept.",
        "",
      ].join("\n"),
    );
    expect(
      Array.from(host.children).map((el) => el.textContent?.trim()),
    ).toEqual(["Kept.", "Also kept."]);
  });

  // The list of what a fallback withholds is notation, frozen once released
  // (P0): a later release that withheld these would hide what every release
  // before it shows. So they stay shown, and `vantage-check` says to wrap one
  // in a `<div>` instead.
  it("shows a raw <img>, <figure> or <details>, which are not on its list", async () => {
    for (const [block, tag] of [
      ['<img src="chart.png" alt="The chart" width="300">', "img"],
      [
        '<figure><img src="chart.png" alt="The chart"><figcaption>Needs 0.8</figcaption></figure>',
        "figure",
      ],
      ["<details><summary>The chart</summary>Needs 0.8.</details>", "details"],
    ] as const) {
      const host = await render(
        `Kept.\n\n<!-- vantage: fallback -->\n\n${block}\n\nAlso kept.\n`,
      );
      expect(host.querySelector(tag), block).not.toBeNull();
    }
    // Wrapped in a <div>, the same stand-in is withheld.
    const wrapped = await render(
      'Kept.\n\n<!-- vantage: fallback -->\n\n<div>\n<img src="chart.png" alt="The chart">\n</div>\n\nAlso kept.\n',
    );
    expect(wrapped.querySelector("img")).toBeNull();
  });

  it("never withholds a heading, which is structure rather than a stand-in", async () => {
    // The contents column lists it, other documents link to its slug, and the
    // planning index reads sections under it. The rest of the run still
    // applies.
    const host = await render(
      "<!-- vantage: section tone=note -->\n<!-- vantage: fallback -->\n\n## Kept\n\nBody.\n",
    );

    expect(host.querySelector("h2")?.textContent).toBe("Kept");
    expect(stamped(host.querySelector("h2"))).toEqual({
      "data-vantage-tone": "note",
      "data-vantage-run": "start",
    });
  });

  it("is inert where it has no block: inline, in a tight list item, or last", async () => {
    // The same three places every other name stamps nothing, for the same
    // reasons: inline, the next element is phrasing; in a tight item, the
    // paragraph is bare text; last, there is nothing after it.
    for (const [markdown, expected] of [
      [
        "Some prose <!-- vantage: fallback --> <em>kept</em> too.\n",
        "Some prose kept too.",
      ],
      ["- one\n  <!-- vantage: fallback -->\n  kept\n- two\n", "one kept two"],
      ["Kept.\n\n<!-- vantage: fallback -->\n", "Kept."],
    ]) {
      expect(prose(await html(markdown)), markdown).toBe(expected);
    }
  });

  it("withholds inside a list item and a quote, never past its own parent", async () => {
    const host = await render(
      [
        "1. Item.",
        "",
        "   <!-- vantage: fallback -->",
        "",
        "   Withheld.",
        "",
        "   Kept in the item.",
        "",
        "> <!-- vantage: fallback -->",
        ">",
        "> Withheld too.",
        "",
        "After the quote.",
      ].join("\n"),
    );

    expect(host.textContent).not.toContain("Withheld");
    expect(host.querySelector("li")?.textContent).toContain(
      "Kept in the item.",
    );
    expect(host.querySelector("blockquote")).not.toBeNull();
    expect(host.textContent).toContain("After the quote.");
  });

  it("takes the rest of its run with it, so nothing re-targets the next block", async () => {
    // A tone or a question merged onto the withheld block goes with it. Left
    // behind, the run would land on the block after it and style — or offer
    // an answer on — something nobody wrote it for.
    const markup = await html(
      [
        "<!-- vantage: block tone=warning -->",
        '<!-- vantage: oq id=OQ-7 leaning="Yes." -->',
        "<!-- vantage: fallback -->",
        "",
        "Withheld.",
        "",
        "Next.",
      ].join("\n"),
    );

    expect(prose(markup)).toBe("Next.");
    expect(markup).not.toContain("data-vantage-");
    expect(markup).not.toContain('id="OQ-7"');
  });

  it("is never a member of the section around it", async () => {
    // Withheld before anything is stamped, so the last block the reader sees
    // closes the section's rule and a collapse group counts only what is
    // there.
    const host = await render(
      [
        "<!-- vantage: section tone=tip collapsed=true -->",
        "",
        "## Toned",
        "",
        "Seen.",
        "",
        "<!-- vantage: fallback -->",
        "",
        "Withheld.",
        "",
        "## Next",
      ].join("\n"),
    );

    expect(runs(host, "[data-vantage-tone]")).toEqual(["start", "end"]);
    expect(host.querySelectorAll("[data-vantage-collapsed]")).toHaveLength(1);
    expect(host.textContent).not.toContain("Withheld");
  });

  it("does what the style guide says its inline SVG example does", async () => {
    // The guide tells agents to pair every drawing with a fallback block; its
    // example has to draw here and show nothing else.
    const example = [...STYLE_GUIDE.matchAll(/```markdown\n([\s\S]*?)```/g)]
      .map((match) => match[1] ?? "")
      .find((body) => body.includes("<svg"));
    expect(example).toContain("<!-- vantage: fallback -->");

    const host = await render(example!);
    expect(host.querySelectorAll("svg *")).toHaveLength(3);
    expect(host.textContent?.trim()).toBe("");
  });

  it("still withholds with an unknown key, which drops pair by pair (D2)", async () => {
    // A key a later release adds must not make this release show the block.
    const host = await render(
      "<!-- vantage: fallback for=svg -->\n\nWithheld.\n\nKept.\n",
    );

    expect(host.textContent).not.toContain("Withheld");
  });
});

describe("the `collapsed` token", () => {
  const SECTION = [
    "<!-- vantage: section collapsed=true -->",
    "",
    "## Details",
    "",
    "Body one.",
    "",
    "Body two.",
    "",
    "## Next",
    "",
    "Outside.",
  ].join("\n");

  it("stamps a toggle on the heading and a group on each body block", async () => {
    const host = await render(SECTION);

    // The heading takes a *different* attribute from the blocks it hides, and
    // that asymmetry is the design: sharing one would make a nested heading —
    // both a hidden member and a toggle — unreachable by either control.
    expect(stamped(host.querySelector("h2"))).toEqual({
      "data-vantage-collapse-toggle": "1",
    });
    for (const paragraph of Array.from(host.querySelectorAll("p")).slice(
      0,
      2,
    )) {
      expect(stamped(paragraph)).toEqual({
        "data-vantage-collapsed": "true",
        "data-vantage-collapse-group": "1",
      });
    }
    // The section ends where the tone's would: at the next same-depth heading.
    expect(stamped(host.querySelectorAll("h2")[1])).toEqual({});
    expect(stamped(host.querySelectorAll("p")[2])).toEqual({});
  });

  it("wraps nothing — no `details`, no `summary`, no added element", async () => {
    // Four measured breakages, not taste: comment cards would land inside the
    // `<summary>`, a summary click would also open the comment popover, the
    // typography plugin's `h2 + *` margin resets would stop matching, and it is
    // the restructuring the design's own Open Question settled against.
    const markup = await html(SECTION);

    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("<summary");
    expect(prose(markup)).toBe(
      prose(await html(SECTION.replace(/^<!-- vantage:.*-->$/m, ""))),
    );
  });

  it("shows every block, and no readiness marker, with no JS", async () => {
    // The gate the whole feature rests on. `renderMarkdown`'s HTML is what the
    // CLI checker reads and what an external consumer of the package's viewer
    // renders; the hiding CSS is gated on a marker only the toggle pass sets, so
    // this HTML must carry every block AND must not carry the marker. Hidden
    // content with no way to reveal it is content loss (P1/D8), not a style.
    const markup = await html(SECTION);

    expect(markup).not.toContain("data-vantage-collapse-ready");
    expect(prose(markup)).toContain("Body one.");
    expect(prose(markup)).toContain("Body two.");
  });

  it("numbers groups in document order, densely and repeatably", async () => {
    const host = await render(
      [
        "<!-- vantage: section collapsed=true -->",
        "",
        "## First",
        "",
        "A.",
        "",
        "<!-- vantage: section collapsed=true -->",
        "",
        "## Second",
        "",
        "B.",
        "",
        "<!-- vantage: section collapsed=true -->",
        "",
        "## Third",
        "",
        "C.",
      ].join("\n"),
    );

    expect(
      Array.from(host.querySelectorAll("[data-vantage-collapse-toggle]")).map(
        (el) => el.getAttribute("data-vantage-collapse-toggle"),
      ),
    ).toEqual(["1", "2", "3"]);
    expect(
      Array.from(host.querySelectorAll("[data-vantage-collapse-group]")).map(
        (el) => el.getAttribute("data-vantage-collapse-group"),
      ),
    ).toEqual(["1", "2", "3"]);
  });

  it("counts per document, so one render cannot renumber the next", async () => {
    // The counter lives in the transformer's closure. At module scope it would
    // renumber a document because another one rendered first, and `renderMarkdown`
    // running twice in one process has to produce byte-identical HTML.
    const once = await html(SECTION);
    await html(SECTION);

    expect(await html(SECTION)).toBe(once);
  });

  it("makes a nested heading both a hidden member and its own toggle", async () => {
    const host = await render(
      [
        "<!-- vantage: section collapsed=true -->",
        "",
        "## Outer",
        "",
        "Para A.",
        "",
        "<!-- vantage: section collapsed=true -->",
        "",
        "### Inner",
        "",
        "Para B.",
      ].join("\n"),
    );

    expect(stamped(host.querySelector("h3"))).toEqual({
      "data-vantage-collapsed": "true",
      "data-vantage-collapse-group": "1",
      "data-vantage-collapse-toggle": "2",
    });
    // The inner section's body belongs to the inner group: opening the outer one
    // reveals the `###` with its own caret still closed.
    expect(stamped(host.querySelectorAll("p")[1])).toEqual({
      "data-vantage-collapsed": "true",
      "data-vantage-collapse-group": "2",
    });
  });

  it("composes with tone without borrowing its run marker", async () => {
    const host = await render(
      [
        "<!-- vantage: section tone=note collapsed=true -->",
        "",
        "## Toned and closed",
        "",
        "Body.",
      ].join("\n"),
    );

    expect(stamped(host.querySelector("h2"))).toEqual({
      "data-vantage-tone": "note",
      "data-vantage-run": "start",
      "data-vantage-collapse-toggle": "1",
    });
    expect(stamped(host.querySelector("p"))).toEqual({
      "data-vantage-tone": "note",
      "data-vantage-run": "end",
      "data-vantage-collapsed": "true",
      "data-vantage-collapse-group": "1",
    });
  });

  it("stamps no run for a collapse-only section", async () => {
    // `run` describes where a tone's rule starts and stops. A section with no
    // tone has no rule to draw, so the attribute would be noise the CSS reads.
    const markup = await html(SECTION);

    expect(markup).not.toContain("data-vantage-run");
  });

  it("stamps nothing for `collapsed=false`", async () => {
    // `false` is the default written down, not a second state: "not collapsed"
    // is not a thing an attribute can usefully say, so the token's only effect
    // is on a `collapsed=true` in the same directive run (below).
    const host = await render(
      "<!-- vantage: section collapsed=false -->\n\n## Open\n\nBody.\n",
    );

    expect(stamped(host.querySelector("h2"))).toEqual({});
    expect(stamped(host.querySelector("p"))).toEqual({});
  });

  it("cancels a `collapsed=true` earlier in the same directive run", async () => {
    // The one thing `false` does do, and the reason it is in the vocabulary
    // rather than being an unknown value: adjacent comments merge into one
    // directive, last key wins, so the second pair overrides the first.
    const host = await render(
      [
        "<!-- vantage: section collapsed=true -->",
        "<!-- vantage: section collapsed=false -->",
        "",
        "## Head",
        "",
        "Body.",
        "",
      ].join("\n"),
    );

    expect(stamped(host.querySelector("h2"))).toEqual({});
    expect(stamped(host.querySelector("p"))).toEqual({});
  });

  it("cannot cancel an ENCLOSING collapsed section", async () => {
    // Pinned deliberately, because the shipped comments used to claim the
    // opposite. A nested heading inside a collapsed `##` is a hidden member of
    // the outer group by design (A3) — that asymmetry is what makes nesting work
    // — and the outer run is stamped by a walk that has not resolved the inner
    // heading's directive yet. So the inner section is hidden until the reader
    // opens the outer one, and the inner `collapsed=false` changes nothing.
    //
    // Opting a subsection out would mean excluding its whole run from the outer
    // group, so closing the outer section would leave a subsection on screen.
    // That is a feature with its own question to answer, not this behavior
    // being wrong.
    const host = await render(
      [
        "<!-- vantage: section collapsed=true -->",
        "",
        "## Outer",
        "",
        "Outer body.",
        "",
        "<!-- vantage: section collapsed=false -->",
        "",
        "### Inner",
        "",
        "Inner body.",
        "",
      ].join("\n"),
    );

    expect(stamped(host.querySelector("h2"))).toEqual({
      "data-vantage-collapse-toggle": "1",
    });
    // The inner heading: a hidden member of group 1, and no toggle of its own.
    expect(stamped(host.querySelector("h3"))).toEqual({
      "data-vantage-collapsed": "true",
      "data-vantage-collapse-group": "1",
    });
    for (const paragraph of Array.from(host.querySelectorAll("p"))) {
      expect(stamped(paragraph)).toEqual({
        "data-vantage-collapsed": "true",
        "data-vantage-collapse-group": "1",
      });
    }
  });

  it("drops `collapsed` on a `block` scope", async () => {
    // A hidden lone block with no summary is content that is simply gone: there
    // is nothing left on screen to reveal it. Only a heading can be a summary.
    const host = await render(
      "<!-- vantage: block collapsed=true -->\n\nLone paragraph.\n",
    );

    expect(stamped(host.querySelector("p"))).toEqual({});
  });

  it("drops `collapsed` on a `section` that degraded onto a non-heading", async () => {
    const host = await render(
      "<!-- vantage: section collapsed=true -->\n\nLone paragraph.\n",
    );

    expect(stamped(host.querySelector("p"))).toEqual({});
  });

  it("drops the toggle on a heading with no body blocks", async () => {
    // A caret that hides nothing is an affordance that lies, and the group id it
    // would have burned stays available for the next section.
    const host = await render(
      [
        "<!-- vantage: section collapsed=true -->",
        "",
        "## Empty",
        "",
        "<!-- vantage: section collapsed=true -->",
        "",
        "## Real",
        "",
        "Body.",
      ].join("\n"),
    );

    expect(stamped(host.querySelectorAll("h2")[0])).toEqual({});
    expect(stamped(host.querySelectorAll("h2")[1])).toEqual({
      "data-vantage-collapse-toggle": "1",
    });
  });

  it("keeps a value the vocabulary does not contain out of the DOM", async () => {
    const host = await render(
      "<!-- vantage: section collapsed=maybe -->\n\n## H\n\nBody.\n",
    );

    expect(stamped(host.querySelector("h2"))).toEqual({});
    expect(stamped(host.querySelector("p"))).toEqual({});
  });

  it("survives the sanitizer, group ids included", async () => {
    // The two new attributes are value-allowlisted by pattern rather than by
    // token list, so this is the assertion that catches a missing entry — and a
    // pattern that rejects the plugin's own output.
    const host = await render(SECTION);

    expect(
      host.querySelector("h2")!.getAttribute("data-vantage-collapse-toggle"),
    ).toBe("1");
    expect(
      host.querySelector("p")!.getAttribute("data-vantage-collapse-group"),
    ).toBe("1");
  });

  it("refuses a hand-written group that is not a number", async () => {
    // The toggle JS interpolates the value into a selector, so the sanitizer
    // pins it to digits: raw HTML is the only way a different shape could appear.
    const markup = await html(
      [
        '<h2 data-vantage-collapse-toggle="1) or true">a</h2>',
        '<p data-vantage-collapse-group="*">b</p>',
        '<p data-vantage-collapsed="true" data-vantage-collapse-group="2">c</p>',
      ].join("\n\n"),
    );

    expect(markup).not.toContain("or true");
    expect(markup).not.toContain('data-vantage-collapse-group="*"');
    expect(markup).toContain('data-vantage-collapse-group="2"');
  });
});

describe("the document is the artifact (P1/D8/D1)", () => {
  const FIXTURE = [
    "# Title", // 1
    "", // 2
    "<!-- vantage: section tone=warning emphasis=strong badge=stale -->", // 3
    "", // 4
    "## Migration path", // 5
    "", // 6
    "The steps below predate the rewrite.", // 7
    "", // 8
    '<!-- vantage: oq id=OQ-9 leaning="Back of the queue" -->', // 9
    "", // 10
    "_Leaning:_ back of the queue.", // 11
    "", // 12
    "## Next", // 13
    "", // 14
    "Untouched.", // 15
  ].join("\n");

  /** The same document with every directive line blanked, so lines still align. */
  const BLANKED = FIXTURE.split("\n")
    .map((line) => (line.trimStart().startsWith("<!-- vantage:") ? "" : line))
    .join("\n");

  /** The same document with the directive lines gone, as GitHub effectively sees it. */
  const DELETED = FIXTURE.split("\n")
    .filter((line) => !line.trimStart().startsWith("<!-- vantage:"))
    .join("\n");

  it("changes nothing but attributes — including every data-source-line", async () => {
    const withDirectives = (await html(FIXTURE))
      .replace(/ data-vantage-[a-z-]+="[^"]*"/g, "")
      // An `oq` directive also mints an `id`, which is an attribute and so is
      // within what P1 permits — but it has to come off alongside the
      // `data-vantage-*` set for this comparison to be about anything else.
      // Matched by the id grammar rather than by the fixture's literal value:
      // that removes exactly what a directive can add and leaves the heading
      // slugs, which `rehypeSlug` mints and which never start with `OQ-`.
      .replace(/ id="OQ-[A-Z0-9]*[0-9]+"/g, "");

    expect(withDirectives.replace(/\s+/g, " ").trim()).toBe(
      (await html(BLANKED)).replace(/\s+/g, " ").trim(),
    );
  });

  it("reads the same as the document with the directives deleted", async () => {
    expect(prose(await html(FIXTURE))).toBe(prose(await html(DELETED)));
  });

  it("leaves no comment in the rendered markup", async () => {
    // The plugin deliberately does not remove the comment node; the sanitizer
    // does, which is why nothing Vantage-specific reaches the DOM but the
    // attributes we allowlisted.
    const markup = await html(FIXTURE);

    expect(markup).not.toContain("<!--");
    expect(markup).not.toContain("vantage:");
  });

  it("renders identically twice in one process", async () => {
    // Declarative and idempotent: read on every render, meaning the same thing
    // every time, with no state accumulating in the module between trees.
    expect(await html(FIXTURE)).toBe(await html(FIXTURE));
  });
});

describe("the sanitizer is the second gate", () => {
  it("keeps every attribute the plugin emits", async () => {
    // The silent failure mode of this whole design: a stamped attribute that
    // `sanitize.ts` does not allowlist disappears with no error anywhere.
    const host = await render(
      [
        "<!-- vantage: section tone=warning emphasis=quiet badge=wip -->",
        '<!-- vantage: oq leaning="Take it" -->',
        "",
        "## Heading",
        "",
        "Body.",
      ].join("\n"),
    );

    expect(stamped(host.querySelector("h2"))).toEqual({
      "data-vantage-tone": "warning",
      "data-vantage-emphasis": "quiet",
      "data-vantage-badge": "wip",
      "data-vantage-run": "start",
      "data-vantage-oq": "true",
      "data-vantage-question": "true",
      "data-vantage-leaning": "Take it",
    });
  });

  it("strips a value the vocabulary does not contain, whoever wrote it", async () => {
    // Hand-written raw HTML bypasses the plugin entirely, which is what the
    // value-level allowlist is for.
    const markup = await html(
      [
        '<p data-vantage-tone="url(https://evil.example/x)">a</p>',
        '<p data-vantage-run="everywhere">b</p>',
        '<p data-vantage-oq="OQ-9">c</p>',
        '<p data-vantage-tone="warning">d</p>',
      ].join("\n\n"),
    );

    expect(markup).not.toContain("evil.example");
    expect(markup).not.toContain("everywhere");
    expect(markup).not.toContain("OQ-9");
    expect(markup).toContain('data-vantage-tone="warning"');
  });
});

/**
 * The status emoji are *prose*, not directive syntax — they sit in the
 * question's title where any renderer shows them — so nothing about them can be
 * asserted through `renderMarkdown`. What has to hold is that the two consumers
 * read one vocabulary: the checker's `vantage/oq-missing`, which must demand a
 * directive on an open question and never on a blocked one, and the viewer's
 * contents column, which shows the marker and needs a word for it.
 */
describe("open question status markers", () => {
  it("names the three states the convention defines, and only those", () => {
    expect(Object.keys(VANTAGE_OQ_STATUS)).toEqual([
      "open",
      "settled",
      "blocked",
    ]);
  });

  it("reads each marker out of a question title", () => {
    expect(vantageOqStatus("\u{1F4AC} **OQ-1: Should it?**")).toBe("open");
    expect(vantageOqStatus("\u2705 **OQ-2: Should it?**")).toBe("settled");
    expect(vantageOqStatus("\u{1F512} **OQ-3: Should it?**")).toBe("blocked");
  });

  it("returns null for a title carrying no marker", () => {
    expect(vantageOqStatus("**OQ-4: An unmarked question.**")).toBeNull();
    expect(vantageOqStatus("")).toBeNull();
  });

  it("does not mistake a deferred question for an unmarked one", () => {
    // The convention writes a pure-preference question as both markers, and the
    // second one is not in the vocabulary at all.
    expect(vantageOqStatus("\u{1F4AC} \u{1F937} **OQ-B5: How much?**")).toBe(
      "open",
    );
  });

  it("resolves a non-open marker ahead of an open one", () => {
    // A question wearing both has been ruled on and the stale marker simply has
    // not been cleared. Reading it as open re-opens a settled decision — and on
    // the checker's side would demand a directive for a blocked question, which
    // is a false positive that fails a build.
    expect(vantageOqStatus("\u{1F4AC} \u2705 **OQ-5: Decided.**")).toBe(
      "settled",
    );
    expect(vantageOqStatus("\u{1F4AC} \u{1F512} **OQ-6: Waiting.**")).toBe(
      "blocked",
    );
  });

  it("has a spoken label for every state, since one glyph says nothing aloud", () => {
    for (const state of Object.keys(VANTAGE_OQ_STATUS)) {
      expect(
        VANTAGE_OQ_STATUS_LABEL[state as keyof typeof VANTAGE_OQ_STATUS],
      ).toMatch(/\S/);
    }
  });
});
