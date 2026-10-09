/**
 * Every preference this browser remembers for the reader, and the only module in
 * `frontend/src` allowed to touch `localStorage`.
 *
 * Eleven preferences existed before this module and two of them followed the
 * reader between tabs, because each of the other nine was an ad-hoc
 * `localStorage.getItem` at the point of use: a second tab read the value once
 * at mount and then drifted for the rest of its life. Light/dark was worse than
 * drifted — it had two writers, and the one behind Shift+D changed the class and
 * the storage without telling the settings menu, so the menu went stale in the
 * tab the reader was looking at.
 *
 * The fix that lasts is not nine more `storage` listeners but one module that
 * owns the storage, so the next preference cannot be added without passing
 * through it. Three guards make that structural rather than a habit:
 * `PREFERENCE_KEYS` makes an unregistered key a type error, the
 * `no-restricted-syntax` rule in `frontend/eslint.config.js` makes a
 * `localStorage` member access outside this file a lint error at the line, and
 * `preferences.test.ts` fails both on a `vantage:` key smuggled past the type as
 * a bare string literal and on a registered key that nothing follows.
 *
 * The storage *format* is deliberately untouched: the same keys, the same
 * `"true"`/`"false"` strings, the same raw values. A reader who upgrades
 * mid-session has one tab on the old bundle and one on the new, and their
 * preferences have to survive the change and stay mutually readable — so there
 * is no migration here and nothing was renamed, including the two review keys
 * whose `vantage.` prefix does not match the `vantage:` the rest use.
 */

/**
 * The preferences with one fixed key each, exhaustively. A key that is not in
 * this list is not a `PreferenceKey`, so it cannot be passed to anything below:
 * adding a preference means adding it here first, which is the whole point.
 */
export const PREFERENCE_KEYS = [
  /** Light or dark — see `lib/darkMode.ts`, which owns the `dark` class. */
  "vantage:theme",
  /** The color theme's id, `"default"` meaning the app's own look. */
  "vantage:colorTheme",
  "vantage:tocOpen",
  "vantage:fullWidth",
  /**
   * Whether the planning page's question cards open unfolded: the page's
   * Expand all / Collapse all, which every card rendered later opens with
   * (`docs/reference/planning-index.md` §6.6). A display preference like
   * full width, not planning state; absent, cards open folded.
   */
  "vantage:planningCardsExpanded",
  /**
   * The planning page's page size: how many questions that need you it shows
   * as full cards, one of `planningLimits.pageSizes`, as a decimal string
   * (`docs/reference/planning-index.md` §6.4). Absent, the default.
   */
  "vantage:planningPageSize",
  /**
   * Whether the planning page's folded *Blocked* and *Maintenance* groups are
   * open, `"true"` or `"false"`; absent, closed (§6.2).
   */
  "vantage:planningBlockedOpen",
  "vantage:planningMaintenanceOpen",
  /**
   * The kinds of *Maintenance* that the planning page's Copy answers +
   * maintenance leaves out: their request ids, comma-separated, `""` for
   * none (`lib/planningCopy.ts`, §6.7 of the same reference). Absent, Ready to
   * build alone is left out.
   */
  "vantage:planningCopyLeftOut",
  "vantage:sidebarCollapsed",
  /** The sidebar's width in px, as a decimal string. */
  "vantage:sidebarWidth",
  "vantage:shortcuts-enabled",
  "vantage:repoSortMode",
  "vantage:showEmptyDirs",
  "vantage:showHidden",
  "vantage:showGitignored",
  /**
   * That the multi-block selection hint has been shown once — the one entry here
   * that records something the app did rather than something the reader chose.
   * Its `vantage.` prefix is from before the `vantage:` convention and is kept
   * because renaming it would show the hint again to every existing reader.
   */
  "vantage.reviewMode.multiBlockHintShown",
] as const;

/** Any of the fixed keys. An unregistered string is a compile error. */
export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

/**
 * Review mode is remembered per document, so it is a family of keys rather than
 * one: `useReviewStore` writes one per file, scoped by repository in daemon
 * mode. A family is registered by its prefix and reached only through the
 * accessor below, because the one preference that legitimately has unbounded
 * keys is otherwise the hole every future ad-hoc write fits through.
 */
