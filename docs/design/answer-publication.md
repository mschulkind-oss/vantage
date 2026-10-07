---
title: "An agent reply is not a recorded decision"
status: in-review
stage: DESIGN
next: "Rule OQ-AP1 — choose the product safeguard beyond document-first instructions"
---

# An agent reply is not a recorded decision

**Status:** 2026-10-07. Shared authoring instructions are implemented in this
change; the product safeguards below are proposals, not implemented behavior.

> **In short.** Record a user's ruling before working through its consequences.
> Vantage should distinguish an agent asking for another ruling from an agent
> that has replied without updating the authoritative document.

**Why it matters.** A long agent workflow leaves answered questions visibly open,
then an acknowledgment can make those questions appear to need the user again.

**Cost.** Better instructions require no new stored state; stronger safeguards
change the review delivery contract and the planning page's treatment of replies.

**Start at:** [The proposed safeguard](#3-the-proposed-safeguard).

**Needs your ruling:** [OQ-AP1](#OQ-AP1).

**Reads with:** [Planning documents](../../userguide/guides/planning.md)
(the current user experience) and [the review inbox](../../userguide/guides/review-inbox.md)
(the delivery protocol).

---

## 1. The failure and the boundary

A user answers design questions. The coordinator launches a design writer,
implementation repairs, and independent reviews. It promises to update the
served documents and deliver comment responses once that wave finishes.

The work may be progressing, but the planning interface cannot see the decision:
its authoritative state lives in saved Markdown, not the writer's brief, a todo
list, or the coordinator's chat. Updating another worktree is also invisible to
the checkout being served.

There are two different facts:

- **Decision recorded:** the design says what the user decided, and its question
  is no longer open. This is document authoring, not proof of implementation.
- **Consequences completed:** the decision's downstream design, code, tests,
  and review are finished. This can happen much later.

These phrases describe ordinary workflow facts, not new stage words. Existing
`status`, `stage`, `next`, and `depends-on` remain the document's planning fields.
Vantage must not write a ruling into Markdown on the user's behalf: a comment
may be a clarification request or a partial answer, and the agent must interpret
it in context.

## 2. What exists, and what this change delivers

Today a pending comment on a question makes the planning page show *Answered —
waiting on the agent*. The page derives this from review state; the standalone
checker reads only documents. Once the agent replies, the pending-comment
exception ends. If the question remains open in Markdown, it needs the user
again. This is documented in
[how a comment becomes an answer](../../userguide/guides/planning.md#a-comment-on-a-question-is-your-answer)
and implemented by [the planning answer predicates](../../frontend/src/lib/planningAnswers.ts).

The inbox records agent responses, rounds, and before/after text. It does not
establish whether the document incorporated a ruling. See
[response application](../../internal/review/commands.go) and
[review-state architecture](review-state-architecture.md#62-agent-responses-become-deliveries).

This change shares one answer-processing instruction between the canonical
style guide and every review clipboard payload. It reaches document Copy,
single-comment Copy, and planning Copy answers, as well as the in-app guide and
`vantage-check style-guide`. Its source is
[the canonical guide](../../packages/vantage-md/src/styleGuide.ts).

The instructions require a small, coherent update in the served checkout before
downstream work. They cover compaction, repaired links, preserved dependency IDs,
partial answers, honest metadata, and one-writer conflicts. This costs no new
protocol field and displaces the practice of waiting for a whole work wave.
It cannot enforce an external agent's ordering or prove the prose is correct.

## 3. The proposed safeguard

**Recommendation: explicit reply outcomes plus document evidence**, subject to
[OQ-AP1](#OQ-AP1). An ordinary reply is too ambiguous to determine whether the
human owes another answer.

For responses to planning questions, extend the inbox delivery with an optional
question ID and an explicit outcome. The exact field names are the implementer's
choice; the meanings are not:

| Outcome | Meaning | What the planning page does |
| :--- | :--- | :--- |
| Recorded | The agent says it incorporated the ruling into the saved document | Check the current document evidence before treating the ruling as recorded |
| Clarification | The agent needs another human decision; the summary asks the narrower question | An open question needs the human again |
| Deferred | The agent has not incorporated the ruling; the summary states the obstacle | Keep the original answer as work owed by the agent, not a new human question |
| Absent | A legacy delivery or a response to ordinary prose | Preserve today's behavior; do not infer an outcome from summary text |

Partial rulings that leave a human decision use Clarification after recording
the settled part. An unanswered engineering investigation is not a new human
question: use Deferred and name the useful next agent action or real obstacle.

The review store owns reply outcomes and question identity. The document owns
whether the question is open, answered, or compacted. The planning page combines
those sources; a reply must never overwrite document state or fabricate a stage.

### 3.1 Document evidence

A Recorded claim is structurally supported only when the current, successfully
scanned document contains either:

- the same question ID with an answered marker; or
- that exact ID in the first column of a Decision Ledger table headed `ID`,
  with no still-open or blocked directive of that ID.

An ID occurring in unrelated prose, deleting the question without a ledger,
renaming it, setting the document's stage to `done`, or changing another section
is not evidence. Duplicate IDs, unreadable documents, and omitted scans produce
an unknown result, never a successful verification.

An answered marker is an intermediate state, not completed compaction. Keep the
existing answered-question contribution to *Needs you* until compaction, while
labeling it as agent-owned compaction rather than another ruling owed by the user.
This proposal does not change the standalone index's inclusion of answered
questions or dependencies that already recognize retained decision IDs.

Extract ledger IDs through the shared Markdown planning scan, using the actual
parsed table rather than searching raw text. Expose that evidence alongside the
scanned questions. The exact container is the implementer's choice. The viewer
must not introduce a second Markdown parser, shell out per card, or give the
standalone checker access to machine-local reviews.

Structural evidence is not semantic validation: the ruling could still be
misstated in the body. The page must say *Recorded in document*, not *Decision
verified correct* or *Implemented*.

### 3.2 When a reply and the document disagree

A Recorded claim with an open or blocked question shows *Agent replied — document
still open*. A Deferred reply shows *Waiting on the agent* and its stated
obstacle. An unknown scan shows *Document update not checked*. None of these
states counts as a new ruling owed by the user.

Keep these entries discoverable in their current question section. They remain
eligible for Copy answers, which includes the original answer and the latest
reply, explicitly asking the agent to finish recording it. Do not automatically
resend requests, start an agent, or infer a timeout. The user controls copying.

Once current document evidence supports compaction, the question leaves the
planning list through the normal document-derived update. Its review thread
remains available in the document's review history.

### 3.3 Ordering, follow-ups, and failure

Evaluate evidence when either the document's planning scan or its reviews change,
using the page's current document and review versions. Review and document push
messages can arrive in either order: disagreement is a derived condition, not a
permanent failure stamped into the response. A later scan can clear it without
redelivering the reply.

A newer reviewer edit or follow-up supersedes the earlier outcome, using the
existing round-aware review rules. An old Recorded response never settles a
newer user request. Dismissal remains an explicit human action; reopening returns
the question to the normal unanswered state unless another current answer exists.

Store outcomes atomically with reactions. Preserve nonce deduplication. Content
deduplication must include outcome and question ID, so correcting Deferred to
Recorded is not discarded merely because the summary text is unchanged. A retry
of an identical delivery remains a no-op. Unknown outcome values are logged and
treated as absent; malformed question IDs are not credited to any question.

A batch is processed per response, not all-or-nothing: one unsupported Recorded
claim must not discard successful updates for another document. With no replies
or no planning questions, existing review behavior is unchanged.

### 3.4 Compatibility and scope

Old deliveries and stored reviews have no outcome; no migration assigns them
one. A newer viewer preserves their current interpretation. New clipboard
instructions include outcomes only when the serving version supports them;
old viewers continue their existing behavior. Before adopting the extension,
verify the old inbox reader's treatment of unknown JSON fields rather than
assuming a new delivery is safe on every release.

No new Markdown directive, frontmatter field, or stage word is needed. No server
rewrites a design document, no timer declares a decision settled, and no global
lock allows an agent to overwrite another writer. The product can expose a stale
record; it cannot stop an external agent from launching downstream work.

## 4. Alternatives and cost

| Approach | Added cost | What it cannot fix | Verdict |
| :--- | :--- | :--- | :--- |
| Shared instructions only | One shared text block; no stored-state change | An agent can still postpone or ignore it | Deliver now |
| Advisory notice after any reply to an open question | Derived UI check; no new delivery field | Cannot distinguish a valid clarification from a postponed edit | Smaller fallback, but ambiguous |
| Explicit outcomes plus document evidence | One optional outcome and question ID per response; shared scan evidence; reply-state and UI tests | Cannot prove the body faithfully records the ruling or force agent scheduling | Recommended follow-up |
| Automatically copy comments into Markdown | A new competing document writer and interpretation rules | Cannot safely distinguish questions, partial rulings, and decisions | Reject |
| Hold all work until a full rewrite passes review | No new schema, but latency remains the whole work wave | Recreates the reported experience | Reject |

The recommended design adds no polling and no network dependency to the checker.
Evidence is computed with each changed document scan, not separately for every
card. Bound its work by the planning scanner's existing file and candidate limits;
unknown evidence under those limits must stay visible as unknown.

## 5. Observable acceptance criteria

- A clear ruling becomes saved document state before downstream work starts;
  the smaller instruction change is testable as a payload contract, not as a
  guarantee about arbitrary agent behavior.
- A Recorded reply against unchanged open Markdown stays agent-owned and can be
  copied back without asking the user to decide again.
- A Clarification reply restores the remaining question to the human's queue.
- A Deferred reply displays its obstacle without hiding the question or claiming
  that the decision has been implemented.
- A recorded question compacts and leaves the list after a document update,
  irrespective of whether the review push or document push arrived first.
- A newer user follow-up remains pending despite an older Recorded delivery.
- A removed ID, duplicate ID, hidden document, unreadable document, or skipped
  scan never provides successful evidence.
- Legacy responses, non-question comments, dismissal, nonce retries, and
  independent responses within a batch preserve their stated behavior.

## Open Questions

1. 💬 **OQ-AP1: Should Vantage distinguish reply outcomes, or only warn about stale documents?**

   [The proposed safeguard](#3-the-proposed-safeguard) prevents a postponed
   document update from becoming another decision owed by the user.

   - **A — Advisory notice only.** Smaller change, but a notice cannot tell a
     valid clarification from an agent postponing an update.
   - **B — Explicit outcomes plus document evidence.** Distinguishes those
     cases and keeps unfinished recording agent-owned, at the cost of extending
     the inbox contract and review-state behavior.

   <!-- vantage: question id=OQ-AP1 leaning="B — explicit outcomes plus document evidence; a reply alone cannot distinguish clarification from postponed recording." -->

   _Leaning:_ B — explicit outcomes plus document evidence; a reply alone cannot
   distinguish clarification from postponed recording.

   **Answer:**

   > _(empty — fill in when decided)_
