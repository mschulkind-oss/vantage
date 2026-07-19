import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import {
  rehypeSourceLines,
  parseFrontmatter,
  sanitizeSchema,
} from "vantage-md";
import { MermaidDiagram, FrontmatterDisplay } from "vantage-md/react";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import { useNavigate } from "react-router-dom";
import { cn } from "../lib/utils";
import { shouldHandleInternalNavigation } from "../lib/navigation";
import { useRepoStore } from "../stores/useRepoStore";
import { useDeltaFlash } from "../hooks/useDeltaFlash";
import {
  useReviewHighlights,
  type InlineReviewActions,
} from "../hooks/useReviewHighlights";
import { useReviewStore } from "../stores/useReviewStore";
import { ReviewCommentPopover } from "./ReviewCommentPopover";
import {
  blockVisibleText,
  canonicalOffsetsFromRange,
  hashBlockText,
  stripBlockText,
} from "../lib/reviewAnchor";
import type { CommentAnchor } from "../types";

interface MarkdownViewerProps {
  content: string;
  currentPath: string;
  isReviewMode?: boolean;
}

// Tags eligible to be the anchor block for a comment.  We deliberately
// exclude container-only tags that `rehypeSourceLines` also tags
// (`ul`, `ol`, `tr`, `div`, `hr`) — selecting "an item in a list"
// should anchor on the `<li>`, not collapse to the parent `<ul>`.
const ANCHOR_TAGS = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table";

const MULTIBLOCK_HINT_KEY = "vantage.reviewMode.multiBlockHintShown";

function showMultiBlockHintToast(rect: DOMRect) {
  // One-time per browser; once dismissed, never again.  The hint exists
  // to teach the clamp behavior on first encounter.
  try {
    if (localStorage.getItem(MULTIBLOCK_HINT_KEY) === "1") return;
  } catch {
    /* ignore */
  }
  const existing = document.getElementById("review-multiblock-hint");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "review-multiblock-hint";
  toast.className = "review-blocked-toast";
  toast.textContent = "Comment will attach to the first paragraph";
  document.body.appendChild(toast);

  const top = rect.top + window.scrollY - 36;
  const left = rect.left + window.scrollX + rect.width / 2;
  toast.style.top = `${Math.max(8, top)}px`;
  toast.style.left = `${left}px`;

  setTimeout(() => toast.remove(), 2500);
  try {
    localStorage.setItem(MULTIBLOCK_HINT_KEY, "1");
  } catch {
    /* ignore */
  }
}

interface CapturedSelection {
  anchor: CommentAnchor;
  block: HTMLElement;
  displayText: string;
  rect: DOMRect;
  clamped: boolean;
}

/**
 * Resolve the anchor block for a DOM node.  Walks ancestors looking for
 * the closest `[data-source-line]` whose tag is in ANCHOR_TAGS — this
 * keeps comments off of pure-container elements.
 */
