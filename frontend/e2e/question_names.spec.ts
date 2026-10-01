import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveFixture } from "./ownServer";

// `oq`, `question` and `fallback` in a real browser, against the real build's
// stylesheet and the real server (docs/design/checker-version-skew.md §3.1,
// §3.2), and the row of controls review mode gives an open question
// (docs/reference/inline-markup.md, "The one-click Open Question answer").
// The fixture is `fixtures/question_names/questions.md`: an open `oq`, a 🔒
// and a ✅ `question`, an open `question` written in its parts, and a toned
// section holding a fallback block. Every check of these names is jsdom's
// otherwise, which runs no stylesheet and paints nothing.

const here = path.dirname(fileURLToPath(import.meta.url));
const DOC = "/questions.md";
const FALLBACK = "FALLBACK-TEXT";
const ANSWERED = "Answered — waiting on the agent";

const prose = (page: Page) => page.locator("[data-content-scroll] .prose");

/** The ids of the elements matching `selector`, in document order. */
const idsOf = (page: Page, selector: string) =>
  prose(page)
    .locator(selector)
    .evaluateAll((els) => els.map((el) => el.id));

/** The list item of the question whose title opens `id`. */
const item = (page: Page, id: string) =>
  prose(page).locator("li").filter({ hasText: `${id}:` });

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(DOC);
  await expect(prose(page).locator("h1")).toContainText(
    "Questions in every state",
  );
}

/** Open the document with review mode already on, as a reader who left it on. */
async function openInReview(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("vantage.reviewMode:questions.md", "on");
  });
  await open(page);
  await expect(prose(page).locator(".review-oq-row")).toHaveCount(2);
}

/** Take back every comment a test filed, so the next starts from none. */
async function clearReview(page: Page) {
  await page.evaluate(() =>
    fetch("/api/review?path=questions.md", { method: "DELETE" }),
  );
}

