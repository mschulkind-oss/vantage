---
title: "One repository config file, two readers — and the starred documents it promotes"
author: "Matt Schulkind"
date: 2026-09-20
status: accepted
tags: [config, starred, vantage-check, server]
summary: "The server becomes a second reader of the checker's `.vantage.toml`, and the first thing it reads there is a list of documents the repository promotes into Starred — alongside a list the user promotes for themselves."
vantage:
  status-chip: true
---

# One repository config file, two readers — and the starred documents it promotes

**Status:** DESIGNED (2026-09-20). Every decision below is ruled. It lands
immediately after the bookmark store, and before any code that depends on these
rulings.

**The short version.** Bookmarks are the reader's own, kept in their data
directory and never travelling with the repository. Two things are missing at
either end of that. A reader wants a standing list — *my roadmap is always
starred, in every project* — which belongs in their user config. And a repository
wants to say *start here*, which belongs to the repository and therefore in a file
committed alongside it. That file already exists: `.vantage.toml`, which
[`vantage-check`](../../userguide/guides/vantage-check.md) reads today. The server
becomes its second reader.

Promoted documents are **not** bookmarks. They are never written into the user's
bookmark file, they carry a label saying where they came from, and the star that
means "I chose this" keeps meaning exactly that.

## 1. Why one file with two readers, rather than a second file

[`AGENTS.md`](../../AGENTS.md) treats "the backend shells out to git" and
"`vantage-md` is consumed from source" as design facts rather than implementation
details, and a second program reading a config file is the same kind of fact. It
is worth stating why this is a unification and not a collision.

A repository already has exactly one place to configure Vantage. Adding
`.vantage-server.toml` beside `.vantage.toml` would mean a contributor guessing
which of two files a key belongs in, and a reviewer unable to see both halves of
one project's configuration at once. The cost of sharing is that two programs in
two languages must agree about one file; the cost of not sharing is paid by every
person who opens the repository.

### 1.1 The checker already tolerates it, by construction

This is the load-bearing fact, so it is stated with its location rather than
assumed. [`packages/vantage-check/src/core/config.ts`](../../packages/vantage-check/src/core/config.ts)
reads `root["check"]` and enumerates nothing else — its own comment says "other
tools' sections are not ours to police", and
[`packages/vantage-check/test/config.test.ts`](../../packages/vantage-check/test/config.test.ts)
pins that with a foreign section. An unknown top-level table is therefore not
merely accepted today; it is accepted on purpose.

> [!WARNING]
> **There is exactly one arrangement that breaks this, and it looks like the tidy
> one.** Nesting the server's keys under the checker's table — `[check.starred]`,
> or a bare `check.starred = […]` — reaches the parser's `default:` branch and
> throws `unknown key`, exit code 2, for **every existing `.vantage.toml` user**.
> The parser is strict, but only one level down, so reading it quickly gives
> precisely the opposite impression of the truth. The server's keys are top-level
> or they are a breaking change.

### 1.2 Neither reader polices the other's keys

The checker stays out of the server's table, and the server stays out of the
checker's. A checker that validated the server's keys would turn someone's CI red
for a key that is not its business the moment the two binaries are a version
apart — and they ship as separate artifacts, so version skew is the normal state,
not the exception. Each reader shouts about its own typos.

The invariant that actually needs pinning is narrow: **neither reader rejects a
file containing the other's sections.** One shared fixture that both test suites
parse is enough to hold it, and it is cheap enough to keep honest.

## 2. What the server reads

```toml
# .vantage.toml, at the repository root
[check]
strict = true          # the checker's, untouched

[starred]
promote = [
  "roadmap.md",        # a literal path, relative to the repository root
  "docs/design/*.md",  # a pattern, gitignore syntax
]
```

The same table, with the same one key, appears in the user's own config:

```toml
# ~/.config/vantage/config.toml
[starred]
promote = ["roadmap.md", "ROADMAP.md"]
```

One shape in both files, so the reference documentation teaches it once. The key
is `promote` because that is what it does — it does not star anything on the
reader's behalf, it puts a document where a starred one appears.

### 2.1 `[starred]`, not `[server]`

`[server]` is the literal string the checker's own test uses as its example of
"a section belonging to another tool". Claiming it would make a passing test's
name a lie. `[starred]` also says what the table is for rather than which
binary reads it, which is the distinction that survives a future in which both
binaries read more of this file.

### 2.2 The repository root only — no upward walk

The checker finds `.vantage.toml` by walking *up* from the file it is checking.
The server does not copy that, and the difference is deliberate. Three reasons,
each sufficient:

- **A walk-up reads a file outside the served tree**, which is the one thing
  [`internal/pathsafe`](../../internal/pathsafe) exists to prevent.
