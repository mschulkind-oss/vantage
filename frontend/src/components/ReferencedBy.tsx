/**
 * Referenced by (`docs/reference/planning-index.md` §7): one line under a planning
 * document's frontmatter card saying how many documents link to it, whether the
 * roadmap routes it, and how many of its open questions the roadmap does not
 * (in the line's words, are *not on the roadmap*), and, behind that line,
 * those documents.
 *
 * With several roadmaps that route, the line names the first in roadmap order
 * that routes the document, by the fewest trailing directories that tell it
 * from the others, then how many more do, and its unrouted count is of the
 * questions no roadmap routes. It never reads the planning page's chosen
 * roadmap, so every reader, in every browser, sees the same line. A roadmap's
 * row in the list is named exactly as the line names it (see `labelsOf`).
 *
 * The line is the point. A list of every linking heading pushed a heavily cited
 * document's body a screen down to answer two questions a reader asks of it:
 * *is this on the roadmap?* and *who depends on it?* So the line answers the
 * first in words and the second in a count, and the list waits to be asked for.
 *
 * Its last part, for a live document holding a question, is a link to the
 * planning page filtered to that document, *its questions on the planning
 * page* (§7.1). It is a link of its own after the disclosure button and after
 * the plain-text line, never inside either, since a link inside a `<button>`
 * is invalid nested interactive content. It never shrinks: where the line is
 * cut off, the words before it give way.
 *
 * - **A disclosure button**, not `<details>`: `aria-expanded` and
 *   `aria-controls` on a real `<button>`, which is keyboard operable and which
 *   review mode's click handler already steps around. The list is rendered
 *   `hidden` while collapsed, so it neither reads out nor prints.
 * - **Collapsed on every document load.** Nothing is stored: the state lives in
 *   this component, and the viewer keys it by path, so expanding lasts for the
 *   visit and a different document starts collapsed.
 * - **With no document linking here** there is no list to open, so the line, if
 *   it has anything to say, is plain text rather than a button, and it may be
 *   the link alone.
 * - **One line from `sm` up, wrapped below it.** Cut off at a phone's width,
 *   the line lost its end, which is the roadmap's answer and the part the line
 *   exists for, and a touch screen has no hover to show the title. Below `sm`
 *   the line wraps, the link taking a line of its own under the words, with
 *   no separator to hang at a line's edge, and a row wraps with a hanging
 *   indent and breaks a file name with nowhere else to break rather than
 *   widen the page.
 * - **One line at every width when it fills a reservation** (`oneLine`): the
 *   line the viewer reserved at first paint for an index still on its way
 *   (`docs/reference/planning-index.md` §12.2) is one line tall, and a
 *   phone's wrapped line was two, so filling it moved the whole document down
 *   a line. There its words are cut off instead, for this visit only, with
 *   the whole of them in the title and the documents behind the disclosure,
 *   while the link keeps its width; the next visit has the index at first
 *   paint and wraps it.
 *
 * It sits inside the prose container, directly after the frontmatter card, so
 * it is built from elements nothing there reads as the document: no heading,
 * which the contents column would list; no `[data-vantage-oq]` or
 * `[data-vantage-question]`; no `p` or `li`, which review mode's hover would
 * offer to comment on; and no `data-source-line`,
 * so no review anchor can land on it. `not-prose` keeps typography's list and
 * paragraph styles off it, as they are off the frontmatter card.
 */
import { Fragment, useId, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ReferenceSource, ReferenceSummary } from "vantage-md/planning";
import { AppLink } from "./AppLink";
import { cn } from "../lib/utils";

interface ReferencedByProps {
  summary: ReferenceSummary;
  /** The viewer URL of a repository path, `/{repo}/…` in daemon mode. */
  hrefFor: (path: string) => string;
  /**
   * The planning page filtered to this document, or `null` where there is no
   * page to link: in a static export, or for a path no filter names. The line
   * links it only when the summary says the document has live questions (see
   * `summaryLine`).
   */
  planningHref?: string | null;
  /**
   * Keep the line to one line at every width, as it must be when it fills the
   * line reserved for it at first paint. Otherwise it wraps below `sm`.
   */
  oneLine?: boolean;
}

/** Marks the whole surface, for tests and for any pass that must step around it. */
export const REFERENCED_BY_ATTR = "data-vantage-referenced-by";

