import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppLink } from "./AppLink";
import { BrowserRouter } from "react-router-dom";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("AppLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter>{ui}</BrowserRouter>);
  };

  it("renders an <a> tag with correct href", () => {
    renderWithRouter(<AppLink to="/docs/readme.md">Link Text</AppLink>);
    const link = screen.getByText("Link Text");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/docs/readme.md");
  });

  // In a static export the route is the URL's fragment: a path-style href is
  // a file the host does not have, so "Copy link" and a middle-click opened
  // the export's front page, or nothing at all, instead of the document.
  it("writes the hash route in a static export, and navigates by route", () => {
    window.__VANTAGE_STATIC__ = true;
    try {
      renderWithRouter(<AppLink to="/docs/readme.md">Link</AppLink>);
      const link = screen.getByText("Link");
      expect(link).toHaveAttribute("href", "#/docs/readme.md");
      fireEvent.click(link);
      expect(mockNavigate).toHaveBeenCalledWith("/docs/readme.md");
    } finally {
      delete window.__VANTAGE_STATIC__;
    }
  });

  it("uses SPA navigation on normal click", () => {
    renderWithRouter(<AppLink to="/docs/readme.md">Link</AppLink>);
    fireEvent.click(screen.getByText("Link"));
    expect(mockNavigate).toHaveBeenCalledWith("/docs/readme.md");
  });

  it("does not intercept Ctrl+click", () => {
    renderWithRouter(<AppLink to="/docs/readme.md">Link</AppLink>);
    fireEvent.click(screen.getByText("Link"), { ctrlKey: true });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not intercept Meta+click (Cmd on Mac)", () => {
    renderWithRouter(<AppLink to="/docs/readme.md">Link</AppLink>);
    fireEvent.click(screen.getByText("Link"), { metaKey: true });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not intercept Shift+click", () => {
    renderWithRouter(<AppLink to="/docs/readme.md">Link</AppLink>);
    fireEvent.click(screen.getByText("Link"), { shiftKey: true });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not intercept middle mouse button", () => {
    renderWithRouter(<AppLink to="/docs/readme.md">Link</AppLink>);
    fireEvent.click(screen.getByText("Link"), { button: 1 });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // A link meant for another tab is the browser's to follow. Navigating this
  // tab as well would take the reader's page away as the new tab opens.
  it("leaves a target=_blank link to the browser, and navigates nothing here", () => {
    const onBefore = vi.fn();
    renderWithRouter(
      <AppLink
        to="/docs/readme.md"
        target="_blank"
        rel="noopener noreferrer"
        onBeforeNavigate={onBefore}
      >
        Link
      </AppLink>,
    );
    const link = screen.getByText("Link");
    expect(link).toHaveAttribute("href", "/docs/readme.md");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // Not prevented: the browser opens the new tab.
    expect(fireEvent.click(link)).toBe(true);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(onBefore).not.toHaveBeenCalled();
  });

  it("navigates this tab by route for target=_self, as with no target", () => {
    renderWithRouter(
      <AppLink to="/docs/readme.md" target="_self">
        Link
      </AppLink>,
    );
    expect(fireEvent.click(screen.getByText("Link"))).toBe(false);
    expect(mockNavigate).toHaveBeenCalledWith("/docs/readme.md");
  });

  it("calls onBeforeNavigate before navigating", () => {
    const onBefore = vi.fn();
    renderWithRouter(
      <AppLink to="/path" onBeforeNavigate={onBefore}>
        Link
      </AppLink>,
    );
    fireEvent.click(screen.getByText("Link"));
    expect(onBefore).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/path");
  });

  it("prevents navigation when onBeforeNavigate returns false", () => {
    const onBefore = vi.fn(() => false);
    renderWithRouter(
      <AppLink to="/path" onBeforeNavigate={onBefore}>
        Link
      </AppLink>,
    );
    fireEvent.click(screen.getByText("Link"));
    expect(onBefore).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("passes through extra HTML attributes", () => {
    renderWithRouter(
      <AppLink to="/path" className="custom-class" title="tooltip">
        Link
      </AppLink>,
    );
    const link = screen.getByText("Link");
    expect(link).toHaveClass("custom-class");
    expect(link).toHaveAttribute("title", "tooltip");
  });
});
