import { afterEach, describe, expect, it, vi } from "vitest";

import { reducedMotion } from "./reducedMotion";

afterEach(() => vi.unstubAllGlobals());

describe("reducedMotion", () => {
  it("reports what the reader's system asks for", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
    }));
    expect(reducedMotion()).toBe(true);

    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(reducedMotion()).toBe(false);
  });
});
