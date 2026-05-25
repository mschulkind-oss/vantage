# Review Mode — Current Design and Where the Tiny Gaps Are

This is a design audit of Vantage's review mode as of `7652eb7`. The goal is to walk a real reviewer through the current UI click-by-click, find the small modeling gaps that make the flow feel awkward, and propose two focused changes:

1. **Simplify display.** The "what does this comment attach to" logic is a tower of fallbacks that breaks in surprising ways. Apply the same pattern that worked for hover-to-comment (`7652eb7`): pick a stable unit (a block), do one obvious thing, drop the heuristics.
2. **Replace change-tracking with reactions.** Snapshot-browsing isn't useful for finding what changed in response to a comment. A per-comment "reaction" — the agent says "I addressed it like *this*" — is what the reviewer actually wants to scan.

The lens: review mode is a single-document, single-reviewer, agent-on-the-other-side workflow. Stories are click-by-click so we can spot the model gaps that make any given moment feel "almost right."

---

## Part 1 — Current UI surface

### Toolbar buttons (top-right of the document, when a `.md` file is open and not in raw mode)

| Button | What it does today |
|---|---|
| `Review` (purple `MessageSquarePlus`) | Toggles review mode for the current file. Off → on writes a `vantage.reviewMode:<repo>:<path>` localStorage flag. On → off, if there's saved data, opens an "End Review" confirmation dialog; otherwise just turns off. |
| `‹ N/M ›` snapshot toolbar | Only appears once the first snapshot exists. Chevrons walk through `snapshots[0..N-1]` then "Live." `Latest` jumps back to live. |
| `Copy N` (purple `ClipboardCopy`) | Only when ≥1 unresolved comment. Copies markdown blob with line anchors to clipboard. |
| `MessageSquare` (no label) | Opens the side panel listing all comments. |

### In-document gestures

| Gesture | Result |
|---|---|
| Move mouse over any block | Block grows a `.review-block-hovered` class (whole vertical span, not just text). Set in `MarkdownViewer.tsx:316-377`. |
| Click an unhovered link / button / inline-comment-block | Click passes through normally. |
| Click a hovered block (no active selection) | The block's text is captured, popover opens. (`MarkdownViewer.tsx:381-420`) |
| Drag-select text and release | Selection text is captured (≥3 chars), popover opens with that exact substring. |
| Toggle review mode while text is already selected | Auto-captures the selection — saves a re-select. (`MarkdownViewer.tsx:302-308`) |

### Side panel sections

| Section | Contents |
|---|---|
| Header | "Review Comments" + active count badge |
| Active comments | Quoted text (left blue bar) + body, edit/delete on hover |
| Resolved comments | Same with strikethrough at 60% opacity, delete on hover |
| Footer | `Copy All (N)` (primary) + `Clear All` with two-click confirm |

### State machine

```
                       ┌────────────────┐
                       │  mode = OFF    │  default
                       └───┬────────────┘
                           │ click "Review"
                           │   OR loadReview() finds saved data on file open
                           ▼
                       ┌────────────────┐
                       │  mode = ON     │
                       │  (live view)   │◄──┐
                       └───┬────────────┘   │ click "Latest" or right-most chevron
                           │ chevron / setSnapshotIndex(i)
                           ▼                │
                       ┌────────────────┐   │
                       │  mode = ON     │───┘
                       │  (snapshot i)  │
                       └────────────────┘
                           │ click "Review" while ON
                           │   ┌─ no data → straight to OFF
                           │   └─ data exists → "End review?" dialog
                           ▼
                       ┌────────────────┐
                       │  mode = OFF    │  + DELETE /api/review on confirm
                       │  + state wiped │
                       └────────────────┘
```

### Where data lives

| State | Storage | Lifetime |
|---|---|---|
| Comments + snapshots | Server JSON at `~/.local/share/vantage/reviews/<encoded-path>.json` | Until "End Review" |
| `isReviewMode` per file | `localStorage` `vantage.reviewMode:<repo>:<path>` | Until end-review or browser clears |
| `currentSnapshotIndex` | In-memory only | Resets on file switch / refresh |
| `pendingSelection` | In-memory only | Resets on file switch / refresh |
| `lastContent` (snapshot trigger) | In-memory only | Resets on file switch / refresh |

