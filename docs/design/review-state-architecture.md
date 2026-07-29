# Where Review State Lives — and Why It Keeps Biting Us

> Status: **implemented** · 2026-07-19 (proposed and shipped the same day;
> amended the same day — see §11; further amended 2026-07-20 — see §12)
>
> Landed as `59c95eaa` (command endpoints, review_changed push, response
> inbox), `b417e787` (frontend commands, paste box, inbox payload), `b732ff6a`
> (changelog protocol retired, machinery deleted, stale-payload warning), and
> `7e1c0bd6` (two silent-swallow defects found by attacking the result). §10's
> "do not build it now" recommendation was overtaken by the decision to build
> it; the reasoning below stands as the record of why.
>
> **§1–§5 describe the architecture as it was before that work** — they are the
> diagnosis, kept in their original present tense. §6 onward is what now
> exists.
>
> Prompted by a one-line bug report — "replying to a comment doesn't relight the
> Copy button" — that turned into nine commits, three adversarial review passes,
> and repeated rediscoveries of the same failure. This document argues that the
> failure was not incidental: the review feature keeps two kinds of state in the
> wrong place, and every rabbit hole was forced compensation for that placement.
> It ends with a proposal whose deletion list is longer than its addition list.
>
> This doc was itself adversarially fact-checked against the code; corrections
> from that pass are incorporated, and §6 owes its push-channel section to it.

## 1. Verdict up front

The hunch is right. Two architectural choices generate all of the hard bugs:

1. **The document is used as a message channel, but messages are never
   consumed.** The agent "sends" its response by writing a `<!-- changelog -->`
   block into the reviewed document. The block then lives in the document
   forever and is re-presented to the server on every subsequent save. The
   server must therefore *remember what it has already read* and infer
   new-versus-replay from content — and content is not identity. Every dedup
   heuristic we stacked (summary matching, round windows, `EditedAt` clauses,
   fingerprints, block counting) is an attempt to reconstruct message identity
   from message content, which is impossible in general. We eventually hit the
   floor of that impossibility: a byte-identical rewrite of the block is
   *provably* indistinguishable from no write at all.

2. **Two writers replace the whole state.** The browser PUTs the entire review
   (every comment, every reaction) on every edit, while the file watcher does a
   read-modify-write to append agent reactions to the same file. Full-state
   replacement from two writers is the textbook lost-update setup. The
   compensation — per-file locks, a server-side merge, a PUT echo the client
   conditionally adopts, two monotonic sequence counters with per-call
   snapshots — is all machinery that a command-based write model simply would
   not need.

A third, smaller misplacement made the first two more dangerous: **semantic
state ("whose turn is it?") is inferred from the order of a mutable array**
rather than recorded as a fact, which makes reaction *ordering* load-bearing —
dangerous in a system where the two writers stamp timestamps from two different
clocks (server whole-seconds, browser floats).

None of this means the code is wrong *today*. The current implementation is,
to the best of three adversarial review passes, correct — but it is correct the
expensive way: by remembering things about things, guarded by tests that exist
only to pin the compensation in place.

## 2. What the review feature actually is

Underneath the UI, this feature is a **threaded conversation between two
parties, attached to spans of a Markdown document, with turn-tracking**:

- The **reviewer** (browser) opens threads (comments), replies, accepts,
  dismisses, edits, deletes.
- The **agent** (an external process that edits files) answers threads.
- The system tracks *whose turn it is* per thread — that single bit drives the
  Copy buttons, the filter tabs, the minimap, and the clipboard payload.

Where that state lives today:

| State | Lives in | Written by |
|---|---|---|
| Threads + reactions + resolved flags | One JSON file per document (`internal/review/store.go`) | Both writers: the browser PUTs the full review (the server merges agent-owned turns back in); the watcher read-modify-writes |
| The agent's responses (messages) | **The reviewed document itself**, as persistent `<!-- changelog -->` blocks | Agent |
| "Which responses have I already recorded" | `ReviewData.AppliedChangelog` (a `"<blockCount>:<digest>"` marker) plus round-scoped dedup heuristics (`internal/review/changelog.go`) | Server |
| Whose turn it is | *Derived* — from the identity and order of the last reaction (`isPendingForAgent`, `frontend/src/stores/useReviewStore.ts`) | Nobody; recomputed |
| Before/after capture for a response | An in-memory previous-content cache, lost on restart | Server |
| The browser's working copy | Zustand store, PUT back wholesale on every action | Browser |
| `ReviewData.Snapshots` | A dead field: nothing writes it anymore, but legacy files carrying it still gate review-mode auto-enable | Nobody |

## 3. The incident record: one failure, seven doors

