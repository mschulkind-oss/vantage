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
- **Nothing may sit above the opening delimiter** — not a blank line, not an editorial comment, not a \`<!-- vantage: … -->\` directive. Frontmatter is recognized only at the very first byte of the file (in Vantage, on GitHub, and in every other reader), so one line above it turns the whole block into body text: a horizontal rule followed by a heading made of the raw keys, with every field lost. \`vantage-check\` reports it as \`frontmatter/not-at-top\`.
- **\`vantage:\` is Vantage's own reserved key.** It holds chrome that belongs to the file rather than to a section, it never shows up in the metadata card, and every other renderer ignores it. One key today: \`status-chip\`.
- **Prefer \`status-chip: true\`**, which shows the document's own \`status:\` and therefore cannot disagree with it. A literal \`status-chip: accepted\` is accepted too, but it is a second value that goes stale on its own — \`vantage-check\` reports the disagreement.
- The chip's vocabulary is \`status\`'s, exactly: \`draft | in-review | accepted | deprecated\`, lowercase. \`Draft\` renders no chip at all, silently.

### Planning documents: \`stage\`, \`next\`, \`depends-on\`
- **Vantage reads a repository's plans as a set.** A document whose frontmatter has \`status\` or \`stage\`, or that carries an \`oq\` or \`question\` directive, is a *planning document*, and Vantage shows its state (status, stage, open questions) in a badge beside every link to it. So write each fact once, in the document it belongs to, and link to it everywhere else: a copied status or count is the one that goes stale.
- Three top-level keys beside \`status\` hold the rest of a document's planning state. They are facts about the file, so they sit at the top level, never under \`vantage:\`:
\`\`\`yaml
---
title: "Payload bootstrap"
status: in-review
stage: DESIGN
next: "Rule OQ-B2 \u2014 the install step waits on it"
depends-on:
  - pypi-distribution.md
  - ../plans/rollout.md#OQ-R1
---
\`\`\`
- **\`stage\` is one word from the repository's own vocabulary**, the words \`[planning.stages]\` declares (below), spelled exactly as declared: matching is case-sensitive, so \`Decided\` is not \`DECIDED\`. \`vantage-check\` reports a word outside them as \`planning/stage-vocabulary\`.
- **Frontmatter is the stage's one home.** Do not repeat the word in a prose \`**Status:**\` line: that is a second copy, and no tool can read or check it. Keep the prose line, where a document has one, for the date and the why.
- **\`next\` is the next step, on one line of plain text.** A bare \`OQ-\` id in it links to this document's question of that id, so name the question rather than paraphrasing it.
- **\`depends-on\` lists what the document waits on**: relative paths, resolved like links, each optionally ending in \`#OQ-\u2026\` to name one question. A single path may stand on its own. A target that does not exist, lies outside the repository, or does not contain the id is an error (\`planning/depends-on-missing\`).
- **Never a \`priority\` key.** A priority only means something relative to the others, so it lives in an ordered list, a roadmap, and not in each document.
- **A roadmap is ordered links.** Every \`roadmap.md\` Vantage reads is a roadmap, in any directory, unless \`[planning]\` lists the roadmaps instead; one in a hidden directory, matched by \`.vantageignore\`, or ruled out by \`include\` or \`exclude\` is not read, and so is not a roadmap. Each entry is a link to a document or a question, then a one-clause reason for its place; the badge beside the link carries the rest, so never copy a status, a stage or a count into it. Prose beneath an entry holds only what has no other home, such as what would unblock it. A bare link to a document *routes* every question in it into the roadmap's order, and a link to one question's \`#OQ-\u2026\` anchor routes that question; a link to any other heading routes nothing. A question is routed when any roadmap routes it, and with \`planning/unrouted\` turned on, \`vantage-check\` reports an open question no roadmap routes.
- **\`[planning]\` in \`.vantage.toml\`** says which files are read, which of them are roadmaps, and what each stage word means. Every key is optional:
\`\`\`toml
[planning]
# roadmap = ["roadmap.md", "docs/plans/roadmap.md"]  # absent: every roadmap.md
exclude = ["docs/gallery/**"]   # gitignore syntax; every .md is included by default

[planning.stages]               # each word maps to open | ready | built | done
DESIGN = "open"
DECIDED = "ready"
BUILT = "built"
SUPERSEDED = "done"
\`\`\`
- **Each stage word maps to one of four roles**, which is what the word means to Vantage: \`open\` is still being decided, \`ready\` is decided and not built, \`built\` is built, and \`done\` is no longer a live proposal, so its questions leave every list of what needs a ruling. \`vantage-check index\` prints those lists.
- **Never change \`target\`.** A \`target = "X.Y"\` line at the top of \`.vantage.toml\` names the oldest Vantage release the repository's readers use, and only a human edits it. A \`vantage-check\` older than the target refuses to run and names the release it needs: run that release, and leave the target as it is.

### Mermaid diagrams
- Use \`\`\`mermaid code blocks for flowcharts, sequence diagrams, and architecture diagrams. Vantage provides interactive zoom, pan, dark/light theme adaptation, and SVG export.
- **Quote labels with special characters**: Always quote node labels containing parentheses, brackets, or colons to prevent syntax errors:
\`\`\`mermaid
flowchart TD
    client["Client (React SPA)"] -->|WebSocket| srv["Vantage Server (Go)"]
    srv --> git["Git CLI (git diff)"]
\`\`\`

### Inline SVG (needs Vantage 0.8 or later)
- **Inline \`<svg>\` is a capability, not notation: it needs Vantage 0.8 or later.** GitHub, every other renderer and Vantage before 0.8 drop the drawing and leave the words of its \`<text>\` elements behind as loose text, so keep \`<text>\` to short labels a reader can bear to see as loose words.
- **Name the drawing with \`aria-label\` on the \`<svg>\`, never with \`<title>\` or \`<desc>\`.** Vantage 0.8 removes both, so they name nothing there, and every other reader prints them: Vantage before 0.8 as loose words, GitHub with the tags.
- **Pair every inline drawing with a fallback block**: a \`<!-- vantage: fallback -->\` directive above the block that stands in for the drawing. Vantage 0.8 and later never show that block; every other reader drops the comment and shows it. Say what the drawing shows and that it needs Vantage 0.8 or later, and link a copy of it committed as a file where there is one (\`[the drawing](diagram.svg)\`). The block is a paragraph, a list, a quote, a code block, a table or a \`<div>\`; Vantage shows a raw \`<img>\`, \`<figure>\` or \`<details>\` there, so wrap one in a \`<div>\`.
- **Wrap the drawing in a \`<div>\` on a line of its own, with no blank line anywhere inside it**, and give it a \`width\`, a \`height\` and a \`viewBox\`. Paint with \`fill\`/\`stroke\` set to \`currentColor\` or a hex color, so it reads in light and dark mode.
\`\`\`markdown
<div>
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40" role="img" aria-label="Two boxes joined by an arrow">
  <rect x="1" y="1" width="40" height="38" fill="none" stroke="currentColor"/>
  <path d="M45 20 H75 M68 14 L75 20 L68 26" fill="none" stroke="currentColor"/>
  <rect x="79" y="1" width="40" height="38" fill="none" stroke="currentColor"/>
</svg>
</div>

<!-- vantage: fallback -->

Two boxes joined by an arrow. This drawing needs Vantage 0.8 or later.
\`\`\`
- **For a document read mostly on GitHub**, commit the drawing as a file and embed it with \`![alt](diagram.svg)\` instead, which every renderer shows.

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

- **Five names**: \`section\` (the heading and everything under it), \`block\` (the one block after it), \`oq\` (one open Open Question, which review mode offers to answer), \`question\` (one blocked or answered Open Question, which nothing offers to answer), \`fallback\` (the one block after it, which Vantage 0.8 and later never show; see Inline SVG above). \`fallback\` takes no keys, and withholds only a paragraph, a list, a quote, a code block, a table, a rule or a \`<div>\`, never a heading.
- **The keys and values are a closed set**: \`tone\` = \`note | tip | important | warning | caution | muted\`; \`emphasis\` = \`strong | normal | quiet\`; \`badge\` = \`draft | stale | blocked | done | wip\`; \`collapsed\` = \`true | false\`. Name a *tone*, never a color — the theme decides what a warning looks like, in light mode, in dark mode, and in print.
- **Use them sparingly.** One or two per document, on the sections that genuinely differ. A document where everything is toned says nothing, and a rainbow one is harder to read than a plain one.
- **Anything outside those sets is silently ignored** — nothing breaks, and nothing styles either. Run \`vantage-check\` on the document: the \`vantage/*\` rules are the only thing that will ever tell you a directive did nothing.
- **Always close the comment with \`-->\`.** Never \`--!>\`, and never leave it open: Markdown reads every line below an unclosed \`<!--\` as part of the comment, and the whole rest of the document vanishes from the page. For the same reason \`-->\` cannot appear *inside* a value — it ends the comment early and spills the remainder into the page as literal text.
- **In a list, indent the directive inside the item**, with blank lines around it (below). At the start of a line between two items it ends the list and starts a second one, which changes the numbering and the spacing in every renderer — the one thing a directive must never do.
- **A question's id, on \`oq\` and \`question\` alike, is \`OQ-\` then an optional short uppercase prefix then digits** — \`OQ-9\`, \`OQ-TP6\`, \`OQ-A03\`. The prefix is what keeps ids distinct once one document references another's questions, so use one in both whenever they cross-reference. \`vantage-check\` reports anything outside that shape as \`vantage/oq-id-format\`, and the same id twice in one document as \`vantage/oq-id-duplicate\` — both are silent otherwise, because the id becomes the block's anchor and a refused or duplicated one simply goes nowhere.
- **A reference is a link, or it is a lie.** An \`OQ-\` id, a \`\u00a7N\` section number and a filename all read like pointers, and written as bare prose none of them can be followed or checked — which is exactly why a stale one is never caught. Link the question to its anchor (\`[OQ-4](#OQ-4)\`, or the Decision Ledger once it is compacted), the section to its heading, the filename to the file. \`vantage-check\` reports all three (\`ref/*\`) as errors, and checks that the link points at the thing the reference names rather than merely at something. Writing a specimen rather than a reference? Put it in a fenced block, which the rules never read.
- **Every open question (\u{1F4AC}) with a stated leaning gets an \`oq\` directive.** The convention's prose — the emoji, the \`OQ-N\` id, the \`_Leaning:_\` line, the fill-in \`**Answer:**\` — produces no button on its own. Writing the convention and stopping there is the most common way this feature goes missing: the questions look complete, review mode is on, and there is nothing to click. **\`vantage-check\` reports it as an error** (\`vantage/oq-missing\`), because a question awaiting a ruling that the reviewer cannot file is not a style preference. An open question with no leaning yet takes \`oq\` too, without \`leaning\`, so the planning index still counts it; until it states one, its button files the literal text "Take the stated leaning."
- **A blocked (\u{1F512}) or answered (\u2705) question gets a \`question\` directive instead**: \`<!-- vantage: question id=OQ-10 -->\`, with an \`id\` and nothing else (below). Mark a question \u{1F512} if it is blocked on something upstream and cannot be answered yet, or \u2705 once it is decided, and change its directive's name in the same edit. \`question\` declares the same question with the same anchor and offers no button, since a blocked question cannot be answered yet and a decided one has been ruled. Never leave \`oq\` on one: every Vantage before 0.8 offers the one-click button on every \`oq\`, and on a question with no leaning it files the literal text "Take the stated leaning." \`vantage-check\` reports the wrong name either way (\`vantage/question-name\`). Keep the directive in every state: a question without one does not exist to Vantage's planning index (its model of a repository's plans), so nothing counts it, badges it or lists it as waiting. The directive goes when the question is compacted into the Decision Ledger, and not before.
- **Outside a list, the directive goes above the question's title.** A question that is not a list item is the one block its directive lands on, so a directive below the bold title lands on the block after it, which carries no marker, and every viewer reads the question as open. \`vantage-check\` reports that as \`vantage/question-name\` too.
- **A \`leaning\` restates the leaning; it is never "yes".** The one-click button in review mode files that text as a review comment, and the comment is all the agent reading it has — nobody remembers which button was clicked. \`leaning="Yes"\` beside a two-branch question is a support ticket.
- **Put the question in its bold title, and keep the text below it short.** The planning page shows each question as a card that leads with the title and shows only the first few lines of the rest, so a question buried in a paragraph of background is one the reviewer has to dig for. Say in the title what is being decided, write beneath it only what a ruling needs, and keep background, history and cross-references in the document's own sections, linked from the question. \`vantage-check\` warns when a question's text, not counting its \`_Leaning:_\` paragraph and its \`**Answer:**\`, runs past 120 words (\`planning/question-length\`); a repository can raise the limit with \`max-words\`, or turn the rule off, under \`[check.rules]\`.

\`\`\`markdown
1. **OQ-9: Queue position on re-entry.**

   <!-- vantage: oq id=OQ-9 leaning="Back of the queue — the fix might interact with what merged while it was out." -->

   _Leaning:_ Back of the queue.

2. \u{1F512} **OQ-10: The retry budget.**

   <!-- vantage: question id=OQ-10 -->

   Waits on the load test, so there is no leaning to state yet.
\`\`\`

### Tables, task lists, and math
- **Tables**: Use standard markdown tables for structured comparisons and schemas.
- **Task lists**: Use \`- [ ]\` and \`- [x]\` for actionable checklists and status tracking.
- **LaTeX Math**: Use \`$$...$$\` for *all* KaTeX math — display blocks (\`$$\` alone on its own lines) and inline alike (\`$$E = mc^2$$\` mid-sentence).
  - Single dollars are **not** math delimiters: \`$HOME\` and \`$100\` stay literal, so prose and shell snippets are safe to write as-is.
`;
