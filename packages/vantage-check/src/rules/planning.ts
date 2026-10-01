import { realpathSync, statSync } from "node:fs";
import { dirname, join, parse, relative, sep } from "node:path";
import {
  PLANNING_SECTION_TITLES,
  QUESTION_SHAPE,
  derivePlanningSections,
  findDocument,
  hasRoadmapName,
  idsOf,
  planningIndexBuilder,
  questionFor,
  type PlanningConfig,
  type PlanningDocument,
  type PlanningSections,
  type SourceEntry,
} from "../../../vantage-md/src/planning/index.js";
import { parseFrontmatter } from "../../../vantage-md/src/frontmatter.js";
import {
  VANTAGE_OQ_ID,
  VANTAGE_SENTINEL,
} from "../../../vantage-md/src/vantageDirectives.js";
import {
  Listing,
  isCandidate,
  listCandidates,
  matchesPatterns,
  readCandidate,
} from "../core/candidates.js";
import { displayPath, parseMarkdown } from "../core/document.js";
import { repositoryRoot } from "../core/projectRoot.js";
import type { Settings } from "../core/settings.js";
import { questionName } from "../core/text.js";
import type { EnvironmentFailure, Finding } from "../core/types.js";
import { questionWords } from "./questionLength.js";

/**
 * The planning rules (`docs/reference/planning-index.md` §13), run once in the
 * main thread, apart from the per-file rules: the *post-pass*, a term that
 * document defines in §2. They run while the worker threads check, or before
 * the per-file rules in a one-thread run, and their findings join the report
 * after the files' (`docs/reference/check-performance.md` §5.1).
 *
 * Not per file, as every other rule is, for two reasons. A worker is handed
 * rule settings and hands back findings, and nothing else crosses: the
 * `[planning]` table does not, and `planning/unrouted` needs the roadmaps,
 * which are rarely among the files a shard was given. And running once, outside
 * both the sequential and the parallel path, with findings joined after theirs
 * either way, is what keeps `--jobs 1` and `--jobs 4` byte-identical. The cost
 * is a second parse of each planning document the run checks, and a third of
 * each one holding a question for `planning/question-length` to measure, which
 * reads the questions the scan found, so it measures exactly the ones the page
 * shows a card for.
 *
 * The rules read a *narrow index* (also defined there): the index built from
 * the roadmaps plus the run's own candidates. Every rule needs only a document
 * and the roadmaps, and the page's sections, derived from that batch, give
 * each of the run's documents exactly the membership the full index would.
 * That is why the page and the gate cannot disagree (P7), and why a one-file
 * check has no candidate count to refuse (Plan Q7).
 *
 * Listed roadmaps are found with the listing's one-path test. Roadmaps found
 * by name cannot be known without listing the tree, so the pass walks the
 * project root's listing once for them, and only when `planning/unrouted` is
 * on and one of the run's documents has an open question it could report
 * (§13). The walk counts nothing and refuses nothing.
 */

export const PLANNING_RULES = [
  "planning/stage-vocabulary",
  "planning/depends-on-missing",
  "planning/stage-disagrees",
  "planning/unrouted",
  "planning/question-length",
] as const;

type PlanningRule = (typeof PLANNING_RULES)[number];

export interface PlanningReport {
  findings: Finding[];
  failures: EnvironmentFailure[];
}

/**
 * Check the run's files against the planning rules. `files` are absolute, as
 * `discover` gives them; findings are reported for those files only, with
 * `file` as every other rule names it. `planningFor` gives the `[planning]`
 * table of a project root, or of the files with none (`planningConfigFor`).
 */
