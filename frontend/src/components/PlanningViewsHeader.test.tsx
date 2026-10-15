import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PlanningViewsHeader } from "./PlanningViewsHeader";

vi.mock("./AppShell", () => ({
  OpenSidebarButton: () => <button type="button">Open sidebar</button>,
}));

const shell = {
  sidebarCollapsed: true,
  openSidebar: vi.fn(),
  bannerSpace: 0,
  showGitMetadata: false,
};

function header(activeView: "overview" | "questions") {
  return (
    <MemoryRouter>
      <PlanningViewsHeader
        activeView={activeView}
        isMultiRepo
        repoName="team #1"
        showSidebar
        shell={shell}
        title={
          activeView === "overview" ? "Work overview" : "Planning questions"
        }
        tools={<button type="button">Page tools</button>}
      />
    </MemoryRouter>
  );
}

describe("PlanningViewsHeader", () => {
  it.each([
    ["overview", "Work overview", "Questions"],
    ["questions", "Planning questions", "Overview"],
  ] as const)(
    "keeps the shared frame and marks %s active",
    (active, title, other) => {
      render(header(active));
      const pageHeading = screen.getByRole("heading", { name: title });
      expect(pageHeading).toBeInTheDocument();
      expect(pageHeading).toHaveClass("sr-only");
      expect(
        screen.getByRole("button", { name: "Open sidebar" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Page tools" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("navigation", { name: "Repository breadcrumb" }),
      ).toHaveTextContent("team #1");
      expect(
        screen.getByRole("button", { name: "Folders: team #1" }),
      ).toBeInTheDocument();
      expect(
        screen
          .getByRole("navigation", { name: "Planning views" })
          .querySelectorAll("a"),
      ).toHaveLength(2);
      expect(
        screen.getByRole("link", {
          name: active === "overview" ? "Overview" : "Questions",
        }),
      ).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: other })).not.toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
        "href",
        "/.vantage/work/team%20%231",
      );
      expect(screen.getByRole("link", { name: "Questions" })).toHaveAttribute(
        "href",
        "/.vantage/planning/team%20%231",
      );
    },
  );

  it("omits the single-repository root crumb without losing either view", () => {
    render(
      <MemoryRouter>
        <PlanningViewsHeader
          activeView="questions"
          isMultiRepo={false}
          repoName=""
          showSidebar
          shell={shell}
          title="Planning questions"
        />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("navigation", { name: "Repository breadcrumb" }),
    ).not.toBeInTheDocument();
    const pageHeading = screen.getByRole("heading", {
      name: "Planning questions",
    });
    expect(pageHeading).toBeInTheDocument();
    expect(pageHeading).toHaveClass("sr-only");
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/.vantage/work",
    );
    expect(screen.getByRole("link", { name: "Questions" })).toHaveAttribute(
      "href",
      "/.vantage/planning",
    );
  });
});
