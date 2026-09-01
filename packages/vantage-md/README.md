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

### Your own processor, Vantage's chain

`buildPipeline` returns the exact remark and rehype lists `renderMarkdown` and
the React viewer use, in the exact order — including the sanitiser schema, and
`rehypeSlug` after it, which is what keeps generated heading ids free of
`rehype-sanitize`'s `user-content-` prefix. Use it rather than assembling the
chain yourself; that is how a document ends up rendering differently in two
places.

```typescript
import { buildPipeline } from "vantage-md";

const { remarkPlugins, rehypePlugins } = buildPipeline({ bodyLineOffset: 0 });

const processor = unified()
  .use(remarkParse)
  .use(remarkPlugins)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypePlugins)
  .use(rehypeStringify);
```

Every plugin is toggleable (`gfm`, `math`, `highlight`, `sourceLines`,
`sanitize`), and `buildRemarkPlugins` returns the mdast half alone for tools
that parse without rendering. `rehypeSourceLines` is still exported on its own
if all you want is `data-source-line`.

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
| `vantage-md` | `renderMarkdown`, `buildPipeline`, `buildRemarkPlugins`, `rehypeSourceLines`, `scrollToLineAnchor`, `parseLineAnchor`, `parseFrontmatter`, `readVantageFrontmatter`, `sanitizeSchema` |
| `vantage-md/react` | `MarkdownViewer`, `useLineAnchor`, `MermaidDiagram`, `FrontmatterDisplay`, `DocumentStatusChip` + all core exports |
| `vantage-md/styles` | Line-anchor highlight CSS, plus the theme layer for the `data-vantage-*` directive attributes and the chrome chips (light + dark mode) |

## Features

- **Line anchors** — `data-source-line` attributes on every block element, with scroll/highlight utilities
- **GFM** — tables, strikethrough, task lists, autolinks
- **KaTeX** — `$$...$$` math, inline and block (single `$` is not a delimiter, so `$HOME` and `$100` stay literal)
- **Mermaid** — diagram rendering (client-side, lazy-loaded)
- **Syntax highlighting** — via highlight.js
- **Frontmatter** — YAML (`---`) and TOML (`+++`) parsing. A reserved `vantage:` key carries file-scoped chrome: `status-chip: true` makes `FrontmatterDisplay` render the document's `status:` as a chip above the metadata card, and the reserved key itself is never shown as a metadata row
- **Sanitization** — XSS-safe with allowlisted KaTeX/MathML elements
- **Dark mode** — all styles support `.dark` class

## License

MIT
