import { useCallback, useEffect, useRef, useState } from "react";

/** Accepts a value or an updater, like the setter `useState` hands back. */
export type SetFlag = (next: boolean | ((prev: boolean) => boolean)) => void;

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

/** Read one flag, treating an absent or unrecognised value as the fallback. */
function readFlag(key: string, fallback: boolean): boolean {
  try {
    return parseFlag(localStorage.getItem(key), fallback);
  } catch {
    // Storage can be missing outright, not merely empty — a `file://` origin or
    // a private window over quota throws on access.
    return fallback;
  }
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
  key: string,
  fallback = false,
): [boolean, SetFlag] {
  const [value, setValue] = useState(() => readFlag(key, fallback));

  // Updater functions resolve against this ref rather than against React state,
  // which keeps the storage write out of the updater: StrictMode double-invokes
  // updaters to surface impurity, and a write in there would run twice. The ref
  // is assigned before `setValue`, so two toggles in one tick still compose.
  const latest = useRef(value);

  const set = useCallback<SetFlag>(
    (next) => {
      const resolved = typeof next === "function" ? next(latest.current) : next;
      latest.current = resolved;
      try {
        localStorage.setItem(key, String(resolved));
      } catch {
        /* A preference that cannot be saved is still worth honouring in-tab. */
      }
      setValue(resolved);
    },
    [key],
  );

  useEffect(() => {
    // Re-read on mount and whenever the key changes. On mount this is the value
    // the initialiser already produced, so React bails out without a re-render.
    const adopt = (incoming: boolean) => {
      latest.current = incoming;
      setValue(incoming);
    };
    adopt(readFlag(key, fallback));

    // A tab never hears its own writes, so there is no echo to filter: every
    // event delivered here was raised by another tab on this origin.
    const onStorage = (e: StorageEvent) => {
      // `sessionStorage` writes raise `storage` on this window too.
      if (e.storageArea && e.storageArea !== localStorage) return;
      // `clear()` reports a null key and wipes every flag at once.
      if (e.key !== null && e.key !== key) return;
      adopt(parseFlag(e.newValue, fallback));
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, fallback]);

  return [value, set];
}
