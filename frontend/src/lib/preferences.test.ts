/**
 * The preference store's own contract, and the two guards that make forgetting
 * the next preference impossible rather than merely unlikely.
 *
 * The behavioral half uses jsdom exactly as `usePersistentFlag.test.ts` does: a
 * `setItem` in this window raises no `storage` event, just as in Chrome, while a
 * hand-dispatched `StorageEvent` carries `storageArea` through faithfully. So
 * "another tab wrote this" is modeled the only way it can be — by dispatching
 * the event a real second tab would have caused.
 *
 * The scanning half reads `src/` off disk, for two things a type cannot see:
 *
 * - **A `vantage:` key written as a bare string literal.** `PreferenceKey` stops
 *   an unregistered key being *passed*; nothing stops one being written as a
 *   literal somewhere else and reaching storage by another route entirely.
 * - **A registered key that nothing follows.** This is the one that encodes
 *   "nobody forgot": a key with no `usePersistent*` or `subscribePreference`
 *   call, and no entry in `UNSYNCED_PREFERENCES` arguing why it should not have
 *   one, fails. Absence is not an argument, so absence is not accepted as one.
 *
 * Test files are outside both scans. They name keys that do not exist on purpose
 * — `usePersistentFlag.test.ts` drives the hook with a fixture key — and they
 * touch storage directly on purpose, because the stored format is part of what
 * they assert. What covers them instead is the `no-restricted-syntax` rule in
 * `eslint.config.js`, whose exemption for tests says as much.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PREFERENCE_FAMILIES,
  PREFERENCE_KEYS,
  UNSYNCED_PREFERENCES,
  clearPreference,
  readPreference,
  reviewModePreferenceKey,
  subscribePreference,
  writePreference,
  type PreferenceKey,
  type PreferenceName,
} from "./preferences";

const KEY: PreferenceName = "vantage:tocOpen";
const OTHER: PreferenceName = "vantage:fullWidth";

/** What a second tab's write looks like from in here. */
function writeFromAnotherTab(key: string, value: string | null) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key,
      newValue: value,
      storageArea: localStorage,
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reading and writing", () => {
  it("round-trips the raw string, with no format of its own", () => {
    writePreference(KEY, "true");
    expect(readPreference(KEY)).toBe("true");
    expect(localStorage.getItem("vantage:tocOpen")).toBe("true");
  });

  it("reports an unset preference as null rather than as a default", () => {
    expect(readPreference(KEY)).toBeNull();
  });

  it("clears to absence, not to a stored default", () => {
    writePreference(KEY, "true");
    clearPreference(KEY);
    expect(localStorage.getItem("vantage:tocOpen")).toBeNull();
  });

  it("reads null rather than throwing when storage cannot be reached", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readPreference(KEY)).toBeNull();
  });

  it("swallows a write that cannot be saved, because the caller has applied it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writePreference(KEY, "true")).not.toThrow();
  });

  it("swallows a clear that cannot be reached", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => clearPreference(KEY)).not.toThrow();
  });

  it("puts a family key under its registered prefix", () => {
    expect(reviewModePreferenceKey("repo:docs/guide.md")).toBe(
      "vantage.reviewMode:repo:docs/guide.md",
    );
  });
});

