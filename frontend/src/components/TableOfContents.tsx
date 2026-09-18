import React, { type RefObject } from "react";
import { cn } from "../lib/utils";
import { scrollToAnchor } from "../lib/anchorScroll";
import { useDocumentHeadings } from "../hooks/useDocumentHeadings";

interface TableOfContentsProps {
  /** The scroll container holding the rendered document. */
  containerRef: RefObject<HTMLElement | null>;
  /** Whether the table of contents is showing. Closed means no DOM observers run at all. */
  open: boolean;
}

/** Levels deeper than this share the deepest indent rather than marching off the edge. */
const MAX_INDENT = 3;

/**
 * The document's headings, floating in the margin beside the content.
 *
 * It is a column of the same flex row the document sits in, so it is always
 * adjacent to the text rather than pinned to the window — and it carries no
 * surface of its own: no panel, no border, no background. The heading list is
 * an aid to the document, and drawing a box around it makes it compete with it.
 *
 * `sticky` rather than scrolling away with the prose: a table of contents you have to
 * scroll back up to reach is one you stop using.
 *
 * Clicking an entry goes through `scrollToAnchor`, which is the same path the
 * heading's own `#` link takes — so an entry pointing into a
 * `<!-- vantage: section collapsed=true -->` section opens that section on the
 * way, instead of scrolling to a box with no height.
 *
 * Hidden below `md`. The design is a margin note, and a phone has no margin to
 * put it in; the toolbar hides its toggle at the same breakpoint.
 */
export const TableOfContents: React.FC<TableOfContentsProps> = ({
  containerRef,
  open,
}) => {
  const { headings, activeId } = useDocumentHeadings(containerRef, open);

  if (!open) return null;

  // Indent relative to the document's own shallowest heading: a document whose
  // body starts at h2 should not be indented one step throughout.
  const topLevel = headings.reduce((min, h) => Math.min(min, h.level), 6);

  return (
    <aside
      data-testid="table-of-contents"
      className="hidden md:block w-52 shrink-0"
    >
      <nav
        aria-label="Table of contents"
        className="sticky top-2 max-h-[calc(100vh-8rem)] overflow-y-auto pb-6"
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Contents
        </p>
        {headings.length === 0 ? (
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            No headings in this document.
          </p>
        ) : (
          headings.map((h) => (
            <a
              key={h.id}
              href={`#${h.id}`}
              // A real link, not a button: this is the same "#id" navigation
              // the heading's own hover anchor offers, and it keeps what a
              // button would drop — modifier-click and middle-click open the
              // section in a new tab, and right-click offers "Copy Link" for
              // the exact URL this entry addresses. preventDefault only
              // covers the plain click, so those all keep working natively.
              onClick={(e) => {
                e.preventDefault();
                window.history.replaceState(null, "", `#${h.id}`);
                scrollToAnchor(h.id, containerRef.current);
              }}
              aria-current={h.id === activeId ? "location" : undefined}
              className={cn(
                "block w-full text-left py-1 pr-2 text-[13px] leading-snug no-underline transition-colors cursor-pointer",
                h.id === activeId
                  ? "text-blue-600 dark:text-blue-400 font-medium"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100",
              )}
              style={{
                paddingLeft: `${8 + Math.min(h.level - topLevel, MAX_INDENT) * 12}px`,
              }}
            >
              {h.text}
            </a>
          ))
        )}
      </nav>
    </aside>
  );
};
