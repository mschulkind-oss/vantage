/**
 * The planning index: every planning document in one repository, with the
 * candidates that could not be read (design §3).
 *
 * Built from one batch of sources — the server's planning endpoint, or the
 * checker's own walk — or from files already scanned, and kept fresh one path
 * at a time (§3.4). Every function here returns a new index and leaves its
 * argument alone, so a viewer can hold the previous one on screen while the
 * next is computed.
 */

import { isStageRole, type PlanningConfig, type StageRole } from "./config.js";
import {
  scanPlanningDocument,
  type PlanningDocument,
  type ScanResult,
} from "./scan.js";

/**
 * One batch of candidate sources: the endpoint's body, camelCased.
 *
 * `refused` means the repository has more candidates than `maxCandidates`, so
 * nothing was opened and the three lists are empty.
 */
export interface PlanningSources {
  config: PlanningConfig;
  candidateCount: number;
  refused: boolean;
  files: { path: string; content: string }[];
  skipped: { path: string; size: number }[];
  unreadable: { path: string; reason: string }[];
}

/** One path's answer, from the endpoint's single-path mode. */
export type SourceEntry =
  | { kind: "file"; path: string; content: string }
  | { kind: "skipped"; path: string; size: number }
  | { kind: "unreadable"; path: string; reason: string }
  /** Missing, or not a candidate. */
  | { kind: "absent"; path: string };

/**
 * One path's answer with a file's text replaced by its scan result: what the
 * scan worker answers a refresh with, having read and scanned the file off
 * the main thread (`docs/design/planning-index-at-scale.md` §5.3). `hash` is
 * the file's content hash, which the index itself never reads.
 */
export type ScannedEntry =
  | { kind: "file"; path: string; hash: string; result: ScanResult }
  | { kind: "skipped"; path: string; size: number }
  | { kind: "unreadable"; path: string; reason: string }
  /** Missing, or not a candidate. */
  | { kind: "absent"; path: string };

export interface PlanningIndex {
  config: PlanningConfig;
  /** As of the last batch. */
  candidateCount: number;
  /** When true, `documents`, `skipped` and `unreadable` are all empty. */
  refused: boolean;
  /** Sorted by path. */
  documents: PlanningDocument[];
  /** Candidates over `maxFileBytes`, never read. Sorted by path. */
  skipped: { path: string; size: number }[];
  /**
   * Candidates the server could not read, and those whose frontmatter does not
   * parse (`ScanResult` "unreadable"). Sorted by path.
   */
  unreadable: { path: string; reason: string }[];
}

