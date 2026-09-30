/**
 * What a `files_changed` push's `removed_dirs` says about one path.
 *
 * The watcher lists a watched directory renamed away or removed in
 * `removed_dirs`, by the path it had, because a renamed directory's files move
 * without an event of their own: `mv docs/old docs/new` arrives as
 * `removed_dirs: ["docs/old"]` with the Markdown now under `docs/new` in
 * `paths`, and nothing names `docs/old/a.md`. A removed directory's files are
 * the opposite: each is pushed by the event of its own removal
 * (internal/live/watcher.go, `filesChangedMessage`).
 */
import type { FileNode } from "../types";

/** Whether `path` is the directory `dir` or lies somewhere below it. */
export function isWithin(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

/** The directory holding `path`, `""` at the top of the tree. */
function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** The last segment of `path`. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The files `trees` list inside any of `dirs`: what the viewer knew was in the
 * removed directories before the push that removed them. The file tree lists
 * every folder that is open, and the document's own folder is open whenever a
 * document is on screen; a folder view lists the folder it shows.
 */
export function filesWithin(
  trees: Iterable<FileNode[] | null | undefined>,
  dirs: readonly string[],
): string[] {
  const found = new Set<string>();
  const walk = (nodes: FileNode[]) => {
    for (const node of nodes) {
      if (node.is_dir) {
        if (node.children) walk(node.children);
      } else if (dirs.some((dir) => isWithin(node.path, dir))) {
        found.add(node.path);
      }
    }
  };
  for (const nodes of trees) if (nodes) walk(nodes);
  return [...found];
}

/** A place a batch could have renamed one removed directory to. */
interface Candidate {
  /** The removed directory. */
  dir: string;
  /** Its new name. */
  root: string;
  /** Where `path` is under it. */
  target: string;
  /** The files known to have been in `dir` that arrived under `root`. */
  witnesses: Set<string>;
}

/**
 * Where the document or folder at `path` went, when the pushes of one batch
 * show that a directory it was in, or is, was renamed: `path` with that
 * directory's new name. `null` whenever they do not show it beyond doubt,
 * which is what the caller falls back from — reloading `path` shows whether it
 * is gone.
 *
 * `known` is every file the viewer knew was inside the removed directories
 * (`filesWithin`). A place is taken for the directory's new name — its *root* —
 * only on the word of *witnesses*: files known to have been in the directory,
 * or the document itself, that arrived below the root just as they lay below
 * the directory. A root has to be one a renamed directory could have:
 *
 * - not the removed directory, nor above or below it, since a directory renamed
 *   to a new name contained neither itself nor its parents;
 * - not inside any removed directory, since what is there is itself gone or
 *   uncertain.
 *
 * **A file whose own path was pushed is no witness.** A renamed directory's
 * files move without events of their own, so a pushed old path was removed
 * along with its directory, or rebuilt where it was, or edited — and an
 * unrelated file of the same name elsewhere in the same batch would otherwise
 * take the reader to a different document as if it were theirs. The document
 * edited just before its folder was renamed is followed on the word of the
 * folder's other files; alone in its folder, it is reloaded instead.
 *
 * A document is followed only to a pushed path, since a rename that brought it
 * along names it there. Between roots, the one with the most witnesses wins;
 * among those tied, one a single change away (the same parent, renamed in
 * place, or the same name, moved elsewhere), and then the outermost, since a
 * README in every subfolder makes `docs/new/sub/README.md` end the way
 * `docs/new/README.md` does. Anything still tied is no answer.
 */
export function renamedTo(
  path: string,
  removedDirs: Iterable<string>,
  paths: Iterable<string>,
  known: Iterable<string> = [],
): string | null {
  const dirs = [...removedDirs];
  const pushed = new Set(paths);
  const isDocument = path.toLowerCase().endsWith(".md");
  const knownFiles = [...known];

  // Where each name arrived, outside every removed directory.
  const arrivals = new Map<string, string[]>();
  for (const p of pushed) {
    if (dirs.some((d) => isWithin(p, d))) continue;
    const name = nameOf(p);
    const list = arrivals.get(name);
    if (list) list.push(p);
    else arrivals.set(name, [p]);
  }

  const candidates = new Map<string, Candidate>();
  for (const dir of dirs) {
    if (!isWithin(path, dir) || (isDocument && path === dir)) continue;
    const witnesses = new Set(
      knownFiles.filter((k) => k !== dir && isWithin(k, dir)),
    );
    if (isDocument) witnesses.add(path);
    for (const witness of witnesses) {
      if (pushed.has(witness)) continue;
      const tail = witness.slice(dir.length);
      for (const p of arrivals.get(nameOf(witness)) ?? []) {
        if (p.length <= tail.length || !p.endsWith(tail)) continue;
        const root = p.slice(0, p.length - tail.length);
        if (isWithin(root, dir) || isWithin(dir, root)) continue;
        const target = root + path.slice(dir.length);
        if (isDocument && !pushed.has(target)) continue;
        if (dirs.some((d) => isWithin(target, d))) continue;
        const key = `${dir}\0${root}`;
        let candidate = candidates.get(key);
        if (!candidate) {
          candidate = { dir, root, target, witnesses: new Set() };
          candidates.set(key, candidate);
        }
        candidate.witnesses.add(witness);
      }
    }
  }

  // One place can be reached through two removed directories, an ancestor and
  // the directory inside it; it is one answer, with every witness of either.
  const byTarget = new Map<string, Candidate>();
  for (const c of candidates.values()) {
    const same = byTarget.get(c.target);
    if (!same) byTarget.set(c.target, c);
    else for (const w of c.witnesses) same.witnesses.add(w);
  }

  let top = [...byTarget.values()];
  if (top.length === 0) return null;
  const most = Math.max(...top.map((c) => c.witnesses.size));
  top = top.filter((c) => c.witnesses.size === most);
  if (top.length > 1) {
    const oneChange = top.filter(
      (c) =>
        parentOf(c.root) === parentOf(c.dir) ||
        nameOf(c.root) === nameOf(c.dir),
    );
    if (oneChange.length > 0) top = oneChange;
  }
  if (top.length > 1) {
    top = top.filter(
      (c) => !top.some((o) => o.root !== c.root && isWithin(c.root, o.root)),
    );
  }
  return top.length === 1 ? top[0].target : null;
}