The user-visible failure is always the same: **the reviewer's follow-up is
silently marked answered, or an agent's real answer is silently dropped — the
thread dies with each side believing the other owes a reply.** We found seven
distinct paths to it. Five shipped; two were written, caught by adversarial
review before commit, and never shipped — which is worth recording, because
they are exactly the traps the next implementer will walk toward.

| # | Door | Root cause | Outcome |
|---|---|---|---|
| 1 | Toolbar re-derived "pending" as *any* agent reaction exists, so a reply never relit Copy (the original report) | Derived truth duplicated per-surface | Shipped; fixed in `294669cf` |
| 2 | Whole-history dedup dropped a genuine round-2 answer whose summary repeated round 1 verbatim | Content-as-identity | Shipped; fixed in `b38f585f` |
| 3 | The round-scoped dedup then *re-applied* the persistent block on every later file save, stamping the stale answer on top of the follow-up | Channel never consumed | Shipped in `b38f585f`; fixed in `30ebe5c3` (the `AppliedChangelog` fingerprint) |
| 4 | That fingerprint hashed only the live block's bullets, so a *fresh appended round* with verbatim-identical bullets hashed the same — door 2's failure, resurrected one layer up | Content-as-identity | Shipped in `30ebe5c3`; fixed in `506ef9df` (digest paired with a block count) |
| 5 | An *in-place edit* to the live block (adding a bullet for comment B) replayed comment A's already-applied bullet | Content-as-identity | Shipped in `506ef9df`; fixed in `760c38a3` (round-scoping only when the count rose) |
| 6 | A *whole-document* fingerprint — the first attempt at fixing #3's format — made pruning or rewording an *earlier* block (routine agent housekeeping) re-fire the live one | Content-as-identity | Never shipped; caught by the adversarial pass pre-commit |
| 7 | The PUT-merge's obvious implementation — sort reactions by timestamp — could reorder a reply *behind* the answer it responds to, across two clocks | Order-as-semantics + two-writer merge | Never shipped; caught pre-commit, `30ebe5c3` landed with a positional splice instead |

And the residue that cannot be closed: an agent that rewrites its changelog
block with byte-identical text has produced a document identical to the one
before — there is no evidence to detect. We handle it today with instructions
in the clipboard payload ("do not write a no-op entry"; 6/6 agents complied in
an empirical test), which is to say: we handle it by asking nicely.

Doors 2–6 are one lesson learned five times. Each fix was locally correct;
each moved the inference problem to a new spot, because the problem is not in
any of those spots. It is in asking the question "*is this content new?*" at
all.

## 4. Diagnosis

### 4.1 The document is a whiteboard being used as a mailbox

A message channel needs delivery semantics: a message arrives once, is
consumed, and is gone. The document gives the opposite — persistence. The
changelog block is a message that *re-arrives on every save forever*, so the
receiver must carry a memory of everything it has ever received and compare
incoming content against it.

That memory is `AppliedChangelog` plus the dedup window in
`hasAddressedReaction` — state *about* state. It is where the whack-a-mole
lives, and its failure modes are exactly the ways content can change without
meaning changing (prose edits, block pruning, in-place bullet addition) or
meaning can change without content changing (verbatim repeat rounds).

The rule this violates: **messages need identity, and identity must travel
with the message.** When it does, dedup is a lookup. When it must be inferred
from content, dedup is the nine-commit chase in §3.

### 4.2 Full-state replacement from two writers

`saveReview` PUTs `{file_path, snapshots, comments}` — the entire review — on
every reviewer action. Meanwhile `ApplyChangelog` read-modify-writes the same
file from the watcher goroutine. The compensation stack, in the order we were
forced to build it:

1. Per-file mutexes, held across whole read-modify-writes (then sharded to a
   fixed table because the map was unbounded and keyed by client input).
2. `SaveFromClient`: a server-side merge that re-splices agent reactions a
   stale client copy is missing (~130 lines of `store.go`, including a
   positional splice specifically because timestamp order cannot be trusted
   across clocks).
3. A PUT *echo* — the server returns what it actually persisted — plus client
   adoption guarded by two sequence counters (`saveSeq`, `loadSeq`) with
   per-call snapshots and a file-path check, plus explicit invalidation in
   `endReview`/`deleteReview` so a slow echo cannot resurrect a deleted review.

Note what the merge *still* does not solve: two browsers on the same document
can eat each other's **reviewer** turns, because the merge deliberately only
restores *agent* reactions ("reviewer turns are the client's to own" — which is
only safe when there is exactly one client). Full-state writes have no good
answer here; operations do, for free.

### 4.3 Order as semantics

`isPendingForAgent` answers "whose turn is it" by inspecting the *last* element
of the reactions array (after skipping trailing acceptances). That makes array
order — an artifact of append sequence, merge behavior, and two unsynchronized
clocks — carry the feature's central bit of meaning. It is why the merge had to
splice positionally rather than sort (door 7), and why a clock-skewed browser
could otherwise silently mark its own reply as answered.

