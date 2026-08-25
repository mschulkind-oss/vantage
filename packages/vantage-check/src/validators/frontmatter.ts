/**
 * frontmatter — surface a broken frontmatter block the way the strict parser
 * sees it. `parseFrontmatter` (which the viewer uses) silently swallows a bad
 * block, so it can't detect breakage; this validator uses
 * `parseFrontmatterStrict` to report it.
 *
 *   - frontmatter/unclosed  (warning) — delimiter opened, never closed
 *   - frontmatter/invalid   (error)   — block present but not valid YAML/TOML
 */

import { parseFrontmatterStrict } from "vantage-md";
import type { Finding } from "../types.js";
import type { Validator } from "./types.js";

export const validateFrontmatter: Validator = {
  id: "frontmatter",
  run(doc) {
    const strict = parseFrontmatterStrict(doc.content);
    const findings: Finding[] = [];
    if (strict.unclosed) {
      findings.push({
        file: doc.rel,
        rule: "frontmatter/unclosed",
        severity: "warning",
        line: 1,
        message:
          "frontmatter block is opened with a delimiter but never closed — it will render as visible text",
      });
    }
    if (strict.error !== null) {
      findings.push({
        file: doc.rel,
        rule: "frontmatter/invalid",
        severity: "error",
        line: 1,
        message: `frontmatter is not valid ${
          strict.format === "toml" ? "TOML" : "YAML"
        }: ${strict.error.replace(/\s+/g, " ").slice(0, 160)}`,
      });
    }
    return findings;
  },
};
