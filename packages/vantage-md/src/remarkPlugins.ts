/**
 * The mdast half of the Vantage chain (`pipeline.ts`), in a module of its own
 * so that what imports it imports no rehype plugin.
 *
 * The planning scan parses with it, and the scan runs in a worker
 * (`docs/reference/planning-index.md` §10): `pipeline.ts` also imports
 * `rehype-katex`, whose browser build builds a `DOMParser` the moment it
 * loads, and a worker has none. A production bundle shakes those imports out,
 * but the dev server loads every module a module imports, so the worker would
 * die on its first import. `pipeline.ts` re-exports it, so every other caller
 * is unchanged.
 */

import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PipelineOptions } from "./pipeline.js";

/**
 * The mdast half of the chain. Exported on its own because there is a real
 * mdast-only consumer: the CLI checker parses documents without ever running
 * rehype (`packages/vantage-check/src/core/document.ts`), and it has to parse
 * them exactly the way the viewer does.
 */
export function buildRemarkPlugins(
  options: PipelineOptions = {},
): PluggableList {
  const { gfm = true, math = true } = options;
  const plugins: PluggableList = [];
  // `singleTilde: false` — `~x~` is not strikethrough, so a lone tilde in
  // prose survives. `singleDollarTextMath: false` — `$` is not a math
  // delimiter, so `$HOME` and `$100` stay literal. Both are contracts the
  // style guide and the user guide state, not preferences.
  if (gfm) plugins.push([remarkGfm, { singleTilde: false }]);
  if (math) plugins.push([remarkMath, { singleDollarTextMath: false }]);
  return plugins;
}
