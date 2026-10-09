import { useEffect, type RefObject } from "react";
import type { ReviewComment } from "../types";
import { renderCommentMarkdown } from "../lib/commentMarkdown";
import {
  NEIGHBOR_RADIUS,
  blockAtLine,
  commentCardHost,
  findHashNeighbor,
  indexBlocks,
  rangeFromCanonicalOffsets,
} from "../lib/reviewAnchor";
import { revealCollapsedBlock } from "../lib/collapseSections";
import {
  closeHint,
  closesBox,
  statusText,
  STATUS_TICK_MS,
  type CommentBox,
} from "../lib/commentAutosave";
import {
  hasAgentReaction,
  isPendingForAgent,
  latestAgentReaction,
  useReviewStore,
} from "../stores/useReviewStore";

const MARK_ATTR = "data-review-comment-id";
/** Marks a thread entry with the id of the reviewer's reply it shows. */
const REPLY_ATTR = "data-review-reply-id";

/** `value` safe inside a double-quoted HTML attribute. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
const INLINE_COMMENT_ATTR = "data-review-inline-comment";

/** Minimum gap between arming the delete confirm and it accepting. */
const CONFIRM_MIN_MS = 350;

/** How long an armed delete stays armed. */
const DELETE_CONFIRM_MS = 3000;

/**
 * The comment whose inline delete is armed, if any. Module-level so it outlives
 * the teardown-and-rebuild the hook performs on every store write; the
 * timestamp expires it, so a stale arm cannot make a later click destructive.
 */
let armedDelete: { id: string; at: number } | null = null;

/**
 * Render review comments inline.  Comments are anchored to a block via
 * `data-source-line` (already added by `rehypeSourceLines`); the anchor
 * carries a hash of the canonicalized block text so we can detect drift
 * without comparing strings byte-for-byte.
 *
 * Algorithm per active comment:
 *
 * 1. Look up `[data-source-line="N"]` (where N = anchor.source_line).
 * 2. If found and the block's hash matches → highlight the canonical
 *    substring (or the whole block when selection_length=0) and attach
 *    an inline comment block beneath.
 * 3. If found but the hash diverges → faint whole-block highlight.  No
 *    substring re-find — the reaction's before/after carries the
 *    original wording (PR2).
 * 4. If not found → walk ±NEIGHBOR_RADIUS source lines looking for a
 *    block whose hash matches the anchor.  If found, re-anchor.
 * 5. Otherwise → the anchor is lost. Render the comment detached, after the
 *    closest still-present source line ≤ anchor.source_line, with a locator
 *    saying where it used to be — a neighborhood, stated as one, so it does
 *    not read as a comment on the block it happens to follow.
 *
 * The pre-PR2 fallback ladder (text-search, normalized text-search,
 * word-overlap "best block", and the ✓ addressed heuristic on snapshot
 * diffs) is gone.
 */
/**
 * Everything the inline surface can do.  Passed as one object so the inline
 * and sidebar surfaces stay at parity: adding a capability here surfaces it on
 * every inline comment block at once, rather than growing another positional
 * parameter that only some render paths remember to thread through.
 */
export interface InlineReviewActions {
  onDelete: (id: string) => void;
  /** Close without recording a reaction. */
  onDismiss: (id: string) => void;
  /** Reopen a resolved comment, no reply. */
  onReopen: (id: string) => void;
  /**
   * The box ✎ opens on `comment`, which saves its text as the reviewer types
   * (`lib/commentAutosave.ts`); `null` when there is nowhere to save to.
   */
  editBox: (comment: ReviewComment) => CommentBox | null;
  /**
   * The box Reply, or Reopen & Reply on a dismissed comment, opens; its first
   * save creates the reply and its later ones edit it.
   */
  replyBox: (comment: ReviewComment) => CommentBox | null;
  /** Copy this one comment's thread; resolves false if the clipboard refused. */
  onCopy: (id: string) => Promise<boolean>;
}

/**
 * `publishDrift` says whether this pass owns the review store's
 * `commentsDrifted`. Only the page's own document does: an embedded viewer
 * renders no comments, and publishing "none drifted" from it would clear the
 * flag the real document's pass had set.
 */
export function useReviewHighlights(
  containerRef: RefObject<HTMLDivElement | null>,
  comments: ReviewComment[],
  currentContent: string | null,
  actions: InlineReviewActions,
  publishDrift = true,
) {
  // Leaving the document — a navigation, or the viewer going away — closes
  // every box open in it, which saves what each holds.
  useEffect(() => {
    const el = containerRef.current;
    return () => {
      if (el) for (const open of boxesIn(el)) closeInlineBox(open);
    };
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.setAttribute(LAYER_ATTR, "");

    // The whole inline layer is torn down and rebuilt on every store write,
    // and a box's own saves are store writes, pushed to every tab. So the
    // boxes open in it are lifted out first, with where their focus, caret,
    // selection and scroll were, and put back into the rebuilt layer as the
    // same elements: the reviewer typing in one never notices a save
    // (docs/design/planning-to-do-list.md §6.1).
    const open = boxesIn(el);
    const held = open.map(liftBox);
    const heldResolved = new Set(
      open.filter((b) => b.heldResolved).map((b) => b.commentId),
    );

    rebuildLayer(el, comments, actions, publishDrift, heldResolved);

    for (const lifted of held) putBoxBack(el, lifted);
  }, [containerRef, comments, currentContent, actions, publishDrift]);
}

