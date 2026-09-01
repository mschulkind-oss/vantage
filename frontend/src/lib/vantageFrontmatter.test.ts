/**
 * The `vantage:` frontmatter key.
 *
 * The code under test lives in `packages/vantage-md`, which has no runner of its
 * own; the frontend resolves `vantage-md` to that package's TypeScript source
 * (see `vitest.config.ts`), so these run against the real reader — the one both
 * viewers and the CLI checker use, reached the way the app reaches it.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DOC_STATUSES,
  DOC_STATUS_TONES,
  VANTAGE_TONES,
  isDocStatus,
  parseFrontmatter,
  readVantageFrontmatter,
} from "vantage-md";

/** The `vantage:` value, already through the real YAML/TOML parser. */
function read(source: string) {
  return readVantageFrontmatter(parseFrontmatter(source).frontmatter);
}

const yaml = (...lines: string[]) =>
  ["---", ...lines, "---", "", "# Body", ""].join("\n");

describe("readVantageFrontmatter", () => {
  it("is silent and empty when there is no `vantage:` key", () => {
    const result = readVantageFrontmatter({ title: "x", status: "draft" });
    expect(result.statusChip).toBeUndefined();
    expect(result.issues).toEqual([]);
  });

  it("treats `vantage:` that is not a table as one issue and no chrome", () => {
    for (const value of ["hello", 3, true, null, ["a"], new Date()]) {
      const result = readVantageFrontmatter({ vantage: value });
      expect(result.statusChip).toBeUndefined();
      expect(result.issues).toEqual([{ kind: "not-a-table", value }]);
    }
  });

  describe("`status-chip: true` inherits the document's own status", () => {
    it("takes the top-level `status:`", () => {
      const result = readVantageFrontmatter({
        status: "draft",
        vantage: { "status-chip": true },
      });
      expect(result.statusChip).toBe("draft");
      expect(result.issues).toEqual([]);
    });

    it("reads the status through YAML, trailing comment and all", () => {
      // The single most important assertion in this file. Every document in the
      // repo writes the vocabulary as a comment on the line —
      // `status: accepted # draft | in-review | accepted | deprecated` — so a
      // reader that scraped the source line would get the comment too and match
      // nothing. Going through `YAML.parse` yields `"accepted"`.
      const result = read(
        yaml(
          'title: "Inline markup"',
          "status: accepted # draft | in-review | accepted | deprecated",
          "vantage:",
          "  status-chip: true",
        ),
      );
      expect(result.statusChip).toBe("accepted");
      expect(result.issues).toEqual([]);
    });

    it("reports an orphan when there is no legal `status:` to inherit", () => {
      const result = readVantageFrontmatter({
        vantage: { "status-chip": true },
      });
      expect(result.statusChip).toBeUndefined();
      expect(result.issues).toEqual([
        { kind: "status-chip-orphan", status: undefined },
      ]);
    });

    it("is case-sensitive about the status it inherits", () => {
      const result = readVantageFrontmatter({
        status: "Draft",
        vantage: { "status-chip": true },
      });
      expect(result.statusChip).toBeUndefined();
      expect(result.issues).toEqual([
        { kind: "status-chip-orphan", status: "Draft" },
      ]);
    });
  });

  describe("a literal `status-chip:` token", () => {
    it("renders the token it names", () => {
      const result = read(yaml("vantage:", "  status-chip: in-review"));
      expect(result.statusChip).toBe("in-review");
      expect(result.issues).toEqual([]);
    });

    it("still renders when it disagrees with `status:`, and says so", () => {
      // Both values are legal, so the chip is not dropped — the disagreement is
      // markup rot (R3), which is a checker finding, not a render decision.
      const result = read(
        yaml("status: accepted", "vantage:", "  status-chip: in-review"),
      );
      expect(result.statusChip).toBe("in-review");
      expect(result.issues).toEqual([
        {
          kind: "status-chip-disagrees",
          chip: "in-review",
          status: "accepted",
        },
      ]);
    });

    it("says nothing when it agrees with `status:`", () => {
      const result = read(
        yaml("status: accepted", "vantage:", "  status-chip: accepted"),
      );
      expect(result.statusChip).toBe("accepted");
      expect(result.issues).toEqual([]);
    });
  });

  it("turns `status-chip: false` off with no complaint", () => {
    const result = read(
      yaml("status: draft", "vantage:", "  status-chip: false"),
    );
    expect(result.statusChip).toBeUndefined();
    expect(result.issues).toEqual([]);
  });

  it("rejects a badge token, which belongs to a different key's vocabulary", () => {
    // `stale` is a legal `badge=`, and that is exactly why this has to fail:
    // `badge` is section-scoped workflow state, `status` is document lifecycle.
    const result = read(yaml("vantage:", "  status-chip: stale"));
    expect(result.statusChip).toBeUndefined();
    expect(result.issues).toEqual([
      {
        kind: "bad-value",
        key: "status-chip",
        value: "stale",
        legal: [...DOC_STATUSES, "true", "false"],
      },
    ]);
  });

  it("rejects a wrong-case token", () => {
    const result = read(yaml("vantage:", "  status-chip: Draft"));
    expect(result.statusChip).toBeUndefined();
    expect(result.issues[0]).toMatchObject({
      kind: "bad-value",
      value: "Draft",
    });
  });

  it("rejects a value of the wrong type, Dates included", () => {
    for (const value of [3, [], {}, new Date("2026-08-31")]) {
      const result = readVantageFrontmatter({
        vantage: { "status-chip": value },
      });
      expect(result.statusChip).toBeUndefined();
      expect(result.issues).toEqual([
        {
          kind: "bad-value",
          key: "status-chip",
          value,
          legal: [...DOC_STATUSES, "true", "false"],
        },
      ]);
    }
  });

  it("drops an unknown key per key, keeping the ones it knows (D2)", () => {
    // `toc:` is iced by the design, so it is simply an unknown key — inert, with
    // a warning from the checker and no effect on the chip beside it.
    const result = read(
      yaml(
        "vantage:",
        "  status-chip: draft",
        "  toc: section",
        "  tone: warning",
      ),
    );
    expect(result.statusChip).toBe("draft");
    expect(result.issues).toEqual([
      { kind: "unknown-key", key: "toc" },
      { kind: "unknown-key", key: "tone" },
    ]);
  });

  it("reads TOML exactly as it reads YAML", () => {
    const toml = [
      "+++",
      "[vantage]",
      "status-chip = true",
      "+++",
      "",
      "# Body",
      "",
    ].join("\n");
    // `status` has to be above the table header: everything after `[vantage]`
    // belongs to that table.
    const withStatus = [
      "+++",
      'status = "draft"',
      "[vantage]",
      "status-chip = true",
      "+++",
      "",
      "# Body",
      "",
    ].join("\n");
    expect(read(withStatus).statusChip).toBe("draft");
    expect(read(toml).issues).toEqual([
      { kind: "status-chip-orphan", status: undefined },
    ]);
  });

  it("is pure: same input twice, same answer, input untouched", () => {
    const input = {
      title: "x",
      status: "draft",
      vantage: { "status-chip": true, toc: "section" },
    };
    const copy = structuredClone(input);
    expect(readVantageFrontmatter(input)).toEqual(
      readVantageFrontmatter(input),
    );
    expect(input).toEqual(copy);
  });

  describe("the reader never speaks (P3)", () => {
    afterEach(() => vi.restoreAllMocks());

    it("logs nothing, for any input", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      for (const value of [
        undefined,
        "hello",
        new Date(),
        { "status-chip": true },
        { "status-chip": "Draft" },
        { "status-chip": 3 },
        { toc: "section" },
      ]) {
        readVantageFrontmatter({ status: "draft", vantage: value });
      }

      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });
  });

  it("narrows with `isDocStatus` and nothing else", () => {
    for (const status of DOC_STATUSES) expect(isDocStatus(status)).toBe(true);
    for (const other of ["Draft", "stale", "", 3, true, null, new Date()]) {
      expect(isDocStatus(other)).toBe(false);
    }
  });
});

