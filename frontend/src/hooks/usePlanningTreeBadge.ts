/**
 * What a file-tree row shows of its planning document
 * (`docs/design/planning-index.md` §7), in the tree's compact form: a dot in
 * the status chip's tone and `💬 N` for open questions, with every word of it
 * in `label`.
 *
 * The compact form exists because a row has one scarce thing, its width, and
 * the file name has the first claim on all of it. A full chip took enough of it
 * to cut a long name down to its first letter; a dot and a count need a few
 * characters' worth, and whatever they cannot show, `label` still says, in the
 * badge's accessible name and in the row's tooltip.
 */
import { useMemo } from "react";
import { DOC_STATUS_TONES, VANTAGE_TONES } from "vantage-md";
import {
  badgeSpeech,
  type PlanningDocument,
  type PlanningIndex,
} from "vantage-md/planning";
import {
  usePlanningDocument,
  usePlanningStages,
} from "../stores/usePlanningStore";

export interface TreeBadge {
  /**
   * The dot's tone, one of the chip tones: the stage's warning when the stage
   * is not a declared one, else the status chip's, else muted for a stage
   * alone. `null` draws no dot, for a document whose only state is questions.
   */
  tone: (typeof VANTAGE_TONES)[number] | null;
  /** The stage is not one of the declared words (§4). */
  undeclaredStage: boolean;
  /** Open questions: `💬 N` when there are any. Blocked ones are not shown. */
  open: number;
  /**
   * Everything the row knows, phrased as a link's badge says it to a screen
   * reader: `in review, design, 4 open questions`. The badge's accessible name
   * and title, and the row's tooltip.
   */
  label: string;
}

/**
 * The badge a row shows for `doc`, or `null` when the row shows none: when the
 * file is not a planning document, and when it is one with no status, no stage
 * and no open question (§5.1's empty badge, which is never drawn).
 */
export function treeBadgeOf(
  doc: PlanningDocument | undefined,
  stages: PlanningIndex["config"]["stages"],
): TreeBadge | null {
  if (doc === undefined) return null;
  const open = doc.questions.filter((q) => q.state === "open").length;
  if (doc.status === null && doc.stage === null && open === 0) return null;

  const stageInVocabulary =
    stages === null || doc.stage === null || Object.hasOwn(stages, doc.stage);
  const tone =
    doc.stage !== null && !stageInVocabulary
      ? "warning"
      : doc.status !== null
        ? DOC_STATUS_TONES[doc.status]
        : doc.stage !== null
          ? "muted"
          : null;
  return {
    tone,
    undeclaredStage: !stageInVocabulary,
    open,
    label: badgeSpeech({
      kind: "document",
      path: doc.path,
      status: doc.status,
      stage: doc.stage,
      stageInVocabulary,
      open,
      blocked: 0,
    }),
  };
}

/**
 * The tree badge for the file at `path` in the current repository's ready
 * index; `null` for a directory (pass `null`), for a file that is not a
 * planning document, and until the index is ready. Starts nothing, and
 * re-renders only when this one document or the stage vocabulary changes
 * (`usePlanningDocument`).
 */
export function usePlanningTreeBadge(path: string | null): TreeBadge | null {
  const doc = usePlanningDocument(path ?? "");
  const stages = usePlanningStages();
  return useMemo(
    () => (path === null ? null : treeBadgeOf(doc, stages)),
    [path, doc, stages],
  );
}
