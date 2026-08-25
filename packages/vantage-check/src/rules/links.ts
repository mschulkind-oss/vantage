/**
 * The link/* rules — the CLI's own, near-zero-false-positive checks.
 *
 * Every href is classified once:
 *   1. shape checks (leading-slash, uri-scheme) — at most one, and only when
 *      the shape is a usable relative path do we look at the target at all;
 *   2. target checks (missing-target, line-anchor-range, dead-section-anchor).
 *
 * Inline code, fences, and raw text are never seen as links: we walk the
 * remark AST (via vantage-md's `parseToMdast`), so only real `link`/`image`
 * nodes — and reference links resolved through `definition` nodes — are
 * considered. Autolinks the viewer produces are plain `link` nodes too.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { visit } from "unist-util-visit";
import {
  headingIds as computeHeadingIds,
  parseFrontmatter,
  parseLineAnchor,
} from "vantage-md";
import { countLines, type ParsedDoc } from "../parse.js";
import type { Finding } from "../types.js";

/** Schemes the viewer can actually navigate to. */
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "data"]);

/**
 * Per-run cache so a target file is read and slugified at most once even when
 * many documents link to it.
 */
export interface Ctx {
  lineCountOf(abs: string): number;
  headingIdsOf(abs: string): string[];
}

/** Build a fresh per-run Ctx backed by on-disk reads with a small cache. */
export function makeCtx(): Ctx {
  const lineCounts = new Map<string, number>();
  const slugs = new Map<string, string[]>();
  return {
    lineCountOf(abs) {
      let n = lineCounts.get(abs);
      if (n === undefined) {
        n = countLines(readFileSync(abs, "utf8"));
        lineCounts.set(abs, n);
      }
      return n;
    },
    headingIdsOf(abs) {
      let ids = slugs.get(abs);
      if (ids === undefined) {
        const { body } = parseFrontmatter(readFileSync(abs, "utf8"));
        ids = computeHeadingIds(body);
        slugs.set(abs, ids);
      }
      return ids;
    },
  };
}

interface LinkRef {
  href: string;
  line: number; // 1-based line within the body
  isImage: boolean;
}

interface Target {
  kind: "missing" | "dir" | "file";
  /** Resolved absolute path; null for a same-document target. */
  abs: string | null;
  lineCount: number;
  headingIds: string[] | null;
}

/**
 * The scheme of an href, lowercased, or null when there is none. A single
 * letter followed by a colon counts (that is how `C:\...` drive paths look),
 * which is exactly what lets us reject them.
 */
export function schemeOf(href: string): string | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href);
  return m ? m[1].toLowerCase() : null;
}

/** Split an href into its path and fragment at the first `#`. */
export function splitFragment(href: string): {
  path: string;
  frag: string | null;
} {
  const i = href.indexOf("#");
  if (i === -1) return { path: href, frag: null };
  return { path: href.slice(0, i), frag: href.slice(i) };
}

function isMarkdownFile(abs: string): boolean {
  return abs.toLowerCase().endsWith(".md");
}

function mk(
  file: string,
  rule: string,
  line: number,
  message: string,
): Finding {
  return { file, rule, severity: "error", line, message };
}

// Show a resolved target the way the report shows the file: relative to the
// working directory, so a report reads consistently.
function disp(abs: string | null): string {
  if (abs === null) return "this file";
  return path.relative(process.cwd(), abs) || abs;
}

function collectDefinitions(doc: ParsedDoc): Map<string, string> {
  const defs = new Map<string, string>();
  visit(doc.mdast, "definition", (node) => {
    defs.set(node.identifier, node.url);
  });
  return defs;
}

