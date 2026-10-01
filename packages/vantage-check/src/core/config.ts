import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  isKnownRule,
  isOpenNamespace,
  ruleMeta,
  ruleNamespaces,
} from "../rules/registry.js";
import {
  DEFAULT_PLANNING_CONFIG,
  STAGE_ROLES,
  isStageRole,
  type PlanningConfig,
  type StageRole,
} from "../../../vantage-md/src/planning/index.js";
import { checkerName } from "../version.js";
import { Settings, type RuleOptions } from "./settings.js";
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
   * (`docs/reference/planning-index.md` §14).
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
  const options = new Map<string, RuleOptions>();

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
          if (!isTable(setting)) {
            overrides.set(id, asSetting(setting, id, path));
            continue;
          }
          const table = asRuleTable(setting, id, path);
          if (table.setting !== undefined) overrides.set(id, table.setting);
          options.set(id, table.options);
        }
        break;
      }
      default: {
        const misplaced = viewerKeyAdvice(key);
        throw new ConfigError(
          misplaced === undefined
            ? `${path}: unknown key check.${key}, which ${checkerName()} does not know. ${newerOrTypo("key")}`
            : `${path}: unknown key check.${key}. ${misplaced}`,
        );
      }
    }
  }

  const planning =
    root["planning"] === undefined
      ? defaultPlanning()
      : parsePlanning(asTable(root["planning"], path, "planning"), path);

  return { settings: new Settings(overrides, options), policy, planning };
}

/**
 * `[planning]`, the one table both readers of this file parse: the server for
 * `include`, `exclude` and the two limits, the checker for all of it
 * (`docs/reference/planning-index.md` §14).
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
        planning.roadmaps = asRoadmaps(value, path);
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
      default: {
        const misplaced = viewerKeyAdvice(key);
        throw new ConfigError(
          misplaced === undefined
            ? `${path}: unknown key planning.${key}. In ${checkerName()}, [planning] takes roadmap, include, exclude, max-file-bytes, max-candidates and a [planning.stages] table. ${newerOrTypo("key")}`
            : `${path}: unknown key planning.${key}. ${misplaced}`,
        );
      }
    }
  }
  return planning;
}

/**
 * `roadmap`, as a list (§14): a string is a list of one, and a list
 * names exactly those roadmaps, in the order written, `[]` none. Anything else
 * is refused, and so is a list holding anything but text or one path twice.
 * smol-toml hands an inline table and `[[planning.roadmap]]` over as a table
 * and as a list of tables, so both are refused here too.
 */
function asRoadmaps(value: unknown, path: string): string[] {
  if (typeof value === "string") return [asRoadmap(value, path, null)];
  if (!Array.isArray(value)) {
    throw new ConfigError(
      `${path}: planning.roadmap must be a repo-relative path written as text, or a list of them (got ${JSON.stringify(value)})`,
    );
  }
  const seen = new Map<string, number>();
  return value.map((entry: unknown, i) => {
    const position = i + 1;
    if (typeof entry !== "string") {
      throw new ConfigError(
        `${path}: entry ${position} of planning.roadmap must be a repo-relative path written as text (got ${JSON.stringify(entry)})`,
      );
    }
    const roadmap = asRoadmap(entry, path, position);
    const earlier = seen.get(roadmap);
    if (earlier !== undefined) {
      throw new ConfigError(
        `${path}: entry ${position} of planning.roadmap (${JSON.stringify(entry)}) names the same path as entry ${earlier}; list each roadmap once`,
      );
    }
    seen.set(roadmap, position);
    return roadmap;
  });
}

/**
 * A repo-relative path: not empty, no leading `/`, no `..` segment. A leading
 * `./` is dropped, so the value compares equal to the paths the index holds.
 * `position` is the entry's, counted from 1, in the list form, and `null` for
 * the string form, which has only the one.
 */
