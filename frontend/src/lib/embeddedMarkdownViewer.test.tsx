/**
 * The package viewer's embedded mode.
 *
 * `MarkdownViewer` always drew the frontmatter card, so a panel that wanted the
 * prose — and the directive anchors, line anchors and mermaid handling that
 * come with it — had to hide the card with CSS from outside the package.
 * `hideFrontmatter` makes that a package decision instead, and the risk it
 * carries is that it quietly drops more than the card: this pins that it drops
 * exactly the card and keeps the body, the chain's line numbers and the
 * heading ids.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownViewer } from "vantage-md/react";

afterEach(cleanup);

const DOCUMENT = [
  "---", // 1
  "title: Embedded fixture", // 2
  "status: draft", // 3
  "---", // 4
  "", // 5
  "## Body", // 6
  "", // 7
  "Prose.", // 8
].join("\n");

describe("the package MarkdownViewer's embedded mode", () => {
  it("draws the frontmatter card by default", () => {
    const { container } = render(<MarkdownViewer content={DOCUMENT} />);

    expect(container.textContent).toContain("Embedded fixture");
    expect(container.querySelector("h2")?.textContent).toBe("Body");
  });

  it("drops the card and keeps the body when hideFrontmatter is set", () => {
    const { container } = render(
      <MarkdownViewer content={DOCUMENT} hideFrontmatter />,
    );

    expect(container.textContent).not.toContain("Embedded fixture");
    expect(container.textContent).toContain("Prose.");
  });

  it("keeps the body's file-relative line numbers and heading id", () => {
    const { container } = render(
      <MarkdownViewer content={DOCUMENT} hideFrontmatter />,
    );

    // The body is line 6 of the file, so the frontmatter is still counted even
    // though its card is not drawn.
    const heading = container.querySelector("h2");
    expect(heading?.textContent).toBe("Body");
    expect(heading?.getAttribute("data-source-line")).toBe("6");
    expect(heading?.getAttribute("id")).toBe("body");
  });
});