test.describe("question and fallback directives", () => {
  test.describe.configure({ mode: "serial" });
  serveFixture(path.join(here, "fixtures/question_names"));

  test("stamps every question as one, the `oq` one besides, and withholds the fallback", async ({
    page,
  }) => {
    await open(page);
    expect(await idsOf(page, "[data-vantage-oq]")).toEqual(["OQ-1"]);
    expect(await idsOf(page, "[data-vantage-question]")).toEqual([
      "OQ-1",
      "OQ-2",
      "OQ-3",
      "OQ-4",
    ]);
    await expect(prose(page)).not.toContainText(FALLBACK);
    // The toned section runs over what is shown and nothing else: the
    // withheld block is no member of it, so the last block seen ends it.
    await expect
      .poll(() =>
        prose(page)
          .locator("[data-vantage-run]")
          .evaluateAll((els) =>
            els.map((el) => el.getAttribute("data-vantage-run")),
          ),
      )
      .toEqual(["start", "middle", "end"]);

    // Removed, not hidden, so print has nothing to show either.
    await page.emulateMedia({ media: "print" });
    await expect(prose(page)).not.toContainText(FALLBACK);
    await expect(
      prose(page).getByText("Shown after the fallback."),
    ).toBeVisible();
  });

  test("counts every question in the contents column, and the open ones to answer in one click", async ({
    page,
  }) => {
    await open(page);
    // Each test has a context of its own, so the column starts hidden.
    await page.getByRole("button", { name: "Show contents" }).click();
    await expect(page.getByTestId("toc-question-count")).toHaveAttribute(
      "aria-label",
      "4 questions here — 2 open, 1 answered, 1 blocked; 2 can be answered in one click",
    );
  });

  test("offers Take this leaning on each open question, whichever name declared it", async ({
    page,
  }) => {
    await open(page);
    const review = page
      .getByTestId("viewer-header")
      .getByRole("button", { name: "Review", exact: true });
    await expect(review).toHaveAttribute(
      "title",
      "Enter review mode — 2 open questions here can be answered in one click",
    );
    await review.click();
    await expect(prose(page).locator(".review-oq-take")).toHaveCount(2);
    for (const id of ["OQ-1", "OQ-4"]) {
      await expect(item(page, id).locator(".review-oq-take")).toHaveCount(1);
    }
    for (const id of ["OQ-2", "OQ-3"]) {
      await expect(
        item(page, id).locator("[data-vantage-oq-button]"),
      ).toHaveCount(0);
    }
  });

  test("offers Take this leaning on the open questions' cards alone", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    const card = (title: string) => page.getByRole("article", { name: title });
    for (const title of [
      "OQ-1: Does the open question take a leaning?",
      "OQ-4: Does an open question under the new name take a leaning?",
    ]) {
      await expect(
        card(title).getByRole("button", { name: "Take this leaning" }),
      ).toBeVisible();
    }
    const blocked = card(
      "OQ-2: Is the blocked question waiting on the load test?",
    );
    await expect(blocked).toBeVisible();
    await expect(
      blocked.getByRole("button", { name: "Take this leaning" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Take this leaning" }),
    ).toHaveCount(2);
    await expect(page.locator("main")).not.toContainText(FALLBACK);
  });

  // The row is at the end of the question, after its Answer, and it is in the
  // document's first paint: late data never moves painted content
  // (docs/reference/planning-index.md §12). Measured inside the document:
  // the shell's own sources — a folder in the file tree filling late, and
  // review mode's 4px bar above the viewer, which moves the whole pane —
  // are the reference's to fix, and stable_paint.spec.ts records them.
  test("puts an open question's controls in one row at the end of its item, painted with the document", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      interface Entry extends PerformanceEntry {
        value: number;
        hadRecentInput: boolean;
        sources: { node: Node | null }[];
      }
      const shifts: { value: number; nodes: string[] }[] = [];
      (window as unknown as { __shifts: typeof shifts }).__shifts = shifts;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Entry[]) {
          if (entry.hadRecentInput) continue;
          const inDocument = entry.sources.flatMap((source) => {
            const el =
              source.node instanceof Element
                ? source.node
                : (source.node?.parentElement ?? null);
            return el?.closest("[data-content-scroll] .prose")
              ? [
                  `${el.tagName} ${el.className} "${(el.textContent ?? "").slice(0, 40)}"`,
                ]
              : [];
          });
          if (inDocument.length > 0) {
            shifts.push({ value: entry.value, nodes: inDocument });
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await openInReview(page);

    const row = item(page, "OQ-4").locator(":scope > .review-oq-row");
    await expect(row).toHaveCount(1);
    // Its item's last child, after the Answer's quote — not between the
    // leaning and the Answer, where the directive's block is.
    expect(
      await item(page, "OQ-4").evaluate((li) => {
        const last = li.lastElementChild!;
        return [
          last.classList.contains("review-oq-row"),
          last.previousElementSibling?.tagName,
        ];
      }),
    ).toEqual([true, "BLOCKQUOTE"]);
    await expect(row.getByRole("button")).toHaveText([
      "Take this leaning",
      "Answer…",
    ]);
    // Closer to its own question than to anything after it.
    const gaps = await item(page, "OQ-4").evaluate((li) => {
      const row = li.lastElementChild!.getBoundingClientRect();
      const above = li.lastElementChild!.previousElementSibling!;
      return {
        above: row.top - above.getBoundingClientRect().bottom,
        below:
          (li.parentElement!.nextElementSibling?.getBoundingClientRect().top ??
            row.bottom + 100) - row.bottom,
      };
    });
    expect(gaps.above).toBeGreaterThan(0);
    expect(gaps.above).toBeLessThan(gaps.below);

    // Two frames, so the observer has reported the last paint.
    const shifts = await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve((window as unknown as { __shifts: unknown }).__shifts),
            ),
          ),
        ),
    );
    expect(shifts).toEqual([]);
  });

  test("keeps the take's chip and Undo as they were", async ({ page }) => {
    await openInReview(page);
    const row = item(page, "OQ-1").locator(".review-oq-row");
    await row.getByRole("button", { name: "Take this leaning" }).click();
    await expect(row.locator(".review-oq-taken")).toHaveText("Leaning taken");
    await expect(row.locator(".review-oq-answered")).toHaveCount(0);
    await row.getByRole("button", { name: "Undo" }).click();
    await expect(
      row.getByRole("button", { name: "Take this leaning" }),
    ).toBeVisible();
    await clearReview(page);
  });

  test("takes a comment typed on a question's body for its answer, in the document, on its card and in Copy answers", async ({
    page,
  }) => {
    await openInReview(page);
    // A click on the question's context, not the leaning a take anchors on.
    await item(page, "OQ-4")
      .getByText("Its context, in a paragraph of its own.")
      .click();
    await page
      .locator('textarea[placeholder="Your comment..."]')
      .fill("The first way, after all.");
    await page.getByText("Save", { exact: true }).click();

    const row = item(page, "OQ-4").locator(":scope > .review-oq-row");
    await expect(row.locator(".review-oq-answered")).toHaveText(ANSWERED);
    await expect(row.getByRole("button")).toHaveCount(0);
    // The other open question is untouched by it.
    await expect(
      item(page, "OQ-1").getByRole("button", { name: "Take this leaning" }),
    ).toBeVisible();

    await page.goto("/.vantage/planning");
    const card = (id: string) =>
      page.getByRole("article", { name: new RegExp(`^${id}:`) });
    await expect(card("OQ-4").getByText(ANSWERED)).toBeVisible();
    await expect(
      card("OQ-4").getByRole("button", { name: "Take this leaning" }),
    ).toHaveCount(0);
    // Still listed, with the comment as its answer.
    await expect(
      card("OQ-4").getByRole("list", { name: "Comments on this question" }),
    ).toContainText("The first way, after all.");
    await expect(page.getByTestId("pending-answers")).toHaveText("1");
    await expect(page.getByTestId("nothing-needs-you")).toHaveCount(0);

    // Answering the last open one from its card leaves nothing needing you.
    await card("OQ-1")
      .getByRole("button", { name: "Take this leaning" })
      .click();
    await expect(card("OQ-1").getByText("Leaning taken")).toBeVisible();
    await expect(page.getByTestId("nothing-needs-you")).toContainText(
      "Every open question has your answer, waiting on the agent.",
    );
    await expect(page.getByTestId("pending-answers")).toHaveText("2");
    await clearReview(page);
  });
});

