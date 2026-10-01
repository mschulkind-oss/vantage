/**
 * The canonical Vantage Markdown style guide.
 *
 * This string is the single source of truth for the conventions Vantage's
 * renderer expects. It reaches readers three ways:
 *
 * - the in-app "Style Guide for Agents" modal, which shows it with a copy
 *   button,
 * - the `vantage-check style-guide` command, which prints it so an agent can
 *   fetch it without a human in the loop, and
 * - this package's own export, for anyone who renders with `vantage-md`.
 *
 * How the CLI serves it, and why there is one copy: docs/reference/agent-cli.md
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
- **Vantage reads a repository's plans as a set.** A document whose frontmatter has \`status\` or \`stage\`, or that carries a \`question\` directive (or an \`oq\`, the name it replaces), is a *planning document*, and Vantage shows its state (status, stage, open questions) in a badge beside every link to it. So write each fact once, in the document it belongs to, and link to it everywhere else: a copied status or count is the one that goes stale.
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

- **Four names to write**: \`section\` (the heading and everything under it), \`block\` (the one block after it), \`question\` (one Open Question, in any state; see Open questions below), \`fallback\` (the one block after it, which Vantage 0.8 and later never show; see Inline SVG above). \`fallback\` takes no keys, and withholds only a paragraph, a list, a quote, a code block, a table, a rule or a \`<div>\`, never a heading. A fifth, \`oq\`, is the name \`question\` replaces (below).
- **The keys and values are a closed set**: \`tone\` = \`note | tip | important | warning | caution | muted\`; \`emphasis\` = \`strong | normal | quiet\`; \`badge\` = \`draft | stale | blocked | done | wip\`; \`collapsed\` = \`true | false\`. Name a *tone*, never a color — the theme decides what a warning looks like, in light mode, in dark mode, and in print.
- **Use them sparingly.** One or two per document, on the sections that genuinely differ. A document where everything is toned says nothing, and a rainbow one is harder to read than a plain one.
- **Anything outside those sets is silently ignored** — nothing breaks, and nothing styles either. Run \`vantage-check\` on the document: the \`vantage/*\` rules are the only thing that will ever tell you a directive did nothing.
- **Always close the comment with \`-->\`.** Never \`--!>\`, and never leave it open: Markdown reads every line below an unclosed \`<!--\` as part of the comment, and the whole rest of the document vanishes from the page. For the same reason \`-->\` cannot appear *inside* a value — it ends the comment early and spills the remainder into the page as literal text.
- **In a list, indent the directive inside the item**, with blank lines around it (below). At the start of a line between two items it ends the list and starts a second one, which changes the numbering and the spacing in every renderer — the one thing a directive must never do.
- **A question's id is \`OQ-\` then an optional short uppercase prefix then digits** — \`OQ-9\`, \`OQ-TP6\`, \`OQ-A03\`. The prefix is what keeps ids distinct once one document references another's questions, so use one in both whenever they cross-reference. \`vantage-check\` reports anything outside that shape as \`vantage/oq-id-format\`, and the same id twice in one document as \`vantage/oq-id-duplicate\` — both are silent otherwise, because the id becomes the block's anchor and a refused or duplicated one simply goes nowhere.
- **A reference is a link, or it is a lie.** An \`OQ-\` id, a \`\u00a7N\` section number and a filename all read like pointers, and written as bare prose none of them can be followed or checked — which is exactly why a stale one is never caught. Link the question to its anchor (\`[OQ-4](#OQ-4)\`, or the Decision Ledger once it is compacted), the section to its heading, the filename to the file. \`vantage-check\` reports all three (\`ref/*\`) as errors, and checks that the link points at the thing the reference names rather than merely at something. Writing a specimen rather than a reference? Put it in a fenced block, which the rules never read.

### Open questions
A question a document leaves for a human to rule on is an *Open Question*, written in a numbered list under a heading of its own.

- **Write each question in its parts, never as one run-together paragraph.** Vantage lays a question out by these parts: the contents column and the planning page's card show its title as the question, and the card shows the leaning as the leaning and the Answer as the answer, so a part run into another one is read as neither. Each part is a block of its own, with a blank line before it:
  1. **The title line**: the status marker, the id and the question itself in bold, saying what is being decided: \`\u{1F4AC} **OQ-9: Where does a job go when it re-enters the queue?**\`.
  2. **The context**, in short paragraphs: only what a ruling needs. Background, history and cross-references belong in the document's own sections, linked from the question.
  3. **The options as a list**, one item each, when there are options to choose between.
  4. **\`_Leaning:_\` as a paragraph of its own**: which option, and why, in a sentence or two.
  5. **\`**Answer:**\` as a paragraph of its own**, with the ruling below it once there is one.

\`\`\`markdown
## Open Questions

1. \u{1F4AC} **OQ-9: Where does a job go when it re-enters the queue?**

   A job that fails its checks leaves the queue and comes back once it is fixed. What merged while it was out may change what it does.

   - **A — The back of the queue.** It waits its turn again.
   - **B — Its old place.** It skips ahead of what joined since.

   <!-- vantage: question id=OQ-9 leaning="A — the back of the queue: the fix might interact with what merged while it was out." -->

   _Leaning:_ A. The fix might interact with what merged while it was out.

   **Answer:**

   > _(empty — fill in when decided)_

2. \u{1F512} **OQ-10: How large is the retry budget?**

   <!-- vantage: question id=OQ-10 -->

   Waits on the load test, so there is no leaning to state yet.
\`\`\`

- **The marker is the question's state**: \u{1F4AC} open (\u{1F4AC} \u{1F937} when it is a matter of preference), \u{1F512} blocked on something upstream that has to happen first, \u2705 answered. Review mode offers a one-click **Take this leaning** on an open question, and on nothing else.
- **Every question gets a \`question\` directive**, \`<!-- vantage: question id=OQ-9 leaning="…" -->\`, in every state, indented into its list item on a line of its own directly above the \`_Leaning:_\` paragraph, or above another of its paragraphs when it states no leaning. The directive is what makes it a question to Vantage: it gives the question its \`#OQ-9\` anchor, and Vantage's planning index (its model of a repository's plans) reads a question from nothing else, so without one nothing counts it, badges it or lists it as waiting. It goes when the question is compacted into the Decision Ledger, and not before.
- **Changing a question's state changes its marker and nothing else.** Mark it \u{1F512} when it cannot be answered yet, and \u2705 once it is decided; the directive stays as it is, its \`leaning\` included, which nothing offers to take once the question is not open.
- **Every open question with a stated leaning restates it as the directive's \`leaning\`.** The convention's prose — the emoji, the \`OQ-N\` id, the \`_Leaning:_\` line, the fill-in \`**Answer:**\` — produces no button on its own, and writing it and stopping there is the most common way the button goes missing: the questions look complete, review mode is on, and there is nothing to click. \`vantage-check\` reports an open question with a \`_Leaning:_\` and no directive as an error (\`vantage/oq-missing\`). An open question with no leaning yet takes the directive without \`leaning\`, so the planning index still counts it; until it states one, its button files the literal text "Take the stated leaning."
- **A \`leaning\` restates the leaning; it is never "yes".** The one-click button in review mode files that text as a review comment, and the comment is all the agent reading it has — nobody remembers which button was clicked. \`leaning="Yes"\` beside a two-branch question is a support ticket.
- **Keep the text below the title short.** The planning page shows each question as a card that leads with the title and shows only the first few lines of the rest, so a question buried in a paragraph of background is one the reviewer has to dig for. \`vantage-check\` warns when a question's text, not counting its \`_Leaning:_\` paragraph and its \`**Answer:**\`, runs past 120 words (\`planning/question-length\`), and when a leaning shares a paragraph with other text (\`vantage/question-layout\`); a repository can raise the limit with \`max-words\`, or turn either rule off, under \`[check.rules]\`.
- **Write a question as a list item.** Outside a list, a question runs from the block its directive lands on through the blocks after it, up to the next heading (for a question written as a heading, the next one of its level or higher), the next rule or the next question, so whatever prose follows it before then is read as part of it. There the directive goes above the question's title, since every viewer reads the question's marker from the block it lands on: a directive below the bold title lands on the block after it, which carries no marker, so every viewer reads the question as open. \`vantage-check\` reports that as \`vantage/question-name\`.
- **\`oq\` is the name \`question\` replaces.** Vantage keeps reading \`<!-- vantage: oq id=OQ-9 leaning="…" -->\` as it always has, and \`vantage-check\` warns on it (\`vantage/oq-deprecated\`) with the \`question\` to write instead, keys unchanged. Vantage before 0.8 drops \`question\` whole, so a reader still on 0.7 gets no one-click answer and no anchor on a question written with it, and misreads nothing. So keep an \`oq\` on an open question unless you know every reader of the repository is on 0.8 or later; a repository whose readers are still on 0.7 keeps its \`oq\`s and turns the warning off in \`.vantage.toml\`, with \`"vantage/oq-deprecated" = "off"\` under \`[check.rules]\`, which a \`vantage-check\` before 0.8 rejects as a rule it does not know. **Never put \`oq\` on a \u{1F512} or \u2705 question**: every Vantage before 0.8 offers the one-click button on every \`oq\`, whatever its marker says, and on a question with no leaning it files the literal text "Take the stated leaning." \`vantage-check\` reports that as an error (\`vantage/question-name\`).

### Tables, task lists, and math
- **Tables**: Use standard markdown tables for structured comparisons and schemas.
- **Task lists**: Use \`- [ ]\` and \`- [x]\` for actionable checklists and status tracking.
- **LaTeX Math**: Use \`$$...$$\` for *all* KaTeX math — display blocks (\`$$\` alone on its own lines) and inline alike (\`$$E = mc^2$$\` mid-sentence).
  - Single dollars are **not** math delimiters: \`$HOME\` and \`$100\` stay literal, so prose and shell snippets are safe to write as-is.
`;
