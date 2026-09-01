import { useEffect, type RefObject } from "react";
import type { ReviewComment } from "../types";
import { renderCommentMarkdown } from "../lib/commentMarkdown";
import {
  ANCHORABLE_BLOCK_SELECTOR,
  blockVisibleText,
  hashBlockText,
  rangeFromCanonicalOffsets,
} from "../lib/reviewAnchor";
import { revealCollapsedBlock } from "../lib/collapseSections";
import {
  hasAgentReaction,
  isPendingForAgent,
  latestAgentReaction,
  useReviewStore,
} from "../stores/useReviewStore";

const MARK_ATTR = "data-review-comment-id";
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

/** Max ±source_line distance for the neighbor walk before marking outdated. */
const NEIGHBOR_RADIUS = 10;

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
  onEdit: (id: string, newComment: string) => void;
  onReply: (id: string, replyText: string) => void;
  /** Copy this one comment's thread; resolves false if the clipboard refused. */
  onCopy: (id: string) => Promise<boolean>;
}

export function useReviewHighlights(
  containerRef: RefObject<HTMLDivElement | null>,
  comments: ReviewComment[],
  currentContent: string | null,
  actions: InlineReviewActions,
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // The whole inline layer is torn down and rebuilt on every store write, so
    // an open reply/edit box would lose whatever the reviewer had typed —
    // including when their own keystroke-adjacent action triggers the redraw.
    // Capture drafts first and restore them after the rebuild.
    const drafts = captureDrafts(el);

    // An arm belongs to one comment in one document. Drop it as soon as that
    // comment is gone — deleted, or left behind by a file switch — so it cannot
    // be restored onto a later render of something else.
    if (armedDelete && !comments.some((c) => c.id === armedDelete?.id)) {
      armedDelete = null;
    }

    // Clean up previous marks
    el.querySelectorAll(`mark[${MARK_ATTR}]`).forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(
          document.createTextNode(mark.textContent || ""),
          mark,
        );
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
    const publishDrift = () => {
      useReviewStore
        .getState()
        .setCommentsDrifted(
          comments.some((c) => drifted.has(c.id) && isPendingForAgent(c)),
        );
    };

    if (comments.length === 0) {
      publishDrift();
      return;
    }

    const active = comments.filter((c) => !c.resolved);
    const resolved = comments.filter((c) => c.resolved);

    // Resolved comments are rendered (collapsed) rather than reduced to a bare
    // count: without them the inline surface offers no way to read a finished
    // thread, reopen it, or delete it, so the sidebar became mandatory.
    if (resolved.length > 0) {
      insertResolvedSection(el, resolved, actions);
    }

    if (active.length === 0) {
      publishDrift();
      restoreDrafts(el, drafts);
      return;
    }

    // Tag every block once with data-block-hash so the neighbor walk
    // can do synchronous lookups.  Skips containers we never anchor on.
    const allBlocks = el.querySelectorAll<HTMLElement>(
      ANCHORABLE_BLOCK_SELECTOR,
    );
    const blocksByLine = new Map<number, HTMLElement>();
    const blocksByHash = new Map<string, HTMLElement[]>();
    for (const block of allBlocks) {
      const lineAttr = block.getAttribute("data-source-line");
      if (!lineAttr) continue;
      const line = Number.parseInt(lineAttr, 10);
      if (!Number.isFinite(line)) continue;
      const hash = hashBlockText(blockVisibleText(block));
      block.setAttribute("data-block-hash", hash);
      blocksByLine.set(line, block);
      const list = blocksByHash.get(hash) ?? [];
      list.push(block);
      blocksByHash.set(hash, list);
    }

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

      let block = blocksByLine.get(anchor.source_line) ?? null;
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
          "[review] comment %s: no block found at source_line=%d (blocksByLine has %d entries)",
          comment.id.slice(0, 8),
          anchor.source_line,
          blocksByLine.size,
        );
      }

      if (!block || (divergent && !matchedByHash)) {
        // Hash didn't match at the recorded line — try neighbor walk.
        const neighbor = findHashNeighbor(
          blocksByHash,
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
          findClosestPriorBlock(blocksByLine, anchor.source_line),
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

    publishDrift();
    restoreDrafts(el, drafts);
  }, [containerRef, comments, currentContent, actions]);
}

/** Walk neighbors by source line, find one whose hash matches. */
function findHashNeighbor(
  blocksByHash: Map<string, HTMLElement[]>,
  targetHash: string,
  centerLine: number,
  radius: number,
): HTMLElement | null {
  const candidates = blocksByHash.get(targetHash);
  if (!candidates) return null;
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const cand of candidates) {
    const lineAttr = cand.getAttribute("data-source-line");
    if (!lineAttr) continue;
    const line = Number.parseInt(lineAttr, 10);
    if (!Number.isFinite(line)) continue;
    const dist = Math.abs(line - centerLine);
    if (dist > radius) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
    }
  }
  return best;
}

