import { createHash } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { planningIndexReady } from "./planningIndex";

async function expectDetailsActionsReachable(page: Page, card: Locator) {
  const summary = card.locator("summary");
  await summary.scrollIntoViewIfNeeded();
  await summary.click();
  await expect(card.locator("details")).toHaveAttribute("open", "");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= window.innerWidth &&
        document.querySelector("[data-content-scroll]")!.scrollWidth <=
          document.querySelector("[data-content-scroll]")!.clientWidth,
    ),
  ).toBe(true);

  const panel = card.locator("details > div");
  const panelBounds = await panel.evaluate((element) => {
    const panelRect = element.getBoundingClientRect();
    const viewportRect = document
      .querySelector("[data-content-scroll]")!
      .getBoundingClientRect();
    return {
      left: panelRect.left,
      right: panelRect.right,
      viewportLeft: viewportRect.left,
      viewportRight: viewportRect.right,
    };
  });
  expect(panelBounds.left).toBeGreaterThanOrEqual(panelBounds.viewportLeft);
  expect(panelBounds.right).toBeLessThanOrEqual(panelBounds.viewportRight);

  for (const action of [
    panel.getByRole("link", { name: "Open document to comment" }),
    panel.getByRole("button", { name: "Copy change request" }),
  ]) {
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeVisible();
    const actionBounds = await action.evaluate((element) => {
      const actionRect = element.getBoundingClientRect();
      const viewportRect = document
        .querySelector("[data-content-scroll]")!
        .getBoundingClientRect();
      return {
        left: actionRect.left,
        right: actionRect.right,
        viewportLeft: viewportRect.left,
        viewportRight: viewportRect.right,
      };
    });
    expect(actionBounds.left).toBeGreaterThanOrEqual(actionBounds.viewportLeft);
    expect(actionBounds.right).toBeLessThanOrEqual(actionBounds.viewportRight);
  }

  await summary.click();
}

