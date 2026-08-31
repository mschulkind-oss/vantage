import type { RuleSetting, Severity } from "./types.js";
import { RULES, ruleMeta } from "../rules/registry.js";

/**
 * What every rule is set to for this run: the registry's defaults, with
 * whatever `.vantage.toml` and the flags say layered on top.
 *
 * Overrides may name a rule exactly (`link/missing-target`), a family
 * (`link/*`), or everything (`*`); the most specific one wins.
 */
export class Settings {
  constructor(private readonly overrides: ReadonlyMap<string, RuleSetting>) {}

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

  /** Every rule that will actually run, for `--explain`-style output. */
  activeRules(): string[] {
    return RULES.map((rule) => rule.id).filter((id) => this.enabled(id));
  }
}
