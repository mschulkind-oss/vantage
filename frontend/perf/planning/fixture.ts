/**
 * The scale fixture of `docs/reference/planning-index.md` §18: a git
 * repository of 15, 30, 45 or 60 planning documents, each a renamed copy of
 * one of four real documents of this repository, written to a temporary
 * directory at run time and never committed. At 60 documents it is about
 * 1.3 MB, so no run builds a large input.
 *
 * The four sources are read at a pinned commit, so the mix stays the one §18's
 * slopes are defined over however those documents change or graduate later:
 * 20.4 KB (1 KB = 1,000 bytes) and 3.75 cards per document on average, a card
 * being one question the planning index holds. They repeat in a fixed order,
 * so 60 holds 15 of each and the smaller sizes are as near the mix as a size
 * that is not a multiple of four can be; each size's own averages are printed
 * and asserted, within a tolerance, from the planning index of the repository
 * written.
 *
 * Wiring, so every section of the planning page has entries:
 *
 * - The roadmap routes every other group of four documents, so *Needs you*
 *   and *Not on a roadmap* both hold more than a page at every size.
 * - Each copy of the open-questions gallery has a 🔒 question, so *Blocked*
 *   holds a full page from 45 documents (twelve of them).
 * - One copy of the tones gallery gets a `ready` stage (*Ready to build*),
 *   one a `built` stage (*Ready to graduate*), and one copy of the color-themes
 *   design a `ready` stage while its question is open (*Stage conflict*).
 * - Besides the planning documents, one file over the fixture's
 *   `max-file-bytes` (*Too large*), and one whose frontmatter does not parse
 *   (*Unreadable*). Neither is a planning document, so neither counts.
 *
 * Copies are named `docs/plans/pNN-<source>.md`, so a larger fixture adds
 * documents after every page a smaller one shows: from 45 documents on, every
 * section's first page holds the same entries, which is what D3's fixed
 * number of cards needs. The three row sections hold one document each at
 * every size; a page of them holds 25 rows, which no mix of 45 documents fills,
 * so a fixed count is what keeps them from growing instead.
 *
 * Run on its own to keep one: `node frontend/perf/planning/fixture.ts --size 45`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PLANNING_LIMITS } from "../../src/planningScan/limits.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");

export const FIXTURE_SIZES = [15, 30, 45, 60] as const;

/** Where the four sources are read from: `main` when the harness was added. */
export const SOURCES_COMMIT = "7fa8cbff28e7d5bf6ccd2b8466b416177df0064a";

/** The four real documents, in the order the copies repeat. */
export const SOURCES = [
  // 8.3 KB; 9 questions: 7 open, 1 answered, 1 blocked. No stage.
  "docs/gallery/open-questions.md",
  // 36.1 KB; 1 open question. DESIGN.
  "docs/design/color-themes.md",
  // 5.2 KB; no questions, a planning document by its `status`. No stage.
  "docs/gallery/tones.md",
  // 32.0 KB; 5 open questions. DESIGN.
  "docs/design/agent-bootstrap.md",
] as const;

/** §18's mix: what the four sources average, and what every size is held near. */
export const MIX = { kb: 20.4, cards: 3.75 } as const;

/** How far one size's averages may sit from the mix. 15 is the farthest. */
const TOLERANCE = { kbRatio: 0.05, cards: 0.15 } as const;

/** The source of the *Too large* file: 63.4 KB, over the limit set below. */
const TOO_LARGE_SOURCE = "docs/design/checker-version-skew.md";
/** Above every source, below the *Too large* one. */
const MAX_FILE_BYTES = 48 * 1024;

const STAGES = `[planning.stages]
DESIGN = "open"
DECIDED = "ready"
BUILT = "built"
CURRENT = "done"
`;

const PLANS_DIR = "docs/plans";

export interface FixtureDocument {
  path: string;
  source: string;
  bytes: number;
  cards: number;
  routed: boolean;
  stage: string | null;
}

