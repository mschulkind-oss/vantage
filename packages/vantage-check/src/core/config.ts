import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  isKnownRule,
  isOpenNamespace,
  ruleNamespaces,
} from "../rules/registry.js";
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
}

/** A config file that cannot be trusted. Never silently ignored. */
export class ConfigError extends Error {}

export const CONFIG_FILENAME = ".vantage.toml";

const DEFAULT_POLICY: CheckPolicy = { strict: false, exitCode: 1 };

export function defaultConfig(): LoadedConfig {
  return { settings: Settings.defaults(), policy: { ...DEFAULT_POLICY } };
}

/**
 * The nearest `.vantage.toml`, walking up from a file or directory.
 *
 * TOML because that is what Vantage already speaks (the user-level config is
 * `<UserConfigDir>/vantage/config.toml`), and at the repository root rather
 * than inside `.vantage/`, which is transient state users are told to
 * gitignore — committed configuration inside a gitignored directory is a trap.
 */
export function findConfig(from: string): string | undefined {
  let current = directoryOf(resolve(from));

  for (;;) {
    const candidate = join(current, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
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
}

export function loadConfig(options: LoadOptions): LoadedConfig {
  if (options.noConfig) return defaultConfig();

  const path = options.explicitPath
    ? resolve(options.explicitPath)
    : findConfig(options.from);

  if (!path) return defaultConfig();
  if (options.explicitPath && !existsSync(path)) {
    throw new ConfigError(`no config file at ${options.explicitPath}`);
  }

  return { path, ...parseConfig(readFileSync(path, "utf8"), path) };
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

  return { settings: new Settings(overrides), policy };
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
