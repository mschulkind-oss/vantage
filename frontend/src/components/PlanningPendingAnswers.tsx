import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { AnchoredMenu } from "./AnchoredMenu";
import { AppLink } from "./AppLink";
import { RESERVED_ICON_SIZE, ReservedLabel } from "./ReservedLabel";
import type { PendingGroup } from "../lib/planningAnswers";

/** Bound mounted previews, even when Copy answers holds thousands of comments. */
const ANSWERS_PER_PAGE = 20;

/** Inspect exactly the groups Copy answers copies, without another request. */
export function PlanningPendingAnswers({
  groups,
  known,
  leftOut,
  hrefOf,
  onOpenDocument,
}: {
  groups: readonly PendingGroup[];
  known: boolean;
  leftOut: number;
  hrefOf: (path: string) => string;
  onOpenDocument: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuAnchorRef = useRef<HTMLElement>(null);
  const entriesRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const close = useCallback(() => setOpen(false), []);
  const entries = useMemo(
    () =>
      groups.flatMap(({ path, comments }) =>
        comments.map((comment) => ({ path, comment })),
      ),
    [groups],
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(entries.length / ANSWERS_PER_PAGE) - 1),
  );
  const start = currentPage * ANSWERS_PER_PAGE;
  const shown = entries.slice(start, start + ANSWERS_PER_PAGE);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    entriesRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus();
  }, [currentPage]);
  const flip = (next: number) => {
    refocus.current = true;
    setPage(next);
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={!known || entries.length === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        title="See the documents and comments included in Copy answers"
        onClick={() => {
          // Entering a portaled menu closes the compact toolbar's panel.
          // Anchor to its persistent ⋯ button in that case, so placement and
          // Escape's focus return never target a now-hidden Review button.
          const toolbar = anchorRef.current?.closest(
            ".hdr-overflow[data-open]",
          );
          menuAnchorRef.current =
            toolbar?.querySelector<HTMLElement>(".hdr-more") ??
            anchorRef.current;
          setPage(0);
          setOpen((value) => !value);
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        <ReservedLabel
          icon={<MessageSquare size={RESERVED_ICON_SIZE} aria-hidden="true" />}
          label="Review answers"
          reserve={["Review answers"]}
          labelClassName="hdr-label"
        />
      </button>
      <AnchoredMenu
        open={open}
        onClose={close}
        anchorRef={menuAnchorRef}
        width={440}
        aria-label="Answers waiting on the agent"
      >
        <div className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
          <p className="font-semibold">Answers waiting on the agent</p>
          <p>
            {entries.length} {entries.length === 1 ? "answer" : "answers"} in{" "}
            {groups.length} {groups.length === 1 ? "document" : "documents"}.
            Open a source to review its comment; nothing is sent or marked
            answered.
          </p>
          {leftOut > 0 && (
            <p>
              The filter leaves out {leftOut}{" "}
              {leftOut === 1 ? "answer" : "answers"}. Clear it to review those
              too.
            </p>
          )}
          <p>
            Links use the comment's recorded line; text may have moved since it
            was filed.
          </p>
        </div>
        <div ref={entriesRef}>
          {shown.map(({ path, comment }, i) => {
            const recordedLine = comment.anchor?.source_line;
            const line =
              typeof recordedLine === "number" &&
              Number.isInteger(recordedLine) &&
              recordedLine > 0
                ? recordedLine
                : undefined;
            const source = comment.selected_text || comment.fallback_text;
            const followUp = comment.reactions
              ?.filter((r) => r.actor === "reviewer")
              .at(-1)?.summary;
            return (
              <div key={`${path}\n${comment.id}`}>
                {(i === 0 || shown[i - 1]?.path !== path) && (
                  <p className="border-t border-slate-200 px-3 pt-2 text-xs font-semibold [overflow-wrap:anywhere] text-slate-700 dark:border-slate-700 dark:text-slate-200">
                    {path}
                  </p>
                )}
                <AppLink
                  role="menuitem"
                  tabIndex={-1}
                  to={`${hrefOf(path)}${line === undefined ? "" : `#L${line}`}`}
                  aria-label={`Open ${path}${line === undefined ? "" : ` at line ${line}`}`}
                  onBeforeNavigate={() => {
                    onOpenDocument();
                    close();
                  }}
                  className="block px-3 py-2 text-sm no-underline [overflow-wrap:anywhere] text-slate-700 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:text-slate-200 dark:hover:bg-slate-700 dark:focus:bg-slate-700"
                >
                  <span className="text-xs text-blue-600 dark:text-blue-400">
                    Open document{line === undefined ? "" : ` at line ${line}`}{" "}
                    · {comment.id.slice(0, 8)}
                  </span>
                  {source && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      On: {source}
                    </p>
                  )}
                  <p className="mt-1 whitespace-pre-wrap">{comment.comment}</p>
                  {followUp && (
                    <p className="mt-1 whitespace-pre-wrap">
                      Follow-up: {followUp}
                    </p>
                  )}
                </AppLink>
              </div>
            );
          })}
        </div>
        {entries.length === 0 && (
          <p className="px-3 py-2 text-sm">
            No answers are waiting on the agent.
          </p>
        )}
        {entries.length > ANSWERS_PER_PAGE && (
          <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
            {currentPage > 0 && (
              <button
                type="button"
                role="menuitem"
                onClick={() => flip(currentPage - 1)}
              >
                Previous answers
              </button>
            )}
            <span>
              {start + 1}–{start + shown.length} of {entries.length}
            </span>
            {start + shown.length < entries.length && (
              <button
                type="button"
                role="menuitem"
                onClick={() => flip(currentPage + 1)}
              >
                Next answers
              </button>
            )}
          </div>
        )}
      </AnchoredMenu>
    </>
  );
}
