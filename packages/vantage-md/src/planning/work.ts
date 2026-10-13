import type { PlanningIndex } from "./model.js";
import type { PlanningDocument } from "./scan.js";
import type { StageRole } from "./config.js";

export interface WorkStageGroup {
  stage: string;
  documents: PlanningDocument[];
}

export interface WorkRoleGroup {
  role: Exclude<StageRole, "done">;
  stages: WorkStageGroup[];
}

export interface WorkBoard {
  stagesDeclared: boolean;
  roles: WorkRoleGroup[];
  terminal: PlanningDocument[];
  missingStage: PlanningDocument[];
  unmapped: WorkStageGroup[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Group every indexed planning document without assigning a lifecycle order. */
export function deriveWorkBoard(index: PlanningIndex): WorkBoard {
  const roles = new Map<string, Map<string, PlanningDocument[]>>();
  const terminal: PlanningDocument[] = [];
  const missingStage: PlanningDocument[] = [];
  const unmapped = new Map<string, PlanningDocument[]>();
  const stages = index.config.stages;

  for (const document of index.documents) {
    if (document.stage === null) {
      missingStage.push(document);
      continue;
    }
    const role = stages?.[document.stage];
    if (role === "done") {
      terminal.push(document);
      continue;
    }
    if (role === "open" || role === "ready" || role === "built") {
      let byStage = roles.get(role);
      if (byStage === undefined) {
        byStage = new Map();
        roles.set(role, byStage);
      }
      const documents = byStage.get(document.stage) ?? [];
      documents.push(document);
      byStage.set(document.stage, documents);
      continue;
    }
    const documents = unmapped.get(document.stage) ?? [];
    documents.push(document);
    unmapped.set(document.stage, documents);
  }

  const groups = (byStage: Map<string, PlanningDocument[]>): WorkStageGroup[] =>
    [...byStage]
      .sort(([a], [b]) => compare(a, b))
      .map(([stage, documents]) => ({
        stage,
        documents: documents.sort((a, b) => compare(a.path, b.path)),
      }));

  const roleGroups: WorkRoleGroup[] = (["open", "ready", "built"] as const)
    .filter((role) => roles.has(role))
    .map((role) => ({ role, stages: groups(roles.get(role)!) }));

  return {
    stagesDeclared: stages !== null,
    roles: roleGroups,
    terminal: terminal.sort((a, b) => compare(a.path, b.path)),
    missingStage: missingStage.sort((a, b) => compare(a.path, b.path)),
    unmapped: groups(unmapped),
  };
}

/** Match only the card facts the Work filter promises to search. */
export function filterWorkDocuments(
  documents: readonly PlanningDocument[],
  query: string,
): PlanningDocument[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return [...documents];
  return documents.filter((document) =>
    [document.path, document.stage ?? "", document.next ?? ""].some((value) =>
      value.toLocaleLowerCase().includes(needle),
    ),
  );
}
