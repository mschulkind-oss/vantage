---
name: release-notes
description: Use when writing or revising a version entry in Vantage's CHANGELOG.md — the section `just release` refuses to cut a tag without, and the one CI publishes as the GitHub release body.
---

# Release notes for Vantage

`just release <semver>` refuses to cut a tag unless
[`CHANGELOG.md`](../../../CHANGELOG.md) holds a real section for that version.
[`scripts/changelog-section.sh`](../../../scripts/changelog-section.sh) lifts that
section out byte for byte, and `publish.yml` posts it as the body of the GitHub
release. So the entry **is** the announcement, and it ships at the instant the tag
is pushed: a tag is never moved in this repository, and editing the file
afterwards does not change a release that has already been published. The sentence
you think of next week is a sentence the release does not have.

Run the extractor over your draft before committing — `sh
scripts/changelog-section.sh <version>` prints exactly what the release will say,
and nothing else tells you that. Note what it drops: the `## [<version>] - <date>`
heading, because GitHub's release title already carries both. Whatever you write
first has to stand on its own with no heading above it.

## Who reads it

Two people, and neither is a contributor.

- Someone who runs `vantage` over their own documents and wants to know what is
  different this morning.
- Someone on an older version deciding whether the upgrade is worth the minute.

A contributor already has the commit log, which is longer, more honest and better
written than any summary of it. So nothing in the entry is addressed to them: no
hashes, no PR numbers, no package or module names, no file paths, no "refactored
for clarity", no "see the diff".

## What earns a line

Something a reader can do, see, or stop working around. Two questions, and a line
needs yes to both:

1. Could a reader who never opens the repository notice it?
2. Did the thing it fixes exist in a **published** version?

Worked against this repository's own history:

| Commit | Earns a line? |
| --- | --- |
| `feat(viewer): bookmark documents and folders` | Yes. There is a star beside the document name now, and a section in the sidebar that was not there. |
| `fix(shortcuts): refresh the picker lists every time a picker opens` | Yes. `t` could not find a file written after the page loaded — a daily annoyance in a published version. |
| `fix(check): report a directory passed to --config instead of crashing` | Yes. Shipped behavior, and the exit code a script keys on changed. |
| `refactor(md): share the open question status vocabulary with the checker` | No. Two copies of a list became one; a reader sees the same page. |
| `fix(starred): name the bookmark file after its root` | No. It corrected a filename introduced a few commits earlier in the same release, so no reader ever had the old one. A fix to something that never shipped is not a fix. |
| `fix(viewer): keep the contents tally and its scroll target honest` | No, for the same reason: the column it corrects is new in the same release, so the corrected behavior is simply the behavior. |
| `perf(viewer): load a built-in theme as a stylesheet` | No. Real and measured, but measured against a state no release ever had. |
| `ci: run the commit-message policy on pull requests` | No. Contributor-facing, and the contributor has the commit. |

The awkward case is the second half of that table: a release that adds a feature
usually also contains the three commits that finished it. Those belong to the
feature's paragraph, invisibly, not to the fix list. **Fixes are fixes to
something a reader could have hit.**

Never earns a line, whatever the effort was: a refactor, a test, a dependency
bump, an internal rename, a design note, a CI change, a docs commit that
documents something the same release added.

## How it should sound

**American English.** Color, gray, behavior, canceled, license, math. The whole
repository is American, including the settings menu's **Colors** label, so an
entry spelled the other way reads as a different hand.

**Write it the way you would tell a colleague what changed.** That is the whole
rule, and it is the one most often missed, because the register that goes wrong
here is not sloppiness — it is polish. An entry can pass every rule below and
still be unreadable because it is trying to sound like something.

So, concretely:

- **Short declarative sentences, one idea each.** If a sentence has three clauses
  hanging off it, it is two sentences.
- **No aphorisms.** "The sentence you think of next week is a sentence the release
  does not have" is a nice line and nobody reading release notes wants it. State
  the fact and move on.
- **No inverted clauses for effect.** "Gone is the flicker" is worse than "the
  flicker is gone", and "what the paint needs is the link in the document" is
  worse than "the link has to be in the document before the first paint".
- **At most one em-dash aside per paragraph**, and none at all if the sentence
  works without it. A paragraph with three is a paragraph arguing with itself.
- **Say "you".** These notes are addressed to a reader, and the passive voice is
  usually hiding either the actor or the fact that the claim is vague.
- **Do not explain why a thing was hard.** The reader was not there. "Checked in a
  real browser" is the fact; "measured rather than asserted" is the author
  admiring the method.

The test: read the paragraph out loud. If you would not say it to someone at a
desk beside you, rewrite it.

## The rules, and why each one is a tell

- **No bullet that is a commit subject with the type prefix stripped.** "Keep the
  contents tally and its scroll target honest" is a fine commit subject and says
  nothing to a reader: it names neither the symptom nor what they will now see.
  If a line reads like it was written by someone looking at a diff, it was.
- **No "we're excited to announce", no "we're thrilled".** The release is
  evidence of enthusiasm; stating it spends a sentence on the author's feelings.
- **No "under the hood", no "behind the scenes".** The phrase exists to give an
  invisible change a sentence. If a reader cannot see it, cut the line — do not
  introduce it.
