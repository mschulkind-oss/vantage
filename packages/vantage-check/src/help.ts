import {
  PLANNING_AGENT_SECTION_IDS,
  PLANNING_SECTION_TITLES,
} from "../../vantage-md/src/planning/index.js";
import { RULES } from "./rules/registry.js";
import { COMMIT, DEVELOPMENT_BUILD, RELEASE, knownCommit } from "./version.js";

/** The id column is as wide as the longest id, plus two spaces. */
const RULE_WIDTH = Math.max(...RULES.map((rule) => rule.id.length)) + 2;

/**
 * The sections `--request` takes, each id with the title the page shows it
 * under, since the two differ (*Stage conflict* is `disagrees`): one per
 * line of the index options' description column.
 */
const REQUEST_ID_WIDTH =
  Math.max(...PLANNING_AGENT_SECTION_IDS.map((id) => id.length)) + 2;
const REQUEST_SECTION_LIST = PLANNING_AGENT_SECTION_IDS.map(
  (id) =>
    `${" ".repeat(39)}${id.padEnd(REQUEST_ID_WIDTH)}${PLANNING_SECTION_TITLES[id]}`,
).join("\n");

/** The same, in one line, for a usage error: `unrouted (Not on a roadmap), …`. */
export const REQUEST_SECTIONS = PLANNING_AGENT_SECTION_IDS.map(
  (id) => `${id} (${PLANNING_SECTION_TITLES[id]})`,
).join(", ");

const RULE_LIST = RULES.map(
  (rule) => `  ${rule.id.padEnd(RULE_WIDTH)}${rule.summary}`,
).join("\n");

export const USAGE = `vantage-check — Vantage's Markdown conventions, and a check that a document really renders

Usage:
  vantage-check <path>...            check files and directories (the default command)
  vantage-check check <path>...      the same thing, said explicitly
  vantage-check index                print the project's planning index: each
                                     section, what it means and who acts on it,
                                     then the chosen roadmap with each link's
                                     badge
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
  --request [<section>...]           print instead the request to give an agent
                                     for these sections, as the planning page's
                                     Copy agent request buttons copy it
                                     (default: all four):
${REQUEST_SECTION_LIST}
  --roadmap <path>                   the roadmap Needs you follows, relative to
                                     the project root (default: the one nearest
                                     the root that can be read and has no stage
                                     with the done role)
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
  2  bad arguments, a bad .vantage.toml, a .vantage.toml whose target is
     newer than this checker, or a path that does not exist
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

A top-level target, written above the first [table], names the oldest Vantage
release this repository's readers use. A checker older than it refuses to run
and names the release it needs; any other says on stderr that it read it. Under
a target before 0.8, check asks for oq, not question, on an open question
(vantage/oq-deprecated, vantage/oq-missing): a viewer before 0.8 answers only
an oq in one click.

  target = "0.8"

A key, rule id or rule option this checker does not know is ignored with a
warning on stderr, since a newer vantage-check may know it.

Everything works offline against files on disk: no server, no port, no network.
`;

/**
 * `vantage-check 0.8.0` for a release, and `vantage-check development build
 * (2a179b7)` for anything else — never the manifest's placeholder, which is no
 * release at all (`docs/design/checker-version-skew.md` §4.2).
 */
export function versionLine(
  release: string | undefined = RELEASE,
  commit: string = COMMIT,
): string {
  if (release !== undefined) return `vantage-check ${release}\n`;
  const at = knownCommit(commit);
  return `vantage-check ${DEVELOPMENT_BUILD}${at === undefined ? "" : ` (${at})`}\n`;
}
