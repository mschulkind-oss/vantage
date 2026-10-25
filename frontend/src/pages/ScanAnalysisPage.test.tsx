import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScanAnalysisPage } from "./ScanAnalysisPage";
import { ShellContext, type ShellContextValue } from "../hooks/useShellPage";
import { useRepoStore } from "../stores/useRepoStore";
import type { ScanAnalysisResponse } from "../types/scanAnalysis";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);
const realRefreshTree = useRepoStore.getState().refreshTree;
const refreshTreeForTest = vi.fn(async () => {});

const LONG_EXAMPLE_BASENAME = `${"x".repeat(200)}.md`;
const LONG_EXAMPLE_PATH = `build/cache/${LONG_EXAMPLE_BASENAME}`;

const evidenceResponse: ScanAnalysisResponse = {
  evidence: {
    command: "git ls-files -co --exclude-standard",
    elapsedMs: 2500,
    timeoutMs: 2000,
    gitignored: false,
    timedOut: true,
    directory: "docs/generated",
    error: "walk exceeded configured timeout",
    unknown_failures: 3,
    settings: {
      show_hidden: true,
      use_ignore_files: false,
      exclude_dir_count: 4,
      walk_max_depth: 12,
    },
  },
  diagnostic: null,
};
const partialResponse: ScanAnalysisResponse = {
  evidence: evidenceResponse.evidence,
  diagnostic: {
    method: "filesystem_directory_entries_and_readdir_time",
    partial: true,
    reason: "Stopped at the diagnostic time limit.",
    elapsedMs: 900,
    entries: 42,
    directories: [
      {
        path: "build/cache",
        elapsedMs: 310,
        entries: 23,
        examples: [LONG_EXAMPLE_PATH],
      },
    ],
    comparison: {
      status: "partial",
      elapsedMs: 180,
      entries: 9,
      reason: "Comparison stopped at its time limit.",
    },
    recommendations: [
      {
        path: "build/cache",
        reason:
          "Contains generated artifacts and took the most enumeration time.",
        examples: [LONG_EXAMPLE_PATH],
      },
    ],
  },
};

function ScopeSwitcher() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate("/.vantage/scan-analysis/other")}>
      Switch project
    </button>
  );
}

const shellContext: ShellContextValue = {
  controls: {
    sidebarCollapsed: false,
    openSidebar: vi.fn(),
    bannerSpace: 0,
    showGitMetadata: true,
  },
  publish: vi.fn(),
  register: vi.fn(),
};

function renderAt(path: string) {
  return render(
    <ShellContext.Provider value={shellContext}>
      <MemoryRouter initialEntries={[path]}>
        <ScopeSwitcher />
        <Routes>
          <Route
            path="/.vantage/scan-analysis"
            element={<ScanAnalysisPage />}
          />
          <Route
            path="/.vantage/scan-analysis/:repo"
            element={<ScanAnalysisPage />}
          />
          <Route path="*" element={<p>Not analysis</p>} />
        </Routes>
      </MemoryRouter>
    </ShellContext.Provider>,
  );
}

function useMultiRepo() {
  useRepoStore.setState({
    isMultiRepo: true,
    reposLoaded: true,
    repos: [
      { name: "my repo#2", last_activity: null },
      { name: "other", last_activity: null },
    ],
    currentRepo: "not-the-route-project",
  });
}

