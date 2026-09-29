/**
 * The limits module: the design's numbers, and a test's override of them.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PLANNING_LIMITS,
  planningLimits,
  setPlanningLimitsForTests,
} from "./limits";

afterEach(() => setPlanningLimitsForTests(null));

describe("the limits module", () => {
  it("holds the design's numbers", () => {
    expect(planningLimits).toEqual(DEFAULT_PLANNING_LIMITS);
    expect(planningLimits.chunkEntries).toBe(100);
    expect(planningLimits.chunkBytes).toBe(256 * 1024);
    expect(planningLimits.cardChars).toBe(32_000);
    expect(planningLimits.pageMarkdownChars).toBe(32 * 1024);
    expect(planningLimits.holdMs).toBe(150);
  });

  it("takes an override over the defaults, and never stacks two", () => {
    setPlanningLimitsForTests({ chunkEntries: 2 });
    expect(planningLimits.chunkEntries).toBe(2);
    setPlanningLimitsForTests({ cardChars: 50 });
    expect(planningLimits.cardChars).toBe(50);
    expect(planningLimits.chunkEntries).toBe(100);
    setPlanningLimitsForTests(null);
    expect(planningLimits).toEqual(DEFAULT_PLANNING_LIMITS);
  });

  it("keeps its defaults frozen", () => {
    expect(Object.isFrozen(DEFAULT_PLANNING_LIMITS)).toBe(true);
  });
});
