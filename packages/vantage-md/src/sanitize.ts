/**
 * Sanitization schema for the rendering pipeline.
 * Allows GFM, KaTeX MathML, syntax highlighting classes,
 * data-source-line attributes, a filtered inline `style`, and inline SVG as
 * static drawing (see `SVG_CHILD_TAGS`), while blocking XSS vectors.
 */

import { defaultSchema } from "rehype-sanitize";
import {
  VANTAGE_BADGES,
  VANTAGE_COLLAPSED,
  VANTAGE_EMPHASIS,
  VANTAGE_RUNS,
  VANTAGE_TONES,
  VANTAGE_OQ_ID,
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
 * integral) but the inference was not, because the sanitizer has finished before
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
  // makes every removal a behavior change. They buy an attacker nothing that
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
 * the sanitizer and never meets this regex, so the enumeration was buying
 * nothing but the residual it conceded. Banning the property closes that
 * residual, and it is bigger than "overlaps its neighbors" made it sound:
 * measured in Chrome against the viewer's real ancestor chain, an author's
 * `position:absolute;top:0;left:0;width:100%;height:100%` is sized to the whole
 * content pane (the nearest positioned ancestor is outside the scroll
 * container), is not clipped by the scroller, and survives scrolling to the end
 * of the document. It was `position:fixed` in all but the keyword.
 *
 * Matching is all-or-nothing: one unrecognized declaration drops the whole
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
 * an element overlap its neighbors *inside the flow*. That one scrolls with the
 * content and is clipped by the scroll container, and closing it means giving up
 * margins, which prose actually uses. Containment in the stylesheet, not another
 * rule here, is what would close it. `overflow: visible` on an inline `<svg>` is
 * the same residual by another route — see `SVG_ROOT_ATTRIBUTES`.
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
 * Inline SVG, admitted as static drawing and nothing else.
 *
 * The allowlist is shapes, text and grouping. Everything in SVG that can run
 * code, fetch, or reach outside the element is refused: `script`,
 * `foreignObject`, `use` and `image` (both take an `href`), `xlink:href` on
 * `a`, the `animate`/`set` family (which can rewrite an `href` after the
 * sanitizer has looked), `style` elements, and every attribute that takes a
 * `url(…)` reference — `filter`, `mask`, `clip-path`, `marker-*`, `cursor`.
 *
 * Gradients, patterns and `<defs>` are out for a second reason: they are only
 * reachable through `url(#id)`, and the sanitizer prefixes every `id` with
 * `user-content-`, so the reference would dangle even if it were allowed.
 *
 * **Refusing an element is not the same as removing it.** `hast-util-sanitize`
 * *unwraps* an element it does not allow — drops the tag and keeps its
 * children — unless the tag is on `strip`. See `SVG_STRIPPED` for why that
 * matters here.
 *
 * `switch` is admitted, as a plain container, because draw.io wraps every label
 * in one: `<switch><foreignObject>…</foreignObject><text>…</text></switch>`. A
 * `switch` renders only its first child whose conditions hold, and with the
 * `foreignObject` removed and the conditional attributes (`requiredFeatures`,
 * `systemLanguage`) refused, that is the `<text>` fallback. Unwrapped instead,
 * it would render *every* branch — including the "Text is not SVG - cannot
 * display" notice draw.io appends for viewers without `foreignObject`.
 *
 * Every child requires an `svg` ancestor, so no shape or text element is
 * admitted into HTML flow on its own.
 *
 * `title` and `desc` are not children at all: they are stripped, with their
 * contents, and `aria-label` on the root is the drawing's accessible name. Both
 * are HTML integration points — the parser reads what is inside them as HTML —
 * and an `svg` ancestor turned out not to be enough to keep a `<title>` in SVG
 * context. `<math><svg><title>` keeps MathML context, and React hoists any
 * `title` outside SVG context into the page's `<head>`, so the document set the
 * tab title. In `renderMarkdown`'s string output, `<svg><desc><title>`,
 * `<svg><title><title>` and a `title` inside a `foreignObject` all re-parse into
 * an HTML `title`, which is what `document.title` reads on a page that has none
 * of its own.
 */
const SVG_CHILD_TAGS = [
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "switch",
];

/**
 * Refused SVG elements removed *with their contents*, rather than unwrapped.
 *
 * Each of these holds children that are never meant to be painted where they
 * stand: a clip region, a mask, a gradient's stops, a marker's arrowhead, a
 * symbol's body, a filter's primitives, an exporter's RDF, the text of a
 * `title` or `desc` (see `SVG_CHILD_TAGS`), or — for `foreignObject` — HTML. Unwrapped, those children land in the drawing as
 * ordinary shapes. A default Figma export ends in `<defs><clipPath><rect
 * fill="white"/>`, and unwrapping it painted that white rect over the whole
 * drawing; a `<marker>` arrowhead became a stray triangle at the origin. The
 * HTML inside a `foreignObject` survived as descendants of `svg`, which React
 * then created as invisible SVG-namespace `div`s and `p`s — the anchor an Open
 * Question button looks for — and which a browser re-parsing `renderMarkdown`'s
 * string output breaks out of the `svg` at, spilling the rest of the drawing
 * into the page.
 *
 * The camel-cased names are the ones the HTML parser gives these elements in
 * SVG, and the only spelling a hast tree carries. The rest are lowercase in any
 * context, so they are stripped in prose too: a bare `<pattern>` written as a
 * placeholder outside a code span takes the rest of its paragraph with it,
 * where it used to lose only the tag, and a stray `<title>x</title>` loses its
 * text. Code spans are unaffected.
 */
