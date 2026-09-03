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
import { VANTAGE_ALERTS } from "./rehypeVantageAlerts.js";

type Schema = typeof defaultSchema;

/**
 * CSS properties an inline `style` may set.
 *
 * **The only `style` this list ever filters is one a document wrote by hand.**
 * Nothing the pipeline generates reaches it: `rehypeKatex` and `rehypeHighlight`
 * both run *after* `rehypeSanitize` (`pipeline.ts`), so their output is trusted
 * rather than filtered, and `remark-gfm` emits table alignment as an `align`
 * attribute rather than as CSS. So this is a filter on untrusted author HTML and
 * nothing else — which is exactly the hole that made it necessary: `<div
 * style="position:fixed;inset:0">` covered the viewport and
 * `style="background:url(https://…)"` called home on render, both verbatim,
 * because `rehype-sanitize` does not parse CSS. Scripts were never the risk
 * here; layout and network were.
 *
 * The list is therefore deliberately typographic: the styling a prose document
 * has any business asking for. It is *not* sized to KaTeX, and a KaTeX release
 * that starts using a new property is a non-event here — `\pmb` already emits
 * `text-shadow`, which is not on this list and renders anyway.
 *
 * **The design doc used to argue the opposite — that `style` had to be allowed
 * and `position` enumerated because KaTeX needs them — and it was wrong.** The
 * measurement behind it was real (KaTeX does emit `position:relative` on every
 * integral) but the inference was not, because the sanitiser has finished before
 * the first KaTeX span exists. Rebuilding the shipped rehype order with a filter
 * that rejects *every* value leaves all ten of the integral's style attributes
 * untouched. The "Security" section of `docs/reference/inline-markup.md`
 * records the correction; the test that would catch a reordering is in
 * `frontend/src/lib/sanitize.test.ts`.
 */
const SAFE_STYLE_PROPERTIES = [
  // Box metrics. `top`/`right`/`bottom`/`left` are inert now that `position` is
  // banned, and they stay only because dropping them would fail the whole
  // attribute for a document that writes one — the all-or-nothing rule below
  // makes every removal a behaviour change. They buy an attacker nothing that
  // negative `margin` does not already buy.
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
  // Rules and boxes.
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
 * One rule beyond the property list does the work: **no parentheses anywhere**,
 * which closes `url(…)` and `expression(…)` in one stroke — the network and
 * legacy-script vectors. Its cost is borne entirely by authors, who lose
 * `calc()`, `rgb()` and `var()` along with them; that is the trade, and it is
 * worth it for a filter this small.
 *
 * **`position` is not on the property list at all**, so every value of it is
 * refused — `static` and `relative` along with `fixed` and `sticky`. It used to
 * be enumerated, on the belief that KaTeX needed `relative`; KaTeX renders after
 * the sanitiser and never meets this regex, so the enumeration was buying
 * nothing but the residual it conceded. Banning the property closes that
 * residual, and it is bigger than "overlaps its neighbours" made it sound:
 * measured in Chrome against the viewer's real ancestor chain, an author's
 * `position:absolute;top:0;left:0;width:100%;height:100%` is sized to the whole
 * content pane (the nearest positioned ancestor is outside the scroll
 * container), is not clipped by the scroller, and survives scrolling to the end
 * of the document. It was `position:fixed` in all but the keyword.
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
 * Residual, stated plainly and now genuinely small: negative `margin` still lets
 * an element overlap its neighbours *inside the flow*. That one scrolls with the
 * content and is clipped by the scroll container, and closing it means giving up
 * margins, which prose actually uses. Containment in the stylesheet, not another
 * rule here, is what would close it.
 */
const VALUE = `[^;:()"'\\\\]*`;
// Wrapped in its own group, and the trailing `?` below applies to that group.
// Interpolating the declaration bare would attach the `?` to `VALUE`'s `*`,
// making the last declaration's value *lazy* instead of the whole declaration
// optional — which rejects a trailing `;` (`color:red;`). The semicolon test in
// `frontend/src/lib/sanitize.test.ts` is what catches that.
const DECLARATION = `(?:(?:${SAFE_STYLE_PROPERTIES.join("|")})\\s*:${VALUE})`;

export const SAFE_STYLE = new RegExp(
  `^\\s*(?:${DECLARATION};\\s*)*${DECLARATION}?$`,
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
      // GFM alerts, compiled by `rehypeVantageAlerts`. Value-allowlisted like
      // the tone tokens it shares a palette with, so a document cannot forge a
      // sixth kind through raw HTML.
      ["dataVantageAlert", ...VANTAGE_ALERTS],
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
