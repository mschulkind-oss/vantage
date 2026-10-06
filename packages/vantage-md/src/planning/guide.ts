/**
 * What each section of the planning page means and who acts on it, and the
 * request an agent is given for the sections an agent works on
 * (`docs/reference/planning-index.md` §6.2, §13.2).
 *
 * The one copy of every section's title, explanation line and actor, and of
 * the request templates: the page's headings, its section bar, its outline and
 * its Copy agent request buttons, and `vantage-check index`'s headings, its
 * JSON `sectionGuide` and its `--request`, all read them here, so the page and
 * the CLI cannot word a section two ways (P7). A request is generated from the
 * index at the moment it is asked for, never stored, so it always names what
 * the documents say now, in the stage words `[planning.stages]` declares now.
 *
 * The section ids are a machine interface — URL parameters, heading anchors,
 * `--request` arguments — and never change; a title is display text, and may.
 */

import { VANTAGE_OQ_STATUS } from "../vantageDirectives.js";
import type { PlanningConfig, StageRole } from "./config.js";
import { findDocument, type PlanningIndex } from "./model.js";
import type { DependsOn, PlanningQuestion } from "./scan.js";
import type { PlanningSections, QuestionRef } from "./sections.js";

/** Every section, by the id its URL parameter and heading carry, in page order. */
export const PLANNING_SECTION_IDS = [
  "needs-you",
  "unrouted",
  "waiting",
  "ready",
  "graduate",
  "disagrees",
  "skipped",
  "could-not-read",
] as const;
export type PlanningSectionId = (typeof PLANNING_SECTION_IDS)[number];

/** The field of `PlanningSections` that holds a section's entries. */
export type PlanningSectionKey =
  | "needsYou"
  | "unrouted"
  | "waiting"
  | "ready"
  | "graduate"
  | "disagrees"
  | "skipped"
  | "unreadable";

/**
 * Who acts next on a section's entries: `you`, the person reading the page;
 * `agent`, an agent given the section's request; or `nobody`, for entries
 * waiting on something else. Values of `vantage-check index --format json`,
 * so a name, once published, keeps its meaning.
 */
export type PlanningActor = "you" | "agent" | "nobody";

export interface PlanningSectionGuide {
  id: PlanningSectionId;
  key: PlanningSectionKey;
  /** Its heading, completing "these …". */
  title: string;
  /** One line under the heading: what its entries are, and what to do. */
  explanation: string;
  actor: PlanningActor;
}

const guide = (
  id: PlanningSectionId,
  key: PlanningSectionKey,
  title: string,
  actor: PlanningActor,
  explanation: string,
): PlanningSectionGuide =>
  Object.freeze({ id, key, title, explanation, actor });

/** Each section's guide, explained as it is when a roadmap is chosen. */
export const PLANNING_SECTION_GUIDE: Readonly<
  Record<PlanningSectionId, PlanningSectionGuide>
> = Object.freeze({
  "needs-you": guide(
    "needs-you",
    "needsYou",
    "Needs you",
    "you",
    "Open or answered questions on this roadmap, in its order. Rule each open one, then Copy answers.",
  ),
  unrouted: guide(
    "unrouted",
    "unrouted",
    "Not on a roadmap",
    "agent",
    "Open questions no roadmap links to. An agent proposes where each goes; you confirm.",
  ),
  waiting: guide(
    "waiting",
    "waiting",
    "Blocked",
    "nobody",
    "Waiting on a question, a document or an outside event. Nothing to do here.",
  ),
  ready: guide(
    "ready",
    "ready",
    "Ready to build",
    "agent",
    "Decided, with no open questions. An agent builds it.",
  ),
  graduate: guide(
    "graduate",
    "graduate",
    "Ready to graduate",
    "agent",
    "Built, with no questions left. An agent turns it into a reference doc.",
  ),
  disagrees: guide(
    "disagrees",
    "disagrees",
    "Stage conflict",
    "agent",
    "The stage says ready or built, but questions are open. An agent finds which is wrong.",
  ),
  skipped: guide(
    "skipped",
    "skipped",
    "Too large",
    "you",
    "Over max-file-bytes ([planning] in .vantage.toml), so not scanned. Raise the limit or exclude the file.",
  ),
  "could-not-read": guide(
    "could-not-read",
    "unreadable",
    "Unreadable",
    "you",
    "Could not be read. Fix or exclude the file.",
  ),
});

