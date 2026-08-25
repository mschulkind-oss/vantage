import path from "node:path";
import { describe, expect, it } from "vitest";
import { docFromContent, type ParsedDoc } from "../parse.js";
import { checkDoc, makeCtx, schemeOf, splitFragment } from "./links.js";

// Fixture root: a repo-shaped tree with real files, so cross-document targets
// (../README.md, guide.md, …) resolve to something on disk.
const FIX = path.resolve(process.cwd(), "test/fixtures/repo");

// A document whose content lives in memory but whose abs path sits inside the
// fixture tree, so relative hrefs resolve against the real fixture files.
function doc(content: string, absRel = "docs/any.md"): ParsedDoc {
  return docFromContent(content, path.join(FIX, absRel), absRel);
}

function rules(d: ParsedDoc) {
  return checkDoc(d, makeCtx());
}

function rule(d: ParsedDoc, id: string) {
  return rules(d).filter((f) => f.rule === id);
}

describe("schemeOf / splitFragment", () => {
  it("detects schemes, including single-letter drive letters", () => {
    expect(schemeOf("https://x.com")).toBe("https");
    expect(schemeOf("mailto:a@b.c")).toBe("mailto");
    expect(schemeOf("C:\\Users\\x")).toBe("c");
    expect(schemeOf("/abs/path")).toBeNull();
    expect(schemeOf("rel/path.md")).toBeNull();
    expect(schemeOf("#frag")).toBeNull();
  });

  it("splits the fragment at the first #", () => {
    expect(splitFragment("a.md#setup")).toEqual({
      path: "a.md",
      frag: "#setup",
    });
    expect(splitFragment("#setup")).toEqual({ path: "", frag: "#setup" });
    expect(splitFragment("a.md")).toEqual({ path: "a.md", frag: null });
  });
});

describe("link/leading-slash", () => {
  it("flags absolute paths", () => {
    expect(rule(doc("[x](/etc/passwd)\n"), "link/leading-slash")).toHaveLength(
      1,
    );
    expect(
      rule(doc("[x](/docs/guide.md#setup)\n"), "link/leading-slash"),
    ).toHaveLength(1);
  });

  it("does not flag relative paths or protocol-relative URLs", () => {
    expect(
      rule(doc("[x](docs/guide.md)\n"), "link/leading-slash"),
    ).toHaveLength(0);
    expect(
      rule(doc("[x](//example.com/x)\n"), "link/leading-slash"),
    ).toHaveLength(0);
    // Protocol-relative is not a finding of any rule.
    expect(rules(doc("[x](//example.com/x)\n"))).toHaveLength(0);
  });
});

describe("link/uri-scheme", () => {
  it("flags non-openable schemes", () => {
    expect(
      rule(doc("[x](file:///etc/passwd)\n"), "link/uri-scheme"),
    ).toHaveLength(1);
    expect(
      rule(doc("[x](C:\\Users\\m\\d.md)\n"), "link/uri-scheme"),
    ).toHaveLength(1);
  });

  it("allows http, https, mailto, data", () => {
    for (const href of [
      "https://example.com",
      "http://example.com",
      "mailto:matt@example.com",
      "data:text/plain,hi",
    ]) {
      expect(rules(doc(`[x](${href})\n`))).toHaveLength(0);
    }
  });
});

describe("link/missing-target", () => {
  it("flags a relative target that does not exist", () => {
    const f = rule(doc("[x](missing.md)\n"), "link/missing-target");
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain("docs/missing.md");
  });

  it("flags an image whose file is missing", () => {
    expect(
      rule(doc("![i](missing.png)\n"), "link/missing-target"),
    ).toHaveLength(1);
  });

  it("flags a link that points at a directory", () => {
    const f = rule(doc("[x](.)\n"), "link/missing-target");
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain("directory");
  });

  it("allows a target that exists (cross-document)", () => {
    // From docs/, ../README.md resolves to the real fixture file.
    expect(
      rule(doc("[x](../README.md)\n"), "link/missing-target"),
    ).toHaveLength(0);
    expect(rule(doc("[x](guide.md)\n"), "link/missing-target")).toHaveLength(0);
  });
});

describe("link/line-anchor-range", () => {
  // A 4-line document; #L4 is the highest valid anchor.
  const fourLines = "# T\n\nbody\n\nend\n";

  it("flags a same-document anchor past the end", () => {
    expect(
      rule(doc(`${fourLines}[x](#L99)\n`), "link/line-anchor-range"),
    ).toHaveLength(1);
  });

  it("flags a cross-document anchor past the end", () => {
    // README.md in the fixtures is 4 lines.
    expect(
      rule(doc("[x](../README.md#L99)\n"), "link/line-anchor-range"),
    ).toHaveLength(1);
  });

  it("allows an in-range anchor and an inverted in-range range", () => {
    expect(
      rule(doc(`${fourLines}[x](#L4)\n`), "link/line-anchor-range"),
    ).toHaveLength(0);
    expect(
      rule(doc(`${fourLines}[x](#L4-L1)\n`), "link/line-anchor-range"),
    ).toHaveLength(0);
  });

  it("does not apply to images", () => {
    // guide.md is 8 lines; #L99 would be out of range for a link, but images
    // are not checked for line anchors.
    expect(rules(doc("![i](guide.md#L99)\n"))).toHaveLength(0);
  });
});

describe("link/dead-section-anchor", () => {
  it("flags a same-document anchor with no matching heading", () => {
    expect(
      rule(
        doc("# Setup\n\n[x](#does-not-exist)\n"),
        "link/dead-section-anchor",
      ),
    ).toHaveLength(1);
  });

  it("flags a cross-document anchor with no matching heading", () => {
    // README.md's only heading is "Overview" -> id "overview".
    expect(
      rule(doc("[x](../README.md#nope)\n"), "link/dead-section-anchor"),
    ).toHaveLength(1);
  });

  it("allows an anchor that matches a heading (same- and cross-document)", () => {
    expect(
      rule(doc("# Setup\n\n[x](#setup)\n"), "link/dead-section-anchor"),
    ).toHaveLength(0);
    // guide.md has a "## Setup" heading.
    expect(
      rule(doc("[x](guide.md#setup)\n"), "link/dead-section-anchor"),
    ).toHaveLength(0);
  });

  it("does not apply to non-Markdown targets", () => {
    // data.txt exists (fixture) but is not .md, so section anchors are not
    // checked against it.
    expect(rules(doc("[x](data.txt#whatever)\n"))).toHaveLength(0);
  });
});

describe("line numbers and frontmatter", () => {
  it("reports file lines (body line + frontmatter offset)", () => {
    // 3-line frontmatter, then the bad link on body line 1 -> file line 4.
    const d = doc("---\ntitle: x\n---\n[x](missing.md)\n");
    const f = rule(d, "link/missing-target");
    expect(f).toHaveLength(1);
    expect(f[0].line).toBe(4);
  });
});

describe("reference links", () => {
  it("resolves reference links through definition nodes", () => {
    const d = doc("[x][ref]\n\n[ref]: missing.md\n");
    expect(rule(d, "link/missing-target")).toHaveLength(1);
  });

  it("ignores unresolved references (they render as literal text)", () => {
    const d = doc("[x][nope]\n");
    expect(rules(d)).toHaveLength(0);
  });
});
