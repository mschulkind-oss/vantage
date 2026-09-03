/**
 * GFM alerts — `> [!WARNING]` — compiled into `data-vantage-alert`.
 *
 * `remark-gfm` does not implement alerts, so until this plugin existed a
 * `> [!WARNING]` rendered as an ordinary blockquote with the literal marker
 * visible as its first words. Worse than merely unstyled: `@tailwindcss/typography`
 * italicises blockquotes and draws `open-quote`/`close-quote` around the first
 * paragraph, so a callout came out as an italic *quotation* whose opening words
 * were `"[!WARNING]`. That was the "Known gaps" entry in
 * `docs/reference/inline-markup.md` and OQ-10, filed rather than fixed, while
 * `styleGuide.ts` went on telling every agent to write them.
 *
 * The tokens are deliberately the ones the `tone` vocabulary already resolves —
 * an alert *is* the six-colour light/dark treatment `tone` shipped, which is
 * exactly what the gap entry said whoever fixed this should do rather than
 * building a second palette. `[!WARNING]` and `<!-- vantage: block tone=warning -->`
 * therefore agree by construction, and adding a theme still touches one
 * custom-property block.
 *
 * **This runs in the shared pipeline, so all four renderers get it** — the live
 * viewer, the package's exported viewer, the static export and the CLI checker's
 * `renderMarkdown`. That is what makes an injected title element acceptable here
 * where the collapse caret's glyph had to be drawn in CSS: the caret is injected
 * by app JS that may never run, and this is not (D5).
 *
 * ## What it does not do
 *
 * It does not touch a blockquote that carries no marker, and an unrecognised
 * marker (`[!HINT]`) is left exactly as it was — visible literal text, which is
 * the honest rendering of something GitHub also would not style. Silently
 * swallowing it would hide a typo that reads as a callout on neither renderer.
 */

import { visit } from "unist-util-visit";
import type { Element, Root, Text } from "hast";

/**
 * The five GFM alert kinds, lowercased.
 *
 * Deliberately *not* re-derived from `VANTAGE_TONES`: that list carries a sixth
 * token, `muted`, which is ours and is not an alert word. The overlap is the
 * point — the five that coincide share a palette — but the two vocabularies are
 * closed by different authorities and a change to one must not silently move the
 * other. A test asserts the five are a subset of the tones.
 */
export const VANTAGE_ALERTS = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const;

export type VantageAlert = (typeof VANTAGE_ALERTS)[number];

/** The visible label per kind. Title case, as GitHub renders it. */
export const ALERT_TITLES: Readonly<Record<VantageAlert, string>> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

/**
 * The marker, anchored and requiring the rest of its line to be empty.
 *
 * GFM puts the marker alone on the blockquote's first line, and holding to that
 * is what keeps a paragraph that merely *begins* with bracketed text from being
 * eaten. The trailing newline is optional only for the degenerate blockquote
 * whose entire content is the marker.
 *
 * Measured against the real chain rather than assumed: `remark-parse` reads
 * `[!TIP]` as a shortcut link reference, and because no definition matches,
 * `mdast-util-to-hast` puts it back as **one** leading text node —
 * `"[!TIP]\nThe generalization: "` — not as a `[`/label/`]` triple. So a single
 * anchored test on the first text node is enough, and the plugin does not have
 * to reassemble the marker across siblings.
 */
const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)/;

/** The first child, if it is an element. */
function firstElement(node: Element): Element | undefined {
  const child = node.children.find(
    (c) => c.type === "element" || (c.type === "text" && c.value.trim() !== ""),
  );
  return child?.type === "element" ? child : undefined;
}

/**
 * Compile `> [!KIND]` blockquotes into `data-vantage-alert="kind"`.
 *
 * Order in the chain matters twice, and both are stated in `pipeline.ts`:
 *
 * - **after `rehypeSourceLines`**, so the injected title carries no
 *   `data-source-line`. That is what keeps it out of `anchorBlockWithin`, which
 *   filters candidates to those with a finite line — otherwise a review comment
 *   on an alert would anchor to the word "Warning" instead of to the prose.
 * - **before `rehypeSanitize`**, so nothing reaches the DOM the schema has not
 *   passed. `dataVantageAlert` is allowlisted there by name *and* value, like
 *   every other `data-vantage-*` attribute.
 */
export function rehypeVantageAlerts() {
  return (tree: Root): void => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "blockquote") return;

      const paragraph = firstElement(node);
      if (paragraph === undefined || paragraph.tagName !== "p") return;

      const lead = paragraph.children[0];
      if (lead === undefined || lead.type !== "text") return;

      const match = MARKER.exec(lead.value);
      if (match === null) return;

      const kind = match[1].toLowerCase() as VantageAlert;
      lead.value = lead.value.slice(match[0].length);

      // A paragraph holding nothing but the marker leaves an empty <p> that
      // typography still gives a margin to, so the callout opens with a blank
      // line. Drop it — but only when it is genuinely empty, since
      // `> [!NOTE]\n> text` puts the text in this same node.
      if (lead.value === "" && paragraph.children.length === 1) {
        node.children = node.children.filter((c) => c !== paragraph);
      }

      node.properties = { ...node.properties, dataVantageAlert: kind };
      node.children.unshift({
        type: "element",
        tagName: "div",
        properties: { className: ["vantage-alert-title"] },
        children: [{ type: "text", value: ALERT_TITLES[kind] } as Text],
      } as Element);
    });
  };
}
