import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import { VANTAGE_SENTINEL, buildPipeline, parseFrontmatter } from "vantage-md";
import { MermaidDiagram, FrontmatterDisplay } from "vantage-md/react";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import { useNavigate } from "react-router-dom";
import { cn } from "../lib/utils";
import { scrollToAnchor } from "../lib/anchorScroll";
import { projectFor } from "../lib/cloneLinks";
import { shouldHandleInternalNavigation } from "../lib/navigation";
import { fragmentHref, routeHref } from "../lib/staticMode";
import { readPreference, writePreference } from "../lib/preferences";
import { useRepoStore } from "../stores/useRepoStore";
import { useDeltaFlash } from "../hooks/useDeltaFlash";
import {
  useReviewHighlights,
  type InlineReviewActions,
} from "../hooks/useReviewHighlights";
import {
  useOpenQuestionButtons,
  type AnswerQuestion,
} from "../hooks/useOpenQuestionButtons";
import {
  MARKDOWN_LINK_ATTR,
  linkTargetAttributes,
  rehypeCollectMarkdownLinks,
  rehypeMarkMarkdownLinks,
  usePlanningLinkBadges,
} from "../hooks/usePlanningLinkBadges";
import { findDocument, referenceSummary } from "vantage-md/planning";
import { usePlanningIndex } from "../stores/usePlanningStore";
import { PLANNING_BADGE_ATTR } from "./PlanningBadge";
import { ReferencedBy, summaryLine } from "./ReferencedBy";
import { useCollapseSections } from "../hooks/useCollapseSections";
import { useReviewStore } from "../stores/useReviewStore";
import { ReviewCommentPopover } from "./ReviewCommentPopover";
import {
  blockVisibleText,
  canonicalOffsetsFromRange,
  hashBlockText,
  stripBlockText,
} from "../lib/reviewAnchor";
import { hoverTargetAt } from "../lib/reviewHover";
import type { CommentAnchor } from "../types";

interface MarkdownViewerProps {
  content: string;
  currentPath: string;
  isReviewMode?: boolean;
  /**
   * How many Open Questions in this document can be answered in one click.
   *
   * Reported whether or not review mode is on, because the count is a fact
   * about the document and the button is a fact about the mode. Must be a
   * stable reference — it is in the reporting effect's dep array.
   */
  onOpenQuestionCount?: (count: number) => void;
  /**
   * Added to every `data-source-line`. For a slice of a document rendered on
   * its own — the planning page's question card, over the card block the
   * planning scan cut, which carries this offset — so every line, and every
   * review anchor built on one, is the document's. Default 0.
   */
  sourceLineOffset?: number;
  /**
   * A viewer inside another page rather than the page itself: no frontmatter
   * card, no Referenced by, no review mode (so no comments, no Open Question
   * buttons and no comment popover), no delta flash, and no drift published.
   * The review store holds the document being viewed; an embedded viewer
   * painting its comments onto a card, or clearing its `commentsDrifted`,
   * would be reporting on a different document. Link badges and collapsed
   * sections stay, because they are how the text reads.
   */
  embedded?: boolean;
}

/**
 * Tags eligible to be the anchor block for a comment — the tags
 * `resolveAnchorBlock` stops on. Container-only tags that `rehypeSourceLines`
 * also stamps (`ul`, `ol`, `tr`, `div`, `hr`) are deliberately absent:
 * selecting "an item in a list" should anchor on the `<li>` rather than
 * collapse to the parent `<ul>`. This mirrors `ANCHORABLE_BLOCK_SELECTOR`'s tag
 * list — keep the two together, or a selection will anchor to a block the
 * highlighter never indexes.
 *
 * `td`/`th` are reached before `table` by virtue of being deeper, so a
 * selection inside a cell anchors to the cell. That is also what makes a
 * cross-cell drag report itself as clamped — two different cells, where both
 * ends used to resolve to the one table — and hint that the comment lands
 * where the selection started.
 */
const ANCHOR_TAGS =
  "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, td, th";

