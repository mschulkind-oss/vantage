/**
 * Copy agent request, or Copy all agent requests, on the planning page
 * (`docs/reference/planning-index.md` §6.2).
 */
import React, { useEffect, useState } from "react";
import { Check, ClipboardCopy } from "lucide-react";
import { copyTextOrWarn } from "../lib/clipboard";
import { cn } from "../lib/utils";
import { RESERVED_ICON_SIZE, ReservedLabel } from "./ReservedLabel";

/** How long Copied stands in for a copy button's label. */
const COPIED_MS = 2000;

/**
 * Copy agent request, or Copy all agent requests: copies the text `request`
 * generates when pressed, from the index already on screen, so it needs no
 * network and nothing selected. Confirmed as Copy answers is, its label
 * turning to Copied for two seconds in room kept for the longer of the two,
 * so the confirmation moves nothing, and said once to a screen reader, since
 * a button's new label is not read out. Never printed.
 */
export const CopyRequestButton: React.FC<{
  label: string;
  /** Its accessible name: the label, and what it copies. */
  name: string;
  /** Its tooltip. */
  hint: string;
  /** What a screen reader is told once it has copied. */
  done: string;
  request: () => string | null;
  className?: string;
}> = ({ label, name, hint, done, request, className }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <>
      <button
        type="button"
        data-planning-agent-request
        aria-label={name}
        title={hint}
        onClick={() => {
          const text = request();
          if (text === null) return;
          void copyTextOrWarn(text).then((ok) => {
            if (ok) setCopied(true);
          });
        }}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 print:hidden dark:text-slate-300 dark:hover:bg-slate-700",
          className,
        )}
      >
        {/* As wide as its label, so Copied moves nothing. */}
        <ReservedLabel
          icon={
            copied ? (
              <Check size={RESERVED_ICON_SIZE} aria-hidden="true" />
            ) : (
              <ClipboardCopy size={RESERVED_ICON_SIZE} aria-hidden="true" />
            )
          }
          label={copied ? "Copied" : label}
          reserve={[label, "Copied"]}
        />
      </button>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {copied && done}
      </span>
    </>
  );
};
