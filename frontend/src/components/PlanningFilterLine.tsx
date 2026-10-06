/**
 * The planning page's filter line (`docs/reference/planning-index.md`
 * §6.17): one fixed-height row at the top of the page's column, above every
 * state of the route, holding the Filter box.
 *
 * - **Typing applies, and the box never waits for it** (§6.16, F7). The box's
 *   text is local state, so a keystroke's own render is the box's alone, and
 *   each change is handed to the page through `onType`, which lays out its
 *   results in a transition and writes the URL after the idle pause. While an
 *   input method composes nothing is handed over; the composed text is, when
 *   the composition ends. Enter, ✕ and a pasted planning link apply at once,
 *   through `onApply`; other pasted text is typing written at once; leaving
 *   the box asks for a write still owed (`onFlush`).
 * - **It follows every navigation it did not cause.** `BrowserRouter` commits
 *   a location in a transition, so a box controlled from the URL would drop
 *   keystrokes; instead the box is reset from the URL whenever the location's
 *   key changes. A push (`g p`, the sidebar's entry) or a pop (Back,
 *   Forward) resets it even while it has the focus, dropping any text not
 *   yet written. The page's own replaces (the idle pause's write, its
 *   canonical rewrite, a clamp, a flip, a pick) never reset it while it has
 *   the focus, and without it only while it still holds the text the URL
 *   held before: so no write of the reader's own text touches it, caret and
 *   selection included, and a link opened in a spelling of its own still
 *   shows its canonical text once the page rewrites it. Between them, the
 *   box is rewritten while it has the focus only by the reader's own Enter,
 *   ✕ or paste, which set the text they navigate to first.
 * - **It never moves anything.** Its height is fixed, its text is complete
 *   at first paint, and its ✕, hint and spinner each have a slot that is
 *   always there. At narrow widths the hint's words give way first, to an
 *   icon in a slot of its own, then the visible label, which stays the
 *   accessible name; the row never wraps. The input's description names the
 *   hint while it shows, at every width.
 * - **Esc never clears** (§6.17): it puts back the applied filter's text over a
 *   text that is not applied, and otherwise hands the focus back to the pane.
 *
 * The page draws it in every state but a static export, which has no
 * planning page to filter.
 */
import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { AlertCircle, Loader2, X } from "lucide-react";
import {
  parsePlanningFilter,
  readPastedPlanningLink,
} from "vantage-md/planning";
import { filterValue } from "../lib/planningPages";
import { cn } from "../lib/utils";

/** A real filter, as the placeholder offers it: what the notice's example is. */
export const FILTER_PLACEHOLDER = "path:docs/design/*.md is:open";

/**
 * What the hint slot says while the box holds a text that is not applied: one
 * the language cannot read, which the reader has not entered (§6.17). Enter
 * applies it as written, and the notice then names what it cannot read.
 */
export const FILTER_HINT = "Not applied: Enter says why";