export interface FixtureReport {
  dir: string;
  size: number;
  sourcesCommit: string;
  /** Each source: its size and the questions the index holds for a copy. */
  sources: { path: string; bytes: number; cards: number }[];
  /** The four sources' own averages: the mix. */
  mix: { kb: number; cards: number };
  /** This size's averages, over its planning documents alone. */
  averages: { kb: number; cards: number };
  /** Every file written, the roadmap and the two failure files included. */
  candidates: number;
  totalBytes: number;
  /** Entries per section, as `vantage-check index` derives them. */
  sections: Record<string, number>;
  documents: FixtureDocument[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const kb = (bytes: number) => bytes / 1000;
const round = (n: number, places = 2) => Number(n.toFixed(places));

function gitShow(file: string): string {
  return execFileSync("git", ["show", `${SOURCES_COMMIT}:${file}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
}

/** `text` with its frontmatter's `stage:` set to `stage`, or added. */
function withStage(text: string, stage: string): string {
  const end = text.indexOf("\n---", 4);
  if (!text.startsWith("---\n") || end < 0) {
    throw new Error("a source of the scale fixture has no frontmatter");
  }
  const header = text.slice(0, end);
  const body = text.slice(end);
  if (/^stage:.*$/m.test(header)) {
    return header.replace(/^stage:.*$/m, `stage: ${stage}`) + body;
  }
  return `${header}\nstage: ${stage}${body}`;
}

/** A header that does not parse: the title's closing quote dropped. */
function unparseable(text: string): string {
  const broken = text.replace(/^title: "(.*)"$/m, 'title: "$1');
  if (broken === text) throw new Error("the Unreadable source has no title");
  return broken;
}

interface Planned {
  path: string;
  source: string;
  text: string;
  routed: boolean;
  stage: string | null;
}

/** The fixture's planning documents, in order, before anything is written. */
function plan(size: number, texts: Map<string, string>): Planned[] {
  const seen = new Map<string, number>();
  const docs: Planned[] = [];
  for (let i = 0; i < size; i += 1) {
    const source = SOURCES[i % SOURCES.length];
    const copy = seen.get(source) ?? 0;
    seen.set(source, copy + 1);
    let stage: string | null = null;
    if (source === "docs/gallery/tones.md" && copy === 0) stage = "DECIDED";
    if (source === "docs/gallery/tones.md" && copy === 1) stage = "BUILT";
    if (source === "docs/design/color-themes.md" && copy === 0) {
      stage = "DECIDED";
    }
    const original = texts.get(source) ?? "";
    docs.push({
      path: `${PLANS_DIR}/p${pad(i + 1)}-${path.basename(source)}`,
      source,
      text: stage === null ? original : withStage(original, stage),
      routed: Math.floor(i / SOURCES.length) % 2 === 0,
      stage,
    });
  }
  return docs;
}

function roadmap(docs: Planned[]): string {
  const lines = docs
    .filter((doc) => doc.routed)
    .map(
      (doc, at) =>
        `${at + 1}. [${path.basename(doc.path, ".md")}](${doc.path})`,
    );
  return [
    "# Roadmap",
    "",
    "The scale fixture's roadmap, written by `frontend/perf/planning/fixture.ts`.",
    "It routes every other group of four plans, so Needs you and Not on a roadmap",
    "both fill.",
    "",
    ...lines,
    "",
  ].join("\n");
}

function git(dir: string, args: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Vantage perf",
      "-c",
      "user.email=perf@vantage.local",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    {
      cwd: dir,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-10-01T12:00:00Z",
        GIT_COMMITTER_DATE: "2026-10-01T12:00:00Z",
      },
    },
  );
}

interface IndexJson {
  index: {
    documents: { path: string; questions: unknown[] }[];
  };
  sections: Record<string, unknown>;
}

/**
 * `vantage-check index --format json` over `dir`, from this tree's sources
 * under Bun, or the CLI `just cli` built when Bun is not on the PATH. It
 * derives the sections exactly as the planning page does (P7).
 */
function indexOf(dir: string): IndexJson {
  const source = path.join(REPO_ROOT, "packages/vantage-check/src/main.ts");
  const built = path.join(
    REPO_ROOT,
    "packages/vantage-check/dist/vantage-check",
  );
  const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
  const [command, args] =
    bun.status === 0
      ? ["bun", [source, "index", "--format", "json"]]
      : [built, ["index", "--format", "json"]];
  if (command === built && !existsSync(built)) {
    throw new Error(
      "checking the fixture needs Bun on the PATH (just setup), or the CLI `just cli` builds",
    );
  }
  const out = execFileSync(command, args, {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out) as IndexJson;
}

function check(failures: string[], ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

/**
 * Write the scale fixture of `size` planning documents into a new directory
 * under `parent` (the OS temp directory by default), commit it, and check it:
 * the averages, and an entry in every section. Throws, naming every failed
 * check, when one fails.
 */
export function writeFixture(size: number, parent = tmpdir()): FixtureReport {
  if (!(FIXTURE_SIZES as readonly number[]).includes(size)) {
    throw new Error(
      `the scale fixture is 15, 30, 45 or 60 documents, not ${size}`,
    );
  }
  const texts = new Map<string, string>(
    [...SOURCES, TOO_LARGE_SOURCE].map((file) => [file, gitShow(file)]),
  );
  const docs = plan(size, texts);
  const dir = mkdtempSync(
    path.join(parent, `vantage-planning-fixture-${size}-`),
  );
  mkdirSync(path.join(dir, PLANS_DIR), { recursive: true });

  const files = new Map<string, string>([
    [
      ".vantage.toml",
      `# The planning index's scale fixture (frontend/perf/planning/fixture.ts).\n[planning]\nmax-file-bytes = ${MAX_FILE_BYTES}\n\n${STAGES}`,
    ],
    ["roadmap.md", roadmap(docs)],
    [`${PLANS_DIR}/zz-too-large.md`, texts.get(TOO_LARGE_SOURCE) ?? ""],
    [
      `${PLANS_DIR}/zz-unreadable.md`,
      unparseable(texts.get("docs/gallery/tones.md") ?? ""),
    ],
  ]);
  for (const doc of docs) files.set(doc.path, doc.text);
  let totalBytes = 0;
  for (const [file, text] of files) {
    writeFileSync(path.join(dir, file), text);
    totalBytes += Buffer.byteLength(text);
  }
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, [
    "commit",
    "-q",
    "-m",
    `perf: the planning scale fixture, ${size} documents`,
  ]);