Deriving state from an append-only, single-writer log is fine (that is event
sourcing). Deriving it from a mutable array assembled by a merge of two
writers is how door 7 nearly shipped.

### 4.4 The counter-example that proves the rule

The most instructive fix of the saga was centralizing the turn-state
predicates (`isPendingForAgent` and friends) and deleting the four divergent
per-surface copies. The rule itself needed correcting twice more afterwards
(`df756f40`: declined answers, acceptance re-dating) — but each correction was
one edit in one place, reviewed once, and **no per-surface divergence bug ever
recurred**. Compare the other lineage: every fix that *added memory about
memory* (fingerprints, dedup windows, merges, echoes) spawned at least one
further confirmed defect before the stack stabilized.

That asymmetry is the practical test: a fix that deletes a second copy of
truth converges; a fix that adds bookkeeping about what you have already seen
recurses.

## 5. What the compensation costs today

Rough inventory of code that exists *only* because of the placements above:

- `internal/review/changelog.go` — the `AppliedChangelog` marker, the
  `changelogState` type and its parse/format, the legacy-upgrade fallback, and
  the append-vs-edit dedup scoping: ~22 references across the apply path; the
  guard block alone is ~40 lines of the most carefully-commented code in the
  repo, because none of it is obvious.
- `internal/review/store.go` — `SaveFromClient`, `mergeAgentReactions`,
  `spliceMissingAgentTurns`, `reactionKey`: ~130 lines.
- `frontend/src/stores/useReviewStore.ts` — the `loadSeq`/`saveSeq` counters,
  their per-call snapshots, the echo-adoption guards, staleness checks, and
  invalidation bumps: ~15 sites.
- 1,749 lines of Go tests in `changelog_test.go` + `store_test.go`, the
  majority pinning dedup/merge/marker behavior — mutation-verified, i.e.
  written twice.
- A "Do not write a no-op entry" section in every clipboard payload, shipped
  because the remaining case is undecidable server-side.

All of it correct. None of it about the product. Every line is the system
remembering what it has seen, so it can guess what a change *means*.

## 6. The right shape: commands in, state out, delivery is an event

One principle covers all three misplacements: **record facts at the moment
they happen, where they happen, exactly once — and make every write an
operation, not a snapshot.**

Concretely: the server becomes the single owner of review state. Both parties
— reviewer and agent — send it *commands*. Nobody writes the state wholesale;
nobody communicates by mutating a persistent artifact that gets re-read.

### 6.1 Reviewer writes become commands

Replace the PUT-everything endpoint with small operations, path-scoped like
every existing review route (`?path=`, and under `/api/r/{repo}/` in
multi-repo mode):

```
POST   /api/review/comments                     create (anchor, text)
PATCH  /api/review/comments/{id}                edit text / resolve / reopen
POST   /api/review/comments/{id}/replies        reviewer follow-up
POST   /api/review/comments/{id}/accept         reviewer acceptance
POST   /api/review/comments/{id}/reopen-reply   reopen + follow-up, atomically
POST   /api/review/dismissals                   bulk dismiss (all / outdated)
DELETE /api/review/comments/{id}                delete
```

Each handler mutates under the (now trivial) per-file lock and returns the
updated review. Bulk actions are single commands, not N PATCHes, so no
half-applied state is representable.

**The push channel this requires.** Today an agent response reaches the
browser only because the agent *edits the document*, which trips the file
watcher, which broadcasts, which triggers a review reload. Sever the
response-to-document coupling and that path goes with it — an API-delivered
response would sit invisible until a manual refresh, recreating the original
bug by another route. So the proposal includes a server-initiated websocket
message (`review_changed`, carrying repo + path), broadcast from every command
and delivery handler, with the frontend reloading review state on receipt.
This is not incidental plumbing; it is the delivery leg of the new channel.

**What survives on the client.** The browser stays a cache of server state,
which means one guard survives on principle: *discard any response — GET or
command echo — that started before my latest local write or delete.* That is
`saveSeq` under an honest name, reduced from merge-adoption machinery to
standard fetch-race hygiene, and it must survive every migration phase (the
watcher keeps firing reloads for as long as agents keep editing documents).

What this deletes: `SaveFromClient` and both splice/merge helpers, the PUT
echo and its conditional-adoption logic, and the whole-state write itself. Two
browsers on one document stop losing each other's turns: appends never erase
each other, and concurrent edits of the same text degrade to last-wins — a
visible outcome, unlike today's silent erasure of the other client's replies.

### 6.2 Agent responses become deliveries