/** Closest block whose source-line ≤ target — anchor for outdated rendering. */
function findClosestPriorBlock(
  blocksByLine: Map<number, HTMLElement>,
  targetLine: number,
): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLine = -Infinity;
  for (const [line, block] of blocksByLine) {
    if (line <= targetLine && line > bestLine) {
      bestLine = line;
      best = block;
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
  joinToneRun(blockEl, wrapper);
  if (blockEl.nextSibling) {
    blockEl.parentNode!.insertBefore(wrapper, blockEl.nextSibling);
  } else {
    blockEl.parentNode!.appendChild(wrapper);
  }
}

function insertOutdatedComment(
  container: HTMLElement,
  comment: ReviewComment,
  actions: InlineReviewActions,
  anchorBlock: HTMLElement | null = null,
) {
  const wrapper = createOutdatedBlock(comment, actions);
  if (anchorBlock?.parentNode) {
    joinToneRun(anchorBlock, wrapper);
    if (anchorBlock.nextSibling) {
      anchorBlock.parentNode.insertBefore(wrapper, anchorBlock.nextSibling);
    } else {
      anchorBlock.parentNode.appendChild(wrapper);
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
    // One Dismiss button, one action. There used to be two, both labelled
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
  const { onDelete, onDismiss, onReopen, onEdit, onCopy } = actions;

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

  wireReplyButton(wrapper, comment, actions);

  const editBtn = wrapper.querySelector(".review-inline-comment-edit");
  const textEl = wrapper.querySelector(".review-inline-comment-text");
  if (editBtn && textEl) {
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (wrapper.querySelector(".review-inline-edit-area")) return;

      const currentText = comment.comment;
      const textarea = document.createElement("textarea");
      textarea.className = "review-inline-edit-area";
      textarea.value = currentText;
      textarea.rows = 3;

      const btnRow = document.createElement("div");
      btnRow.className = "review-inline-edit-buttons";

      const saveBtn = document.createElement("button");
      saveBtn.textContent = "Save";
      saveBtn.className = "review-inline-edit-save";

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      cancelBtn.className = "review-inline-edit-cancel";

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(saveBtn);

      (textEl as HTMLElement).style.display = "none";
      textEl.parentNode!.insertBefore(textarea, textEl.nextSibling);
      textEl.parentNode!.insertBefore(btnRow, textarea.nextSibling);
      textarea.focus();

      const cleanup = () => {
        textarea.remove();
        btnRow.remove();
        (textEl as HTMLElement).style.display = "";
      };

      saveBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const newText = textarea.value.trim();
        if (newText && newText !== currentText) {
          onEdit(comment.id, newText);
        }
        cleanup();
      });

      cancelBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        cleanup();
      });

      textarea.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
          ev.preventDefault();
          saveBtn.click();
        }
        if (ev.key === "Escape") {
          ev.preventDefault();
          cancelBtn.click();
        }
      });
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
    html += `<div class="review-thread-entry" data-thread-idx="${i}">${badge}<span class="review-thread-text"></span></div>`;
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

function wireReplyButton(
  wrapper: HTMLElement,
  comment: ReviewComment,
  actions: InlineReviewActions,
): void {
  const onReply = actions.onReply;
  const replyBtn = wrapper.querySelector(".review-inline-comment-reply");
  if (!replyBtn) return;

  replyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (wrapper.querySelector(".review-inline-reply-area")) return;

    const content = wrapper.querySelector(".review-inline-comment-content");
    if (!content) return;

    const textarea = document.createElement("textarea");
    textarea.className = "review-inline-reply-area";
    textarea.placeholder = "Write a reply…";
    textarea.rows = 2;

    const btnRow = document.createElement("div");
    btnRow.className = "review-inline-edit-buttons";

    const sendBtn = document.createElement("button");
    sendBtn.textContent = comment.resolved ? "Reopen & Reply" : "Reply";
    sendBtn.className = "review-inline-edit-save";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.className = "review-inline-edit-cancel";

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(sendBtn);

    content.appendChild(textarea);
    content.appendChild(btnRow);
    textarea.focus();

    const cleanup = () => {
      textarea.remove();
      btnRow.remove();
    };

    sendBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const text = textarea.value.trim();
      if (text) onReply(comment.id, text);
      cleanup();
    });

    cancelBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      cleanup();
    });

    textarea.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        sendBtn.click();
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        cancelBtn.click();
      }
    });
  });
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

/** An open, unsubmitted reply or edit box captured before a re-render. */
interface Draft {
  commentId: string;
  kind: "reply" | "edit";
  value: string;
  selectionStart: number | null;
}

function captureDrafts(container: HTMLElement): Draft[] {
  const drafts: Draft[] = [];
  const areas = container.querySelectorAll<HTMLTextAreaElement>(
    ".review-inline-reply-area, .review-inline-edit-area",
  );
  for (const area of areas) {
    const wrapper = area.closest(`[${INLINE_COMMENT_ATTR}]`);
    const commentId = wrapper?.getAttribute(INLINE_COMMENT_ATTR);
    if (!commentId || commentId === "__resolved__") continue;
    if (!area.value.trim()) continue;
    drafts.push({
      commentId,
      kind: area.classList.contains("review-inline-reply-area")
        ? "reply"
        : "edit",
      value: area.value,
      selectionStart: area.selectionStart,
    });
  }
  return drafts;
}

function restoreDrafts(container: HTMLElement, drafts: Draft[]): void {
  if (drafts.length === 0) return;
  for (const draft of drafts) {
    const wrapper = container.querySelector<HTMLElement>(
      `[${INLINE_COMMENT_ATTR}="${draft.commentId}"]`,
    );
    if (!wrapper) continue; // comment is gone — nothing to restore onto
    const opener = wrapper.querySelector<HTMLElement>(
      draft.kind === "reply"
        ? ".review-inline-comment-reply"
        : ".review-inline-comment-edit",
    );
    if (!opener) continue;
    opener.click(); // rebuilds the textarea via the normal open path
    const area = wrapper.querySelector<HTMLTextAreaElement>(
      draft.kind === "reply"
        ? ".review-inline-reply-area"
        : ".review-inline-edit-area",
    );
    if (!area) continue;
    area.value = draft.value;
    if (draft.selectionStart !== null) {
      area.setSelectionRange(draft.selectionStart, draft.selectionStart);
    }
  }
}

// Used by stripBlockText callers that also want a hash for the same text.
// Kept here so consumers don't need to import both helpers separately.
export { hashBlockText, stripBlockText } from "../lib/reviewAnchor";
