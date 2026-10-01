import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { STYLE_GUIDE } from "../../vantage-md/src/styleGuide.js";
import { parseConfig, type Target } from "../src/core/config.js";
import {
  releaseVersion,
  targetNotes,
  targetRefusal,
  type DeclaredTarget,
} from "../src/core/target.js";
import { bufferIo } from "../src/io.js";
import { makeTree } from "./helpers.js";

/**
 * The top-level `target` in this release (`docs/design/checker-version-skew.md`
 * §4, as ruled on 2026-09-30): a checker older than it refuses, a development
 * build never does, and any other run notes it and checks as its own release.
 */

function declared(path: string, written: string): DeclaredTarget {
  const target = parseConfig(`target = "${written}"\n`).target as Target;
  return { path, target };
}

const ROOT = "/repo";
const FILE = join(ROOT, ".vantage.toml");

describe("releaseVersion", () => {
  it.each([
    ["0.8.0", [0, 8, 0]],
    ["0.10.2", [0, 10, 2]],
    ["0.9.0-rc.1", [0, 9, 0]],
  ])("reads %s", (release, version) => {
    expect(releaseVersion(release)).toEqual(version);
  });

  it("knows no release for a development build, or a version it cannot read", () => {
    expect(releaseVersion(undefined)).toBeUndefined();
    expect(releaseVersion("nightly")).toBeUndefined();
  });
});

describe("targetRefusal", () => {
  it("refuses a target newer than the release, naming the file, both releases and the fix", () => {
    expect(targetRefusal([declared(FILE, "0.9")], ROOT, "0.8.3")).toBe(
      ".vantage.toml targets Vantage 0.9, and this is vantage-check 0.8.3, which is older: it knows nothing a newer release added, so it can neither check that release's documents nor teach its notation, and stops here. Run vantage-check 0.9.0 or later (for example, `uvx vantage-check@latest`), and leave target as it is.",
    );
  });

  it.each([
    ["0.8", "0.8.0"],
    ["0.8", "0.8.3"],
    ["0.7.1", "0.8.0"],
    ["0.9", "0.9.0-rc.1"],
  ])("goes on under target %s for vantage-check %s", (written, release) => {
    expect(
      targetRefusal([declared(FILE, written)], ROOT, release),
    ).toBeUndefined();
  });

  it("compares the patch, since a target names one", () => {
    expect(targetRefusal([declared(FILE, "0.8.1")], ROOT, "0.8.0")).toContain(
      "Run vantage-check 0.8.1 or later",
    );
  });

  it("compares numbers, not text", () => {
    expect(
      targetRefusal([declared(FILE, "0.10")], ROOT, "0.9.0"),
    ).toBeDefined();
    expect(
      targetRefusal([declared(FILE, "0.9")], ROOT, "0.10.0"),
    ).toBeUndefined();
  });

  it("never refuses in a development build", () => {
    expect(
      targetRefusal([declared(FILE, "999.0")], ROOT, undefined),
    ).toBeUndefined();
  });

  it("names every file too new for it, and the newest release among them", () => {
    const message = targetRefusal(
      [
        declared("/repo/one/.vantage.toml", "0.9"),
        declared("/repo/two/.vantage.toml", "0.8"),
        declared("/repo/three/.vantage.toml", "0.10"),
      ],
      ROOT,
      "0.8.0",
    );

    expect(message).toBe(
      [
        "this is vantage-check 0.8.0, older than what these files target: it knows nothing a newer release added, so it can neither check that release's documents nor teach its notation, and stops here.",
        "  one/.vantage.toml targets Vantage 0.9",
        "  three/.vantage.toml targets Vantage 0.10",
        "Run vantage-check 0.10.0 or later (for example, `uvx vantage-check@latest`), and leave target as it is.",
      ].join("\n"),
    );
  });
});

describe("targetNotes", () => {
  it("says a target equal to the release is the one it checks for", () => {
    expect(targetNotes([declared(FILE, "0.8")], ROOT, "0.8.0")).toEqual([
      ".vantage.toml targets Vantage 0.8, the release vantage-check 0.8.0 checks for.",
    ]);
  });

  it("says an older target is not held to yet, and never sends the reader to an older checker", () => {
    expect(targetNotes([declared(FILE, "0.7")], ROOT, "0.8.0")).toEqual([
      ".vantage.toml targets Vantage 0.7, and vantage-check 0.8.0 checks against its own, newer release's notation whatever the target. A release never gives existing notation a new meaning, so a viewer on 0.7 drops what it does not know.",
    ]);
    // A 0.7.x checker reports 0.8.0's `question` and `fallback` as unknown
    // names, so pointing at one would turn a safe document into errors.
    expect(
      targetNotes([declared(FILE, "0.7.1")], ROOT, "0.8.0")[0],
    ).not.toMatch(/run (a |vantage-check )?0\.7/);
  });

  it("says a development build checks as itself and never refuses", () => {
    expect(targetNotes([declared(FILE, "999.0")], ROOT, undefined)).toEqual([
      ".vantage.toml targets Vantage 999.0. This development build of vantage-check checks for its own checkout whatever the target, and never refuses one.",
    ]);
  });

  it("shows a file outside the working directory by its whole path", () => {
    expect(
      targetNotes([declared("/elsewhere/.vantage.toml", "0.8")], ROOT, "0.8.0"),
    ).toEqual([
      "/elsewhere/.vantage.toml targets Vantage 0.8, the release vantage-check 0.8.0 checks for.",
    ]);
  });
});

