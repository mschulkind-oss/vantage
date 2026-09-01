/**
 * Sanitization schema for the rendering pipeline.
 * Allows GFM, KaTeX MathML, syntax highlighting classes, and
 * data-source-line attributes while blocking XSS vectors.
 */

import { defaultSchema } from "rehype-sanitize";
import {
  VANTAGE_BADGES,
  VANTAGE_COLLAPSED,
  VANTAGE_EMPHASIS,
  VANTAGE_RUNS,
  VANTAGE_TONES,
} from "./vantageDirectives.js";

type Schema = typeof defaultSchema;

/**
 * CSS properties an inline `style` may set.
 *
 * `style` has to be allowed at all because KaTeX positions every glyph with it
 * — strip the attribute and rendered math falls apart. But an unfiltered
 * `style` is a real hole: a document can cover the viewport with
 * `position:fixed;inset:0`, or call home on render with
 * `background:url(https://…)`, and both used to pass through verbatim. Scripts
 * were never the risk here; layout and network were.
 *
 * The list is deliberately typographic. Everything KaTeX emits is here —
 * measured against a battery of formulas in the frontend's sanitize test, which
 * fails if a KaTeX release starts using something new. GFM tables need nothing
 * from it: they carry `align` attributes, not CSS.
 */
const SAFE_STYLE_PROPERTIES = [
  // Box metrics — KaTeX sizes and offsets nearly every span with these.
  "height",
  "min-height",
  "max-height",
  "width",
  "min-width",
  "max-width",
  "top",
  "bottom",
  "left",
  "right",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  // Rules and boxes — KaTeX draws fraction bars and radicals with borders.
  "border",
  "border-style",
  "border-color",
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-radius",
  // Typography.
  "color",
  "background-color",
  "font",
  "font-size",
  "font-style",
  "font-weight",
  "font-family",
  "font-variant",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-decoration",
  "text-indent",
  "white-space",
  "vertical-align",
  "list-style-type",
  // Flow.
  "display",
  "float",
  "clear",
  "opacity",
  "overflow",
];

/**
 * A `style` value we will keep, as a whole.
 *
 * Two rules do the work. **No parentheses anywhere**, which is what closes
 * `url(…)` and `expression(…)` — the network and legacy-script vectors — and
 * costs nothing, because KaTeX never emits a parenthesis. And **`position` may
 * only be `static`, `relative` or `absolute`**: KaTeX needs the first three for
 * struts and rules, while `fixed` and `sticky` are what let a document escape
 * its container and cover the page.
 *
 * Matching is all-or-nothing: one unrecognised declaration drops the whole
 * attribute, and the element renders unstyled rather than partly styled. That
 * is the safe direction to fail, and it degrades to plain text rather than to a
 * broken page.
 *
 * **The grammar must stay unambiguous, and `;` is what keeps it so.** The value
 * class is "anything but the delimiters", which includes whitespace — a value
 * legitimately contains it (`margin: 0 auto`). So if whitespace could *also*
 * end a declaration, both constructs would compete for the same characters and
 * the match would fork at every declaration; on a value that ultimately fails,
 * the engine explores every fork. An earlier form of this regex separated
 * declarations with `\s*;?\s*`, and 200 document-controlled characters took the
 * renderer — and the CLI checker, and therefore CI — 94 seconds. Requiring `;`
 * pins each declaration's extent to the delimiter positions, so there is exactly
 * one way to parse any input and rejection is linear. `VALUE` absorbs the
 * padding on both sides for the same reason: a separate `\\s*` next to it would
 * put the ambiguity straight back. Pinned by the flat-time test in
 * `frontend/src/lib/sanitize.test.ts` — do not loosen the separator.
 *
 * Residual, stated plainly: an absolutely-positioned element can still overlap
 * its neighbours inside the article. Closing that needs containment in the
 * stylesheet, not in the sanitiser.
 */
const VALUE = `[^;:()"'\\\\]*`;
const DECLARATION = `(?:${SAFE_STYLE_PROPERTIES.join("|")})\\s*:${VALUE}`;
const POSITION = `position\\s*:\\s*(?:static|relative|absolute)\\s*`;
const ANY_DECLARATION = `(?:${DECLARATION}|${POSITION})`;

