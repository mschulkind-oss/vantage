import { useEffect, type RefObject } from "react";
import type { ReviewComment } from "../types";
import { marked } from "marked";
import {
  blockVisibleText,
  hashBlockText,
  rangeFromCanonicalOffsets,
} from "../lib/reviewAnchor";

const mdOptions = { breaks: false, gfm: true };

function renderMarkdownInline(text: string): string {
  const html = (marked.parse(text, mdOptions) as string).trim();
  const singlePara = /^<p>([\s\S]*)<\/p>$/.exec(html);
  if (singlePara) return singlePara[1];
  return html;
}

const MARK_ATTR = "data-review-comment-id";
const INLINE_COMMENT_ATTR = "data-review-inline-comment";

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
 * 5. Otherwise → render the comment as Outdated near the closest
 *    still-present source line ≤ anchor.source_line.
 *
 * The pre-PR2 fallback ladder (text-search, normalized text-search,
 * word-overlap "best block", and the ✓ addressed heuristic on snapshot
 * diffs) is gone.
 */
export function useReviewHighlights(
  containerRef: RefObject<HTMLDivElement | null>,
  comments: ReviewComment[],
  currentContent: string | null,
  onDeleteComment: (id: string) => void,
  onResolveComment: (id: string) => void,
  onDismissComment: (id: string) => void,
  onEditComment: (id: string, newComment: string) => void,
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

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

    if (comments.length === 0) return;

    console.log(
      "[review] useReviewHighlights: %d comments, blocksByLine will be built from %d blocks",
      comments.length,
      el.querySelectorAll("[data-source-line]").length,
    );

    const active = comments.filter((c) => !c.resolved);
    const resolved = comments.filter((c) => c.resolved);

    if (resolved.length > 0) {
      insertResolvedIndicator(el, resolved.length);
    }

    if (active.length === 0) return;

    // Tag every block once with data-block-hash so the neighbor walk
    // can do synchronous lookups.  Skips containers we never anchor on.
    const allBlocks = el.querySelectorAll<HTMLElement>(
      "p[data-source-line], h1[data-source-line], h2[data-source-line], h3[data-source-line], h4[data-source-line], h5[data-source-line], h6[data-source-line], li[data-source-line], blockquote[data-source-line], pre[data-source-line], table[data-source-line]",
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
        // Legacy comment with no anchor — render as outdated at top.
        console.warn(
          "[review] comment %s has no anchor — rendering as outdated. comment:",
          comment.id.slice(0, 8),
          comment,
        );
        insertOutdatedComment(
          el,
          comment,
          onDeleteComment,
          onResolveComment,
          onDismissComment,
          onEditComment,
        );
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
        // No block at line, no hash neighbor — outdated.
        console.warn(
          "[review] comment %s: OUTDATED — no block at line %d, no hash neighbor for %s",
          comment.id.slice(0, 8),
          anchor.source_line,
          anchor.block_text_hash,
        );
        insertOutdatedComment(
          el,
          comment,
          onDeleteComment,
          onResolveComment,
          onDismissComment,
          onEditComment,
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
        // Same line, different content (Q8: faint, no substring re-find).
        block.classList.add("review-highlight-block-divergent");
      }

      insertInlineCommentAfter(
        block,
        comment,
        onDeleteComment,
        onResolveComment,
        onDismissComment,
        onEditComment,
        divergent,
      );
    }
  }, [
    containerRef,
    comments,
    currentContent,
    onDeleteComment,
    onResolveComment,
    onDismissComment,
    onEditComment,
  ]);
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

function insertInlineCommentAfter(
  blockEl: HTMLElement,
  comment: ReviewComment,
  onDelete: (id: string) => void,
  onResolve: (id: string) => void,
  onDismiss: (id: string) => void,
  onEdit: (id: string, newComment: string) => void,
  divergent: boolean,
) {
  const wrapper = createCommentBlock(
    comment,
    onDelete,
    onResolve,
    onDismiss,
    onEdit,
    divergent,
  );
  if (blockEl.nextSibling) {
    blockEl.parentNode!.insertBefore(wrapper, blockEl.nextSibling);
  } else {
    blockEl.parentNode!.appendChild(wrapper);
  }
}

