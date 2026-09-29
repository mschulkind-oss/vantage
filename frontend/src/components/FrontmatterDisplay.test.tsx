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

describe("FrontmatterDisplay — `next` links its question ids", () => {
  // docs/design/planning-index.md §4: a bare `OQ-…` id in `next` links to this
  // document's question when one of its questions carries that id.
  const nextCell = () =>
    screen.getByText("next").closest("tr")!.querySelectorAll("td")[1];

  it("links a declared id to its question", () => {
    render(
      <FrontmatterDisplay
        frontmatter={{
          next: "Rule OQ-B2 — the payload's install step waits on it",
        }}
        linkIds={["OQ-B1", "OQ-B2"]}
      />,
    );
    const link = screen.getByRole("link", { name: "OQ-B2" });
    expect(link).toHaveAttribute("href", "#OQ-B2");
    expect(nextCell()).toHaveTextContent(
      "Rule OQ-B2 — the payload's install step waits on it",
    );
  });

  it("links every declared id, and keeps the words around them", () => {
    render(
      <FrontmatterDisplay
        frontmatter={{ next: "OQ-1, then OQ-2." }}
        linkIds={["OQ-1", "OQ-2"]}
      />,
    );
    expect(
      screen.getAllByRole("link").map((a) => a.getAttribute("href")),
    ).toEqual(["#OQ-1", "#OQ-2"]);
    expect(nextCell()).toHaveTextContent("OQ-1, then OQ-2.");
  });

  it("leaves an id no question carries as text: undeclared, or compacted into the ledger", () => {
    render(
      <FrontmatterDisplay
        frontmatter={{ next: "Compact OQ-9 and rule OQ-1" }}
        linkIds={["OQ-1"]}
      />,
    );
    expect(screen.queryByRole("link", { name: "OQ-9" })).toBeNull();
    expect(screen.getByRole("link", { name: "OQ-1" })).toBeInTheDocument();
  });

  it("leaves an id that is only part of a longer token as text", () => {
    render(
      <FrontmatterDisplay
        frontmatter={{ next: "See xOQ-1, OQ-12 and OQ-1a" }}
        linkIds={["OQ-1"]}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(nextCell()).toHaveTextContent("See xOQ-1, OQ-12 and OQ-1a");
  });

  it("renders `next` as plain text without ids, as before the index is ready", () => {
    render(<FrontmatterDisplay frontmatter={{ next: "Rule OQ-1" }} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Rule OQ-1")).toBeInTheDocument();
  });

  // §4 ignores a `next` that is not one line, as the index does, so its ids
  // are not the header's to link.
  it("links nothing in a `next` that runs over several lines", () => {
    render(
      <FrontmatterDisplay
        frontmatter={{ next: "Rule OQ-1\nthen OQ-2" }}
        linkIds={["OQ-1", "OQ-2"]}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("links nothing in any other key", () => {
    render(
      <FrontmatterDisplay
        frontmatter={{ summary: "About OQ-1", extra: { next: "OQ-1 too" } }}
        linkIds={["OQ-1"]}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});
