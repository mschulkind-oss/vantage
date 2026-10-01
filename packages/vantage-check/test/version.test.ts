import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STYLE_GUIDE } from "../../vantage-md/src/styleGuide.js";
import { styleGuideHeader } from "../src/commands/styleGuide.js";
import { versionLine } from "../src/help.js";
import { bufferIo } from "../src/io.js";
import {
  DEVELOPMENT_BUILD,
  MANIFEST_PLACEHOLDER,
  RELEASE,
  VERSION,
  stampFor,
} from "../src/version.js";
import { makeTree } from "./helpers.js";

/**
 * How a build names itself (`docs/design/checker-version-skew.md` §4.2, §6).
 *
 * Only the release workflow knows a release: publish.yml stamps the tag into
 * package.json and build.ts inlines it. Every other build carries the
 * manifest's placeholder, and used to print it — `vantage-check 0.1.0`, a
 * release older than every convention the build checks.
 */

const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
) as { version: string };

describe("what build.ts stamps", () => {
  // If the manifest's version moves off the placeholder, every local build
  // stamps it and claims to be that release. The release workflow is the only
  // thing that writes a real version there, and it never commits it.
  it("finds the placeholder in the manifest", () => {
    expect(manifest.version).toBe(MANIFEST_PLACEHOLDER);
  });

  it("stamps nothing for the placeholder, so a local build is a development build", () => {
    expect(stampFor(MANIFEST_PLACEHOLDER)).toBe("");
  });

  it("stamps the version the release workflow put in the manifest, unchanged", () => {
    expect(stampFor("0.8.0")).toBe("0.8.0");
    expect(stampFor("0.8.1-rc.1")).toBe("0.8.1-rc.1");
  });
});

describe("a development build", () => {
  it("is what running from source is", () => {
    expect(RELEASE).toBeUndefined();
    expect(VERSION).toBe(DEVELOPMENT_BUILD);
  });

  it("says so in `version`, beside its commit when it knows one", () => {
    expect(versionLine(undefined, "2a179b7")).toBe(
      "vantage-check development build (2a179b7)\n",
    );
    expect(versionLine(undefined, "dev")).toBe(
      "vantage-check development build\n",
    );
    expect(versionLine(undefined, "unknown")).toBe(
      "vantage-check development build\n",
    );
  });

  it("says so in the style guide's first line, and names no release", () => {
    const header = styleGuideHeader(undefined, "2a179b7");

    expect(header).toContain("development build");
    expect(header).toContain("(2a179b7)");
    expect(header).not.toMatch(/\d+\.\d+\.\d+/);
    expect(styleGuideHeader(undefined, "dev")).not.toContain("(");
  });

  // A checkout can be behind the newest release as well as ahead of every
  // one — the 0.8.0 tree built after 0.8.1 ships — so the line claims only
  // that it can be newer.
  it("claims only that its conventions can be newer than every release", () => {
    expect(styleGuideHeader(undefined, "2a179b7")).toBe(
      "A Vantage development build's conventions (2a179b7): they can be newer than every release, so a reader on a released viewer may not have all of them.",
    );
    expect(styleGuideHeader(undefined, "dev")).not.toMatch(/at or ahead/);
  });
});

describe("a release build", () => {
  it("prints the release alone, exactly as before", () => {
    expect(versionLine("0.8.0", "abc1234")).toBe("vantage-check 0.8.0\n");
  });

  it("names the release in the style guide's first line (§6.1)", () => {
    expect(styleGuideHeader("0.8.0")).toBe(
      "Vantage 0.8.0's conventions: for readers on 0.8.0 or later.",
    );
  });
});

/**
 * The same, through the real commands, with the build's define standing in.
 *
 * `bun build --define` replaces the identifier `version.ts` reads; a global of
 * that name is what the module's `typeof` guard sees in its place, so this runs
 * every module as a binary stamped with that value would.
 */
