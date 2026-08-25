import { Command } from "commander";
import { existsSync } from "node:fs";
import { STYLE_GUIDE_SNIPPET } from "vantage-md";
import { exitCode, runCheck } from "./check.js";
import { formatHuman, formatJson } from "./output.js";
import type { Finding, Report } from "./types.js";
import { COMMIT, VERSION } from "./version.js";

const program = new Command();

program
  .name("vantage-check")
  .description(
    "Check Vantage documents against the pipeline that renders them.",
  )
  .version(`${VERSION}${COMMIT !== "dev" ? ` (commit ${COMMIT})` : ""}`);

program
  .command("style-guide")
  .description(
    "Print the canonical Markdown style guide for Vantage documents.",
  )
  .action(() => {
    // .trim() matches the frontend modal's copy behavior exactly.
    process.stdout.write(STYLE_GUIDE_SNIPPET.trim() + "\n");
  });

program
  .command("check [paths...]", { isDefault: true })
  .description("Verify that a document or directory really renders in Vantage.")
  .option("--strict", "treat warnings as errors", false)
  .option("--format <format>", "output format: text or json", "text")
  .action((paths: string[], opts: { strict: boolean; format: string }) => {
    const targets = paths.length > 0 ? paths : ["."];
    const strict = Boolean(opts.strict);

    for (const t of targets) {
      if (!existsSync(t)) {
        process.stderr.write(
          `vantage-check: no such file or directory: ${t}\n`,
        );
        process.exitCode = 2;
        return;
      }
    }

    const merged: Report = { files: 0, findings: [] as Finding[] };
    for (const t of targets) {
      const r = runCheck(t);
      merged.files += r.files;
      merged.findings.push(...r.findings);
    }

    const out =
      opts.format === "json" ? formatJson(merged) : formatHuman(merged);
    process.stdout.write(out.endsWith("\n") ? out : out + "\n");
    process.exitCode = exitCode(merged, strict);
  });

program.parse(process.argv);
