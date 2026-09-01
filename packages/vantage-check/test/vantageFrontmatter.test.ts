import { describe, expect, it } from "vitest";
// The viewer's own reader, so these tests ask the viewer what a document says
// rather than restating what we believe about it.
import {
  DOC_STATUSES,
  VANTAGE_FRONTMATTER_KEYS,
} from "../../vantage-md/src/vantageFrontmatter.js";
import { RULES } from "../src/rules/registry.js";
import { checkTree, makeTree, ruleIds } from "./helpers.js";

/** A document with `lines` of frontmatter and a body that checks clean. */
function doc(...lines: string[]): string {
  return ["---", ...lines, "---", "", "# Title", "", "Body.", ""].join("\n");
}

async function findingsFor(...lines: string[]) {
  const root = makeTree({ "docs/index.md": doc(...lines) });
  return (await checkTree(root)).findings;
}

describe("vantage/frontmatter-shape", () => {
  it("fires when `vantage:` is not a table", async () => {
    const findings = await findingsFor("vantage: true");

    expect(findings.map((f) => f.rule)).toEqual(["vantage/frontmatter-shape"]);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toContain("table of keys");
  });
});

describe("vantage/frontmatter-key", () => {
  it("fires on a key this build does not know, and lists the ones it does", async () => {
    // `toc:` is the case that will actually happen: the design doc's own
    // frontmatter example showed it before it was iced.
    const findings = await findingsFor("vantage:", "  toc: section");

    expect(findings.map((f) => f.rule)).toEqual(["vantage/frontmatter-key"]);
    // A warning on purpose: a document written for a newer build must not fail
    // an older checker's gate (D3).
    expect(findings[0]?.severity).toBe("warning");
    for (const key of VANTAGE_FRONTMATTER_KEYS) {
      expect(findings[0]?.message).toContain(key);
    }
  });

  it("reports each unknown key once and leaves a good one alone", async () => {
    const findings = await findingsFor(
      "status: draft",
      "vantage:",
      "  status-chip: true",
      "  toc: section",
      "  tone: warning",
    );

    expect(findings.map((f) => f.rule)).toEqual([
      "vantage/frontmatter-key",
      "vantage/frontmatter-key",
    ]);
  });
});

describe("vantage/frontmatter-value", () => {
  it("errors on a wrong-case token and suggests the right one", async () => {
    const findings = await findingsFor("vantage:", "  status-chip: Draft");

    expect(findings.map((f) => f.rule)).toEqual(["vantage/frontmatter-value"]);
    // An error, not a warning: this is a typo in *this* build's own vocabulary,
    // and the chip silently does not render.
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.message).toContain("Did you mean `draft`?");
  });

  it("errors on a token from another key's vocabulary, with nothing to suggest", async () => {
    // `stale` is a legal `badge=`, which is why the confusion is worth naming.
    const findings = await findingsFor("vantage:", "  status-chip: stale");

    expect(findings.map((f) => f.rule)).toEqual(["vantage/frontmatter-value"]);
    expect(findings[0]?.message).not.toContain("Did you mean");
    for (const status of DOC_STATUSES) {
      expect(findings[0]?.detail).toContain(status);
    }
  });
});

describe("vantage/status-chip-stale", () => {
  it("fires when there is no `status:` to inherit", async () => {
    const findings = await findingsFor("vantage:", "  status-chip: true");

    expect(findings.map((f) => f.rule)).toEqual(["vantage/status-chip-stale"]);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toContain("no `status:` key");
  });

  it("fires when the chip and `status:` disagree", async () => {
    const findings = await findingsFor(
      "status: accepted",
      "vantage:",
      "  status-chip: draft",
    );

    expect(findings.map((f) => f.rule)).toEqual(["vantage/status-chip-stale"]);
    expect(findings[0]?.message).toContain("`draft`");
    expect(findings[0]?.message).toContain("`accepted`");
  });

  it("says nothing when the chip inherits a legal status", async () => {
    const findings = await findingsFor(
      "title: Inline markup",
      "status: accepted # draft | in-review | accepted | deprecated",
      "vantage:",
      "  status-chip: true",
    );

    expect(findings).toEqual([]);
  });

  it("says nothing when a literal token agrees with `status:`", async () => {
    const findings = await findingsFor(
      "status: in-review",
      "vantage:",
      "  status-chip: in-review",
    );

    expect(findings).toEqual([]);
  });
});

describe("the family as a whole", () => {
  it("reports at line 1, column 1 — the frontmatter block", async () => {
    // `parseFrontmatter` returns no per-key positions, and a text scan for the
    // key would make a `vantage:` inside a fenced code sample a finding.
    const findings = await findingsFor("vantage:", "  status-chip: Draft");

    expect(findings[0]?.line).toBe(1);
    expect(findings[0]?.column).toBe(1);
  });

  it("is silent, and fails nothing, on a document with no `vantage:` key", async () => {
    const root = makeTree({
      "docs/index.md": doc("title: Plain", "status: draft"),
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
    expect(report.failures).toEqual([]);
  });

  it("is silent on a `vantage:` key inside a fenced code sample", async () => {
    const root = makeTree({
      "docs/index.md": [
        "# Title",
        "",
        "```yaml",
        "vantage:",
        "  status-chip: Draft",
        "```",
        "",
      ].join("\n"),
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });

  it("registers every id it can report", async () => {
    // `vantage-check rules` renders `RULES`, and config treats an id missing
    // from it as a typo — so a rule that reports an unregistered id is
    // unlistable and unconfigurable, and nothing else checks that.
    const ids = new Set(RULES.map((rule) => rule.id));
    for (const id of [
      "vantage/frontmatter-shape",
      "vantage/frontmatter-key",
      "vantage/frontmatter-value",
      "vantage/status-chip-stale",
    ]) {
      expect(ids).toContain(id);
    }
  });
});
