import { create } from "zustand";
import axios from "axios";
import { isStaticMode } from "../lib/staticMode";
import type { Degradation } from "../types";

/**
 * The ways the server is serving a project worse than normal because it is too
 * big for a limit — the file watcher out of watches, the untracked-file walk
 * out of time. See docs/design/serve-clones-directory.md §7.
 *
 * Global, like the bookmark list: GET /api/degraded spans every project, and
 * the banner picks out the one open. A `degraded_changed` push refetches it.
 *
 * A dismissal lasts until the page is reloaded and is kept in memory only: it
 * is not a preference (lib/preferences.ts owns those), and a limit still hit
 * after a reload is worth saying again.
 */

/** A degradation's identity for dismissal: one per project and kind. */
export const degradationKey = (d: Pick<Degradation, "repo" | "kind">): string =>
  `${d.repo}\u0000${d.kind}`;

/** Discards a response that lost a race, as useStarredStore's listSeq does. */
let loadSeq = 0;

interface DegradedState {
  items: Degradation[];
  /** Keys (see degradationKey) the reader has dismissed on this page. */
  dismissed: string[];
  load: () => Promise<void>;
  dismiss: (d: Pick<Degradation, "repo" | "kind">) => void;
}

export const useDegradedStore = create<DegradedState>((set, get) => ({
  items: [],
  dismissed: [],

  load: async () => {
    if (isStaticMode()) return;
    const seq = ++loadSeq;
    try {
      const res = await axios.get<Degradation[]>("/api/degraded");
      if (seq !== loadSeq) return;
      set({ items: Array.isArray(res.data) ? res.data : [] });
    } catch (error) {
      // A server from before this route has nothing to report.
      console.debug("Failed to load degradations:", error);
    }
  },

  dismiss: (d) => {
    const key = degradationKey(d);
    if (get().dismissed.includes(key)) return;
    set({ dismissed: [...get().dismissed, key] });
  },
}));
