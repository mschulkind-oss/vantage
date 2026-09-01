import { parseFrontmatter } from "../../../vantage-md/src/frontmatter.js";
import { VANTAGE_SENTINEL } from "../../../vantage-md/src/vantageDirectives.js";
import type { Collector } from "../core/collector.js";

/**
 * Frontmatter, delegated to the viewer's own parser.
 *
 * `parseFrontmatter` never throws — a document with broken frontmatter still
 * renders, with the block silently treated as body text. That is right for a
 * viewer and useless for an author, who sees a metadata card quietly missing
 * and no reason why. All this rule does is surface what the parser already
 * knew, in the parser's own words.
 *
 * `frontmatter/not-at-top` is the exception, and it has to be: it is the one
 * frontmatter failure the parser cannot record, because from its point of view
 * the document simply has no frontmatter.
 */
export function checkFrontmatter(collector: Collector): void {
  checkNotAtTop(collector);

  const { problem } = collector.doc.frontmatter;
  if (!problem) return;

  // The block starts on line 1, so a position inside it is offset by the
  // opening delimiter's line.
  const at = {
    line: problem.line === undefined ? 1 : problem.line + 1,
    column: problem.column ?? 1,
  };

  switch (problem.kind) {
    case "invalid":
      collector.report(
        "frontmatter/parse",
        at,
        `The frontmatter block does not parse, so Vantage renders it as body text instead of a metadata card.`,
        problem.message,
      );
      break;

    case "unterminated":
      collector.report(
        "frontmatter/unterminated",
        { line: 1, column: 1 },
        `The document opens with \`${problem.delimiter}\` but never closes it, so the metadata is rendered as body text.`,
      );
      break;

    case "not-a-mapping":
      collector.report(
        "frontmatter/not-a-mapping",
        { line: 1, column: 1 },
        `The frontmatter parses to a value rather than a table of fields. Vantage expects \`key: value\` pairs; a \`${problem.delimiter}\` at the top of a document is read as frontmatter, not as a horizontal rule.`,
      );
      break;
  }
}

/**
 * Frontmatter that would have parsed, sitting one line too low.
 *
 * `parseFrontmatter` is anchored: it reads frontmatter only when the document
 * *starts* with `---` or `+++`. So a `<!-- vantage: … -->` on line 1 — or an
 * editorial comment, or a single stray blank line — turns the whole block into
 * body text, and the parser records no `problem` because as far as it is
 * concerned the document has no frontmatter at all. Nothing else notices either:
 * the block becomes a `thematicBreak` plus a setext heading, both of which are
 * legal Markdown and legal directive targets, so `vantage/orphan` is happy too.
 *
 * The parser is deliberately **not** being taught to skip leading comments.
 * GitHub, Hugo and `gray-matter` all require frontmatter at offset 0, and
 * `marked` and bare CommonMark were measured rendering this document exactly as
 * Vantage does — an `<hr>` and an `<h2>` of the raw keys. Tolerating it in
 * Vantage alone would make the *viewer* the odd one out (D1 in reverse) while
 * every other reader still lost the metadata, and `parseFrontmatter` is exported
 * from the published package, so its contract is not this rule's to move. The
 * honest fix is to say so, loudly, here.
 *
 * The test is the parser itself: strip the leading whitespace and complete
 * comments, hand what is left to `parseFrontmatter`, and report only if that
 * yields a real table of fields *and* the block is shaped like frontmatter
 * rather than like a pair of horizontal rules (see `abutsDelimiters`).
 */
