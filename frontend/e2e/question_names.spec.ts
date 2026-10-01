import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveFixture } from "./ownServer";

// `oq`, `question` and `fallback` in a real browser, against the real build's
// stylesheet and the real server (docs/design/checker-version-skew.md §3.1,
// §3.2). The fixture is `fixtures/question_names/questions.md`: an open `oq`,
// a 🔒 and a ✅ `question`, and a toned section holding a fallback block.
// Every check of these names is jsdom's otherwise, which runs no stylesheet
// and paints nothing.

const here = path.dirname(fileURLToPath(import.meta.url));
const DOC = "/questions.md";
const FALLBACK = "FALLBACK-TEXT";

const prose = (page: Page) => page.locator("[data-content-scroll] .prose");

/** The ids of the elements matching `selector`, in document order. */
const idsOf = (page: Page, selector: string) =>
  prose(page)
    .locator(selector)
    .evaluateAll((els) => els.map((el) => el.id));

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(DOC);
  await expect(prose(page).locator("h1")).toContainText(
    "Questions in every state",
  );
}

test.describe("question and fallback directives", () => {
  test.describe.configure({ mode: "serial" });
  serveFixture(path.join(here, "fixtures/question_names"));

  test("stamps the open question as one to answer and the rest as questions, and withholds the fallback", async ({
    page,
  }) => {
    await open(page);
    expect(await idsOf(page, "[data-vantage-oq]")).toEqual(["OQ-1"]);
    expect(await idsOf(page, "[data-vantage-question]")).toEqual([
      "OQ-2",
      "OQ-3",
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

  test("counts every question in the contents column, and one to answer in one click", async ({
    page,
  }) => {
    await open(page);
    // Each test has a context of its own, so the column starts hidden.
    await page.getByRole("button", { name: "Show contents" }).click();
    await expect(page.getByTestId("toc-question-count")).toHaveAttribute(
      "aria-label",
      "3 questions here — 1 open, 1 answered, 1 blocked; 1 can be answered in one click",
    );
  });

  test("offers Take this leaning on the open question alone", async ({
    page,
  }) => {
    await open(page);
    const review = page
      .getByTestId("viewer-header")
      .getByRole("button", { name: "Review", exact: true });
    await expect(review).toHaveAttribute(
      "title",
      "Enter review mode — 1 open question here can be answered in one click",
    );
    await review.click();
    await expect(prose(page).locator(".review-oq-take")).toHaveCount(1);
    await expect(
      prose(page)
        .locator("li")
        .filter({ hasText: "OQ-1:" })
        .locator(".review-oq-take"),
    ).toHaveCount(1);
  });

  test("offers Take this leaning on the open question's card alone", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    const card = (title: string) => page.getByRole("article", { name: title });
    const open = card("OQ-1: Does the open question take a leaning?");
    await expect(
      open.getByRole("button", { name: "Take this leaning" }),
    ).toBeVisible();
    const blocked = card(
      "OQ-2: Is the blocked question waiting on the load test?",
    );
    await expect(blocked).toBeVisible();
    await expect(
      blocked.getByRole("button", { name: "Take this leaning" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Take this leaning" }),
    ).toHaveCount(1);
    await expect(page.locator("main")).not.toContainText(FALLBACK);
  });
});
