# Style Guide for Agents

Vantage documents have conventions that make them render well — relative
links only, no leading slashes, line anchors, math and Mermaid that actually
compile. The **style guide** is the canonical statement of those conventions,
meant to be put in front of an LLM that is writing or editing documents for a
repo viewed in Vantage.

It has a single source of truth in the `vantage-md` package
(`src/styleGuide.ts`). Three places hand you the same text — get it from
whichever is closest, and never maintain a private copy:

| Where | How |
| :--- | :--- |
| The app | Settings (⚙) → **Agent Style Guide** — a modal with a copy button |
| The CLI | `uvx vantage-check style-guide` (or the compiled `vantage-check`) |
| The package | `import { STYLE_GUIDE } from "vantage-md"` |

## How to use it

Paste the guide into the agent's context when it writes a document for the
repo — most agents will do this on their own if the repo's agent instructions
point at it, e.g.:

```
Before writing Vantage documents, read the style guide:
`uvx vantage-check style-guide`
```

Then, after the agent has written the document, verify it:

```
uvx vantage-check docs/design/api.md
```

The style guide tells the agent **how to write**; `check` verifies the
result **against the real pipeline** — the two are the write side and the
verify side of the same contract. See [vantage-check](../guides/vantage-check.md).

> [!NOTE]
> The guide is advice; the checker is the enforcement. Not every convention in
> the guide is a rule the checker can decide — it reports what *breaks*
> rendering, and leaves matters of taste to you.

## Related

- [vantage-check](../guides/vantage-check.md) — the checker, its rules, and config
- [Review Inbox](../guides/review-inbox.md) — the review flow that tells agents to run
  both
