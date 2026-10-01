---
title: "Gallery — open questions"
status: accepted
summary: "The `question` directive and the row of controls review mode puts at the end of an open question, where it will and will not appear, and what a comment on the question turns it into."
---

# Open questions

`question`, with the deprecated `oq` it replaces, is the only directive that
produces an **affordance** rather than a treatment. At the end of an open question, review mode renders one row of
controls: **"Take this leaning"** and **"Answer…"**. Take this leaning files the
directive's `leaning=` text as an ordinary review comment — the same call the
comment popover makes, with an anchor identical in shape to what click-and-type
produces. Answer… opens that popover on the same block.

The row is the last thing in the question: the last child of its list item,
after the leaning and the Answer, or, outside a list, the next sibling of the
question's last block. Outside a list a question runs from the block its
directive lands on over the blocks after it, up to the next heading (for a
heading, the next one of its level or higher), rule or question. The row is
never a child of a block, and it stays inside whatever contains the question —
so an item's row keeps the item's indent and a blockquote's sits inside the
quote.

There is no new endpoint, no new inbox verb, and nothing downstream knows the
comment came from a button. A comment on the question is its answer, however it
was made: once one is waiting on the agent, the row says so instead.

> [!IMPORTANT]
> **Nothing on this page renders until review mode is on.** Review mode is
> per-file and remembered per file, so turning it on elsewhere does not turn it
> on here. Switch it on for this document and the buttons appear; switch it off
> and the page must read exactly as it does now.
>
> With it off, the **Review toggle's tooltip carries the count**, and says the
> questions can be answered in one click. That tooltip is the only thing that
> says the affordance exists when the buttons cannot render, and it is there
> because without it a document full of leanings read as ordinary prose — which
> is exactly how the feature was first reported broken.

## What to look at

- Does the row sit at the end of its question, after the leaning, reading as the
  question's own, and does it keep its container's indentation? Reload with
  review mode on: the row must be there from the first paint, with nothing below
  it jumping down.
- Is there exactly **one** Take this leaning per open question, and is it
  affirmative only? There is deliberately no Reject — a rejection needs a
  reason, which means typing anyway, so a Reject button would mostly produce
  content-free rejections. Answer… is the typing.
- Click one. The comment that lands in the review panel should read as the
  leaning sentence, not as "yes".
- **Then click Undo.** The comment should go, and the button should come back.
- **Take a leaning, then dismiss the comment from its card.** The chip and Undo
  must both still be there — that is the state this feature used to dead-end in.
- **Click a question's title and comment there instead.** The row must turn into
  *Answered — waiting on the agent*, with no Undo, and Take this leaning and
  Answer… must go. Delete the comment and they come back.
- Turn review mode off. Every row must vanish, the prose must be unchanged, and
  the **Review toggle's tooltip must name the count** — which must equal the
  number of Take this leaning buttons that were just there. Nothing may appear
  beside the label: the count is deliberately not a chip on the button.

## In a list, which is where they really live

An Open Questions list is the normal home for these. The directive is
**indented inside the item** — at column 0 between two items it terminates the
list, and one loose list becomes two with different numbering and spacing, which
is a change every renderer sees. The row is the item's last child, so in the
first item it comes after the Answer, not between the leaning and the Answer
where the directive is.

The numbering below must read 1, 2, 3. If it restarts, a directive escaped its
item.

1. **OQ-1: Should the gallery live under `docs/`?**

   <!-- vantage: question id=OQ-1 leaning="Yes — it is checked by the gate there, so a directive that stops being valid fails a commit instead of rotting quietly." -->

   _Leaning:_ Yes, so the gate checks it.

   **Answer:**

   > _(empty — fill in when decided)_

1. **OQ-2: One page per concern, or one long page?**

   <!-- vantage: question id=OQ-2 leaning="One page per concern, so a review comment can name the page it is about." -->

   _Leaning:_ One page per concern.

1. **OQ-3: Should the gallery ship to end users, or stay a maintainer tool?**

   <!-- vantage: question id=OQ-3 leaning="Maintainer tool. It is a color-review surface, not documentation of a feature — the user guide already covers the markup." -->

   _Leaning:_ Maintainer tool.

## On a bare paragraph

<!-- vantage: question id=OQ-4 leaning="A paragraph is the plainest host, and the button should look identical here to how it looks in a list." -->

A question written as a plain paragraph rather than a list item. Outside a list
a question runs on over the blocks after the one its directive lands on, up to
the next heading, so this question is this paragraph and the two below it, and
its row goes below the last of them, not between this paragraph and the next. A
comment on any of the three is its answer.

This is the best specimen for the **taken** state, because nothing else is
competing for the space. Take it, and the button becomes a green **Leaning
taken** chip with a quiet **Undo** beside it; the comment's own card appears
below the paragraph it is on. Undo deletes that comment and restores the button.

Undo is withheld in exactly one case: once anything has replied to the comment,
deleting it would take the reply with it, so the chip renders alone and its
tooltip says where the thread is instead.

## On a blockquote

<!-- vantage: question id=OQ-5 leaning="A blockquote already has a border in the gutter, so this is the placement most likely to collide." -->

> A question written as a blockquote. Check two things: that the row clears the
> quote bar rather than sitting on top of it, and that the closing quotation mark
> is at the end of the quoted sentence rather than after the button.

## On a heading

<!-- vantage: question id=OQ-6 leaning="A heading is a legal host, and the button must not disturb the heading's baseline." -->

### A question as a heading

A heading can host the button too. A question written as a heading runs to the
end of its section, so the row lands below this paragraph, the section's last
block, and not between the heading and it, where it would read as part of the
heading rather than the end of the question.

## With no leaning

<!-- vantage: question id=OQ-7 -->

`leaning=` is optional. Without one the button still renders and files a fixed
default comment instead — which is usually not what you want, because the
comment is all the agent reading it ever sees. Nobody remembers which button was
clicked.

## Blocked or answered

A question that cannot be answered yet, or already has been, keeps its
`question` directive and changes its marker. It anchors and counts exactly as an
open one does, so the contents column lists both of these and a link to either
id scrolls here, and review mode must render **no** row under either: no
button, no chip, no Undo.

1. 🔒 **OQ-9: Is a blocked question declared without a button?**

   <!-- vantage: question id=OQ-9 -->

   It waits on the specimens above, so there is no leaning to take yet.

2. ✅ **OQ-10: And an answered one?**

   <!-- vantage: question id=OQ-10 -->

   _Leaning:_ yes.

   **Answer:**

   > Yes: neither offers Take this leaning.

`oq`, the name `question` replaces, would be wrong on either, and
`vantage-check` says so. Every Vantage before 0.8 offers the button on every
`oq` it meets, while `question` is a name those viewers drop whole, so they
show these two as ordinary list items with nothing to click.

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
<!-- vantage: question id=OQ-8 leaning="This does nothing." -->

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
