# vantage-md

Markdown rendering pipeline with GitHub-style line anchors (`#L42`, `#L42-L50`), mermaid diagrams, KaTeX math, and syntax highlighting.

Extracted from [Vantage](https://github.com/mschulkind-oss/vantage), a markdown documentation viewer.

## Install

```bash
npm install vantage-md
```

## Usage

### Framework-agnostic: markdown string to HTML

```typescript
import { renderMarkdown } from "vantage-md";

const { html, frontmatter } = await renderMarkdown("# Hello\n\nSome **bold** text");
// html: '<h1 data-source-line="1">Hello</h1>\n<p data-source-line="3">Some <strong>bold</strong> text</p>'
```

Every rendered block element gets a `data-source-line` attribute, enabling GitHub-style line anchors.

### Options

All features are enabled by default. Disable what you don't need:

```typescript
const { html } = await renderMarkdown(content, {
  gfm: true,          // GFM tables, strikethrough, task lists
  math: true,         // KaTeX rendering
  highlight: true,    // Syntax highlighting
  sourceLines: true,  // data-source-line attributes
  sanitize: true,     // XSS sanitization
  frontmatter: true,  // Parse and strip YAML/TOML frontmatter
});
```

### Line anchors

Scroll to and highlight lines in rendered markdown:

```typescript
import { scrollToLineAnchor } from "vantage-md";
import "vantage-md/styles";

// Highlight lines 42-50 and scroll to them
const cleanup = scrollToLineAnchor(container, "#L42-L50");

// Remove highlights
cleanup?.();
```

### React component

```tsx
import { MarkdownViewer } from "vantage-md/react";
import "vantage-md/styles";

function Docs({ content, path }) {
  return (
    <MarkdownViewer
      content={content}
      currentPath={path}
      hash={window.location.hash}
      onNavigate={(path) => navigate(path)}
    />
  );
}
```

The React component includes mermaid diagram rendering (lazy-loaded), frontmatter display, and syntax highlighting out of the box.

### Rehype plugin (bring your own pipeline)

```typescript
import { rehypeSourceLines } from "vantage-md";

const processor = unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeSourceLines)  // adds data-source-line to block elements
  .use(rehypeStringify);
```

### Svelte / Vue / plain HTML

```svelte
<script>
  import { renderMarkdown } from "vantage-md";
  import "vantage-md/styles";

  let html = "";
  renderMarkdown(content).then((result) => (html = result.html));
</script>

{@html html}
```

## Exports

| Entry point | Description |
|-------------|-------------|
| `vantage-md` | `renderMarkdown`, `rehypeSourceLines`, `scrollToLineAnchor`, `parseLineAnchor`, `parseFrontmatter`, `sanitizeSchema` |
| `vantage-md/react` | `MarkdownViewer`, `useLineAnchor`, `MermaidDiagram`, `FrontmatterDisplay` + all core exports |
| `vantage-md/styles` | Line-anchor highlight CSS (light + dark mode) |

## Features

- **Line anchors** — `data-source-line` attributes on every block element, with scroll/highlight utilities
- **GFM** — tables, strikethrough, task lists, autolinks
- **KaTeX** — `$$...$$` math, inline and block (single `$` is not a delimiter, so `$HOME` and `$100` stay literal)
- **Mermaid** — diagram rendering (client-side, lazy-loaded)
- **Syntax highlighting** — via highlight.js
- **Frontmatter** — YAML (`---`) and TOML (`+++`) parsing
- **Sanitization** — XSS-safe with allowlisted KaTeX/MathML elements
- **Dark mode** — all styles support `.dark` class

## License

MIT