/**
 * Tear the comment layer in `el` down and build it again from `comments`.
 * `heldResolved` names comments drawn among the dismissed ones whatever they
 * are now: a reply box opened on a dismissed comment reopens it with its first
 * save, and moving the comment would move the box being typed in.
 */
function rebuildLayer(
  el: HTMLElement,
  comments: ReviewComment[],
  actions: InlineReviewActions,
  publishDrift: boolean,
  heldResolved: ReadonlySet<string>,
): void {
  {
    // An arm belongs to one comment in one document. Drop it as soon as that
    // comment is gone — deleted, or left behind by a file switch — so it cannot
    // be restored onto a later render of something else.
    if (armedDelete && !comments.some((c) => c.id === armedDelete?.id)) {
      armedDelete = null;
    }

    // Clean up previous marks by unwrapping them. Not by replacing each with a
    // text node of its `textContent`: a selection can span a whole link, and
    // flattening it turned the link into plain text — and the planning badge
    // beside it into words of the block, which changed the block's hash and
    // drifted every comment on it (docs/reference/planning-index.md §5.3).
    el.querySelectorAll(`mark[${MARK_ATTR}]`).forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
      }
    });

    // Clean up previous inline comment blocks
    el.querySelectorAll(`[${INLINE_COMMENT_ATTR}]`).forEach((node) => {
      node.remove();
    });

    // Clean up previous block-level review classes
    el.querySelectorAll(
      ".review-highlight-block, .review-highlight-block-divergent",
    ).forEach((node) => {
      node.classList.remove(
        "review-highlight-block",
        "review-highlight-block-divergent",
      );
    });

    // Anchor resolution below decides, per comment, whether the block it points
    // at still holds the text the reviewer commented on. That answer is the only
    // trustworthy basis for "the document changed under the comments", so it is
    // published from here rather than recomputed elsewhere. Only comments still
    // waiting on the agent count: drift under an answered or dismissed comment is
    // nothing for the reviewer to act on.
    const drifted = new Set<string>();
    const reportDrift = () => {
      if (!publishDrift) return;
      useReviewStore
        .getState()
        .setCommentsDrifted(
          comments.some((c) => drifted.has(c.id) && isPendingForAgent(c)),
        );
    };

    if (comments.length === 0) {
      reportDrift();
      return;
    }

    const shownResolved = (c: ReviewComment) =>
      !!c.resolved || heldResolved.has(c.id);
    const active = comments.filter((c) => !shownResolved(c));
    const resolved = comments.filter(shownResolved);

    // Resolved comments are rendered (collapsed) rather than reduced to a bare
    // count: without them the inline surface offers no way to read a finished
    // thread, reopen it, or delete it, so the sidebar became mandatory.
    if (resolved.length > 0) {
      insertResolvedSection(el, resolved, actions);
    }

    if (active.length === 0) {
      reportDrift();
      return;
    }

    // Tag every block once with data-block-hash so the neighbor walk
    // can do synchronous lookups.  Skips containers we never anchor on.
    const blocks = indexBlocks(el);

    for (const comment of active) {
      const anchor = comment.anchor;
      if (!anchor) {
        // Legacy comment with no anchor — render as outdated at top. Not counted
        // as drift: with no recorded hash there is nothing to compare, so the
        // document may be untouched since the comment was written. Saying
        // "changed" here would be the guess this signal exists to avoid.
        console.warn(
          "[review] comment %s has no anchor — rendering as outdated. comment:",
          comment.id.slice(0, 8),
          comment,
        );
        insertOutdatedComment(el, comment, actions);
        continue;
      }

      let block = blockAtLine(
        blocks,
        anchor.source_line,
        anchor.block_text_hash,
      );
      let divergent = false;
      let matchedByHash = false;

      if (block) {
        const currentHash = block.getAttribute("data-block-hash") || "";
        if (currentHash === anchor.block_text_hash) {
          matchedByHash = true;
        } else {
          divergent = true;
          console.warn(
            "[review] comment %s: hash mismatch at line %d. anchor=%s current=%s",
            comment.id.slice(0, 8),
            anchor.source_line,
            anchor.block_text_hash,
            currentHash,
          );
        }
      } else {
        console.warn(
          "[review] comment %s: no block found at source_line=%d (blocksByLine has %d lines)",
          comment.id.slice(0, 8),
          anchor.source_line,
          blocks.byLine.size,
        );
      }

      if (!block || (divergent && !matchedByHash)) {
        // Hash didn't match at the recorded line — try neighbor walk.
        const neighbor = findHashNeighbor(
          blocks,
          anchor.block_text_hash,
          anchor.source_line,
          NEIGHBOR_RADIUS,
        );
        if (neighbor) {
          block = neighbor;
          divergent = false;
          matchedByHash = true;
        }
      }

      if (!block) {
        // No block at line, no hash neighbor — outdated. The commented text is
        // not merely different, it is gone: drift in its strongest form.
        drifted.add(comment.id);
        console.warn(
          "[review] comment %s: OUTDATED — no block at line %d, no hash neighbor for %s",
          comment.id.slice(0, 8),
          anchor.source_line,
          anchor.block_text_hash,
        );
        insertOutdatedComment(
          el,
          comment,
          actions,
          findClosestPriorBlock(blocks.byLine, anchor.source_line),
        );
        continue;
      }

      if (matchedByHash && anchor.selection_length > 0) {
        const range = rangeFromCanonicalOffsets(
          block,
          anchor.selection_offset,
          anchor.selection_length,
        );
        if (range) {
          try {
            const mark = document.createElement("mark");
            mark.setAttribute(MARK_ATTR, comment.id);
            mark.className = "review-highlight";
            range.surroundContents(mark);
          } catch {
            // surroundContents fails when the range crosses element
            // boundaries (e.g. inline `<code>`).  Fall back to
            // whole-block highlight — communicates honestly that we
            // couldn't pin down the substring.
            block.classList.add("review-highlight-block");
          }
        } else {
          block.classList.add("review-highlight-block");
        }
      } else if (matchedByHash) {
        // Whole-block anchor (no substring).
        block.classList.add("review-highlight-block");
      } else if (divergent) {
        // Same line, different content (Q8: faint, no substring re-find). The
        // text the reviewer commented on has been rewritten in place — drift.
        //
        // Note the neighbor walk above clears `divergent` when it finds the
        // original text a few lines away: a block that only *moved* still says
        // what the comment is about, so that is not drift.
        drifted.add(comment.id);
        block.classList.add("review-highlight-block-divergent");
      }

      // An unresolved comment inside a collapsed section opens it. The card is
      // inserted as a sibling of the block and carries no collapsed attribute of
      // its own, so leaving the section shut would strand a comment about text
      // that is not rendered — and every jump to it, from the panel or the
      // stripe, would land on a zero-height box.
      //
      // Done here rather than at each jump because there are four of them (the
      // panel, the stripe, a `#L42`, a hash link) and this pass is what every one
      // of them lands in. The cost is that closing such a section by hand does
      // not survive the next store write, which re-runs this pass: an open
      // section is the recoverable state, an invisible comment is not.
      revealCollapsedBlock(block);
      insertInlineCommentAfter(block, comment, actions, divergent);
    }

    reportDrift();
  }
}

