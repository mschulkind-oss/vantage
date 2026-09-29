import { readFileSync, statSync } from "node:fs";
import { dirname, join, parse, relative, sep } from "node:path";
import {
  buildPlanningIndex,
  derivePlanningSections,
  findDocument,
  idsOf,
  questionFor,
  type PlanningConfig,
  type PlanningDocument,
  type PlanningSections,
  type PlanningSources,
  type SourceEntry,
} from "../../../vantage-md/src/planning/index.js";
import { parseFrontmatter } from "../../../vantage-md/src/frontmatter.js";
import {
  VANTAGE_OQ_ID,
  VANTAGE_SENTINEL,
} from "../../../vantage-md/src/vantageDirectives.js";
import { Listing, isCandidate, readCandidate } from "../core/candidates.js";
import { displayPath } from "../core/document.js";
import { repositoryRoot } from "../core/projectRoot.js";
import type { Settings } from "../core/settings.js";
import type { EnvironmentFailure, Finding } from "../core/types.js";

/**
 * The planning rules (`docs/design/planning-index.md` §8), run once in the
 * main thread after every file has been checked: the *post-pass*, a term the
 * implementation plan coined.
 *
 * Not per file, as every other rule is, for two reasons. A worker is handed
 * rule overrides and hands back findings, and nothing else crosses: the
 * `[planning]` table does not, and `planning/unrouted` needs the roadmap,
 * which is rarely one of the files a shard was given. And running once after
 * both the sequential and the parallel path is what keeps `--jobs 1` and
 * `--jobs 4` byte-identical. The cost is a second parse of each planning
 * document the run checks.
 *
 * The rules read a *narrow index* (also the plan's term): the index built from
 * the roadmap plus the run's own candidates, never a walk of the tree. Every
 * rule needs only a document and the roadmap, and the page's sections, derived
 * from that batch, give each of the run's documents exactly the membership the
 * full index would. That is why the page and the gate cannot disagree (P7),
 * and why a one-file check costs one roadmap parse and has no candidate count
 * to refuse (Plan Q7).
 */

export const PLANNING_RULES = [
  "planning/stage-vocabulary",
  "planning/depends-on-missing",
  "planning/stage-disagrees",
  "planning/unrouted",
] as const;

type PlanningRule = (typeof PLANNING_RULES)[number];

export interface PlanningReport {
  findings: Finding[];
  failures: EnvironmentFailure[];
}

/**
 * Check the run's files against the planning rules. `files` are absolute, as
 * `discover` gives them; findings are reported for those files only, with
 * `file` as every other rule names it.
 */
