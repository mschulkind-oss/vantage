import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import axios from "axios";
import { SettingsDropdown } from "./SettingsDropdown";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

/**
 * Let the colour theme's stylesheet load. Every theme is a `<link>` now, and
 * jsdom fetches nothing, so the event a browser fires has to be fired here.
 */
async function loadThemeLink() {
  const links = () =>
    Array.from(document.head.querySelectorAll<HTMLLinkElement>("link"));
  await waitFor(() => expect(links().length).toBeGreaterThan(0));
  links()[links().length - 1].dispatchEvent(new Event("load"));
}

function renderDropdown() {
  return render(
    <SettingsDropdown
      showEmptyDirs={true}
      onShowEmptyDirsChange={vi.fn()}
      showHidden={true}
      onShowHiddenChange={vi.fn()}
      showGitignored={true}
      onShowGitignoredChange={vi.fn()}
      keyboardShortcutsEnabled={true}
      onKeyboardShortcutsEnabledChange={vi.fn()}
    />,
  );
}

describe("SettingsDropdown", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    localStorage.clear();
    mockedAxios.get.mockResolvedValue({ data: { default: "", themes: [] } });
  });

  afterEach(() => {
    document.head.querySelectorAll("link").forEach((l) => l.remove());
    document.documentElement.removeAttribute("data-vantage-theme");
  });

  it("renders settings button", () => {
    render(
      <SettingsDropdown
        showEmptyDirs={true}
        onShowEmptyDirsChange={vi.fn()}
        showHidden={true}
        onShowHiddenChange={vi.fn()}
        showGitignored={true}
        onShowGitignoredChange={vi.fn()}
        keyboardShortcutsEnabled={true}
        onKeyboardShortcutsEnabledChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Settings")).toBeInTheDocument();
  });

  it("opens dropdown on click", () => {
    render(
      <SettingsDropdown
        showEmptyDirs={true}
        onShowEmptyDirsChange={vi.fn()}
        showHidden={true}
        onShowHiddenChange={vi.fn()}
        showGitignored={true}
        onShowGitignoredChange={vi.fn()}
        keyboardShortcutsEnabled={true}
        onKeyboardShortcutsEnabledChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Keyboard")).toBeInTheDocument();
    expect(screen.getByText("File Tree")).toBeInTheDocument();
    expect(screen.getByText("Show all folders")).toBeInTheDocument();
    expect(screen.getByText("Show hidden files")).toBeInTheDocument();
    expect(screen.getByText("Show gitignored files")).toBeInTheDocument();
    expect(screen.getByText("Enable shortcuts")).toBeInTheDocument();
  });

  it("toggles show empty dirs", () => {
    const onChange = vi.fn();
    render(
      <SettingsDropdown
        showEmptyDirs={false}
        onShowEmptyDirsChange={onChange}
        showHidden={true}
        onShowHiddenChange={vi.fn()}
        showGitignored={true}
        onShowGitignoredChange={vi.fn()}
        keyboardShortcutsEnabled={true}
        onKeyboardShortcutsEnabledChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Settings"));
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("switches to dark theme", () => {
    render(
      <SettingsDropdown
        showEmptyDirs={true}
        onShowEmptyDirsChange={vi.fn()}
        showHidden={true}
        onShowHiddenChange={vi.fn()}
        showGitignored={true}
        onShowGitignoredChange={vi.fn()}
        keyboardShortcutsEnabled={true}
        onKeyboardShortcutsEnabledChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(screen.getByText("Dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("vantage:theme")).toBe("dark");
  });

  it("switches to light theme", () => {
    document.documentElement.classList.add("dark");
    localStorage.setItem("vantage:theme", "dark");
    render(
      <SettingsDropdown
        showEmptyDirs={true}
        onShowEmptyDirsChange={vi.fn()}
        showHidden={true}
        onShowHiddenChange={vi.fn()}
        showGitignored={true}
        onShowGitignoredChange={vi.fn()}
        keyboardShortcutsEnabled={true}
        onKeyboardShortcutsEnabledChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(screen.getByText("Light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("vantage:theme")).toBe("light");
  });

  it("closes on Escape", () => {
    render(
      <SettingsDropdown
        showEmptyDirs={true}
        onShowEmptyDirsChange={vi.fn()}
        showHidden={true}
        onShowHiddenChange={vi.fn()}
        showGitignored={true}
        onShowGitignoredChange={vi.fn()}
        keyboardShortcutsEnabled={true}
        onKeyboardShortcutsEnabledChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByText("Theme")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Theme")).not.toBeInTheDocument();
  });

  it("toggles keyboard shortcuts setting", () => {
    const onKeyboardShortcutsEnabledChange = vi.fn();
    render(
      <SettingsDropdown
        showEmptyDirs={true}
        onShowEmptyDirsChange={vi.fn()}
        showHidden={true}
        onShowHiddenChange={vi.fn()}
        showGitignored={true}
        onShowGitignoredChange={vi.fn()}
        keyboardShortcutsEnabled={false}
        onKeyboardShortcutsEnabledChange={onKeyboardShortcutsEnabledChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Settings"));
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    expect(onKeyboardShortcutsEnabledChange).toHaveBeenCalledWith(true);
  });

  describe("colour theme picker", () => {
    it("lists the built-ins and the server's user themes when opened", async () => {
      mockedAxios.get.mockResolvedValue({
        data: { default: "", themes: [{ id: "nord", name: "nord" }] },
      });
      renderDropdown();
      fireEvent.click(screen.getByLabelText("Settings"));
      const select = screen.getByLabelText("Colours") as HTMLSelectElement;
      await waitFor(() =>
        expect(Array.from(select.options).map((o) => o.value)).toEqual([
          "default",
          "catppuccin",
          "lila",
          "nord",
        ]),
      );
      expect(select.value).toBe("default");
      expect(mockedAxios.get).toHaveBeenCalledWith("/api/themes");
    });

    it("shows the active theme", async () => {
      document.documentElement.setAttribute("data-vantage-theme", "catppuccin");
      renderDropdown();
      fireEvent.click(screen.getByLabelText("Settings"));
      expect(
        (screen.getByLabelText("Colours") as HTMLSelectElement).value,
      ).toBe("catppuccin");
    });

    it("keeps the applied theme selectable when the list lacks it", async () => {
      // A user theme is in effect, but the server cannot be reached, so the
      // list is the built-ins only.
      document.documentElement.setAttribute("data-vantage-theme", "nord");
      mockedAxios.get.mockRejectedValue(new Error("network"));
      renderDropdown();
      fireEvent.click(screen.getByLabelText("Settings"));
      const select = screen.getByLabelText("Colours") as HTMLSelectElement;
      await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());
      expect(Array.from(select.options).map((o) => o.value)).toEqual([
        "default",
        "catppuccin",
        "lila",
        "nord",
      ]);
      expect(select.value).toBe("nord");

      // So "Vantage" is a real change, and returns to the built-in look.
      fireEvent.change(select, { target: { value: "default" } });
      await waitFor(() =>
        expect(
          document.documentElement.hasAttribute("data-vantage-theme"),
        ).toBe(false),
      );
    });

    it("applies and remembers a choice, leaving light/dark alone", async () => {
      document.documentElement.classList.add("dark");
      localStorage.setItem("vantage:theme", "dark");
      renderDropdown();
      fireEvent.click(screen.getByLabelText("Settings"));
      fireEvent.change(screen.getByLabelText("Colours"), {
        target: { value: "catppuccin" },
      });
      await loadThemeLink();
      await waitFor(() =>
        expect(
          document.documentElement.getAttribute("data-vantage-theme"),
        ).toBe("catppuccin"),
      );
      expect(localStorage.getItem("vantage:colorTheme")).toBe("catppuccin");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(localStorage.getItem("vantage:theme")).toBe("dark");
    });

    it("marks a theme with no dark half, so dark mode is not a surprise", async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          default: "",
          repo_defaults: {},
          themes: [
            { id: "daylight", name: "daylight", has_dark: false },
            { id: "nord", name: "nord", has_dark: true },
          ],
        },
      });
      renderDropdown();
      fireEvent.click(screen.getByLabelText("Settings"));
      const select = screen.getByLabelText("Colours") as HTMLSelectElement;
      await waitFor(() =>
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
          "Vantage",
          "Catppuccin",
          "Lila",
          "daylight (light only)",
          "nord",
        ]),
      );
    });

    it("says nothing about a theme the list never described", async () => {
      // A user theme is in effect but the server cannot be reached, so its
      // option is synthesised — and a "(light only)" guess about a file this
      // list has not seen would be worse than no claim at all.
      document.documentElement.setAttribute("data-vantage-theme", "nord");
      mockedAxios.get.mockRejectedValue(new Error("network"));
      renderDropdown();
      fireEvent.click(screen.getByLabelText("Settings"));
      const select = screen.getByLabelText("Colours") as HTMLSelectElement;
      await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());
      expect(
        Array.from(select.options).find((o) => o.value === "nord")?.textContent,
      ).toBe("nord");
    });
  });
});
