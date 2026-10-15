import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { indexOf, type PlanningConfig } from "../test/planning";
import { usePlanningStore } from "../stores/usePlanningStore";
import { useRepoStore } from "../stores/useRepoStore";
import { WorkPage } from "./WorkPage";

const { loadWorkHistory, copyTextOrWarn, setCurrentRepo } = vi.hoisted(() => ({
  loadWorkHistory: vi.fn(),
  copyTextOrWarn: vi.fn(),
  setCurrentRepo: vi.fn(),
}));

vi.mock("../lib/workHistory", () => ({ loadWorkHistory }));
vi.mock("../lib/clipboard", () => ({ copyTextOrWarn }));
vi.mock("../hooks/useWebSocket", () => ({ useWebSocket: vi.fn() }));
vi.mock("../hooks/useShellPage", () => ({
  useShellPage: () => ({
    sidebarCollapsed: true,
    openSidebar: vi.fn(),
    bannerSpace: 0,
  }),
}));
vi.mock("../components/AppShell", () => ({
  OpenSidebarButton: () => null,
}));

const frontmatter = (stage: string, extra = "") =>
  `---\nstage: ${stage}\n${extra}---\n`;
const history = {
  status: "complete" as const,
  commitsExamined: 1,
  truncated: false,
  events: [],
};

