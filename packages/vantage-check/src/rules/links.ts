import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Node } from "unist";
import { visit } from "unist-util-visit";
import { parseLineAnchor } from "../../../vantage-md/src/lineAnchor.js";
import type { Collector } from "../core/collector.js";
import { displayPath } from "../core/document.js";
import { nearestAnchor } from "../core/slugs.js";
import { isMarkdown } from "../core/workspace.js";

/**
 * The rules nobody else can run for us.
 *
 * Everything here needs *this repo on disk* and Vantage's routing semantics:
 * whether a path resolves, whether a file is long enough for the line a link
 * names, whether a heading with that slug exists in the document being pointed
 * at. A general-purpose Markdown linter cannot answer any of them, which is
 * exactly why these are ours to write — and why they have to be right, because
 * an agent that sees one bogus error stops running the tool.
 *
 * The safety property throughout: only report when the filesystem has already
 * settled the question. Anything ambiguous is left alone.
 */

/** A link as written, split into the parts the rules care about. */
export interface LinkReference {
  node: Node;
  /** The href exactly as it appears in the document. */
  url: string;
}

/**
 * Every link in the document, from the parsed tree.
 *
 * From the *tree*, not the text: a crude search for `](` reports
 * `` `[Doc](/docs/guide.md)` `` inside inline code as a broken link, and being
 * wrong once is enough to lose the reader. Inline code, fenced blocks and plain
 * prose are simply not link nodes, so walking the AST settles it structurally.
 *
 * Raw HTML anchors (`<a href="...">`) are deliberately not collected: they are
 * a single `html` node with no parsed href, and guessing at one with a regex
 * puts us back in the business the previous paragraph is about.
 */
export function collectLinks(tree: Node): LinkReference[] {
  const references: LinkReference[] = [];

  const push = (node: Node, url: unknown) => {
    if (typeof url === "string" && url.length > 0) {
      references.push({ node, url });
    }
  };

  visit(tree, (node) => {
    switch (node.type) {
      case "link":
      case "image":
      case "definition":
        push(node, (node as { url?: unknown }).url);
        break;
      default:
        break;
    }
  });

  return references;
}

export function checkLinks(collector: Collector): void {
  const { doc, workspace } = collector;
  const documentDir = dirname(doc.path);

  for (const { node, url } of collectLinks(doc.mdast)) {
    const at = collector.at(node);
    const { path, fragment } = splitFragment(url);

    // A fragment with no path is a link into this same document.
    if (path === "") {
      if (fragment) checkFragment(collector, at, fragment, doc.path);
      continue;
    }

    if (DRIVE_LETTER.test(path) || path.startsWith("\\\\")) {
      collector.report(
        "link/uri-scheme",
        at,
        `\`${url}\` is an absolute filesystem path. Vantage serves files by repo-relative path, so write it relative to this file instead.`,
      );
      continue;
    }

    const scheme = schemeOf(path);
    if (scheme === "file") {
      collector.report(
        "link/uri-scheme",
        at,
        `\`${url}\` uses the \`file://\` scheme, which Vantage cannot route. Write the target relative to this file instead.`,
      );
      continue;
    }
    // Any other scheme — http, mailto, tel, a custom one — is somebody else's
    // to resolve, and resolving it would mean touching the network.
    if (scheme !== undefined || path.startsWith("//")) continue;

    if (path.startsWith("/")) {
      collector.report(
        "link/leading-slash",
        at,
        `\`${url}\` starts with a slash. Vantage resolves links relative to the current file, so a leading slash breaks web routing and multi-repo scoping.${suggestRelative(doc.path, path)}`,
      );
      continue;
    }

    const target = resolve(documentDir, cleanPath(path));
    if (!workspace.exists(target)) {
      collector.report(
        "link/missing-target",
        at,
        `\`${url}\` does not exist (looked for \`${collectorRelative(collector, target)}\`).`,
      );
      continue;
    }

    if (fragment) checkFragment(collector, at, fragment, target);
  }
}

/**
 * Check the `#...` half of a link, once the file half is known to resolve.
 *
 * Two different questions hide behind one syntax: `#L42` names lines in any
 * file, while `#some-heading` names a slug that only a Markdown document has.
 * A fragment that is neither is left alone — there is nothing on disk that
 * would settle it — with one exception: a fragment shaped like a line anchor
 * the viewer cannot parse (`#L4x`) is settled, because the syntax it is
 * reaching for is one we own. See `malformedLineAnchor`.
 */
