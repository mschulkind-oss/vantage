/**
 * A question's card on the planning page (`docs/design/planning-index.md`
 * §6.3), and above all §13's last risk: an answer filed from the page must be
 * indistinguishable from one filed with the in-page button.
 *
 * Each case files the same question twice — once with the in-page button over
 * the whole document, rendered by the app's `MarkdownViewer` in review mode,
 * and once from its card — and holds the two comments equal: the same
 * `anchor`, the same `comment` and the same `fallback_text`. The corpus is
 * every question in `agent-bootstrap.md`, each host shape the gallery shows,
 * and fixtures whose block holds a reference-style link and a footnote, the
 * two things a slice of a document can render differently from the document.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import axios from "axios";
import {
  buildPlanningIndex,
  cardBlockFor,
  scanPlanningDocument,
  type CardBlock,
  type PlanningIndex,
  type PlanningQuestion,
} from "vantage-md/planning";
import { MarkdownViewer } from "./MarkdownViewer";
import { PlanningQuestionCard, WAITING_LABEL } from "./PlanningQuestionCard";
import {
  OQ_DEFAULT_LEANING,
  answerableOpenQuestions,
} from "../hooks/useOpenQuestionButtons";
import {
  resetPlanningTrackers,
  usePlanningStore,
} from "../stores/usePlanningStore";
import { useRepoStore } from "../stores/useRepoStore";
import { useReviewStore } from "../stores/useReviewStore";
import { readRepoFile, sourcesOf } from "../test/planning";
import type { CommentAnchor, ReviewComment } from "../types";

vi.mock("axios");
vi.mock("vantage-md/react", async () => {
  const actual = await vi.importActual("vantage-md/react");
  return {
    ...actual,
    MermaidDiagram: ({ code }: { code: string }) => <pre>{code}</pre>,
  };
});
const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

afterEach(cleanup);

/* ------------------------------------------------------------------ *
 * The corpus
 * ------------------------------------------------------------------ */

const REFERENCE_LINK = [
  "# Referenced",
  "",
  "1. \u{1F4AC} **OQ-R1: Does [the plan][plan] settle it?**",
  "",
  '   <!-- vantage: oq id=OQ-R1 leaning="It does." -->',
  "",
  "   _Leaning:_ it does, see [the plan][plan].",
  "",
  "1. \u{1F4AC} **OQ-R2: And the second?**",
  "",
  '   <!-- vantage: oq id=OQ-R2 leaning="Also." -->',
  "",
  "   _Leaning:_ also.",
  "",
  "[plan]: plans/x.md",
  "",
].join("\n");

const FOOTNOTE = [
  "# Footnoted",
  "",
  "An earlier paragraph with a note.[^a]",
  "",
  "1. \u{1F4AC} **OQ-F1: A question with a note?**",
  "",
  '   <!-- vantage: oq id=OQ-F1 leaning="Take it." -->',
  "",
  "   _Leaning:_ take it.[^b]",
  "",
  "[^a]: The first note.",
  "[^b]: The second note.",
  "",
].join("\n");

const CORPUS: Record<string, string> = {
  "docs/design/agent-bootstrap.md": readRepoFile(
    "docs/design/agent-bootstrap.md",
  ),
  "docs/gallery/open-questions.md": readRepoFile(
    "docs/gallery/open-questions.md",
  ),
  "docs/reference.md": REFERENCE_LINK,
  "docs/footnote.md": FOOTNOTE,
  "plans/x.md": "---\nstatus: draft\n---\n\n# X\n",
};

const INDEX: PlanningIndex = buildPlanningIndex(sourcesOf(CORPUS));

function questionsOf(path: string): PlanningQuestion[] {
  const result = scanPlanningDocument(path, CORPUS[path], false);
  if (result.kind !== "planning") throw new Error(`${path} is not planning`);
  return result.document.questions;
}

/** The question's card block, as the scan cut it from its document's text. */
function blockOf(
  question: PlanningQuestion,
  source = CORPUS[question.path],
): CardBlock | null {
  const result = scanPlanningDocument(question.path, source, false);
  if (result.kind !== "planning") return null;
  return cardBlockFor(result.cards, question) ?? null;
}

