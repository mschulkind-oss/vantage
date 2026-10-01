/**
 * A question's card on the planning page (`docs/reference/planning-index.md`
 * §6.6), and above all §6.7's rule: an answer filed from the page must be
 * indistinguishable from one filed with the in-page button.
 *
 * Each case files the same question twice — once with the in-page button over
 * the whole document, rendered by the app's `MarkdownViewer` in review mode,
 * and once from its card — and holds the two comments equal: the same
 * `anchor`, the same `comment` and the same `fallback_text`. The corpus is
 * every question in `agent-bootstrap.md`, each host shape the gallery shows,
 * fixtures whose block holds a reference-style link and a footnote, the
 * two things a slice of a document can render differently from the document,
 * and a dense question of the kind the card lays out to be read: a paragraph
 * of background around its title, badged links, and an empty Answer.
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
  type PlanningBadge,
  type PlanningIndex,
  type PlanningQuestion,
} from "vantage-md/planning";
import { MarkdownViewer } from "./MarkdownViewer";
import { planningBadgeElement } from "./PlanningBadge";
import {
  PlanningQuestionCard,
  WAITING_LABEL,
  type CardFolds,
} from "./PlanningQuestionCard";
import {
  OQ_DEFAULT_LEANING,
  documentQuestions,
} from "../hooks/useOpenQuestionButtons";
import {
  resetPlanningTrackers,
  usePlanningStore,
} from "../stores/usePlanningStore";
import { useRepoStore } from "../stores/useRepoStore";
import { useReviewStore } from "../stores/useReviewStore";
import {
  clearMermaidCache,
  setCachedSvg,
} from "../../../packages/vantage-md/src/mermaidCache";
import { readRepoFile, sourcesOf } from "../test/planning";
import { planningCardId } from "../lib/planningCardId";
import {
  REVIEW_UI_SELECTOR,
  blockVisibleText,
  hashBlockText,
} from "../lib/reviewAnchor";
import {
  CARD_CUT_ATTR,
  CARD_PART_ATTR,
  flushClampMeasures,
  type CardPart,
} from "../lib/planningCardParts";
import type { CommentAnchor, ReviewComment } from "../types";

vi.mock("axios");
// The viewer's diagram, drawn from the SVG cache when it holds the diagram
// and empty until then; Mermaid itself stays out of the suite.
vi.mock("vantage-md/react", async () => {
  const actual = await vi.importActual("vantage-md/react");
  const cache = await vi.importActual<
    typeof import("../../../packages/vantage-md/src/mermaidCache")
  >("../../../packages/vantage-md/src/mermaidCache");
  return {
    ...actual,
    MermaidDiagram: ({ code }: { code: string }) => (
      <div data-testid="mermaid-container">
        <div className="mermaid">
          {cache.getCachedSvg(code) !== undefined && <svg data-code={code} />}
        </div>
      </div>
    ),
  };
});
const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

afterEach(cleanup);

/** Open document's accessible name, which says what its icon does. */
const OPEN_DOCUMENT = "Open document (opens in a new tab)";

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

/**
 * A question as a real repository writes one when it has been around a while
 * (the yolo-jail example of 2026-09-30): its title opens one paragraph of
 * background, cross-references and history, whose links carry an accepted
 * document's and a ruled question's badges, then a leaning and an empty
 * Answer. Then an answered question with its Answer filled in, and two
 * questions outside a list, whose directive stamps the paragraph their title
 * opens: one with a marker, one without.
 */
const DENSE = [
  "# Jail credentials",
  "",
  "1. \u{1F4AC} **OQ-J1: Should the broker mint credentials per profile?** The",
  "   broker hands every jail one session today, which",
  "   [the auth design](accepted.md) settled for a single profile, and",
  "   [OQ-J0](#OQ-J0) ruled how a refresh is serialized. Its history",
  "   ([the incident log](accepted.md#history)) shows two jails racing one",
  "   single-use token, and [the plan](../plans/x.md) defers the rest. It has",
  "   come up three times since the first draft, each time deferred.",
  "",
  "   The options are one session per jail, or one per profile.",
  "",
  '   <!-- vantage: oq id=OQ-J1 leaning="Per profile, narrowed before it crosses." -->',
  "",
  "   _Leaning:_ per profile, narrowed before it crosses into the jail.",
  "",
  "   **Answer:**",
  "",
  "   > _(empty — fill in when decided)_",
  "",
  "2. \u2705 **OQ-J0: Serialize refreshes?**",
  "",
  "   <!-- vantage: question id=OQ-J0 -->",
  "",
  "   _Leaning:_ yes.",
  "",
  "   **Answer:**",
  "",
  "   > Yes: one broker per host.",
  "",
  '<!-- vantage: oq id=OQ-J2 leaning="Keep it." -->',
  "",
  "\u{1F4AC} **OQ-J2: Is a question outside a list laid out too?** Its title",
  "opens the block its directive stamps.",
  "",
  '<!-- vantage: oq id=OQ-J3 leaning="Keep it too." -->',
  "",
  "**OQ-J3: And one with no marker?** Its title opens the block its",
  "directive stamps too.",
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
  "docs/jail.md": DENSE,
  "docs/accepted.md":
    "---\nstatus: accepted\n---\n\n# Accepted\n\n## History\n",
  "plans/x.md": "---\nstatus: draft\n---\n\n# X\n",
};

const INDEX: PlanningIndex = buildPlanningIndex(sourcesOf(CORPUS));

function questionsOf(path: string): PlanningQuestion[] {
  const result = scanPlanningDocument(path, CORPUS[path], false);
  if (result.kind !== "planning") throw new Error(`${path} is not planning`);
  return result.document.questions;
}

/** The corpus's documents that hold questions. */
const QUESTION_PATHS = Object.keys(CORPUS).filter((path) => {
  const result = scanPlanningDocument(path, CORPUS[path], false);
  return result.kind === "planning" && result.document.questions.length > 0;
});

/** The question's card block, as the scan cut it from its document's text. */
function blockOf(
  question: PlanningQuestion,
  source = CORPUS[question.path],
): CardBlock | null {
  const result = scanPlanningDocument(question.path, source, false);
  if (result.kind !== "planning") return null;
  return cardBlockFor(result.cards, question) ?? null;
}