function checkFragment(
  collector: Collector,
  at: { line: number; column: number },
  fragment: string,
  targetPath: string,
): void {
  const { workspace } = collector;
  const range = parseLineAnchor(fragment);

  if (range) {
    const lineCount = workspace.lineCount(targetPath);
    if (lineCount === null) return;

    // A warning, and a rule of its own, because severity is per rule id and
    // this one must not fail a run: `parseLineAnchor` normalises `#L50-L20`
    // with Math.min/Math.max, so the viewer really does highlight lines 20–50.
    // The link works. Reporting a working link as an error is the
    // false-positive class this package exists to avoid — but an inverted
    // range is still almost certainly a typo, which is what the warning says.
    //
    // Deliberately not an early return: a range can be inverted *and* run off
    // the end of the file, and the second of those is a genuine error.
    if (invertedRange(fragment)) {
      collector.report(
        "link/inverted-range",
        at,
        `\`#${fragment}\` is inverted — it ends before it starts.`,
      );
    }

    if (range.end > lineCount) {
      const name = collectorRelative(collector, targetPath);
      collector.report(
        "link/line-anchor-range",
        at,
        `\`#${fragment}\` points past the end of \`${name}\`, which has ${lineCount} line${lineCount === 1 ? "" : "s"}.`,
      );
    }
    return;
  }

  // Not a line anchor. It can still be two other things, and both are checked
  // before anything is reported: a heading slug, or an id somebody wrote by
  // hand in raw HTML. `documentAnchors` holds both, and is null when the
  // target is not Markdown or could not be read — either way, nothing we know
  // settles the question.
  const anchors = workspace.documentAnchors(targetPath);
  if (anchors?.has(fragment)) return;
  // Ids the renderer generates for GFM footnotes are not headings and are not
  // worth modelling; a link to one is vanishingly rare and a false positive is
  // not.
  if (fragment.startsWith("user-content-")) return;

  // Now that every id the target really exposes has been ruled out, a fragment
  // shaped like a botched line anchor can only be a botched line anchor.
  //
  // Two things are still not ruled out, and both stay silent: a Markdown file
  // we could not read, whose ids are unknown, and a directory, which has no
  // lines for an anchor to name in the first place.
  const idsUnknown = anchors === null && isMarkdown(targetPath);
  if (
    !idsUnknown &&
    malformedLineAnchor(fragment) &&
    workspace.kind(targetPath) === "file"
  ) {
    collector.report(
      "link/line-anchor-format",
      at,
      `\`#${fragment}\` is shaped like a line anchor but Vantage cannot parse it, so the link scrolls nowhere. Vantage accepts \`#L42\`, \`#L42-L50\` and \`#L42-50\`.`,
    );
    return;
  }

  if (anchors === null) return;

  const suggestion = nearestAnchor(fragment, anchors);
  const name = collectorRelative(collector, targetPath);
  const where =
    targetPath === collector.doc.path ? "this document" : `\`${name}\``;
  collector.report(
    "link/dead-section-anchor",
    at,
    `\`#${fragment}\` matches no heading in ${where}.${
      suggestion ? ` Did you mean \`#${suggestion}\`?` : ""
    }`,
  );
}

const DRIVE_LETTER = /^[a-zA-Z]:[\\/]/;
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

function schemeOf(url: string): string | undefined {
  const match = SCHEME.exec(url);
  return match?.[1]?.toLowerCase();
}

/** Split `path#fragment`, keeping everything after the first `#` verbatim. */
export function splitFragment(url: string): { path: string; fragment: string } {
  const hash = url.indexOf("#");
  if (hash === -1) return { path: url, fragment: "" };
  return { path: url.slice(0, hash), fragment: url.slice(hash + 1) };
}

/**
 * The on-disk name a link's path part refers to: query string dropped, percent
 * escapes decoded.
 */
function cleanPath(path: string): string {
  const query = path.indexOf("?");
  const withoutQuery = query === -1 ? path : path.slice(0, query);
  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return withoutQuery;
  }
}

