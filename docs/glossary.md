---
title: "Glossary"
tags: [glossary, terms]
summary: "Terms of art that more than one document in this repository uses, each defined once, with what it excludes and where it came from. A term one document uses alone is defined in that document."
---

# Glossary

A term moves here when a second document needs it, and both documents link here
instead of defining it twice. Each entry says what the term means, what it is
not, and where it came from. An entry nothing links to any more is deleted.

## Canary

A document known to be valid that a delegate, a parser `vantage-check` runs to
answer a question it does not answer itself, must accept before it may judge a
real document. Mermaid and the render pipeline each parse theirs once per thread
that checks. A canary that fails means the delegate cannot run here, so every
document it would have checked gets a [failure](#failure); it never means a
document is wrong.

**Not** a test fixture: a canary runs on every check, inside the shipped binary.

**Origin:** coined by `vantage-check`'s implementation, 2026-08-31 (`0174b50`).
Used by [`agent-cli.md`](reference/agent-cli.md#12-invariants) and
[`check-performance.md`](reference/check-performance.md#42-the-render-rule-renders-the-tree-the-rules-already-read).

## Failure

Short for *environment failure*: a statement from `vantage-check` that a check
could not run, so the status of the documents it names is unknown. A file it
could not read, a delegate that could not start, and a worker thread that never
answered are each a failure. Any failure makes the run exit `3`, whatever the
[findings](#finding), and both report formats print failures apart from
findings.

**Not** a [finding](#finding), and never counted toward an error or a warning.
Not a usage error either: a bad argument or an untrustworthy `.vantage.toml` is
exit `2`.

**Origin:** the agent-cli design, 2026-08-24 (`3e7d8e4`), whose risk R1 and
principle P2 say a delegate's failure is not automatically a finding. That
design is in git; [`agent-cli.md`](reference/agent-cli.md) replaced it. Used by
[`agent-cli.md`](reference/agent-cli.md#12-invariants) and
[`check-performance.md`](reference/check-performance.md#11-principles).

## Finding

A statement from `vantage-check` that a document is wrong: a rule id, a
severity (`error` or `warning`), a position in the file, and a message addressed
to whoever has to fix the document. Errors fail the run, with exit `1` by
default, and warnings fail it only in strict mode.

**Not** a statement about the checker or its environment, which is a
[failure](#failure).

**Origin:** the agent-cli design, 2026-08-24 (`3e7d8e4`), principle P2. Used by
[`agent-cli.md`](reference/agent-cli.md#12-invariants) and
[`check-performance.md`](reference/check-performance.md#11-principles).
