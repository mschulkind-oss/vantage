/**
 * The one definition of the Vantage remark/rehype chain.
 *
 * Three call sites render Markdown — `renderMarkdown` (string in, HTML out,
 * which is what the CLI checker runs), the app's `<MarkdownViewer>`, and this
 * package's exported `<MarkdownViewer>` — and each one used to hand-write the
 * same plugin list in the same order. Three copies kept in sync by hand is how
 * a plugin lands in the viewer and not in the checker: a document that styles
 * in the app and renders bare through the tool that is supposed to validate it,
 * with no error anywhere.
 *
 * The order is load-bearing, not incidental:
 *
 * - `rehypeRaw` first: `remark-rehype` runs with `allowDangerousHtml: true`,
 *   so raw HTML is still a string until this plugin parses it.
 * - `rehypeSourceLines` before `rehypeSanitize`: `data-source-line` has to be
 *   an allowlisted attribute on an element the sanitiser keeps.
 * - `rehypeVantageAnchors`, `rehypeSlug`, `rehypeHighlight` and `rehypeKatex`
 *   after `rehypeSanitize`. For the first two this is not a preference: the
 *   sanitiser's default schema clobbers `id` with the prefix `user-content-`,
 *   so writing one before it turns every `#heading` and every `#OQ-4` link in
 *   every document into a dead anchor. `rehypeVantageAnchors` precedes
 *   `rehypeSlug` because `rehype-slug` leaves an element that already has an
 *   `id` alone. For the other two, being here means their output is trusted
 *   rather than filtered — KaTeX emits inline `style` on nearly every glyph.
 *
 * Anything that reads HTML comments must sit between `rehypeRaw` and
 * `rehypeSanitize`: before `rehypeRaw` there are no comment nodes, and
 * `rehypeSanitize` deletes them. `rehypeVantageDirectives` is what occupies
 * that slot, and it is registered unconditionally — a renderer that skipped it
 * would disagree with the others about what a document means.
 */

import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeVantageAnchors from "./rehypeVantageAnchors.js";
import rehypeSourceLines from "./rehypeSourceLines.js";
import { rehypeVantageAlerts } from "./rehypeVantageAlerts.js";
import rehypeVantageDirectives from "./rehypeVantageDirectives.js";
import {
  rehypeCaptureMathStamps,
  rehypeRestoreMathStamps,
} from "./rehypeVantageMathStamps.js";
import { sanitizeSchema } from "./sanitize.js";

export interface PipelineOptions {
  /** GFM tables, strikethrough, task lists (default: true) */
  gfm?: boolean;
  /** KaTeX math, `$$…$$` only (default: true) */
  math?: boolean;
  /** Syntax highlighting via highlight.js (default: true) */
  highlight?: boolean;
  /** `data-source-line` attributes for line anchors (default: true) */
  sourceLines?: boolean;
  /** XSS sanitisation (default: true) */
  sanitize?: boolean;
  /**
   * Lines the frontmatter consumed, added to every emitted line number so
   * `data-source-line` names a line in the *file* rather than in the parsed
   * body — which is what a `#L42` link written against the file means.
   * Defaults to 0. Ignored when `sourceLines` is false.
   */
  bodyLineOffset?: number;
}

export interface Pipeline {
  remarkPlugins: PluggableList;
  rehypePlugins: PluggableList;
}

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

/** The hast half. Deliberately not exported: see `buildPipeline`. */
function buildRehypePlugins(options: PipelineOptions = {}): PluggableList {
  const {
    math = true,
    highlight = true,
    sourceLines = true,
    sanitize = true,
    bodyLineOffset = 0,
  } = options;

  const plugins: PluggableList = [rehypeRaw];
  if (sourceLines) {
    plugins.push([rehypeSourceLines, { offset: bodyLineOffset }]);
  }
  // ── The comment slot ──────────────────────────────────────────────────
  // `rehypeVantageDirectives` compiles `<!-- vantage: … -->` comments into
  // `data-vantage-*` attributes, and it can only do that here: before
  // `rehypeRaw` there are no comment nodes, and `rehypeSanitize` deletes them.
  // It gets no option of its own: every renderer has to agree about what a
  // document means, and a flag is a way for them to disagree.
  // GFM alerts. After `rehypeSourceLines` so the title it injects carries no
  // `data-source-line` and therefore cannot become a review anchor, and before
  // the sanitiser so its one attribute is allowlisted like every other
  // `data-vantage-*`. No option of its own, for the same reason the directives
  // plugin has none: a flag is a way for two renderers to disagree about what a
  // document means.
  plugins.push(rehypeVantageAlerts);
  plugins.push(rehypeVantageDirectives);
  if (sanitize) plugins.push([rehypeSanitize, sanitizeSchema]);
  // ── The id slot ───────────────────────────────────────────────────────
  // Both of these write `id`, and both are here rather than earlier for the
  // same reason: the sanitiser clobbers `id` with `user-content-`, so anything
  // that sets one upstream of it produces dead anchors in every document with
  // no error anywhere. `rehypeVantageAnchors` goes first — `rehypeSlug` skips
  // an element that already has an `id`, so promoting an Open Question's id
  // before slugging is what lets a question written as a heading keep it.
  plugins.push(rehypeVantageAnchors);
  plugins.push(rehypeSlug);
  if (highlight) plugins.push(rehypeHighlight);
  // ── The KaTeX bracket ─────────────────────────────────────────────────
  // `rehype-katex` does not decorate a display-math block, it *replaces* it:
  // `$$…$$` arrives as a `<pre>`, which `rehypeVantageDirectives` has already
  // stamped as a member of its section's run and `rehypeSourceLines` has already
  // given a `data-source-line`, and the splice throws all of that away. The two
  // plugins around it snapshot those attributes and put them back on the
  // `<span class="katex-display">` that took the block's place — which is what
  // keeps a toned section's rule continuous across a formula, a `#L` anchor
  // pointing at one resolvable, and `collapsed=true` able to hide it. They are a
  // pair and they must bracket `rehypeKatex`; see `rehypeVantageMathStamps.ts`.
  if (math) {
    plugins.push(rehypeCaptureMathStamps, rehypeKatex, rehypeRestoreMathStamps);
  }
  return plugins;
}

/**
 * Both halves from one options object.
 *
 * This is what every renderer calls. It takes one object rather than exposing
 * the two builders because `math` spans both halves — `remark-math` parses the
 * delimiters, `rehype-katex` renders the result — and two calls are two places
 * to forget the second one.
 *
 * Returns fresh arrays on every call and reads no module-level state; keep it
 * that way, so a plugin in the chain cannot become a function of how many times
 * the chain has been built.
 */
export function buildPipeline(options: PipelineOptions = {}): Pipeline {
  return {
    remarkPlugins: buildRemarkPlugins(options),
    rehypePlugins: buildRehypePlugins(options),
  };
}