/** Closest block whose source-line ≤ target — anchor for outdated rendering. */
function findClosestPriorBlock(
  blocksByLine: Map<number, HTMLElement[]>,
  targetLine: number,
): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLine = -Infinity;
  for (const [line, blocks] of blocksByLine) {
    if (line <= targetLine && line > bestLine) {
      bestLine = line;
      best = blocks[blocks.length - 1];
    }
  }
  return best;
}

/**
 * A comment card inserted *inside* a toned section joins that section's run.
 *
 * The card lands as a sibling between two stamped blocks, and the section's
 * vertical rule is drawn per member and bled upward by a fixed 2.5rem
 * (`packages/vantage-md/src/styles/directives.css`). A comment card is much
 * taller than that, so without this the rule breaks for the height of every
 * card — the tone reads as two sections instead of one.
 *
 * Only a card that really is between two members joins. `start` and `middle`
 * both have a member below them; after an `end` — or a lone `only` block, which
 * has no run at all — a stamped card would hang the rule *below* the section it
 * belongs to, which is worse than the gap it would close.
 */
function joinToneRun(blockEl: HTMLElement, wrapper: HTMLElement) {
  const tone = blockEl.getAttribute("data-vantage-tone");
  const run = blockEl.getAttribute("data-vantage-run");
  if (tone === null || (run !== "start" && run !== "middle")) return;
  wrapper.setAttribute("data-vantage-tone", tone);
  wrapper.setAttribute("data-vantage-run", "middle");
}

function insertInlineCommentAfter(
  blockEl: HTMLElement,
  comment: ReviewComment,
  actions: InlineReviewActions,
  divergent: boolean,
) {
  const wrapper = createCommentBlock(comment, actions, divergent);
  const host = commentCardHost(blockEl);
  joinToneRun(host, wrapper);
  if (host.nextSibling) {
    host.parentNode!.insertBefore(wrapper, host.nextSibling);
  } else {
    host.parentNode!.appendChild(wrapper);
  }
}