/**
 * A fragment that is unmistakably an attempt at a line anchor, and that the
 * viewer cannot parse as one: `#L`, `#L4x`, `#L42-`, `#L42-L`, `#L42-L4x`.
 *
 * The test is deliberately narrow — an uppercase `L` followed immediately by a
 * digit (plus the bare `L`) — because that shape cannot be anything else once
 * the target's real ids have been ruled out. `rehypeSlug` runs the same
 * `github-slugger` we do and emits *lowercase* slugs, so no heading can ever
 * produce an id starting `L4`; the caller has already checked the hand-written
 * ids as well.
 *
 * Forms evaluated against the real viewer and deliberately NOT reported here.
 * Each was verified by running the shape through `parseLineAnchor` and
 * `renderMarkdown` rather than by reasoning about it:
 *
 * - `#L50-L10` — inverted, but `parseLineAnchor` normalises it with
 *   Math.min/Math.max and the viewer highlights 10–50. The link *works*, so it
 *   is `link/inverted-range`'s warning, not an error here.
 * - `#l42` — a lowercase `l` is not a line anchor, but it is a perfectly good
 *   heading slug: a heading `## L42` renders as `id="l42"`, so this resolves.
 *   When it does not, `link/dead-section-anchor` already says so, in the right
 *   words. Reporting a format error would be wrong for the resolving case.
 * - `#Introduction`, and uppercase fragments generally — `rehype-sanitize`
 *   rewrites a hand-written `<span id="Introduction">` to
 *   `id="user-content-Introduction"`, and the viewer resolves a fragment as
 *   `getElementById(id) || getElementById("user-content-" + id)`. So an
 *   uppercase fragment does resolve when the author wrote the id by hand,
 *   which is why `core/slugs.ts` collects those ids and why this is left to
 *   `link/dead-section-anchor`.
 * - `#Section Name` — a space in a link destination is not a link at all:
 *   CommonMark leaves `[a](#Section Name)` as literal text, so there is no
 *   link node to report. Written as `[a](<#Section Name>)` it is a dead
 *   section anchor, which is already covered.
 * - `#L0` — parses (0–0), so it is a *range* question rather than a format
 *   one, and it belongs to `link/line-anchor-range` if anybody ever writes it.
 */
function malformedLineAnchor(fragment: string): boolean {
  if (parseLineAnchor(fragment)) return false;
  return fragment === "L" || /^L\d/.test(fragment);
}

/** True when a range anchor names its end before its start, e.g. `L50-L20`. */
function invertedRange(fragment: string): boolean {
  const match = /^L(\d+)-L?(\d+)$/.exec(fragment);
  if (!match) return false;
  return Number(match[1]) > Number(match[2]);
}

/**
 * Name a file the way the reader would: relative to the document when the
 * target is nearby, relative to where the run started when it is not, and only
 * absolute when neither of those is shorter.
 */
function collectorRelative(collector: Collector, target: string): string {
  const fromDocument = relative(dirname(collector.doc.path), target);
  if (fromDocument !== "" && !fromDocument.startsWith("..")) {
    return fromDocument;
  }
  return displayPath(target, collector.cwd);
}

/**
 * Turn `/docs/guide.md` into the relative path that would have worked, when
 * the repository root can be found and the file is really there.
 *
 * Only ever appended to a message. If any of it is uncertain the suggestion is
 * simply omitted — a wrong suggestion in an otherwise correct finding is the
 * same trust problem as a wrong finding.
 */
function suggestRelative(documentPath: string, linkPath: string): string {
  const root = repositoryRoot(dirname(documentPath));
  if (!root) return "";

  const target = join(root, cleanPath(linkPath));
  if (!existsSync(target)) return "";

  let suggestion = relative(dirname(documentPath), target).split(sep).join("/");
  if (!suggestion.startsWith(".")) suggestion = `./${suggestion}`;
  return ` Write \`${suggestion}\`.`;
}

/**
 * The nearest ancestor that looks like a repository root.
 *
 * `.git` is checked as a plain directory entry rather than by asking git, so
 * this still works in a bare checkout with no git on PATH (P1).
 */
function repositoryRoot(from: string): string | undefined {
  let current = from;
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    if (existsSync(join(current, ".vantage.toml"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