The `lastContent` reset is load-bearing: on first content arrival after a refresh, `reviewLastContent` is null so no spurious snapshot fires. Subtle invariant — easy to break.

### Comment anchoring (where the trouble is)

Comments key on `selected_text` — the exact string the reviewer captured. On every render, `useReviewHighlights.ts` (705 LOC) walks the DOM and tries:

1. **Exact text-node match**, wrap in `<mark>`, attach inline comment block to the containing block (`tryHighlight`).
2. **Whitespace-normalized match** if step 1 fails (`tryHighlightNormalized`).
3. **Best-block heuristic** if both fail but the text is *still in `innerText`* somewhere — word-overlap score against each block, score > 0.15 wins.
4. **"Outdated"** if the text is gone from `innerText` entirely. Pinned to the best-block by word overlap; if no block scores > 0.15, dumped at the top of the document.

Step 1 is what we want to happen. Steps 2-4 are damage control.

### "Changed block" highlights (snapshot mode)

`splitBlocks(previousSnapshot.content)` and `splitBlocks(currentContent)` — split by blank lines, position-aligned. Blocks at the same index that differ are flagged. Then for each `<p|h1-6|li|blockquote|pre|table>` in the rendered DOM, if its `textContent` matches a "changed" stripped-markdown text, it gets:

- `data-review-changed-block` + `.review-changed-block` class (left bar, faint background)
- Position-aligned check vs. resolved comments → a `✓ addressed` pseudo-badge if the block's old counterpart contained a resolved comment's text
- Otherwise, when viewing a past snapshot, a `1/N` revision badge in the corner

This relies on **block index alignment**, which falls apart any time a block is inserted, deleted, reordered, or any time a heading was renamed (because `stripMarkdown` does its own thing).

---

## Part 2 — User Stories (click-by-click, with model gaps inline)

### 1. Maya — reviews an agent-drafted spec

**Context:** Maya opens `specs/billing-rewrite.md` in single-repo Vantage. ~80 paragraphs. She's done two reviews like this before.

**The review:**

1. Maya clicks **`Review`** in the toolbar.
   - The button turns purple. The localStorage flag `vantage.reviewMode:specs/billing-rewrite.md = "on"` is written.
   - **No data on the server**, so `loadReview` returned 404 / empty. The side panel button (`MessageSquare`) is now visible. The snapshot toolbar isn't yet (no snapshots).
   - **No instructions on screen.** First-time users would be lost. Maya knows what to do.

2. Maya hovers paragraph 6. The whole paragraph gets a faint background (`.review-block-hovered`).

3. Maya drag-selects "tax is computed at checkout" inside that paragraph. She releases the mouse.
   - `mouseup` fires, the 10ms `setTimeout` fires `captureCurrentSelection()`, which sets `pendingSelection`.
   - The **comment popover** appears below the selection. 6-row textarea, "Add Comment" header, "⌘+Enter to save" hint.

4. Maya types `this is wrong — tax is computed at invoice generation` and presses ⌘+Enter.
   - `addComment(selectedText, comment)` runs. `saveReview()` POSTs the new state.
   - The popover closes, the phrase gets a yellow `.review-highlight` background, and a 💬 inline-comment block appears under paragraph 6.

5. Maya scrolls down. Paragraph 14 has a fenced code block. She wants to flag a specific identifier inside the code.
   - She drag-selects `customer_id` inside the `<code>`. Releases.

   **Gap (display, not gesture):** the inline comment block lands in the wrong place. `findBlockAncestor` walks up looking for a direct child of the prose container. With syntax-highlighted code, the chain is `<span>` → `<span>` → `<code>` → `<pre>` → prose-container. The walk often resolves to a `<span>` that *isn't* a direct child, and the regex on line 221 (`/^(P|H[1-6]|LI|BLOCKQUOTE|PRE|DIV|TABLE|UL|OL|SECTION)$/i`) only matches if the parent is one of those. Result: the comment gets attached at an unpredictable depth. The yellow highlight is on `customer_id`, but the comment block appears one paragraph above.