function insertOutdatedComment(
  container: HTMLElement,
  comment: ReviewComment,
  actions: InlineReviewActions,
  anchorBlock: HTMLElement | null = null,
) {
  const wrapper = createOutdatedBlock(comment, actions);
  const host = anchorBlock ? commentCardHost(anchorBlock) : null;
  if (host?.parentNode) {
    joinToneRun(host, wrapper);
    if (host.nextSibling) {
      host.parentNode.insertBefore(wrapper, host.nextSibling);
    } else {
      host.parentNode.appendChild(wrapper);
    }
    return;
  }
  if (container.firstChild) {
    container.insertBefore(wrapper, container.firstChild);
  } else {
    container.appendChild(wrapper);
  }
}

/**
 * The action row shared by every inline comment variant.  Building it in one
 * place is what keeps the anchored, outdated, and resolved renderings at
 * parity — they previously drifted, leaving orphaned comments with no way to
 * be edited or deleted without opening the sidebar.
 */
function actionRowHtml(comment: ReviewComment): string {
  const answered = hasAgentReaction(comment);
  const buttons: string[] = [];

  if (comment.resolved) {
    buttons.push(
      `<button class="review-inline-comment-reopen" title="Reopen this comment">Reopen</button>`,
      `<button class="review-inline-comment-reply" title="Reopen and reply">Reopen &amp; Reply</button>`,
    );
  } else {
    // Copy is offered for anything still owed to the agent, matching the
    // sidebar and toolbar Copy counts exactly.
    if (isPendingForAgent(comment)) {
      buttons.push(
        `<button class="review-inline-comment-copy" title="Copy this comment thread to send back to the agent">Copy</button>`,
      );
    }
    // One Dismiss button, one action. There used to be two, both labeled
    // "Dismiss": on an answered comment it silently meant *accept* and wrote a
    // reviewer turn into the thread, which reopening did not retract — so
    // dismiss/reopen/dismiss stacked up "Accepted" rows nobody asked for.
    // Dismissing is a flag on the comment, never a turn in the conversation.
    if (answered) {
      buttons.push(
        `<button class="review-inline-comment-reply" title="Reply">Reply</button>`,
      );
    }
    buttons.push(
      `<button class="review-inline-comment-dismiss" title="Dismiss comment">Dismiss</button>`,
    );
    buttons.push(
      `<button class="review-inline-comment-edit" title="Edit comment">&#x270E;</button>`,
    );
  }

  buttons.push(
    `<button class="review-inline-comment-delete" title="Delete comment">&times;</button>`,
  );
  return `<div class="review-inline-comment-actions">${buttons.join("")}</div>`;
}

/**
 * The status badge shared by every inline comment renderer.
 *
 * This reports **turn state only** — who the thread is waiting on. It says
 * nothing about whether the anchor still resolves, which is a separate fact
 * expressed by placement and the detached header. The two used to be welded
 * together: the badge lived solely inside the orphan renderer, so an answered
 * comment whose anchor still resolved showed no status at all, while "the
 * anchor is gone" and "the agent addressed this" appeared in the same slot.
 *
 * A comment still waiting on the agent gets no badge — that is the default
 * state, and the Copy button already marks it.
 */
function statusBadgeHtml(comment: ReviewComment): string {
  let label = "";
  if (comment.resolved) {
    label = "Dismissed";
  } else if (hasAgentReaction(comment) && !isPendingForAgent(comment)) {
    label =
      latestAgentReaction(comment)?.kind === "wont_fix"
        ? "Declined"
        : "Addressed";
  }
  if (!label) return "";
  const mod = label.toLowerCase();
  return `<div class="review-status-badge review-status-badge--${mod}">${label}</div>`;
}

/** Render an inline comment block.  Resolve/Dismiss is reaction-aware. */
function createCommentBlock(
  comment: ReviewComment,
  actions: InlineReviewActions,
  divergent: boolean,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.setAttribute(INLINE_COMMENT_ATTR, comment.id);
  wrapper.className = divergent
    ? "review-inline-comment review-inline-comment--divergent"
    : "review-inline-comment";

  wrapper.innerHTML = `
    <div class="review-inline-comment-body">
      <span class="review-inline-comment-icon" title="Review comment">&#x1f4ac;</span>
      <div class="review-inline-comment-content">
        ${statusBadgeHtml(comment)}
        <div class="review-inline-comment-text"></div>
        ${renderThreadHtml(comment)}
      </div>
      ${actionRowHtml(comment)}
    </div>
  `;

  const textEl = wrapper.querySelector(".review-inline-comment-text");
  if (textEl) textEl.innerHTML = renderCommentMarkdown(comment.comment);

  populateThreadSummaries(wrapper, comment);
  wireCommentButtons(wrapper, comment, actions);
  return wrapper;
}

/**
 * Render a comment whose anchor no longer resolves.
 *
 * It is placed after the nearest surviving block above where it was written,
 * which is a neighborhood and not a position — so the block states that
 * outright ("was near line N · original text no longer found") rather than
 * sitting silently where it would read as a comment on the block above it.
 *
 * The quoted selection is NOT struck through. It is `fallback_text`: the text
 * the reviewer chose to comment on, and the record of what they meant. Striking
 * it read as retracted, when in practice the text is usually still in the
 * document, merely reworded or moved past the point the anchor could follow.
 */
