import { describe, it, expect, vi, beforeEach } from "vitest";
import { useFilePickerStore } from "./useFilePickerStore";
import { useRepoStore } from "./useRepoStore";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const reset = () =>
  useFilePickerStore.setState({
    open: null,
    files: [],
    filesRepo: null,
    globalFiles: [],
    globalSource: null,
    loading: false,
  });

/** Point the store's API base at a repo (or single-repo mode when null). */
const inRepo = (repo: string | null) =>
  useRepoStore.setState({
    currentRepo: repo,
    isMultiRepo: repo !== null,
  });

describe("useFilePickerStore", () => {
  beforeEach(() => {
    reset();
    inRepo(null);
    vi.clearAllMocks();
  });

  it("fetches the current repo's list when the local picker opens", async () => {
    mockedAxios.get.mockResolvedValue({ data: ["docs/a.md"] });

    await useFilePickerStore.getState().openLocal();

    expect(mockedAxios.get).toHaveBeenCalledWith("/api/files");
    expect(useFilePickerStore.getState().files).toEqual(["docs/a.md"]);
    expect(useFilePickerStore.getState().open).toBe("local");
    expect(useFilePickerStore.getState().loading).toBe(false);
  });

  it("scopes the request to the selected repository", async () => {
    inRepo("notes");
    mockedAxios.get.mockResolvedValue({ data: [] });

    await useFilePickerStore.getState().openLocal();

    expect(mockedAxios.get).toHaveBeenCalledWith("/api/r/notes/files");
  });

  // The pickers exist to find a file that may have been written a second ago,
  // so an open is never served from the last open's answer.
  it("refetches on every open", async () => {
    mockedAxios.get.mockResolvedValue({ data: ["docs/a.md"] });

    await useFilePickerStore.getState().openLocal();
    useFilePickerStore.getState().close();
    await useFilePickerStore.getState().openLocal();

    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  // Stale-while-revalidate: the list on screen is what the reader is reading,
  // and blanking it for the length of a request would be worse than showing a
  // list that is one file out of date for 20ms.
  it("keeps the list on screen while a refresh is in flight", async () => {
    mockedAxios.get.mockResolvedValue({ data: ["docs/a.md"] });
    await useFilePickerStore.getState().openLocal();

    let resolve: (value: { data: string[] }) => void = () => {};
    mockedAxios.get.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const pending = useFilePickerStore.getState().refresh();

    expect(useFilePickerStore.getState().files).toEqual(["docs/a.md"]);
    resolve({ data: ["docs/a.md", "docs/b.md"] });
    await pending;
    expect(useFilePickerStore.getState().files).toEqual([
      "docs/a.md",
      "docs/b.md",
    ]);
  });

  it("does not fetch anything when no picker is open", async () => {
    await useFilePickerStore.getState().refresh();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("refreshes whichever list the open picker is showing", async () => {
    mockedAxios.get.mockResolvedValue({ data: [] });
    await useFilePickerStore.getState().openGlobal("all");
    mockedAxios.get.mockClear();

    await useFilePickerStore.getState().refresh();

    expect(mockedAxios.get).toHaveBeenCalledWith("/api/files/all");
  });

  // A list of another repository's files is not stale data worth showing while
  // the refetch is in flight — it is the wrong list, and it must never be on
  // screen for even one render.
  it("drops another repository's list as it opens", async () => {
    mockedAxios.get.mockResolvedValue({ data: ["docs/a.md"] });
    inRepo("notes");
    await useFilePickerStore.getState().openLocal();

    inRepo("code");
    mockedAxios.get.mockReturnValue(new Promise(() => {}));
    void useFilePickerStore.getState().openLocal();

    expect(useFilePickerStore.getState().files).toEqual([]);
  });

  // `Shift+R` used to open this picker over /api/recent/all; it is
  // RecentsModal's now, and the global picker only ever lists every file.
  it("lists every file across projects, never the recents", async () => {
    mockedAxios.get.mockResolvedValue({
      data: [{ repo: "notes", path: "docs/a.md" }],
    });
    await useFilePickerStore.getState().openGlobal("all");

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith("/api/files/all");
    expect(useFilePickerStore.getState().globalFiles).toEqual([
      { repo: "notes", path: "docs/a.md" },
    ]);
  });

  it("keeps the same list across a reopen, so the reopen is not a spinner", async () => {
    mockedAxios.get.mockResolvedValue({ data: ["docs/a.md"] });
    await useFilePickerStore.getState().openLocal();
    useFilePickerStore.getState().close();

    mockedAxios.get.mockReturnValue(new Promise(() => {}));
    void useFilePickerStore.getState().openLocal();

    expect(useFilePickerStore.getState().files).toEqual(["docs/a.md"]);
  });

  // A refresh can overtake the fetch an open fired, and the older answer must
  // not land on top of the newer one.
  it("discards a response a later request has overtaken", async () => {
    let resolveFirst: (value: { data: string[] }) => void = () => {};
    mockedAxios.get.mockReturnValueOnce(
      new Promise((r) => {
        resolveFirst = r;
      }),
    );
    const first = useFilePickerStore.getState().openLocal();

    mockedAxios.get.mockResolvedValue({ data: ["second.md"] });
    await useFilePickerStore.getState().refresh();

    resolveFirst({ data: ["first.md"] });
    await first;

    expect(useFilePickerStore.getState().files).toEqual(["second.md"]);
  });

  it("keeps the previous list when a request fails", async () => {
    mockedAxios.get.mockResolvedValue({ data: ["docs/a.md"] });
    await useFilePickerStore.getState().openLocal();

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockedAxios.get.mockRejectedValue(new Error("network"));
    await useFilePickerStore.getState().refresh();

    expect(useFilePickerStore.getState().files).toEqual(["docs/a.md"]);
    expect(useFilePickerStore.getState().loading).toBe(false);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