6. Maya drag-selects a phrase that crosses paragraph 19's last line and paragraph 20's first line.
   - `tryHighlight` calls `range.surroundContents()`, which throws because the range crosses element boundaries. Falls back to `tryHighlightNormalized`, which splits the highlight across nodes — both halves get a `<mark>`.
   - But `insertInlineComment` uses `findBlockAncestor(firstMark)` — only paragraph 19. The comment block appears under 19, not 20, even though half the highlighted text is in 20. Visually, the comment looks like it belongs to 19 only.

   **Model gap:** the comment is conceptually attached to *the selection*, but the inline display is attached to *one block*. When the selection isn't contained in one block, this lies.

7. Maya does eight more comments, all single-block, all clean.

8. She clicks **`Copy 10`** in the toolbar.
   - Clipboard now holds a markdown blob: ten sections, each with `[Lines 12-14](/specs/billing-rewrite.md#L12-L14) [a3f9c2d1]`, the selected text quoted, two lines of context above and below, and at the end a "Responding to Comments" instruction block telling the agent to append `<!-- changelog -->` lines.
   - The toolbar button flashes "Copied!" for 2s.

9. Maya pastes that into a chat with the agent. Agent runs, edits the file. Maya's WebSocket fires; `fileContent.content` updates. The auto-snapshot effect on `ViewerPage.tsx:204` snapshots the *previous* content.
   - The snapshot toolbar appears: `‹ 1/2 Live ›`. Maya is at "Live."
   - Comment 1's `selected_text` ("tax is computed at checkout") is now gone from the doc — agent rewrote it as "tax is computed at invoice generation."

10. The display rebuilds. For comment 1:
    - `tryHighlight`: doesn't find the string. ✗
    - `tryHighlightNormalized`: same. ✗
    - "Still present?" check: `normalizedRendered.includes(normalizedSelection)` — false. So it's **outdated**.
    - `insertCommentAtBestBlock` runs word-overlap scoring. The new paragraph 6 still mentions "tax" and "invoice." Best-block scores 0.4. Comment lands as an "Outdated" block under the new paragraph 6, with a "Dismiss" button.

    Meanwhile, paragraph 6 has a `data-review-changed-block` attribute (the old para 6 vs. new para 6 differ). Because comment 1 is resolved? No — comment 1 is *outdated* but not resolved. So no `✓ addressed` badge fires.

    **Gap:** The doc just changed *because* of Maya's comment. The comment is now sitting next to the changed block, labeled "Outdated," with a "Dismiss" button. There is no signal "yes, this change is what you asked for." Maya has to re-read the new paragraph, decide it's right, and click Dismiss. Then she has to do that 9 more times.

11. Maya sees ten unresolved comments and ten changed blocks. She picks comment 3 to verify first. She wants to see "what was paragraph 14 before?"

12. She clicks the **`‹`** chevron. The view replaces the body with `snapshots[0].content`.
    - **Banner appears**: "Viewing past revision 1/2." (`MarkdownViewer.tsx` shows `snapshotLabel`)
    - The five blocks that changed in this snapshot show a `1/2` revision badge in their corner.
    - She tries to leave a comment on the changed paragraph. A toast pops: *"Go to Latest to comment on changed text."* The selection is blocked.

    **Gap:** The most natural moment to react to a change is when staring at it. But on the snapshot she can't comment. She has to memorize what she wants to say, click `Latest`, find the paragraph in live view, and select again.

13. Eventually she clicks `Latest` and Dismisses the ten outdated comments. Done.

**The friction hot spots in click order:**

- Step 5: comment-on-code-identifier lands in wrong block
- Step 6: cross-block selection's comment block is half-orphaned
- Step 10: ten changes, ten "Outdated" comments, no per-comment "this is the change" signal
- Step 12: snapshot view can't be commented on

**Each is a tiny model gap, not a missing feature:**