function createOutdatedBlock(
  comment: ReviewComment,
  actions: InlineReviewActions,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.setAttribute(INLINE_COMMENT_ATTR, comment.id);
  wrapper.className = "review-inline-comment review-inline-comment--outdated";

  const line = comment.anchor?.source_line;
  const locator =
    line != null
      ? `was near line ${line} &middot; original text no longer found`
      : `original text no longer found`;

  wrapper.innerHTML = `
    <div class="review-inline-comment-body review-inline-comment-body--outdated">
      <div class="review-inline-comment-content">
        ${statusBadgeHtml(comment)}
        <div class="review-detached-locator">${locator}</div>
        <div class="review-outdated-quote"></div>
        <div class="review-inline-comment-text"></div>
        ${renderThreadHtml(comment)}
      </div>
      ${actionRowHtml(comment)}
    </div>
  `;
  const quoteEl = wrapper.querySelector(".review-outdated-quote");
  if (quoteEl)
    quoteEl.textContent = comment.fallback_text || comment.selected_text || "";
  const textEl = wrapper.querySelector(".review-inline-comment-text");
  if (textEl) textEl.innerHTML = renderCommentMarkdown(comment.comment);

  populateThreadSummaries(wrapper, comment);
  wireCommentButtons(wrapper, comment, actions);
  return wrapper;
}

function wireCommentButtons(
  wrapper: HTMLElement,
  comment: ReviewComment,
  actions: InlineReviewActions,
) {
  const { onDelete, onDismiss, onReopen, onCopy } = actions;

  const simple: Array<[string, () => void]> = [
    [".review-inline-comment-dismiss", () => onDismiss(comment.id)],
    [".review-inline-comment-reopen", () => onReopen(comment.id)],
  ];
  for (const [selector, run] of simple) {
    const btn = wrapper.querySelector(selector);
    if (!btn) continue;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      run();
    });
  }

  // Delete is two-click, matching the sidebar: it discards the agent's replies
  // along with the comment, and there is no undo.
  const deleteBtn = wrapper.querySelector(".review-inline-comment-delete");
  if (deleteBtn) {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const paintDisarmed = () => {
      deleteBtn.textContent = "×";
      deleteBtn.classList.remove("review-inline-comment-delete--armed");
      deleteBtn.setAttribute("title", "Delete comment");
    };

    // When this button is armed, and since when. The clock is consulted here
    // rather than trusting the timer to have fired: a starved or throttled
    // timer would otherwise leave a button that reads "×" but still deletes on
    // a single click.
    const armedSince = (): number | null => {
      if (armedDelete?.id !== comment.id) return null;
      if (Date.now() - armedDelete.at >= DELETE_CONFIRM_MS) return null;
      return armedDelete.at;
    };

    const paintArmed = (at: number) => {
      deleteBtn.textContent = "Delete?";
      deleteBtn.classList.add("review-inline-comment-delete--armed");
      deleteBtn.setAttribute(
        "title",
        "Click again to delete this comment and its replies",
      );
      if (timer) clearTimeout(timer);
      // The remaining window, not a fresh one — a rebuild must not extend the
      // confirm indefinitely while the agent writes.
      timer = setTimeout(
        () => {
          // A rebuilt copy of this button owns the arm now; this one is
          // detached and must not retire it.
          if (!deleteBtn.isConnected) return;
          // Retire only the arm this timer was scheduled for; a later arm on the
          // same comment owns itself.
          if (armedDelete?.id === comment.id && armedDelete.at === at) {
            armedDelete = null;
          }
          paintDisarmed();
        },
        Math.max(0, DELETE_CONFIRM_MS - (Date.now() - at)),
      );
    };

    // Restore an arm that survived a rebuild. The inline layer is torn down on
    // every store write — which the agent fires constantly — so without this
    // the button silently reverts between the reviewer's two clicks and delete
    // reads as broken.
    const restored = armedSince();
    if (restored !== null) paintArmed(restored);

    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const at = armedSince();
      if (at !== null) {
        // A physical double-click delivers two clicks; without the floor it
        // would arm and fire in one gesture, defeating the guard.
        if (Date.now() - at < CONFIRM_MIN_MS) return;
        armedDelete = null;
        if (timer) clearTimeout(timer);
        timer = null;
        paintDisarmed();
        onDelete(comment.id);
        return;
      }
      // Only one comment is ever armed, so any button still painted armed from
      // a previous arm must be reset — otherwise two read "Delete?" at once and
      // clicking the stale one looks like it will delete when it only re-arms.
      for (const stale of document.querySelectorAll(
        ".review-inline-comment-delete--armed",
      )) {
        stale.textContent = "×";
        stale.classList.remove("review-inline-comment-delete--armed");
        stale.setAttribute("title", "Delete comment");
      }
      armedDelete = { id: comment.id, at: Date.now() };
      paintArmed(armedDelete.at);
    });
  }

  const copyBtn = wrapper.querySelector(".review-inline-comment-copy");
  if (copyBtn) {
    copyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await onCopy(comment.id);
      // The copy leaves the store untouched, so this element survives; report
      // the outcome on it rather than letting a clipboard refusal look like a
      // dead button.
      copyBtn.textContent = ok ? "Copied!" : "Copy failed";
      copyBtn.classList.add("review-inline-comment-copy--done");
      setTimeout(() => {
        copyBtn.textContent = "Copy";
        copyBtn.classList.remove("review-inline-comment-copy--done");
      }, 2000);
    });
  }

  // Reply, and Reopen & Reply on a dismissed comment, open the reply box; ✎
  // opens the edit box. Each saves as the reviewer types (`InlineBox`).
  for (const btn of wrapper.querySelectorAll(".review-inline-comment-reply")) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openInlineBox("reply", wrapper, comment, actions);
    });
  }
  const editBtn = wrapper.querySelector(".review-inline-comment-edit");
  if (editBtn) {
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openInlineBox("edit", wrapper, comment, actions);
    });
  }
}

