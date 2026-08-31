/**
 * `<!-- vantage: … -->` directives: the grammar, the closed vocabulary, and what
 * the plugin stamps.
 *
 * The code under test lives in `packages/vantage-md`, which has no test runner
 * of its own; the frontend resolves `vantage-md` to that package's TypeScript
 * source (see `vite.config.ts`), so these run against the real thing — and
 * `renderMarkdown` runs the real chain, sanitiser included, which is the only
 * way to prove an attribute actually reaches a document rather than merely
 * being written onto a tree that the sanitiser then empties.
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
  VANTAGE_SENTINEL,
  VANTAGE_TONES,
  hasVantageSentinel,
  parseVantageDirective,
  renderMarkdown,
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

  it("calls a sentinelled comment that does not parse malformed, with a reason", () => {
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
  it("is exactly three names", () => {
    expect([...DIRECTIVE_NAMES]).toEqual(["section", "block", "oq"]);
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

  it("gives `section` and `block` the same keys, and `oq` free text", () => {
    // They differ in extent, not in what they can say.
    expect(Object.keys(DIRECTIVE_VOCABULARY.section ?? {})).toEqual(
      Object.keys(DIRECTIVE_VOCABULARY.block ?? {}),
    );
    expect(DIRECTIVE_VOCABULARY.section?.tone).toEqual(VANTAGE_TONES);
    // `id` and `leaning` are the design's only values with no closed set, which
    // is why they are the only ones the sanitiser cannot value-allowlist.
    expect(DIRECTIVE_VOCABULARY.oq).toEqual({ id: null, leaning: null });
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
    // sanitiser. Letting it change a directive's meaning would make behaviour
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

  it("resolves inside a list item, which is where an `oq` directive lives", async () => {
    // The design's own example puts the comment at column 0 between two list
    // items; measured, that splits one `<ol>` into two and visibly renumbers
    // the document, so the working form indents it inside the item. That is
    // also why the plugin walks the whole tree rather than the root's children.
    const host = await render(
      [
        "1. **OQ-B1: does the daemon retry?**",
        "",
        '   <!-- vantage: oq id=OQ-B1 leaning="Back of the queue" -->',
        "",
        "   _Leaning:_ back of the queue.",
        "",
        "2. Question two",
      ].join("\n"),
    );

    expect(host.querySelectorAll("ol")).toHaveLength(1);
    const target = host.querySelectorAll("li")[0].querySelectorAll("p")[1];
    expect(stamped(target)).toEqual({
      "data-vantage-oq": "true",
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
        "<!-- vantage: section badge=stale -->",
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

    expect(host.querySelector("h2")!.getAttribute("data-vantage-badge")).toBe(
      "stale",
    );
    expect(stamped(host.querySelectorAll("h1")[1])).toEqual({});
    expect(stamped(host.querySelectorAll("p")[1])).toEqual({});
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
        '<!-- vantage: oq leaning="Ship it" -->',
        "",
        "## Question",
        "",
        "Body.",
      ].join("\n"),
    );

    expect(stamped(host.querySelector("h2"))).toEqual({
      "data-vantage-tone": "note",
      "data-vantage-run": "start",
      "data-vantage-oq": "true",
      "data-vantage-leaning": "Ship it",
    });
    // `oq` marks one answerable question, so it does not follow the section.
    expect(stamped(host.querySelector("p"))).toEqual({
      "data-vantage-tone": "note",
      "data-vantage-run": "end",
    });
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

    expect(stamped(host.querySelector("h2"))).toEqual({
      "data-vantage-badge": "stale",
      "data-vantage-run": "start",
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

describe("the `oq` directive", () => {
  it("marks the block with the string `true`, never a bare attribute", async () => {
    // `rehype-stringify` emits a bare `data-vantage-oq` for the boolean `true`
    // while react-markdown emits `="true"`. Different markup from the checker
    // and the app is a D5 violation with no error anywhere, so the plugin emits
    // the string and this test pins the serialisation, not the tree.
    const markup = await html('<!-- vantage: oq leaning="Yes" -->\n\nBody.\n');

    expect(markup).toContain('data-vantage-oq="true"');
    expect(markup).not.toMatch(/data-vantage-oq[ >]/);
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

  it("resolves `id` without putting it in the DOM", async () => {
    // Nothing in the DOM reads it: the button finds its block by
    // `[data-vantage-oq]` and its text by `data-vantage-leaning`. The id stays
    // in the source, for the checker and for `rg`.
    const markup = await html("<!-- vantage: oq id=OQ-9 -->\n\nBody.\n");

    expect(markup).toContain('data-vantage-oq="true"');
    expect(markup).not.toContain("OQ-9");
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
    const withDirectives = (await html(FIXTURE)).replace(
      / data-vantage-[a-z-]+="[^"]*"/g,
      "",
    );

    expect(withDirectives.replace(/\s+/g, " ").trim()).toBe(
      (await html(BLANKED)).replace(/\s+/g, " ").trim(),
    );
  });

  it("reads the same as the document with the directives deleted", async () => {
    expect(prose(await html(FIXTURE))).toBe(prose(await html(DELETED)));
  });

  it("leaves no comment in the rendered markup", async () => {
    // The plugin deliberately does not remove the comment node; the sanitiser
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

describe("the sanitiser is the second gate", () => {
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
