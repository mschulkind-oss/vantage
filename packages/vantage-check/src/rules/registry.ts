import type { RuleSetting } from "../core/types.js";

export interface RuleMeta {
  id: string;
  /** One line, for `vantage-check rules` and for the documentation. */
  summary: string;
  /** What the rule does when nothing configures it. */
  default: RuleSetting;
}

/**
 * Every rule the checker knows, and what it does out of the box.
 *
 * Two families, and the split is the design's P2. `link/*` is ours because no
 * general-purpose tool can answer "does this path exist in *this* repo"; the
 * rest delegate to the parser that actually owns the question, so a diagram
 * fails for the reason the viewer would fail on it, in that parser's own words.
 */
export const RULES: readonly RuleMeta[] = [
  {
    id: "link/leading-slash",
    summary:
      "A link target starting with `/`, which breaks web routing and multi-repo scoping",
    default: "error",
  },
  {
    id: "link/uri-scheme",
    summary: "A `file://` link, a Windows drive letter, or a UNC path",
    default: "error",
  },
  {
    id: "link/missing-target",
    summary: "A relative link whose target does not exist on disk",
    default: "error",
  },
  {
    id: "link/line-anchor-range",
    summary: "A `#L42` anchor that points past the end of its target file",
    default: "error",
  },
  {
    id: "link/inverted-range",
    summary:
      "A `#L50-L10` anchor that ends before it starts — it resolves, so a warning",
    default: "warning",
  },
  {
    id: "link/line-anchor-format",
    summary: "A `#L4x` anchor Vantage cannot parse, so it scrolls nowhere",
    default: "error",
  },
  {
    id: "link/dead-section-anchor",
    summary: "A `#section` anchor matching no heading in the target document",
    default: "error",
  },
  {
    id: "frontmatter/parse",
    summary:
      "Frontmatter that YAML or TOML cannot parse, so it renders as text",
    default: "error",
  },
  {
    id: "frontmatter/unterminated",
    summary: "An opening `---` or `+++` with no closing delimiter",
    default: "warning",
  },
  {
    id: "frontmatter/not-a-mapping",
    summary: "Frontmatter that parses to a value rather than a table of fields",
    default: "warning",
  },
  {
    id: "mermaid/parse",
    summary: "A diagram Mermaid's own parser rejects, rendered as an error box",
    default: "error",
  },
  {
    id: "katex/parse",
    summary: "A `$$...$$` formula KaTeX rejects, rendered as red error text",
    default: "error",
  },
  {
    id: "render/pipeline",
    summary:
      "A document the viewer's own render pipeline throws on, end to end",
    default: "error",
  },
  {
    id: "markdown/hygiene",
    summary:
      "General Markdown hygiene via remark-lint (off by default; enable the family)",
    default: "off",
  },
];

/**
 * Families whose rule names are owned by somebody else.
 *
 * `markdown/*` ids come from remark-lint, so the set is theirs to change and
 * config has to accept ids this build has never heard of. Every other family is
 * ours, and an id we do not know is a typo.
 */
const OPEN_NAMESPACES = new Set(["markdown"]);

export function isOpenNamespace(id: string): boolean {
  const namespace = id.split("/")[0];
  return namespace !== undefined && OPEN_NAMESPACES.has(namespace);
}

const BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

export function ruleMeta(id: string): RuleMeta | undefined {
  return BY_ID.get(id);
}

export function isKnownRule(id: string): boolean {
  return BY_ID.has(id);
}

/** The rule families, in the order they should be listed. */
export function ruleNamespaces(): string[] {
  const seen = new Set<string>();
  for (const rule of RULES) {
    const namespace = rule.id.split("/")[0];
    if (namespace) seen.add(namespace);
  }
  return [...seen];
}