/** Each section's title. */
export const PLANNING_SECTION_TITLES: Readonly<
  Record<PlanningSectionId, string>
> = Object.freeze(
  Object.fromEntries(
    PLANNING_SECTION_IDS.map((id) => [id, PLANNING_SECTION_GUIDE[id].title]),
  ) as Record<PlanningSectionId, string>,
);

/**
 * With no roadmap chosen, because none routes, Needs you lists every open
 * question by document (§6.2), and its line says so.
 */
const NEEDS_YOU_WITHOUT_ROADMAP =
  "Open questions, by document. Rule each, then Copy answers.";

/** The line under a section's heading, for these sections. */
export function sectionExplanation(
  id: PlanningSectionId,
  sections: Pick<PlanningSections, "chosenRoadmap">,
): string {
  return id === "needs-you" && sections.chosenRoadmap === null
    ? NEEDS_YOU_WITHOUT_ROADMAP
    : PLANNING_SECTION_GUIDE[id].explanation;
}

/** Every section's guide in page order, explained by `sectionExplanation`. */
export function planningSectionGuide(
  sections: Pick<PlanningSections, "chosenRoadmap">,
): PlanningSectionGuide[] {
  return PLANNING_SECTION_IDS.map((id) => ({
    ...PLANNING_SECTION_GUIDE[id],
    explanation: sectionExplanation(id, sections),
  }));
}

/* ------------------------------------------------------------------ *
 * Agent requests
 * ------------------------------------------------------------------ */

/** The sections whose actor is `agent`, in page order: those with a request. */
export const PLANNING_AGENT_SECTION_IDS = [
  "unrouted",
  "ready",
  "graduate",
  "disagrees",
] as const satisfies readonly PlanningSectionId[];
export type PlanningAgentSectionId =
  (typeof PLANNING_AGENT_SECTION_IDS)[number];

export function isPlanningAgentSectionId(
  value: string,
): value is PlanningAgentSectionId {
  return (PLANNING_AGENT_SECTION_IDS as readonly string[]).includes(value);
}

/** How many entries an agent section holds, on every page. */
export function agentSectionCount(
  sections: PlanningSections,
  id: PlanningAgentSectionId,
): number {
  return (sections[PLANNING_SECTION_GUIDE[id].key] ?? []).length;
}

/**
 * The agent sections among `ids` (default: all four) that hold an entry, in
 * page order: the ones a request covers, and on the page, the ones that get a
 * Copy agent request button.
 */
export function agentSectionsWithEntries(
  sections: PlanningSections,
  ids: readonly PlanningAgentSectionId[] = PLANNING_AGENT_SECTION_IDS,
): PlanningAgentSectionId[] {
  return PLANNING_AGENT_SECTION_IDS.filter(
    (id) => ids.includes(id) && agentSectionCount(sections, id) > 0,
  );
}

export interface PlanningAgentRequestOptions {
  /**
   * The repository the request is about, as an agent can find it: the
   * absolute path of its root, which is what `vantage-check index` names and
   * what the viewer names when the server reports it.
   */
  repository: string;
  /**
   * The sections to cover (default: all four agent sections). Covered in page
   * order whatever order they are given in, each once, and an empty one is
   * left out.
   */
  ids?: readonly PlanningAgentSectionId[];
  /**
   * The Vantage release of the viewer handing the request over, as `X.Y.Z`,
   * or absent for a development build and for `vantage-check index
   * --request`, which name none. With one, the checker command the request
   * ends with runs `uvx vantage-check` with `VANTAGE_VIEWER=<release>` in
   * front of it, as the review payload's does
   * (`docs/design/checker-version-skew.md` §5): a request is text an agent
   * acts on, frozen into the viewer that ships it, so it names the viewer's
   * release now, for the checkers that read it later.
   */
  viewer?: string;
  /**
   * An applied planning filter (§6.2), with
   * `sections` the filtered sections. `text` is the filter's canonical text
   * less its unmatched terms, which a `Filter:` line after `Repository:`
   * carries as a code span; `unfiltered` are the sections it was applied to,
   * which every blocked-on fact is read from (§6.15), since a filter can keep a
   * Ready row and leave out what Blocked holds it for. Absent, or with an
   * empty `text`, which a filter of unmatched `-path:` terms alone leaves and
   * which keeps every entry, the request is byte for byte what it was before
   * filters.
   */
  filter?: { text: string; unfiltered: PlanningSections };
}

