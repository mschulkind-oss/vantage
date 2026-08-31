import { RULES } from "./rules/registry.js";
import { VERSION } from "./version.js";

const RULE_LIST = RULES.map(
  (rule) => `  ${rule.id.padEnd(26)}${rule.summary}`,
).join("\n");

export const USAGE = `vantage-check — Vantage's Markdown conventions, and a check that a document really renders

Usage:
  vantage-check <path>...            check files and directories (the default command)
  vantage-check check <path>...      the same thing, said explicitly
  vantage-check style-guide          print the Vantage Markdown style guide
  vantage-check version              print the version
  vantage-check help                 print this message

Options for check:
  --format text|json                 output format (default: text)
  --strict                           fail the run on warnings as well as errors
  -q, --quiet                        drop the summary line
  --color / --no-color               force colour on or off
  --config <path>                    use this .vantage.toml
  --no-config                        ignore .vantage.toml entirely

Exit codes:
  0  nothing to fix
  1  findings that fail the run
  2  bad arguments, or a path that does not exist
  3  a check could not run — the documents were not fully checked, so the
     result is unknown rather than clean

Rules:
${RULE_LIST}

Configuration is optional. A .vantage.toml at the repository root can set rule
severities ("error", "warning", "off"), and check.strict / check.exit-code:

  [check]
  strict = false

  [check.rules]
  "link/dead-section-anchor" = "warning"

Everything works offline against files on disk: no server, no port, no network.
`;

export function versionLine(): string {
  return `vantage-check ${VERSION}\n`;
}
