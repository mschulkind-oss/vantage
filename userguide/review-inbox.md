# The `.vantage/` directory

When you review a Markdown document and an agent answers your comments, the
answers arrive through a small directory at the root of the repository being
served:

```
<repo>/.vantage/inbox/
```

**Yes, gitignore it.** Vantage does not do this for you and does not touch your
`.gitignore` (see [Gitignoring it](#gitignoring-it) below).

This page explains exactly what lands there, who writes it, who deletes it, and
what to do when something is left behind.

---

## Why it exists

An agent's response to a review comment has to reach Vantage somehow. It used
to be written into the reviewed document itself, as a `<!-- changelog -->`
block — which meant the block stayed in your document forever and got re-read
on every save, and Vantage had to guess whether each re-read was a new answer
or one it had already recorded. Guessing wrong silently dropped answers or
silently marked your follow-ups as answered. (The full history is in
[docs/design/review-state-architecture.md](../docs/design/review-state-architecture.md).)

The inbox replaces that with an ordinary mailbox: a response is **delivered
once, consumed, and deleted**. Nothing accumulates in your documents, and
nothing has to be inferred from content.

## What the agent writes

When you copy comments to an agent, the clipboard payload tells it to save the
document first, then append **one JSON line per comment it acted on** to a file
named after the document, with path separators flattened to `__`:

| Document | Inbox file |
|---|---|
| `spec.md` | `.vantage/inbox/spec.md.jsonl` |
| `docs/design/api.md` | `.vantage/inbox/docs__design__api.md.jsonl` |

Each line is one JSON object, newline-terminated:

```json
{"path":"docs/design/api.md","id":"abcd1234","round":2,"summary":"Rewrote the intro in plain language.","nonce":"k7f29qd1x4"}
```

The payload hands the agent the exact filename and a filled-in example line, so
it does not have to derive any of this.

| Field | Meaning |
|---|---|
| `path` | The document's repo-relative path. Must stay inside the repo. |
| `id` | The comment's short id, from the payload (the `[abcd1234]` in each heading). A unique prefix of the full id is enough. |
| `summary` | One sentence: what the agent changed. Rendered inline under your comment. |
| `round` | Which turn the answer was written against — the thread's length in the payload the agent read. Lets Vantage tell "answered the latest turn" from "answered something you have since replied to." |
| `nonce` | A fresh random string per line. Vantage uses it to recognize a redelivered line. |

The **filename is advisory only** — Vantage never reads meaning from it. Every
line's own `path` field decides which document it applies to, so one file may
carry lines for several documents and still be applied correctly.

Agents that cannot write files fall back to replying in chat with a
`- [abcd1234] summary` block, which you paste into the Review panel's **Paste
agent response** box. That path never touches `.vantage/` at all.

## What Vantage does with it

The file watcher drains the inbox at startup and whenever anything under
`.vantage/inbox` changes. Draining one file is:

1. **Claim** — rename it to `<name>.consuming`, so a concurrent write cannot
   race the read.
2. **Parse** — read whole, newline-terminated lines. A line that is not valid
   JSON, has no `id`, or names a path outside the repo is logged and skipped;
   the rest of the file still applies.
3. **Apply** — record each response as an agent reply on the matching comment,
   capturing the document's before/after text for the diff shown in the panel.
4. **Delete** — remove the consumed file, then push a `review_changed` message
   so any open browser updates without a reload.

If Vantage is not running when the agent delivers, nothing is lost: the file
sits there and is drained the next time the server starts.

## Files you may see

Under normal operation the inbox is **empty** — files exist only between
delivery and the next watcher pass, usually well under a second. These are the
leftovers you might find:

| Name | Meaning | What to do |
|---|---|---|
| `<doc>.jsonl` | A delivery waiting to be consumed. | Nothing — it drains on the next pass, or at next startup. |
| `*.consuming` | A delivery that was claimed but whose apply failed (e.g. the review file was unwritable). | Nothing — it is retried on the next pass. Redelivery is safe; the `nonce` prevents double-recording. |
| `*.partial` | The tail of a file that ended mid-line, preserved so a half-written delivery is never dropped. | Nothing. Vantage never re-reads these; they are kept as evidence. Safe to delete. |
| `*.oversize` | A delivery file larger than 8 MB, quarantined unparsed. | Investigate — a delivery file should be a few hundred bytes. Safe to delete once you have looked. |

Any of these is safe to delete by hand; the worst case is losing an
undelivered response, which you can re-request by copying the comments again.

## Gitignoring it

**Vantage does not create `.vantage/`, and does not write to your `.gitignore`
or `.git/info/exclude`.** The agent creates the directory when it delivers its
first response, so the first time you use the review flow it will appear as an
untracked directory in `git status`.

Add it to the repository's `.gitignore`:

```gitignore
.vantage/
```

Or, if you would rather not commit that line to a shared repo, add it to your
own clone only:

```bash
echo '.vantage/' >> .git/info/exclude
```

Committing an inbox file is harmless but pointless — it is transient state, and
Vantage will consume and delete it.

## It is hidden inside Vantage

`.vantage` is on Vantage's built-in always-ignored list, so it never appears in
the file tree, in search, or in any listing, and it cannot be opened by URL
even if you type the path directly. That holds regardless of your
`--use-ignore-files` setting.

This is only about the Vantage UI — it says nothing about git, which is why the
gitignore step above is still yours to do.

## Known behavior worth knowing

**A redelivered *line* is ignored; a re-run *agent* is not.** The `nonce`
means the same line consumed twice records one reply. But an agent that runs
its delivery step a second time writes *new* lines with *fresh* nonces — as the
instructions tell it to — and each one is recorded. The visible result is the
same answer appearing two or more times under a comment, and if the agent
re-ran its whole delivery step, under *every* comment at once.

Nothing is lost when this happens and no turn is misattributed; the duplicate
is cosmetic. Dismissing the comment, or deleting and re-adding it, clears it.

This is a known rough edge rather than a designed behavior. It is fixable now
that deliveries carry `round`: two answers naming the same comment, the same
round, and the same summary are a redelivery by construction, whereas the same
summary against a *later* round is a genuine second answer. That distinction
was impossible under the old in-document protocol, which is why duplicates were
originally accepted as the price of never silently dropping an answer.

**An answer that arrives after you replied does not silence your reply.** If
the agent was still working when you posted a follow-up, its delivery lands
after your turn in the thread — but `round` records which turn it was answering,
so the comment stays in the agent's queue instead of reading as answered.

**Deliveries for another document are ignored, loudly.** If a line names a
comment id that does not exist on the document it targets, the delivery is
skipped and logged as dropped, rather than being applied to the wrong thread.
Pasting a response block into the wrong document's panel reports **"No matching
comments on this document"** rather than a false success.

## Related

- [Review Mode](features.md#review-mode) — the reviewer-facing workflow.
- [docs/design/review-state-architecture.md](../docs/design/review-state-architecture.md)
  — why the inbox replaced the in-document protocol.
