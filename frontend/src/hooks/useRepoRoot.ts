/**
 * The root of a repository on the server's disk, as `/info` reports it: what
 * the planning page's agent requests name the repository by, as `vantage-check
 * index --request` names it by the root it runs in.
 *
 * Asked for once per repository and page load, when the planning page opens,
 * and read only when a request is copied, so nothing on screen waits for it or
 * changes when it arrives. Until it has answered, or when it fails, a request
 * names the repository by `repoLabel`'s fallback instead.
 */
import axios from "axios";
import { useEffect } from "react";

/** Each repository's root, by its name (`""` in single-repo mode). */
const roots = new Map<string, string>();
/** The repositories whose `/info` has been asked for this page load. */
const asked = new Set<string>();

/** Ask for `repo`'s root, once; `null` asks nothing. */
export function useRepoRoot(repo: string | null, isMultiRepo: boolean): void {
  useEffect(() => {
    if (repo === null || asked.has(repo)) return;
    asked.add(repo);
    const base = isMultiRepo ? `/api/r/${encodeURIComponent(repo)}` : "/api";
    // Through a promise of its own, so a GET that throws as it is sent fails
    // as one that is refused does.
    Promise.resolve()
      .then(() => axios.get<{ root_path?: unknown }>(`${base}/info`))
      .then(
        (response) => {
          const root = response?.data?.root_path;
          if (typeof root === "string" && root !== "") roots.set(repo, root);
        },
        // Asked again the next time the page opens; a request names the
        // repository by its fallback meanwhile.
        () => asked.delete(repo),
      );
  }, [repo, isMultiRepo]);
}

/**
 * How a request names `repo`: its root, once `/info` has reported it; else
 * its name in daemon mode, or `.`, the directory the agent is working in.
 */
export function repoLabel(repo: string): string {
  return roots.get(repo) ?? (repo === "" ? "." : repo);
}

export function resetRepoRootsForTests(): void {
  roots.clear();
  asked.clear();
}