- Comments are anchored to a *string*, not a *block*. The string drifts.
- Comments are *visually attached* to one block, but *conceptually about* a selection.
- The signal "agent addressed your comment" is a heuristic on the *block*, not a relationship to the *comment*.
- Snapshot view is for read-only because the snapshot has no stable substrate to anchor a *new* comment on.

---

### 2. Sam — returns the next morning

**Context:** Sam left review mode on yesterday with 4 unresolved comments + 2 snapshots. Closes laptop. Opens it.

1. Sam navigates to the file. `loadReview()` fires, server returns the saved blob. Because `data.comments.length > 0`, `isReviewMode = true` is set. The toolbar shows: `Review` (purple), `‹ 2/3 Live ›`, `Copy 4`, `MessageSquare`.

2. Comments render. Three highlight cleanly. Comment #4's selected text was edited overnight by the agent — it's now "Outdated."

   **Gap:** Sam doesn't know whether comment #4 is outdated because *the agent acted on it* or because *somebody changed something unrelated*. The label says "Outdated"; that's all. He has to read both versions to figure it out.

3. He resolves the three clean ones (`Resolve` button on each inline comment block). Re-reads the changed paragraph for #4. Decides he's happy. Clicks "Dismiss" on the outdated comment.

4. He decides he's done. He clicks **`Review`** to turn it off.
   - Has data → confirmation dialog. "End review will delete all comments and snapshots." He clicks Confirm. `DELETE /api/review`. Everything wiped.

5. Next week, he wants to know what he asked for. There's nothing — comments and the snapshot trail are gone together.

   **Gap:** "End review" is a *destroy* button, not a *close* button. The two snapshots had value beyond the review (they're a sparse local history of a doc that maybe isn't in git). They went down with the comments.

6. Worse: there's no per-comment record of what changed. Even if Sam had archived the data, "comment X said Y; agent changed Z" isn't in the data model. The `events` are just `created_at`.

---

### 3. The agent — receives the clipboard blob

**Context:** Claude (or similar) gets a 10-comment review pasted in a chat.

1. The blob has line numbers (`#L12-L14`) and the `[a3f9c2d1]` short-id markers. Easy to read.

2. The agent edits the file. For each comment, it:
   - Locates the affected block by line number,
   - Rewrites,
   - Appends to the bottom of the file:
     ```
     <!-- changelog -->
     - [a3f9c2d1] Reworded paragraph: tax is now described as invoice-time
     ```

3. **Gap:** Nothing parses the changelog. `rg 'changelog' src/ frontend/src/` returns only the clipboard-emit code. The "agent → reviewer" channel that the prompt promises *does not exist server-side*. The reviewer never sees the agent's per-comment summary; they just see "Outdated" labels and blocks with `✓ addressed` heuristic badges.

4. **Gap:** The agent has no way to push back. If comment #2 says "delete this section" but the agent thinks the section is load-bearing, there's no `won't_fix(reason)` channel. The agent either silently complies or silently doesn't.

5. **Gap:** The agent doesn't know which block actually maps to comment #5 unless it trusts its own line-number reading of the clipboard blob. If the doc has shifted under it (e.g. the agent did some edits in a previous turn), `#L12-L14` may be stale. There's no API to fetch comments by ID.

---

### 4. Lisa — reads the doc, doesn't know what review is

**Context:** Lisa is a stakeholder. Doesn't review. Just reads.

1. She opens the file. `Review` button is grey, off. She doesn't notice it. She reads the doc. No friction.

2. A week later, she's asked to review. She finds the `Review` button by hovering toolbar icons. She clicks it. The button turns purple. The side-panel button appears.

3. She tries selecting text. Popover appears. She reads "Add Comment." She thinks "oh, this is like Google Docs." Types a comment. ⌘+Enter saves.

4. **Where it works for first-timers:** drag-select works exactly the way Google Docs / GitHub / Hypothesis taught her. The mental model carries over.

5. **Where it doesn't:** the per-block hover-highlight is unfamiliar. She thinks the block is "selected" and wonders why nothing happens until she clicks. Then she clicks expecting nothing — a popover opens. Now she's confused: did she select the whole block, or did clicking *cause* it to be selected?

   **Gap:** Two gestures (drag-select, click-block) produce the same UI (popover), but the *implied scope* of the comment is different (substring vs. whole block). The popover shows the captured text, but Lisa doesn't read it.