const CASES = QUESTION_PATHS.flatMap((path) =>
  questionsOf(path)
    // The in-page button is offered on an open question alone (Plan Q5), and
    // each case files with it.
    .filter((q) => q.state === "open")
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
  const host = documentQuestions(container).find(
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

describe("an answer from the card is the in-page button's (§6.7)", () => {
  it("has a corpus holding every shape to compare", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(15);
  });

  it.each(CASES)("takes the leaning on %s", async (_name, question) => {
    const inPage = fileInPage(question);
    const { onFile } = renderCard(question);

    if (question.leaning === null) {
      // No leaning, so no Take on the card (§6.6). The in-page button files
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
    for (const path of QUESTION_PATHS) {
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

  // Its icon is the one for a link that opens elsewhere, and a reader who
  // clicked it expected a new tab (user direction, 2026-10-01).
  it("opens Open document in a new tab, at the document itself, with no fragment", () => {
    navigate.mockClear();
    const onOpenHere = vi.fn();
    renderCard(byId("OQ-B2"), { onOpenHere });
    const link = screen.getByRole("link", { name: OPEN_DOCUMENT });
    // Said to a screen reader; the eye has the icon.
    expect(link).toHaveTextContent(/^Open document/);
    expect(link.querySelector(".sr-only")).toHaveTextContent(
      "(opens in a new tab)",
    );
    expect(link).toHaveAttribute("href", "/docs/design/agent-bootstrap.md");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // The browser opens the tab; this one goes nowhere, and saves nothing.
    expect(fireEvent.click(link)).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(onOpenHere).not.toHaveBeenCalled();
  });

  it("opens the document in this tab from its name, once the page has saved its place", () => {
    navigate.mockClear();
    const onOpenHere = vi.fn();
    renderCard(byId("OQ-B2"), { onOpenHere });
    const link = screen.getByRole("link", {
      name: "docs/design/agent-bootstrap.md",
    });
    expect(link).toHaveAttribute("href", "/docs/design/agent-bootstrap.md");
    expect(link).not.toHaveAttribute("target");
    expect(fireEvent.click(link)).toBe(false);
    expect(navigate).toHaveBeenCalledWith("/docs/design/agent-bootstrap.md");
    expect(onOpenHere).toHaveBeenCalledOnce();
    expect(onOpenHere.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0]!,
    );
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

/* ------------------------------------------------------------------ *
 * The card, laid out to be read (user direction, 2026-09-30)
 * ------------------------------------------------------------------ */

const jail = questionsOf("docs/jail.md");
const jailById = (id: string) => jail.find((q) => q.id === id)!;
const gallery = questionsOf("docs/gallery/open-questions.md");
const galleryById = (id: string) => gallery.find((q) => q.id === id)!;

/** Every element in the card marked as `part`. */
const partsIn = (container: HTMLElement, part: CardPart) =>
  Array.from(container.querySelectorAll(`[${CARD_PART_ATTR}="${part}"]`));
/** The card's own element for `question`'s unit. */
const unitIn = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-planning-card-unit]")!;
const headline = () =>
  screen.queryByRole("heading", { level: 3 })?.textContent ?? null;
const foldButton = () =>
  screen.queryByRole("button", { name: /^Show (full question|less)$/ });
/** The element the card keeps at its cut, wherever it is. */
const cutIn = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(`[${CARD_CUT_ATTR}]`);
/** The card's row of controls. */
const controlRow = () =>
  screen.getByRole("article").querySelector("[data-planning-card-controls]")!;

describe("the card is laid out to be read", () => {
  it("leads with the question's bold title as its headline, and hides it in the question", () => {
    const question = jailById("OQ-J1");
    const { container } = renderCard(question);
    expect(headline()).toBe(
      "\u{1F4AC} OQ-J1: Should the broker mint credentials per profile?",
    );
    // The marker is the headline's, so a screen reader hears the title.
    expect(screen.getByRole("heading", { level: 3 })).toHaveAccessibleName(
      question.title,
    );
    const [title] = partsIn(container, "title");
    expect(title?.tagName).toBe("STRONG");
    expect(title).toHaveTextContent(question.title);
    // The paragraph the title opens keeps its background, with no marker
    // left dangling at its start.
    const lede = title!.parentElement!;
    expect(lede).toHaveAttribute(CARD_PART_ATTR, "clamp");
    expect(lede.textContent!.trimStart()).toMatch(/^OQ-J1: /);
    expect(container.querySelector(".planning-card-body")).toHaveAttribute(
      "data-planning-card-headed",
    );
  });

  it("hides the title's paragraph when the title was all it held", () => {
    const question = jailById("OQ-J0");
    const { container } = renderCard(question);
    expect(headline()).toBe("\u2705 OQ-J0: Serialize refreshes?");
    const [lede] = partsIn(container, "lede");
    expect(lede?.tagName).toBe("P");
    expect(lede).toHaveTextContent(question.title);
    // What is left is the leaning and the answer: nothing to cut short.
    expect(partsIn(container, "clamp")).toHaveLength(0);
    expect(foldButton()).toBeNull();
  });

  it("draws the leaning as a block of its own, which folding never hides", () => {
    const question = jailById("OQ-J1");
    const { container } = renderCard(question);
    const [leaning] = partsIn(container, "leaning");
    expect(leaning).toHaveTextContent(
      "Leaning: per profile, narrowed before it crosses into the jail.",
    );
    // The document's own leaning paragraph, which the in-page button hangs
    // off: nothing is written in its place.
    expect(leaning).toHaveAttribute("data-vantage-oq");
    expect(
      container.querySelector("[data-planning-card-leaning-aside]"),
    ).toBeNull();
  });

  it("does not show an empty Answer, and keeps one that is filled in", () => {
    const empty = renderCard(jailById("OQ-J1"));
    const placeholder = partsIn(empty.container, "placeholder");
    expect(placeholder.map((el) => el.tagName)).toEqual(["P", "BLOCKQUOTE"]);
    expect(placeholder[0]).toHaveTextContent(/^Answer:$/);
    expect(placeholder[1]).toHaveTextContent("(empty — fill in when decided)");
    empty.unmount();

    const filled = renderCard(jailById("OQ-J0"));
    expect(partsIn(filled.container, "placeholder")).toHaveLength(0);
    const answer = partsIn(filled.container, "answer");
    expect(answer.map((el) => el.tagName)).toEqual(["P", "BLOCKQUOTE"]);
    expect(answer[1]).toHaveTextContent("Yes: one broker per host.");
  });

  it("folds the rest of the question behind Show full question, at the cut, which the reader opens and closes", () => {
    const { container } = renderCard(jailById("OQ-J1"));
    // The first block is cut to a few lines, and every later one is hidden
    // until the card is unfolded.
    const [clamp] = partsIn(container, "clamp");
    expect(partsIn(container, "more").map((el) => el.textContent)).toEqual([
      "The options are one session per jail, or one per profile.",
    ]);
    const body = container.querySelector(".planning-card-body")!;
    expect(body).not.toHaveAttribute("data-planning-card-unfolded");
    // Something is folded away, so the cut fades whatever the block measures
    // (here, where there is no layout, nothing).
    act(() => flushClampMeasures());
    expect(clamp).toHaveAttribute("data-planning-card-overflow");
    // Show full question is at the cut: directly after the block it cuts
    // short, inside the question, and not in the row of controls.
    const cut = cutIn(container)!;
    expect(clamp!.nextElementSibling).toBe(cut);
    const fold = foldButton()!;
    expect(cut).toContainElement(fold);
    expect(controlRow()).not.toContainElement(fold);
    expect(fold).toHaveTextContent("Show full question");
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(fold).toHaveAttribute("aria-controls", body.id);

    fireEvent.click(fold);
    act(() => flushClampMeasures());
    expect(body).toHaveAttribute("data-planning-card-unfolded");
    expect(clamp).not.toHaveAttribute("data-planning-card-overflow");
    // Show less is at the end of the question, and the cut is empty.
    const less = foldButton()!;
    expect(less).toHaveTextContent("Show less");
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(less).toHaveAttribute("aria-controls", body.id);
    expect(cut.childNodes).toHaveLength(0);
    expect(less.closest("[data-planning-card-fold-end]")).not.toBeNull();
    expect(
      body.compareDocumentPosition(less) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(controlRow()).not.toContainElement(less);

    fireEvent.click(less);
    act(() => flushClampMeasures());
    expect(body).not.toHaveAttribute("data-planning-card-unfolded");
    expect(clamp).toHaveAttribute("data-planning-card-overflow");
    expect(cut).toContainElement(foldButton());
    expect(foldButton()).toHaveTextContent("Show full question");
  });

  it("is a button in the tab order, and its focus goes to what its press revealed", () => {
    const { container } = renderCard(jailById("OQ-J1"));
    const body = container.querySelector<HTMLElement>(".planning-card-body")!;
    const fold = foldButton()!;
    expect(fold.tagName).toBe("BUTTON");
    expect(fold).toHaveAttribute("type", "button");
    expect(fold).not.toHaveAttribute("tabindex");
    expect(fold).toBeEnabled();
    // The question takes the focus only from a fold.
    expect(body).not.toHaveAttribute("tabindex");
    fold.focus();
    fireEvent.click(fold);
    // Show full question went with the cut, and Show less is past what it
    // revealed: the focus is on the question, where reading goes on.
    expect(foldButton()).toHaveTextContent("Show less");
    expect(document.activeElement).toBe(body);
    expect(body).toHaveAttribute("tabindex", "-1");
    expect(body.id).toBe(foldButton()!.getAttribute("aria-controls"));
    // Folding gives it to Show full question at the cut, and the question
    // leaves the tab order again.
    foldButton()!.focus();
    expect(body).not.toHaveAttribute("tabindex");
    fireEvent.click(foldButton()!);
    expect(document.activeElement).toBe(foldButton());
    expect(foldButton()).toHaveTextContent("Show full question");
    expect(cutIn(container)).toContainElement(foldButton());
  });

  it("moves no focus that the press did not have", () => {
    const { container } = renderCard(jailById("OQ-J1"));
    const body = container.querySelector<HTMLElement>(".planning-card-body")!;
    fireEvent.click(foldButton()!);
    expect(document.activeElement).toBe(document.body);
    expect(body).not.toHaveAttribute("tabindex");
  });

  it("is described by its card's headline, which tells one card's apart from another's", () => {
    renderCard(jailById("OQ-J1"));
    const title = screen.getByRole("heading", { level: 3 });
    expect(title.id).not.toBe("");
    expect(foldButton()).toHaveAttribute("aria-describedby", title.id);
    // The marker is hidden from it, as it is from the heading's name.
    expect(foldButton()).toHaveAccessibleDescription(
      "OQ-J1: Should the broker mint credentials per profile?",
    );
    fireEvent.click(foldButton()!);
    expect(foldButton()).toHaveAttribute("aria-describedby", title.id);
  });

  describe("a link the folded card cuts off", () => {
    afterEach(() => vi.restoreAllMocks());
    /** The clamp's last line ends 60px down; `below` lies past it. */
    function laidOut(below: string) {
      const own = HTMLElement.prototype.getBoundingClientRect;
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute(CARD_PART_ATTR) === "clamp") {
          return { top: 0, bottom: 60 } as DOMRect;
        }
        if (this.textContent === below) {
          return { top: 80, bottom: 100 } as DOMRect;
        }
        if (this.tagName === "A") return { top: 0, bottom: 20 } as DOMRect;
        return own.call(this);
      });
    }

    it("unfolds the card when the reader tabs to it, and keeps it in view", () => {
      laidOut("the plan");
      const folds: CardFolds = new Map();
      const { container } = renderCard(jailById("OQ-J1"), {
        folds,
        cardKey: "k",
      });
      const body = container.querySelector(".planning-card-body")!;
      const into = vi.fn();
      const link = screen.getByRole("link", { name: "the plan" });
      link.scrollIntoView = into;
      act(() => link.focus());
      expect(body).toHaveAttribute("data-planning-card-unfolded");
      expect(document.activeElement).toBe(link);
      expect(into).toHaveBeenCalledWith({ block: "nearest" });
      // The reader's own fold, as a press of Show full question records it.
      expect(folds.get("k")).toBe(true);
      expect(foldButton()).toHaveTextContent("Show less");
    });

    it("unfolds it too when the browser has scrolled the clamp to the link first", () => {
      // Shown 40px down, in a clamp scrolled by 72px: 112px down as laid out.
      laidOut("nothing");
      const { container } = renderCard(jailById("OQ-J1"));
      const [clamp] = partsIn(container, "clamp") as HTMLElement[];
      clamp!.scrollTop = 72;
      const link = screen.getByRole("link", { name: "the plan" });
      vi.spyOn(link, "getBoundingClientRect").mockReturnValue({
        top: 20,
        bottom: 40,
      } as DOMRect);
      act(() => link.focus());
      const body = container.querySelector(".planning-card-body")!;
      expect(body).toHaveAttribute("data-planning-card-unfolded");
    });

    it("leaves the card folded for a link on a line it shows", () => {
      laidOut("the plan");
      const { container } = renderCard(jailById("OQ-J1"));
      const body = container.querySelector(".planning-card-body")!;
      act(() => screen.getByRole("link", { name: "the auth design" }).focus());
      expect(body).not.toHaveAttribute("data-planning-card-unfolded");
      // Nor does a focus outside the question, the card's own controls.
      act(() => screen.getByRole("link", { name: OPEN_DOCUMENT }).focus());
      expect(body).not.toHaveAttribute("data-planning-card-unfolded");
    });

    it("never scrolls the clamp, which would open the card on the middle of its question", () => {
      const { container } = renderCard(jailById("OQ-J1"));
      const [clamp] = partsIn(container, "clamp") as HTMLElement[];
      clamp!.scrollTop = 96;
      expect(clamp!.scrollTop).toBe(96);
      fireEvent.scroll(clamp!);
      expect(clamp!.scrollTop).toBe(0);
      // Folded again, a browser gives the block back the scroll it had as
      // the clamp, and says nothing: it is taken back off as it is measured.
      fireEvent.click(foldButton()!);
      act(() => flushClampMeasures());
      clamp!.scrollTop = 72;
      fireEvent.click(foldButton()!);
      act(() => flushClampMeasures());
      expect(clamp!.scrollTop).toBe(0);
    });
  });

  it("keeps the cut out of the question's text, which an answer's anchor hashes", () => {
    const { container } = renderCard(jailById("OQ-J1"));
    const cut = cutIn(container)!;
    expect(cut.matches(REVIEW_UI_SELECTOR)).toBe(true);
    expect(cut).toHaveTextContent("Show full question");
    const unit = unitIn(container);
    expect(blockVisibleText(unit)).not.toContain("Show full question");
  });

  it("puts nothing in its row of controls for the fold", () => {
    renderCard(byId("OQ-B3"));
    expect(foldButton()).toBeNull();
    expect(
      screen.getByRole("article").querySelector("[data-planning-fold-slot]"),
    ).toBeNull();
    expect(controlRow().querySelector("[data-planning-card-fold]")).toBeNull();
  });

  describe("with a layout to measure", () => {
    /**
     * Every cut-short block runs to `tall` px, in lines of 20px, of which the
     * clamp shows three.
     */
    function measured(tall: number) {
      const clamped = (el: HTMLElement) =>
        el.getAttribute(CARD_PART_ATTR) === "clamp";
      const computed = window.getComputedStyle.bind(window);
      vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
        const style = computed(el, pseudo);
        if (el instanceof HTMLElement && clamped(el)) {
          Object.defineProperty(style, "lineHeight", { value: "20px" });
        }
        return style;
      });
      vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
        function (this: HTMLElement) {
          return clamped(this) ? tall : 0;
        },
      );
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
        function (this: HTMLElement) {
          return clamped(this) ? Math.min(tall, 60) : 0;
        },
      );
    }
    afterEach(() => vi.restoreAllMocks());

    // The measurement waits for the end of the task (measureClampSoon),
    // which a synchronous test brings forward.
    const measureNow = () => act(() => flushClampMeasures());

    it("offers Show full question when the first block runs past its lines, and fades it at the cut", () => {
      measured(200);
      const { container } = renderCard(byId("OQ-B4"));
      // Nothing is folded away after it, so only the measurement says.
      expect(foldButton()).toBeNull();
      measureNow();
      expect(partsIn(container, "more")).toHaveLength(0);
      const [clamp] = partsIn(container, "clamp");
      expect(clamp).toHaveAttribute("data-planning-card-overflow");
      expect(foldButton()).toHaveTextContent("Show full question");
      expect(clamp!.nextElementSibling).toBe(cutIn(container));
      expect(cutIn(container)).toContainElement(foldButton());
      // Unfolded, the block is whole, and has no fade to show; measured
      // against the lines it would fold to, it still offers to fold.
      fireEvent.click(foldButton()!);
      expect(foldButton()).toHaveTextContent("Show less");
      measureNow();
      expect(clamp).not.toHaveAttribute("data-planning-card-overflow");
      expect(foldButton()).toHaveTextContent("Show less");
    });

    it("puts the cut right after a question that is one block, where the card keeps it shown", () => {
      measured(200);
      const { container } = renderCard(galleryById("OQ-4"));
      measureNow();
      const unit = unitIn(container);
      expect(unit).toHaveAttribute(CARD_PART_ATTR, "clamp");
      const cut = cutIn(container)!;
      // A sibling of the unit, in the element the card hides every other
      // child of, which the stylesheet exempts it from.
      expect(unit.nextElementSibling).toBe(cut);
      expect(cut.parentElement).toHaveAttribute("data-planning-card-path");
      expect(cut).toContainElement(foldButton());
    });

    // A page of cards is measured in one pass, every read before any write,
    // so the page is laid out once and not once a card.
    it("measures every card committed together in one pass, reads before writes", () => {
      measured(200);
      const order: string[] = [];
      const height = vi
        .spyOn(HTMLElement.prototype, "scrollHeight", "get")
        .mockImplementation(function (this: HTMLElement) {
          if (this.getAttribute(CARD_PART_ATTR) !== "clamp") return 0;
          order.push("read");
          return 200;
        });
      const toggle = vi.spyOn(Element.prototype, "toggleAttribute");
      toggle.mockImplementation(function (
        this: Element,
        name: string,
        force?: boolean,
      ) {
        if (name === "data-planning-card-overflow") order.push("write");
        if (force) this.setAttribute(name, "");
        else this.removeAttribute(name);
        return force ?? false;
      });
      render(
        <BrowserRouter>
          {(["OQ-B4", "OQ-B4"] as const).map((id, i) => (
            <PlanningQuestionCard
              key={i}
              question={byId(id)}
              card={blockOf(byId(id))}
              badge={null}
              comments={[]}
              href={`/${byId(id).path}`}
              onFile={async () => {}}
            />
          ))}
        </BrowserRouter>,
      );
      expect(order).toEqual([]);
      measureNow();
      expect(order).toEqual(["read", "read", "write", "write"]);
      expect(
        screen.getAllByRole("button", { name: "Show full question" }),
      ).toHaveLength(2);
      height.mockRestore();
    });

    it("offers nothing to unfold, and fades nothing, when the question fits its lines", () => {
      measured(40);
      const { container } = renderCard(byId("OQ-B4"));
      measureNow();
      const [clamp] = partsIn(container, "clamp");
      expect(clamp).not.toHaveAttribute("data-planning-card-overflow");
      expect(foldButton()).toBeNull();
      // The cut is there, empty, which the stylesheet does not draw.
      expect(cutIn(container)!.childNodes).toHaveLength(0);
      // Unfolded by the page, it offers no Show less either.
      cleanup();
      renderCard(byId("OQ-B4"), { unfoldedByDefault: true });
      measureNow();
      expect(foldButton()).toBeNull();
    });
  });

  it("drops the question's number, which the headline makes redundant, and keeps it in the DOM", () => {
    const { container } = renderCard(byId("OQ-B3"));
    // The stylesheet hides the marker of a headed card; the value is still
    // the document's, for what reads it.
    expect(unitIn(container)).toHaveAttribute("value", "3");
    expect(container.querySelector(".planning-card-body")).toHaveAttribute(
      "data-planning-card-headed",
    );
  });

  it("lays out a question with no bold title as it renders, with the leaning it would file beside it", () => {
    const { container, unmount } = renderCard(galleryById("OQ-4"));
    expect(headline()).toBeNull();
    expect(container.querySelector(".planning-card-body")).not.toHaveAttribute(
      "data-planning-card-headed",
    );
    expect(unitIn(container)).toHaveAttribute(CARD_PART_ATTR, "clamp");
    expect(
      container.querySelector("[data-planning-card-leaning-aside]"),
    ).toHaveTextContent(`Leaning: ${galleryById("OQ-4").leaning}`);
    unmount();

    // No leaning at all: nothing beside it.
    const none = renderCard(galleryById("OQ-7"));
    expect(
      none.container.querySelector("[data-planning-card-leaning-aside]"),
    ).toBeNull();
  });

  it("never empties a marker inside the block an answer anchors on", () => {
    const marked = renderCard(jailById("OQ-J2"));
    // The title opens the stamped paragraph and its marker is text of that
    // paragraph, so it stays, and so does the title: no headline.
    expect(headline()).toBeNull();
    expect(unitIn(marked.container).textContent).toMatch(/^\u{1F4AC} OQ-J2/u);
    expect(partsIn(marked.container, "title")).toHaveLength(0);
    marked.unmount();

    // Without a marker there is nothing to strand: the title is hidden by the
    // stylesheet alone, which leaves the paragraph's text as it was.
    const bare = renderCard(jailById("OQ-J3"));
    expect(headline()).toBe("OQ-J3: And one with no marker?");
    expect(partsIn(bare.container, "title")).toHaveLength(1);
    expect(unitIn(bare.container).textContent).toMatch(/^OQ-J3: /);
  });

  // A comment on the question's list item is placed by the item's hash, which
  // the card takes from its own DOM each time it lays the question out: with
  // the marker it emptied last time still out, every such comment would read
  // as drifted.
  it("reads its question as the document has it each time it lays it out again", () => {
    const question = jailById("OQ-J1");
    const page = render(
      <BrowserRouter>
        <MarkdownViewer content={DENSE} currentPath="docs/jail.md" />
      </BrowserRouter>,
    );
    const item = Array.from(page.container.querySelectorAll("li")).find(
      (li) => lineOf(li) === question.unitLine,
    )!;
    const inPage = hashBlockText(blockVisibleText(item));
    page.unmount();

    const { container, rerender } = renderCard(question);
    expect(unitIn(container)).toHaveAttribute("data-block-hash", inPage);
    // New comments run the pass again, over the marks it left.
    rerender(
      <BrowserRouter>
        <PlanningQuestionCard
          question={question}
          card={blockOf(question)}
          badge={null}
          comments={[]}
          href="/x"
          onFile={async () => {}}
        />
      </BrowserRouter>,
    );
    expect(unitIn(container)).toHaveAttribute("data-block-hash", inPage);
    // And lays it out again after reading it.
    expect(partsIn(container, "title")).toHaveLength(1);
    expect(unitIn(container).textContent!.trimStart()).toMatch(/^OQ-J1: /);
  });

  it("carries its planningCardId as its id, with or without a question id", () => {
    const question = byId("OQ-B2");
    const { unmount } = renderCard(question);
    expect(screen.getByRole("article")).toHaveAttribute(
      "id",
      planningCardId(question.path, question.id, question.unitLine),
    );
    expect(screen.getByRole("article").id).toBe(
      "pq-docs%2Fdesign%2Fagent-bootstrap.md--OQ-B2",
    );
    unmount();

    const unnamed = { ...galleryById("OQ-4"), id: null };
    renderCard(unnamed, { card: blockOf(galleryById("OQ-4")) });
    expect(screen.getByRole("article").id).toBe(
      `pq-docs%2Fgallery%2Fopen-questions.md--L${unnamed.unitLine}`,
    );
  });

  it("gives a preview card and a card whose document lost it the headline too", () => {
    const question = byId("OQ-B2");
    const { unmount } = renderCard(question, {
      card: null,
      preview: true,
      onShowQuestion: async () => null,
    });
    expect(headline()).toBe(`\u{1F4AC} ${question.title}`);
    unmount();
    renderCard(question, { card: null });
    expect(headline()).toBe(`\u{1F4AC} ${question.title}`);
  });
});

/* ------------------------------------------------------------------ *
 * The fold a card opens with, and where folding leaves the page
 * (user direction, 2026-10-01)
 * ------------------------------------------------------------------ */

describe("the fold a card opens with (planning-index.md §6.6)", () => {
  const UNFOLDED = "data-planning-card-unfolded";
  const KEY = "docs/jail.md\n3";
  const bodyOf = (container: HTMLElement) =>
    container.querySelector(".planning-card-body")!;
  const cardWith = (
    props: Partial<React.ComponentProps<typeof PlanningQuestionCard>> = {},
  ) => {
    const question = jailById("OQ-J1");
    return (
      <PlanningQuestionCard
        question={question}
        card={blockOf(question)}
        badge={null}
        comments={[]}
        href={`/${question.path}`}
        onFile={async () => {}}
        cardKey={KEY}
        {...props}
      />
    );
  };
  const renderWith = (
    props: Partial<React.ComponentProps<typeof PlanningQuestionCard>> = {},
  ) => {
    const view = render(<BrowserRouter>{cardWith(props)}</BrowserRouter>);
    return {
      ...view,
      rerenderWith: (
        next: Partial<React.ComponentProps<typeof PlanningQuestionCard>>,
      ) => view.rerender(<BrowserRouter>{cardWith(next)}</BrowserRouter>),
    };
  };
  /** How often the fold flipped on an element already on the page. */
  function flipsDuring(run: () => void): number {
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: [UNFOLDED],
    });
    run();
    const flips = observer.takeRecords().length;
    observer.disconnect();
    return flips;
  }

  it("opens folded, or unfolded when the page says so, from its first render", () => {
    let folded!: ReturnType<typeof renderWith>;
    expect(flipsDuring(() => (folded = renderWith()))).toBe(0);
    expect(bodyOf(folded.container)).not.toHaveAttribute(UNFOLDED);
    folded.unmount();

    let unfolded!: ReturnType<typeof renderWith>;
    expect(
      flipsDuring(() => (unfolded = renderWith({ unfoldedByDefault: true }))),
    ).toBe(0);
    expect(bodyOf(unfolded.container)).toHaveAttribute(UNFOLDED);
    expect(foldButton()).toHaveTextContent("Show less");
    expect(cutIn(unfolded.container)!.childNodes).toHaveLength(0);
    expect(partsIn(unfolded.container, "clamp")[0]).not.toHaveAttribute(
      "data-planning-card-overflow",
    );
  });

  it("records the reader's fold in the visit's folds, which a card mounting again opens with", () => {
    const folds: CardFolds = new Map();
    const first = renderWith({ folds });
    fireEvent.click(foldButton()!);
    expect([...folds]).toEqual([[KEY, true]]);
    first.unmount();
    // Its page flipped away and back: as the reader left it, whatever the
    // page's default.
    const again = renderWith({ folds, unfoldedByDefault: false });
    expect(bodyOf(again.container)).toHaveAttribute(UNFOLDED);
    fireEvent.click(foldButton()!);
    expect(folds.get(KEY)).toBe(false);
    again.unmount();
    const third = renderWith({ folds, unfoldedByDefault: true });
    expect(bodyOf(third.container)).not.toHaveAttribute(UNFOLDED);
  });

  it("keeps its own fold over the page's until the page replaces its folds", () => {
    const visit: CardFolds = new Map();
    const view = renderWith({ folds: visit });
    const body = bodyOf(view.container);
    fireEvent.click(foldButton()!);
    expect(body).toHaveAttribute(UNFOLDED);
    view.rerenderWith({ folds: visit });
    expect(body).toHaveAttribute(UNFOLDED);
    // Collapse all: new folds, and the page's default, which every card takes.
    view.rerenderWith({ folds: new Map(), unfoldedByDefault: false });
    expect(body).not.toHaveAttribute(UNFOLDED);
    expect(foldButton()).toHaveTextContent("Show full question");
    // Expand all.
    const expanded: CardFolds = new Map();
    view.rerenderWith({ folds: expanded, unfoldedByDefault: true });
    expect(body).toHaveAttribute(UNFOLDED);
    // The reader's own fold wins again, until the next one.
    fireEvent.click(foldButton()!);
    expect(body).not.toHaveAttribute(UNFOLDED);
    view.rerenderWith({ folds: expanded, unfoldedByDefault: true });
    expect(body).not.toHaveAttribute(UNFOLDED);
  });

  it("moves nothing on screen when only the default changes, which another tab's choice does", () => {
    const folds: CardFolds = new Map();
    const view = renderWith({ folds, unfoldedByDefault: false });
    const body = bodyOf(view.container);
    expect(
      flipsDuring(() => view.rerenderWith({ folds, unfoldedByDefault: true })),
    ).toBe(0);
    expect(body).not.toHaveAttribute(UNFOLDED);
    view.unmount();
    // A card rendered later opens with it.
    const later = renderWith({ folds, unfoldedByDefault: true });
    expect(bodyOf(later.container)).toHaveAttribute(UNFOLDED);
  });

  describe("where folding leaves the page", () => {
    const rect = (top: number) => ({ top }) as DOMRect;
    /** The card in a pane scrolled to 500px, with the card's top as given. */
    function inPane(
      props: Partial<React.ComponentProps<typeof PlanningQuestionCard>> = {},
    ) {
      const view = render(
        <BrowserRouter>
          <div data-content-scroll>{cardWith(props)}</div>
        </BrowserRouter>,
      );
      const pane = view.container.querySelector<HTMLElement>(
        "[data-content-scroll]",
      )!;
      let scrollTop = 500;
      Object.defineProperty(pane, "scrollTop", {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      });
      const top = vi.spyOn(
        screen.getByRole("article"),
        "getBoundingClientRect",
      );
      return { top, scrollTop: () => scrollTop };
    }
    afterEach(() => vi.restoreAllMocks());
    /** Where the fold's control is, wherever the card puts it. */
    function controlAt(y: number) {
      const own = HTMLElement.prototype.getBoundingClientRect;
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute("data-planning-card-fold")
          ? rect(y)
          : own.call(this);
      });
    }

    it("keeps the card's top where it was when it unfolds", () => {
      const { top, scrollTop } = inPane();
      // Read as the reader asks, and again once the unfolded card is laid
      // out, 30px higher, as the browser's own anchoring would leave it.
      top.mockReturnValueOnce(rect(-50)).mockReturnValueOnce(rect(-80));
      fireEvent.click(foldButton()!);
      expect(scrollTop()).toBe(470);
    });

    it("leaves the scroll alone when nothing moved the card's top", () => {
      const { top, scrollTop } = inPane();
      top.mockReturnValueOnce(rect(120)).mockReturnValueOnce(rect(120));
      fireEvent.click(foldButton()!);
      expect(scrollTop()).toBe(500);
    });

    it("keeps the card's top where it was when it folds with its control in view", () => {
      const { top, scrollTop } = inPane({ unfoldedByDefault: true });
      top.mockReturnValueOnce(rect(-40)).mockReturnValueOnce(rect(-40));
      controlAt(60);
      fireEvent.click(foldButton()!);
      expect(foldButton()).toHaveTextContent("Show full question");
      expect(scrollTop()).toBe(500);
    });

    it("brings the card's top into view when folding would leave all of it above the pane", () => {
      const { top, scrollTop } = inPane({ unfoldedByDefault: true });
      top.mockReturnValueOnce(rect(-300)).mockReturnValueOnce(rect(-300));
      // Show full question, once the card is folded, 200px above the pane.
      controlAt(-200);
      fireEvent.click(foldButton()!);
      expect(foldButton()).toHaveTextContent("Show full question");
      // The pane's top is 0, and the card comes to 16px below it.
      expect(scrollTop()).toBe(500 - 316);
    });
  });
});

