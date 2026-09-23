/**
 * Light/dark had two writers and one of them told nobody, which is the bug these
 * tests pin down from both ends: a choice made here has to reach everything in
 * this tab that shows the mode, and a choice made in another tab has to reach the
 * page as well as the state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  chooseColorMode,
  colorMode,
  subscribeColorMode,
  toggleColorMode,
} from "./darkMode";

const root = document.documentElement;

/** What a second tab's write looks like from in here. */
function writeFromAnotherTab(value: string | null) {
  if (value === null) localStorage.removeItem("vantage:theme");
  else localStorage.setItem("vantage:theme", value);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "vantage:theme",
      newValue: value,
      storageArea: localStorage,
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  root.classList.remove("dark");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the mode in effect", () => {
  it("is read off the class the stylesheets key on, not a copy beside it", () => {
    expect(colorMode()).toBe("light");
    root.classList.add("dark");
    expect(colorMode()).toBe("dark");
  });
});

describe("choosing in this tab", () => {
  it("applies the class and remembers the choice", () => {
    chooseColorMode("dark");
    expect(root.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("vantage:theme")).toBe("dark");

    chooseColorMode("light");
    expect(root.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("vantage:theme")).toBe("light");
  });

  it("tells this tab, which no storage event will do", () => {
    // The whole reason this module exists: the browser raises no `storage` event
    // in the window that wrote, so the settings menu kept showing "light" after
    // Shift+D had gone dark.
    const notify = vi.fn();
    const stop = subscribeColorMode(notify);

    chooseColorMode("dark");

    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops telling a watcher that has unsubscribed", () => {
    const notify = vi.fn();
    subscribeColorMode(notify)();

    chooseColorMode("dark");

    expect(notify).not.toHaveBeenCalled();
  });

  it("still applies the mode when storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    chooseColorMode("dark");

    expect(root.classList.contains("dark")).toBe(true);
  });
});

describe("Shift+D", () => {
  it("flips whichever mode the page is in, and announces it", () => {
    const notify = vi.fn();
    const stop = subscribeColorMode(notify);

    toggleColorMode();
    expect(colorMode()).toBe("dark");
    toggleColorMode();
    expect(colorMode()).toBe("light");

    expect(notify).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("vantage:theme")).toBe("light");
    stop();
  });
});

describe("another tab choosing", () => {
  it("applies the incoming mode to this page", () => {
    writeFromAnotherTab("dark");
    expect(root.classList.contains("dark")).toBe(true);

    writeFromAnotherTab("light");
    expect(root.classList.contains("dark")).toBe(false);
  });

  it("tells this tab's watchers, so the settings menu follows too", () => {
    const notify = vi.fn();
    const stop = subscribeColorMode(notify);

    writeFromAnotherTab("dark");

    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not write back what it was handed", () => {
    // Re-storing an adopted value is how two tabs would talk in circles if
    // `storage` events ever did echo to the window that wrote.
    writeFromAnotherTab("dark");
    // The spy goes on after the seeding write, and the event is dispatched by
    // hand rather than through the helper, so the only `setItem` this could see
    // is one this module made.
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "vantage:theme",
        newValue: "light",
        storageArea: localStorage,
      }),
    );

    expect(root.classList.contains("dark")).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("treats a removed preference as light, not as a reason to keep dark", () => {
    writeFromAnotherTab("dark");
    writeFromAnotherTab(null);
    expect(root.classList.contains("dark")).toBe(false);
  });

  it("ignores a value it does not recognize rather than inverting the page", () => {
    writeFromAnotherTab("midnight");
    expect(root.classList.contains("dark")).toBe(false);
  });
});