export function checkPlanning(
  files: readonly string[],
  cwd: string,
  settings: Settings,
  planningFor: (root: string | null) => PlanningConfig,
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
    try {
      const config = planningFor(root);
      const pass = new PlanningPass(root, base, group, cwd, settings, config);
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
  /** The project root with its links resolved, found on first need. */
  private realRoot: string | undefined;

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
    const builder = planningIndexBuilder({
      config,
      // The narrow index has no count: it never counts the tree, so it has
      // nothing to refuse (Plan Q7), and a count here could only trip the
      // index's own refusal on a large run.
      candidateCount: 0,
      refused: false,
      skipped: [],
      unreadable: [],
    });
    const added = new Set<string>();
    const add = (entry: SourceEntry): PlanningDocument | null => {
      added.add(entry.path);
      switch (entry.kind) {
        case "file":
          this.texts.set(join(this.base, entry.path), entry.content);
          return builder.add({ path: entry.path, content: entry.content });
        case "skipped":
        case "unreadable":
          return builder.addScanned(entry);
        case "absent":
          return null;
      }
    };

    // Only candidates are planning documents (§3.1). A repository
    // whose files use `stage` for something else excludes them, and that has
    // to quiet these rules too (§3.1).
    const listing = this.root === null ? null : new Listing(this.root);
    const checked = new Map<string, string>();
    // Whether a checked document has an open question `unrouted` could
    // report: without one, no roadmap can change a finding.
    let unroutable = false;
    for (const file of this.files) {
      const rel = relativeTo(this.base, file);
      if (rel === null || checked.has(rel)) continue;
      const candidate =
        listing === null
          ? this.candidateWithoutRoot(file, rel)
          : isCandidate(listing, config, rel);
      if (!candidate) continue;
      checked.set(rel, file);
      const entry = readCandidate(this.base, rel, config.maxFileBytes);
      if (entry.kind === "file" && !this.mayFire(entry.content)) continue;
      const doc = add(entry);
      if (doc !== null && this.mayBeUnrouted(doc)) unroutable = true;
    }
    if (checked.size === 0) return;

    // Without a project there is no roadmap, and Not on a roadmap is not
    // shown without one (§6.2), so `unrouted` reports nothing. A roadmap may
    // be one of the run's files already, read and left out only because no
    // rule could report on it; routing still needs it.
    if (
      listing !== null &&
      unroutable &&
      this.settings.enabled("planning/unrouted")
    ) {
      for (const rel of this.roadmaps(listing)) {
        if (!added.has(rel)) {
          add(readCandidate(this.base, rel, config.maxFileBytes));
        }
      }
    }

    const index = builder.finish();
    const sections = derivePlanningSections(index);
    const routing = sections.roadmaps
      .filter((roadmap) => roadmap.state === "routes")
      .map((roadmap) => roadmap.path);
    // Routing (§4.3) in plain words: a link to the question's anchor, or to
    // its document as a whole, never to one of its headings.
    const missing =
      routing.length === 1
        ? `the roadmap (${routing.join("")}) links neither to it nor to this document as a whole`
        : `no roadmap (${routing.join(", ")}) links to it or to this document as a whole`;
    for (const [rel, file] of checked) {
      const doc = findDocument(index, rel);
      if (doc === undefined) continue;
      const report = (rule: PlanningRule, line: number, message: string) =>
        this.report(rule, file, line, message);
      this.stageVocabulary(doc, report);
      this.dependsOnMissing(doc, report);
      this.stageDisagrees(doc, sections, report);
      this.questionLength(doc, rel, report);
      for (const ref of sections.unrouted ?? []) {
        if (ref.path !== rel) continue;
        const question = questionFor(index, ref);
        const name = questionName(ref.id, question?.title ?? "untitled");
        report(
          "planning/unrouted",
          question?.unitLine ?? ref.line,
          // Where it goes is an order, and the order is the human's: the
          // message points at the request, which proposes and never places.
          `Open question ${name} is not on a roadmap: ${missing}, so the planning page lists it under ${PLANNING_SECTION_TITLES.unrouted}. Where it goes is the human's to confirm; \`vantage-check index --request unrouted\` asks an agent for a proposal.`,
        );
      }
    }
  }

  /**
   * Whether `unrouted` could report on the document: it has an open question
   * and its stage has no `done` role, since a done document contributes to no
   * section (Plan Q11).
   */
  private mayBeUnrouted(doc: PlanningDocument): boolean {
    return !this.isDone(doc) && doc.questions.some((q) => q.state === "open");
  }

  /** Whether the document's stage has the `done` role. */
  private isDone(doc: PlanningDocument): boolean {
    const stages = this.config.stages;
    return (
      stages !== null &&
      doc.stage !== null &&
      Object.hasOwn(stages, doc.stage) &&
      stages[doc.stage] === "done"
    );
  }

  /**
   * The paths the project's roadmaps may be at, candidates all (§4.1):
   * each listed one the listing holds, whatever `include` and `exclude` say,
   * or, with none listed, every candidate named `roadmap.md`, found by the
   * one walk of the listing this pass makes.
   */
  private roadmaps(listing: Listing): string[] {
    const listed = this.config.roadmaps;
    if (listed !== null) {
      return listed.filter((rel) => isCandidate(listing, this.config, rel));
    }
    return listCandidates(listing, this.config).filter(hasRoadmapName);
  }

  /**
   * Whether any enabled rule could fire on a document with this text, read
   * from its header and one substring test, before the document is parsed.
   *
   * The parse is nearly all of this pass's cost, and most documents in a run
   * cannot be reported by any of the five rules: without `stage` or
   * `depends-on` in the header, and without a question directive in the body,
   * none of them has anything to say. Leaving such a document out of the
   * narrow index changes nothing for the others, since each rule reads only
   * its own document and the roadmap. The test only ever says yes too often:
   * the scan still decides what the document is.
   */
  private mayFire(content: string): boolean {
    const { frontmatter, problem } = parseFrontmatter(content);
    // A header that does not parse makes the document unreadable to the
    // index, and it contributes nothing (§15).
    if (problem !== undefined) return false;
    const has = (key: string) => Object.hasOwn(frontmatter, key);
    const enabled = (rule: PlanningRule) => this.settings.enabled(rule);
    const directives = content.includes(VANTAGE_SENTINEL);
    const staged = has("stage") && this.config.stages !== null;
    return (
      (has("depends-on") && enabled("planning/depends-on-missing")) ||
      (staged && enabled("planning/stage-vocabulary")) ||
      (staged && directives && enabled("planning/stage-disagrees")) ||
      (directives && enabled("planning/unrouted")) ||
      (directives && enabled("planning/question-length"))
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
      `Stage \`${doc.stage}\` is not declared under [planning.stages], which declares ${list(declared.map((w) => `\`${w}\``))}. Matching is exact and case-sensitive${near === undefined ? "." : `: did you mean \`${near}\`?`}`,
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
      // The scan keeps the path inside the root as written; a symbolic link
      // on the way can still take it out.
      if (!this.holds(target)) {
        report(
          rule,
          entry.line,
          `${written} names ${entry.target}, which lies outside this repository through a symbolic link.`,
        );
        continue;
      }
      const id = entry.fragment;
      if (id === null || !VANTAGE_OQ_ID.test(id)) continue;
      const text = kind === "directory" ? "" : this.text(entry.target);
      // A file that exists and cannot be read has not settled anything.
      if (text === null || idsOf(text).includes(id)) continue;
      report(
        rule,
        entry.line,
        `${written} names ${id}, which appears nowhere in ${entry.target}, not even in its Decision Ledger.`,
      );
    }
  }

  /** The page's Stage conflict section: ready or built, with open questions. */
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
      `Stage \`${doc.stage}\` says this document is ${role === "built" ? "built" : "decided"}, but ${open.length} question${one ? " is" : "s are"} still open${ids.length > 0 ? ` (${ids.join(", ")})` : ""}. Have ${one ? "it" : "them"} ruled, or set a stage that is still open.`,
    );
  }

  /**
   * A question whose text runs past `max-words`, leaning and Answer aside
   * (`rules/questionLength.ts`). Every question the page shows a card for is
   * measured, whatever its state; a document whose stage has the `done` role
   * shows none, so its questions are left alone, as `unrouted` leaves them.
   *
   * The scan's own tree is not kept, so the body is parsed once more, only
   * for a document with a question to measure.
   */
  private questionLength(
    doc: PlanningDocument,
    rel: string,
    report: Report,
  ): void {
    const rule = "planning/question-length";
    if (!this.settings.enabled(rule) || doc.questions.length === 0) return;
    if (this.isDone(doc)) return;
    const text = this.texts.get(join(this.base, rel));
    if (text === undefined || text === null) return;
    const limit = this.settings.option(rule, "max-words");
    const { body, bodyLineOffset } = parseFrontmatter(text);
    const root = parseMarkdown(body);
    for (const question of doc.questions) {
      const words = questionWords(root, question, bodyLineOffset);
      if (words === null || words <= limit) continue;
      const name = questionName(question.id, question.title);
      report(
        rule,
        question.unitLine,
        `Question ${name} runs to ${words} words, not counting its leaning and its Answer, past the limit of ${limit}. Its card on the planning page leads with the bold title and shows only the first few lines of the rest, so put the question itself in the title and keep the text to what a ruling needs: move background, history and cross-references into the document's sections and link to them. ${QUESTION_SHAPE} A leaning or an Answer run into another paragraph counts here as the question's own words.`,
      );
    }
  }

  /**
   * Whether a file with no project root is a candidate. There is no listing
   * to consult, and no repository to anchor `include` and `exclude` to, so
   * they are read against the working directory, the tree `index` scans when
   * there is no root (§13). A file outside it is matched by its extension
   * alone.
   */
  private candidateWithoutRoot(file: string, rel: string): boolean {
    if (!rel.toLowerCase().endsWith(".md")) return false;
    const fromCwd = relativeTo(this.cwd, file);
    return fromCwd === null || matchesPatterns(this.config, fromCwd);
  }

  /**
   * Whether `abs`, links followed, is inside the project root. Without a root
   * there is no repository to leave.
   */
  private holds(abs: string): boolean {
    if (this.root === null) return true;
    try {
      const real = realpathSync(abs);
      this.realRoot ??= realpathSync(this.root);
      return real === this.realRoot || real.startsWith(this.realRoot + sep);
    } catch {
      return false;
    }
  }

  /**
   * A repo-relative file's text, read once per run as the endpoint reads a
   * candidate: a regular file of at most `max-file-bytes`, in UTF-8. `null`
   * when it is anything else, which has settled nothing.
   */
  private text(rel: string): string | null {
    const abs = join(this.base, rel);
    const cached = this.texts.get(abs);
    if (cached !== undefined) return cached;
    const entry = readCandidate(this.base, rel, this.config.maxFileBytes);
    const text = entry.kind === "file" ? entry.content : null;
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