describe("a diagram not drawn when the card painted (planning-index.md §6.5)", () => {
  const DRAWN = "graph LR\n  A --> B";
  const source = [
    "# Diagrams",
    "",
    "1. \u{1F4AC} **OQ-M1: Which shape?**",
    "",
    '   <!-- vantage: oq id=OQ-M1 leaning="This one." -->',
    "",
    "   _Leaning:_ this one.",
    "",
    "   ```mermaid",
    "   graph LR",
    "     A --> B",
    "   ```",
    "",
    "   ```mermaid",
    "   graph LR",
    "     C --> D",
    "   ```",
    "",
  ].join("\n");
  const question = (() => {
    const r = scanPlanningDocument("docs/diagrams.md", source, false);
    if (r.kind !== "planning") throw new Error("diagrams.md");
    return r.document.questions[0]!;
  })();

  afterEach(() => clearMermaidCache());

  it("frames it at a fixed height, and leaves a drawn one at its own size", () => {
    setCachedSvg(DRAWN, "<svg></svg>");
    renderCard(question, { card: blockOf(question, source) });
    const [drawn, late] = screen.getAllByTestId("mermaid-container");
    expect(drawn).toHaveAttribute("data-planning-mermaid-drawn");
    expect(drawn).not.toHaveAttribute("data-planning-mermaid-frame");
    expect(late).toHaveAttribute("data-planning-mermaid-frame");
    expect(
      screen
        .getByRole("article")
        .querySelector<HTMLElement>(".planning-card-body")!
        .style.getPropertyValue("--planning-mermaid-frame"),
    ).toBe("240px");
  });

  it("frames what a late diagram becomes, as its error box replaces it", async () => {
    renderCard(question, { card: blockOf(question, source) });
    const late = screen.getAllByTestId("mermaid-container")[1]!;
    // MermaidDiagram draws a diagram it cannot parse as another element.
    const box = document.createElement("div");
    box.setAttribute("data-testid", "mermaid-container");
    box.textContent = "Diagram syntax error";
    await act(async () => {
      late.replaceWith(box);
      await Promise.resolve();
    });
    expect(box).toHaveAttribute("data-planning-mermaid-frame");
  });
});

