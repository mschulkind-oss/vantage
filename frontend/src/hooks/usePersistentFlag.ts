import { useCallback } from "react";
import type { PreferenceName } from "../lib/preferences";
import { usePersistentValue, type SetValue } from "./usePersistentValue";

/** Accepts a value or an updater, like the setter `useState` hands back. */
export type SetFlag = SetValue<boolean>;

/**
 * Only the two strings we write mean anything; absent, null and anything else
 * are all "no preference recorded" and yield the fallback. Reading garbage as
 * `false` would silently override a preference that defaults to on.
 */
function parseFlag(raw: string | null, fallback: boolean): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

/**
 * A boolean reading preference, remembered in `localStorage` and kept in step
 * across every tab on this origin.
 *
 * The storage format is the one the viewer already used before this hook
 * existed — the string `"true"` or `"false"` under a `vantage:`-prefixed key —
 * so a tab still running older code reads the same value, and anything that is
 * neither string reads as the fallback rather than throwing.
 *
 * `key` and `fallback` are expected to be constants; changing either re-reads
 * storage rather than carrying the old value over.
 */
export function usePersistentFlag(
  key: PreferenceName,
  fallback = false,
): [boolean, SetFlag] {
  // Memoized on the fallback and nothing else, which is what preserves the
  // re-read-on-change behavior this hook has always documented: an unmemoized
  // parse would make `usePersistentValue` re-read on every render instead, and
  // that would overwrite a value storage refused to save. `String` needs no
  // memo — it is the same function every time.
  const parse = useCallback(
    (raw: string | null) => parseFlag(raw, fallback),
    [fallback],
  );

  return usePersistentValue(key, parse, String);
}
