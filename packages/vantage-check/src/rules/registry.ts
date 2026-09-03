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
 * Three kinds, and the split is the design's P2. `link/*` is ours because no
 * general-purpose tool can answer "does this path exist in *this* repo".
 * `frontmatter/*`, `mermaid/*`, `katex/*` and `render/*` delegate to the parser
 * that actually owns the question, so a diagram fails for the reason the viewer
 * would fail on it, in that parser's own words. And `vantage/*` is about
 * Vantage's own markup, where there is no third party to ask and no error to
 * surface — the renderer is silent on purpose, so the checker has to speak.
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
    id: "frontmatter/not-at-top",
    summary:
      "A frontmatter block with a comment or a blank line above it, so it is body text and every field is lost",
    default: "error",
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
  // `vantage/*` — the one family whose subject is Vantage's own markup, and the
  // one family whose findings nothing else in the tool can produce. Every
  // directive failure is silent by design (D2: unknown is inert, never fatal),
  // so a typo renders a bare document with no error anywhere; these rules are
  // the only thing that says so. Severities follow the house rule: a question
  // the parsed tree has *settled* is an error, and something that works but is
  // almost certainly not what the author meant is a warning (`link/*`).
  {
    id: "vantage/unterminated",
    summary:
      "A `<!-- vantage:` comment with no `-->`, which deletes the rest of the document from the render",
    default: "error",
  },
  {
    id: "vantage/malformed",
    summary:
      "A `<!-- vantage: … -->` comment that does not parse, so it is ignored",
    default: "error",
  },
  {
    id: "vantage/unknown-name",
    summary:
      "A directive name outside `section`, `block` and `oq` — the whole directive is dropped",
    default: "error",
  },
  {
    id: "vantage/unknown-key",
    summary: "A directive key the closed vocabulary does not contain",
    default: "error",
  },
  {
    id: "vantage/unknown-value",
    summary: "A directive value outside the closed token set for its key",
    default: "error",
  },
  {
    id: "vantage/list-split",
    summary:
      "A directive between two list items, which ends the list and starts a second one",
    default: "error",
  },
  {
    id: "vantage/block-split",
    summary:
      "A directive that restructures the document around it — the general form of `vantage/list-split`, measured by deleting the comment and re-parsing",
    default: "error",
  },
  {
    id: "vantage/duplicate-key",
    summary:
      "The same key twice in one directive, or in one run of them — the last one wins, so a warning",
    default: "warning",
  },
  {
    id: "vantage/oq-missing",
    summary:
      "An open question (💬) with a stated leaning and no `oq` directive, so the reviewer cannot file it",
    default: "error",
  },
  {
    id: "vantage/orphan",
    summary:
      "A directive with no block it can attach to, so it styles nothing — it resolves, so a warning",
    default: "warning",
  },
  // The same family, one scope up: the reserved `vantage:` frontmatter key. It
  // belongs here rather than under `frontmatter/*` because those rules delegate
  // to `yaml` and `smol-toml` — parsers that own the syntax and have no opinion
  // about our vocabulary. Once the block has parsed, everything under `vantage:`
  // is ours, and just as silent.
  {
    id: "vantage/frontmatter-shape",
    summary:
      "A `vantage:` frontmatter key that is not a table of keys, so it configures nothing",
    default: "warning",
  },
  {
    id: "vantage/frontmatter-key",
    summary:
      "A key under `vantage:` this build does not know — a warning, so a newer document does not fail an older checker",
    default: "warning",
  },
  {
    id: "vantage/frontmatter-value",
    summary:
      "A `vantage:` value outside its closed set, so the chrome silently vanishes",
    default: "error",
  },
  {
    id: "vantage/status-chip-stale",
    summary:
      "A status chip with no `status:` to show, or one that disagrees with it",
    default: "warning",
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
