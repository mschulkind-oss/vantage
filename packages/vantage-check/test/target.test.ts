import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { STYLE_GUIDE } from "../../vantage-md/src/styleGuide.js";
import { run } from "../src/cli.js";
import { parseConfig, type Target } from "../src/core/config.js";
import type { RunShard } from "../src/core/parallel.js";
import { checkFiles } from "../src/core/runner.js";
import {
  OQ_MISSING_FOR_OLDER_READERS_MESSAGE,
  OQ_MISSING_MESSAGE,
} from "../src/rules/directives.js";
import {
  heldConfigPath,
  readsOnlyOq,
  releaseVersion,
  targetNotes,
  targetRefusal,
  type DeclaredTarget,
} from "../src/core/target.js";
import type { Finding } from "../src/core/types.js";
import { bufferIo } from "../src/io.js";
import { makeTree } from "./helpers.js";

/**
 * The top-level `target` in this release (`docs/design/checker-version-skew.md`
 * §4, as ruled on 2026-09-30): a checker older than it refuses, a development
 * build never does, and any other run notes it and checks as its own release,
 * except that a target before 0.8 quiets `vantage/oq-deprecated` (OQ-VS7).
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

  it("says an older target is checked as the newer release, and never sends the reader to an older checker", () => {
    expect(targetNotes([declared(FILE, "0.8")], ROOT, "0.9.0")).toEqual([
      ".vantage.toml targets Vantage 0.8, and vantage-check 0.9.0 checks against its own, newer release's notation whatever the target. A release never gives existing notation a new meaning, so a viewer on 0.8 drops what it does not know.",
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

  it("names the one exception under a target before 0.8, release and development build alike", () => {
    const exception =
      "The one exception: a viewer before 0.8 offers its one-click answer only on an `oq`, so under this target nothing asks for an `oq` to become `question` (vantage/oq-deprecated), and a question that lacks a directive is told to take an `oq` (vantage/oq-missing).";
    expect(targetNotes([declared(FILE, "0.7")], ROOT, "0.8.1")).toEqual([
      `.vantage.toml targets Vantage 0.7, and vantage-check 0.8.1 checks against its own, newer release's notation whatever the target. A release never gives existing notation a new meaning, so a viewer on 0.7 drops what it does not know. ${exception}`,
    ]);
    expect(targetNotes([declared(FILE, "0.7.1")], ROOT, undefined)).toEqual([
      `.vantage.toml targets Vantage 0.7.1. This development build of vantage-check checks for its own checkout whatever the target, and never refuses one. ${exception}`,
    ]);
    expect(
      targetNotes([declared(FILE, "0.8")], ROOT, "0.8.1")[0],
    ).not.toContain("exception");
  });

  it("leaves the exception out for a file no document of the run is held to", () => {
    const [note] = targetNotes(
      [declared(FILE, "0.7")],
      ROOT,
      "0.8.1",
      () => false,
    );
    expect(note).toContain(".vantage.toml targets Vantage 0.7");
    expect(note).not.toContain("exception");
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

describe("readsOnlyOq", () => {
  it.each([
    ["0.7", true],
    ["0.7.1", true],
    ["0.6", true],
    ["0.8", false],
    ["0.8.1", false],
    ["0.10", false],
    ["1.0", false],
  ])("target %s: %s", (written, expected) => {
    expect(readsOnlyOq(declared(FILE, written).target)).toBe(expected);
  });

  it("is false with no target", () => {
    expect(readsOnlyOq(null)).toBe(false);
  });
});

describe("heldConfigPath", () => {
  it("is a root's own file, whatever the run's config", () => {
    expect(heldConfigPath("/above/.vantage.toml", false, "/above/repo")).toBe(
      "/above/repo/.vantage.toml",
    );
  });

  it("is the file --config names for every document, and none under --no-config", () => {
    expect(heldConfigPath("/cfg.toml", true, "/repo")).toBe("/cfg.toml");
    expect(heldConfigPath("/cfg.toml", true, null)).toBe("/cfg.toml");
    expect(heldConfigPath(undefined, true, "/repo")).toBeUndefined();
  });

  it("is none for a document with no root, which only another path's walk can have configured", () => {
    expect(heldConfigPath("/other/.vantage.toml", false, null)).toBeUndefined();
  });
});

/**
 * A target before 0.8 says some readers answer only an `oq` in one click, so
 * `check` leaves `oq` alone in the documents held to it (OQ-VS7).
 */
