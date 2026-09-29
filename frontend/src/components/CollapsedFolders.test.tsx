import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { CollapsedFolders } from "./CollapsedFolders";

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderFolders() {
  return render(
    <MemoryRouter initialEntries={["/docs/design/notes.md"]}>
      <CollapsedFolders
        root={{ label: "root", href: "/" }}
        dirs={["docs", "design"]}
        hrefFor={(depth) =>
          "/" + ["docs", "design"].slice(0, depth + 1).join("/")
        }
      />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CollapsedFolders", () => {
  it("names the folders it stands for, in its label and its tooltip", () => {
    renderFolders();
    const more = screen.getByRole("button", { name: "Folders: docs/design" });
    expect(more).toHaveTextContent("…");
    expect(more).toHaveAttribute("title", "docs/design");
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens a menu with a link to the repository and every folder, outermost first", () => {
    renderFolders();
    fireEvent.click(screen.getByRole("button", { name: /Folders/ }));

    const items = screen.getAllByRole("menuitem");
    expect(items.map((a) => a.textContent)).toEqual(["root", "docs", "design"]);
    expect(items.map((a) => a.getAttribute("href"))).toEqual([
      "/",
      "/docs",
      "/docs/design",
    ]);
    expect(screen.getByRole("button", { name: /Folders/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("goes to the folder chosen and closes", () => {
    renderFolders();
    fireEvent.click(screen.getByRole("button", { name: /Folders/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "docs" }));

    expect(screen.getByTestId("where")).toHaveTextContent("/docs");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

// Collapsing the folders put them behind this menu, so the keyboard has to be
// able to get into it: a menu that opened with focus left on its trigger, and
// that Escape closed by dropping focus on <body>, took forty-five Tab presses
// to reach — the panel is portaled to the end of the document.
describe("CollapsedFolders from the keyboard", () => {
  const open = () => {
    const more = screen.getByRole("button", { name: /Folders/ });
    more.focus();
    fireEvent.click(more);
    return more;
  };
  const key = (k: string, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(document.activeElement!, { key: k, ...init });

  it("puts focus on the first item when it opens", () => {
    renderFolders();
    open();
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "root" }),
    );
  });

  it("moves between the folders with the arrow keys, Home and End", () => {
    renderFolders();
    open();
    const [root, docs, design] = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(root);
    key("ArrowDown");
    expect(document.activeElement).toBe(docs);
    key("ArrowDown");
    key("ArrowDown");
    expect(document.activeElement).toBe(root);
    key("ArrowUp");
    expect(document.activeElement).toBe(design);
    key("Home");
    expect(document.activeElement).toBe(root);
    key("End");
    expect(document.activeElement).toBe(design);
  });

  it("gives focus back to the … when Escape closes it", () => {
    renderFolders();
    const more = open();
    key("Escape");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("closes on Tab, from the … rather than from the end of the page", () => {
    renderFolders();
    const more = open();
    key("Tab");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more);
  });
});

// At the repository root there are no folders to collapse, but the header's
// `repo` step still folds the repository's name in behind a "…".
describe("CollapsedFolders at the repository root", () => {
  it("stands for the repository alone", () => {
    render(
      <MemoryRouter>
        <CollapsedFolders
          root={{
            label: "a-long-repository-name",
            href: "/a-long-repository-name",
          }}
          dirs={[]}
          hrefFor={() => "/"}
        />
      </MemoryRouter>,
    );
    const more = screen.getByRole("button", {
      name: "Folders: a-long-repository-name",
    });
    fireEvent.click(more);
    expect(
      screen.getAllByRole("menuitem").map((a) => a.getAttribute("href")),
    ).toEqual(["/a-long-repository-name"]);
  });
});
