import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
import { checkerName, viewerName } from "../version.js";
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
  /**
   * The top-level `target`, or `null` when the file declares none. Read and
   * validated here, and acted on by `core/target.ts`: in this release a
   * checker older than it refuses to run, and any other only says it read it.
   */
  target: Target | null;
  /**
   * One message per key or rule id this checker does not know, each of which
   * it ignored (`docs/design/checker-version-skew.md`). The commands print
   * them on stderr; they are about the configuration, never about a document,
   * so they are not findings and change no exit code.
   */
  warnings: string[];
}

/**
 * A `target` as written, and the release it names. `"0.8"` names `0.8.0`.
 *
 * The **target** is the oldest Vantage release that anyone reading the
 * repository renders it with (`docs/design/checker-version-skew.md` §4.1).
 */
export interface Target {
  /** As written: `0.8` or `0.8.1`. */
  written: string;
  /** Major, minor and patch, the patch `0` when the target names none. */
  version: readonly [number, number, number];
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
    target: null,
    warnings: [],
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

/**
 * A path as a run names it: relative to the working directory when it is
 * inside it, else as given. Every message about a config file names it this
 * way, a refusal and a warning in one run alike.
 */
export function shownPath(path: string, cwd: string | undefined): string {
  if (cwd === undefined) return path;
  const rel = relative(cwd, path);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? path : rel;
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
  /** Where the run was started, which messages name the file from. */
  cwd?: string;
}

/** The file `loadConfig` reads for these options, or none. */
export function configPathFor(options: LoadOptions): string | undefined {
  if (options.noConfig) return undefined;
  return options.explicitPath
    ? resolve(options.explicitPath)
    : findConfig(options.from, options.stopAt);
}

export function loadConfig(options: LoadOptions): LoadedConfig {
  const path = configPathFor(options);

  if (!path) return defaultConfig();
  const named = shownPath(options.explicitPath ?? path, options.cwd);
  if (options.explicitPath && !existsSync(path)) {
    throw new ConfigError(`no config file at ${named}`);
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
      `${named}: larger than ${MAX_CONFIG_BYTES} bytes, more than the server reads`,
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
    throw new ConfigError(`${named} ${reason}`);
  }

  return { path, ...parseConfig(source, shownPath(path, options.cwd)) };
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
  /** Handed the warnings of a root's own file, when that file is read here. */
  warn: (message: string) => void = () => {},
  /** Where the run was started, which messages name the file from. */
  cwd?: string,
): PlanningConfig {
  if (explicit || root === null) return loaded.planning;
  if (loaded.path === join(resolve(root), CONFIG_FILENAME)) {
    return loaded.planning;
  }
  const own = loadConfig({
    from: root,
    stopAt: root,
    ...(cwd === undefined ? {} : { cwd }),
  });
  for (const message of own.warnings) warn(message);
  return own.planning;
}

/**
 * Parse and validate a config file.
 *
 * **Forward compatible**, as this checker uses the words: a file written for a
 * newer vantage-check reads in this one without failing. A key in `[check]` or
 * `[planning]`, a rule id, or a rule's option that this release does not know
 * is ignored with a warning (`warnings`), because to an older checker every
 * key a later release adds looks exactly like a typo, and an exit 2 there made
 * the newest repository uncheckable by every checker before it
 * (`docs/design/checker-version-skew.md` §2.3). The warning names this release
 * and says both what to do if the key is newer and what to do if it is a
 * typo, so a typo is still said out loud rather than dropped.
 *
 * What stays an error is a key this checker does know: a value it cannot take
 * (a severity that is not a severity, a limit below 1, a malformed `target`),
 * and one of the viewer's top-level names written inside one of this
 * checker's tables, which it knows to be misplaced (`viewerKeyAdvice`).
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
  const target = parseTarget(root["target"], path);
  // `[starred]` is the server's table, not this checker's, so nothing else in
  // it is read here. A `target` appended to a file that ends in it lands in
  // it, though, and that one this checker knows: left there, no checker reads
  // it, so none could refuse a repository it is too old for (§4.1).
  const starred = root["starred"];
  if (isTable(starred) && Object.hasOwn(starred, "target")) {
    throw new ConfigError(
      `${path}: unknown key starred.target. ${viewerKeyAdvice("target")}`,
    );
  }
  const warnings: string[] = [];
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
          const unknown = unknownRule(id, path);
          if (unknown !== undefined) {
            warnings.push(unknown);
            continue;
          }
          if (!isTable(setting)) {
            overrides.set(id, asSetting(setting, id, path));
            continue;
          }
          const table = asRuleTable(setting, id, path, warnings);
          if (table.setting !== undefined) overrides.set(id, table.setting);
          options.set(id, table.options);
        }
        break;
      }
      default: {
        const misplaced = viewerKeyAdvice(key);
        if (misplaced !== undefined) {
          throw new ConfigError(
            `${path}: unknown key check.${key}. ${misplaced}`,
          );
        }
        warnings.push(
          `${path}: unknown key check.${key}, which ${checkerName()} does not know, so this run ignores it. ${newerOrTypo("key")}`,
        );
      }
    }
  }

  const planning =
    root["planning"] === undefined
      ? defaultPlanning()
      : parsePlanning(
          asTable(root["planning"], path, "planning"),
          path,
          warnings,
        );

  return {
    settings: new Settings(overrides, options),
    policy,
    planning,
    target,
    warnings,
  };
}

/**
 * A target's form (§4.1): a release, `X.Y` or `X.Y.Z`, numbers written
 * without leading zeros as a version's are.
 */
const TARGET_FORM = /^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/;

/**
 * The top-level `target`, validated: `null` when it is absent, and a
 * `ConfigError` for anything that does not name one release.
 *
 * The form is strict because a target is a floor. A range would leave the
 * checker to choose a point in it, a leading `v` or a pre-release names no
 * release a reader runs, and `target = 0.8` is a TOML number, which cannot
 * tell `0.10` from `0.1`. A form a later release adds is therefore an error
 * here, as any value of a known key this checker cannot take is.
 */
export function parseTarget(value: unknown, path: string): Target | null {
  if (value === undefined) return null;
  const match = typeof value === "string" ? TARGET_FORM.exec(value) : null;
  if (typeof value !== "string" || match === null) {
    throw new ConfigError(
      `${path}: target must name one Vantage release as text, "X.Y" or "X.Y.Z", such as target = "0.8" (got ${JSON.stringify(value)}). It is the oldest release anyone reading this repository uses, so a number, a range, "latest", a leading v and a pre-release are not targets.`,
    );
  }
  return {
    written: value,
    version: [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")],
  };
}

/**
 * `[planning]`, the one table both readers of this file parse: the server for
 * `include`, `exclude` and the two limits, the checker for all of it
 * (`docs/reference/planning-index.md` §14).
 *
 * A bad value is refused whole, as one in `[check]` is. A table the server
 * reads one way and the checker another would let the page and the gate
 * disagree about which files are planning documents, so the rules are pinned
 * for both readers by `internal/repoconfig/testdata/planning-config.json`. A
 * key this checker does not know is ignored with a warning instead, which the
 * server does not do: `version-skew-config.json` beside it pins both answers.
 */
function parsePlanning(
  table: Record<string, unknown>,
  path: string,
  warnings: string[],
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
        if (misplaced !== undefined) {
          throw new ConfigError(
            `${path}: unknown key planning.${key}. ${misplaced}`,
          );
        }
        // The server reads this table too, and refuses the whole file over a
        // key it does not know (docs/design/repo-config.md §2.3), so the one
        // reader that warns says what the other does.
        warnings.push(
          `${path}: unknown key planning.${key}, which ${checkerName()} does not know, so this run ignores it. Here [planning] takes roadmap, include, exclude, max-file-bytes, max-candidates and a [planning.stages] table, and ${viewerName()} ignores the whole file over a key it does not know, [starred] and theme included. ${newerOrTypo("key")}`,
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
    // `target` appended to a file that ends in this table lands here (§4.1).
    // A stage word may be spelled `target`, but its role is never a release.
    if (word === "target" && looksLikeRelease(role)) {
      throw new ConfigError(
        `${path}: planning.stages.target is a release, not a stage's role. ${viewerKeyAdvice("target")}`,
      );
    }
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

/**
 * The warning for a rule id this checker does not know, or `undefined` for one
 * it does: an exact rule, a family it has, `*`, or any id in a family whose
 * names are somebody else's (`markdown/*`). One of the viewer's own top-level
 * names in its place is misplaced rather than unknown, and is an error.
 */
function unknownRule(id: string, path: string): string | undefined {
  if (id === "*" || isKnownRule(id) || isOpenNamespace(id)) return undefined;

  const namespace = id.endsWith("/*") ? id.slice(0, -2) : undefined;
  if (namespace && ruleNamespaces().includes(namespace)) return undefined;

  const misplaced = viewerKeyAdvice(id);
  if (misplaced !== undefined) {
    throw new ConfigError(`${path}: unknown rule "${id}". ${misplaced}`);
  }
  return `${path}: unknown rule "${id}", which ${checkerName()} does not have, so this run ignores it. ${newerOrTypo("rule")} \`vantage-check help\` lists every rule, and a whole family is "${ruleNamespaces()[0]}/*".`;
}

/** A family, `link/*`, or every rule, `*`: ids that take a severity only. */
function isFamily(id: string): boolean {
  return id === "*" || id.endsWith("/*");
}

/** A value someone meant as a release: a number, or text such as `0.8`. */
function looksLikeRelease(value: unknown): boolean {
  return (
    typeof value === "number" ||
    (typeof value === "string" && /^v?\d+(\.\d+)*$/.test(value))
  );
}

/**
 * The advice after an unknown `check.*` or `planning.*` key, an unknown rule
 * id, or an unknown key in a rule's table
 * (`docs/design/checker-version-skew.md` §6.2).
 *
 * Each is ignored with a warning, and is either a typo or a key from a later
 * release, which every release before it does not know. An agent told only
 * "unknown rule" tends to "fix" it by deleting the line, which breaks the
 * repository for the newer checker it was written for. So the message names
 * this checker's version and says to keep the key. Unlike a finding about a
 * document, this one may name an upgrade: here a newer checker is the fix, not
 * a way to silence one.
 */
function newerOrTypo(what: "key" | "rule"): string {
  return `If this repository is configured for a newer vantage-check, run one (for example, \`uvx vantage-check@latest\`) and don't remove the ${what}; if it is a typo, fix it.`;
}

/**
 * What an exit-2 error says instead of a warning when the unknown key is one of
 * the file's own top-level names, written inside a table this checker reads.
 *
 * Three names belong at the top of this file: `theme` and `target`, keys, and
 * `[starred]`, a table (userguide/reference/configuration.md). TOML reads a
 * bare key written after a `[table]` header as part of that table, so a `theme`
 * line below `[check]` arrives here as `check.theme`, below `[check.rules]` as a
 * rule id, and below `[planning]` as `planning.theme`: the mistake the user
 * guide's theme pages warn about. None is a typo or a newer checker's key, and
 * the advice for those (fix the spelling, or keep the line and run a newer
 * checker) leaves it where it does nothing, so this stays an error while an
 * unknown key is a warning. A misplaced `target` matters most: no checker
 * reads it there, so none could refuse a repository it is too old for. Each
 * message still opens as any unknown key or rule does, and the guide quotes
 * that opening (`unknown key check.theme`) as the symptom to look for.
 */
function viewerKeyAdvice(key: string): string | undefined {
  switch (key) {
    case "theme":
    case "target":
      return `\`${key}\` is a top-level key, and TOML reads a key written after a [table] header as part of that table: move it above the first [table].`;
    case "starred":
      return "`starred` is the viewer's own table, not part of this one: write it as a top-level [starred] table.";
    default:
      return undefined;
  }
}

/**
 * A rule written as a table, `{ severity = "warning", max-words = 150 }`: the
 * form that sets a rule's options. `severity` is optional, and without it the
 * rule keeps the severity the family, `*` or the registry gives it. An option
 * is a whole number of at least 1.
 *
 * Any one rule takes the form, including one with no options in this release,
 * since a later release can give it some: a key the rule does not have here is
 * ignored with a warning, as an unknown rule is. A family or `*` takes a
 * severity only, because options are set on one rule by its exact id, so a
 * table there is an error.
 */
function asRuleTable(
  table: Record<string, unknown>,
  id: string,
  path: string,
  warnings: string[],
): { setting: RuleSetting | undefined; options: RuleOptions } {
  if (isFamily(id)) {
    throw new ConfigError(
      `${path}: "${id}" names ${id === "*" ? "every rule" : "a family"}, which takes only a severity, "error", "warning" or "off", and no table: an option is set on one rule by its exact id.`,
    );
  }
  const known = ruleMeta(id)?.options;
  const names = known === undefined ? [] : Object.keys(known);
  let setting: RuleSetting | undefined;
  const options: Record<string, number> = {};
  for (const [key, value] of Object.entries(table)) {
    if (key === "severity") {
      setting = asSetting(value, id, path);
      continue;
    }
    if (!names.includes(key)) {
      const misplaced = viewerKeyAdvice(key);
      if (misplaced !== undefined) {
        throw new ConfigError(
          `${path}: unknown key ${JSON.stringify(key)} for rule "${id}". ${misplaced}`,
        );
      }
      const takes =
        names.length === 0
          ? "takes only a severity"
          : `takes severity and ${names.join(", ")}`;
      warnings.push(
        `${path}: unknown key ${JSON.stringify(key)} for rule "${id}", which in ${checkerName()} ${takes}, so this run ignores the key. ${newerOrTypo("key")}`,
      );
      continue;
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