describe("ScanAnalysisPage", () => {
  beforeEach(() => {
    window.__VANTAGE_STATIC__ = false;
    refreshTreeForTest.mockClear();
    vi.clearAllMocks();
    mockedAxios.get.mockResolvedValue({ data: evidenceResponse });
    mockedAxios.post.mockResolvedValue({ data: partialResponse });
    useRepoStore.setState({
      isMultiRepo: false,
      reposLoaded: true,
      repos: [{ name: "", last_activity: null }],
      currentRepo: null,
      refreshTree: refreshTreeForTest,
    });
  });

  afterEach(() => {
    delete window.__VANTAGE_STATIC__;
    useRepoStore.setState({ refreshTree: realRefreshTree });
  });

  it("reads evidence on open in the route's encoded repo scope and starts diagnostics only on request", async () => {
    useMultiRepo();
    renderAt("/.vantage/scan-analysis/my%20repo%232");
    expect(
      await screen.findByText("git ls-files -co --exclude-standard"),
    ).toBeInTheDocument();
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "/api/r/my%20repo%232/git/scan-analysis",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(useRepoStore.getState().currentRepo).toBe("my repo#2");
    expect(refreshTreeForTest).not.toHaveBeenCalled();
    const snapshotLimits = screen.getByTestId("scan-analysis-snapshot-limits");
    expect(snapshotLimits).toHaveTextContent(
      "The diagnostic ignore-file snapshot is bounded to 1 MiB of combined file bytes, 4,096 lines combined, and 4 KiB per line. The overall 5-second deadline is cooperative, not a hard real-time guarantee; a blocked filesystem call can take longer to return.",
    );
    const runButton = screen.getByRole("button", {
      name: "Run bounded diagnostic",
    });
    expect(
      snapshotLimits.compareDocumentPosition(runButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Run bounded diagnostic" }),
    );
    await screen.findByText("Stopped at the diagnostic time limit.");
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "/api/r/my%20repo%232/git/scan-analysis",
      {},
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText(/Partial result/)).toBeInTheDocument();
    expect(
      screen.getByText("filesystem_directory_entries_and_readdir_time"),
    ).toHaveClass("break-all");
    expect(screen.getByTestId("scan-analysis-directory-examples")).toHaveClass(
      "break-all",
    );
    expect(
      screen.getByTestId("scan-analysis-directory-examples"),
    ).toHaveTextContent(LONG_EXAMPLE_PATH);
    expect(screen.getByTestId("scan-analysis-affected-paths")).toHaveClass(
      "break-all",
    );
    expect(
      screen.getByTestId("scan-analysis-affected-paths"),
    ).toHaveTextContent(LONG_EXAMPLE_PATH);
    expect(
      screen.getByText(
        /Partial comparison: 180 ms · 9 Markdown pathspec matches/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("scan-analysis-ignore-suggestion"),
    ).toHaveTextContent(
      /No .vantageignore rule is offered because recorded.*use_ignore_files is off.*exclude_dirs/,
    );
    expect(screen.getByText(/no ignore file is changed/i)).toBeInTheDocument();
    expect(screen.getByText(/up to 5 seconds/)).toBeInTheDocument();
    expect(screen.getByText(/direct read only/)).toBeInTheDocument();
    expect(
      screen.getByText(/Markdown pathspec matches, not filesystem entries/),
    ).toBeInTheDocument();
    expect(screen.getByText("Show hidden files")).toBeInTheDocument();
    expect(screen.getByText("Affected scan directory")).toBeInTheDocument();
    expect(
      screen.getByText("Recorded command (configured paths redacted)"),
    ).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(
      screen.getByText(/Previous scan error: walk exceeded configured timeout/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Affected untracked, non-gitignored Markdown paths observed/,
      ),
    ).toBeInTheDocument();
  });

  it("renders a completed comparison as measured results", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        ...partialResponse,
        diagnostic: {
          ...partialResponse.diagnostic!,
          partial: false,
          reason: "",
          comparison: {
            status: "completed",
            elapsedMs: 500,
            entries: 17,
            reason: "",
          },
        },
      },
    });
    renderAt("/.vantage/scan-analysis");
    await screen.findByText("git ls-files -co --exclude-standard");
    fireEvent.click(
      screen.getByRole("button", { name: "Run bounded diagnostic" }),
    );
    expect(
      await screen.findByText(
        /Completed: 500 ms · 17 Markdown pathspec matches/,
      ),
    ).toBeInTheDocument();
  });

  it("keeps an unavailable comparison explicitly unknown", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        ...partialResponse,
        diagnostic: {
          ...partialResponse.diagnostic!,
          comparison: {
            status: "unknown",
            elapsedMs: 0,
            entries: 0,
            reason: "Comparison was unavailable.",
          },
        },
      },
    });
    renderAt("/.vantage/scan-analysis");
    await screen.findByText("git ls-files -co --exclude-standard");
    fireEvent.click(
      screen.getByRole("button", { name: "Run bounded diagnostic" }),
    );
    expect(
      await screen.findByText(/Unknown — comparison could not be completed/),
    ).toBeInTheDocument();
    expect(screen.getByText("Comparison was unavailable.")).toBeInTheDocument();
  });

  it("shows an escaped literal-star rule only when ignore files are enabled", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        ...evidenceResponse,
        evidence: {
          ...evidenceResponse.evidence!,
          settings: {
            ...evidenceResponse.evidence!.settings!,
            use_ignore_files: true,
          },
        },
      },
    });
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        ...partialResponse,
        evidence: {
          ...evidenceResponse.evidence!,
          settings: {
            ...evidenceResponse.evidence!.settings!,
            use_ignore_files: true,
          },
        },
        diagnostic: {
          ...partialResponse.diagnostic!,
          recommendations: [
            {
              path: "generated/cache*",
              reason: "Measured directory with non-gitignored Markdown files.",
              examples: ["generated/cache*/report.md"],
            },
          ],
        },
      },
    });
    renderAt("/.vantage/scan-analysis");
    await screen.findByText("git ls-files -co --exclude-standard");
    fireEvent.click(
      screen.getByRole("button", { name: "Run bounded diagnostic" }),
    );
    expect(await screen.findByText("/generated/cache\\*/")).toBeInTheDocument();
    expect(
      screen.getByText(/Affected untracked, non-gitignored Markdown paths/),
    ).toBeInTheDocument();
  });

  it("discloses that every suggested rule can affect unlisted tracked and Gitignored documents", async () => {
    const exactDisclosure =
      "Examples are not exhaustive. This rule can also hide tracked or Gitignored documents in this directory that are not listed above.";
    const recommendations = [
      {
        path: "generated/cache",
        reason: "Measured generated files.",
        examples: ["generated/cache/report.md"],
      },
      {
        path: "vendor/docs",
        reason: "Measured vendored files.",
        examples: ["vendor/docs/guide.md"],
      },
    ];
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        ...evidenceResponse,
        evidence: {
          ...evidenceResponse.evidence!,
          settings: {
            ...evidenceResponse.evidence!.settings!,
            use_ignore_files: true,
          },
        },
      },
    });
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        ...partialResponse,
        evidence: {
          ...evidenceResponse.evidence!,
          settings: {
            ...evidenceResponse.evidence!.settings!,
            use_ignore_files: true,
          },
        },
        diagnostic: {
          ...partialResponse.diagnostic!,
          recommendations,
        },
      },
    });
    renderAt("/.vantage/scan-analysis");
    await screen.findByText("git ls-files -co --exclude-standard");
    fireEvent.click(
      screen.getByRole("button", { name: "Run bounded diagnostic" }),
    );

    const disclosures = await screen.findAllByTestId(
      "scan-analysis-ignore-impact",
    );
    expect(disclosures).toHaveLength(recommendations.length);
    for (const disclosure of disclosures) {
      expect(disclosure).toHaveTextContent(exactDisclosure);
    }
  });

  it.each([
    ["generated/dir /child", "/generated/dir /child/"],
    ["generated/invalid\uFFFDname", "/generated/invalid\uFFFDname/"],
  ])(
    "withholds a copyable rule for an unsafe or lossy path %s",
    async (path, reconstructedRule) => {
      const unsafeResponse: ScanAnalysisResponse = {
        ...partialResponse,
        evidence: {
          ...evidenceResponse.evidence!,
          settings: {
            ...evidenceResponse.evidence!.settings!,
            use_ignore_files: true,
          },
        },
        diagnostic: {
          ...partialResponse.diagnostic!,
          recommendations: [
            {
              path,
              reason: "Contains observed Markdown documents.",
              examples: [`${path}/readme.md`],
            },
          ],
        },
      };
      mockedAxios.post.mockResolvedValueOnce({ data: unsafeResponse });
      renderAt("/.vantage/scan-analysis");
      await screen.findByText("git ls-files -co --exclude-standard");
      fireEvent.click(
        screen.getByRole("button", { name: "Run bounded diagnostic" }),
      );
      const suggestion = await screen.findByTestId(
        "scan-analysis-ignore-suggestion",
      );
      expect(suggestion).toHaveTextContent(
        "A safe literal .vantageignore rule cannot be generated for this name because its reported path may be lossy or unsafe to quote; inspect or rename the directory, or configure a verified exclusion manually.",
      );
      expect(suggestion).not.toHaveTextContent(
        "Suggested repository-root .vantageignore rule",
      );
      expect(screen.queryByText(reconstructedRule)).not.toBeInTheDocument();
      expect(
        screen.getByTestId("scan-analysis-affected-paths"),
      ).toHaveTextContent(`${path}/readme.md`);
    },
  );

  it("withholds a copyable rule for a path the matcher cannot quote literally", async () => {
    const unsafeResponse: ScanAnalysisResponse = {
      ...partialResponse,
      evidence: {
        ...evidenceResponse.evidence!,
        settings: {
          ...evidenceResponse.evidence!.settings!,
          use_ignore_files: true,
        },
      },
      diagnostic: {
        ...partialResponse.diagnostic!,
        recommendations: [
          {
            path: "generated/cache?",
            reason: "Contains observed untracked Markdown documents.",
            examples: ["generated/cache?/readme.md"],
          },
        ],
      },
    };
    mockedAxios.post.mockResolvedValueOnce({ data: unsafeResponse });
    renderAt("/.vantage/scan-analysis");
    await screen.findByText("git ls-files -co --exclude-standard");
    fireEvent.click(
      screen.getByRole("button", { name: "Run bounded diagnostic" }),
    );
    expect(
      await screen.findByTestId("scan-analysis-ignore-suggestion"),
    ).toHaveTextContent(
      /A safe literal .vantageignore rule cannot be generated/,
    );
    expect(screen.queryByText("/generated/cache?/")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("scan-analysis-affected-paths"),
    ).toHaveTextContent("generated/cache?/readme.md");
  });

  it("does not render analysis requests or controls in a static export", async () => {
    window.__VANTAGE_STATIC__ = true;
    renderAt("/.vantage/scan-analysis");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Open this project with vantage serve",
    );
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Run bounded diagnostic" }),
    ).not.toBeInTheDocument();
  });

  it("shows an evidence loading state until the opening read completes", async () => {
    let finish: ((value: { data: ScanAnalysisResponse }) => void) | undefined;
    mockedAxios.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderAt("/.vantage/scan-analysis");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading recorded scan evidence",
    );
    await act(async () => {
      finish?.({ data: evidenceResponse });
    });
    expect(
      await screen.findByText("git ls-files -co --exclude-standard"),
    ).toBeInTheDocument();
  });

  it("loads single-repo evidence and shows unknown past evidence without inventing values", async () => {
    mockedAxios.get.mockResolvedValue({
      data: { evidence: null, diagnostic: null },
    });
    renderAt("/.vantage/scan-analysis");
    expect(
      await screen.findByText(/No diagnostic has run/),
    ).toBeInTheDocument();
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "/api/git/scan-analysis",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.queryByText("0 ms")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run bounded diagnostic" }),
    ).toBeEnabled();
  });

  it("shows loading and retries a failed evidence read", async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error("server unavailable"))
      .mockResolvedValueOnce({ data: evidenceResponse });
    renderAt("/.vantage/scan-analysis");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "server unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry evidence" }));
    expect(
      await screen.findByText("git ls-files -co --exclude-standard"),
    ).toBeInTheDocument();
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it("offers a retry when the diagnostic fails", async () => {
    mockedAxios.post
      .mockRejectedValueOnce(new Error("diagnostic reached an error"))
      .mockResolvedValueOnce({ data: partialResponse });
    renderAt("/.vantage/scan-analysis");
    await screen.findByText("git ls-files -co --exclude-standard");
    fireEvent.click(
      screen.getByRole("button", { name: "Run bounded diagnostic" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "diagnostic reached an error",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry diagnostic" }));
    expect(
      await screen.findByText("Stopped at the diagnostic time limit."),
    ).toBeInTheDocument();
  });

  it("cancels a diagnostic and ignores its late result", async () => {
    let finish: ((value: { data: ScanAnalysisResponse }) => void) | undefined;
    mockedAxios.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderAt("/.vantage/scan-analysis");
    await screen.findByText("git ls-files -co --exclude-standard");
    fireEvent.click(
      screen.getByRole("button", { name: "Run bounded diagnostic" }),
    );
    const signal = mockedAxios.post.mock.calls[0]?.[2]?.signal as AbortSignal;
    expect(
      screen.getByRole("button", { name: "Cancel diagnostic" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel diagnostic" }));
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Diagnostic cancelled",
    );
    await act(async () => {
      finish?.({ data: partialResponse });
    });
    expect(
      screen.queryByText("Stopped at the diagnostic time limit."),
    ).not.toBeInTheDocument();
  });

  it("aborts stale scope requests and ignores their late responses", async () => {
    const finishOld: Array<(value: { data: ScanAnalysisResponse }) => void> =
      [];
    const oldSignals: AbortSignal[] = [];
    const otherResponse: ScanAnalysisResponse = {
      ...evidenceResponse,
      evidence: {
        ...evidenceResponse.evidence!,
        command: "other project evidence",
      },
    };
    mockedAxios.get.mockImplementation((url, config) => {
      if (url === "/api/r/other/git/scan-analysis") {
        return Promise.resolve({ data: otherResponse });
      }
      const signal = config?.signal;
      if (signal) oldSignals.push(signal);
      return new Promise<{ data: ScanAnalysisResponse }>((resolve) => {
        finishOld.push(resolve);
      });
    });
    useMultiRepo();
    renderAt("/.vantage/scan-analysis/my%20repo%232");
    await waitFor(() => expect(mockedAxios.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Switch project" }));
    expect(
      await screen.findByText("other project evidence"),
    ).toBeInTheDocument();
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "/api/r/other/git/scan-analysis",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(oldSignals.length).toBeGreaterThan(0);
    expect(oldSignals.every((signal) => signal.aborted)).toBe(true);
    await act(async () => {
      for (const finish of finishOld) finish({ data: evidenceResponse });
    });
    expect(screen.getByText("other project evidence")).toBeInTheDocument();
  });
});
