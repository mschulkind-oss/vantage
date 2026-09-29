import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import App from "./App";
import { MemoryRouter } from "react-router-dom";

vi.mock("./pages/ViewerPage", () => ({
  ViewerPage: () => <div data-testid="viewer-page">Viewer Page</div>,
}));

describe("App", () => {
  it("renders ViewerPage for root route", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("viewer-page")).toBeInTheDocument();
  });
});

vi.mock("./pages/PlanningPage", () => ({
  PlanningPage: () => <div data-testid="planning-page">Planning Page</div>,
}));

describe("the planning page's route (Plan Q13)", () => {
  const at = (url: string) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <App />
      </MemoryRouter>,
    );

  it("is /.vantage/planning, and /.vantage/planning/<repo> in daemon mode", () => {
    at("/.vantage/planning");
    expect(screen.getByTestId("planning-page")).toBeInTheDocument();
    at("/.vantage/planning/alpha");
    expect(screen.getAllByTestId("planning-page")).toHaveLength(2);
  });

  it("hides no document: a top-level planning/ directory is still the viewer's", () => {
    at("/planning/notes.md");
    expect(screen.getByTestId("viewer-page")).toBeInTheDocument();
    expect(screen.queryByTestId("planning-page")).toBeNull();
  });
});
