---
title: "Gallery — badges and chips"
status: accepted
summary: "All five badge tokens, at every heading level, plus the frontmatter status chip."
vantage:
  status-chip: true
---

# Badges and chips

**The chip above this heading is the specimen for the whole "File-scoped
chrome" feature** — it comes from this document's own frontmatter
(`status: accepted` plus `vantage: status-chip: true`), not from a directive.
It should sit as the first thing in the content column, above the metadata
card, and read `ACCEPTED` in the tip colours.

A badge and a status chip are **the same visual object**, drawn by one rule.
The badge is a pseudo-element on a heading; the chip is a real element in the
page chrome. They share their geometry and their palette on purpose, so a
`draft` chip and a `badge=draft` look identical.

Everything below uses the `chip` and `ink` halves of each tone token — the two
values [Tones](./tones.md) never exercises, since a stripe uses `accent` and a
wash uses `wash`.

## The five badge tokens

Five words, and each borrows one tone's colours. `important` has no badge word,
which is the one place the two vocabularies do not line up.

| Badge | Borrows | Means |
| :--- | :--- | :--- |
| `wip` | note | being worked on right now |
| `done` | tip | finished |
| `stale` | warning | still true, probably, but nobody has checked |
| `blocked` | caution | cannot proceed |
| `draft` | muted | not ready to be read as authoritative |

<!-- vantage: section badge=wip -->

### A `wip` section

The chip is drawn once, beside the heading — never repeated on each paragraph
under it. That is the thing to verify: this section has two blocks and must
show exactly one chip.

A second chip down here would mean the point-vs-range split has regressed.

<!-- vantage: section badge=done -->

### A `done` section

Uppercased by the stylesheet, not in the document. The element's text content
stays the lowercase token every other renderer would see, so nothing about the
document's text changes because Vantage drew a chip.

<!-- vantage: section badge=stale -->

### A `stale` section

<!-- vantage: section badge=blocked -->

### A `blocked` section

<!-- vantage: section badge=draft -->

### A `draft` section

The quietest of the five. If it reads as an artifact rather than a label, the
muted chip needs more contrast against the page.

## Badges with tones

A badge and a tone are independent, and the interesting cases are the ones where
they disagree — a `done` chip on a `caution` section is a legitimate thing to
write, and it should not look like a mistake.

<!-- vantage: section tone=caution badge=done -->

### Agreeing, sort of

Caution stripe, done chip. Two different claims about the same section: the
content is hazardous, the work on it is finished.

<!-- vantage: section tone=muted badge=wip -->

### Deliberately mismatched

A muted section with a `wip` chip. The stripe says "skip this" and the chip says
"active" — the note-blue chip against the grey stripe is the contrast to judge.

<!-- vantage: section badge=wip -->

## Heading levels

The badge is sized `clamp(10px, 0.5em, 12px)`, so it scales with its heading and
then stops. The point is that the chip stays legible on an `h5` and does not
become a banner on an `h2`. This heading carries the largest specimen; read the
four below it as a column and look for the two clamp ends.

<!-- vantage: block badge=wip -->

### An `h3` badge

<!-- vantage: block badge=wip -->

#### An `h4` badge

<!-- vantage: block badge=wip -->

##### An `h5` badge

<!-- vantage: block badge=wip -->

###### An `h6` badge

## Badges off a heading

Legal, and rarer. A `block badge=…` stamps whatever block follows it, so a
paragraph can carry a chip.

<!-- vantage: block badge=blocked -->

A paragraph carrying a `blocked` chip. The chip lands after the paragraph's last
word rather than beside a heading, so it inherits body size instead of heading
size.

Inside a list, the directive is **indented into the item** and its target is the
paragraph that follows it there — not the `<li>` and not the `<ul>`. At column 0
between two items it would end the list and start a second one, which is a
change every renderer sees.

1. An ordinary list item.

1. A badged item.

   <!-- vantage: block badge=stale -->

   The chip lands on this paragraph, which is the directive's next sibling
   inside the item.

1. Another ordinary item — and the numbering must still read 1, 2, 3, which is
   how you can tell the list was not split.

## Next

- [Tones](./tones.md) — where `accent` and `wash` live.
- [Collapse](./collapse.md) — the third thing a heading can carry.