const MULTIBLOCK_HINT_KEY = "vantage.reviewMode.multiBlockHintShown";

function showMultiBlockHintToast(rect: DOMRect) {
  // One-time per browser; once dismissed, never again.  The hint exists
  // to teach the clamp behavior on first encounter.
  //
  // Read at the moment of the selection rather than held in state, which is why
  // this preference is one of the two in `UNSYNCED_PREFERENCES`: a second tab
  // reads it the next time it matters, so there is never a stale copy to sync.
  if (readPreference(MULTIBLOCK_HINT_KEY) === "1") return;
  const existing = document.getElementById("review-multiblock-hint");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "review-multiblock-hint";
  toast.className = "review-blocked-toast";
  // Not "the first paragraph": a selection dragged across two table cells
  // clamps the same way, and it never met a paragraph.
  toast.textContent = "Comment will attach where the selection starts";
  document.body.appendChild(toast);

  const top = rect.top + window.scrollY - 36;
  const left = rect.left + window.scrollX + rect.width / 2;
  toast.style.top = `${Math.max(8, top)}px`;
  toast.style.left = `${left}px`;

  setTimeout(() => toast.remove(), 2500);
  writePreference(MULTIBLOCK_HINT_KEY, "1");
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
  isReviewMode: isReviewModeProp = false,
  onOpenQuestionCount,
  sourceLineOffset = 0,
  embedded = false,
}) => {
  // Review mode belongs to the page's own document, never to one embedded in
  // another page (see `embedded`).
  const isReviewMode = isReviewModeProp && !embedded;
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const isMultiRepo = useRepoStore((state) => state.isMultiRepo);
  const currentRepo = useRepoStore((state) => state.currentRepo);
  // Set only on the loose project beside a directory of clones: a path into
  // one of them belongs to the clone's own project (see lib/cloneLinks.ts).
  const clones = useRepoStore(
    (state) => state.repos.find((r) => r.name === state.currentRepo)?.clones,
  );

  // Build path with repo prefix in multi-repo mode
  const buildPath = useCallback(
    (filePath: string): string => {
      if (isMultiRepo && currentRepo) {
        const target = projectFor(currentRepo, filePath, clones);
        return `/${target.repo}/${target.path}`;
      }
      return `/${filePath}`;
    },
    [isMultiRepo, currentRepo, clones],
  );

  // The content URL for a repository-relative path, in whichever project
  // serves it.
  const contentUrl = useCallback(
    (filePath: string): string => {
      if (isMultiRepo && currentRepo) {
        const target = projectFor(currentRepo, filePath, clones);
        return `/api/r/${encodeURIComponent(target.repo)}/content?path=${encodeURIComponent(target.path)}`;
      }
      return `/api/content?path=${encodeURIComponent(filePath)}`;
    },
    [isMultiRepo, currentRepo, clones],
  );

  // Parse frontmatter from content
  const { frontmatter, body, bodyLineOffset } = useMemo(() => {
    return parseFrontmatter(content);
  }, [content]);

  // The chain lives in vantage-md so the app, the package's exported viewer,
  // and the CLI checker cannot drift apart. `bodyLineOffset` makes
  // `data-source-line` count file lines — both `#L42` links and review comment
  // anchors are read against the whole file, not the body rendered here.
  // The viewer adds only the pair that tells a Markdown link from a raw HTML
  // one, around the whole chain (see `MARKDOWN_LINK_ATTR`).
  const { remarkPlugins, rehypePlugins } = useMemo(() => {
    const pipeline = buildPipeline({
      bodyLineOffset: bodyLineOffset + sourceLineOffset,
    });
    return {
      remarkPlugins: pipeline.remarkPlugins,
      rehypePlugins: [
        rehypeCollectMarkdownLinks,
        ...pipeline.rehypePlugins,
        rehypeMarkMarkdownLinks,
      ],
    };
  }, [bodyLineOffset, sourceLineOffset]);

  const handleLinkClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      // Anchor links within the same doc: scroll inside the content container.
      // `scrollToAnchor` opens any collapsed section around the target first —
      // measuring a `display: none` box scrolls the reader nowhere useful.
      if (href.startsWith("#") && !embedded) {
        e.preventDefault();
        scrollToAnchor(href.slice(1));
        return;
      }

      if (href.startsWith("http") || href.startsWith("mailto:")) return;

      // Allow browser default for Ctrl+click, Cmd+click, middle-click, etc.
      if (!shouldHandleInternalNavigation(e)) {
        return;
      }

      e.preventDefault();

      // Embedded, the page holds only a slice of the document, so a section
      // of it is on the document's own page (see `resolveHref`).
      if (href.startsWith("#")) {
        navigate(buildPath(currentPath) + href);
        return;
      }

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
    [currentPath, navigate, buildPath, embedded],
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

      return contentUrl(resolvedPath);
    },
    [currentPath, contentUrl],
  );

  // This document's own route, which a link to one of its sections names in
  // an export (`fragmentHref`).
  const documentRoute = buildPath(currentPath);

  // The `href` a link renders with: a relative path resolved to the route it
  // reaches, and both written the way the router reads them (`routeHref`), so
  // that "Copy link" and a middle-click get the URL a click navigates to.
  const resolveHref = useCallback(
    (href: string | undefined): string => {
      if (!href) return "";
      // An embedded viewer shows a slice of `currentPath` on another page,
      // where the fragment's target is not, so it names the document.
      if (href.startsWith("#") && embedded)
        return routeHref(documentRoute + href);
      if (href.startsWith("#"))
        return fragmentHref(documentRoute, href.slice(1));
      if (
        href.startsWith("http") ||
        href.startsWith("mailto:") ||
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
      return routeHref(
        buildPath(resolvedPath) + (hashPart ? `#${hashPart}` : ""),
      );
    },
    [currentPath, buildPath, embedded, documentRoute],
  );

  // Delta flash: highlight only changed blocks on live updates
  useDeltaFlash(containerRef, content, currentPath, !embedded);

  // --- Review mode ---
  const comments = useReviewStore((s) => s.comments);
  const pendingSelection = useReviewStore((s) => s.pendingSelection);
  const setPendingSelection = useReviewStore((s) => s.setPendingSelection);
  const clearPendingSelection = useReviewStore((s) => s.clearPendingSelection);
  const addComment = useReviewStore((s) => s.addComment);
  const deleteComment = useReviewStore((s) => s.deleteComment);
  const editComment = useReviewStore((s) => s.editComment);
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
      dismissComment,
      unresolveComment,
      editComment,
      reopenAndReply,
      replyToComment,
      copyCommentToClipboard,
    ],
  );

  // Collapsed sections (design §4.3). BEFORE the highlighter on purpose: this is
  // the pass that sets `data-vantage-collapse-ready`, and the highlighter forces
  // a section open when a comment lands inside one — which it can only do once
  // the marker is there. Effects run in call order, so the order here is the
  // ordering constraint. Unlike the two review passes it is ungated: a collapsed
  // section is how the document reads, not a review affordance.
  useCollapseSections(containerRef, body);

  useReviewHighlights(
    containerRef,
    isReviewMode ? comments : [],
    isReviewMode ? body : null,
    reviewActions,
    !embedded,
  );

  // The one-click Open Question answer (design §5.2). A sibling pass rather than
  // an addition to useReviewHighlights, whose effect returns early when there
  // are no comments — the normal state of a fresh review, and exactly when this
  // button matters. Both are zustand actions, so both are stable refs.
  //
  // Undo is `deleteComment`, the same action the inline card's `×` calls: taking
  // a leaning writes one comment and Undo removes it, so the pair is symmetric
  // and nothing new reaches the server. The hook offers Undo only while the
  // comment carries no reactions, so this can never discard a reply.
  //
  // Answer… opens the popover a click on the question's host block opens, at
  // the button: the same anchor and fallback text, so what it files is the
  // comment the planning card's Answer… files.
  const answerQuestion = useCallback<AnswerQuestion>(
    (anchor, fallbackText, rect) =>
      setPendingSelection({
        anchor,
        rect,
        displayText: fallbackText,
        clamped: false,
      }),
    [setPendingSelection],
  );
  useOpenQuestionButtons(
    containerRef,
    comments,
    isReviewMode,
    isReviewMode ? body : null,
    addComment,
    deleteComment,
    onOpenQuestionCount,
    answerQuestion,
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

  // Hover-to-comment: highlight the block the cursor is pointing at, and let a
  // click anywhere on it open the comment popover for that block's text. Prose
  // is matched on the cursor's Y alone and table cells on X and Y both;
  // `hoverTargetAt` owns that rule and the reasoning behind it.
  // Text selection still works normally — the click handler defers to any
  // active selection so drag-selecting a phrase isn't intercepted.
  const hoveredBlockRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!isReviewMode) return;
    const el = containerRef.current;
    if (!el) return;

    const HOVERED_CLASS = "review-block-hovered";

    const clear = () => {
      if (hoveredBlockRef.current) {
        hoveredBlockRef.current.classList.remove(HOVERED_CLASS);
        hoveredBlockRef.current = null;
      }
    };

    const onMove = (e: MouseEvent) => {
      const block = hoverTargetAt(el, e.clientX, e.clientY);
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
      // Don't intercept clicks on links, buttons, or existing review UI. Every
      // OQ affordance — the take button, the "Leaning taken" chip, and Undo —
      // sits in a row carrying `data-vantage-oq-button`, so the one selector
      // covers the chip, which is a <span> and would not be caught by `button`.
      // A planning badge sits beside a link, not in it, and clicking one does
      // nothing (planning-index.md §5.3) — least of all open a comment.
      if (
        target.closest(
          `a, button, [data-review-inline-comment], [data-vantage-oq-button], [${PLANNING_BADGE_ATTR}]`,
        )
      )
        return;
      // Defer to a non-empty text selection.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;

      const hovered = hoveredBlockRef.current;
      if (!hovered || !el.contains(hovered)) return;

      // `hoverTargetAt` already returns an anchorable element in every case
      // it has one (a cell, a table, or a prose block), but it answers a
      // *pointing* question, not an anchoring one — so still resolve, in case a
      // future hover target is a tag no comment can attach to.
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

  // Factory for heading components with hover anchor links. Like every
  // override below, it takes `node` out before it spreads the rest:
  // react-markdown passes each one the hast element it renders, and that is not
  // an attribute — spread onto the DOM element, it becomes
  // `node="[object Object]"`.
  const headingWithAnchor = useCallback(
    (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") => {
      const Component = ({
        node,
        id,
        children,
        ...props
      }: {
        id?: string;
        children?: React.ReactNode;
      } & React.HTMLAttributes<HTMLHeadingElement> &
        ExtraProps) => (
        <Tag id={id} className="group relative" {...props}>
          {id && (
            <a
              // Naming the document in an export, where a bare `#id` would
              // replace its route (`fragmentHref`).
              href={fragmentHref(documentRoute, id)}
              className="heading-anchor"
              aria-label="Link to this heading"
              onClick={(e) => {
                e.preventDefault();
                // Update URL hash without scrolling. The address bar is what
                // a reader copies, so it gets the same URL as the href.
                window.history.replaceState(
                  null,
                  "",
                  fragmentHref(documentRoute, id),
                );
                // Scroll to the heading, opening the section it sits in if a
                // `collapsed=true` ancestor is hiding it.
                scrollToAnchor(id);
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
    [documentRoute],
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
        node,
        href,
        children,
        [MARKDOWN_LINK_ATTR]: markdownLink,
        ...props
      }: {
        href?: string;
        children?: React.ReactNode;
        [MARKDOWN_LINK_ATTR]?: string;
      } & React.AnchorHTMLAttributes<HTMLAnchorElement> &
        ExtraProps) {
        // The link's repository path, stamped for the badge pass to read: the
        // rendered `href` carries `/{repo}/` in daemon mode and keeps `..`
        // unresolved, so it is never parsed back into a path. After `props`, so
        // nothing a document writes can stand in for it. Only on a link written
        // in Markdown, the kind the index counts, and never on a raw HTML one.
        return (
          <a
            // An `<a>` the document wrote without an `href` keeps none. An
            // empty one would make it a link to this page.
            href={href === undefined ? undefined : resolveHref(href)}
            onClick={(e) => href && handleLinkClick(e, href)}
            {...props}
            {...(markdownLink === undefined
              ? {}
              : linkTargetAttributes(currentPath, href))}
          >
            {children}
          </a>
        );
      },
      code(
        props: {
          children?: React.ReactNode;
          className?: string;
        } & React.HTMLAttributes<HTMLElement> &
          ExtraProps,
      ) {
        const { node, children, className, ...rest } = props;
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
    [handleLinkClick, resolveHref, headingWithAnchor, currentPath],
  );

  // The rendered document, as one element held across renders. The pipeline
  // re-parses the whole body each time `<ReactMarkdown>` renders, and this
  // component renders for reasons that leave the body alone — the planning
  // index loading and changing with every push, a pending selection, a review
  // store write. An element equal to the last one is not rendered again.
  const markdown = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={transformImageUri}
        components={markdownComponents}
      >
        {body}
      </ReactMarkdown>
    ),
    [remarkPlugins, rehypePlugins, transformImageUri, markdownComponents, body],
  );

  // Link badges (docs/reference/planning-index.md §5). Ungated like the collapse
  // pass: a badge is how a link reads, not a review affordance. Until the index
  // is ready, and whenever it failed, the pass only sweeps, so a failed build
  // leaves the document as it renders today; an index that lands after the
  // first paint badges only what has not been on screen (the hook's own
  // comment, and planning-index.md §12.2). After
  // `markdownComponents`, because a new one remounts every link.
  const planning = usePlanningIndex();
  const planningIndex = planning.status === "ready" ? planning.index : null;
  usePlanningLinkBadges(
    containerRef,
    planningIndex,
    currentPath,
    body,
    markdownComponents,
  );

  // The ids `next` may link (planning-index.md §3.4): those this document's own
  // questions carry, never a bare id found only in its text, which is how a
  // compacted question is kept. Until the index is ready `next` is plain text.
  const planningDocument = planningIndex
    ? findDocument(planningIndex, currentPath)
    : undefined;
  const nextLinkIds = useMemo(
    () =>
      planningDocument?.questions.flatMap((q) => (q.id === null ? [] : [q.id])),
    [planningDocument],
  );

  // Referenced by (§7), for a planning document only: the reference puts the line
  // below a planning document's card, and a plain document has no card to be
  // below in the index's sense.
  const referenceSummaryHere = useMemo(
    () =>
      planningIndex !== null && planningDocument !== undefined
        ? referenceSummary(planningIndex, currentPath)
        : null,
    [planningIndex, planningDocument, currentPath],
  );

  // Whether this visit's first paint had the index: a document's path, since
  // a live reload of it is the same visit, as Referenced by's own state is.
  // Adjusted during render, React's documented pattern, so the render that
  // meets a new path already answers for it.
  const [visit, setVisit] = useState(() => ({
    path: currentPath,
    indexed: planningIndex !== null,
  }));
  if (visit.path !== currentPath) {
    setVisit({ path: currentPath, indexed: planningIndex !== null });
  }
  const indexedAtFirstPaint =
    visit.path === currentPath ? visit.indexed : planningIndex !== null;
  // A planning document by its own frontmatter: known before the index is.
  const plannedByFrontmatter =
    Object.hasOwn(frontmatter, "status") || Object.hasOwn(frontmatter, "stage");
  const referencedByLine =
    referenceSummaryHere === null ? null : summaryLine(referenceSummaryHere);
  // Drawn after the first paint, it fills the one line reserved for it, so it
  // is one line at every width: wrapped on a phone, it moved the document.
  const referencedBy =
    referenceSummaryHere !== null && referencedByLine !== null ? (
      <ReferencedBy
        key={currentPath}
        summary={referenceSummaryHere}
        hrefFor={buildPath}
        oneLine={!indexedAtFirstPaint}
      />
    ) : null;

  // A `#…` link React did not already handle — the header's `next` link, which
  // `FrontmatterDisplay` draws as a plain anchor because it lives in the
  // published package. Scrolled the way every in-document link is, so a
  // question in a collapsed section opens first.
  const handleUnhandledHashClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.defaultPrevented) return;
      const link = (e.target as Element).closest?.("a[href^='#']");
      if (!link || !e.currentTarget.contains(link)) return;
      e.preventDefault();
      scrollToAnchor(link.getAttribute("href")!.slice(1));
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      onClick={handleUnhandledHashClick}
      className={cn(
        // A named group, for Referenced by's reservation to ask what the
        // prose holds; unnamed `group-*` variants inside never see it.
        "group/prose prose prose-slate dark:prose-invert max-w-none",
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

        // Images: inline, which is what GitHub does and what a badge row
        // needs. Badges written on adjacent source lines are ONE paragraph
        // joined by a soft break, so GitHub lays them out as a row; Tailwind's
        // preflight makes every replaced element `display: block`, which turns
        // that row into a column. Vertical spacing is the wrapping `<p>`'s
        // (`prose-p:my-[16px]` above), exactly as on GitHub — a margin on the
        // image itself would also prise apart the lines of any paragraph an
        // image sits inside, so it is zeroed rather than inherited from
        // typography's 2em.
        "prose-img:inline-block prose-img:rounded-lg prose-img:my-0",

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
      {!embedded && (
        <FrontmatterDisplay frontmatter={frontmatter} linkIds={nextLinkIds} />
      )}
      {/* Directly after the card, and first in the container when a document
          has no frontmatter: the card then renders nothing at all. Keyed by
          path, so every document loads with it collapsed (§7). */}
      {!embedded &&
        (indexedAtFirstPaint ? (
          referencedBy
        ) : plannedByFrontmatter ? (
          (referencedBy ?? <ReservedLine />)
        ) : body.includes(VANTAGE_SENTINEL) ? (
          // A planning document by its question directives alone, `oq` or
          // `question`, which are known only once they have rendered: the
          // stylesheet reserves the line when the prose holds one, so the first
          // paint has it or not, and what fills it later is shown only where
          // it was reserved.
          <div className="hidden group-has-[[data-vantage-oq]]/prose:contents group-has-[[data-vantage-question]]/prose:contents">
            {referencedBy ?? <ReservedLine />}
          </div>
        ) : null)}
      {markdown}
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

/** Marks the line Referenced by reserved at first paint, while it is empty. */
export const REFERENCED_BY_RESERVED_ATTR =
  "data-vantage-referenced-by-reserved";

/**
 * The line Referenced by fills when the index lands after a document's first
 * paint (`docs/reference/planning-index.md` §12.2): as tall as its one
 * line and its margin, and the line that fills it is kept to one line at every
 * width, so filling it moves nothing; left empty when the index has nothing
 * to say. Built like the line, from nothing the document's
 * passes read as the document.
 */
function ReservedLine() {
  return (
    <div
      {...{ [REFERENCED_BY_RESERVED_ATTR]: "" }}
      aria-hidden="true"
      className="not-prose mb-6 text-[13px] leading-relaxed"
    >
      {"\u00a0"}
    </div>
  );
}

// Memoize to prevent re-renders when parent re-renders but content hasn't changed
export const MarkdownViewer = memo(
  MarkdownViewerInner,
  (prevProps, nextProps) => {
    // `onOpenQuestionCount` is deliberately absent: it must be a stable
    // reference from the parent, and comparing it would only matter if it were
    // not — in which case the fix is the parent's `useCallback`, not a
    // re-render on every keystroke here.
    return (
      prevProps.content === nextProps.content &&
      prevProps.currentPath === nextProps.currentPath &&
      prevProps.isReviewMode === nextProps.isReviewMode &&
      prevProps.sourceLineOffset === nextProps.sourceLineOffset &&
      prevProps.embedded === nextProps.embedded
    );
  },
);
