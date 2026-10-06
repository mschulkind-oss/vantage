/**
 * The planning page's page inputs (`docs/reference/planning-index.md`
 * §6.5): what the shown pages' cards need before they may paint.
 *
 * - **Their card blocks**, from the scanner client, which cut them in the scan
 *   and keeps them in the scan cache. A preview card's block is not asked for.
 * - **The reviews of the documents their cards and rows belong to**, in one
 *   `POST …/planning/reviews` (`usePlanningReviews.ts`), with those of every
 *   listed document holding a question that needs the human, on any page
 *   and under any roadmap, since a comment there answers it and takes it off
 *   the need-you numbers the sections paint with (`needYouDocuments`). The
 *   sections wait for them at most `reviewsDeadlineMs`; comments that come
 *   later go only into each card's reserved count.
 * - **Every Mermaid diagram in those blocks**, drawn into the viewer's SVG
 *   cache, so it is at its full size when its card mounts. The sections wait
 *   at most `mermaidDeadlineMs` after the blocks; a diagram drawn later draws
 *   into a fixed frame.
 *
 * The page renders its sections only from a complete set, in one commit
 * inside a transition, and keeps the set on screen until the next one is
 * complete: a flip, an index update and a stale block all change the page in
 * one commit, never card by card. The first set waits, besides, for the frame
 * to have painted, and on a page opened before its index was ready, for the
 * Markdown pipeline to have run once (`lib/warmMarkdown.ts`).
 *
 * Each set is cached by repository, index version, chosen roadmap, applied
 * planning filter and pages, the last `pageInputsKept` kept, outside any
 * component: a history entry returned to whose set is cached renders the
 * frame and the sections in one commit, and `prefetchPlanningPage` fills the
 * cache ahead of a visit, on the `g` of `g p` and from the viewer's planning
 * entry, for the roadmap the page would choose and no filter (§6.5;
 * `docs/design/planning-filter.md` §6.5).
 */
import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useNavigationType } from "react-router-dom";
import type { CardBlock, PlanningIndex } from "vantage-md/planning";
import { mermaidFences, prerenderMermaid } from "vantage-md/react";
import {
  chooseRoadmap,
  layoutPlanningPage,
  listedQuestions,
  readRememberedRoadmap,
  sectionsOf,
  type PageRequest,
  type PlanningLayout,
} from "../lib/planningPages";
import { afterNextPaint } from "../lib/afterPaint";
import { isStaticMode } from "../lib/staticMode";
import { warmMarkdown } from "../lib/warmMarkdown";
import {
  planningScanner,
  type CardAnswer,
  type CardWant,
} from "../planningScan/client";
import { planningLimits } from "../planningScan/limits";
import {
  usePlanningStore,
  type PlanningLoad,
} from "../stores/usePlanningStore";
import { fetchPlanningReviews, planningReviewsOf } from "./usePlanningReviews";

type ReadyLoad = Extract<PlanningLoad, { status: "ready" }>;

/** A card's block, by its document and its first line. */
export const blockKey = (path: string, startLine: number): string =>
  `${path}\n${startLine}`;

export interface PageInputs {
  /**
   * Repository, index version, chosen roadmap, filter and pages: the cache's
   * key.
   */
  key: string;
  repo: string;
  /** The index these pages were laid out from, and its hashes. */
  index: PlanningIndex;
  version: number;
  hashes: Readonly<Record<string, string>>;
  layout: PlanningLayout;
  /**
   * Each shown card's block, by `blockKey`: `null` when its document no
   * longer has it, or it could not be had. A preview card's is absent.
   */
  blocks: ReadonlyMap<string, CardBlock | null>;
  /** Cards the scanner answered as previews, by `blockKey`. */
  previews: ReadonlySet<string>;
  /** The documents of the shown cards and rows, whose reviews they show. */
  documents: readonly string[];
  /** The reviews request failed before these inputs were complete. */
  reviewsFailed: boolean;
}

/** A set of inputs on screen, and what it had when it was committed. */
export interface ShownInputs {
  inputs: PageInputs;
  /**
   * The documents whose reviews were in hand when the set was committed.
   * Another document's comments came late, so its cards show them only in
   * their reserved count until the reader asks (§12.2).
   */
  reviewed: ReadonlySet<string>;
}

