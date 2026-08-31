import { readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

/** Extensions we treat as Markdown when walking a directory. */
export const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

/**
 * Directories a documentation walk should never descend into. Dot-directories
 * are skipped wholesale, which also covers `.vantage/` (transient review state)
 * and `.git/`.
 */
const SKIP_DIRECTORIES = new Set(["node_modules"]);

export interface Discovery {
  /** Absolute paths, deduplicated and sorted. */
  files: string[];
  /** Targets that do not exist or could not be read. */
  errors: string[];
}

/**
 * Expand the command line's paths into a list of files to check.
 *
 * A named file is checked whatever its extension — naming it is the intent. A
 * named directory is walked for Markdown only.
 */
export function discover(paths: string[], cwd: string): Discovery {
  const files = new Set<string>();
  const errors: string[] = [];

  for (const path of paths) {
    const absolute = resolve(cwd, path);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      errors.push(`no such file or directory: ${path}`);
      continue;
    }

    if (stats.isDirectory()) {
      walk(absolute, files, errors);
    } else {
      files.add(absolute);
    }
  }

  return { files: [...files].sort(), errors };
}

function walk(directory: string, files: Set<string>, errors: string[]): void {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    errors.push(`cannot read directory ${directory}: ${describe(error)}`);
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(path, files, errors);
    } else if (entry.isFile() && MARKDOWN_EXTENSIONS.has(extname(entry.name))) {
      files.add(path);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
