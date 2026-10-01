/**
 * Run the viewer's Markdown pipeline once before a page's first card needs it
 * (`docs/reference/planning-index.md` §6.10).
 *
 * The first time the pipeline runs in a page load it costs several times what
 * any later run does: none of its code has been compiled yet, and
 * `rehype-highlight` builds its grammars for the first time. React renders the
 * sections in a transition and yields between cards, but one card's Markdown
 * is one component it cannot split, so on a direct load of the planning page
 * that first card was a main-thread task of 50–70 ms with the CPU slowed 2×.
 *
 * So a page opened while its index builds, when the main thread has nothing
 * else to do, runs the same chain over a few short samples, one per task, and
 * its first card then costs what every other card does
 * (`usePlanningPageInputs`). `g p` from a document needs none of it: the
 * document already ran the pipeline.
 */
import ReactMarkdown from "react-markdown";
import { buildPipeline } from "vantage-md";
import {
  rehypeCollectMarkdownLinks,
  rehypeMarkMarkdownLinks,
} from "../hooks/usePlanningLinkBadges";

/**
 * What a card holds, a little of each, spread over separate tasks so that no
 * one of them pays for all of the first run: a paragraph; a question in a
 * list, with its directive, a leaning and an answer; a heading, a table, raw
 * HTML and an alert; and highlighted code.
 */
export const WARM_SAMPLES: readonly string[] = [
  "Warm.",
  [
    "1. 💬 **OQ-W1: Is this [warm](other.md#OQ-W2)?** It reads `code`, _em_",
    "   and ~~struck~~ text.",
    "",
    '   <!-- vantage: oq id=OQ-W1 leaning="Yes." -->',
    "",
    "   _Leaning:_ yes.",
    "",
    "   **Answer:**",
    "",
    "   > _(empty — fill in when decided)_",
    "",
    "   - a nested item",
    "   - [x] a task",
  ].join("\n"),
  [
    "## A heading",
    "",
    "| A | B |",
    "| :--- | ---: |",
    "| 1 | <kbd>2</kbd> |",
    "",
    "> [!NOTE]",
    "> A note.",
  ].join("\n"),
  ["```ts", "const warm = true;", "```"].join("\n"),
];

let warmed: Promise<void> | null = null;

/**
 * Run the pipeline over each of {@link WARM_SAMPLES}, one per task, once per
 * page load: asking again waits for the same run. Resolves when the last has
 * run. A sample the pipeline throws on is skipped; a card rendering the same
 * thing says so where it stands.
 */
export function warmMarkdown(): Promise<void> {
  warmed ??= new Promise((resolve) => {
    const { remarkPlugins, rehypePlugins } = buildPipeline();
    // The viewer's own chain (`MarkdownViewer.tsx`), around the shared one.
    const plugins = [
      rehypeCollectMarkdownLinks,
      ...rehypePlugins,
      rehypeMarkMarkdownLinks,
    ];
    let at = 0;
    const step = () => {
      try {
        // The component is a plain function of its props: calling it runs the
        // whole pipeline, and the elements it returns are dropped.
        ReactMarkdown({
          children: WARM_SAMPLES[at],
          remarkPlugins,
          rehypePlugins: plugins,
        });
      } catch {
        // Nothing to warm from this one.
      }
      at += 1;
      if (at < WARM_SAMPLES.length) setTimeout(step, 0);
      else resolve();
    };
    setTimeout(step, 0);
  });
  return warmed;
}

/** Forget that the pipeline has run. For tests. */
export function resetWarmMarkdown(): void {
  warmed = null;
}
