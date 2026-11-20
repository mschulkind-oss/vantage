---
title: "The planning page keeps itself current — the reader is told what changed, never asked to understand the machinery"
status: in-review
stage: DESIGN
next: "Rule OQ-FS2 to OQ-FS5; OQ-FS1 is settled (lay out now, verify after)"
depends-on: [planning-question-state.md]
---

# The planning page keeps itself current — the reader is told what changed, never asked to understand the machinery

**Status:** 2026-11-20. Nothing built. Evidence verified against the working tree
on 2026-11-20 (one narrow fix in flight, named in [§2.3](#23-the-fix-in-flight-and-what-it-does-not-fix)). Not yet routed by `roadmap.md`.

> **In short.** A reader of `/.vantage/planning` should hold three things in
> their head: whether the page is **current**, **behind**, or **offline**; what
> each question's **status** is; and that there is **one** button, which brings
> the page up to date. Keeping the document and its comments in step is the
> system's job, done on every change and every return to the tab, and a card
> never asks the reader to resolve a state the system could resolve itself.

**Why it matters.** Today the header carries four controls about freshness and
ownership — _Apply updates_, _Reload from server_, an _Unknown_ pill and a link
icon reading _0 not attached_ — and a card can wear a dashed _Unknown_ band for
hours because the page paired its comments with a version of the document that
an agent has since edited. The owner's words: *"refresh buttons, and out of
date, and that link thing where comments are disconnected somehow. It's all very
confusing."* Each control is correct and the whole is unreadable.

**The shape.** One **reading** per document that the system keeps coherent
itself; one **page freshness** state with one action, _Update_; a card status
vocabulary with no _Unknown_ in it; and the comments no question owns moved out
of the header into a section of their own.

**Cost.** _Reload from server_, the _Unknown_ pill and the header's ownership
control go; _Apply updates_ changes name and gains a verification read; the card
label _Unknown_ is replaced by named conditions; the Maintenance vocabulary
gains one kind. The settled rules (late data never moves painted content, no
synthesized identity, a coherent pair, nothing shown on a guess) are kept whole.

**Start at [§4](#4-the-readers-state-model)** — the state model. [§5](#5-the-readers-situations) walks every
situation through it; [§6](#6-what-happens-to-todays-surface) disposes of today's controls.

**Needs your ruling:** [OQ-FS2](#OQ-FS2), [OQ-FS3](#OQ-FS3), [OQ-FS4](#OQ-FS4), [OQ-FS5](#OQ-FS5).

**Reads with:** [`planning-question-state.md`](planning-question-state.md) (the
design this one narrows: its ownership, labels and live-versus-applied rules
stand; this doc replaces its header controls and its _Unknown_ state),
[`planning-ownership.md`](../reference/planning-ownership.md) (the built
contract: evidence, the scanner bridge, binding), [`planning-index.md` §6.4](../reference/planning-index.md#64-needs-you-as-a-to-do-list)
and [§12](../reference/planning-index.md#12-late-data-never-moves-painted-content)
(the layout and the late-data rules every mechanism here answers to). No
companion seed is open yet; the planner opens one at acceptance.

---

## 1. Verdict, and the principles it rests on

The page's freshness machinery is sound and its *presentation* is wrong: it
shows the reader the machinery's internal states (a pair out of step, a reviews
batch that failed, a bind the server refused) as though each were something the
reader must act on. The fix is not another control. It is to give the system
the jobs it can do alone, and to show the reader only what is left.

- **P1. Coherence is the system's job.** A document and the comments on it are
  read as one version, and whenever either half changes the system reads them
  as one again. No reader action exists whose purpose is to make a pair
  coherent.
- **P2. One freshness state, one action.** The whole page is current, behind,
  or offline. Behind has one button. Offline has none the reader needs to press;
  the system retries.
- **P3. A card's status is about the question, never about the machinery.** A
  card says what the question's state is, or names a condition of the
  *document* a person can fix. It never says the page's internals disagree.
- **P4. Transient states are shown as transient, and bounded.** A re-read in
  flight keeps the last known status with a small mark; the mark has a
  deadline, after which the page as a whole is offline. Nothing waits
  indefinitely in a per-card limbo.
- **P5. The settled rules hold.** Late data never moves painted content
  ([L1–L4](../reference/planning-index.md#121-the-rules)); a comment binds to a
  question only through a directive id; ownership is read only from a coherent
  pair; nothing is shown on a guess. Every mechanism below is designed inside
  them, and [§8](#8-alternatives-considered) rejects the ones that would bend them.

## 2. What exists today, precisely

### 2.1 The header's controls and the card's band

Verified 2026-11-20 against the tree.

| Element | Where | What it does today |
| :--- | :--- | :--- |
| **Apply updates N** | `PlanningUpdates` in [`PlanningUpdates.tsx#L20-L78`](../../frontend/src/components/PlanningUpdates.tsx#L20-L78) | Lays the page out from data already in hand; never fetches. Disabled with "Save or Restore the open answer first" while an open answer holds changes. Room kept from first paint; invisible at zero |
| **Reload from server** | `PlanningReload`, [`PlanningUpdates.tsx#L89-L129`](../../frontend/src/components/PlanningUpdates.tsx#L89-L129) | Re-reads every listed document's reviews in one batch, then asks the scan store for a rescan ([`usePlanningReviews.ts#L408`](../../frontend/src/hooks/usePlanningReviews.ts#L408)). Does not lay out. Its tooltip says so: "Layout waits for Apply updates" |
| **Unknown pill** | beside Reload, same file | Appears after a failed reload or a changed sample: "Unknown · last successful read HH:MM · last attempt failed HH:MM" |
| **N not attached / N with unresolved ownership** | [`PlanningUnresolved.tsx#L41-L107`](../../frontend/src/components/PlanningUnresolved.tsx#L41-L107) | A link icon whose room is kept even at zero, so it reads "0 not attached"; opens a menu grouping Unassigned, Ambiguous, Removed, Unknown and Compacted comments, each with **Attach to question…**, plus the automatic binds the server refused |
| **Review answers**, **Copy answers N**, **Copy answers + maintenance N** | [`PlanningPendingAnswers.tsx`](../../frontend/src/components/PlanningPendingAnswers.tsx), `PlanningPage.tsx` | Hand the pending answers to the agent. About delivery, not freshness |
| **Card status band** | [`PlanningLifecycleBanner.tsx#L20-L57`](../../frontend/src/components/PlanningLifecycleBanner.tsx#L20-L57) | One fixed-height band: Open, Response saved, Agent replied, Ruling recorded, Compacted, Question removed, or **Unknown** (dashed; tooltip "The document and its reviews cannot be read as one") |

### 2.2 How a card comes to read Unknown, and stays there

The page holds, per document, the reviews it read and the **evidence** they
came with — the content hash of the document as the server saw it when it read
them ([`planning-ownership.md` §2](../reference/planning-ownership.md#2-evidence-which-reading-a-pair-belongs-to)).
A card's label is derived from the live index plus the reviews
(`lifecycleFor`, [`questionOwnership.ts#L412-L439`](../../frontend/src/lib/questionOwnership.ts#L412-L439)),
and it reads _Unknown_ in five distinct situations the band does not tell apart:

1. The reviews are not read yet.
2. The reviews were read against another version of the document — their
   `content_hash` differs from the index's hash for that path, or the server
   sampled a change mid-read (`incoherence`, [`#L195-L207`](../../frontend/src/lib/questionOwnership.ts#L195-L207)).
3. The document is missing from the index.
4. The id is declared twice in the document.
5. The id is written in the text but in no directive.

Situation 2 is the one that held for 8.4 hours. The page re-reads a document's
reviews only when that document's `reviewEpoch` moves
([`usePlanningReviews.ts#L496-L517`](../../frontend/src/hooks/usePlanningReviews.ts#L496-L517)),
and until the fix below only a `review_changed` push moved it. An agent's edit
pushes `files_changed`, which refreshes the index entry — new hash — and leaves
the reviews paired with the old one. Nothing heals that but a review change or a
fresh visit. _Reload from server_ reads the reviews against the file as it is
now; when the page's layout is from an older index (updates held back), the new
reviews disagree with the laid-out hash just as the old ones did.

The tab being hidden for hours makes this the common case, not the edge: on
return after 30 s hidden the socket reconnects by force
([`useWebSocket.ts#L693-L705`](../../frontend/src/hooks/useWebSocket.ts#L693-L705)),
a reconnect rescans the index in full
([`planning-index.md` §8.3](../reference/planning-index.md#83-staying-fresh-change-pushes-reconnects-and-ordering)),
and every document an agent touched meanwhile now has a hash its held reviews do
not carry.

### 2.3 The fix in flight, and what it does not fix

A pushed Markdown document now bumps its own `reviewEpoch`
([`usePlanningStore.ts#L488-L502`](../../frontend/src/stores/usePlanningStore.ts#L488-L502)),
so an edit re-reads that document's reviews. This design takes that as given.
It closes situation 2 for a tab that *receives* the push. It does not change
what the reader sees while the re-read is in flight (still _Unknown_), does not
tell situations 1–5 apart, does not cover a push lost while the socket was down,
and leaves four header controls where one belongs.

## 3. Terms

- **Reading** *(coined here)* — one document version together with the comments
  read against that same version, as one unit. It is what
  [`planning-ownership.md` §2](../reference/planning-ownership.md#2-evidence-which-reading-a-pair-belongs-to)
  calls the evidence of a coherent pair; this doc uses the plain word for it. Not
  the layout: a layout is made *from* readings, and a reading can move on while
  the layout stays ([`planning-index.md` §6.4](../reference/planning-index.md#64-needs-you-as-a-to-do-list)
  defines the layout and its basis). A reading is **coherent** when both halves
  carry the same content hash, and **stale** when the document has moved on
  since its comments were read.
- **Page freshness** *(coined here)* — one state for the whole page, drawn once
  in the header: **current**, **behind**, or **offline** ([§4.1](#41-page-freshness-three-states-one-button)).
  Not a card's status, and not a count: a page can be current with every card
  waiting on the agent.
- **Document condition** *(coined here)* — a fact about a document that stops
  the page from reading it as the checker would: the checker is not installed,
  refused the scan, failed, or the document is over the scan limit; or an id
  is declared twice or written outside a directive. Not a freshness state: a
  document in such a condition is read fine, and stays in it until a person
  changes the document or the server. Distinct from a comment the page cannot
  attach, which is a condition of one comment ([§4.3](#43-comments-without-a-question)).

## 4. The reader's state model

### 4.1 Page freshness: three states, one button

| State | What the reader sees in the header | What they can do | What the system does |
| :--- | :--- | :--- | :--- |
| **Current** | Nothing. The slot the button occupies is empty | Nothing to do | Holds every listed document's reading coherent; reconciles on every trigger in [§4.4](#44-when-the-system-reconciles) |
| **Behind** | **Update · N**, N the changes a new layout would bring; its title lists them by kind, as today's _2 new replies, 1 new question, 1 done_ | Press **Update**. The page lays out with the first item kept where it is, as _Apply updates_ does now | Keeps reading in the background; the count rises and falls live. Nothing lays out on its own ([L2](../reference/planning-index.md#121-the-rules)) |
| **Offline** | **Offline since HH:MM · retrying** in the same slot, with **Retry now**. Appears only when a reconcile has failed for 30 s | Wait, or press Retry now | Retries the failed reads from 1 s doubling to 30 s, indefinitely; the first success returns the page to current or behind, with every held count repaired |

- **Behind is reached only by data already received.** The page never says it
  is behind on suspicion; a change the socket missed is found by a reconcile
  ([§4.4](#44-when-the-system-reconciles)), which then counts it.
- **Update while an answer box holds unsaved changes** keeps today's guard: the
  button is disabled with "Save or Restore the open answer first"
  ([OQ-FS4](#OQ-FS4) asks whether to narrow that).
- **Update ends in the truth.** Pressing it lays out from data in hand at once
  and, in the same press, verifies every listed document's reading against the
  server; the layout does not wait for the verification ([OQ-FS1](#OQ-FS1)).
  Should the verification find anything newer, the page is behind again at
  once, with the new count. That should almost never happen: the server pushes
  every change, so data in hand is behind the server for milliseconds, not
  minutes. The verification is a backstop, and a second **Update** after a
  press means a push was missed — a defect to find, not a routine state.
- **Offline is a page state, never a card's.** Cards keep the last status they
  were read with; counts keep their last values ([OQ-FS3](#OQ-FS3) asks whether
  they should). The page says once, in the header, that what is shown is as of
  HH:MM.

### 4.2 A card's status: the question's state, or the document's condition

The band keeps its fixed height and its position at the card's top. Its
vocabulary:

| Band reads | When | Reader's move |
| :--- | :--- | :--- |
| Open | The id is declared once, the reading is coherent, no pending comment is bound to it | Answer it |
| Answered, waiting for agent | A comment bound to it is pending for the agent | None; wait, or edit the answer |
| Agent replied, question still open | The agent reacted and nothing is pending | Read the reply; answer again if needed |
| Ruling recorded | The directive carries ✅ in the live scan | None; the agent compacts it |
| Compacted | The id is in the ledger's first column and in no directive | None |
| Removed from document | The id is in no directive, no ledger and nowhere in the text of a readable scan | Attach its comments elsewhere, or leave them |
| Not checked — _reason_ | A document condition from the server: _checker not installed_, _scan refused_, _scan failed_, _too large to scan_ | Fix the server or the document; the band names which |
| Id appears N times | The id is declared more than once | The agent fixes the document; it is listed in Maintenance ([§4.5](#45-a-document-condition-is-maintenance)) |
| Id outside a directive | The id is written in the text but in no directive | Same |

Two things are deliberately **not** in the table:

- **Unknown is gone.** Every situation that reads _Unknown_ today
  ([§2.2](#22-how-a-card-comes-to-read-unknown-and-stays-there)) is either a
  transient the system resolves ([§4.6](#46-how-a-transient-is-shown-and-how-long-it-may-last)),
  a document condition with its own words, or — a document missing from the
  index — a layout the page would not have made. A word that means "one of
  five things, and you cannot tell which" is not a status.
- **Nothing about the page's internals.** The band never says the reviews are
  not read, the pair is incoherent, or a batch failed. Those are the page's to
  resolve, and while it does the band shows the last status with the mark in
  [§4.6](#46-how-a-transient-is-shown-and-how-long-it-may-last).

The marks a card already carries in its own line — _New reply_, _Answered
elsewhere_, _Done_, _Newer than shown_ — are kept. They are late data about
that card, drawn in room it has, and they say in plain words what changed.

### 4.3 Comments without a question

A comment the page cannot credit to exactly one question is a fact about **that
comment**, and it is rare: a legacy comment with no id, a comment whose id is
now declared twice, a comment on a removed or compacted question, or an
automatic bind the server refused. It is not a header-level state of the page,
and it is not the reader's fault.

- **Where it lives.** A section group, **Comments without a question (N)**,
  beside the page's other groups, under _Needs you_ when any comment in it is
  pending for the agent and under _Maintenance_ otherwise ([OQ-FS2](#OQ-FS2) asks
  whether a group is the right home). The header control goes.
- **What each entry says.** Plain words for why, one per kind: _no question id
  was recorded_; _its question, OQ-X, is now in the Decision Ledger_; _its
  question, OQ-X, was removed from the document_; _OQ-X appears twice in the
  document_; _the server could not attach it: reason_. Then the quote it was
  filed on and the comment, as the menu shows today.
- **What the reader can do.** **Attach to question…**, as today: the
  document's unique ids with titles, the comment's quote beside the chosen
  question's current text, nothing preselected, bind on Confirm. And **Copy
  requests**, today's _Copy unassigned requests_, for the group as a whole.
- **What the system does.** Attaches automatically whenever the proof is
  unique, on every new coherent reading, as `useLegacyAutoBind` does; a
  refusal is shown on the entry and tried again on the next reading, never
  retried in a loop.
- **Degenerate case.** An empty group is not drawn, and no room is kept for its
  header control, because there is none. A group a layout had keeps its line at
  0 until the next layout, as every group does.

### 4.4 When the system reconciles

**Reconcile** *(coined here)* — reading, for every listed document whose reading
is stale or unread, the document's index entry and its reviews as one, and
adopting the result only if it is not older than what is held
([`planning-ownership.md` §8](../reference/planning-ownership.md#8-apply-updates-reload-from-server-and-selection-anchors)'s
adopt-if-not-older rule). Not a layout: a reconcile changes marks and counts,
never an item's height, position or presence.

The triggers, each precise:

| Trigger | What is reconciled |
| :--- | :--- |
| A `files_changed` push naming a listed Markdown document | That document (the fix in [§2.3](#23-the-fix-in-flight-and-what-it-does-not-fix)) |
| A `review_changed` push naming a listed document | That document |
| The socket reconnects | Every listed document, after the full rescan the reconnect already runs |
| The tab becomes visible after 30 s or more hidden | Every listed document — this is the same threshold the socket uses to force its reconnect, so the two run together |
| The reader presses **Update** | Every listed document, as the verification read |
| The reader presses **Retry now** while offline | The reads that failed |

No timer. A push lost while the socket was up is the one case none of these
covers until the next change to that file; it is bounded by the next
reconnect, visibility change or Update press, and [§8](#8-alternatives-considered)
says why a timer is not worth its cost.

- **Ordering.** Reconciles are per document and idempotent; two for one
  document coalesce into the later one; an answer older than what is held is
  dropped. A `boot_id` other than the held one discards the repository's held
  readings and reconciles everything, as Reload does today.
- **Scope.** Only the listed documents — the ones the page's sections name.
  The page never reads the whole project's reviews.
- **Who writes.** The reviews store alone adopts a reading; the page reads it.
  No card holds a reading of its own.

### 4.5 A document condition is maintenance

An id declared twice, or written outside a directive, is a defect in the
document that only an edit fixes, and the agent is who edits. So it joins the
_Maintenance_ section as a kind of its own, **Duplicate or stray id**, with a
request in _Copy answers + maintenance_ asking the agent to make each id unique
and inside a directive. The checker's own rule, `vantage/oq-id-duplicate`,
already reports it; this makes the planning page say so where the reader is.

The server-side conditions (checker not installed, refused, failed, too large)
are named once in the frame's notices, as the refused state is today, and on
each affected card's band. They are not maintenance: no edit to a document
clears them.

### 4.6 How a transient is shown, and how long it may last

A reading is stale from the moment its document changes until the reconcile
lands — ordinarily a few hundred milliseconds. During that window:

- **A card keeps the status it last read**, and the band adds **· checking** at
  its end, in the room the band has. The mark appears only if the reconcile
  has run longer than 1 s, so an ordinary edit never flashes it.
- **Counts keep their last values.** They are not guesses: they were true of
  the last coherent reading, and the header will say so if the page goes
  offline.
- **The deadline is 30 s.** A reconcile that has failed for 30 s, retrying from
  1 s doubling, moves the page to **offline**; every _checking_ mark clears,
  because the header now carries the whole truth once. The first success
  returns the page to current or behind.
- **Never longer.** There is no state in which a card says _checking_ for
  minutes, and no state in which the page is current while a card's reading is
  stale.

## 5. The reader's situations

Each row says what the reader sees, what if anything they must do, and what
happens by itself.

| Situation | Sees | Must do | By itself |
| :--- | :--- | :--- | :--- |
| **Fresh page** | Frame, then sections in one commit; every card with a status from a coherent reading; header empty of freshness controls | Nothing | Reads each listed document and its reviews as one; a reading not in by the reviews deadline paints the card with its reserved comment count and the _checking_ mark until it lands |
| **An agent edits a listed document** | No movement. The card gains _Newer than shown_ if its text changed; the header reads **Update · N** | Press Update when ready to see the change | Reconciles that document on the push; the card's status follows the new reading within the deadline; nothing lays out |
| **An agent replies to a comment** | The card's _New reply_ mark and gutter bar; its band moves to _Agent replied_; _Needs you_'s count rises by one, in its slot | Read the reply; answer again if the question needs it | Reconciles on the `review_changed` push |
| **Tab hidden for hours, then shown** | The page as it was, then within a second or two **Update · N** with everything that happened; cards whose status changed show it in their bands | Press Update | Socket reconnects, index rescans, every listed document reconciles. No card reads _Unknown_, and no card reads _checking_ for longer than the deadline |
| **Network down** | After 30 s of failed reads: **Offline since HH:MM · retrying**; cards and counts keep their last values; _Copy answers_ still copies what is held | Nothing; Retry now if impatient | Retries with backoff; on success the page is current or behind |
| **Reader mid-answer when something changes** | Their card unchanged — their own answer is never marked _Answered elsewhere_; **Update · N** disabled with "Save or Restore the open answer first" | Finish or restore the answer, then Update | Reconciles underneath; the answer box's text is never replaced |
| **A comment that cannot be tied to a question** | A group **Comments without a question (1)** with the reason in plain words and the quote | Attach to question…, or leave it | Attaches it the moment a reading proves a unique home; a refusal is shown on the entry |
| **A document the server cannot check** | Each of its cards: _Not checked — checker not installed_ (or refused, failed, too large); the frame's notice names it once | Install the checker, or split the document | Reads the document again on every trigger; the condition clears itself when the server can scan |
| **An id declared twice** | _Id appears 2 times_ on both cards; _Maintenance_ lists it under _Duplicate or stray id_ | Hand it to the agent with Copy answers + maintenance | Clears on the next reading after the edit; comments bound to it wait in the group until then and rebind themselves if the fingerprint still matches |

## 6. What happens to today's surface

| Element | Disposition | Reason |
| :--- | :--- | :--- |
| **Apply updates N** | **Renamed** to **Update · N** ([OQ-FS5](#OQ-FS5)), and **gains** a verification read in the same press ([§4.1](#41-page-freshness-three-states-one-button)) | It was already the one reader action the rules allow. "Apply" names the mechanism; the reader wants the page brought up to date, and wants the press to end in the truth |
| **Reload from server** | **Removed** as a control; its work is **made automatic** ([§4.4](#44-when-the-system-reconciles)); its retry survives as **Retry now** inside the offline state | A reader cannot know when the server has something newer, so a button that asks them to guess is the wrong shape. Every trigger that could leave a reading stale is one the system sees |
| **Unknown pill** | **Merged** into the **offline** state | It was the offline state, with a name that said nothing about what to do |
| **N not attached / N with unresolved ownership** | **Moved** out of the header into the **Comments without a question** group ([§4.3](#43-comments-without-a-question)); **renamed**; its reserved room goes with it | A rare, per-comment condition does not earn a permanent header slot that reads "0 not attached" to everyone; it belongs with the other groups, beside the work it is |
| **Review answers** | **Kept**, unchanged | About handing answers to the agent, not freshness; nothing here changes what it lists |
| **Copy answers N**, **Copy answers + maintenance N** | **Kept**; maintenance gains the **Duplicate or stray id** kind ([§4.5](#45-a-document-condition-is-maintenance)) | Same; the new kind gives the duplicate-id condition the agent-shaped exit it lacked |
| **Card status band** | **Kept**; _Unknown_ **removed**, three named conditions and the _checking_ mark **added** ([§4.2](#42-a-cards-status-the-questions-state-or-the-documents-condition), [§4.6](#46-how-a-transient-is-shown-and-how-long-it-may-last)) | The band stays the one place a card's state is read; it stops carrying the page's internals |
| **Card marks** (_New reply_, _Answered elsewhere_, _Done_, _Newer than shown_) | **Kept** | Already plain-worded late data in reserved room |

## 7. What this does not propose

- No change to how a comment binds to a question, to the scanner bridge, or to
  the evidence a reading carries ([`planning-ownership.md`](../reference/planning-ownership.md)
  stands).
- No change to the late-data rules: nothing lays out on its own, not on a
  timer, not on the tab returning, not when a reconcile lands.
- No reply outcome schema; [OQ-AP1](answer-publication.md#OQ-AP1) stays where it is.
- No change to the viewer's review mode, to Copy answers' payload, or to the
  editing-session protocol.
- No whole-project review reads; the scope stays the listed documents.

## 8. Alternatives considered

| Alternative | Verdict |
| :--- | :--- |
| Keep _Reload from server_ and make _Apply updates_ fetch too, so both end in the truth | Rejected: two buttons that both fetch and one of which also lays out is the confusion the owner named, with a fetch added |
| Apply held updates automatically when the tab returns after hours hidden, since the reader was not looking | Rejected: the settled rule says nothing applies held updates on its own, the tab coming back included ([`planning-index.md` §6.4](../reference/planning-index.md#64-needs-you-as-a-to-do-list)). The reader may have left the page scrolled to a card they meant to come back to |
| A periodic reconcile timer (every few minutes) to catch lost pushes | Rejected for now: ~489 planning documents and dozens of pushes an hour means the push path carries the load already; a timer adds reviews reads for a case bounded by the next reconnect or Update. Revisit if a lost push is ever observed to outlive a session |
| Keep _Unknown_ but add its reason to the band | Rejected: five reasons with one word is still five states for the reader to decode, and three of them are the system's to resolve, not the reader's to read |
| Blank every count while offline, as _Unknown_ reads today | Rejected in favor of [OQ-FS3](#OQ-FS3)'s leaning: a last-known value under a header that says "as of HH:MM" is honest; a blank is a fact withheld |
| Reconcile from each card (per-card review reads) | Rejected: one reading per document, one writer; a card never holds a reading of its own |
| Keep the ownership control in the header, hidden at zero | Rejected: hiding it moves painted labels when it appears, which is why its room is kept today; the group has room of its own |
| Show a document condition only in the frame's notice, not on the card | Rejected: the reader reads cards, and a card with no band where its neighbors have one says nothing |

## 9. Risks

| Risk | Mitigation |
| :--- | :--- |
| A verification read on every Update press adds a request the press did not make before | It is one reviews batch, scoped to the listed documents, the same request Reload makes today; [OQ-FS1](#OQ-FS1) keeps the layout itself instant |
| Reconciling every listed document on tab return, on a page listing hundreds of documents | The reconcile reads only documents whose reading is stale or unread, and the reconnect's rescan has already said which hashes moved |
| A reader who relied on _Reload from server_ to "make sure" loses the button | Update's verification read is that reassurance, in the one button they already press |
| The _checking_ mark changes a band's words under the reader | In the band's own fixed room; words change, nothing moves ([L1](../reference/planning-index.md#121-the-rules)) |
| A new Maintenance kind changes _Copy answers + maintenance_'s request text and the checker's `--request` parity | The kind is added to both, as the existing kinds are, and the parity test covers it |

## 10. What done looks like

- A reader who hides the tab for eight hours while agents edit listed documents
  returns to a page whose header reads **Update · N** within two seconds, with
  no card reading _Unknown_ or _checking_ past the deadline.
- The header holds no _Reload from server_, no _Unknown_ pill and no link icon;
  an install with every comment attached shows nothing about ownership anywhere.
- The word _Unknown_ appears on no card. A card on an unscannable document says
  why in words that name the server-side cause.
- Pulling the network for a minute yields one header line, **Offline since
  HH:MM · retrying**, and no other change on the page; restoring it clears the
  line without a press.
- An edit to a listed document under a live socket moves that card's band to
  its new status within the reviews deadline, and the page's count by exactly
  the changes a layout would bring.
- The CLS observer in the stable-paint tests records zero shift from any of the
  above.

## 11. Sequencing, as prose

Reconcile first — it is what makes _Unknown_ unnecessary, and it lands behind
the existing controls without changing what the reader sees. Then the band's
vocabulary, which only becomes honest once reconcile exists. Then the header:
remove Reload and the pill, rename and extend Update. Then the group for
comments without a question and the maintenance kind, which are independent of
the rest and can go in either order.

## Open Questions

1. 💬 **OQ-FS2: Where should the comments no question owns be listed — a group among the page's sections, or a control of their own?**

   A legacy comment on a document has no question id. Today the header's link
   icon reads **1 not attached**, and reads **0 not attached** on every page
   where nothing is wrong. Matt did not know what the icon meant.

   - **A — A section group, _Comments without a question (1)_**, beside the
     other groups, with Attach on each entry; nothing in the header. On a page
     with nothing to attach, nothing is shown anywhere.
   - **B — Keep a header control**, renamed, invisible at zero but keeping its
     room so the header never moves. Matt still has to learn one icon.
   - **C — On the card of the nearest question**, as a note. Rejected before it
     was written: that is a guess at ownership, which the rules forbid.

   <!-- vantage: question id=OQ-FS2 leaning="A (A section group) — a rare per-comment condition belongs with the other work, not in a permanent header slot." -->

   _Leaning:_ A (A section group) — a rare per-comment condition belongs with the other work, not in a permanent header slot.

   **Answer:**
   > _(empty — fill in when decided)_

2. 💬 **OQ-FS3: While the page is offline, should counts and card statuses keep their last values, or go blank?**

   Matt's laptop drops its connection. Today each affected count reads
   _Unknown_ and the header shows a pill with the last good time. The design
   puts one line in the header, **Offline since HH:MM · retrying**.

   - **A — Keep the last values** everywhere under that line. Matt reads the
     page as it was at HH:MM and the header says so once.
   - **B — Blank the counts** and show _checking_ on every band, so nothing on
     the page can be mistaken for current. Matt sees a page full of marks for
     what is one fact.

   <!-- vantage: question id=OQ-FS3 leaning="A (Keep the last values) — a last-known value under a line that dates it is honest; blanks say the same thing fifty times." -->

   _Leaning:_ A (Keep the last values) — a last-known value under a line that dates it is honest; blanks say the same thing fifty times.

   **Answer:**
   > _(empty — fill in when decided)_

3. 💬 **OQ-FS4: While an answer box holds unsaved text, should Update be refused outright, or apply everywhere but that card?**

   Matt is typing an answer on one card when **Update · 12** appears. Today the
   button is disabled with "Save or Restore the open answer first", so the
   twelve changes wait until he finishes.

   - **A — Keep the refusal.** Matt finishes or restores, then presses. Simple,
     and the card he is typing in never moves under him.
   - **B — Apply around the open card.** Everything else lays out; his card
     keeps its place and height. Twelve changes land while he is typing, and
     the card above his may grow, which pushes his box down the screen.

   <!-- vantage: question id=OQ-FS4 leaning="A (Keep the refusal) — a layout that moves the box someone is typing in is the one thing the late-data rule exists to prevent." -->

   _Leaning:_ A (Keep the refusal) — a layout that moves the box someone is typing in is the one thing the late-data rule exists to prevent.

   **Answer:**
   > _(empty — fill in when decided)_

4. 💬 🤷 **OQ-FS5: What should the one button be called?**

   The header's one freshness control, today **Apply updates 7**. Its title
   lists the changes by kind. The name is read dozens of times a day and is
   the only word about freshness most readers ever see.

   - **A — Update · 7.** One verb, what the reader wants done.
   - **B — Show 7 changes.** Says what appears, not what the page does.
   - **C — Keep Apply updates 7.** Already known to the people using it.

   <!-- vantage: question id=OQ-FS5 leaning="A (Update · 7) — pure preference; the shortest word that is a verb and is not refresh." -->

   _Leaning:_ A (Update · 7) — pure preference; the shortest word that is a verb and is not refresh.

   **Answer:**
   > _(empty — fill in when decided)_

## Decision Ledger

| ID | Ruling / Decision | Date | Settled in |
| :--- | :--- | :--- | :--- |
| OQ-FS1 | A — Update lays out at once and verifies afterwards. Pushes keep held data within milliseconds of the server, so a second Update after the verification signals a missed push to be fixed, not a routine state | 2026-11-20 | [§4.1](#41-page-freshness-three-states-one-button) |
