# Where Review State Lives — and Why It Keeps Biting Us

> Status: **proposal** · 2026-07-19
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

This reverses a recorded decision, and should say so. The original design
([review-mode.md](review-mode.md), open question 4) chose "changelog block
only — no REST endpoint, ever," on the grounds that the agent's contract is
editing Markdown and a second channel was out of scope — while presciently
warning that this made the changelog grammar load-bearing. That was a
reasonable call made *before the parser existed*, when the dedup tax was
invisible; §3–§5 of this document are what the single-channel simplicity
turned out to cost. The reversal is of the channel's *medium*, not its
spirit: the agent still does one simple thing, it just does it somewhere
that can be consumed.

The agent stops writing responses into the document. It *delivers* them, once,
through any of three doors — all events, not regions of a persistent file:

1. **API / CLI** (preferred): the clipboard payload embeds the complete
   invocation — server URL, repo (in multi-repo mode), and path included, e.g.
   `vantage respond --server http://host:8200 [--repo X] --path docs/a.md <short-id> "summary"`
   — with a raw `curl` form as the fallback (and for the cases where the
   URL the browser sees is not reachable from the agent's machine). The
   `respond` verb is new; today's CLI has no such command.
2. **Inbox file** (for file-only agents): append a line to
   `.vantage/inbox/<flattened-doc-path>.jsonl` (same path-flattening scheme as
   the review store). The watcher — taught to watch this directory explicitly;
   today it drops non-Markdown paths — consumes it: rename, parse whole
   newline-terminated lines (a partial final line waits for the next pass),
   persist the reactions atomically into the review, *then* delete. Crash
   between persist and delete re-consumes rather than loses, making the inbox
   at-least-once — which is precisely why inbox lines carry nonces (below).
   `.vantage/` joins the default ignore set for both git and the file tree.
3. **Paste into the panel** (for tool-less chat models): the reviewer pastes
   the model's response block into a box in the Review panel, which issues the
   API call. The paste grammar is the *existing* bullet format — which means
   `parseChangelog`/`parseBullet`/`resolveCommentID` survive as the paste
   parser. What retires is the format's role as a *document-embedded
   protocol*, not the parser. A double-paste is deduped by deriving the nonce
   from the pasted content — a deliberate, contained re-admission of
   content-as-identity, acceptable because this door is human-mediated.

**Nonces, specified honestly.** Every delivery carries a client-generated
nonce. The server stores seen nonces *inside `ReviewData`*, written in the
same atomic save as the reactions they guard (an in-memory set would die on
restart — the exact flaw this doc criticizes in the prev-content cache), and
capped (last N per review) so client-supplied input cannot grow server state
unboundedly — the exact flaw the lock table had. A crash between apply and
record is impossible because they are one write.

What nonces buy is **transport idempotency**: a retried or replayed *call*
is a lookup, not a fingerprint investigation. What they do not buy is
protection against an agent that *re-issues the command afresh* (crashed
harness re-running its scrollback): that mints a new nonce and lands a
duplicate reaction. This is the residual of the new design, replacing the
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

- **A durability downgrade, named as such.** The doc-block channel is
  zero-infrastructure at-least-once delivery: it survives server crashes and
  arbitrary downtime, re-offered on every save — the entire dedup tax of §5
  is the *price* of that durability. The API door fails loudly when the
  server is down (arguably better than silent buffering — the agent knows);
  the inbox door, built re-consumable as specified above, retains real
  buffering. But the default posture moves from "cannot be lost, hard to
  dedup" to "deduped by construction, loud when undeliverable."
- **The transcript stops traveling with the repository.** Changelog blocks
  ride along in git; the review JSON lives in machine-local state and does
  not. If cross-machine review history matters, an export command covers it
  later.
- **Reviewer commands need surfaced failure.** Today's PUT is self-healing —
  any later successful PUT retransmits everything, so a failed one costs
  nothing durable. A failed command is that operation lost, so failures must
  be surfaced (re-enable the button, show a toast) or queued; that is part of
  the addition list, not an afterthought.
- "Any agent that can edit a file can respond" becomes "any agent that can
  run a command, write one inbox line, or whose reviewer can paste a block."
- Static exports are unaffected: review is already inert there (no review
  data is exported; the static interceptor strips writes), though hiding the
  Review toggle in static builds would be honest — independent of this
  proposal.
- **Net size, claimed carefully:** product code is roughly break-even — five
  thin handlers, a push message, a CLI verb, an inbox consumer, and a paste
  box against the deletions above. The decisive win is elsewhere: the ~1,750
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
3. **Add `/responses` + nonces, the CLI verb, the inbox consumer, and the
   panel paste box.** Update the clipboard payload to instruct delivery
   ("save the file, then respond") instead of doc-editing.
4. **Retire the changelog protocol — parser-as-protocol and dedup apparatus
   together, never separately** — after one release behind a compatibility
   flag. During that release, the watcher warns loudly (log + UI notice) when
   a changelog block still arrives: clipboard payloads are long-lived — they
   sit in agents' chat contexts — and a stale payload driving a retired
   protocol would otherwise reproduce this doc's headline failure, silently.
   After removal, keep a cheap marker-detection warning for one more release.

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

## 10. Recommendation and open questions

**Recommendation: adopt the direction, but do not build it now.** The current
implementation is correct, mutation-tested, and stable; the migration is
surgery on a healthy patient. The right trigger is the *next* time review
work touches the dedup or merge paths — at that point, execute §8 instead of
extending the inference machinery; extending it further is the one outcome
this doc exists to prevent. Until then, the doc's value is as a tripwire: the
protocol is explicitly not frozen, so nothing accumulates around it.

Open questions, for whenever the trigger fires:

1. **Which agent door ships first?** CLI/API covers the primary flow
   (coding agents on the same machine); the paste box covers tool-less chat;
   the inbox is the most work for the narrowest audience. Plausibly ship CLI
   + paste and skip the inbox until someone asks.
2. **Flag or fast retirement?** §8 phase 4 assumes one compatibility release,
   but with no external users and no frozen protocol, retiring the changelog
   parser immediately (keeping only the stale-payload warning) may be the
   better trade.
3. **Does review history need to travel with the repo?** If yes, an export
   command joins the addition list; if machine-local is fine, nothing does.
4. **Priority against the Go-port roadmap** — this competes with port stages
   for attention and should not preempt them.
