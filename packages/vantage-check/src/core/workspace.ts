import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { indexDocument, type DocumentIndex } from "./slugs.js";
import { parseMarkdown, type Document } from "./document.js";
import { parseFrontmatter } from "../../../vantage-md/src/frontmatter.js";

/** What a link can point at. */
export type TargetKind = "file" | "directory" | "missing";

/**
 * Everything the rules need to know about *other* files on disk, answered once
 * and cached. A directory of documents cross-links heavily: without the cache
 * a doc set of any size re-reads and re-parses the same targets hundreds of
 * times.
 *
 * Nothing here touches the network or a running server — a link is resolved by
 * looking at the filesystem, which is the only channel the CLI has (P1).
 */
export class Workspace {
  private readonly kinds = new Map<string, TargetKind>();
  private readonly lineCounts = new Map<string, number | null>();
  private readonly indexes = new Map<string, DocumentIndex | null>();

  kind(path: string): TargetKind {
    const cached = this.kinds.get(path);
    if (cached !== undefined) return cached;

    let kind: TargetKind;
    try {
      const stats = statSync(path);
      kind = stats.isDirectory() ? "directory" : "file";
    } catch {
      kind = "missing";
    }
    this.kinds.set(path, kind);
    return kind;
  }

  exists(path: string): boolean {
    return this.kind(path) !== "missing";
  }

  /**
   * How many lines a file has, or null if it cannot be read as text.
   *
   * A file ending in a newline is not one line longer for this purpose: a
   * trailing newline terminates the last line, it does not start another. That
   * matches what an editor's gutter shows, which is what a `#L42` link means.
   */
  lineCount(path: string): number | null {
    const cached = this.lineCounts.get(path);
    if (cached !== undefined) return cached;

    let count: number | null;
    try {
      count = countLines(readFileSync(path, "utf8"));
    } catch {
      count = null;
    }
    this.lineCounts.set(path, count);
    return count;
  }

  /** The fragment ids a Markdown file exposes, or null if it is not Markdown. */
  documentAnchors(path: string): Set<string> | null {
    return this.index(path)?.anchors ?? null;
  }

  /**
   * Section number → heading slug for a Markdown file, or null when it is not
   * Markdown or cannot be read. An empty map is a real answer, distinct from
   * null: the document is Markdown and has no numbered headings, which is what
   * `ref/unlinked-section` reads as "nothing to resolve against".
   */
  numberedHeadings(path: string): Map<string, string> | null {
    return this.index(path)?.numbered ?? null;
  }

  /**
   * Take a document the run has already read and parsed, instead of reading and
   * parsing it again.
   *
   * Documents in a set link to each other, so nearly every file the run checks
   * is also a *target* of one — and answering a question about a target used to
   * mean a second `readFileSync` and a second `parseMarkdown` of bytes already
   * in memory. Offering each document as it is loaded removes that duplicate
   * for every target the run reaches after the file itself.
   *
   * The answers are derived here, eagerly, rather than by keeping the tree
   * around: the index is small and a run over a large corpus should not hold
   * every mdast it has ever seen.
   */
  offer(doc: Document): void {
    this.kinds.set(doc.path, "file");
    this.lineCounts.set(doc.path, countLines(doc.text));
    // Only Markdown has anchors. A file named on the command line is checked
    // whatever its extension, so this guard is what stops `notes.txt` being
    // credited with headings that `documentAnchors` would never have found for
    // it from disk — which would turn a link to `notes.txt#anything` into a
    // dead-anchor finding the sequential reader never sees.
    if (isMarkdown(doc.path)) {
      this.indexes.set(doc.path, indexDocument(doc.mdast));
    }
  }

  /** One read and one parse per Markdown file, however many rules ask. */
  private index(path: string): DocumentIndex | null {
    const cached = this.indexes.get(path);
    if (cached !== undefined) return cached;

    let result: DocumentIndex | null = null;
    if (isMarkdown(path)) {
      try {
        const text = readFileSync(path, "utf8");
        result = indexDocument(parseMarkdown(parseFrontmatter(text).body));
      } catch {
        result = null;
      }
    }
    this.indexes.set(path, result);
    return result;
  }
}

export function isMarkdown(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return extension === ".md" || extension === ".markdown";
}

/** See `Workspace.lineCount` for why a trailing newline does not count. */
function countLines(text: string): number {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}
