import { describe, expect, it } from "vitest";
import { scanAnalysisIgnoreRule } from "./scanAnalysisIgnoreRule";

describe("scanAnalysisIgnoreRule", () => {
  it("quotes a literal asterisk in an anchored directory suggestion", () => {
    expect(scanAnalysisIgnoreRule("generated/cache*")).toBe(
      "/generated/cache\\*/",
    );
  });

  it.each([
    "literal?",
    "bracket[1]",
    "bracket]",
    "back\\slash",
    "trailing ",
    "nested /child",
    "nested/child ",
    "replacement\uFFFDcharacter",
    "line\nbreak",
    "carriage\rreturn",
    "tab\tname",
    "control\u0000name",
    "/absolute/path",
    "../parent",
    "",
  ])("does not suggest an unsafe literal path: %s", (path) => {
    expect(scanAnalysisIgnoreRule(path)).toBeNull();
  });
});
