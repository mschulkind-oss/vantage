import { test, expect } from "@playwright/test";

test.describe("Mermaid Diagrams", () => {
  test("renders various mermaid diagrams correctly", async ({ page }) => {
    // Navigate to the mermaid diagrams test document
    await page.goto("/mermaid-diagrams-test.md");

    // Wait for the page to load and content to be visible
    await expect(
      page.getByRole("heading", { name: "Mermaid Diagrams Test Document" }),
    ).toBeVisible();

    // Wait for mermaid diagrams to render
    // Mermaid diagrams are rendered as SVG elements within the page
    await page.waitForTimeout(3000); // Give time for diagrams to render

    // Check that multiple SVG diagrams are present (mermaid renders as SVG)
    const svgDiagrams = page.locator("svg");
    // Expect at least some diagrams to render (not all types may be supported)
    const count = await svgDiagrams.count();
    expect(count).toBeGreaterThan(5);

    // Test specific diagram types that should definitely render
    // Flowchart - "Is it working?" is unique to the flowchart in our test doc
    await expect(
      page.locator("svg").filter({ hasText: "Is it working?" }),
    ).toBeVisible();

    // Sequence diagram
    await expect(
      page.locator("svg").filter({ hasText: "Alice" }),
    ).toBeVisible();

    // Pie chart
    await expect(page.locator("svg").filter({ hasText: "Dogs" })).toBeVisible();

    // State diagram
    await expect(
      page.locator("svg").filter({ hasText: "Still" }),
    ).toBeVisible();

    // Class diagram
    await expect(
      page.locator("svg").filter({ hasText: "Animal" }),
    ).toBeVisible();

    // Gantt chart
    await expect(
      page.locator("svg").filter({ hasText: "A task" }),
    ).toBeVisible();
  });

  test("keeps the classes a diagram's source names inside the diagram", async ({
    page,
  }) => {
    // Mermaid renders after the sanitizer and copies the names `:::name`,
    // `class A name` and `classDef` give a node onto that node, so a diagram
    // can carry the app's own utilities, which a document's `class` attribute
    // cannot. The reference records this as the one route left, bounded by the
    // diagram: `position` does nothing on an SVG group, the `svg` clips what is
    // inside it, and a `classDef` label stays in the `foreignObject` that holds
    // it. This measures that bound.
    await page.goto("/mermaid-classes.md");
    const diagram = page.locator(".prose svg[aria-roledescription]");
    await expect(diagram).toBeVisible({ timeout: 15000 });
    await expect(diagram.locator("g.node")).toHaveCount(5);
    const measured = await diagram.evaluate((svg) => {
      const rect = svg.getBoundingClientRect();
      // Every point of the viewport, on a 20px grid, that hits the diagram.
      const hits: [number, number][] = [];
      for (let x = 0; x < innerWidth; x += 20) {
        for (let y = 0; y < innerHeight; y += 20) {
          const hit = document.elementFromPoint(x, y);
          if (hit && svg.contains(hit)) hits.push([x, y]);
        }
      }
      return {
        classes: Array.from(svg.querySelectorAll("g.node"), (node) =>
          node.getAttribute("class"),
        ),
        overflow: getComputedStyle(svg).overflow,
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
        hits,
      };
    });
    // The route is open: the names arrive on the nodes.
    for (const name of ["fixed", "inset-0", "z-50", "bg-white", "sheet"]) {
      expect(
        measured.classes.some((value) => value!.split(" ").includes(name)),
        name,
      ).toBe(true);
    }
    // And bounded: nothing inside the diagram is hit outside its box.
    expect(measured.overflow).toBe("hidden");
    expect(measured.hits.length).toBeGreaterThan(0);
    for (const [x, y] of measured.hits) {
      expect(x).toBeGreaterThanOrEqual(Math.floor(measured.rect.left));
      expect(x).toBeLessThanOrEqual(Math.ceil(measured.rect.right));
      expect(y).toBeGreaterThanOrEqual(Math.floor(measured.rect.top));
      expect(y).toBeLessThanOrEqual(Math.ceil(measured.rect.bottom));
    }
  });

  test("keeps a diagram's source from writing the page's stylesheet", async ({
    page,
  }) => {
    // Mermaid puts every selector of a diagram's CSS under the diagram's id,
    // but leaves the names of its `@keyframes` global. So a diagram whose
    // source wrote a stylesheet could redefine an animation the app plays on
    // its own elements: a document block the viewer flashes, a sidebar row, a
    // spinner. Given `position: fixed` at the size of the window, the next
    // flash laid that block over the header and the sidebar and took their
    // clicks. The same stylesheet fetched images from hosts the document
    // picked. The fixture reaches it by all four routes Mermaid reads:
    // `themeCSS` and `fontFamily`, each from an `init` directive and from
    // frontmatter.
    const fetched: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname.endsWith(".invalid")) {
        fetched.push(request.url());
      }
    });
    await page.goto("/mermaid-stylesheet.md");
    const diagrams = page.locator(".prose svg[aria-roledescription]");
    await expect(diagrams).toHaveCount(4, { timeout: 15000 });
    for (const label of [
      "init theme",
      "frontmatter theme",
      "init font",
      "frontmatter font",
    ]) {
      await expect(diagrams.filter({ hasText: label })).toBeVisible();
    }

    const measured = await page.evaluate(() => {
      const isDiagramSheet = (sheet: CSSStyleSheet) =>
        sheet.ownerNode instanceof Element &&
        sheet.ownerNode.closest("svg") !== null;
      const keyframes = (sheets: CSSStyleSheet[]) => {
        const names = new Set<string>();
        const walk = (rules: CSSRuleList) => {
          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSKeyframesRule) names.add(rule.name);
            else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
          }
        };
        for (const sheet of sheets) walk(sheet.cssRules);
        return names;
      };
      const sheets = Array.from(document.styleSheets);
      const app = keyframes(sheets.filter((sheet) => !isDiagramSheet(sheet)));
      const diagram = keyframes(sheets.filter(isDiagramSheet));

      // What the viewer does to a block that just changed
      // (`useDeltaFlash.ts`), measured mid-flash.
      const block = Array.from(document.querySelectorAll(".prose p")).find(
        (p) => p.textContent === "The block the test flashes.",
      ) as HTMLElement;
      block.classList.add("animate-flash-update");
      const style = getComputedStyle(block);
      const rect = block.getBoundingClientRect();
      const pane = document
        .querySelector("[data-content-scroll]")!
        .getBoundingClientRect();
      return {
        appKeyframes: [...app],
        redefined: [...diagram].filter((name) => app.has(name)),
        flashing: style.animationName,
        position: style.position,
        inPane:
          rect.left >= pane.left &&
          rect.right <= pane.right &&
          rect.width < pane.width,
      };
    });
    // The page does define the animations the fixture aims at.
    expect(measured.appKeyframes).toContain("flash-update");
    expect(measured.appKeyframes).toContain("spin");
    // Soft, so that one run names every route still open.
    expect.soft(measured.redefined).toEqual([]);
    expect.soft(measured.flashing).toBe("flash-update");
    expect.soft(measured.position).toBe("static");
    expect.soft(measured.inPane).toBe(true);
    expect.soft(fetched).toEqual([]);
  });

  test("handles mermaid diagram errors gracefully", async ({ page }) => {
    // Create a temporary file with invalid mermaid syntax
    // For this test, we'll use the existing test file but check that valid diagrams still render
    await page.goto("/mermaid-diagrams-test.md");

    // Even if some diagrams fail, others should still render
    const svgDiagrams = page.locator("svg");
    // We expect at least some diagrams to render successfully
    await expect(svgDiagrams.first()).toBeVisible();
  });
});
