/**
 * The planning outline (`lib/planningOutline.ts`): the planning page's
 * contents column, in the place a document's table of contents takes in the
 * viewer (`docs/reference/planning-index.md` §6.9).
 *
 * The same column as the table of contents, drawn the same way: beside the
 * page's column, with no surface of its own, and `sticky` so it stays in
 * reach while the page scrolls. It names each section with its count, and
 * the line under the section's heading as its tooltip, and, under it, the
 * documents the section lists, each with its questions there.
 * A section goes to its heading; a document goes to its first card or row
 * in the section, flipping the section to the page that holds it first.
 *
 * Every entry is a real link, so it takes the focus with Tab and follows
 * with Enter, and a modifier-click opens it in a tab of its own: a
 * document's link names the page and the card in its URL. It marks where
 * the reader is as the page scrolls (`hooks/usePlanningOutlineActive.ts`).
 */
import React from "react";
import type { OutlineActive } from "../hooks/usePlanningOutlineActive";
import { shouldHandleInternalNavigation } from "../lib/navigation";
import type { OutlineDocument, OutlineSection } from "../lib/planningOutline";
import type { SectionId } from "../lib/planningPages";
import { cn } from "../lib/utils";

/** A path's file name, and the folders before it, `""` at the root. */
function splitPath(path: string): [dir: string, name: string] {
  const at = path.lastIndexOf("/");
  return at === -1 ? ["", path] : [path.slice(0, at), path.slice(at + 1)];
}

const questionsWord = (n: number) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? "question" : "questions"}`;

interface PlanningOutlineProps {
  /** The outline of the sections in the page's frame; `null` before it. */
  outline: readonly OutlineSection[] | null;
  active: OutlineActive;
  /**
   * The roadmap picker, at the column's head when there is a choice. Drawn
   * only with the outline, so it must be known by the time the outline is.
   */
  picker: React.ReactNode;
  /** The URL of a document's entry: the section on its page, at its card. */
  hrefOf: (section: SectionId, document: OutlineDocument) => string;
  onSection: (id: SectionId) => void;
  onDocument: (id: SectionId, document: OutlineDocument) => void;
  /**
   * Ask ahead for the inputs of the page a document's entry flips to, when
   * the pointer or the focus reaches it, as a pager does.
   */
  onPrefetch?: (id: SectionId, page: number) => void;
}

export const PlanningOutline: React.FC<PlanningOutlineProps> = ({
  outline,
  active,
  picker,
  hrefOf,
  onSection,
  onDocument,
  onPrefetch,
}) => (
  <aside
    data-testid="planning-outline"
    // As wide as the table of contents, and beside the cards as it is
    // beside a document: in a band glued to the pane's left.
    className="hidden md:block w-64 shrink-0"
  >
    {/* z-10 for the table of contents' reason: nothing a card renders may
        paint over the column and take its clicks. */}
    <nav
      aria-label="Planning outline"
      className="sticky top-2 z-10 max-h-[calc(100vh-8rem)] overflow-y-auto pb-6"
    >
      {/* Nothing in the column before the outline: its head arrives with
          it, in the commit that draws the section bar, so the picker is never
          inserted above a label already painted (the column's width is held
          by the aside meanwhile). */}
      {outline !== null && picker}
      {outline !== null && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Contents
        </p>
      )}
      {outline !== null && (
        <ul className="space-y-1">
          {outline.map((section) => (
            <li key={section.id}>
              <OutlineSectionLink
                section={section}
                active={active.section === section.id}
                onGo={() => onSection(section.id)}
              />
              {section.documents.length > 0 && (
                <ul>
                  {section.documents.map((document) => (
                    <li key={document.path}>
                      <OutlineDocumentLink
                        document={document}
                        href={hrefOf(section.id, document)}
                        active={
                          active.section === section.id &&
                          active.path === document.path
                        }
                        onGo={() => onDocument(section.id, document)}
                        onReach={
                          onPrefetch &&
                          (() => onPrefetch(section.id, document.page))
                        }
                      />
                    </li>
                  ))}
                  {section.more > 0 && (
                    <li
                      data-testid="outline-more"
                      className="py-1 pr-2 pl-5 text-xs text-slate-500 dark:text-slate-400"
                    >
                      and {section.more.toLocaleString("en-US")} more{" "}
                      {section.more === 1 ? "document" : "documents"}
                    </li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </nav>
  </aside>
);

const linkClass = (active: boolean) =>
  cn(
    "block w-full text-left py-1 pr-2 leading-snug no-underline transition-colors cursor-pointer",
    active
      ? "text-blue-600 dark:text-blue-400"
      : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100",
  );

/** A plain click is the page's; a modified one opens a tab, as a link does. */
function follow(e: React.MouseEvent, go: () => void): void {
  if (!shouldHandleInternalNavigation(e)) return;
  e.preventDefault();
  go();
}

const OutlineSectionLink: React.FC<{
  section: OutlineSection;
  active: boolean;
  onGo: () => void;
}> = ({ section, active, onGo }) => (
  <a
    href={`#${section.id}`}
    data-testid="outline-section"
    title={section.explanation}
    aria-current={active ? "location" : undefined}
    onClick={(e) => follow(e, onGo)}
    className={cn(
      linkClass(active),
      "pl-2 text-xs font-semibold uppercase tracking-wider",
    )}
  >
    {section.title}{" "}
    <span className="ml-1 font-normal tabular-nums">
      {section.total.toLocaleString("en-US")}
    </span>
  </a>
);

/**
 * A document, by its file name, with the folders it is in below it and its
 * questions after it. The name has its line to itself: the count wraps below
 * it rather than take any of its width, and a name longer than the column
 * breaks rather than being cut, since two documents may share every
 * character but the last few. The folders, which say which of two same-named
 * documents this is, truncate, with the whole path in the tooltip.
 */
const OutlineDocumentLink: React.FC<{
  document: OutlineDocument;
  href: string;
  active: boolean;
  onGo: () => void;
  onReach?: () => void;
}> = ({ document, href, active, onGo, onReach }) => {
  const [dir, name] = splitPath(document.path);
  const counted = document.questions > 0;
  return (
    <a
      href={href}
      data-testid="outline-document"
      data-path={document.path}
      aria-current={active ? "location" : undefined}
      aria-label={
        counted
          ? `${document.path}, ${questionsWord(document.questions)}`
          : document.path
      }
      title={document.path}
      onClick={(e) => follow(e, onGo)}
      onPointerEnter={onReach}
      onFocus={onReach}
      className={cn(linkClass(active), "pl-5 text-[13px]")}
    >
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <span
          data-testid="outline-document-name"
          className={cn(
            "min-w-0 [overflow-wrap:anywhere]",
            active && "font-medium",
          )}
        >
          {name}
        </span>
        {counted && (
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {document.questions.toLocaleString("en-US")}
          </span>
        )}
      </span>
      {dir !== "" && (
        <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
          {dir}/
        </span>
      )}
    </a>
  );
};
