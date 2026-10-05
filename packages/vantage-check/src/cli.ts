import { EXIT_OK, EXIT_USAGE } from "./exit.js";
import type { Io } from "./io.js";
import { REQUEST_SECTIONS, USAGE, versionLine } from "./help.js";
import { styleGuideCommand } from "./commands/styleGuide.js";
import {
  checkCommand,
  parseJobs,
  type CheckOptions,
} from "./commands/check.js";
import type { RunShard } from "./core/parallel.js";
import { indexCommand, type IndexOptions } from "./commands/index.js";
import { isPlanningAgentSectionId } from "../../vantage-md/src/planning/index.js";

export type Invocation =
  | { kind: "check"; options: CheckOptions }
  | { kind: "index"; options: IndexOptions }
  | { kind: "style-guide" }
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "usage-error"; message: string };

const COMMANDS = new Set(["check", "index", "style-guide", "version", "help"]);

/**
 * Turn argv (already stripped of node and the script path) into an invocation.
 *
 * Kept separate from `run` so the dispatch table is testable without touching a
 * filesystem or a process.
 *
 * A first argument that is neither a command nor a flag is taken as a path to
 * check, so `vantage-check docs/` does the obvious thing. That is the form the
 * review payload tells agents to run, and making them remember a subcommand
 * first would be a way to lose them. The cost is that a command's name is not
 * a path: `vantage-check index` runs `index`, and a file called `index` is
 * checked as `vantage-check ./index`.
 */
export function parseArgs(argv: string[]): Invocation {
  if (argv.length === 0) return { kind: "help" };

  const first = argv[0] as string;
  if (first === "-h" || first === "--help" || first === "help") {
    return { kind: "help" };
  }
  if (first === "-V" || first === "--version" || first === "version") {
    return { kind: "version" };
  }
  if (first === "style-guide") {
    const rest = argv.slice(1);
    if (rest.length > 0) {
      return {
        kind: "usage-error",
        message: `style-guide takes no arguments (got ${rest.join(" ")})`,
      };
    }
    return { kind: "style-guide" };
  }
  if (first === "check") return parseCheck(argv.slice(1));
  if (first === "index") return parseIndex(argv.slice(1));
  if (!first.startsWith("-")) return parseCheck(argv);

  return { kind: "usage-error", message: `unknown option: ${first}` };
}

function parseCheck(argv: string[]): Invocation {
  const options: CheckOptions = {
    paths: [],
    format: "text",
    strict: false,
    quiet: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;

    if (arg === "--") {
      options.paths.push(...argv.slice(index + 1));
      break;
    }

    if (!arg.startsWith("-")) {
      if (COMMANDS.has(arg) && options.paths.length === 0) {
        return {
          kind: "usage-error",
          message: `\`${arg}\` is a command, not a path — put it first`,
        };
      }
      options.paths.push(arg);
      continue;
    }

    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : arg.slice(equals + 1);
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      index++;
      return argv[index];
    };

    switch (name) {
      case "--format": {
        const value = takeValue();
        if (value !== "text" && value !== "json") {
          return {
            kind: "usage-error",
            message: `--format takes text or json (got ${value ?? "nothing"})`,
          };
        }
        options.format = value;
        break;
      }
      case "--strict":
        options.strict = true;
        break;
      case "-q":
      case "--quiet":
        options.quiet = true;
        break;
      case "--color":
        options.color = true;
        break;
      case "--no-color":
        options.color = false;
        break;
      case "--config": {
        const value = takeValue();
        if (value === undefined) {
          return { kind: "usage-error", message: "--config needs a path" };
        }
        options.configPath = value;
        break;
      }
      case "--no-config":
        options.noConfig = true;
        break;
      case "-j":
      case "--jobs": {
        const value = takeValue();
        if (value === undefined) {
          return { kind: "usage-error", message: "--jobs needs a number" };
        }
        try {
          options.jobs = parseJobs(value, "--jobs");
        } catch (error) {
          return { kind: "usage-error", message: (error as Error).message };
        }
        break;
      }
      default:
        return { kind: "usage-error", message: `unknown option: ${name}` };
    }
  }

  return { kind: "check", options };
}

