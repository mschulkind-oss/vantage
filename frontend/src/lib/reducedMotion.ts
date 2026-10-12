/**
 * Whether the reader has asked their system for less motion.
 *
 * A card answered here is shown shrinking to its row (`shrinkToRow` in
 * `components/PlanningNeedsYou.tsx`), and the question that joins the end of
 * the cards grows in beside it (`growCard` in
 * `components/PlanningQuestionCard.tsx`); for a reader who asked for less
 * motion both take their height at once, and only a colour changes, which moves
 * nothing.
 *
 * Its own module rather than one of theirs: a component file may export
 * components alone, or Fast Refresh rebuilds the module for every edit to it
 * (`react-refresh/only-export-components`).
 */
export function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
