/**
 * The canonical Markdown style guide for documents viewed in Vantage.
 *
 * This is the single source of truth for the conventions agents are told when
 * writing Vantage documents. It is shared by three consumers: the frontend
 * modal (`StyleGuideModal`), the published `vantage-md` package, and the
 * `vantage-check` CLI's `style-guide` command. Editing it here updates all of
 * them — do not fork a copy anywhere.
 */
export const STYLE_GUIDE_SNIPPET = `## Markdown style guide (for Vantage viewer)

When writing or updating markdown documents that will be viewed in Vantage, follow these conventions:

### Structure
- Use headings (## and ###) to organize content — they become navigable outline anchors.
- Keep paragraphs focused and concise. Break up dense text with subheadings, lists, or tables.

### Links and cross-references
- **Relative paths only**: Always link relative to the *current file's directory*:
  - Sibling in same folder: \`[Other Doc](./other-doc.md)\` or \`[Other Doc](other-doc.md)\`
  - Subdirectory: \`[Design Doc](./design/auth.md)\`
  - Parent / sibling folder: \`[Overview](../overview.md)\` or \`[Spec](../specs/api.md)\`
- **Never use leading slashes**:
  - ❌ \`[Doc](/docs/guide.md)\` (breaks web routing and multi-repo scoping)
  - ✅ \`[Doc](../docs/guide.md)\` or \`[Doc](./guide.md)\`
- **Never use absolute filesystem paths or URI schemes**:
  - ❌ \`file:///workspace/docs/guide.md\`, \`/workspace/docs/guide.md\`, \`C:\\...\`
  - ✅ \`[Doc](./guide.md)\` or \`[Doc](../guide.md)\`
- **Always include the file extension**: Use \`.md\`, \`.ts\`, \`.go\`, etc. (e.g. \`[Model](model.go)\`).
- **Line anchors and ranges**:
  - Link to specific lines: \`[Handler](../server/api.go#L42)\` or \`[Range](../server/api.go#L42-L58)\`
  - Same-file line anchor: \`[See lines](#L10-L25)\`
  - Vantage scrolls to and highlights the target lines.
- **Section anchors**:
  - Same doc: \`[Usage](#usage)\`
  - Cross-doc: \`[Architecture](../overview.md#system-architecture)\`
  - Anchor slugs are lowercase, hyphenated, and punctuation-stripped.
- **Backticks in links**: Place backticks inside the link label, not around the markdown link syntax:
  - ✅ \`[\`config.json\`](./config.json)\` or \`[config.json](./config.json)\`
  - ❌ \`\`[config.json](./config.json)\`\`

### Frontmatter (Metadata)
- Include structured metadata at the very top of docs delimited by \`---\` (YAML) or \`+++\` (TOML). Vantage renders this as a metadata card:
\`\`\`yaml
---
title: "Feature Specification"
author: "Agent"
date: 2026-08-15
status: in-review # draft | in-review | accepted | deprecated
tags: [architecture, backend, api]
summary: "Brief description of the document purpose."
---
\`\`\`

### Mermaid diagrams
- Use \`\`\`mermaid code blocks for flowcharts, sequence diagrams, and architecture diagrams. Vantage provides interactive zoom, pan, dark/light theme adaptation, and SVG export.
- **Quote labels with special characters**: Always quote node labels containing parentheses, brackets, or colons to prevent syntax errors:
\`\`\`mermaid
flowchart TD
    client["Client (React SPA)"] -->|WebSocket| srv["Vantage Server (Go)"]
    srv --> git["Git CLI (git diff)"]
\`\`\`

### Code blocks and diffs
- Always tag fenced code blocks with language identifiers (\`ts\`, \`go\`, \`python\`, \`bash\`, \`json\`, \`yaml\`, \`diff\`, \`sql\`, etc.) for syntax highlighting.
- For proposed code modifications, use \`\`\`diff blocks with \`+\` and \`-\` prefixes:
\`\`\`diff
-const oldUrl = "/api/v1";
+const newUrl = "/api/v2";
\`\`\`

### Callouts and alerts
- Use GitHub-style blockquote callouts for notes, tips, and warnings:
> [!NOTE]
> Background context or helpful explanation.

> [!TIP]
> Best practice advice or optimization suggestions.

> [!IMPORTANT]
> Key requirements or crucial information.

> [!WARNING]
> Urgent caution, breaking changes, or potential pitfalls.

> [!CAUTION]
> High-risk actions that could cause data loss or security issues.

### Tables, task lists, and math
- **Tables**: Use standard markdown tables for structured comparisons and schemas.
- **Task lists**: Use \`- [ ]\` and \`- [x]\` for actionable checklists and status tracking.
- **LaTeX Math**: Use \`$$...$$\` for *all* KaTeX math — display blocks (\`$$\` alone on its own lines) and inline alike (\`$$E = mc^2$$\` mid-sentence).
  - Single dollars are **not** math delimiters: \`$HOME\` and \`$100\` stay literal, so prose and shell snippets are safe to write as-is.
`;
