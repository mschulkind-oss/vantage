/**
 * Planning state in the file tree (`docs/design/planning-index.md` §7), in the
 * tree's compact form: each planning document's row shows a dot in its status
 * chip's tone and `💬 N` for its open questions, says every word of it once,
 * in the badge's accessible name, and shows them as the tooltip of the row's
 * name and badge; every other row is unchanged. Whether the badge fits is layout, which jsdom does not do:
 * `e2e/tree_badges.spec.ts` measures that.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import axios from "axios";
import type { PlanningConfig, PlanningIndex } from "vantage-md/planning";
import { FileTree } from "./FileTree";
import { PLANNING_BADGE_ATTR } from "./PlanningBadge";
import {
  setPlanningScannerForTests,
  type ScannerClient,
} from "../planningScan/client";
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
  "docs/draft.md": `---\nstatus: draft\n---\n`,
  "docs/deprecated.md": `---\nstatus: deprecated\n---\n`,
  "docs/stage-only.md": "---\nstage: DECIDED\n---\n",
  "docs/typo.md": "---\nstatus: accepted\nstage: DECIEDD\n---\n",
  // Stage matching is exact (Plan Q20), so this is not the declared DESIGN.
  "docs/lowercase.md": `---\nstatus: in-review\nstage: design\n---\n\n${question("OQ-1", "\u{1F4AC}")}`,
  "docs/asks.md": `# Asks\n\n${question("OQ-1", "\u{1F4AC}")}`,
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
  // One planning row and one plain row with a git change, for the dot.
  ...(path === "docs/staged.md" || path === "docs/plain.md"
    ? { git_status: "modified" }
    : {}),
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
          hashes: {},
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

const dotIn = (path: string) =>
  badgeIn(path)!.querySelector<HTMLElement>(".vantage-tree-badge__dot");

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
  // A scanner whose builds never land: every index here is seeded.
  builds = [];
  setPlanningScannerForTests({
    build: (request) => builds.push(request),
    cancel: () => {},
    refresh: () => new Promise(() => {}),
    cards: () => new Promise(() => {}),
    quotes: () => new Promise(() => {}),
  });
});

afterEach(() => setPlanningScannerForTests(null));

let builds: Parameters<ScannerClient["build"]>[0][] = [];

describe("file-tree badges (§7)", () => {
  it("draws a status as a dot and open questions as 💬 N, and says it all in words", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree();
    const badge = badgeIn("docs/staged.md")!;
    // Status, stage and open questions, as a link's badge says them; blocked
    // questions are not the tree's to count.
    expect(badge).toHaveAccessibleName("in review, design, 2 open questions");
    // The count is the only text: no status, no stage, no 🔒.
    expect(badge).toHaveTextContent(/^\u{1F4AC} 2$/u);
    expect(dotIn("docs/staged.md")).toHaveClass("vantage-chip--warning");
    expect(badge.querySelector(".vantage-chip")).toBeNull();
  });

  it("draws each status in its chip's tone, with no words and no count", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree();
    for (const [path, tone, label] of [
      ["docs/draft.md", "muted", "draft"],
      ["docs/unstaged.md", "tip", "accepted"],
      ["docs/deprecated.md", "caution", "deprecated"],
    ]) {
      expect(dotIn(path)).toHaveClass(`vantage-chip--${tone}`);
      expect(badgeIn(path)).toHaveAccessibleName(label);
      expect(badgeIn(path)).toHaveTextContent(/^$/);
    }
  });

  it("draws a stage outside the declared words as a warning ring, whatever the status", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree();
    expect(dotIn("docs/typo.md")).toHaveClass(
      "vantage-chip--warning",
      "vantage-tree-badge__dot--undeclared",
    );
    expect(badgeIn("docs/typo.md")).toHaveAccessibleName(
      "accepted, deciedd, not a declared stage",
    );
    expect(dotIn("docs/staged.md")).not.toHaveClass(
      "vantage-tree-badge__dot--undeclared",
    );
  });

  it("shows an undeclared stage as it is written, where the tooltip is the only text", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree();
    // `design` is not the declared `DESIGN`. Lowercased, as it is spoken, the
    // tooltip would say "design, not a declared stage" of a word that looks
    // declared, and nothing else in the row shows which it is.
    const words =
      "in review, stage \u201cdesign\u201d is not a declared stage, 1 open question";
    expect(screen.getByText("lowercase.md")).toHaveAttribute("title", words);
    expect(badgeIn("docs/lowercase.md")!.parentElement).toHaveAttribute(
      "title",
      words,
    );
    expect(badgeIn("docs/typo.md")!.parentElement).toHaveAttribute(
      "title",
      "accepted, stage \u201cDECIEDD\u201d is not a declared stage",
    );
    // What a screen reader hears is unchanged, and a declared stage's
    // tooltip is its spoken words.
    expect(badgeIn("docs/lowercase.md")).toHaveAccessibleName(
      "in review, design, not a declared stage, 1 open question",
    );
    expect(screen.getByText("staged.md")).toHaveAttribute(
      "title",
      "in review, design, 2 open questions",
    );
  });

  it("draws a declared stage with no status as a muted dot", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree();
    expect(dotIn("docs/stage-only.md")).toHaveClass("vantage-chip--muted");
    expect(badgeIn("docs/stage-only.md")).toHaveAccessibleName("decided");
  });

  it("draws no dot for a document whose only state is its questions", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree();
    const badge = badgeIn("docs/asks.md")!;
    expect(dotIn("docs/asks.md")).toBeNull();
    expect(badge).toHaveTextContent(/^\u{1F4AC} 1$/u);
    expect(badge).toHaveAccessibleName("1 open question");
  });

  it("says the badge's words once, after the file's name, and shows them on hover", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree();
    const r = row("docs/staged.md");
    // The space between the two is the slot's being a flex box, which jsdom
    // has no stylesheet to know; the browser suite reads the spaced name.
    expect(r).toHaveAccessibleName(
      /^staged\.md ?in review, design, 2 open questions$/,
    );
    // Not a second time as a description: a `title` on the row, or on the
    // badge, is one, and a screen reader reads it after the name.
    expect(r).not.toHaveAccessibleDescription();
    expect(badgeIn("docs/staged.md")).not.toHaveAccessibleDescription();
    expect(r).not.toHaveAttribute("title");
    // The tooltip is on what the pointer rests on instead: the name, which
    // fills the row when there is no room to draw the badge, and the slot the
    // badge is drawn in.
    const words = "in review, design, 2 open questions";
    expect(screen.getByText("staged.md")).toHaveAttribute("title", words);
    expect(badgeIn("docs/staged.md")!.parentElement).toHaveAttribute(
      "title",
      words,
    );
    expect(badgeIn("docs/staged.md")).not.toHaveAttribute("title");
  });

  it("leaves a symlink's tooltip on the row's name", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree([
      {
        name: "staged.md",
        path: "docs/staged.md",
        is_dir: false,
        is_symlink: true,
        symlink_target: "elsewhere/staged.md",
      },
    ]);
    const r = row("docs/staged.md");
    expect(r).toHaveAttribute("title", "Symlink → elsewhere/staged.md");
    expect(screen.getByText("staged.md")).not.toHaveAttribute("title");
    expect(badgeIn("docs/staged.md")!.parentElement).toHaveAttribute(
      "title",
      "in review, design, 2 open questions",
    );
  });

  it("leaves every other row unchanged", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree();
    for (const path of ["docs/plain.md", "docs/settled.md", "docs"]) {
      // A plain file, a planning document with nothing of the three to show,
      // and a directory, which is never a planning document.
      expect(badgeIn(path)).toBeNull();
      expect(row(path).querySelector(".vantage-tree-badge-slot")).toBeNull();
      expect(row(path)).not.toHaveAttribute("title");
      expect(row(path).querySelector("[title]")).toBeNull();
    }
    expect(row("docs/plain.md")).toHaveAccessibleName("plain.md");
  });

  it("puts the badge after the name, and the git-change dot still last", () => {
    seedReady(indexOf(TREE, STAGES));
    renderTree();
    const r = row("docs/staged.md");
    const name = screen.getByText("staged.md");
    const slot = badgeIn("docs/staged.md")!.parentElement!;
    expect(slot).toHaveClass("vantage-tree-badge-slot");
    expect(slot.previousElementSibling).toBe(name);
    // The dot is still the row's end, pushed there by its own auto margin,
    // exactly as on a row with no badge.
    const dot = r.lastElementChild!;
    expect(dot.previousElementSibling).toBe(slot);
    expect(dot).toHaveClass("ml-auto", "rounded-full", "bg-amber-500");
    expect(row("docs/plain.md").lastElementChild!.className).toBe(
      dot.className,
    );
  });

  it("shows nothing until the index is ready, then follows it", () => {
    renderTree();
    expect(document.querySelector(`[${PLANNING_BADGE_ATTR}]`)).toBeNull();
    seedReady(indexOf(TREE, STAGES));
    expect(badgeIn("docs/staged.md")).toHaveAccessibleName(
      "in review, design, 2 open questions",
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
    expect(builds).toEqual([{ repo: "", seq: 1, bypassCache: false }]);
  });
});