function collectLinks(doc: ParsedDoc): LinkRef[] {
  const defs = collectDefinitions(doc);
  const out: LinkRef[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visit(doc.mdast, (node: any) => {
    const line = node.position?.start?.line ?? 0;
    switch (node.type) {
      case "link":
        out.push({ href: node.url, line, isImage: false });
        break;
      case "image":
        out.push({ href: node.url, line, isImage: true });
        break;
      case "linkReference": {
        const href = defs.get(node.identifier);
        if (href !== undefined) out.push({ href, line, isImage: false });
        break;
      }
      case "imageReference": {
        const href = defs.get(node.identifier);
        if (href !== undefined) out.push({ href, line, isImage: true });
        break;
      }
    }
  });
  return out;
}

function resolveTarget(rawPath: string, doc: ParsedDoc, ctx: Ctx): Target {
  // Same document: the href is just a fragment (or empty).
  if (rawPath === "") {
    return {
      kind: "file",
      abs: null,
      lineCount: doc.lineCount,
      headingIds: doc.headingIds,
    };
  }

  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // Malformed percent-encoding: keep the raw path so it resolves (and is
    // reported) rather than throwing.
  }
  const abs = path.resolve(path.dirname(doc.abs), decoded);

  let st;
  try {
    st = statSync(abs);
  } catch {
    return { kind: "missing", abs, lineCount: 0, headingIds: null };
  }
  if (st.isDirectory()) {
    return { kind: "dir", abs, lineCount: 0, headingIds: null };
  }
  return {
    kind: "file",
    abs,
    lineCount: ctx.lineCountOf(abs),
    headingIds: isMarkdownFile(abs) ? ctx.headingIdsOf(abs) : null,
  };
}

/**
 * Run all five link rules over a parsed document. Returns findings with
 * file-relative paths and 1-based file line numbers.
 */
export function checkDoc(doc: ParsedDoc, ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  for (const { href, line, isImage } of collectLinks(doc)) {
    const file = doc.rel;
    // Line numbers reported are file lines, not body lines.
    const at = line + doc.bodyLineOffset;

    const scheme = schemeOf(href);

    // A URL. Flag schemes the viewer cannot open; either way there is no local
    // file target to check.
    if (scheme !== null) {
      if (!ALLOWED_SCHEMES.has(scheme)) {
        findings.push(
          mk(
            file,
            "link/uri-scheme",
            at,
            `scheme "${scheme}:" is not openable in the viewer — use http, https, mailto, or a repo-relative path`,
          ),
        );
      }
      continue;
    }

    // Protocol-relative web URL (//host/path): absolute, no local target.
    if (href.startsWith("//")) continue;

    // Absolute filesystem path.
    if (href.startsWith("/")) {
      findings.push(
        mk(
          file,
          "link/leading-slash",
          at,
          `absolute path "${href}" — use a repo-relative path so it resolves against this file`,
        ),
      );
      continue;
    }

    // Relative path (possibly with a fragment).
    const { path: rawPath, frag } = splitFragment(href);
    const target = resolveTarget(rawPath, doc, ctx);

    if (target.kind !== "file") {
      findings.push(
        mk(
          file,
          "link/missing-target",
          at,
          target.kind === "dir"
            ? `"${href}" points at a directory (${disp(target.abs)}), not a document`
            : `"${href}" does not resolve to a file (${disp(target.abs)})`,
        ),
      );
      continue;
    }

    // Anchor checks: links only (not images), and only when there is a frag.
    if (frag && !isImage) {
      const range = parseLineAnchor(frag);
      if (range) {
        if (range.end > target.lineCount) {
          findings.push(
            mk(
              file,
              "link/line-anchor-range",
              at,
              `line anchor ${frag} is beyond the ${target.lineCount} lines of ${disp(target.abs)}`,
            ),
          );
        }
      } else if (target.headingIds) {
        const slug = frag.slice(1);
        if (!target.headingIds.includes(slug)) {
          findings.push(
            mk(
              file,
              "link/dead-section-anchor",
              at,
              `no heading with anchor "${slug}" in ${disp(target.abs)}`,
            ),
          );
        }
      }
    }
  }
  return findings;
}