/**
 * The commands, as a stamped build runs them: the same stand-in for
 * `bun build --define` that version.test.ts uses.
 */
describe("the commands under a target", () => {
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

  async function output(version: string, argv: string[], cwd: string) {
    const run = await stamped(version);
    const io = bufferIo(cwd);
    const code = await run(argv, io);
    return { code, stdout: io.stdout, stderr: io.stderr };
  }

  const tree = (toml: string) =>
    makeTree({ ".vantage.toml": toml, "index.md": "[Gone](./nowhere.md)\n" });

  it.each([["check", "."], ["index"], ["style-guide"]])(
    "%s refuses a target newer than the release, and prints nothing else",
    async (...argv) => {
      const { code, stdout, stderr } = await output(
        "0.8.0",
        argv,
        tree('target = "0.9"\n'),
      );

      expect(code).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toBe(
        `vantage-check: ${targetRefusal([declared("/r/.vantage.toml", "0.9")], "/r", "0.8.0")}\n`,
      );
    },
  );

  // §4.2: a file written for a newer release can hold a value this release
  // cannot parse, and the answer to that file is the refusal, not the value.
  it.each([["check", "."], ["index"]])(
    "%s refuses before it reads the rest of the file",
    async (...argv) => {
      const { code, stderr } = await output(
        "0.8.0",
        argv,
        tree('target = "0.9"\n\n[check]\nstrict = "warnings"\n'),
      );

      expect(code).toBe(2);
      expect(stderr).toContain("targets Vantage 0.9");
      expect(stderr).not.toContain("check.strict");
    },
  );

  it.each([["check", "."], ["index"], ["style-guide"]])(
    "%s notes a target it goes on under, on stderr",
    async (...argv) => {
      const { code, stdout, stderr } = await output(
        "0.8.0",
        argv,
        tree(
          'target = "0.7"\n\n[check.rules]\n"link/missing-target" = "off"\n',
        ),
      );

      expect(code).toBe(0);
      expect(stderr).toBe(
        `vantage-check: ${targetNotes([declared("/r/.vantage.toml", "0.7")], "/r", "0.8.0")[0]}\n`,
      );
      expect(stdout).not.toContain("targets Vantage");
    },
  );

  it("leaves the guide after its first line byte for byte under a target", async () => {
    const { stdout } = await output(
      "0.8.0",
      ["style-guide"],
      tree('target = "0.8"\n'),
    );

    expect(stdout.slice(stdout.indexOf("\n") + 1)).toBe(
      `${STYLE_GUIDE.trim()}\n`,
    );
  });

  it("never refuses in a development build", async () => {
    const { code, stderr } = await output(
      "",
      ["check", "."],
      tree(
        'target = "999.0"\n\n[check.rules]\n"link/missing-target" = "off"\n',
      ),
    );

    expect(code).toBe(0);
    expect(stderr).toContain("never refuses one");
  });

  it("refuses for any root of the run, not only the run's own config", async () => {
    const outer = makeTree({
      "one/.git/HEAD": "ref: refs/heads/main\n",
      "one/a.md": "# A\n",
      "two/.git/HEAD": "ref: refs/heads/main\n",
      "two/.vantage.toml": 'target = "0.9"\n',
      "two/b.md": "# B\n",
    });
    const { code, stdout, stderr } = await output(
      "0.8.0",
      ["check", "one/a.md", "two/b.md"],
      outer,
    );

    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("two/.vantage.toml targets Vantage 0.9");
  });

  it("answers to the file --config names, and to none under --no-config", async () => {
    const root = makeTree({
      ".vantage.toml": 'target = "0.9"\n',
      "cfg/v.toml": "[check]\nstrict = false\n",
      "index.md": "# Title\n",
    });

    expect((await output("0.8.0", ["check", "."], root)).code).toBe(2);
    expect(
      (await output("0.8.0", ["check", "--config", "cfg/v.toml", "."], root))
        .code,
    ).toBe(0);
    expect(
      (await output("0.8.0", ["check", "--no-config", "."], root)).code,
    ).toBe(0);
  });

  it("style-guide refuses a malformed target, and passes over the rest of a bad file", async () => {
    const bad = await output("0.8.0", ["style-guide"], tree("target = 0.8\n"));
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("target must name one Vantage release");

    const unreadable = await output("0.8.0", ["style-guide"], tree("[check\n"));
    expect(unreadable.code).toBe(0);
    expect(unreadable.stderr).toBe("");
  });
});

describe("the help", () => {
  it("says what target does, and that an unknown key is a warning", async () => {
    const { USAGE } = await import("../src/help.js");

    expect(USAGE).toContain('target = "0.8"');
    expect(USAGE).toContain("A checker older than it refuses to run");
    expect(USAGE).toContain("is ignored with a\nwarning on stderr");
  });
});
