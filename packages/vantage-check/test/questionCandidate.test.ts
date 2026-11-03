import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { EXIT_FINDINGS, EXIT_OK } from "../src/exit.js";
import { bufferIo } from "../src/io.js";
import { RULES, ruleMeta } from "../src/rules/registry.js";
import { checkTree, makeTree, ruleIds } from "./helpers.js";

/**
 * `vantage/question-candidate`: the structural shapes of a question that carry
 * no directive and that `vantage/oq-missing` does not already report
 * (docs/design/agent-planning-handoff.md §5.2).
 */

const one = async (markdown: string) =>
  checkTree(makeTree({ "index.md": markdown }));
const CANDIDATE = "vantage/question-candidate";
/** Only the two question-shape rules: unrelated rules fire on tiny fixtures. */
const check = async (markdown: string) =>
  ruleIds(await one(markdown)).filter(
    (id) => id === CANDIDATE || id === "vantage/oq-missing",
  );

const DIRECTIVE = '<!-- vantage: question id=OQ-1 leaning="yes" -->';

describe("vantage/question-candidate registration", () => {
  it("is a warning, on by default", () => {
    expect(ruleMeta(CANDIDATE)?.default).toBe("warning");
    expect(RULES.filter((r) => r.id === CANDIDATE)).toHaveLength(1);
  });
});

describe("vantage/question-candidate on list items", () => {
  it("reports a 🔒 item with an id and no directive", async () => {
    expect(
      await check("1. 🔒 **OQ-1: Blocked on the vendor?** Waiting.\n"),
    ).toEqual([CANDIDATE]);
  });

  it("reports a 💬 item with an id and no leaning", async () => {
    expect(await check("1. 💬 **OQ-2: Which port?** Context.\n")).toEqual([
      CANDIDATE,
    ]);
  });

  it("reports it as a warning", async () => {
    const report = await one("1. 🔒 OQ-1: Blocked?\n");
    expect(
      report.findings
        .filter((f) => f.rule === CANDIDATE)
        .map((f) => f.severity),
    ).toEqual(["warning"]);
  });

  it("leaves the oq-missing case (💬, id, leaning) to oq-missing alone", async () => {
    const md = [
      "1. 💬 **OQ-1: Gate on push?** Tradeoff.",
      "",
      "   _Leaning:_ yes.",
      "",
    ].join("\n");
    expect(await check(md)).toEqual(["vantage/oq-missing"]);
  });

  it("reports a 💬 item whose leaning runs in on the question's paragraph", async () => {
    expect(
      await check("1. 💬 **OQ-1: Gate on push?** _Leaning:_ yes.\n"),
    ).toEqual([CANDIDATE]);
  });

  it("reports a 🔒 item with a leaning (oq-missing never does)", async () => {
    const md = [
      "1. 🔒 **OQ-1: Gate on push?** Tradeoff.",
      "",
      "   _Leaning:_ yes.",
      "",
    ].join("\n");
    expect(await check(md)).toEqual([CANDIDATE]);
  });

  it("is quiet when the item carries a question directive", async () => {
    const md = [
      "1. 🔒 **OQ-1: Blocked?** Waiting.",
      "",
      `   ${DIRECTIVE}`,
      "",
    ].join("\n");
    expect(await check(md)).toEqual([]);
  });

  it("is quiet on a ✅ item", async () => {
    expect(await check("1. ✅ **OQ-1: Done?** Yes.\n")).toEqual([]);
  });

  it("is quiet when the marker is not first or the id is absent", async () => {
    expect(await check("1. See 💬 OQ-1 for context.\n")).toEqual([]);
    expect(await check("1. 💬 **Should we?** No id here.\n")).toEqual([]);
  });
});

describe("vantage/question-candidate on tables", () => {
  const table = (header: string, row: string) =>
    [header, "| --- | --- |", row, ""].join("\n");

  it("reports a Leaning table with ids as plain text, once per table", async () => {
    const md = table(
      "| Question | Leaning |",
      "| OQ-KS1 first | yes |\n| OQ-KS2 second | no |",
    );
    expect(await check(md)).toEqual([CANDIDATE]);
  });

  it("reports an Answer table with ids as inline code", async () => {
    expect(await check(table("| Q | Answer |", "| `OQ-KS1` | yes |"))).toEqual([
      CANDIDATE,
    ]);
  });

  it("is quiet on the ledger form, first header exactly ID", async () => {
    expect(await check(table("| ID | Leaning |", "| OQ-KS1 | yes |"))).toEqual(
      [],
    );
  });

  it("is quiet when the row id is a link", async () => {
    expect(
      await check(table("| Q | Leaning |", "| [OQ-KS1](#oq-ks1) | yes |")),
    ).toEqual([]);
  });

  it("is quiet without a Leaning or Answer header", async () => {
    expect(await check(table("| Q | Notes |", "| OQ-KS1 | yes |"))).toEqual([]);
  });
});

describe("vantage/question-candidate where ids are only mentioned", () => {
  it("is quiet in fences, prose, links and inline code in prose", async () => {
    const md = [
      "```md",
      "1. 🔒 OQ-1: in a fence",
      "```",
      "",
      "Prose mentions OQ-2, `OQ-3` and [OQ-4](#oq-4).",
      "",
    ].join("\n");
    expect(await check(md)).toEqual([]);
  });

  it("produces nothing and passes --strict-style on a clean document", async () => {
    const report = await one("# Title\n\nPlain text.\n");
    expect(report.findings).toEqual([]);
  });
});

describe("vantage/question-candidate through the CLI", () => {
  const cli = async (...args: string[]) => {
    const root = makeTree({
      "index.md": '1. 🔒 [OQ-1](#oq-1): Blocked?\n\n<a id="oq-1"></a>\n',
    });
    const io = bufferIo(root);
    const code = await run(["check", ...args, "index.md"], io);
    return { code, stdout: io.stdout + io.stderr };
  };

  it("warns without failing, and fails under --strict", async () => {
    const plain = await cli();
    expect(plain.stdout).toContain(CANDIDATE);
    expect(plain.code).toBe(EXIT_OK);
    const strict = await cli("--strict");
    expect(strict.stdout).toContain(CANDIDATE);
    expect(strict.code).toBe(EXIT_FINDINGS);
  });
});
