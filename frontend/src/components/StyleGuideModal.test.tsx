import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StyleGuideModal, STYLE_GUIDE_SNIPPET } from "./StyleGuideModal";
import * as clipboard from "../lib/clipboard";

describe("StyleGuideModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not render when closed", () => {
    render(<StyleGuideModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the style guide modal and snippet when open", () => {
    render(<StyleGuideModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Style Guide for Agents")).toBeInTheDocument();
    expect(
      screen.getByText(/Markdown style guide \(for Vantage viewer\)/),
    ).toBeInTheDocument();
  });

  it("includes rules for links, frontmatter, mermaid, callouts, and code blocks", () => {
    expect(STYLE_GUIDE_SNIPPET).toContain("Relative paths only");
    expect(STYLE_GUIDE_SNIPPET).toContain("Never use leading slashes");
    expect(STYLE_GUIDE_SNIPPET).toContain(
      "Never use absolute filesystem paths",
    );
    expect(STYLE_GUIDE_SNIPPET).toContain("Line anchors and ranges");
    expect(STYLE_GUIDE_SNIPPET).toContain("Frontmatter (Metadata)");
    expect(STYLE_GUIDE_SNIPPET).toContain("Mermaid diagrams");
    expect(STYLE_GUIDE_SNIPPET).toContain("Code blocks and diffs");
    expect(STYLE_GUIDE_SNIPPET).toContain("Callouts and alerts");
  });

  it("copies snippet on copy button click", async () => {
    const copySpy = vi
      .spyOn(clipboard, "copyTextOrWarn")
      .mockResolvedValue(true);

    render(<StyleGuideModal isOpen={true} onClose={() => {}} />);

    const copyBtn = screen.getByRole("button", { name: /Copy snippet/i });
    fireEvent.click(copyBtn);

    expect(copySpy).toHaveBeenCalledWith(STYLE_GUIDE_SNIPPET.trim());
    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeInTheDocument();
    });
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<StyleGuideModal isOpen={true} onClose={onClose} />);

    const closeBtn = screen.getByLabelText("Close modal");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<StyleGuideModal isOpen={true} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
