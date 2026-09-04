# Toned section fixture

Fixture for `directive_tone_rule.spec.ts`, which measures — in pixels, over the
real stylesheet — whether a toned section's vertical rule is one continuous line.
Every block type a `section` can reach appears once below, in one run, because
every way the rule has broken was per-tag: a `<pre>` and an `<hr>` clipped their
own `::before` away, a `$$…$$` block lost its stamp to `rehype-katex`, and a
raw-HTML `<figure>` was never stamped at all because the range was gated by the
list of tags a directive may *target*.

<!-- vantage: section tone=warning -->

## Every member type, one run

A paragraph, long enough to wrap onto a second line so the rule has some height
to cover here rather than a single line's worth.

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
