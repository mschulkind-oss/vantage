import { describe, expect, it, vi } from "vitest";

// Mock only renderMarkdown (the thing under test's delegate); keep the real
// parse helpers docFromContent relies on.
vi.mock("vantage-md", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vantage-md")>();
  return { ...actual, renderMarkdown: vi.fn() };
});

import { docFromContent } from "../parse.js";
import { validatePipeline } from "./pipeline.js";
import * as vantageMd from "vantage-md";

const doc = (content: string) =>
  docFromContent(content, "/repo/doc.md", "doc.md");

describe("validatePipeline", () => {
  it("reports no findings when the real pipeline renders the document", async () => {
    vi.mocked(vantageMd.renderMarkdown).mockResolvedValue({
      html: "<p>ok</p>",
      frontmatter: {},
      body: "ok\n",
    });
    const findings = await validatePipeline.run(doc("# Hi\n\nok\n"));
    expect(findings).toEqual([]);
    expect(vantageMd.renderMarkdown).toHaveBeenCalledWith("# Hi\n\nok\n");
  });

  it("flags a document the pipeline rejects, with the pipeline message", async () => {
    vi.mocked(vantageMd.renderMarkdown).mockRejectedValue(
      new Error("boom: plugin exploded"),
    );
    const findings = await validatePipeline.run(doc("# Hi\n\nok\n"));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "render/pipeline",
      severity: "error",
      line: 0,
    });
    expect(findings[0].message).toContain("boom: plugin exploded");
  });
});
