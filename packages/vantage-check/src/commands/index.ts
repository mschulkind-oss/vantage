import { resolve } from "node:path";
import {
  PLANNING_NOTICES,
  VANTAGE_OQ_PREFERENCE,
  badgeFor,
  badgeText,
  buildPlanningIndex,
  derivePlanningSections,
  findDocument,
  questionFor,
  type PlanningBadge,
  type PlanningIndex,
  type PlanningSections,
  type PlanningSources,
  type QuestionRef,
  type QuestionState,
} from "../../../vantage-md/src/planning/index.js";
import { VANTAGE_OQ_STATUS } from "../../../vantage-md/src/vantageDirectives.js";
import { Listing, listCandidates, readCandidate } from "../core/candidates.js";
import { ConfigError, loadConfig } from "../core/config.js";
import { repositoryRoot } from "../core/projectRoot.js";
import { EXIT_ENVIRONMENT, EXIT_OK, EXIT_USAGE } from "../exit.js";
import type { Io } from "../io.js";
import { VERSION } from "../version.js";

/**
 * `vantage-check index`: the planning page, for an agent
 * (`docs/design/planning-index.md` §8).
 *
 * It scans the *project root* (the nearest ancestor of the working directory
 * holding `.git` or `.vantage.toml`, else the working directory itself), builds
 * the planning index from every candidate there, and prints the page's
 * sections, then the roadmap with each link's badge inline. Every line of it is
 * a derivation `vantage-md` also hands the viewer, so the page and the CLI
 * cannot disagree (P7).
 *
 * It reports and does not judge, so it never exits 1: 0 when it ran, 2 for bad
 * arguments or a bad config, 3 when it could not run, which includes a project
 * with more candidates than `max-candidates` (Plan Q7).
 */
export interface IndexOptions {
  format: "text" | "json";
  /** An explicit `.vantage.toml`. It chooses the config, never the project. */
  configPath?: string;
  /** Ignore any `.vantage.toml` and use the built-in defaults. */
  noConfig?: boolean;
}

/**
 * The JSON format's own version, which is not the tool's. `check`'s JSON calls
 * the tool's version `version`; this one says `toolVersion` for that, so the
 * word here can mean the format, and a later change to the shape can say so.
 */
export const INDEX_FORMAT_VERSION = 1;

/** A candidate project, scanned: the index and the text each document had. */
interface ScannedProject {
  root: string;
  index: PlanningIndex;
  /** Every candidate, for narrowing each document's links on output. */
  candidates: ReadonlySet<string>;
  /** Each read candidate's text, for the roadmap's badged source. */
  sources: ReadonlyMap<string, string>;
}

export function indexCommand(options: IndexOptions, io: Io): number {
  // The config file never moves the project: `--config /tmp/x.toml` still
  // scans the tree the command was run in (Plan Q16).
  const root = repositoryRoot(io.cwd) ?? io.cwd;

  // The root's own config and nothing above it, the one file the server
  // reads for this repository (repo-config.md §2.2), so the page and this
  // command read the same `[planning]` (P7).
  let loaded;
  try {
    loaded = loadConfig({
      from: root,
      stopAt: root,
      ...(options.configPath === undefined
        ? {}
        : { explicitPath: resolve(io.cwd, options.configPath) }),
      ...(options.noConfig === undefined ? {} : { noConfig: options.noConfig }),
    });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    io.err(`vantage-check: ${error.message}\n`);
    return EXIT_USAGE;
  }

  const project = scanProject(root, loaded.planning);
  const { index } = project;
  const sections = index.refused ? null : derivePlanningSections(index);

  if (options.format === "json") {
    io.out(renderJson(project, sections));
  } else if (sections !== null) {
    io.out(renderText(project, sections));
  }

  if (index.refused) {
    io.err(
      `vantage-check: ${PLANNING_NOTICES.refused(index.candidateCount, index.config.maxCandidates)}\n`,
    );
    return EXIT_ENVIRONMENT;
  }
  return EXIT_OK;
}

/**
 * Every candidate under `root`, read the way the planning endpoint reads it,
 * into one batch, and the index built from that batch. Past `max-candidates`
 * nothing is opened at all, as the server opens nothing (design §3.5).
 */