describe("the commands, as a stamped build runs them", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function stamped(version: string) {
    vi.stubGlobal("__VANTAGE_CHECK_VERSION__", version);
    vi.stubGlobal("__VANTAGE_CHECK_COMMIT__", "abc1234");
    vi.resetModules();
    return (await import("../src/cli.js")).run;
  }

  async function output(
    run: Awaited<ReturnType<typeof stamped>>,
    argv: string[],
    cwd?: string,
  ) {
    const io = bufferIo(cwd);
    const code = await run(argv, io);
    return { code, stdout: io.stdout, stderr: io.stderr };
  }

  it("is a release when the release workflow stamped one", async () => {
    const run = await stamped("0.8.0");

    expect((await output(run, ["version"])).stdout).toBe(
      "vantage-check 0.8.0\n",
    );
    const guide = (await output(run, ["style-guide"])).stdout;
    expect(guide.split("\n")[0]).toBe(
      "Vantage 0.8.0's conventions: for readers on 0.8.0 or later.",
    );
  });

  // The empty stamp is what build.ts writes for the placeholder, so this is a
  // `just cli` build: the bug was a binary that printed 0.1.0 here.
  it("is a development build when build.ts stamped the placeholder away", async () => {
    const run = await stamped(stampFor(MANIFEST_PLACEHOLDER));

    const version = (await output(run, ["version"])).stdout;
    expect(version).toBe("vantage-check development build (abc1234)\n");
    expect(version).not.toContain(MANIFEST_PLACEHOLDER);
    const guide = (await output(run, ["style-guide"])).stdout;
    expect(guide.split("\n")[0]).toContain("development build");
  });

  it("names the release in the JSON reports, and a development build as one", async () => {
    const root = makeTree({ "index.md": "# Title\n" });

    for (const [stamp, expected] of [
      ["0.8.0", "0.8.0"],
      ["", DEVELOPMENT_BUILD],
    ] as const) {
      const run = await stamped(stamp);
      const check = await output(run, ["check", ".", "--format", "json"], root);
      expect(JSON.parse(check.stdout).version).toBe(expected);
      const index = await output(run, ["index", "--format", "json"], root);
      expect(JSON.parse(index.stdout).toolVersion).toBe(expected);
      vi.unstubAllGlobals();
    }
  });

  // §13.8: in 0.8.0, `unknown-name` names 0.8.0 and gives no upgrade command.
  it("names the release in a finding about unknown markup, and no upgrade", async () => {
    const run = await stamped("0.8.0");
    const root = makeTree({
      "index.md": "<!-- vantage: callout tone=warning -->\n\n## H\n",
    });

    const { code, stdout } = await output(
      run,
      ["check", ".", "--format", "json"],
      root,
    );
    const [finding] = JSON.parse(stdout).findings as {
      rule: string;
      message: string;
      detail: string;
    }[];

    expect(code).toBe(1);
    expect(finding?.rule).toBe("vantage/unknown-name");
    expect(finding?.message).toContain(
      "a Vantage 0.8.0 viewer drops the whole directive",
    );
    expect(finding?.detail).toContain("don't remove it");
    expect(`${finding?.message} ${finding?.detail}`).not.toMatch(
      /uvx|@latest|upgrade/i,
    );
  });

  // §13.8: an unknown rule id says not to remove it, and names the checker.
  // It is ignored with that warning rather than failing the run, so a
  // repository configured for a newer checker still checks in this one.
  it("names the release in a config warning, and says to keep the rule", async () => {
    const run = await stamped("0.8.0");
    const root = makeTree({
      ".vantage.toml": '[check.rules]\n"future/rule" = "error"\n',
      "index.md": "# Title\n",
    });

    const { code, stderr } = await output(run, ["check", "."], root);

    expect(code).toBe(0);
    expect(stderr).toContain(
      'unknown rule "future/rule", which vantage-check 0.8.0 does not have, so this run ignores it.',
    );
    expect(stderr).toContain("`uvx vantage-check@latest`");
    expect(stderr).toContain("don't remove the rule");
  });

  it("guide after the first line is the shared guide, byte for byte", async () => {
    const run = await stamped("0.8.0");
    const guide = (await output(run, ["style-guide"])).stdout;

    expect(guide.slice(guide.indexOf("\n") + 1)).toBe(
      `${STYLE_GUIDE.trim()}\n`,
    );
  });
});