export const REVIEW_MODE_FAMILY = "vantage.reviewMode:";

/**
 * The roadmap the planning page shows is remembered per repository
 * (`docs/reference/planning-index.md` §6.8), so it is a family too: one key per
 * repository, the empty name in single-repo mode, holding the picked roadmap's
 * repo-relative path as it is. Only a pick on the page writes one.
 */
export const PLANNING_ROADMAP_FAMILY = "vantage:planningRoadmap:";

/** Every registered prefix under which a preference may mint keys at runtime. */
export const PREFERENCE_FAMILIES = [
  REVIEW_MODE_FAMILY,
  PLANNING_ROADMAP_FAMILY,
] as const;

export type PreferenceFamily = (typeof PREFERENCE_FAMILIES)[number];

/** Anything this module will store: a fixed key, or a key in a family. */
export type PreferenceName = PreferenceKey | `${PreferenceFamily}${string}`;

/**
 * Where review mode for one document is remembered. `scope` is the caller's
 * already-scoped path (`repo:path` in daemon mode, the bare path otherwise);
 * this function only puts it under the registered prefix, so the resulting name
 * is typed as a preference and the callers have no reason to build the string
 * themselves.
 */
export function reviewModePreferenceKey(scope: string): PreferenceName {
  return `${REVIEW_MODE_FAMILY}${scope}`;
}

/**
 * Where the planning page remembers the roadmap picked for `repo`: `""` in
 * single-repo mode, the repository's name in daemon mode.
 */
export function planningRoadmapPreferenceKey(repo: string): PreferenceName {
  return `${PLANNING_ROADMAP_FAMILY}${repo}`;
}

/**
 * The registered names that deliberately do **not** follow the reader between
 * tabs, each with the argument for why not.
 *
 * `preferences.test.ts` reads this list: a registered name that neither has a
 * follower in `src` nor an entry here fails the suite. That is what stops the
 * next preference from being tab-local because nobody thought about it — absence
 * is not an argument, so absence is not accepted as one.
 */
export const UNSYNCED_PREFERENCES: Partial<
  Record<PreferenceKey | PreferenceFamily, string>
> = {
  "vantage.reviewMode.multiBlockHintShown":
    "Nothing holds this in state to be told: MarkdownViewer reads it at the " +
    "instant a multi-block selection is made, so whichever tab shows the hint " +
    "first has already been heard by the next tab's read. A subscription would " +
    "have nothing to update, and the value never goes back to unset.",
  [REVIEW_MODE_FAMILY]:
    "Reviewing is per document, and the two tabs a reader opens are usually on " +
    "two different ones, so nearly every event here would concern a file the " +
    "receiving tab is not showing. For the case where it is the same file, the " +
    "second tab already adopts the toggle when it opens the document, because " +
    "`loadReview` reads the preference then — and live adoption would go " +
    "further than that, closing the review affordances under a reviewer " +
    "part-way through a comment on the strength of a click in another tab. " +
    "Adoption at open is the weaker guarantee and the right one.",
  "vantage:planningPageSize":
    "A page size changing is a new layout of Needs you, and only the reader's " +
    "own action may lay the page out again under them " +
    "(planning-index.md §12.1). The page reads the preference at every " +
    "layout it makes, so another tab's choice applies at this tab's next " +
    "Refresh, filter change or visit, with nothing to follow in between.",
  "vantage:planningBlockedOpen":
    "Opening or closing a group moves everything below it, which only the " +
    "reader's own action may do (planning-index.md §12.1). Read once per " +
    "visit, as the page opens.",
  "vantage:planningMaintenanceOpen":
    "Opening or closing a group moves everything below it, which only the " +
    "reader's own action may do (planning-index.md §12.1). Read once per " +
    "visit, as the page opens.",
  [PLANNING_ROADMAP_FAMILY]:
    "The planning page reads the remembered roadmap once per visit, by design " +
    "(planning-index.md §6.8): another tab's pick must never swap Needs you " +
    "under a reader who is part-way through answering it here. The next visit " +
    "reads the new pick, and a URL that names a roadmap outranks it anyway.",
};