- **It would make the server's own tests depend on the filesystem above them** —
  on whether some ancestor of a temporary directory happens to hold a
  `.vantage.toml`.
- **In daemon mode it is ambiguous.** Several served repositories can share an
  ancestor, so a walk-up would silently give one repository's promotions to
  another.

### 2.3 Rejected whole, never half

A malformed file, or one with an unknown key inside `[starred]`, is refused
entirely: the repository is served **as if it had no config**, and a warning names
it. Not half-applied, and not fatal.

Failing startup is defensible in serve mode and indefensible in daemon mode, where
one contributor's bad commit would take down every other repository on the
machine. Two behaviours for one file is worse than either, so there is one. "Never
half" is the discipline the checker already holds for the same file.

### 2.4 The file is attacker-controlled

The moment someone opens an untrusted repository, this is hostile input. The
reader therefore `Lstat`s before reading and refuses anything that is not a
regular file, caps the read, and never follows a symlink — an ordinary
`os.ReadFile` on `<root>/.vantage.toml` would happily read `~/.ssh/config`
through one. A repository-controlled string is never echoed into a path without
passing the checks in [§3.3](#33-a-promoted-path-is-held-to-a-stricter-standard-than-a-bookmark).

### 2.5 Reload

A repository's config changes while the server runs, and the server runs for
weeks. Read-once-at-startup is wrong for that; a read per request costs a file
read per repository per response. So the reader re-stats at most once every two
seconds — the interval [`internal/ignore`](../../internal/ignore) already uses for
the same problem — and re-parses only when the modification time moves.

An edit gets **no live push** in this design. Wiring one would mean teaching the
live watcher to keep an event it currently drops *and* inventing a push for it,
and the observable gap is that a contents list is at most two seconds stale.

## 3. Promotion

### 3.1 A promoted row is wire-only

`Entry` is what gets persisted. Promotion adds `Listed` — an `Entry` plus a
`Source` — which exists only in the JSON the server sends. The persisted type and
the on-disk format do not change at all.

That makes "a promoted document is never written into the user's bookmark file"
true **by construction** rather than by care. Putting the label on the persisted
`Entry` instead would write a source field into every row of every user's file,
and would make the store's own `Add` capable of persisting a promoted row — a
mistake nothing in the type system would catch.

### 3.2 The star means "I chose this"

This is where promotion is most likely to ship visibly wrong, so it is a ruling
rather than an implementation note.

The viewer's `isStarred` is filtered to the user's own rows. It is not "this path
appears in the list". The header star uses that one predicate for two jobs —
whether to render filled, and whether a click should add or remove — so a promoted
row in the same array renders a **filled amber star for a document the reader
never starred**, whose click issues a delete the server answers with 404, which
is swallowed, leaving the star filled. Nothing crashes and no existing test fails.

For the same reason the label lands in its own commit, *before* any promoted row
can reach the response.

### 3.3 A promoted path is held to a stricter standard than a bookmark

The bookmark store deliberately never touches the filesystem to validate an
entry, because a bookmark whose target was deleted has to round-trip so the
viewer can offer to remove it. Its own comment says not to consolidate that
check with `pathsafe`.

A promoted path has no such round-trip requirement — nobody typed it, and a
broken one is a config error rather than a user's stale bookmark. So it clears
both the lexical check *and* physical containment in its repository. That is
exactly the check that catches a promoted `docs/notes.md` which is a symlink to
something outside the tree.

### 3.4 A literal costs nothing; only a pattern walks

A line with no `*`, `?` or `[` is taken literally and resolved with no filesystem
access whatsoever. This matters because the motivating case — one roadmap — must
stay free: the client refetches the whole list on mount, on reconnect, and on
every change push, so a ten-repository daemon would otherwise perform ten full
Markdown walks per star click.

Only a pattern triggers a listing, and the promoted set is bounded *after*
expansion so a pattern matching a thousand documents cannot produce a thousand
rows.

> [!NOTE]
> Patterns match files, not directories. The listing the server has available
> yields Markdown files only, so a promoted **directory** can be named literally
> but cannot be discovered by a pattern.

### 3.5 Collisions, and who wins

Repository-level and user-level lines **union** — the repository says "these
matter in this project" and the user says "these matter to me everywhere", and
there is no coherent winner between two sets, only between two claims on one row.

On a collision, deduplicated by repository and path:

1. **The user's own bookmark wins over any promotion.** It is the only one of the
   three with an honest timestamp, and the only one the reader can remove.
2. **Between the two promotions, the user's config wins**, because that is the one
   the reader chose for themselves, and the row can say so.

Deduplication is correctness rather than tidiness: the sidebar keys each row on
its repository and path, so two rows with one key is a duplicate-key warning and a
visibly doubled row.

### 3.6 A promoted row cannot be unstarred, this time

The affordance is hidden, and the row says the config file is where it comes from.

Of the three possible answers this is the only one that adds no persisted state.
"Yes, and it sticks" needs a dismissal list in the user's file, and that tombstone
can never be collected: the store is forbidden from stat'ing the filesystem, so a
dismissal for a path that no longer exists, or for a promotion that has since been
removed from the config, would sit there forever. "Yes, but it comes back" is a
control that visibly does nothing.

### 3.7 Static exports emit nothing

Unchanged from the bookmark feature, and for a narrower reason than before. A
promoted document *is* the repository's own committed content, so the privacy
argument that covers a user's bookmarks does not apply to it — the reason here is
that an export has no server to merge two sources, and giving it one is its own
piece of work. The export's stated reason is corrected to say that.

## 4. What this repository does not get

**No `.vantage.toml` of its own, in this change.** Two hazards, both silent:

- The gate runs the compiled checker over the documentation tree with no explicit
  config, and the checker walks *up* — so the moment a root config exists, the
  gate starts honouring its `[check]` table. That is a retune of the gate hidden
  inside a feature change.
- A fixture named `.vantage.toml` anywhere under the tree is worse: it is found by
  that same upward walk from any document below it, and the checker also treats
  the filename as a repository-root marker when it suggests link targets. Test
  fixtures therefore use a plain `.toml` name.

## 5. Deferred, then done

Passing a **directory** to the checker's `--config` used to crash rather than
report: the load threw a bare `EISDIR` which the command re-raised, so a mistyped
argument was announced as the checker's own environment breaking. Fixed in its own
commit, as this section said it wanted — every way the read can fail is now a
config error, which is the family the command maps to "fix the invocation".

## 6. Decision Ledger

| ID | Ruling / Decision | Date | Settled in |
| :--- | :--- | :--- | :--- |
| OQ-RC1 | The server becomes a second reader of `.vantage.toml` rather than getting a file of its own. | 2026-09-20 | [§1](#1-why-one-file-with-two-readers-rather-than-a-second-file) |
| OQ-RC2 | The table is top-level `[starred]` with one `promote` key, identical in the repository and user files. Never nested under `[check]`. | 2026-09-20 | [§1.1](#11-the-checker-already-tolerates-it-by-construction), [§2.1](#21-starred-not-server) |
| OQ-RC3 | Neither reader validates the other's keys; one shared fixture pins that both tolerate the other's sections. | 2026-09-20 | [§1.2](#12-neither-reader-polices-the-others-keys) |
| OQ-RC4 | The server reads the repository root's file only, with no upward walk. | 2026-09-20 | [§2.2](#22-the-repository-root-only--no-upward-walk) |
| OQ-RC5 | A bad file is rejected whole, warned about, and the repository served config-free. Never fatal, never half-applied. | 2026-09-20 | [§2.3](#23-rejected-whole-never-half) |
| OQ-RC6 | The read is guarded: regular files only, size-capped, no symlink following. | 2026-09-20 | [§2.4](#24-the-file-is-attacker-controlled) |
| OQ-RC7 | Self-reload on a modification-time check throttled to two seconds. No live push. | 2026-09-20 | [§2.5](#25-reload) |
| OQ-RC8 | Promoted rows are wire-only; the persisted entry and the on-disk format are unchanged. | 2026-09-20 | [§3.1](#31-a-promoted-row-is-wire-only) |
| OQ-RC9 | The star means the reader starred it. The label lands before any promoted row can reach the response. | 2026-09-20 | [§3.2](#32-the-star-means-i-chose-this) |
| OQ-RC10 | A promoted path clears physical containment as well as the lexical check. | 2026-09-20 | [§3.3](#33-a-promoted-path-is-held-to-a-stricter-standard-than-a-bookmark) |
| OQ-RC11 | Literals resolve with no filesystem access; only patterns walk, and the set is bounded after expansion. | 2026-09-20 | [§3.4](#34-a-literal-costs-nothing-only-a-pattern-walks) |
| OQ-RC12 | Repository and user lines union; on collision the user's bookmark wins, then the user's config. | 2026-09-20 | [§3.5](#35-collisions-and-who-wins) |
| OQ-RC13 | A promoted row cannot be unstarred; the affordance is hidden and the row names the config file. | 2026-09-20 | [§3.6](#36-a-promoted-row-cannot-be-unstarred-this-time) |
| OQ-RC14 | Static exports emit nothing, for lack of a merge rather than for privacy. | 2026-09-20 | [§3.7](#37-static-exports-emit-nothing) |
| OQ-RC15 | This repository gets no `.vantage.toml`, and no fixture is named that. | 2026-09-20 | [§4](#4-what-this-repository-does-not-get) |
