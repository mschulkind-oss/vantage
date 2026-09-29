/**
 * Planning state in the file tree (`docs/design/planning-index.md` §7): each
 * planning document's row shows its stage, or its status chip without one, and
 * `💬 N` for its open questions; every other row is unchanged.
 */
import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import axios from "axios";
import type { PlanningConfig, PlanningIndex } from "vantage-md/planning";
import { FileTree } from "./FileTree";
import { PLANNING_BADGE_ATTR } from "./PlanningBadge";
import {
  resetPlanningTrackers,
  usePlanningStore,
} from "../stores/usePlanningStore";
import { useRepoStore } from "../stores/useRepoStore";
import { indexOf } from "../test/planning";
import type { FileNode } from "../types";

vi.mock("axios");

const question = (id: string, marker: string) =>
  [
    `1. ${marker} **${id}: A question?**`,
    "",
    `   <!-- vantage: oq id=${id} leaning="Yes." -->`,
    "",
    "   _Leaning:_ yes.",
    "",
  ].join("\n");

const TREE: Record<string, string> = {
  "docs/staged.md": `---\nstatus: in-review\nstage: DESIGN\n---\n\n${question("OQ-1", "\u{1F4AC}")}${question("OQ-2", "\u{1F4AC}")}${question("OQ-3", "\u{1F512}")}`,
  "docs/unstaged.md": `---\nstatus: accepted\n---\n\n# Accepted\n`,
  "docs/typo.md": "---\nstage: DECIEDD\n---\n",
  "docs/settled.md": `# Settled\n\n${question("OQ-1", "✅")}`,
  "docs/plain.md": "# Plain\n",
};

const STAGES: Partial<PlanningConfig> = {
  stages: { DESIGN: "open", DECIDED: "ready" },
};

const file = (path: string): FileNode => ({
  name: path.split("/").pop()!,
  path,
  is_dir: false,
});

const NODES: FileNode[] = [
  { name: "docs", path: "docs", is_dir: true },
  ...Object.keys(TREE).map(file),
];

let version = 0;

function seedReady(index: PlanningIndex, repo = ""): void {
  act(() => {
    usePlanningStore.setState({
      byRepo: {
        [repo]: {
          status: "ready",
          index,
          version: ++version,
          rescanning: false,
          sources: {},
        },
      },
    });
  });
}

const renderTree = (nodes: FileNode[] = NODES) =>
  render(
    <BrowserRouter>
      <FileTree nodes={nodes} />
    </BrowserRouter>,
  );

/** The row of the tree whose link goes to `path`. */
const row = (path: string, repoPrefix = "") =>
  document.querySelector<HTMLElement>(`a[href="${repoPrefix}/${path}"]`)!;

const badgeIn = (path: string, repoPrefix = "") =>
  row(path, repoPrefix).querySelector<HTMLElement>(`[${PLANNING_BADGE_ATTR}]`);

beforeEach(() => {
  resetPlanningTrackers();
  usePlanningStore.setState({ byRepo: {}, reviewEpoch: {} });
  useRepoStore.setState({
    reposLoaded: true,
    isMultiRepo: false,
    currentRepo: null,
  });
  vi.mocked(axios.get).mockReset();
  vi.mocked(axios.get).mockReturnValue(new Promise(() => {}));
});

describe("file-tree badges (§7)", () => {
  it("shows a planning document's stage and open questions, and not its status or blocked ones", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree();
    const badge = badgeIn("docs/staged.md")!;
    expect(badge).toHaveAccessibleName("design, 2 open questions");
    expect(within(badge).getByText("DESIGN")).toBeInTheDocument();
    expect(within(badge).getByText("\u{1F4AC} 2")).toBeInTheDocument();
    expect(within(badge).queryByText("in-review")).toBeNull();
    expect(within(badge).queryByText(/\u{1F512}/u)).toBeNull();
  });

  it("shows the status chip for a planning document with no stage", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree();
    const chip = within(badgeIn("docs/unstaged.md")!).getByText("accepted");
    expect(chip).toHaveClass("vantage-chip", "vantage-chip--tip");
  });

  it("draws a stage outside the declared words in the warning tone", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree();
    expect(within(badgeIn("docs/typo.md")!).getByText("DECIEDD")).toHaveClass(
      "vantage-planning-badge__part--warning",
    );
  });

  it("leaves every other row unchanged", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree();
    expect(badgeIn("docs/plain.md")).toBeNull();
    // A planning document with nothing of the three to show.
    expect(badgeIn("docs/settled.md")).toBeNull();
    expect(row("docs").querySelector(`[${PLANNING_BADGE_ATTR}]`)).toBeNull();
  });

  it("keeps the name first, and the badge after it", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree();
    const name = screen.getByText("staged.md");
    expect(
      name.compareDocumentPosition(badgeIn("docs/staged.md")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows nothing until the index is ready, then follows it", () => {
    renderTree();
    expect(document.querySelector(`[${PLANNING_BADGE_ATTR}]`)).toBeNull();
    seedReady(indexOf(TREE, STAGES));
    expect(badgeIn("docs/staged.md")).toHaveAccessibleName(
      "design, 2 open questions",
    );
    seedReady(
      indexOf(
        {
          ...TREE,
          "docs/staged.md": `---\nstage: DESIGN\n---\n\n${question("OQ-1", "✅")}`,
        },
        STAGES,
      ),
    );
    expect(badgeIn("docs/staged.md")).toHaveAccessibleName("design");
  });

  it("reads the current repository's index in daemon mode", () => {
    useRepoStore.setState({ isMultiRepo: true, currentRepo: "alpha" });
    seedReady(indexOf(TREE, STAGES), "alpha");
    renderTree();
    expect(badgeIn("docs/staged.md", "/alpha")).not.toBeNull();
  });

  it("starts the index: the tree is one of its first needs (§3.4)", () => {
    renderTree();
    expect(axios.get).toHaveBeenCalledWith("/api/planning/sources");
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});
