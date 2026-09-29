/**
 * A planning document's state in the file tree
 * (`docs/design/planning-index.md` §7): its stage, or its status chip when it
 * has no stage, and `💬 N` while it has open questions. Every other file's row is
 * unchanged, and so is a planning document with nothing of the three to show.
 *
 * Drawn with the link badge's own markup, so a stage outside the declared words
 * takes the same warning tone here as beside a link, and a screen reader hears
 * the same phrasing.
 */
import type { PlanningBadge } from "vantage-md/planning";
import {
  usePlanningDocument,
  usePlanningStages,
} from "../stores/usePlanningStore";
import { PlanningBadgeChip } from "./PlanningBadge";

export function PlanningTreeBadge({ path }: { path: string }) {
  const doc = usePlanningDocument(path);
  const stages = usePlanningStages();
  if (doc === undefined) return null;

  const open = doc.questions.filter((q) => q.state === "open").length;
  // The stage when there is one; the status only in its absence.
  const status = doc.stage === null ? doc.status : null;
  if (doc.stage === null && status === null && open === 0) return null;

  const badge: PlanningBadge = {
    kind: "document",
    path: doc.path,
    status,
    stage: doc.stage,
    stageInVocabulary:
      stages === null || doc.stage === null || Object.hasOwn(stages, doc.stage),
    open,
    blocked: 0,
  };
  return (
    <span className="shrink-0 text-xs">
      <PlanningBadgeChip badge={badge} />
    </span>
  );
}
