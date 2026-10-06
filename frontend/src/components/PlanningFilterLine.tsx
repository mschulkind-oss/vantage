/**
 * The planning page's filter line (`docs/design/planning-filter.md` §7): one
 * fixed-height row at the top of the page's column, above every state of the
 * route, holding the Filter box.
 *
 * - **Its text comes from the URL, and only Enter applies it.** The box is
 *   local state, so typing changes nothing but the box: nothing is laid out
 *   per keystroke. Enter, ✕ and a pasted planning link apply, through
 *   `onApply`, which the page turns into one replace navigation (§6.4).
 * - **It follows every navigation it did not cause.** `BrowserRouter` commits
 *   a location in a transition, so a box controlled from the URL would drop
 *   keystrokes; instead the box is reset from the URL whenever the location's
 *   key changes. A push (`g p`, the sidebar's entry) or a pop (Back,
 *   Forward) resets it even while it has the focus, dropping any unapplied
 *   text; the page's own replaces (its canonical rewrite, a clamp, a flip, a
 *   pick) reset it only while it lacks the focus. Between them, the box is
 *   rewritten while it has the focus only by the reader's own Enter, ✕ or
 *   paste, which set the text they navigate to first.
 * - **It never moves anything.** Its height is fixed, its text is complete
 *   at first paint, and its ✕, hint and spinner each have a slot that is
 *   always there. At narrow widths the hint gives way first, then the
 *   visible label, which stays the accessible name; the row never wraps.
 * - **Esc never clears** (§7): it puts back the applied text over unapplied
 *   text, and otherwise hands the focus back to the pane.
 *
 * The page draws it in every state but a static export, which has no
 * planning page to filter.
 */
import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { Loader2, X } from "lucide-react";
import { readPastedPlanningLink } from "vantage-md/planning";
import { filterValue } from "../lib/planningPages";
import { cn } from "../lib/utils";

/** A real filter, as the placeholder offers it: what the notice's example is. */
export const FILTER_PLACEHOLDER = "path:docs/design/*.md is:open";

/** What the hint slot says while the box holds text the page does not show. */
export const FILTER_HINT = "Enter to apply";

export const PlanningFilterLine: React.FC<{
  /**
   * The URL's filter text as written: every `filter` value joined with one
   * space, `""` for none. What the box shows on open and after any
   * navigation it did not cause.
   */
  urlText: string;
  /** The URL's filter is not understood: `aria-invalid`, and an amber ring. */
  invalid: boolean;
  /** The page has waited past `spinnerMs` for a filter's page inputs. */
  busy: boolean;
  /**
   * Apply `text`, and choose `roadmap` when a pasted link names one: the
   * page's one replace navigation (§6.4). Text already applied does nothing.
   */
  onApply: (text: string, roadmap: string | null) => void;
  /** Esc with nothing unapplied: the focus back to the page's pane. */
  onLeave: () => void;
  /** The input, for `/`, which focuses it and selects its text. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** The filter notice's id, which describes the input while there is one. */
  describedBy?: string;
  /** What the polite live region says: the notice, after an Enter or ✕. */
  announcement: string;
  /**
   * The applied filter's canonical text, `""` for none: the line a printout
   * shows in place of the box, so it always says it is filtered.
   */
  printText: string;
}> = ({
  urlText,
  invalid,
  busy,
  onApply,
  onLeave,
  inputRef,
  describedBy,
  announcement,
  printText,
}) => {
  const id = useId();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [text, setText] = useState(urlText);

  // Reset from the URL on every navigation the box did not cause, before it
  // paints: a push or a pop always, a replace only while the box lacks the
  // focus, since the box's own Enter is a replace that already set its text.
  const seenKey = useRef(location.key);
  useLayoutEffect(() => {
    if (seenKey.current === location.key) return;
    seenKey.current = location.key;
    const focused =
      inputRef.current !== null && inputRef.current === document.activeElement;
    if (navigationType !== "REPLACE" || !focused) setText(urlText);
  }, [location.key, navigationType, urlText, inputRef]);

  /** Apply `next`, showing it in the box as the URL will hold it. */
  const apply = (next: string, roadmap: string | null = null) => {
    setText(filterValue(next));
    onApply(next, roadmap);
  };

  const unapplied = text !== urlText;
  return (
    <div className="@container mb-4">
      <form
        role="search"
        aria-label="Filter the planning page"
        data-testid="planning-filter"
        onSubmit={(e) => {
          // A form submits on Enter, which would reload the page.
          e.preventDefault();
          apply(text);
        }}
        className="flex h-9 flex-nowrap items-center gap-2 print:hidden"
      >
        <label
          htmlFor={id}
          className="sr-only shrink-0 text-sm font-medium text-slate-600 @sm:not-sr-only dark:text-slate-300"
        >
          Filter
        </label>
        <div
          className={cn(
            "flex h-8 min-w-32 flex-1 items-center rounded-md border bg-white pl-2 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-blue-500 dark:bg-slate-800",
            invalid
              ? "border-amber-500 ring-1 ring-amber-500 dark:border-amber-400 dark:ring-amber-400"
              : "border-slate-300 dark:border-slate-600",
          )}
        >
          <input
            ref={inputRef}
            id={id}
            // Not `search`: Chrome clears that kind on Esc (§7).
            type="text"
            value={text}
            placeholder={FILTER_PLACEHOLDER}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              if (unapplied) setText(urlText);
              else onLeave();
            }}
            onPaste={(e) => {
              // A pasted planning link applies at once, whole or inside the
              // lines the checker prints around it (§7); anything else is
              // text, applied on Enter as typed text is.
              const link = readPastedPlanningLink(
                e.clipboardData.getData("text"),
              );
              if (link === null) return;
              e.preventDefault();
              apply(link.filter, link.roadmap);
            }}
            className="h-full min-w-0 flex-1 bg-transparent font-mono text-[13px] text-slate-800 outline-none placeholder:text-slate-500 dark:text-slate-100 dark:placeholder:text-slate-400"
          />
          {/* ✕'s slot, always there and empty while there is no text. */}
          <span className="flex size-7 shrink-0 items-center justify-center">
            {text !== "" && (
              <button
                type="button"
                aria-label="Clear the filter"
                title="Clear the filter"
                onClick={() => {
                  apply("");
                  // The focus stays in the box (§7).
                  inputRef.current?.focus();
                }}
                className="flex size-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </span>
        </div>
        {/* The hint's slot: as wide as its one text, and the first thing to
            give way at a narrow width. */}
        <span
          data-testid="planning-filter-hint"
          className="hidden w-28 shrink-0 text-xs whitespace-nowrap text-slate-500 @lg:block dark:text-slate-400"
        >
          {unapplied && FILTER_HINT}
        </span>
        <span
          data-testid="planning-filter-spinner-slot"
          className="flex size-3.5 shrink-0 items-center justify-center"
        >
          {busy && (
            <Loader2
              size={14}
              className="animate-spin text-blue-600"
              aria-hidden="true"
            />
          )}
        </span>
        <span
          data-testid="planning-filter-status"
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </span>
      </form>
      {printText !== "" && (
        <p
          data-testid="planning-filter-print"
          className="hidden text-sm text-slate-700 print:block dark:text-slate-200"
        >
          Filter: <code>{printText}</code>
        </p>
      )}
    </div>
  );
};