This revisits a recorded decision, and should say so. The original design
([review-mode.md](review-mode.md), open question 4) chose "changelog block
only — no REST endpoint, ever," on the grounds that the agent's contract is
editing Markdown and a second channel was out of scope — while presciently
warning that this made the changelog grammar load-bearing. That was a
reasonable call made *before the parser existed*, when the dedup tax was
invisible; §3–§5 of this document are what the single-channel simplicity
turned out to cost. The 2026-07-19 review reaffirmed the original constraint
on the *medium* — no direct agent-to-server comms, no CLI; agents transfer by
copy/paste and file writes — so the change here is deliberately minimal: the
agent still responds by writing a file. What changes is *which* file — one
that exists to be consumed, instead of the reviewed document, which exists to
be kept.

The agent stops writing responses into the reviewed document. It *delivers*
them, once, through one of two doors — both events, not regions of a
persistent artifact:

1. **Inbox file** (primary): the clipboard payload instructs the agent to
   append one JSON line — comment short-id, summary, nonce — to
   `.vantage/inbox/<flattened-doc-path>.jsonl` (same path-flattening scheme as
   the review store). The watcher — taught to watch this directory explicitly;
   today it drops non-Markdown paths — consumes it: rename, parse whole
   newline-terminated lines (a partial final line waits for the next pass),
   persist the reactions atomically into the review, *then* delete. Crash
   between persist and delete re-consumes rather than loses, making the inbox
   at-least-once — which is precisely why inbox lines carry nonces (below).
   `.vantage/` joins the default ignore set for both git and the file tree.
2. **Paste into the panel** (for tool-less chat models): the reviewer pastes
   the model's response block into a box in the Review panel, which records it
   through the server. The paste grammar is the *existing* bullet format —
   which means `parseChangelog`/`parseBullet`/`resolveCommentID` survive as
   the paste parser. What retires is the format's role as a *document-embedded
   protocol*, not the parser. A double-paste is deduped by deriving the nonce
   from the pasted content — a deliberate, contained re-admission of
   content-as-identity, acceptable because this door is human-mediated.

There is deliberately no third door. An agent-facing REST endpoint or CLI
verb was considered and rejected in review: it would teach agents a second
transfer medium when file writes already suffice, and it reopens exactly the
scope the original design refused.

**Nonces, specified honestly.** Every delivery carries a nonce — written into
its inbox line by the agent, or derived from the pasted content for the paste
door. The server stores seen nonces *inside `ReviewData`*, written in the
same atomic save as the reactions they guard (an in-memory set would die on
restart — the exact flaw this doc criticizes in the prev-content cache), and
capped (last N per review) so client-supplied input cannot grow server state
unboundedly — the exact flaw the lock table had. A crash between apply and
record is impossible because they are one write.

What nonces buy is **transport idempotency**: a retried or replayed *delivery*
is a lookup, not a fingerprint investigation. What they do not buy is
protection against an agent that *writes a fresh line for the same answer*
(crashed harness re-running its scrollback): that carries a new nonce and
lands a duplicate reaction. This is the residual of the new design, replacing the
byte-identical-rewrite residual of the old one — and it is the better failure
class by construction: a **visible duplicate** the reviewer can see and
dismiss, instead of a silently swallowed answer or a silently answered
follow-up. Failures should be inspectable; the old ones were not.

### 6.3 Capture "before" at the honest moment

Today's before/after capture depends on an in-memory previous-content cache
that is lost on restart. Under the command model, capture `before_text` when
the fact becomes true: snapshot the anchored block's text at the moment a
comment is created or replied to — the text the reviewer was actually looking
at — and `after_text` at delivery time from the file on disk.

Two trades, stated rather than hidden: when one agent pass edits a block
shared by two comments, the second comment's "before" is older than today's
flush-time capture (it shows what the reviewer saw, not what the agent last
left — arguably more honest, but different); and an agent that responds
*before* saving its edit captures a stale "after" — the payload instructs
"save the file, then respond," and the paste door skips after-capture
entirely when the reviewer hasn't applied the edits yet. Comments created
before the migration carry no captured "before"; their first post-migration
responses will have empty befores.

## 7. What this deletes, keeps, and costs

**Deleted:** the whole-state PUT and `SaveFromClient`/merge/splice/
`reactionKey`; the PUT echo and its adoption guards; the `AppliedChangelog`
marker, `changelogState`, the legacy-upgrade pass, and the append-vs-edit
dedup scoping — *together with* the changelog-as-protocol (they are
inseparable: a compatibility-mode parser without the dedup apparatus replays
blocks on every save, door 3); the dead `Snapshots` plumbing (`addSnapshot`
already has zero callers; the field survives only in legacy files, whose
auto-enable gate moves to a server-side check); the "no-op entry"
instructions; and the large majority of the 1,749 dedup/merge-pinning test
lines.