// A question outside a list runs from the block its directive lands on over
// the blocks after it, up to the next heading, rule or question
// (docs/reference/inline-markup.md): its row goes after its Answer, and a
// comment on any of its blocks is its answer. The fixture is
// `fixtures/question_paragraphs/paragraphs.md`, two open questions written as
// paragraphs, served on their own so the counts above stay theirs.
test.describe("a question written as paragraphs", () => {
  test.describe.configure({ mode: "serial" });
  serveFixture(path.join(here, "fixtures/question_paragraphs"));

  const PARAGRAPHS = "/paragraphs.md";
  /** The paragraph whose text starts with `text`. */
  const para = (page: Page, text: string) =>
    prose(page).locator("p").filter({ hasText: text });

  async function openParagraphs(page: Page) {
    await page.addInitScript(() => {
      localStorage.setItem("vantage.reviewMode:paragraphs.md", "on");
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PARAGRAPHS);
    await expect(prose(page).locator(".review-oq-row")).toHaveCount(2);
  }

  test("puts the row after the question's Answer, not between its title and its context", async ({
    page,
  }) => {
    await openParagraphs(page);
    const rows = prose(page).locator(".review-oq-row");
    // The first row follows the Answer's quote and comes before the next
    // question's title; the second follows that question's leaning, before
    // the Afterword's heading.
    expect(
      await rows.evaluateAll((els) =>
        els.map((row) => [
          row.previousElementSibling?.tagName,
          row.nextElementSibling?.tagName,
          (row.nextElementSibling?.textContent ?? "").includes("OQ-P2") ||
            (row.nextElementSibling?.textContent ?? "").includes("Afterword"),
        ]),
      ),
    ).toEqual([
      ["BLOCKQUOTE", "P", true],
      ["P", "H2", true],
    ]);
    await expect(rows.first().getByRole("button")).toHaveText([
      "Take this leaning",
      "Answer…",
    ]);
  });

  test("takes a comment on its leaning for its answer, in the document and on its card", async ({
    page,
  }) => {
    await openParagraphs(page);
    await para(page, "Leaning: the first way.").click();
    await page
      .locator('textarea[placeholder="Your comment..."]')
      .fill("The first way, as leaned.");
    await page.getByText("Save", { exact: true }).click();

    const rows = prose(page).locator(".review-oq-row");
    await expect(rows.first().locator(".review-oq-answered")).toHaveText(
      ANSWERED,
    );
    // The next question is its own.
    await expect(
      rows.nth(1).getByRole("button", { name: "Take this leaning" }),
    ).toBeVisible();

    await page.goto("/.vantage/planning");
    const card = (id: string) =>
      page.getByRole("article", { name: new RegExp(`^${id}:`) });
    await expect(card("OQ-P1").getByText(ANSWERED)).toBeVisible();
    await expect(
      card("OQ-P1").getByRole("button", { name: "Take this leaning" }),
    ).toHaveCount(0);
    // The card holds the whole question, its leaning and its comment.
    await expect(card("OQ-P1")).toContainText("Its context, in a paragraph");
    await expect(
      card("OQ-P1").getByRole("list", { name: "Comments on this question" }),
    ).toContainText("The first way, as leaned.");
    await expect(page.getByTestId("pending-answers")).toHaveText("1");
    await page.evaluate(() =>
      fetch("/api/review?path=paragraphs.md", { method: "DELETE" }),
    );
  });
});
