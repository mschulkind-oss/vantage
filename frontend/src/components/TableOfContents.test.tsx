/**
 * The table of contents panel and the outline collection behind it.
 *
 * The outline is read out of the rendered DOM rather than re-derived from the
 * Markdown source, so the fixtures here are shaped like what `MarkdownViewer`
 * actually emits: an `id` on every heading and a literal `#` anchor link inside
 * it. That anchor is why `headingText` exists — plain `textContent` on a
 * rendered heading reads "#Overview".
 *
 * The Open Question fixtures are shaped like what `rehypeVantageDirectives`
 * emits for the layout the convention prescribes, and the shape is the point: the
 * directive sits *between* the question's title and its leaning, so the element
 * carrying `data-vantage-oq` and the `id` is the **leaning** paragraph while the
 * title is a sibling. A label read off the stamped element reads "Leaning: …" for
 * every entry in the column, which is the failure these fixtures exist to catch.
 */

import React, { useRef } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TableOfContents } from "./TableOfContents";
import {
  activeEntryId,
  collectOutline,
  measureEntryOffsets,
  questionLabel,
  type OutlineEntry,
} from "../hooks/useDocumentOutline";

/** A rendered document, as `MarkdownViewer` leaves it in the DOM. */
function documentHTML(): string {
  return `
    <h1 id="title" class="group relative"><a href="#title" class="heading-anchor">#</a>Title</h1>
    <p>Intro</p>
    <h2 id="first" class="group relative"><a href="#first" class="heading-anchor">#</a>First section</h2>
    <h3 id="nested" class="group relative"><a href="#nested" class="heading-anchor">#</a>Nested</h3>
    <h2 id="second" class="group relative"><a href="#second" class="heading-anchor">#</a>Second section</h2>
    <h2>Unlinkable</h2>
  `;
}

/**
 * One Open Question, in the list layout the convention prescribes.
 *
 * `data-source-line` on every block is not decoration: `answerableOpenQuestions`
 * resolves the block a review comment would anchor to, and a block without a
 * source line is not anchorable at all — so a fixture missing it yields no
 * question, no button and no entry, for a reason that has nothing to do with the
 * code under test. The renderer stamps it on every block.
 */
function questionHTML(
  id: string,
  marker: string,
  title: string,
  line = 1,
): string {
  return `
    <li data-source-line="${line}">
      <p data-source-line="${line}">${marker} <strong>${title}</strong> Some stakes.</p>
      <p data-source-line="${line + 2}" data-vantage-oq="true" data-vantage-leaning="A leaning." ${id ? `id="${id}"` : ""}><em>Leaning:</em> a leaning.</p>
    </li>
  `;
}

/** A design document: headings, then an Open Questions list under one of them. */
function documentWithQuestionsHTML(): string {
  return `
    <h1 id="title" class="group relative"><a href="#title" class="heading-anchor">#</a>Title</h1>
    <h2 id="open-questions" class="group relative"><a href="#open-questions" class="heading-anchor">#</a>Open questions</h2>
    <ol>
      ${questionHTML("OQ-1", "💬", "OQ-1: Does the emoji carry enough weight next to a chip?", 10)}
      ${questionHTML("OQ-2", "✅", "OQ-2: Should an answered question look different?", 20)}
    </ol>
    <h2 id="ledger" class="group relative"><a href="#ledger" class="heading-anchor">#</a>Decision Ledger</h2>
  `;
}