describe("a preview card (planning-index.md §6.6)", () => {
  it("shows the question as the index knows it, and only Show question and Open document", () => {
    const question = byId("OQ-B2");
    renderCard(question, {
      card: null,
      preview: true,
      onShowQuestion: async () => null,
    });
    const article = screen.getByRole("article");
    expect(
      screen.getByRole("heading", { level: 3, name: question.title }),
    ).toBeTruthy();
    const body = article.querySelector("[data-planning-preview]");
    expect(body).not.toBeNull();
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
    expect(screen.getByRole("link", { name: OPEN_DOCUMENT })).toBeTruthy();
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
      card: null,
      preview: true,
      onShowQuestion,
    });
    const show = screen.getByRole("button", { name: "Show question" });
    show.focus();
    act(() => {
      fireEvent.click(show);
    });
    expect(onShowQuestion).toHaveBeenCalledWith(question);
    // Inert while it loads, and still focused: a disabled button drops it.
    expect(show).not.toBeDisabled();
    expect(show).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(show);
    act(() => {
      fireEvent.click(show);
    });
    expect(onShowQuestion).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer(blockOf(question));
    });
    // Show question is gone, so its focus goes to the card it became.
    expect(document.activeElement).toBe(screen.getByRole("article"));
    const unit = container.querySelector("[data-planning-card-unit]");
    expect(unit?.textContent).toContain("OQ-B2");
    expect(container.querySelector("[data-planning-preview]")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Take this leaning" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Answer…" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show question" })).toBeNull();
    // Asked for whole, it arrives unfolded.
    expect(container.querySelector(".planning-card-body")).toHaveAttribute(
      "data-planning-card-unfolded",
    );
  });

  it("stays a preview, and says so, when the block cannot be had", async () => {
    renderCard(byId("OQ-B2"), {
      card: null,
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
    expect(screen.getByRole("link", { name: OPEN_DOCUMENT })).toBeTruthy();
  });

  it("offers Answer… and Open document, and no Take, on an answered question", () => {
    renderStatus(ofState("answered"));
    expect(screen.queryByRole("button", { name: "Take this leaning" })).toBe(
      null,
    );
    expect(screen.getByRole("button", { name: "Answer…" })).toBeTruthy();
    expect(screen.getByRole("link", { name: OPEN_DOCUMENT })).toBeTruthy();
  });

  it("offers only Open document on a blocked question", () => {
    renderStatus(ofState("blocked"));
    expect(screen.queryByRole("button", { name: "Take this leaning" })).toBe(
      null,
    );
    expect(screen.queryByRole("button", { name: "Answer…" })).toBe(null);
    expect(screen.getByRole("link", { name: OPEN_DOCUMENT })).toBeTruthy();
  });

  it("offers no Take on a question a `question` directive declared, whatever its state", () => {
    // Only an `oq` is a question to answer in one click: the in-page pass
    // offers nothing on a `question`, and neither does its card, even on an
    // open one, which `vantage/question-name` reports.
    const open = ofState("open");
    renderCard(
      { ...open, directive: "question" },
      { card: blockOf(open, status) },
    );
    expect(screen.queryByRole("button", { name: "Take this leaning" })).toBe(
      null,
    );
    expect(screen.getByRole("button", { name: "Answer…" })).toBeTruthy();
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
      expect(screen.getByRole("link", { name: OPEN_DOCUMENT })).toBeTruthy();
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
    renderCard(byId("OQ-B3"), {
      comments: [onB3, answered],
      cardKey: "b3",
      onScoped,
    });
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
    expect(onScoped).toHaveBeenLastCalledWith(
      "b3",
      expect.objectContaining({ ids: [onB3.id, "answered"] }),
    );
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
      expect(onScoped).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ids: [onB3.id] }),
      );
      unmount();
    }
  });

  it("keeps a count of them in its control row, which folds their list away", async () => {
    const onB3 = await takenOn(byId("OQ-B3"));
    renderCard(byId("OQ-B3"), { comments: [onB3] });
    const count = screen.getByRole("button", { name: "1 comment" });
    expect(count).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("list", { name: "Comments on this question" }),
    ).toBeTruthy();
    fireEvent.click(count);
    expect(count).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("list", { name: "Comments on this question" }),
    ).toBeNull();
  });

  // planning-index.md §12.2: comments that reach a painted card go
  // into a slot that was always there, and nothing inline.
  it("lists comments that came late only once the reader opens the count", async () => {
    const onB3 = await takenOn(byId("OQ-B3"));
    renderCard(byId("OQ-B3"), { comments: [onB3], commentsLate: true });
    expect(
      screen.queryByRole("list", { name: "Comments on this question" }),
    ).toBeNull();
    const count = screen.getByRole("button", { name: "1 comment" });
    expect(count).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(count);
    expect(
      screen.getByRole("list", { name: "Comments on this question" }),
    ).toHaveTextContent(onB3.comment);
  });

  it("keeps the count's slot, at its width, before there is anything to count", () => {
    renderCard(byId("OQ-B3"), { comments: undefined, commentsLate: true });
    const slot = screen
      .getByRole("article")
      .querySelector("[data-planning-comment-slot]");
    expect(slot).toHaveClass("w-28");
    expect(slot!.childNodes).toHaveLength(0);
  });

  it("opens the list for an answer filed from the card itself", async () => {
    const onB3 = await takenOn(byId("OQ-B3"));
    const { rerender, onFile } = renderCard(byId("OQ-B3"), {
      comments: [],
      commentsLate: true,
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Take this leaning" }),
      );
    });
    expect(onFile).toHaveBeenCalled();
    rerender(
      <BrowserRouter>
        <PlanningQuestionCard
          question={byId("OQ-B3")}
          card={blockOf(byId("OQ-B3"))}
          badge={null}
          comments={[onB3]}
          commentsLate
          href="/x"
          onFile={onFile}
        />
      </BrowserRouter>,
    );
    expect(
      screen.getByRole("list", { name: "Comments on this question" }),
    ).toBeTruthy();
  });

  // planning-index.md §6.7: a card with no rendered question has
  // nothing exact to report, so its page places the comments by line. A
  // card rendered this visit reports what it read, and leaving withdraws
  // nothing: the page keeps the report for as long as what it was read from.
  it("reports nothing exact without a rendered question, and withdraws nothing when it goes", async () => {
    const onB3 = await takenOn(byId("OQ-B3"));
    const onScoped = vi.fn();
    const preview = renderCard(byId("OQ-B3"), {
      card: null,
      preview: true,
      comments: [onB3],
      cardKey: "b3",
      onScoped,
    });
    expect(onScoped).toHaveBeenCalledWith("b3", null);
    expect(onScoped.mock.calls.every(([, report]) => report === null)).toBe(
      true,
    );
    preview.unmount();

    onScoped.mockClear();
    const comments = [onB3];
    const rendered = renderCard(byId("OQ-B3"), {
      comments,
      cardKey: "b3",
      onScoped,
    });
    expect(onScoped).toHaveBeenLastCalledWith("b3", {
      ids: [onB3.id],
      question: byId("OQ-B3"),
      comments,
    });
    expect(onScoped.mock.lastCall?.[1].comments).toBe(comments);
    const calls = onScoped.mock.calls.length;
    rendered.unmount();
    expect(onScoped).toHaveBeenCalledTimes(calls);

    // A block without the question's host in it says nothing exact either.
    const hostless = {
      ...blockOf(byId("OQ-B3"))!,
      markdown: "Nothing here.\n",
    };
    onScoped.mockClear();
    renderCard(byId("OQ-B3"), {
      card: hostless,
      comments: [onB3],
      cardKey: "b3",
      onScoped,
    });
    expect(onScoped).toHaveBeenCalledWith("b3", null);
    expect(onScoped.mock.calls.every(([, ids]) => ids === null)).toBe(true);
  });

  // The page trusts a report only while it was read from the comments the
  // document has now, so a card on the page says again what it read, even
  // when the same comments are on its question.
  it("reports again, with what it read, when its document's comments change", async () => {
    const onB3 = await takenOn(byId("OQ-B3"));
    const onScoped = vi.fn();
    const first = [onB3];
    const { rerender, onFile } = renderCard(byId("OQ-B3"), {
      comments: first,
      cardKey: "b3",
      onScoped,
    });
    expect(onScoped.mock.lastCall?.[1].comments).toBe(first);
    const second = [onB3, { ...onB3, id: "elsewhere", anchor: undefined }];
    rerender(
      <BrowserRouter>
        <PlanningQuestionCard
          question={byId("OQ-B3")}
          card={blockOf(byId("OQ-B3"))}
          badge={null}
          comments={second}
          href="/x"
          onFile={onFile}
          cardKey="b3"
          onScoped={onScoped}
        />
      </BrowserRouter>,
    );
    expect(onScoped).toHaveBeenLastCalledWith(
      "b3",
      expect.objectContaining({ ids: [onB3.id] }),
    );
    expect(onScoped.mock.lastCall?.[1].comments).toBe(second);
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

/* ------------------------------------------------------------------ *
 * The badges inside a question, toned down (user direction, 2026-09-30)
 * ------------------------------------------------------------------ */

// jsdom applies the real stylesheet's rules to computed style, though it
// resolves no var(): the filter and the opacity are what can be read.
describe("a badge inside a question", () => {
  let style: HTMLStyleElement;
  beforeEach(() => {
    style = document.createElement("style");
    style.textContent = readRepoFile("frontend/src/index.css");
    document.head.appendChild(style);
  });
  afterEach(() => {
    style.remove();
    document.body.replaceChildren();
  });

  /** The parts of `badge`, drawn inside a card's question when `inCard`. */
  const partsOf = (badge: PlanningBadge, inCard: boolean) => {
    const host = document.createElement("p");
    const element = planningBadgeElement(badge);
    host.appendChild(element);
    if (inCard) {
      const body = document.createElement("div");
      body.className = "planning-card-body";
      body.appendChild(host);
      document.body.appendChild(body);
    } else {
      document.body.appendChild(host);
    }
    return Array.from(element.children) as HTMLElement[];
  };

  it("draws a question's state gray and faded, glyph and all", () => {
    const badges: PlanningBadge[] = [
      ...(["answered", "open", "blocked"] as const).map(
        (state): PlanningBadge => ({
          kind: "question",
          path: "a.md",
          id: "OQ-1",
          state,
        }),
      ),
      // The "✅ ruled" of a compacted question.
      { kind: "ruled", path: "a.md", id: "OQ-2" },
    ];
    for (const badge of badges) {
      const [part] = partsOf(badge, true);
      const computed = getComputedStyle(part!);
      const label = part!.className;
      expect(computed.filter, label).toBe("grayscale(1)");
      expect(Number(computed.opacity), label).toBeLessThan(1);
      // Faded no further than the 3:1 floor allows (index.css).
      expect(Number(computed.opacity), label).toBeGreaterThanOrEqual(0.85);
    }
  });

  it("tones a document's status chip the same way, and keeps a warning's", () => {
    const parts = partsOf(
      {
        kind: "document",
        path: "a.md",
        status: "accepted",
        stage: "BUILT",
        stageInVocabulary: false,
        open: 1,
        blocked: 0,
      },
      true,
    );
    const [chip, stage, open] = parts;
    expect(getComputedStyle(chip!).filter).toBe("grayscale(1)");
    expect(getComputedStyle(open!).filter).toBe("grayscale(1)");
    // A stage outside the vocabulary is a warning: it keeps its tone.
    expect(stage!.className).toContain("vantage-planning-badge__part--warning");
    expect(getComputedStyle(stage!).filter).not.toBe("grayscale(1)");
    expect(getComputedStyle(stage!).opacity).not.toBe("0.85");
  });

  it("leaves a badge outside a card as it is", () => {
    const [part] = partsOf(
      { kind: "question", path: "a.md", id: "OQ-1", state: "answered" },
      false,
    );
    expect(getComputedStyle(part!).filter).not.toBe("grayscale(1)");
  });
});
