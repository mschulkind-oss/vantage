/**
 * .vantage.toml configuration.
 *
 * Precedence (highest wins): a CLI flag > the config file > built-in defaults.
 * A missing config is fine (defaults apply); a *present but invalid* config is
 * not — it is a ConfigError, which forces exit code 2. We never silently fall
 * back: a typo in a repo's config should fail loudly, not quietly change what
 * gets checked.
 *
 * Schema:
 *   [check]
 *   strict = false
 *   [check.severity]
 *   "link/missing-target" = "error"     # "error" | "warning" | "off"
 *   [check.lint]
 *   enabled = true
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { Severity } from "./types.js";

export type RuleSeverity = "error" | "warning" | "off";

export interface LintConfig {
  enabled: boolean;
}

export interface Config {
  strict: boolean;
  /** Per-rule severity overrides from [check.severity]. */
  severity: Map<string, RuleSeverity>;
  lint: LintConfig;
  /** The config file this was parsed from, or null for pure defaults. */
  source: string | null;
}

/** Thrown when a present config file is unreadable, bad TOML, or bad schema. */
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly file: string | null,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Built-in severity for every rule the CLI knows (lint/* handled by prefix). */
export const DEFAULT_SEVERITIES: Record<string, Severity> = {
  "link/leading-slash": "error",
  "link/uri-scheme": "error",
  "link/missing-target": "error",
  "link/line-anchor-range": "error",
  "link/dead-section-anchor": "error",
  "frontmatter/invalid": "error",
  "frontmatter/unclosed": "warning",
  "math/compile": "error",
  "mermaid/parse": "error",
  "render/pipeline": "error",
};

const DEFAULT_CONFIG: Config = {
  strict: false,
  severity: new Map(),
  lint: { enabled: false },
  source: null,
};

/** The built-in default config (what applies when no .vantage.toml is found). */
export function defaultConfig(): Config {
  return { ...DEFAULT_CONFIG, severity: new Map(DEFAULT_CONFIG.severity) };
}

/**
 * Effective severity for a rule under a config. "off" means the rule's
 * findings are suppressed. Unknown rules default to warning so a rule we don't
 * recognise can never by itself fail a run.
 */
export function severityOf(rule: string, config: Config): RuleSeverity {
  const override = config.severity.get(rule);
  if (override !== undefined) return override;
  if (rule.startsWith("lint/")) return "warning";
  return (DEFAULT_SEVERITIES[rule] ?? "warning") as RuleSeverity;
}

const CONFIG_FILE_NAME = ".vantage.toml";

/**
 * Walk up from `startDir` looking for `.vantage.toml`, stopping at the nearest
 * git root (a directory containing `.git`) or the filesystem root. Returns the
 * config path, or null when none is found.
 */
export function findConfigFile(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE_NAME);
    if (isFile(candidate)) return candidate;
    const isGitRoot = isDir(path.join(dir, ".git"));
    const parent = path.dirname(dir);
    if (isGitRoot || parent === dir) break;
    dir = parent;
  }
  return null;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function configFromData(data: unknown, file: string): Config {
  const root = (data ?? {}) as Record<string, unknown>;
  const check = (root.check ?? {}) as Record<string, unknown>;

  if (check.strict !== undefined && typeof check.strict !== "boolean") {
    throw new ConfigError("[check] strict must be a boolean", file);
  }
  const strict = check.strict === true;

  const severity = new Map<string, RuleSeverity>();
  const sevTable = check.severity ?? {};
  if (typeof sevTable !== "object" || sevTable === null) {
    throw new ConfigError("[check.severity] must be a table", file);
  }
  for (const [rule, value] of Object.entries(sevTable)) {
    if (value !== "error" && value !== "warning" && value !== "off") {
      throw new ConfigError(
        `[check.severity] "${rule}" = "${value}" is not a valid severity (expected "error", "warning", or "off")`,
        file,
      );
    }
    severity.set(rule, value as RuleSeverity);
  }

  const lint = (check.lint ?? {}) as Record<string, unknown>;
  if (lint.enabled !== undefined && typeof lint.enabled !== "boolean") {
    throw new ConfigError("[check.lint] enabled must be a boolean", file);
  }
  const lintEnabled = lint.enabled === true;

  return {
    strict,
    severity,
    lint: { enabled: lintEnabled },
    source: file,
  };
}

export function parseConfigFile(file: string): Config {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new ConfigError(
      `cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`,
      file,
    );
  }
  let data: unknown;
  try {
    data = parseToml(text) as unknown;
  } catch (e) {
    throw new ConfigError(
      `invalid TOML in ${file}: ${e instanceof Error ? e.message : String(e)}`,
      file,
    );
  }
  return configFromData(data, file);
}

/**
 * Resolves and caches the config that applies to each file. When an explicit
 * path (from `--config`) is given it is used for every file; otherwise the
 * config is discovered per file (cached by the path it resolves to).
 */
export class ConfigResolver {
  private byPath = new Map<string, Config>();
  private explicit: string | null;

  constructor(explicitPath: string | null) {
    this.explicit = explicitPath;
    if (explicitPath !== null && !isFile(explicitPath)) {
      throw new ConfigError(
        `config file not found: ${explicitPath}`,
        explicitPath,
      );
    }
  }

  /** The config that applies to the file at `abs`. */
  forFile(abs: string): Config {
    const file = this.explicit ?? findConfigFile(path.dirname(abs)) ?? null;
    if (file === null) return defaultConfig();
    let config = this.byPath.get(file);
    if (config === undefined) {
      config = parseConfigFile(file);
      this.byPath.set(file, config);
    }
    return config;
  }
}
