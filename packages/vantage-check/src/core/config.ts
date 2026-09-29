import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  isKnownRule,
  isOpenNamespace,
  ruleNamespaces,
} from "../rules/registry.js";
import {
  DEFAULT_PLANNING_CONFIG,
  STAGE_ROLES,
  isStageRole,
  type PlanningConfig,
  type StageRole,
} from "../../../vantage-md/src/planning/index.js";
import { Settings } from "./settings.js";
import type { RuleSetting } from "./types.js";

/** Run-level policy: what makes the run fail, and how loudly. */
export interface CheckPolicy {
  /** Warnings fail the run too. */
  strict: boolean;
  /** The exit code to use when findings fail the run. */
  exitCode: number;
}

export interface LoadedConfig {
  /** The file this came from, if any. Absent means built-in defaults. */
  path?: string;
  settings: Settings;
  policy: CheckPolicy;
  /**
   * `[planning]`, resolved: defaults applied, `stages` null when the table is
   * absent or empty. `index` and the planning rules read it
   * (`docs/design/planning-index.md` §9).
   */
  planning: PlanningConfig;
}

/** A config file that cannot be trusted. Never silently ignored. */
export class ConfigError extends Error {}

export const CONFIG_FILENAME = ".vantage.toml";

/** The largest config either reader takes: the server's `maxSize`. */
export const MAX_CONFIG_BYTES = 200 * 1024;

const DEFAULT_POLICY: CheckPolicy = { strict: false, exitCode: 1 };

export function defaultConfig(): LoadedConfig {
  return {
    settings: Settings.defaults(),
    policy: { ...DEFAULT_POLICY },
    planning: defaultPlanning(),
  };
}

/** A fresh copy: the frozen default's arrays are shared, and not frozen. */
function defaultPlanning(): PlanningConfig {
  return {
    ...DEFAULT_PLANNING_CONFIG,
    include: [...DEFAULT_PLANNING_CONFIG.include],
    exclude: [...DEFAULT_PLANNING_CONFIG.exclude],
  };
}

/**
 * The nearest `.vantage.toml`, walking up from a file or directory.
 *
 * TOML because that is what Vantage already speaks (the user-level config is
 * `<UserConfigDir>/vantage/config.toml`), and at the repository root rather
 * than inside `.vantage/`, which is transient state users are told to
 * gitignore — committed configuration inside a gitignored directory is a trap.
 */
export function findConfig(from: string, stopAt?: string): string | undefined {
  let current = directoryOf(resolve(from));
  const last = stopAt === undefined ? undefined : resolve(stopAt);

  for (;;) {
    const candidate = join(current, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current || current === last) return undefined;
    current = parent;
  }
}

export interface LoadOptions {
  /** An explicit `--config` path. Missing is an error, not a fallback. */
  explicitPath?: string;
  /** `--no-config`: use the built-in defaults and look no further. */
  noConfig?: boolean;
  /** Where discovery starts — the first target, or the working directory. */
  from: string;
  /** The last directory discovery looks in; by default it walks to `/`. */
  stopAt?: string;
}

export function loadConfig(options: LoadOptions): LoadedConfig {
  if (options.noConfig) return defaultConfig();

  const path = options.explicitPath
    ? resolve(options.explicitPath)
    : findConfig(options.from, options.stopAt);

  if (!path) return defaultConfig();
  if (options.explicitPath && !existsSync(path)) {
    throw new ConfigError(`no config file at ${options.explicitPath}`);
  }

  // Every way the read can fail becomes a ConfigError, because the caller maps
  // that family to "fix the invocation" and re-raises anything else as an
  // internal error. `existsSync` above is true for a DIRECTORY, so
  // `--config docs/` used to reach readFileSync and abort with a bare
  // `EISDIR: illegal operation on a directory` plus a stack trace into the
  // bundle — exit 3, "a check could not run", for what is a mistyped argument.
  // A permission error read the same way.
  // The server's cap (`maxSize` in internal/repoconfig): past it the server
  // reads nothing of the file and serves the defaults, so a table applied here
  // would be one the planning page never reads.
  let size = 0;
  try {
    const stats = statSync(path);
    if (stats.isFile()) size = stats.size;
  } catch {
    // The read below says why.
  }
  if (size > MAX_CONFIG_BYTES) {
    throw new ConfigError(
      `${options.explicitPath ?? path}: larger than ${MAX_CONFIG_BYTES} bytes, more than the server reads`,
    );
  }

  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    const reason =
      (error as NodeJS.ErrnoException).code === "EISDIR"
        ? "is a directory, not a config file"
        : `could not be read: ${(error as Error).message}`;
    throw new ConfigError(`${options.explicitPath ?? path} ${reason}`);
  }

  return { path, ...parseConfig(source, path) };
}

