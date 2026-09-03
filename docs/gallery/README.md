---
title: "The directive gallery"
status: accepted
summary: "A set of specimen documents that render every Vantage directive, for reviewing how the markup actually looks."
---

# The directive gallery

Six specimen documents that render **every** Vantage directive, token and
combination, with nothing else on the page. Their only job is to be looked at.

They exist because the directive vocabulary is
[semantic and never chromatic](../reference/inline-markup.md#the-token-vocabulary)
— a document names `tone=warning` and the theme decides what that means, in
light, in dark and in print. That is the right design and it has one cost: an
author writing `tone=warning` has no idea what they are about to get, and a
maintainer changing a colour has nowhere to check the result. This is that
place.

It is a **maintainer tool, not documentation of the feature.** The user guide's
[style guide](../../userguide/reference/style-guide.md) tells authors what to
write and
[the reference](../reference/inline-markup.md) says how it works; the gallery
only shows what it looks like.

> [!NOTE]
> Everything here is a live specimen, not a screenshot or a code sample — the
> markup in these files is doing the thing it describes. That is also why they
> break the style guide's advice to use directives sparingly: a document where
> everything is toned normally says nothing, and these six say exactly one
> thing.

## Fire it up

```bash
just gallery
```

That is `just dev` with the URL written down. Then open:

```text
http://localhost:8201/docs/gallery/README.md
```

**Use :8201, not :8200.** :8201 is the Vite dev server, so edits to
`frontend/src` and to `packages/vantage-md` are live. :8200 is the Go backend it
proxies to, and on its own it serves whatever `web/dist` was last built with —
which is not your CSS edits.

Two switches change what these pages are showing you:

- **The theme toggle.** Every tone has a separate dark definition, so light and
  dark are two independent judgements and a change to one is not a change to the
  other. Read each page twice.
- **Review mode**, per file. [Open questions](./open-questions.md) renders
  nothing at all until it is on.

## The pages

| Page | Covers | The question it answers |
| :--- | :--- | :--- |
| [Tones](./tones.md) | all six `tone` tokens, as lone blocks and as sections; the GFM alerts beside them | are the six distinguishable, and at the same weight? |
| [Emphasis](./emphasis.md) | `strong` / `normal` / `quiet`, against a fixed tone and across all six | do the 1px rule steps read, and is `quiet` still legible? |
| [Badges and chips](./badges-and-chips.md) | all five `badge` tokens, every heading level, the frontmatter status chip | does the chip stay legible small and stay a chip when large? |
| [Sections and the run](./sections.md) | one toned section across nine block types; adjacent runs; the unstampable hole | is the stripe continuous, and does it stop where the section stops? |
| [Collapse](./collapse.md) | `collapsed=true`, nesting, the caret, the three gates | does the caret work by keyboard, and does everything print open? |
| [Open questions](./open-questions.md) | `oq`, the one-click button, and where it will not appear | one affirmative button per question, and nothing when review mode is off? |

Each page opens with its own "what to look at" list. Those lists are the point —
they are what turns "this looks a bit off" into a specific claim about a
specific value.

## How to review it

Vantage reviews Markdown, so review the gallery in Vantage. The loop is the
product's own:

1. Turn **review mode** on for the page you are looking at.
2. Click the block that looks wrong and type what is wrong with it. Comments
   anchor to blocks, so a comment on the `muted` specimen stays attached to that
   specimen.
3. **Copy comments to agent** and paste. The agent gets your comments with the
   file and the blocks they are attached to.
4. It changes the theme layer, answers through
   [the inbox](../../userguide/guides/review-inbox.md), and the page live-reloads
   under you.

That is why the specimens are labelled with their exact directive rather than
with prose descriptions: `tone=muted emphasis=quiet` is a thing a comment can be
about, and "the faint grey one" is not.

## What to change when something looks wrong

Almost always exactly one file: `packages/vantage-md/src/styles/directives.css`.
Every colour in the system is a custom property declared at the top of it — the
light set on `:root`, the dark set under `.dark` — and every rule below reads
those properties rather than naming a colour. A new theme is one property block
and zero document changes.

Four things in that file break silently if changed, and all four are recorded in
[the reference](../reference/inline-markup.md#the-theme-layer): the file must
stay **unlayered**, it must be imported by relative source path, the accent
`var()` must have **no fallback**, and `emphasis=strong` must keep excluding
headings, `pre` and `table`.

> [!WARNING]
> **A computed-style test cannot see most of what this gallery shows.** The
> code-fence bug is the standing example: the stripe's `left` was correct the
> whole time and it simply did not paint, because the fence clipped its own
> pseudo-element. Only a rendered page — or a pixel test — catches that class of
> defect, which is the gap these six documents fill.

## Findings from the first pass

Two things the gallery caught the first time it was rendered. Both are recorded
here rather than fixed, because each is a change to the theme layer with its own
test to write.

### A bordered member draws its slice 1–4px right of everyone else's

The stripe is an absolutely-positioned `::before`, and `left` on an absolutely
positioned element resolves from the **padding** edge of its containing block —
which is the member itself. So a member with a left border of its own has its
padding edge pushed inward by that border, and its slice lands that much to the
right.

Measured on [Sections](./sections.md) at a 1280px viewport, with every member's
border edge at the same x and every computed `left` identical at `-12px`:

| Member | `border-left-width` | Painted x |
| :--- | :--- | :--- |
| `p`, `ul`, `ol`, `table`, `hr`, `h3`, `h4`, KaTeX `span` | `0px` | 308 |
| `pre` | `1px` | 309 |
| `blockquote` | `4px` | 312 |

The blockquote's 4px is visible as a jog in an otherwise straight stripe, and
because the slice is only 3px wide it reads as a break rather than as a bend.

> [!NOTE]
> `directives.css` says "Measured: the pseudo's computed `left` puts all eight
> block types on the same pixel." That claim is **true and does not imply what
> it is cited for** — the computed `left` really is identical on all of them;
> it is the padding edge each one is measured from that differs. The heading
> compensation is not the culprit and works exactly as documented: `h3` and
> `h4` land on 308 with the paragraphs.

### The Open Question button lands inside the closing quotation mark

On a blockquote host, the button is appended as the last element child of the
paragraph, and `@tailwindcss/typography` draws the closing quote as that same
paragraph's `::after` with `content: close-quote`. So the generated `"` renders
*after* the button, and the button reads as part of the quoted sentence.

Only blockquotes are affected — no other host has generated content after its
content.

## Keeping it honest

The gallery is under `docs/`, so `just check` runs `vantage-check` over it like
every other document here. A token that leaves the vocabulary, or a directive
that stops attaching to anything, fails a commit instead of quietly becoming a
specimen of nothing.

The flip side: **every directive in these files has to be valid.** The
interesting invalid cases — an unknown token, an `oq` above a list, a directive
with nothing after it — are described in prose and in fenced examples rather
than written live, because writing them live would fail the gate. Point
`vantage-check` at a scratch file to see those.

When a token is added to the vocabulary, add its specimen here in the same
commit. A gallery that is missing the newest token is worse than no gallery,
because the gap is invisible.