/** Headings a source's row shows before its "+M more". */
export const HEADINGS_SHOWN = 4;

const counted = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The words of the line's link to the filtered planning page (§7.1). */
const PLANNING_PART = "its questions on the planning page";

/** What the line says: up to four parts, joined by " · " in this order. */
export interface SummaryLine {
  /** `Referenced by N documents`; `null` when no document links here. */
  count: string | null;
  /**
   * `on the roadmap under X` when the roadmap routes it; with several that
   * route, `on plans/roadmap.md under X and N other roadmaps`, naming the
   * first that routes it. Otherwise `null`.
   */
  roadmap: string | null;
  /**
   * `K open questions not on the roadmap`, in the warning tone, or `null`
   * when there are none; `…not on any roadmap` with several that route: the
   * planning page's *Not on a roadmap*, in its words. Of questions, so it
   * stays true of a document the roadmap links only by heading, which routes
   * nothing (§4.3), and of the roadmap itself: it says what the roadmap leaves
   * out, never that the document is off it.
   */
  unrouted: string | null;
  /**
   * `its questions on the planning page`, always last: the words of a link to
   * the planning page filtered to this document (§7.1). Present when its
   * stage has no `done` role and it holds at least one question, of any
   * state, which the filter keeps (`hasLiveQuestions`), and there is a page
   * to link (`planningHref`). Otherwise `null`, and the rest of the line is
   * as it would be without it.
   */
  planning: string | null;
}

/**
 * The line for `summary` (§7), or `null` when nothing links to the document,
 * nothing in it is unrouted, and it has no link to the planning page. The
 * roadmap's answer comes before the unrouted count, and does not replace it: a
 * document the roadmap routes one question of can still hold another it does
 * not, which the planning page lists under *Not on a roadmap*, and this line
 * is where the document's own page says so.
 *
 * `planningHref` is the filtered planning page's address, or `null` where
 * there is none; the summary decides whether the line links it. So a live
 * document that nothing links to and that has nothing unrouted, such as one
 * whose questions are all settled, or any in a repository no roadmap routes,
 * gets a line holding only the link (§7.1).
 */
// eslint-disable-next-line react-refresh/only-export-components -- the component's own wording, exported for its tests
export function summaryLine(
  summary: ReferenceSummary,
  planningHref: string | null = null,
): SummaryLine | null {
  const n = summary.sources.length;
  const count =
    n > 0 ? `Referenced by ${counted(n, "document", "documents")}` : null;
  // One roadmap is "the roadmap"; with several, each is named as a row names
  // a file, so `roadmap.md` at the root reads beside `plans/roadmap.md`.
  const several = summary.roadmaps.length > 1;
  let roadmap: string | null = null;
  const [first, ...more] = summary.onRoadmaps;
  if (first !== undefined) {
    const name = several
      ? (labelsOf(summary).get(first.roadmap) ?? first.roadmap)
      : "the roadmap";
    roadmap = `on ${name}`;
    if (first.heading !== null) roadmap += ` under ${first.heading}`;
    if (more.length > 0) {
      roadmap += ` and ${counted(more.length, "other roadmap", "other roadmaps")}`;
    }
  }
  const unrouted =
    summary.unrouted > 0
      ? `${counted(summary.unrouted, "open question", "open questions")} not on ${several ? "any roadmap" : "the roadmap"}`
      : null;
  const planning =
    summary.hasLiveQuestions && planningHref !== null ? PLANNING_PART : null;
  if (
    count === null &&
    roadmap === null &&
    unrouted === null &&
    planning === null
  ) {
    return null;
  }
  return { count, roadmap, unrouted, planning };
}

/** The parts before the link: the words a button or the plain text holds. */
const partsOf = (line: SummaryLine) =>
  [line.count, line.roadmap, line.unrouted].filter((part) => part !== null);

const textOf = (line: SummaryLine) => partsOf(line).join(" · ");

