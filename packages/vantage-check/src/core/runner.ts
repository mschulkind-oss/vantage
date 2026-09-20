import { Collector } from "./collector.js";
import { loadDocument } from "./document.js";
import type { Settings } from "./settings.js";
import type { EnvironmentFailure, Finding, RunReport } from "./types.js";
import { Workspace } from "./workspace.js";
import {
  checkDirectives,
  checkOpenQuestionIds,
  checkOpenQuestions,
} from "../rules/directives.js";
import { checkFrontmatter } from "../rules/frontmatter.js";
import { checkLinks } from "../rules/links.js";
import { checkReferences } from "../rules/references.js";
import { checkMath } from "../rules/math.js";
import { checkMarkdownHygiene } from "../rules/markdown.js";
import { checkMermaid } from "../rules/mermaid.js";
import { checkPipeline } from "../rules/render.js";
import { checkVantageFrontmatter } from "../rules/vantageFrontmatter.js";

/**
 * Run every enabled rule over every file, in one thread.
 *
 * This is the whole checker. `core/parallel.ts` splits a file list across
 * several threads and calls this in each of them, so whatever is true of a run
 * here is true of a shard there — the rules never learn which they are in.
 *
 * One `Workspace` for the list: the cache is what makes a cross-linked document
 * set affordable, and it is per-run rather than global so nothing survives into
 * a second run with stale answers.
 */
export async function checkFiles(
  files: readonly string[],
  cwd: string,
  settings: Settings,
): Promise<RunReport> {
  const workspace = new Workspace();
  const findings: Finding[] = [];
  const failures: EnvironmentFailure[] = [];
  let filesChecked = 0;

  for (const file of files) {
    let collector: Collector;
    try {
      const doc = loadDocument(file, cwd);
      // Before any rule runs: the next document that links to this one gets its
      // anchors and line count from the parse we just did.
      workspace.offer(doc);
      collector = new Collector(doc, settings, workspace, cwd);
    } catch (error) {
      // A file we cannot open has not been judged. It is a failure of the run,
      // never a finding against the document.
      failures.push({
        rule: "document/read",
        file,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    filesChecked++;
    checkLinks(collector);
    checkReferences(collector);
    checkFrontmatter(collector);
    // After `checkFrontmatter`, not before: the block has to have been judged
    // as frontmatter before anything reads what is inside it.
    checkVantageFrontmatter(collector);
    checkDirectives(collector);
    checkOpenQuestions(collector);
    checkOpenQuestionIds(collector);
    checkMath(collector);
    await checkMermaid(collector);
    await checkMarkdownHygiene(collector);
    // Last: the specific rules have had their say, and this catches whatever
    // they do not cover.
    await checkPipeline(collector);

    findings.push(...collector.findings);
    failures.push(...collector.failures);
  }

  return { filesChecked, findings, failures };
}