export const PlanningFilterLine: React.FC<{
  /**
   * The URL's filter text as written: every `filter` value joined with one
   * space, `""` for none. What the box shows on open and after any
   * navigation it did not cause.
   */
  urlText: string;
  /**
   * The text Esc puts back over a text that is not applied: the newest
   * understood text the reader typed while the URL has not taken it, which
   * the page applies, or holds back until the URL takes it when it keeps no
   * entry (§6.16); else the URL's text.
   */
  appliedText: string;
  /**
   * The page applies the reader's newest understood text, which the URL has
   * not taken: no text the URL holds is the applied one then, so one the
   * language cannot read is not applied even where the URL holds it.
   */
  leads?: boolean;
  /**
   * A not-understood filter is applied, from the URL or an Enter:
   * `aria-invalid`, and an amber ring. Never for one only typed (§6.17).
   */
  invalid: boolean;
  /**
   * Another filter's page is on its way: the spinner is drawn now, and shows
   * once this many milliseconds have passed, which the browser times on its
   * own, so no later render need land first. `null` for no spinner.
   */
  busyAfter: number | null;
  /**
   * The box's text changed: each keystroke's, a composition's once it ends,
   * and a paste that is no planning link's. `now` is set for the paste, which
   * is written at once rather than after the idle pause (§6.16).
   */
  onType: (text: string, now: boolean) => void;
  /**
   * Apply `text` at once, and choose `roadmap` when a pasted link names one:
   * Enter, ✕ and a pasted link, one replace navigation (§6.16). Text already
   * applied and written does nothing.
   */
  onApply: (text: string, roadmap: string | null) => void;
  /** The focus left the box: a write the idle pause still owes is made now. */
  onFlush: () => void;
  /** Esc with nothing unapplied: the focus back to the page's pane. */
  onLeave: () => void;
  /** The input, for `/`, which focuses it and selects its text. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** The filter notice's id, which describes the input while there is one. */
  describedBy?: string;
  /** What the polite live region says: the notice, once the URL takes it. */
  announcement: string;
  /**
   * The applied filter's canonical text, `""` for none: the line a printout
   * shows in place of the box, so it always says it is filtered.
   */
  printText: string;
}> = ({
  urlText,
  appliedText,
  leads = false,
  invalid,
  busyAfter,
  onType,
  onApply,
  onFlush,
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
  // The text as last committed, for the reset below, which runs after it.
  const textRef = useRef(text);
  useLayoutEffect(() => {
    textRef.current = text;
  });
  // What the box's own Enter, ✕ or paste just applied, as the URL will hold
  // it, until the next location or the reader's next change: the router
  // commits a location in a transition, and until it does the URL still
  // holds the old text, which the box neither calls not applied nor puts
  // back on Esc (§6.17).
  const [applied, setApplied] = useState<string | null>(null);

  // Reset from the URL on every navigation the box did not cause, before it
  // paints: a push or a pop always; a replace never while the box has the
  // focus, and without it only while the box holds what the URL held before
  // it, so the reader's own text, written on the idle pause or as the focus
  // left, is never rewritten under them.
  const seenKey = useRef(location.key);
  const seenText = useRef(urlText);
  useLayoutEffect(() => {
    if (seenKey.current === location.key) return;
    seenKey.current = location.key;
    const before = seenText.current;
    seenText.current = urlText;
    setApplied(null);
    const focused =
      inputRef.current !== null && inputRef.current === document.activeElement;
    const untouched = textRef.current === before;
    if (navigationType !== "REPLACE" || (!focused && untouched)) {
      setText(urlText);
    }
  }, [location.key, navigationType, urlText, inputRef]);

  /** Apply `next`, showing it in the box as the URL will hold it. */
  const apply = (next: string, roadmap: string | null = null) => {
    const value = filterValue(next);
    setText(value);
    setApplied(value);
    onApply(next, roadmap);
  };

  // An input method is composing: nothing is handed to the page until it
  // ends (§6.17), so the page never chases unconverted letters.
  const composing = useRef(false);
  // A paste that is no planning link is typing written at once: its change
  // follows the paste event in the same task, so the mark is gone by the
  // next one.
  const pasted = useRef(false);

  // Not applied: a text the language cannot read, which the reader has not
  // entered. Every other text the box holds is applied, or on its way. While
  // the page applies a text typed since, what the URL holds is not entered.
  const entered = applied ?? (leads ? null : urlText);
  const unapplied =
    text !== entered && parsePlanningFilter(text).kind === "not-understood";
  // The hint's words, which describe the box while it shows: at a narrow
  // width only an icon is drawn, and the words are for assistive technology
  // alone (§6.17).
  const hintId = useId();
  const described =
    [describedBy, unapplied ? hintId : undefined].filter(Boolean).join(" ") ||
    undefined;
  return (
    // In print the input row is hidden, and with no filter the line with
    // it, margin and all: a printout of the page changes only to say it is
    // filtered (§6.17).
    <div className={cn("@container mb-4", printText === "" && "print:hidden")}>
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
            // Not `search`: Chrome clears that kind on Esc (§6.17).
            type="text"
            value={text}
            placeholder={FILTER_PLACEHOLDER}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={invalid || undefined}
            aria-describedby={described}
            onChange={(e) => {
              const value = e.target.value;
              setText(value);
              setApplied(null);
              const now = pasted.current;
              pasted.current = false;
              const native = e.nativeEvent as Partial<InputEvent>;
              if (composing.current || native.isComposing === true) return;
              onType(value, now);
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(e) => {
              composing.current = false;
              onType(e.currentTarget.value, false);
            }}
            onBlur={onFlush}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              if (unapplied) setText(appliedText);
              else onLeave();
            }}
            onPaste={(e) => {
              // A pasted planning link applies at once, whole or inside the
              // lines the checker prints around it (§6.17); anything else is
              // text, applied as typed text is and written at once.
              const link = readPastedPlanningLink(
                e.clipboardData.getData("text"),
              );
              if (link === null) {
                pasted.current = true;
                setTimeout(() => {
                  pasted.current = false;
                }, 0);
                return;
              }
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
                // The focus stays in the box (§6.17), so pressing ✕ is not
                // leaving it, which would write what ✕ is about to clear.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  apply("");
                  // The focus stays in the box (§6.17).
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
            give way at a narrow width, to an icon in a slot of its own, so
            the page's not following the box is never left unsaid. The words
            stay for assistive technology, which the input's description
            names while they show. */}
        <span
          data-testid="planning-filter-hint"
          className="hidden w-44 shrink-0 text-xs whitespace-nowrap text-slate-500 @lg:block dark:text-slate-400"
        >
          {unapplied && FILTER_HINT}
        </span>
        <span
          data-testid="planning-filter-hint-icon"
          title={unapplied ? FILTER_HINT : undefined}
          className="flex size-3.5 shrink-0 items-center justify-center @lg:hidden"
        >
          {unapplied && (
            <AlertCircle
              size={14}
              className="text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
          )}
        </span>
        {unapplied && (
          <span id={hintId} className="sr-only">
            {FILTER_HINT}
          </span>
        )}
        <span
          data-testid="planning-filter-spinner-slot"
          className="flex size-3.5 shrink-0 items-center justify-center"
        >
          {busyAfter !== null && (
            <span
              data-testid="planning-filter-spinner"
              className="planning-reveal flex"
              style={{ animationDelay: `${busyAfter}ms` }}
            >
              <Loader2
                size={14}
                className="animate-spin text-blue-600"
                aria-hidden="true"
              />
            </span>
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
          className="hidden text-sm text-slate-700 [overflow-wrap:anywhere] print:block dark:text-slate-200"
        >
          Filter: <code>{printText}</code>
        </p>
      )}
    </div>
  );
};
