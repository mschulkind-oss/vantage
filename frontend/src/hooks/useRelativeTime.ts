import { useState, useEffect, useRef } from "react";
import { formatDistanceToNow } from "date-fns";

/**
 * Format age with a stable boundary at 60 s to avoid the flickering that
 * date-fns' default 30 s threshold causes when WebSocket-driven re-renders
 * land right on the boundary.
 */
function formatAge(d: Date): string {
  const ageMs = Date.now() - d.getTime();
  // Hold "less than a minute" until a full 60 s to prevent oscillation
  if (ageMs < 60_000) return "less than a minute";
  return formatDistanceToNow(d, { addSuffix: false });
}

function getDelay(d: Date | null): number {
  if (!d) return 60_000;
  const ageMs = Date.now() - d.getTime();
  if (ageMs < 60_000) return 10_000; // < 1 min: every 10s
  if (ageMs < 3_600_000) return 30_000; // < 1 hr: every 30s
  if (ageMs < 86_400_000) return 300_000; // < 1 day: every 5 min
  return 3_600_000; // older: every hour
}

/**
 * Returns a relative time string that auto-updates as time passes.
 * Uses recursive setTimeout so the interval adapts as the age increases.
 */
export function useRelativeTime(
  date: Date | string | null | undefined,
  options?: { addSuffix?: boolean },
): string {
  const addSuffix = options?.addSuffix ?? true;

  const format = (): string => {
    if (!date) return "";
    const d = typeof date === "string" ? new Date(date) : date;
    const text = formatAge(d);
    return addSuffix ? `${text} ago` : text;
  };

  const [text, setText] = useState(format);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Syncs derived state on dep change; no cascade risk since format() is pure.
    setText(format());

    const parsed = date
      ? typeof date === "string"
        ? new Date(date)
        : date
      : null;

    const tick = () => {
      setText(format());
      timerRef.current = setTimeout(tick, getDelay(parsed));
    };
    timerRef.current = setTimeout(tick, getDelay(parsed));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Re-subscribe when the date input changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, addSuffix]);

  return text;
}
