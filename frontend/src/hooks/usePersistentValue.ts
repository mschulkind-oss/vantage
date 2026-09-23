import { useCallback, useEffect, useRef, useState } from "react";
import {
  readPreference,
  subscribePreference,
  writePreference,
  type PreferenceName,
} from "../lib/preferences";

/** Accepts a value or an updater, like the setter `useState` hands back. */
export type SetValue<T> = (next: T | ((prev: T) => T)) => void;

/**
 * A reading preference of any shape — a number, a string enum, an id —
 * remembered in `localStorage` and kept in step across every tab on this origin.
 *
 * This is the hook the non-boolean preferences needed, and the one
 * `usePersistentFlag` is now built on. Having it matters beyond saving code: a
 * component that wants a remembered value has no way to read one without also
 * following it, which is what stops the next preference from being the next one
 * that only syncs on reload.
 *
 * `parse` turns the stored string — or `null`, meaning nothing is stored — into
 * the value, and `serialize` turns it back. Between them they are the whole of
 * this preference's storage format, which stays the app's own rather than
 * becoming this hook's, because a tab on an older bundle still has to read what
 * a new one writes. `parse` must return a default rather than throw for anything
 * it does not recognise: storage holds whatever an older bundle, a devtools
 * session or a different app on this origin left there.
 *
 * Both functions must be **stable** — module-level, or `useCallback`-wrapped.
 * The subscription is torn down and storage re-read whenever their identity
 * changes, and an inline arrow would do that on every render. That is not merely
 * wasteful: the re-read overwrites the in-tab value with the stored one, which
 * throws away the very thing a failed write is supposed to leave standing.
 */
export function usePersistentValue<T>(
  name: PreferenceName,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string,
): [T, SetValue<T>] {
  const [value, setValue] = useState(() => parse(readPreference(name)));

  // Updater functions resolve against this ref rather than against React state,
  // which keeps the storage write out of the updater: StrictMode double-invokes
  // updaters to surface impurity, and a write in there would run twice. The ref
  // is assigned before `setValue`, so two updates in one tick still compose.
  const latest = useRef(value);

  const set = useCallback<SetValue<T>>(
    (next) => {
      const resolved =
        typeof next === "function"
          ? (next as (prev: T) => T)(latest.current)
          : next;
      latest.current = resolved;
      writePreference(name, serialize(resolved));
      setValue(resolved);
    },
    [name, serialize],
  );

  useEffect(() => {
    // Re-read on mount and whenever the preference being followed changes. On
    // mount this is the value the initialiser already produced, so React bails
    // out without a re-render.
    const adopt = (raw: string | null) => {
      const incoming = parse(raw);
      latest.current = incoming;
      setValue(incoming);
    };
    adopt(readPreference(name));
    return subscribePreference(name, adopt);
  }, [name, parse]);

  return [value, set];
}
