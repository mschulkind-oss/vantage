/**
 * Copy answers + maintenance (`docs/reference/planning-index.md` §6.7): the
 * planning page header's second copy button, beside Copy answers, and its
 * panel, which says what it copies and which kinds of *Maintenance* it adds.
 *
 * - **The button copies; its ▾ opens the panel.** The ▾ is a button of its
 *   own at the button's right end, so a tap on a touch screen, where there is
 *   no hover, opens the panel without copying, and the keyboard reaches it
 *   with Tab: click, tap, Enter, Space or ↓ open it.
 * - **Hover opens it too,** after the pointer has rested on the button for
 *   `OPEN_MS`, and it stays open while the pointer is on the button or the
 *   panel, closing `CLOSE_MS` after it leaves both. Focus alone never opens
 *   it, so tabbing past does not throw a panel over the page.
 * - **Esc or a press elsewhere closes it.** Esc gives the focus back to the ▾.
 * - **The checkboxes are one preference** in this browser, the kinds left
 *   out (`lib/planningCopy.ts`), *Ready to build* among them until the reader
 *   checks it, followed across tabs.
 * - **Greyed out, never disabled,** with no kind checked or nothing to copy:
 *   `aria-disabled`, so the button keeps its place in the tab order and the
 *   panel still opens from it, or nothing could check a kind again.
 *
 * Its count and its label sit in room kept from the first paint, as Copy
 * answers' do, so neither the counts arriving nor *Copied* moves anything.
 */
import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, ClipboardList } from "lucide-react";
import type { PlanningRequestId } from "vantage-md/planning";
import { usePersistentValue } from "../hooks/usePersistentValue";
import {
  COPY_KINDS,
  checkedKinds,
  copyGreyed,
  copyTotal,
  parseLeftOut,
  serializeLeftOut,
} from "../lib/planningCopy";
import { MAINTENANCE_TITLES } from "../lib/planningPages";
import { cn } from "../lib/utils";
import { planningLimits } from "../planningScan/limits";
import { RESERVED_ICON_SIZE, ReservedLabel } from "./ReservedLabel";

/** How long the pointer rests on the button before the panel opens. */
export const OPEN_MS = 200;
/** How long after the pointer leaves the button and the panel it closes. */
export const CLOSE_MS = 300;
/** How long *Copied* stands in for the label. */
const COPIED_MS = 2000;

/** The button's label, and the name its ▾ and panel go by. */
export const COPY_MAINTENANCE_LABEL = "Copy answers + maintenance";

/** The panel's sentence (§6.7). */
export const COPY_PANEL_SENTENCE =
  "Your answers, the same as Copy answers, plus the maintenance this page found for the agent.";

const LEFT_OUT_KEY = "vantage:planningCopyLeftOut";

const count = (n: number) => n.toLocaleString("en-US");