test.describe("Work in the shared shell", () => {
  test("reaches Questions and returns to Overview without changing g p", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/.vantage/work");
    await expect(
      page.getByRole("heading", { level: 1, name: "Work overview" }),
    ).toBeAttached();
    const pageNav = page.getByRole("navigation", {
      name: "Planning views",
    });
    const overviewLink = pageNav.getByRole("link", { name: "Overview" });
    const questionsLink = pageNav.getByRole("link", { name: "Questions" });
    await expect(overviewLink).toBeVisible();
    await expect(overviewLink).toHaveAttribute("aria-current", "page");
    await expect(questionsLink).toBeVisible();

    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Planning questions" }),
    ).toBeAttached();
    await expect(questionsLink).toHaveAttribute("aria-current", "page");
    await overviewLink.click();
    await expect(page).toHaveURL(/\/\.vantage\/work$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Work overview" }),
    ).toBeAttached();
    await expect(overviewLink).toHaveAttribute("aria-current", "page");
  });

  test("fits forty active tiles at desktop density and keeps details usable on phones", async ({
    page,
  }, testInfo) => {
    const count = 40;
    const terminalCount = 2;
    // These repository-specific stage words deliberately map to the shared
    // open/ready/built roles; they do not assert a universal stage sequence.
    const stages = [
      { name: "DESIGN", role: "open" },
      { name: "DECIDED", role: "ready" },
      { name: "BUILT", role: "built" },
      { name: "REVIEWING", role: "built" },
    ] as const;
    const config = {
      roadmaps: null,
      include: ["**/*.md"],
      exclude: [],
      max_file_bytes: 1048576,
      max_candidates: 5000,
      stages: {
        DESIGN: "open",
        DECIDED: "ready",
        BUILT: "built",
        REVIEWING: "built",
        SUPERSEDED: "done",
      },
    };
    const contentFor = (stage: string, title: string, next?: string) =>
      `---\nstage: ${stage}\ntitle: ${JSON.stringify(title)}${next ? `\nnext: ${JSON.stringify(next)}` : ""}\nstage-since: 2026-10-01T00:00:00Z\n---\n\n# ${title}\n`;
    const activeFiles = Array.from({ length: count }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      const stage = stages[Math.floor(index / 10)]!;
      const title =
        index === 1 || index === 38
          ? "A shared title used by two planning documents"
          : index % 5 === 0
            ? `Carry the saved planning boundary through work item ${number}`
            : [
                "Assess repository planning scope",
                "Review a dependency's saved claim",
                "Describe the next validation context",
                "Separate status from implementation evidence",
                "Keep an indexed handoff discoverable",
              ][index % 5];
      const next =
        index % 3 === 0
          ? "Recheck the scope against its design note and record any changed claim"
          : `Review saved stage and next-step evidence for item ${number}`;
      const path = `plans/work-item-${number}.md`;
      const content = contentFor(stage.name, title, next);
      const hash = createHash("sha256")
        .update(content, "utf8")
        .digest("hex")
        .slice(0, 32);
      return { kind: "file", path, hash, content };
    });
    const terminalFiles = Array.from({ length: terminalCount }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      const path = `plans/archived-${number}.md`;
      const content = contentFor(
        "SUPERSEDED",
        `Archived planning record ${number}`,
      );
      const hash = createHash("sha256")
        .update(content, "utf8")
        .digest("hex")
        .slice(0, 32);
      return { kind: "file", path, hash, content };
    });
    const files = [...activeFiles, ...terminalFiles];
    const candidateCount = count + terminalCount;
    const stream = [
      JSON.stringify({
        kind: "header",
        config,
        candidate_count: candidateCount,
        refused: false,
      }),
      ...files.map((file) => JSON.stringify(file)),
      JSON.stringify({ kind: "end", candidates: candidateCount }),
      "",
    ].join("\n");
    await page.route("**/api/planning/server-id", (route) =>
      route.fulfill({ json: { server_id: "work-overview-density" } }),
    );
    await page.route("**/api/planning/stream", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: stream,
      }),
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/.vantage/work");
    const cards = page.locator("[data-work-document]");
    await expect(cards).toHaveCount(count);
    await expect(page.getByTestId("work-counts")).toContainText(
      `${candidateCount} in applied snapshot`,
    );
    const stageSummary = page.getByRole("navigation", {
      name: "Stage count and jump summary",
    });
    for (const label of ["DESIGN", "DECIDED", "BUILT", "REVIEWING"]) {
      await expect(
        stageSummary.getByRole("link", {
          name: `Jump to ${label}: 10 matching of 10 applied documents`,
        }),
      ).toBeVisible();
    }
    const terminalAccess = stageSummary.getByRole("button", {
      name: `Terminal/reference ${terminalCount}`,
    });
    await expect(terminalAccess).toBeVisible();
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(
      page
        .locator('[data-work-document="plans/work-item-01.md"]')
        .getByRole("link", {
          name: "Carry the saved planning boundary through work item 01 — plans/work-item-01.md",
        }),
    ).toBeVisible();
    for (const [path, name] of [
      [
        "plans/work-item-02.md",
        "A shared title used by two planning documents",
      ],
      [
        "plans/work-item-39.md",
        "A shared title used by two planning documents",
      ],
    ]) {
      await expect(
        page.locator(`[data-work-document="${path}"] summary`),
      ).toHaveAttribute("aria-label", `Full details for ${name} — ${path}`);
    }
    const desktop = await page.evaluate(() => {
      const content = document.querySelector("[data-content-scroll]")!;
      const bounds = content.getBoundingClientRect();
      const cards = Array.from(
        document.querySelectorAll("[data-work-document]"),
      );
      const cardBounds = cards.map((card) => card.getBoundingClientRect());
      const outside = cardBounds.flatMap((rect, index) =>
        rect.top >= bounds.top && rect.bottom <= bounds.bottom
          ? []
          : [
              {
                path: cards[index]!.getAttribute("data-work-document"),
                top: rect.top,
                bottom: rect.bottom,
                viewportTop: bounds.top,
                viewportBottom: bounds.bottom,
              },
            ],
      );
      return {
        count: cards.length,
        allVisible: outside.length === 0,
        outside,
        firstTop: cardBounds[0]!.top,
        lastBottom: Math.max(...cardBounds.map((rect) => rect.bottom)),
        viewportTop: bounds.top,
        viewportBottom: bounds.bottom,
        scrollHeight: content.scrollHeight,
        clientHeight: content.clientHeight,
      };
    });
    console.log(
      `overview-density ${JSON.stringify({
        count: desktop.count,
        firstTop: desktop.firstTop,
        lastBottom: desktop.lastBottom,
        contentTop: desktop.viewportTop,
        contentBottom: desktop.viewportBottom,
        allVisible: desktop.allVisible,
      })}`,
    );
    await page.screenshot({
      path: testInfo.outputPath("work-overview-1440x900.png"),
    });
    expect(desktop).toMatchObject({ count, allVisible: true, outside: [] });
    for (const index of [0, 4, 35, 39]) {
      await expectDetailsActionsReachable(page, cards.nth(index));
    }
    const terminalSection = page.getByLabel("Terminal/reference stage group");
    const terminalToggle = terminalSection.getByRole("button");
    await expect(terminalToggle).toHaveAttribute("aria-expanded", "false");
    await expect(terminalToggle).toContainText("2 matching");
    await expect(terminalToggle).toContainText("2 applied");
    await expect(terminalToggle).toContainText("Show");
    await terminalAccess.click();
    await expect(terminalToggle).toHaveAttribute("aria-expanded", "true");
    await expect(terminalToggle).toBeVisible();

    await page.setViewportSize({ width: 375, height: 812 });
    await expect
      .poll(() =>
        page
          .getByTestId("sidebar")
          .evaluate((element) => element.getBoundingClientRect().right),
      )
      .toBeLessThanOrEqual(0);

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <= window.innerWidth &&
            document.querySelector("[data-content-scroll]")!.scrollWidth <=
              document.querySelector("[data-content-scroll]")!.clientWidth,
        ),
      )
      .toBe(true);
    for (const index of [0, 39]) {
      await expectDetailsActionsReachable(page, cards.nth(index));
    }
    const first = page.locator('[data-work-document="plans/work-item-01.md"]');
    await expect(first.locator("summary")).toHaveAttribute(
      "aria-label",
      "Full details for Carry the saved planning boundary through work item 01 — plans/work-item-01.md",
    );
    await first.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(first.locator("details")).toHaveAttribute("open", "");
    await expect(first.getByText("Stage:")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("work-overview-375x812.png"),
    });
  });

  test("keeps a 270-document inventory reachable through voluntary stage disclosures", async ({
    page,
  }, testInfo) => {
    // Match the supplied large-board capture's census, including the exact
    // CURRENT word left unmapped here rather than inventing its authority.
    const groups = [
      ["DESIGN", 78],
      ["SKETCH", 22],
      ["DECIDED", 20],
      ["BUILT", 36],
      ["CURRENT", 19],
      ["Missing stage", 66],
      ["Terminal/reference", 29],
    ] as const;
    const config = {
      roadmaps: null,
      include: ["**/*.md"],
      exclude: [],
      max_file_bytes: 1048576,
      max_candidates: 5000,
      stages: {
        DESIGN: "open",
        SKETCH: "open",
        DECIDED: "ready",
        BUILT: "built",
        SUPERSEDED: "done",
      },
    };
    const files = groups.flatMap(([label, count]) =>
      Array.from({ length: count }, (_, index) => {
        const word = label === "Terminal/reference" ? "SUPERSEDED" : label;
        const path = `plans/${label === "Missing stage" ? "missing" : word.toLowerCase()}-${String(index + 1).padStart(3, "0")}.md`;
        const title = `Review saved planning context ${path}`;
        const content = `---\n${label === "Missing stage" ? "status: draft" : `stage: ${word}`}\ntitle: ${JSON.stringify(title)}\nnext: Inspect the document's saved claim\n---\n\n# ${title}\n`;
        return {
          kind: "file",
          path,
          content,
          hash: createHash("sha256").update(content).digest("hex").slice(0, 32),
        };
      }),
    );
    const stream = [
      JSON.stringify({
        kind: "header",
        config,
        candidate_count: 270,
        refused: false,
      }),
      ...files.map((file) => JSON.stringify(file)),
      JSON.stringify({ kind: "end", candidates: 270 }),
      "",
    ].join("\n");
    await page.route("**/api/planning/server-id", (route) =>
      route.fulfill({ json: { server_id: "work-overview-large-disclosures" } }),
    );
    await page.route("**/api/planning/stream", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: stream,
      }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/.vantage/work");
    await expect(page.locator("[data-work-document]")).toHaveCount(241);
    await expect(page.getByTestId("work-counts")).toContainText(
      "270 in applied snapshot",
    );
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    const summary = page.getByRole("navigation", {
      name: "Stage count and jump summary",
    });
    for (const [label, count] of groups.slice(0, -1)) {
      await expect(
        summary.getByRole("link", {
          name: `Jump to ${label}: ${count} matching of ${count} applied documents`,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: `Collapse ${label} stage` })
        .click();
      await expect(
        page.getByRole("heading", { name: label, exact: true }),
      ).toBeVisible();
    }
    await expect(page.locator("[data-work-document]")).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("work-overview-270-collapsed-1440x900.png"),
    });
    for (const [label, lastPath] of [
      ["DESIGN", "plans/design-078.md"],
      ["Missing stage", "plans/missing-066.md"],
      ["CURRENT", "plans/current-019.md"],
    ]) {
      await summary
        .getByRole("link", { name: new RegExp(`^Jump to ${label}:`) })
        .click();
      const reveal = page.getByRole("button", {
        name: `Expand ${label} stage`,
      });
      await expect(reveal).toBeVisible();
      await reveal.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("button", { name: `Collapse ${label} stage` }),
      ).toHaveAttribute("aria-expanded", "true");
      const last = page.locator(`[data-work-document="${lastPath}"]`);
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeVisible();
      await expectDetailsActionsReachable(page, last);
      await page
        .getByRole("button", { name: `Collapse ${label} stage` })
        .click();
    }
    await summary
      .getByRole("button", { name: "Terminal/reference 29" })
      .click();
    const terminal = page.getByLabel("Terminal/reference stage group");
    await expect(terminal.getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const lastTerminal = page.locator(
      '[data-work-document="plans/superseded-029.md"]',
    );
    await lastTerminal.scrollIntoViewIfNeeded();
    await expect(lastTerminal).toBeVisible();
    await terminal.getByRole("button").click();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator("[data-content-scroll]").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({
      path: testInfo.outputPath("work-overview-270-collapsed-375x812.png"),
    });
    await summary
      .getByRole("link", { name: /^Jump to Missing stage:/ })
      .click();
    const missingReveal = page.getByRole("button", {
      name: "Expand Missing stage stage",
    });
    await expect(missingReveal).toBeVisible();
    await missingReveal.focus();
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("button", { name: "Collapse Missing stage stage" }),
    ).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({
      path: testInfo.outputPath("work-overview-270-expanded-375x812.png"),
    });
    const lastMissing = page.locator(
      '[data-work-document="plans/missing-066.md"]',
    );
    await expectDetailsActionsReachable(page, lastMissing);
    await page
      .getByRole("button", { name: "Expand all active stages" })
      .click();
    await expect(page.locator("[data-work-document]")).toHaveCount(241);
    await expect(
      page.getByRole("button", { name: "Expand all active stages" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          document.querySelector("[data-content-scroll]")!.scrollWidth <=
            document.querySelector("[data-content-scroll]")!.clientWidth,
      ),
    ).toBe(true);
  });

  test("stacks cards on a narrow viewport and keeps document links keyboard-operable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/.vantage/work");
    const first = page.locator("[data-work-document]").first();
    await expect(first).toBeVisible();
    const cards = page.locator("[data-work-document]");
    const firstBox = await first.boundingBox();
    const secondBox = await cards.nth(1).boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect(Math.abs(firstBox!.x - secondBox!.x)).toBeLessThan(2);
    await expect
      .poll(() =>
        page
          .locator("[data-content-scroll]")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      )
      .toBe(true);
    const documentLink = first.locator("a").first();
    await documentLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\.md$/);
  });

  test("keeps repository identity and controls reachable in a narrow Questions header", async ({
    page,
  }) => {
    const repo = "team #1 with a long repository name";
    const repoSegment = encodeURIComponent(repo);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/repos", (route) =>
      route.fulfill({ json: [{ name: repo, last_activity: null }] }),
    );
    await page.route(
      (url) => url.pathname.startsWith(`/api/r/${repoSegment}/`),
      async (route) => {
        const url = new URL(route.request().url());
        const apiPath = url.pathname.replace(`/api/r/${repoSegment}`, "/api");
        // Keep the backend response independent of the intercepted request's
        // lifetime; Playwright's route.fetch response can be disposed if the
        // page cancels that request during navigation.
        const request = route.request();
        const method = request.method();
        const requestHeaders = await request.allHeaders();
        delete requestHeaders.host;
        delete requestHeaders["content-length"];
        delete requestHeaders["accept-encoding"];
        const response = await fetch(
          `http://localhost:8101${apiPath}${url.search}`,
          {
            method,
            headers: requestHeaders,
            body:
              method === "GET" || method === "HEAD"
                ? undefined
                : await request.postDataBuffer(),
          },
        );
        const body = Buffer.from(await response.arrayBuffer());
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body,
        });
      },
    );
    await page.routeWebSocket(
      new RegExp(`/api/r/${repoSegment}/ws$`),
      () => {},
    );

    await page.goto(`/.vantage/planning/${repoSegment}`);
    const header = page.getByTestId("planning-header");
    const questionLink = header
      .getByRole("navigation", { name: "Planning views" })
      .getByRole("link", { name: "Questions" });
    await expect(questionLink).toHaveAttribute("aria-current", "page");
    await planningIndexReady(page, repo);
    await expect(page.getByRole("article").first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Needs you" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Folders: ${repo}` }),
    ).toBeVisible();
    await expect(
      header.getByRole("button", { name: "Toolbar actions" }),
    ).toBeVisible();
    await expect(header.locator(".hdr-repo")).toBeHidden();
    await expect(header.locator(".hdr-repo-separator")).toBeHidden();

    const collapsedRepo = header.getByRole("button", {
      name: `Folders: ${repo}`,
    });
    await expect(collapsedRepo).toBeVisible();
    await collapsedRepo.click();
    await expect(
      page.getByRole("menu", { name: "Folders" }).getByRole("menuitem", {
        name: repo,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: test
        .info()
        .outputPath("questions-narrow-settled-repository-menu-390x844.png"),
    });
    await page.keyboard.press("Escape");
    await header.getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(new RegExp(`\\.vantage/work/${repoSegment}$`));
    await expect(page.locator("[data-work-document]").first()).toBeVisible();
  });

  test("keeps the desktop Questions labels beside the sidebar after the index loads", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/.vantage/planning");
    await planningIndexReady(page);
    await expect(
      page.getByRole("heading", { name: "Questions" }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(10);
    await expect(
      page.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeVisible();

    const header = page.getByTestId("planning-header");
    const reviewAnswers = header.getByRole("button", {
      name: "Review answers",
      exact: true,
    });
    const copyAnswers = header.locator(
      'button:has([data-testid="pending-answers"])',
    );
    const copyMaintenance = header.getByRole("button", {
      name: /^Copy answers \+ maintenance /,
    });
    await expect(
      reviewAnswers.locator(".hdr-label:not([data-reserve])"),
    ).toHaveText("Review answers");
    await expect(
      copyAnswers.locator(".hdr-label:not([data-reserve])"),
    ).toHaveText("Copy answers");
    await expect(
      copyMaintenance.locator(".hdr-label:not([data-reserve])"),
    ).toHaveText("Copy answers + maintenance");
    await page.screenshot({
      path: test
        .info()
        .outputPath("questions-desktop-settled-copy-labels-1440x900.png"),
    });
  });

  test("keeps encoded multi-repository routes and document links encoded", async ({
    page,
  }) => {
    const repo = "team #1";
    const repoSegment = encodeURIComponent(repo);
    await page.route("**/api/repos", (route) =>
      route.fulfill({ json: [{ name: repo, last_activity: null }] }),
    );
    await page.route(
      (url) => url.pathname.startsWith(`/api/r/${repoSegment}/`),
      async (route) => {
        const url = new URL(route.request().url());
        const apiPath = url.pathname.replace(`/api/r/${repoSegment}`, "/api");
        const request = route.request();
        const method = request.method();
        const requestHeaders = await request.allHeaders();
        delete requestHeaders.host;
        delete requestHeaders["content-length"];
        delete requestHeaders["accept-encoding"];
        const response = await fetch(
          `http://localhost:8101${apiPath}${url.search}`,
          {
            method,
            headers: requestHeaders,
            body:
              method === "GET" || method === "HEAD"
                ? undefined
                : await request.postDataBuffer(),
          },
        );
        const body = Buffer.from(await response.arrayBuffer());
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body,
        });
      },
    );
    await page.routeWebSocket(/\/api\/r\/team%20%231\/ws$/, () => {});

    await page.goto(`/.vantage/work/${repoSegment}`);
    await expect(page).toHaveURL(new RegExp(`\\.vantage/work/${repoSegment}$`));
    const documentLink = page
      .locator("[data-work-document]")
      .first()
      .getByRole("link")
      .first();
    await expect(documentLink).toHaveAttribute(
      "href",
      `/${repoSegment}/plans/design.md`,
    );
  });

  test("keeps a static export's missing planning index unavailable", async ({
    page,
  }) => {
    const historyRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/git/planning-snapshots")) {
        historyRequests.push(request.url());
      }
    });
    await page.addInitScript(() => {
      Object.assign(window, { __VANTAGE_STATIC__: true });
    });

    await page.goto("/#/.vantage/work");
    await expect(
      page.getByRole("heading", { name: "Planning index unavailable" }),
    ).toBeVisible();
    await expect(
      page.getByText(/static export, which has no planning index/),
    ).toBeVisible();
    expect(historyRequests).toEqual([]);
  });
});
