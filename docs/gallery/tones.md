---
title: "Gallery — tones"
status: accepted
summary: "Every `tone` token, as a lone block and as a section, beside the GFM alerts they borrow their names from."
---

# Tones

Six tokens, each rendered twice: once as a **lone block** and once as a
**section**. The two look deliberately different, and that difference is the
first thing to check.

- A lone block gets the **wash** — a tinted background plus the accent rule.
- A section gets **only the rule**, drawn as one continuous vertical stripe in
  the left gutter across every block it covers.

Compare the six against each other, not against an idea of what "warning"
should look like. The question this page answers is whether they are
*distinguishable* and whether they sit at the same visual weight.

Then hit the theme toggle and read the whole page again. Every value has a
separate dark definition, so light and dark are two independent judgements.

## Lone blocks — the wash

<!-- vantage: block tone=note -->

`tone=note` — a lone block. Accent and wash both come from the note token.

<!-- vantage: block tone=tip -->

`tone=tip` — a lone block. Accent and wash both come from the tip token.

<!-- vantage: block tone=important -->

`tone=important` — a lone block. Accent and wash both come from the important
token. This is the one tone with no matching badge word.

<!-- vantage: block tone=warning -->

`tone=warning` — a lone block. Its wash and chip are a notch stronger than the
others' by design; whether that reads as deliberate or as inconsistent is a
judgement to make here.

<!-- vantage: block tone=caution -->

`tone=caution` — a lone block. Accent and wash both come from the caution
token.

<!-- vantage: block tone=muted -->

`tone=muted` — a lone block. The only token that is not a GFM alert word. It
exists to push a block *down* the page's hierarchy rather than up it.

## Sections — the rule

Each subsection below carries one tone and ends at the next heading. The rule
should run unbroken from the heading's first line to the last line of the last
paragraph, and stop dead there.

<!-- vantage: section tone=note -->

### note

The rule starts at this heading. It is positioned out in the gutter that also
holds line anchors and blockquote borders, and headings are pulled left by
`1.5em` of their own font size so the heading's stripe and this paragraph's
stripe land on the same pixel.

That alignment is the thing to check: sight down the left edge and look for a
jog between the heading and the body.

<!-- vantage: section tone=tip -->

### tip

Three blocks, one stripe. The stripe is not a border on each block — it is a
slice per block, bled upward to meet its predecessor.

So the failure mode to look for is a **gap**, not a misdrawn line.

<!-- vantage: section tone=important -->

### important

The heaviest of the six in most themes. Two paragraphs, so the rule has one
joint in it.

If the joint is visible as a lighter or darker band, the bleed is wrong.

<!-- vantage: section tone=warning -->

### warning

Warning and caution are the pair most likely to be confused at a glance,
because both sit in the red-orange half of the wheel.

Read them one after the other and decide whether the distance between them is
enough.

<!-- vantage: section tone=caution -->

### caution

The other half of that pair. In dark mode both lighten considerably, which
compresses the distance further.

<!-- vantage: section tone=muted -->

### muted

A muted section is a section the reader is invited to skip. It should be the
quietest thing on the page while still visibly *being* a marked section — if it
disappears entirely, the token is doing nothing.

## The GFM alerts

The five alert words are the tone vocabulary's, and they now resolve to **the
same four per-tone properties** — so `> [!WARNING]` and
`<!-- vantage: block tone=warning -->` cannot drift apart, and a new theme is
still one custom-property block.

An alert is a heavier treatment than a tone on purpose. It draws a real left
border, a full wash and a title, because the author asked for a callout; a tone
annotates a block that reads perfectly well without it.

> [!NOTE]
> A note alert.

> [!TIP]
> A tip alert.

> [!IMPORTANT]
> An important alert.

> [!WARNING]
> A warning alert.

> [!CAUTION]
> A caution alert.

What to check here: that the five are distinguishable at a glance, that the
title reads as a label rather than as the first words of the sentence, and that
the wash is strong enough to bound the box without fighting the text.

### An unknown marker is left alone

`[!HINT]` is not an alert word on GitHub either, so it stays exactly as written —
visible literal text rather than a silently swallowed typo.

> [!HINT]
> This is a plain blockquote, and it should look like one: italic, quote marks,
> and the marker still showing.

That is also the specimen for **an ordinary blockquote**, which is worth having
on the page now that alerts no longer look like one.

## Next

- [Emphasis](./emphasis.md) — the same tones at three weights.
- [Badges and chips](./badges-and-chips.md) — where the `chip` and `ink`
  halves of each token show up.
