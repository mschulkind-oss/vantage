---
title: "The planning page is its questions, and a block has a referent"
date: 2026-10-10
status: accepted
stage: DECIDED
next: "Write the implementation plan, then build the blocked-on key, the derivation, the page, and this repository's own bare blocked questions"
tags: [planning, planning-page, questions, notation]
summary: "The page lists questions, not documents. \u201cBlocked\u201d stops being an assertion and becomes a reference: a blocked question must name what it waits on, and a question nobody has researched is unactioned \u2014 an open question with an owner \u2014 not blocked."
---

# The planning page is its questions, and a block has a referent

**Status:** 2026-10-10. Ruled in conversation; nothing built. Revises
[OQ-TD1 and OQ-TD2](../reference/planning-index.md#why-its-this-way) of the
planning reference.

> **In short.** The page lists questions, not documents. "Blocked" stops being a
> word an author types and becomes a reference: a blocked question names what it
> waits on, and a question nobody has researched is **unactioned** — an open
> question with an owner — not blocked.

**Why it matters.** An implementation plan rendered under *Blocked*, beside the
line *Nothing to do here*, while the question that would unblock it sat unrouted
one folded group away. Worse, because 🔒 is an unverifiable assertion, it is a
place any amount of unattempted work can be parked: a question marked blocked
"because we never researched it" reads exactly like one waiting on an upstream
decision.

**The shape.** Three moves. A question's block becomes a reference (`blocked-on`,
the question-level twin of a document's `depends-on`). The derivation stops
emitting document rows, so *Blocked* is questions only, and a 🔒 with no live
referent is unactioned rather than blocked. The page appends the unrouted open
questions to *Needs you*.

**Cost.** `index --format json` changes, so its version bumps. Every existing
bare 🔒 in every repository becomes a finding in this release, by design. No
notation is redefined: `blocked-on` is a new key, and a viewer older than this
release drops an unknown key and reads the question exactly as it did.

**Start at [§2](#2-blocked-versus-unactioned)** — the distinction the rest of the
design follows from.

**Needs your ruling:** None.

**Reads with:** [`planning-index.md`](../reference/planning-index.md)
([§3.3](../reference/planning-index.md#33-questions),
[§6.2](../reference/planning-index.md#62-sections-top-to-bottom),
[§6.4](../reference/planning-index.md#64-needs-you-as-a-to-do-list),
[§13.3](../reference/planning-index.md#133-the-planning-rules)); the companion
implementation plan.

---

## 1. What the page did

Two failures with one root:

- **It showed documents that owe nothing.** The only metadata that put a
  *document row* in *Blocked* is `depends-on:` — the field that says "I am
  blocked on this." Its main producer is an implementation plan, and a plan holds
  no question of its own. So the page spent a row on a downstream consumer, under
  *Nothing to do here*, and its dependency is what the reader actually needed.
- **It hid questions that owe something.** A question no roadmap routes went to a
  folded *Maintenance* group because the section's actor was "agent." Off-roadmap
  is a lint gap, not a lower priority: the question still needs a person.

## 2. Blocked versus unactioned

`depends-on` gives a document a **referent**: a file and an id the index can
resolve, watch, and clear when the target closes. A question's 🔒 gives it
nothing — the index reads the marker and takes the author's word. With no
referent, one marker has collapsed three unrelated conditions:

| Condition | What it means | Who owes it |
| :--- | :--- | :--- |
| **Unactioned** | answerable in principle; nobody has done the work | you, or an agent |
| **Blocked** | cannot be answered until something outside it happens first | nobody — it is waiting on the world |
| **Set aside** | answerable, deliberately left | whoever set it aside |

All three render identically, under an explanation that says *Nothing to do
here*. So the page tells the reader a question needs nothing from them when most
of the time it means **nobody has picked it up**. That is the thing to fix:

> **A block is a reference, not an adjective.** And an open question does not
> have "nobody" as an owner; it is either yours to rule or an agent's to work.

## 3. The change

### 3.1 A question's block is a reference

The `question` directive gains one optional key, **`blocked-on`**, a list read
exactly as a document's `depends-on` is: a repo-relative path, optionally with
`#OQ-…`. Resolved, it means the same as a document's: an entry naming a question
waits while that question is open, and one naming a document waits while that
document has an open question.

For a genuine external dependency, an entry that is not a repo-relative path is
an **external blocker name**, such as `blocked-on="the 1.0 release"`. It is a
*named* blocker the index shows and cannot resolve, so it never clears itself.
This keeps the rule the design turns on intact — a block always names what it
waits on — without pretending an outside event is a file. A path-shaped entry
that does not resolve is a finding, as a bad `depends-on` entry is.

```markdown
1. 🔒 **OQ-3: How large is the retry budget?**

   <!-- vantage: question id=OQ-3 blocked-on="docs/design/rate-limiting.md#OQ-1" -->

   _Leaning:_ 5 attempts.
```

### 3.2 Blocked is questions only, and a bare 🔒 is unactioned

`derivePlanningSections` stops emitting `{kind: "document"}` entries into
`waiting`, so a plan blocked on a design question leaves the index and every
reader at once: the page, the filter's kept-count, the outline, and
`vantage-check index`. `depends-on` keeps its other job — the inline
"(blocked on …)" mark on *Ready to build* and *Ready to graduate* rows, where the
row has an actor and the mark stops an agent building something too early.

**The referent decides the state, and the marker must agree with it.** A question
is *blocked* exactly when its `blocked-on` has a live referent; it is *open*
otherwise. The marker is the author's claim about that, and where the two
disagree the checker names which is wrong and the referent decides:

- 🔒 with a live referent → blocked, and its row names and links what it waits on;
- 🔒 whose referents have all closed, or with no `blocked-on` at all → unactioned:
  nothing blocks it, so it is an open question with an owner;
- 💬 with a live referent → blocked, although the marker said open;
- 💬 with no live referent → open, as today.

Either unactioned case is an *open* question on the page: a card if a roadmap
routes it, and at the end of *Needs you* if not. An open question has an owner —
you or an agent — and never "nobody."

### 3.3 Unrouted questions join the end of the to-do list

`Needs you` becomes the routed open questions in roadmap order, then the unrouted
open questions by path and document order, each marked *Not on a roadmap*, as
full cards the reader can rule in place. The unrouted questions have no position
in roadmap order, so they follow it rather than being dropped.

**Not on a roadmap stays in *Maintenance*.** The questions appear twice on
purpose: as cards in *Needs you*, which the reader answers, and as rows in the
agent's routing worklist. *Copy answers + maintenance*, with every kind checked,
is the full hand-off — route these, build these, compact these, fix these.

**Convention over configuration.** Nothing new is marked or configured to get
this behavior. The discriminator is the convention the page already runs on —
does a document hold questions? — and the referent is the field the document
family already has.

## 4. What the tree will say

A 🔒 with no live referent is a finding, so this release lights up every bare
blocked question in every repository. That is the point, and it is the tree
evolving: each one is answered, given a referent, or moved to 💬 — a decision its
owner now has to make instead of parking it. This repository's own bare 🔒
questions are fixed in the same change that adds the rule.

## 5. Decision Ledger

| ID | Ruling | Date |
| :--- | :--- | :--- |
| — | *Blocked* lists questions, not documents; the change is at the derivation so page, counts, outline and checker agree, and `INDEX_FORMAT_VERSION` goes to 3. | 2026-10-10 |
| — | A question's block is a reference (`blocked-on`), the question-level twin of `depends-on`; a quoted phrase is an allowed external referent. | 2026-10-10 |
| — | A 🔒 with no live referent is unactioned, not blocked; it is an open question with an owner, and the checker reports it. | 2026-10-10 |
| — | Unrouted open questions are cards at the end of *Needs you*, marked *Not on a roadmap*. | 2026-10-10 |
| — | *Not on a roadmap* stays in *Maintenance* as the agent's routing worklist. | 2026-10-10 |