function resolveAnchorBlock(
  container: HTMLElement,
  node: Node | null,
): HTMLElement | null {
  if (!node) return null;
  const start =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement;
  if (!start) return null;
  let cur: HTMLElement | null = start;
  while (cur && cur !== container) {
    if (cur.matches?.(ANCHOR_TAGS) && cur.hasAttribute("data-source-line")) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

const MarkdownViewerInner: React.FC<MarkdownViewerProps> = ({
  content,
  currentPath,
  isReviewMode = false,
}) => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const isMultiRepo = useRepoStore((state) => state.isMultiRepo);
  const currentRepo = useRepoStore((state) => state.currentRepo);

  // Build path with repo prefix in multi-repo mode
  const buildPath = useCallback(
    (filePath: string): string => {
      if (isMultiRepo && currentRepo) {
        return `/${currentRepo}/${filePath}`;
      }
      return `/${filePath}`;
    },
    [isMultiRepo, currentRepo],
  );

  // Get API base for content requests
  const getApiBase = useCallback((): string => {
    if (isMultiRepo && currentRepo) {
      return `/api/r/${encodeURIComponent(currentRepo)}`;
    }
    return "/api";
  }, [isMultiRepo, currentRepo]);

  // Parse frontmatter from content
  const { frontmatter, body } = useMemo(() => {
    return parseFrontmatter(content);
  }, [content]);

  const handleLinkClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      // Anchor links within the same doc: scroll inside the content container
      if (href.startsWith("#")) {
        e.preventDefault();
        const id = href.slice(1);
        const el =
          document.getElementById(id) ||
          document.getElementById(`user-content-${id}`);
        if (el) {
          // Find the scrollable content container (has overflow-y-auto)
          const scrollContainer =
            el.closest("[data-content-scroll]") ||
            el.closest(".overflow-y-auto");
          if (scrollContainer) {
            const offset =
              el.getBoundingClientRect().top -
              scrollContainer.getBoundingClientRect().top +
              scrollContainer.scrollTop;
            scrollContainer.scrollTo({ top: offset - 16 });
          } else {
            el.scrollIntoView();
          }
        }
        return;
      }

      if (href.startsWith("http") || href.startsWith("mailto:")) return;

      // Allow browser default for Ctrl+click, Cmd+click, middle-click, etc.
      if (!shouldHandleInternalNavigation(e)) {
        return;
      }

      e.preventDefault();

      // Handle cross-doc anchor links (e.g. other-doc.md#section)
      const [pathPart, hashPart] = href.split("#");

      // Resolve relative path
      const parts = currentPath.split("/");
      parts.pop();
      const dir = parts.join("/");

      // Clean up href
      const cleanHref = pathPart.replace(/^\.\//, "");
      const resolvedPath = dir ? `${dir}/${cleanHref}` : cleanHref;

      const targetUrl =
        buildPath(resolvedPath) + (hashPart ? `#${hashPart}` : "");
      navigate(targetUrl);
    },
    [currentPath, navigate, buildPath],
  );

  const transformImageUri = useCallback(
    (uri: string, key?: string) => {
      // Only transform image sources, leave links alone as they are handled by handleLinkClick
      if (key === "href") {
        return uri;
      }

      if (uri.startsWith("http") || uri.startsWith("data:")) return uri;

      // Resolve relative path based on currentPath
      const parts = currentPath.split("/");
      parts.pop(); // remove filename
      const dir = parts.join("/");
      const resolvedPath = dir ? `${dir}/${uri}` : uri;
      const apiBase = getApiBase();

      return `${apiBase}/content?path=${encodeURIComponent(resolvedPath)}`;
    },
    [currentPath, getApiBase],
  );

  // Helper to resolve relative link paths to absolute paths
  const resolveHref = useCallback(
    (href: string | undefined): string => {
      if (!href) return "";
      if (
        href.startsWith("http") ||
        href.startsWith("mailto:") ||
        href.startsWith("#") ||
        href.startsWith("/")
      ) {
        return href;
      }

      // Handle cross-doc anchors (e.g. other.md#section)
      const [pathPart, hashPart] = href.split("#");

      // Resolve relative path based on currentPath
      const parts = currentPath.split("/");
      parts.pop(); // remove filename
      const dir = parts.join("/");
      const cleanHref = pathPart.replace(/^\.\//, "");
      const resolvedPath = dir ? `${dir}/${cleanHref}` : cleanHref;
      return buildPath(resolvedPath) + (hashPart ? `#${hashPart}` : "");
    },
    [currentPath, buildPath],
  );

  // Delta flash: highlight only changed blocks on live updates
  useDeltaFlash(containerRef, content, currentPath);

  // --- Review mode ---
  const comments = useReviewStore((s) => s.comments);
  const pendingSelection = useReviewStore((s) => s.pendingSelection);
  const setPendingSelection = useReviewStore((s) => s.setPendingSelection);
  const clearPendingSelection = useReviewStore((s) => s.clearPendingSelection);
  const addComment = useReviewStore((s) => s.addComment);
  const deleteComment = useReviewStore((s) => s.deleteComment);
  const editComment = useReviewStore((s) => s.editComment);
  const resolveComment = useReviewStore((s) => s.resolveComment);
  const dismissComment = useReviewStore((s) => s.dismissComment);
  const replyToComment = useReviewStore((s) => s.replyToComment);
  const reopenAndReply = useReviewStore((s) => s.reopenAndReply);
  const unresolveComment = useReviewStore((s) => s.unresolveComment);
  const copyCommentToClipboard = useReviewStore(
    (s) => s.copyCommentToClipboard,
  );

  const reviewActions = useMemo<InlineReviewActions>(
    () => ({
      onDelete: deleteComment,
      onResolve: resolveComment,
      onDismiss: dismissComment,
      onReopen: unresolveComment,
      onEdit: editComment,
      // Replying to a resolved comment reopens it, matching the sidebar's
      // "Reopen & Reply" — the inline surface offers the same one action.
      onReply: (id, text) => {
        const target = useReviewStore
          .getState()
          .comments.find((c) => c.id === id);
        if (target?.resolved) reopenAndReply(id, text);
        else replyToComment(id, text);
      },
      onCopy: copyCommentToClipboard,
    }),
    [
      deleteComment,
      resolveComment,
      dismissComment,
      unresolveComment,
      editComment,
      reopenAndReply,
      replyToComment,
      copyCommentToClipboard,
    ],
  );

  useReviewHighlights(
    containerRef,
    isReviewMode ? comments : [],
    isReviewMode ? body : null,
    reviewActions,
  );

  // Build a CapturedSelection from the current window selection or a
  // hovered block (whole-block click).  Returns null if nothing is
  // capture-worthy at this moment.
  const buildCapturedSelection = useCallback(
    (block: HTMLElement, range: Range | null): CapturedSelection | null => {
      const sourceLineAttr = block.getAttribute("data-source-line");
      if (!sourceLineAttr) return null;
      const sourceLine = Number.parseInt(sourceLineAttr, 10);
      if (!Number.isFinite(sourceLine)) return null;

      const blockText = blockVisibleText(block);
      const blockHash = hashBlockText(blockText);
      const canonicalBlock = stripBlockText(blockText);

      let offset = 0;
      let length = 0;
      let displayText = canonicalBlock;
      let clamped = false;
      let rect: DOMRect;

      if (range && !range.collapsed) {
        const offsets = canonicalOffsetsFromRange(block, range);
        if (offsets && offsets.length >= 3) {
          offset = offsets.offset;
          length = offsets.length;
          displayText = canonicalBlock.slice(offset, offset + length);
        }
        rect = range.getBoundingClientRect();
      } else {
        rect = block.getBoundingClientRect();
      }

      if (range && !range.collapsed) {
        const startBlock = resolveAnchorBlock(
          (block.closest("[data-content-scroll]") as HTMLElement | null) ??
            block.parentElement!,
          range.startContainer,
        );
        const endBlock = resolveAnchorBlock(
          (block.closest("[data-content-scroll]") as HTMLElement | null) ??
            block.parentElement!,
          range.endContainer,
        );
        if (startBlock && endBlock && startBlock !== endBlock) {
          clamped = true;
        }
      }

      const anchor: CommentAnchor = {
        source_line: sourceLine,
        block_text_hash: blockHash,
        selection_offset: offset,
        selection_length: length,
      };
      return { anchor, block, displayText, rect, clamped };
    },
    [],
  );

  // Capture the current window selection (if any) and promote it to a
  // pending review comment.  Returns true if something was captured.
  // Shared between mouseup and the "toggle review mode while text already
  // selected" auto-capture flow.
  const captureCurrentSelection = useCallback((): boolean => {
    const el = containerRef.current;
    if (!el) return false;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return false;
    }

    const text = selection.toString().trim();
    if (!text || text.length < 3) return false;

    const range = selection.getRangeAt(0);
    if (
      !el.contains(range.startContainer) &&
      !el.contains(range.endContainer)
    ) {
      return false;
    }

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    const startBlock = resolveAnchorBlock(el, range.startContainer);
    if (!startBlock) return false;

    const captured = buildCapturedSelection(startBlock, range);
    if (!captured) return false;

    if (captured.clamped) {
      showMultiBlockHintToast(rect);
    }

    setPendingSelection({
      anchor: captured.anchor,
      rect: captured.rect,
      displayText: captured.displayText,
      clamped: captured.clamped,
    });
    return true;
  }, [setPendingSelection, buildCapturedSelection]);

  // Text selection handler for review mode.
  // We listen on the document for mouseup so we catch selections that start
  // inside the container and end outside.  A short delay lets the browser
  // finalize the selection before we read it.
  useEffect(() => {
    if (!isReviewMode) return;
    const el = containerRef.current;
    if (!el) return;

    const handler = () => {
      // Small delay: the browser sometimes hasn't committed the selection
      // at the instant mouseup fires (especially on fast clicks).
      setTimeout(() => captureCurrentSelection(), 10);
    };

    el.addEventListener("mouseup", handler);
    return () => el.removeEventListener("mouseup", handler);
  }, [isReviewMode, captureCurrentSelection]);

  // When review mode is turned on while text is already selected, treat
  // that selection as the user's intended comment target — skips the
  // "oh I forgot to enable review mode first, now I have to reselect" chore.
  useEffect(() => {
    if (!isReviewMode) return;
    // Small delay so this runs *after* any focus/click that accompanied the
    // toggle (toolbar button click can otherwise clobber the selection).
    const id = setTimeout(() => captureCurrentSelection(), 0);
    return () => clearTimeout(id);
  }, [isReviewMode, captureCurrentSelection]);

  // Hover-to-comment: highlight the block whose vertical span contains the
  // mouse cursor, regardless of horizontal position.  Click anywhere on the
  // highlighted block opens the comment popover for that block's text.
  // Text selection still works normally — the click handler defers to any
  // active selection so drag-selecting a phrase isn't intercepted.
  const hoveredBlockRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!isReviewMode) return;
    const el = containerRef.current;
    if (!el) return;

    const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote";
    const HOVERED_CLASS = "review-block-hovered";

    const clear = () => {
      if (hoveredBlockRef.current) {
        hoveredBlockRef.current.classList.remove(HOVERED_CLASS);
        hoveredBlockRef.current = null;
      }
    };

    const findBlockAtY = (clientY: number): HTMLElement | null => {
      const blocks = el.querySelectorAll(
        BLOCK_SELECTOR,
      ) as NodeListOf<HTMLElement>;
      let best: HTMLElement | null = null;
      let bestDepth = -1;
      for (const block of blocks) {
        // Skip review-UI elements rendered inside the prose container.
        if (block.closest("[data-review-inline-comment]")) continue;
        const text = (block.innerText || block.textContent || "").trim();
        if (text.length < 3) continue;
        const r = block.getBoundingClientRect();
        if (clientY < r.top || clientY > r.bottom) continue;
        // Prefer the deepest matching block (e.g. an `li` inside an outer
        // wrapper) so nested lists don't always resolve to their parent.
        let depth = 0;
        let cur: Element | null = block;
        while (cur && cur !== el) {
          depth++;
          cur = cur.parentElement;
        }
        if (depth > bestDepth) {
          bestDepth = depth;
          best = block;
        }
      }
      return best;
    };

    const onMove = (e: MouseEvent) => {
      const block = findBlockAtY(e.clientY);
      if (block === hoveredBlockRef.current) return;
      clear();
      if (block) {
        block.classList.add(HOVERED_CLASS);
        hoveredBlockRef.current = block;
      }
    };

    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", clear);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", clear);
      clear();
    };
  }, [isReviewMode]);

  // Click on a hovered block opens the comment popover — unless the user is
  // making a text selection (then captureCurrentSelection on mouseup wins).
  useEffect(() => {
    if (!isReviewMode) return;
    const el = containerRef.current;
    if (!el) return;

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Don't intercept clicks on links, buttons, or existing review UI.
      if (target.closest("a, button, [data-review-inline-comment]")) return;
      // Defer to a non-empty text selection.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;

      const hovered = hoveredBlockRef.current;
      if (!hovered || !el.contains(hovered)) return;

      // The hover-block selector includes p, h1-h6, li, blockquote;
      // resolveAnchorBlock walks to the nearest tag with data-source-line
      // (which may be the same element or a closer ancestor).
      const block = resolveAnchorBlock(el, hovered) ?? hovered;
      if (!block.hasAttribute("data-source-line")) return;

      const captured = buildCapturedSelection(block as HTMLElement, null);
      if (!captured) return;

      setPendingSelection({
        anchor: captured.anchor,
        rect: captured.rect,
        displayText: captured.displayText,
        clamped: false,
      });
    };

    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [isReviewMode, setPendingSelection, buildCapturedSelection]);

  // Factory for heading components with hover anchor links
  const headingWithAnchor = useCallback(
    (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") => {
      const Component = ({
        id,
        children,
        ...props
      }: {
        id?: string;
        children?: React.ReactNode;
      } & React.HTMLAttributes<HTMLHeadingElement>) => (
        <Tag id={id} className="group relative" {...props}>
          {id && (
            <a
              href={`#${id}`}
              className="heading-anchor"
              aria-label="Link to this heading"
              onClick={(e) => {
                e.preventDefault();
                // Update URL hash without scrolling
                window.history.replaceState(null, "", `#${id}`);
                // Scroll to the heading
                const el =
                  document.getElementById(id) ||
                  document.getElementById(`user-content-${id}`);
                if (el) {
                  const scrollContainer =
                    el.closest("[data-content-scroll]") ||
                    el.closest(".overflow-y-auto");
                  if (scrollContainer) {
                    const offset =
                      el.getBoundingClientRect().top -
                      scrollContainer.getBoundingClientRect().top +
                      scrollContainer.scrollTop;
                    scrollContainer.scrollTo({ top: offset - 16 });
                  } else {
                    el.scrollIntoView();
                  }
                }
              }}
            >
              #
            </a>
          )}
          {children}
        </Tag>
      );
      Component.displayName = Tag.toUpperCase();
      return Component;
    },
    [],
  );

  // Memoize markdown components to prevent unnecessary re-renders
  const markdownComponents = useMemo(
    () => ({
      h1: headingWithAnchor("h1"),
      h2: headingWithAnchor("h2"),
      h3: headingWithAnchor("h3"),
      h4: headingWithAnchor("h4"),
      h5: headingWithAnchor("h5"),
      h6: headingWithAnchor("h6"),
      a({
        href,
        children,
        ...props
      }: {
        href?: string;
        children?: React.ReactNode;
      } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
        const resolvedHref = resolveHref(href);
        return (
          <a
            href={resolvedHref}
            onClick={(e) => href && handleLinkClick(e, href)}
            {...props}
          >
            {children}
          </a>
        );
      },
      code(
        props: {
          children?: React.ReactNode;
          className?: string;
        } & React.HTMLAttributes<HTMLElement>,
      ) {
        const { children, className, ...rest } = props;
        const match = /language-(\w+)/.exec(className || "");
        // Check if it's a block code (has newline at end usually) or explicit class
        if (match && match[1] === "mermaid") {
          return <MermaidDiagram code={String(children).replace(/\n$/, "")} />;
        }
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        );
      },
    }),
    [handleLinkClick, resolveHref, headingWithAnchor],
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        "prose prose-slate dark:prose-invert max-w-none",
        // Headings: GitHub-like sizing and spacing
        "prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-slate-900 dark:prose-headings:text-slate-100",
        "prose-h1:text-[2em] prose-h1:mb-3 prose-h1:pb-[0.3em] prose-h1:border-b prose-h1:border-slate-200 dark:prose-h1:border-slate-700",
        "prose-h2:text-[1.5em] prose-h2:mt-6 prose-h2:mb-3 prose-h2:pb-[0.3em] prose-h2:border-b prose-h2:border-slate-200 dark:prose-h2:border-slate-700",
        "prose-h3:text-[1.25em] prose-h3:mt-6 prose-h3:mb-2",
        "prose-h4:text-[1em] prose-h4:mt-6 prose-h4:mb-2",

        // Body text: tighter line height and spacing to match GitHub
        "prose-p:text-slate-700 dark:prose-p:text-slate-300 prose-p:leading-[1.5] prose-p:my-[16px]",

        // Lists: tighter spacing
        "prose-ul:my-[16px] prose-ul:list-disc prose-li:my-0.5 prose-li:marker:text-slate-900 dark:prose-li:marker:text-slate-300",
        "prose-ol:my-[16px] prose-li:marker:text-slate-900 dark:prose-li:marker:text-slate-300",

        // Code blocks: GitHub-like light gray / dark background
        "prose-pre:bg-slate-50 dark:prose-pre:bg-slate-800 prose-pre:border prose-pre:border-slate-200 dark:prose-pre:border-slate-700 prose-pre:p-4 prose-pre:rounded-md prose-pre:text-[85%] prose-pre:leading-[1.45]",

        // Links: Standard blue. Note: `prose-a:hover:underline` (link-hover),
        // NOT `hover:prose-a:underline` (prose-hover) — the latter underlines
        // every link in the document whenever the user hovers anywhere in the
        // prose container, which looks like accidental multi-link merging.
        "prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline prose-a:hover:underline",

        // Images
        "prose-img:rounded-lg prose-img:my-4",

        // Blockquotes: Simpler vertical bar style
        "prose-blockquote:border-l-[0.25em] prose-blockquote:border-slate-300 dark:prose-blockquote:border-slate-600 prose-blockquote:pl-4 prose-blockquote:text-slate-600 dark:prose-blockquote:text-slate-400 prose-blockquote:italic",

        // Inline code: GitHub-like style (pill, light bg)
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-code:bg-slate-100 dark:prose-code:bg-slate-800 prose-code:px-[0.4em] prose-code:py-[0.2em] prose-code:rounded-md prose-code:text-slate-800 dark:prose-code:text-slate-200 prose-code:font-mono prose-code:text-[85%] prose-code:font-normal prose-code:border prose-code:border-slate-200/50 dark:prose-code:border-slate-700/50",

        // Tables: tighter styling
        "prose-table:text-sm",
        "prose-th:px-3 prose-th:py-1.5 prose-th:border prose-th:border-slate-200 dark:prose-th:border-slate-700",
        "prose-td:px-3 prose-td:py-1.5 prose-td:border prose-td:border-slate-200 dark:prose-td:border-slate-700",
      )}
    >
      <FrontmatterDisplay frontmatter={frontmatter} />
      <ReactMarkdown
        remarkPlugins={[
          [remarkGfm, { singleTilde: false }],
          [remarkMath, { singleDollarTextMath: false }],
        ]}
        rehypePlugins={[
          rehypeRaw,
          rehypeSourceLines,
          [rehypeSanitize, sanitizeSchema],
          rehypeSlug,
          rehypeHighlight,
          rehypeKatex,
        ]}
        urlTransform={transformImageUri}
        components={markdownComponents}
      >
        {body}
      </ReactMarkdown>
      {/* Review mode: comment popover for new selections */}
      {isReviewMode && pendingSelection && (
        <ReviewCommentPopover
          selectedText={pendingSelection.displayText}
          rect={pendingSelection.rect}
          onSave={(comment) => {
            addComment(
              pendingSelection.anchor,
              comment,
              pendingSelection.displayText,
            );
          }}
          onCancel={clearPendingSelection}
        />
      )}
    </div>
  );
};

// Memoize to prevent re-renders when parent re-renders but content hasn't changed
export const MarkdownViewer = memo(
  MarkdownViewerInner,
  (prevProps, nextProps) => {
    return (
      prevProps.content === nextProps.content &&
      prevProps.currentPath === nextProps.currentPath &&
      prevProps.isReviewMode === nextProps.isReviewMode
    );
  },
);