const CASES = Object.keys(CORPUS)
  .filter((path) => path !== "plans/x.md")
  .flatMap((path) =>
    questionsOf(path)
      // A blocked question offers no answer from either place (Plan Q5).
      .filter((q) => q.state !== "blocked")
      .map((q) => [`${path} ${q.id ?? `line ${q.line}`}`, q] as const),
  );

/* ------------------------------------------------------------------ *
 * Filing each way
 * ------------------------------------------------------------------ */

interface Filed {
  anchor: CommentAnchor | null | undefined;
  comment: string;
  fallback_text: string | undefined;
}

const lineOf = (el: Element) => Number(el.getAttribute("data-source-line"));

beforeEach(() => {
  resetPlanningTrackers();
  // Badges on, in both places: they are in the DOM each anchor is built from,
  // and must be in neither anchor.
  usePlanningStore.setState({
    byRepo: {
      "": {
        status: "ready",
        index: INDEX,
        version: 1,
        rescanning: false,
        hashes: {},
      },
    },
    reviewEpoch: {},
  });
  useRepoStore.setState({
    reposLoaded: true,
    isMultiRepo: false,
    currentRepo: null,
  });
  useReviewStore.setState({
    comments: [],
    pendingSelection: null,
    commentsDrifted: false,
    filePath: null,
  });
  vi.mocked(axios.get).mockReset();
  vi.mocked(axios.get).mockRejectedValue(new Error("no reads in this test"));
  vi.mocked(axios.post).mockReset();
  vi.mocked(axios.post).mockResolvedValue({ data: null });
});

/** File `question` with the in-page button over its whole document. */
function fileInPage(question: PlanningQuestion): Filed {
  useReviewStore.setState({ filePath: question.path, comments: [] });
  const { container, unmount } = render(
    <BrowserRouter>
      <MarkdownViewer
        content={CORPUS[question.path]}
        currentPath={question.path}
        isReviewMode
      />
    </BrowserRouter>,
  );
  const host = answerableOpenQuestions(container).find(
    ({ block }) => lineOf(block) === question.line,
  );
  expect(host, "the in-page host").toBeDefined();
  const take =
    host!.block.nextElementSibling?.querySelector<HTMLElement>(
      ".review-oq-take",
    );
  expect(take, "the in-page button").toBeTruthy();
  act(() => {
    fireEvent.click(take!);
  });
  const body = vi.mocked(axios.post).mock.calls.at(-1)![1] as Filed;
  unmount();
  return {
    anchor: body.anchor,
    comment: body.comment,
    fallback_text: body.fallback_text,
  };
}

function renderCard(
  question: PlanningQuestion,
  props: Partial<React.ComponentProps<typeof PlanningQuestionCard>> = {},
) {
  const onFile = vi.fn(async () => {});
  const view = render(
    <BrowserRouter>
      <PlanningQuestionCard
        question={question}
        card={"card" in props ? props.card : blockOf(question)}
        badge={null}
        comments={[]}
        href={`/${question.path}`}
        onFile={onFile}
        {...props}
      />
    </BrowserRouter>,
  );
  return { ...view, onFile };
}

const filedBy = (onFile: ReturnType<typeof vi.fn>): Filed => {
  const comment = onFile.mock.calls.at(-1)![1] as ReviewComment;
  return {
    anchor: comment.anchor,
    comment: comment.comment,
    fallback_text: comment.fallback_text,
  };
};

