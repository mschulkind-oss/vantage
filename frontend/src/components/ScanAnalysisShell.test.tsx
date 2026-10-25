import { render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { ScanAnalysisPage } from "../pages/ScanAnalysisPage";
import { SCAN_ANALYSIS_ROUTE } from "../lib/scanAnalysisRoute";
import { useDegradedStore } from "../stores/useDegradedStore";
import { useGitStore } from "../stores/useGitStore";
import { useRepoStore } from "../stores/useRepoStore";
import { useStarredStore } from "../stores/useStarredStore";
import type { ScanAnalysisResponse } from "../types/scanAnalysis";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const response: ScanAnalysisResponse = {
  evidence: {
    command: "git ls-files -co --exclude-standard",
    elapsedMs: 1200,
    timeoutMs: 1000,
    gitignored: false,
    timedOut: true,
  },
  diagnostic: null,
};
const staleProjectRecent = {
  path: "a-only/stale.md",
  date: "2026-01-01T00:00:00Z",
  author_name: "A",
  message: "old project result",
  hexsha: "abc",
};

const originalRepoActions = useRepoStore.getState();
const originalGitActions = useGitStore.getState();
const originalDegradedLoad = useDegradedStore.getState().load;
const originalStarredLoad = useStarredStore.getState().loadStarred;

const refreshTree = vi.fn(async () => {});
const refreshExpandedTree = vi.fn(async () => {});
const fetchRecentFiles = vi.fn(async () => {});

describe("scan-analysis AppShell loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__VANTAGE_STATIC__ = false;
    mockedAxios.get.mockResolvedValue({ data: response });
    useRepoStore.setState({
      reposLoaded: true,
      isMultiRepo: true,
      currentRepo: "project-a",
      repos: [
        { name: "project-a", last_activity: null },
        { name: "project-b", last_activity: null },
      ],
      refreshTree,
      refreshExpandedTree,
    });
    useGitStore.setState({
      recentFiles: [staleProjectRecent],
      isRecentLoading: false,
      fetchRecentFiles,
    });
    useDegradedStore.setState({ load: async () => {} });
    useStarredStore.setState({ loadStarred: async () => {} });
  });

  afterEach(() => {
    delete window.__VANTAGE_STATIC__;
    useRepoStore.setState({
      refreshTree: originalRepoActions.refreshTree,
      refreshExpandedTree: originalRepoActions.refreshExpandedTree,
    });
    useGitStore.setState({
      fetchRecentFiles: originalGitActions.fetchRecentFiles,
    });
    useDegradedStore.setState({ load: originalDegradedLoad });
    useStarredStore.setState({ loadStarred: originalStarredLoad });
  });

  it.each([`${SCAN_ANALYSIS_ROUTE}/unknown`, SCAN_ANALYSIS_ROUTE])(
    "clears an invalid analysis scope without falling back to or displaying project A: %s",
    async (path) => {
      useDegradedStore.setState({
        items: [
          {
            repo: "project-a",
            kind: "walk_timeout",
            message: "Project A recent-file warning",
          },
        ],
      });
      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route
                path={SCAN_ANALYSIS_ROUTE}
                element={<ScanAnalysisPage />}
              />
              <Route
                path={`${SCAN_ANALYSIS_ROUTE}/:repo`}
                element={<ScanAnalysisPage />}
              />
            </Route>
          </Routes>
        </MemoryRouter>,
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Return to the project list",
      );
      expect(
        screen.getByRole("link", { name: "Back to project" }),
      ).toHaveAttribute("href", "/");
      expect(useRepoStore.getState().currentRepo).toBeNull();
      expect(
        screen.queryByText("Project A recent-file warning"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("stale.md")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("sidebar-resize-handle"),
      ).not.toBeInTheDocument();
      expect(refreshTree).not.toHaveBeenCalled();
      expect(refreshExpandedTree).not.toHaveBeenCalled();
      expect(fetchRecentFiles).not.toHaveBeenCalled();
      expect(
        mockedAxios.get.mock.calls.some(([url]) =>
          String(url).includes("/git/scan-analysis"),
        ),
      ).toBe(false);
      expect(
        mockedAxios.get.mock.calls.some(([url]) =>
          String(url).includes("/git/recent"),
        ),
      ).toBe(false);
    },
  );

  it("does not refresh tree or recents and does not map project A's cached recent into project B", async () => {
    render(
      <MemoryRouter initialEntries={[`${SCAN_ANALYSIS_ROUTE}/project-b`]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route
              path={`${SCAN_ANALYSIS_ROUTE}/:repo`}
              element={<ScanAnalysisPage />}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Recorded recent-file scan evidence"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Sidebar data is not refreshed during scan analysis.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("scan-analysis-content")).toHaveClass(
      "min-w-0",
      "w-full",
    );
    expect(refreshTree).not.toHaveBeenCalled();
    expect(refreshExpandedTree).not.toHaveBeenCalled();
    expect(fetchRecentFiles).not.toHaveBeenCalled();
    expect(screen.queryByText("stale.md")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "/api/r/project-b/git/scan-analysis",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    expect(
      mockedAxios.get.mock.calls.some(([url]) =>
        String(url).includes("/git/recent"),
      ),
    ).toBe(false);
    expect(
      mockedAxios.get.mock.calls.some(([url]) =>
        String(url).includes("/planning/sources"),
      ),
    ).toBe(false);
  });
});