- **No "various improvements", "numerous fixes", "and more", "plus bug fixes".**
  Unfalsifiable, and unfalsifiable is the signature. Name them or drop them.
- **No adjective doing a fact's job**: powerful, seamless, robust, blazing,
  delightful, significantly, greatly. Give the fact and delete the adjective.
- **No emoji in headings or bullets.** (An emoji that is *content* — the `💬`
  Vantage prints in an open-question tally — is fine, quoted as the app prints
  it.)
- **No restating the version in prose.** "Vantage 0.7.0 introduces…" wastes the
  first words of the release on something printed directly above them.
- **No passive construction hiding the actor.** "The theme is now remembered"
  leaves out the two facts in it: *your* choice, remembered *per browser*.
- **No padding.** One feature split into five parallel bullets to look
  substantial reads as five small things; written as a paragraph it reads as one
  real thing.
- **No number you cannot point at in the tree.** See below.

Several of these are refused outright, by the extractor, before a tag exists: a
missing, empty or headings-only section; one whose every line reduces to a stub
(`TBD`, `todo`, `…`); the phrases "various improvements", "misc fixes", "bug fixes
and other improvements", "this release includes", "we're excited", "under the
hood", "and much more", and a pasted "Full Changelog:" link; and a section that is
nothing but commit subjects. It names the phrase it found. Everything else on this
list is on you, and a check that cannot fire is not permission.

## What good looks like

- **Prose first.** A feature is a paragraph of two to six sentences that says
  what the reader can now do and what it fixes. A list is for items that are
  genuinely parallel and short — a set of unrelated fixes is a list; one feature
  is not.
- **Name the failure in the reader's terms.** "`t` could not find a file created
  after the page loaded" — not "the picker cached its list for the life of the
  tab".
- **Numbers only where they are real and checkable.** `3:1` is checkable: it is
  `CONTRAST_FLOOR` in
  [`frontend/src/lib/contrast.ts`](../../../frontend/src/lib/contrast.ts), held by
  two tests. A byte count measured once into a commit message is not checkable by
  the next person and does not go in.
- **Link the guide.** Anything with a page under
  [`userguide/`](../../../userguide/README.md) gets a relative link to it, in the
  repository's own style — relative path, no leading slash, extension included.
  `vantage-check` runs over this file's neighbors and a dead link or a dead
  anchor is a failure, so check the heading slug you are linking to rather than
  guessing it.
- **Keep the Keep a Changelog shape**: `## [<version>] - <YYYY-MM-DD>`, then
  `### Added` / `### Changed` / `### Fixed`, omitting the ones with nothing in
  them.

## Gathering the material honestly

1. Read `git log --oneline <last-tag>..HEAD` end to end, then read the bodies of
   the ones that look reader-visible. The bodies are where the reasoning is.
2. **Group by what a reader does**, never by subsystem and never in commit order.
   Twenty commits of Go and ten of TypeScript can be two features to a reader,
   and a reader does not know or care which of them were one pull request.
3. **Verify every claim against the working tree, not against the commit that
   made it.** Series here revise themselves: a built-in palette was named
   "Vantage" and renamed three commits later, a bookmark's storage location moved
   twice after the commit that introduced it. Read the code, or the
   [`userguide/`](../../../userguide/README.md) page, as it stands now.
4. **A claim you cannot verify does not go in.** Not hedged, not softened, not
   "improved". Out.

## Length

The ceilings are per item, because that is where padding actually happens:

- **A lead line: one sentence**, naming the two or three things the release is,
  and only when there is more than one. A single-feature release needs no lead.
- **A feature: one paragraph — six sentences and about 140 words at the outside**,
  plus the pointer to its guide. `0.7.0`'s color-theme paragraph sits on that
  line, and it is the largest feature in the release. If yours will not fit, you
  are describing the implementation.
- **A fix: one line.** Two sentences if the symptom and the cause are genuinely
  both needed.
- **The whole section: one or two screens.** `0.7.0` — three features, a
  behavior change and four fixes — is about 650 words, and that is the top of the
  range, not a target. A release with more words than that has something in it
  that is not a reader-visible change.
- **A patch release with two fixes is three sentences** and wants no subheadings
  at all.

Padding a thin release to look substantial is the failure mode this whole
document exists for. A three-sentence entry is a good entry.

## One worked example

Shipped in `0.3.0`, and a fair example of what to avoid:

```markdown
### Changed

- **Startup performance** — Significantly faster initial load with background
  tree fetching, repo caching, and loading gate.
```

Three faults. "Significantly" is standing where a number or a perceptible
difference should be. "Background tree fetching, repo caching, and loading gate"
are three implementation names, one of which ("loading gate") means nothing
outside the codebase. And there is nothing a reader can hold against their own
experience — they cannot tell whether this line came true for them.

The same change, if the tree confirms each clause:

```markdown
Opening a project no longer waits for its file tree. The document renders first
and the sidebar fills in behind it, so a repository with thousands of files is
readable as fast as a small one.
```

That is one claim a reader can check by opening a large repository. If the tree
turns out not to support the second sentence, the entry is the first sentence —
which is the whole method: **verify, then write what survived.**
