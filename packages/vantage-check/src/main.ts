import { Command } from "commander";
import { existsSync } from "node:fs";
import { STYLE_GUIDE_SNIPPET } from "vantage-md";
import { exitCode, runCheck } from "./check.js";
import { ConfigError } from "./config.js";
import { formatHuman, formatJson } from "./output.js";
import type { Report } from "./types.js";
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
  .option(
    "--config <path>",
    "use this .vantage.toml instead of discovering one",
  )
  .action(
    async (
      paths: string[],
      opts: { strict: boolean; format: string; config?: string },
    ) => {
      const targets = paths.length > 0 ? paths : ["."];
      const strict = Boolean(opts.strict);
      const configPath = opts.config ?? null;

      for (const t of targets) {
        if (!existsSync(t)) {
          process.stderr.write(
            `vantage-check: no such file or directory: ${t}\n`,
          );
          process.exitCode = 2;
          return;
        }
      }

      const merged: Report = {
        files: 0,
        findings: [],
        unchecked: [],
        environmentError: null,
        configError: null,
        strict,
      };
      const unchecked = new Set<string>();
      try {
        for (const t of targets) {
          const r = await runCheck(t, { strict, configPath });
          merged.files += r.files;
          merged.findings.push(...r.findings);
          r.unchecked.forEach((u) => unchecked.add(u));
          merged.environmentError ??= r.environmentError;
          merged.configError ??= r.configError;
          merged.strict = merged.strict || r.strict;
        }
      } catch (e) {
        if (e instanceof ConfigError) {
          merged.configError = e.message;
        } else {
          throw e;
        }
      }
      merged.unchecked = [...unchecked].sort();

      const out =
        opts.format === "json" ? formatJson(merged) : formatHuman(merged);
      process.stdout.write(out.endsWith("\n") ? out : out + "\n");
      process.exitCode = exitCode(merged);
    },
  );

program.parse(process.argv);
