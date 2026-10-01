/**
 * Every number the planning index at scale fixes, in one object
 * (`docs/reference/planning-index.md`, whose §2 calls this file the
 * *limits module*). The scan worker, its client and cache read theirs here,
 * and so do the planning page and the document page's first paint, so no
 * surface carries a copy of a number another one enforces.
 *
 * Read a limit where it is used, as `planningLimits.chunkDocuments`, and never
 * copy it into a module-level constant: a test proves a limit by configuring it
 * down with {@link setPlanningLimitsForTests}, and a copy taken at import time
 * would not see that. No test grows an input to a default.
 *
 * A worker has its own copy of this module, so an override made on the main
 * thread reaches the inline client and never the worker. The dev server's
 * end-to-end tests configure a worker's own copy down through the `limits`
 * message its dev build takes (`worker.ts`); a production build ignores it.
 */

export interface PlanningLimits {
  /* ---- The scan worker (§8.2, §10, §11) ---- */

  /** Entries per `documents` message: documents, unreadable and skipped. */
  chunkEntries: number;
  /**
   * Bytes of facts per `documents` message, as JSON. A single document larger
   * than this travels alone.
   */
  chunkBytes: number;
  /** The least time between two `progress` messages, in ms. */
  progressMs: number;
  /** Records per scan-cache transaction. */
  cacheBatch: number;
  /**
   * The longest card block kept, in characters (`CardBlock.markdown.length`).
   * A longer one is never stored and is answered only when asked for in full;
   * the page draws a preview card for it (§10.4, §6.6).
   */
  cardChars: number;
  /**
   * Characters of card blocks a scanner holds in memory when there is no scan
   * cache, least recently used first out (§11.4). Every roadmap's are held here
   * even with a cache, since no roadmap is ever stored.
   */
  memoryCardChars: number;
  /** How long a scan runs before it lets other work in, in ms (§10.6). */
  sliceMs: number;

  /* ---- Helpers, for a cold build (§10.5) ---- */

  /** Content received and not yet scanned past which helpers are asked for. */
  helperThresholdBytes: number;
  /** The most content one helper may have queued. */
  helperQueueBytes: number;
  /** The most helpers a build uses. */
  maxHelpers: number;
  /** Cores left to the main thread and the scan worker before any helper. */
  helperReservedCores: number;

  /* ---- The planning page (§6) ---- */

  /** Entries per page of Needs you, Not on a roadmap and Blocked. */
  pageEntries: number;
  /**
   * Card Markdown per page of those sections, in characters (`cardChars`): a
   * page stops before its cards pass it, and always holds at least one entry.
   */
  pageMarkdownChars: number;
  /** Document rows per page of Ready to build, Ready to graduate and Stage conflict. */
  pageRows: number;
  /** Lines per page of Too large and Unreadable. */
  pageLines: number;
  /**
   * Pages in a section from which its pager also offers a page select. The
   * design said only "a long section" (§6.4 still does), so this number is
   * coined here, not taken from it.
   */
  pageSelectFrom: number;
  /** The most cards one commit of the sections renders. */
  commitCards: number;
  /** The most card Markdown one commit renders, in characters. */
  commitMarkdownChars: number;
  /** How long the page inputs may take before a spinner shows, in ms. */
  spinnerMs: number;
  /** How long the sections wait for their documents' reviews, in ms. */
  reviewsDeadlineMs: number;
  /** How long the sections wait for their Mermaid diagrams, in ms. */
  mermaidDeadlineMs: number;
  /** The fixed height a diagram drawn past its deadline is fitted into, in px. */
  mermaidFramePx: number;
  /** Sets of page inputs kept, by repository, index version and pages. */
  pageInputsKept: number;
  /** Digits the header's pending count reserves room for. */
  pendingCountDigits: number;
  /** File lines quoted either side of a comment's anchor in Copy answers. */
  quoteContextLines: number;
  /**
   * Documents the planning outline lists under one section; past it, a line
   * says how many more there are, and the section's pager reaches them. The
   * design names no such number, so this one is coined here.
   */
  outlineDocuments: number;

  /* ---- A document's first paint (§12.3) ---- */

  /** The longest a first paint waits for data already on its way, in ms. */
  holdMs: number;
}

/** The defaults, as the reference's Current values table lists them. */
export const DEFAULT_PLANNING_LIMITS: Readonly<PlanningLimits> = Object.freeze({
  chunkEntries: 100,
  chunkBytes: 256 * 1024,
  progressMs: 100,
  cacheBatch: 100,
  cardChars: 32_000,
  memoryCardChars: 8 * 1024 * 1024,
  sliceMs: 8,

  helperThresholdBytes: 2 * 1024 * 1024,
  helperQueueBytes: 2 * 1024 * 1024,
  maxHelpers: 3,
  helperReservedCores: 2,

  pageEntries: 10,
  pageMarkdownChars: 32 * 1024,
  pageRows: 25,
  pageLines: 50,
  pageSelectFrom: 5,
  commitCards: 30,
  commitMarkdownChars: 96 * 1024,
  spinnerMs: 150,
  reviewsDeadlineMs: 1000,
  mermaidDeadlineMs: 1000,
  mermaidFramePx: 240,
  pageInputsKept: 8,
  pendingCountDigits: 4,
  quoteContextLines: 2,
  outlineDocuments: 50,

  holdMs: 150,
});

/** The limits in force: the defaults, or a test's override of them. */
export const planningLimits: Readonly<PlanningLimits> = {
  ...DEFAULT_PLANNING_LIMITS,
};

/**
 * Configure limits down for one test, over the defaults; `null` restores them.
 * Each call starts from the defaults, so two overrides never stack.
 */
export function setPlanningLimitsForTests(
  overrides: Partial<PlanningLimits> | null,
): void {
  Object.assign(planningLimits, DEFAULT_PLANNING_LIMITS, overrides ?? {});
}
