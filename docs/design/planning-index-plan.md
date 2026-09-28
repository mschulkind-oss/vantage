---
title: "The planning index — implementation sketch"
status: draft
stage: SKETCH
tags: [planning, implementation-plan]
summary: "Material that came up while designing the planning index and needs no ruling. Not a hand-off: do not build from it while it is a sketch."
---

# The planning index — implementation sketch

**Status:** SKETCH, 2026-09-28. Incomplete, and it will change while
[`planning-index.md`](planning-index.md)'s questions are open. **The design wins on behavior**:
where this file and the design disagree, this file is wrong.

## Notes gathered during design

- **The anchor for an answer filed from the planning page.** `buildWholeBlockAnchor`
  (`frontend/src/lib/reviewAnchor.ts:163-178`) reads `data-source-line` and hashes the rendered
  block's `innerText`. So the planning page's card has to render the question's list item
  through the same pipeline, with its source lines matching the whole document. It can render a
  slice with a line offset, or render the whole document and extract the block. Which one is the
  implementer's choice, provided the resulting anchors match. `useReviewStore.runCommand` posts
  only for the store's current `filePath` (`useReviewStore.ts:443-446`), so it needs a path
  parameter. The Go handler already accepts any `?path=` (`internal/api/review_command_handlers.go:84-110`).
- **Batch sources endpoint.** Nothing like it exists. `ListAllFiles` (`internal/fs/service.go:589`)
  gives the paths. Apply the `[planning]` include and exclude patterns with the same
  `gitignore.CompileIgnoreLines` that `[starred] promote` uses (`internal/starred/promote.go:155`).
  Enforce `max-file-bytes` and `max-candidates` on the server so an oversized project is refused
  before anything is read.
- **Config readers.** Add `planning` to `repoconfig`'s owned tables (`internal/repoconfig/repoconfig.go:133`).
  The checker's `config.ts` reads only `[check]` today. It needs a gitignore matcher to match the
  server's pattern semantics.
- **Leaning text.** `collectOqIds` parses the `leaning` pair and drops it
  (`packages/vantage-check/src/core/openQuestions.ts:52-54`). Keep it.
- **State extraction.** The contents column's `questionLabel` / `markerBefore`
  (`frontend/src/hooks/useDocumentOutline.ts:176`) works on the DOM. The scan works on mdast.
  See the design's agreement invariant ([§3.3](planning-index.md#33-a-question)).
- **Rules that need the whole index.** `check` runs files in worker threads
  (`packages/vantage-check/src/core/parallel.ts`). `planning/unrouted` and
  `planning/stage-disagrees` need the roadmap and every document's questions, so they belong in
  a pass that runs after the per-file work, not in a per-file rule.
- **Chords.** `g p` goes beside `g h` and `g r` in `frontend/src/hooks/useKeyboardShortcuts.ts:83-114`,
  and in the shortcuts help (`frontend/src/components/KeyboardShortcuts.tsx:30`).
- **Routes.** Add `/planning/*` next to `/recent/*` in `frontend/src/App.tsx:9-11`.
- **Badge placement.** Add a post-render hook in the style of `useOpenQuestionButtons`, wired in
  `frontend/src/components/MarkdownViewer.tsx`. Links are resolved by `resolveHref` (`:231-255`).
- **The combined payload** ([§6.3](planning-index.md#63-a-question-on-the-page)). Its builder would sit
  next to `copyAllToClipboard` (`useReviewStore.ts:708`).
