---
title: "Gallery — emphasis"
status: accepted
summary: "`emphasis` at all three settings, against a fixed tone and on its own."
---

# Emphasis

`emphasis` answers "how loud", and `tone` answers "what is this". They are
deliberately separate keys, so an author never has to overstate severity just to
get visual weight.

Three settings, and one of them writes nothing:

| Setting | Rule width | Other effect |
| :--- | :--- | :--- |
| `strong` | 4px | `font-weight: 500`, except on headings, `pre` and `table` |
| `normal` | 3px (the default) | none — it is the default written down |
| `quiet` | 2px | `opacity: 0.72` |

The width differences are 1px steps, so judge them by holding one specimen
against the next rather than by looking at any one alone.

## Against a fixed tone

Same tone throughout, so the only variable is weight. All three should read as
the same *kind* of block at three different volumes.

<!-- vantage: section tone=important emphasis=strong -->

### strong

4px rule, and body text at weight 500. The exclusion list is the thing to check
here: this heading must stay at its normal prose weight, because an unlayered
`font-weight` would otherwise pull a toned heading *down* to 500 from the
semibold typography gives it.

So compare this heading against the `normal` heading below. They should be
identical.

<!-- vantage: section tone=important emphasis=normal -->

### normal

3px rule, ordinary body weight. Writing `emphasis=normal` stamps the attribute
but the stylesheet declares nothing for it, which is why this looks exactly like
a section with no `emphasis` key at all.

It is in the vocabulary so that a merged directive can override an earlier
`strong` — last key wins.

<!-- vantage: section tone=important emphasis=quiet -->

### quiet

2px rule, and the whole block at 72% opacity. Opacity applies to the heading
too, so a quiet section fades as a unit.

The question to answer here: at 72%, is this still comfortably legible on both
backgrounds? A faded block is nearer to content loss than to decoration, which
is why print restores it to full opacity.

## Every tone at `strong`

Weight interacts with hue. A 4px stripe in muted grey and a 4px stripe in
caution red do not carry the same force, so the six are worth seeing at the
loudest setting.

<!-- vantage: block tone=note emphasis=strong -->

`tone=note emphasis=strong`

<!-- vantage: block tone=tip emphasis=strong -->

`tone=tip emphasis=strong`

<!-- vantage: block tone=important emphasis=strong -->

`tone=important emphasis=strong`

<!-- vantage: block tone=warning emphasis=strong -->

`tone=warning emphasis=strong`

<!-- vantage: block tone=caution emphasis=strong -->

`tone=caution emphasis=strong`

<!-- vantage: block tone=muted emphasis=strong -->

`tone=muted emphasis=strong`

## Every tone at `quiet`

The same six at the quietest setting. `muted` plus `quiet` is the floor of the
whole system — if it is invisible here, one of the two keys is redundant.

<!-- vantage: block tone=note emphasis=quiet -->

`tone=note emphasis=quiet`

<!-- vantage: block tone=tip emphasis=quiet -->

`tone=tip emphasis=quiet`

<!-- vantage: block tone=important emphasis=quiet -->

`tone=important emphasis=quiet`

<!-- vantage: block tone=warning emphasis=quiet -->

`tone=warning emphasis=quiet`

<!-- vantage: block tone=caution emphasis=quiet -->

`tone=caution emphasis=quiet`

<!-- vantage: block tone=muted emphasis=quiet -->

`tone=muted emphasis=quiet`

## Emphasis with no tone

There is no rule to modulate, because the stripe is drawn by the tone attribute
and nothing else. So these two specimens get the weight and opacity effects and
no stripe at all — which is a legitimate thing to write, and worth knowing looks
like this rather than like nothing.

<!-- vantage: block emphasis=strong -->

`emphasis=strong` with no tone — weight 500, no stripe, no wash.

<!-- vantage: block emphasis=quiet -->

`emphasis=quiet` with no tone — 72% opacity, no stripe, no wash.

## Next

- [Tones](./tones.md) — the six tokens at default weight.
- [Sections](./sections.md) — what the rule does across every block type.