describe("following another tab", () => {
  it("hands the handler the incoming value", () => {
    const heard: (string | null)[] = [];
    const stop = subscribePreference(KEY, (v) => heard.push(v));

    writeFromAnotherTab("vantage:tocOpen", "true");
    writeFromAnotherTab("vantage:tocOpen", null);

    expect(heard).toEqual(["true", null]);
    stop();
  });

  it("does not call the handler for this tab's own write", () => {
    const handler = vi.fn();
    const stop = subscribePreference(KEY, handler);

    writePreference(KEY, "true");

    // The browser raises no `storage` event in the window that wrote, and this
    // module does not synthesize one: the writer has already applied the change.
    expect(handler).not.toHaveBeenCalled();
    stop();
  });

  it("dispatches by key, so one preference's change wakes only its handlers", () => {
    const mine = vi.fn();
    const theirs = vi.fn();
    const stopMine = subscribePreference(KEY, mine);
    const stopTheirs = subscribePreference(OTHER, theirs);

    writeFromAnotherTab("vantage:tocOpen", "true");

    expect(mine).toHaveBeenCalledWith("true");
    expect(theirs).not.toHaveBeenCalled();
    stopMine();
    stopTheirs();
  });

  it("ignores sessionStorage writes, which raise the same event", () => {
    const handler = vi.fn();
    const stop = subscribePreference(KEY, handler);

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "vantage:tocOpen",
        newValue: "true",
        storageArea: sessionStorage,
      }),
    );

    expect(handler).not.toHaveBeenCalled();
    stop();
  });

  it("re-reads every preference on a clear(), which reports a null key", () => {
    localStorage.setItem("vantage:tocOpen", "true");
    localStorage.setItem("vantage:fullWidth", "true");
    const mine = vi.fn();
    const theirs = vi.fn();
    const stopMine = subscribePreference(KEY, mine);
    const stopTheirs = subscribePreference(OTHER, theirs);

    localStorage.clear();
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: null,
        newValue: null,
        storageArea: localStorage,
      }),
    );

    expect(mine).toHaveBeenCalledWith(null);
    expect(theirs).toHaveBeenCalledWith(null);
    stopMine();
    stopTheirs();
  });

  it("serves every subscriber of one key from the one listener", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribePreference(KEY, first);
    const stopSecond = subscribePreference(KEY, second);

    writeFromAnotherTab("vantage:tocOpen", "true");

    expect(first).toHaveBeenCalledWith("true");
    expect(second).toHaveBeenCalledWith("true");

    // And one unsubscribing leaves the other hearing, which is what a single
    // shared listener has to get right and a listener-per-subscription gets
    // right for free.
    stopFirst();
    writeFromAnotherTab("vantage:tocOpen", "false");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
  });

  it("stops listening on the window once nothing is subscribed", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");

    const stop = subscribePreference(KEY, vi.fn());
    expect(add).toHaveBeenCalledWith("storage", expect.any(Function));
    stop();
    expect(remove).toHaveBeenCalledWith("storage", expect.any(Function));
  });

  it("survives a handler that unsubscribes from inside itself", () => {
    // Which React does on unmount, and which would throw or skip a sibling if
    // the dispatch iterated the live set.
    const other = vi.fn();
    const stopOther = subscribePreference(KEY, other);
    const stopSelf = subscribePreference(KEY, () => stopSelf());

    expect(() => writeFromAnotherTab("vantage:tocOpen", "true")).not.toThrow();
    expect(other).toHaveBeenCalledWith("true");
    stopOther();
  });

  it("is safe to unsubscribe twice", () => {
    const stop = subscribePreference(KEY, vi.fn());
    stop();
    expect(() => stop()).not.toThrow();
  });
});

const RELATIVE_SRC_ROOT = "..";

/**
 * The root is resolved through a variable, not a literal `new URL(…,
 * import.meta.url)`: Vite rewrites the literal form into an asset URL that `fs`
 * cannot open. `textContrast.test.ts` reads the sources the same way.
 */
const SRC_ROOT = fileURLToPath(new URL(RELATIVE_SRC_ROOT, import.meta.url));

/** Every `.ts`/`.tsx` under `src/`, tests excluded — see the header. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sources(path, found);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

function relative(file: string): string {
  return file.replace(/.*\/src\//, "src/");
}

interface KeyLiteral {
  file: string;
  line: number;
  key: string;
}

/**
 * Every string literal in `src/` that is shaped like a preference key.
 *
 * "Shaped like" is the quote, then `vantage:` or `vantage.`, then at least one
 * character and no whitespace, then the same quote. The shape is what keeps the
 * app's other uses of the word out: a directive sentinel is `"<!-- vantage: …"`
 * with prose after the colon and something before the word, `".vantage.toml"`
 * has a dot in front of it, and `"data-vantage-theme"` has a hyphen instead of a
 * separator. The bare sentinel `"vantage:"` is excluded by needing a character
 * after the colon, which no key can do without.
 */
