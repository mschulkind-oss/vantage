/** Make an anchored, directory-only `.vantageignore` suggestion for a relative directory path. */
export function scanAnalysisIgnoreRule(path: string): string | null {
  const segments = path.split("/");
  if (
    path === "" ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    ) ||
    /[?\\\p{Cc}]/u.test(path) ||
    path.includes("[") ||
    path.includes("]") ||
    / +$/.test(path)
  ) {
    return null;
  }

  // The server's gitignore matcher supports quoting a literal `*` with `\\*`.
  return `/${segments.map((segment) => segment.replaceAll("*", "\\*")).join("/")}/`;
}