---

## Part 3 — The pattern that's already working: do one thing, on a stable unit

The hover-to-comment refactor (`7652eb7`) is the model. Before:

- Each block had a sticky gutter `+` button with custom hit-zone CSS variables and a 1500ms hide-delay tolerance for mouse travel (`f4511c6`, `1c8e5ec`).
- The hit zone broke on tall blocks. Cursor exited it, hide timer fired, button vanished, click failed.

After `7652eb7`:

- The block under the cursor's *vertical span* gets a hover class. The whole block is the hit target.
- Click anywhere on the hovered block opens the popover. Drag-select still works (defers to selection).
- Code shrunk: `+196 / -164` lines.

The pattern: **stop trying to be precise about a tiny sub-region. Pick the natural unit (a block). Make the whole block the target. Branch by gesture (selection vs. click) not by region.**

The display side hasn't had this treatment yet. It still tries to be precise about substrings inside blocks, with a fallback ladder when it can't.

### What a block-anchored model looks like

We already have **`data-source-line`** on every rendered block (added by `rehypeSourceLines` in `vantage-md`). It's the source-markdown line of the block's first character. Stable across re-renders of the *same* content. Approximately stable across small edits (insert a paragraph above → all later lines shift by N, but the block we anchor to keeps its identity if we resolve by text-hash within a window).

A comment becomes:

```python
class CommentAnchor(BaseModel):
    source_line: int        # block's data-source-line at comment time
    block_text_hash: str    # sha1 of the block's stripped text, for drift check
    selection_offset: int   # char offset within the block (display only)
    selection_length: int   # selection length (display only)
    fallback_text: str      # for the truly-outdated case

class ReviewComment(BaseModel):
    id: str
    anchor: CommentAnchor
    body: str
    # ...
```

On render:

1. Find the block with matching `data-source-line`. If hash matches → highlight `selection_offset .. selection_offset+length` within that block, attach inline comment under that block. **Done.**
2. Hash mismatch → walk neighbor blocks looking for a hash match. If found → re-anchor (update stored `source_line`), do the same as step 1. Mark the comment with a small "moved" indicator.
3. Hash gone entirely → outdated. Show `fallback_text` in a quoted block at the *closest still-present* `data-source-line`. No word-overlap heuristic. No best-block-by-score.

What this kills:

- `tryHighlightNormalized` (whitespace fallback)
- `insertCommentAtBestBlock` word-overlap heuristic
- `findBlockAncestor` traversal — we're handed the block element directly via `[data-source-line="N"]`
- The "still present in `innerText` but unmatched" branch
- The "best block scored > 0.15 else dump at top" branch

What it gives up:

- Sub-block highlight precision when the block has been edited but not removed. Acceptable: we still highlight *something* in the right block, and the `fallback_text` quote shows the original wording.
- Multi-block selections. Either disallow them (clamp to first block — easier, communicates honestly) or store an *anchor range* (`source_line_start, source_line_end`). Easier: clamp.

### Code blocks, multi-block selections, and the popover

- **Code block fix** falls out automatically: `data-source-line` is set on `<pre>`, not on inner `<span>`s. The anchor *is* the `<pre>`. Comment attaches under the `<pre>`. Done.
- **Multi-block selections:** the popover, on `mouseup`, can detect `range.startContainer`'s ancestor `[data-source-line]` ≠ `range.endContainer`'s. Two options:
  - Clamp to start block, show a hint: *"Comments attach to one block. Selecting first block."* (Recommended — predictable.)
  - Allow multi-block, store both lines, render the highlight across both. (More work; rarer use case.)
- **Block click (no selection):** anchor is the whole block, `selection_offset = 0, selection_length = block_text.length`. Today's behavior, just stored differently.

---

## Part 4 — Reactions, not change-tracking

### What change-tracking gives you today

The snapshot toolbar lets you walk back through document versions. Changed blocks get a faint left-bar and a `1/N` corner badge. The `✓ addressed` badge is a heuristic guess (block-position alignment + text overlap with resolved comments).