export function checkPlanning(
  files: readonly string[],
  cwd: string,
  settings: Settings,
  config: PlanningConfig,
): PlanningReport {
  if (!PLANNING_RULES.some((rule) => settings.enabled(rule))) {
    return { findings: [], failures: [] };
  }

  // Each file's project root, found by walking up from it: `check` may be
  // handed files from more than one repository, and each finds its own
  // roadmap (Plan Q16). A file with no root is judged on its own.
  const byBase = new Map<string, { root: string | null; files: string[] }>();
  for (const file of files) {
    const root = repositoryRoot(dirname(file)) ?? null;
    const base = root ?? parse(file).root;
    const group = byBase.get(base);
    if (group === undefined) byBase.set(base, { root, files: [file] });
    else group.files.push(file);
  }

  const findings: Finding[] = [];
  const failures: EnvironmentFailure[] = [];
  for (const [base, { root, files: group }] of byBase) {
    const pass = new PlanningPass(root, base, group, cwd, settings, config);
    try {
      pass.run();
      findings.push(...pass.findings);
    } catch (error) {
      // A bug here has not judged anything, so it must not read as clean.
      failures.push({
        rule: "planning",
        message: `the planning rules could not run over ${group.length} file${group.length === 1 ? "" : "s"}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return { findings, failures };
}

/** Slash-separated `abs` below `base`, or `null` outside it. */
function relativeTo(base: string, abs: string): string | null {
  const rel = relative(base, abs).split(sep).join("/");
  if (rel === "" || rel === ".." || rel.startsWith("../")) return null;
  return rel;
}

/** One project's share of the run: one narrow index, one set of findings. */
class PlanningPass {
  readonly findings: Finding[] = [];
  private readonly texts = new Map<string, string | null>();

  constructor(
    private readonly root: string | null,
    /**
     * The directory repo-relative paths are relative to: the project root,
     * or without one the file system's own, so that a `depends-on` entry
     * still resolves to a real path and only its existence is in question.
     */
    private readonly base: string,
    private readonly files: readonly string[],
    private readonly cwd: string,
    private readonly settings: Settings,
    private readonly config: PlanningConfig,
  ) {}

  run(): void {
    const { config } = this;
    const sources: PlanningSources = {
      config,
      // The narrow index has no count: it never walks the tree, so it has
      // nothing to refuse (Plan Q7), and a count here could only trip the
      // index's own refusal on a large run.
      candidateCount: 0,
      refused: false,
      files: [],
      skipped: [],
      unreadable: [],
    };
    const added = new Set<string>();
    const add = (entry: SourceEntry) => {
      added.add(entry.path);
      if (entry.kind === "file") {
        sources.files.push({ path: entry.path, content: entry.content });
        this.texts.set(join(this.base, entry.path), entry.content);
      } else if (entry.kind === "skipped") {
        sources.skipped.push({ path: entry.path, size: entry.size });
      } else if (entry.kind === "unreadable") {
        sources.unreadable.push({ path: entry.path, reason: entry.reason });
      }
    };

    // Only candidates are planning documents (design §3.1). A repository
    // whose files use `stage` for something else excludes them, and that has
    // to quiet these rules too (§13).
    const listing = this.root === null ? null : new Listing(this.root);
    const checked = new Map<string, string>();
    for (const file of this.files) {
      const rel = relativeTo(this.base, file);
      if (rel === null || checked.has(rel)) continue;
      const candidate =
        listing === null
          ? rel.toLowerCase().endsWith(".md")
          : isCandidate(listing, config, rel);
      if (!candidate) continue;
      checked.set(rel, file);
      const entry = readCandidate(this.base, rel, config.maxFileBytes);
      if (entry.kind !== "file" || this.mayFire(entry.content)) add(entry);
    }
    if (checked.size === 0) return;

    // Without a project there is no roadmap, and Unrouted is not shown
    // without one (§6.2), so `unrouted` reports nothing. The roadmap may be
    // one of the run's files already, read and left out only because no rule
    // could report on it; routing still needs it.
    if (
      listing !== null &&
      this.settings.enabled("planning/unrouted") &&
      !added.has(config.roadmap) &&
      isCandidate(listing, config, config.roadmap)
    ) {
      add(readCandidate(this.base, config.roadmap, config.maxFileBytes));
    }

    const index = buildPlanningIndex(sources);
    const sections = derivePlanningSections(index);
    for (const [rel, file] of checked) {
      const doc = findDocument(index, rel);
      if (doc === undefined) continue;
      const report = (rule: PlanningRule, line: number, message: string) =>
        this.report(rule, file, line, message);
      this.stageVocabulary(doc, report);
      this.dependsOnMissing(doc, report);
      this.stageDisagrees(doc, sections, report);
      for (const ref of sections.unrouted ?? []) {
        if (ref.path !== rel) continue;
        const question = questionFor(index, ref);
        const name = ref.id ?? `“${question?.title ?? "untitled"}”`;
        report(
          "planning/unrouted",
          question?.unitLine ?? ref.line,
          `Open question ${name} is not routed by the roadmap (${config.roadmap}). Link it, or this document, from there, so the planning page lists it under Needs you rather than Unrouted.`,
        );
      }
    }
  }

  /**
   * Whether any enabled rule could fire on a document with this text, read
   * from its header and one substring test, before the document is parsed.
   *
   * The parse is nearly all of this pass's cost, and most documents in a run
   * cannot be reported by any of the four rules: without `stage` or
   * `depends-on` in the header, and without an `oq` directive in the body,
   * none of them has anything to say. Leaving such a document out of the
   * narrow index changes nothing for the others, since each rule reads only
   * its own document and the roadmap. The test only ever says yes too often:
   * the scan still decides what the document is.
   */
  private mayFire(content: string): boolean {
    const { frontmatter, problem } = parseFrontmatter(content);
    // A header that does not parse makes the document unreadable to the
    // index, and it contributes nothing (design §3.6).
    if (problem !== undefined) return false;
    const has = (key: string) => Object.hasOwn(frontmatter, key);
    const enabled = (rule: PlanningRule) => this.settings.enabled(rule);
    const directives = content.includes(VANTAGE_SENTINEL);
    const staged = has("stage") && this.config.stages !== null;
    return (
      (has("depends-on") && enabled("planning/depends-on-missing")) ||
      (staged && enabled("planning/stage-vocabulary")) ||
      (staged && directives && enabled("planning/stage-disagrees")) ||
      (directives && enabled("planning/unrouted"))
    );
  }

  private report(
    rule: PlanningRule,
    file: string,
    line: number,
    message: string,
  ): void {
    if (!this.settings.enabled(rule)) return;
    this.findings.push({
      rule,
      severity: this.settings.severity(rule),
      message,
      file: displayPath(file, this.cwd),
      line,
      column: 1,
    });
  }

  /**
   * A `stage` outside `[planning.stages]`. Inert when nothing is declared,
   * even at `error`: with no vocabulary there is nothing to be outside of. A
   * stage that is not a word at all, such as a number or a date, is outside it
   * too, and the scan says what it was.
   */
  private stageVocabulary(doc: PlanningDocument, report: Report): void {
    const stages = this.config.stages;
    if (stages === null) return;
    for (const problem of doc.headerProblems) {
      if (problem.key === "stage") {
        report("planning/stage-vocabulary", problem.line, problem.message);
      }
    }
    if (doc.stage === null || Object.hasOwn(stages, doc.stage)) return;

    const declared = Object.keys(stages);
    const near = declared.find(
      (word) => word.toLowerCase() === doc.stage?.toLowerCase(),
    );
    report(
      "planning/stage-vocabulary",
      doc.stageLine ?? 1,
      `Stage \`${doc.stage}\` is not declared under [planning.stages], which declares ${list(declared.map((w) => `\`${w}\``))}. Matching is exact and case-sensitive${near === undefined ? "" : `: did you mean \`${near}\`?`}`,
    );
  }

  /**
   * A `depends-on` entry that names nothing: a target outside the repository,
   * one that does not exist, or an `#OQ-…` id its target never mentions, not
   * even in a Decision Ledger. An entry the scan had to drop, because it was
   * not a path at all, names nothing either.
   */
  private dependsOnMissing(doc: PlanningDocument, report: Report): void {
    const rule = "planning/depends-on-missing";
    for (const problem of doc.headerProblems) {
      if (problem.key === "depends-on") {
        report(rule, problem.line, problem.message);
      }
    }
    for (const entry of doc.dependsOn) {
      const written = `\`depends-on\` entry \`${entry.raw.trim()}\``;
      if (entry.target === null) {
        report(
          rule,
          entry.line,
          `${written} does not name a path inside this repository, so nothing can wait on it. Write a path relative to this document.`,
        );
        continue;
      }
      const target = join(this.base, entry.target);
      const kind = kindOf(target);
      if (kind === "missing") {
        report(
          rule,
          entry.line,
          `${written} names ${entry.target}, which does not exist.`,
        );
        continue;
      }
      const id = entry.fragment;
      if (id === null || !VANTAGE_OQ_ID.test(id)) continue;
      const text = kind === "file" ? this.text(target) : "";
      // A file that exists and cannot be read has not settled anything.
      if (text === null || idsOf(text).includes(id)) continue;
      report(
        rule,
        entry.line,
        `${written} names ${id}, which appears nowhere in ${entry.target}, not even in its Decision Ledger.`,
      );
    }
  }

  /** The page's Disagrees section: a ready or built stage with open questions. */
  private stageDisagrees(
    doc: PlanningDocument,
    sections: PlanningSections,
    report: Report,
  ): void {
    if (!sections.disagrees?.includes(doc.path)) return;
    const role =
      doc.stage === null ? undefined : this.config.stages?.[doc.stage];
    const open = doc.questions.filter((q) => q.state === "open");
    const ids = open.flatMap((q) => (q.id === null ? [] : [q.id]));
    const one = open.length === 1;
    report(
      "planning/stage-disagrees",
      doc.stageLine ?? 1,
      `Stage \`${doc.stage}\` says this document is ${role === "built" ? "built" : "decided"}, but ${open.length} question${one ? " is" : "s are"} still open${ids.length > 0 ? ` (${ids.join(", ")})` : ""}. Rule ${one ? "it" : "them"}, or set a stage that is still open.`,
    );
  }

  /** A file's text, read once per run; `null` when it cannot be read. */
  private text(abs: string): string | null {
    const cached = this.texts.get(abs);
    if (cached !== undefined) return cached;
    let text: string | null;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      text = null;
    }
    this.texts.set(abs, text);
    return text;
  }
}

type Report = (rule: PlanningRule, line: number, message: string) => void;

function kindOf(path: string): "file" | "directory" | "missing" {
  try {
    return statSync(path).isDirectory() ? "directory" : "file";
  } catch {
    return "missing";
  }
}

/** `a`, `a and b`, `a, b and c`. */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
