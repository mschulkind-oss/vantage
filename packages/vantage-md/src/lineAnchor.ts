/**
 * Parsing for GitHub-style line anchors, with no DOM in sight.
 *
 * Split out from scrollToLineAnchor.ts so that non-browser consumers — the
 * `vantage-check` CLI, which validates `#L42` links against the file on disk —
 * can share the *same* syntax the viewer honours instead of reimplementing it
 * and drifting.
 */

/**
 * Parse a GitHub-style line anchor hash.
 * Supports: #L42, #L42-L50, #L42-50
 * Returns null if the hash is not a line anchor.
 */
export function parseLineAnchor(
  hash: string,
): { start: number; end: number } | null {
  if (!hash) return null;
  const frag = hash.startsWith("#") ? hash.slice(1) : hash;
  const match = frag.match(/^L(\d+)(?:-L?(\d+))?$/);
  if (!match) return null;

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : start;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}