function insertOutdatedComment(
  container: HTMLElement,
  comment: ReviewComment,
  onDelete: (id: string) => void,
  onResolve: (id: string) => void,
  onDismiss: (id: string) => void,
  onEdit: (id: string, newComment: string) => void,
  anchorBlock: HTMLElement | null = null,
) {
  const wrapper = createOutdatedBlock(
    comment,
    onDelete,
    onResolve,
    onDismiss,
    onEdit,
  );
  if (anchorBlock?.parentNode) {
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

/** Render an inline comment block.  Resolve/Dismiss is reaction-aware. */
function createCommentBlock(
  comment: ReviewComment,
  onDelete: (id: string) => void,
  onResolve: (id: string) => void,
  onDismiss: (id: string) => void,
  onEdit: (id: string, newComment: string) => void,
  divergent: boolean,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.setAttribute(INLINE_COMMENT_ATTR, comment.id);
  wrapper.className = divergent
    ? "review-inline-comment review-inline-comment--divergent"
    : "review-inline-comment";

  const hasAgentReaction = (comment.reactions ?? []).some(
    (r) => r.actor === "agent",
  );

  // Reaction sub-block (only when an agent reaction exists).
  let reactionHtml = "";
  if (hasAgentReaction) {
    const latest = [...(comment.reactions ?? [])]
      .reverse()
      .find((r) => r.actor === "agent");
    if (latest) {
      void latest; // template HTML is static; summary + diff are populated below
      reactionHtml = renderReactionBlockHtml();
    }
  }

  const actionButton = hasAgentReaction
    ? `<button class="review-inline-comment-resolve" title="Accept the agent's fix">Resolve</button>`
    : `<button class="review-inline-comment-dismiss" title="Dismiss comment">Dismiss</button>`;

  wrapper.innerHTML = `
    <div class="review-inline-comment-body">
      <span class="review-inline-comment-icon" title="Review comment">&#x1f4ac;</span>
      <div class="review-inline-comment-content">
        <div class="review-inline-comment-text"></div>
        ${reactionHtml}
      </div>
      <div class="review-inline-comment-actions">
        ${actionButton}
        <button class="review-inline-comment-edit" title="Edit comment">&#x270E;</button>
        <button class="review-inline-comment-delete" title="Delete comment">&times;</button>
      </div>
    </div>
  `;

  const textEl = wrapper.querySelector(".review-inline-comment-text");
  if (textEl) textEl.innerHTML = renderMarkdownInline(comment.comment);

  if (hasAgentReaction) {
    const latest = [...(comment.reactions ?? [])]
      .reverse()
      .find((r) => r.actor === "agent");
    const summaryEl = wrapper.querySelector(".review-reaction-summary");
    if (latest && summaryEl)
      summaryEl.innerHTML = renderMarkdownInline(latest.summary);
  }

  wireCommentButtons(wrapper, comment, onDelete, onResolve, onDismiss, onEdit);
  return wrapper;
}

function createOutdatedBlock(
  comment: ReviewComment,
  onDelete: (id: string) => void,
  onResolve: (id: string) => void,
  onDismiss: (id: string) => void,
  onEdit: (id: string, newComment: string) => void,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.setAttribute(INLINE_COMMENT_ATTR, comment.id);
  wrapper.className = "review-inline-comment review-inline-comment--outdated";

  const hasAgentReaction = (comment.reactions ?? []).some(
    (r) => r.actor === "agent",
  );

  let reactionHtml = "";
  if (hasAgentReaction) {
    reactionHtml = renderReactionBlockHtml();
  }

  const actionButton = hasAgentReaction
    ? `<button class="review-inline-comment-resolve" title="Accept the agent's fix">Resolve</button>`
    : `<button class="review-inline-comment-dismiss" title="Dismiss comment">Dismiss</button>`;

  wrapper.innerHTML = `
    <div class="review-inline-comment-body review-inline-comment-body--outdated">
      <div class="review-inline-comment-content">
        <div class="review-outdated-badge">${hasAgentReaction ? "Addressed" : "Outdated"}</div>
        <div class="review-outdated-quote"></div>
        <div class="review-inline-comment-text"></div>
        ${reactionHtml}
      </div>
      <div class="review-inline-comment-actions">
        ${actionButton}
      </div>
    </div>
  `;
  const quoteEl = wrapper.querySelector(".review-outdated-quote");
  if (quoteEl)
    quoteEl.textContent = comment.fallback_text || comment.selected_text || "";
  const textEl = wrapper.querySelector(".review-inline-comment-text");
  if (textEl) textEl.innerHTML = renderMarkdownInline(comment.comment);

  if (hasAgentReaction) {
    const latest = [...(comment.reactions ?? [])]
      .reverse()
      .find((r) => r.actor === "agent");
    const summaryEl = wrapper.querySelector(".review-reaction-summary");
    if (latest && summaryEl)
      summaryEl.innerHTML = renderMarkdownInline(latest.summary);
  }

  wireCommentButtons(wrapper, comment, onDelete, onResolve, onDismiss, onEdit);
  return wrapper;
}

function wireCommentButtons(
  wrapper: HTMLElement,
  comment: ReviewComment,
  onDelete: (id: string) => void,
  onResolve: (id: string) => void,
  onDismiss: (id: string) => void,
  onEdit: (id: string, newComment: string) => void,
) {
  const deleteBtn = wrapper.querySelector(".review-inline-comment-delete");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onDelete(comment.id);
    });
  }
  const resolveBtn = wrapper.querySelector(".review-inline-comment-resolve");
  if (resolveBtn) {
    resolveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onResolve(comment.id);
    });
  }
  const dismissBtn = wrapper.querySelector(".review-inline-comment-dismiss");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onDismiss(comment.id);
    });
  }
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

function renderReactionBlockHtml(): string {
  return `
    <div class="review-reaction">
      <div class="review-reaction-header">
        <span class="review-reaction-badge">Agent</span>
        <span class="review-reaction-summary"></span>
      </div>
    </div>
  `;
}

function insertResolvedIndicator(container: HTMLElement, count: number) {
  const existing = container.querySelector(".review-resolved-indicator");
  if (existing) existing.remove();

  const bar = document.createElement("div");
  bar.className = "review-resolved-indicator";
  bar.setAttribute(INLINE_COMMENT_ATTR, "__resolved__");
  bar.innerHTML = `
    <span class="review-resolved-indicator-icon">✓</span>
    <span class="review-resolved-indicator-text">${count} resolved comment${count !== 1 ? "s" : ""}</span>
  `;

  if (container.firstChild) {
    container.insertBefore(bar, container.firstChild);
  } else {
    container.appendChild(bar);
  }
}

// Used by stripBlockText callers that also want a hash for the same text.
// Kept here so consumers don't need to import both helpers separately.
export { hashBlockText, stripBlockText } from "../lib/reviewAnchor";