async function answerOnCard(
  onFile: ReturnType<typeof vi.fn>,
  typed: string,
): Promise<Filed> {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Answer…" }));
  });
  fireEvent.change(screen.getByPlaceholderText("Your comment..."), {
    target: { value: typed },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
  return filedBy(onFile);
}

describe("an answer from the card is the in-page button's (§13, §15)", () => {
  it("has a corpus holding every shape to compare", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(12);
  });

  it.each(CASES)("takes the leaning on %s", async (_name, question) => {
    const inPage = fileInPage(question);
    const { onFile } = renderCard(question);

    if (question.leaning === null) {
      // No leaning, so no Take on the card (§6.3). The in-page button files
      // the default; Answer… files what is typed, on the same anchor.
      expect(screen.queryByRole("button", { name: "Take this leaning" })).toBe(
        null,
      );
      expect(inPage.comment).toBe(OQ_DEFAULT_LEANING);
      const answered = await answerOnCard(onFile, "My own answer.");
      expect(answered).toEqual({ ...inPage, comment: "My own answer." });
      return;
    }

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Take this leaning" }),
      );
    });
    expect(onFile).toHaveBeenCalledWith(question.path, expect.anything());
    expect(filedBy(onFile)).toEqual(inPage);
  });

  it.each(CASES)(
    "files Answer… on the same anchor for %s",
    async (_name, question) => {
      const inPage = fileInPage(question);
      const { onFile } = renderCard(question);
      const answered = await answerOnCard(onFile, "Typed on the page.");
      expect(answered).toEqual({ ...inPage, comment: "Typed on the page." });
    },
  );
});

/* ------------------------------------------------------------------ *
 * The card itself
 * ------------------------------------------------------------------ */

const bootstrap = questionsOf("docs/design/agent-bootstrap.md");
const byId = (id: string) => bootstrap.find((q) => q.id === id)!;