function Harness({
  open = true,
  html = documentHTML(),
}: {
  open?: boolean;
  html?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <TableOfContents containerRef={ref} open={open} />
      <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

/** An entry for the measuring tests, which care only about id and element. */
function entryFor(el: HTMLElement, kind: OutlineEntry["kind"]): OutlineEntry {
  return {
    kind,
    id: el.id,
    text: el.textContent ?? "",
    marker: "",
    status: null,
    level: 1,
    element: el,
  };
}

describe("collectOutline", () => {
  it("reads level, id and text from headings, dropping the anchor link", () => {
    const container = document.createElement("div");
    container.innerHTML = documentHTML();

    expect(
      collectOutline(container).map(({ kind, id, text, level }) => ({
        kind,
        id,
        text,
        level,
      })),
    ).toEqual([
      { kind: "heading", id: "title", text: "Title", level: 1 },
      { kind: "heading", id: "first", text: "First section", level: 2 },
      { kind: "heading", id: "nested", text: "Nested", level: 3 },
      { kind: "heading", id: "second", text: "Second section", level: 2 },
    ]);
  });

  it("skips a heading with no id, which nothing could link to", () => {
    const container = document.createElement("div");
    container.innerHTML = documentHTML();
    expect(collectOutline(container).map((e) => e.text)).not.toContain(
      "Unlinkable",
    );
  });

  it("does not invent headings from a fenced code block", () => {
    // The rendered form of ```\n# not a heading\n``` — text, not an <h1>.
    const container = document.createElement("div");
    container.innerHTML = `<pre><code># not a heading</code></pre>`;
    expect(collectOutline(container)).toEqual([]);
  });

  it("lists a tagged question in document order, between the headings", () => {
    const container = document.createElement("div");
    container.innerHTML = documentWithQuestionsHTML();

    expect(collectOutline(container).map((e) => [e.kind, e.id])).toEqual([
      ["heading", "title"],
      ["heading", "open-questions"],
      ["question", "OQ-1"],
      ["question", "OQ-2"],
      ["heading", "ledger"],
    ]);
  });

  it("reads the title and marker from the question, not from the stamped leaning", () => {
    const container = document.createElement("div");
    container.innerHTML = documentWithQuestionsHTML();
    const [first] = collectOutline(container).filter(
      (e) => e.kind === "question",
    );

    expect(first.text).toBe(
      "OQ-1: Does the emoji carry enough weight next to a chip?",
    );
    expect(first.marker).toBe("💬");
    // The trap: the element carrying the id is the leaning paragraph.
    expect(first.text).not.toMatch(/Leaning/);
  });

  it("shows the state the document wrote, not one assumed from the directive", () => {
    // A question may keep its directive after being answered — the gallery does
    // exactly that, deliberately. The column must not call it open.
    const container = document.createElement("div");
    container.innerHTML = documentWithQuestionsHTML();
    const questions = collectOutline(container).filter(
      (e) => e.kind === "question",
    );

    expect(questions.map((q) => [q.marker, q.status])).toEqual([
      ["💬", "open"],
      ["✅", "settled"],
    ]);
  });

  it("nests a question one step under the heading it falls beneath", () => {
    const container = document.createElement("div");
    container.innerHTML = documentWithQuestionsHTML();
    const byId = new Map(collectOutline(container).map((e) => [e.id, e.level]));

    expect(byId.get("open-questions")).toBe(2);
    expect(byId.get("OQ-1")).toBe(3);
  });

  it("puts a question before any heading at the top level", () => {
    const container = document.createElement("div");
    container.innerHTML = `<ol>${questionHTML("OQ-9", "💬", "OQ-9: Asked before anything else?")}</ol>`;
    expect(collectOutline(container).map((e) => e.level)).toEqual([1]);
  });

  it("lists a question whose directive carried no id, with nothing to link to", () => {
    // The set has to match the buttons: `answerableOpenQuestions` renders one for
    // this question, so a column that dropped it would disagree with the page.
    const container = document.createElement("div");
    container.innerHTML = `<ol>${questionHTML("", "💬", "OQ-8: Unanchored?")}</ol>`;
    const [entry] = collectOutline(container);

    expect(entry.kind).toBe("question");
    expect(entry.id).toBe("");
  });

  it("omits a stamped block that hosts no button", () => {
    // A `pre` is anchorable and the plugin stamps it, but it can host no button.
    // An entry leading there would promise an action that is not on offer.
    const container = document.createElement("div");
    container.innerHTML = `<pre data-source-line="1" data-vantage-oq="true" id="OQ-5"><code>fenced</code></pre>`;
    expect(collectOutline(container)).toEqual([]);
  });

  it("counts one question when two directives resolve to one block", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <ol>
        <li data-source-line="1" data-vantage-oq="true" id="OQ-7">
          <p data-source-line="1" data-vantage-oq="true" data-vantage-leaning="A leaning.">💬 <strong>OQ-7: Stamped twice?</strong></p>
        </li>
      </ol>
    `;
    expect(
      collectOutline(container).filter((e) => e.kind === "question"),
    ).toHaveLength(1);
  });
});

describe("questionLabel", () => {
  it("falls back to the question's own text when there is no bold title", () => {
    const container = document.createElement("div");
    container.innerHTML = `<p data-vantage-oq="true" id="OQ-4">💬 A question written as a bare paragraph.</p>`;
    const stamped = container.querySelector<HTMLElement>("[data-vantage-oq]")!;

    expect(questionLabel(stamped)).toEqual({
      marker: "💬",
      text: "💬 A question written as a bare paragraph.",
    });
  });

  it("keeps both markers of a deferred question", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <li>
        <p>💬 🤷 <strong>OQ-B5: How much payload budget?</strong></p>
        <p data-vantage-oq="true" id="OQ-B5">A leaning.</p>
      </li>
    `;
    const stamped = container.querySelector<HTMLElement>("[data-vantage-oq]")!;

    expect(questionLabel(stamped).marker).toBe("💬 🤷");
  });

  it("ignores a bold run that is not a question title", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <li>
        <p><strong>Note:</strong> not a title.</p>
        <p>💬 <strong>OQ-3: The real title?</strong></p>
        <p data-vantage-oq="true" id="OQ-3">A leaning.</p>
      </li>
    `;
    const stamped = container.querySelector<HTMLElement>("[data-vantage-oq]")!;

    expect(questionLabel(stamped).text).toBe("OQ-3: The real title?");
  });
});

describe("measureEntryOffsets", () => {
  /**
   * jsdom has no layout engine, so a plain node's `getBoundingClientRect`
   * and `offsetParent` are stubbed by hand here to stand in for what a real
   * browser would compute — a rendered heading at some position, or one
   * `display: none` has taken out of flow.
   */
  function stubRendered(el: HTMLElement, top: number) {
    el.getBoundingClientRect = () => ({ top }) as unknown as DOMRect;
    Object.defineProperty(el, "offsetParent", {
      configurable: true,
      get: () => document.body,
    });
  }
  function stubHidden(el: HTMLElement) {
    el.getBoundingClientRect = () => ({ top: 0 }) as unknown as DOMRect;
    Object.defineProperty(el, "offsetParent", {
      configurable: true,
      get: () => null,
    });
  }

  it("measures each entry's offset from the container's top", () => {
    const container = document.createElement("div");
    stubRendered(container, 0);
    const h1 = document.createElement("h1");
    h1.id = "a";
    stubRendered(h1, 140);
    container.append(h1);

    expect(measureEntryOffsets(container, [entryFor(h1, "heading")])).toEqual([
      { id: "a", top: 140 },
    ]);
  });

  it("measures the entry's own element, not another with the same id", () => {
    // A collision this is specifically guarding against: id="root" also names
    // the app's own mount point, which sits outside — and, in document order,
    // before — the content container. Holding the element is what makes a
    // global lookup impossible rather than merely avoided.
    const outer = document.createElement("div");
    outer.id = "root";
    stubRendered(outer, 999);
    document.body.append(outer);

    const container = document.createElement("div");
    stubRendered(container, 0);
    const heading = document.createElement("h1");
    heading.id = "root";
    stubRendered(heading, 64);
    container.append(heading);
    document.body.append(container);

    try {
      expect(
        measureEntryOffsets(container, [entryFor(heading, "heading")]),
      ).toEqual([{ id: "root", top: 64 }]);
    } finally {
      outer.remove();
      container.remove();
    }
  });

  it("excludes an entry that is not rendered (a closed collapsed section)", () => {
    const container = document.createElement("div");
    stubRendered(container, 0);
    const visible = document.createElement("h1");
    visible.id = "visible";
    stubRendered(visible, 50);
    const hidden = document.createElement("h2");
    hidden.id = "hidden";
    stubHidden(hidden);
    container.append(visible, hidden);

    expect(
      measureEntryOffsets(container, [
        entryFor(visible, "heading"),
        entryFor(hidden, "heading"),
      ]),
    ).toEqual([{ id: "visible", top: 50 }]);
  });

  it("skips an entry with no id, which the active tracker cannot name", () => {
    const container = document.createElement("div");
    stubRendered(container, 0);
    const p = document.createElement("p");
    stubRendered(p, 20);
    container.append(p);

    expect(measureEntryOffsets(container, [entryFor(p, "question")])).toEqual(
      [],
    );
  });

  it("tracks a question alongside the headings", () => {
    const container = document.createElement("div");
    stubRendered(container, 0);
    const heading = document.createElement("h2");
    heading.id = "open-questions";
    stubRendered(heading, 40);
    const question = document.createElement("p");
    question.id = "OQ-1";
    stubRendered(question, 80);
    container.append(heading, question);

    expect(
      measureEntryOffsets(container, [
        entryFor(heading, "heading"),
        entryFor(question, "question"),
      ]),
    ).toEqual([
      { id: "open-questions", top: 40 },
      { id: "OQ-1", top: 80 },
    ]);
  });
});

describe("activeEntryId", () => {
  it("is the last entry at or above the band", () => {
    expect(
      activeEntryId([
        { id: "a", top: -400 },
        { id: "b", top: -20 },
        { id: "c", top: 500 },
      ]),
    ).toBe("b");
  });

  it("is the first entry when the reader is above all of them", () => {
    expect(
      activeEntryId([
        { id: "a", top: 300 },
        { id: "b", top: 900 },
      ]),
    ).toBe("a");
  });

  it("is null with no entries", () => {
    expect(activeEntryId([])).toBeNull();
  });
});

/**
 * A single real JSX heading, not `dangerouslySetInnerHTML`: re-rendering this
 * with a new `text`/`id` goes through React's own reconciler, which patches
 * the existing DOM node's `id` attribute and text node in place rather than
 * replacing it — exactly what live reload does to a heading whose position
 * in the tree is unchanged, and exactly the case a MutationObserver
 * listening only for childList mutations cannot see.
 */
function LiveHeading({ text, id }: { text: string; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <TableOfContents containerRef={ref} open />
      <div ref={ref}>
        <h2 id={id}>{text}</h2>
      </div>
    </div>
  );
}

/**
 * A paragraph that gains its `oq` directive in place, which is what editing a
 * document to add one does: React patches `data-vantage-oq` onto the element
 * that is already there rather than replacing it, so nothing about the mutation
 * is a childList record.
 */
function LiveQuestion({ tagged }: { tagged: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <TableOfContents containerRef={ref} open />
      <div ref={ref}>
        <h2 id="questions">Questions</h2>
        <ul>
          <li data-source-line="1">
            <p data-source-line="1">
              💬 <strong>OQ-1: Newly tagged?</strong>
            </p>
            <p
              data-source-line="3"
              id={tagged ? "OQ-1" : undefined}
              data-vantage-oq={tagged ? "true" : undefined}
              data-vantage-leaning={tagged ? "A leaning." : undefined}
            >
              A leaning.
            </p>
          </li>
        </ul>
      </div>
    </div>
  );
}

describe("TableOfContents", () => {
  beforeEach(() => {
    // jsdom has no MutationObserver callback scheduling worth waiting on here;
    // the initial scan is what these assertions are about.
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback) =>
        setTimeout(() => cb(0), 0) as unknown as number,
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders nothing when closed", () => {
    render(<Harness open={false} />);
    expect(screen.queryByTestId("table-of-contents")).toBeNull();
  });

  it("lists the document's headings when open", () => {
    render(<Harness />);
    expect(screen.getByTestId("table-of-contents")).toBeTruthy();
    expect(screen.getByRole("link", { name: "First section" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Nested" })).toBeTruthy();
  });

  it("indents by depth, relative to the document's shallowest heading", () => {
    render(<Harness />);
    const h1 = screen.getByRole("link", { name: "Title" });
    const h2 = screen.getByRole("link", { name: "First section" });
    const h3 = screen.getByRole("link", { name: "Nested" });
    expect(h1.style.paddingLeft).toBe("8px");
    expect(h2.style.paddingLeft).toBe("20px");
    expect(h3.style.paddingLeft).toBe("32px");
  });

  it("scrolls to a heading and puts it in the URL", () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    render(<Harness />);

    act(() => {
      fireEvent.click(screen.getByRole("link", { name: "Second section" }));
    });

    expect(replaceState).toHaveBeenCalledWith(null, "", "#second");
    replaceState.mockRestore();
  });

  it("carries no surface of its own — no panel, border or background", () => {
    render(<Harness />);
    const toc = screen.getByTestId("table-of-contents");
    const classes = `${toc.className} ${toc.querySelector("nav")?.className ?? ""}`;
    expect(classes).not.toMatch(/\bbg-|\bborder\b|\bborder-[rltb]\b|shadow/);
  });

  it("picks up a heading whose text and id changed in place", async () => {
    const { rerender } = render(
      <LiveHeading text="Old Heading" id="old-heading" />,
    );
    await screen.findByRole("link", { name: "Old Heading" });

    act(() => {
      rerender(<LiveHeading text="New Heading" id="new-heading" />);
    });

    await screen.findByRole("link", { name: "New Heading" });
    expect(screen.queryByRole("link", { name: "New Heading" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "New Heading" })).toHaveAttribute(
      "href",
      "#new-heading",
    );
  });

  it("says so when the document has no headings", () => {
    function Empty() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div>
          <TableOfContents containerRef={ref} open />
          <div ref={ref}>
            <p>Just prose.</p>
          </div>
        </div>
      );
    }
    render(<Empty />);
    expect(screen.getByText("No headings in this document.")).toBeTruthy();
  });

  it("lists a question, addressing its anchor so the link can be copied", () => {
    render(<Harness html={documentWithQuestionsHTML()} />);
    const entries = screen.getAllByTestId("toc-question");

    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveAttribute("href", "#OQ-1");
  });

  it("says the state in words for a reader who cannot see the emoji", () => {
    render(<Harness html={documentWithQuestionsHTML()} />);

    expect(
      screen.getByRole("link", {
        name: "Open question: OQ-1: Does the emoji carry enough weight next to a chip?",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", {
        name: "Answered question: OQ-2: Should an answered question look different?",
      }),
    ).toBeTruthy();
  });

  it("counts the questions in the header, and says nothing at zero", () => {
    const { unmount } = render(<Harness html={documentWithQuestionsHTML()} />);
    expect(screen.getByTestId("toc-question-count").textContent).toContain("2");
    unmount();

    render(<Harness />);
    expect(screen.queryByTestId("toc-question-count")).toBeNull();
  });

  it("scrolls to the question, not to the leaning the anchor sits on", () => {
    render(<Harness html={documentWithQuestionsHTML()} />);
    const item = document.querySelector("li")!;
    const scrollIntoView = vi.fn();
    item.scrollIntoView = scrollIntoView;

    act(() => {
      fireEvent.click(screen.getAllByTestId("toc-question")[0]);
    });

    // The enclosing item is what moves into view — the title is inside it, and
    // the stamped leaning paragraph is not the thing the reader is looking for.
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("picks up a question tagged in place, with no childList mutation", async () => {
    const { rerender } = render(<LiveQuestion tagged={false} />);
    await screen.findByRole("link", { name: "Questions" });
    expect(screen.queryAllByTestId("toc-question")).toHaveLength(0);

    act(() => {
      rerender(<LiveQuestion tagged />);
    });

    await vi.waitFor(() =>
      expect(screen.queryAllByTestId("toc-question")).toHaveLength(1),
    );
  });
});
