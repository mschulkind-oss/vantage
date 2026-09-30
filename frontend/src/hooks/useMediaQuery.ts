import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether `query` matches now, following it as the window changes.
 *
 * Read during render, so the first paint already has the answer and nothing
 * lays out twice. Where `matchMedia` does not exist (jsdom), it is
 * `fallback`.
 */
export function useMediaQuery(query: string, fallback: boolean): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list =
        typeof window.matchMedia === "function"
          ? window.matchMedia(query)
          : null;
      list?.addEventListener("change", notify);
      return () => list?.removeEventListener("change", notify);
    },
    [query],
  );
  const read = useCallback(
    () =>
      typeof window.matchMedia === "function"
        ? window.matchMedia(query).matches
        : fallback,
    [query, fallback],
  );
  return useSyncExternalStore(subscribe, read, () => fallback);
}

/**
 * The width from which the contents column is drawn: Tailwind's `md`, which
 * the column's own `md:block` and the header's toggles use too.
 */
export const CONTENTS_COLUMN_QUERY = "(min-width: 48rem)";
