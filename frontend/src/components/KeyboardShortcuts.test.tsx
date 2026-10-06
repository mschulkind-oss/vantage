import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  KeyboardShortcutsModal,
  KeyboardShortcutsButton,
} from "./KeyboardShortcuts";

describe("KeyboardShortcutsModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <KeyboardShortcutsModal isOpen={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders modal content when open", () => {
    render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
  });

  it("displays shortcut groups", () => {
    render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("File Viewing")).toBeInTheDocument();
    expect(screen.getByText("Theme & Settings")).toBeInTheDocument();
  });

  it("displays individual shortcuts", () => {
    render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("Open file finder")).toBeInTheDocument();
    expect(screen.getByText("Toggle sidebar")).toBeInTheDocument();
    expect(screen.getByText("Toggle dark mode")).toBeInTheDocument();
    expect(screen.getByText("Show this help")).toBeInTheDocument();
    expect(screen.getByText("Scroll down")).toBeInTheDocument();
    expect(screen.getByText("View latest diff")).toBeInTheDocument();
    expect(screen.getByText("Copy absolute file path")).toBeInTheDocument();
  });

  // A page with no document (the planning page) wires none of the keys that
  // act on one, so its help does not offer them.
  it("leaves out the document keys where the page wires none", () => {
    render(
      <KeyboardShortcutsModal
        isOpen={true}
        onClose={vi.fn()}
        documentKeys={false}
      />,
    );
    expect(screen.queryByText("View latest diff")).toBeNull();
    expect(screen.queryByText("View file history")).toBeNull();
    expect(screen.queryByText("Copy absolute file path")).toBeNull();
    expect(screen.queryByText("File Viewing")).toBeNull();
    expect(screen.queryByText(/leave raw view/)).toBeNull();
    // What the keys still do there.
    expect(screen.getByText("Scrolling")).toBeInTheDocument();
    expect(screen.getByText("Scroll down")).toBeInTheDocument();
    expect(screen.getByText("Scroll to bottom")).toBeInTheDocument();
    expect(screen.getByText("Close a dialog")).toBeInTheDocument();
    expect(screen.getByText("Go to the planning page")).toBeInTheDocument();
  });

  // Shift+T is one chord, not Shift pressed and released before T; only a real
  // sequence like `g h` reads "then".
  it("joins a modifier to its key with + and a sequence with then", () => {
    render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);
    const row = (description: string) =>
      screen.getByText(description).parentElement!.textContent;
    expect(row("Search all projects' files")).toContain("Shift+T");
    expect(row("Go home (root)")).toContain("gthenh");
  });

  it("lists g then p for the planning page", () => {
    render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(
      screen.getByText("Go to the planning page").parentElement!.textContent,
    ).toContain("gthenp");
  });

  // docs/design/planning-filter.md §7: `/` is the planning page's alone.
  it("lists / in a row of its own where the page has a filter box, and nowhere else", () => {
    const { unmount } = render(
      <KeyboardShortcutsModal
        isOpen={true}
        onClose={vi.fn()}
        documentKeys={false}
        filterKey={true}
      />,
    );
    expect(
      screen.getByText("Filter the planning page").parentElement!.textContent,
    ).toBe("Filter the planning page/");
    unmount();
    render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText("Filter the planning page")).toBeNull();
  });

  it("lists opening a menu row in a new tab, under every menu it works in", () => {
    render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);
    const row = screen.getByText(
      "Open the highlighted row in a new tab",
    ).parentElement!;
    expect(row.textContent).toContain("Alt+EnterorCtrl+Enter");
    expect(
      screen.getByText("In the file finder, project picker and recents"),
    ).toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsModal isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when clicking the backdrop", () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsModal isOpen={true} onClose={onClose} />);
    // Click the backdrop (the outer fixed div)
    const backdrop = screen.getByRole("dialog").parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when clicking the X button", () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("KeyboardShortcutsButton", () => {
  it("renders a button with keyboard icon", () => {
    render(<KeyboardShortcutsButton onClick={vi.fn()} />);
    expect(screen.getByLabelText("Keyboard shortcuts")).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<KeyboardShortcutsButton onClick={onClick} />);
    fireEvent.click(screen.getByLabelText("Keyboard shortcuts"));
    expect(onClick).toHaveBeenCalled();
  });
});
