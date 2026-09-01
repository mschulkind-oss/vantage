/**
 * The canonical Vantage Markdown style guide.
 *
 * This string is the single source of truth for the conventions Vantage's
 * renderer expects. Two consumers read it:
 *
 * - the in-app "Style Guide for Agents" modal, which shows it with a copy
 *   button, and
 * - the `vantage-check style-guide` command, which prints it so an agent can
 *   fetch it without a human in the loop.
 *
 * Every rule stated here should be one a checker can enforce or a renderer
 * actually cares about — if a line is neither, it does not belong.
 */

export const STYLE_GUIDE = `## Markdown style guide (for Vantage viewer)

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
vantage:
  status-chip: true # show \`status\` as a chip above the metadata card
---
\`\`\`
- **Nothing may sit above the opening delimiter** — not a blank line, not an editorial comment, not a \`<!-- vantage: … -->\` directive. Frontmatter is recognised only at the very first byte of the file (in Vantage, on GitHub, and in every other reader), so one line above it turns the whole block into body text: a horizontal rule followed by a heading made of the raw keys, with every field lost. \`vantage-check\` reports it as \`frontmatter/not-at-top\`.
- **\`vantage:\` is Vantage's own reserved key.** It holds chrome that belongs to the file rather than to a section, it never shows up in the metadata card, and every other renderer ignores it. One key today: \`status-chip\`.
- **Prefer \`status-chip: true\`**, which shows the document's own \`status:\` and therefore cannot disagree with it. A literal \`status-chip: accepted\` is accepted too, but it is a second value that goes stale on its own — \`vantage-check\` reports the disagreement.
- The chip's vocabulary is \`status\`'s, exactly: \`draft | in-review | accepted | deprecated\`, lowercase. \`Draft\` renders no chip at all, silently.

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

### Vantage directives (optional, and Vantage-only)

Vantage reads a few styling hints from ordinary HTML comments. Every other renderer — GitHub included — drops them, so a document has to read exactly the same without them: directives decorate, they never carry meaning. One goes on a line of its own, with a blank line after it, and applies to the block that follows:

\`\`\`markdown
<!-- vantage: section tone=warning badge=stale -->

## Migration path

The steps below predate the rewrite.
\`\`\`

- **Three names**: \`section\` (the heading and everything under it), \`block\` (the one block after it), \`oq\` (one answerable Open Question).
- **The keys and values are a closed set**: \`tone\` = \`note | tip | important | warning | caution | muted\`; \`emphasis\` = \`strong | normal | quiet\`; \`badge\` = \`draft | stale | blocked | done | wip\`; \`collapsed\` = \`true | false\`. Name a *tone*, never a colour — the theme decides what a warning looks like, in light mode, in dark mode, and in print.
- **Use them sparingly.** One or two per document, on the sections that genuinely differ. A document where everything is toned says nothing, and a rainbow one is harder to read than a plain one.
- **Anything outside those sets is silently ignored** — nothing breaks, and nothing styles either. Run \`vantage-check\` on the document: the \`vantage/*\` rules are the only thing that will ever tell you a directive did nothing.
- **Always close the comment with \`-->\`.** Never \`--!>\`, and never leave it open: Markdown reads every line below an unclosed \`<!--\` as part of the comment, and the whole rest of the document vanishes from the page. For the same reason \`-->\` cannot appear *inside* a value — it ends the comment early and spills the remainder into the page as literal text.
- **In a list, indent the directive inside the item**, with blank lines around it (below). At the start of a line between two items it ends the list and starts a second one, which changes the numbering and the spacing in every renderer — the one thing a directive must never do.
- **A \`leaning\` restates the leaning; it is never "yes".** The one-click button in review mode files that text as a review comment, and the comment is all the agent reading it has — nobody remembers which button was clicked. \`leaning="Yes"\` beside a two-branch question is a support ticket.

\`\`\`markdown
1. **OQ-9: Queue position on re-entry.**

   <!-- vantage: oq id=OQ-9 leaning="Back of the queue — the fix might interact with what merged while it was out." -->

   _Leaning:_ Back of the queue.
\`\`\`

### Tables, task lists, and math
- **Tables**: Use standard markdown tables for structured comparisons and schemas.
- **Task lists**: Use \`- [ ]\` and \`- [x]\` for actionable checklists and status tracking.
- **LaTeX Math**: Use \`$$...$$\` for *all* KaTeX math — display blocks (\`$$\` alone on its own lines) and inline alike (\`$$E = mc^2$$\` mid-sentence).
  - Single dollars are **not** math delimiters: \`$HOME\` and \`$100\` stay literal, so prose and shell snippets are safe to write as-is.
`;