function asRoadmap(
  value: string,
  path: string,
  position: number | null,
): string {
  const where =
    position === null
      ? "planning.roadmap"
      : `entry ${position} of planning.roadmap`;
  const roadmap = value.startsWith("./") ? value.slice(2) : value;
  if (roadmap === "") {
    throw new ConfigError(
      `${path}: ${where} is empty (got ${JSON.stringify(value)})`,
    );
  }
  if (roadmap.startsWith("/") || roadmap.split("/").includes("..")) {
    throw new ConfigError(
      `${path}: ${where} must be a path inside the repository, relative to its root, with no leading / and no .. (got ${JSON.stringify(value)})`,
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

/** Stage word → role. An empty table is no table (§14). */
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

  const misplaced = viewerKeyAdvice(id);
  throw new ConfigError(
    misplaced === undefined
      ? `${path}: unknown rule "${id}", which ${checkerName()} does not have. ${newerOrTypo("rule")} \`vantage-check help\` lists every rule, and a whole family is "${ruleNamespaces()[0]}/*".`
      : `${path}: unknown rule "${id}". ${misplaced}`,
  );
}

/**
 * The advice after an unknown `check.*` or `planning.*` key or an unknown rule
 * id (`docs/design/checker-version-skew.md` §6.2), including a key in a rule's
 * table and a table for a rule that takes none.
 *
 * Each is exit 2 and usually a typo. It is also what every checker older than
 * a repository's configuration says: a key, a rule or a rule's option added in
 * a later release is unknown to all the releases before it. An agent told only
 * "unknown rule" tends to "fix" it by deleting the line, which breaks the
 * repository for the newer checker it was written for. So the message names
 * this checker's version and says to keep the key. Unlike a finding about a
 * document, this one may name an upgrade: here a newer checker is the fix, not
 * a way to silence one.
 */
function newerOrTypo(what: "key" | "rule" | "table"): string {
  const otherwise =
    what === "table"
      ? "if it is a mistake, write the severity alone"
      : "if it is a typo, fix it";
  return `If this repository is configured for a newer vantage-check, run one (for example, \`uvx vantage-check@latest\`) and don't remove the ${what}; ${otherwise}.`;
}

/**
 * What an exit-2 error says instead of `newerOrTypo` when the unknown key is
 * one of the viewer's own, written inside a table this checker reads.
 *
 * The viewer reads two names at the top of this file: `theme`, a key, and
 * `[starred]`, a table (userguide/reference/configuration.md). TOML reads a
 * bare key written after a `[table]` header as part of that table, so a `theme`
 * line below `[check]` arrives here as `check.theme`, below `[check.rules]` as a
 * rule id, and below `[planning]` as `planning.theme`: the mistake the user
 * guide's theme pages warn about. Neither is a typo or a newer checker's key,
 * and the advice for those (fix the spelling, or keep the line and run a newer
 * checker) leaves it where it does nothing. Each message still opens as any
 * unknown key or rule does, and the guide quotes that opening
 * (`unknown key check.theme`) as the symptom to look for.
 */
function viewerKeyAdvice(key: string): string | undefined {
  switch (key) {
    case "theme":
      return "`theme` is a top-level key, and TOML reads a key written after a [table] header as part of that table: move it above the first [table].";
    case "starred":
      return "`starred` is the viewer's own table, not part of this one: write it as a top-level [starred] table.";
    default:
      return undefined;
  }
}

/**
 * A rule written as a table, `{ severity = "warning", max-words = 150 }`: the
 * form that sets a rule's options, which only a rule the registry gives
 * options takes. `severity` is optional, and without it the rule keeps the
 * severity the family, `*` or the registry gives it. An option is a whole
 * number of at least 1, and a key that is neither is refused, as an unknown
 * rule is.
 */
function asRuleTable(
  table: Record<string, unknown>,
  id: string,
  path: string,
): { setting: RuleSetting | undefined; options: RuleOptions } {
  const known = ruleMeta(id)?.options;
  const names = known === undefined ? [] : Object.keys(known);
  if (names.length === 0) {
    throw new ConfigError(
      `${path}: rule "${id}" takes only a severity, "error", "warning" or "off", and no table in ${checkerName()}. ${newerOrTypo("table")}`,
    );
  }
  let setting: RuleSetting | undefined;
  const options: Record<string, number> = {};
  for (const [key, value] of Object.entries(table)) {
    if (key === "severity") {
      setting = asSetting(value, id, path);
      continue;
    }
    if (!names.includes(key)) {
      throw new ConfigError(
        `${path}: unknown key ${JSON.stringify(key)} for rule "${id}", which in ${checkerName()} takes severity and ${names.join(", ")}. ${newerOrTypo("key")}`,
      );
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw new ConfigError(
        `${path}: ${key} for rule "${id}" is ${known?.[key]?.summary ?? key}, and must be a whole number of 1 or more (got ${JSON.stringify(value)})`,
      );
    }
    options[key] = value;
  }
  return { setting, options };
}

/** A TOML table, as smol-toml hands one over; a date is an object too. */
function isTable(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
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