function keyLiterals(): KeyLiteral[] {
  const found: KeyLiteral[] = [];
  for (const file of sources(SRC_ROOT)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((text, index) => {
        for (const match of text.matchAll(/(["'`])(vantage[:.][^"'`\s]+)\1/g)) {
          found.push({ file, line: index + 1, key: match[2] });
        }
      });
  }
  return found;
}

function registered(key: string): boolean {
  return (
    (PREFERENCE_KEYS as readonly string[]).includes(key) ||
    PREFERENCE_FAMILIES.some((family) => key.startsWith(family))
  );
}

describe("every preference key in the sources is a registered one", () => {
  it("has no key-shaped literal that is neither a key nor in a family", () => {
    // A `vantage:` literal here that `preferences.ts` has never heard of is a
    // preference being added the old way — reachable by `localStorage` under a
    // name no type, and therefore no cross-tab subscription, knows about.
    const strangers = keyLiterals().filter(({ key }) => !registered(key));

    expect(
      strangers.map((s) => `${relative(s.file)}:${s.line} ${s.key}`),
    ).toEqual([]);
  });

  it("reads the sources it claims to, so an empty pass is not a green one", () => {
    const literals = keyLiterals();
    expect(literals.length).toBeGreaterThan(20);
    expect(new Set(literals.map((l) => l.file)).size).toBeGreaterThan(4);
    // And past `preferences.ts` itself, which would satisfy the counts above on
    // its own while proving nothing about the code that uses it.
    expect(
      new Set(
        literals
          .filter((l) => !l.file.endsWith("preferences.ts"))
          .map((l) => l.key),
      ).size,
    ).toBeGreaterThan(8);
  });

  it("finds the literals whose shape it is most likely to have got wrong", () => {
    const keys = new Set(keyLiterals().map((l) => l.key));
    expect(keys).toContain("vantage:tocOpen");
    // The dotted family prefix, which does not follow the `vantage:` convention
    // and is the one a tightened regex would quietly stop seeing.
    expect(keys).toContain("vantage.reviewMode:");
  });
});

/**
 * The name each follower call follows, as far as the text can say.
 *
 * A call's first argument is either the key as a literal or a constant holding
 * it; the constant is resolved within the file that contains the call, which is
 * both narrow enough to be unambiguous and wide enough for the two files that
 * name their key once at the top. Anything else — a parameter, an expression, a
 * constant imported from elsewhere — resolves to nothing and is skipped, which
 * makes this guard fail closed: a key followed through a route this cannot read
 * is reported as unfollowed, and the fix is to hand the call site the key as a
 * literal or as a constant beside it.
 */
function followedKeys(): Set<string> {
  const followed = new Set<string>();
  for (const file of sources(SRC_ROOT)) {
    const text = readFileSync(file, "utf8");
    const aliases = new Map<string, string>();
    for (const match of text.matchAll(
      /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*["'`](vantage[:.][^"'`\s]+)["'`]/g,
    )) {
      aliases.set(match[1], match[2]);
    }
    for (const match of text.matchAll(
      /\b(?:usePersistentFlag|usePersistentValue|subscribePreference)\s*\(\s*([^,)]+)/g,
    )) {
      const argument = match[1].trim();
      const literal = /^["'`](vantage[:.][^"'`\s]+)["'`]$/.exec(argument);
      if (literal) {
        followed.add(literal[1]);
        continue;
      }
      const resolved = aliases.get(argument);
      if (resolved) followed.add(resolved);
    }
  }
  return followed;
}

describe("every registered preference is followed by somebody", () => {
  it("has a follower, or a declared reason for having none", () => {
    const followed = followedKeys();
    const unaccounted = [...PREFERENCE_KEYS, ...PREFERENCE_FAMILIES].filter(
      (name) =>
        !followed.has(name) &&
        !(name in UNSYNCED_PREFERENCES) &&
        // A family is followed if anything follows a key inside it.
        !(
          PREFERENCE_FAMILIES.some((family) => name === family) &&
          [...followed].some((key) => key.startsWith(name))
        ),
    );

    expect(
      unaccounted.map(
        (name) =>
          `${name} is stored but nothing keeps it in step across tabs — read ` +
          `it with usePersistentFlag/usePersistentValue, or subscribePreference ` +
          `for a store, or add it to UNSYNCED_PREFERENCES with the argument for why not`,
      ),
    ).toEqual([]);
  });

  it("does not excuse a preference that is in fact followed", () => {
    // An entry that has outlived its argument is worse than no entry: it reads
    // as a decision when it has become a stale note.
    const followed = followedKeys();
    const contradicted = Object.keys(UNSYNCED_PREFERENCES).filter((name) =>
      followed.has(name),
    );
    expect(contradicted).toEqual([]);
  });

  it("gives a reason, not merely a mention, for each unsynced preference", () => {
    for (const [name, reason] of Object.entries(UNSYNCED_PREFERENCES)) {
      expect(reason, name).toBeTruthy();
      expect(reason!.length, name).toBeGreaterThan(80);
    }
  });

  it("only excuses names that are registered", () => {
    const names: string[] = [...PREFERENCE_KEYS, ...PREFERENCE_FAMILIES];
    expect(
      Object.keys(UNSYNCED_PREFERENCES).filter((n) => !names.includes(n)),
    ).toEqual([]);
  });

  it("resolves both the literal and the aliased call sites", () => {
    // The two routes this scan understands, each proved by a live call: a key
    // written at the call site, and a key named once at the top of its file.
    // A regression in either would otherwise show up as a bogus failure above
    // rather than as a broken scanner here.
    const followed = followedKeys();
    expect(followed).toContain("vantage:tocOpen");
    expect(followed).toContain("vantage:colorTheme");
    expect(followed.size).toBeGreaterThan(8);
  });

  it("accounts for every key one way or the other", () => {
    const followed = followedKeys();
    const keys: PreferenceKey[] = [...PREFERENCE_KEYS];
    for (const key of keys) {
      expect(followed.has(key) || key in UNSYNCED_PREFERENCES, key).toBe(true);
    }
  });
});
