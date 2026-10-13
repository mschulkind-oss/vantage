import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
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
  it("shows the saved board, authority disclosure and Decisions links", async () => {
    seedIndex(
      {
        "docs/design/a.md":
          frontmatter("DESIGN", "next: Review OQ-1\n") +
          '\n1. 💬 **OQ-1: Is this ready?**\n\n   <!-- vantage: question id=OQ-1 leaning="Check it." -->\n\n   _Leaning:_ Check it.\n',
        "roadmap.md": "---\nstage: DESIGN\n---\n# Roadmap\n",
      },
      1,
      { stages: { DESIGN: "open" } },
    );
    renderWork();
    expect(
      await screen.findByRole("heading", { name: "Saved stage overview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Vantage does not verify implementation or write source files/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Decisions" })).toHaveAttribute(
      "href",
      "/.vantage/planning",
    );
    expect(
      screen.getByRole("link", { name: "1 question on Decisions" }),
    ).toHaveAttribute(
      "href",
      "/.vantage/planning?filter=path:/docs/design/a.md",
    );
    expect(
      screen.getAllByRole("button", { name: "Copy change request" }),
    ).toHaveLength(2);
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
    await screen.findByRole("heading", { name: "Saved stage overview" });
    expect(
      screen.getByRole("region", { name: "Needs classification" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Missing stage" }),
    ).toHaveTextContent("docs/missing.md");
    expect(
      screen.getByRole("region", { name: "Unknown stages" }),
    ).toHaveTextContent("docs/unknown.md");
  });

  it("shows every card after Show more and keeps terminal items collapsed", async () => {
    const tree = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `docs/${String(index).padStart(2, "0")}.md`,
        frontmatter("DESIGN"),
      ]),
    );
    tree["docs/terminal.md"] = frontmatter("SUPERSEDED");
    seedIndex(tree, 1, { stages: { DESIGN: "open", SUPERSEDED: "done" } });
    renderWork();
    await screen.findByRole("heading", { name: "Saved stage overview" });
    expect(document.querySelectorAll("[data-work-document]")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: /Show more/ }));
    expect(document.querySelectorAll("[data-work-document]")).toHaveLength(12);
    expect(screen.queryByText("docs/terminal.md")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Terminal\/reference/ }),
    );
    expect(screen.getByText("docs/terminal.md")).toBeInTheDocument();
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

    expect(await screen.findByText("docs/a-00.md")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Show more \(2 remaining\)/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Terminal\/reference/ }),
    );
    const showMoreEvents = await screen.findByRole("button", {
      name: /Show more \(1 remaining\)/,
    });
    fireEvent.click(showMoreEvents);
    expect(await screen.findByText("docs/event-5.md")).toBeInTheDocument();
    expect(screen.getByText("docs/a-11.md")).toBeInTheDocument();
    expect(screen.getByText("docs/a-terminal.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch to repo B" }));

    expect(await screen.findByText("docs/b-00.md")).toBeInTheDocument();
    expect(screen.queryByText("docs/b-11.md")).not.toBeInTheDocument();
    expect(screen.queryByText("docs/b-terminal.md")).not.toBeInTheDocument();
    expect(screen.queryByText("docs/event-5.md")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^docs\/event-/ })).toHaveLength(
      5,
    );
    expect(document.querySelectorAll("[data-work-document]")).toHaveLength(10);
    expect(
      screen.getByRole("button", { name: /Terminal\/reference/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      await screen.findByRole("button", { name: /Show more \(1 remaining\)/ }),
    ).toBeInTheDocument();
  });

  it("filters local card facts and offers a clear action when there are no matches", async () => {
    seedIndex(
      {
        "docs/alpha.md": frontmatter("DESIGN", "next: Inspect parser\n"),
        "docs/beta.md": frontmatter("DESIGN", "next: Nothing else\n"),
      },
      1,
      { stages: { DESIGN: "open" } },
    );
    renderWork();
    await screen.findByRole("heading", { name: "Saved stage overview" });
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "parser" },
    });
    expect(document.querySelectorAll("[data-work-document]")).toHaveLength(1);
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
    await screen.findByRole("heading", { name: "Saved stage overview" });
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
    expect(screen.getByText("docs/one.md")).toBeInTheDocument();
    expect(screen.queryByText("docs/two.md")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Refresh saved index updates/ }),
    );
    await waitFor(() =>
      expect(screen.getByText("docs/two.md")).toBeInTheDocument(),
    );
    expect(screen.queryByText("docs/one.md")).not.toBeInTheDocument();
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
    expect(await screen.findByText("docs/only.md")).toBeInTheDocument();
    await waitFor(() => expect(setCurrentRepo).toHaveBeenCalledWith("team #1"));
    expect(screen.getByRole("link", { name: "Decisions" })).toHaveAttribute(
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

  it("shows partial Git provenance and a history link for deleted-path evidence", async () => {
    loadWorkHistory.mockResolvedValueOnce({
      status: "partial",
      commitsExamined: 3,
      truncated: true,
      reason: "A shallow boundary was reached.",
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
    seedIndex({});
    renderWork();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "A shallow boundary was reached.",
      ),
    );
    expect(screen.getByRole("link", { name: "docs/gone.md" })).toHaveAttribute(
      "href",
      "/history/docs/gone.md",
    );
    expect(
      screen.getByRole("link", { name: "View file history" }),
    ).toHaveAttribute("href", "/history/docs/gone.md");
    expect(screen.getByText("DESIGN → Deleted")).toBeInTheDocument();
    expect(
      screen.getByText(/Git commit evidence · deadbeef/),
    ).toBeInTheDocument();
  });

  it("copies a proposal without changing the indexed source facts", async () => {
    const index = seedIndex({ "docs/proposal.md": frontmatter("DESIGN") }, 1, {
      stages: { DESIGN: "open" },
    });
    renderWork();
    await screen.findByRole("heading", { name: "Saved stage overview" });
    fireEvent.click(
      screen.getByRole("button", { name: "Copy change request" }),
    );
    await waitFor(() => expect(copyTextOrWarn).toHaveBeenCalled());
    expect(copyTextOrWarn.mock.calls[0]?.[0]).toContain("docs/proposal.md");
    expect(index.documents[0]?.stage).toBe("DESIGN");
    expect(index.documents[0]?.stageSince).toBeUndefined();
  });
});