export const PlanningCopyPanel: React.FC<{
  /** The answers Copy answers copies, as its count says. */
  answers: number;
  /** Whether that count is known yet: `–` and greyed out until it is. */
  known: boolean;
  /**
   * Whether what it copies can be copied now: not while Copy answers' quoted
   * lines are on their way, when Copy answers is disabled. Greyed out
   * meanwhile.
   */
  ready?: boolean;
  /** Each kind's items, live and filtered as the page's groups count them. */
  counts: ReadonlyMap<string, number>;
  /**
   * Copy the answers and the requests for `kinds`; resolves whether it
   * copied.
   */
  onCopy: (kinds: readonly PlanningRequestId[]) => Promise<boolean>;
}> = ({ answers, known, ready = true, counts, onCopy }) => {
  const [leftOut, setLeftOut] = usePersistentValue(
    LEFT_OUT_KEY,
    parseLeftOut,
    serializeLeftOut,
  );
  const total = copyTotal(answers, counts, leftOut);
  const greyed = !known || !ready || copyGreyed(total, leftOut);

  // How the panel is open: `hover`, which closes as the pointer leaves, or
  // `asked`, by the ▾, which stays until Esc or a press elsewhere.
  const [open, setOpen] = useState<null | "hover" | "asked">(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimers = () => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };
  useEffect(() => clearTimers, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // A press anywhere else closes it.
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: PointerEvent | MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  // Opened from the keyboard: the focus goes into the panel.
  // Set only by a key that opens it, and forgotten whenever it closes, so a
  // later hover never takes the focus.
  const focusPanel = useRef(false);
  const focusFirst = () =>
    panelRef.current
      ?.querySelector<HTMLElement>("button, input")
      ?.focus({ preventScroll: true });
  useEffect(() => {
    if (open === null) {
      focusPanel.current = false;
      return;
    }
    if (!focusPanel.current) return;
    focusPanel.current = false;
    focusFirst();
  }, [open]);

  const onPointerEnter = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (open !== null || openTimer.current !== null) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      setOpen((now) => now ?? "hover");
    }, OPEN_MS);
  };
  const onPointerLeave = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (openTimer.current !== null) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (open !== "hover") return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen((now) => (now === "hover" ? null : now));
    }, CLOSE_MS);
  };

  const pressToggle = () => {
    clearTimers();
    // A panel hover opened stays once the ▾ is pressed; one it opened, goes.
    setOpen((now) => (now === "asked" ? null : "asked"));
  };

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    if (greyed) return;
    void onCopy(checkedKinds(leftOut)).then((ok) => {
      if (ok) setCopied(true);
    });
  };

  const setKind = (id: PlanningRequestId, checked: boolean) =>
    setLeftOut((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(id);
      else next.add(id);
      return next;
    });

  const shown = known ? count(total) : "–";
  const title = !known
    ? "The answers waiting on the agent are still being counted"
    : !ready
      ? "The answers' quoted lines are still on their way"
      : checkedKinds(leftOut).length === 0
        ? "No kind of maintenance is checked, so this copies nothing Copy answers does not: choose one with ▾"
        : total === 0
          ? "Nothing to copy: no answers are waiting on the agent, and the kinds checked hold nothing"
          : "Copy your answers, the same as Copy answers, then the agent requests for the maintenance checked under ▾";

  return (
    <div
      ref={rootRef}
      data-planning-copy-maintenance
      className="relative inline-flex shrink-0 items-stretch"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || open === null) return;
        e.preventDefault();
        e.stopPropagation();
        clearTimers();
        setOpen(null);
        toggleRef.current?.focus();
      }}
    >
      <button
        type="button"
        onClick={copy}
        aria-disabled={greyed || undefined}
        // Its name stays put: the live region below says it copied.
        aria-label={`${COPY_MAINTENANCE_LABEL} ${shown}`}
        title={title}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-l-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors dark:border-slate-600 dark:text-slate-200",
          greyed
            ? "cursor-not-allowed opacity-40"
            : "hover:bg-slate-100 dark:hover:bg-slate-700",
        )}
      >
        <ReservedLabel
          icon={
            copied ? (
              <Check size={RESERVED_ICON_SIZE} aria-hidden="true" />
            ) : (
              <ClipboardList size={RESERVED_ICON_SIZE} aria-hidden="true" />
            )
          }
          label={copied ? "Copied" : COPY_MAINTENANCE_LABEL}
          reserve={[COPY_MAINTENANCE_LABEL, "Copied"]}
          labelClassName="hdr-label"
          trailing={{
            text: shown,
            testId: "copy-maintenance-count",
            // Left-aligned: its digits change with the filter and late
            // data (§6.4), and a count that grows to the right moves no
            // text that is already painted.
            className:
              "inline-block text-left tabular-nums text-slate-500 dark:text-slate-400",
            style: { minWidth: `${planningLimits.pendingCountDigits}ch` },
          }}
        />
      </button>
      <button
        ref={toggleRef}
        type="button"
        aria-label={`Choose what ${COPY_MAINTENANCE_LABEL} copies`}
        aria-expanded={open !== null}
        aria-controls={panelId}
        data-planning-copy-toggle
        onClick={(e) => {
          // From the keyboard, Enter and Space click: opening, the focus
          // goes in.
          focusPanel.current = e.detail === 0 && open !== "asked";
          pressToggle();
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown") return;
          e.preventDefault();
          clearTimers();
          if (open !== null) {
            setOpen("asked");
            focusFirst();
            return;
          }
          focusPanel.current = true;
          setOpen("asked");
        }}
        className="inline-flex items-center rounded-r-md border border-l-0 border-slate-300 px-1.5 text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {copied && "Copied your answers and the maintenance checked."}
      </span>
      {open !== null && (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label={`What ${COPY_MAINTENANCE_LABEL} copies`}
          data-planning-copy-panel
          className="absolute top-full right-0 z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3 text-xs font-normal whitespace-normal text-slate-700 normal-case shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <div className="mb-2 flex items-start gap-3">
            <p className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
              {COPY_PANEL_SENTENCE}
            </p>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setLeftOut(new Set())}
                className="rounded px-1 text-blue-600 hover:underline dark:text-blue-400"
              >
                All
              </button>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setLeftOut(new Set(COPY_KINDS))}
                className="rounded px-1 text-blue-600 hover:underline dark:text-blue-400"
              >
                None
              </button>
            </span>
          </div>
          <ul className="space-y-1">
            <li
              data-copy-row="answers"
              className="flex items-center gap-2 pl-6"
            >
              <span className="flex-1">Your answers</span>
              <span className="tabular-nums">
                {known ? count(answers) : "–"}
              </span>
            </li>
            {COPY_KINDS.map((id) => (
              <li key={id} data-copy-row={id}>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!leftOut.has(id)}
                    onChange={(e) => setKind(id, e.target.checked)}
                    className="size-4 shrink-0"
                  />
                  <span className="flex-1">{MAINTENANCE_TITLES[id]}</span>
                  <span className="tabular-nums">
                    {count(counts.get(id) ?? 0)}
                  </span>
                </label>
              </li>
            ))}
            <li
              data-copy-row="total"
              className="mt-1 flex items-center gap-2 border-t border-slate-200 pt-1 pl-6 font-medium dark:border-slate-700"
            >
              <span className="flex-1">Copied</span>
              <span className="tabular-nums">{shown}</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
};