/* ------------------------------------------------------------------ *
 * The wire shape
 * ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(isString) ? [...value] : null;
}

/** Every element of `value` through `read`, or `null` if any is refused. */
function listOf<T>(value: unknown, read: (item: Json) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const parsed = read(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

function parseConfig(value: unknown): PlanningConfig | null {
  if (!isRecord(value)) return null;
  const { roadmap, max_file_bytes, max_candidates, stages } = value;
  const include = stringList(value["include"]);
  const exclude = stringList(value["exclude"]);
  if (!isString(roadmap) || include === null || exclude === null) return null;
  if (!isNumber(max_file_bytes) || !isNumber(max_candidates)) return null;

  // An empty table is no table (design §9), so only a declared word makes one.
  let roles: Record<string, StageRole> | null = null;
  if (stages !== null) {
    if (!isRecord(stages)) return null;
    for (const [word, role] of Object.entries(stages)) {
      if (!isStageRole(role)) return null;
      // Defined, not assigned: `roles["__proto__"] = role` sets the prototype
      // and drops the word, which the server keeps.
      roles ??= {};
      Object.defineProperty(roles, word, {
        value: role,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return {
    roadmap,
    include,
    exclude,
    maxFileBytes: max_file_bytes,
    maxCandidates: max_candidates,
    stages: roles,
  };
}

const readFile = (item: Json) =>
  isString(item["path"]) && isString(item["content"])
    ? { path: item["path"], content: item["content"] }
    : null;
const readSkipped = (item: Json) =>
  isString(item["path"]) && isNumber(item["size"])
    ? { path: item["path"], size: item["size"] }
    : null;
const readUnreadable = (item: Json) =>
  isString(item["path"]) && isString(item["reason"])
    ? { path: item["path"], reason: item["reason"] }
    : null;

/**
 * The batch endpoint's body, or `null` for any other shape.
 *
 * Strict on purpose. A static export has no endpoint, and a static host may
 * answer its URL with the site's `index.html` at 200 (design §3.6), so a body
 * that is not the batch's own shape has to read as a failure, not as an empty
 * repository.
 */
export function parsePlanningSources(json: unknown): PlanningSources | null {
  if (!isRecord(json)) return null;
  const config = parseConfig(json["config"]);
  const files = listOf(json["files"], readFile);
  const skipped = listOf(json["skipped"], readSkipped);
  const unreadable = listOf(json["unreadable"], readUnreadable);
  const candidateCount = json["candidate_count"];
  const refused = json["refused"];
  if (config === null || files === null) return null;
  if (skipped === null || unreadable === null) return null;
  if (!isNumber(candidateCount) || typeof refused !== "boolean") return null;
  return { config, candidateCount, refused, files, skipped, unreadable };
}

/** One entry from the single-path mode, or `null` for any other shape. */
export function parseSourceEntry(json: unknown): SourceEntry | null {
  if (!isRecord(json) || !isString(json["path"])) return null;
  const path = json["path"];
  switch (json["kind"]) {
    case "file":
      return isString(json["content"])
        ? { kind: "file", path, content: json["content"] }
        : null;
    case "skipped":
      return isNumber(json["size"])
        ? { kind: "skipped", path, size: json["size"] }
        : null;
    case "unreadable":
      return isString(json["reason"])
        ? { kind: "unreadable", path, reason: json["reason"] }
        : null;
    case "absent":
      return { kind: "absent", path };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Building and keeping it fresh
 * ------------------------------------------------------------------ */

/** Byte order for ASCII, as the server's `sort.Strings` orders paths. */
function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function insertSorted<T extends { path: string }>(list: T[], item: T): T[] {
  const out = [...list];
  let at = out.findIndex((existing) => byPath(existing, item) > 0);
  if (at === -1) at = out.length;
  out.splice(at, 0, item);
  return out;
}

/**
 * Scan one candidate as the index reads it: whether it is the roadmap is
 * decided from `config`, so no caller decides it.
 */
export function scanCandidate(
  config: PlanningConfig,
  path: string,
  content: string,
): ScanResult {
  return scanPlanningDocument(path, content, path === config.roadmap);
}

/**
 * Build the index from one batch.
 *
 * The refusal is decided here as well as by whoever produced the batch: a
 * count over `maxCandidates` refuses even when `refused` says otherwise, so the
 * checker's walk and the server cannot disagree about where the line is.
 * Whether a file is the roadmap is decided here too, from the config, and no
 * caller passes it.
 */
export function buildPlanningIndex(sources: PlanningSources): PlanningIndex {
  const builder = planningIndexBuilder(sources);
  for (const file of sources.files) builder.add(file);
  return builder.finish();
}

/** {@link buildPlanningIndex} one file at a time; see {@link planningIndexBuilder}. */
export interface PlanningIndexBuilder {
  /** Scan one file, and return its document if it is a planning document. */
  add(file: { path: string; content: string }): PlanningDocument | null;
  /**
   * Take one file already scanned, as {@link scanCandidate} scans it, and
   * return its document if it is a planning document.
   */
  addResult(path: string, result: ScanResult): PlanningDocument | null;
  /**
   * Take one path's scanned answer, whatever its kind: a `file` as
   * {@link PlanningIndexBuilder.addResult} takes it, a `skipped` or
   * `unreadable` one into its list, and an `absent` one nowhere.
   */
  addScanned(entry: ScannedEntry): PlanningDocument | null;
  finish(): PlanningIndex;
}

/**
 * {@link buildPlanningIndex} over `sources`, with its files added one at a
 * time instead of taken from `sources.files`, so a caller can yield between
 * them, or add files it scanned elsewhere. The lists are sorted once, at
 * `finish`, so a batch costs its files' scans and one sort, where folding each
 * file in with {@link applySource} would copy every list once per file.
 *
 * A refused builder takes nothing, whatever it is given.
 */
export function planningIndexBuilder(
  sources: Omit<PlanningSources, "files">,
): PlanningIndexBuilder {
  const { config, candidateCount } = sources;
  const refused =
    sources.refused || candidateCount > sources.config.maxCandidates;
  const documents: PlanningDocument[] = [];
  const skipped = refused ? [] : [...sources.skipped];
  const unreadable = refused ? [] : [...sources.unreadable];
  const addResult = (
    path: string,
    result: ScanResult,
  ): PlanningDocument | null => {
    if (refused) return null;
    if (result.kind === "unreadable") {
      unreadable.push({ path, reason: result.reason });
    }
    if (result.kind !== "planning") return null;
    documents.push(result.document);
    return result.document;
  };
  return {
    add({ path, content }) {
      if (refused) return null;
      return addResult(path, scanCandidate(config, path, content));
    },
    addResult,
    addScanned(entry) {
      if (refused) return null;
      switch (entry.kind) {
        case "file":
          return addResult(entry.path, entry.result);
        case "skipped":
          skipped.push({ path: entry.path, size: entry.size });
          return null;
        case "unreadable":
          unreadable.push({ path: entry.path, reason: entry.reason });
          return null;
        case "absent":
          return null;
      }
    },
    finish: () => ({
      config,
      candidateCount,
      refused,
      documents: [...documents].sort(byPath),
      skipped: [...skipped].sort(byPath),
      unreadable: [...unreadable].sort(byPath),
    }),
  };
}

/**
 * Apply one path's fresh answer: scan a `file`'s text, then
 * {@link applyScanned}.
 */
export function applySource(
  index: PlanningIndex,
  entry: SourceEntry,
): PlanningIndex {
  if (index.refused) return index;
  if (entry.kind !== "file") return applyScanned(index, entry);
  const { path, content } = entry;
  const result = scanCandidate(index.config, path, content);
  // The index holds no hashes, so `applyScanned` never reads this one.
  return applyScanned(index, { kind: "file", path, hash: "", result });
}

/**
 * Apply one path's fresh answer, already scanned, as {@link scanCandidate}
 * scans it.
 *
 * The path leaves every list first and then joins the one its answer names: a
 * `file` joins `documents` only if it scanned as a planning document, or
 * `unreadable` if its frontmatter does not parse; `absent` joins nothing.
 *
 * A refused index is returned unchanged, and `candidateCount` and `refused`
 * never move here: non-planning candidates are not recorded, so one path's
 * answer cannot tell a new candidate from a known one, and only a rescan can
 * say how many there are now.
 */
export function applyScanned(
  index: PlanningIndex,
  entry: ScannedEntry,
): PlanningIndex {
  if (index.refused) return index;
  const { path } = entry;
  // A list the path is not in is kept as it is, so an answer that changes
  // nothing returns `index` itself: every pushed Markdown path is asked about,
  // and a save of a file that is not a planning document must not read as a
  // new index.
  const without = <T extends { path: string }>(list: T[]): T[] =>
    list.some((item) => item.path === path)
      ? list.filter((item) => item.path !== path)
      : list;
  let documents = without(index.documents);
  let skipped = without(index.skipped);
  let unreadable = without(index.unreadable);

  switch (entry.kind) {
    case "file": {
      const { result } = entry;
      if (result.kind === "planning") {
        documents = insertSorted(documents, result.document);
      } else if (result.kind === "unreadable") {
        unreadable = insertSorted(unreadable, { path, reason: result.reason });
      }
      break;
    }
    case "skipped":
      skipped = insertSorted(skipped, { path, size: entry.size });
      break;
    case "unreadable":
      unreadable = insertSorted(unreadable, { path, reason: entry.reason });
      break;
    case "absent":
      break;
  }
  if (
    documents === index.documents &&
    skipped === index.skipped &&
    unreadable === index.unreadable
  ) {
    return index;
  }
  return { ...index, documents, skipped, unreadable };
}

/**
 * Drop everything under a directory that was removed or renamed away. `dir`
 * itself is repo-relative; `docs/a` drops `docs/a/x.md` and keeps `docs/ab.md`.
 */
export function withoutDirectory(
  index: PlanningIndex,
  dir: string,
): PlanningIndex {
  if (index.refused) return index;
  const prefix = `${dir.replace(/\/+$/, "")}/`;
  const keep = (entry: { path: string }) => !entry.path.startsWith(prefix);
  return {
    ...index,
    documents: index.documents.filter(keep),
    skipped: index.skipped.filter(keep),
    unreadable: index.unreadable.filter(keep),
  };
}

/** The planning document at `path`, if the index holds one. */
export function findDocument(
  index: PlanningIndex,
  path: string,
): PlanningDocument | undefined {
  const { documents } = index;
  let lo = 0;
  let hi = documents.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const doc = documents[mid];
    if (doc === undefined) return undefined;
    if (doc.path === path) return doc;
    if (doc.path < path) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}
