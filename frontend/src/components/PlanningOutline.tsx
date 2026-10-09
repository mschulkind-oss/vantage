/**
 * The planning outline (`lib/planningOutline.ts`): the planning page's
 * contents column, titled *On this page*, in the place a document's table
 * of contents takes in the viewer (`docs/design/planning-to-do-list.md`
 * §3.5).
 *
 * The same column as the table of contents, drawn the same way: beside the
 * page's column, with no surface of its own, and `sticky` so it stays in
 * reach while the page scrolls. It lists the documents of *Needs you*'s full
 * cards, each with how many of its questions need you, then a line each for
 * the answered rows, *Blocked* and *Maintenance*. A document goes to its
 * first card; a line to the first answered row, or to its group's heading,
 * opening the group first.
 *
 * Every entry is a real link, so it takes the focus with Tab and follows
 * with Enter, and a modifier-click opens it in a tab of its own. It marks
 * where the reader is as the page scrolls
 * (`hooks/usePlanningOutlineActive.ts`).
 */
import React from "react";
import type { OutlineActive } from "../hooks/usePlanningOutlineActive";
import { shouldHandleInternalNavigation } from "../lib/navigation";
import type {
  OutlineDocument,
  OutlineLine,
  PlanningOutline as Outline,
} from "../lib/planningOutline";
import { cn } from "../lib/utils";

/** A path's file name, and the folders before it, `""` at the root. */
function splitPath(path: string): [dir: string, name: string] {
  const at = path.lastIndexOf("/");
  return at === -1 ? ["", path] : [path.slice(0, at), path.slice(at + 1)];
}

const needWord = (n: number) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? "needs" : "need"} you`;

/** The column's title. */
export const OUTLINE_TITLE = "On this page";

interface PlanningOutlineProps {
  /** The outline of the layout on screen; `null` before it. */
  outline: Outline | null;
  active: OutlineActive;
  /**
   * The roadmap picker, at the column's head when there is a choice. Drawn
   * only with the outline, so it must be known by the time the outline is.
   */
  picker: React.ReactNode;
  /** The URL of an entry: the page, at the element `target` names. */
  hrefOf: (target: string) => string;
  onLine: (line: OutlineLine) => void;
  onDocument: (document: OutlineDocument) => void;
}

export const PlanningOutline: React.FC<PlanningOutlineProps> = ({
  outline,
  active,
  picker,
  hrefOf,
  onLine,
  onDocument,
}) => (
  <aside
    data-testid="planning-outline"
    // As wide as the table of contents, and beside the cards as it is
    // beside a document: in a band glued to the pane's left.
    className="hidden md:block w-64 shrink-0"
  >
    {/* z-10 for the table of contents' reason: nothing a card renders may
        paint over the column and take its clicks. The scroll container clips
        what overflows it, focus rings included, and the picker's box is as
        wide as the column: so the nav reaches 4 px past the column on each
        side and pads its content back by as much, which leaves a ring (2 px,
        offset 1 px) room to be drawn whole without moving anything. */}
    <nav
      aria-label={OUTLINE_TITLE}
      className="sticky top-2 z-10 -mx-1 max-h-[calc(100vh-8rem)] overflow-y-auto px-1 pb-6"
    >
      {/* Nothing in the column before the outline: its head arrives with
          it, so the picker is never inserted above a label already painted
          (the column's width is held by the aside meanwhile). */}
      {outline !== null && picker}
      {outline !== null && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {OUTLINE_TITLE}
        </p>
      )}
      {outline !== null && (
        <ul className="space-y-1">
          {outline.documents.map((document) => (
            <li key={document.path}>
              <OutlineDocumentLink
                document={document}
                href={hrefOf(document.target)}
                active={
                  active.section === "needs-you" &&
                  active.path === document.path
                }
                onGo={() => onDocument(document)}
              />
            </li>
          ))}
          {outline.more > 0 && (
            <li
              data-testid="outline-more"
              className="py-1 pr-2 pl-2 text-xs text-slate-500 dark:text-slate-400"
            >
              and {outline.more.toLocaleString("en-US")} more{" "}
              {outline.more === 1 ? "document" : "documents"}
            </li>
          )}
          {outline.lines.map((line) => (
            <li key={line.id}>
              <OutlineLineLink
                line={line}
                href={hrefOf(line.target)}
                active={active.section === line.id}
                onGo={() => onLine(line)}
              />
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

const OutlineLineLink: React.FC<{
  line: OutlineLine;
  href: string;
  active: boolean;
  onGo: () => void;
}> = ({ line, href, active, onGo }) => (
  <a
    href={href}
    data-testid="outline-line"
    data-outline-line={line.id}
    title={line.explanation}
    aria-current={active ? "location" : undefined}
    onClick={(e) => follow(e, onGo)}
    className={cn(
      linkClass(active),
      "mt-1 pl-2 text-xs font-semibold uppercase tracking-wider",
    )}
  >
    {line.title}{" "}
    <span className="ml-1 font-normal tabular-nums">
      {line.total.toLocaleString("en-US")}
    </span>
  </a>
);

/**
 * A document, by its file name, with the folders it is in below it and how
 * many of its questions need you after it. The name has its line to itself:
 * the count wraps below it rather than take any of its width, and a name
 * longer than the column breaks rather than being cut, since two documents
 * may share every character but the last few. The folders, which say which
 * of two same-named documents this is, truncate, with the whole path in the
 * tooltip.
 */
const OutlineDocumentLink: React.FC<{
  document: OutlineDocument;
  href: string;
  active: boolean;
  onGo: () => void;
}> = ({ document, href, active, onGo }) => {
  const [dir, name] = splitPath(document.path);
  return (
    <a
      href={href}
      data-testid="outline-document"
      data-path={document.path}
      aria-current={active ? "location" : undefined}
      aria-label={`${document.path}, ${needWord(document.questions)}`}
      title={document.path}
      onClick={(e) => follow(e, onGo)}
      className={cn(linkClass(active), "pl-2 text-[13px]")}
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
        <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {document.questions.toLocaleString("en-US")}
        </span>
      </span>
      {dir !== "" && (
        <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
          {dir}/
        </span>
      )}
    </a>
  );
};
