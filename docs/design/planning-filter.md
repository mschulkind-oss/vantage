---
title: "An agent's planning link is a filter the human could have typed"
date: 2026-10-05
status: accepted
stage: BUILT
next: "Graduate into docs/reference/planning-index.md with the sketch beside this file, then delete both"
tags: [planning, vantage-check, agents, url, forward-compatibility]
summary: "A planning filter is one line of text, such as path:docs/design/x.md is:open, that the planning page's Filter box, its filter= URL parameter and vantage-check index --filter all read with one parser. It hides entries of sections derived from the whole index and never reorders them. A release that cannot read every term shows every entry and says why. The checker prints a root-relative link to the filtered page, which the human pastes into the Filter box or puts their address in front of."
---

# An agent's planning link is a filter the human could have typed

**Status:** 2026-10-05 (`d22eedc`). Built, with every ruling in the [Decision Ledger](#decision-ledger): the filter module the page and the checker share, `index --filter`, the filter line with `/` and the pasted link, and Referenced by's link. The user guide, the checker's help and the style guide teach it. Where the build chose what this design delegates, or departed from a line of it, the sketch's [As built](planning-filter-plan.md#as-built) says. MEASURED: in Chromium on the e2e fixture, a cold filtered link and an Enter in the box shift nothing painted and leave `history.length` as it was, and a filtered visit then cleared makes at most two review requests (`frontend/e2e/planning_filter.spec.ts`). UNMEASURED: the no-long-task half of [criterion 8](#15-success-criteria), since a cold dev-server load showed 2 to 5 long tasks of up to about 180 ms that no run could pin on the filter; D6 and D12 on a large index; a 0.8.x viewer given a filtered link, which is the written model of [§10.4](#104-how-p0-is-checked), not a run; the filter line with assistive technology; and how accurately agents write the grammar. [§3](#3-what-exists-today) describes `db5c01f`, the tree `v0.8.1` was cut from. The path dialect ([§5.4](#54-path-patterns)) was probed against the port in `patterns.ts` and against git 2.55.0. This design merges three proposals and the reviews of them.

> **In short.** The link an agent hands over and the text a person types are the same thing: one **planning filter** that the Filter box, `?filter=` and `vantage-check index --filter` read with one parser. It only hides entries of sections derived from the whole index, and a release that cannot read all of it applies none of it, which is what keeps every key added later safe.

**Why it matters.** You asked to be handed "all of the questions I need to answer" for one feature. In 0.8.1 the planning page shows every entry in the repository, nothing on it filters, and the checker cannot learn the address you open Vantage at ([§3](#3-what-exists-today)).

**The shape.** A parser and predicate in `vantage-md`'s planning module, applied after the sections are derived. The page reads and writes `filter=` and draws a filter line. The checker takes `--filter` and prints a root-relative link, which the Filter box applies when it is pasted in. A document's Referenced by line links to the page filtered to that document.

**Cost.** `filter=`, `--filter`, the `path:` dialect and `is:open` become permanent notation the day they ship. The page gains a row, and Referenced by a link. A 0.8.x viewer opens a filtered link unfiltered, without saying so ([§10.1](#101-older-readers)).

**Start at [§5](#5-the-filter-language):** the language. The page, the checker and the link all follow from it.

**Needs your ruling:** None. Every question is ruled ([Decision Ledger](#decision-ledger)).

**Reads with:** [`planning-index.md`](../reference/planning-index.md) (the planning page and `index` this extends; its principles P1 to P7 are cited by number), [`checker-version-skew.md`](checker-version-skew.md) (P0, which decides what this release does with text it cannot read), [`agent-cli.md`](../reference/agent-cli.md#11-principles) (P1, which is why the checker cannot ask the server for an address). The implementation sketch is [`planning-filter-plan.md`](planning-filter-plan.md).

---

## 1. Verdict, and the principles

**Build one filter text and give it three readers.** The Filter box on the planning page, the `filter` URL parameter and `vantage-check index --filter` all take the same string and read it with the same code. A link the agent prints is therefore a filter the human could have typed, and one the human typed is the text the agent's `--filter` takes. That is your "not some private filter thing", made literal: the filter has no state anywhere except its text.

The first release reads `path:` and the one value `is:open` ([OQ-PF1](#decision-ledger)). Everything else a person might type is visibly not understood, so a later release can give it a meaning without changing one. Applying the terms a release understands and dropping the rest looks kinder, and it is wrong: dropping a term can hide entries as soon as anything can be OR'd in. So this release applies all of a filter or none of it ([F3](#1-verdict-and-the-principles)).

The principles below are numbered F1 to F6 *(coined here)* so later sections can cite them. They apply the planning reference's [P1 to P7](../reference/planning-index.md#11-principles) and the skew design's [P0](checker-version-skew.md#1-verdict-and-the-principles) to a filter.

- **F1. One text, three readers.** The box, `filter=` and `--filter` read one string through one parser in `packages/vantage-md/src/planning/`. The page reads and writes the URL only in `planningPages.ts`, beside `roadmap=`. The parameter's name, and the link the checker prints, come from the planning module (planning-index P4 and P7; AGENTS.md's "one implementation, three consumers").
- **F2. Filter after derivation, and only remove.** The filter applies to sections derived from the **whole** index. It keeps their order, and it never reaches into the index, the scan worker or the scan cache.
- **F3. All or nothing.** A filter holding any term this release does not understand is not applied at all. The page shows every entry and names the term, and the checker exits 2. Every release that cannot read a filter therefore fails the same way, by showing more, and from this release on it also says so.
- **F4. The filter's only state is its text.** Nothing is stored. Every control that changes the filter writes text into the box, and the URL outranks anything remembered ([planning-index.md:205-207](../reference/planning-index.md#L205-L207)). The roadmap the page shows is its own choice, as it is today, and not part of the filter.
- **F5. The page and the checker agree on what a text means, and the checker is stricter.** This is the `--roadmap` split ([`commands/index.ts:143-167`](../../packages/vantage-check/src/commands/index.ts#L143-L167)). Where the page falls back and says why, the checker exits 2: a not-understood filter shows every entry, and an unmatched term keeps nothing.
- **F6. No address is guessed or kept.** The checker never contacts a server, and nothing stores the address the human opens Vantage at. Its link is always root-relative, and the page's Filter box applies it when it is pasted in ([§9](#9-handing-the-human-a-link)).

## 2. Terms

Every row below is coined here. Terms this document uses without defining are the planning reference's ([§2](../reference/planning-index.md#2-terms)): *section*, *frame*, *section bar*, *page* (of a section), *page inputs*, *agent request*, *chosen roadmap*, *routed*, *stage role*, *answered by a comment*. An **entry** is one item a section lists, either a question's card or a document's row. That reference uses the word this way without defining it. A question that only another roadmap routes is in no section, so it is counted, never an entry.

| Term | Means | Is not |
| :--- | :--- | :--- |
| **Planning filter** | One line of text deciding which entries of the planning page's sections are shown. It is the same text in the Filter box, the `filter` URL parameter and `index --filter` | A search: it never ranks or reorders (planning-index P5). Not a saved view, nor the roadmap choice. Not review mode's take filter, which [planning-index.md:1036](../reference/planning-index.md#L1036) also calls a filter, nor the file picker's fuzzy filter |
| **Filter term** (a *term*, for short) | One piece of a planning filter, split at white space outside double quotes. The only form this release understands is `key:value` | A section id, or a line of a gitignore file |
| **Key** | The word before a filter term's first `:`. This release reads two, `path` and `is`, in lowercase | A frontmatter key, a `.vantage.toml` key, or a key on the keyboard |
| **Keep** | A term *matches* a path or a question. A filter *keeps* a question or a document row when, for each key it uses, one of that key's terms matches it. A **kept entry** is a kept item a section lists | Routing: a kept entry has nothing to do with which roadmap links it |
| **Kept document** | A path that one of the filter's `path:` terms matches, or every path when the filter has none. A kept document can have no kept entries | A kept entry |
| **`is:` value** | A question's state as the index reads it from the marker. `open` keeps a marker holding neither 🔒 nor ✅: 💬, 💬 🤷 or none. It is the only value this release reads ([OQ-PF1](#decision-ledger)) | *Answered by a comment*: the index reads no comments, so `is:open` keeps a question you answered on the page |
| **Not understood** (filter) | A filter holding at least one term or form this release gives no meaning ([§5.5](#55-what-this-release-does-not-understand)). It is not applied at all | An empty filter. Not a filter with an unmatched term, which is applied. Not the page's refusal past `max-candidates` |
| **Unmatched term** | A `path:` term that matches no path the index lists | A term that keeps a document with no entries, such as a `CURRENT` reference |
| **Canonical text** | The one spelling of a filter that the page writes back and the checker echoes ([§5.6](#56-canonical-text)) | The text as typed |
| **Filter line** | The fixed-height row at the top of the planning page that holds the Filter box ([§7](#7-the-filter-line)) | The frame, or the header |
| **Filter notice** | The sentences, shared by the page and the checker, saying a page is filtered and what that hides ([§6.7](#67-the-filter-notice)) | The box |
| **Planning link** | A URL to the planning page that carries a planning filter, as `--filter` prints it | The address bar after a flip, which may also hold page parameters |
| **Root-relative link** | A planning link that starts at `/.vantage/planning`, with no scheme, host or port, because the checker does not know them. The common name for what [RFC 3986 §4.2](https://www.rfc-editor.org/rfc/rfc3986#section-4.2) calls an absolute-path reference | A relative Markdown link. It is never resolved against the page it is opened from |
| **Pasted link** | A planning link, whole or root-relative, pasted into the Filter box on its own or inside the lines the checker prints around it ([§7](#7-the-filter-line)). The box applies its filter at once | Filter text: `filter=` and `--filter` never read a link |

When a second document needs one of these terms, it moves to the reference's term table and both link there.

## 3. What exists today

- **Nothing filters the planning page.** It has no text input, and nothing in `vantage-md`'s planning module takes a predicate. `derivePlanningSections(index, {roadmap})` has one option ([`sections.ts:406`](../../packages/vantage-md/src/planning/sections.ts#L406)).
- **The URL holds the section ids and `roadmap`.** That is one page number per section (`needs-you`, `unrouted`, `waiting`, `ready`, `graduate`, `disagrees`, `skipped`, `could-not-read`; [`guide.ts:25-34`](../../packages/vantage-md/src/planning/guide.ts#L25-L34)) plus `roadmap=`. Every change the page makes is a replace navigation: the canonical rewrite ([`PlanningPage.tsx:1155-1166`](../../frontend/src/pages/PlanningPage.tsx#L1155-L1166)), flips, and a roadmap pick, which also drops `needs-you` ([`planningPages.ts:413-421`](../../frontend/src/lib/planningPages.ts#L413-L421)).
- **Every other parameter is kept and ignored.** `pageSearch` leaves "every other parameter, and the order of those it keeps" alone ([`planningPages.ts:423-445`](../../frontend/src/lib/planningPages.ts#L423-L445)), and a test pins `q=1&unrouted=3` as needing no rewrite ([`planningPages.test.ts:294`](../../frontend/src/lib/planningPages.test.ts#L294)). So a 0.8.0 or 0.8.1 viewer opened with `?filter=…` shows the whole page and says nothing.
- **Derivation reads documents a filter would hide.**
  - A `depends-on` target missing from the index never waits ([`sections.ts:391-399`](../../packages/vantage-md/src/planning/sections.ts#L391-L399)).
  - Routing needs every roadmap and its link targets. With no roadmap that routes, *Needs you* is every open question by document and *Not on a roadmap* does not exist ([`sections.ts:437-440`](../../packages/vantage-md/src/planning/sections.ts#L437-L440)).
  - So filtering the index before deriving would move blocked documents out of *Blocked*. With the roadmap filtered out too, which `path:docs/design/x.md` does, *Needs you* would lose roadmap order and its ✅ questions, and the page would show a false *No roadmap* notice.
- **The page's state has three identities that know nothing of a filter.** These are the `sectionsOf` cache keyed by index and roadmap ([`planningPages.ts:302-324`](../../frontend/src/lib/planningPages.ts#L302-L324)), `inputsKey` ([`usePlanningPageInputs.ts:123-129`](../../frontend/src/hooks/usePlanningPageInputs.ts#L123-L129)), and the frame, which re-derives its sections from the shown layout's roadmap ([`PlanningPage.tsx:1417-1422`](../../frontend/src/pages/PlanningPage.tsx#L1417-L1422)).
- ***Needs you* is not "open questions".** Under a roadmap that routes, it holds 💬 and 🤷 questions and also ✅ ones waiting for compaction ([`sections.ts:337-341`](../../packages/vantage-md/src/planning/sections.ts#L337-L341)). A feature's open questions can also sit under *Not on a roadmap*, or on another roadmap, where no section lists them.
- **`index` refuses paths, and an older checker refuses new flags.** "A path would be a second answer to a question the root already settles" (`cli.ts:158-161`). An unknown option exits 2 ([`cli.ts:250-254`](../../packages/vantage-check/src/cli.ts#L250-L254)), while a variable it does not read goes unnoticed ([`useReviewStore.ts:1173-1187`](../../frontend/src/stores/useReviewStore.ts#L1173-L1187)).
- **Nothing tells an agent the server's address, and the checker may not ask.** "The filesystem is the only channel" ([`agent-cli.md` P1](../reference/agent-cli.md#11-principles)). The default port falls forward when busy (`serve.go:291-335`). Daemon mode adds a repository segment, which `planningPath` does not encode ([`planningRoute.ts:17-22`](../../frontend/src/lib/planningRoute.ts#L17-L22)) and the startup tip does (`tips.go:200-201`). Tunnels and jails make the agent's `localhost` a different machine from the human's.
- **`compat-previous` cannot see any of this.** It renders notation through the previous *published* `vantage-md`, and the planning module is deliberately unpublished. The precedent for an older app's behavior is a hand-written model: `questionOffersTake` models 0.7.1's review mode ([`notation.ts:53-56`](../../frontend/src/compat/notation.ts#L53-L56), [`notation.ts:117-133`](../../frontend/src/compat/notation.ts#L117-L133)).

## 4. Non-goals

- **Not a search.** It never ranks, sorts or reorders, so roadmap order survives every filter (planning-index P5).
- **Not stored.** There is no remembered last filter, no named filters in `.vantage.toml` and no preference. A filter lives in a link and in the box, nowhere else.
- **Not across repositories**, in daemon mode included ([planning-index.md §17](../reference/planning-index.md#17-non-goals)).
- **Never filled in from the document the reader came from.** `g p` on a document opens the bare page, as it already chooses the roadmap without regard to that document ([planning-index.md:2409-2411](../reference/planning-index.md#L2409-L2411)).
- **Nothing beyond index facts.** It never matches question bodies, comments, frontmatter `title` or `tags`, or anything else the index does not hold. Counts and page bounds therefore stay exact at first paint ([S1 and S2](../reference/planning-index.md#12-principles-at-scale)).
- **No link-graph keys and no `depends-on` closure.** Over this repository's 19 planning documents before this one, the transitive link closure of a single design reached 16 of them.
- **No selection of one question by id.** Ids are unique only within a document, so `#` stays free.
- **No merging of roadmaps.** A filtered page still lists only the chosen roadmap's *Needs you*; questions other roadmaps route are counted and named, never interleaved ([planning-index.md §17](../reference/planning-index.md#17-non-goals)).
- **No evaluation on the server.** Go is unchanged, and the server still parses no Markdown.
- **No pushing a filter to an open page** through `.vantage/inbox`. An older server would consume the message and report `delivered:`.
- **No new route to stop older viewers**, and no filter in a static export, which has no planning page.
- **No change to unfiltered output.** `vantage-check index` without `--filter` prints the same bytes as today, in text, in JSON and with `--request`.
- **Not task state.** There are no "done" or "seen" marks: what is left is what the filter keeps.

## 5. The filter language

### 5.1 One parameter, one flag, one box

- **The URL parameter is `filter`, and the flag is `--filter`.** The parameter collides with no section id and not with `roadmap`.
- **Why not `q`.** `q=1` is the test fixture for an unknown parameter (`planningPages.test.ts:294`). Also, the parameter, the flag and the box's label should be one word a person reads three times.
- **Given more than once,** the values join with one space, in order. That is exactly what typing both into the box gives.
- **An empty or all-whitespace value is no filter.** The page then removes the parameter, so an unfiltered URL never carries one, and the e2e specs' anchored URL patterns stay true.

### 5.2 Grammar

```text
filter   = [sp] [ term *( sp term ) ] [sp]
sp       = 1*( SP / HTAB / CR / LF )
term     = key ":" value
key      = "path" / "is"                    ; lowercase only
value    = pattern / quoted                 ; after "is:", only the values the keys table lists
pattern  = 1*pchar
pchar    = ALPHA / DIGIT / "." / "_" / "-" / "/" / "*"
quoted   = DQUOTE 1*( qchar / "\" DQUOTE / "\" "\" ) DQUOTE
qchar    = any code point except DQUOTE, "\" and the excluded code points
```

Text the grammar does not produce is not understood, and so is text it produces that [§5.5](#55-what-this-release-does-not-understand) lists. To name a term, in the notice or in an exit-2 message, the text is split at white space outside double quotes, and an unclosed quote runs to the end of the text.

### 5.3 Keys, and how terms combine

| Key | Matches | Entries it can keep |
| :--- | :--- | :--- |
| `path:<pattern>` or `path:"<literal>"` | The entry's path. For a question that is its document's path. For a Blocked row, a stage row, a Too large or an Unreadable entry, it is the row's own path | Every kind |
| `is:open` | A question this release reads as open: its marker holds neither 🔒 nor ✅, so 💬, 💬 🤷 or no marker ([`scan.ts:352-361`](../../packages/vantage-md/src/planning/scan.ts#L352-L361)) | Questions only |

`open` is the only `is:` value this release reads ([OQ-PF1](#decision-ledger)). Any other, such as one for ✅ or 🔒 questions, is not understood, and can come later under a name chosen then ([§10.3](#103-how-a-key-is-added-later)).

- **Terms with the same key are OR'd.** A document has one path and a question has one state, so an AND of two `path:` terms would almost always be empty without saying so.
- **Different keys are AND'd.** `path:docs/design/x.md is:open` keeps x's open questions.
- **An `is:` term keeps no document row.** It drops the Blocked document rows, the stage rows, Too large and Unreadable. A document row has no question state for it to match.
- **This rule is fixed for every later key.** Same key OR, different keys AND, so a key added later arrives without reopening how terms combine.
- **An `is:` value is a reading of the marker, and it is frozen.** It keeps every question whose marker this release reads as that state, refinements included. A state a later release adds must carry 🔒 or ✅ in its marker, as `🔒 ⏸` does ([`notation.ts:22-27`](../../frontend/src/compat/notation.ts#L22-L27)), so `is:open` never keeps one. A later state gets a value of its own, which a later value for its parent state also keeps.
- **`is:open` keeps a question you answered with a comment.** The index reads no comments, so the card stays, under its section's *(N answered)* count ([`planning.md`, A comment on a question is your answer](../../userguide/guides/planning.md#a-comment-on-a-question-is-your-answer)). That collision is also why a later value for ✅ questions can never be `answered`: the page already calls a question you commented on *answered*.
- **`path:<doc> is:open` is "every question I need to answer"** for `<doc>`. It keeps the 💬 and 🤷 questions under *Needs you* and under *Not on a roadmap*. It counts those on other roadmaps, and the notice names each of those roadmaps ([§6.7](#67-the-filter-notice)). It leaves out ✅ questions, which are the agent's to compact, and 🔒 ones, which cannot be answered yet, and the notice says how many 🔒 it left out. Under `path:` alone the same link also lists the document's rows and its ✅ questions.

### 5.4 Path patterns

A pattern is a **strict subset of gitignore patterns**. Every bare form it accepts means what it means in git, except one leading `./`, which means the root, as `roadmap=` already reads it ([`planningPages.ts:333-337`](../../frontend/src/lib/planningPages.ts#L333-L337)). A bare pattern runs through the port Vantage already has ([`compileIgnorePatterns`, `patterns.ts:103`](../../packages/vantage-md/src/planning/patterns.ts#L103)). A quoted one cannot, and has a comparator of its own (below).

| Form | Keeps |
| :--- | :--- |
| `path:docs/design/agent-bootstrap.md` | That file. A `/` before the last character anchors it to the root, as in git |
| `path:color-themes.md`, `path:*themes*` | That name at any depth. With no inner `/`, it is unanchored, as in git |
| `path:/roadmap.md` | Only the root's file: a leading `/` anchors. A file at the root is named this way, because `path:roadmap.md` also keeps `x/roadmap.md` |
| `path:docs/design` or `path:docs/design/` | Everything under that folder |
| `path:docs/design/checker-version-skew*` | Both the design and its `-plan.md`. A `*` stays within one segment |
| `path:docs/**/*.md` | Any depth below `docs`. A `**` segment crosses segments |
| `path:"docs/my notes.md"` | The same anchoring and folder rules, with every character literal: no wildcards, and spaces allowed |

- **How a bare pattern is evaluated.** An anchored pattern is given to the port with a leading `/` added, and an unanchored one as written. A `/` only at the end does not anchor, as in git: `path:docs/` keeps a `docs` folder at any depth, and `path:/docs/` only the root's. With the `/`, the port anchors exactly as git does. Probed on 2026-10-05:
  - `/docs/design/agent-bootstrap.md` does not match `x/docs/design/agent-bootstrap.md`.
  - `/docs/design` matches `docs/design/a.md`, and not `docs/designx/a.md`.
  - `/docs/**/*.md` matches `docs/a.md`, and not `x/docs/a.md`.
  - `/docs/design/*.md` does not match `docs/design/sub/a.md`.
- **Where the subset stops, and why.** The port's quirks would become URL notation for good (`patterns.ts:10-19`):
  - `?` is literal.
  - `[ ] ( ) { } + | ^ $` keep their RE2 meaning, so `docs/c++.md` cannot match itself (probed).
  - A pattern with an inner slash is unanchored, so `docs/design/x.md` also matches `x/docs/design/x.md` (probed). The filter anchors it instead.
  - A leading `#` is a comment, and a leading `!` negates.

  Probing the port against `git check-ignore --no-index` found five more forms on which they disagree, each with the filter's leading `/`:
  - **A `**` that is not a whole segment.** `/docs/**x` keeps `docsx`, outside `docs/`, and `/docs/***` keeps `docsfoo`. Git reads such a `**` as one `*`.
  - **A trailing `/**`.** The port keeps the path before it as well, so `/docs/*/**` keeps `docs/a.md`, which git does not. A trailing `/` says "everything under" without the quirk.
  - **Two `**` segments in a row.** `/**/**/a.md` misses a root `a.md` that git keeps.
  - **A trailing `**/`.** Git reads `docs/design/**/` as every folder below `docs/design`, while the port matches nothing.
  - **`/` alone.** The port keeps every path and git none.

  None of these characters or forms is understood ([§5.5](#55-what-this-release-does-not-understand)), so each stays free for a later release to define. With them out, a differential run on 2026-10-05 of 5,256 generated patterns over 19 paths found no disagreement between the port and git.
- **A quoted value is a literal, compared by a comparator in the filter module.** The port cannot match a literal: it trims spaces at both ends, reads a leading `#` or `!`, and gives `[ ( { + | ^ $ \` their RE2 meaning (probed: `" a.md"` matches `a.md`). So a quoted value is compared code point for code point, under the bare form's anchoring and folder rules, defined once:
  - With a leading `/`, or a `/` before its last character, it keeps the path equal to it and every path under it.
  - With neither, it keeps every path one of whose segments equals it.
  - A trailing `/` keeps only paths under it.

  Wherever [§5.6](#56-canonical-text) rule 3 writes a quoted value bare, the fixture pins that the comparator and the port agree.
- **Compared as typed.** There is no case folding and no Unicode normalization: an NFD spelling does not keep an NFC path. Matching is case-sensitive, as the index's paths and `[planning] include` are, and as git is with `core.ignorecase` off; macOS and Windows turn it on by default. Whatever ships is frozen, and only the case-sensitive choice leaves a case-folding key possible later.
- **Following the port, within the fixture.** The bare dialect shares its engine with `[planning] include`, which keeps the port in step with Go's library (`patterns.ts:21-22`). It does not promise to agree with `include`, because the filter anchors an inner-slash pattern and `include` does not. The fixture of [§10.4](#104-how-p0-is-checked) lists every construct the subset accepts: a literal, a leading `/`, a trailing `/`, `*` within a segment, a leading `**/` and an inner `/**/`, each with paths that tell git's answer from a wrong one. If a change made for `include` ever alters one of those answers, the filter keeps a frozen copy of today's port instead of following it.

### 5.5 What this release does not understand

Each of these makes the whole filter **not understood** ([F3](#1-verdict-and-the-principles)):

- **A key other than `path` or `is`**, case variants such as `Path:` included, and `is:` with a value [§5.3](#53-keys-and-how-terms-combine) does not list.
- **A term with no `:`.** That covers bare words, `OR`, `AND`, `NOT`, parentheses and quoted words.
- **A term that starts with `-` or `!`.**
- **An empty value** (`path:`) and an unclosed quote.
- **In a bare pattern:**
  - any character outside `A–Z a–z 0–9 . _ - / *`, so a path with any other character is written quoted;
  - a `**` that is not a whole segment, which covers any run of three or more `*`;
  - a trailing `/**` or `**/`, and two `**` segments in a row;
  - no character other than `/` and `*`, as in `/`, `*` or `/**`.
- **In either form:** two `/` in a row, and a `.` or `..` segment other than one leading `./`.
- **In a quoted value:**
  - a `\` followed by anything but `"` or `\`;
  - a value that is only `/`;
  - an **excluded code point**: a control or an invisible format character. They are listed as a fixed table in the filter module (U+0000 to U+001F, U+007F to U+009F, U+00AD, U+061C, U+180E, U+200B to U+200F, U+202A to U+202E, U+2060 to U+206F, U+FEFF), never read from the engine's Unicode tables, so a browser and the checker agree on every one.
- **Too long:** more than 64 terms, or more than 2,048 code points. Both limits are constants in the filter module, and tests configure them down rather than building long inputs.

A not-understood filter is never rewritten, never partly applied and never read as text. The page keeps it in the URL and the box exactly as written, so it can be fixed ([§10.2](#102-this-release-given-what-it-does-not-understand)).

### 5.6 Canonical text

The page rewrites an understood filter to its canonical text in place, as one replace. The checker echoes the same text.

1. Each term is written by the rules below. The terms are then joined by one space, in the order written, and a repeat of an earlier term is dropped.
2. In a bare or quoted value, one leading `./` becomes `/`. A leading `/` is then dropped when what remains still has an inner `/`, since the meaning is the same: `./docs/x.md` and `/docs/x.md` become `docs/x.md`, and `./roadmap.md` becomes `/roadmap.md`.
3. A quoted value is written bare when every character in it is a pattern character other than `*` and the bare form is understood.
4. Inside quotes, only `"` and `\` are escaped.
5. No terms means no parameter.

A filter that Vantage or the checker generates names each document as `path:/<its path>`, so rule 2 keeps the `/` exactly where a bare name would otherwise match at any depth.

The canonical text holds no control characters, so it can sit in any newline-joined cache key. **A later release must produce the same canonical text for every filter this one understands.**

## 6. What a filter does to the page

### 6.1 Where it applies

The page derives the sections over the whole index, under the chosen roadmap, exactly as today. The filter then takes them in and returns sections of the same shape with entries removed and none reordered. Every consumer that already reads sections picks the filter up unchanged: the layout, the pagers, the outline, the section bar and the agent request, which reads the unfiltered sections for one fact ([§6.3](#63-blocked-on-reads-the-unfiltered-sections)). Blocked still names blockers the filter hides, and routing still uses roadmaps it hides, because neither is recomputed.

### 6.2 Every section and every whole-index value

| Value | Under a filter, on the page and in `filter.sections` |
| :--- | :--- |
| Every section's entries: *Needs you*, *Not on a roadmap*, *Blocked* (both kinds), *Ready to build*, *Ready to graduate*, *Stage conflict*, *Too large*, *Unreadable* | The kept entries, in the same order. A section the filter empties is not shown, as an empty section is not shown today |
| Section bar, section headings, pagers, page bounds, outline | From the filtered sections. Page bounds still come from index facts alone, so they are exact at first paint |
| `onOtherRoadmaps`, and the "N more on other roadmaps" line | Kept questions only. They stay counted questions, never entries, and the filter notice names each roadmap that holds them ([§6.7](#67-the-filter-notice)) |
| Each roadmap's `needsYouCount`, the picker's "(N need you)" and the page's recount of it | Counted over kept questions. The recount ([`planningAnswers.ts:171-179`](../../frontend/src/lib/planningAnswers.ts#L171-L179)) applies the same predicate |
| The roadmap list, each roadmap's state, `chosenRoadmap`, `stagesDeclared` | Unchanged. A filter never changes which roadmap is chosen: the URL's, then the remembered one, then the default |
| `nothingNeedsYou` ([`sections.ts:468`](../../packages/vantage-md/src/planning/sections.ts#L468)) | True when no open question in a live document is kept: today's rule with the filter applied, so a kept question on another roadmap counts. The frame's *Nothing needs you* then reads *Nothing this filter keeps needs you* |
| The head-of-sections line saying every open question has your answer | Over kept questions |
| A Blocked document row | Kept when a `path:` term matches the row's own path, with every blocker still named and linked, because the row comes from the whole derivation. An `is:` term drops it. Either way, the notice names each blocker the filter leaves out ([§6.7](#67-the-filter-notice)) |
| The roadmap notice, the no-stages notice, the refusal past `max-candidates` | Unchanged: they are facts about the repository |
| Copy answers | Kept questions only ([§6.6](#66-copy-agent-request-and-copy-answers)) |

The checker's JSON keeps `sections` unfiltered and carries these values as `filter.sections` ([§8.3](#83-output)).

### 6.3 Blocked-on reads the unfiltered sections

An agent request annotates a *Ready to build* or *Ready to graduate* row with what it is blocked on. When any row is so annotated, it adds "Skip any entry marked blocked". `blockedOn` finds that by scanning the sections' Blocked entries for the row's path ([`guide.ts:458-476`](../../packages/vantage-md/src/planning/guide.ts#L458-L476)).

A Ready document can still hold 🔒 questions: *Ready to build* excludes only open ones ([`sections.ts:473`](../../packages/vantage-md/src/planning/sections.ts#L473)). So a filter that keeps the row and drops its 🔒 entries would erase the annotation, and the agent would be told to build something that still waits.

The rule is therefore that **the request's blocked-on facts come from the unfiltered sections, always.** No key this release reads can hit the case. `path:` keeps a document's row and its Blocked entries together, and an `is:` term keeps no row. But a later negation or free-text key would hit it, so the rule exists before such a key does.

### 6.4 The URL

- **On open.** The page reads `filter`. If it is understood and not canonical, the existing in-place rewrite writes the canonical text as one parameter, in the same replace that clamps pages, with the fragment kept. A not-understood filter is left exactly as written. Page parameters in a filtered link are read against the filtered sections.
- **On Enter, or on ✕.** One replace navigation does all of this:
  - it sets `filter` to the canonical text, or to the text as typed when that is not understood, or removes `filter` when the text is empty;
  - it writes `filter` with the link encoding of [§9.2](#92-the-link-it-prints), so the address bar shows what an agent's link shows, and writes every other parameter as the page writes it today;
  - it deletes every section's page parameter, as a roadmap pick deletes `needs-you`;
  - it keeps `roadmap` and every unknown parameter;
  - it drops the fragment.

  The old page stays up until the new page inputs are in, and then everything changes in one commit. Past 150 ms (`spinnerMs`, `limits.ts:131`) a spinner shows in the filter line's own slot, as the roadmap picker's does. Entering the text already applied does nothing.
- **Ordering.** The URL is the one writer. A second Enter while the first page's inputs are loading wins: the page lays out from the newest URL, and an abandoned filter's inputs may finish into the cache but are never shown unasked.
- **An index update while filtered** applies the same text to the new index. Counts change in the commit that changes the sections, as they do today.
- **A roadmap pick keeps the filter.** So do page flips and the outline's links, which already carry the whole query. A flip writes the page's own form encoding (`%3A`, `%2F`), which reads back to the same text.
- **`g p` and the sidebar entry open the bare page** and drop the filter, as they already drop page parameters and `roadmap=` ([`useKeyboardShortcuts.ts:102-106`](../../frontend/src/hooks/useKeyboardShortcuts.ts#L102-L106), [`AppShell.tsx:492-500`](../../frontend/src/components/AppShell.tsx#L492-L500)). A filter belongs to a link, never to the document the reader came from. Back returns to the filtered URL, and the box follows it ([§7](#7-the-filter-line)).
- **Nothing is remembered.**

### 6.5 Identities

The applied filter's canonical text joins every identity a page of the planning page has:

- the cache of derived sections, which is keyed by index, then roadmap, then filter;
- the layout, whose invariant becomes "two layouts of one index with the same roadmap, filter and pages show the same entries";
- the page-inputs cache key;
- the pager and outline prefetch;
- the frame's re-derivation of its sections from the shown layout.

A not-understood filter shows the same entries as no filter, so its identity is no filter's.

### 6.6 Copy agent request and Copy answers

**Copy agent request and Copy all agent requests follow the filter.** When a filter is applied, the text gains one line after `Repository:`:

```text
Filter: `path:docs/design/x.md is:open`. Only the entries it keeps are listed.
```

- **The line carries the canonical text with its unmatched terms left out.** An unmatched term keeps nothing and terms of one key are OR'd, so leaving it out keeps the same entries, and the line stays a text `--filter` accepts. When every `path:` term is unmatched, nothing is kept and there is no request.
- **The text is a code span**, fenced with one more backtick than the longest run inside it and padded with a space where it starts or ends with a backtick, so the period after it can never be read as part of a path.
- **The request is byte-equal to `vantage-check index --request --filter '<the line's text>'`.** The parity test, which compares what a button copies with what `--request` prints for the same tree ([`PlanningPage.test.tsx:3065`](../../frontend/src/pages/PlanningPage.test.tsx#L3065)), is extended over every understood text in the fixture whose request is not empty.
- Unfiltered text gains nothing and stays byte-identical.
- The `Verify:` line is unchanged.
- A not-understood filter is not applied, so its request has no `Filter:` line and equals plain `--request`.

**Copy answers follows the filter** ([OQ-PF2](#decision-ledger)). With one agent per piece of work, the agent for one piece gets that piece's answers and no one else's. Two rules hold beneath it:

- **The visit's two review requests read every document the unfiltered sections list.** A visit makes at most two ([`usePlanningReviews.ts:9-12`](../../frontend/src/hooks/usePlanningReviews.ts#L9-L12)), and a layout asks for any shown document the tab has not read ([`usePlanningPageInputs.ts:160-188`](../../frontend/src/hooks/usePlanningPageInputs.ts#L160-L188), [`:262-265`](../../frontend/src/hooks/usePlanningPageInputs.ts#L262-L265)).
  - The first request holds the shown pages' documents and those with a question that needs you, as today.
  - The second, once the sections have painted, holds every other document any unfiltered section lists: the question documents it reads today, and now every row's document too.

  With the second request reading question documents only, opening a filtered link and then clearing the filter would show stage rows nobody had read, and make a third request. Reading the code, a flip to a later page of rows can already do that today, and this closes it as well.
- **Comments are placed over the unfiltered listed questions**, as today ([`planningAnswers.ts:115-121`](../../frontend/src/lib/planningAnswers.ts#L115-L121)), and only the resulting groups and the set of answered questions are then narrowed to kept ones. Placement picks the innermost listed question whose unit holds a comment's line ([`planningPages.ts:499-515`](../../frontend/src/lib/planningPages.ts#L499-L515)). Placing over kept questions alone would credit a comment on a hidden nested question, such as a ✅ one under `is:open`, to the kept question around it.

The payload and its count cover pending comments on kept questions only. The button's tooltip and accessible name say how many pending answers the filter leaves out. Neither is visible text, so nothing in the header moves as reviews arrive.

### 6.7 The filter notice

The notice is the first of the frame's notices. It arrives with the section bar and it prints. Its words live in `PLANNING_NOTICES`, so the page and the checker share them. The filter text in it is set off: as code on the page, and between backticks in the checker's text, so the `:` after it cannot be read as part of it. It takes four forms:

| Form | Says |
| :--- | :--- |
| Applied | A first line: the canonical text, then entries shown of the unfiltered total, kept documents of the paths the index lists, and how many kept entries are open questions. For example: ``Filtered by `path:docs/design/x.md is:open`: 5 of 15 entries, in 1 of 20 paths, 5 of them open questions.`` Then one line per clause below that applies. Last, the page's "Clear the filter to see the other 10." or the checker's "Run without --filter to see the other 10." |
| Applied, nothing kept | The same, with none shown, followed by the filtered *Nothing this filter keeps needs you* |
| Unmatched term | One line per term, under the first: `` `path:docs/desing` matches no path the index lists. `` |
| Not understood | ``Not filtered: this Vantage does not understand `<term>`. It reads path: and is: terms, such as `path:docs/design/*.md is:open`. Every entry is shown.`` Where there is no term to name, the reason stands in its place: an unclosed quote, or a filter past 64 terms or 2,048 code points |

The clauses of the applied form:

- **Other roadmaps.** ``2 more questions it keeps are on other roadmaps: `docs/a/roadmap.md` (1), `docs/b/roadmap.md` (1).`` The page adds "Choose one to see them; the filter stays." and the checker "Rerun with --roadmap naming one."
- **Blocked.** ``3 of its questions are blocked and will need you later.`` It counts the 🔒 questions in kept documents that an `is:` term leaves out, so a human told "nothing needs you" knows whether a later round will come.
- **Waits on.** ``docs/design/x.md waits on docs/design/y.md, which this filter leaves out.`` One line for each kept document whose Blocked row, in the unfiltered sections, names a target that is not a kept document. A `#OQ-…` target is named with its fragment, and adding `path:` for it brings in its whole document, since no key selects one question.

The other rules:

- **What is counted.** "Paths" counts every path the index lists: its planning documents and its Too large and Unreadable paths. A filter with no `path:` term keeps every path, so the *Waits on* clause never applies to it. The total of entries is the unfiltered section bar's sum.
- **What is delegated.** The exact words are the implementer's. The counts, their order, the clauses and which of them apply are not.
- **Words.** "Not understood" is chosen so that it collides with none of the roadmap state `unreadable`, the *Unreadable* section, and the refusal past `max-candidates`.

## 7. The filter line

- **Placement.** The filter line is a row at the top of `<main>`, above every state of the planning route: *Choose a project*, *Repository not found*, loading, building, ready, the load error and the refusal past `max-candidates` ([`PlanningPage.tsx:1882-1915`](../../frontend/src/pages/PlanningPage.tsx#L1882-L1915) draws those as alternatives). The shell draws no page until the repository list has loaded ([`AppShell.tsx:126`](../../frontend/src/components/AppShell.tsx#L126)), so which of them shows is known at the page's first paint. It is not drawn in a static export, which has no planning page and knows so from a flag the static build writes into the page.
- **Places it is not.** The other placements were rejected:
  - **Not the header.** A box there takes the header's yield steps sooner, and in the end narrows the file name. The header is also hidden in print (`index.css:2602`).
  - **Not the frame.** The frame is not drawn in the error and refused states.
  - **Not the section bar's cluster.** It wraps with the bar.
  - **Not the outline's head.** That exists only on wide screens.
- **It never moves anything.** Its height is fixed and nothing is ever inserted above it. Its text comes from the URL synchronously, so it is complete at first paint. Its ✕, its hint and its spinner each have a slot that is always present. The new row for the reference's [§12.2](../reference/planning-index.md#122-every-late-datum-and-where-its-space-comes-from) reads: "The filter line | the planning page | drawn at first paint from the URL alone, one fixed-height row above every state of the route; its ✕, hint and spinner have slots of their own; its notice is the frame's."
- **Contents.**
  - A `<form role="search">` named "Filter the planning page", holding a visible label, *Filter*.
  - A `type="text"` input. Not `type="search"`, because Chrome clears that kind on Esc.
  - A placeholder that is a real example, in `slate-500` ink: `slate-400` reads 2.4:1 on a light panel (`textContrast.test.ts:13-16`).
  - The ✕ slot, empty while there is no text.
  - A hint slot.
  - The spinner slot, sized like the roadmap picker's.
- **At narrow widths** the hint gives way first, then the visible label, which stays the accessible name. The input keeps a minimum width, whose size is the implementer's, the ✕ and spinner keep their slots, and the row never wraps.
- **Behavior.**
  - **On open,** the box holds the URL's text exactly. It never takes the focus ([`useShellPage.ts:133-139`](../../frontend/src/hooks/useShellPage.ts#L133-L139)). A not-understood filter marks the input `aria-invalid` and gives it an amber ring from first paint.
  - **Typing** changes only the box. Nothing is laid out per keystroke: each layout asks for its own page inputs, and the cache keeps eight sets (`limits.ts:135`), so typing would evict the sets Back relies on.
  - **Enter applies** ([§6.4](#64-the-url)), and the box then shows the canonical text.
  - **The box follows every navigation it did not cause.** After `g p` or the sidebar entry on this page, and after Back or Forward, the box shows the new URL's filter and drops any unapplied text, even while it has the focus. The planning page is not remounted by those navigations (one `${PLANNING_ROUTE}/*` route, [`App.tsx:17-19`](../../frontend/src/App.tsx#L17-L19)), so this has to be a rule. Between them, the box is rewritten while it has the focus only by the reader's own Enter.
  - **✕ clears and applies in one step.** The focus stays in the box. ✕ is a control a reader aims at, and the link the agent handed over still holds the filter.
  - **Esc puts back the applied text** when the box holds unapplied text. Otherwise it returns the focus to the pane. **Esc never clears:** it is pressed by reflex to leave a field, and a filter change replaces the history entry, so Back would not bring a cleared filter back.
  - **Leaving the box applies nothing.** Unapplied text stays, and the hint slot says "Enter to apply", so the box never silently disagrees with the page.
  - **In the load error, the refusal, *Choose a project* and *Repository not found*,** the box still reads and writes the URL. There are simply no sections for it to filter.
  - **The page's shortcuts** turn off while the box has the focus, at no cost ([`useKeyboardShortcuts.ts:67-77`](../../frontend/src/hooks/useKeyboardShortcuts.ts#L67-L77)). The box is reachable by Tab and by click whether shortcuts are on or off, and by `/` while they are on.
- **`/` focuses the box** ([OQ-PF4](#decision-ledger)) wherever the planning page's shortcuts work: with them on and the focus outside a text field. It selects the box's text, so a paste replaces it. The shortcuts help lists it in a row of its own for the planning page, and on a document `/` does nothing.
- **A pasted link applies at once** ([OQ-PF3](#decision-ledger)). When the text pasted into the box holds a planning link, the box applies that link's filter as Enter does, and shows it as its text:
  - **What counts as one.** The first run of characters up to white space that holds `/.vantage/planning`, with or without a scheme, host, port and repository segment in front, and its query after. The link ends earlier, at the first character a planning link never holds unencoded, so a backtick, quote, parenthesis or angle bracket a chat wraps it in is not read as part of it. Then the trailing `?`, `.`, `,`, `:`, `_` and `~` that GitHub's [extended autolinks](https://github.github.com/gfm/#autolinks-extension-) leave out are dropped, so a sentence's period after it is too. So the bare link, a whole URL, and the checker's `Planning page:` line with the lines around it all count.
  - **What is read from it.** Its `filter` value, decoded as the page decodes its own URL, and its `roadmap` when it names one, which the same replace navigation chooses. Like a link that names a roadmap, that choice is not remembered. A link with no `filter` clears the filter.
  - **What is ignored.** The scheme, host, port and repository segment, its page parameters and its fragment. The filter applies to the repository on screen.
  - **Anything else** pasted is text, applied on Enter as typed text is. A link whose filter is not understood is applied as written, so the notice names its term.

  So *press `/`, paste* reaches the filtered page from any origin, in any mode and through any tunnel, and nothing stores an address.
- **For screen readers.** The input's `aria-describedby` names the notice. A polite live region speaks the notice after a reader's Enter or ✕, never as the page opens. A filter change that resets a section to page 1 is not announced as a flip.
- **In print.** The input row is hidden. A print-only line reads `Filter: <canonical>`, and the notice prints, so a printout always says it is filtered and by how much.

**From a document, *its questions on the planning page*** ([OQ-PF4](#decision-ledger)). A document's [Referenced by](../reference/planning-index.md#71-referenced-by) line gains a last part: a link to the planning page filtered by `path:/<the document's path>`, written in canonical text by the planning module's link function.

- **When.** The document's stage has no `done` role and it holds at least one question. Both are facts of the index, so the part is known when the line fills. Otherwise there is no part, and the rest of the line is unchanged.
- **Where.** It is a link of its own after the line's disclosure button, never inside it, and it never shrinks: where the line is cut off at its end, the button's text gives way. The line is the one line already reserved at first paint for a planning document ([planning-index.md §12.2](../reference/planning-index.md#122-every-late-datum-and-where-its-space-comes-from)), and a document with a question is one by its directives, so the link arrives into reserved space and moves nothing. A document with no line today, because nothing links to it and every open question is routed, gets a line holding only the link.
- **The address.** It is the page's own planning path, with the repository segment percent-encoded in daemon mode, and the query from the link function. It is a plain link: Ctrl-click and a middle click open a new tab, and it prints as text. It is not drawn in a static export, which has no planning page.
- **It is a reader's action.** Following it is the reader choosing this document's filter, so `g p` still opens the bare page whatever document it is pressed on ([§4](#4-non-goals)).

## 8. The checker

### 8.1 The flag

`vantage-check index --filter <text>`, or `--filter=<text>`. It works with `--format json`, `--request` and `--roadmap`.

- **Given twice,** the values join with a space, as the URL's do.
- **`--filter ''`** is no filter, and the output is byte-identical to a run without it.
- **It is a flag, not an environment variable, on purpose.** An older checker that ignored a `VANTAGE_FILTER` would print the whole index to an agent that believes it filtered. A flag makes that checker exit 2 instead, which is the correct failure here.

### 8.2 Exit codes

| Exit | When |
| :--- | :--- |
| 0 | It ran. That includes a filter keeping documents that have no entries, and an empty `--request` |
| 2, before the scan | The filter is not understood (`--filter: this checker does not understand <term>; it reads path: and is: terms`, or the reason where there is no term). Also `--filter` with no value |
| 2, after the scan | An unmatched term. The message lists each one, as `--roadmap` lists the roadmaps that do route. Nothing is printed to stdout |
| 3 | Past `max-candidates`, whatever the filter says. The unmatched check never runs then |

It never exits 1. An unmatched term is an error here and only a notice on the page, because a mistyped path is the agent's likeliest mistake, and exit 2 stops it before the human is handed an empty page.

### 8.3 Output

- **Text.** The filter notice comes first, its clauses included. Then the `Planning page:` line and its hint lines ([§9.2](#92-the-link-it-prints)). Then the existing notices, with *Nothing needs you* in its filtered form, the Roadmaps block with filtered counts, the filtered sections, and `Agent requests: vantage-check index --request --filter '<canonical>'`, shell-quoted, when an agent section has entries. The chosen roadmap's source follows unchanged.
- **JSON.**
  - Without `--filter`, it is byte-identical.
  - With it, **every existing key keeps its meaning.** `index` is the whole index, `sections` is the unfiltered derivation, and the top-level `roadmaps`, badges included, is unchanged, all byte for byte what a run without `--filter` prints. A filter changes `roadmaps[].needsYouCount` and `nothingNeedsYou`, which the reference defines over the whole index ([planning-index.md §13.2](../reference/planning-index.md#132-vantage-check-index)), so filtered values in `sections` would change existing keys' meaning.
  - The filtered view is a new last key, present only with `--filter`: `filter: {text, canonical, link, documents: {kept, of}, entries: {shown, of}, openQuestions, blockedLeftOut, otherRoadmaps: [{path, count}], waitsOutside: [{path, target}], sections}`. `filter.sections` has the shape of `sections` and the values of [§6.2](#62-every-section-and-every-whole-index-value). `link` is always root-relative.
  - The format version stays 2, because a new key does not bump it ([planning-index.md:2173-2176](../reference/planning-index.md#L2173-L2176)).
- **`--request --filter`** prints the filtered request with its `Filter:` line. With nothing to ask for, stdout stays empty, stderr says why, and it exits 0, as today.

The help's row, sketched (the wording is the implementer's; the keys are not):

```text
  --filter <text>    show only the entries the text keeps, as the planning
                     page's Filter box does, and print a link to that page:
                       path:<pattern>   a document: a file, a folder, or a
                                        gitignore-style * or ** pattern;
                                        start a root file's path with /
                       is:open          a question still open
                     Terms with one key keep any of their matches; terms
                     with different keys must all match. Paste the link
                     into the planning page's Filter box (press /).
```

## 9. Handing the human a link

### 9.1 The address the checker cannot know

Only the browser knows the address the human opens Vantage at:

- The checker may not ask a server ([`agent-cli.md` P1](../reference/agent-cli.md#11-principles)).
- The port falls forward when 8000 is busy.
- Daemon names carry `-2` suffixes and fold case on some systems ([`serve-clones-directory.md`](../reference/serve-clones-directory.md)).
- Tunnels exist.
- The agent may be in a container. In this jail `localhost` is the jail's own loopback, and the project root is `/workspace`, while the host checkout, whose directory name a daemon would use, is `vantage`.

So the checker never builds an origin. It never guesses a port or a repository name.

### 9.2 The link it prints

```text
Planning page: /.vantage/planning?filter=path:docs/design/x.md+is:open
  Press / on the planning page and paste this line, or put the scheme, host and port you open Vantage at in front of the link.
```

- **One line, two ways to use it.** Pasted into the Filter box ([§7](#7-the-filter-line)), the line works on any origin, in any mode and through any tunnel, because the box reads only the link's query. With an address in front it is a link to click, and in daemon mode it then reaches *Choose a project*, which keeps the filter ([§9.4](#94-daemon-mode)). The filter's readable text is in the notice above it, for typing.
- **The query.** It carries `roadmap=<chosen>` whenever two or more roadmaps route, so the human's *Needs you* follows the roadmap the agent checked, whatever they last picked. Pasting the link chooses that roadmap too. The link never carries a page parameter or a fragment.
- **A linked worktree.** When the root's `.git` is a file, a second hint line says "`<root>` is a linked worktree: the page shows the checkout your Vantage serves, which may not hold these documents as they are here." The checker cannot tell which checkout a server serves, but it can tell when its own is not a repository's main one.
- **The encoding.** One function in the planning module holds the parameter's name and how its value is written. It percent-encodes everything except `A–Z a–z 0–9 - . _ ~ : /`, and writes a space as `+`.
  - So `*` is written `%2A`, and Markdown or a chat client cannot read it as emphasis.
  - `#`, `&`, `+` and `"` are encoded, so the value cannot be cut short.
  - `:` and `/` stay bare, so the human can read the filter in the link before clicking it.
- **Reading it back.** `URLSearchParams` on the page reads that query back to exactly the canonical text, so opening the link triggers no rewrite. A round-trip test over every understood form in the fixture ([§10.4](#104-how-p0-is-checked)) pins it. Enter writes the same encoding, so a typed filter's address matches an agent's link until the first flip. After it the address bar shows the page's own form encoding instead, and both read alike, as `roadmap=` already does ([`planning.md`, Several roadmaps](../../userguide/guides/planning.md#several-roadmaps)).

### 9.3 No address is kept

Nothing stores the address the human opens Vantage at, and the checker never prints one ([OQ-PF3](#decision-ledger)).

- **It has no home that is right.** It is a fact about a machine, so it does not belong in `.vantage.toml`, the reasoning [`vantage-check.md`](../../userguide/guides/vantage-check.md#large-corpora) gives for having no `jobs` key. And one machine can open one repository at several addresses at once: a daemon, a foreground `vantage serve` whose port fell forward, a tunnel.
- **Pasting makes it unnecessary.** *Press `/`, paste* is two keys on a page the human already has open, so the link never needs an address in front ([§7](#7-the-filter-line)).
- **An agent may put one in front itself.** One the human has told the address, in the conversation or in the agent's own notes, can write the whole link. That is the agent's knowledge, not Vantage's, and the checker never reads it.

### 9.4 Daemon mode

A root-relative link has no repository segment. In daemon mode, `/.vantage/planning` with no segment shows *Choose a project*, which today links to `/` and drops the query, and a wrong segment shows *Repository not found* with no way on ([`PlanningPage.tsx:1882-1890`](../../frontend/src/pages/PlanningPage.tsx#L1882-L1890)). With this design, both list each served project as `/.vantage/planning/<encoded name>?<the same query>`. A root-relative link with an address in front then costs the human one click instead of losing its filter. Pasted into the Filter box of a project's page, it needs no click at all.

### 9.5 The loop, and what agents are taught

1. **The human asks** for the questions one piece of work needs answered.
2. **The agent lists that work's planning documents,** each by its path from the root with a leading `/`, because a bare name with no inner `/` matches at any depth: the design, its `-plan.md` if one exists, and every document a kept one names in `depends-on`. A `depends-on` entry naming one question by its `#` fragment brings in all of that question's document, since no key selects one question.
3. **In the checkout the human's Vantage serves, it runs `vantage-check index --filter 'path:/<design> path:/<plan> is:open'`.** A link made in another checkout, such as a worktree, opens the served checkout's documents.
   - Exit 2 names the bad term.
   - `unknown option for index: --filter` means the checker predates the filter, and `uvx vantage-check@latest` is the fix.
   - If the notice names other roadmaps, it reruns with `--roadmap` naming each, and hands over each link.
   - If the notice names a blocker the filter leaves out, it adds that document and reruns.
4. **It hands over the `Planning page:` line, the filter text in a code span, and the counts,** and tells the human to press `/` on their planning page and paste the line. It puts an address in front only when the human has told it theirs ([§9.3](#93-no-address-is-kept)).
5. **The human answers on the page** and presses Copy answers.
6. **The agent applies the answers** and reruns the same command until it reports *Nothing this filter keeps needs you*. The *Blocked* clause says whether another round will follow.

The loop also runs the other way. A human who filtered the page by hand and presses Copy agent request hands the agent the `Filter:` line, whose text `--filter` takes as it is.

**Where agents learn it:**

- the `--filter` row in `help.ts`'s usage;
- a section of `vantage-check.md`, *Handing the human a filtered planning page*, with the loop above;
- [`agent-cli.md` §3.3](../reference/agent-cli.md#33-index-version-and-help);
- one bullet in the style guide's *Planning documents*. The style guide ships inside the checker, so it never teaches a flag the reader's checker lacks:

```text
- **To ask a human for the rulings a piece of work needs, hand them a filtered
  planning page.** In the checkout their Vantage serves, name the work's
  documents from the root with a leading `/`: the design, its `-plan.md` if
  one exists, and what its `depends-on` names. Run `vantage-check index
  --filter 'path:/<design> path:/<plan> is:open'`, and give the human the
  `Planning page:` line: they press `/` on their planning page and paste it,
  or type the filter text into its Filter box. Once you have applied their
  answers, the same command lists what is still open.
```

When `.vantage.toml`'s `target` names a release before the one that ships the filter, the checker adds a caution under the link: "A Vantage viewer before <release> ignores this filter and shows every entry." That uses `target`'s existing meaning, the oldest release the repository's readers use ([`checker-version-skew.md` §4.1](checker-version-skew.md#41-the-key)).

## 10. Compatibility, in both directions

### 10.1 Older readers

| Reader | Given | Does |
| :--- | :--- | :--- |
| A 0.7.x viewer | Any planning URL | It has no planning page |
| A 0.8.0 or 0.8.1 viewer | A planning link the checker printed | Keeps `filter=`, ignores it, and shows every entry with no notice. The link carries no page parameters, so nothing is read against the wrong sections, and `roadmap=` keeps its meaning |
| A 0.8.x viewer | An address-bar URL copied from a newer page, holding a filter and page parameters (`filter=…&needs-you=2`) | Reads the page parameters against the unfiltered sections and clamps them: a true page of the whole list, not the one the sender saw |
| A 0.8.x viewer | Copy agent request or Copy all agent requests, on a filtered link | Copies the whole request, with no `Filter:` line: what that page shows. An agent taught that a filtered page's request carries a `Filter:` line can tell |
| A 0.8.x viewer | Copy answers, on a filtered link | Every pending answer, as today |
| A 0.8.x checker | `--filter` | Exits 2 with `unknown option for index: --filter` |
| Agent text frozen in a released viewer | — | Nothing frozen *runs* `--filter`. The `Verify:` line is unchanged, and `Filter:` is data |

**Why this is the degradation P0 allows, not a misreading.** P0 gives a new meaning a new key, "which older viewers already drop without harm" ([`checker-version-skew.md` P0](checker-version-skew.md#1-verdict-and-the-principles)), and `filter` is that key.

- **It is dropped whole.** 0.8.x drops `filter` whole, the way a release before 0.8 drops a `question` directive whole, which the compatibility model counts as "the harmless degradation P0 allows" ([`notation.ts:13-20`](../../frontend/src/compat/notation.ts#L13-L20)).
- **Nothing of it is shown or read another way.** Every entry 0.8.x shows is true, none is hidden, and every control does what it does on 0.8.x's own page. The `text` misreading is something else: notation that an older parser shows as literal text ([`notation.ts:37-40`](../../frontend/src/compat/notation.ts#L37-L40)).
- **What is lost is the narrowing, and its cost is bounded.** The human sees more than they were sent for. An agent handed a request from that page gets the whole request, and can tell. The *Filtered by* notice the agent mentioned is missing.

Only a new route would stop an older viewer from showing an unfiltered page. That would give one page two addresses forever, to prevent a harm that is bounded, so it is rejected ([§12](#12-alternatives-with-verdicts)).

### 10.2 This release, given what it does not understand

- **A not-understood filter** ([§5.5](#55-what-this-release-does-not-understand)) is not applied. Every entry is shown, the notice names the first term it cannot read, or the reason, and the box and the URL keep the text as written. The checker exits 2 before scanning.
- **Not by dropping the term.** Dropping `OR is:open` from `path:a OR is:open` leaves `path:a`, which hides questions the filter asked for. The same happens to a value a later release ORs onto an existing key.
- **Not by matching nothing.** That hands the human an empty page under version skew, and "a partial index would quietly under-report questions" ([planning-index.md:179-182](../reference/planning-index.md#L179-L182)).
- **An unmatched term** is applied: it simply keeps nothing, and the notice names it. The checker exits 2 ([§8.2](#82-exit-codes)).
- **An unknown URL parameter** is kept and ignored, as today.

### 10.3 How a key is added later

- **A new meaning gets a new form.** That can be a new key, a new value on `is:`, or new syntax in a form this release does not understand: a leading `-`, `OR`, parentheses, bare words, `,`, `#`, `?`, `[ ]`, `{ }`, or any other character in a bare pattern. This release shows more for every one of those, never less.
- **An accepted filter never changes meaning.** That covers its canonical text, the path dialect, which fields a key reads, and what each `is:` value keeps ([§5.3](#53-keys-and-how-terms-combine)). Searching question text later is a new key, never a wider `path:`.
- **The combination rule is fixed:** same key OR, different keys AND.
- **Every other surface only widens.** What the Filter box reads as a pasted link, the 64-term and 2,048-code-point limits, and the subkeys of the JSON `filter` key may grow, and never shrink or change. A repeated `filter=` or `--filter` always joins with a space, so a repeated parameter never gets a meaning of its own.
- **A key that needs a new fact** is also a scan change, and the stored shape changes with it.
- **Candidate keys:** `is:` values for ✅ and for 🔒 questions; `stage:` over the repository's declared words; a one-hop link key; a selector for one question, once `#` is given a meaning; and free text.

### 10.4 How P0 is checked

- **A fixture of forms.** It lives in the planning module and holds `read: [{text, canonical, keeps}]` and `notUnderstood: [{text, term}]`, with `reason` in place of `term` where there is no term to name. `keeps` is checked against a small index the fixture also holds.
  - That index holds a `🔒 ⏸` question, a ✅ question nested inside an open one, a root `roadmap.md` beside an `x/roadmap.md`, a path with a space, a non-ASCII path in NFC, and paths that tell git's answer for each accepted construct of [§5.4](#54-path-patterns) from a wrong one. Those `keeps` were taken from `git check-ignore --no-index`.
  - The page's tests and the checker's tests both load it.
  - A later release may move an entry from `notUnderstood` to `read`. It may never edit or remove a `read` entry, nor remove a `notUnderstood` entry except by moving it.
  - A test compares the fixture with its copy at the previous release's tag, when git has the tag, and fails on any change to a `read` entry. Where the tag is absent, it skips and says so.
- **A written model of 0.8.x's URL handling** in a unit test, following the `questionOffersTake` precedent. It asserts that every link the checker prints passes 0.8.x's rewrite with `filter` untouched and holds no page parameter for 0.8.x to misread. UNMEASURED: no 0.8.x build is run.

## 11. Worked example: this document's own questions

This illustrates this tree on 2026-10-05, with this document and its roadmap entry in place and its five questions still open: 20 paths and 15 entries. They were ruled before anything was built, so the success criteria ([§15](#15-success-criteria)) use a fixed fixture instead.

```console
$ vantage-check index --filter 'path:/docs/design/planning-filter.md is:open'
Filtered by `path:docs/design/planning-filter.md is:open`: 5 of 15 entries, in 1 of 20 paths, 5 of them open questions.
Run without --filter to see the other 10.
Planning page: /.vantage/planning?filter=path:docs/design/planning-filter.md+is:open
  Press / on the planning page and paste this line, or put the scheme, host and port you open Vantage at in front of the link.

Needs you (5) · for the human
Open or answered questions on this roadmap, in its order. Rule each open one, then Copy answers.
  docs/design/planning-filter.md:709  💬 OQ-PF1: Which keys does the first release read?  (📦 Up Next)
  docs/design/planning-filter.md:725  💬 OQ-PF2: Does Copy answers follow the filter?  (📦 Up Next)
  docs/design/planning-filter.md:739  💬 OQ-PF3: How does an agent's link get the address you open Vantage at?  (📦 Up Next)
  docs/design/planning-filter.md:754  💬 OQ-PF4: Which ways besides typing set the filter in this release?  (📦 Up Next)
  docs/design/planning-filter.md:770  💬 OQ-PF5: Is the filter line always on the page?  (📦 Up Next)

Roadmap: roadmap.md
…
```

**What the human does with it.** On the planning page they already have open, they press `/` and paste the `Planning page:` line, and the page shows those five cards. With an address in front, such as `http://localhost:8000` for a plain `vantage serve`, the link opens the same page in one click. Typing `path:docs/design/planning-filter.md is:open` into the Filter box and pressing Enter gives the same `filter` value, the same address until a flip, and the same five cards. So does *its questions on the planning page* in this document's Referenced by line, except that its filter, `path:docs/design/planning-filter.md`, also keeps the document's ✅ and 🔒 questions; here it has none.

Other filters, over the same tree:

| Filter | Keeps |
| :--- | :--- |
| `path:docs/design/agent-bootstrap.md is:open` | [OQ-B1](agent-bootstrap.md#OQ-B1) to [OQ-B5](agent-bootstrap.md#OQ-B5), all under *Not on a roadmap*: open questions the human answers, in a section whose actor is the agent |
| `path:color-themes.md` | [OQ-CT6](color-themes.md#OQ-CT6), under *Not on a roadmap*. A bare name matches at any depth |
| `path:/roadmap.md` | 1 path and no entries: the roadmap holds no question |
| `path:docs/design/checker-version-skew*` | 2 documents, the design and its sketch, and one entry: the design's *Ready to graduate* row |
| `path:docs/design/checker-version-skew* is:open` | The same 2 documents and no entries: *Nothing this filter keeps needs you* |
| `path:docs/reference` | 9 documents and no entries, because every one is `CURRENT`, a `done` role |
| `path:docs/desing` | An unmatched term. The page applies it, keeps nothing and names it; the checker exits 2 |
| `path:docs/design/*.md OR is:open` | Not understood. The page shows all 15 entries under *Not filtered*; the checker exits 2 before scanning |
| `path:docs/**` | Not understood: a trailing `/**`. `path:docs/` keeps the same paths |

## 12. Alternatives, with verdicts

| Alternative | Verdict |
| :--- | :--- |
| A parameter per key (`?path=a&is=open`) | **Rejected.** It is not one string a person types, and a later key would be ignored silently rather than not understood |
| `q=` | **Rejected.** It collides with the unknown-parameter fixture, and the URL, flag and label would read three ways |
| Positional paths on `index` | **Rejected.** It reverses the recorded refusal of paths (`cli.ts:158-161`) and adds a second grammar |
| `VANTAGE_FILTER` instead of `--filter` | **Rejected.** An older checker would print the whole index as though it were filtered |
| Filtering the index before deriving | **Rejected.** It breaks *Blocked* and routing ([§3](#3-what-exists-today)), and the reference forbids a trimmed index |
| The port's whole dialect for `path:` | **Rejected.** It freezes a literal `?`, RE2 meanings, unanchored inner slashes and five forms on which the port and git disagree into URLs |
| A glob matcher of our own, case-insensitive | **Rejected.** A second glob rule in one repository, and a case rule that disagrees with git, frozen. The quoted form's literal comparator is not a glob matcher |
| Non-ASCII characters in bare patterns | **Rejected.** Typographic quotes and invisible characters would become path characters for good; the quoted form carries any path |
| Not understanding a leading `./` | **Rejected.** Agents write it, and `roadmap=` already reads it as the root |
| `is:answered` for ✅ | **Rejected.** The page already calls a question you commented on *answered* |
| Applying the terms understood and dropping the rest | **Rejected.** It hides questions once anything can be OR'd in ([§10.2](#102-this-release-given-what-it-does-not-understand)) |
| Matching nothing when a term is not understood | **Rejected.** An empty page under version skew, the opposite of how 0.8.x degrades |
| An unmatched term as a warning with exit 0 | **Rejected.** `--roadmap` is strict, and a typo is the agent's commonest mistake. The page still applies it |
| Keeping unmatched terms in the request's `Filter:` line | **Rejected.** `--filter` would exit 2 on the line the human handed over, though leaving them out keeps the same entries |
| Exit 2 when a blocker is left out | **Rejected.** Leaving it out can be deliberate; the *Waits on* clause says so in both readers |
| Kept questions on other roadmaps shown as cards | **Rejected.** It merges roadmap orders, a non-goal; the notice names each roadmap instead |
| `sections` filtered in place under `--filter` | **Rejected.** It changes the meaning of existing keys at format version 2 |
| `--filter` twice exits 2 | **Rejected.** Joining the values is what typing both into the box does |
| The box in the header, the frame, the section bar or the outline | **Rejected** ([§7](#7-the-filter-line)) |
| Applying as you type | **Rejected.** It churns the eight-set inputs cache and the scroll map, and flashes empty pages for half-typed paths |
| Esc clears the box | **Rejected.** It is pressed by reflex, and a replace navigation makes the loss stick |
| ✕ clears the box only, and Enter applies | **Rejected.** ✕ is aimed at, and the agent's link still holds the filter |
| Chips as the filter's state | **Rejected.** A second state that cannot be copied as text |
| `g p` carrying the filter | **Rejected.** A filter belongs to a link; Back restores it |
| A remembered filter, or named filters in `.vantage.toml` | **Rejected for now.** The page stores nothing, and a named filter is a judged fact with two readers |
| Pushing the filter through `.vantage/inbox` | **Rejected.** An older server consumes it and reports `delivered:` |
| A new route so older viewers fail visibly | **Rejected.** Two addresses for one page, against a bounded harm ([§10.1](#101-older-readers)) |
| A 0.8.2 that recognizes `filter=` and warns | **Rejected.** It helps only readers who take 0.8.2 and not the release with the filter |
| `VANTAGE_PLANNING_URL`, set once per repository, to print the link whole | **Rejected** ([OQ-PF3](#decision-ledger)). The address is a fact about a machine with no home that is right, and one machine may open a repository at several. Pasting into the box needs no address |
| `vantage serve` printing a ready-to-paste address at startup | **Rejected** with it. It knows its own port, not the human's tunnel |
| A paste control of its own, beside the box | **Rejected.** The box, reached by `/`, is that control, and a second one would hold the same text |
| A *show only this document* toggle on every card and row | **Rejected** ([OQ-PF4](#decision-ledger)). It adds 10 to 25 controls a page; Referenced by's link and the box cover it |
| The filter line behind a Filter button | **Rejected** ([OQ-PF5](#decision-ledger)). A filter a person operates has to be seen to be learned, and a button adds a state and a layout-shift case |
| More `is:` values, bare words or a leading `-` now | **Rejected** ([OQ-PF1](#decision-ledger)). Each would be permanent notation for a list nobody has asked for; each stays not understood until then |
| The browser writing its address into copied text | **Rejected.** The payload is "a pure function of the document and the build", and the request's parity with `--request` would break |
| The checker reading the user config for a host and port | **Rejected.** The checker's first read of machine config, and wrong for a port that fell forward, a tunnel or a jail |
| A `vantage url` command on the server binary | **Rejected.** It sees the agent's loopback, not the human's, and the binary may not be in the agent's environment |
| A discovery file the server writes | **Rejected.** The server writes nothing on startup, and a file goes stale after a crash |
| Guessing the daemon name from the root's folder name | **Rejected.** Wrong in this very jail (`workspace` against `vantage`) and after a `-2` suffix |
| Link-graph keys, or a `depends-on` closure, now | **Deferred.** The closure is 16 of 19 documents. A one-hop key can come later |
| Selecting one question with `path:x#OQ-…` | **Deferred.** Ids are unique only per document, and `#` stays free |

## 13. Risks

| Risk | Effect | Mitigation |
| :--- | :--- | :--- |
| The human's viewer is a 0.8.x and the agent's checker is newer | The link shows every entry, without saying so | The agent states the counts, and the human looks for the *Filtered by* notice. A request copied there has no `Filter:` line. The checker cautions when `target` predates the filter |
| The agent picks the wrong documents | The human answers too few | Exit 2 on an unmatched term, the *Waits on* clause, and a rerun after the answers |
| The agent runs the checker in another checkout, such as a worktree | The link opens the served checkout's documents, which may lack the questions or hold older ones | Agents are taught to run it in the served checkout, and the checker cautions in a linked worktree |
| The work's questions sit on another roadmap | They are in no section, only counted | The notice names each roadmap and its count, the link carries `roadmap=`, and agents hand over one link per roadmap |
| A blocker the filter leaves out holds questions | Those questions are not shown | The *Waits on* clause, on the page and in the checker, whether or not an `is:` term dropped the Blocked row |
| `is:open` leaves 🔒 questions out | The human thinks the round is the last | The *Blocked* clause counts them |
| An agent writes the URL by hand | A raw `+`, `#` or `&` cuts the filter short | The checker prints the link, and agents are taught never to hand-encode one |
| The link is not clickable where it is handed over | The human has a line, not a link | *Press `/`, paste* is two keys on a page they already have open; the checker's hint line and the agent both say so |
| Copy answers leaves pending answers out | An answer is not handed over | The tooltip counts what the filter leaves out, and clearing the filter copies everything |
| The frozen grammar proves wrong | A wrong meaning that can never change | A small surface, a reserve of not-understood forms for every later need, and the fixture ([§10.4](#104-how-p0-is-checked)) |
| A change to the port for `[planning] include` | A filter's meaning moves with it | The fixture pins every accepted construct, and the filter then keeps a frozen copy of the port |
| A filter change re-lays out a large page | A long task on Enter | It applies on Enter only, with targets of no long task and zero CLS. UNMEASURED |

## 14. Costs, and what is unmeasured

**What becomes permanent:**

- `filter=` and `--filter`;
- `/` on the planning page, and the box reading a pasted link in the shape the checker prints it, which may only widen;
- the Referenced by link's filter, `path:/<document>`;
- `path:` and its dialect, the literal comparator's rules, and each `is:` value that ships;
- the combination rule and the canonical text;
- the join of a repeated `filter=` or `--filter` with a space;
- the 64-term and 2,048-code-point limits, which may only rise;
- the filter notice's existence, its counts and clauses, and the request's `Filter:` line;
- the JSON `filter` key, its subkeys and their meanings, including `link` being root-relative.

Every form this release does not understand stays free.

**What it forecloses:** case-folding, Unicode normalization or the full gitignore dialect under `path:`, which would need new keys; and ever applying part of a filter.

**What it costs to build**, at component level (the file map belongs in the sketch):

- **The planning module:** the parser, the predicate and its application to sections, the literal comparator and its table of excluded code points, the notices, the request's `Filter:` line, the link function, and the fixture of forms.
- **The page:** reading and writing `filter=`, the identities in [§6.5](#65-identities), the filter line with `/` and the reading of a pasted link, the wider second review request, Copy answers, *Choose a project* and *Repository not found*.
- **The viewer:** the link in Referenced by.
- **The checker:** the flag, the text and JSON output, the worktree caution, and the help.
- **Docs:**
  - the user guide's planning and `vantage-check` pages;
  - the planning reference: its [§2](../reference/planning-index.md#2-terms) terms, the [§6](../reference/planning-index.md#6-the-planning-page) subsections, a [§12.2](../reference/planning-index.md#122-every-late-datum-and-where-its-space-comes-from) row, [§13.2](../reference/planning-index.md#132-vantage-check-index), a [§15](../reference/planning-index.md#15-failure-modes) row and [§17](../reference/planning-index.md#17-non-goals);
  - the agent CLI reference's [§3.3](../reference/agent-cli.md#33-index-version-and-help);
  - the style guide bullet and `CHANGELOG.md`;
  - for `/`, the shortcuts help, `keyboard-shortcuts.md` and `features.md`;
  - for Referenced by's link, the reference's [§7.1](../reference/planning-index.md#71-referenced-by) and the guide's Referenced by section.
- **Tests:**
  - the fixture-driven grammar, canonical-text and comparator tests;
  - the URL and identity tests;
  - page tests for one commit, the notice and its clauses, request parity, placement with a nested ✅ question under `is:open`, and the box following `g p` and then Back;
  - a page test that opens a filtered link, clears the filter and counts two review requests;
  - checker tests for the text, the JSON, `--request` and every exit 2;
  - page tests for `/`, and for pasting a bare link, a whole URL from another origin, the checker's whole block, a link naming a roadmap and a link with no `filter`;
  - viewer tests for the Referenced by link: when it is drawn, its address in both modes, that it is absent in a static export, and zero layout shift as the index lands;
  - the 0.8.x model;
  - an e2e flow that opens a filtered link cold and applies a filter with Enter, asserting zero layout shift and an unchanged `history.length`.

**What it does not cost:** a Go change, a scan-cache schema bump or a JSON version bump. Any edit to the planning module changes the scanner id, so each visitor pays one cold build. Most releases already pay that ([`planning.md`, What this browser keeps](../../userguide/guides/planning.md#what-this-browser-keeps)).

**UNMEASURED:**

- D6 (no long task) and D12 (zero layout shift) on a filter change. No perf flow opens a URL with a query yet. The targets are no long task over 50 ms and zero CLS ([planning-index.md §18](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured)).
- 0.8.x's handling of a planning link. It is read from the code, not run.
- The port's agreement with git beyond the generated patterns. The run covered 5,256 patterns over 19 paths, not every pattern.
- How accurately agents write this grammar. No benchmark exists for any filter syntax.
- The filter line with assistive technology.

## 15. Success criteria

The tree is a copy of the e2e fixture [`frontend/e2e/fixtures/test_repo/`](../../frontend/e2e/fixtures/test_repo/), checked and served as its own root. Its roadmap routes `plans/design.md`'s two open questions, [OQ-E1](../../frontend/e2e/fixtures/test_repo/plans/design.md#OQ-E1) and [OQ-E2](../../frontend/e2e/fixtures/test_repo/plans/design.md#OQ-E2), and nothing in it depends on this design's own questions.

1. `vantage-check index --filter 'path:/plans/design.md is:open'` exits 0. It prints the notice, the line `Planning page: /.vantage/planning?filter=path:plans/design.md+is:open` and its hint line, with exactly [OQ-E1](../../frontend/e2e/fixtures/test_repo/plans/design.md#OQ-E1) and [OQ-E2](../../frontend/e2e/fixtures/test_repo/plans/design.md#OQ-E2) under *Needs you*.
2. Opening that link shows those two cards and nothing else. The section bar counts them, the box holds the text, and the notice says what is hidden.
3. Typing the same text into the box on the unfiltered page and pressing Enter gives the same `filter` value, the same address and the same page.
4. Copy agent request on a filtered page is byte-equal to `--request --filter` with its `Filter:` line's text, for every understood text in the fixture of forms whose request is not empty.
5. With no filter, the page, the text output, the JSON and `--request` are byte-identical to today's. With one, the JSON's `index`, `sections` and `roadmaps` are too.
6. `path:plans/desing` exits 2 naming the term. On the page, it keeps nothing and names the term.
7. `path:plans/design.md OR is:open` shows every entry under *Not filtered* on the page, and exits 2 before scanning.
8. A filtered link opened cold, and Enter on the box, shift nothing that is painted, and `history.length` is unchanged. Opening a filtered link and then clearing the filter makes at most two review requests in the visit, and no long task runs over 50 ms.
9. `g p` from a filtered page opens the bare page with an empty box, and Back returns to the filtered one with the box holding its text.
10. In daemon mode, a root-relative link reaches the filtered page in one click from *Choose a project*, and *Repository not found* lists the projects with the filter kept.
11. On the unfiltered page, `/` and then pasting the checker's whole output for criterion 1 shows the page of criterion 2, in single-repository and daemon mode alike.
12. `plans/design.md` in the viewer shows *its questions on the planning page* in its Referenced by line with zero layout shift as the index lands, and following it shows that document's entries, with the box holding `path:plans/design.md`.

## Decision Ledger

| ID | Ruling / Decision | Date | Settled in | Built |
| :--- | :--- | :--- | :--- | :--- |
| OQ-PF1 | The first release reads `path:` and `is:open`, nothing more. Other `is:` values, bare words and a leading `-` stay not understood, to come later under names chosen then | 2026-10-05 | [§5.3](#53-keys-and-how-terms-combine) | ✅ `parsePlanningFilter` in `packages/vantage-md/src/planning/filter.ts`; `is:blocked`, `search` and `-path:x` exit 2 |
| OQ-PF2 | Copy answers follows the filter: its payload and count cover kept questions only, and its tooltip says how many pending answers the filter leaves out | 2026-10-05 | [§6.6](#66-copy-agent-request-and-copy-answers) | ✅ `pendingAnswers` in `frontend/src/lib/planningAnswers.ts`; the button's name and tooltip in `PlanningPage.tsx` |
| OQ-PF3 | No address is stored or printed, so no `VANTAGE_PLANNING_URL`: it is a fact about a machine with no right home, and a machine may open one repository at several. The checker prints a root-relative link, and pasting it into the Filter box, alone or with the lines around it, applies its filter | 2026-10-05 | [§9.3](#93-no-address-is-kept), [§7](#7-the-filter-line) | ✅ `planningLink` and `readPastedPlanningLink` in `filter.ts`; the paste in `PlanningFilterLine.tsx`; no address read or kept anywhere |
| OQ-PF4 | Besides typing, `/` focuses the box, and a document's Referenced by line links to the page filtered to that document. No per-card toggle | 2026-10-05 | [§7](#7-the-filter-line) | ✅ `/` in `useKeyboardShortcuts.ts`; the link in `ReferencedBy.tsx`; no toggle on a card |
| OQ-PF5 | The filter line is always on the page: one fixed-height row in every state, from first paint | 2026-10-05 | [§7](#7-the-filter-line) | ✅ `PlanningFilterLine` drawn first in `PlanningPage.tsx`'s `<main>`, every state but a static export |