**Kept:** the per-file lock (trivial, still correct); the anchor/drift system
(`reviewanchor` — orthogonal and genuinely hard, unaffected either way); the
centralized turn-state predicates; the websocket infrastructure, *gaining* the
`review_changed` push; a client-side "discard responses older than my latest
local write" guard (fetch-race hygiene, not merge machinery); the bullet
parser, demoted from protocol to paste-box input format.

**Costs, honestly:**

- **Durability, mostly preserved.** The doc-block channel was
  zero-infrastructure at-least-once delivery — it survived server crashes and
  arbitrary downtime, re-offered on every save, and the entire dedup tax of
  §5 was the *price* of that property. With the inbox as the primary door the
  class is kept: lines buffer through downtime and survive crashes
  (consumption is rename → persist → delete), now deduped by nonce instead of
  by inference. What is lost is only the re-offered-forever behavior — which
  was the disease.
- **The transcript stays machine-local — decided, and preferred**
  (2026-07-19 review). Changelog blocks used to ride along in git; the review
  JSON does not travel, and reviewed documents stay free of review litter. No
  export command joins the addition list.
- **Reviewer commands need surfaced failure.** Today's PUT is self-healing —
  any later successful PUT retransmits everything, so a failed one costs
  nothing durable. A failed command is that operation lost, so failures must
  be surfaced (re-enable the button, show a toast) or queued; that is part of
  the addition list, not an afterthought.
- "Any agent that can edit a file can respond" survives intact: responding is
  still one file write — an inbox line instead of a document edit. Tool-less
  chat models are covered by the paste box.
- Static exports are unaffected: review is already inert there (no review
  data is exported; the static interceptor strips writes), though hiding the
  Review toggle in static builds would be honest — independent of this
  proposal.
- **Net size, claimed carefully:** product code is roughly break-even — five
  thin handlers, a push message, an inbox consumer, and a paste box against
  the deletions above. The decisive win is elsewhere: the ~1,750
  test lines pinning inference behavior mostly go, and the lines that replace
  the deleted ones are boring CRUD where the deleted ones were the most
  carefully-commented inference code in the repo. Boring is the point.

## 8. Migration sketch

1. **Add the command endpoints and the `review_changed` push** beside the
   existing PUT (thin handlers over the existing store; each atomic under the
   current lock).
2. **Switch the frontend actions** from `saveReview`-the-world to commands;
   delete the merge/echo machinery and its tests. The write-race guard stays
   (agents are still editing documents, so watcher-triggered reloads still
   race local writes). The store's public action surface (`addComment`,
   `replyToComment`, …) does not change, so no component changes.
3. **Add the nonce-deduped inbox consumer and the panel paste box** (the
   paste box records through an internal endpoint — internal to the browser,
   not agent-facing). Update the clipboard payload to instruct the inbox
   write ("save the document, then append your response line") instead of
   doc-editing.
4. **Retire the changelog protocol in the same change — parser-as-protocol
   and dedup apparatus together, never separately.** No compatibility release
   (decided 2026-07-19: no external users, no frozen protocol). Keep one
   cheap permanent safety net: the watcher warns loudly (log + UI notice)
   when a document arrives carrying a changelog block, because clipboard
   payloads are long-lived — they sit in agents' chat contexts — and a stale
   payload driving the retired protocol would otherwise reproduce this doc's
   headline failure, silently.

Each phase lands independently green, provided the write-race guard survives
through phase 2 and the parser/dedup pair is treated as one unit in phase 4.

## 9. How to smell this earlier

Three signals, each of which appeared here well before the bug report:

1. **You are building memory of what you have already seen** — fingerprints,
   seen-sets, dedup keys over content. That means your channel is a whiteboard,
   not a mailbox. Give messages identity, or give the channel consumption.
2. **You are writing merge code for full-state writes.** That means two
   writers share one truth. Pick a single owner and send it operations.
3. **Correctness depends on the order of a mutable collection** — especially
   across a network or clock boundary. That means semantic state is being
   inferred from incidental structure. Record the fact itself, or derive it
   from an append-only, single-writer log.

The through-line of all three: every rabbit hole in this saga came from
**reconstructing a fact after the fact** — was this answered? is this new?
whose turn is it? — from artifacts that were never records of that fact. State
kept where the fact happens, written by the party to whom it happens, at the
moment it happens, needs no reconstruction. The best fix of the whole saga
(predicate centralization) followed that rule and converged; the nine-commit
chase is what careful compensation for its violation looks like. And one
design consequence worth carrying forward even if nothing else here is
adopted: **prefer failure modes that are visible** — the new design's residual
is a duplicate a human can see and dismiss; the old design's residuals were
silent in both directions, which is why the first report arrived as a UI
mystery ("the button won't light up") rather than as what it actually was: a
conversation system losing turns.

## 10. Decisions, and what shipping taught us

