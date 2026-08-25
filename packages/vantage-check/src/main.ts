import { Command } from "commander";
import { STYLE_GUIDE_SNIPPET } from "vantage-md";
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

program.parse(process.argv);
