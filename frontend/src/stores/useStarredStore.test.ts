import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useStarredStore } from "./useStarredStore";
import { useRepoStore } from "./useRepoStore";
import axios from "axios";
import type { StarredEntry } from "../types";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const entry = (over: Partial<StarredEntry> = {}): StarredEntry => ({
  repo: "",
  path: "docs/a.md",
  is_dir: false,
  starred_at: "2026-09-20T12:00:00Z",
  ...over,
});

describe("useStarredStore", () => {
  beforeEach(() => {
    useStarredStore.setState({ entries: [], loaded: false });
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__VANTAGE_STATIC__;
  });

  describe("loadStarred", () => {
    it("fetches and stores the list", async () => {
      mockedAxios.get.mockResolvedValue({ data: { entries: [entry()] } });

      await useStarredStore.getState().loadStarred();

      expect(mockedAxios.get).toHaveBeenCalledWith("/api/starred");
      expect(useStarredStore.getState().entries).toEqual([entry()]);
      expect(useStarredStore.getState().loaded).toBe(true);
    });

    // Blanking the sidebar on a transient failure would be worse than showing
    // a slightly stale list.
    it("keeps the previous list when the request fails", async () => {
      useStarredStore.setState({ entries: [entry()], loaded: true });
      mockedAxios.get.mockRejectedValue(new Error("offline"));

      await useStarredStore.getState().loadStarred();

      expect(useStarredStore.getState().entries).toEqual([entry()]);
    });
  });

  describe("toggleStar", () => {
    it("POSTs when the path is not starred", async () => {
      mockedAxios.post.mockResolvedValue({ data: { entries: [entry()] } });

      await useStarredStore.getState().toggleStar("", "docs/a.md", false);

      expect(mockedAxios.post).toHaveBeenCalledWith("/api/starred", {
        repo: "",
        path: "docs/a.md",
        is_dir: false,
      });
      expect(useStarredStore.getState().entries).toEqual([entry()]);
    });

    it("DELETEs when the path is already starred", async () => {
      useStarredStore.setState({ entries: [entry()], loaded: true });
      mockedAxios.delete.mockResolvedValue({ data: { entries: [] } });

      await useStarredStore.getState().toggleStar("", "docs/a.md", false);

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(mockedAxios.delete).toHaveBeenCalledWith("/api/starred", {
        params: { repo: "", path: "docs/a.md" },
      });
      expect(useStarredStore.getState().entries).toEqual([]);
    });

    it("records a directory bookmark as one", async () => {
      mockedAxios.post.mockResolvedValue({
        data: { entries: [entry({ path: "docs", is_dir: true })] },
      });

      await useStarredStore.getState().toggleStar("", "docs", true);

      expect(mockedAxios.post).toHaveBeenCalledWith("/api/starred", {
        repo: "",
        path: "docs",
        is_dir: true,
      });
    });

    // The server answers every mutation with the whole list, so the client
    // adopts it wholesale rather than merging a delta.
    it("adopts the returned list rather than appending locally", async () => {
      useStarredStore.setState({ entries: [entry({ path: "old.md" })] });
      mockedAxios.post.mockResolvedValue({
        data: { entries: [entry({ path: "new.md" })] },
      });

      await useStarredStore.getState().toggleStar("", "b.md", false);

      expect(useStarredStore.getState().entries).toEqual([
        entry({ path: "new.md" }),
      ]);
    });

    it("leaves state untouched when the request fails", async () => {
      mockedAxios.post.mockRejectedValue(new Error("boom"));

      await useStarredStore.getState().toggleStar("", "docs/a.md", false);

      expect(useStarredStore.getState().entries).toEqual([]);
    });
  });

  describe("isStarred", () => {
    it("matches on both repo and path", () => {
      useStarredStore.setState({
        entries: [entry({ repo: "alpha", path: "a.md" })],
      });

      expect(useStarredStore.getState().isStarred("alpha", "a.md")).toBe(true);
      expect(useStarredStore.getState().isStarred("beta", "a.md")).toBe(false);
      expect(useStarredStore.getState().isStarred("", "a.md")).toBe(false);
    });

    // A prefix match would light the star up on every sibling in the folder.
    it("does not match a prefix", () => {
      useStarredStore.setState({ entries: [entry({ path: "docs" })] });

      expect(useStarredStore.getState().isStarred("", "docs")).toBe(true);
      expect(useStarredStore.getState().isStarred("", "docs/a.md")).toBe(false);
    });
  });

  // The bookmark routes are global. Reaching for the repo-scoped base would
  // 404 in daemon mode, so this guards against someone "restoring" the
  // getApiBase helper the other stores carry.
  it("uses the global route even when a repo is selected", async () => {
    useRepoStore.setState({ currentRepo: "alpha", isMultiRepo: true });
    mockedAxios.get.mockResolvedValue({ data: { entries: [] } });

    await useStarredStore.getState().loadStarred();

    expect(mockedAxios.get).toHaveBeenCalledWith("/api/starred");
    useRepoStore.setState({ currentRepo: null, isMultiRepo: false });
  });

  // A static export has no backend and its interceptor forces every request to
  // GET, so a write would appear to work and revert on reload.
  describe("static mode", () => {
    beforeEach(() => {
      window.__VANTAGE_STATIC__ = true;
    });

    it("makes no requests at all", async () => {
      await useStarredStore.getState().loadStarred();
      await useStarredStore.getState().toggleStar("", "a.md", false);
      await useStarredStore.getState().removeStar("", "a.md");

      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(mockedAxios.delete).not.toHaveBeenCalled();
    });
  });
});
