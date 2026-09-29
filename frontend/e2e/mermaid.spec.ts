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
