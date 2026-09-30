import { describe, it, expect, vi, beforeEach } from "vitest";
import { GIT_PATHS_KEPT, resetGitAnswers, useGitStore } from "./useGitStore";
import { useRepoStore } from "./useRepoStore";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

/** A promise and the functions that settle it, for answers out of order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const commit = (message: string) => ({
  hexsha: "abc123",
  author_name: "Test Author",
  author_email: "test@example.com",
  date: "2024-01-01T00:00:00Z",
  message,
});

describe("useGitStore", () => {
  beforeEach(() => {
    // Reset store state before each test
    useGitStore.setState({
      history: [],
      isLoading: false,
      diff: null,
      isDiffLoading: false,
      showDiff: false,
      isRepoInfoLoading: false,
    });
    resetGitAnswers();
    useRepoStore.setState({ isMultiRepo: false, currentRepo: null });
    vi.clearAllMocks();
  });

  describe("fetchHistory", () => {
    it("fetches and stores git history", async () => {
      const mockHistory = [
        {
          hexsha: "abc123",
          author_name: "Test Author",
          author_email: "test@example.com",
          date: "2024-01-01T00:00:00Z",
          message: "Test commit",
        },
      ];
      mockedAxios.get.mockResolvedValueOnce({ data: mockHistory });

      await useGitStore.getState().fetchHistory("test.md");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "/api/git/history?path=test.md",
      );
      expect(useGitStore.getState().history).toEqual(mockHistory);
      expect(useGitStore.getState().isLoading).toBe(false);
    });

    it("handles fetch error gracefully", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Network error"));

      await useGitStore.getState().fetchHistory("test.md");

      expect(useGitStore.getState().history).toEqual([]);
      expect(useGitStore.getState().isLoading).toBe(false);
    });

    it("keeps each path's history under its path, a failure as none", async () => {
      const mockHistory = [commit("Test commit")];
      mockedAxios.get.mockResolvedValueOnce({ data: mockHistory });
      await useGitStore.getState().fetchHistory("a.md");
      mockedAxios.get.mockRejectedValueOnce(new Error("Network error"));
      await useGitStore.getState().fetchHistory("b.md");

      expect(useGitStore.getState().historyByPath).toEqual({
        "a.md": mockHistory,
        "b.md": [],
      });
    });
  });

  // The viewer asks for a document's status together with its content, while
  // the previous document is still on screen, and its header must neither show
  // the next document's commit nor lose its own
  // (docs/design/planning-index-at-scale.md §11.2).
  describe("fetchStatus", () => {
    it("keeps the answer under its path", async () => {
      const mockCommit = commit("Test commit");
      mockedAxios.get.mockResolvedValueOnce({
        data: { last_commit: mockCommit, git_status: "modified" },
      });

      await useGitStore.getState().fetchStatus("test.md");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "/api/git/status?path=test.md",
      );
      expect(useGitStore.getState().statusByPath).toEqual({
        "test.md": { lastCommit: mockCommit, gitStatus: "modified" },
      });
    });

    it("knows nothing of a path until the server answers for it", async () => {
      const answer = deferred<{ data: unknown }>();
      mockedAxios.get.mockReturnValueOnce(answer.promise);

      const pending = useGitStore.getState().fetchStatus("untracked.md");
      expect(useGitStore.getState().statusByPath["untracked.md"]).toBe(
        undefined,
      );

      answer.resolve({ data: { last_commit: null, git_status: "untracked" } });
      await pending;
      expect(useGitStore.getState().statusByPath["untracked.md"]).toEqual({
        lastCommit: null,
        gitStatus: "untracked",
      });
    });

    // A failure is an answer, so a first paint waiting on it stops waiting,
    // but not an untracked file's: with no commit and no mark it once read as
    // one, and the header said "Untracked file" of a tracked file (L3).
    it("answers a failed request as failed, not as a file with no commit", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Not found"));

      await useGitStore.getState().fetchStatus("test.md");

      expect(useGitStore.getState().statusByPath["test.md"]).toStrictEqual({
        lastCommit: null,
        gitStatus: null,
        failed: true,
      });

      // The next request for it answers properly.
      mockedAxios.get.mockResolvedValueOnce({
        data: { last_commit: commit("Tracked"), git_status: null },
      });
      await useGitStore.getState().fetchStatus("test.md");
      expect(useGitStore.getState().statusByPath["test.md"]).toStrictEqual({
        lastCommit: commit("Tracked"),
        gitStatus: null,
      });
    });

    it("leaves the previous path's answer while the next one's is asked", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { last_commit: commit("On a"), git_status: null },
      });
      await useGitStore.getState().fetchStatus("a.md");

      const answer = deferred<{ data: unknown }>();
      mockedAxios.get.mockReturnValueOnce(answer.promise);
      const pending = useGitStore.getState().fetchStatus("b.md");
      expect(
        useGitStore.getState().statusByPath["a.md"]?.lastCommit?.message,
      ).toBe("On a");

      answer.resolve({
        data: { last_commit: commit("On b"), git_status: null },
      });
      await pending;
      const { statusByPath } = useGitStore.getState();
      expect(statusByPath["a.md"]?.lastCommit?.message).toBe("On a");
      expect(statusByPath["b.md"]?.lastCommit?.message).toBe("On b");
    });

    it("drops an older answer for a path that lands after a newer one", async () => {
      const older = deferred<{ data: unknown }>();
      const newer = deferred<{ data: unknown }>();
      mockedAxios.get
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);

      const first = useGitStore.getState().fetchStatus("a.md");
      const second = useGitStore.getState().fetchStatus("a.md");
      newer.resolve({
        data: { last_commit: commit("Newer"), git_status: null },
      });
      await second;
      older.resolve({
        data: { last_commit: commit("Older"), git_status: null },
      });
      await first;

      expect(
        useGitStore.getState().statusByPath["a.md"]?.lastCommit?.message,
      ).toBe("Newer");
    });

    it("forgets one repository's answers at the first request for another", async () => {
      useRepoStore.setState({ isMultiRepo: true, currentRepo: "alpha" });
      mockedAxios.get.mockResolvedValueOnce({
        data: { last_commit: commit("In alpha"), git_status: null },
      });
      await useGitStore.getState().fetchStatus("README.md");

      // Alpha's late answer for another path lands after the switch.
      const late = deferred<{ data: unknown }>();
      mockedAxios.get.mockReturnValueOnce(late.promise);
      const lateAnswer = useGitStore.getState().fetchStatus("notes.md");

      useRepoStore.setState({ currentRepo: "beta" });
      const beta = deferred<{ data: unknown }>();
      mockedAxios.get.mockReturnValueOnce(beta.promise);
      const betaAnswer = useGitStore.getState().fetchStatus("README.md");
      expect(mockedAxios.get).toHaveBeenLastCalledWith(
        "/api/r/beta/git/status?path=README.md",
      );
      // Beta's README is another file: until beta answers, it is not known.
      expect(useGitStore.getState().statusByPath).toEqual({});

      late.resolve({
        data: { last_commit: commit("In alpha"), git_status: null },
      });
      await lateAnswer;
      beta.resolve({ data: { last_commit: null, git_status: "untracked" } });
      await betaAnswer;
      expect(useGitStore.getState().statusByPath).toEqual({
        "README.md": { lastCommit: null, gitStatus: "untracked" },
      });
    });

    it(`keeps the ${GIT_PATHS_KEPT} paths answered last`, async () => {
      mockedAxios.get.mockResolvedValue({
        data: { last_commit: null, git_status: null },
      });
      for (let i = 0; i <= GIT_PATHS_KEPT; i++) {
        await useGitStore.getState().fetchStatus(`doc-${i}.md`);
      }
      // doc-0 was answered first, so it went. doc-1, answered again, is the
      // newest now, so the next path to arrive pushes out doc-2 instead.
      await useGitStore.getState().fetchStatus("doc-1.md");
      await useGitStore.getState().fetchStatus("one-more.md");

      const paths = Object.keys(useGitStore.getState().statusByPath);
      expect(paths).toHaveLength(GIT_PATHS_KEPT);
      expect(paths).not.toContain("doc-0.md");
      expect(paths).not.toContain("doc-2.md");
      expect(paths.slice(-2)).toEqual(["doc-1.md", "one-more.md"]);
    });
  });

  describe("fetchRepoInfo", () => {
    it("says it is loading until /info answers, either way", async () => {
      const answer = deferred<{ data: unknown }>();
      mockedAxios.get.mockReturnValueOnce(answer.promise);
      const pending = useGitStore.getState().fetchRepoInfo();
      expect(useGitStore.getState().isRepoInfoLoading).toBe(true);
      answer.resolve({ data: { name: "repo", root_path: "/r" } });
      await pending;
      expect(useGitStore.getState()).toMatchObject({
        isRepoInfoLoading: false,
        repoRootPath: "/r",
      });

      mockedAxios.get.mockRejectedValueOnce(new Error("down"));
      await useGitStore.getState().fetchRepoInfo();
      expect(useGitStore.getState().isRepoInfoLoading).toBe(false);
    });
  });

  describe("fetchDiff", () => {
    it("fetches and stores diff", async () => {
      const mockDiff = {
        commit_hexsha: "abc123",
        commit_message: "Test commit",
        commit_author: "Test Author",
        commit_date: "2024-01-01T00:00:00Z",
        file_path: "test.md",
        hunks: [],
        raw_diff: "",
      };
      mockedAxios.get.mockResolvedValueOnce({ data: mockDiff });

      await useGitStore.getState().fetchDiff("test.md", "abc123");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "/api/git/diff?path=test.md&commit=abc123",
      );
      expect(useGitStore.getState().diff).toEqual(mockDiff);
      expect(useGitStore.getState().showDiff).toBe(true);
      expect(useGitStore.getState().isDiffLoading).toBe(false);
    });

    it("handles fetch error by setting diff to null", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Not found"));

      await useGitStore.getState().fetchDiff("test.md", "abc123");

      expect(useGitStore.getState().diff).toBeNull();
      expect(useGitStore.getState().isDiffLoading).toBe(false);
    });
  });

  describe("closeDiff", () => {
    it("closes diff modal and clears diff", () => {
      useGitStore.setState({
        showDiff: true,
        diff: {
          commit_hexsha: "abc123",
          commit_message: "Test",
          commit_author: "Author",
          commit_date: "2024-01-01",
          file_path: "test.md",
          hunks: [],
          raw_diff: "",
        },
      });

      useGitStore.getState().closeDiff();

      expect(useGitStore.getState().showDiff).toBe(false);
      expect(useGitStore.getState().diff).toBeNull();
    });
  });
});