### Why it doesn't work for the actual task

The reviewer's question after the agent runs is: **"For each of my 10 comments, what did the agent do about it?"**

What snapshot-browsing answers: "What blocks differ between this snapshot and that snapshot?" Different question. To answer the reviewer's question with snapshot tools, the reviewer has to:

1. Pick a comment from the panel.
2. Find the relevant block in the live view.
3. Click ◄ to step back to a snapshot containing that block in its old form.
4. Memorize the diff.
5. Click `Latest`.
6. Cross-check that what they remembered is what actually happened.
7. Decide to resolve.

That's 6+ steps per comment. With 10 comments, it's a chore. Maya skips it; she just dismisses everything and trusts the agent.

### What "reactions" looks like

A **reaction** is a per-comment record of what changed in response. Bound to a comment ID. Browseable as a per-comment artifact, not a per-block one.

Data:

```python
class CommentReaction(BaseModel):
    comment_id: str
    actor: str                # "agent" | "reviewer"
    kind: str                 # "addressed" | "wont_fix" | "needs_clarification" | "noted"
    summary: str              # one-line description from the agent
    before_text: str          # block text before the change
    after_text: str           # block text after the change (for "addressed")
    timestamp: float
```

How it gets created:

- **Agent path (the common one):** the agent calls `POST /api/review/<comment_id>/react` with kind, summary, before, after. The clipboard prompt is updated to instruct this. Or, simpler middle ground: the agent appends a `<!-- changelog -->` block as today, but the **server parses it** when the file is saved/watched, looks up each `[<id>]`, captures before/after from the most recent snapshot vs current, and creates a reaction record. Either way: the changelog stops being a dead instruction and becomes a real channel.
- **Reviewer path:** when the reviewer clicks `Resolve`, that's a reaction with `kind=noted`. When they click `Dismiss` on an outdated comment, that's `kind=noted` with summary "dismissed."

How it appears:

- Each comment in the side panel grows a "Reaction" sub-block. If the comment has a reaction, the panel shows: agent summary line ("Reworded as invoice-time"), and a compact word-diff of `before_text` vs `after_text` inline.
- Resolving a comment with an addressed reaction is one click in the panel: `Resolve` button next to the reaction summary.
- A new toolbar button `Reactions` (or a tab in the side panel) shows just comments-with-pending-reactions. Maya's flow becomes: click `Reactions`, see 10 cards, scan summaries, click `Resolve` on each that's right, click `Reject` (re-opens) on each that isn't.

### What reactions *replace*

- **The `✓ addressed` block-level badge.** It was a guess. Reactions are explicit and per-comment.
- **The whole snapshot toolbar UI flow for "what changed?"** Snapshots can stay as a raw mechanism (we still need a "before" capture), but the reviewer's primary interface for "what did the agent do?" is reactions, not snapshot navigation. Snapshots become an internal data store, not a top-level UI affordance.
- **The "Outdated" label as a primary signal.** A comment is outdated only if its anchor block is gone *and* there's no reaction. With a reaction present, the comment is "addressed," not "outdated" — the agent's summary tells the story.

### What reactions *enable*

- The side panel becomes the answer to "what's left." Counts: `3 awaiting reaction · 5 addressed · 2 won't fix`.
- The "Outdated" failure mode goes from common to rare. Most "outdated" comments today are actually "addressed but the system can't tell."
- Cross-conversation accountability: the reaction record is the artifact of the loop. It survives "End review" if we want it to.

---

## Part 5 — Concrete simplification proposal

Two PRs, in this order:

### PR 1 — Block-anchor comments via `data-source-line`

Scope:

