import { useEffect, useState } from "react";

const NONE: ReadonlySet<string> = new Set();

/**
 * The members of `keys` that have been in it for `ms` or longer. A key that
 * leaves drops out at once; one that joins is in the answer `ms` after the
 * set last changed. So a transient shorter than `ms` never shows: the
 * planning card's _· checking_ mark waits 1 s, and an ordinary edit, whose
 * reconcile lands in a few hundred milliseconds, never flashes it
 * (`docs/design/planning-page-freshness.md` §4.6).
 */
export function useLingering(
  keys: ReadonlySet<string>,
  ms: number,
): ReadonlySet<string> {
  const key = [...keys].sort().join("\n");
  const [long, setLong] = useState<ReadonlySet<string>>(NONE);
  // The set changed: what left it is no longer long, at once, in this render.
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    const kept = [...long].filter((k) => keys.has(k));
    if (kept.length !== long.size) setLong(new Set(kept));
  }
  useEffect(() => {
    if (key === "") return;
    const timer = setTimeout(() => setLong(new Set(key.split("\n"))), ms);
    return () => clearTimeout(timer);
  }, [key, ms]);
  return long;
}