The original recommendation was "adopt the direction, but do not build it
now." That was overtaken: the rework was built immediately after the
decisions below were made. What shipped follows §6–§8 with one addition the
plan missed and two defects worth recording.

**The addition:** §6.1's push channel turned out to be load-bearing in a way
the first draft understated. Severing the response-from-document coupling
also severs the *only* path by which an agent's answer reached the browser,
because the websocket fired solely on document file changes. Every command
and delivery now broadcasts `review_changed`.

**The two defects**, both found by attacking the landed implementation, and
both the same failure this rework exists to eliminate wearing new clothes:

1. The paste box reported success whenever the request did not throw. Bullets
   naming comments the open document lacks parse fine and apply nothing, so a
   block pasted into the wrong panel got a green "Applied". The endpoint now
   returns the applied count. *Lesson: "no error" is not "it worked" — a
   delivery channel must report what it delivered.*
2. The stale-protocol warning fired on any document containing a changelog
   marker, unreviewed and unfenced, so serving this very repository nagged on
   every save of the design docs that quote the retired format. It was made
   fence-aware and gated on the document being under review — and then, later,
   deleted outright. See §10.1. *Lesson: a warning that cries wolf on
   documentation gets trained away.*

### 10.1 Two unfalsifiable signals, and the one that replaced them

The compensations above narrowed *when* the warning fired without fixing what it
claimed, and the claim was the defect. "The agent responded using the retired
changelog protocol — nothing was recorded" asserts a lost turn, but the evidence
was only that a saved document contained a marker — a fact that reads identically
whether the response vanished or arrived through the inbox moments later. Field
evidence: a reviewed document was saved eleven times over six minutes while an
agent worked in it, producing eleven identical warnings, and thirty seconds after
the last one the agent delivered normally (`applied=2`, inbox file consumed).
Every warning was wrong, and the banner stayed up through the successful delivery
because only a manual dismiss cleared it.

A transition-based variant — warn only when the marker set *grows* — was
considered and rejected: it would have been a quieter version of the same
unfalsifiable claim, since a marker appearing still does not mean a response was
lost. The detection is gone instead: no marker scan, no `changelog_ignored` push,
nothing server-side that looks at document text for protocol residue. A document
carrying a changelog block is ordinary prose.

The first replacement inverted the polarity — from accusation to observation, "an
agent is working here" rather than "it failed" — deriving that from two facts on
the wire: the open document appeared in `files_changed`, and a comment was still
unanswered. It survived one review and was cut, because it repeated the original
mistake pointed the other way. `files_changed` reports that a path changed and
never why, so an agent answering, an agent doing unrelated work in a reviewed
document, a formatter, a `git checkout`, and the reviewer's own editor all arrive
identically. Gating on a prior clipboard handoff and expiring the claim after
five minutes were both drafted; both only narrowed the window and shortened the
lie. "An agent is working" is a claim about an intention, and no signal available
to the browser carries one.

What ships instead answers a different question — one the stored data can settle:
**has the document changed under a comment still awaiting a response?** Every
comment's anchor carries `block_text_hash`, the hash of the block as the reviewer
saw it when commenting, and `useReviewHighlights` already resolves that against
the rendered document on every content change to decide how to draw each comment.
Three outcomes fall out of work already being done: the text matches (at the
recorded line, or a few lines away via the neighbor walk — a block that only
*moved* still says what the comment is about), the block was rewritten in place,
or the block is gone. The latter two are drift, and if any of them lands under a
comment that is still pending, the review header shows one bit: *document
changed*.

That bit is falsifiable in both directions. Byte-identical blocks mean a definite
*no* — edits that miss every commented block correctly say nothing, because the
comments' context is genuinely still valid. It needs no timers, no TTL, and no
handoff tracking: it is a function of content, so it clears itself when the text
is restored, when a reply re-captures the block (§4), or when the agent answers
and the comment stops being pending. And it is deliberately one bit, not a count.
The reviewer's response to it is "re-read the document before handing these over",
which is a whole-document action; knowing it was two of five comments would not
change it. The per-comment truth already lives where it *does* change something —
the drifted block renders faint, and an orphaned comment renders detached, quoting
the text it was written against.

*Lesson, and the one worth carrying past this feature: a signal must be able to
distinguish the case it names from its opposite.* Both failed versions named
something unobservable — a lost turn, then an intention — and each fired on
evidence equally consistent with the opposite. The fix was not a better heuristic
but a better question: ask something the stored data can answer, and let the
reviewer draw the conclusion. This is §9's "prefer failure modes that are
visible" with a corollary: visible, and not lying about which failure it is.

The decisions that shaped the build (2026-07-19 review — conducted, fittingly,
through the changelog protocol this work retires):

1. **Delivery doors: inbox + paste only.** No agent-facing API or CLI, ever —
   copy/paste and file writes are the transfer mediums. This reaffirms the
   original design's constraint on medium (§6.2) rather than reversing it.