/**
 * The `[planning]` table one project's planning is read under: the table the
 * server reads for it, which is its root's own `.vantage.toml` and nothing
 * above it (`docs/design/repo-config.md` §2.2). The run's `[check]` table is
 * found by walking up from the first target, and may come from further up, or
 * from another of the run's projects; its `[planning]` is this project's only
 * when it is the root's own file. An explicit `--config` or `--no-config` is
 * taken as given, and so is the run's config for a file with no root, which
 * no file above it can have supplied.
 *
 * Throws `ConfigError` when the root's own file is malformed.
 */
export function planningConfigFor(
  loaded: LoadedConfig,
  explicit: boolean,
  root: string | null,
): PlanningConfig {
  if (explicit || root === null) return loaded.planning;
  if (loaded.path === join(resolve(root), CONFIG_FILENAME)) {
    return loaded.planning;
  }
  return loadConfig({ from: root, stopAt: root }).planning;
}

/**
 * Parse and validate a config file.
 *
 * Unknown keys and unknown rule ids are errors rather than warnings. A typo in
 * a rule name that silently disables nothing is exactly the kind of quiet
 * wrongness a checker cannot afford, and the fix is one line either way.
 */
export function parseConfig(
  source: string,
  path = CONFIG_FILENAME,
): Omit<LoadedConfig, "path"> {
  let parsed: unknown;
  try {
    parsed = parseToml(source);
  } catch (error) {
    throw new ConfigError(
      `${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const root = asTable(parsed, path, "");
  // Vantage's own config lives in this file too; other tools' sections are not
  // ours to police.
  const check =
    root["check"] === undefined ? {} : asTable(root["check"], path, "check");

  const policy: CheckPolicy = { ...DEFAULT_POLICY };
  const overrides = new Map<string, RuleSetting>();

  for (const [key, value] of Object.entries(check)) {
    switch (key) {
      case "strict":
        if (typeof value !== "boolean") {
          throw new ConfigError(`${path}: check.strict must be true or false`);
        }
        policy.strict = value;
        break;
      case "exit-code": {
        if (
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < 0 ||
          value > 125
        ) {
          throw new ConfigError(
            `${path}: check.exit-code must be a whole number between 0 and 125`,
          );
        }
        policy.exitCode = value;
        break;
      }
      case "rules": {
        const rules = asTable(value, path, "check.rules");
        for (const [id, setting] of Object.entries(rules)) {
          assertRuleId(id, path);
          overrides.set(id, asSetting(setting, id, path));
        }
        break;
      }
      default:
        throw new ConfigError(`${path}: unknown key check.${key}`);
    }
  }

  const planning =
    root["planning"] === undefined
      ? defaultPlanning()
      : parsePlanning(asTable(root["planning"], path, "planning"), path);

  return { settings: new Settings(overrides), policy, planning };
}

/**
 * `[planning]`, the one table both readers of this file parse: the server for
 * `include`, `exclude` and the two limits, the checker for all of it
 * (`docs/design/planning-index.md` §9).
 *
 * Refused whole, as `[check]` is. A table the server reads one way and the
 * checker another would let the page and the gate disagree about which files
 * are planning documents, so the rules are pinned for both readers by
 * `internal/repoconfig/testdata/planning-config.json`.
 */
function parsePlanning(
  table: Record<string, unknown>,
  path: string,
): PlanningConfig {
  const planning = defaultPlanning();
  for (const [key, value] of Object.entries(table)) {
    switch (key) {
      case "roadmap":
        planning.roadmap = asRoadmap(value, path);
        break;
      case "include":
      case "exclude":
        planning[key] = asPatterns(value, key, path);
        break;
      case "max-file-bytes":
        planning.maxFileBytes = asLimit(value, key, path);
        break;
      case "max-candidates":
        planning.maxCandidates = asLimit(value, key, path);
        break;
      case "stages":
        planning.stages = asStages(value, path);
        break;
      default:
        throw new ConfigError(
          `${path}: unknown key planning.${key}. [planning] takes roadmap, include, exclude, max-file-bytes, max-candidates and a [planning.stages] table`,
        );
    }
  }
  return planning;
}

/**
 * A repo-relative path: not empty, no leading `/`, no `..` segment. A leading
 * `./` is dropped, so the value compares equal to the paths the index holds.
 */
function asRoadmap(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ConfigError(
      `${path}: planning.roadmap must be a repo-relative path written as text`,
    );
  }
  const roadmap = value.startsWith("./") ? value.slice(2) : value;
  if (roadmap === "") {
    throw new ConfigError(`${path}: planning.roadmap is empty`);
  }
  if (roadmap.startsWith("/") || roadmap.split("/").includes("..")) {
    throw new ConfigError(
      `${path}: planning.roadmap must be a path inside the repository, relative to its root, with no leading / and no .. (got ${JSON.stringify(value)})`,
    );
  }
  return roadmap;
}

function asPatterns(value: unknown, key: string, path: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new ConfigError(
      `${path}: planning.${key} must be a list of gitignore-style patterns, each written as text`,
    );
  }
  return [...value];
}

function asLimit(value: unknown, key: string, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ConfigError(
      `${path}: planning.${key} must be a whole number of 1 or more (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

/** Stage word → role. An empty table is no table (design §9). */
function asStages(
  value: unknown,
  path: string,
): Record<string, StageRole> | null {
  const table = asTable(value, path, "planning.stages");
  let stages: Record<string, StageRole> | null = null;
  for (const [word, role] of Object.entries(table)) {
    if (!isStageRole(role)) {
      throw new ConfigError(
        `${path}: planning.stages.${JSON.stringify(word)} must be one of ${STAGE_ROLES.map((r) => `"${r}"`).join(", ")} (got ${JSON.stringify(role)})`,
      );
    }
    // Defined, not assigned: `stages["__proto__"] = role` sets the prototype
    // and drops the word, which the server keeps.
    stages ??= {};
    Object.defineProperty(stages, word, {
      value: role,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return stages;
}

function assertRuleId(id: string, path: string): void {
  if (id === "*" || isKnownRule(id) || isOpenNamespace(id)) return;

  const namespace = id.endsWith("/*") ? id.slice(0, -2) : undefined;
  if (namespace && ruleNamespaces().includes(namespace)) return;

  throw new ConfigError(
    `${path}: unknown rule "${id}". Run \`vantage-check help\` for the list; a whole family is "${ruleNamespaces()[0]}/*".`,
  );
}

function asSetting(value: unknown, id: string, path: string): RuleSetting {
  if (value === "error" || value === "warning" || value === "off") return value;
  if (value === "warn") return "warning";
  if (value === false) return "off";
  throw new ConfigError(
    `${path}: rule "${id}" must be "error", "warning" or "off" (got ${JSON.stringify(value)})`,
  );
}

function asTable(
  value: unknown,
  path: string,
  where: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(
      `${path}: ${where === "" ? "the file" : where} must be a table`,
    );
  }
  return value as Record<string, unknown>;
}

function directoryOf(path: string): string {
  try {
    return statSync(path).isDirectory() ? path : dirname(path);
  } catch {
    return dirname(path);
  }
}