describe("the card shows its question, and only its question", () => {
  it("hides the question's siblings and keeps its number from the document", () => {
    const { container } = renderCard(byId("OQ-B3"));
    const unit = container.querySelector<HTMLElement>(
      "[data-planning-card-unit]",
    )!;
    expect(unit.tagName).toBe("LI");
    expect(unit.textContent).toContain("OQ-B3: Which formats");
    // The list is one block holding all six items; the card shows the third.
    expect(unit.getAttribute("value")).toBe("3");
    const list = unit.parentElement!;
    expect(list).toHaveAttribute("data-planning-card-path");
    const others = Array.from(list.children).filter((li) => li !== unit);
    expect(others.length).toBe(5);
    for (const li of others) {
      expect(li).not.toHaveAttribute("data-planning-card-unit");
      expect(li).not.toHaveAttribute("data-planning-card-path");
    }
  });

  it("finds each question's unit on the line the index names", () => {
    for (const path of Object.keys(CORPUS)) {
      if (path === "plans/x.md") continue;
      for (const question of questionsOf(path)) {
        const { container, unmount } = renderCard(question);
        const unit = container.querySelector("[data-planning-card-unit]");
        expect(unit, `${path} line ${question.line}`).not.toBeNull();
        expect(lineOf(unit!)).toBe(question.unitLine);
        unmount();
      }
    }
  });

  it("names its document, with the document's badge", () => {
    renderCard(byId("OQ-B1"), {
      badge: {
        kind: "document",
        path: "docs/design/agent-bootstrap.md",
        status: "in-review",
        stage: "DESIGN",
        stageInVocabulary: true,
        open: 5,
        blocked: 1,
      },
    });
    const article = screen.getByRole("article");
    expect(
      screen.getByRole("link", { name: "docs/design/agent-bootstrap.md" }),
    ).toHaveAttribute("href", "/docs/design/agent-bootstrap.md");
    expect(
      screen.getByRole("img", {
        name: "in review, design, 5 open questions, 1 blocked question",
      }),
    ).toBeTruthy();
    expect(article).toBeTruthy();
  });

  // The card holds a slice of its document on another page, so a link to a
  // section of the document has to go there: the section is not on the page.
  it("sends a same-document section link to its document", () => {
    navigate.mockClear();
    renderCard(byId("OQ-B2"));
    const link = screen.getByRole("link", { name: "§3" });
    expect(link).toHaveAttribute(
      "href",
      "/docs/design/agent-bootstrap.md#3-fixative-and-proactive",
    );
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith(
      "/docs/design/agent-bootstrap.md#3-fixative-and-proactive",
    );
  });

  it("links Open document to the document itself, with no fragment", () => {
    renderCard(byId("OQ-B2"));
    expect(screen.getByRole("link", { name: "Open document" })).toHaveAttribute(
      "href",
      "/docs/design/agent-bootstrap.md",
    );
  });

  it("renders nothing of its question while its block is on its way, and offers only Open document", () => {
    const { container } = renderCard(byId("OQ-B2"), { card: undefined });
    const article = screen.getByRole("article");
    expect(
      article.querySelector(".planning-card-body")?.childNodes,
    ).toHaveLength(0);
    expect(container.textContent).not.toContain("not in the planning index");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Open document" })).toBeTruthy();
  });

  it("says so when its document no longer has its block", () => {
    renderCard(byId("OQ-B2"), { card: null });
    expect(
      screen.getByText(
        "This question's document is not in the planning index any more.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("a preview card (planning-index-at-scale.md §10.4)", () => {
  it("shows the question as the index knows it, and only Show question and Open document", () => {
    const question = byId("OQ-B2");
    renderCard(question, {
      card: undefined,
      preview: true,
      onShowQuestion: async () => null,
    });
    const article = screen.getByRole("article");
    const body = article.querySelector("[data-planning-preview]");
    expect(body).not.toBeNull();
    expect(body).toHaveTextContent(question.title);
    expect(body).toHaveTextContent(`Open · Leaning: ${question.leaning}`);
    expect(body).toHaveTextContent(
      `${question.cardChars.toLocaleString("en-US")} characters`,
    );
    expect(article.querySelector("[data-planning-card-unit]")).toBeNull();
    expect(
      screen
        .getAllByRole("button")
        .map((b) => b.textContent)
        .filter(Boolean),
    ).toEqual(["Show question"]);
    expect(screen.getByRole("link", { name: "Open document" })).toBeTruthy();
  });

  it("renders the whole card in place once Show question has its block", async () => {
    const question = byId("OQ-B2");
    let answer!: (block: CardBlock | null) => void;
    const onShowQuestion = vi.fn(
      () =>
        new Promise<CardBlock | null>((resolve) => {
          answer = resolve;
        }),
    );
    const { container } = renderCard(question, {
      card: undefined,
      preview: true,
      onShowQuestion,
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Show question" }));
    });
    expect(onShowQuestion).toHaveBeenCalledWith(question);
    expect(
      screen.getByRole("button", { name: "Show question" }),
    ).toBeDisabled();
    await act(async () => {
      answer(blockOf(question));
    });
    const unit = container.querySelector("[data-planning-card-unit]");
    expect(unit?.textContent).toContain("OQ-B2");
    expect(container.querySelector("[data-planning-preview]")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Take this leaning" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Answer…" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show question" })).toBeNull();
  });

  it("stays a preview, and says so, when the block cannot be had", async () => {
    renderCard(byId("OQ-B2"), {
      card: undefined,
      preview: true,
      onShowQuestion: async () => null,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show question" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load the question.",
    );
    expect(screen.getByRole("button", { name: "Show question" })).toBeEnabled();
  });
});

describe("the card's controls follow the question's state (Plan Q5)", () => {
  const status = readRepoFile("docs/gallery/status.md");
  const statusQuestions = (() => {
    const r = scanPlanningDocument("docs/gallery/status.md", status, false);
    if (r.kind !== "planning") throw new Error("status.md");
    return r.document.questions;
  })();
  const ofState = (state: PlanningQuestion["state"]) =>
    statusQuestions.find((q) => q.state === state)!;
  const renderStatus = (question: PlanningQuestion) =>
    renderCard(question, { card: blockOf(question, status) });

  it("offers Take, Answer… and Open document on an open question", () => {
    renderStatus(ofState("open"));
    expect(
      screen.getByRole("button", { name: "Take this leaning" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Answer…" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open document" })).toBeTruthy();
  });

  it("offers Answer… and Open document, and no Take, on an answered question", () => {
    renderStatus(ofState("answered"));
    expect(screen.queryByRole("button", { name: "Take this leaning" })).toBe(
      null,
    );
    expect(screen.getByRole("button", { name: "Answer…" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open document" })).toBeTruthy();
  });

  it("offers only Open document on a blocked question", () => {
    renderStatus(ofState("blocked"));
    expect(screen.queryByRole("button", { name: "Take this leaning" })).toBe(
      null,
    );
    expect(screen.queryByRole("button", { name: "Answer…" })).toBe(null);
    expect(screen.getByRole("link", { name: "Open document" })).toBeTruthy();
  });

  it("offers no Take without a leaning, and nothing that writes in a static export", () => {
    const noLeaning = questionsOf("docs/gallery/open-questions.md").find(
      (q) => q.id === "OQ-7",
    )!;
    const { unmount } = renderCard(noLeaning);
    expect(screen.queryByRole("button", { name: "Take this leaning" })).toBe(
      null,
    );
    expect(screen.getByRole("button", { name: "Answer…" })).toBeTruthy();
    unmount();

    window.__VANTAGE_STATIC__ = true;
    try {
      renderCard(byId("OQ-B1"));
      expect(screen.queryByRole("button", { name: "Take this leaning" })).toBe(
        null,
      );
      expect(screen.queryByRole("button", { name: "Answer…" })).toBe(null);
      expect(screen.getByRole("link", { name: "Open document" })).toBeTruthy();
    } finally {
      delete window.__VANTAGE_STATIC__;
    }
  });
});

describe("the comments already filed on a question", () => {
  /** A comment on `question`, anchored as a take from its card would be. */
  async function takenOn(question: PlanningQuestion): Promise<ReviewComment> {
    const { onFile, unmount } = renderCard(question);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Take this leaning" }),
      );
    });
    unmount();
    return onFile.mock.calls.at(-1)![1] as ReviewComment;
  }

  it("lists its own, marking the pending ones as waiting on the agent", async () => {
    const onB3 = await takenOn(byId("OQ-B3"));
    const answered: ReviewComment = {
      ...(await takenOn(byId("OQ-B3"))),
      id: "answered",
      comment: "Answered already",
      reactions: [
        {
          actor: "agent",
          kind: "addressed",
          summary: "Did it.",
          before_text: "",
          after_text: "",
          timestamp: Date.now() / 1000 + 10,
        },
      ],
    };
    const onScoped = vi.fn();
    renderCard(byId("OQ-B3"), { comments: [onB3, answered], onScoped });
    const list = screen.getByRole("list", {
      name: "Comments on this question",
    });
    const items = Array.from(list.querySelectorAll(":scope > li"));
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(onB3.comment);
    expect(items[0]).toHaveTextContent(WAITING_LABEL);
    expect(items[1]).toHaveTextContent("Answered already");
    expect(items[1]).not.toHaveTextContent(WAITING_LABEL);
    expect(items[1]).toHaveTextContent("Agent: Did it.");
    expect(onScoped).toHaveBeenLastCalledWith([onB3.id, "answered"]);
    // And the take is shown as taken rather than offered twice.
    expect(screen.getByText("Leaning taken")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take this leaning" })).toBe(
      null,
    );
  });

  it("lists none of a sibling question's comments, though its card holds the sibling", async () => {
    const onB3 = await takenOn(byId("OQ-B3"));
    for (const id of ["OQ-B1", "OQ-B2", "OQ-B4", "OQ-B5"]) {
      const onScoped = vi.fn();
      const { unmount } = renderCard(byId(id), { comments: [onB3], onScoped });
      expect(
        screen.queryByRole("list", { name: "Comments on this question" }),
        id,
      ).toBeNull();
      expect(onScoped).not.toHaveBeenCalledWith([onB3.id]);
      unmount();
    }
  });

  it("says so when the comment could not be saved", async () => {
    const onFile = vi.fn(async () => {
      throw { response: { data: { error: "Document not found" } } };
    });
    renderCard(byId("OQ-B1"), { onFile });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Take this leaning" }),
      );
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Not saved: Document not found",
    );
  });
});