/**
 * The raw stored string, or `null` when nothing is stored.
 *
 * Storage can be missing outright rather than merely empty — a `file://` origin,
 * a Safari private window over quota, a sandboxed iframe, site data blocked —
 * and it throws on property access rather than returning nothing. A reading
 * preference is never worth a blank page, so a throw reads as "no preference
 * recorded" and every caller falls back to its default.
 */
export function readPreference(name: PreferenceName): string | null {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}

/**
 * Remember `value` under `name`, or fail silently.
 *
 * The caller is not told, because there is nothing it could usefully do: it has
 * already applied the change, and a preference that cannot be saved is still
 * worth honoring for the rest of this tab's life.
 */
export function writePreference(name: PreferenceName, value: string): void {
  try {
    localStorage.setItem(name, value);
  } catch {
    /* See above: honored in-tab, just not remembered. */
  }
}

/**
 * Forget `name` entirely, which is not the same as storing a default: a removed
 * key is what lets a later-arriving default (a repo's offered color theme, say)
 * apply, where a stored one would outrank it forever.
 */
export function clearPreference(name: PreferenceName): void {
  try {
    localStorage.removeItem(name);
  } catch {
    /* Nothing to undo — the value we wanted gone was never written. */
  }
}

/** What a subscriber is handed: the raw new value, `null` if there is none. */
export type PreferenceHandler = (value: string | null) => void;

/**
 * Every live subscription, by name. One `storage` listener serves all of them:
 * a listener per subscription would mean every preference in the app waking on
 * every event to decide it was not the one that changed, and the dispatch is the
 * same table either way.
 */
const handlers = new Map<string, Set<PreferenceHandler>>();

let listening = false;

function onStorage(event: StorageEvent): void {
  // A `sessionStorage` write raises `storage` on this window too, and the area
  // the event carries is the only thing that tells the two apart. Without this,
  // any code storing per-tab state under a colliding name would silently drive
  // a cross-tab preference.
  if (event.storageArea && event.storageArea !== localStorage) return;

  if (event.key === null) {
    // `clear()` reports a null key and wipes every preference at once, so this
    // is not a fact about one name and the event's `newValue` says nothing
    // useful. Every subscriber re-reads instead.
    for (const [name, set] of [...handlers]) {
      const value = readPreference(name as PreferenceName);
      for (const handler of [...set]) handler(value);
    }
    return;
  }

  const set = handlers.get(event.key);
  if (!set) return;
  // A tab never hears its own writes, so there is no echo to filter here: every
  // event delivered to this listener was raised by another tab on this origin.
  // The set is copied because a handler is allowed to unsubscribe from inside
  // itself.
  for (const handler of [...set]) handler(event.newValue);
}

/**
 * Follow `name` until the returned function is called.
 *
 * The handler hears **another tab's** writes only. A `writePreference` from this
 * tab does not call it — the browser raises no `storage` event in the window
 * that wrote, and this module deliberately does not synthesize one: the code
 * that wrote has already applied the change, so an echo would put every local
 * write through a second, indistinguishable round trip. In-tab fan-out is the
 * caller's job, and `lib/darkMode.ts` is the one preference that needs it.
 */
export function subscribePreference(
  name: PreferenceName,
  handler: PreferenceHandler,
): () => void {
  let set = handlers.get(name);
  if (!set) {
    set = new Set();
    handlers.set(name, set);
  }
  set.add(handler);
  if (!listening) {
    // Attached on the first subscription rather than at module load, so the
    // listener's lifetime is exactly the lifetime of the subscriptions it
    // serves — which is what makes an unmounted component provably deaf rather
    // than merely holding a handler nothing calls any more.
    window.addEventListener("storage", onStorage);
    listening = true;
  }

  return () => {
    const live = handlers.get(name);
    if (!live) return;
    live.delete(handler);
    if (live.size === 0) handlers.delete(name);
    if (handlers.size === 0 && listening) {
      window.removeEventListener("storage", onStorage);
      listening = false;
    }
  };
}
