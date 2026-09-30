import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";
import App from "./App";
import { MemoryRouter, Outlet, useNavigate } from "react-router-dom";

// The shell, as a frame that counts how often it is mounted: the real one
// loads the repositories, which no case here answers.
const shellMounts = vi.hoisted(() => ({ count: 0 }));
let navigateTo: ((to: string) => void) | null = null;
vi.mock("./components/AppShell", () => ({
  AppShell: () => {
    const navigate = useNavigate();
    navigateTo = navigate;
    useEffect(() => {
      shellMounts.count += 1;
    }, []);
    return (
      <div data-testid="shell">
        <Outlet />
      </div>
    );
  },
}));

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

// planning-index.md §6.5: the viewer and the planning page are drawn in one
// shell, so going between them replaces the main column and nothing else —
// the sidebar is not drawn again, nor its tree, recent files and bookmarks
// asked for again.
describe("the app shell", () => {
  it("is one for the viewer and the planning page, mounted once across them", () => {
    shellMounts.count = 0;
    render(
      <MemoryRouter initialEntries={["/docs/a.md"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("viewer-page")).toBeInTheDocument();
    act(() => navigateTo!("/.vantage/planning"));
    expect(screen.getByTestId("planning-page")).toBeInTheDocument();
    act(() => navigateTo!("/docs/b.md"));
    expect(screen.getByTestId("viewer-page")).toBeInTheDocument();
    expect(screen.getAllByTestId("shell")).toHaveLength(1);
    expect(shellMounts.count).toBe(1);
  });
});
