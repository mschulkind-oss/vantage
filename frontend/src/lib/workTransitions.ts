import {
  candidateMatcher,
  isRoadmapPath,
  scanPlanningDocument,
  type PlanningIndex,
} from "vantage-md/planning";

export interface PlanningSnapshot {
  path: string;
  commit_hexsha: string;
  commit_date: string;
  before: string;
  after: string;
  before_exists: boolean;
  after_exists: boolean;
}

export interface PlanningSnapshots {
  status: "complete" | "partial" | "unavailable";
  commits_examined: number;
  truncated: boolean;
  reason?: string;
  snapshots: PlanningSnapshot[];
}

export interface WorkTransition {
  key: string;
  path: string;
  from: string | null;
  to: string;
  source: "document-metadata" | "git";
  evidenceAt: string;
  commit: string | null;
  conflict: boolean;
}

export interface WorkHistory {
  status: PlanningSnapshots["status"];
  commitsExamined: number;
  truncated: boolean;
  reason?: string;
  events: WorkTransition[];
}

const codeUnitCompare = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

function scannedStage(
  path: string,
  content: string,
  index: PlanningIndex,
): { stage: string | null; planning: boolean; stageSince?: string } | null {
  const result = scanPlanningDocument(
    path,
    content,
    isRoadmapPath(index.config, path),
  );
  if (result.kind === "unreadable") return null;
  if (result.kind === "not-planning") return { stage: null, planning: false };
  return {
    stage: result.document.stage,
    planning: true,
    ...(result.document.stageSince === undefined
      ? {}
      : { stageSince: result.document.stageSince }),
  };
}

/** Compare bounded historical source pairs using the same scanner as the index. */
export function buildWorkHistory(
  index: PlanningIndex,
  snapshots: PlanningSnapshots,
  now = new Date(),
): WorkHistory {
  const nowMs = now.getTime();
  const startMs = nowMs - 168 * 60 * 60 * 1000;
  const isCandidate = candidateMatcher(index.config);
  const eventsByPath = new Map<string, WorkTransition>();
  const metadataEvents: WorkTransition[] = [];

  for (const document of index.documents) {
    if (document.stage === null || document.stageSince === undefined) continue;
    const evidence = new Date(document.stageSince);
    metadataEvents.push({
      key: `metadata:${document.path}:${document.stageSince}`,
      path: document.path,
      from: null,
      to: document.stage,
      source: "document-metadata",
      evidenceAt: document.stageSince,
      commit: null,
      conflict: false,
    });
    // Invalid dates are rejected by the scanner; retain the guard at this
    // boundary so an additive wire field cannot manufacture an event.
    if (!Number.isFinite(evidence.getTime())) metadataEvents.pop();
  }

  for (const pair of snapshots.snapshots) {
    if (!isCandidate(pair.path)) continue;
    const before = pair.before_exists
      ? scannedStage(pair.path, pair.before, index)
      : null;
    const after = pair.after_exists
      ? scannedStage(pair.path, pair.after, index)
      : null;
    if (before === null || !before.planning) continue;
    if (pair.after_exists && after === null) continue;
    const deleted = !pair.after_exists;
    if (deleted && before.stage === null) continue;
    const afterStage = after?.stage ?? null;
    if (!deleted && before.stage === afterStage) continue;

    const current = index.documents.find(
      (document) => document.path === pair.path,
    );
    const hasMetadata = current?.stageSince !== undefined;
    if (hasMetadata && !deleted && afterStage === current?.stage) continue;
    const event: WorkTransition = {
      key: `git:${pair.commit_hexsha}:${pair.path}`,
      path: pair.path,
      from: before.stage,
      to: deleted ? "Deleted" : (afterStage ?? "No saved stage"),
      source: "git",
      evidenceAt: pair.commit_date,
      commit: pair.commit_hexsha,
      conflict: hasMetadata && afterStage !== current?.stage,
    };
    // The service returns commits newest first, and only the newest proven
    // transition for any path is retained.
    if (!eventsByPath.has(pair.path)) eventsByPath.set(pair.path, event);
  }

  const inWindow = (event: WorkTransition): boolean => {
    const at = new Date(event.evidenceAt).getTime();
    return Number.isFinite(at) && at >= startMs && at <= nowMs;
  };
  const events = [...metadataEvents, ...eventsByPath.values()]
    .filter(inWindow)
    .sort((a, b) => {
      const date = Date.parse(b.evidenceAt) - Date.parse(a.evidenceAt);
      return (
        date ||
        codeUnitCompare(a.path, b.path) ||
        codeUnitCompare(a.source, b.source) ||
        codeUnitCompare(a.key, b.key)
      );
    });

  return {
    status: snapshots.status,
    commitsExamined: snapshots.commits_examined,
    truncated: snapshots.truncated,
    ...(snapshots.reason === undefined ? {} : { reason: snapshots.reason }),
    events,
  };
}
