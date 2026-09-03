import { unified, type Processor } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkPresetLintRecommended from "remark-preset-lint-recommended";
import remarkLintNoUndefinedReferences from "remark-lint-no-undefined-references";
import { VFile } from "vfile";
import type { Collector } from "../core/collector.js";
import { fileLine } from "../core/document.js";

/** The master switch. Everything in this family follows it unless named. */
export const HYGIENE_RULE = "markdown/hygiene";

/**
 * GitHub's alert syntax — `> [!NOTE]` — is not part of GFM, so remark parses
 * the label as a shortcut reference to a definition that does not exist. The
 * style guide tells authors to write them, so flagging them would be the checker
 * arguing with its own guide.
 *
 * Vantage **does** render them, as of `rehypeVantageAlerts` — the marker is
 * compiled into `data-vantage-alert` and never reaches the page as text. So
 * this allowance is no longer deference to the guide: it is now simply correct
 * that the label is markup rather than a broken reference, and the lint has
 * nothing to say about it either way.
 */
const ALERT_LABELS = ["!NOTE", "!TIP", "!IMPORTANT", "!WARNING", "!CAUTION"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processor: Processor<any, any, any, any, any> | undefined;

/**
 * Deliberately *not* `vantage-md`'s `buildRemarkPlugins()`, unlike
 * `core/document.ts`. This processor is lint-only and omits `remark-math` on
 * purpose, and the omission is load-bearing: measured on a fixture of two
 * `$$…$$` blocks containing `\left[ a, b \right]` and `a[0] = b[1]`,
 * `no-undefined-references` reports three findings without `remark-math` and
 * zero with it. Sharing the viewer's list here would silently change which
 * hygiene findings this family reports, so the one duplicated option below
 * stays duplicated.
 */
function lintProcessor() {
  processor ??= unified()
    .use(remarkParse)
    .use(remarkGfm, { singleTilde: false })
    .use(remarkPresetLintRecommended)
    .use(remarkLintNoUndefinedReferences, { allow: ALERT_LABELS })
    .freeze();
  return processor;
}

/**
 * General Markdown hygiene, delegated to remark-lint.
 *
 * Off by default: these are style opinions about Markdown in general, not
 * statements about whether Vantage can render the document, and the checker's
 * value rests on everything it says by default being worth acting on. Turn the
 * family on with `"markdown/hygiene" = "warning"`, and silence any single rule
 * by its own id (`"markdown/no-literal-urls" = "off"`).
 */
export async function checkMarkdownHygiene(
  collector: Collector,
): Promise<void> {
  if (!collector.enabled(HYGIENE_RULE)) return;

  const lint = lintProcessor();
  const file = new VFile({
    path: collector.doc.display,
    // The body, not the whole file: frontmatter is not Markdown, and linting it
    // reports a `tags: [a, b]` list as an undefined reference.
    value: collector.doc.frontmatter.body,
  });

  try {
    const tree = lint.parse(file);
    await lint.run(tree, file);
  } catch (error) {
    collector.fail(
      HYGIENE_RULE,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  for (const message of file.messages) {
    if (!message.ruleId) continue;
    collector.report(
      `markdown/${message.ruleId}`,
      {
        line: fileLine(collector.doc, message.line ?? 1),
        column: message.column ?? 1,
      },
      message.reason,
    );
  }
}
