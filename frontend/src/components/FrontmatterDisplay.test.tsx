/**
 * The metadata card and the file-scope chrome above it.
 *
 * `FrontmatterDisplay` is the shared component both viewers render — the app's
 * `MarkdownViewer` and the package's own — which is the only reason the two
 * cannot drift about the status chip (D5, as it applies to frontmatter: the
 * chip can never appear in `renderMarkdown`'s HTML, because frontmatter is
 * stripped before the pipeline ever runs).
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { FrontmatterDisplay } from "vantage-md/react";

/** The card, found the way a reader finds it: by its "Metadata" header. */
function card(): HTMLElement {
  const label = screen.getByText("Metadata");
  const box = label.closest("div.mb-8");
  expect(box, "no metadata card in the output").not.toBeNull();
  return box as HTMLElement;
}

describe("FrontmatterDisplay", () => {
  it("renders the chip and keeps `vantage:` out of the card", () => {
    render(
      <FrontmatterDisplay
        frontmatter={{ title: "x", vantage: { "status-chip": "draft" } }}
      />,
    );

    // The regression this exists to prevent: `ValueCell`'s isPlainObject branch
    // would render the reserved key as a monospace JSON blob row, shipping the
    // chip *and* the burial the chip exists to remove.
    expect(screen.queryByText("vantage")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("status-chip");

    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("x")).toBeInTheDocument();
  });

  it("puts the chip above the card, not inside it", () => {
    // §5.3's whole complaint is that the status is buried in the card. A chip
    // inside the card answers nothing.
    render(
      <FrontmatterDisplay
        frontmatter={{ title: "x", vantage: { "status-chip": "draft" } }}
      />,
    );

    const chip = screen.getByText("draft");
    expect(chip.tagName).toBe("SPAN");
    expect(chip).toHaveAttribute("data-vantage-status", "draft");
    expect(chip.className).toContain("vantage-chip");
    expect(card()).not.toContainElement(chip);
    expect(chip.closest(".vantage-chrome")).not.toBeNull();
  });

  it("is not a control", () => {
    // D4 by construction rather than by gate: a non-interactive span cannot fail
    // in a static export, so it needs no `isStaticMode()` check and survives
    // there — the one place D5 costs nothing.
    render(
      <FrontmatterDisplay
        frontmatter={{ vantage: { "status-chip": "draft" } }}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders the chip with no card when `vantage:` is the only key", () => {
    render(
      <FrontmatterDisplay
        frontmatter={{ vantage: { "status-chip": "draft" } }}
      />,
    );
    expect(screen.getByText("draft")).toBeInTheDocument();
    // Not an empty gradient box around an empty <table>.
    expect(screen.queryByText("Metadata")).not.toBeInTheDocument();
  });

  it("renders nothing at all when the only key is a reserved key with nothing in it", () => {
    // `toc:` is iced, so this is an unknown key: inert, no chip, and no card
    // either, because the one row it would have printed was filtered out.
    const { container } = render(
      <FrontmatterDisplay frontmatter={{ vantage: { toc: "section" } }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there is no frontmatter", () => {
    const { container } = render(<FrontmatterDisplay frontmatter={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("leaves a document with no `vantage:` key exactly as it was", () => {
    render(
      <FrontmatterDisplay frontmatter={{ title: "x", status: "draft" }} />,
    );
    expect(screen.getByText("Metadata")).toBeInTheDocument();
    expect(screen.getByText("status")).toBeInTheDocument();
    // `status:` on its own is still just a row — the chip is opt-in.
    expect(card()).toContainElement(screen.getByText("draft"));
    expect(document.querySelector(".vantage-chrome")).toBeNull();
  });

  it("shows a hoisted `extra.vantage`, which is the user's key and not ours", () => {
    render(
      <FrontmatterDisplay
        frontmatter={{ extra: { vantage: "hand-rolled" }, title: "x" }}
      />,
    );
    expect(screen.getByText("vantage")).toBeInTheDocument();
    expect(screen.getByText("hand-rolled")).toBeInTheDocument();
  });
});