function checkNotAtTop(collector: Collector): void {
  const { text, frontmatter } = collector.doc;
  // The document really does open with a delimiter: whatever happened to it,
  // `problem` covers it and this rule has nothing to add.
  if (frontmatter.format !== "none" || frontmatter.problem !== undefined)
    return;

  const offset = leadingChrome(text);
  if (offset === undefined || offset === 0) return;

  const shifted = parseFrontmatter(text.slice(offset));
  if (shifted.format === "none" || shifted.problem !== undefined) return;
  if (Object.keys(shifted.frontmatter).length === 0) return;
  if (!abutsDelimiters(text.slice(offset), shifted.format)) return;

  const skipped = text.slice(0, offset);
  const delimiterLine = skipped.split("\n").length;
  const intruder = skipped.includes(VANTAGE_SENTINEL)
    ? "a `<!-- vantage: … -->` directive"
    : skipped.includes("<!--")
      ? "an HTML comment"
      : skipped.includes(BOM)
        ? "a byte-order mark"
        : "a blank line";
  // The directive case is worse than the others: the block it broke becomes a
  // horizontal rule, `hr` is a stampable target, so the directive attaches to it
  // and the author gets a styled rule as evidence that the markup "worked".
  const stamped = skipped.includes(VANTAGE_SENTINEL)
    ? " The directive then stamps the horizontal rule the block became, which is what makes the mistake look like it worked."
    : "";

  collector.report(
    "frontmatter/not-at-top",
    { line: 1, column: 1 },
    `Frontmatter has to be the first bytes of the file, and this document's \`${shifted.format === "toml" ? "+++" : "---"}\` is on line ${delimiterLine}, under ${intruder}. So the block is body text: it renders as a horizontal rule followed by a heading made of the raw keys, and every field in it is gone — no metadata card, no \`status:\` chip, no \`vantage:\` settings. Move whatever is above the opening delimiter below the closing one.${stamped}`,
  );
}

/**
 * Is this block shaped like frontmatter, or like two horizontal rules?
 *
 * `parseFrontmatter` cannot answer that and does not have to: at offset 0 a
 * `---` *is* the frontmatter delimiter, so it trims the region and hands it to
 * YAML. Below offset 0 the same bytes are ordinary Markdown, and YAML reads any
 * single line with a colon in it as a mapping — so `Note: this is a draft`
 * between two thematic breaks parses to `{Note: "this is a draft"}` and would
 * otherwise be reported as misplaced frontmatter with fields that were never
 * lost. That report is worse than noise: its remedy ("move whatever is above
 * the opening delimiter below the closing one") turns the prose into real
 * frontmatter and deletes the paragraph from the page.
 *
 * What actually differs is adjacency. Frontmatter abuts its delimiters, and
 * that is what makes the consequence this rule describes: the closing `---`
 * underlines the last key, so the block renders as a rule plus a setext heading
 * of the raw keys. A blank line beside either delimiter breaks that — the two
 * delimiters are thematic breaks, the prose is a paragraph between them, and
 * the document renders exactly as written with nothing missing. Measured both
 * ways through `renderMarkdown` (see delegates.test.ts). An internal blank line
 * is left alone: it changes nothing about either delimiter.
 */
function abutsDelimiters(text: string, format: "yaml" | "toml"): boolean {
  const delimiter = format === "toml" ? "+++" : "---";
  // Both bounds are read the way `parseFrontmatter` reads them: the end of the
  // opening delimiter's *line* (which may carry trailing spaces) and the
  // newline before the closing delimiter.
  const opened = text.indexOf("\n");
  const end = text.indexOf(`\n${delimiter}`, delimiter.length);
  if (opened === -1 || end === -1) return false;
  const inner = text.slice(opened + 1, end).split("\n");
  return inner[0]?.trim() !== "" && inner.at(-1)?.trim() !== "";
}

/** The one byte `\s` matches that no editor shows. */
const BOM = "\uFEFF";

/**
 * How many bytes of leading whitespace and complete HTML comments the document
 * opens with, or `undefined` if it opens with an unterminated comment — which is
 * `vantage/unterminated`'s finding to make, not this one's.
 */
function leadingChrome(text: string): number | undefined {
  let at = 0;
  for (;;) {
    while (at < text.length && /\s/.test(text[at] as string)) at++;
    if (!text.startsWith("<!--", at)) return at;
    const close = text.indexOf("-->", at + 4);
    if (close === -1) return undefined;
    at = close + 3;
  }
}
