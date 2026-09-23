import React, { type RefObject } from "react";
import { cn } from "../lib/utils";
import { scrollToAnchorElement } from "../lib/anchorScroll";
import {
  entryAccessibleName,
  tallyQuestions,
  tallySentence,
  useDocumentOutline,
  type OutlineEntry,
} from "../hooks/useDocumentOutline";

interface TableOfContentsProps {
  /** The scroll container holding the rendered document. */
  containerRef: RefObject<HTMLElement | null>;
  /** Whether the table of contents is showing. Closed means no DOM observers run at all. */
  open: boolean;
}

/** Levels deeper than this share the deepest indent rather than marching off the edge. */
const MAX_INDENT = 3;

/**
 * The document's outline — its headings, and the Open Questions still awaiting a
 * ruling — floating in the margin beside the content.
 *
 * It is a column of the same flex row the document sits in, so it is always
 * adjacent to the text rather than pinned to the window — and it carries no
 * surface of its own: no panel, no border, no background. The heading list is
 * an aid to the document, and drawing a box around it makes it compete with it.
 *
 * `sticky` rather than scrolling away with the prose: a table of contents you have to
 * scroll back up to reach is one you stop using.
 *
 * Clicking an entry goes through `scrollToAnchorElement`, which is the same path the
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
  const { entries, activeId } = useDocumentOutline(containerRef, open);

  if (!open) return null;

  // Indent relative to the document's own shallowest entry: a document whose
  // body starts at h2 should not be indented one step throughout.
  const topLevel = entries.reduce((min, e) => Math.min(min, e.level), 6);
  const tallies = tallyQuestions(entries);

  return (
    <aside
      data-testid="table-of-contents"
      // w-64, not a skinny rail: the band is glued to the left of the pane,
      // so a wider contents column spends the window's leftover right-hand
      // space rather than the document's measure.
      className="hidden md:block w-64 shrink-0"
    >
      <nav
        aria-label="Table of contents"
        className="sticky top-2 max-h-[calc(100vh-8rem)] overflow-y-auto pb-6"
      >
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Contents
          </p>
          {/*
           * The tally, here rather than beside the questions themselves because
           * it answers something asked before the column is read at all: does
           * this document want anything from me? Absent at zero — a document with
           * nothing outstanding should say nothing, not say "0".
           */}
          {tallies.length > 0 && (
            <span
              data-testid="toc-question-count"
              className="flex shrink-0 gap-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400"
              title={tallySentence(tallies)}
              aria-label={tallySentence(tallies)}
            >
              {tallies.map((t) => (
                <span key={t.status ?? "unmarked"}>
                  <span aria-hidden="true">{t.glyph}</span> {t.count}
                </span>
              ))}
            </span>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            No headings in this document.
          </p>
        ) : (
          entries.map((entry, i) => (
            <OutlineLink
              key={entry.id || `${entry.kind}-${i}`}
              entry={entry}
              active={entry.id !== "" && entry.id === activeId}
              indent={8 + Math.min(entry.level - topLevel, MAX_INDENT) * 12}
              containerRef={containerRef}
            />
          ))
        )}
      </nav>
    </aside>
  );
};

/**
 * One entry, as a real link wherever it can be one.
 *
 * A link, not a button: this is the same "#id" navigation the heading's own
 * hover anchor offers, and it keeps what a button would drop — modifier-click
 * and middle-click open the section in a new tab, and right-click offers
 * "Copy Link" for the exact URL this entry addresses. `preventDefault` only
 * covers the plain click, so those all keep working natively.
 *
 * A question whose directive carried no `id=` has no URL to offer, so it renders
 * as a `span` that still scrolls. Rendering an `<a>` with no `href` would look
 * identical and quietly drop keyboard focus.
 */
const OutlineLink: React.FC<{
  entry: OutlineEntry;
  active: boolean;
  indent: number;
  containerRef: RefObject<HTMLElement | null>;
}> = ({ entry, active, indent, containerRef }) => {
  const question = entry.kind === "question";

  // `entry.element` and not `#${entry.id}`: for a question the anchor sits on the
  // leaning paragraph, so scrolling to it puts the question's own title above the
  // top of the viewport — the reader arrives at an answer to a question they
  // cannot see. The element is the enclosing item, which the active highlight
  // measures too. The `href` still addresses the anchor, which is what a
  // cross-document reference has to be able to use.
  const go = () => scrollToAnchorElement(entry.element, containerRef.current);

  const className = cn(
    "block w-full text-left py-1 pr-2 text-[13px] leading-snug no-underline transition-colors cursor-pointer",
    active
      ? "text-blue-600 dark:text-blue-400 font-medium"
      : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100",
  );

  /*
   * The marker is INSIDE the clamped box, not a sibling of it. `line-clamp` is
   * `display: -webkit-box`, so a clamped sibling is a block: the emoji ended up
   * alone on its own line above the title, turning every entry into three lines
   * and the column into a ladder. Inside, it is the first inline run of the text
   * it belongs to.
   *
   * Clamped rather than truncated in JS: a question title is a sentence, and two
   * lines of it is usually enough to recognize the question without making the
   * column a wall of text. The `title` carries the whole thing.
   */
  const body = (
    <span className={question ? "line-clamp-2" : undefined}>
      {entry.marker !== "" && (
        // The document's own text, shown rather than translated into a color:
        // it renders in print and in a theme that does not exist yet, which a
        // chip would not. `aria-hidden` because `entryAccessibleName` already
        // says the state in words.
        <span aria-hidden="true" className="mr-1">
          {entry.marker}
        </span>
      )}
      {entry.text}
    </span>
  );

  const shared = {
    "data-testid": question ? "toc-question" : "toc-heading",
    "aria-current": active ? ("location" as const) : undefined,
    title: question ? entryAccessibleName(entry) : undefined,
    className,
    style: { paddingLeft: `${indent}px` },
  };

  if (entry.id === "") {
    return (
      <span
        {...shared}
        role="link"
        tabIndex={0}
        onClick={go}
        // A real `<a>` gets this from the browser; a span with a link role has
        // to say it, or the entry is reachable by keyboard and does nothing.
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          go();
        }}
      >
        {body}
      </span>
    );
  }

  return (
    <a
      {...shared}
      href={`#${entry.id}`}
      aria-label={question ? entryAccessibleName(entry) : undefined}
      onClick={(e) => {
        e.preventDefault();
        window.history.replaceState(null, "", `#${entry.id}`);
        go();
      }}
    >
      {body}
    </a>
  );
};