2. **Fast retirement.** No transition release: the changelog protocol and its
   dedup apparatus go in one change, leaving only the stale-payload warning.
   (That warning has since been removed too — §10.1 — so retirement is total:
   nothing in the codebase reads the marker.)
3. **History is machine-local, by preference.** No export command; reviewed
   documents stay free of review litter in git.

(The first draft also asked how this ranks against the Go-port roadmap — a
stale premise, since the port completed long ago. Question withdrawn.)

<!-- changelog -->
- [e8aca84a] Dropped the API/CLI door entirely — delivery is inbox file (primary) + paste only, keeping agent transfer to file writes and copy/paste.
- [0a1e8813] Phase 4 now retires the changelog protocol in one change, no compatibility release; only the stale-payload warning stays.
- [249ed210] Recorded machine-local history as the decision and removed the export-command contingency.
- [8febbe4a] Removed the Go-port priority question — stale premise, the port is long complete.

---

## 11. Follow-up: two facts that were still sharing one slot

_Added 2026-07-19, after the above shipped._

The rework moved reviewer writes to commands and agent writes to the inbox, and
the defects it was built to kill stayed dead. But three user-visible bugs
surfaced afterwards, and they turned out to be one bug wearing three hats — the
same failure mode as §1, one level up.

The architecture separated **who writes what**. It did not separate **what is a
turn from what is a flag**, or **turn state from anchor state**:

1. **Dismissing wrote a conversation turn.** The inline and sidebar "Dismiss"
   buttons on an *answered* comment called `resolveComment`, which POSTed to
   `/accept` and appended a reviewer `noted` reaction rendered as "You
   accepted". Reopening did not retract it, so dismiss → reopen → dismiss left
   two acceptances in a thread the reviewer had never spoken in. Two different
   buttons carried the same label, "Dismiss", and only one of them meant it.
2. **The status badge lived in the wrong renderer.** `Addressed` was emitted
   only by `createOutdatedBlock`, so a comment the agent had answered showed a
   status **only if its anchor had also been lost**. Two comments in identical
   conversation states rendered differently based on a fact about text
   matching.
3. **The bulk dismiss grouped by anchor state.** "Dismiss N outdated" swept
   comments whose anchor no longer resolved. Because an agent answers by
   rewriting the paragraph you commented on — movement *and* edit, which breaks
   the hash — answered comments become orphaned comments in the normal case.
   The button therefore *looked* like "dismiss the answered ones" while being
   documented as something else entirely.

Each was individually small. Together they taught a wrong model: that
"outdated" means "handled". A reviewer who learned that from the badge then
read the button through it, and was right about the effect for the wrong
reason.

**The fix is the same shape as the original one — put each fact in one place:**

- **Dismissal is a flag, not a turn.** The `accept` command, its endpoint, and
  `resolveComment` are gone; one `Dismiss` button, one action, no reaction
  written. Legacy `noted` reactions still on disk are skipped everywhere they
  are read (predicates, both thread renderers, the agent payload) rather than
  migrated — they must not reach the agent labelled "Follow-up", which would
  put a question in the reviewer's mouth.
- **`isPendingForAgent` shed its acceptance handling.** The `acceptedAt`
  re-dating is gone entirely; the trailing-turn skip survives only as legacy
  data handling. One behavior change falls out: reopening an answered comment
  that was edited *after* the answer now re-queues it, where the acceptance
  used to suppress that. That is correct — the agent has not seen the current
  wording.
- **Turn state and anchor state are rendered separately.** A shared
  `statusBadgeHtml` reports turn state (`Addressed` / `Declined` / `Dismissed`,
  nothing while pending) on *every* inline renderer. Anchor state is expressed
  by placement plus a locator line — "was near line N · original text no longer
  found" — and never by a status word.
- **The bulk action groups by turn state**: `Dismiss Answered (N)`, built on
  the existing `isAnsweredByAgent` predicate.
- **The detached quote is no longer struck through.** `fallback_text` is the
  record of what the reviewer chose to comment on, not deleted content — and in
  the common case that text is still in the document, just past where the
  anchor could follow it. Striking it read as retracted.

Two smaller things were fixed alongside, in the same pass:

- **Duplicate deliveries.** `ApplyResponses` deduped by nonce only, so an agent
  that re-ran its delivery step wrote fresh nonces and recorded the same answer
  again. It now also treats an entry as a redelivery when the comment already
  carries an agent reaction with the same round *and* summary — a distinction
  that was impossible under the in-document protocol and is available only
  because deliveries now carry `round` explicitly (§7).
