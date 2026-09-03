---
title: "Gallery — open questions"
status: accepted
summary: "The `oq` directive and its one-click review button, and where the button will and will not appear."
---

# Open questions

`oq` is the only directive that produces an **affordance** rather than a
treatment. Below a question it marks, review mode renders one button labelled
**"Take this leaning"**, in a row of its own. Clicking it files the directive's
`leaning=` text as an ordinary review comment — the same call the comment popover
makes, with an anchor identical in shape to what click-and-type produces.

The row is the block's next sibling, never a child of it, and it stays inside
whatever contains the question — so an item's button keeps the item's indent and
a blockquote's sits inside the quote.

There is no new endpoint, no new inbox verb, and nothing downstream knows the
comment came from a button.

> [!IMPORTANT]
> **Nothing on this page renders until review mode is on.** Review mode is
> per-file and remembered per file, so turning it on elsewhere does not turn it
> on here. Switch it on for this document and the buttons appear; switch it off
> and the page must read exactly as it does now.

## What to look at

- Does the row sit under its question without pushing the prose around, and does
  it keep its container's indentation?
- Is there exactly **one** button per `oq`, and is it affirmative only? There is
  deliberately no Reject — a rejection needs a reason, which means typing
  anyway, so a Reject button would mostly produce content-free rejections.
- Click one. The comment that lands in the review panel should read as the
  leaning sentence, not as "yes".
- **Then click Undo.** The comment should go, and the button should come back.
- **Take a leaning, then dismiss the comment from its card.** The chip and Undo
  must both still be there — that is the state this feature used to dead-end in.
- Turn review mode off. Every row must vanish, and the prose must be unchanged.

## In a list, which is where they really live

An Open Questions list is the normal home for these. The directive is
**indented inside the item** — at column 0 between two items it terminates the
list, and one loose list becomes two with different numbering and spacing, which
is a change every renderer sees.

The numbering below must read 1, 2, 3. If it restarts, a directive escaped its
item.

1. **OQ-1: Should the gallery live under `docs/`?**

   <!-- vantage: oq id=OQ-1 leaning="Yes — it is checked by the gate there, so a directive that stops being valid fails a commit instead of rotting quietly." -->

   _Leaning:_ Yes, so the gate checks it.

1. **OQ-2: One page per concern, or one long page?**

   <!-- vantage: oq id=OQ-2 leaning="One page per concern, so a review comment can name the page it is about." -->

   _Leaning:_ One page per concern.

1. **OQ-3: Should the gallery ship to end users, or stay a maintainer tool?**

   <!-- vantage: oq id=OQ-3 leaning="Maintainer tool. It is a colour-review surface, not documentation of a feature — the user guide already covers the markup." -->

   _Leaning:_ Maintainer tool.

## On a bare paragraph

<!-- vantage: oq id=OQ-4 leaning="A paragraph is the plainest host, and the button should look identical here to how it looks in a list." -->

A question written as a plain paragraph rather than a list item. The row goes
directly below this block.

This is the best specimen for the **taken** state, because nothing else is
competing for the space. Take it, and the button becomes a green **Leaning
taken** chip with a quiet **Undo** beside it; the comment's own card appears
below the row. Undo deletes that comment and restores the button.

Undo is withheld in exactly one case: once anything has replied to the comment,
deleting it would take the reply with it, so the chip renders alone and its
tooltip says where the thread is instead.

## On a blockquote

<!-- vantage: oq id=OQ-5 leaning="A blockquote already has a border in the gutter, so this is the placement most likely to collide." -->

> A question written as a blockquote. Check two things: that the row clears the
> quote bar rather than sitting on top of it, and that the closing quotation mark
> is at the end of the quoted sentence rather than after the button.

## On a heading

<!-- vantage: oq id=OQ-6 leaning="A heading is a legal host, and the button must not disturb the heading's baseline." -->

### A question as a heading

A heading can host the button too. The row lands between the heading and this
paragraph, which is the one placement worth a second look: the heading's own
bottom margin and the row's negative top margin have to add up to something that
still reads as "this button belongs to that heading".

## With no leaning

<!-- vantage: oq id=OQ-7 -->

`leaning=` is optional. Without one the button still renders and files a fixed
default comment instead — which is usually not what you want, because the
comment is all the agent reading it ever sees. Nobody remembers which button was
clicked.

## Where the button will not appear

Two lists are at work and they are not the same. A comment can be **anchored**
on a block, and a block can **host** a button; the second set is the first minus
`pre` and `table`.

| Tag | Anchorable | Hosts a button |
| :--- | :--- | :--- |
| `p`, `h1`–`h6`, `li`, `blockquote` | yes | yes |
| `pre` | yes | no — the button would render as part of the code |
| `table` | yes | no — a `<button>` child of `<table>` is invalid HTML, so the parser hoists it out |
| `ul`, `ol`, `tr`, `hr`, `div` | no | no |

The `ul` row is the one that catches authors. A directive at column 0 above a
list targets the `<ul>`, not the first `<li>`, so it silently does nothing:

```markdown
<!-- vantage: oq id=OQ-8 leaning="This does nothing." -->

- The target is the list, not this item.
```

None of those cases are demonstrated live on this page, because each one is a
`vantage-check` finding and this page has to pass the gate. Run the checker on a
file containing them to see what it says.

## The static gate

The button is also gated on **static mode being off**, and that gate is not
optional. An exported static site runs review mode with every write silently
coerced into a `GET`, so an ungated button would look live and do nothing —
worse than no button at all.

To see it: export a static site from this repo and open this page there. Review
mode will still toggle; the buttons must not appear.

## Next

- [Collapse](./collapse.md) — the other injected control, and the one the click
  handler has to coexist with.
- [The reference](../reference/inline-markup.md#the-one-click-open-question-answer)
  — why there is exactly one button.
