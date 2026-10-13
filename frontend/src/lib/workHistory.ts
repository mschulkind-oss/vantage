import axios from "axios";
import type { PlanningIndex } from "vantage-md/planning";
import { isStaticMode } from "./staticMode";
import {
  buildWorkHistory,
  type PlanningSnapshots,
  type WorkHistory,
} from "./workTransitions";

const unavailable = (reason: string): PlanningSnapshots => ({
  status: "unavailable",
  commits_examined: 0,
  truncated: false,
  reason,
  snapshots: [],
});

function isPlanningSnapshots(value: unknown): value is PlanningSnapshots {
  if (value === null || typeof value !== "object") return false;
  const response = value as Partial<PlanningSnapshots>;
  if (
    !["complete", "partial", "unavailable"].includes(response.status ?? "") ||
    !Number.isInteger(response.commits_examined) ||
    response.commits_examined! < 0 ||
    response.commits_examined! > 50 ||
    typeof response.truncated !== "boolean" ||
    !Array.isArray(response.snapshots) ||
    response.snapshots.length > 50 ||
    (response.reason !== undefined && typeof response.reason !== "string")
  )
    return false;
  if (
    response.status === "partial" &&
    (response.truncated !== true || !response.reason)
  )
    return false;
  if (response.status !== "partial" && response.truncated) return false;
  if (response.status === "unavailable" && response.snapshots.length > 0)
    return false;
  return response.snapshots.every((snapshot) => {
    if (snapshot === null || typeof snapshot !== "object") return false;
    const pair = snapshot as PlanningSnapshots["snapshots"][number];
    return (
      typeof pair.path === "string" &&
      pair.path.length > 0 &&
      !pair.path.startsWith("/") &&
      !pair.path.includes("\\") &&
      pair.path
        .split("/")
        .every(
          (segment) => segment !== "" && segment !== "." && segment !== "..",
        ) &&
      /\.md$/i.test(pair.path) &&
      /^[a-f0-9]{40}$/.test(pair.commit_hexsha) &&
      typeof pair.commit_date === "string" &&
      Number.isFinite(Date.parse(pair.commit_date)) &&
      typeof pair.before === "string" &&
      typeof pair.after === "string" &&
      typeof pair.before_exists === "boolean" &&
      typeof pair.after_exists === "boolean" &&
      (pair.before_exists || pair.before === "") &&
      (pair.after_exists || pair.after === "")
    );
  });
}

/** Load one bounded history batch for the currently selected repository. */
export async function loadWorkHistory(
  repo: string,
  isMultiRepo: boolean,
  index: PlanningIndex,
  now = new Date(),
): Promise<WorkHistory> {
  if (isStaticMode()) {
    return buildWorkHistory(
      index,
      unavailable("This static export has no Git history data."),
      now,
    );
  }
  const base = isMultiRepo ? `/api/r/${encodeURIComponent(repo)}` : "/api";
  try {
    const response = await axios.get<PlanningSnapshots>(
      `${base}/git/planning-snapshots`,
    );
    const data = response.data;
    if (!isPlanningSnapshots(data)) {
      return buildWorkHistory(
        index,
        unavailable("The server returned an invalid Git history response."),
        now,
      );
    }
    return buildWorkHistory(index, data, now);
  } catch {
    return buildWorkHistory(
      index,
      unavailable("Local Git history could not be loaded."),
      now,
    );
  }
}