function scanProject(
  root: string,
  config: PlanningSources["config"],
): ScannedProject {
  const candidates = listCandidates(new Listing(root), config);
  const refused = candidates.length > config.maxCandidates;
  const sources: PlanningSources = {
    config,
    candidateCount: candidates.length,
    refused,
    files: [],
    skipped: [],
    unreadable: [],
  };
  const texts = new Map<string, string>();
  if (!refused) {
    for (const path of candidates) {
      const entry = readCandidate(root, path, config.maxFileBytes);
      switch (entry.kind) {
        case "file":
          sources.files.push({ path, content: entry.content });
          texts.set(path, entry.content);
          break;
        case "skipped":
          sources.skipped.push({ path, size: entry.size });
          break;
        case "unreadable":
          sources.unreadable.push({ path, reason: entry.reason });
          break;
        case "absent":
          // Listed a moment ago and gone now: it is no longer a candidate.
          break;
      }
    }
  }
  return {
    root,
    index: buildPlanningIndex(sources),
    candidates: new Set(candidates),
    sources: texts,
  };
}

/** A link from the roadmap, as the JSON lists it. */
interface RoadmapLink {
  line: number;
  target: string;
  fragment: string | null;
  badge: PlanningBadge | null;
  badgeText: string | null;
}

/**
 * The index as the JSON prints it. The index keeps every repo-relative link,
 * because a target's candidacy can change between scans; the output narrows
 * each document's links to what design §3.2 calls a link, one to another
 * candidate.
 */
function narrowed(project: ScannedProject): PlanningIndex {
  const { index, candidates } = project;
  return {
    ...index,
    documents: index.documents.map((doc) => ({
      ...doc,
      links: doc.links.filter(
        (link) => link.target !== doc.path && candidates.has(link.target),
      ),
    })),
  };
}

function roadmapLinks(project: ScannedProject): RoadmapLink[] {
  const { index } = project;
  const roadmap = findDocument(narrowed(project), index.config.roadmap);
  if (roadmap === undefined) return [];
  return roadmap.links.map((link) => {
    const badge = badgeFor(index, roadmap.path, {
      path: link.target,
      fragment: link.fragment,
    });
    return {
      line: link.line,
      target: link.target,
      fragment: link.fragment,
      badge,
      badgeText: badge === null ? null : badgeText(badge),
    };
  });
}

/**
 * The machine-readable index. A refused project has no sections and no
 * roadmap to show, so both are `null` there, and `index.refused` and
 * `index.candidateCount` say why.
 */
