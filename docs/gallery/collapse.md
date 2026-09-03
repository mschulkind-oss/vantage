---
title: "Gallery — collapse"
status: accepted
summary: "Collapsed sections, the caret, nesting, and the three gates that keep content reachable."
---

# Collapse

`collapsed=true` on a section puts a caret on the heading and starts its body
hidden. There is no `<details>` wrapper anywhere — the heading takes one
attribute and each block it hides takes another, so the run stays a flat list of
siblings and comment cards, margin resets and line anchors all keep working.

The caret is a real `<button>`, injected by the toggle script. It is
keyboard-operable, it carries `aria-expanded`, and clicking it must **not** also
open a review comment popover.

The glyph is drawn in CSS rather than written into the element, so the
document's text content is byte-identical whether or not the script ran. Nothing
about a block's hash, its clipboard payload or its anchor shifts because a caret
appeared.

## What to look at

- Does the caret rotate when you toggle it?
- Does `Tab` reach it, and do `Enter` and `Space` operate it?
- With review mode on, does a click on the caret open a comment popover it
  should not?
- Print the page. **Every collapsed section must print open, and no caret may
  print at all** — a section that printed closed is content loss on paper.

## A collapsed section

<!-- vantage: section collapsed=true -->

### Closed to start with

You are reading this because you opened it. It starts hidden.

A second block, so the group is more than one member. Both blocks belong to the
same group and both should appear and disappear together.

```bash
echo "a fence inside a collapsed group"
```

## Collapsed, with a tone

The two keys are independent. A collapsed section can be toned, and the stripe
should cover exactly the blocks that are visible at any moment — so it shortens
to the heading alone when the section is closed.

<!-- vantage: section tone=warning collapsed=true -->

### Closed and toned

The stripe grows when you open this and shrinks when you close it, because the
hidden blocks are `display: none` and stop taking part in layout.

Watch the gutter as you toggle: the stripe should never be left hanging in empty
space below the heading.

## Collapsed, with a badge

<!-- vantage: section tone=muted badge=draft collapsed=true -->

### Closed, toned and badged

Three things on one heading: a stripe drawn by `::before`, a chip drawn by
`::after`, and a caret that is a real element. This is the only specimen where
all three meet, and the order on the line matters — caret, heading text, chip.

If the chip has moved to the wrong side of the text, or the caret is overlapping
the stripe, this is where it shows.

## Nesting

A nested heading inside a collapsed section is **both** a hidden member of the
outer group and the toggle for its own. That is why the heading and the blocks
take different attributes: one shared attribute would make the inner heading
permanently invisible and reachable by neither toggle.

<!-- vantage: section tone=note collapsed=true -->

### An outer collapsed section

A block belonging to the outer group.

<!-- vantage: section collapsed=true -->

#### An inner collapsed section

A block belonging to the inner group. Opening the outer section must reveal this
heading with its own caret still closed — so getting to this paragraph takes two
clicks.

Closing the outer section must hide the inner heading, its caret and this
paragraph together.

### A sibling at the outer depth

This heading is at the same depth as the outer section's, so it ends that run.
It is not collapsed, and toggling the section above must not affect it.

## `collapsed=false`

The default, written down. On its own it stamps nothing at all — this section
looks exactly like one with no `collapsed` key.

<!-- vantage: section tone=tip collapsed=false -->

### Explicitly open

No caret, nothing hidden. Its one real use is overriding a `collapsed=true`
earlier in the same merged run of directives, where the last key wins:

```markdown
<!-- vantage: section tone=note collapsed=true -->
<!-- vantage: section collapsed=false -->

## Open after all
```

Two consecutive directives merge onto one block whether or not there is a blank
line between them, so the tone survives and the collapse is cancelled.

> [!IMPORTANT]
> It cannot cancel an **enclosing** collapsed section. A nested heading is a
> hidden member of the outer group by design, and the outer run is stamped
> before any inner directive has been resolved.

## The three gates

Hidden content with no way to reveal it is content loss, not a style. So the
hiding rule is gated three times, and each gate covers a different way the
control could fail to exist:

| Gate | Covers |
| :--- | :--- |
| `data-vantage-collapse-ready` on the container | the script never ran — a renderer with no JavaScript shows the whole document |
| `data-vantage-collapse-armed` on each block | the script ran but gave *this* group no caret |
| `@media not print` | paper, where no caret can be clicked |

The second is not implied by the first. "A control exists somewhere in this
document" is not "this block can be reopened", and the difference is what keeps
a hand-written `data-vantage-collapsed="true"` in raw HTML — which the sanitiser
allows by name — from hiding a block nothing can reveal.

The third is not a counter-rule but an absence: `not print` means the
declaration does not exist in the print stylesheet at all, so no later rule can
defeat it.

## Next

- [Sections](./sections.md) — the run the caret hides.
- [Open questions](./open-questions.md) — the other thing the toggle script must
  not fight with.
