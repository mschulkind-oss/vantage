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

  it("opens a menu with a link to every folder, outermost first", () => {
    renderFolders();
    fireEvent.click(screen.getByRole("button", { name: /Folders/ }));

    const items = screen.getAllByRole("menuitem");
    expect(items.map((a) => a.textContent)).toEqual(["docs", "design"]);
    expect(items.map((a) => a.getAttribute("href"))).toEqual([
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