const SVG_STRIPPED = [
  "foreignObject",
  "defs",
  "clipPath",
  "mask",
  "pattern",
  "marker",
  "symbol",
  "linearGradient",
  "radialGradient",
  "filter",
  "metadata",
  "title",
  "desc",
];

/**
 * A paint value: a keyword, a named color, or a hex color. No parentheses, for
 * the same reason `SAFE_STYLE` refuses them — `fill="url(https://…)"` is a
 * render-time fetch, and `rgb()` is the price of closing it.
 */
const SVG_PAINT = /^(?:#[0-9a-f]{3,8}|[a-z]+)$/i;

/**
 * Attributes any SVG element may carry, drawing and typography alike.
 *
 * **Each entry is a hast property name, which is not always the camel case of
 * the attribute.** `property-information` decides the spelling, and it has
 * `strokeLineCap` for `stroke-linecap` — a naive `strokeLinecap` matches
 * nothing, and the attribute is dropped in every renderer without a word. The
 * table-driven test in `frontend/src/lib/sanitize.test.ts` renders every entry
 * in its written spelling, so a misspelled one fails there.
 *
 * `stroke-dasharray` (and with it `stroke-dashoffset`, which does nothing
 * alone) is refused, because it lets a few bytes buy an unbounded paint. The
 * number of dashes is the path's length over the dash period, both in user
 * units the document chooses. Measured in headless Chromium, fifty 90-byte
 * paths with a 0.0011 dash took 21 s to paint and a hundred took 37 s. A value
 * grammar cannot bound it: refusing sub-unit dashes is undone by scaling the
 * user units, and the same fifty paths with `stroke-dasharray="1.1"` under a
 * `viewBox` a thousand times larger still took 15 s.
 */
const SVG_ATTRIBUTES: NonNullable<Schema["attributes"]>[string] = [
  ["fill", SVG_PAINT],
  ["stroke", SVG_PAINT],
  "fillOpacity",
  "fillRule",
  "strokeOpacity",
  "strokeWidth",
  "strokeLineCap",
  "strokeLineJoin",
  "opacity",
  "transform",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "textAnchor",
  "dominantBaseline",
  // Geometry. Names are shared across shapes, so one list serves them all.
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "dx",
  "dy",
  "d",
  "points",
];

/**
 * The root `<svg>`'s attributes: `SVG_ATTRIBUTES` less `transform`, plus the
 * viewport and the accessible name.
 *
 * `transform` on the root is not an SVG transform at all. The root is an
 * in-flow CSS box, and the attribute becomes a CSS transform of that box, so
 * `<svg width="10" height="10" transform="translate(-300 -300) scale(80)">`
 * laid out as a 10px box and painted as an 800px one over the paragraphs
 * around it. On a child it moves shapes inside the viewport, which clips them.
 *
 * Residual: that clip is the root's `overflow`, which `SAFE_STYLE` lets a
 * document set. `style="overflow:visible"` on the root lets a child with a
 * large `transform` or large coordinates paint over its neighbors — measured in
 * Chromium, the same overlap. It is the negative-`margin` residual described at
 * `SAFE_STYLE` by another route: it stays in the flow, scrolls with the content,
 * and the scroll container clips it.
 */
const SVG_ROOT_ATTRIBUTES: NonNullable<Schema["attributes"]>[string] = [
  ...SVG_ATTRIBUTES.filter((attribute) => attribute !== "transform"),
  "xmlns",
  "viewBox",
  "preserveAspectRatio",
  "role",
  "ariaLabel",
];

/**
 * Never set `allowComments` here.
 *
 * `hast-util-sanitize` drops comment nodes because that boolean defaults to
 * `false` — comments are not elements, so `tagNames` has nothing to do with it.
 * `rehypeVantageDirectives` relies on that deletion: it consumes a
 * `<!-- vantage: … -->` comment into attributes and deliberately leaves the node
 * for the sanitizer. Turning the switch on readmits every directive comment —
 * valid and malformed alike — into the rendered HTML, which breaks the carrier's
 * whole premise. `vantageDirectives.test.ts` ("leaves no comment in the rendered
 * markup") is the guard.
 */
export const sanitizeSchema: Schema = {
  ...defaultSchema,
  strip: [...(defaultSchema.strip || []), ...SVG_STRIPPED],
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
    "svg",
    ...SVG_CHILD_TAGS,
  ],
  ancestors: {
    ...defaultSchema.ancestors,
    ...Object.fromEntries(SVG_CHILD_TAGS.map((tag) => [tag, ["svg"]])),
  },
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
      // tree the sanitizer still refuses it.
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
      // The Open Question's id on its way to becoming a real `id`, pattern-
      // allowlisted like the collapse-group counters above rather than left
      // name-only: `rehypeVantageAnchors` writes this value straight into the
      // document's id namespace on the other side of this schema, so anything
      // a document could smuggle through here it would be smuggling into `id`.
      // The grammar is imported, never restated — see `VANTAGE_OQ_ID`.
      ["dataVantageOqId", VANTAGE_OQ_ID],
      // GFM alerts, compiled by `rehypeVantageAlerts`. Value-allowlisted like
      // the tone tokens it shares a palette with, so a document cannot forge a
      // sixth kind through raw HTML.
      ["dataVantageAlert", ...VANTAGE_ALERTS],
      // The design's one genuinely free-text value: the body of a review
      // comment, so it cannot be value-allowlisted and this entry is name-only.
      // Two defenses remain rather than three — `hast` escapes the value on
      // serialization and React sets it through the DOM property path, so it
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
    svg: SVG_ROOT_ATTRIBUTES,
    ...Object.fromEntries(SVG_CHILD_TAGS.map((tag) => [tag, SVG_ATTRIBUTES])),
  },
};
