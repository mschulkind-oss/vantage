import { EXIT_OK, EXIT_USAGE } from "./exit.js";
import type { Io } from "./io.js";
import { USAGE, versionLine } from "./help.js";
import { styleGuideCommand } from "./commands/styleGuide.js";
import { checkCommand, type CheckOptions } from "./commands/check.js";

export type Invocation =
  | { kind: "check"; options: CheckOptions }
  | { kind: "style-guide" }
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "usage-error"; message: string };

const COMMANDS = new Set(["check", "style-guide", "version", "help"]);

/**
 * Turn argv (already stripped of node and the script path) into an invocation.
 *
 * Kept separate from `run` so the dispatch table is testable without touching a
 * filesystem or a process.
 *
 * A first argument that is neither a command nor a flag is taken as a path to
 * check, so `vantage-check docs/` does the obvious thing. That is the form the
 * review payload tells agents to run, and making them remember a subcommand
 * first would be a way to lose them.
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
      default:
        return { kind: "usage-error", message: `unknown option: ${name}` };
    }
  }

  return { kind: "check", options };
}

/** Run one invocation and return the process exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
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
    case "check":
      return checkCommand(invocation.options, io);
    case "usage-error":
      io.err(`vantage-check: ${invocation.message}\n\n`);
      io.err(USAGE);
      return EXIT_USAGE;
  }
}
