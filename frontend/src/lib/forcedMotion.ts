import { createContext } from "react";

/**
 * Whether the part of the page below it plays the full height motion of an
 * answer whatever the system asks for. `false` everywhere but the planning
 * motion inspector (`pages/PlanningMotionPage.tsx`). Its frames show the full
 * transition, but playback starts only when the reader explicitly requests it.
 * This never changes the preference (`lib/reducedMotion.ts`) elsewhere. Read
 * by the answered row's shrink and the arriving card's grow.
 */
export const ForcedMotion = createContext(false);