function renderThreadHtml(comment: ReviewComment): string {
  const reactions = comment.reactions ?? [];
  if (reactions.length === 0) return "";

  let html = '<div class="review-thread">';
  for (let i = 0; i < reactions.length; i++) {
    const r = reactions[i];
    // Legacy "noted" turns are skipped: they recorded a dismissal made through
    // a since-removed accept action, and dismissing is a flag on the comment,
    // not something the reviewer said. `data-thread-idx` keeps the raw index so
    // [populateThreadSummaries] still pairs each badge with its own summary
    // across the gap.
    if (r.kind === "noted") continue;
    const [cls, label] =
      r.actor === "agent"
        ? ["agent", r.kind === "wont_fix" ? "Agent declined" : "Agent"]
        : ["reviewer", "You"];
    const badge = `<span class="review-thread-badge review-thread-badge--${cls}">${label}</span>`;
    // A reply's id marks its entry, which an open reply box hides while it
    // is still editing that reply.
    const reply = r.id ? ` ${REPLY_ATTR}="${escapeAttr(r.id)}"` : "";
    html += `<div class="review-thread-entry" data-thread-idx="${i}"${reply}>${badge}<span class="review-thread-text"></span></div>`;
  }
  html += "</div>";
  return html;
}

function populateThreadSummaries(
  wrapper: HTMLElement,
  comment: ReviewComment,
): void {
  const reactions = comment.reactions ?? [];
  const entries = wrapper.querySelectorAll(".review-thread-entry");
  // Keyed by data-thread-idx, not by position: [renderThreadHtml] skips legacy
  // "noted" turns, so the Nth rendered entry is not necessarily the Nth
  // reaction. Pairing positionally would put each summary under the wrong
  // speaker's badge.
  for (const entry of entries) {
    const idx = Number.parseInt(
      entry.getAttribute("data-thread-idx") ?? "",
      10,
    );
    const r = Number.isFinite(idx) ? reactions[idx] : undefined;
    if (!r) continue;
    const textEl = entry.querySelector(".review-thread-text");
    if (textEl) textEl.innerHTML = renderCommentMarkdown(r.summary);
  }
}

/**
 * Resolved comments, collapsed behind a toggle at the top of the document.
 * The bar used to be a bare count with no handler, which meant a resolved
 * thread could not be read, reopened, or deleted from the document at all —
 * the sidebar was the only way back. The open/closed state is kept in
 * `resolvedSectionOpen` so it survives the full teardown-and-rebuild that
 * every store write performs.
 */
function insertResolvedSection(
  container: HTMLElement,
  resolved: ReviewComment[],
  actions: InlineReviewActions,
) {
  const section = document.createElement("div");
  section.className = "review-resolved-section";
  section.setAttribute(INLINE_COMMENT_ATTR, "__resolved__");

  const count = resolved.length;
  const bar = document.createElement("button");
  bar.className = "review-resolved-indicator";
  bar.type = "button";
  bar.innerHTML = `
    <span class="review-resolved-indicator-icon">✓</span>
    <span class="review-resolved-indicator-text">${count} dismissed comment${count !== 1 ? "s" : ""}</span>
    <span class="review-resolved-indicator-caret">${resolvedSectionOpen ? "▾" : "▸"}</span>
  `;

  const list = document.createElement("div");
  list.className = "review-resolved-list";
  if (!resolvedSectionOpen) list.style.display = "none";
  for (const comment of resolved) {
    const block = createCommentBlock(comment, actions, false);
    block.classList.add("review-inline-comment--resolved");
    list.appendChild(block);
  }

  bar.addEventListener("click", (e) => {
    e.stopPropagation();
    resolvedSectionOpen = !resolvedSectionOpen;
    list.style.display = resolvedSectionOpen ? "" : "none";
    const caret = bar.querySelector(".review-resolved-indicator-caret");
    if (caret) caret.textContent = resolvedSectionOpen ? "▾" : "▸";
  });

  section.appendChild(bar);
  section.appendChild(list);

  if (container.firstChild) {
    container.insertBefore(section, container.firstChild);
  } else {
    container.appendChild(section);
  }
}