function renderWork(path = "/.vantage/work") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/*" element={<WorkPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function detailsSummary(path: string): HTMLElement {
  return document.querySelector(
    `[data-work-document="${path}"] summary`,
  ) as HTMLElement;
}

function MultiRepoWorkRoute() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate("/.vantage/work/repo-b")}>
        Switch to repo B
      </button>
      <Routes>
        <Route path="/.vantage/work/:repo" element={<WorkPage />} />
      </Routes>
    </>
  );
}

function seedIndex(
  tree: Record<string, string>,
  version = 1,
  config: Partial<PlanningConfig> = {},
) {
  const index = indexOf(tree, config);
  usePlanningStore.setState({
    byRepo: {
      "": { status: "ready", index, version, rescanning: false, hashes: {} },
    },
    ensure: vi.fn(),
    rescan: vi.fn(),
  });
  return index;
}

function seedRepo(multi = false, repos: { name: string }[] = []) {
  useRepoStore.setState({
    isMultiRepo: multi,
    currentRepo: null,
    repos,
    reposLoaded: true,
    setCurrentRepo,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.__VANTAGE_STATIC__ = false;
  loadWorkHistory.mockResolvedValue(history);
  copyTextOrWarn.mockResolvedValue(true);
  seedRepo();
});

afterEach(() => {
  window.__VANTAGE_STATIC__ = false;
});

describe("WorkPage", () => {
  it("shows the saved overview without an unconditional source-claims disclaimer", async () => {
    seedIndex(
      {
        "docs/design/a.md":
          frontmatter(
            "DESIGN",
            'title: "A custom document"\nnext: Review OQ-1\n',
          ) +
          '\n1. 💬 **OQ-1: Is this ready?**\n\n   <!-- vantage: question id=OQ-1 leaning="Check it." -->\n\n   _Leaning:_ Check it.\n',
        "roadmap.md": "---\nstage: DESIGN\n---\n# Roadmap\n",
      },
      1,
      { stages: { DESIGN: "open" } },
    );
    renderWork();
    expect(
      await screen.findByRole("heading", { name: "Work overview" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        /Vantage does not verify implementation or write source files/,
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Questions" })).toHaveAttribute(
      "href",
      "/.vantage/planning",
    );
    expect(
      screen.getByRole("link", { name: "1 question on Questions" }),
    ).toHaveAttribute(
      "href",
      "/.vantage/planning?filter=path:/docs/design/a.md",
    );
    expect(
      screen.getByRole("link", {
        name: "A custom document — docs/design/a.md",
      }),
    ).toBeInTheDocument();
    fireEvent.click(detailsSummary("docs/design/a.md"));
    const customCard = document.querySelector(
      '[data-work-document="docs/design/a.md"]',
    ) as HTMLElement;
    expect(
      within(customCard).getByRole("link", { name: "Review OQ-1" }),
    ).toHaveAttribute(
      "href",
      "/.vantage/planning?filter=path:/docs/design/a.md",
    );
    expect(
      within(customCard).getByRole("button", { name: "Copy change request" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(loadWorkHistory).toHaveBeenCalledTimes(1));
  });

  it("shows effective question state, waiting dependencies, and ready/built conflicts", async () => {
    const question =
      '\n1. 💬 **OQ-1: What blocks this?**\n\n   <!-- vantage: question id=OQ-1 leaning="Review it." -->\n\n   _Leaning:_ Review it.\n';
    seedIndex(
      {
        "docs/target.md": frontmatter("DESIGN") + question,
        "docs/waiting.md":
          frontmatter("READY", "depends-on: target.md#OQ-1\n") + question,
      },
      1,
      { stages: { DESIGN: "open", READY: "ready" } },
    );
    renderWork();
    fireEvent.click(detailsSummary("docs/target.md"));
    fireEvent.click(detailsSummary("docs/waiting.md"));
    expect(screen.getByText("Conflict")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Stage conflict: a ready/built stage has an open question.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "docs/target.md#OQ-1" }),
    ).toHaveAttribute("href", "/docs/target.md");
    expect(screen.getAllByText(/1 open · 0 waiting · 0 answered/)).toHaveLength(
      2,
    );
  });

  it("keeps missing and configured-unknown stages visible under classification", async () => {
    seedIndex(
      {
        "docs/unknown.md": frontmatter("MYSTERY"),
        "docs/missing.md": "---\nstatus: draft\n---\n",
      },
      1,
      { stages: { DESIGN: "open" } },
    );
    renderWork();
    expect(
      screen.getByRole("region", {
        name: "Needs classification: Missing stage",
      }),
    ).toHaveTextContent("docs/missing.md");
    expect(
      screen.getByRole("region", { name: "Unknown stage: MYSTERY" }),
    ).toHaveTextContent("docs/unknown.md");
  });

  it("shows every active tile and keeps terminal items collapsed with a count", async () => {
    const tree = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `docs/${String(index).padStart(2, "0")}.md`,
        frontmatter("DESIGN"),
      ]),
    );
    tree["docs/terminal.md"] = frontmatter("SUPERSEDED");
    seedIndex(tree, 1, { stages: { DESIGN: "open", SUPERSEDED: "done" } });
    renderWork();
    await screen.findByRole("heading", { name: "Work overview" });
    expect(document.querySelectorAll("[data-work-document]")).toHaveLength(12);
    expect(screen.queryByText("docs/terminal.md")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Terminal\/reference.*1 matching.*1 applied/,
      }),
    ).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(
      screen.getByRole("button", {
        name: /Terminal\/reference.*1 matching.*1 applied/,
      }),
    );
    expect(
      screen.getByRole("link", { name: "terminal.md — docs/terminal.md" }),
    ).toBeInTheDocument();
  });

  it("resets card, terminal, and event expansion when switching repositories", async () => {
    const indexFor = (prefix: string) =>
      indexOf(
        {
          ...Object.fromEntries(
            Array.from({ length: 12 }, (_, index) => [
              `docs/${prefix}-${String(index).padStart(2, "0")}.md`,
              frontmatter("DESIGN"),
            ]),
          ),
          [`docs/${prefix}-terminal.md`]: frontmatter("SUPERSEDED"),
        },
        { stages: { DESIGN: "open", SUPERSEDED: "done" } },
      );
    const events = Array.from({ length: 6 }, (_, index) => ({
      key: `git:commit-${index}:docs/event-${index}.md`,
      path: `docs/event-${index}.md`,
      from: "DESIGN",
      to: "DECIDED",
      source: "git" as const,
      evidenceAt: new Date(Date.now() - index * 60_000).toISOString(),
      commit: `commit-${index}`,
      conflict: false,
    }));
    const repoHistory = { ...history, events };
    loadWorkHistory.mockResolvedValue(repoHistory);
    seedRepo(true, [{ name: "repo-a" }, { name: "repo-b" }]);
    usePlanningStore.setState({
      byRepo: {
        "repo-a": {
          status: "ready",
          index: indexFor("a"),
          version: 1,
          rescanning: false,
          hashes: {},
        },
        "repo-b": {
          status: "ready",
          index: indexFor("b"),
          version: 1,
          rescanning: false,
          hashes: {},
        },
      },
      ensure: vi.fn(),
      rescan: vi.fn(),
    });
    render(
      <MemoryRouter initialEntries={["/.vantage/work/repo-a"]}>
        <MultiRepoWorkRoute />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("link", { name: "a-00.md — docs/a-00.md" }),
    ).toBeInTheDocument();
    fireEvent.click(detailsSummary("docs/a-00.md"));
    fireEvent.click(
      screen.getByRole("button", {
        name: /Terminal\/reference.*1 matching · 1 applied · Show/,
      }),
    );
    const showMoreEvents = await screen.findByRole("button", {
      name: /Show more \(1 remaining\)/,
    });
    fireEvent.click(showMoreEvents);
    expect(await screen.findByText("docs/event-5.md")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "a-11.md — docs/a-11.md" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "a-terminal.md — docs/a-terminal.md" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch to repo B" }));

    expect(
      await screen.findByRole("link", { name: "b-00.md — docs/b-00.md" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "b-11.md — docs/b-11.md" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("docs/b-terminal.md")).not.toBeInTheDocument();
    expect(screen.queryByText("docs/event-5.md")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^docs\/event-/ })).toHaveLength(
      5,
    );
    expect(document.querySelectorAll("[data-work-document]")).toHaveLength(12);
    expect(
      (
        document.querySelector(
          '[data-work-document="docs/b-00.md"] details',
        ) as HTMLDetailsElement
      ).open,
    ).toBe(false);
    expect(
      screen.getByRole("button", {
        name: /Terminal\/reference.*1 matching · 1 applied · Show/,
      }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      await screen.findByRole("button", { name: /Show more \(1 remaining\)/ }),
    ).toBeInTheDocument();
  });

  it("filters titles and local card facts and offers a clear action when there are no matches", async () => {
    seedIndex(
      {
        "docs/alpha.md":
          frontmatter("DESIGN", "next: Inspect parser\n") +
          "\n# Parser mechanics\n",
        "docs/beta.md":
          frontmatter("DESIGN", "next: Nothing else\n") + "\n# Other title\n",
      },
      1,
      { stages: { DESIGN: "open" } },
    );
    renderWork();
    await screen.findByRole("heading", { name: "Work overview" });
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Parser mechanics" },
    });
    expect(document.querySelectorAll("[data-work-document]")).toHaveLength(1);
    expect(screen.getByTestId("work-counts")).toHaveTextContent(
      "1 matching · 2 in applied snapshot",
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "missing" },
    });
    expect(screen.getByText(/No documents match/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(document.querySelectorAll("[data-work-document]")).toHaveLength(2);
  });

  it("holds an external index update until Refresh applies it", async () => {
    const first = seedIndex({ "docs/one.md": frontmatter("DESIGN") }, 1, {
      stages: { DESIGN: "open" },
    });
    renderWork();
    await screen.findByRole("heading", { name: "Work overview" });
    act(() => {
      usePlanningStore.setState({
        byRepo: {
          "": {
            status: "ready",
            index: indexOf(
              { "docs/two.md": frontmatter("DESIGN") },
              { stages: { DESIGN: "open" } },
            ),
            version: 2,
            rescanning: false,
            hashes: {},
          },
        },
      });
    });
    expect(
      screen.getByRole("link", { name: "one.md — docs/one.md" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "two.md — docs/two.md" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Refresh saved index updates/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "two.md — docs/two.md" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("link", { name: "one.md — docs/one.md" }),
    ).not.toBeInTheDocument();
    expect(first.documents).toHaveLength(1);
  });

  it("does not show a different repository when the route names a missing one", async () => {
    seedRepo(true, [{ name: "available" }]);
    usePlanningStore.setState({
      byRepo: {
        available: {
          status: "ready",
          index: indexOf({ "docs/safe.md": frontmatter("DESIGN") }),
          version: 1,
          rescanning: false,
          hashes: {},
        },
      },
    });
    renderWork("/.vantage/work/missing");
    expect(
      await screen.findByText(/Repository “missing” is not available/),
    ).toBeInTheDocument();
    expect(screen.queryByText("docs/safe.md")).not.toBeInTheDocument();
    expect(loadWorkHistory).not.toHaveBeenCalled();
  });

  it("reconciles an encoded repository route and selects only its index", async () => {
    seedRepo(true, [{ name: "team #1" }]);
    usePlanningStore.setState({
      byRepo: {
        "team #1": {
          status: "ready",
          index: indexOf({ "docs/only.md": frontmatter("DESIGN") }),
          version: 1,
          rescanning: false,
          hashes: {},
        },
      },
    });
    renderWork("/.vantage/work/team%20%231");
    expect(
      await screen.findByRole("link", { name: "only.md — docs/only.md" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(setCurrentRepo).toHaveBeenCalledWith("team #1"));
    expect(screen.getByRole("link", { name: "Questions" })).toHaveAttribute(
      "href",
      "/.vantage/planning/team%20%231",
    );
  });

  it("shows a project chooser instead of the single-repo index in daemon mode", async () => {
    seedRepo(true, [{ name: "one" }, { name: "two" }]);
    usePlanningStore.setState({
      byRepo: {
        one: {
          status: "ready",
          index: indexOf({ "docs/wrong.md": frontmatter("DESIGN") }),
          version: 1,
          rescanning: false,
          hashes: {},
        },
      },
    });
    renderWork("/.vantage/work");
    expect(
      await screen.findByText("Choose a repository to see its Work overview."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "one" })).toHaveAttribute(
      "href",
      "/.vantage/work/one",
    );
    expect(screen.queryByText("docs/wrong.md")).not.toBeInTheDocument();
  });

  it("keeps the static index unavailable and makes no history request", async () => {
    window.__VANTAGE_STATIC__ = true;
    usePlanningStore.setState({
      byRepo: {
        "": {
          status: "error",
          message:
            "This is a static export, which has no planning index: it needs the Vantage server.",
        },
      },
      ensure: vi.fn(),
    });
    renderWork();
    expect(
      await screen.findByRole("heading", {
        name: "Planning index unavailable",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/static export, which has no planning index/),
    ).toBeInTheDocument();
    expect(loadWorkHistory).not.toHaveBeenCalled();
  });

  it.each([
    "A shallow boundary was reached.",
    "The source-pair limit was reached. Older transitions were not inspected.",
  ])(
    "keeps partial Git coverage compact and preserves its full reason: %s",
    async (reason) => {
      loadWorkHistory.mockResolvedValueOnce({
        status: "partial",
        commitsExamined: 3,
        truncated: true,
        reason,
        events: [
          {
            key: "git:deadbeef:docs/gone.md",
            path: "docs/gone.md",
            from: "DESIGN",
            to: "Deleted",
            source: "git",
            evidenceAt: "2026-03-01T00:00:00.000Z",
            commit: "deadbeef",
            conflict: false,
          },
        ],
      });
      seedIndex({ "docs/current.md": frontmatter("DESIGN") }, 1, {
        stages: { DESIGN: "open" },
      });
      renderWork();
      await screen.findByText("Recent Git evidence is limited");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Recent Git evidence is limited",
      );
      expect(screen.getByRole("status")).not.toHaveTextContent(reason);
      const summary = screen.getByText("Coverage details");
      const details = summary.closest("details")!;
      expect(details).not.toHaveAttribute("open");
      expect(within(details).getByText(reason)).toBeInTheDocument();
      expect(details).toHaveTextContent(
        "This limits automatic transition evidence only; saved stage counts are unaffected.",
      );
      fireEvent.click(summary);
      expect(details).toHaveAttribute("open");
      expect(screen.getByTestId("work-counts")).toHaveTextContent(
        "1 matching · 1 in applied snapshot",
      );
      expect(
        screen.getByRole("link", { name: "docs/gone.md" }),
      ).toHaveAttribute("href", "/history/docs/gone.md");
      expect(
        screen.getByRole("link", { name: "View file history" }),
      ).toHaveAttribute("href", "/history/docs/gone.md");
      expect(screen.getByText("DESIGN → Deleted")).toBeInTheDocument();
      expect(
        screen.getByText(/Git commit evidence · deadbeef/),
      ).toBeInTheDocument();
    },
  );

  it("distinguishes unavailable Git from limited coverage while preserving metadata evidence", async () => {
    loadWorkHistory.mockResolvedValueOnce({
      status: "unavailable",
      commitsExamined: 0,
      truncated: false,
      reason: "This repository has no local Git history.",
      events: [
        {
          key: "metadata:docs/current.md",
          path: "docs/current.md",
          to: "DESIGN",
          source: "document-metadata",
          evidenceAt: "2026-03-01T00:00:00.000Z",
          conflict: false,
        },
      ],
    });
    seedIndex({ "docs/current.md": frontmatter("DESIGN") }, 1, {
      stages: { DESIGN: "open" },
    });
    renderWork();
    await screen.findByText("Recent Git evidence is unavailable");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Recent Git evidence is unavailable",
    );
    expect(
      screen.queryByText("Recent Git evidence is limited"),
    ).not.toBeInTheDocument();
    const details = screen.getByText("Coverage details").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(
      "This repository has no local Git history.",
    );
    expect(details).toHaveTextContent(
      "Metadata evidence, if present, is still shown separately.",
    );
    expect(
      screen.getByText("Document metadata evidence: stage entered DESIGN"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "docs/current.md" })[0],
    ).toHaveAttribute("href", "/docs/current.md");
    expect(screen.getByTestId("work-counts")).toHaveTextContent(
      "1 matching · 1 in applied snapshot",
    );
    expect(
      screen.queryByRole("link", { name: "View file history" }),
    ).not.toBeInTheDocument();
  });

  it("keeps complete empty coverage free of a warning disclosure", async () => {
    seedIndex({});
    renderWork();
    expect(
      await screen.findByText(
        "No recent stage transitions were found in the inspected window.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Coverage details")).not.toBeInTheDocument();
  });

  it("copies a proposal without changing the indexed source facts", async () => {
    const index = seedIndex({ "docs/proposal.md": frontmatter("DESIGN") }, 1, {
      stages: { DESIGN: "open" },
    });
    renderWork();
    fireEvent.click(detailsSummary("docs/proposal.md"));
    fireEvent.click(
      screen.getByRole("button", { name: "Copy change request" }),
    );
    await waitFor(() => expect(copyTextOrWarn).toHaveBeenCalled());
    expect(copyTextOrWarn.mock.calls[0]?.[0]).toContain("docs/proposal.md");
    expect(index.documents[0]?.stage).toBe("DESIGN");
    expect(index.documents[0]?.stageSince).toBeUndefined();
  });
});
