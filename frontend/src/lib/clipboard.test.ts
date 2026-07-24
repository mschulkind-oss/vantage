import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, copyTextOrWarn, showCopyError } from "./clipboard";

// jsdom does not implement document.execCommand, so define a mockable stub the
// fallback path can call.
function stubExecCommand(result: boolean): ReturnType<typeof vi.fn> {
  const exec = vi.fn().mockReturnValue(result);
  Object.assign(document, { execCommand: exec });
  return exec;
}

describe("copyText", () => {
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    Object.assign(navigator, { clipboard: originalClipboard });
    vi.restoreAllMocks();
  });

  it("uses the async Clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const ok = await copyText("hello");

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when navigator.clipboard is undefined", async () => {
    // Non-secure context: the API isn't defined at all.
    Object.assign(navigator, { clipboard: undefined });
    const exec = stubExecCommand(true);

    const ok = await copyText("plain http");

    expect(ok).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("falls back to execCommand when the async API rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    const exec = stubExecCommand(true);

    const ok = await copyText("retry");

    expect(ok).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("reports failure when both paths fail", async () => {
    Object.assign(navigator, { clipboard: undefined });
    stubExecCommand(false);

    const ok = await copyText("nope");

    expect(ok).toBe(false);
  });
});

describe("copyTextOrWarn", () => {
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    Object.assign(navigator, { clipboard: originalClipboard });
    document.getElementById("copy-error-toast")?.remove();
    vi.restoreAllMocks();
  });

  it("shows a guidance toast when the copy fails", async () => {
    Object.assign(navigator, { clipboard: undefined });
    stubExecCommand(false);

    const ok = await copyTextOrWarn("nope");

    expect(ok).toBe(false);
    const toast = document.getElementById("copy-error-toast");
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toMatch(/HTTPS|tunnel/i);
  });

  it("shows no toast on success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const ok = await copyTextOrWarn("ok");

    expect(ok).toBe(true);
    expect(document.getElementById("copy-error-toast")).toBeNull();
  });
});

describe("showCopyError", () => {
  afterEach(() => {
    document.getElementById("copy-error-toast")?.remove();
  });

  it("replaces a prior toast rather than stacking", () => {
    showCopyError();
    showCopyError();
    expect(document.querySelectorAll("#copy-error-toast")).toHaveLength(1);
  });
});
