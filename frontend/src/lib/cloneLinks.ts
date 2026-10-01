/**
 * Where a repository-relative path resolved inside project `repo` is served.
 *
 * The loose project — the one holding the Markdown beside a directory of clones
 * (docs/reference/serve-clones-directory.md §4.3) — refuses every path inside a
 * clone, because each clone is served as a project of its own. So a path whose
 * first folder is one of its `clones` (directory name → project name, from
 * `/api/repos`) belongs to that clone's project, with the folder dropped. `.`
 * and `..` are resolved before deciding. Every other path is returned as it
 * was given.
 */
export function projectFor(
  repo: string,
  path: string,
  clones: Record<string, string> | undefined,
): { repo: string; path: string } {
  if (!clones) return { repo, path };
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return { repo, path };
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  if (parts.length === 0 || !Object.hasOwn(clones, parts[0])) {
    return { repo, path };
  }
  return { repo: clones[parts[0]], path: parts.slice(1).join("/") };
}