interface Entry {
  promise: Promise<PageInputs | null>;
  /** Set once the promise settles: `null` for a set that was superseded. */
  result?: PageInputs | null;
}

const cache = new Map<string, Entry>();

/** Paths refreshed for a stale block, by repository, path and hash. */
const refreshed = new Set<string>();

/** Forget every set of inputs, and every stale refresh. For tests. */
export function resetPlanningPageInputs(): void {
  cache.clear();
  refreshed.clear();
}

const inputsKey = (
  repo: string,
  version: number,
  layout: PlanningLayout,
): string =>
  // A roadmap's path is never empty, so `""` stands for none; nor is an
  // applied filter's canonical text, which holds no control character, so it
  // sits on a line of its own (planning-filter.md §5.6).
  `${repo}\n${version}\n${layout.roadmap ?? ""}\n${layout.filter}\n${layout.pages}`;

/** `promise`, or nothing once `ms` have passed. */
function within(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void promise.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Draw every Mermaid diagram of `markdowns` into the viewer's SVG cache,
 * waiting for them at most `mermaidDeadlineMs`. A diagram that fails, or is
 * still drawing, is left for its card, which frames it.
 */
export function predrawDiagrams(markdowns: readonly string[]): Promise<void> {
  const codes = new Set<string>();
  for (const markdown of markdowns) {
    for (const code of mermaidFences(markdown)) codes.add(code);
  }
  if (codes.size === 0) return Promise.resolve();
  return within(
    Promise.allSettled([...codes].map((code) => prerenderMermaid(code))),
    planningLimits.mermaidDeadlineMs,
  );
}

/** What a layout's shown pages ask for. */
function needsOf(layout: PlanningLayout, hashes: ReadyLoad["hashes"]) {
  const wants: CardWant[] = [];
  const unhashed: string[] = [];
  const seen = new Set<string>();
  const documents = new Set<string>();
  for (const section of layout.sections) {
    if (section.kind === "rows") {
      for (const path of section.items) documents.add(path);
      continue;
    }
    if (section.kind !== "cards") continue;
    for (const entry of section.items) {
      if (entry.kind === "document") {
        documents.add(entry.path);
        continue;
      }
      const { question } = entry;
      documents.add(question.path);
      if (entry.preview) continue;
      const { startLine } = question.block;
      const key = blockKey(question.path, startLine);
      if (seen.has(key)) continue;
      seen.add(key);
      const hash = hashes[question.path];
      if (hash === undefined) unhashed.push(key);
      else wants.push({ path: question.path, hash, startLine });
    }
  }
  return { wants, unhashed, documents: [...documents].sort() };
}

/**
 * The listed documents holding a question that needs the human — open, or
 * answered and awaiting compaction — under the layout's roadmap: every
 * document whose comments can take a question off the page's need-you
 * numbers (`lib/planningAnswers.ts`), whichever page or roadmap lists it.
 */
export function needYouDocuments(
  index: PlanningIndex,
  roadmap: string | null,
): string[] {
  const paths = new Set<string>();
  for (const question of listedQuestions(index, sectionsOf(index, roadmap))) {
    if (question.state === "open" || question.state === "answered") {
      paths.add(question.path);
    }
  }
  return [...paths].sort();
}

/**
 * Whether the repository's index moves on from `version` within `ms`: the
 * refresh a stale block asked for has landed.
 */
function versionMoves(
  repo: string,
  version: number,
  ms: number,
): Promise<boolean> {
  const moved = () => {
    const load = usePlanningStore.getState().byRepo[repo];
    return load?.status !== "ready" || load.version !== version;
  };
  if (moved()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, ms);
    const unsubscribe = usePlanningStore.subscribe(() => {
      if (!moved()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

/** The block a cached set holds for `want`'s path, line and content hash. */
function heldBlock(repo: string, want: CardWant): CardBlock | undefined {
  const at = blockKey(want.path, want.startLine);
  for (const entry of cache.values()) {
    const had = entry.result;
    if (had?.repo !== repo || had.hashes[want.path] !== want.hash) continue;
    const block = had.blocks.get(at);
    if (block) return block;
  }
  return undefined;
}

async function gather(
  key: string,
  repo: string,
  ready: ReadyLoad,
  layout: PlanningLayout,
): Promise<PageInputs | null> {
  const { wants, unhashed, documents } = needsOf(layout, ready.hashes);

  // The reviews are asked for at once, and waited for at most their deadline:
  // the shown documents', and every one whose comments the need-you numbers
  // read, so that a cold visit paints them right.
  let reviewsFailed = false;
  const reviews = fetchPlanningReviews(repo, [
    ...documents,
    ...needYouDocuments(ready.index, layout.roadmap),
  ]).then(
    (ok) => {
      reviewsFailed = !ok;
    },
    () => {
      reviewsFailed = true;
    },
  );
  const reviewsWait = within(reviews, planningLimits.reviewsDeadlineMs);

  const blocks = new Map<string, CardBlock | null>();
  const previews = new Set<string>();
  for (const k of unhashed) blocks.set(k, null);
  const stale: CardWant[] = [];
  // A block a cached set already holds for the same content is that block: an
  // index update that did not touch a shown document asks the scanner
  // nothing for it, and its card's props stay equal, so it does not render.
  const asked = wants.filter((want) => {
    const held = heldBlock(repo, want);
    if (held === undefined) return true;
    blocks.set(blockKey(want.path, want.startLine), held);
    return false;
  });
  if (asked.length > 0) {
    let answers: CardAnswer[] | null;
    try {
      answers = await planningScanner().cards(repo, asked);
    } catch {
      answers = null;
    }
    asked.forEach((want, at) => {
      const k = blockKey(want.path, want.startLine);
      const answer = answers?.[at];
      if (answer === undefined) blocks.set(k, null);
      else if ("block" in answer) blocks.set(k, answer.block);
      else if ("preview" in answer) previews.add(k);
      else stale.push(want);
    });
  }

  if (stale.length > 0) {
    // The scanner holds another version of these files than the index read:
    // refresh them, and ask again under the index that follows. The page on
    // screen stays until then. A path already refreshed for this hash is not
    // asked twice, and a refresh that changes nothing in time leaves its
    // cards without a block.
    const paths = [
      ...new Set(
        stale
          .filter((want) => {
            const mark = `${repo}\n${want.path}\n${want.hash}`;
            if (refreshed.has(mark)) return false;
            refreshed.add(mark);
            return true;
          })
          .map((want) => want.path),
      ),
    ];
    if (paths.length > 0) {
      usePlanningStore.getState().noteFilesChanged(repo, paths, []);
      const moved = await versionMoves(
        repo,
        ready.version,
        planningLimits.reviewsDeadlineMs,
      );
      if (moved) return null;
    }
    for (const want of stale) {
      blocks.set(blockKey(want.path, want.startLine), null);
    }
  }

  // Every diagram of the blocks, drawn before the cards mount.
  await predrawDiagrams(
    [...blocks.values()].flatMap((block) =>
      block === null ? [] : [block.markdown],
    ),
  );

  await reviewsWait;
  return {
    key,
    repo,
    index: ready.index,
    version: ready.version,
    hashes: ready.hashes,
    layout,
    blocks,
    previews,
    documents,
    reviewsFailed,
  };
}

/**
 * The inputs of `layout`'s pages, from the cache or asked for now. Asking
 * again for a set still on its way waits for the same one.
 */
export function loadPageInputs(
  repo: string,
  ready: ReadyLoad,
  layout: PlanningLayout,
): Entry {
  const key = inputsKey(repo, ready.version, layout);
  const had = cache.get(key);
  if (had !== undefined) {
    // Most recently used, last out.
    cache.delete(key);
    cache.set(key, had);
    return had;
  }
  const entry: Entry = { promise: gather(key, repo, ready, layout) };
  void entry.promise.then(
    (result) => {
      entry.result = result;
      // A superseded set is never wanted again: its version has moved on.
      if (result === null && cache.get(key) === entry) cache.delete(key);
    },
    () => {
      if (cache.get(key) === entry) cache.delete(key);
    },
  );
  cache.set(key, entry);
  while (cache.size > planningLimits.pageInputsKept) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return entry;
}

/**
 * Ask for the inputs of `repo`'s planning page ahead of a visit — every
 * section on its first page unless `request` says otherwise — once its index
 * is ready. For the `g` of `g p`, the viewer's planning entry and a pager.
 *
 * `roadmap` is the roadmap the page shows, for a pager; without one, it is
 * the roadmap a visit would choose with no roadmap in its URL: the one this
 * browser remembers for `repo`, else the default (§6.5). `filter` is the
 * filter the page applies, for a pager, as `PlanningLayout.filter` names it;
 * `g p` and the sidebar entry open the bare page, with none
 * (`planning-filter.md` §6.4).
 */
export function prefetchPlanningPage(
  repo: string,
  request: PageRequest = {},
  roadmap?: string | null,
  filter = "",
): void {
  if (isStaticMode()) return;
  const load = usePlanningStore.getState().byRepo[repo];
  if (load?.status !== "ready" || load.index.refused) return;
  const chosen = chooseRoadmap(
    sectionsOf(load.index).roadmaps,
    roadmap ?? null,
    roadmap === undefined ? readRememberedRoadmap(repo) : null,
  );
  loadPageInputs(
    repo,
    load,
    layoutPlanningPage(
      load.index,
      sectionsOf(load.index, chosen, filter),
      request,
      filter,
    ),
  );
}

function shownOf(inputs: PageInputs): ShownInputs {
  const held = planningReviewsOf(inputs.repo);
  return {
    inputs,
    reviewed: new Set(inputs.documents.filter((path) => path in held)),
  };
}

/**
 * The page inputs on screen for `repo`'s `layout`, laid out from `ready`, and
 * whether a newer set is still on its way (`waiting`) and has been for longer
 * than `spinnerMs` (`slow`).
 *
 * On the first render there is nothing to show, so the frame commits alone,
 * unless this is a return to a history entry whose set is cached.
 */
export function usePlanningPageInputs(
  repo: string | null,
  ready: ReadyLoad | null,
  layout: PlanningLayout | null,
): { shown: ShownInputs | null; waiting: boolean; slow: boolean } {
  const navigationType = useNavigationType();
  const wanted =
    repo !== null && ready !== null && layout !== null && !isStaticMode()
      ? inputsKey(repo, ready.version, layout)
      : null;

  const [shown, setShown] = useState<ShownInputs | null>(() => {
    if (navigationType !== "POP" || wanted === null) return null;
    const result = cache.get(wanted)?.result;
    return result ? shownOf(result) : null;
  });

  // `wanted` names the set; the load and the layout only say how to build it.
  const latest = useRef({ ready, layout });
  useLayoutEffect(() => {
    latest.current = { ready, layout };
  });

  // No set renders before the frame this page first committed has painted
  // (§6.3): a set already in hand when the frame commits — a prefetch on the
  // `g` of `g p` — would otherwise start rendering its cards at once, and the
  // frame would paint only once they yield. A page opened before its index
  // was ready also runs the Markdown pipeline once first, while the index
  // builds, so its first card costs what every other one does (§6.10).
  const [warm] = useState(() => ready === null && !isStaticMode());
  const gate = useRef<Promise<void> | null>(null);
  useLayoutEffect(() => {
    let open: () => void = () => {};
    gate.current = new Promise((resolve) => {
      open = () => resolve();
    });
    return afterNextPaint(() => {
      if (warm) void warmMarkdown().then(open);
      else open();
    });
  }, [warm]);

  useEffect(() => {
    const { ready, layout } = latest.current;
    if (repo === null || ready === null || layout === null || wanted === null) {
      return;
    }
    const entry = loadPageInputs(repo, ready, layout);
    let live = true;
    void Promise.all([entry.promise, gate.current]).then(([inputs]) => {
      if (!live || inputs === null) return;
      startTransition(() =>
        setShown((prev) =>
          prev?.inputs.key === inputs.key ? prev : shownOf(inputs),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [repo, wanted]);

  const waiting = wanted !== null && shown?.inputs.key !== wanted;
  const [slowFor, setSlowFor] = useState<string | null>(null);
  // Forgotten once the wait is over: a later wait for the same set is slow
  // only once it too has passed `spinnerMs`.
  if (!waiting && slowFor !== null) setSlowFor(null);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(
      () => setSlowFor(wanted),
      planningLimits.spinnerMs,
    );
    return () => clearTimeout(timer);
  }, [waiting, wanted]);

  return { shown, waiting, slow: waiting && slowFor === wanted };
}