export const SAFE_STYLE = new RegExp(
  `^\\s*(?:${ANY_DECLARATION};\\s*)*${ANY_DECLARATION}?$`,
  "i",
);

/**
 * A collapse group id: one or more digits, anchored.
 *
 * The plugin mints these as a per-document counter, so there is no vocabulary to
 * list. Keeping the shape narrow matters anyway — the toggle JS builds a
 * `[data-vantage-collapse-group="…"]` selector out of the value, and a document
 * that hand-wrote raw HTML is the only way a non-numeric one could ever appear.
 */
const COLLAPSE_GROUP_ID = /^[0-9]+$/;

/**
 * Never set `allowComments` here.
 *
 * `hast-util-sanitize` drops comment nodes because that boolean defaults to
 * `false` — comments are not elements, so `tagNames` has nothing to do with it.
 * `rehypeVantageDirectives` relies on that deletion: it consumes a
 * `<!-- vantage: … -->` comment into attributes and deliberately leaves the node
 * for the sanitiser. Turning the switch on readmits every directive comment —
 * valid and malformed alike — into the rendered HTML, which breaks the carrier's
 * whole premise. `vantageDirectives.test.ts` ("leaves no comment in the rendered
 * markup") is the guard.
 */
export const sanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    // KaTeX MathML elements
    "math",
    "semantics",
    "mrow",
    "mi",
    "mo",
    "mn",
    "msup",
    "msub",
    "mfrac",
    "mover",
    "munder",
    "msqrt",
    "mroot",
    "mtable",
    "mtr",
    "mtd",
    "mtext",
    "mspace",
    "annotation",
    // Other
    "figure",
    "figcaption",
    "summary",
    "details",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] || []),
      "className",
      ["style", SAFE_STYLE],
      "dataSourceLine",
      // What `rehypeVantageDirectives` compiles a `<!-- vantage: … -->` comment
      // into, named individually — never by a `data-vantage-*` wildcard, which
      // would readmit whatever a future bug emits and whatever a document
      // hand-writes as raw HTML.
      //
      // The value lists are the belt to the plugin's braces: the vocabulary is
      // closed in the plugin *and* here, imported from the one module that
      // defines it, so even if a refactor let an unvalidated value reach the
      // tree the sanitiser still refuses it.
      ["dataVantageTone", ...VANTAGE_TONES],
      ["dataVantageEmphasis", ...VANTAGE_EMPHASIS],
      ["dataVantageBadge", ...VANTAGE_BADGES],
      ["dataVantageCollapsed", ...VANTAGE_COLLAPSED],
      // The other half of `collapsed`: which group a hidden block belongs to,
      // and which group a heading toggles. Both are plugin-minted counters with
      // no vocabulary to allowlist, so they take a pattern instead —
      // `hast-util-sanitize` accepts a `RegExp` in place of a literal value.
      // A pattern rather than a bare name because the JS interpolates the value
      // into a selector: anything but digits has no business reaching it.
      ["dataVantageCollapseGroup", COLLAPSE_GROUP_ID],
      ["dataVantageCollapseToggle", COLLAPSE_GROUP_ID],
      ["dataVantageRun", ...VANTAGE_RUNS],
      ["dataVantageOq", "true"],
      // The design's one genuinely free-text value: the body of a review
      // comment, so it cannot be value-allowlisted and this entry is name-only.
      // Two defences remain rather than three — `hast` escapes the value on
      // serialisation and React sets it through the DOM property path, so it
      // cannot break out of the attribute — and the honest record of that is in
      // the design doc rather than a third layer implied here.
      "dataVantageLeaning",
    ],
    code: [...(defaultSchema.attributes?.code || []), "className"],
    span: [
      ...(defaultSchema.attributes?.span || []),
      "className",
      ["style", SAFE_STYLE],
    ],
    div: [
      ...(defaultSchema.attributes?.div || []),
      "className",
      ["style", SAFE_STYLE],
    ],
    a: [...(defaultSchema.attributes?.a || []), "id", "className"],
    math: ["xmlns"],
    annotation: ["encoding"],
    img: [...(defaultSchema.attributes?.img || []), "loading"],
    td: [...(defaultSchema.attributes?.td || []), ["style", SAFE_STYLE]],
    th: [...(defaultSchema.attributes?.th || []), ["style", SAFE_STYLE]],
  },
};