/** Whether the resolved-comments section is expanded; survives re-renders. */
let resolvedSectionOpen = false;

/** Marks the element a hook's comment layer is drawn in. */
const LAYER_ATTR = "data-review-layer";

/**
 * An inline edit or reply box open in a document's comment layer: a textarea
 * and its foot, saving through `box` as the reviewer types
 * (`lib/commentAutosave.ts`). The element is built once and kept for the
 * box's life, and every rebuild of the layer puts that same element back into
 * its comment's new card, so a save never costs the reviewer their place.
 */
interface InlineBox {
  kind: "edit" | "reply";
  commentId: string;
  /**
   * Opened on a dismissed comment, so it is drawn among the dismissed ones
   * until it closes, though its first save reopens the comment.
   */
  heldResolved: boolean;
  /** The comment layer it is open in. */
  host: HTMLElement;
  el: HTMLElement;
  textarea: HTMLTextAreaElement;
  box: CommentBox;
  /** Stop following the box: its foot's subscription and clock. */
  stop: () => void;
}

/** Every inline box open, by kind and comment. */
const inlineBoxes = new Map<string, InlineBox>();

const boxKey = (kind: InlineBox["kind"], commentId: string) =>
  `${kind}:${commentId}`;

function boxesIn(host: HTMLElement): InlineBox[] {
  return [...inlineBoxes.values()].filter((b) => b.host === host);
}

/** Open the `kind` box on `comment`'s card, or focus the one already open. */
function openInlineBox(
  kind: InlineBox["kind"],
  wrapper: HTMLElement,
  comment: ReviewComment,
  actions: InlineReviewActions,
): void {
  const existing = inlineBoxes.get(boxKey(kind, comment.id));
  if (existing) {
    existing.textarea.focus();
    return;
  }
  const host = wrapper.closest<HTMLElement>(`[${LAYER_ATTR}]`);
  if (!host) return;
  const box =
    kind === "edit" ? actions.editBox(comment) : actions.replyBox(comment);
  if (!box) return;

  const el = document.createElement("div");
  el.className = "review-inline-box";
  const textarea = document.createElement("textarea");
  textarea.className =
    kind === "edit" ? "review-inline-edit-area" : "review-inline-reply-area";
  textarea.rows = kind === "edit" ? 3 : 2;
  if (kind === "reply") textarea.placeholder = "Write a reply…";
  textarea.value = box.getState().text;
  const foot = buildFoot(box);
  el.append(textarea, foot.el);

  const entry: InlineBox = {
    kind,
    commentId: comment.id,
    heldResolved: kind === "reply" && !!comment.resolved,
    host,
    el,
    textarea,
    box,
    stop: foot.stop,
  };
  textarea.addEventListener("input", () => box.input(textarea.value));
  textarea.addEventListener("keydown", (ev) => {
    if (closesBox(ev)) {
      ev.preventDefault();
      ev.stopPropagation();
      closeInlineBox(entry);
    }
  });
  foot.close.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeInlineBox(entry);
  });
  // A click in the box is the reviewer's own, never one for the card under it.
  el.addEventListener("click", (ev) => ev.stopPropagation());

  inlineBoxes.set(boxKey(kind, comment.id), entry);
  box.open();
  attachBox(wrapper, entry);
  textarea.focus();
}

/**
 * Close an inline box: the box saves what it holds and goes on retrying if it
 * must, and the card shows its comment or reply again.
 */
function closeInlineBox(entry: InlineBox): void {
  if (inlineBoxes.get(boxKey(entry.kind, entry.commentId)) !== entry) return;
  inlineBoxes.delete(boxKey(entry.kind, entry.commentId));
  entry.stop();
  entry.box.close();
  const wrapper = entry.el.parentElement?.closest<HTMLElement>(
    `[${INLINE_COMMENT_ATTR}]`,
  );
  entry.el.remove();
  if (!wrapper) return;
  const typed = entry.box.typed;
  if (entry.kind === "edit") {
    const textEl = wrapper.querySelector<HTMLElement>(
      ".review-inline-comment-text",
    );
    if (textEl) {
      // What was typed is what the comment says now, though its save may
      // still be on its way; the next rebuild draws what the server holds.
      if (typed) textEl.innerHTML = renderCommentMarkdown(typed);
      textEl.style.display = "";
    }
  } else {
    const replyId = entry.box.subject.replyId;
    const shown = replyId
      ? wrapper.querySelector<HTMLElement>(`[${REPLY_ATTR}="${replyId}"]`)
      : null;
    if (shown) shown.style.display = "";
  }
}

