---
title: "Gallery — status at a glance"
status: accepted
summary: "Task lists, badges and chips together, as a reader scanning for what still needs them would meet them."
---

# Status at a glance

Every other page in this gallery isolates one mechanism. This one deliberately
does the opposite: it puts all of them on one page in the shapes a real document
uses, because the question here is not "does this token render" but **"can I tell
what still needs me without reading?"**

Scroll past this page quickly, then stop and check what you retained. That is
the test.

## What to look at

- Scanning a checklist, do the **open** items stand out from the done ones?
- Is a done item still comfortably legible, or has it faded past reading?
- Do the badge chips read as status, or as decoration?
- Can you find the one blocked item in the roadmap below without reading the
  words?
- Print it. Every fade must go, and every box must keep its shape — *which*
  items are done is information, not decoration.

## A checklist

The asymmetry is the design: open items keep full contrast, done items recede.
A reader brings "what is left" to a checklist, so the done half should stop
competing without ever becoming unreadable.

- [ ] An open item, at full contrast.
- [ ] A second open item, so the two read as a group.
- [x] A done item, faded but legible.
- [x] Another done item.
- [ ] A third open item, after the done ones — the interleaved case, which is
      where a weak treatment stops working.

## A roadmap section

The shape `roadmap.md` actually uses: nested items, mixed status, and a badge on
the heading saying what the whole section is.

<!-- vantage: section badge=wip -->

### In flight

- [x] Land the directive gallery.
- [x] Render GFM alerts.
- [ ] Retune the tone weights.
  - [x] Widen the section rule.
  - [x] Strengthen the washes.
  - [ ] Decide whether two bars beside an alert is clutter.
- [ ] Style task lists so a roadmap scans.

Nesting has to survive: a sub-task and a sibling are different claims, and a
flattened list makes them look the same.

<!-- vantage: section tone=caution badge=blocked -->

### Blocked

- [ ] Anything waiting on a decision that has not been made.

This is the section the "find the blocked item without reading" check is about.
It carries both a tone and a badge, which is the strongest signal the vocabulary
can make — and if it still does not catch the eye on a fast scroll, that is the
finding.

<!-- vantage: section tone=muted badge=done -->

### Shipped

- [x] Everything here is finished.
- [x] A muted section of done items — the quietest combination the system can
      produce, and the floor of the whole design.

If this section disappears entirely rather than merely receding, either `muted`
or the done fade has gone too far.

## Open questions, as the convention writes them

The [documentation convention](../../userguide/reference/style-guide.md) marks an
Open Question's state with an emoji and a stable ID. Those are ordinary text, so
they render everywhere — the question is whether they are enough on their own,
beside the chips and boxes above.

1. 💬 **OQ-1: Does the emoji carry enough weight next to a chip?**

   <!-- vantage: oq id=OQ-1 leaning="Probably not on a long page — an emoji is one glyph in a paragraph, and a chip is a coloured object beside a heading." -->

   _Leaning:_ probably not on a long page.

   **Answer:**

   > _(empty — fill in when decided)_

1. ✅ **OQ-2: Should an answered question look different from an open one?**

   <!-- vantage: oq id=OQ-2 leaning="Yes, and it already can: a section badge says it at heading level while the emoji says it at item level." -->

   _Leaning:_ yes, and the badge vocabulary already covers it.

   **Answer:**

   > _(empty — fill in when decided)_

1. 🔒 **OQ-3: Is a blocked question distinguishable from a merely open one?**

   <!-- vantage: oq id=OQ-3 leaning="Only by the emoji today. A badge=blocked on the section is the stronger signal, but it is section-level and a question is item-level." -->

   _Leaning:_ only by the emoji today.

   **Answer:**

   > _(empty — fill in when decided)_

## The full status vocabulary, side by side

Everything the system can say about status, in one place, so the set can be
judged as a set rather than one token at a time.

| Mechanism | Says | Scope | Where it renders |
| :--- | :--- | :--- | :--- |
| `- [ ]` / `- [x]` | done or not | one list item | a box, drawn by `task-list.css` |
| `badge=` | five lifecycle words | one heading | a chip beside the heading |
| `status:` frontmatter | four document states | the whole file | a chip above the metadata card |
| `tone=` | six roles | a section or a block | a rule in the gutter, or a wash |
| `> [!KIND]` | five callout kinds | one blockquote | a bordered, washed box with a title |
| `oq` | this is answerable | one block | a button, in review mode only |

The overlap is deliberate and mostly harmless — `badge=done` and `- [x]` say the
same thing at different scopes. The gap is the interesting part: **nothing says
"this document has three unanswered questions" at the top of the page**, which is
the one thing a scanning reader most wants and the one thing no mechanism here
provides.

## Next

- [Badges and chips](./badges-and-chips.md) — the chips in isolation.
- [Tones](./tones.md) — the six roles, and the alerts beside them.
