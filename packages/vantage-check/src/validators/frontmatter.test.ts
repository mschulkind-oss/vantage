import { parseFrontmatter, parseFrontmatterStrict } from "vantage-md";
import { describe, expect, it } from "vitest";
import { docFromContent } from "../parse.js";
import { validateFrontmatter } from "./frontmatter.js";
import type { Finding } from "../types.js";

const doc = (content: string) =>
  docFromContent(content, "/repo/doc.md", "doc.md");

async function runFrontmatter(content: string): Promise<Finding[]> {
  return Promise.resolve(validateFrontmatter.run(doc(content)));
}

const CASES: {
  name: string;
  content: string;
  unclosed: boolean;
  /** "null" or "non-null": whether parseFrontmatterStrict reports an error. */
  error: "null" | "non-null";
}[] = [
  {
    name: "valid yaml",
    content: "---\ntitle: Hello\n---\n\nBody.\n",
    unclosed: false,
    error: "null",
  },
  {
    name: "valid toml",
    content: '+++\ntitle = "Hi"\n+++\n\nBody.\n',
    unclosed: false,
    error: "null",
  },
  {
    name: "unclosed block that looks like frontmatter",
    content: "---\ntitle: Hello\n\nBody.\n",
    unclosed: true,
    error: "null",
  },
  {
    name: "top --- used as a horizontal rule is not frontmatter",
    content: "---\n\nSome intro text.\n",
    unclosed: false,
    error: "null",
  },
  {
    name: "present but invalid yaml",
    content: "---\ntitle: [unclosed\n---\n\nBody.\n",
    unclosed: false,
    error: "non-null",
  },
];

describe("parseFrontmatterStrict (vantage-md)", () => {
  for (const c of CASES) {
    it(`classifies: ${c.name}`, () => {
      const strict = parseFrontmatterStrict(c.content);
      expect(strict.unclosed).toBe(c.unclosed);
      if (c.error === "non-null") {
        expect(strict.error).not.toBeNull();
      } else {
        expect(strict.error).toBeNull();
      }
    });
  }

  it("agrees with parseFrontmatter on body, format, and offset", () => {
    for (const c of CASES) {
      const strict = parseFrontmatterStrict(c.content);
      const old = parseFrontmatter(c.content);
      expect(strict.body).toBe(old.body);
      expect(strict.format).toBe(old.format);
      expect(strict.frontmatter).toEqual(old.frontmatter);
      expect(strict.bodyLineOffset).toBe(old.bodyLineOffset);
    }
  });
});

describe("validateFrontmatter", () => {
  it("reports no findings for valid or absent frontmatter", async () => {
    expect(await runFrontmatter("---\ntitle: t\n---\nBody.\n")).toEqual([]);
    expect(await runFrontmatter("Just a document.\n")).toEqual([]);
  });

  it("flags an unclosed block as a warning on line 1", async () => {
    const findings = await runFrontmatter("---\ntitle: Hello\n\nBody.\n");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "frontmatter/unclosed",
      severity: "warning",
      line: 1,
    });
  });

  it("flags invalid yaml as an error carrying the parser message", async () => {
    const findings = await runFrontmatter(
      "---\ntitle: [unclosed\n---\n\nBody.\n",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "frontmatter/invalid",
      severity: "error",
      line: 1,
    });
    expect(findings[0].message).toMatch(/YAML/);
    expect(findings[0].message.length).toBeLessThan(220);
  });

  it("does not flag a --- horizontal rule", async () => {
    expect(await runFrontmatter("---\n\nSome intro text.\n")).toEqual([]);
  });
});
