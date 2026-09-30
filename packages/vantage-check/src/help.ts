import { RULES } from "./rules/registry.js";
import { VERSION } from "./version.js";

/** The id column is as wide as the longest id, plus two spaces. */
const RULE_WIDTH = Math.max(...RULES.map((rule) => rule.id.length)) + 2;

const RULE_LIST = RULES.map(
  (rule) => `  ${rule.id.padEnd(RULE_WIDTH)}${rule.summary}`,
).join("\n");

export const USAGE = `vantage-check — Vantage's Markdown conventions, and a check that a document really renders

Usage:
  vantage-check <path>...            check files and directories (the default command)
  vantage-check check <path>...      the same thing, said explicitly
  vantage-check index                print the project's planning index: what
                                     needs a ruling, what waits, and the chosen
                                     roadmap with each link's badge
  vantage-check style-guide          print the Vantage Markdown style guide
  vantage-check version              print the version
  vantage-check help                 print this message

Options for check:
  --format text|json                 output format (default: text)
  --strict                           fail the run on warnings as well as errors
  -q, --quiet                        drop the summary line
  --color / --no-color               force color on or off
  --config <path>                    use this .vantage.toml
  --no-config                        ignore .vantage.toml entirely
  -j, --jobs <n>|auto                threads to check with (default: auto — one
                                     per 12 files, at most 6). --jobs 1 checks
                                     in this thread alone. VANTAGE_CHECK_JOBS
                                     sets the default for a machine.

Options for index:
  --format text|json                 output format (default: text)
  --roadmap <path>                   the roadmap Needs you follows, relative to
                                     the project root (default: the roadmap
                                     nearest the root that routes)
  --config <path>                    use this .vantage.toml
  --no-config                        ignore .vantage.toml entirely

A command's name is not a path: to check a file or directory called index,
write ./index.

index scans the project root: the working directory, or the nearest directory
above it, that holds .git or .vantage.toml, and the working directory itself
when none does. --config chooses the config, never the project.

Exit codes:
  0  nothing to fix; for index, it ran
  1  findings that fail the run (never from index, which reports and does not
     judge)
  2  bad arguments, a bad .vantage.toml, or a path that does not exist
  3  a check could not run — the documents were not fully checked, so the
     result is unknown rather than clean. For index: the project has more
     candidate files than [planning] max-candidates, so nothing was scanned

Rules:
${RULE_LIST}

Configuration is optional. A .vantage.toml at the repository root can set rule
severities ("error", "warning", "off"), and check.strict / check.exit-code:

  [check]
  strict = false

  [check.rules]
  "link/dead-section-anchor" = "warning"

The same file's [planning] table says which files are planning documents and
what their stages mean, for index and the planning/* rules. With no roadmap
key, every roadmap.md the planning index reads is a roadmap (one in a hidden
directory, matched by .vantageignore, or ruled out by include or exclude is
not); roadmap names exactly the ones to read instead, as one path or a list:

  [planning]
  # roadmap = "plans/roadmap.md"
  # roadmap = ["roadmap.md", "docs/plans/roadmap.md"]
  exclude = ["docs/gallery/**"]

  [planning.stages]
  DESIGN = "open"
  DECIDED = "ready"
  BUILT = "built"
  SUPERSEDED = "done"

Everything works offline against files on disk: no server, no port, no network.
`;

export function versionLine(): string {
  return `vantage-check ${VERSION}\n`;
}