function LineWords({ line }: { line: SummaryLine }) {
  return (
    <>
      {partsOf(line).map((part, i) => (
        <Fragment key={part}>
          {i > 0 && " · "}
          <span
            className={
              part === line.unrouted
                ? "font-medium text-[color:var(--vantage-tone-warning-ink)]"
                : undefined
            }
          >
            {part}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/** `a`–`z` for `A`–`Z`, and nothing else, as `hasRoadmapName` folds a name. */
const foldAscii = (text: string) =>
  text.replace(/[A-Z]+/g, (upper) => upper.toLowerCase());

/**
 * The label for each of `paths`: its file name, or, when another path in the
 * list has the same file name, the fewest trailing directories that tell it
 * apart, the way an editor labels two tabs of the same name. Sorted by path,
 * `docs/brainstorm/x.md` and `docs/design/x.md` would otherwise read as one
 * name twice, in an order that looks unsorted.
 *
 * Names are compared ASCII case-insensitively, as a roadmap's file name is
 * (§4.1): `roadmap.md`, `Roadmap.md` and `ROADMAP.md` are all roadmaps
 * found by one name, and a reader does not tell two files apart by the case of
 * a letter, so each of them gets a directory.
 */
function sourceLabels(paths: Iterable<string>): Map<string, string> {
  const parts = new Map(
    [...paths].map((path) => [path, foldAscii(path).split("/")]),
  );
  const all = [...parts.keys()];
  const tail = (path: string, n: number) =>
    parts.get(path)!.slice(-n).join("/");
  const labels = new Map<string, string>();
  for (const path of all) {
    const own = parts.get(path)!;
    let n = 1;
    while (
      n < own.length &&
      all.some((other) => other !== path && tail(other, n) === tail(path, n))
    ) {
      n += 1;
    }
    labels.set(path, path.split("/").slice(-n).join("/"));
  }
  return labels;
}

/**
 * The name of every file the surface shows: each linking document, and, when
 * the line names roadmaps because several route, each of those too. They are
 * labelled together, so a roadmap's row and the line name it the same way: a
 * `docs/roadmap.md` that is the only roadmap linking here is still
 * `docs/roadmap.md` in its row when `roadmap.md` at the root is a roadmap too.
 */
function labelsOf(summary: ReferenceSummary): Map<string, string> {
  const paths = new Set(summary.sources.map((source) => source.from));
  if (summary.roadmaps.length > 1) {
    for (const roadmap of summary.roadmaps) paths.add(roadmap);
  }
  return sourceLabels(paths);
}

interface SourceRowProps {
  source: ReferenceSource;
  /** What the row calls the source; see `labelsOf`. */
  name: string;
  hrefFor: (path: string) => string;
  expanded: boolean;
  onMore: () => void;
  /**
   * Called with the first heading past "+M more" on every render. It is always
   * mounted, since print shows it, so the caller focuses it only after a press.
   */
  revealedRef: (el: HTMLElement | null) => void;
}

/**
 * One source: its file name, then the headings its links sit under, each a
 * link to the first line under that heading that links here, which `#L…`
 * scrolls to and marks. A link above every heading has no heading to show, so
 * the file name links to it. Otherwise the file name links to the document
 * itself: its first link is its first heading's, and a second link to the same
 * line was one more keyboard stop that went nowhere new.
 */
function SourceRow({
  source,
  name,
  hrefFor,
  expanded,
  onMore,
  revealedRef,
}: SourceRowProps) {
  const href = hrefFor(source.from);
  const headed = source.references.filter((ref) => ref.heading !== null);
  const shownCount = expanded ? headed.length : HEADINGS_SHOWN;
  const more = Math.max(0, headed.length - shownCount);
  const first = source.references[0];
  return (
    <div
      role="listitem"
      className="pl-4 -indent-4 [overflow-wrap:anywhere] sm:pl-0 sm:indent-0"
    >
      <AppLink
        to={
          first === undefined || first.heading !== null
            ? href
            : `${href}#L${first.line}`
        }
        title={source.from}
        className="font-medium text-blue-600 hover:underline dark:text-blue-400"
      >
        {name}
      </AppLink>
      {headed.map((ref, i) => (
        <span
          key={ref.line}
          ref={i === HEADINGS_SHOWN ? revealedRef : undefined}
          // Past "+M more" on screen, but paper has nothing to press, so
          // every heading prints.
          className={i >= shownCount ? "hidden print:inline" : undefined}
        >
          {" · "}
          <AppLink
            to={`${href}#L${ref.line}`}
            className="text-[12px] text-slate-500 hover:text-blue-600 hover:underline dark:text-slate-400 dark:hover:text-blue-400"
          >
            {ref.heading}
          </AppLink>
        </span>
      ))}
      {more > 0 && (
        <span className="print:hidden">
          {" · "}
          <button
            type="button"
            onClick={onMore}
            aria-label={`+${more} more headings in ${name}`}
            className="text-[12px] text-slate-500 hover:text-blue-600 hover:underline dark:text-slate-400 dark:hover:text-blue-400"
          >
            +{more} more
          </button>
        </span>
      )}
    </div>
  );
}

export function ReferencedBy({
  summary,
  hrefFor,
  planningHref = null,
  oneLine = false,
}: ReferencedByProps) {
  const [open, setOpen] = useState(false);
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The row whose "+M more" was just pressed. The button leaves with the
  // press, so focus moves to the first heading it revealed rather than to
  // the document body.
  const focusRow = useRef<string | null>(null);
  const listId = useId();
  const line = summaryLine(summary, planningHref);
  if (line === null) return null;
  const text = textOf(line);
  const hasWords = partsOf(line).length > 0;
  const labels = labelsOf(summary);
  const truncate = oneLine ? "truncate" : "sm:truncate";
  const hasButton = summary.sources.length > 0;
  // The link's part, its separator and the link in one flex item, so the
  // separator always sits beside the link it joins. Where the line is one
  // line, the part keeps its width and the words before it are cut off
  // instead (§7.1). Below `sm`, unless it fills a
  // reservation, the part takes a line of its own, without the separator,
  // starting where the words start, after the button's chevron. Left to wrap
  // item by item, the separator hung alone at the end of the words' line or
  // opened the link's, joining nothing, and the link started under the
  // chevron rather than under the words.
  const linkPart = oneLine
    ? "shrink-0 whitespace-nowrap"
    : cn(
        "basis-full sm:basis-auto sm:shrink-0 sm:whitespace-nowrap",
        hasButton && "pl-[18px] sm:pl-0",
      );

  return (
    <div
      {...{ [REFERENCED_BY_ATTR]: "" }}
      className="not-prose mb-6 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400"
    >
      <div
        className={cn(
          "flex items-start",
          oneLine ? "flex-nowrap" : "flex-wrap sm:flex-nowrap",
        )}
      >
        {!hasWords ? null : !hasButton ? (
          <div className={cn("min-w-0", truncate)} title={text}>
            <LineWords line={line} />
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((was) => !was)}
            title={text}
            className="-ml-0.5 flex min-w-0 max-w-full items-start gap-1 rounded px-0.5 text-left hover:text-slate-700 dark:hover:text-slate-200"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "mt-[3.5px] size-3.5 shrink-0 transition-transform print:hidden",
                open && "rotate-90",
              )}
            />
            <span className={cn("min-w-0", truncate)}>
              <LineWords line={line} />
            </span>
          </button>
        )}
        {line.planning !== null && planningHref !== null && (
          <span className={linkPart}>
            {hasWords && (
              <span
                className={cn("whitespace-pre", !oneLine && "hidden sm:inline")}
              >
                {" · "}
              </span>
            )}
            {/* A plain link, so a Ctrl or middle click opens a tab, and it
                prints as text. Inline in its part, so only its words take a
                click, never the rest of a line of its own. */}
            <AppLink
              to={planningHref}
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              {line.planning}
            </AppLink>
          </span>
        )}
      </div>
      {summary.sources.length > 0 && (
        <nav
          id={listId}
          aria-label="Referenced by"
          hidden={!open}
          className="mt-1 pl-[18px]"
        >
          <div role="list" className="flex flex-col gap-1 sm:gap-0.5">
            {summary.sources.map((source) => (
              <SourceRow
                key={source.from}
                source={source}
                name={labels.get(source.from)!}
                hrefFor={hrefFor}
                expanded={expandedRows.has(source.from)}
                onMore={() => {
                  focusRow.current = source.from;
                  setExpandedRows((rows) => new Set(rows).add(source.from));
                }}
                revealedRef={(el) => {
                  if (el === null || focusRow.current !== source.from) return;
                  focusRow.current = null;
                  el.querySelector("a")?.focus();
                }}
              />
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
