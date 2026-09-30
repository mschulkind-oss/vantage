/**
 * The planning index — a model of a repository's planning documents, rebuilt
 * from the files on every load and never stored whole
 * (`docs/design/planning-index.md`). What the viewer does keep is each file's
 * scan result, in the browser under the file's content hash, and it never uses
 * one without a matching hash (`docs/design/planning-index-at-scale.md` §8.1).
 *
 * Internal to vantage-md, and deliberately so (P4, Plan Q19): nothing here is
 * exported from the published entry `src/index.ts`, so it is not semver API.
 * The viewer reaches it as `vantage-md/planning` through the frontend's source
 * alias, and `vantage-check` imports it by relative path, as both already
 * consume the rest of this package. One scan, and every surface — link badges,
 * the planning page, Referenced by, the file tree, `vantage-check index` and its
 * rules — is a view of it.
 *
 * Everything is a pure function of JSON-serializable data: no `Map`, no `Set`,
 * no class instance crosses this boundary, so a result can be posted between
 * threads or printed as JSON without a translation step.
 */

export {
  DEFAULT_PLANNING_CONFIG,
  STAGE_ROLES,
  candidateMatcher,
  isStageRole,
} from "./config.js";
export type { PlanningConfig, StageRole } from "./config.js";
export { compileIgnorePatterns } from "./patterns.js";
export { resolveRepoLink } from "./links.js";
export { idsOf, scanPlanningDocument } from "./scan.js";
export type {
  CardBlock,
  DependsOn,
  HeaderProblem,
  PlanningDocument,
  PlanningLink,
  PlanningQuestion,
  QuestionState,
  ScanResult,
} from "./scan.js";
export {
  VANTAGE_OQ_PREFERENCE,
  normalizeLeaning,
} from "../vantageDirectives.js";
export {
  applyScanned,
  applySource,
  buildPlanningIndex,
  findDocument,
  parsePlanningSources,
  parseSourceEntry,
  parseStreamLine,
  planningIndexBuilder,
  scanCandidate,
  withoutDirectory,
} from "./model.js";
export type {
  PlanningIndex,
  PlanningIndexBuilder,
  PlanningSources,
  ScannedEntry,
  SourceEntry,
  StreamLine,
} from "./model.js";
export { badgeFor, badgeSpeech, badgeText } from "./badges.js";
export type { PlanningBadge } from "./badges.js";
export {
  PLANNING_NOTICES,
  derivePlanningSections,
  questionFor,
  referenceSummary,
  referencedBy,
  routeQuestions,
} from "./sections.js";
export type {
  PlanningSections,
  QuestionRef,
  Reference,
  ReferenceSource,
  ReferenceSummary,
  RoutedQuestion,
  WaitingEntry,
} from "./sections.js";
export { cardBlockFor } from "./cardSource.js";
