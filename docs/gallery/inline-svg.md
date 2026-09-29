---
title: "Gallery — inline SVG"
status: accepted
summary: "A lighthouse at night, a chart, an icon in a sentence and a drawing in a toned section, drawn only with what the sanitizer admits."
---

# Inline SVG

Every picture on this page is a raw `<svg>` written straight into the Markdown,
with no image file and no Mermaid behind it. The sanitizer admits
[static drawing and nothing else](../reference/inline-markup.md#inline-svg), so
these drawings use only what it keeps: shapes, paths, `text` and `tspan`, groups
with a `transform`, hex paint, and opacity. Nothing here was written expecting
to lose anything, so any shape missing from the page is one the sanitizer
refused.

## What to look at

- **Light and dark mode.** The lighthouse paints its own night sky, so it should
  look the same in both themes. Everything else — the caption under the scene,
  the chart's words and axes, the star map — is drawn in `currentColor`, the
  prose text color, and must follow the toggle. Read the page twice.
- **The beam is translucent.** It is a wide polygon filled at 13% opacity with
  a narrow one at 18% inside it, and nothing else. The stars behind it must
  still show through, fainter against the light, and the core, where both
  polygons paint, must be brighter than the edges. It is not drawn with dashes,
  because `stroke-dasharray` is refused and a dashed line renders solid.
- **The icon stays on its line.** The lighthouse in the
  [sentence below](#an-icon-in-a-sentence) is a drawing inside a paragraph. It
  must sit on the text line at the height of a letter, not break the paragraph
  into three.
- **The chart's text in dark mode.** The title, tick numbers, week numbers and
  the full-moon label must stay legible on the dark page. The gridlines are the
  same color at 15% opacity, so they should recede in both themes rather than
  disappear in one.
- **The toned section's rule runs past the drawing.** In
  [Finding north](#finding-north-from-the-lamp-room), the section's accent must
  run unbroken from the heading, down the side of the star map, to the last
  paragraph. The `<div>` around the drawing is the section's member and draws
  that part of the rule.
- **Print.** In print preview the drawings print in their own colors, the night
  sky included, because the print stylesheet asks for exact color. Text in
  `currentColor` prints near-black like the prose around it, and the section's
  rule prints gray.
- **GitHub renders none of the drawings.** It drops each `<svg>` and leaves the
  words of its `<text>` elements behind as loose text, so on GitHub this page is
  a scatter of captions and axis numbers. See
  [Inline SVG](../reference/inline-markup.md#inline-svg) for the file-based form
  to use in a document read there.

## A lighthouse at night

<div>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400" role="img" aria-label="A striped lighthouse on a cliff at night, its beam crossing a starry sky above the sea, where a small sailboat carries a lantern">
  <rect x="0" y="0" width="640" height="360" rx="14" fill="#0b1630"/>
  <g fill="#2a4478">
    <rect x="0" y="120" width="640" height="150" opacity="0.18"/>
    <rect x="0" y="160" width="640" height="110" opacity="0.2"/>
    <rect x="0" y="196" width="640" height="74" opacity="0.22"/>
    <rect x="0" y="226" width="640" height="44" opacity="0.25"/>
    <rect x="0" y="250" width="640" height="20" opacity="0.3"/>
  </g>
  <g fill="#fff8e7">
    <circle cx="38" cy="30" r="1.2" opacity="0.9"/>
    <circle cx="70" cy="110" r="0.9" opacity="0.6"/>
    <circle cx="150" cy="24" r="1.5" opacity="1"/>
    <circle cx="185" cy="62" r="0.8" opacity="0.5"/>
    <circle cx="212" cy="128" r="1.1" opacity="0.8"/>
    <circle cx="240" cy="36" r="0.9" opacity="0.55"/>
    <circle cx="268" cy="92" r="1.6" opacity="0.95"/>
    <circle cx="300" cy="18" r="0.8" opacity="0.45"/>
    <circle cx="318" cy="150" r="1" opacity="0.7"/>
    <circle cx="352" cy="58" r="1.3" opacity="0.85"/>
    <circle cx="380" cy="112" r="0.7" opacity="0.4"/>
    <circle cx="402" cy="28" r="1.1" opacity="0.75"/>
    <circle cx="436" cy="82" r="0.9" opacity="0.6"/>
    <circle cx="470" cy="20" r="1.5" opacity="0.9"/>
    <circle cx="494" cy="132" r="0.8" opacity="0.5"/>
    <circle cx="516" cy="44" r="1" opacity="0.7"/>
    <circle cx="604" cy="26" r="1.2" opacity="0.8"/>
    <circle cx="618" cy="120" r="0.8" opacity="0.45"/>
    <circle cx="24" cy="180" r="0.9" opacity="0.5"/>
    <circle cx="120" cy="150" r="1.2" opacity="0.8"/>
    <circle cx="170" cy="210" r="1" opacity="0.55"/>
    <circle cx="262" cy="206" r="0.8" opacity="0.4"/>
    <circle cx="390" cy="190" r="0.7" opacity="0.35"/>
    <circle cx="60" cy="240" r="0.8" opacity="0.35"/>
  </g>
  <path d="M268 83 V101 M259 92 H277 M150 15 V33 M141 24 H159" stroke="#fff8e7" stroke-width="1" stroke-linecap="round" opacity="0.6"/>
  <circle cx="92" cy="54" r="36" fill="#f3e6c4" opacity="0.05"/>
  <circle cx="92" cy="54" r="27" fill="#f3e6c4" opacity="0.07"/>
  <path d="M96.35 32 A20 20 0 1 0 113.81 61.1 A17 17 0 0 1 96.35 32 Z" fill="#f3e6c4"/>
  <g fill="#ffcf5a">
    <polygon points="556,64 556,80 0,200 0,90" opacity="0.13"/>
    <polygon points="556,67 556,77 0,168 0,118" opacity="0.18"/>
    <polygon points="564,64 564,80 640,90 640,56" opacity="0.13"/>
  </g>
  <path d="M0 270 H640 V346 A14 14 0 0 1 626 360 H14 A14 14 0 0 1 0 346 Z" fill="#0a2240"/>
  <line x1="0" y1="270" x2="640" y2="270" stroke="#7d9bd0" stroke-opacity="0.35"/>
  <g stroke="#f3e6c4" stroke-width="2" stroke-linecap="round">
    <line x1="80" y1="278" x2="106" y2="278" stroke-opacity="0.5"/>
    <line x1="72" y1="287" x2="112" y2="287" stroke-opacity="0.4"/>
    <line x1="84" y1="297" x2="102" y2="297" stroke-opacity="0.35"/>
    <line x1="68" y1="309" x2="116" y2="309" stroke-opacity="0.25"/>
    <line x1="82" y1="322" x2="104" y2="322" stroke-opacity="0.2"/>
  </g>
  <g fill="none" stroke="#7d9bd0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 292 q10 -5 20 0 t20 0 t20 0" stroke-opacity="0.45"/>
    <path d="M150 318 q12 -6 24 0 t24 0 t24 0 t24 0" stroke-opacity="0.4"/>
    <path d="M24 342 q14 -7 28 0 t28 0 t28 0 t28 0 t28 0" stroke-opacity="0.35"/>
    <path d="M250 290 q9 -4 18 0 t18 0" stroke-opacity="0.35"/>
    <path d="M300 336 q12 -6 24 0 t24 0 t24 0" stroke-opacity="0.3"/>
    <polyline points="330,284 336,280 342,284 348,280 354,284" stroke-opacity="0.35"/>
    <polyline points="222,352 229,347 236,352 243,347 250,352 257,347 264,352" stroke-opacity="0.3"/>
    <polyline points="380,306 386,302 392,306 398,302 404,306" stroke-opacity="0.3"/>
  </g>
  <g transform="translate(190 292) rotate(-4)">
    <circle cx="-27" cy="-12" r="8" fill="#ffd66b" opacity="0.1"/>
    <circle cx="-27" cy="-12" r="4.5" fill="#ffd66b" opacity="0.2"/>
    <line x1="0" y1="-2" x2="0" y2="-52" stroke="#d9cfb8" stroke-width="1.5" stroke-linecap="round"/>
    <polygon points="3,-7 3,-47 30,-7" fill="#efe6d2"/>
    <polygon points="-3,-9 -3,-39 -22,-9" fill="#efe6d2" opacity="0.75"/>
    <line x1="-27" y1="-3" x2="-27" y2="-10" stroke="#d9cfb8" stroke-width="1" stroke-linecap="round"/>
    <path d="M-30 -3 H32 L23 8 H-21 Z" fill="#b5452f"/>
    <circle cx="-27" cy="-12" r="2" fill="#ffd66b"/>
  </g>
  <g fill="none" stroke-linecap="round">
    <path d="M156 303 q8 -3 16 0 t16 0 t16 0 t16 0" stroke="#7d9bd0" stroke-width="1.5" stroke-opacity="0.55"/>
    <line x1="160" y1="312" x2="170" y2="312" stroke="#ffd66b" stroke-width="2" stroke-opacity="0.4"/>
  </g>
  <path d="M640 198 L606 196 L580 199 L548 201 L520 205 L494 212 L470 226 L454 244 L444 262 L436 284 L430 310 L424 336 L420 360 H626 A14 14 0 0 0 640 346 Z" fill="#060c18"/>
  <polyline points="444,262 454,244 470,226 494,212 520,205 548,201 580,199 606,196 640,198" fill="none" stroke="#35548a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.8"/>
  <g fill="none" stroke="#1c2c4a" stroke-width="1.5" stroke-linecap="round">
    <path d="M472 250 l14 6"/>
    <path d="M458 290 l18 4"/>
    <path d="M502 236 l12 8"/>
    <path d="M452 322 l16 -3"/>
    <path d="M522 280 l10 6"/>
  </g>
  <g fill="none" stroke="#dfe8f5" stroke-width="1.5" stroke-linecap="round">
    <path d="M418 298 q6 -4 12 0" stroke-opacity="0.5"/>
    <path d="M410 326 q6 -4 12 0" stroke-opacity="0.4"/>
    <path d="M402 352 q7 -4 14 0" stroke-opacity="0.35"/>
  </g>
  <g transform="translate(604 197)">
    <rect x="-10" y="-18" width="30" height="20" fill="#141b2b"/>
    <polygon points="-14,-17 5,-32 24,-17" fill="#0c111c"/>
    <rect x="14" y="-34" width="5" height="10" fill="#0c111c"/>
    <rect x="-3" y="-12" width="7" height="6" fill="#ffd66b"/>
  </g>
  <g transform="translate(560 200)">
    <rect x="-27" y="-3" width="54" height="10" rx="2" fill="#1e2638"/>
    <polygon points="-22,0 22,0 14,-110 -14,-110" fill="#eee8dc"/>
    <g fill="#c43d3d">
      <polygon points="-20.7,-18 20.7,-18 19.5,-34 -19.5,-34"/>
      <polygon points="-18.2,-52 18.2,-52 17.1,-68 -17.1,-68"/>
      <polygon points="-15.7,-86 15.7,-86 14.6,-102 -14.6,-102"/>
    </g>
    <polygon points="4,0 22,0 14,-110 3,-110" fill="#0b1630" opacity="0.28"/>
    <path d="M-6 0 V-10 A6 6 0 0 1 6 -10 V0 Z" fill="#3b2a20"/>
    <rect x="-3" y="-47" width="6" height="9" rx="1" fill="#ffd66b"/>
    <rect x="-3" y="-81" width="6" height="9" rx="1" fill="#ffd66b"/>
    <rect x="-20" y="-116" width="40" height="6" rx="1" fill="#2b3142"/>
    <rect x="-11" y="-140" width="22" height="24" fill="#ffd66b"/>
    <circle cx="0" cy="-128" r="4.5" fill="#fffbe6"/>
    <g stroke="#2b3142" stroke-width="1.5" stroke-linecap="round">
      <line x1="-7" y1="-140" x2="-7" y2="-116"/>
      <line x1="7" y1="-140" x2="7" y2="-116"/>
      <line x1="-18" y1="-124" x2="18" y2="-124"/>
      <line x1="-18" y1="-124" x2="-18" y2="-116"/>
      <line x1="-9" y1="-124" x2="-9" y2="-116"/>
      <line x1="9" y1="-124" x2="9" y2="-116"/>
      <line x1="18" y1="-124" x2="18" y2="-116"/>
    </g>
    <path d="M-15 -140 H15 L11 -146 Q0 -160 -11 -146 Z" fill="#c43d3d"/>
    <line x1="0" y1="-154" x2="0" y2="-162" stroke="#2b3142" stroke-width="2" stroke-linecap="round"/>
    <circle cx="0" cy="-164" r="2" fill="#2b3142"/>
    <circle cx="0" cy="-128" r="14" fill="#ffe8a3" opacity="0.3"/>
    <circle cx="0" cy="-128" r="26" fill="#ffe8a3" opacity="0.14"/>
  </g>
  <text x="320" y="387" text-anchor="middle" fill="currentColor" font-size="15" font-family="Georgia, 'Times New Roman', serif">A <tspan font-style="italic">vantage point</tspan>, after dark<tspan fill-opacity="0.65" font-size="13"> — drawn with nothing the sanitizer refuses</tspan></text>
</svg>
</div>

How it is built, since each choice is a thing the sanitizer would otherwise
have taken away:

- **The sky's glow is stepped, not a gradient.** It is five translucent bands
  stacked toward the horizon. A gradient is reachable only through `url(#id)`,
  and the sanitizer refuses that paint and removes the gradient itself.
- **The moon is one path of two arcs.** A crescent cut from a disk by a second
  circle in the sky's color would also cut a notch out of the halo around it,
  and a mask is removed with everything inside it.
- **The stars are circles at opacities from 0.35 to 1**, and the two brightest
  carry a cross of round-capped strokes.
- **The lighthouse, the cottage and the boat are each a `<g>` with a
  `transform`**, drawn around their own origin and moved into place. That is
  allowed on anything inside the drawing and refused on the `<svg>` itself.
- **The caption is one `text` with two `tspan`s**, in the page's text color,
  under the scene rather than on it.

## A chart

<div>
<svg xmlns="http://www.w3.org/2000/svg" width="560" height="300" viewBox="0 0 560 300" role="img" aria-label="Bar chart of sea monsters sighted per week from the lamp room. Weeks 1 to 8: 2, 3, 1, 5, 4, 7, 13 and 6. Week 7 was a full moon.">
  <text x="0" y="18" fill="currentColor" font-size="15" font-weight="bold">Sea monsters sighted per week</text>
  <text x="0" y="35" fill="currentColor" fill-opacity="0.7" font-size="11">sightings from the lamp room</text>
  <g fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M462 31 q6 -3 12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0" stroke="currentColor" stroke-width="1" stroke-opacity="0.35"/>
    <path d="M472 30 a7 7 0 0 1 14 0" stroke="#199e70"/>
    <path d="M494 30 a7 7 0 0 1 14 0" stroke="#199e70"/>
    <path d="M516 30 q0 -16 10 -16 q7 0 8 5" stroke="#199e70"/>
  </g>
  <circle cx="527" cy="19" r="1.3" fill="currentColor"/>
  <g stroke="currentColor" stroke-opacity="0.15">
    <line x1="48" y1="56" x2="544" y2="56"/>
    <line x1="48" y1="122.7" x2="544" y2="122.7"/>
    <line x1="48" y1="189.3" x2="544" y2="189.3"/>
  </g>
  <g fill="#3987e5">
    <path d="M62 256 V233.3 a4 4 0 0 1 4 -4 h26 a4 4 0 0 1 4 4 V256 Z"/>
    <path d="M124 256 V220.0 a4 4 0 0 1 4 -4 h26 a4 4 0 0 1 4 4 V256 Z"/>
    <path d="M186 256 V246.7 a4 4 0 0 1 4 -4 h26 a4 4 0 0 1 4 4 V256 Z"/>
    <path d="M248 256 V193.3 a4 4 0 0 1 4 -4 h26 a4 4 0 0 1 4 4 V256 Z"/>
    <path d="M310 256 V206.7 a4 4 0 0 1 4 -4 h26 a4 4 0 0 1 4 4 V256 Z"/>
    <path d="M372 256 V166.7 a4 4 0 0 1 4 -4 h26 a4 4 0 0 1 4 4 V256 Z"/>
    <path d="M434 256 V86.7 a4 4 0 0 1 4 -4 h26 a4 4 0 0 1 4 4 V256 Z"/>
    <path d="M496 256 V180.0 a4 4 0 0 1 4 -4 h26 a4 4 0 0 1 4 4 V256 Z"/>
  </g>
  <g stroke="currentColor" stroke-linecap="round">
    <line x1="48" y1="56" x2="48" y2="256" stroke-opacity="0.6"/>
    <line x1="48" y1="256" x2="544" y2="256" stroke-width="1.5"/>
  </g>
  <g fill="currentColor" font-size="11" text-anchor="end" dominant-baseline="middle">
    <text x="40" y="256">0</text>
    <text x="40" y="189.3">5</text>
    <text x="40" y="122.7">10</text>
    <text x="40" y="56">15</text>
  </g>
  <g fill="currentColor" font-size="12" text-anchor="middle">
    <text x="79" y="274">1</text>
    <text x="141" y="274">2</text>
    <text x="203" y="274">3</text>
    <text x="265" y="274">4</text>
    <text x="327" y="274">5</text>
    <text x="389" y="274">6</text>
    <text x="451" y="274">7</text>
    <text x="513" y="274">8</text>
  </g>
  <text x="296" y="294" fill="currentColor" fill-opacity="0.7" font-size="11" text-anchor="middle">week</text>
  <text x="451" y="74" fill="currentColor" font-size="12" text-anchor="middle"><tspan font-weight="bold">13</tspan> (full moon)</text>
</svg>
</div>

One series, so no legend: the title names it. The bars are one blue that holds
at least 3:1 against both the light and the dark page, since a paint attribute
takes one hex color and cannot follow the theme. Everything that must follow it
is `currentColor`. The only value labeled is the one worth a second look.

## An icon in a sentence

The keeper marks every night the lamp was lit with a small <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" role="img" aria-label="lighthouse"><path d="M1 2 L5 3.5 M1 7 L5 5.5 M15 2 L11 3.5 M15 7 L11 5.5" stroke="#e3a008" stroke-width="1.2" stroke-linecap="round"/><path d="M6 3 L8 1 L10 3 Z" fill="currentColor"/><rect x="6.5" y="3" width="3" height="3" fill="#e3a008"/><path d="M5.5 15 L6.8 6 H9.2 L10.5 15 Z" fill="currentColor"/><path d="M6.1 10.5 H9.9" stroke="#c43d3d" stroke-width="1.6"/><path d="M3 15.25 H13" stroke="currentColor" stroke-linecap="round"/></svg> in the log, and the mark sits on the line like a word. It is `1em` square, so it scales with the text around it, and it is a drawing inside a paragraph, which the stylesheet keeps inline. The same drawing inside a `<div>` of its own would be a block.

## A drawing in a toned section

A drawing in a toned section is where a gap in the section's rule would show.
The section below carries `tone=tip`, and its middle member is the star map.

<!-- vantage: section tone=tip -->

### Finding north from the lamp room

On a clear night the keeper finds north without a compass. The two stars at the
front of the Plough's bowl are the pointers: follow the line from the lower to
the upper one about five times the gap between them, and the star waiting there
is Polaris.

<div>
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200" role="img" aria-label="The Plough, whose two pointer stars lead to Polaris, about five times the gap between them away">
  <g transform="translate(80 110) rotate(75)">
    <line x1="60" y1="-20" x2="70" y2="-220" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.3" stroke-linecap="round"/>
    <polyline points="-96,8 -62,-12 -30,-16 6,-12 60,-20 58,20 10,26 6,-12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.45" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="58" y1="20" x2="60" y2="-20" stroke="currentColor" stroke-width="2" stroke-opacity="0.85" stroke-linecap="round"/>
    <circle cx="70" cy="-220" r="10" fill="currentColor" fill-opacity="0.12"/>
    <g fill="currentColor">
      <circle cx="-96" cy="8" r="3"/>
      <circle cx="-62" cy="-12" r="3"/>
      <circle cx="-30" cy="-16" r="3.2"/>
      <circle cx="6" cy="-12" r="2.2"/>
      <circle cx="10" cy="26" r="3"/>
      <circle cx="58" cy="20" r="3"/>
      <circle cx="60" cy="-20" r="3.4"/>
      <circle cx="70" cy="-220" r="4.5"/>
    </g>
  </g>
  <g fill="currentColor" font-size="12">
    <text x="104" y="42">the Plough</text>
    <text x="310.6" y="102" text-anchor="middle" font-weight="bold">Polaris</text>
    <text x="76" y="190" text-anchor="middle" fill-opacity="0.75" font-size="11">Merak</text>
    <text x="124" y="178" fill-opacity="0.75" font-size="11">Dubhe</text>
    <text x="211.4" y="135.8" transform="rotate(-12.14 211.4 135.8)" text-anchor="middle" fill-opacity="0.75" font-size="11">five times the gap</text>
  </g>
</svg>
</div>

The drawing sits in a `<div>`, which is the form the reference recommends, and
the `<div>` is what the section stamps and what draws the rule beside it. The
line to Polaris is solid at 30% opacity, where a paper chart would dash it.

## Counting what arrived

A refused element is removed or unwrapped without a word, and `vantage-check`
reports neither, so the only proof that a drawing arrived whole is a count. Each
drawing here should have exactly as many elements under its `<svg>` in the page
as it has in this file:

| Drawing | Elements inside the `<svg>` |
| :--- | :--- |
| The lighthouse at night | 116 |
| The chart | 41 |
| The icon | 6 |
| The star map | 20 |

In the browser console, on this page:

```js
[...document.querySelectorAll(".prose svg[aria-label]")].map((svg) => [
  svg.getAttribute("aria-label").slice(0, 32),
  svg.querySelectorAll("*").length,
]);
```

A lower number on the page names a refused element; find it by comparing the
drawing's source with the element in the inspector. Recount after editing a
drawing.

## Next

- [Sections and the run](./sections.md) — the rule past every other block
  type.
- [Inline SVG](../reference/inline-markup.md#inline-svg) — what the sanitizer
  admits, and why each refusal is there.
