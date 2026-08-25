/**
 * lint/* — opt-in Markdown style linting via remark-lint's recommended preset.
 * Runs the same remark plugins the viewer uses (GFM) so lint sees the same
 * tree. Each remark-lint message becomes a `lint/<ruleId>` finding at warning
 * severity (see config defaults). Off by default; enabled per-repo via
 * `[check.lint] enabled = true` in .vantage.toml.
 */

import { unified } from "unified";
import { VFile } from "vfile";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkPresetLintRecommended from "remark-preset-lint-recommended";
import { EnvironmentFailure, type Validator } from "./types.js";

export const validateLint: Validator = {
  id: "lint",
  async run(doc) {
    let file: VFile;
    try {
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkPresetLintRecommended);
      file = new VFile({ value: doc.body });
      await processor.run(processor.parse(file), file);
    } catch (e) {
      throw new EnvironmentFailure(
        "lint",
        `remark-lint failed to run: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return file.messages.map((m) => ({
      file: doc.rel,
      rule: `lint/${m.ruleId ?? "unknown"}`,
      severity: "warning" as const,
      line: (m.line ?? 0) + doc.bodyLineOffset,
      message: m.message,
    }));
  },
};