- **The paste box is gone.** `POST /review/responses`, the bullet grammar, and
  the panel UI are deleted; the inbox is the only delivery door. The decision
  above ("inbox + paste only") kept paste as the door for tool-less chat
  models; in practice every agent writes files, and a second door meant a
  second dedup story (content-hashed nonces) for no realized benefit.

**The lesson worth carrying:** §1's diagnosis was "the same fact is derived in
two places." This follow-up is its sibling — "two different facts are presented
in one place." Both produce the same symptom: reasoning that seems to work,
until the two things drift apart and the UI starts asserting something nobody
decided.

---

## 12. Follow-up: the inbox was guessing when the writer was done

_Added 2026-07-20._

The inbox fixed the channel — messages are consumed once and gone (§6.2). But
its *completion signal* was inferred, not stated, and that reopened the same
class of silent loss the whole rework exists to kill, now on the delivery leg.

The contract was "append one JSON line per comment to a shared per-document
`.jsonl` file." The consumer decided a file was ready to claim, apply, and
**delete** by asking `hasCompleteLine` — *does it end in a newline?* That is the
tell: a trailing newline means a *line* finished, not that the *agent*
finished. So any consume that interleaved with an in-progress write lost data,
two ways:

1. **Unlinked-inode loss.** The agent holds the file open `O_APPEND`. It writes
   line 1 (`…\n`); the watcher fires, claims, applies, and deletes; the agent
   writes line 2 into the now-unlinked inode. Gone — the reported symptom,
   "appending to a file already deleted by the time they get to it."
2. **Orphaned-tail loss.** A buffered multi-line flush leaves the consumer a
   complete `line1\n` plus a `line2…` tail. The tail was parked as `*.partial`
   — and, as that code's own comment admitted, "will likely never be completed"
   because the writer's descriptor points at the file that was already consumed.
   Parked meant silently dropped.

Every scrap of machinery around it — `hasCompleteLine`, the tail split in
`readCompleteLines`, `*.partial`, `preservePartialLine` — was compensation for
one thing: **the consumer was reconstructing "is the writer done?" from byte
structure.** That is §9's first smell exactly, one leg further out: a fact
(*this delivery is complete*) inferred after the fact from an artifact that was
never a record of it, instead of stated by the party who knows it.

**The fix is the same shape as every other one in this document — let the party
to whom the fact is true state it, once.** The agent writes its whole delivery
to a `*.writing` scratch file the consumer ignores, then **renames** it to the
committed `*.jsonl` name. A same-directory rename is atomic, so a committed file
is complete and immutable by construction: never mid-write, never appended to
again. The delivery unit became one file rather than a shared append log, with a
per-delivery unique token so two turns for one document cannot collide on the
name.

That deleted the entire is-the-writer-done layer — `hasCompleteLine`, the tail
split, `*.partial`, `preservePartialLine` — while `.consuming` claim/apply/
delete crash-safety, nonce dedup, and oversize quarantine were untouched. The
clipboard payload now teaches write-then-rename; the `*.partial` leftover is
gone from the user guide, replaced by `*.writing`.

Cleaned up in the same pass: the "If you cannot write files — reply in chat"
fallback in the clipboard payload pointed at the paste box, which §11 had
already removed. It was instructing agents to use a door that no longer existed.

### 12.1 The first cut denylisted; it had to allowlist

The rename protocol was right, but the first implementation of the *skip* was
backwards, and it broke on the very first real delivery. The consumer said
"consume everything **except** names ending in `.writing` or `.oversize`." That
is a denylist over a **live directory other tools write into**. An agent whose
file-writer commits atomically — write `foo.jsonl.tmp.XXXX`, rename onto
`foo.jsonl` — creates a temp whose name we never anticipated. The denylist did
not recognize it, so it claimed and deleted the temp; the writer's rename then
failed `ENOENT`, source gone. The agent read this as "the inbox forbids
renames" — it does not; the consumer had eaten the writer's temp, the same
unlinked-target loss as before, now inflicted *by* the consumer instead of
suffered by it.

The fix is to **allowlist**: consume only `*.jsonl` (a committed delivery) and
`*.consuming` (our own leftover). Every other name — `.writing`, `.oversize`,
and any temp a writer we do not control minted — is ignored by construction, so
no name we failed to predict is ever grabbed. A pleasant consequence: an agent
whose editor already writes atomically can target the `.jsonl` name directly
and skip the `.writing` step, because the allowlist never races a rename it did
not initiate.

**The lesson worth carrying:** a delivery channel needs a completion signal, and
that signal is a fact the *sender* owns. Infer it from the payload's shape — a
newline, a closing brace, a size — and you are back to reconstructing after the
fact, which is where every silent loss in this saga has lived. A rename is the
sender saying "done"; nothing else in the protocol has to guess. And when you
share a directory with writers you do not control, name what you *own* and
ignore the rest — a denylist over someone else's temp files is a race you
cannot enumerate your way out of.
