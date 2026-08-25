import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STYLE_GUIDE_SNIPPET } from "vantage-md";

const mainTs = fileURLToPath(new URL("./main.ts", import.meta.url));

// Run the real entrypoint in dev mode (no build step) and capture stdout.
function runCli(args: string[]): string {
  return execFileSync("bun", [mainTs, ...args], { encoding: "utf8" });
}

describe("style-guide command", () => {
  it("emits the canonical style guide from vantage-md, byte-for-byte", () => {
    // Single-source guarantee: the command's output is exactly the shared
    // constant — nothing more, nothing less.
    expect(runCli(["style-guide"])).toBe(STYLE_GUIDE_SNIPPET.trim() + "\n");
  });

  it("reports a version", () => {
    expect(runCli(["--version"]).trim()).toMatch(/\d+\.\d+\.\d+/);
  });
});
