/**
 * Which project a planning link's space id names
 * (`docs/reference/planning-index.md` §13.6, which defines the term): the
 * page's side of it. A **space id** is one random id per checkout, kept in its
 * `.vantage/space`, which `vantage-check index --filter` makes and writes into
 * its link as `space=`. In daemon mode a root-relative link has no project
 * segment, so the page asks the server which project it serves holds the id
 * (`GET /api/spaces/{id}`) and opens that project's page, rather than show
 * *Choose a project*.
 *
 * An answer is kept for the tab's session once it says a project holds the
 * id or none does: a checkout's id never changes, and a link is printed only
 * after its file is made, so the answer holds until the server's projects
 * change, which a reload sees. A request that fails is kept by nobody, so the
 * next visit asks again. Nothing is stored in the browser.
 */
import axios from "axios";
import { useEffect, useState, useSyncExternalStore } from "react";
import { PLANNING_SPACE_PARAM, isPlanningSpaceId } from "vantage-md/planning";
import { planningLimits } from "../planningScan/limits";
import { PLANNING_ROUTE } from "./planningRoute";
import { isStaticMode } from "./staticMode";

/**
 * What the server says of a space id: the project holding it, by name (`""`
 * in single-project mode, which serves one), no project it serves, or no
 * answer at all, as from a server too old to have the route.
 */
export type PlanningSpaceAnswer =
  { kind: "found"; repo: string } | { kind: "none" } | { kind: "failed" };

const NONE: PlanningSpaceAnswer = Object.freeze({ kind: "none" });
const FAILED: PlanningSpaceAnswer = Object.freeze({ kind: "failed" });

/** What the page says where a link's space does not open a project's page. */
export const PLANNING_SPACE_MESSAGES = Object.freeze({
  /** Daemon mode, no project segment, and no project served holds the id. */
  notServed:
    "This link was made in a checkout this Vantage does not serve: no project here holds its space id. Each project's planning page below keeps its filter.",
  /** Daemon mode, no project segment, and `space=` holds no space id. */
  notAnId:
    "This link's space= is not a space id, so it names no project. Each project's planning page below keeps its filter.",
  /** Daemon mode, no project segment, and the server gave no answer. */
  failed:
    "This Vantage could not say which project holds this link's space id. Each project's planning page below keeps its filter.",
  /** Single-project mode: the id is not the served checkout's. */
  otherCheckout:
    "This link was made in another checkout: this page shows the checkout this Vantage serves.",
});

/**
 * The `space` value a planning URL's query holds, as written, or `null` when
 * it holds none or only an empty one. The first value counts. Whether it is a
 * space id at all is `isPlanningSpaceId`'s to say.
 */
export function readSpaceRequest(search: URLSearchParams): string | null {
  const value = search.get(PLANNING_SPACE_PARAM);
  return value === null || value === "" ? null : value;
}

/** `search` without any `space` parameter, every other one kept in order. */
export function withoutSpace(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search);
  next.delete(PLANNING_SPACE_PARAM);
  return next;
}

/**
 * The space id to find a project for at `pathname` and `search`: the URL's,
 * when it is the planning route with no project segment and its `space=` is
 * a space id; otherwise `null`. Only daemon mode acts on it, which is not
 * known before the repositories are, so the app shell asks it beside them. A
 * static export has no server to ask.
 */
export function projectlessSpace(
  pathname: string,
  search: string,
): string | null {
  if (isStaticMode()) return null;
  if (pathname !== PLANNING_ROUTE && !pathname.startsWith(`${PLANNING_ROUTE}/`))
    return null;
  const rest = pathname.slice(PLANNING_ROUTE.length).split("/");
  if (rest.some((segment) => segment !== "")) return null;
  const id = readSpaceRequest(new URLSearchParams(search));
  return id !== null && isPlanningSpaceId(id) ? id : null;
}

/** How many ids' answers the session keeps: far more than a tab visits. */
const KEPT = 16;

const answers = new Map<string, PlanningSpaceAnswer>();
const asking = new Map<string, Promise<PlanningSpaceAnswer>>();
const listeners = new Set<() => void>();
/** Moved on by a test's reset, so a request from before it keeps nothing. */
let generation = 0;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The body of a 200 read as an answer; anything else is no answer. */
function answerOf(data: unknown): PlanningSpaceAnswer {
  if (typeof data !== "object" || data === null || !("repo" in data)) {
    return FAILED;
  }
  const { repo } = data as { repo: unknown };
  if (repo === null) return NONE;
  return typeof repo === "string" ? { kind: "found", repo } : FAILED;
}

/**
 * Ask the server which project holds `id`, once: a request in flight is
 * shared, and an answer the session keeps is given again without one. An
 * `id` that is not a space id is never sent, since the server refuses it.
 */
export function askPlanningSpace(id: string): Promise<PlanningSpaceAnswer> {
  const known = answers.get(id);
  if (known !== undefined) return Promise.resolve(known);
  const inFlight = asking.get(id);
  if (inFlight !== undefined) return inFlight;
  if (!isPlanningSpaceId(id)) return Promise.resolve(FAILED);
  const from = generation;
  const asked = axios
    .get<unknown>(`/api/spaces/${id}`)
    .then(
      ({ data }) => answerOf(data),
      () => FAILED,
    )
    .then((answer) => {
      if (from !== generation) return answer;
      asking.delete(id);
      if (answer.kind !== "failed") {
        answers.set(id, answer);
        while (answers.size > KEPT) {
          const oldest = answers.keys().next().value;
          if (oldest === undefined) break;
          answers.delete(oldest);
        }
        for (const listener of listeners) listener();
      }
      return answer;
    });
  asking.set(id, asked);
  return asked;
}

/**
 * The server's answer for `id`, asked when it is not known: `null` while it
 * is on its way, and for a `null` id. An answer the session keeps is there in
 * the first render, so a page opened after it arrived never shows the wait.
 */
export function usePlanningSpace(
  id: string | null,
): PlanningSpaceAnswer | null {
  const kept = useSyncExternalStore(
    subscribe,
    () => (id === null ? null : (answers.get(id) ?? null)),
    () => null,
  );
  // A failed request, which the session keeps no answer for: this caller's.
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (id === null) return;
    let live = true;
    void askPlanningSpace(id).then((answer) => {
      if (live && answer.kind === "failed") setFailed(id);
    });
    return () => {
      live = false;
    };
  }, [id]);
  if (id === null) return null;
  return kept ?? (failed === id ? FAILED : null);
}

/**
 * Whether a first paint waits for the answer for `id`: the hold
 * (`docs/reference/planning-index.md` §12.3), so what the answer decides is in
 * the first paint instead of replacing it. It waits while the answer is on
 * its way, and at most `planningLimits.holdMs` from when `id` is first given;
 * a `null` id holds nothing.
 */
export function usePlanningSpaceHold(id: string | null): boolean {
  const answer = usePlanningSpace(id);
  const [expired, setExpired] = useState<string | null>(null);
  const holding = id !== null && answer === null && expired !== id;
  useEffect(() => {
    if (!holding || id === null) return;
    const timer = setTimeout(() => setExpired(id), planningLimits.holdMs);
    return () => clearTimeout(timer);
  }, [holding, id]);
  return holding;
}

/** Forget every answer and request, for a test that starts afresh. */
export function resetPlanningSpacesForTests(): void {
  generation += 1;
  answers.clear();
  asking.clear();
}