  const json = indexOf(dir);
  const cardsOf = new Map(
    json.index.documents.map((d) => [d.path, d.questions.length] as const),
  );
  const documents: FixtureDocument[] = docs.map((doc) => ({
    path: doc.path,
    source: doc.source,
    bytes: Buffer.byteLength(doc.text),
    cards: cardsOf.get(doc.path) ?? -1,
    routed: doc.routed,
    stage: doc.stage,
  }));
  const sources = SOURCES.map((source) => {
    const first = documents.find(
      (d) => d.source === source && d.stage === null,
    );
    return {
      path: source,
      bytes: Buffer.byteLength(texts.get(source) ?? ""),
      cards: first?.cards ?? -1,
    };
  });
  const mean = (values: number[]) =>
    values.reduce((sum, v) => sum + v, 0) / values.length;
  const mix = {
    kb: round(kb(mean(sources.map((s) => s.bytes)))),
    cards: round(mean(sources.map((s) => s.cards))),
  };
  const averages = {
    kb: round(kb(mean(documents.map((d) => d.bytes)))),
    cards: round(mean(documents.map((d) => d.cards))),
  };
  const sections: Record<string, number> = {};
  for (const [id, value] of Object.entries(json.sections)) {
    if (Array.isArray(value) && id !== "roadmaps") sections[id] = value.length;
  }

  const failures: string[] = [];
  const { pageEntries } = DEFAULT_PLANNING_LIMITS;
  check(
    failures,
    documents.every((d) => d.cards >= 0),
    "a copy is not a planning document",
  );
  check(
    failures,
    round(mix.kb, 1) === MIX.kb && mix.cards === MIX.cards,
    `the four sources average ${mix.kb} KB and ${mix.cards} cards, not ${MIX.kb} and ${MIX.cards}`,
  );
  check(
    failures,
    Math.abs(averages.kb - MIX.kb) <= MIX.kb * TOLERANCE.kbRatio &&
      Math.abs(averages.cards - MIX.cards) <= TOLERANCE.cards,
    `${size} documents average ${averages.kb} KB and ${averages.cards} cards, too far from ${MIX.kb} and ${MIX.cards}`,
  );
  check(
    failures,
    documents.every((d) => d.bytes < MAX_FILE_BYTES) &&
      Buffer.byteLength(texts.get(TOO_LARGE_SOURCE) ?? "") > MAX_FILE_BYTES,
    `max-file-bytes (${MAX_FILE_BYTES}) does not sit between the copies and the Too large file`,
  );
  for (const id of ["needsYou", "unrouted"]) {
    check(
      failures,
      (sections[id] ?? 0) >= pageEntries,
      `${id} holds ${sections[id] ?? 0} entries, less than a page (${pageEntries})`,
    );
  }
  check(
    failures,
    size < 45
      ? (sections.waiting ?? 0) > 0
      : (sections.waiting ?? 0) >= pageEntries,
    `waiting holds ${sections.waiting ?? 0} entries`,
  );
  for (const id of [
    "ready",
    "graduate",
    "disagrees",
    "skipped",
    "unreadable",
  ]) {
    check(
      failures,
      sections[id] === 1,
      `${id} holds ${sections[id] ?? 0} entries, not 1`,
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `the scale fixture at ${size} documents (${dir}) is not the one §18 defines:\n  ${failures.join("\n  ")}`,
    );
  }
  return {
    dir,
    size,
    sourcesCommit: SOURCES_COMMIT,
    sources,
    mix,
    averages,
    candidates: files.size - 1,
    totalBytes,
    sections,
    documents,
  };
}

/** One line for a person: the size, its averages and its sections. */
export function describeFixture(report: FixtureReport): string {
  const sections = Object.entries(report.sections)
    .map(([id, n]) => `${id} ${n}`)
    .join(", ");
  return (
    `scale fixture: ${report.size} documents, ${report.averages.kb} KB and ` +
    `${report.averages.cards} cards each on average (mix ${report.mix.kb} KB, ` +
    `${report.mix.cards} cards); ${(report.totalBytes / 1e6).toFixed(2)} MB in ` +
    `${report.candidates} candidates; sections: ${sections}`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--size");
  const size = Number(at > 0 ? process.argv[at + 1] : 15);
  const out = process.argv.indexOf("--out");
  const report = writeFixture(size, out > 0 ? process.argv[out + 1] : tmpdir());
  console.log(describeFixture(report));
  console.log(report.dir);
}
