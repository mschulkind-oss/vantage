import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { indexOf } from "../test/planning";
import { loadWorkHistory } from "./workHistory";

const { isStaticMode } = vi.hoisted(() => ({ isStaticMode: vi.fn() }));
vi.mock("./staticMode", () => ({ isStaticMode }));

const snapshots = {
  status: "complete" as const,
  commits_examined: 2,
  truncated: false,
  snapshots: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
  isStaticMode.mockReturnValue(false);
  vi.spyOn(axios, "get").mockResolvedValue({ data: snapshots });
});

describe("loadWorkHistory", () => {
  it("makes one selected-repository batch request and preserves completeness", async () => {
    const result = await loadWorkHistory("team #1", true, indexOf({}));
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledWith(
      "/api/r/team%20%231/git/planning-snapshots",
    );
    expect(result).toMatchObject({
      status: "complete",
      commitsExamined: 2,
      events: [],
    });
  });

  it("reports transport and response failures as unavailable rather than an empty complete feed", async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error("offline"));
    const failed = await loadWorkHistory("", false, indexOf({}));
    expect(failed.status).toBe("unavailable");
    expect(failed.reason).toContain("could not be loaded");

    vi.mocked(axios.get).mockResolvedValueOnce({ data: { snapshots: [] } });
    const malformed = await loadWorkHistory("", false, indexOf({}));
    expect(malformed.status).toBe("unavailable");
    expect(malformed.reason).toContain("invalid Git history response");

    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        ...snapshots,
        status: "partial",
        truncated: true,
        reason: "bounded",
        snapshots: [{ path: "../escape.md" }],
      },
    });
    const invalidPair = await loadWorkHistory("", false, indexOf({}));
    expect(invalidPair.status).toBe("unavailable");
    expect(invalidPair.reason).toContain("invalid Git history response");
  });

  it("does not request a static endpoint and keeps its no-history reason", async () => {
    isStaticMode.mockReturnValue(true);
    const result = await loadWorkHistory(
      "",
      false,
      indexOf({
        "docs/metadata.md":
          "---\nstage: DECIDED\nstage-since: 2026-03-01\n---\n",
      }),
      new Date("2026-03-02T00:00:00Z"),
    );
    expect(axios.get).not.toHaveBeenCalled();
    expect(result.status).toBe("unavailable");
    expect(result.events).toMatchObject([
      { path: "docs/metadata.md", source: "document-metadata", to: "DECIDED" },
    ]);
  });

  it("retains partial status and the server's bound explanation", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        ...snapshots,
        status: "partial",
        truncated: true,
        reason: "50-commit limit",
      },
    });
    const result = await loadWorkHistory("", false, indexOf({}));
    expect(result).toMatchObject({
      status: "partial",
      truncated: true,
      reason: "50-commit limit",
    });
  });
});
