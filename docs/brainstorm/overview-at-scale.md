---
title: "Large collections in Work — choose what opens before changing the board"
status: draft
stage: SKETCH
next: "Rule OQ-OAS1 — choose the initial stage-browsing default"
tags: [brainstorm, planning, viewer]
summary: "A supplied 270-document Overview capture exposes an unresolved first-view choice, not evidence of unfinished work or a known history defect."
---

# Large collections in Work — choose what opens before changing the board

**Status:** Exploration from a supplied Overview capture; no browsing behavior is
approved or implemented here. The [Work overview reference](../reference/work-overview.md)
remains the system contract for the current board and its bounded Git evidence.

## Observation

One supplied capture of the `yolo-jail` repository showed **270 indexed documents**:

| Displayed group | Count |
| --- | ---: |
| DESIGN | 78 |
| SKETCH | 22 |
| DECIDED | 20 |
| BUILT | 36 |
| CURRENT | 19 |
| Missing stage | 66 |
| Terminal/reference | 29 |

These are one capture's index and labels, not permanent or universal counts. The
**241 documents outside the displayed Terminal/reference bucket are not 241
unfinished tasks**: the board reports saved document classification, not task
completion, implementation, or progress. See the reference's [stage roles and
board census](../reference/work-overview.md#board-census-and-stage-roles).

The capture showed the unconditional claims-only disclaimer that the recent
presentation repair removes. That repair changes presentation only; it does not
change the history inspection limits. The [current limits](../reference/work-overview.md#current-values)
remain 50 commits, 50 source pairs, and 64 KiB per blob. A repository whose
local history extends beyond the 50-commit inspection limit is truncated; a
source-pair may also be unreadable or invalid, not only oversized. The generic
reason says a changed blob was unavailable **or** exceeded 64 KiB. The capture
does not identify a triggering path or a snapshot reason, so no offending file
can be named from it.

## Options

**Summary-first** *(coined here)* means stage counts stay visible while stage
contents start collapsed; a reader can focus one stage or choose **Show all**.
The turn is an explicit choice of what to inspect first, not a new grouping,
work state, or smaller index.

| Rank | Direction | Concrete cost in this capture | Verdict |
| --- | --- | --- | --- |
| 1 | Summary-first counts, explicit stage focus/collapse, and **Show all** | Starts with 7 group summaries instead of 270 document cards; expanding DESIGN still exposes 78 cards and Missing stage 66 | Strongest next direction; preserves complete access and the current inventory |
| 2 | Compact rows instead of cards | Still presents all 270 entries at once; saves vertical space only if the row safely preserves title, path, stage, and handoffs | Plausible alternative if the problem is card height rather than choosing a stage |
| 3 | Reveal entries in batches | Reduces the first visible batch, but hides indexed entries behind repeated actions and requires a batch-size rule | Weaker than stage summaries: it makes the reader discover the inventory by paging |

The screenshot establishes density, not a performance failure or the reader's
preferred default. The recommendation is summary-first because it reduces the
initial wall while keeping exact stage counts and one **Show all** path; it does
not justify hiding documents permanently or changing navigation. Compact rows
likely displace the current tile treatment if card height proves to be the
problem. Batch reveal is not a scale fix without evidence that rendering all
indexed documents is itself failing.

> [!IMPORTANT]
> Do not convert stage counts into an unfinished-work total. Do not treat the
> generic blob reason as proof that a known file exceeded the cap. The two
> observations are independent: collection size does not establish the cause of
> partial Git history.

## Open question

1. 💬 **OQ-OAS1: What should a large collection show before the reader chooses a stage?**

   The current board shows active groups together; the capture has 270 indexed
   documents and groups as large as 78 and 66. Summary-first would keep group
   counts visible and offer focus/collapse plus **Show all**; the alternative is
   all active groups expanded by default, with optional focus.

   <!-- vantage: question id=OQ-OAS1 leaning="Prefer summary-first counts with explicit stage focus/collapse and Show all; the capture is dense, but the choice remains yours." -->

   _Leaning:_ Prefer summary-first counts with explicit stage focus/collapse and
   Show all; the capture is dense, but the choice remains yours.
