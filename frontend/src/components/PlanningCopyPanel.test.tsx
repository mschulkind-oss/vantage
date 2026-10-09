/**
 * Copy answers + maintenance's button and panel
 * (`docs/reference/planning-index.md` §6.7): when the panel opens and
 * closes, what it says, the checkboxes remembered in this browser, the
 * button's count, and when it is greyed out.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOSE_MS,
  COPY_PANEL_SENTENCE,
  OPEN_MS,
  PlanningCopyPanel,
} from "./PlanningCopyPanel";
import { readPreference } from "../lib/preferences";

const COUNTS = new Map([
  ["unrouted", 3],
  ["disagrees", 1],
  ["compact", 3],
  ["graduate", 2],
  ["ready", 4],
]);

let copied: string[][];
const onCopy = vi.fn(async (kinds: readonly string[]) => {
  copied.push([...kinds]);
  return true;
});

function renderPanel(
  props: Partial<React.ComponentProps<typeof PlanningCopyPanel>> = {},
) {
  return render(
    <div>
      <p data-testid="elsewhere">Elsewhere</p>
      <PlanningCopyPanel
        answers={3}
        known
        counts={COUNTS}
        onCopy={onCopy}
        {...props}
      />
    </div>,
  );
}

const button = () =>
  screen.getByRole("button", { name: /^Copy answers \+ maintenance / });
const toggle = () =>
  screen.getByRole("button", {
    name: "Choose what Copy answers + maintenance copies",
  });
const panel = () =>
  screen.queryByRole("group", {
    name: "What Copy answers + maintenance copies",
  });
const root = () =>
  document.querySelector<HTMLElement>("[data-planning-copy-maintenance]")!;
const row = (id: string) =>
  document.querySelector<HTMLElement>(`[data-copy-row="${id}"]`)!;

const enter = (el: HTMLElement) =>
  fireEvent.pointerEnter(el, { pointerType: "mouse" });
const leave = (el: HTMLElement) =>
  fireEvent.pointerLeave(el, { pointerType: "mouse" });
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  copied = [];
  onCopy.mockClear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe("the panel opens on hover", () => {
  beforeEach(() => vi.useFakeTimers());

  it("after the pointer has rested on the button for 200 ms, not before", () => {
    renderPanel();
    enter(root());
    wait(OPEN_MS - 1);
    expect(panel()).toBeNull();
    wait(1);
    expect(panel()).not.toBeNull();
  });

  it("not for a pointer that only passes", () => {
    renderPanel();
    enter(root());
    wait(OPEN_MS / 2);
    leave(root());
    wait(OPEN_MS);
    expect(panel()).toBeNull();
  });

  it("stays while the pointer is on the button or the panel, and closes 300 ms after it leaves both", () => {
    renderPanel();
    enter(root());
    wait(OPEN_MS);
    // Onto the panel, which is inside the same box: no leave.
    fireEvent.pointerMove(panel()!, { pointerType: "mouse" });
    wait(1000);
    expect(panel()).not.toBeNull();
    leave(root());
    wait(CLOSE_MS - 1);
    expect(panel()).not.toBeNull();
    // Back before it closes: it stays.
    enter(root());
    wait(CLOSE_MS);
    expect(panel()).not.toBeNull();
    leave(root());
    wait(CLOSE_MS);
    expect(panel()).toBeNull();
  });

  it("never for a touch, where a tap is no hover", () => {
    renderPanel();
    fireEvent.pointerEnter(root(), { pointerType: "touch" });
    wait(OPEN_MS * 2);
    expect(panel()).toBeNull();
  });
});

describe("the ▾", () => {
  it("opens the panel on a click, and a second click closes it", () => {
    renderPanel();
    fireEvent.click(toggle(), { detail: 1 });
    expect(panel()).not.toBeNull();
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle(), { detail: 1 });
    expect(panel()).toBeNull();
  });

  it("opens it on ↓, and on Enter or Space (a click with no pointer), with the focus in it", () => {
    renderPanel();
    toggle().focus();
    fireEvent.keyDown(toggle(), { key: "ArrowDown" });
    expect(panel()).not.toBeNull();
    expect(panel()!.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(toggle());
    // Enter and Space on a button are a click whose detail is 0.
    fireEvent.click(toggle(), { detail: 0 });
    expect(panel()).not.toBeNull();
    expect(panel()!.contains(document.activeElement)).toBe(true);
  });

  it("never takes the focus into a panel hover opens, after Enter closed it from the ▾", () => {
    vi.useFakeTimers();
    renderPanel();
    toggle().focus();
    fireEvent.keyDown(toggle(), { key: "ArrowDown" });
    expect(panel()).not.toBeNull();
    toggle().focus();
    // Enter on the ▾ is a click with no pointer: it closes the panel.
    fireEvent.click(toggle(), { detail: 0 });
    expect(panel()).toBeNull();
    enter(root());
    wait(OPEN_MS);
    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it("never takes the focus into a panel hover opens, after ↓ on a panel already open", () => {
    vi.useFakeTimers();
    renderPanel();
    fireEvent.click(toggle(), { detail: 1 });
    toggle().focus();
    fireEvent.keyDown(toggle(), { key: "ArrowDown" });
    toggle().focus();
    fireEvent.click(toggle(), { detail: 1 });
    expect(panel()).toBeNull();
    enter(root());
    wait(OPEN_MS);
    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it("is never opened by the focus alone", () => {
    renderPanel();
    toggle().focus();
    button().focus();
    expect(panel()).toBeNull();
  });

  it("closes on a press elsewhere", () => {
    renderPanel();
    fireEvent.click(toggle(), { detail: 1 });
    fireEvent.mouseDown(screen.getByTestId("elsewhere"));
    expect(panel()).toBeNull();
  });

  it("keeps a panel hover opened, once pressed", () => {
    vi.useFakeTimers();
    renderPanel();
    enter(root());
    wait(OPEN_MS);
    fireEvent.click(toggle(), { detail: 1 });
    leave(root());
    wait(CLOSE_MS * 2);
    expect(panel()).not.toBeNull();
  });
});

describe("what the panel says", () => {
  it("reads the sentence, All · None, Your answers without a checkbox, each kind, and the total", () => {
    renderPanel();
    fireEvent.click(toggle(), { detail: 1 });
    expect(panel()).toHaveTextContent(COPY_PANEL_SENTENCE);
    expect(row("answers")).toHaveTextContent(/^Your answers3$/);
    expect(row("answers").querySelector("input")).toBeNull();
    expect(
      ["unrouted", "disagrees", "compact", "graduate", "ready"].map(
        (id) => row(id).textContent,
      ),
    ).toEqual([
      "Not on a roadmap3",
      "Stage conflict1",
      "To fold into the ledger3",
      "Ready to graduate2",
      "Ready to build4",
    ]);
    expect(row("total")).toHaveTextContent(/^Copied12$/);
  });

  it("keeps a kind with nothing in it, at 0, with its checkbox", () => {
    renderPanel({ counts: new Map([["unrouted", 2]]) });
    fireEvent.click(toggle(), { detail: 1 });
    expect(row("graduate")).toHaveTextContent("Ready to graduate0");
    expect(row("graduate").querySelector("input")).toBeChecked();
  });

  it("follows the counts it is given, live", () => {
    const view = renderPanel();
    fireEvent.click(toggle(), { detail: 1 });
    view.rerender(
      <div>
        <p data-testid="elsewhere">Elsewhere</p>
        <PlanningCopyPanel
          answers={4}
          known
          counts={new Map([...COUNTS, ["compact", 5]])}
          onCopy={onCopy}
        />
      </div>,
    );
    expect(row("compact")).toHaveTextContent("To fold into the ledger5");
    expect(row("total")).toHaveTextContent(/^Copied15$/);
    expect(screen.getByTestId("copy-maintenance-count")).toHaveTextContent(
      "15",
    );
  });
});

describe("the checkboxes", () => {
  it("leave Ready to build out until it is checked, and the count follows", () => {
    renderPanel();
    expect(screen.getByTestId("copy-maintenance-count")).toHaveTextContent(
      "12",
    );
    fireEvent.click(toggle(), { detail: 1 });
    expect(row("ready").querySelector("input")).not.toBeChecked();
    fireEvent.click(row("ready").querySelector("input")!);
    expect(screen.getByTestId("copy-maintenance-count")).toHaveTextContent(
      "16",
    );
  });

  it("are one preference in this browser, kept for the next visit", () => {
    renderPanel();
    fireEvent.click(toggle(), { detail: 1 });
    fireEvent.click(row("compact").querySelector("input")!);
    expect(readPreference("vantage:planningCopyLeftOut")).toBe("compact,ready");
    cleanup();
    renderPanel();
    fireEvent.click(toggle(), { detail: 1 });
    expect(row("compact").querySelector("input")).not.toBeChecked();
    expect(row("unrouted").querySelector("input")).toBeChecked();
  });

  it("are all checked by All and none by None", () => {
    renderPanel();
    fireEvent.click(toggle(), { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(readPreference("vantage:planningCopyLeftOut")).toBe("");
    expect(row("total")).toHaveTextContent(/^Copied16$/);
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(panel()!.querySelectorAll("input:checked")).toHaveLength(0);
  });
});

describe("the button", () => {
  it("copies the answers and the checked kinds", async () => {
    renderPanel();
    await act(async () => {
      fireEvent.click(button());
    });
    expect(copied).toEqual([["unrouted", "disagrees", "compact", "graduate"]]);
    expect(button()).toHaveTextContent(/^Copied/);
    expect(button()).toHaveAccessibleName("Copy answers + maintenance 12");
  });

  it("is greyed out, not disabled, with no kind checked, and its ▾ still opens the panel", async () => {
    renderPanel();
    fireEvent.click(toggle(), { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(button()).toHaveAttribute("aria-disabled", "true");
    expect(button()).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(button());
    });
    expect(copied).toEqual([]);
    fireEvent.mouseDown(document.body);
    fireEvent.click(toggle(), { detail: 1 });
    expect(panel()).not.toBeNull();
  });

  it("is greyed out while what it copies is not ready, and copies nothing", async () => {
    renderPanel({ ready: false });
    expect(button()).toHaveAttribute("aria-disabled", "true");
    await act(async () => {
      fireEvent.click(button());
    });
    expect(copied).toEqual([]);
  });

  it("is greyed out when its total is 0", () => {
    renderPanel({ answers: 0, counts: new Map() });
    expect(button()).toHaveAttribute("aria-disabled", "true");
  });

  it("is greyed out, and counts –, until the answers are counted", () => {
    renderPanel({ known: false });
    expect(button()).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("copy-maintenance-count")).toHaveTextContent("–");
  });
});
