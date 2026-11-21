# Changelog

What changed in each release of Vantage, newest first. Releases before 0.7.0
are summarized one section per minor line; the commit log has the rest.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

**Scan one document with `vantage-check index --document <path>`.** It prints that document's entry in the planning index as JSON, reading no other file. See [one document's index](docs/reference/planning-index.md#137-one-documents-index---document).

**The planning page lists question ids that need fixing.** A new *Maintenance* kind, **Duplicate or stray id**, lists each id two questions declare and each id written in a question's title that its directive does not carry, with a link to where it is. No answer filed under such an id counts until the document is fixed. **Copy answers + maintenance** and `vantage-check index --request fix-ids` hand an agent the request to fix them.

### Changed

**The planning page has one button for updates: *Update · N*.** It replaces *Apply updates*, and pressing it also reads the listed documents' comments again, so it ends in what the server holds. *Reload from server* and its *Unknown* pill are gone: the page reads again by itself when the connection comes back, and when its reads have failed for 30 seconds the header says *Offline since HH:MM · retrying*, with **Retry now**. Update now waits while any answer box is open, and never closes one for you; it says *Close the open answer first — what you typed is saved*.

**Comments no question owns have their own section on the planning page.** The header's *M with unresolved ownership* control is gone. Those comments, and notes on text outside every question, are listed in **Comments without a question (N)**, after *Maintenance*, each with why it has no question and the text it was filed on, with **Attach to question…** and **Copy requests** as before. The section appears only when there is something in it.

**Slow-call log lines say where they were slow.** A slow request names its repository, and a slow git, file or checker call names its directory, so a server serving many projects shows which one is slow. `/api/perf/diagnostics` is unchanged.

### Fixed

**A question card no longer reads *Unknown*.** While an agent's edit is being read again, a card keeps the status it last read, adding *· checking* if the read takes longer than a second, and the header's counts keep their last values. A card on a document the scan could not check says why — *Not checked — scan refused*, *too large to scan* or *scan failed* — and a card whose id is declared twice or written outside a directive says *Id appears more than once* or *Id outside a directive*.

**The planning page catches up by itself after the connection drops.** A push the server sent while the connection was down was lost, and the comments it announced stayed out of date until the page was opened again or **Reload from server** was pressed. Now, when the connection comes back, including when a tab hidden for half a minute or more is shown again, the page reads every listed document's comments again. A read that fails is tried again after 1 s, then 2 s, and so on up to every 30 s, until it lands.

**The repository's *Folders* button on a phone-width planning page can be pressed again.** The header had no room for it and slid it under *Open sidebar*. At that width *Update · N* now shows its icon and count without the word, as the header's other buttons already drop theirs.

**An answer saved while its document was changing no longer loses its question for good.** When the server could not confirm the question an answer was filed under — an agent had just edited the document — it saved the answer with no question and forgot which one it was. It now keeps that id and the planning page attaches the answer to it on the next reading where the server can confirm it.

**A comment on text outside every question no longer reads as an error.** The planning page listed it among comments with *unresolved ownership* and offered to attach it to a question, as if it had been lost. It is now a *note*, with nothing to attach.

**Answers on a document an agent just edited no longer show as *not attached*.** Until the page re-read that document's comments, it listed every pending answer on it under the header's link control, as if they had lost their question. They are now listed nowhere for that moment, and the page shows the last reading it held until the read lands.

**A comment on a question's empty *Answer* no longer shows as "original text no longer found" the moment it is saved.** Every open question's empty answer reads the same, so a comment filed on one by clicking it, selecting it or pressing **Answer…** could not be told apart from the others and was drawn as lost. Those comments are now filed under their question's id, as **Take this leaning** already was. A comment already saved this way stays as it is; attach it with **Attach to question…** on the planning page.

**A question card no longer stays *Unknown* after an agent edits its document.** The page re-read a document's comments only when a comment changed, so an edit left them paired with the version before it, and the card read *Unknown* until the page was opened afresh; going back to it was not enough. Now an edit to a listed document re-reads its comments, and the card's status follows once the page shows the new version (after **Apply updates**, if it is holding updates back).

**Take this leaning, editing an answer and replying no longer wait on a scan of the whole project.** Proving which question an answer belongs to ran the checker over every planning document, which took 10–27 s on a project of about 700, and other writes to that document's review waited behind it. The server now scans only the one document. With a checker older than this release it falls back to the whole project, as before.

**A commit in one repository no longer slows every repository's recent files list.** A commit in any repository dropped every repository's cached list, so each open tab's next refetch walked its repository again, and tabs asking at once each ran their own walk. On a server with several busy repositories, 7,060 of these requests took over a second in a week. Now a commit drops only its own repository's list, requests that arrive together share one walk, and a tab no longer refetches its tree and recent files when another repository changes. The file tree's caches are likewise dropped only for the repository that changed.

## [0.12.0] - 2026-11-16

Keep records out of Ready and compaction with one frontmatter line, and fix answering, compaction, delivery and live updates.

### Added

**Keep a record out of Ready and compaction.** Add `planning-actions: none` to a live document's frontmatter, and it is no longer offered as ready to build, ready to graduate, or to fold into the ledger. Its questions, badges, stage and dependencies stay as they were. An invalid value is read as `all` and reported as a warning by `vantage-check`. On a done-role stage the key does nothing and is silent; on a roadmap it does nothing and is reported. See [planning documents](userguide/guides/planning.md).

**Compare five text transitions when a question rolls up.** In the planning
animation inspector, the **Text handoff** menu starts on the production title
glide and offers four alternatives: fading during or after the collapse,
sliding and fading, and shrinking and fading. Play or step through each with
the same card roll-up. These comparisons are read-only; choosing one does not
change the live planning page's transition.

**Build planning views from `vantage-md/planning`.** Your own tool can read the planning index, filters and agent requests the viewer uses, so it shows the same documents and questions.

### Changed

**Answered cards glide their title into the compact row.** The rest of the card
fades away as it rolls up. Green grows to a softer tint and stays afterward,
rather than flashing brighter and fading back. The main app has one fixed
transition, with no animation setting. With reduced motion, you see the finished
row and green immediately.

**`vantage-md` ships ES modules only.** Its CommonJS entry threw on import, so `require("vantage-md")` never worked; import it instead. `MarkdownViewer` takes `hideFrontmatter`.

**Apply updates reads as a label.** The Questions toolbar keeps its planning labels beside the primary controls, and a question with unresolved ownership explains itself in a tooltip.

**The checker catches two more misplaced questions.** `vantage/question-name` reports a question directive placed below its own heading, and one whose ID disagrees with the title of the question it attaches to.

### Fixed

**Reopening a comment editor no longer closes its editing session.** An editor
reopened while its session is starting keeps saving instead of reporting that
the comment was deleted. Confirming Discard also removes a new comment from
the document immediately.

**Questions toolbar controls stay put while ownership loads.** Resolving the
last unattached comment no longer shifts adjacent controls. On narrow screens,
**Reload from server** joins **Toolbar actions** instead of overlapping the
repository picker.

**Bound question comments highlight their own text even when another question
uses the same words.** A unique question id limits the search to that question.
Repeated matching blocks within it still remain unanchored rather than being
guessed from an old line. Compact rows also retain answers typed on question
bodies when you apply updates.

**Answers typed in an opened answered row appear before the save completes.** The card shows your typed answer while the save is in flight. An opened row has **Hide**, which returns it to its row.

**Review deliveries are consumed without waiting for file events.** A worker picks up each delivery when the inbox changes and retries every five seconds, so a response lands even when file watching stalls. A delivery still waiting is reported as unconfirmed, not as Vantage stopped. See [the review inbox](userguide/guides/review-inbox.md).

**Compaction requests skip retired documents.** `vantage-check index --request compact` and **To fold into the ledger** no longer list questions in documents whose stage has the done role.

**Back returns from a scoped document view.** Scoping the Planning page to one document from the outline keeps your filter and query, and **Back** restores them.

**Links to a compacted question keep working.** A question folded into a Decision Ledger row keeps its `#OQ-…` anchor on that row.

**Live updates stay connected during heavy logging.** Diagnostic log bursts no longer exceed the server's frame limit and close the connection.

## [0.11.0] - 2026-11-04

Answer planning questions from the document, restore or reattach answers, and
browse saved document stages in Overview.

### Added

**Answer an open question without finding the Review toggle.**
**Take this leaning** and **Answer…** appear while you read the document.
Confirm **Enter review mode** to continue that same action; Cancel leaves
review mode and comments unchanged. See [review mode](userguide/features.md#review-mode).

**Overview groups planning documents by their saved stages.** Switch from
**Questions** to **Overview** to browse stages, next steps, dependencies, and
recorded stage changes. Filter the tiles or collapse stages you are not reading.
It shows what documents claim, not verified implementation progress, and never
writes them. See [the Work overview](docs/reference/work-overview.md).

**Planning cards show when a question was handled elsewhere.** A prominent
status band distinguishes saved responses, recorded rulings, compacted questions,
and removed questions. Unverified evidence reads **Unknown**. Status updates do
not replace question text, disturb editors, or move cards. See
[late changes and Refresh](userguide/guides/planning.md#late-changes-and-refresh).

**Inspect the planning answer animation frame by frame.** Open
`/.vantage/planning-motion` and press **Play from start** as often as you like,
or use **First / Previous / Next / Last frame** to pause and step through it.
Frame 0 is the original question. Exact timing and animation details are optional.
The sample uses real cards and effects and changes no reviews. Answering now keeps
the question text visible while the card collapses, then reveals the compact row
at the end, instead of removing the text before the roll-up starts.

**Restore, delete, or attach planning answers.** Escape or × offers to restore
an existing answer's opening text while keeping replies, or discard a new answer
and its replies. Delete is separate. Comment on selections in question bodies
and verified headlines; comments with no proven owner offer **Attach to question…**.
See [planning review actions](userguide/guides/planning.md#leaving-an-answer-box-close-keeps-esc-asks).

**Reload reads the server without replacing what you are reading.**
**Reload from server** reports failed reads instead of treating them as no work.
**Newer than shown** marks edited questions; opening a row or unfolding a card
refreshes that card alone. Applying updates is blocked while an answer box holds
changes. See [late changes and Refresh](userguide/guides/planning.md#late-changes-and-refresh).

**Investigate a slow recent-files scan.** Its timeout warning links to saved
scan evidence. A deliberate bounded diagnostic ranks directory reads and offers
exclusion examples without changing visibility or writing ignore files. Timings
approximate current work, not the earlier Git command. See
[scan analysis](docs/reference/recent-scan-analysis.md).

### Changed

**Hide git metadata when you want a document-only header.** Settings →
**Show git metadata** controls the status, commit, age, and history link.
See [git integration](userguide/features.md#git-integration).

**The checker warns about questions it cannot index, not their length.**
Question-looking list items without a directive, and `OQ-` tables with a Leaning
or Answer column (not decision ledgers), now warn. `planning/question-length`
stays off, including in strict runs, unless explicitly enabled; its word threshold
remains configurable. Keep substantive setup and options. See
[checker configuration](userguide/guides/vantage-check.md#configuration).

**Server-only installs need the checker to refresh comment snapshots.**
Install `vantage-check` beside `vantage`, put it on `PATH`, or set `VANTAGE_CHECK`;
archives and Homebrew provide both. Without it, the server warns at startup,
preserves comments, and reports unverified ownership as **Unknown**. Saved text
for reply comparisons cannot refresh on edits or replies, even for ordinary
Markdown. See [installation](userguide/getting-started.md) and
[comment snapshots](docs/reference/comment-autosave.md).

### Fixed

**Review-mode changes preserve your reading position** through sidebar-induced
line wrapping, in both directions. Scrolling yourself immediately takes over.

**Rewritten questions no longer inherit another question's answer from an old
source line.** Placement, counts, and copied answers use verified identity;
duplicate or unverified identities remain unresolved. See
[question ownership](docs/reference/planning-ownership.md).

**Answered questions no longer inflate what needs you.** Roadmap counts and
`vantage-check index` count only open questions; ✅ questions belong solely under
**Maintenance → To fold into the ledger**. See
[the planning index](docs/reference/planning-index.md#62-sections-top-to-bottom).

**App pages no longer cache obsolete asset names.** Failed loading offers
**Reload this page** instead of a blank tab.

**A project with no configured name no longer becomes an unopenable blank row.**
It takes its directory's name, with a numeric suffix for collisions. See
[configuration](userguide/reference/configuration.md#example-config).

## [0.10.0] - 2026-10-09

The planning page becomes a to-do list of what needs you, every comment box
saves as you type, and `vantage-check` can ask an agent to fold answered
questions into their ledgers.

### Changed

**The planning page shows what needs you, and counts the rest.** *Needs you*
now holds only the questions waiting on your reply: 10 cards at a time, or 20,
30 or 50 if you choose, with no pages. Questions you have answered gather as
one-line rows at the top, and ✅ questions leave it. Answering a card shrinks
it to a row where it stands, and the next question joins the end. *Blocked*
and a new *Maintenance* group, which holds *Not on a roadmap*, *Ready to
build*, *Ready to graduate*, *Stage conflict* and the ✅ questions, are folded
until you open them. The section bar is gone, and the contents column is now
titled *On this page*. See [Needs you](userguide/guides/planning.md#needs-you).

**Nothing moves while you read.** An agent's reply, an answer you gave in
another tab or an edited document now marks what it concerns, such as **New
reply**, and is counted in the header as *3 updates · Refresh*. Press
**Refresh** to lay the page out again. See
[Late changes and Refresh](userguide/guides/planning.md#late-changes-and-refresh).

**Copy answers + maintenance** replaces Copy all agent requests. It copies
what Copy answers copies, then the agent requests for the kinds of maintenance
you check in its panel, which opens on hover or from its ▾. *Ready to build*
starts unchecked, so a copy never asks an agent to build something by accident.
See [Copy answers + maintenance](userguide/guides/planning.md#copy-answers--maintenance).

**The filter line says *18 match · 379 hidden*** in place of the notice that
repeated the filter. Press *379 hidden*, or ✕, to clear the filter, and Back
brings it back. Enter in the box now takes you to the results. See
[What the filter line says](userguide/guides/planning.md#what-the-filter-line-says).

**Every comment box saves as you type.** There is no Save and no Cancel, only
**Close**, and Esc or a click outside the box keeps your text instead of
throwing it away. A save that fails keeps retrying, and leaving the tab with
anything unsaved asks first. See
[Comment boxes save as you type](userguide/features.md#comment-boxes-save-as-you-type).

### Added

**`vantage-check index --request compact`** lists the ✅ questions and asks an
agent to fold each into its document's Decision Ledger. `--request` with no
name now prints all five requests. See
[`vantage-check index`](userguide/guides/vantage-check.md#vantage-check-index).

## [0.9.2] - 2026-10-08

### Fixed

- `vantage-check` no longer asks you to link a file that git ignores. If a
  committed document names a private, gitignored file — a local config file
  that exists on your machine and nowhere else — the checker used to flag that
  name on your machine and let it pass in a clean checkout. It now leaves the
  mention alone. A link you wrote to that file is still checked.

## [0.9.1] - 2026-10-06

### Changed

**A planning link from `vantage-check` opens its own project when one Vantage
serves several.** The `Planning page:` link that `vantage-check index --filter`
prints now ends with `&space=`, an id naming the checkout it ran in, and so
does `filter.link` under `--format json`. Put your Vantage's address in front
of the link and open it. In daemon mode, the page asks Vantage which project
holds that id and opens that project's planning page with the filter, with no
list of projects on the way. In 0.9.0 it listed every project's planning page
for you to pick from. A link made in a checkout your Vantage does not serve
says so, and in daemon mode only then shows that list. Pasting the line into
the Filter box works as before. See
[Filtered links](userguide/guides/planning.md#filtered-links).

**`index --filter` now writes `.vantage/space`.** The first run that prints a
link makes the file at the project root, holding the id, and later runs reuse
it. The checker keeps the id out of git, so that every clone gets its own.
When it makes `.vantage` itself, it also writes a `.vantage/.gitignore` that
ignores the whole directory. A `.vantage` that is already there with no
`.gitignore`, as the review inbox can leave one, gets one that ignores only the
id. A `.vantage/.gitignore` you already have is left alone, so make sure it
ignores `space`. A linked worktree gets an id of its own. A checkout copied
whole, `.vantage` included, shares the original's id, so a link from either
opens neither and the page lists both: remove `.vantage/space` in the copy. See
[What `--filter` writes](userguide/guides/vantage-check.md#what---filter-writes).

The checker and the viewer both need 0.9.1. Vantage 0.9.0 ignores `space=`
and lists each project's planning page as before, and a link from
`vantage-check` 0.9.0 has no `space=`.

### Fixed

- Moving between pages, such as from a document to the planning page with
  `g p`, no longer flashes the *Disconnected from backend* banner.
- A planning link written in a document, such as a `Planning page:` line in an
  agent's handoff note, opened as a path inside that document's project. It now
  opens the planning page.

## [0.9.0] - 2026-10-06

### Added

**A planning page filtered to one piece of work.** The planning page has a
**Filter** box at its top, there as soon as the page opens, and the page
narrows as you type. A word, such as `generator`, finds the questions whose id,
title, leaning or path holds it, ignoring case, and the documents whose path,
stage or `next` does. `path:` finds its text anywhere in a path, as GitHub's
code search does, with `*` and `**` as wildcards, and a leading `/` ties it to
the start of the path. `is:open` keeps only open questions, as in
`path:/docs/design/search.md is:open`, and a `-` before a term leaves out what
it matches. The page keeps its order, a notice says what the filter hides, and
a filter that keeps nothing says *Nothing matches* where the sections would be,
and why. See
[Filtering the page](userguide/guides/planning.md#filtering-the-page).

Press `/` to reach the box. Paste a link to a planning page into it, as a whole
address or as the line `vantage-check index --filter` prints, and the link's
filter, and its roadmap if it names one, apply at once to the project on
screen, whatever address the link was made for. The page's address follows the
box without adding to your history. **Copy answers** and
**Copy agent request** cover only what the filter keeps, and the agent request
names the filter on a `Filter:` line.

A planning document that holds a question now ends its Referenced by line with
*its questions on the planning page*, a link to the planning page filtered to
that document, unless its stage has the
[`done` role](userguide/guides/planning.md#stage-roles). Such a document that
nothing links to gets a line holding only that link where it had none: one with
no open question, or any in a repository where no roadmap routes. See
[Referenced by](userguide/guides/planning.md#referenced-by).

**`vantage-check index --filter`** takes the same text, prints only what it
keeps, and prints a `Planning page:` line for your agent to hand you.
`vantage-check style-guide` now tells agents to hand you that line when they
need your rulings. The checker cannot know the address you open Vantage at, so
the link starts at `/.vantage/planning`: press `/` on your planning page and
paste the line, or put your address in front. In daemon mode, where the link
names no project, the planning page with no project named, or one not found,
now lists a link to each project's planning page, keeping any filter. Run in a
linked worktree, `--filter` adds a line under the link saying that the page
shows the checkout your Vantage serves, which may not hold the documents as
they are in the worktree. If your `.vantage.toml` sets a `target` before 0.9,
another line says that an older Vantage shows every entry. Under a `target`
before 0.8, it says first that a Vantage that old has no planning page. With
`--format json`, the filtered sections are under a new `filter` key. Every
other key, `sections` included, is what it is without the flag, and the format
version stays 2.

`--filter` exits `2` on a filter it cannot read, such as one with an unclosed
quote, and on a `path:` or `-path:` term that matches no path. A word that
matches nothing is an empty answer and exits `0`. `vantage-check` 0.8.0 and
0.8.1 exit `2` with `unknown option for index: --filter`: run
`uvx vantage-check@latest`. Vantage 0.8.0 and 0.8.1 ignore the filter without
saying so: they show the whole planning page, or, in daemon mode, ask you to
choose a project. A later release may keep other entries for the same filter
text, so have your agent rerun `--filter` rather than keep an old link. See
[Handing the human a filtered planning page](userguide/guides/vantage-check.md#handing-the-human-a-filtered-planning-page).

### Fixed

- In daemon mode, `g p` and the sidebar's planning entry opened the wrong page
  for a project whose name holds `#` or `?`.
- On the planning page, the roadmap picker at the top of the contents column
  drew its focus ring cut off at the left edge.

## [0.8.1] - 2026-10-02

If your `.vantage.toml` sets a `target` before 0.8, such as `target = "0.7"`,
`vantage-check` no longer asks you to write `question` on an open question,
because a viewer before 0.8 offers its one-click answer only on an `oq`: it stops
warning on an `oq` (`vantage/oq-deprecated`), and tells a question with no
directive to take one (`vantage/oq-missing`). An `oq` on a 🔒 or ✅ question is
still an error. A checker before 0.8 ignores the `target` line, where 0.7.1
rejects `"vantage/oq-deprecated" = "off"`. See
[When Your Readers Are on 0.7](userguide/guides/vantage-check.md#when-your-readers-are-on-07).

## [0.8.0] - 2026-10-02

**Highlights.** Vantage 0.8 puts every open question in your design docs on one
page, in roadmap order, hands your answers to an agent in one copy, and serves a
whole folder of clones with `vantage ~/code`.

### Added

**The planning page.** Press `g p`, or run `vantage-check index`, to see what a
repository's planning documents still owe: questions that need a ruling, what
waits on what, and which documents are ready to build. Answer questions from
their cards, then hand the work to an agent with **Copy answers** or **Copy
agent request**. Links to planning documents get badges such as
`in-review · DESIGN · 💬 5`, and with several `roadmap.md` files the page lets
you pick one. See [Planning Documents](userguide/guides/planning.md).

**Inline SVG.** An `<svg>` wrapped in a `<div>`, with no blank line inside,
renders as a drawing. Colors written in `style` are dropped, so Inkscape and
matplotlib exports render black. GitHub and Vantage 0.7 drop the drawing, so
follow it with a `<!-- vantage: fallback -->` paragraph saying what it shows,
which only Vantage 0.8 hides. See
[Inline SVG](docs/reference/inline-markup.md#inline-svg).

**`question` replaces `oq`.** One `question` directive declares a question in
any state, and `oq` still works but is deprecated. Vantage 0.7 drops a
`question`, losing its one-click answer, so keep `oq` on open questions until
every reader is on 0.8, and turn its new warning off with
`"vantage/oq-deprecated" = "off"` under `[check.rules]`. Keep running the newest
checker meanwhile: 0.7.1 rejects that line and the new directives. See
[When Your Readers Are on 0.7](userguide/guides/vantage-check.md#when-your-readers-are-on-07).

**Answers by comment.** A comment on a question is its answer, whether you take
its leaning, use **Answer…**, or comment anywhere in it. The question then shows
as answered, in the document and on its planning card, and no longer counts as
needing you. See
[Planning Documents](userguide/guides/planning.md#a-comment-on-a-question-is-your-answer).

### Changed

**Unknown config keys.** An unknown `.vantage.toml` key no longer breaks the
server or the checker. `vantage-check` used to exit `2`, and the server ignored
the whole file over one in `[starred]`. From 0.8.0, a checker older than a
top-level `target`, the oldest release your readers use, refuses to run. See
[Keys From a Newer Release](userguide/reference/configuration.md#keys-from-a-newer-release).

**Your release in the review prompt.** The prompt's check command names it, as
`VANTAGE_VIEWER=0.8.0 uvx vantage-check <file>`, and so does the planning page's
agent request, so a later checker can write for the viewer you run. See
[How agents find out about it](userguide/guides/vantage-check.md#how-agents-find-out-about-it).

**Hand-written HTML.** It and Mermaid can no longer draw over Vantage's own
page. Vantage drops a `class` Markdown did not put there, a `style` whose
`display` is `contents` or unlisted, and a Mermaid diagram's `themeCSS` and font
families. `vantage-check` reports none of these. See
[Security](docs/reference/inline-markup.md#security).

**A folder of clones.** `vantage ~/code` serves each clone as its own project,
and the Markdown outside them as one more, when the directory is not inside a
git repository. Only `--one-project`, the old behavior, shows review comments
left on that Markdown. See
[Serve a directory of clones](userguide/getting-started.md#serve-a-directory-of-clones).

**A startup tip.** `vantage` started in a terminal mentions the background
service. `VANTAGE_NO_TIPS=1`, or `tips = false` in your config, turns it off.

**New checker findings.** Some can fail a CI job, so
[pin the checker](userguide/guides/vantage-check.md#in-ci) to take them when you
choose. `planning/depends-on-missing` and `vantage/question-name`, an `oq` on a
🔒 or ✅ question, are errors. The new warnings, which fail `--strict`, are
`planning/question-length`, `vantage/oq-deprecated`, `vantage/question-layout`
and `prose/inline-list`, on a paragraph that runs `(a) (b) (c)` together. Check
a file named `index` as `vantage-check ./index`, since `index` is now a command.

### Fixed

- A request for `docs/../.vantage/…`, or on macOS for any case of `.git` or
  `.vantage` such as `.GIT/config` (which can hold a token), read the real file.
  Vantage refuses both now.
- Review mode's **Copy** quotes each path, so a file name holding `$(…)` or a
  backtick cannot run a command.
- On a `vantage build` site, a heading's `#` link left an address that opened a
  blank page. Rebuild and redeploy to fix it; see
  [Page URLs](userguide/guides/static-sites.md#page-urls).
- On macOS, a large tree could use up the server's open files and stop it.
- A document reloaded when only its attributes changed, as Spotlight and backup
  tools do.
- A page in a project or folder named `api` showed a JSON 404 on a reload.
- The sidebar's recent files could miss or misplace a document just written.

### Contributors

Thanks to Eduardo Hidalgo ([@edus44](https://github.com/edus44)) for inline SVG.

## [0.7.1] - 2026-09-27

### Added

**`Shift+R` lists recent files across all projects,** as `r` does for the
current one, with each row's project name. See
[Recently Changed Files](userguide/reference/keyboard-shortcuts.md#recently-changed-files).

**`Alt+Enter` or `Ctrl+Enter` (`Cmd+Enter` on macOS) opens the highlighted row
of a picker in a new tab,** as do Ctrl-click and middle-click. See
[File Picker](userguide/reference/keyboard-shortcuts.md#file-picker).

### Fixed

- Build output (`target`, `build`, `dist`) and tool caches such as `.cache` and
  `__pycache__` are no longer listed, discovered or watched by default, so a
  build no longer exhausts inotify watches. Linked Git worktrees are left out
  too, so no tree shows twice. See
  [Ignore Files and Live Reload](userguide/reference/configuration.md#ignore-files-and-live-reload).

## [0.7.0] - 2026-09-23

Vantage now supports color themes and bookmarks, and reads per-project settings
from `.vantage.toml`.

### Added

**Pick a color theme under Colors in the settings menu:** six come with Vantage,
each with light and dark variants, and the default look is now called Slate.
Add your own as a CSS file in `~/.config/vantage/themes/`, or set
`theme = "gruvbox"` in your config to start every browser in one. See
[Color Themes](userguide/guides/themes.md).

**Click the star beside a document or folder to bookmark it in the Starred
section above the file tree.** Bookmarks are kept in
`~/.local/share/vantage/starred/`, not your browser, so every tab sees them, and
a project's `.vantage.toml` and your config can list pinned entries. See
[Starred](userguide/features.md#starred).

**A document's open questions appear under their headings in its table of
contents,** with a count beside **Contents**: `💬 1 ✅ 2` means one open and two
answered. See [Table of Contents](userguide/features.md#table-of-contents).

### Changed

**Settings follow you between tabs:** the sidebar and its width, the tree
filters, the project sort order, light/dark and the color theme. Review mode
does not, so a toggle in one tab cannot close the review pane in another.

### Fixed

- The file pickers reload their list each time they open, so a file created
  after the page loaded can be found without a reload.
- A document that fails to load, or a slow response for one you have left, no
  longer replaces the one you are reading.
- `vantage-check check --config <a directory>` says it is a directory and exits
  2, instead of printing a stack trace.

### Contributors

Thanks to [@nichiflu](https://github.com/nichiflu) for the initial color-theme
implementation.

## 0.6.x

_0.6.0 – 0.6.2, September 2026._

Long documents have a table of contents: the list button beside the breadcrumb
shows the headings in the left margin, and the button beside it lets the text
fill the pane.

- Serving a git repository no longer makes the browser reload once a second.
- A repository cloned under one of your `source_dirs` shows up within thirty
  seconds, with no restart. See [Daemon Mode](userguide/guides/daemon-mode.md).
- A port you name is bound exactly or startup fails. Only the default 8000 walks
  to the next free port.
- Images on adjacent lines render on one row, as on GitHub.

### Contributors

Thanks to Eduardo Hidalgo ([@edus44](https://github.com/edus44)) for the table
of contents, the Vantage favicon, and fixes to port selection and spurious
browser reloads.

## 0.5.x

_0.5.0 – 0.5.10, May to September 2026._

Vantage stopped being a Python server and became one Go binary. Install it with
`brew install`, `uvx vantage-md ~/notes`, or a platform archive from a release.
`vantage serve` opens your browser, and `--no-open` stops it.

- `vantage-check` is new. It reports dead links, dead anchors, broken Mermaid
  diagrams, and style problems. See
  [vantage-check](userguide/guides/vantage-check.md).
- `<!-- vantage: … -->` comments, which GitHub ignores, add status chips,
  collapsible sections, emphasis, and badges. GitHub's alert blocks render too.
- Review mode was rebuilt: a comment anchors to a whole block, replies thread,
  and agents reply through a `.vantage/` directory. See
  [The `.vantage/` directory](userguide/guides/review-inbox.md).
- The "What's New" popup, the changed-document highlight, and the jj history
  viewer were removed.
- `.vantageignore` and `~/.config/vantage/ignore` keep files out of the tree.

## 0.4.x

_0.4.0 – 0.4.2, April 2026._

`uvx vantage-md ~/notes` started the server and opened your browser at the
directory you named, a Homebrew formula arrived, and macOS became a tested
platform.

- Review mode became per file, and hovering a paragraph put a comment button in
  the gutter.
- You could edit a comment in place, and resolved comments collapsed into one
  indicator.
- `log_level` in the config and `VANTAGE_LOG_LEVEL` in the environment arrived,
  and the watcher warned near your inotify limit, the usual reason live reload
  stops.

## 0.3.x

_0.3.0 – 0.3.8, April 2026._

This line added review mode. You selected text in a document and left a comment,
which the server stored and marked "Outdated" when the text under it changed.
Each save in review mode snapshotted the previous version so you could step
back through revisions, and one button copied every comment as Markdown for an
agent.

- Opening a project no longer waited for its file tree.
- Headings got hover anchors, and `#L42` or `#L42-L50` in the URL highlighted
  those source lines.
- You could collapse the sidebar and show hidden or gitignored files.
- TOML frontmatter between `+++` fences was shown, with taxonomies as tag pills.
- A red banner appeared when the page lost its connection.

## 0.2.x and earlier

_0.0.1 – 0.2.0, February to March 2026._

Where Vantage started: a Python server for the Markdown in your git
repositories, reloading the page when you saved, with GitHub-flavored Markdown,
syntax highlighting, KaTeX math, Mermaid diagrams, commit history and diffs, a
fuzzy file picker on `t`, dark mode on `Shift+D`, vim-style scrolling, and
static-site export.

- `Shift+T` searched files across every project, `P` switched projects, `r` and
  `Shift+R` found recently modified files, and `y` copied the current file's
  path.
- `source_dirs` in the config found every git repository under a directory.
- The project picker became a full page.
