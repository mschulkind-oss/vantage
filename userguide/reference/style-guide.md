# Style Guide for Agents

Vantage documents have conventions that make them render well — relative
links only, no leading slashes, line anchors, math and Mermaid that actually
compile. The **style guide** is the canonical statement of those conventions,
meant to be put in front of an LLM that is writing or editing documents for a
repo viewed in Vantage.

It has a single source of truth in the `vantage-md` package
(`src/styleGuide.ts`), and it changes between releases. Three places hand you
the same text for the same version. Each gives the guide of its own release, so
know which release you are reading, and never maintain a private copy:

| Where | How | Whose release |
| :--- | :--- | :--- |
| The app | Settings (⚙) → **Agent Style Guide** — a modal with a copy button | The viewer's |
| The CLI | `uvx vantage-check style-guide` (or the compiled `vantage-check`) | The checker's. With no version, `uvx` runs the newest release |
| The package | `import { STYLE_GUIDE } from "vantage-md"` | The installed package's |

> [!IMPORTANT]
> **The CLI's guide describes the checker's release, which can be newer than
> your readers' viewer.** Its first line names that release. That is safe: a
> release never gives existing notation a new meaning, so what a newer guide
> teaches, an older viewer drops without misreading it. Write by the newest
> guide and check with the newest checker, as
> [Which release it writes for](../guides/vantage-check.md#which-release-it-writes-for)
> says, rather than by an older release's: a checker before 0.8 reports 0.8's
> directives as errors. What a 0.7.x viewer loses from the 0.8.0 guide, and how
> a repository whose readers are on 0.7 keeps what they need, is in
> [When your readers are on 0.7](../guides/vantage-check.md#when-your-readers-are-on-07).

## How to use it

Paste the guide into the agent's context when it writes a document for the
repo — most agents will do this on their own if the repo's agent instructions
point at it, e.g.:

```
Before writing Vantage documents, read the style guide:
`uvx vantage-check style-guide`
```

Point at the command rather than pasting its output into the instructions: a
pasted copy is frozen at the release that printed it. When your CI pins the
checker, put the same version in the command
([In CI](../guides/vantage-check.md#in-ci)).

Then, after the agent has written the document, verify it:

```
uvx vantage-check docs/design/api.md
```

The style guide tells the agent **how to write**; `check` verifies the
result **against the real pipeline** — the two are the write side and the
verify side of the same contract, when both come from the same release. See
[vantage-check](../guides/vantage-check.md).

> [!NOTE]
> The guide is advice; the checker is the enforcement. Not every convention in
> the guide is a rule the checker can decide — it reports what *breaks*
> rendering, and leaves matters of taste to you.

## Questions

The guide says how an Open Question is written, because Vantage lays a question
out by its parts: the contents column and the planning page's card show its
title as the question, its leaning as the leaning and its Answer as the answer.
So a question is written in parts, each a block of its own with a blank line
before it, as an item of a numbered list under a heading of its own: a title
line with its marker, its id and the question in bold; its context, in short
paragraphs; its options, as a list; `_Leaning:_` as a paragraph of its own; and
`**Answer:**` as a paragraph of its own — never one run-together paragraph.
Every question carries a `question` directive, in every state.
`vantage-check` warns when a leaning shares a paragraph with other text
(`vantage/question-layout`), and when a question's text runs long
(`planning/question-length`); both quote the shape.

## Planning documents

The guide also covers the frontmatter Vantage reads a repository's plans
from: `stage`, `next` and `depends-on` beside `status`, the rule that a stage is
written in the frontmatter and nowhere else, how a roadmap is written, the
`[planning]` table in `.vantage.toml` that declares the stage words, and how to
hand you a [filtered planning page](../guides/planning.md#filtering-the-page)
when an agent needs your rulings on one piece of work. What
Vantage does with them, the badges on links, the planning page and
`vantage-check index`, is in [Planning Documents](../guides/planning.md).

## Related

- [vantage-check](../guides/vantage-check.md) — the checker, its rules, and config
- [Review Inbox](../guides/review-inbox.md) — the review flow that tells agents to run
  both