describe("an `oq` under a target before 0.8", () => {
  /** An open question declared with `oq`, otherwise clean. */
  const OPEN_OQ = [
    "# Doc",
    "",
    "1. 💬 **OQ-1: Should the gate run on push?**",
    "",
    '   <!-- vantage: oq id=OQ-1 leaning="On push." -->',
    "",
    "   _Leaning:_ On push.",
    "",
  ].join("\n");

  /** The same question answered, which no target excuses an `oq` on. */
  const ANSWERED_OQ = OPEN_OQ.replace("💬", "✅");

  /** The seam, wired to the real checker in this process. */
  const inProcess: RunShard = (files, cwd, settings) =>
    checkFiles(files, cwd, settings);

  async function check(cwd: string, ...argv: string[]) {
    const io = bufferIo(cwd);
    const code = await run(
      ["check", "--format", "json", ...argv],
      io,
      inProcess,
    );
    const findings = (JSON.parse(io.stdout) as { findings: Finding[] })
      .findings;
    return {
      code,
      stderr: io.stderr,
      rules: findings.map((f) => `${f.file}: ${f.rule}`),
    };
  }

  it.each([
    ['target = "0.7"\n', []],
    ['target = "0.7.1"\n', []],
    ['target = "0.8"\n', ["doc.md: vantage/oq-deprecated"]],
    ["", ["doc.md: vantage/oq-deprecated"]],
  ])("under %j reports %j", async (toml, expected) => {
    const root = makeTree({ ".vantage.toml": toml, "doc.md": OPEN_OQ });
    expect((await check(root, ".")).rules).toEqual(expected);
  });

  it("passes --strict under a target before 0.8, and says why on stderr", async () => {
    const root = makeTree({
      ".vantage.toml": 'target = "0.7"\n',
      "doc.md": OPEN_OQ,
    });
    const { code, stderr } = await check(root, "--strict", ".");

    expect(code).toBe(0);
    expect(stderr).toContain("nothing asks for an `oq` to become `question`");
  });

  it("still reports an `oq` on a ✅ question, which every viewer before 0.8 offers to answer", async () => {
    const root = makeTree({
      ".vantage.toml": 'target = "0.7"\n',
      "doc.md": ANSWERED_OQ,
    });
    const { code, rules } = await check(root, ".");

    expect(rules).toEqual(["doc.md: vantage/question-name"]);
    expect(code).toBe(1);
  });

  it("holds each repository in a run to its own target", async () => {
    const outer = makeTree({
      "old/.git/HEAD": "ref: refs/heads/main\n",
      "old/.vantage.toml": 'target = "0.7"\n',
      "old/doc.md": OPEN_OQ,
      "new/.git/HEAD": "ref: refs/heads/main\n",
      "new/doc.md": OPEN_OQ,
    });

    // Either order: the run's [check] comes from the first path's walk, and
    // which repository's target applies must not.
    for (const paths of [
      ["old", "new"],
      ["new", "old"],
    ]) {
      expect((await check(outer, ...paths)).rules).toEqual([
        "new/doc.md: vantage/oq-deprecated",
      ]);
    }
  });

  it("never takes the target of a config found above the file's own root", async () => {
    // The trap in checker-version-skew.md §12: the walk to [check] goes past
    // `.git`, so its target can belong to a parent directory.
    const outer = makeTree({
      ".vantage.toml": 'target = "0.7"\n',
      "clone/.git/HEAD": "ref: refs/heads/main\n",
      "clone/doc.md": OPEN_OQ,
    });
    const { rules, stderr } = await check(outer, "clone");

    expect(rules).toEqual(["clone/doc.md: vantage/oq-deprecated"]);
    // The file is still noted, as every target the run read is, but its
    // exception holds no document here, so the note does not claim it.
    expect(stderr).toContain(".vantage.toml targets Vantage 0.7");
    expect(stderr).not.toContain("The one exception");
  });

  it("holds a document in no repository to no target, in either order", async () => {
    const outer = makeTree({
      "old/.git/HEAD": "ref: refs/heads/main\n",
      "old/.vantage.toml": 'target = "0.7"\n',
      "old/doc.md": OPEN_OQ,
      "loose/loose.md": OPEN_OQ,
    });

    for (const paths of [
      ["old", "loose"],
      ["loose", "old"],
    ]) {
      expect((await check(outer, ...paths)).rules).toEqual([
        "loose/loose.md: vantage/oq-deprecated",
      ]);
    }
  });

  /** An open question with a leaning and no directive at all. */
  const UNDECLARED = [
    "# Doc",
    "",
    "1. 💬 **OQ-1: Should the gate run on push?**",
    "",
    "   _Leaning:_ On push.",
    "",
  ].join("\n");

  async function oqMissing(toml: string) {
    const root = makeTree({ ".vantage.toml": toml, "doc.md": UNDECLARED });
    const io = bufferIo(root);
    await run(["check", "--format", "json", "."], io, inProcess);
    return (JSON.parse(io.stdout) as { findings: Finding[] }).findings;
  }

  it("asks a question with no directive for an `oq`, which the readers can answer", async () => {
    const [finding, ...rest] = await oqMissing('target = "0.7"\n');

    expect(rest).toEqual([]);
    expect(finding?.rule).toBe("vantage/oq-missing");
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toBe(OQ_MISSING_FOR_OLDER_READERS_MESSAGE);
    expect(finding?.message).toContain(
      'add `<!-- vantage: oq id=\u2026 leaning="\u2026" -->`',
    );
    expect(finding?.message).toContain(
      "rename it to `question`, keys unchanged",
    );
  });

  it.each([['target = "0.8"\n'], [""]])(
    "asks for `question` under %j",
    async (toml) => {
      const [finding] = await oqMissing(toml);
      expect(finding?.message).toBe(OQ_MISSING_MESSAGE);
    },
  );

  it("passes --strict once the question takes the `oq` it is told to", async () => {
    const root = makeTree({
      ".vantage.toml": 'target = "0.7"\n',
      "doc.md": UNDECLARED.replace(
        "   _Leaning:_",
        '   <!-- vantage: oq id=OQ-1 leaning="On push." -->\n\n   _Leaning:_',
      ),
    });
    const { code, rules } = await check(root, "--strict", ".");

    expect(rules).toEqual([]);
    expect(code).toBe(0);
  });

  it("answers to the file --config names, and to none under --no-config", async () => {
    const root = makeTree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "cfg/old.toml": 'target = "0.7"\n',
      "doc.md": OPEN_OQ,
    });

    expect((await check(root, "--config", "cfg/old.toml", ".")).rules).toEqual(
      [],
    );
    expect((await check(root, "--no-config", ".")).rules).toEqual([
      "doc.md: vantage/oq-deprecated",
    ]);
  });

  it("reports the same at 1 and 4 jobs", async () => {
    const files: Record<string, string> = {
      "old/.git/HEAD": "ref: refs/heads/main\n",
      "old/.vantage.toml": 'target = "0.7"\n',
      "new/.git/HEAD": "ref: refs/heads/main\n",
    };
    // Half declare the question with `oq`, half with no directive at all.
    const bare = OPEN_OQ.replace(/ {3}<!-- vantage: oq [^\n]*\n\n/, "");
    for (let i = 0; i < 6; i++) {
      files[`old/d${i}.md`] = i % 2 === 0 ? OPEN_OQ : bare;
      files[`new/d${i}.md`] = i % 2 === 0 ? OPEN_OQ : bare;
    }
    const outer = makeTree(files);

    const json = async (jobs: string) => {
      const io = bufferIo(outer);
      await run(
        ["check", "--format", "json", "--jobs", jobs, "old", "new"],
        io,
        inProcess,
      );
      return io.stdout;
    };
    const one = await json("1");
    expect(await json("4")).toBe(one);

    const findings = (JSON.parse(one) as { findings: Finding[] }).findings;
    expect(findings.map((f) => `${f.file}: ${f.rule}`).sort()).toEqual(
      [0, 1, 2, 3, 4, 5]
        .flatMap((i) => [
          `new/d${i}.md: vantage/${i % 2 === 0 ? "oq-deprecated" : "oq-missing"}`,
          ...(i % 2 === 0 ? [] : [`old/d${i}.md: vantage/oq-missing`]),
        ])
        .sort(),
    );
    for (const finding of findings) {
      if (finding.rule !== "vantage/oq-missing") continue;
      expect(finding.message).toBe(
        finding.file.startsWith("old/")
          ? OQ_MISSING_FOR_OLDER_READERS_MESSAGE
          : OQ_MISSING_MESSAGE,
      );
    }
  });
});

describe("the help", () => {
  it("says what target does, and that an unknown key is a warning", async () => {
    const { USAGE } = await import("../src/help.js");

    expect(USAGE).toContain('target = "0.8"');
    expect(USAGE).toContain("A checker older than it refuses to run");
    expect(USAGE).toContain(
      "Under\na target before 0.8, check asks for oq, not question, on an open question\n(vantage/oq-deprecated, vantage/oq-missing)",
    );
    expect(USAGE).toContain("is ignored with a\nwarning on stderr");
  });
});
