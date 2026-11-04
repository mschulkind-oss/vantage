import { createContext } from "react";

/**
 * Whether the part of the page below it plays the full height motion of an
 * answer whatever the system asks for. `false` everywhere but the planning
 * motion inspector (`pages/PlanningMotionPage.tsx`), which lets a reader who
 * asked for less motion look at the motion everyone else sees, without
 * touching the preference itself (`lib/reducedMotion.ts`) for the rest of the
 * page. Read by the answered row's shrink and the arriving card's grow.
 */
export const ForcedMotion = createContext(false);
