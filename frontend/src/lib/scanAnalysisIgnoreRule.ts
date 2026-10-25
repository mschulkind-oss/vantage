/** Make an anchored, directory-only `.vantageignore` suggestion for a relative directory path. */
export function scanAnalysisIgnoreRule(path: string): string | null {
  const segments = path.split("/");
  if (
    path === "" ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        / +$/.test(segment),
    ) ||
    /[?\\\p{Cc}]/u.test(path) ||
    /[+(){}|^$]/.test(path) ||
    path.includes("[") ||
    path.includes("]") ||
    path.includes("\uFFFD")
  ) {
    return null;
  }

  // The server's gitignore matcher supports quoting a literal `*` with `\\*`.
  // Its regex operators cannot be quoted literally by this helper.
  return `/${segments.map((segment) => segment.replaceAll("*", "\\*")).join("/")}/`;
}