function renderJson(
  project: ScannedProject,
  sections: PlanningSections | null,
): string {
  return `${JSON.stringify(
    {
      tool: "vantage-check",
      toolVersion: VERSION,
      version: INDEX_FORMAT_VERSION,
      root: project.root,
      index: narrowed(project),
      sections,
      roadmap: sections === null ? null : roadmapLinks(project),
    },
    null,
    2,
  )}\n`;
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

const TITLE_WIDTH = 100;

/** Collapse whitespace, and cut a long title where a line would wrap. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= TITLE_WIDTH
    ? flat
    : `${flat.slice(0, TITLE_WIDTH - 1).trimEnd()}…`;
}

/** A question's state as the page marks it: `💬`, `💬 🤷`, `🔒` or `✅`. */
function stateGlyph(state: QuestionState, preference: boolean): string {
  if (state === "blocked") return VANTAGE_OQ_STATUS.blocked;
  if (state === "answered") return VANTAGE_OQ_STATUS.settled;
  return preference
    ? `${VANTAGE_OQ_STATUS.open} ${VANTAGE_OQ_PREFERENCE}`
    : VANTAGE_OQ_STATUS.open;
}

/**
 * One question: where its item starts, its state and its title, so a reader
 * can open the file at the line and read the question there.
 */
function questionLine(index: PlanningIndex, ref: QuestionRef): string {
  const q = questionFor(index, ref);
  if (q === undefined) return `${ref.path}:${ref.line}  ${ref.id ?? ""}`;
  return `${q.path}:${q.unitLine}  ${stateGlyph(q.state, q.preference)} ${oneLine(q.title)}`;
}

/** A document, with the badge a link to it would carry. */
function documentLine(index: PlanningIndex, path: string): string {
  const badge = badgeFor(index, "", { path, fragment: null });
  return badge === null ? path : `${path}  [${badgeText(badge)}]`;
}

function bytes(n: number): string {
  return `${n.toLocaleString("en-US")} bytes`;
}

/** A heading with its count, then one indented line per entry. */
function section(title: string, lines: readonly string[]): string | null {
  if (lines.length === 0) return null;
  return [
    `${title} (${lines.length})`,
    ...lines.map((line) => `  ${line}`),
  ].join("\n");
}

/**
 * The page's sections in page order, each hidden when empty, with the notices
 * where the page shows them; then the roadmap's source with a badge in
 * brackets after each badged link.
 */
function renderText(
  project: ScannedProject,
  sections: PlanningSections,
): string {
  const { index } = project;
  const { config } = index;
  const blocks: (string | null)[] = [];

  const notices: string[] = [];
  if (sections.nothingNeedsYou) notices.push(PLANNING_NOTICES.nothingNeedsYou);
  if (!sections.roadmap.present) {
    notices.push(PLANNING_NOTICES.noRoadmap(sections.roadmap.path));
  }
  if (notices.length > 0) blocks.push(notices.join("\n"));

  blocks.push(
    section(
      "Needs you",
      sections.needsYou.map((ref) => {
        const line = questionLine(index, ref);
        return ref.heading === null ? line : `${line}  (${ref.heading})`;
      }),
    ),
  );
  blocks.push(
    section(
      "Unrouted",
      (sections.unrouted ?? []).map((ref) => questionLine(index, ref)),
    ),
  );
  blocks.push(
    section(
      "Waiting",
      sections.waiting.map((entry) =>
        entry.kind === "question"
          ? questionLine(index, entry.question)
          : `${entry.path}  waits on ${entry.waitingOn
              .map(
                (on) =>
                  `${on.target ?? on.raw}${on.fragment === null ? "" : `#${on.fragment}`}`,
              )
              .join(", ")}`,
      ),
    ),
  );

  if (!sections.stagesDeclared) blocks.push(PLANNING_NOTICES.noStages);
  for (const [title, paths] of [
    ["Ready", sections.ready],
    ["Graduate", sections.graduate],
    ["Disagrees", sections.disagrees],
  ] as const) {
    blocks.push(
      section(
        title,
        (paths ?? []).map((path) => documentLine(index, path)),
      ),
    );
  }

  blocks.push(
    section(
      "Skipped",
      sections.skipped.map(
        (s) =>
          `${s.path}  ${bytes(s.size)}, over max-file-bytes (${bytes(config.maxFileBytes)})`,
      ),
    ),
  );
  blocks.push(
    section(
      "Could not read",
      sections.unreadable.map((u) => `${u.path}  ${u.reason}`),
    ),
  );

  const roadmap = sections.roadmap.present
    ? findDocument(index, config.roadmap)
    : undefined;
  const source =
    roadmap === undefined ? undefined : project.sources.get(roadmap.path);
  if (roadmap !== undefined && source !== undefined) {
    blocks.push(
      `Roadmap: ${roadmap.path}\n\n${badged(index, roadmap.path, roadmap.links, source).replace(/\n+$/, "")}`,
    );
  }

  return `${blocks.filter((b) => b !== null).join("\n\n")}\n`;
}

/** `source`, with ` [<badge>]` inserted just past every link that has one. */
function badged(
  index: PlanningIndex,
  from: string,
  links: PlanningIndex["documents"][number]["links"],
  source: string,
): string {
  const inserts = links
    .map((link) => {
      const badge = badgeFor(index, from, {
        path: link.target,
        fragment: link.fragment,
      });
      return badge === null
        ? null
        : { at: link.endOffset, text: ` [${badgeText(badge)}]` };
    })
    .filter((insert) => insert !== null)
    .sort((a, b) => b.at - a.at);
  let out = source;
  for (const { at, text } of inserts) {
    out = `${out.slice(0, at)}${text}${out.slice(at)}`;
  }
  return out;
}
