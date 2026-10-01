# Style Guide for Agents

Vantage documents have conventions that make them render well — relative
links only, no leading slashes, line anchors, math and Mermaid that actually
compile. The **style guide** is the canonical statement of those conventions,
meant to be put in front of an LLM that is writing or editing documents for a
repo viewed in Vantage.

It has a single source of truth in the `vantage-md` package
(`src/styleGuide.ts`), and it changes between releases. Three places hand you
the same text for the same version. Each gives the guide of its own release, so
get it from the one whose release your readers' viewer runs, and never maintain
a private copy:

| Where | How | Whose release |
| :--- | :--- | :--- |
| The app | Settings (⚙) → **Agent Style Guide** — a modal with a copy button | The viewer's |
| The CLI | `uvx vantage-check style-guide` (or the compiled `vantage-check`) | The checker's. With no version, `uvx` runs the newest release |
| The package | `import { STYLE_GUIDE } from "vantage-md"` | The installed package's |

> [!IMPORTANT]
> **The CLI's guide describes the checker's release, which can be newer than
> your readers' viewer.** Its first line names that release. When it is newer
> than the viewer your readers run, ask for theirs instead, such as
> `uvx vantage-check@0.7.1 style-guide` for a 0.7.x viewer. What a 0.7.x viewer
> gets wrong from the 0.8.0 guide is in
> [Which release it writes for](../guides/vantage-check.md#which-release-it-writes-for).

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

## Planning documents

The guide also covers the frontmatter Vantage reads a repository's plans
from: `stage`, `next` and `depends-on` beside `status`, the rule that a stage is
written in the frontmatter and nowhere else, how a roadmap is written, and the
`[planning]` table in `.vantage.toml` that declares the stage words. What
Vantage does with them, the badges on links, the planning page and
`vantage-check index`, is in [Planning Documents](../guides/planning.md).

## Related

- [vantage-check](../guides/vantage-check.md) — the checker, its rules, and config
- [Review Inbox](../guides/review-inbox.md) — the review flow that tells agents to run
  both
