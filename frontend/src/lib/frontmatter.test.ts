/**
 * The frontmatter parser — the one in `packages/vantage-md`, which is the parser
 * both viewers, `renderMarkdown` and the CLI checker actually use.
 *
 * These cases were written against a second copy of the parser that used to live
 * beside this file, imported by nothing but this test. The copy is gone; the
 * cases are not, so they now assert against the real thing. Anything that
 * special-cases a frontmatter key has to land in the package, or the suite goes
 * green while the viewer renders the old behaviour.
 */
import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "vantage-md";

describe("parseFrontmatter", () => {
  describe("YAML frontmatter (---)", () => {
    it("parses frontmatter from content", () => {
      const content = `---
title: My Article
author: John Doe
---
# Content

This is the body.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({
        title: "My Article",
        author: "John Doe",
      });
      expect(result.body).toBe(`# Content

This is the body.`);
      expect(result.format).toBe("yaml");
    });

    it("handles content without frontmatter", () => {
      const content = "# Hello World\nNo frontmatter here.";
      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
      expect(result.format).toBe("none");
    });

    it("handles arrays in frontmatter", () => {
      const content = `---
tags:
  - react
  - typescript
  - testing
---
# Content`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.tags).toEqual([
        "react",
        "typescript",
        "testing",
      ]);
    });

    it("handles nested objects", () => {
      const content = `---
meta:
  description: A test
  keywords:
    - a
    - b
---
Body`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.meta).toEqual({
        description: "A test",
        keywords: ["a", "b"],
      });
    });

    it("handles boolean values", () => {
      const content = `---
draft: true
published: false
---
Body`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.draft).toBe(true);
      expect(result.frontmatter.published).toBe(false);
    });

    it("handles number values", () => {
      const content = `---
order: 42
version: 1.5
---
Body`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.order).toBe(42);
      expect(result.frontmatter.version).toBe(1.5);
    });

    it("returns original content if frontmatter is malformed", () => {
      const content = `---
this is not valid yaml: [unclosed
---
Body`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
      expect(result.format).toBe("none");
    });

    it("handles content starting with --- but no closing delimiter", () => {
      const content = `---
title: Incomplete
No closing delimiter here`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
    });

    it("handles empty frontmatter", () => {
      const content = `---
---
# Content`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe("# Content");
    });
  });

  describe("TOML frontmatter (+++)", () => {
    it("parses basic TOML frontmatter", () => {
      const content = `+++
title = "My Zola Post"
date = 2024-03-15
draft = false
+++
# Content

This is the body.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.title).toBe("My Zola Post");
      expect(result.frontmatter.draft).toBe(false);
      expect(result.format).toBe("toml");
      expect(result.body).toBe(`# Content

This is the body.`);
    });

    it("parses Zola taxonomies", () => {
      const content = `+++
title = "Tagged Post"

[taxonomies]
tags = ["rust", "web", "zola"]
categories = ["tutorial"]
+++
Body`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.title).toBe("Tagged Post");
      expect(result.frontmatter.taxonomies).toEqual({
        tags: ["rust", "web", "zola"],
        categories: ["tutorial"],
      });
      expect(result.format).toBe("toml");
    });

    it("parses Zola extra section", () => {
      const content = `+++
title = "Post with extras"

[extra]
author = "Jane"
series = "Getting Started"
+++
Body`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.extra).toEqual({
        author: "Jane",
        series: "Getting Started",
      });
    });

    it("parses full Zola page frontmatter", () => {
      const content = `+++
title = "Complete Page"
description = "A full example"
date = 2024-06-01
updated = 2024-06-15
slug = "complete-page"
weight = 10
draft = false
template = "page.html"

[taxonomies]
tags = ["example"]

[extra]
lead = "This is the lead text"
+++
# Complete Page`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter.title).toBe("Complete Page");
      expect(result.frontmatter.description).toBe("A full example");
      expect(result.frontmatter.slug).toBe("complete-page");
      expect(result.frontmatter.weight).toBe(10);
      expect(result.frontmatter.draft).toBe(false);
      expect(result.frontmatter.template).toBe("page.html");
      expect(result.frontmatter.taxonomies).toEqual({
        tags: ["example"],
      });
      expect(result.frontmatter.extra).toEqual({
        lead: "This is the lead text",
      });
    });

    it("handles content starting with +++ but no closing delimiter", () => {
      const content = `+++
title = "Incomplete"
No closing delimiter here`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
      expect(result.format).toBe("none");
    });

    it("returns original content if TOML is malformed", () => {
      const content = `+++
this is not valid toml [[[
+++
Body`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
      expect(result.format).toBe("none");
    });

    it("handles empty TOML frontmatter", () => {
      const content = `+++
+++
# Content`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe("# Content");
    });
  });
});
