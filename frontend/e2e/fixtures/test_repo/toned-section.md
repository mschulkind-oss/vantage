# Toned section fixture

Fixture for `directive_tone_rule.spec.ts`, which measures — in pixels, over the
real stylesheet — whether a toned section's vertical rule is one continuous line.
Every block type a `section` can reach appears once below, in one run, because
every way the rule has broken was per-tag: a `<pre>` and an `<hr>` clipped their
own `::before` away, a `$$…$$` block lost its stamp to `rehype-katex`, a
raw-HTML `<figure>` was never stamped at all because the range was gated by the
list of tags a directive may *target*, and a raw `<img>` and a bare `<svg>` are
replaced elements, which draw no `::before` at all.

Two images must draw nothing: one floated right, and the second of a row of
two, which shares the first one's line. Either would otherwise stand a slice
in the middle of the column.

The images point at files that do not exist, on purpose: a broken image with a
`width` and a `height` keeps that box, and the box is all the spec measures.

<!-- vantage: section tone=warning -->

## Every member type, one run

A paragraph, long enough to wrap onto a second line so the rule has some height
to cover here rather than a single line's worth.

<img src="tone-rule-missing-r.png" alt="r" width="60" height="24" align="right">

- a list item
- another list item
- a third list item

```js
const clipped = true;
const bleed = 40;
console.log(clipped, bleed, "one line long enough that the fence has to scroll horizontally at any viewport width the spec is likely to use, which is what the un-clipping must not cost");
```

A paragraph after the fence, which is where the void used to end.

<figure>
  <figcaption>A raw-HTML figure: a member no directive could have targeted.</figcaption>
</figure>

<img src="tone-rule-missing.png" alt="a raw image" width="120" height="92">

<div>
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80" role="img" aria-label="A drawing inside a div"><rect x="1" y="1" width="118" height="78" fill="none" stroke="currentColor"/></svg>
</div>

<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80" role="img" aria-label="A bare drawing">
  <rect x="1" y="1" width="118" height="78" fill="none" stroke="currentColor"/>
</svg>

<img src="tone-rule-missing-a.png" alt="a" width="60" height="40">
<img src="tone-rule-missing-b.png" alt="b" width="60" height="40">

$$
\frac{a}{b} = \sum_{i=1}^{n} x_i^2
$$

> A blockquote inside the toned section.

| column a | column b |
| -------- | -------- |
| 1        | 2        |

---

The last member of the run, after a thematic break.

## Outside the section

This heading ends the run, and nothing here is stamped.
