/**
 * A planning document's state in the file tree, in the tree's compact form
 * (`docs/design/planning-index.md` §7): a dot in its status chip's tone, or in
 * the warning tone, as a ring, when its stage is not a declared one, and
 * `💬 N` while it has open questions. The full phrasing is the badge's
 * accessible name and title; the full chip is for links and the document
 * header, where there is room for it.
 *
 * It sits in a slot after the name that is laid out to take no width from it:
 * the name is exactly as wide as it would be with no badge, and the badge uses
 * only the room left over, whole or not at all. How is in `index.css`, under
 * `.vantage-tree-badge-slot`. When it is not drawn, the row's tooltip says what
 * it would have (`FileTree`).
 */
import { VANTAGE_OQ_STATUS } from "vantage-md";
import type { TreeBadge } from "../hooks/usePlanningTreeBadge";
import { cn } from "../lib/utils";
import { PLANNING_BADGE_ATTR } from "./PlanningBadge";

export function PlanningTreeBadge({ badge }: { badge: TreeBadge }) {
  return (
    <span className="vantage-tree-badge-slot">
      <span
        {...{ [PLANNING_BADGE_ATTR]: "document" }}
        role="img"
        aria-label={badge.label}
        title={badge.label}
        className="vantage-tree-badge"
      >
        {badge.tone !== null && (
          <span
            className={cn(
              "vantage-tree-badge__dot",
              `vantage-chip--${badge.tone}`,
              badge.undeclaredStage && "vantage-tree-badge__dot--undeclared",
            )}
          />
        )}
        {badge.open > 0 && (
          <span className="vantage-tree-badge__count">
            {`${VANTAGE_OQ_STATUS.open} ${badge.open}`}
          </span>
        )}
      </span>
    </span>
  );
}
