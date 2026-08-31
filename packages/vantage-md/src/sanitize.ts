/**
 * Sanitization schema for the rendering pipeline.
 * Allows GFM, KaTeX MathML, syntax highlighting classes, and
 * data-source-line attributes while blocking XSS vectors.
 */

import { defaultSchema } from "rehype-sanitize";

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
 * Residual, stated plainly: an absolutely-positioned element can still overlap
 * its neighbours inside the article. Closing that needs containment in the
 * stylesheet, not in the sanitiser.
 */
const DECLARATION = `(?:${SAFE_STYLE_PROPERTIES.join("|")})\\s*:\\s*[^;:()"'\\\\]*`;
const POSITION = `position\\s*:\\s*(?:static|relative|absolute)`;

export const SAFE_STYLE = new RegExp(
  `^\\s*(?:(?:${DECLARATION}|${POSITION})\\s*;?\\s*)*$`,
  "i",
);

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
