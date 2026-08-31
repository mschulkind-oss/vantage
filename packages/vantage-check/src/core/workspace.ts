import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { documentAnchors } from "./slugs.js";
import { parseMarkdown } from "./document.js";
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
  private readonly anchors = new Map<string, Set<string> | null>();

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
      const text = readFileSync(path, "utf8");
      const lines = text.split("\n");
      if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      count = lines.length;
    } catch {
      count = null;
    }
    this.lineCounts.set(path, count);
    return count;
  }

  /** The fragment ids a Markdown file exposes, or null if it is not Markdown. */
  documentAnchors(path: string): Set<string> | null {
    const cached = this.anchors.get(path);
    if (cached !== undefined) return cached;

    let result: Set<string> | null = null;
    if (isMarkdown(path)) {
      try {
        const text = readFileSync(path, "utf8");
        result = documentAnchors(parseMarkdown(parseFrontmatter(text).body));
      } catch {
        result = null;
      }
    }
    this.anchors.set(path, result);
    return result;
  }
}

export function isMarkdown(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return extension === ".md" || extension === ".markdown";
}
