---
title: "Gallery — sections and the run"
status: accepted
summary: "One toned section across every block type it can cover, plus the boundaries between adjacent runs."
---

# Sections and the run

A section's stripe is not a border. Every block under the heading is stamped
separately and draws its own slice, positioned out into the gutter and bled
upward to meet its predecessor. The stripe you see is those slices lining up.

So the whole page reduces to two questions:

1. **Is the stripe continuous?** A gap means one member did not paint, or its
   bleed did not reach.
2. **Does it stop where the section stops?** A stripe hanging above the first
   heading or below the last block means a run marker is wrong.

Scroll slowly and sight down the left gutter. Everything on this page is one
long answer to those two questions.

## Every block type in one run

The section below covers a paragraph, a bulleted list, a numbered list, a
blockquote, a code fence, a table, a thematic break, a block of display maths
and a nested heading — in that order, under one directive.

<!-- vantage: section tone=note -->

### One section, nine members

An opening paragraph. The stripe begins at the heading above and should reach
this block without a joint you can see.

- A bulleted list.
- The list is one member, not one member per item, so the stripe covers the
  whole block.

1. A numbered list.
1. Also one member.

> A blockquote. This is the one member with a border of its own in the same
> gutter, so the stripe and the quote bar sit side by side — check that they do
> not collide or overlap.

```bash
# A code fence. This member is the interesting one.
echo "a fence is a scroll container, and a scroll container clips its own stripe"
```

A code fence forces `overflow-y: auto` on itself to make wide code scroll, and a
box that scrolls clips the absolutely-positioned slice down to nothing — so a
fence used to punch a hole in the stripe as tall as the fence plus the bleed. The
fix un-clips the fence and moves the horizontal scroller onto its `code` child.

What that means for reading this page: **the stripe must run past the fence
above with no interruption**, and the fence below must still scroll sideways.

```text
this line is deliberately far too long to fit in the content column, so that the horizontal scrollbar appears and can be dragged, which is the other half of the fence fix — the scroller moved to the code element rather than being removed
```

| A table | Another column |
| :--- | :--- |
| Also one member | The stripe covers the whole table |
| Not one per row | `tr` is stampable, but a section stamps the `table` |

---

A thematic break is the other special member. It is one or two pixels of box
between two large margins — a gap wider than any neighbour can bleed across — so
it is the only member that also bleeds **downward**, by its own margin rather
than by the shared amount.

Look at the rule above this paragraph: the stripe should pass straight through
the horizontal line with no break on either side of it.

$$
\sum_{i=1}^{n} w_i x_i \geq \theta
$$

Display maths is replaced wholesale by KaTeX after the stamp is applied, so the
stamp has to be captured before and re-applied to the replacement. If that
failed, this formula would show as an unpainted gap in the stripe and would have
no line anchor.

#### A nested heading, still inside the section

A nested heading is included in the run — the section ends at the first heading
of the *same or shallower* depth, and this one is deeper. Headings are pulled
left by `1.5em` of their own font size, which is the only way an `h3`, an `h4`
and a paragraph put their slices on the same pixel.

That makes this the alignment check: the stripe beside this `h4`, beside the
`h3` above, and beside these paragraphs must all be at one x.

## Where the section ends

The heading below is at the same depth as the one that opened the run, so it
terminates it. The stripe above must stop at the last block of the previous
section — and the stripe below must start at this heading, not above it.

<!-- vantage: section tone=caution -->

### A second run, touching the first

Two runs of different tone meeting with nothing between them is the case
sibling-based CSS gets wrong. This heading is the first member of a caution run,
and it must not bleed its stripe upward into the note run above.

If you see a short caution-coloured stripe hanging above this heading, the run
selector has been rewritten as a negation.

<!-- vantage: section tone=tip -->

### A third run, immediately after

The same check again in the other colour pair, and the boundary to look at is
between this heading and the caution paragraph above it.

The colour should change exactly at this heading's top edge.

## The hole a section cannot fill

A block type the pipeline does not stamp is **skipped inside a range, not
treated as the end of it** — so the section continues past it and the stripe
visibly breaks there.

Nothing reports this. It is the one failure mode in the whole feature that only
an author looking at the page can catch, which is the reason this gallery
exists.

<!-- vantage: section tone=warning -->

### A section with a raw-HTML member

This paragraph is stamped and paints its slice.

<figure>
  <figcaption>A raw-HTML figure. Not a stampable tag, so no slice.</figcaption>
</figure>

This paragraph is stamped again and the run continues — but the stripe has a
hole the height of the figure above, because the figure drew nothing and this
block's upward bleed cannot span it.

That break is **expected** and is not a bug in the stylesheet. It is the
documented consequence of putting an unstampable block inside a toned section,
and the fix is to move the figure out of the section rather than to widen the
bleed.

## Sections on non-headings

`section` before something that is not a heading degrades to covering that one
block — there is no heading to define an extent from. It is then exactly
equivalent to `block`, and worth knowing that it renders as a lone block, wash
included, rather than as a one-member stripe.

<!-- vantage: section tone=important -->

A `section` directive in front of a paragraph. Wash, not stripe — because a
one-member run is marked `only`, which is the same marker a `block` gets.

## Next

- [Collapse](./collapse.md) — hiding a run behind a caret on its heading.
- [Open questions](./open-questions.md) — the one affordance that writes.