/**
 * A CommonMark code span holding `text` exactly: fenced with one more
 * backtick than the longest run of backticks inside it, and padded with a
 * space at both ends where it starts or ends with a backtick, or starts and
 * ends with a space, since CommonMark strips one space from each end of a
 * span that has one at both. So the punctuation after it can never be read
 * as part of it.
 */
export function codeSpan(text: string): string {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  const pad =
    text.startsWith("`") ||
    text.endsWith("`") ||
    (text.startsWith(" ") && text.endsWith(" ") && text.trim() !== "");
  return pad ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

/**
 * What every request says after its checker command: the review payload's
 * exit-2 sentence, since a refusal is the one exit an agent is tempted to
 * "fix" by editing `.vantage.toml`.
 */
const VERIFY_CAUTION =
  "If the command cannot run, or exits 2 (a configuration error or a refusal), leave `.vantage.toml` as it is: the check is a quality gate, not part of the work.";

/**
 * The request to hand an agent for the agent sections `options.ids` names:
 * the repository, then one block per section that holds an entry — what the
 * section means, what to do, and every one of its entries, on every page —
 * then how to check the work. `null` when none of them holds an entry, which
 * is when the page shows no button for it.
 *
 * Deterministic: one index, one set of sections and one repository give one
 * text, which is what lets the page's copy and `vantage-check index
 * --request` be compared byte for byte. The text has no trailing newline; the
 * CLI prints it with one.
 */
export function planningAgentRequest(
  index: PlanningIndex,
  sections: PlanningSections,
  options: PlanningAgentRequestOptions,
): string | null {
  const ids = agentSectionsWithEntries(sections, options.ids);
  if (ids.length === 0) return null;
  const blockedFrom = options.filter?.unfiltered ?? sections;
  const blocks = ids.map((id) =>
    requestBlock(index, sections, blockedFrom, id),
  );
  const filter =
    options.filter === undefined || options.filter.text === ""
      ? ""
      : `\nFilter: ${codeSpan(options.filter.text)}. Only the entries it keeps are listed.`;
  return [
    `Repository: ${options.repository}${filter}`,
    ...blocks,
    // Only Markdown: `vantage-check` reads any file it is given as Markdown,
    // so a code file's `§N` comments would read as broken references.
    `Verify: in the repository, run \`${checker(options.viewer)}\` on every Markdown file you changed, then \`${checker(options.viewer)} index\`. ${VERIFY_CAUTION}`,
  ].join("\n\n");
}

/**
 * The checker command a request names: `vantage-check`, or, from a release
 * viewer, `uvx vantage-check` with the viewer's release in front of it.
 */
function checker(viewer: string | undefined): string {
  return viewer === undefined
    ? "vantage-check"
    : `VANTAGE_VIEWER=${viewer} uvx vantage-check`;
}

/**
 * What a section that keeps a blocked document asks of its entries: nothing
 * when none is blocked. `ready` and `graduate` keep a document that Blocked
 * also lists (§6.2), and their JSON keeps that meaning (P0), so the request
 * is where an agent is told to leave it alone.
 */
const SKIP_BLOCKED =
  " Skip any entry marked blocked: it waits on something else first.";

/**
 * One section's block: its heading line, then one line per entry. The entries
 * are `sections`'; what each is blocked on is read from `blockedFrom`, the
 * sections before any filter (§6.15).
 */
function requestBlock(
  index: PlanningIndex,
  sections: PlanningSections,
  blockedFrom: PlanningSections,
  id: PlanningAgentSectionId,
): string {
  const { config } = index;
  const title = `${PLANNING_SECTION_TITLES[id]} (${count(agentSectionCount(sections, id))})`;
  /** Each document's line, and the skip clause when one of them is blocked. */
  const documents = (paths: readonly string[], open = false) => {
    const items = paths.map((path) =>
      documentItem(index, blockedFrom, path, open),
    );
    const blocked = paths.some(
      (path) => blockedOn(index, blockedFrom, path).length > 0,
    );
    return { items, skip: blocked ? SKIP_BLOCKED : "" };
  };
  switch (id) {
    case "unrouted": {
      const roadmaps = sections.roadmaps
        .filter((r) => r.state === "routes")
        .map((r) => r.path);
      const where =
        roadmaps.length === 1
          ? `on ${roadmaps.join("")}`
          : `on one of the roadmaps (${either(roadmaps)})`;
      return lines(
        `${title}: open questions no roadmap links to. For each, propose its place ${where}, with a one-clause reason. Do not decide priority: show the proposals to the human, and edit a roadmap only once they confirm the order. An entry is a link to the question's #OQ- anchor, or to its document with no fragment, which places every question in it.`,
        (sections.unrouted ?? []).map((ref) => questionItem(index, ref)),
      );
    }
    case "ready": {
      const { items, skip } = documents(sections.ready ?? []);
      return lines(
        `${title}: decided, with no open questions. Build each from its plan, then set its stage to ${stageWords(config, "built")}. If one should not be built, ask the human, and only with their agreement retire it ${retireWith(config)}.${skip}`,
        items,
      );
    }
    case "graduate": {
      const { items, skip } = documents(sections.graduate ?? []);
      const done = roleWords(config, "done");
      const which =
        done.length === 0
          ? ""
          : ` (one with the done role: ${done.join(", ")})`;
      return lines(
        `${title}: built, with no questions left. For each, write a reference document of the system as built, where the repository keeps those: verify every claim against the code, and say what it covers and the commit it was verified at (if you use a system-doc skill, use it). Give it the stage the repository's other reference documents carry${which}, or none. Then delete the design document and any plan written for it, repoint every link to them and citation of them, in documents, code comments and tests, at the new one, and keep every question id other documents cite resolvable.${skip}`,
        items,
      );
    }
    case "disagrees": {
      const { items } = documents(sections.disagrees ?? [], true);
      return lines(
        `${title}: the stage says ready or built, but questions are open. For each, find which is wrong, from the document and the code. If the stage is wrong, set it to ${stageWords(config, "open")}. If a question is a follow-up, propose moving it to a new document. Rule and answer nothing: where a question looks settled, tell the human what you found and ask for a ruling.`,
        items,
      );
    }
  }
}

const lines = (head: string, items: readonly string[]): string =>
  [head, ...items].join("\n");

const count = (n: number): string => n.toLocaleString("en-US");

/** `a`, `a or b`, `a, b or c`. */
function either(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/**
 * The stage words `[planning.stages]` maps to `role`, in code-unit order:
 * the page reads the table through the server's JSON, which sorts its keys,
 * and the CLI in the order it was written, so only a sort makes one text.
 */
function roleWords(config: PlanningConfig, role: StageRole): string[] {
  return Object.entries(config.stages ?? {})
    .filter(([, r]) => r === role)
    .map(([word]) => word)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A stage to set, for a role whose words all mean the same: `BUILT`,
 * `DESIGN or SKETCH`.
 */
function stageWords(config: PlanningConfig, role: StageRole): string {
  const words = roleWords(config, role);
  return words.length === 0
    ? `a word with the ${role} role (declare one under [planning.stages] in .vantage.toml)`
    : either(words);
}

/**
 * How a design that will not be built is retired. The `done` role holds
 * words that differ in meaning — a reference that is current, a design that
 * was superseded — so with more than one, the human picks the word too.
 */
function retireWith(config: PlanningConfig): string {
  const words = roleWords(config, "done");
  if (words.length === 0) {
    return "with a stage that has the done role (declare one under [planning.stages] in .vantage.toml)";
  }
  return words.length === 1
    ? `by setting its stage to ${words.join("")}`
    : `with the stage they choose among those with the done role (${words.join(", ")})`;
}

/** The most of a question's title an item quotes, in characters. */
const TITLE_WIDTH = 100;

/** Whitespace collapsed, and cut with an ellipsis past `TITLE_WIDTH`. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= TITLE_WIDTH
    ? flat
    : `${flat.slice(0, TITLE_WIDTH - 1).trimEnd()}…`;
}

/** The question a reference names, as `questionFor` finds it. */
function questionOf(
  index: PlanningIndex,
  ref: QuestionRef,
): PlanningQuestion | undefined {
  return findDocument(index, ref.path)?.questions.find(
    (q) => q.line === ref.line && q.id === ref.id,
  );
}

/** `- docs/a.md:14  OQ-A2: Should it?`: where its item starts, id, title. */
function questionItem(index: PlanningIndex, ref: QuestionRef): string {
  const q = questionOf(index, ref);
  if (q === undefined) {
    return `- ${ref.path}:${ref.line}  ${ref.id ?? ""}`.trimEnd();
  }
  // A title read from the whole item, with no bold id, opens with its marker.
  const title = oneLine(
    q.marker !== "" && q.title.startsWith(q.marker)
      ? q.title.slice(q.marker.length)
      : q.title,
  );
  const named =
    q.id === null || title.startsWith(q.id) ? title : `${q.id}: ${title}`;
  return `- ${q.path}:${q.unitLine}  ${named}`;
}

/**
 * A `depends-on` entry as Blocked names it: `docs/a.md`, `docs/a.md#OQ-A1`,
 * or as written when it names no file of the repository.
 */
export function dependsOnLabel(entry: DependsOn): string {
  return `${entry.target ?? entry.raw}${entry.fragment === null ? "" : `#${entry.fragment}`}`;
}

/**
 * What Blocked holds a document for (§6.2): each of its `depends-on` entries
 * that still waits, then each of its 🔒 questions, a question with no id
 * named by its line. Empty when Blocked does not list it.
 */
function blockedOn(
  index: PlanningIndex,
  sections: PlanningSections,
  path: string,
): string[] {
  const on: string[] = [];
  for (const entry of sections.waiting) {
    if (entry.kind === "document") {
      if (entry.path === path) on.push(...entry.waitingOn.map(dependsOnLabel));
    } else if (entry.question.path === path) {
      const { id, line } = entry.question;
      const q = questionOf(index, entry.question);
      on.push(
        `${VANTAGE_OQ_STATUS.blocked} ${id ?? `line ${q?.unitLine ?? line}`}`,
      );
    }
  }
  return on;
}

/**
 * `- docs/c.md  (stage DECIDED)`; for a document Blocked also lists, what it
 * waits on: `(stage DECIDED; blocked on docs/a.md#OQ-A1, 🔒 OQ-C1)`; and with
 * `open`, the document's open questions: `(stage BUILT; open: OQ-E1, line
 * 20)`, a question with no id named by its line. `blockedFrom` is the
 * sections Blocked is read from, which are never filtered.
 */
function documentItem(
  index: PlanningIndex,
  blockedFrom: PlanningSections,
  path: string,
  open = false,
): string {
  const doc = findDocument(index, path);
  const facts: string[] = [];
  if (doc !== undefined && doc.stage !== null) {
    facts.push(`stage ${doc.stage}`);
  }
  const blocked = blockedOn(index, blockedFrom, path);
  if (blocked.length > 0) facts.push(`blocked on ${blocked.join(", ")}`);
  if (open && doc !== undefined) {
    const named = doc.questions
      .filter((q) => q.state === "open")
      .map((q) => q.id ?? `line ${q.unitLine}`);
    if (named.length > 0) facts.push(`open: ${named.join(", ")}`);
  }
  return facts.length === 0 ? `- ${path}` : `- ${path}  (${facts.join("; ")})`;
}