/**
 * `index [--format text|json] [--request [<section>...]] [--roadmap <path>]
 * [--filter <text>] [--config <path> | --no-config]`. It takes no paths: it
 * scans the project the working directory belongs to, so a path would be a
 * second answer to a question the root already settles. `--roadmap` chooses
 * which roadmap Needs you follows, and given twice, the last wins, as
 * `--config` does.
 *
 * `--request` takes the words after it, up to the next option, as agent
 * section ids, none meaning all four; given twice, the ids add up. It prints
 * text, so it refuses `--format json`.
 *
 * `--filter` takes the next argument whatever it is, so `--filter -path:x` is
 * a filter this release does not understand rather than an unknown option.
 * Given twice, the values join with one space, in order, which is what typing
 * both into the planning page's Filter box gives
 * (`docs/design/planning-filter.md` §8.1). Whether the text is understood is
 * the command's to say, not the parser's: it exits 2 with its own message.
 */
function parseIndex(argv: string[]): Invocation {
  const options: IndexOptions = { format: "text" };
  let format: string | undefined;
  /** Whether a bare word is a section id: only straight after `--request`'s. */
  let requesting = false;
  /** Add one `--request` section, or say why it is not one. */
  const request = (word: string): Invocation | null => {
    if (!isPlanningAgentSectionId(word)) {
      return {
        kind: "usage-error",
        message: `--request takes the sections an agent works on: ${REQUEST_SECTIONS} (got ${word})`,
      };
    }
    options.request ??= [];
    if (!options.request.includes(word)) options.request.push(word);
    return null;
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (requesting && !arg.startsWith("-")) {
      const refused = request(arg);
      if (refused !== null) return refused;
      continue;
    }
    requesting = false;
    if (!arg.startsWith("-") || arg === "--") {
      return {
        kind: "usage-error",
        message: `index takes no paths (got ${argv.slice(index).join(" ")}); it scans the project the working directory is in`,
      };
    }

    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : arg.slice(equals + 1);
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      index++;
      return argv[index];
    };

    switch (name) {
      case "--format": {
        const value = takeValue();
        if (value !== "text" && value !== "json") {
          return {
            kind: "usage-error",
            message: `--format takes text or json (got ${value ?? "nothing"})`,
          };
        }
        options.format = value;
        format = value;
        break;
      }
      case "--config": {
        const value = takeValue();
        if (value === undefined) {
          return { kind: "usage-error", message: "--config needs a path" };
        }
        options.configPath = value;
        break;
      }
      case "--no-config":
        options.noConfig = true;
        break;
      case "--request": {
        options.request ??= [];
        requesting = true;
        // `--request=graduate` names its first section inline.
        const refused = inlineValue === undefined ? null : request(inlineValue);
        if (refused !== null) return refused;
        break;
      }
      case "--roadmap": {
        const value = takeValue();
        if (value === undefined) {
          return { kind: "usage-error", message: "--roadmap needs a path" };
        }
        options.roadmap = value;
        break;
      }
      case "--filter": {
        const value = takeValue();
        if (value === undefined) {
          return {
            kind: "usage-error",
            message:
              "--filter needs a filter text, such as 'path:/docs/design/x.md is:open'",
          };
        }
        options.filter =
          options.filter === undefined ? value : `${options.filter} ${value}`;
        break;
      }
      default:
        return {
          kind: "usage-error",
          message: `unknown option for index: ${name}`,
        };
    }
  }

  if (options.request !== undefined && format === "json") {
    return {
      kind: "usage-error",
      message: "--request prints text, so it takes no --format json",
    };
  }
  return { kind: "index", options };
}

/** Run one invocation and return the process exit code. */
export async function run(
  argv: string[],
  io: Io,
  /** How a check's shards are run. Tests substitute an in-process runner. */
  runShard?: RunShard,
): Promise<number> {
  const invocation = parseArgs(argv);

  switch (invocation.kind) {
    case "help":
      io.out(USAGE);
      return EXIT_OK;
    case "version":
      io.out(versionLine());
      return EXIT_OK;
    case "style-guide":
      return styleGuideCommand(io);
    case "index":
      return indexCommand(invocation.options, io);
    case "check":
      return runShard === undefined
        ? checkCommand(invocation.options, io)
        : checkCommand(invocation.options, io, runShard);
    case "usage-error":
      io.err(`vantage-check: ${invocation.message}\n\n`);
      io.err(USAGE);
      return EXIT_USAGE;
  }
}