describe("the chip's colours exist in the shared stylesheet", () => {
  /**
   * `fs`, not `?raw`: vitest stubs CSS imports to `""` unless `test.css` is on,
   * which would make every assertion below pass vacuously. The path stays a
   * variable — Vite rewrites a literal `new URL("./x", import.meta.url)` into an
   * asset URL `fs` cannot open.
   */
  const path = "../../../packages/vantage-md/src/styles/directives.css";
  const css = readFileSync(new URL(path, import.meta.url), "utf8");

  it("maps every status onto a tone the plugin also uses", () => {
    // The chip has no palette of its own: `status: draft` and `badge=draft` are
    // the same visual object because both resolve to `.vantage-chip--muted`.
    // This is the drift guard — add a status to the union with no tone and it
    // would otherwise render an unstyled chip in every renderer.
    expect(Object.keys(DOC_STATUS_TONES).sort()).toEqual(
      [...DOC_STATUSES].sort(),
    );
    for (const status of DOC_STATUSES) {
      const tone = DOC_STATUS_TONES[status];
      expect(VANTAGE_TONES).toContain(tone);
      expect(css).toContain(`.vantage-chip--${tone} {`);
    }
  });

  it("gives the chrome strip above the metadata card a rule", () => {
    expect(css).toContain(".vantage-chrome {");
  });
});
