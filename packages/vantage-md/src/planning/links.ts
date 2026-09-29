/**
 * Which repository path a link names, for everything the planning index
 * resolves: a document's links, its `depends-on` entries, and the target the
 * viewer stamps on a rendered link so a badge can find it.
 */

/** A URI scheme: `https:`, `mailto:`, a drive letter's `c:`. */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** `decodeURIComponent`, keeping the text as written when it is malformed. */
function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Collapse `.` and `..` segments. `null` when a `..` climbs above the root,
 * which is where a link leaves the repository.
 */
function normalize(path: string): string | null {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/**
 * The repo-relative path and decoded fragment a link from `fromPath` names, or
 * `null` when the link does not name a path inside this repository.
 *
 * `null` covers a scheme (`https:`, `mailto:`, `file:`), a protocol-relative
 * `//host`, a leading `/`, and a relative path whose `..` climbs out of the
 * root. The last is what keeps a link from one repository into another from
 * ever being decorated (design §3.6): each repository is its own root, so the
 * path leaves it. The query is dropped and percent escapes are decoded, as the
 * checker's link rules clean a path (`splitFragment`, `cleanPath`).
 *
 * A link with no path part (`#OQ-4`) names `fromPath` itself. A fragment that is
 * empty (`x.md#`) is no fragment.
 */
export function resolveRepoLink(
  fromPath: string,
  href: string,
): { path: string; fragment: string | null } | null {
  if (href.startsWith("//") || href.startsWith("\\\\")) return null;
  if (SCHEME.test(href)) return null;

  const hash = href.indexOf("#");
  const rawPath = hash === -1 ? href : href.slice(0, hash);
  const rawFragment = hash === -1 ? "" : href.slice(hash + 1);
  const query = rawPath.indexOf("?");
  const pathPart = decode(query === -1 ? rawPath : rawPath.slice(0, query));
  if (pathPart.startsWith("/")) return null;

  const fragment = rawFragment === "" ? null : decode(rawFragment);
  if (pathPart === "") return { path: fromPath, fragment };

  const slash = fromPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : fromPath.slice(0, slash + 1);
  const path = normalize(dir + pathPart);
  if (path === null) return null;
  return { path, fragment };
}
