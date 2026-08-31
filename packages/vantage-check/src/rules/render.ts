import { renderMarkdown } from "../../../vantage-md/src/renderMarkdown.js";
import type { Collector, FilePosition } from "../core/collector.js";
import { fileLine } from "../core/document.js";

const RULE = "render/pipeline";

/**
 * The backstop: run the whole document through the viewer's own renderer.
 *
 * Every other rule asks a specific question — does this path resolve, does
 * KaTeX accept this formula, does Mermaid accept this diagram. This one asks
 * the only question that actually matters to a reader: *does the page come
 * out*. `renderMarkdown` is not a stand-in for the viewer's pipeline, it is
 * the pipeline — the same function, with the same plugins in the same order,
 * imported from source — so whatever the specific rules do not cover, a throw
 * here still catches.
 *
 * Classification is unusually easy for a delegated engine, and worth saying
 * out loud. Mermaid and KaTeX have to be careful because *our* environment
 * differs from the browser's: mermaid reaches for a DOM, so a throw may be
 * about us rather than the document. Nothing in this pipeline does. remark,
 * rehype, `rehype-raw`, `rehype-sanitize`, `rehype-highlight` and
 * `rehype-katex` are pure JavaScript over strings, and run here exactly as
 * they run in the browser. So once the canary below proves the pipeline runs
 * at all, a throw is a statement about the document, and the viewer would
 * throw on it too.
 *
 * Cost is one render per document — a few milliseconds — which is the price of
 * the only end-to-end check in the tool.
 */

/** A document we know renders: the plugins that could break, all at once. */
const CANARY = [
  "---",
  'title: "Canary"',
  "---",
  "",
  "# Canary",
  "",
  "A [link](./other.md), `code`, and $$E = mc^2$$.",
  "",
  "| Column | Value |",
  "| ------ | ----- |",
  "| one    | two   |",
  "",
  "```ts",
  "export const x = 1;",
  "```",
  "",
  '<div id="raw">raw html</div>',
].join("\n");

/** Just enough of `renderMarkdown` to call it. Tests substitute their own. */
export type Render = (content: string) => Promise<unknown>;

type Health = { ok: true } | { ok: false; message: string };

/**
 * One canary per renderer, for the life of the process.
 *
 * Keyed by the function so the real pipeline is proved once per run and a
 * test's stub never inherits that verdict.
 */
const canaries = new WeakMap<Render, Promise<Health>>();

export async function checkPipeline(
  collector: Collector,
  render: Render = renderMarkdown,
): Promise<void> {
  if (!collector.enabled(RULE)) return;

  const health = await ensurePipeline(render);
  if (!health.ok) {
    collector.fail(RULE, health.message);
    return;
  }

  try {
    await render(collector.doc.text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    collector.report(
      RULE,
      positionOf(error, collector),
      "Vantage's render pipeline throws on this document, so the viewer shows nothing at all.",
      message,
    );
  }
}

/**
 * Prove the pipeline renders a document we know is good, before it is allowed
 * to judge anybody else's.
 *
 * If a future plugin does start reaching for a browser, this is what stops the
 * rule reporting every document in the repository as broken: the run fails
 * with "could not check", which is the honest answer, instead of handing an
 * agent a tree full of invented errors.
 */
async function ensurePipeline(render: Render): Promise<Health> {
  let probe = canaries.get(render);
  if (!probe) {
    probe = (async (): Promise<Health> => {
      try {
        await render(CANARY);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          message: `the render pipeline cannot run in this environment (${message}), so no document was rendered`,
        };
      }
    })();
    canaries.set(render, probe);
  }
  return probe;
}

/**
 * Where to point the finding.
 *
 * unified errors are `VFileMessage`s and often carry a position; it is
 * relative to the *body*, because `renderMarkdown` strips frontmatter before
 * parsing, so it goes through `fileLine` like every other position in the
 * tool. With nothing to go on the finding lands on line 1: the statement is
 * about the document as a whole.
 */
function positionOf(error: unknown, collector: Collector): FilePosition {
  const place = error as { line?: unknown; column?: unknown } | undefined;
  if (typeof place?.line !== "number") return { line: 1, column: 1 };
  return {
    line: fileLine(collector.doc, place.line),
    column: typeof place.column === "number" ? place.column : 1,
  };
}
