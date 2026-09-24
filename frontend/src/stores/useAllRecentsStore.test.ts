import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { useAllRecentsStore, ALL_RECENTS_LIMIT } from "./useAllRecentsStore";
import { useRepoStore } from "./useRepoStore";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const file = (repo: string, path: string) => ({
  repo,
  path,
  date: "2026-09-24T10:00:00Z",
  author_name: "Ann",
  message: "m",
  hexsha: "abc1234",
});

describe("useAllRecentsStore", () => {
  beforeEach(() => {
    useAllRecentsStore.setState({
      active: false,
      files: [],
      loading: false,
      error: false,
    });
    useRepoStore.setState({ showHidden: true, showGitignored: true });
    vi.clearAllMocks();
  });

  it("fetches every project's recents when it opens", async () => {
    mockedAxios.get.mockResolvedValue({ data: [file("notes", "a.md")] });

    await useAllRecentsStore.getState().open();

    expect(mockedAxios.get).toHaveBeenCalledWith(
      `/api/recent/all?limit=${ALL_RECENTS_LIMIT}`,
    );
    const state = useAllRecentsStore.getState();
    expect(state.active).toBe(true);
    expect(state.files).toEqual([file("notes", "a.md")]);
    expect(state.loading).toBe(false);
  });

  // Both scopes of the modal list the same kinds of file.
  it("applies the hidden and gitignored filters the per-project list does", async () => {
    useRepoStore.setState({ showHidden: false, showGitignored: false });
    mockedAxios.get.mockResolvedValue({ data: [] });

    await useAllRecentsStore.getState().open();

    expect(mockedAxios.get).toHaveBeenCalledWith(
      `/api/recent/all?limit=${ALL_RECENTS_LIMIT}&show_hidden=false&show_gitignored=false`,
    );
  });

  it("does not fetch on refresh while closed", async () => {
    await useAllRecentsStore.getState().refresh();
    expect(mockedAxios.get).not.toHaveBeenCalled();

    mockedAxios.get.mockResolvedValue({ data: [] });
    await useAllRecentsStore.getState().open();
    useAllRecentsStore.getState().close();
    mockedAxios.get.mockClear();
    await useAllRecentsStore.getState().refresh();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("refetches while open, keeping the list on screen meanwhile", async () => {
    mockedAxios.get.mockResolvedValue({ data: [file("notes", "a.md")] });
    await useAllRecentsStore.getState().open();

    let resolve: (value: { data: unknown[] }) => void = () => {};
    mockedAxios.get.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const pending = useAllRecentsStore.getState().refresh();
    expect(useAllRecentsStore.getState().files).toEqual([
      file("notes", "a.md"),
    ]);

    resolve({ data: [file("code", "b.md")] });
    await pending;
    expect(useAllRecentsStore.getState().files).toEqual([file("code", "b.md")]);
  });

  it("discards a response a later request has overtaken", async () => {
    let resolveFirst: (value: { data: unknown[] }) => void = () => {};
    mockedAxios.get.mockReturnValueOnce(
      new Promise((r) => {
        resolveFirst = r;
      }),
    );
    const first = useAllRecentsStore.getState().open();

    mockedAxios.get.mockResolvedValue({ data: [file("code", "second.md")] });
    await useAllRecentsStore.getState().refresh();

    resolveFirst({ data: [file("notes", "first.md")] });
    await first;

    expect(useAllRecentsStore.getState().files).toEqual([
      file("code", "second.md"),
    ]);
  });

  it("keeps the previous list and flags the error when a request fails", async () => {
    mockedAxios.get.mockResolvedValue({ data: [file("notes", "a.md")] });
    await useAllRecentsStore.getState().open();

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockedAxios.get.mockRejectedValue(new Error("network"));
    await useAllRecentsStore.getState().refresh();

    const state = useAllRecentsStore.getState();
    expect(state.files).toEqual([file("notes", "a.md")]);
    expect(state.error).toBe(true);
    expect(state.loading).toBe(false);
    consoleError.mockRestore();
  });
});