/**
 * Put an inline box into `wrapper`, its comment's card: an edit box in place
 * of the comment's text, a reply box at the foot of the thread, in place of
 * the reply it has saved, which it is still editing.
 */
function attachBox(wrapper: HTMLElement, entry: InlineBox): boolean {
  if (entry.kind === "edit") {
    const textEl = wrapper.querySelector<HTMLElement>(
      ".review-inline-comment-text",
    );
    if (!textEl?.parentNode) return false;
    textEl.style.display = "none";
    textEl.parentNode.insertBefore(entry.el, textEl.nextSibling);
    return true;
  }
  const content = wrapper.querySelector(".review-inline-comment-content");
  if (!content) return false;
  const replyId = entry.box.subject.replyId;
  const shown = replyId
    ? wrapper.querySelector<HTMLElement>(`[${REPLY_ATTR}="${replyId}"]`)
    : null;
  if (shown) shown.style.display = "none";
  content.appendChild(entry.el);
  return true;
}

/** An inline box lifted out of the layer for a rebuild, and where its reader was. */
interface LiftedBox {
  entry: InlineBox;
  focused: boolean;
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
  scrollTop: number;
}

function liftBox(entry: InlineBox): LiftedBox {
  const { textarea } = entry;
  const lifted: LiftedBox = {
    entry,
    focused: document.activeElement === textarea,
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
    direction: textarea.selectionDirection ?? "none",
    scrollTop: textarea.scrollTop,
  };
  entry.el.remove();
  return lifted;
}

/**
 * Put a lifted box back into its comment's rebuilt card, with its focus,
 * caret, selection and scroll as they were. A comment that is gone from the
 * layer — deleted elsewhere, or no longer shown — closes its box, which keeps
 * the text.
 */
function putBoxBack(host: HTMLElement, lifted: LiftedBox): void {
  const { entry } = lifted;
  const wrapper = host.querySelector<HTMLElement>(
    `[${INLINE_COMMENT_ATTR}="${CSS.escape(entry.commentId)}"]`,
  );
  if (!wrapper || !attachBox(wrapper, entry)) {
    closeInlineBox(entry);
    return;
  }
  const { textarea } = entry;
  if (lifted.focused) textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(lifted.start, lifted.end, lifted.direction);
  textarea.scrollTop = lifted.scrollTop;
}

/**
 * A box's foot, built by hand like the rest of the layer, with the classes and
 * words of the React one (`components/CommentBoxFields.tsx`): the hint, where
 * the box's saves stand, and Close.
 */
function buildFoot(box: CommentBox): {
  el: HTMLElement;
  close: HTMLButtonElement;
  stop: () => void;
} {
  const wrap = document.createElement("div");
  const el = document.createElement("div");
  el.className = "comment-box-foot";
  const hint = document.createElement("span");
  hint.className = "comment-box-hint";
  hint.textContent = closeHint();
  const status = document.createElement("span");
  status.className = "comment-box-status";
  status.setAttribute("role", "status");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "comment-box-close";
  close.textContent = "Close";
  el.append(hint, status, close);

  // Once the box's comment is gone: Copy text and Post as a new comment, as
  // the React foot offers them (`GoneActions`).
  const goneRow = document.createElement("div");
  goneRow.className = "comment-box-foot";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "comment-box-close";
  copy.textContent = "Copy text";
  const post = document.createElement("button");
  post.type = "button";
  post.className = "comment-box-close";
  post.textContent = "Post as a new comment";
  goneRow.append(copy, post);
  copy.addEventListener("click", (ev) => {
    ev.stopPropagation();
    void box.copyText().then((ok) => {
      copy.textContent = ok ? "Copied" : "Copy failed";
    });
  });
  post.addEventListener("click", (ev) => {
    ev.stopPropagation();
    box.postAsNew();
  });
  wrap.append(el);

  let saves = box.getState().saves;
  const paint = () => {
    const state = box.getState();
    const gone = state.status === "gone";
    status.textContent = statusText(state, Date.now());
    status.classList.toggle(
      "comment-box-status--retrying",
      state.status === "retrying" || gone,
    );
    if (gone && !goneRow.isConnected) wrap.append(goneRow);
    if (!gone && goneRow.isConnected) goneRow.remove();
    post.style.display = state.canPost ? "" : "none";
    if (state.saves !== saves) {
      saves = state.saves;
      // Once for each save that lands: off, a reflow, and on again restarts it.
      status.classList.remove("comment-box-status--pulse");
      void status.offsetWidth;
      status.classList.add("comment-box-status--pulse");
    }
  };
  paint();
  const unsubscribe = box.subscribe(paint);
  const tick = setInterval(paint, STATUS_TICK_MS);
  return {
    el: wrap,
    close,
    stop: () => {
      unsubscribe();
      clearInterval(tick);
    },
  };
}

// Used by stripBlockText callers that also want a hash for the same text.
// Kept here so consumers don't need to import both helpers separately.
export { hashBlockText, stripBlockText } from "../lib/reviewAnchor";
