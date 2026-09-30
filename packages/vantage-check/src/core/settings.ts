import type { RuleSetting, Severity } from "./types.js";
import { RULES, ruleMeta } from "../rules/registry.js";

/** A rule's configured options, by the name `[check.rules]` gives them. */
export type RuleOptions = Readonly<Record<string, number>>;

/**
 * What every rule is set to for this run: the registry's defaults, with
 * whatever `.vantage.toml` and the flags say layered on top.
 *
 * Overrides may name a rule exactly (`link/missing-target`), a family
 * (`link/*`), or everything (`*`); the most specific one wins. Options, such
 * as `planning/question-length`'s `max-words`, are set for one rule by its
 * exact id, and a family has none.
 */
export class Settings {
  constructor(
    private readonly overrides: ReadonlyMap<string, RuleSetting>,
    private readonly options: ReadonlyMap<string, RuleOptions> = new Map(),
  ) {}

  static defaults(): Settings {
    return new Settings(new Map());
  }

  setting(id: string): RuleSetting {
    const exact = this.overrides.get(id);
    if (exact) return exact;

    const namespace = id.split("/")[0];
    if (namespace) {
      const family = this.overrides.get(`${namespace}/*`);
      if (family) return family;
    }

    const all = this.overrides.get("*");
    if (all) return all;

    // remark-lint owns the names in the markdown family, so a rule this build
    // has never heard of still has to have a setting: the family's master
    // switch, which is off unless someone asked for it.
    if (id.startsWith("markdown/") && id !== "markdown/hygiene") {
      return this.setting("markdown/hygiene");
    }

    return ruleMeta(id)?.default ?? "error";
  }

  enabled(id: string): boolean {
    return this.setting(id) !== "off";
  }

  /** The severity to report a firing rule at. Only meaningful if enabled. */
  severity(id: string): Severity {
    const setting = this.setting(id);
    return setting === "off" ? "error" : setting;
  }

  /**
   * The number a rule's option is set to: the configured value, else the
   * registry's default. Throws for an option the rule does not have, which is
   * a bug in the rule rather than in anybody's config.
   */
  option(id: string, name: string): number {
    const configured = this.options.get(id)?.[name];
    if (configured !== undefined) return configured;
    const meta = ruleMeta(id)?.options;
    const option =
      meta !== undefined && Object.hasOwn(meta, name) ? meta[name] : undefined;
    if (option === undefined) {
      throw new Error(`rule ${id} has no option ${name}`);
    }
    return option.default;
  }

  /**
   * The overrides, as plain data.
   *
   * For crossing a thread boundary: structured cloning strips a class's methods,
   * so a worker is handed what a `Settings` *is* and rebuilds one. The registry
   * defaults are compiled in on both sides, so only the overrides travel, with
   * the options beside them (`optionEntries`).
   */
  entries(): [string, RuleSetting][] {
    return [...this.overrides];
  }

  /** The configured options, as plain data, for the same crossing. */
  optionEntries(): [string, RuleOptions][] {
    return [...this.options];
  }

  /** Every rule that will actually run, for `--explain`-style output. */
  activeRules(): string[] {
    return RULES.map((rule) => rule.id).filter((id) => this.enabled(id));
  }
}
