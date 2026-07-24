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
document first, then deliver **one file per response**, carrying one JSON line
per comment it acted on. The payload hands over a ready-to-run command that
writes the delivery to a `.writing` scratch name and then renames it onto a
`.jsonl` file named after the document (path separators flattened to `__`) with
a random suffix:

```bash
mkdir -p .vantage/inbox && f=.vantage/inbox/docs__design__api.md.$RANDOM.jsonl && cat > "$f.writing" <<'EOF'
{"path":"docs/design/api.md","id":"abcd1234","round":2,"summary":"Rewrote the intro in plain language.","nonce":"k7f29qd1x4"}
EOF
mv "$f.writing" "$f"
```

Each line is one JSON object, newline-terminated. The random suffix keeps two
deliveries for the same document from colliding, and the rename onto `.jsonl` is
what tells Vantage the delivery is complete.

**Why the rename, and why the random name?** Vantage consumes **only** completed
`.jsonl` files, and treats the rename into that name as the "I am done" signal.
Any other name — a `.writing` or `.tmp` scratch file — is ignored until it is
renamed into place, so Vantage never reads a delivery mid-write. Writing
*directly* to the `.jsonl` name breaks this: the shell creates the file empty
(open + truncate) before the write lands, and the watcher fires on that creation
— so Vantage can consume the empty file and delete it, dropping the response the
write then writes into an unlinked file. Renaming sidesteps the race entirely,
because the file only ever appears under the `.jsonl` name once it is whole.
Appending line-by-line to a shared file has the same hazard and worse: a
trailing newline means a line ended, not that the agent is done.

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

## What Vantage does with it

The file watcher drains the inbox at startup and whenever anything under
`.vantage/inbox` changes. It touches **only** committed `*.jsonl` files (and its
own `*.consuming` leftovers) — any other name, including a scratch file an agent
is still assembling and any temp file another tool drops in the directory, is
left strictly alone. Draining one committed file is:

1. **Claim** — rename it to `<name>.consuming`, so a redelivery or a second
   watcher pass cannot race the read.
2. **Parse** — read every line. A line that is not valid JSON, has no `id`, or
   names a path outside the repo is logged and skipped; the rest of the file
   still applies.
3. **Apply** — record each response as an agent reply on the matching comment,
   capturing the document's before/after text for the diff shown in the panel.
   "Record" means one JSON file per reviewed document, rewritten atomically —
   see [Where review state is kept](#where-review-state-is-kept).
4. **Delete** — remove the consumed file, then push a `review_changed` message
   so any open browser updates without a reload.

If Vantage is not running when the agent delivers, nothing is lost: the file
sits there and is drained the next time the server starts.

## Where review state is kept

There is no database. Your comments and the agent's replies live in **one JSON
file per reviewed document**, outside the repository:

```
~/.local/share/vantage/reviews/<flattened-document-path>.json
```

Same flattening as the inbox filenames — `docs/design/api.md` becomes
`docs__design__api.md.json`. The path is deliberately not XDG-resolved: it is an
on-disk upgrade contract and stays byte-stable across releases.

Each file holds the document path, its comments, and every turn of each
thread. Writes are atomic (written to a temp file, then renamed) and serialized
per document, so a delivery landing while you are typing a reply cannot
interleave with it.

Two consequences worth knowing:

- **Review state does not travel with the repository.** It is machine-local by
  design — clone the repo elsewhere and the comments do not follow. That keeps
  review chatter out of your git history.
- **In single-repo mode the file is keyed by document path alone.** Two
  different repositories both serving `docs/spec.md` share one review file.
  Worth knowing if you run several single-repo servers over similarly-laid-out
  projects; multi-repo mode namespaces by repo and is unaffected.

## Files you may see

Under normal operation the inbox is **empty** — files exist only between
delivery and the next watcher pass, usually well under a second. These are the
leftovers you might find:

| Name | Meaning | What to do |
|---|---|---|
| `*.jsonl` | A committed delivery waiting to be consumed. | Nothing — it drains on the next pass, or at next startup. |
| `*.writing` (or any non-`.jsonl` name) | A delivery an agent is still assembling; it becomes a committed `*.jsonl` when the agent renames it. Vantage never touches these. | Nothing while an agent is working. A stray one left by a crashed agent is a never-delivered response — safe to delete. |
| `*.consuming` | A delivery that was claimed but whose apply failed (e.g. the review file was unwritable). | Nothing — it is retried on the next pass. Redelivery is safe; the `nonce` prevents double-recording. |
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

**A redelivery is ignored two ways.** The `nonce` catches the same *line*
consumed twice. But an agent that re-runs its delivery step writes *new* lines
with *fresh* nonces — as the instructions tell it to — which the nonce alone
cannot recognize. So a delivery is also treated as a redelivery when the
comment already carries an agent reply with **the same round and the same
summary**.

The round is what makes that safe: the same summary against a *later* round is
a genuine second answer and still applies. Two identical summaries in the same
round cannot be anything but the same answer arriving twice.

**An answer that arrives after you replied does not silence your reply.** If
the agent was still working when you posted a follow-up, its delivery lands
after your turn in the thread — but `round` records which turn it was answering,
so the comment stays in the agent's queue instead of reading as answered.

**Deliveries for another document are ignored, loudly.** If a line names a
comment id that does not exist on the document it targets, the delivery is
skipped and logged as dropped, rather than being applied to the wrong thread.

## Related

- [Review Mode](features.md#review-mode) — the reviewer-facing workflow.
- [docs/design/review-state-architecture.md](../docs/design/review-state-architecture.md)
  — why the inbox replaced the in-document protocol.
