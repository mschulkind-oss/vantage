import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import axios from "axios";
import { SettingsDropdown } from "./SettingsDropdown";
import {
  applyColorTheme,
  builtInColorThemes,
  followColorTheme,
} from "../lib/colorTheme";
import { toggleColorMode } from "../lib/darkMode";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

/**
 * Let the color theme's stylesheet load. Every theme is a `<link>` now, and
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

  describe("color theme picker", () => {
    it("lists the built-ins and the server's user themes when opened", async () => {
      mockedAxios.get.mockResolvedValue({
        data: { default: "", themes: [{ id: "ocean", name: "ocean" }] },
      });
      renderDropdown();
      fireEvent.click(screen.getByLabelText("Settings"));
      const select = screen.getByLabelText("Colors") as HTMLSelectElement;
      await waitFor(() =>
        expect(Array.from(select.options).map((o) => o.value)).toEqual([
          ...builtInColorThemes().map((t) => t.id),
          "ocean",
        ]),
      );
      expect(select.value).toBe("default");
      expect(mockedAxios.get).toHaveBeenCalledWith("/api/themes");
    });

    it("shows the active theme", async () => {
      document.documentElement.setAttribute("data-vantage-theme", "catppuccin");
      renderDropdown();
      fireEvent.click(screen.getByLabelText("Settings"));
      expect((screen.getByLabelText("Colors") as HTMLSelectElement).value).toBe(
        "catppuccin",
      );
    });

    it("keeps the applied theme selectable when the list lacks it", async () => {
      // A user theme is in effect, but the server cannot be reached, so the
      // list is the built-ins only.
      document.documentElement.setAttribute("data-vantage-theme", "ocean");
      mockedAxios.get.mockRejectedValue(new Error("network"));
      renderDropdown();
      fireEvent.click(screen.getByLabelText("Settings"));
      const select = screen.getByLabelText("Colors") as HTMLSelectElement;
      await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());
      expect(Array.from(select.options).map((o) => o.value)).toEqual([
        ...builtInColorThemes().map((t) => t.id),
        "ocean",
      ]);
      expect(select.value).toBe("ocean");

      // So "Slate" is a real change, and returns to the built-in look.
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
      fireEvent.change(screen.getByLabelText("Colors"), {
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

    it("moves when another tab picks a theme, which is the whole point", async () => {
      const stop = followColorTheme();
      renderDropdown();
      fireEvent.click(screen.getByLabelText("Settings"));
      const select = screen.getByLabelText("Colors") as HTMLSelectElement;
      expect(select.value).toBe("default");

      localStorage.setItem("vantage:colorTheme", "catppuccin");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "vantage:colorTheme",
          newValue: "catppuccin",
          storageArea: localStorage,
        }),
      );
      await loadThemeLink();

      await waitFor(() => expect(select.value).toBe("catppuccin"));
      stop();
    });

    it("still names the old theme while a new sheet is loading", async () => {
      // Not a missing optimistic update: until the stylesheet is live the reader
      // is still looking at the previous palette, and saying otherwise would
      // name colors that are not on the page.
      // Not awaited before the link loads: `applyColorTheme` resolves *in* that
      // load handler, so awaiting it first would deadlock the test.
      const applied = applyColorTheme(builtInColorThemes()[1]);
      await loadThemeLink();
      await applied;
      renderDropdown();
      fireEvent.click(screen.getByLabelText("Settings"));
      const select = screen.getByLabelText("Colors") as HTMLSelectElement;
      expect(select.value).toBe("catppuccin");

      fireEvent.change(select, { target: { value: "gruvbox" } });

      expect(select.value).toBe("catppuccin");
      await loadThemeLink();
      await waitFor(() => expect(select.value).toBe("gruvbox"));
    });

    it("never names a theme whose stylesheet failed to load", async () => {
      mockedAxios.get.mockResolvedValue({
        data: { default: "", themes: [{ id: "ocean", name: "ocean" }] },
      });
      renderDropdown();
      fireEvent.click(screen.getByLabelText("Settings"));
      const select = screen.getByLabelText("Colors") as HTMLSelectElement;
      await waitFor(() =>
        expect(Array.from(select.options).map((o) => o.value)).toContain(
          "ocean",
        ),
      );

      vi.spyOn(console, "warn").mockImplementation(() => {});
      fireEvent.change(select, { target: { value: "ocean" } });
      const links = () =>
        Array.from(document.head.querySelectorAll<HTMLLinkElement>("link"));
      await waitFor(() => expect(links().length).toBeGreaterThan(0));
      links()[links().length - 1].dispatchEvent(new Event("error"));

      await waitFor(() =>
        expect(localStorage.getItem("vantage:colorTheme")).toBeNull(),
      );
      expect(select.value).toBe("default");
    });

    it("marks a theme with no dark half, so dark mode is not a surprise", async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          default: "",
          repo_defaults: {},
          themes: [
            { id: "daylight", name: "daylight", has_dark: false },
            { id: "ocean", name: "ocean", has_dark: true },
          ],
        },
      });
      renderDropdown();
      fireEvent.click(screen.getByLabelText("Settings"));
      const select = screen.getByLabelText("Colors") as HTMLSelectElement;
      await waitFor(() =>
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
          ...builtInColorThemes().map((t) => t.name),
          "daylight (light only)",
          "ocean",
        ]),
      );
    });

    it("says nothing about a theme the list never described", async () => {
      // A user theme is in effect but the server cannot be reached, so its
      // option is synthesized — and a "(light only)" guess about a file this
      // list has not seen would be worse than no claim at all.
      document.documentElement.setAttribute("data-vantage-theme", "ocean");
      mockedAxios.get.mockRejectedValue(new Error("network"));
      renderDropdown();
      fireEvent.click(screen.getByLabelText("Settings"));
      const select = screen.getByLabelText("Colors") as HTMLSelectElement;
      await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());
      expect(
        Array.from(select.options).find((o) => o.value === "ocean")
          ?.textContent,
      ).toBe("ocean");
    });
  });
});

/**
 * The bug the Light/Dark tests above could not see, because they only ever
 * clicked: the menu used to keep its own `useState` copy of the mode, so Shift+D
 * changed the page and left the buttons showing the mode the reader had just
 * left. The mode is now subscribed rather than copied, and these are the two
 * writers it has to hear.
 */
describe("the mode the buttons show", () => {
  const darkButton = () => screen.getByText("Dark").closest("button")!;

  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    localStorage.clear();
    mockedAxios.get.mockResolvedValue({ data: { default: "", themes: [] } });
  });

  it("follows Shift+D in this tab", () => {
    renderDropdown();
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(darkButton()).not.toHaveClass("bg-slate-700");

    act(() => toggleColorMode());

    expect(darkButton()).toHaveClass("bg-slate-700");
  });

  it("follows another tab's switch", () => {
    renderDropdown();
    fireEvent.click(screen.getByLabelText("Settings"));

    act(() => {
      localStorage.setItem("vantage:theme", "dark");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "vantage:theme",
          newValue: "dark",
          storageArea: localStorage,
        }),
      );
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(darkButton()).toHaveClass("bg-slate-700");
  });
});
