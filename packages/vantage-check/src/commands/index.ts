import { resolve } from "node:path";
import {
  PLANNING_NOTICES,
  ROADMAP_STATE_PHRASES,
  VANTAGE_OQ_PREFERENCE,
  badgeFor,
  badgeText,
  buildPlanningIndex,
  derivePlanningSections,
  findDocument,
  questionFor,
  type PlanningBadge,
  type PlanningIndex,
  type PlanningRoadmap,
  type PlanningSections,
  type PlanningSources,
  type QuestionRef,
  type QuestionState,
} from "../../../vantage-md/src/planning/index.js";
import { VANTAGE_OQ_STATUS } from "../../../vantage-md/src/vantageDirectives.js";
import { Listing, listCandidates, readCandidate } from "../core/candidates.js";
import {
  ConfigError,
  configPathFor,
  loadConfig,
  type LoadOptions,
} from "../core/config.js";
import { declaredTargets, noteTargets, refuseTargets } from "../core/target.js";
import { repositoryRoot } from "../core/projectRoot.js";
import { oneLine } from "../core/text.js";
import { EXIT_ENVIRONMENT, EXIT_OK, EXIT_USAGE } from "../exit.js";
import type { Io } from "../io.js";
import { VERSION } from "../version.js";

/**
 * `vantage-check index`: the planning page, for an agent
 * (`docs/reference/planning-index.md` §13).
 *
 * It scans the *project root* (the nearest ancestor of the working directory
 * holding `.git` or `.vantage.toml`, else the working directory itself), builds
 * the planning index from every candidate there, and prints the page's
 * sections for the chosen roadmap, then that roadmap with each link's badge
 * inline. Every line of it is a derivation `vantage-md` also hands the viewer,
 * so the page and the CLI cannot disagree (P7).
 *
 * With several roadmaps it lists them all and chooses one as the page does,
 * with no memory between runs: `--roadmap`, else the one nearest the root
 * (§13).
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
  /**
   * `--roadmap`: the roadmap Needs you follows, repo-relative, one leading
   * `./` dropped. It has to be one that routes; without it, the default
   * roadmap is chosen.
   */
  roadmap?: string;
}

/**
 * The JSON format's own version, which is not the tool's. `check`'s JSON calls
 * the tool's version `version`; this one says `toolVersion` for that, so the
 * word here can mean the format, and a later change to the shape can say so.
 */
