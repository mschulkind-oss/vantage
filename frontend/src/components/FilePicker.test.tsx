import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { FilePicker } from "./FilePicker";

const hrefFor = (path: string, repo?: string) =>
  repo ? `/${repo}/${path}` : `/current/${path}`;

const globalProps = {
  mode: "global" as const,
  files: [],
  globalFiles: [{ repo: "other", path: "notes/c.md" }],
};

function renderPicker(
  props: Partial<React.ComponentProps<typeof FilePicker>> = {},
) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <FilePicker
        isOpen
        onClose={onClose}
        onSelect={onSelect}
        hrefFor={hrefFor}
        files={["docs/a.md", "b.md"]}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onSelect, onClose };
}

/** A path is split into per-character spans, so find its row by its text. */
function row(text: string): HTMLElement {
  const el = [
    ...document.querySelectorAll<HTMLElement>("[data-file-item]"),
  ].find((r) => r.textContent === text);
  if (!el) throw new Error(`no row for ${text}`);
  return el;
}

describe("FilePicker rows", () => {
  // Record whether the picker left the click to the browser, then cancel it so
  // jsdom does not attempt a real navigation.
  let defaultPrevented: boolean | undefined;
  const recordClick = (e: MouseEvent) => {
    defaultPrevented = e.defaultPrevented;
    e.preventDefault();
  };

  beforeEach(() => {
    defaultPrevented = undefined;
    document.addEventListener("click", recordClick);
  });
  afterEach(() => {
    document.removeEventListener("click", recordClick);
  });

  it("are links to hrefFor's route in local mode", () => {
    renderPicker();
    const a = row("docs/a.md");
    expect(a.tagName).toBe("A");
    expect(a).toHaveAttribute("href", "/current/docs/a.md");
    expect(row("b.md")).toHaveAttribute("href", "/current/b.md");
  });

  it("are links to the named repo's route in global mode", () => {
    renderPicker(globalProps);
    const a = row("other/notes/c.md");
    expect(a.tagName).toBe("A");
    expect(a).toHaveAttribute("href", "/other/notes/c.md");
  });

  it("navigate through onSelect on a plain click, and close", () => {
    const { onSelect, onClose } = renderPicker();
    fireEvent.click(row("docs/a.md"));
    expect(onSelect).toHaveBeenCalledWith("docs/a.md", undefined);
    expect(onClose).toHaveBeenCalled();
    expect(defaultPrevented).toBe(true);
  });

  it("pass the repo to onSelect on a plain click in global mode", () => {
    const { onSelect } = renderPicker(globalProps);
    fireEvent.click(row("other/notes/c.md"));
    expect(onSelect).toHaveBeenCalledWith("notes/c.md", "other");
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }])(
    "leave a modified click (%o) to the browser",
    (modifier) => {
      const { onSelect, onClose } = renderPicker();
      fireEvent.click(row("docs/a.md"), modifier);
      expect(onSelect).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(defaultPrevented).toBe(false);
    },
  );

  it("still select on hover", () => {
    renderPicker();
    fireEvent.mouseEnter(row("b.md"));
    expect(row("b.md").className).toContain("bg-blue-50");
    expect(row("docs/a.md").className).not.toContain("bg-blue-50");
  });
});

describe("FilePicker Enter", () => {
  let open: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    open = vi.spyOn(window, "open").mockReturnValue(null);
  });
  afterEach(() => {
    open.mockRestore();
  });

  const input = () => screen.getByRole("textbox");

  it("selects the highlighted row and closes on a plain Enter", () => {
    const { onSelect, onClose } = renderPicker();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("b.md", undefined);
    expect(onClose).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each([{ altKey: true }, { ctrlKey: true }, { metaKey: true }])(
    "opens the highlighted row in a new tab on a modified Enter (%o)",
    (modifier) => {
      const { onSelect, onClose } = renderPicker();
      fireEvent.keyDown(input(), { key: "ArrowDown" });
      fireEvent.keyDown(input(), { key: "Enter", ...modifier });
      expect(open).toHaveBeenCalledWith("/current/b.md", "_blank", "noopener");
      expect(onSelect).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    },
  );

  it("opens the named repo's route in global mode", () => {
    renderPicker(globalProps);
    fireEvent.keyDown(input(), { key: "Enter", altKey: true });
    expect(open).toHaveBeenCalledWith(
      "/other/notes/c.md",
      "_blank",
      "noopener",
    );
  });
});