- **Schema:** add `anchor: CommentAnchor` to `ReviewComment`. Keep `selected_text` as `fallback_text` for migration.
- **Migration:** on first read of an old comment, derive anchor at load time by running the current locator once, store it back. (Or: run a one-shot migration script — fine for a tool with few users.)
- **Capture:** on `mouseup`/click, find the `[data-source-line]` ancestor for both selection endpoints; if different, clamp to start (with a UI hint).
- **Render:** `useReviewHighlights` becomes a fraction of its current size. Find block by `[data-source-line="N"]`, hash-check, highlight a substring within, attach inline comment under that block. Drop `tryHighlightNormalized`, `insertCommentAtBestBlock`, the word-overlap scoring, and the multi-fallback ladder.
- **Outdated:** triggered only when `data-source-line` lookup fails *and* hash search across neighbors fails. Show as a quoted block in place, not pinned to a guessed best-block.

Estimated LOC delta: `useReviewHighlights.ts` shrinks from 705 to maybe 250.

### PR 2 — Reactions

Scope:

- **Schema:** add `CommentReaction`, list-of, per comment.
- **Server:** parse `<!-- changelog -->` blocks from the file body when the watcher fires a content update. For each `[<id>]`, look up the comment, capture before/after from the latest two snapshots that bracket the edit, write a reaction. (Strip the changelog block from the rendered output, or leave it — designer's call.)
- **API:** `POST /api/review/<id>/react`, `GET /api/review/<id>/reactions`. Lets agents call directly without going through the changelog.
- **UI:** side panel grows a "Reaction" sub-block per commented item. Word-diff inline. Bulk `Resolve all addressed` button.
- **Drop:** `findChangedBlocks` `✓ addressed` heuristic. Snapshot toolbar stays as-is (it's still useful as a manual time machine), but it's no longer the answer to "what got addressed?"

---

## Open Questions

1. **Block anchoring via `data-source-line` — does it survive the edits we actually see?**

   `data-source-line` is the source-markdown line. If the agent inserts a new paragraph above a commented one, the commented block's source line shifts by N. The hash check catches that (we don't trust the line; we use the line as a hint and verify by hash). But across a *rewrite* of the block, the hash changes too. Then we walk neighbors. How many neighbors? 5? 20? All?

   _Leaning:_ Walk ±10 source lines, then give up and mark outdated. 10 is enough for "agent inserted/deleted a paragraph or two"; beyond that, the doc has been restructured and a fuzzy match is misleading anyway.

   **Answer:**
   > Walk ±10 source lines by hash; if no match, mark outdated. Reviewer's call deferred to me — committing to this number.

2. **Multi-block selection — clamp or support?**

   Clamping is honest and one anchor. Support means storing `(start_line, end_line)` and rendering across both. Multi-block comments are rare in practice (Maya hit it once in 10 comments).

   _Leaning:_ Clamp. Show a one-time inline hint when the user makes a multi-block selection: "Comment will attach to the first paragraph." Don't block; don't reselect; just be honest.

   **Answer:**
   > Clamp.

3. **Does the changelog parser run server-side or client-side?**

   Server-side is more robust — runs even if no browser is open. Client-side avoids Python-side markdown parsing and keeps the watcher simple.

   _Leaning:_ Client-side, in the same `useEffect` that auto-snapshots. When `fileContent.content` changes and review is on, scan for `<!-- changelog -->` blocks, post reactions to the server. Server stays dumb storage.

   **Answer:**
   > Server-side. The watcher already sees every file change; parse changelog there and write reactions directly. The browser may be closed when the agent runs — reactions still need to be captured. Drop my client-side leaning.

4. **Does the agent need a direct `POST /react` endpoint, or is the changelog block enough?**

   The changelog is reliable and human-visible; agents already know how to write it. A REST endpoint is more elegant for agent-driven flows but is one more thing to wire up.

   _Leaning:_ Ship reactions with the changelog parser only. Add the REST/MCP endpoint later if Claude Code or another agent integration explicitly needs it.

   **Answer:**
   > Changelog block only — no REST endpoint, ever. The agent's job is to update markdown files; that's it. The changelog block *is* a markdown-file edit, so it fits the agent's contract. A `POST /react` endpoint would mean teaching the agent a second channel; that's out of scope. Implication: the changelog grammar (the `<!-- changelog -->` line + bullet `[<id>] <summary>`) is now load-bearing — design the parser to be strict and the clipboard prompt's example to be unambiguous.

   Today: marks `resolved: true`, hides from active list. With reactions, "Resolve" should specifically mean "I, the reviewer, accept the reaction." If there's no reaction, it's "I'm done with this comment for unrelated reasons."

   _Leaning:_ Two terms: `Resolve` (with reaction → accept agent's fix) and `Dismiss` (no reaction → just close). Both end up `resolved: true` but the reaction record distinguishes them.

   **Answer:**
   > Two buttons: `Resolve` (visible only when a reaction is attached — means "I accept the agent's fix") and `Dismiss` (visible when there's no reaction — means "I'm done with this comment, unrelated to any agent action"). Both set `resolved: true`; the presence/absence of a reaction record distinguishes them in the history.

6. **"End review" still nukes everything — fine, or split it?**

   If reactions are a record we want to keep, ending a review shouldn't delete them. But a reviewer who clicks "End" usually means "I'm done; clean up."

   _Leaning:_ Keep "End review" as destroy. Add a separate "Archive" button that preserves comments + reactions (read-only) for the file. Snapshot trail follows whatever the reactions need (the bracketing pair stays; older snapshots can be GC'd).

   **Answer:**
   > "End review" exists because the display goes bad — outdated comments, stale snapshots, visual noise. Once display is simplified (PR1) and reactions handle "what got addressed?" (PR2), there may be nothing to escape from. Plan: don't surface "End review" as a toolbar button anymore. Move it to a less prominent spot (side-panel footer, behind a small `…` menu) so it's available for the rare cleanup case but not the primary affordance. Re-evaluate after PR1+PR2 ship — if no one ever clicks it, drop it.

7. **Snapshot toolbar — keep, hide, or move?**

   With reactions, the toolbar is useful only for "I want to scrub through doc history" — a power-user gesture. New reviewers might not need to see it.

   _Leaning:_ Keep it visible only when there are ≥2 snapshots *and* the reviewer hovers a "History" affordance. Don't show it by default once reactions are the primary "what changed" UI.

   **Answer:**
   > Remove it. Reactions answer "what got addressed?" per-comment; snapshot scrubbing was a workaround for not having that. If a real need for time-travel surfaces later, add it back. Implication: PR2 deletes the snapshot toolbar UI. Snapshots remain as an internal data store (the changelog parser still needs a "before" capture to write `before_text`/`after_text`), but no chevrons, no `‹ N/M Live ›`, no "Viewing past revision" banner. `findChangedBlocks` and the `1/N` revision badge go too.

8. **Sub-block selection precision after the block changed — show original highlight or skip?**

   If the block matches by line but not by hash (re-anchor by neighbor walk), the stored `selection_offset` is invalid (text shifted). What do we render?

   _Leaning:_ Don't try to re-find the substring. Highlight the whole block faintly to show "this is where the comment lives now." The reviewer's reaction-flow doesn't need precise highlights anymore — the reaction has before/after.

   **Answer:**
   > Confirmed. When block matches by line but hash diverges (block was edited): highlight the whole block faintly, no substring. The reaction's before/after text carries the original wording.

<!-- changelog -->
- [87fb5d26] Q1 answered: walk ±10 source lines by hash, then mark outdated.
- [5250ff0e] Q2 answered: clamp multi-block selections to the first block.
- [fda837c8] Q3 answered: changelog parser runs server-side in the watcher; browser may not be open when the agent runs.
- [c33972ba] Q4 answered: changelog block only, no REST endpoint — the agent's contract is "update markdown files." Updated the leaning's "Implication" line: changelog grammar is now load-bearing.
- [Q5] Resolve (with reaction = accept) vs Dismiss (no reaction = just close); both flip `resolved: true`, the reaction record is the distinguisher.
- [c283b16c] Q6 answered: don't surface "End review" as a top-level button. Tuck it behind a side-panel `…` menu. Re-evaluate dropping it entirely after PR1+PR2 ship.
- [b458de56] Q7 answered: remove the snapshot toolbar in PR2. Snapshots survive as internal storage for reaction before/after; chevrons, "N/M Live" labels, and the changed-block badges go.
- [ea212b53] Q8 confirmed: faint whole-block highlight when hash diverges; no substring re-find.