export const INDEX_FORMAT_VERSION = 2;

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
  const load: LoadOptions = {
    from: root,
    stopAt: root,
    cwd: io.cwd,
    ...(options.configPath === undefined
      ? {}
      : { explicitPath: resolve(io.cwd, options.configPath) }),
    ...(options.noConfig === undefined ? {} : { noConfig: options.noConfig }),
  };
  let loaded;
  let targets;
  try {
    // The target first, as `check` reads it (core/target.ts).
    targets = declaredTargets([configPathFor(load)], io.cwd);
    const refused = refuseTargets(targets, io);
    if (refused !== undefined) return refused;
    loaded = loadConfig(load);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    io.err(`vantage-check: ${error.message}\n`);
    return EXIT_USAGE;
  }
  noteTargets(targets, io);
  for (const warning of loaded.warnings) {
    io.err(`vantage-check: warning: ${warning}\n`);
  }

  const project = scanProject(root, loaded.planning);
  const { index } = project;
  // Past max-candidates nothing was read, so there is nothing to hold
  // `--roadmap` to, and the refusal is the answer whatever it says.
  const asked =
    options.roadmap === undefined || index.refused
      ? undefined
      : options.roadmap.replace(/^\.\//, "");
  const sections = index.refused
    ? null
    : derivePlanningSections(index, { roadmap: asked ?? null });

  // A path that is not a roadmap that routes falls back to the default in
  // the sections, as on the page; asked for by name, it is a bad argument.
  if (sections !== null && asked !== undefined) {
    if (sections.chosenRoadmap !== asked) {
      const routing = sections.roadmaps
        .filter((roadmap) => roadmap.state === "routes")
        .map((roadmap) => roadmap.path);
      const known =
        routing.length === 0
          ? "there is no roadmap"
          : `the roadmaps are: ${routing.join(", ")}`;
      io.err(
        `vantage-check: --roadmap ${options.roadmap} is not a roadmap here; ${known}\n`,
      );
      return EXIT_USAGE;
    }
  }

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
 * nothing is opened at all, as the server opens nothing (§16).
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

/** A link from a roadmap, as the JSON lists it. */
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
 * each document's links to what §3.2 calls a link, one to another
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

/** One roadmap's links, or none when it was not read (§13). */
function roadmapLinks(
  project: ScannedProject,
  narrowedIndex: PlanningIndex,
  path: string,
): RoadmapLink[] {
  const { index } = project;
  const roadmap = findDocument(narrowedIndex, path);
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
 * The machine-readable index, format version 2 (§13). A refused project
 * has no sections and no roadmaps to show, so both are `null` there, and
 * `index.refused` and `index.candidateCount` say why.
 *
 * `roadmaps` has one entry per entry of `sections.roadmaps`, in the same
 * order, each with the links version 1 printed as `roadmap`; they are empty
 * unless the file was read, which is the `routes` and `done` states.
 */
function renderJson(
  project: ScannedProject,
  sections: PlanningSections | null,
): string {
  const index = narrowed(project);
  return `${JSON.stringify(
    {
      tool: "vantage-check",
      toolVersion: VERSION,
      version: INDEX_FORMAT_VERSION,
      root: project.root,
      index,
      sections,
      roadmaps:
        sections === null
          ? null
          : sections.roadmaps.map(({ path, state }) => ({
              path,
              state,
              chosen: path === sections.chosenRoadmap,
              links: roadmapLinks(project, index, path),
            })),
    },
    null,
    2,
  )}\n`;
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

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

/** `1 needs you`, `4 need you`. */
function needsYouCount(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "needs" : "need"} you`;
}

/**
 * One line of the Roadmaps block: the path, then what it gives or why not. A
 * `done` roadmap was read, and its links are in the JSON, so it is said not to
 * route; every other state is one the file was not read in.
 */
function roadmapLine(roadmap: PlanningRoadmap, chosen: string | null): string {
  if (roadmap.state === "done") {
    return `${roadmap.path}  does not route: ${ROADMAP_STATE_PHRASES.done}`;
  }
  if (roadmap.state !== "routes") {
    return `${roadmap.path}  not read: ${ROADMAP_STATE_PHRASES[roadmap.state]}`;
  }
  const line = `${roadmap.path}  ${needsYouCount(roadmap.needsYouCount)}`;
  return roadmap.path === chosen ? `${line}  (chosen)` : line;
}

/**
 * The page's sections in page order, each hidden when empty, with the notices
 * where the page shows them; then the chosen roadmap's source with a badge in
 * brackets after each badged link. With two or more roadmaps, in any state,
 * a Roadmaps block lists them before Needs you; with one or none the text is
 * what it was before there could be several.
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
  const roadmapNotice = PLANNING_NOTICES.roadmapNotice(
    config,
    sections.roadmaps,
  );
  if (roadmapNotice !== null) notices.push(roadmapNotice);
  if (sections.onOtherRoadmaps.length > 0) {
    notices.push(
      `${PLANNING_NOTICES.otherRoadmaps(sections.onOtherRoadmaps.length)} Choose one with --roadmap <path>.`,
    );
  }
  if (notices.length > 0) blocks.push(notices.join("\n"));

  if (sections.roadmaps.length >= 2) {
    blocks.push(
      section(
        "Roadmaps",
        sections.roadmaps.map((r) => roadmapLine(r, sections.chosenRoadmap)),
      ),
    );
  }

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

  const roadmap =
    sections.chosenRoadmap === null
      ? undefined
      : findDocument(index, sections.chosenRoadmap);
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
