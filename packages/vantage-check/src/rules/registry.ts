import type { RuleSetting } from "../core/types.js";
import { QUESTION_WORDS_DEFAULT } from "./questionLength.js";

export interface RuleMeta {
  id: string;
  /** One line, for `vantage-check rules` and for the documentation. */
  summary: string;
  /** What the rule does when nothing configures it. */
  default: RuleSetting;
  /**
   * The numbers a rule can be tuned by, besides its severity, keyed by the
   * name `[check.rules]` gives them in a rule's table (`core/config.ts`). A
   * rule without any takes a severity and nothing else.
   */
  options?: Readonly<Record<string, RuleOption>>;
}

/** One number a rule can be tuned by: a whole number of at least 1. */
export interface RuleOption {
  /** What the number limits, for the message that refuses a bad one. */
  summary: string;
  /** Its value when nothing configures it. */
  default: number;
}

/**
 * Every rule the checker knows, and what it does out of the box.
 *
 * Three kinds, and the split is P2 of docs/reference/agent-cli.md. `link/*` is
 * ours because no general-purpose tool can answer "does this path exist in
 * *this* repo".
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
  // `ref/*` — the family that asks the question underneath `link/*`. Those
  // rules ask whether a link works; these ask whether something that reads like
  // a pointer should have been one. A reference written as prose cannot be
  // dead, which is exactly why nothing else can ever notice it went stale.
  {
    id: "ref/unlinked-oq",
    summary:
      "An `OQ-…` id in prose with no link on it, or one linking to a document without naming the question",
    default: "error",
  },
  {
    id: "ref/unlinked-section",
    summary:
      "A `§N` reference with no link on it, or one pointing at a different section than the number names",
    default: "error",
  },
  {
    id: "ref/unlinked-file",
    summary:
      "A filename in prose that names a real file beside the document and does not link to it",
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
      "A directive name outside `section`, `block`, `question`, `oq` and `fallback` — the whole directive is dropped",
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
      "An open question (💬) with a stated leaning and no `question` directive, so the reviewer cannot file it",
    default: "error",
  },
  {
    id: "vantage/question-name",
    summary:
      "An `oq` directive on a 🔒 or ✅ question, which every viewer before 0.8 offers to answer, or a question directive below a 🔒 or ✅ title outside a list, where the question reads as open",
    default: "error",
  },
  {
    id: "vantage/oq-deprecated",
    summary:
      "An `oq` directive anywhere else: it still works, and `question` is the name to write, keys unchanged",
    default: "warning",
  },
  {
    id: "vantage/question-layout",
    summary:
      "A question's `_Leaning:_` run into a paragraph with other text, which the page and the planning card cannot lay out as its leaning",
    default: "warning",
  },
  {
    id: "vantage/oq-id-format",
    summary:
      "A question directive's id outside `OQ-<prefix?><digits>`, which the sanitizer refuses, so the question gets no anchor",
    default: "error",
  },
  {
    id: "vantage/oq-id-duplicate",
    summary:
      "The same question id on two questions in one document, on `question` or `oq` — `#id` resolves to the first, so references to the second land on the wrong question",
    default: "error",
  },
  {
    id: "vantage/orphan",
    summary:
      "A directive with no block it can attach to, so it styles nothing, or a `fallback` above a heading or raw HTML it never withholds, or merged with another directive — it resolves, so a warning",
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
  // `planning/*` — the planning index's rules (docs/reference/planning-index.md
  // §13). Each is a derivation the planning page also shows, run over the same
  // scan, so the page and the gate cannot disagree. They run once, after every
  // file, over the run's own documents and the roadmap (`rules/planning.ts`).
  {
    id: "planning/stage-vocabulary",
    summary:
      "A `stage` outside the words `[planning.stages]` declares — inert when none are declared",
    default: "error",
  },
  {
    id: "planning/depends-on-missing",
    summary:
      "A `depends-on` entry whose target does not exist or lies outside the repository, or never mentions its `#OQ-…` id",
    default: "error",
  },
  {
    id: "planning/stage-disagrees",
    summary:
      "A stage that says ready or built while the document still has open questions",
    default: "warning",
  },
  {
    id: "planning/unrouted",
    summary:
      "An open question no roadmap links to, directly or through its document (off by default)",
    default: "off",
  },
  {
    id: "planning/question-length",
    summary: `A question whose text, leaning and Answer aside, runs past \`max-words\` (${QUESTION_WORDS_DEFAULT}), more than its card on the planning page shows before the clamp`,
    default: "warning",
    options: {
      "max-words": {
        summary: "the most words a question's text may run to",
        // Calibrated where it is defined, which says against what.
        default: QUESTION_WORDS_DEFAULT,
      },
    },
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
