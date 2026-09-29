/**
 * Referenced by (`docs/design/planning-index.md` §7): one line under a planning
 * document's frontmatter card saying how many documents link to it, whether the
 * roadmap routes it, and how many of its open questions the roadmap does not,
 * and, behind that line, those documents.
 *
 * The line is the point. A list of every linking heading pushed a heavily cited
 * document's body a screen down to answer two questions a reader asks of it:
 * *is this on the roadmap?* and *who depends on it?* So the line answers the
 * first in words and the second in a count, and the list waits to be asked for.
 *
 * - **A disclosure button**, not `<details>`: `aria-expanded` and
 *   `aria-controls` on a real `<button>`, which is keyboard operable and which
 *   review mode's click handler already steps around. The list is rendered
 *   `hidden` while collapsed, so it neither reads out nor prints.
 * - **Collapsed on every document load.** Nothing is stored: the state lives in
 *   this component, and the viewer keys it by path, so expanding lasts for the
 *   visit and a different document starts collapsed.
 * - **With no document linking here** there is no list to open, so the line, if
 *   it has anything to say, is plain text rather than a button.
 * - **One line from `sm` up, wrapped below it.** Cut off at a phone's width,
 *   the line lost its end, which is the roadmap's answer and the part the line
 *   exists for, and a touch screen has no hover to show the title. Below `sm`
 *   the line wraps, and a row wraps with a hanging indent and breaks a file
 *   name with nowhere else to break rather than widen the page.
 *
 * It sits inside the prose container, directly after the frontmatter card, so
 * it is built from elements nothing there reads as the document: no heading,
 * which the contents column would list; no `[data-vantage-oq]`; no `p` or `li`,
 * which review mode's hover would offer to comment on; and no `data-source-line`,
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
}

/** Marks the whole surface, for tests and for any pass that must step around it. */
export const REFERENCED_BY_ATTR = "data-vantage-referenced-by";

/** Headings a source's row shows before its "+M more". */
export const HEADINGS_SHOWN = 4;

const counted = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** What the line says: up to three parts, joined by " · " in this order. */
export interface SummaryLine {
  /** `Referenced by N documents`; `null` when no document links here. */
  count: string | null;
  /** `on the roadmap under X` when the roadmap routes it, otherwise `null`. */
  roadmap: string | null;
  /**
   * `K open questions not routed by the roadmap`, in the warning tone, or
   * `null` when there are none. Worded so that it stays true of a document the
   * roadmap links only by heading, which routes nothing (§6.1), and of the
   * roadmap itself: it says what the roadmap leaves out, never that the
   * document is off it.
   */
  unrouted: string | null;
}

/**
 * The line for `summary` (§7), or `null` when nothing links to the document and
 * nothing in it is unrouted. The roadmap's answer comes before the unrouted
 * count, and does not replace it: a document the roadmap routes one question
 * of can still hold another it does not, which the planning page lists under
 * *Unrouted*, and this line is where the document's own page says so.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the component's own wording, exported for its tests
export function summaryLine(summary: ReferenceSummary): SummaryLine | null {
  const n = summary.sources.length;
  const count =
    n > 0 ? `Referenced by ${counted(n, "document", "documents")}` : null;
  let roadmap: string | null = null;
  if (summary.onRoadmap !== null) {
    const { heading } = summary.onRoadmap;
    roadmap =
      heading === null ? "on the roadmap" : `on the roadmap under ${heading}`;
  }
  const unrouted =
    summary.unrouted > 0
      ? `${counted(summary.unrouted, "open question", "open questions")} not routed by the roadmap`
      : null;
  if (count === null && roadmap === null && unrouted === null) return null;
  return { count, roadmap, unrouted };
}

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

/**
 * The label for each of `paths`: its file name, or, when another path in the
 * list has the same file name, the fewest trailing directories that tell it
 * apart, the way an editor labels two tabs of the same name. Sorted by path,
 * `docs/brainstorm/x.md` and `docs/design/x.md` would otherwise read as one
 * name twice, in an order that looks unsorted.
 */
function sourceLabels(paths: readonly string[]): Map<string, string> {
  const parts = new Map(paths.map((path) => [path, path.split("/")]));
  const tail = (path: string, n: number) =>
    parts.get(path)!.slice(-n).join("/");
  const labels = new Map<string, string>();
  for (const path of paths) {
    const own = parts.get(path)!;
    let n = 1;
    while (
      n < own.length &&
      paths.some((other) => other !== path && tail(other, n) === tail(path, n))
    ) {
      n += 1;
    }
    labels.set(path, tail(path, n));
  }
  return labels;
}

interface SourceRowProps {
  source: ReferenceSource;
  /** What the row calls the source; see `sourceLabels`. */
  name: string;
  hrefFor: (path: string) => string;
  expanded: boolean;
  onMore: () => void;
  /** Called with the first heading "+M more" revealed, once it mounts. */
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
  const shown = expanded ? headed : headed.slice(0, HEADINGS_SHOWN);
  const more = headed.length - shown.length;
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
      {shown.map((ref, i) => (
        <span
          key={ref.line}
          ref={i === HEADINGS_SHOWN ? revealedRef : undefined}
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
        <>
          {" · "}
          <button
            type="button"
            onClick={onMore}
            aria-label={`+${more} more headings in ${name}`}
            className="text-[12px] text-slate-500 hover:text-blue-600 hover:underline dark:text-slate-400 dark:hover:text-blue-400"
          >
            +{more} more
          </button>
        </>
      )}
    </div>
  );
}

export function ReferencedBy({ summary, hrefFor }: ReferencedByProps) {
  const [open, setOpen] = useState(false);
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The row whose "+M more" was just pressed. The button leaves with the
  // press, so focus moves to the first heading it revealed rather than to
  // the document body.
  const focusRow = useRef<string | null>(null);
  const listId = useId();
  const line = summaryLine(summary);
  if (line === null) return null;
  const text = textOf(line);
  const labels = sourceLabels(summary.sources.map((source) => source.from));

  return (
    <div
      {...{ [REFERENCED_BY_ATTR]: "" }}
      className="not-prose mb-6 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400"
    >
      {summary.sources.length === 0 ? (
        <div className="sm:truncate" title={text}>
          <LineWords line={line} />
        </div>
      ) : (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((was) => !was)}
            title={text}
            className="-ml-0.5 flex max-w-full items-start gap-1 rounded px-0.5 text-left hover:text-slate-700 dark:hover:text-slate-200"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "mt-[3.5px] size-3.5 shrink-0 transition-transform print:hidden",
                open && "rotate-90",
              )}
            />
            <span className="min-w-0 sm:truncate">
              <LineWords line={line} />
            </span>
          </button>
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
        </>
      )}
    </div>
  );
}
