import { describe, expect, it, vi } from "vitest";
import html from "../../index.html?raw";

describe("startup without the app bundle", () => {
  it("shows a readable loading message and a working reload action", () => {
    const document = new DOMParser().parseFromString(html, "text/html");
    const root = document.getElementById("root")!;
    expect(root.textContent).toContain("Loading Vantage");
    expect(root.textContent).toContain("If loading doesn't finish");
    const button = root.querySelector("button")!;
    expect(button).not.toBeNull();
    expect(button.textContent?.trim()).toBe("Reload this page");
    expect(button.type).toBe("button");

    // This action must work even when no external JavaScript loads, and reload
    // rather than navigating away from the current path, query, or fragment.
    const reload = vi.fn();
    const click = new Function("window", button.getAttribute("onclick")!);
    click({ location: { reload } });
    expect(reload).toHaveBeenCalledOnce();
    expect(root.querySelector("script, link")).toBeNull();
  });

  it("explains how to proceed when JavaScript is disabled", () => {
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelector("noscript")?.textContent).toContain(
      "Enable JavaScript",
    );
  });
});
