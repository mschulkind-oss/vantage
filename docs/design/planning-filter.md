---
title: "An agent's planning link is a filter the human could have typed"
date: 2026-10-05
status: accepted
stage: BUILT
next: "Graduate into docs/reference/planning-index.md with the sketch beside this file, then delete both"
tags: [planning, vantage-check, agents, url, search]
summary: "A planning filter is one line of text, such as generator path:docs/design is:open, that the planning page's Filter box, its filter= URL parameter and vantage-check index --filter all read with one parser. Words and quoted phrases search what the index holds about each entry, as case-insensitive substrings; path: and is: narrow; a leading - excludes. The page applies it as you type. It hides entries of sections derived from the whole index and never reorders them. The checker prints a root-relative link to the filtered page, which the human pastes into the Filter box or puts their address in front of."
---

# An agent's planning link is a filter the human could have typed

**Status:** 2026-10-06 (`8995acb`). Built, with every ruling in the [Decision Ledger](#decision-ledger). The first build, which applied the filter on Enter and read only `path:` and `is:open`, is the tree [§3](#3-what-exists-today) describes at `519cd66`. Live search landed in three commits: words, phrases, `-` and the colon rule in the module the page and the checker share (`a2cc14c`), the page applying the box as you type (`8b4df7c`), and a typing flow in `just planning-perf` (`5013844`). The review of live search found eight defects, fixed in `8995acb`, among them the stale frame below. Where the build chose what this design delegates, or departed from a line of it, the sketch's [As built](planning-filter-plan.md#as-built) says. The typing targets of [§16](#16-typing-targets-and-how-they-are-read) were read in three batches of 10 runs a cell. Only the third began below a load average of 4, at 3.83, and its load rose to about 18 midway and ended at 10.8, so its verdict, that T1 to T4 are met on both trees, is a weak one:

- **MEASURED, this repository:** T1's p95 under 16 ms, T2's p95 30.8 ms, no long task over 50 ms, and no layout shift.
- **MEASURED, the scale fixture at 60 documents:** T1's p95 under 16 ms, the longest 24; T2's p95 98.8 ms against 100, with 4 of 120 keystrokes over 100 ms and the longest 163; no long task over 50 ms, and no layout shift. Pooled over all three batches, T2's p95 there is 90.7 ms, with 9 of 360 keystrokes over 100 ms.
- **MEASURED, in every batch:** no run added a history entry, the address took the filter in every run, and no visit made more than two review requests. In Chromium on the e2e fixture, criteria 13 and 14 hold, and a cold filtered link and an Enter shift nothing painted and leave `history.length` as it was (`frontend/e2e/planning_filter.spec.ts`).
- **A gap no target catches, now closed.** Typed at 30 ms a key on the scale fixture at 60 documents, the page painted an earlier text's results for one frame, 12 to 17 ms, before the last text's, in all 30 runs of the three batches, against [F7](#1-verdict-and-the-principles)'s *the newest text always wins*. The cause was not only slowness: a set offered while its text was the newest was shown by a render that ran after later keys. Since `8995acb` the shown set is taken only in the render that would show it, and only while no newer text is ahead of it. In one batch of 10 runs after the fix, which began at a load average of 10.8 and so is reported and not judged, no burst painted an earlier text after the last key on either tree, against 10 of 10 runs at 60 documents in the batch just before it. That batch's T2 p95 was 79.4 ms at 60 documents and 26.6 ms on this repository. The page still paints no results between the first key's and about 90 ms after the last key, and a profile puts about half of a slow keystroke at 60 documents in rendering the Markdown of cards that were not on screen before.
- **UNMEASURED:** the rest of [§14](#14-costs-and-what-is-unmeasured)'s list.

**Two rulings since, of 2026-10-06, landed together in the commit after `86165b2`.** `path:` finds its text anywhere in a path, case-insensitively, as GitHub's code search reads it ([§5.4](#54-path-patterns)): the gitignore-style whole-segment matching it replaced kept nothing while a path was typed ([§12](#12-alternatives-with-verdicts)). And while the reader types, a text that keeps no entry at all waits for the idle pause before it applies ([§6.4](#64-typing-and-the-url)), so `-m` or a half word no longer empties the page on each keystroke. T1 to T4 were not read again after them.

> **In short.** The link an agent hands over and the text a person types are the same thing: one **planning filter** that the Filter box, `?filter=` and `vantage-check index --filter` read with one parser. It searches the index's facts as you type, the way a search box does, and only ever hides entries of sections derived from the whole index, never reordering them.

**Why it matters.** You asked to be handed "all of the questions I need to answer" for one feature, and for a Filter box that searches as you type. In 0.8.1 the planning page shows every entry in the repository, nothing on it filters, and the checker cannot learn the address you open Vantage at ([§3](#3-what-exists-today)).

**The shape.** A parser and predicate in `vantage-md`'s planning module, applied after the sections are derived. The page applies the box's text on every keystroke and lets the URL follow it. The checker takes `--filter` and prints a root-relative link, which the Filter box applies when it is pasted in. A document's Referenced by line links to the page filtered to that document.

**Cost.** The page lays out again on every keystroke that changes the filter, held to typing targets of its own ([§16](#16-typing-targets-and-how-they-are-read)). A filtered link may keep other entries in a later release, because nothing freezes the language ([§10.3](#103-later-releases)). A 0.8.x viewer opens a filtered link unfiltered, without saying so ([§10.1](#101-older-readers)).

**Start at [§5](#5-the-filter-language):** the language. The page, the checker and the link all follow from it.

**Needs your ruling:** None. Every question is ruled ([Decision Ledger](#decision-ledger)).

**Reads with:** [`planning-index.md`](../reference/planning-index.md) (the planning page and `index` this extends; its principles P1 to P7 are cited by number), [`checker-version-skew.md`](checker-version-skew.md) (P0, which still governs what a filter reads from files and what the checker's JSON promises scripts), [`agent-cli.md`](../reference/agent-cli.md#11-principles) (P1, which is why the checker cannot ask the server for an address). The implementation sketch is [`planning-filter-plan.md`](planning-filter-plan.md); its WP-6 to WP-9 build live search.

---

## 1. Verdict, and the principles

**Build one filter text and give it three readers.** The Filter box on the planning page, the `filter` URL parameter and `vantage-check index --filter` all take the same string and read it with the same code. A link the agent prints is therefore a filter the human could have typed, and one the human typed is the text the agent's `--filter` takes. That is your "not some private filter thing", made literal: the filter has no state anywhere except its text.

**The language is a search box's** ([OQ-PF1](#decision-ledger)). Words and quoted phrases search what the index holds about each entry, `path:` and `is:open` narrow it, and a leading `-` excludes. The page applies the text as you type ([OQ-PF6](#decision-ledger)), and a later release may change what a text means ([OQ-PF7](#decision-ledger)). A text the language cannot read is applied not at all, rather than in part. Dropping the terms it cannot read looks kinder, and it is wrong: terms of one key are OR'd, so dropping one can hide entries the filter asked for ([F3](#1-verdict-and-the-principles)).

The principles below are numbered F1 to F7 *(coined here)* so later sections can cite them. They apply the planning reference's [P1 to P7](../reference/planning-index.md#11-principles) and the skew design's [P0](checker-version-skew.md#1-verdict-and-the-principles) to a filter.

- **F1. One text, three readers.** The box, `filter=` and `--filter` read one string through one parser in `packages/vantage-md/src/planning/`. The page reads and writes the URL only in `planningPages.ts`, beside `roadmap=`. The parameter's name, and the link the checker prints, come from the planning module (planning-index P4 and P7; AGENTS.md's "one implementation, three consumers").
- **F2. Filter after derivation, and only remove.** The filter applies to sections derived from the **whole** index. It keeps their order, and it never reaches into the index, the scan worker or the scan cache. An exclusion removes entries too; nothing in the language adds one.
- **F3. Malformed text applies nothing.** A text holding a term the language cannot read ([§5.5](#55-what-is-not-understood)) is not applied at all. Opened from a URL, or entered with Enter, the page shows every entry and names the term, and the checker exits 2. While the reader types, the page keeps what it shows ([§6.4](#64-typing-and-the-url)).
- **F4. The filter's only state is its text.** Nothing is stored. Every control that changes the filter writes text into the box, the URL follows the box within an idle pause ([§6.4](#64-typing-and-the-url)), and the URL outranks anything remembered ([planning-index.md:205-207](../reference/planning-index.md#L205-L207)). The roadmap the page shows is its own choice, as it is today, and not part of the filter.
- **F5. The page and the checker agree on what a text means, and the checker is stricter.** They agree within one release (planning-index P7), because they share the module and its fixture ([§10.4](#104-how-it-is-checked)). Where the page falls back and says why, the checker exits 2, as `--roadmap` does ([`commands/index.ts:192-207`](../../packages/vantage-check/src/commands/index.ts#L192-L207)): a not-understood filter shows every entry, and an unmatched term keeps nothing.
- **F6. No address is guessed or kept.** The checker never contacts a server, and nothing stores the address the human opens Vantage at. Its link is always root-relative, and the page's Filter box applies it when it is pasted in ([§9](#9-handing-the-human-a-link)).
- **F7. Typing never waits on the results.** The box shows a keystroke at once. The results follow, swapped in whole, within the targets of [§16](#16-typing-targets-and-how-they-are-read), and the newest text always wins. A text that keeps no entry at all waits for the idle pause instead, so the page never empties under a half-typed word ([§6.4](#64-typing-and-the-url)).

## 2. Terms

Every row below is coined here. Terms this document uses without defining are the planning reference's ([§2](../reference/planning-index.md#2-terms)): *section*, *frame*, *section bar*, *page* (of a section), *page inputs*, *agent request*, *chosen roadmap*, *routed*, *stage role*, *answered by a comment*. An **entry** is one item a section lists, either a question's card or a document's row. That reference uses the word this way without defining it. A question that only another roadmap routes is in no section, so it is counted, never an entry.

| Term | Means | Is not |
| :--- | :--- | :--- |
| **Planning filter** | One line of text deciding which entries of the planning page's sections are shown. It is the same text in the Filter box, the `filter` URL parameter and `index --filter` | A ranked search: it never ranks or reorders (planning-index P5). Not a saved view, nor the roadmap choice. Not review mode's take filter, which [planning-index.md:1036](../reference/planning-index.md#L1036) also calls a filter, nor the file picker's fuzzy filter |
| **Filter term** (a *term*, for short) | One piece of a planning filter, split at white space outside double quotes: a text term or a qualifier, either one with a leading `-` that makes it an exclusion | A section id, or a line of a gitignore file |
| **Text term** | A word or a `"quoted phrase"` that is not a qualifier. It matches an entry when it is a substring of one of the entry's searched fields, whatever the case ([§5.3](#53-what-a-term-matches-and-how-terms-combine)) | Fuzzy: no typo tolerance, no word prefixes, no ranking |
| **Searched fields** | What a text term is compared with. A question's are its id, its title, its leaning and its document's path. A Blocked document row's, or a *Ready to build*, *Ready to graduate* or *Stage conflict* row's, are its path, its `stage` and its `next`. A *Too large* or *Unreadable* entry's is its path | A question's body or comments, or any other frontmatter: the index does not hold them |
| **Qualifier** | A `key:value` term whose key is `path` or `is` | A text term that holds a `:`, such as `Note:` or `stage:ready` |
| **Key** | The word before a qualifier's first `:`: `path` or `is`, in lowercase | A frontmatter key, a `.vantage.toml` key, or a key on the keyboard |
| **Unknown key** | A lowercase word before a text term's first `:` that is not a key, such as `stage` in `stage:ready`. The term is searched as text, and the notice says the word is not a filter key ([§5.3](#53-what-a-term-matches-and-how-terms-combine)) | A key. Not the `Path` of `Path:x` nor the `http` of `http://x`, which draw no hint |
| **Exclusion** | A term with a leading `-`. It drops every entry the same term without the `-` would match | A way to keep more: an exclusion only removes |
| **Keep** | A filter *keeps* an entry when it passes all four tests of [§5.3](#53-what-a-term-matches-and-how-terms-combine): path, state, text and exclusions. A **kept entry** is a kept item a section lists | Routing: a kept entry has nothing to do with which roadmap links it |
| **Kept document** | A path the filter's `path:` terms keep: one of them matches it, or there are none, and no `-path:` term matches it. Text and `is:` terms choose among a kept document's entries and never change which documents are kept, so a kept document can have no kept entries | A kept entry |
| **`is:` value** | A question's state as the index reads it from the marker. `open` keeps a marker holding neither 🔒 nor ✅: 💬, 💬 🤷 or none. It is the only value the language reads ([OQ-PF1](#decision-ledger)) | *Answered by a comment*: the index reads no comments, so `is:open` keeps a question you answered on the page |
| **Not understood** (filter) | A filter holding at least one term the language cannot read ([§5.5](#55-what-is-not-understood)). It is not applied at all | An empty filter. Not a filter with an unmatched term, nor one whose text terms match nothing: both are applied. Not the page's refusal past `max-candidates` |
| **Unmatched term** | A `path:` term, with or without its `-`, that matches no path the index lists | A text term that matches nothing, which is not reported. A term that keeps a document with no entries, such as a `CURRENT` reference |
| **Canonical text** | The one spelling of a filter that the URL holds, Enter writes into the box and the checker echoes ([§5.6](#56-canonical-text)) | The text as typed, which the box keeps while the reader types |
| **Applied filter** | The filter whose results the page shows, or is bringing in. While the reader types it is the box's newest understood text, unless that text keeps no entry, which waits for the idle pause; otherwise it is the URL's | The box's text, which may not be understood. Not the URL's either, which lags the box by up to the idle pause |
| **Idle pause** | 300 ms in which the box's text does not change. After it the URL takes the box's newest understood text, which then applies ([§6.4](#64-typing-and-the-url)) | A wait before the page applies a text, except one that keeps no entry: the results of every other text never wait for it |
| **Filter line** | The fixed-height row at the top of the planning page that holds the Filter box ([§7](#7-the-filter-line)) | The frame, or the header |
| **Filter notice** | The sentences, shared by the page and the checker, saying a page is filtered and what that hides ([§6.7](#67-the-filter-notice)) | The box |
| **Planning link** | A URL to the planning page that carries a planning filter, as `--filter` prints it | The address bar after a flip, which may also hold page parameters |
| **Root-relative link** | A planning link that starts at `/.vantage/planning`, with no scheme, host or port, because the checker does not know them. The common name for what [RFC 3986 §4.2](https://www.rfc-editor.org/rfc/rfc3986#section-4.2) calls an absolute-path reference | A relative Markdown link. It is never resolved against the page it is opened from |
| **Pasted link** | A planning link, whole or root-relative, pasted into the Filter box on its own or inside the lines the checker prints around it ([§7](#7-the-filter-line)). The box applies its filter at once | Filter text: `filter=` and `--filter` never read a link |

When a second document needs one of these terms, it moves to the reference's term table and both link there.

## 3. What exists today

Line links are to the tree at `519cd66`. The first list is what 0.8.1 (`db5c01f`) had, which this design builds on; the second is what the first build of this design did that live search changed. The Status line names the commits that changed it.

**In 0.8.1:**

- **Nothing filtered the planning page.** It had no text input, and nothing in `vantage-md`'s planning module took a predicate. `derivePlanningSections(index, {roadmap})` has one option ([`sections.ts:590-593`](../../packages/vantage-md/src/planning/sections.ts#L590-L593)).
- **The URL holds the section ids and `roadmap`.** That is one page number per section (`needs-you`, `unrouted`, `waiting`, `ready`, `graduate`, `disagrees`, `skipped`, `could-not-read`; [`guide.ts:25-34`](../../packages/vantage-md/src/planning/guide.ts#L25-L34)) plus `roadmap=`. Every change the page makes is a replace navigation: the canonical rewrite ([`PlanningPage.tsx:1286-1297`](../../frontend/src/pages/PlanningPage.tsx#L1286-L1297)), flips, and a roadmap pick, which also drops `needs-you` ([`planningPages.ts:608-621`](../../frontend/src/lib/planningPages.ts#L608-L621)).
- **Every other parameter is kept and ignored.** `pageSearch` leaves "every other parameter, and the order of those it keeps" alone ([`planningPages.ts:623-646`](../../frontend/src/lib/planningPages.ts#L623-L646)), and a test pins `q=1&unrouted=3` as needing no rewrite ([`planningPages.test.ts:310`](../../frontend/src/lib/planningPages.test.ts#L310)). So a 0.8.0 or 0.8.1 viewer opened with `?filter=…` shows the whole page and says nothing.
- **Derivation reads documents a filter would hide.**
  - A `depends-on` target missing from the index never waits ([`sections.ts:569-583`](../../packages/vantage-md/src/planning/sections.ts#L569-L583)).
  - Routing needs every roadmap and its link targets. With no roadmap that routes, *Needs you* is every open question by document and *Not on a roadmap* does not exist ([`sections.ts:626-630`](../../packages/vantage-md/src/planning/sections.ts#L626-L630)).
  - So filtering the index before deriving would move blocked documents out of *Blocked*. With the roadmap filtered out too, which `path:docs/design/x.md` does, *Needs you* would lose roadmap order and its ✅ questions, and the page would show a false *No roadmap* notice.
- **The page's state had three identities that knew nothing of a filter.** These were the derived sections' cache keyed by index and roadmap ([`planningPages.ts:356-373`](../../frontend/src/lib/planningPages.ts#L356-L373)), the page-inputs key ([`usePlanningPageInputs.ts:127-134`](../../frontend/src/hooks/usePlanningPageInputs.ts#L127-L134)), and the frame, which re-derives its sections from the shown layout ([`PlanningPage.tsx:1612-1623`](../../frontend/src/pages/PlanningPage.tsx#L1612-L1623)).
- ***Needs you* is not "open questions".** Under a roadmap that routes, it holds 💬 and 🤷 questions and also ✅ ones waiting for compaction ([`sections.ts:521-526`](../../packages/vantage-md/src/planning/sections.ts#L521-L526)). A feature's open questions can also sit under *Not on a roadmap*, or on another roadmap, where no section lists them.
- **`index` refuses paths, and an older checker refuses new flags.** "A path would be a second answer to a question the root already settles" (`cli.ts:159-161`). An unknown option exits 2 ([`cli.ts:271-275`](../../packages/vantage-check/src/cli.ts#L271-L275)), while a variable it does not read goes unnoticed ([`useReviewStore.ts:1173-1187`](../../frontend/src/stores/useReviewStore.ts#L1173-L1187)).
- **Nothing tells an agent the server's address, and the checker may not ask.** "The filesystem is the only channel" ([`agent-cli.md` P1](../reference/agent-cli.md#11-principles)). The default port falls forward when busy (`serve.go:291-335`). Daemon mode adds a repository segment, which `planningPath` did not encode in 0.8.1 and now does ([`planningRoute.ts:19-37`](../../frontend/src/lib/planningRoute.ts#L19-L37)), as the startup tip does (`tips.go:200-201`). Tunnels and jails make the agent's `localhost` a different machine from the human's.
- **`compat-previous` cannot see any of this.** It renders notation through the previous *published* `vantage-md`, and the planning module is deliberately unpublished. The precedent for an older app's behavior is a hand-written model: `questionOffersTake` models 0.7.1's review mode ([`notation.ts:53-56`](../../frontend/src/compat/notation.ts#L53-L56), [`notation.ts:117-133`](../../frontend/src/compat/notation.ts#L117-L133)).

**In the first build, and changed by live search:**

- **The filter applies on Enter only.** The box is local state reset from the URL on each navigation it did not cause ([`PlanningFilterLine.tsx:99-108`](../../frontend/src/components/PlanningFilterLine.tsx#L99-L108)), and typing changes nothing else ([`:163`](../../frontend/src/components/PlanningFilterLine.tsx#L163)). Enter, ✕ and a pasted link apply through one replace navigation ([`PlanningPage.tsx:2016-2053`](../../frontend/src/pages/PlanningPage.tsx#L2016-L2053)).
- **A bare word is not understood.** A term with no `:` reads as nothing ([`filter.ts:310-326`](../../packages/vantage-md/src/planning/filter.ts#L310-L326)), and so do a leading `-`, an unknown key and `Path:`. The fixture of forms lists each under `notUnderstood`.
- **The fixture is compared with its copy at the previous release's tag** ([`planningFilter.test.ts:266-332`](../../frontend/src/lib/planningFilter.test.ts#L266-L332)), so that no understood text could ever change what it keeps.
- **A filter applied mounts the sections anew.** The section bar, the notices with the sections, and the outline are keyed by the shown filter ([`PlanningPage.tsx:1657-1658`](../../frontend/src/pages/PlanningPage.tsx#L1657-L1658), [`:2314`](../../frontend/src/pages/PlanningPage.tsx#L2314)), because without it a first run measured a 0.078 layout shift on Enter. So each new filter renders every card it shows again.
- **Its caches are bounded by count, and typing would cycle them.** The page inputs keep eight sets (`limits.ts:135`), and parsed filters sixteen ([`planningPages.ts:413`](../../frontend/src/lib/planningPages.ts#L413)). The filtered sections of one derivation are kept for every filter text ever applied to it ([`planningPages.ts:382-401`](../../frontend/src/lib/planningPages.ts#L382-L401)).
- **The visit's second review request goes once sections are on screen** ([`PlanningPage.tsx:1452-1455`](../../frontend/src/pages/PlanningPage.tsx#L1452-L1455)), and each layout's inputs ask for their own shown documents' reviews ([`usePlanningPageInputs.ts:264-276`](../../frontend/src/hooks/usePlanningPageInputs.ts#L264-L276)).

## 4. Non-goals

- **Not a ranked search.** It never ranks, sorts or reorders, so roadmap order survives every filter (planning-index P5).
- **No fuzzy matching.** No typo tolerance, word prefixes, stemming, diacritic folding or Unicode normalization. A later release may add a fuzzy term as a key of its own.
- **Not stored.** There is no remembered last filter, no named filters in `.vantage.toml` and no preference. A filter lives in a link and in the box, nowhere else.
- **Not a stable query language across releases** ([OQ-PF7](#decision-ledger)). A filtered link is for handing over now, not for keeping: a later release may keep other entries for the same text.
- **Not across repositories**, in daemon mode included ([planning-index.md §17](../reference/planning-index.md#17-non-goals)).
- **Never filled in from the document the reader came from.** `g p` on a document opens the bare page, as it already chooses the roadmap without regard to that document ([planning-index.md:2409-2411](../reference/planning-index.md#L2409-L2411)).
- **Nothing beyond index facts.** It never searches question bodies, comments, frontmatter `title` or `tags`, or a document that is not a planning document. Counts and page bounds therefore stay exact at first paint ([S1 and S2](../reference/planning-index.md#12-principles-at-scale)).
- **No link-graph keys and no `depends-on` closure.** Over this repository's 19 planning documents before this one, the transitive link closure of a single design reached 16 of them.
- **No selection of one question by id.** Ids are unique only within a document. A text term finds every question whose id holds it, in every document.
- **No merging of roadmaps.** A filtered page still lists only the chosen roadmap's *Needs you*; questions other roadmaps route are counted and named, never interleaved ([planning-index.md §17](../reference/planning-index.md#17-non-goals)).
- **No evaluation on the server.** Go is unchanged, and the server still parses no Markdown.
- **No pushing a filter to an open page** through `.vantage/inbox`. An older server would consume the message and report `delivered:`.
- **No new route to stop older viewers**, and no filter in a static export, which has no planning page.
- **No change to unfiltered output.** `vantage-check index` without `--filter` prints the same bytes as today, in text, in JSON and with `--request`.
- **Not task state.** There are no "done" or "seen" marks: what is left is what the filter keeps.

## 5. The filter language

### 5.1 One parameter, one flag, one box

- **The URL parameter is `filter`, and the flag is `--filter`.** The parameter collides with no section id and not with `roadmap`.
- **Why not `q`.** `q=1` is the test fixture for an unknown parameter (`planningPages.test.ts:310`). Also, the parameter, the flag and the box's label should be one word a person reads three times.
- **Given more than once,** the values join with one space, in order. That is exactly what typing both into the box gives.
- **An empty or all-whitespace value is no filter.** The page then removes the parameter, so an unfiltered URL never carries one, and the e2e specs' anchored URL patterns stay true.

### 5.2 Grammar

```text
filter    = [sp] [ term *( sp term ) ] [sp]
sp        = 1*( SP / HTAB / CR / LF )
term      = [ "-" ] ( qualifier / text )   ; a leading "-" is always an exclusion's
qualifier = key ":" value                  ; when the part before the first ":" is a key
key       = "path" / "is"                  ; lowercase only
value     = pattern / quoted               ; after "is:", only a bare "open"
text      = word / quoted
word      = 1*wchar
wchar     = any code point except SP, HTAB, CR, LF, DQUOTE and the excluded code points
pattern   = 1*wchar                        ; a "*" in it is a wildcard (§5.4)
quoted    = DQUOTE 1*( qchar / "\" DQUOTE / "\" "\" ) DQUOTE
qchar     = any code point except DQUOTE, "\" and the excluded code points
```

- **The colon rule.** A term is a qualifier exactly when the part before its first `:` is `path` or `is`; it must then read as one, or it is not understood. Every other term is a text term, colon or not: `stage:ready`, `Note:`, `http://x` and `Path:docs` are all searched as text.
- **A `"` opens a quote anywhere in a term**, and white space inside quotes does not split. So `a"b c"` is one term, which is not understood, because a quote may only wrap a whole value.
- **One leading `-` is the exclusion's.** What follows it is read as a term on its own, so `--x` excludes the text `-x`, and a lone `-` is not understood.

Text the grammar does not produce is not understood, and so is text it produces that [§5.5](#55-what-is-not-understood) lists. To name a term, in the notice or in an exit-2 message, the text is split at white space outside double quotes, and an unclosed quote runs to the end of the text.

### 5.3 What a term matches, and how terms combine

| Term | Matches | Entries it can keep |
| :--- | :--- | :--- |
| A text term: `generator`, `"command surface"` | An entry one of whose searched fields holds it as a substring, compared after `toLowerCase` on both sides | Every kind |
| `path:<pattern>` or `path:"<literal>"` | The entry's path. For a question that is its document's path. For a Blocked row, a stage row, a Too large or an Unreadable entry, it is the row's own path | Every kind |
| `is:open` | A question the index reads as open: its marker holds neither 🔒 nor ✅, so 💬, 💬 🤷 or no marker ([`scan.ts:352-361`](../../packages/vantage-md/src/planning/scan.ts#L352-L361)) | Questions only |

**An entry is kept when it passes all four tests:**

1. **Path.** The filter has no `path:` term, or one of them matches the entry's path. Terms of one key are OR'd, because a document has one path.
2. **State.** The filter has no `is:` term, or the entry is a question whose state one of them matches. A document row has no state, so any `is:` term drops it.
3. **Text.** Every text term matches the entry, in any order, each in a field of its own choosing. Text terms are AND'd, as words in a search box are.
4. **Exclusions.** No exclusion matches the entry: a `-path:` term its path, `-is:open` an open question, and a `-` text term one of its searched fields. `-is:open` never drops a row, which has no state.

**How a text term is compared:**

- **Substring, case-insensitive, literal.** The term and each field are lowercased with JavaScript's `String.prototype.toLowerCase`, and the term must occur in the field. Nothing is a wildcard: `*` and `?` are themselves. There is no normalization, so an NFD `é` does not match an NFC one, and `ß` is not `ss`.
- **A quoted phrase is one substring,** spaces included: `"command surface"` matches a title holding those two words together, and not one holding them apart.
- **Fields one at a time.** A term never spans two fields, so the phrase `"x.md design"` cannot match a row by the end of its path and its stage together.
- **The index's own strings.** A question's title is the bold `OQ-…` title as the scanner flattens it, and its leaning is the directive's `leaning=` as the index holds it. A document's `stage` and `next` are its frontmatter values as the index holds them. A field the index holds as `null` matches nothing.
- **No match is an answer, not an error.** A text term that matches nothing leaves an empty result, which the notice counts; it is never an unmatched term.

**The rest of the rules:**

- **An unknown key draws a hint.** A text term whose part before its first `:` is one or more lowercase ASCII letters, is not a key, and is not followed by a `/` gets a line in the notice saying that word is not a filter key ([§6.7](#67-the-filter-notice)). So `stage:ready` and `-title:x` draw one; `http://x`, `Note:` and `Path:x` do not, and neither does a quoted phrase.
- **`is:open` keeps a question you answered with a comment.** The index reads no comments, so the card stays, under its section's *(N answered)* count ([`planning.md`, A comment on a question is your answer](../../userguide/guides/planning.md#a-comment-on-a-question-is-your-answer)). That collision is also why a value for ✅ questions would never be `answered`: the page already calls a question you commented on *answered*.
- **`path:<doc> is:open` is "every question I need to answer"** for `<doc>`. It keeps the 💬 and 🤷 questions under *Needs you* and under *Not on a roadmap*. It counts those on other roadmaps, and the notice names each of those roadmaps ([§6.7](#67-the-filter-notice)). It leaves out ✅ questions, which are the agent's to compact, and 🔒 ones, which cannot be answered yet, and the notice says how many 🔒 it left out. Under `path:` alone the same link also lists the document's rows and its ✅ questions.
- **`path:` searches the path alone.** `path:docs/des` keeps every entry whose path holds that text, and so does the word `docs/des`, which also matches a question's id, title or leaning and a row's `stage` or `next`. What `path:` adds is the path's start (a leading `/`), wildcards, and being a [kept document](#2-terms)'s test, which the unmatched rule and the notice's paths clause count.

### 5.4 Path patterns

**A `path:` value is found anywhere in the path, case-insensitively; `*` stands for any characters within one folder or file name and `**` for any characters across folders; a leading `/` (or `./`) pins it to the start of the path.** A quoted value is the same with every character literal, `*` included, and spaces allowed. That is the `path:` qualifier of [GitHub's code search](https://docs.github.com/en/search-github/github-code-search/understanding-github-code-search-syntax#path-qualifier), without its `?` and its regular expressions. It replaced, on 2026-10-06, gitignore-style matching of whole folder and file names, which kept nothing while a path was typed ([§12](#12-alternatives-with-verdicts)).

| Form | Keeps |
| :--- | :--- |
| `path:docs/des` | `docs/design/a.md`, `x/docs/design/a.md` and `docs/designx/d.md`: every path holding that text. So each keystroke of a path keeps what the finished path does, and more |
| `path:filter` | Every path holding `filter`, in a folder's name or a file's |
| `path:/roadmap.md` | The root's `roadmap.md`, and any path that starts with that text, such as `roadmap.md.bak`; not `docs/roadmap.md`, which `path:roadmap.md` keeps too |
| `path:/docs/design/x.md` | That file: what Vantage and the checker write for one document ([§5.6](#56-canonical-text)) |
| `path:*.md` | Every Markdown file |
| `path:/docs/*.md` | The `.md` files directly in the root's `docs`: a `*` stays within one name |
| `path:/docs/**.md` | Every `.md` under the root's `docs`, at any depth: `**` crosses folders |
| `path:DOCS/Design` | What `path:docs/design` keeps: case is folded on both sides |
| `path:"docs/my notes.md"` | That text, the space included. Quoted, a `*` is a `*` |

- **How it is compared.** The value and the path are both lowercased with `toLowerCase`, as a text term and its fields are ([§5.3](#53-what-a-term-matches-and-how-terms-combine)). Quoted, or with no `*`, the value must occur in the path, or start it when it has a leading `/`. Bare, each lone `*` matches any run of characters holding no `/`, each run of two or more `*` any run at all, and the rest is literal.
- **Nothing else is special.** `?`, `[`, `#`, `!`, `\` and `+` are themselves, and so are `//`, `.` and `..`. A `/` that does not lead is a character of the text: `path:docs/` keeps every path holding `docs/`, at any depth.
- **`**/` needs a folder.** `**` is any characters, so `path:docs/**/x.md` keeps `docs/a/x.md` and not `docs/x.md`, which `path:docs/**x.md` keeps too.
- **A leading `/` pins, and one leading `./` reads as `/`,** as `roadmap=` reads it ([`planningPages.ts:445-450`](../../frontend/src/lib/planningPages.ts#L445-L450)). A value pinned to the start still keeps a longer path: `path:/docs/x.md` keeps `docs/x.mdx` too.
- **Only case is folded.** An NFD spelling does not keep an NFC path, and `ß` is not `ss`. Where a repository holds `Docs/x.md` beside `docs/x.md`, a value keeps both.
- **An exclusion matches the same way.** `-path:<value>` drops exactly what `path:<value>` keeps.
- **Matched in the filter module alone.** `[planning] include` and `exclude` stay gitignore patterns, read through the port of the server's matcher ([`compileIgnorePatterns`, `patterns.ts:103`](../../packages/vantage-md/src/planning/patterns.ts#L103)), which `path:` no longer uses: `include` decides what is indexed, and `path:` what is shown of it.

### 5.5 What is not understood

Each of these makes the whole filter **not understood** ([F3](#1-verdict-and-the-principles)). They are text whose meaning the reader cannot have spelled clearly; none is held back for a later release ([OQ-PF7](#decision-ledger)).

- **Quotes and escapes.**
  - An unclosed quote.
  - A quote that does not wrap a whole value: `a"b"`, `"a"b`, `path:docs/"a".md`.
  - Inside quotes, a `\` followed by anything but `"` or `\`.
  - An empty quoted value, `""` or `path:""`.
- **A lone `-`**, an exclusion of nothing.
- **A qualifier whose value the language cannot read.**
  - An empty value, `path:` or `is:`.
  - An `is:` value other than a bare `open`, such as `is:closed`, `is:Open` or `is:"open"`.

  Any other `path:` value is understood, whatever it holds. Until 2026-10-06 a bare one was not when it held a character outside `A–Z a–z 0–9 . _ - / *`, one of five `**` forms, `//`, or a `.` or `..` segment: forms the port read differently from git, which `path:` no longer runs through ([§5.4](#54-path-patterns)).
- **An excluded code point in any term**: a control or an invisible format character, or a lone surrogate. Tab, CR and LF outside quotes are white space, which separates terms ([§5.2](#52-grammar)), so only inside quotes do they count. They are listed as a fixed table in the filter module (U+0000 to U+001F, U+007F to U+009F, U+00AD, U+061C, U+180E, U+200B to U+200F, U+202A to U+202E, U+2060 to U+206F, U+FEFF), so a browser and the checker agree on every one. A word containing a zero-width space would otherwise match nothing, and say nothing about why.
- **Too long:** more than 64 terms, or more than 2,048 code points. Both limits are constants in the filter module, and tests configure them down rather than building long inputs.

A not-understood filter is never rewritten, never partly applied and never read as text. Once applied, by an Enter or from a URL, the page keeps it in the URL and the box exactly as written, so it can be fixed ([§10.2](#102-what-a-malformed-filter-does)).

### 5.6 Canonical text

The URL holds an understood filter in its canonical text, and the checker echoes the same text. The box shows it after an Enter, and never rewrites what the reader is typing ([§6.4](#64-typing-and-the-url)).

1. Each term is written by the rules below. The terms are then joined by one space, in the order written, and a repeat of an earlier term is dropped.
2. In a bare or quoted `path:` value, one leading `./` becomes `/`, which means the same. A leading `/` stays, since it pins the value to the path's start: `./docs/x.md` and `/docs/x.md` become `/docs/x.md`, and `docs/x.md` stays as it is. Its case stays too.
3. A quoted `path:` value is written bare when bare it reads the same: it holds no white space, no `"`, and no `*`, which bare is a wildcard.
4. A bare word is written as typed, in its own case. A quoted phrase is written bare when, bare, it reads as the same text term and draws no hint: it holds no white space, no `"` and no `:`, and does not start with `-`.
5. An exclusion is a `-` followed by its term's canonical text.
6. Inside quotes, only `"` and `\` are escaped.
7. No terms means no parameter.

A filter that Vantage or the checker generates names each document as `path:/<its path>`, quoted where the path holds a space, a `"` or a `*`. It keeps that document, and any path that starts with its text.

The canonical text holds no control characters, so it can sit in any newline-joined cache key.

## 6. What a filter does to the page

### 6.1 Where it applies

The page derives the sections over the whole index, under the chosen roadmap, exactly as today. The filter then takes them in and returns sections of the same shape with entries removed and none reordered. Every consumer that already reads sections picks the filter up unchanged: the layout, the pagers, the outline, the section bar and the agent request, which reads the unfiltered sections for one fact ([§6.3](#63-blocked-on-reads-the-unfiltered-sections)). Blocked still names blockers the filter hides, and routing still uses roadmaps it hides, because neither is recomputed.

### 6.2 Every section and every whole-index value

| Value | Under a filter, on the page and in `filter.sections` |
| :--- | :--- |
| Every section's entries: *Needs you*, *Not on a roadmap*, *Blocked* (both kinds), *Ready to build*, *Ready to graduate*, *Stage conflict*, *Too large*, *Unreadable* | The kept entries, in the same order. A section the filter empties is not shown, as an empty section is not shown today |
| Section bar, section headings, pagers, page bounds, outline | From the filtered sections. Page bounds still come from index facts alone, so they are exact at first paint |
| `onOtherRoadmaps`, and the "N more on other roadmaps" line | Kept questions only. They stay counted questions, never entries, and the filter notice names each roadmap that holds them ([§6.7](#67-the-filter-notice)) |
| Each roadmap's `needsYouCount`, the picker's "(N need you)" and the page's recount of it | Counted over kept questions. The recount ([`planningAnswers.ts:192-232`](../../frontend/src/lib/planningAnswers.ts#L192-L232)) applies the same predicate |
| The roadmap list, each roadmap's state, `chosenRoadmap`, `stagesDeclared` | Unchanged. A filter never changes which roadmap is chosen: the URL's, then the remembered one, then the default |
| `nothingNeedsYou` ([`sections.ts:652`](../../packages/vantage-md/src/planning/sections.ts#L652)) | True when no open question in a live document is kept: today's rule with the filter applied, so a kept question on another roadmap counts. The frame's *Nothing needs you* then reads *Nothing this filter keeps needs you* |
| The head-of-sections line saying every open question has your answer | Over kept questions |
| A Blocked document row | Kept when the filter keeps it as a row ([§5.3](#53-what-a-term-matches-and-how-terms-combine)), with every blocker still named and linked, because the row comes from the whole derivation. An `is:` term drops it. Either way, the notice names each blocker the filter leaves out ([§6.7](#67-the-filter-notice)) |
| The roadmap notice, the no-stages notice, the refusal past `max-candidates` | Unchanged: they are facts about the repository |
| Copy answers | Kept questions only ([§6.6](#66-copy-agent-request-and-copy-answers)) |

The checker's JSON keeps `sections` unfiltered and carries these values as `filter.sections` ([§8.3](#83-output)).

### 6.3 Blocked-on reads the unfiltered sections

An agent request annotates a *Ready to build* or *Ready to graduate* row with what it is blocked on. When any row is so annotated, it adds "Skip any entry marked blocked". `blockedOn` finds that by scanning the sections' Blocked entries for the row's path ([`guide.ts:496-519`](../../packages/vantage-md/src/planning/guide.ts#L496-L519)).

A Ready document can still hold 🔒 questions: *Ready to build* excludes only open ones ([`sections.ts:657`](../../packages/vantage-md/src/planning/sections.ts#L657)). So a filter that keeps the row and drops its 🔒 entries would erase the annotation, and the agent would be told to build something that still waits.

A text term does exactly that: `decided` keeps a row whose stage is `DECIDED` and drops every 🔒 question of that document whose fields do not hold the word. So **the request's blocked-on facts come from the unfiltered sections, always.** `path:` alone could not hit the case, because it keeps a document's row and its Blocked entries together, and an `is:` term keeps no row.

### 6.4 Typing, and the URL

- **On open.** The page reads `filter`. If it is understood and not canonical, the existing in-place rewrite writes the canonical text as one parameter, in the same replace that clamps pages, with the fragment kept. A not-understood filter is left exactly as written. Page parameters in a filtered link are read against the filtered sections.
- **Typing applies** ([OQ-PF6](#decision-ledger)). The page parses the box's text on every change to it.
  - **An understood text** whose canonical text is not the applied filter's becomes the applied filter. The page lays out its sections, every section on its first page and the roadmap kept, and asks for their page inputs. The old results stay on screen until those inputs are in, and then everything changes in one commit.
  - **An empty text** is no filter, and applies the same way.
  - **A text that keeps no entry at all waits for the idle pause** (ruled 2026-10-06). Until the URL takes it, on the pause or at once on an Enter, ✕, paste or the focus leaving the box, the page goes on showing the filter it applied last. So `-m`, which every `.md` path holds, or a half word that matches nothing, never empties the page between two keystrokes, and *nothing matches* still shows as soon as typing stops. The page judges it in the render the keystroke's transition runs, never in the keystroke's own task ([F7](#1-verdict-and-the-principles)). A text whose only entries are questions on other roadmaps keeps no entry, since those are counted and not listed.
  - **A text with the applied canonical text,** such as one with a space added, changes nothing.
  - **A not-understood text changes nothing on the page.** The results on screen stay, and the hint slot says the text is not applied ([§7](#7-the-filter-line)). Nothing snaps to every entry because a quote was just opened.
- **The URL follows the box.** One replace navigation writes the applied filter after the idle pause, 300 ms in which the box's text has not changed. It is written at once, instead, on Enter, on ✕, on a paste, and when the focus leaves the box. Every write does what Enter does:
  - it sets `filter` to the applied filter's canonical text, or removes it for no filter;
  - it writes `filter` first, with the link encoding of [§9.2](#92-the-link-it-prints), so the address bar shows what an agent's link shows, and writes every other parameter after it as the page writes it today;
  - it deletes every section's page parameter, as a roadmap pick deletes `needs-you`;
  - it keeps `roadmap` and every unknown parameter;
  - it drops the fragment.

  A write that would change nothing is not made. **Typing never adds a history entry**, so Back from a filtered page goes where it went before the reader typed.
- **The box's text is never rewritten by a write of its own filter.** A write of the URL leaves the box alone, caret and selection included, even where the box holds `./docs/x.md` and the URL `docs/x.md`. What does rewrite it is an Enter, and a navigation the box did not cause ([§7](#7-the-filter-line)).
- **On Enter.** The box's text is applied at once and written at once, and the box then shows its canonical text. A not-understood text is applied as written: the URL takes it, and the page shows every entry under the *Not filtered* notice, as it does when a URL holds one on open. Enter on the text already applied and written rewrites the box to canonical text and does nothing else.
- **On ✕.** Enter on an empty text.
- **On a paste.** A pasted planning link applies its filter at once, and its roadmap when it names one ([§7](#7-the-filter-line)). Other pasted text changes the box as typing does, and is written at once rather than after the pause.
- **The newest text wins.** The applied filter has one writer at a time: the box, from the reader's first change until the URL has taken the text, and the URL otherwise.
  - A text superseded before its page inputs are in is never shown. Its inputs may finish, but they are never shown unasked.
  - A navigation the box did not cause, a push or a pop, wins over the box. It drops a write the idle pause still owes, and the box and the applied filter both take its URL's filter.
- **While the results are on their way,** the old page's pagers and the outline flip nothing, since their pages are the old filter's. Past 150 ms (`spinnerMs`, `limits.ts:131`) a spinner shows in the filter line's own slot. It is drawn in the commit of the reader's change and shown by the browser once the time has passed, because the router commits the URL, and the page its new inputs, in transitions, and an update a timer makes meanwhile commits only with them. Typing past an Enter, ✕ or paste whose page is still on its way hands the spinner to the typed text's page, which it then waits for instead.
- **An index update while filtered** applies the same text to the new index. Counts change in the commit that changes the sections, as they do today.
- **A roadmap pick keeps the filter.** So do page flips and the outline's links, which carry the whole query. Each carries the applied filter, so one the idle pause still owes is written in the same replace, and each writes `filter` in the link encoding, so the address bar never shows the form encoding's bare `*`, and a copy of it pasted into the box reads back whole. A press that lands before the render of the reader's last keystroke carries that keystroke's text instead, so the URL never takes an older filter than the page goes on to show: a pick keeps its roadmap, and a flip or an outline jump flips nothing, since its page is the old filter's.
- **`g p` and the sidebar entry open the bare page** and drop the filter, as they already drop page parameters and `roadmap=` ([`useKeyboardShortcuts.ts:110-115`](../../frontend/src/hooks/useKeyboardShortcuts.ts#L110-L115), [`AppShell.tsx:500-506`](../../frontend/src/components/AppShell.tsx#L500-L506)). A filter belongs to a link, never to the document the reader came from. Back returns to the filtered URL, and the box follows it ([§7](#7-the-filter-line)).
- **Nothing is remembered.**

### 6.5 Identities, and what typing must not churn

The applied filter's canonical text joins every identity a page of the planning page has:

- the cache of derived sections, which is keyed by index, then roadmap, then filter;
- the layout, whose invariant becomes "two layouts of one index with the same roadmap, filter and pages show the same entries";
- the page-inputs cache key;
- the pager and outline prefetch;
- the frame's re-derivation of its sections from the shown layout.

A not-understood filter shows the same entries as no filter, so its identity is no filter's.

**Typing lays out a page per keystroke, and none of that may cost what Back relies on:**

- **No set of page inputs another history entry was shown with is evicted by typing.** A set laid out for a text the reader has typed past is dropped from the cache once it is superseded, so typing holds at most two of the eight places: the set on screen and the one on its way.
- **The other caches keyed by filter are bounded too.** The derived sections and the parsed filters kept for typed texts never grow with the number of keystrokes. The bound is the implementer's.
- **Typing adds no review request.** A visit still makes at most two ([D11](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured)), however soon the reader types. The second request reads every document the unfiltered sections list ([§6.6](#66-copy-agent-request-and-copy-answers)), so it covers every filter. A filter change made before that request has gone sends it at once, and a typed text's page inputs wait for its answer instead of asking for their own.

### 6.6 Copy agent request and Copy answers

**Copy agent request and Copy all agent requests follow the filter.** When a filter is applied, the text gains one line after `Repository:`:

```text
Filter: `path:/docs/design/x.md is:open`. Only the entries it keeps are listed.
```

- **The line carries the canonical text with its unmatched terms left out.** An unmatched `path:` term keeps nothing, terms of one key are OR'd, and an unmatched `-path:` term excludes nothing, so leaving them out keeps the same entries, and the line stays a text `--filter` accepts. When every `path:` term without a `-` is unmatched, nothing is kept and there is no request.
- **The text is a code span**, fenced with one more backtick than the longest run inside it and padded with a space where it starts or ends with a backtick, so the period after it can never be read as part of a path.
- **The request is byte-equal to `vantage-check index --request --filter '<the line's text>'`.** The parity test, which compares what a button copies with what `--request` prints for the same tree ([`PlanningPage.test.tsx:3204`](../../frontend/src/pages/PlanningPage.test.tsx#L3204)), runs over every understood text in the fixture whose request is not empty.
- Unfiltered text gains nothing and stays byte-identical.
- The `Verify:` line is unchanged.
- A not-understood filter is not applied, so its request has no `Filter:` line and equals plain `--request`.

**Copy answers follows the filter** ([OQ-PF2](#decision-ledger)). With one agent per piece of work, the agent for one piece gets that piece's answers and no one else's. Two rules hold beneath it:

- **The visit's two review requests read every document the unfiltered sections list.** A visit makes at most two ([`usePlanningReviews.ts:9-12`](../../frontend/src/hooks/usePlanningReviews.ts#L9-L12)), and a layout asks for any shown document the tab has not read ([`usePlanningPageInputs.ts:166-195`](../../frontend/src/hooks/usePlanningPageInputs.ts#L166-L195), [`:264-276`](../../frontend/src/hooks/usePlanningPageInputs.ts#L264-L276)).
  - The first request holds the shown pages' documents and those with a question that needs you.
  - The second, once the sections have painted or the reader has changed the filter, holds every other document any unfiltered section lists: the question documents, and every row's document too.

  So opening a filtered link and then clearing the filter, or typing any filter at all, makes no third request. Copy answers counts once the listed questions' documents are read, and is unknown only while one of them is: a row's document holds no listed question, so no answer, and neither the second request's wait nor its failure holds the count back.
- **Comments are placed over the unfiltered listed questions** ([`planningAnswers.ts:115-121`](../../frontend/src/lib/planningAnswers.ts#L115-L121)), and only the resulting groups and the set of answered questions are then narrowed to kept ones. Placement picks the innermost listed question whose unit holds a comment's line ([`planningPages.ts:718-742`](../../frontend/src/lib/planningPages.ts#L718-L742)). Placing over kept questions alone would credit a comment on a hidden nested question, such as a ✅ one under `is:open`, to the kept question around it.

The payload and its count cover pending comments on kept questions only. The button's tooltip and accessible name say how many pending answers the filter leaves out. Neither is visible text, so nothing in the header moves as reviews arrive.

### 6.7 The filter notice

The notice is the first of the frame's notices. It arrives with the section bar, it describes the results on screen rather than the box's text, and it prints. Its words live in `PLANNING_NOTICES`, so the page and the checker share them. The filter text in it is set off: as code on the page, and between backticks in the checker's text, so the `:` after it cannot be read as part of it. It takes four forms:

| Form | Says |
| :--- | :--- |
| Applied | A first line: the canonical text, then entries shown of the unfiltered total, kept documents of the paths the index lists when its path terms leave a path out, and how many kept entries are open questions. For example: ``Filtered by `path:/docs/design/x.md is:open`: 5 of 15 entries, in 1 of 20 paths, 5 of them open questions.`` Then one line per clause below that applies. Last, the page's "Clear the filter to see the other 10." or the checker's "Run without --filter to see the other 10." |
| Applied, nothing kept | The same, with none shown, followed by the filtered *Nothing this filter keeps needs you* |
| Unmatched term | One line per term, under the first: `` `path:docs/desing` matches no path the index lists. `` |
| Not understood | ``Not filtered: this Vantage cannot read `<term>`.`` Then what the language reads, with a real example, and ``Every entry is shown.`` Where there is no term to name, the reason stands in its place: an unclosed quote, or a filter past 64 terms or 2,048 code points |

The clauses of the applied form:

- **Not a key.** One line per unknown key, in the order written: `` `stage:` is not a filter key, so `stage:ready` is searched as text. The keys are `path:` and `is:`. `` It comes right after the unmatched lines.
- **Other roadmaps.** ``2 more questions it keeps are on other roadmaps: `docs/a/roadmap.md` (1), `docs/b/roadmap.md` (1).`` The page adds "Choose one to see them; the filter stays." and the checker "Rerun with --roadmap naming one."
- **Blocked.** ``3 of its questions are blocked and will need you later.`` It counts the 🔒 questions that every term of the filter but its `is:` terms keeps, and an `is:` term leaves out, so a human told "nothing needs you" knows whether a later round will come.
- **Waits on.** ``docs/design/x.md waits on docs/design/y.md, which this filter leaves out.`` One line for each kept document whose Blocked row, in the unfiltered sections, names a target that is not a kept document. A `#OQ-…` target is named with its fragment, and adding `path:` for it brings in its whole document, since no key selects one question.

The other rules:

- **What is counted.** "Paths" counts every path the index lists: its planning documents and its Too large and Unreadable paths. A filter with no `path:` or `-path:` term keeps every path, so the *Waits on* clause never applies to it. The first line leaves the paths out whenever the path terms keep every path, as such a filter's do: said of a word that keeps nothing, *in 20 of 20 paths* reads as a contradiction. The checker's JSON still gives both counts. The total of entries is the unfiltered section bar's sum.
- **What is delegated.** The exact words are the implementer's. The counts, their order, the clauses and which of them apply are not.
- **Words.** "Not understood" is chosen so that it collides with none of the roadmap state `unreadable`, the *Unreadable* section, and the refusal past `max-candidates`.

## 7. The filter line

- **Placement.** The filter line is a row at the top of `<main>`, above every state of the planning route: *Choose a project*, *Repository not found*, loading, building, ready, the load error and the refusal past `max-candidates` ([`PlanningPage.tsx:2358-2406`](../../frontend/src/pages/PlanningPage.tsx#L2358-L2406) draws those as alternatives). The shell draws no page until the repository list has loaded ([`AppShell.tsx:126`](../../frontend/src/components/AppShell.tsx#L126)), so which of them shows is known at the page's first paint. It is not drawn in a static export, which has no planning page and knows so from a flag the static build writes into the page.
- **Places it is not.** The other placements were rejected:
  - **Not the header.** A box there takes the header's yield steps sooner, and in the end narrows the file name. The header is also hidden in print (`index.css:2613`).
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
- **At narrow widths** the hint gives way first, to an icon in a slot of its own, always there, whose title holds the hint's words; then the visible label gives way, and stays the accessible name. The input keeps a minimum width, whose size is the implementer's, the ✕ and spinner keep their slots, and the row never wraps.
- **Behavior.**
  - **On open,** the box holds the URL's text exactly. It never takes the focus ([`useShellPage.ts:152-158`](../../frontend/src/hooks/useShellPage.ts#L152-L158)). A not-understood filter marks the input `aria-invalid` and gives it an amber ring from first paint.
  - **Typing applies** ([§6.4](#64-typing-and-the-url)), and a text that keeps no entry once the idle pause has passed. The box shows each keystroke at once, in the same frame, whatever the results are doing: their layout and their render never run ahead of the box's own update ([F7](#1-verdict-and-the-principles)).
  - **While an input method composes,** between its composition's start and end, the box applies nothing. The composed text applies when the composition ends, so a reader writing in Japanese or Chinese never sees the page chase the unconverted letters.
  - **A text that is not applied** is a not-understood text the reader has not entered. While the box holds one, the hint slot says so, and that Enter says why; the words are the implementer's, within the slot's fixed width. The input's description names the hint while it shows, so a screen reader hears it at every width. While the page applies a text typed since, a not-understood text in the box is not applied even where the URL holds that same text. The amber ring and `aria-invalid` come only with an applied not-understood filter, from the URL or an Enter, so opening a quote does not flash the box.
  - **Enter applies at once** ([§6.4](#64-typing-and-the-url)), and the box then shows the canonical text. Besides ✕ and a pasted link, which put their own text in the box, it is the one way the reader's own action rewrites the box's text while it has the focus.
  - **The box follows every navigation it did not cause.** After `g p` or the sidebar entry on this page, and after Back or Forward, the box shows the new URL's filter and drops any text not yet written, even while it has the focus. The planning page is not remounted by those navigations (one `${PLANNING_ROUTE}/*` route, [`App.tsx:17-19`](../../frontend/src/App.tsx#L17-L19)), so this has to be a rule. The page's own replaces never rewrite the box while it has the focus. Without the focus, one rewrites it only when its text does not read as the URL's filter: so no write of the box's own filter touches it, and the open rewrite still shows a link written in a spelling of its own in canonical text.
  - **✕ clears and applies in one step.** The focus stays in the box. ✕ is a control a reader aims at, and the link the agent handed over still holds the filter.
  - **Esc puts back the box's last understood text** when the box holds a text that is not applied: the one the page applies, or the idle pause is about to write, else the URL's. Otherwise it returns the focus to the pane. **Esc never clears:** it is pressed by reflex to leave a field, and a filter change replaces the history entry, so Back would not bring a cleared filter back.
  - **Leaving the box** writes the URL at once when the idle pause still owes a write, so an address copied right after typing holds the filter on screen. A text that is not applied stays in the box, with its hint.
  - **In the load error, the refusal, *Choose a project* and *Repository not found*,** the box still reads and writes the URL, typing included. There are simply no sections for it to filter.
  - **The page's shortcuts** turn off while the box has the focus, at no cost ([`useKeyboardShortcuts.ts:75-86`](../../frontend/src/hooks/useKeyboardShortcuts.ts#L75-L86)). The box is reachable by Tab and by click whether shortcuts are on or off, and by `/` while they are on.
- **`/` focuses the box** ([OQ-PF4](#decision-ledger)) wherever the planning page's shortcuts work: with them on and the focus outside a text field. It selects the box's text, so a paste replaces it. The shortcuts help lists it in a row of its own for the planning page, and on a document `/` does nothing.
- **A pasted link applies at once** ([OQ-PF3](#decision-ledger)). When the text pasted into the box holds a planning link, the box applies that link's filter as Enter does, and shows it as its text:
  - **What counts as one.** The first run of characters up to white space that holds `/.vantage/planning`, with or without a scheme, host, port and repository segment in front, and its query after. The link ends earlier, at the first character a planning link never holds unencoded, so a backtick, quote, parenthesis or angle bracket a chat wraps it in is not read as part of it. In its query that is any character but those the link encoding and the page's form encoding write bare, which keeps `*`; in its repository segment, any character but a URL path's, since the page writes the segment with `encodeURIComponent`, which leaves `! ' ( ) *` bare, and the server's startup tip with Go's `url.PathEscape`, which leaves `$ & + : = @` bare. Then the trailing `?`, `.`, `,`, `:`, `_` and `~` that GitHub's [extended autolinks](https://github.github.com/gfm/#autolinks-extension-) leave out are dropped, so a sentence's period after it is too, and a trailing `*` for each `*` before the link in its run, which opened emphasis around it. So the bare link, a whole URL, and the checker's `Planning page:` line with the lines around it all count.
  - **What is read from it.** Its `filter` value, decoded as the page decodes its own URL, and its `roadmap` when it names one, which the same replace navigation chooses. Like a link that names a roadmap, that choice is not remembered. A link with no `filter` clears the filter.
  - **What is ignored.** The scheme, host, port and repository segment, its page parameters and its fragment. The filter applies to the repository on screen.
  - **Anything else** pasted is text, applied as typed text is. A link whose filter is not understood is applied as written, so the notice names its term.

  So *press `/`, paste* reaches the filtered page from any origin, in any mode and through any tunnel, and nothing stores an address.
- **For screen readers.** The input's `aria-describedby` names the notice. A polite live region speaks the notice when the URL takes the reader's text: at once on an Enter, a ✕ or a paste, and for typing once the box has been still for 1 s (`filterSpeechMs`, a number coined by the build), or when the focus leaves it. The idle pause is shorter, so a slow typist's every key is followed by a write, and speaking at each write would speak per keystroke. It never speaks per keystroke, and never as the page opens. A filter change that resets a section to page 1 is not announced as a flip.
- **In print.** The input row is hidden. A print-only line reads `Filter: <canonical>`, and the notice prints, so a printout always says it is filtered and by how much.

**From a document, *its questions on the planning page*** ([OQ-PF4](#decision-ledger)). A document's [Referenced by](../reference/planning-index.md#71-referenced-by) line gains a last part: a link to the planning page filtered by `path:/<the document's path>`, written in canonical text by the planning module's link function.

- **When.** The document's stage has no `done` role and it holds at least one question. Both are facts of the index, so the part is known when the line fills. Otherwise there is no part, and the rest of the line is unchanged.
- **Where.** It is a link of its own after the line's disclosure button, never inside it, and it never shrinks: where the line is cut off at its end, the button's text gives way. The line is the one line already reserved at first paint for a planning document ([planning-index.md §12.2](../reference/planning-index.md#122-every-late-datum-and-where-its-space-comes-from)), and a document with a question is one by its directives, so the link arrives into reserved space and moves nothing. A document with no line today, because nothing links to it and every open question is routed, gets a line holding only the link.
- **The address.** It is the page's own planning path, with the repository segment percent-encoded in daemon mode, and the query from the link function. It is a plain link: Ctrl-click and a middle click open a new tab, and it prints as text. It is not drawn in a static export, which has no planning page.
- **It is a reader's action.** Following it is the reader choosing this document's filter, so `g p` still opens the bare page whatever document it is pressed on ([§4](#4-non-goals)).

## 8. The checker

### 8.1 The flag

`vantage-check index --filter <text>`, or `--filter=<text>`. It works with `--format json`, `--request` and `--roadmap`, and it reads every term the box does: `--filter 'generator is:open'` keeps the open questions whose fields hold *generator*.

- **Given twice,** the values join with a space, as the URL's do.
- **`--filter ''`** is no filter, and the output is byte-identical to a run without it.
- **`--filter -path:x` is a value.** The flag takes the next argument whatever it is, so an exclusion is never read as an unknown option.
- **It is a flag, not an environment variable, on purpose.** An older checker that ignored a `VANTAGE_FILTER` would print the whole index to an agent that believes it filtered. A flag makes that checker exit 2 instead, which is the correct failure here.

### 8.2 Exit codes

| Exit | When |
| :--- | :--- |
| 0 | It ran. That includes a filter keeping documents that have no entries, a text term that matches nothing, an unknown key, and an empty `--request` |
| 2, before the scan | The filter is not understood (`--filter: this checker cannot read <term>`, then what the language reads, or the reason where there is no term). Also `--filter` with no value |
| 2, after the scan | An unmatched term: a `path:` term, with or without its `-`, that matches no path the index lists. The message lists each one, as `--roadmap` lists the roadmaps that do route. Nothing is printed to stdout |
| 3 | Past `max-candidates`, whatever the filter says. The unmatched check never runs then |

It never exits 1. An unmatched term is an error here and only a notice on the page, because a mistyped path is the agent's likeliest mistake, and exit 2 stops it before the human is handed an empty page, or a fuller one than the agent meant. A text term that matches nothing is not one: a search that finds nothing is an answer, and the page shows it the same way.

### 8.3 Output

- **Text.** The filter notice comes first, its clauses included. Then the `Planning page:` line and its hint lines ([§9.2](#92-the-link-it-prints)). Then the existing notices, with *Nothing needs you* in its filtered form, the Roadmaps block with filtered counts, the filtered sections, and `Agent requests: vantage-check index --request --filter '<canonical>'`, shell-quoted, when an agent section has entries. The chosen roadmap's source follows unchanged.
- **JSON.**
  - Without `--filter`, it is byte-identical.
  - With it, **every existing key keeps its meaning.** `index` is the whole index, `sections` is the unfiltered derivation, and the top-level `roadmaps`, badges included, is unchanged, all byte for byte what a run without `--filter` prints. A filter changes `roadmaps[].needsYouCount` and `nothingNeedsYou`, which the reference defines over the whole index ([planning-index.md §13.2](../reference/planning-index.md#132-vantage-check-index)), so filtered values in `sections` would change existing keys' meaning.
  - The filtered view is a new last key, present only with `--filter`: `filter: {text, canonical, link, documents: {kept, of}, entries: {shown, of}, openQuestions, blockedLeftOut, otherRoadmaps: [{path, count}], waitsOutside: [{path, target}], unknownKeys, sections}`. `unknownKeys` lists each unknown key's word once, in the order written, so a script sees the hint the text prints. `filter.sections` has the shape of `sections` and the values of [§6.2](#62-every-section-and-every-whole-index-value). `link` is always root-relative.
  - The format version stays 2, because a new key does not bump it ([planning-index.md:2173-2176](../reference/planning-index.md#L2173-L2176)).
- **`--request --filter`** prints the filtered request with its `Filter:` line. With nothing to ask for, stdout stays empty, stderr says why, and it exits 0, as today.

The help's row, sketched (the wording is the implementer's; the forms are not):

```text
  --filter <text>    show only the entries the text keeps, as the planning
                     page's Filter box does, and print a link to that page:
                       word, "a phrase"  text an entry's id, title, leaning,
                                        path, stage or next holds, in any case
                       path:<pattern>   a document whose path holds the
                                        text, in any case; * within a
                                        name, ** across folders, and a
                                        leading / pins it to the start
                       is:open          a question still open
                       -<term>          leave out what the term matches
                     Every word must match; path: terms keep any of their
                     matches. Paste the link into the planning page's
                     Filter box (press /).
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
Planning page: /.vantage/planning?filter=path:/docs/design/x.md+is:open
  Press / on the planning page and paste this line, or put the scheme, host and port you open Vantage at in front of the link.
```

- **One line, two ways to use it.** Pasted into the Filter box ([§7](#7-the-filter-line)), the line works on any origin, in any mode and through any tunnel, because the box reads only the link's query. With an address in front it is a link to click, and in daemon mode it then reaches *Choose a project*, which keeps the filter ([§9.4](#94-daemon-mode)). The filter's readable text is in the notice above it, for typing.
- **The query.** It carries `roadmap=<chosen>` whenever two or more roadmaps route, so the human's *Needs you* follows the roadmap the agent checked, whatever they last picked. Pasting the link chooses that roadmap too. The link never carries a page parameter or a fragment.
- **A linked worktree.** When the root's `.git` is a file, a second hint line says "`<root>` is a linked worktree: the page shows the checkout your Vantage serves, which may not hold these documents as they are here." The checker cannot tell which checkout a server serves, but it can tell when its own is not a repository's main one.
- **The encoding.** One function in the planning module holds the parameter's name and how its value is written. It percent-encodes everything except `A–Z a–z 0–9 - . _ ~ : /`, and writes a space as `+`.
  - So `*` is written `%2A`, and Markdown or a chat client cannot read it as emphasis.
  - `#`, `&`, `+` and `"` are encoded, so the value cannot be cut short.
  - `:` and `/` stay bare, so the human can read the filter in the link before clicking it.
  - The link's last character is encoded too when it is `.`, `_`, `~` or `:`, which a pasted link loses at its end as a sentence's punctuation ([§7](#7-the-filter-line)): `path:docs/x_` ends the link as `path:docs/x%5F`.
- **Reading it back.** `URLSearchParams` on the page reads that query back to exactly the canonical text, so opening the link triggers no rewrite. A round-trip test over every understood form in the fixture ([§10.4](#104-how-it-is-checked)) pins it. Every write of the URL uses the same encoding, with `filter` first, and so do a flip, a roadmap pick and the outline's links, so a typed filter's address matches an agent's link. A roadmap in a folder is the exception: the page writes its `/` as `%2F`, and both read alike, as `roadmap=` already does ([`planning.md`, Several roadmaps](../../userguide/guides/planning.md#several-roadmaps)).

### 9.3 No address is kept

Nothing stores the address the human opens Vantage at, and the checker never prints one ([OQ-PF3](#decision-ledger)).

- **It has no home that is right.** It is a fact about a machine, so it does not belong in `.vantage.toml`, the reasoning [`vantage-check.md`](../../userguide/guides/vantage-check.md#large-corpora) gives for having no `jobs` key. And one machine can open one repository at several addresses at once: a daemon, a foreground `vantage serve` whose port fell forward, a tunnel.
- **Pasting makes it unnecessary.** *Press `/`, paste* is two keys on a page the human already has open, so the link never needs an address in front ([§7](#7-the-filter-line)).
- **An agent may put one in front itself.** One the human has told the address, in the conversation or in the agent's own notes, can write the whole link. That is the agent's knowledge, not Vantage's, and the checker never reads it.

### 9.4 Daemon mode

A root-relative link has no repository segment. In daemon mode, `/.vantage/planning` with no segment shows *Choose a project*, and a wrong segment shows *Repository not found* ([`PlanningPage.tsx:2358-2381`](../../frontend/src/pages/PlanningPage.tsx#L2358-L2381)). Both list each served project as `/.vantage/planning/<encoded name>?<the same query>`, so a root-relative link with an address in front costs the human one click instead of losing its filter. Pasted into the Filter box of a project's page, it needs no click at all.

### 9.5 The loop, and what agents are taught

1. **The human asks** for the questions one piece of work needs answered.
2. **The agent lists that work's planning documents,** each by its path from the root with a leading `/`, because without it a value is found anywhere in a path, so `path:docs/x.md` keeps `y/docs/x.md` too: the design, its `-plan.md` if one exists, and every document a kept one names in `depends-on`. A `depends-on` entry naming one question by its `#` fragment brings in all of that question's document, since no key selects one question.
3. **In the checkout the human's Vantage serves, it runs `vantage-check index --filter 'path:/<design> path:/<plan> is:open'`.** A link made in another checkout, such as a worktree, opens the served checkout's documents. A word narrows it further when the human asked about one part of the work.
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

### 10.2 What a malformed filter does

- **A not-understood filter** ([§5.5](#55-what-is-not-understood)) is not applied. Opened from a URL or entered with Enter, every entry is shown, the notice names the first term it cannot read, or the reason, and the box and the URL keep the text as written. While the reader types one, the page keeps the results it shows ([§6.4](#64-typing-and-the-url)). The checker exits 2 before scanning.
- **Not by dropping the term.** Dropping the unreadable `path:"b` from `path:a path:"b` leaves `path:a`, which hides the entries the reader asked for under `b`, because terms of one key are OR'd.
- **Not by matching nothing.** An empty page for a malformed text tells the reader less than the notice over every entry does, and "a partial index would quietly under-report questions" ([planning-index.md:179-182](../reference/planning-index.md#L179-L182)).
- **An unmatched term** is applied: it simply keeps nothing, or excludes nothing, and the notice names it. The checker exits 2 ([§8.2](#82-exit-codes)).
- **An unknown URL parameter** is kept and ignored, as today.

### 10.3 Later releases

**Nothing freezes the filter language across releases** ([OQ-PF7](#decision-ledger)). A later release may change what any filter text keeps, its canonical text, the notice's words, and which texts are not understood: a new key, a fuzzy term, a case fold, a wider `path:` dialect. A filtered link is for handing over now, and an agent reruns `--filter` rather than keeping a link.

Some things stay, for reasons of their own:

- **What P0 governs.** The directives, markers and frontmatter the index reads, `.vantage.toml`, the section-id URL parameters and `roadmap=`, and the checker's JSON keys, including `filter`'s subkeys and what each one means, follow the skew design's [P0](checker-version-skew.md#1-verdict-and-the-principles) as they always have. A filter only reads them.
- **The names.** `filter=` and `--filter` keep their names, and a repeated one still joins with a space: a new name would silently unfilter every link and script that uses the old one, to buy nothing.
- **Order never changes** (planning-index P5). No release ranks a filter's results.
- **The page and the checker agree within one release** (planning-index P7, [F5](#1-verdict-and-the-principles)). Across releases they may not, and the page's notice states its own counts.

Nothing released reads a filter differently on the day this ships: the first build is still under `CHANGELOG.md`'s *Unreleased*, so no release has read one at all.

### 10.4 How it is checked

- **A fixture of forms, within one release.** It lives in the planning module and holds `read: [{text, canonical, documents, questions, keeps, unmatched, unknownKeys}]` and `notUnderstood: [{text, term}]`, with `reason` in place of `term` where there is no term to name. They are checked against a small index the fixture also holds: `documents` are the paths it keeps, `questions` the index's questions it keeps, in whatever section or none, and `keeps` the entries the sections then list.
  - That index holds a `🔒 ⏸` question, a ✅ question nested inside an open one, a `💬 🤷` question on a routed path and one with no marker on an unrouted one, a root `roadmap.md` beside an `x/roadmap.md`, a path with a space, a non-ASCII path in NFC, and paths that tell each clause of [§5.4](#54-path-patterns)'s rule from a wrong reading of it: `x/docs/design/a.md`, which holds the whole of `docs/design/a.md`, and folders named like files elsewhere. Those `documents` came from a matcher written apart from the filter module, from [§5.4](#54-path-patterns)'s one sentence alone. `read` holds `path:Docs/design`, which keeps what `path:docs/design` does, and the NFD spelling of `docs/café.md`, which matches nothing.
  - For text terms it holds a question matched by each field alone (id, title, leaning, its path), a row matched by its `stage` and by its `next`, a Too large and an Unreadable path, a match that differs only in case, an NFC and an NFD spelling that do not match, a quoted phrase against the same words apart, an exclusion of each kind, and an unknown key's hint.
  - The page's tests and the checker's tests both load it, which is what holds P7.
  - Any entry may be edited, moved or removed when the language changes. Nothing compares the fixture with an earlier release's ([OQ-PF7](#decision-ledger)).
- **A written model of 0.8.x's URL handling** in a unit test, following the `questionOffersTake` precedent. It asserts that every link the checker prints passes 0.8.x's rewrite with `filter` untouched and holds no page parameter for 0.8.x to misread. UNMEASURED: no 0.8.x build is run.

## 11. Worked example: this document's own questions

This illustrates this tree on 2026-10-05, with this document and its roadmap entry in place and its five questions still open: 20 paths and 15 entries. They were ruled before anything was built, so the success criteria ([§15](#15-success-criteria)) use a fixed fixture instead.

```console
$ vantage-check index --filter 'path:/docs/design/planning-filter.md is:open'
Filtered by `path:/docs/design/planning-filter.md is:open`: 5 of 15 entries, in 1 of 20 paths, 5 of them open questions.
Run without --filter to see the other 10.
Planning page: /.vantage/planning?filter=path:/docs/design/planning-filter.md+is:open
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

**What the human does with it.** On the planning page they already have open, they press `/` and paste the `Planning page:` line, and the page shows those five cards. With an address in front, such as `http://localhost:8000` for a plain `vantage serve`, the link opens the same page in one click. Typing `path:docs/design/planning-filter.md is:open` into the Filter box narrows the page as they type, and once they pause, the address holds the same `filter` value and the page the same five cards. So does *its questions on the planning page* in this document's Referenced by line, except that its filter, `path:/docs/design/planning-filter.md`, also keeps the document's ✅ and 🔒 questions; here it has none.

Other filters, over the same tree:

| Filter | Keeps |
| :--- | :--- |
| `path:docs/design/agent-bootstrap.md is:open` | [OQ-B1](agent-bootstrap.md#OQ-B1) to [OQ-B5](agent-bootstrap.md#OQ-B5), all under *Not on a roadmap*: open questions the human answers, in a section whose actor is the agent |
| `path:color-themes.md` | [OQ-CT6](color-themes.md#OQ-CT6), under *Not on a roadmap*. A value is found anywhere in a path |
| `path:/roadmap.md` | 1 path and no entries: the roadmap holds no question |
| `path:docs/design/checker-version-skew*` | 2 documents, the design and its sketch, and one entry: the design's *Ready to graduate* row |
| `path:docs/design/checker-version-skew* is:open` | The same 2 documents and no entries: *Nothing this filter keeps needs you* |
| `path:docs/reference` | 9 documents and no entries, because every one is `CURRENT`, a `done` role |
| `path:docs/desing` | An unmatched term. The page applies it, keeps nothing and names it; the checker exits 2 |
| `path:docs/design/*.md is:closed` | Not understood: `is:` reads only `open`. Once entered, the page shows all 15 entries under *Not filtered*; the checker exits 2 before scanning |
| `path:docs/des` | Every document under `docs/design`: each keystroke of a path keeps what the finished path does, and more |

Text terms, over this tree at `519cd66`, whose other questions are the same:

| Filter | Keeps |
| :--- | :--- |
| `generator is:open` | [OQ-B1](agent-bootstrap.md#OQ-B1) and [OQ-B3](agent-bootstrap.md#OQ-B3), whose titles hold *generator* |
| `payload` | [OQ-B2](agent-bootstrap.md#OQ-B2) and [OQ-B5](agent-bootstrap.md#OQ-B5), by their titles |
| `pypi` | [OQ-B4](agent-bootstrap.md#OQ-B4), whose title holds *PyPI*: case does not matter |
| `oq-b` | [OQ-B1](agent-bootstrap.md#OQ-B1) to [OQ-B5](agent-bootstrap.md#OQ-B5), by their ids |
| `agent-bootstrap -payload` | [OQ-B1](agent-bootstrap.md#OQ-B1), [OQ-B3](agent-bootstrap.md#OQ-B3) and [OQ-B4](agent-bootstrap.md#OQ-B4): every question of that document, by its path, but the two whose titles hold *payload* |
| `stage:ready` | Nothing, since no field holds that text. The notice says `stage:` is not a filter key; the checker exits 0 |

## 12. Alternatives, with verdicts

| Alternative | Verdict |
| :--- | :--- |
| A parameter per key (`?path=a&is=open`) | **Rejected.** It is not one string a person types |
| `q=` | **Rejected.** It collides with the unknown-parameter fixture, and the URL, flag and label would read three ways |
| Positional paths on `index` | **Rejected.** It reverses the recorded refusal of paths (`cli.ts:159-161`) and adds a second grammar |
| `VANTAGE_FILTER` instead of `--filter` | **Rejected.** An older checker would print the whole index as though it were filtered |
| Filtering the index before deriving | **Rejected.** It breaks *Blocked* and routing ([§3](#3-what-exists-today)), and the reference forbids a trimmed index |
| Applying only on Enter | **Rejected** ([OQ-PF6](#decision-ledger)). You asked for the page to follow the box basically instantly. The costs that once rejected typing, the churned caches and the half-typed path, are met in [§6.5](#65-identities-and-what-typing-must-not-churn) and by text terms |
| Debouncing the results | **Rejected.** Matching takes about a millisecond at 20,000 questions ([§12.1](#121-the-search-libraries-measured)), so any wait would be the whole delay. Only the URL waits for the idle pause, and with it a text that keeps no entry |
| Applying a text that keeps no entry at once, as any other | **Replaced** on 2026-10-06. `-m`, every prefix of a word that is not there yet, and before the substring rule every prefix of a path emptied the page and refilled it at the next key: a browser run in the review of live search painted about 900 ms of empty page typing `path:docs/design` |
| Holding back only a last term not yet followed by a space, or only `path:` values and exclusions | **Rejected** for the rule as ruled: any text that keeps no entry waits, and only while the reader types |
| Matching a last `path:` value as a prefix while it is typed | **Rejected.** The page would read a text one way and the URL and the checker another ([F5](#1-verdict-and-the-principles)) |
| Bare words not understood | **Rejected** ([OQ-PF1](#decision-ledger)). A search box that refuses words is no search box |
| An unknown key, such as `stage:`, not understood | **Rejected.** A word with a colon would keep the old results with no answer; searched as text with a hint, it answers and says why |
| Exit 2 for a text term that matches nothing | **Rejected.** A search that finds nothing is an answer, and the page shows it the same way |
| Fuzzy or typo-tolerant text terms | **Rejected for now.** Every library that offers it decides membership by thresholds of its own ([§12.1](#121-the-search-libraries-measured)). A later release may add a fuzzy term as a key of its own |
| Word-prefix matching instead of substring | **Rejected.** It needs a definition of a word, on which the three libraries that use one disagree, and is slower on one letter: 3.6 to 6.3 ms against 0.5 at 20,000 questions |
| A pinned Unicode case-folding table instead of `toLowerCase` | **Rejected.** It buys only a meaning that holds across engines' Unicode versions, which [OQ-PF7](#decision-ledger) does not ask for |
| Ranking the results | **Rejected.** Roadmap order is priority (planning-index P5) |
| uFuzzy 1.0.19 as the matcher | **Rejected** ([§12.1](#121-the-search-libraries-measured)). Its `filter()` keeps terms only in typed order, drops punctuation and non-Latin letters from the needle, and lowercases by the host's locale |
| MiniSearch 7.2.0 | **Rejected.** Whole-token matching with no mid-word match and no phrase, a 237 ms index build, and a BM25 ranking to throw away |
| FlexSearch 0.8.212 | **Rejected.** The fastest per keystroke, and the heaviest everywhere else: 17 KB gzipped, an index of 0.6 to 2.4 s and 32 to 64 MB, and an encoder that folds and collapses letters |
| Fuse.js 7.5.0 | **Rejected.** A fuzzy score decides membership, and it takes 81 to 156 ms a keystroke at ten characters |
| match-sorter 8.3.0 | **Rejected.** 11 to 49 ms a keystroke, no AND of words, and diacritics stripped by default |
| Orama 3.1.18 | **Rejected.** Not a strict AND even at `threshold: 0`, a 391 ms index build, and 22 KB gzipped |
| fuzzysort 4.0.2 | **Rejected.** Subsequence matching keeps about three times what substring keeps for short queries, and its defaults cut results to ten |
| The port's whole dialect for `path:` | **Rejected.** It gives `?`, RE2 meanings, unanchored inner slashes and five forms meanings git does not |
| Gitignore-style matching of whole folder and file names, a subset of the port's dialect that git agrees with | **Replaced** on 2026-10-06, after it was built. It was chosen so that a filtered link would keep the same entries in every later release, a freeze [OQ-PF7](#decision-ledger) dropped, and live search made its cost plain: `path:d` … `path:docs/desig` keep nothing while they are typed, so the commonest term emptied the page at each keystroke, and `path:roadmap.md` keeping every `roadmap.md` while `path:docs/x.md` kept only the root's took a rule of its own to explain. Its not-understood forms existed only to keep the port in step with git |
| A substring glob matcher of our own, case-insensitive | **Chosen** on 2026-10-06 ([§5.4](#54-path-patterns)). It was first rejected as a second glob rule beside `[planning] include`'s, and a case rule that disagrees with git; the two rules never meet, since `include` decides what is indexed and `path:` what is shown, and GitHub's search folds case the same way |
| GitHub's `?` and regular expressions in `path:` | **Rejected for now.** Each gives a character a path can hold a second meaning, and nobody has asked |
| Bare `path:` values limited to `A–Z a–z 0–9 . _ - / *` | **Dropped** on 2026-10-06. The set kept the port from reading `[`, `+` or `?` as syntax. Matched in the module, every character is its own, and the invisible ones stay excluded ([§5.5](#55-what-is-not-understood)) |
| Not understanding a leading `./` | **Rejected.** Agents write it, and `roadmap=` already reads it as the root |
| `is:answered` for ✅ | **Rejected.** The page already calls a question you commented on *answered* |
| More `is:` values now | **Rejected for now.** Nobody has asked; one can come in any release ([OQ-PF7](#decision-ledger)) |
| Applying the terms understood and dropping the rest | **Rejected.** It hides entries, because terms of one key are OR'd ([§10.2](#102-what-a-malformed-filter-does)) |
| Matching nothing when a term is not understood | **Rejected.** An empty page tells the reader less than the notice over every entry |
| Showing every entry the moment typed text stops being understood | **Rejected.** Opening a quote would flash the whole page between two filtered ones |
| An unmatched term as a warning with exit 0 | **Rejected.** `--roadmap` is strict, and a typo is the agent's commonest mistake. The page still applies it |
| Keeping unmatched terms in the request's `Filter:` line | **Rejected.** `--filter` would exit 2 on the line the human handed over, though leaving them out keeps the same entries |
| Exit 2 when a blocker is left out | **Rejected.** Leaving it out can be deliberate; the *Waits on* clause says so in both readers |
| Kept questions on other roadmaps shown as cards | **Rejected.** It merges roadmap orders, a non-goal; the notice names each roadmap instead |
| `sections` filtered in place under `--filter` | **Rejected.** It changes the meaning of existing keys at format version 2 |
| `--filter` twice exits 2 | **Rejected.** Joining the values is what typing both into the box does |
| The box in the header, the frame, the section bar or the outline | **Rejected** ([§7](#7-the-filter-line)) |
| Esc clears the box | **Rejected.** It is pressed by reflex, and a replace navigation makes the loss stick |
| ✕ clears the box only | **Rejected.** ✕ is aimed at, and the agent's link still holds the filter |
| Rewriting the box to canonical text as the URL takes it | **Rejected.** The caret would jump under the reader's fingers; only Enter rewrites it |
| A history entry per filter | **Rejected.** Back would step through every prefix typed |
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
| The browser writing its address into copied text | **Rejected.** The payload is "a pure function of the document and the build", and the request's parity with `--request` would break |
| The checker reading the user config for a host and port | **Rejected.** The checker's first read of machine config, and wrong for a port that fell forward, a tunnel or a jail |
| A `vantage url` command on the server binary | **Rejected.** It sees the agent's loopback, not the human's, and the binary may not be in the agent's environment |
| A discovery file the server writes | **Rejected.** The server writes nothing on startup, and a file goes stale after a crash |
| Guessing the daemon name from the root's folder name | **Rejected.** Wrong in this very jail (`workspace` against `vantage`) and after a `-2` suffix |
| Link-graph keys, or a `depends-on` closure, now | **Deferred.** The closure is 16 of 19 documents. A one-hop key can come later |
| Selecting one question with `path:x#OQ-…` | **Deferred.** Ids are unique only per document; a text term finds an id in every document |

### 12.1 The search libraries, measured

Measured on 2026-10-05 on this machine: 32 threads, shared, with a load average between 12 and 37 throughout, so these are medians on a busy machine. The corpus was 20,000 questions, each its id and title, lifted from this repository's own `docs/` and `userguide/` (27 to 254 characters, median 78). What was timed is the match and building the filtered, order-preserving list, which is what the page pays. Every library was the latest on npm that day; sizes are an esbuild minified bundle of the entry points used, gzipped.

| Matcher | Gzipped | Index build | Worst ms a keystroke, 1 / 3 / 10 characters (Node) | What decides a match |
| :--- | ---: | ---: | :--- | :--- |
| Substring by hand, the design's | none | 1.4 ms, to lowercase the fields once | 0.5 / 0.9 / 1.3 | Every term a substring of a field |
| uFuzzy 1.0.19 | 4.2 KB | none | 1.1 / 1.2 / 2.1 | A regex per needle, terms in typed order |
| MiniSearch 7.2.0 | 5.9 KB | 237 ms | 4.0 / 12 / 8.6 | Whole tokens or their prefixes, ranked |
| FlexSearch 0.8.212 | 17.2 KB | 565 to 2,360 ms | 0.3 / 0.3 / 1.1 | Its tokenizer and encoder, ranked |
| Fuse.js 7.5.0 | 9.5 KB | 9.6 ms | 25 / 41 / 156 | A fuzzy score under a threshold |
| match-sorter 8.3.0 | 3.5 KB | none | 11 / 23 / 29 | A ranking ladder down to a threshold |
| Orama 3.1.18 | 22.0 KB | 391 ms | 11 / 64 / 61 | Token prefixes, ranked, threshold-bound |
| fuzzysort 4.0.2 | 8.4 KB | 0.5 ms | 7.1 / 14 / 10 | Scored in-order subsequences |

- **The hand-rolled matcher is 1 to 3% of a 50 ms budget** in Node, Bun and Chrome alike, and needs no index. At a typical repository's 100 to 800 questions it takes microseconds, so on this page the cost to watch is React rendering the cards, not the predicate.
- **Four of the seven changed what a query keeps between their own releases** over the same data and call (uFuzzy, fuzzysort, FlexSearch and Orama), some in patch releases, so a dependency would decide this page's behavior in its own release notes.

## 13. Risks

| Risk | Effect | Mitigation |
| :--- | :--- | :--- |
| A keystroke's re-layout is slow on a large page | The box lags, or the results do | The box never waits on the results ([F7](#1-verdict-and-the-principles)), the results swap whole when ready, and [§16](#16-typing-targets-and-how-they-are-read) sets the targets they are measured against |
| Typing cycles the caches | Back flashes the top of a page it had cached, or a third review request goes out | Superseded sets leave the cache, the other caches are bounded, and typing adds no review request ([§6.5](#65-identities-and-what-typing-must-not-churn)) |
| A half-typed term matches nothing | The page empties between two keystrokes | `path:` finds its text anywhere in a path, so each keystroke of a path keeps what the path does and more ([§5.4](#54-path-patterns)); and a typed text that keeps no entry waits for the idle pause ([§6.4](#64-typing-and-the-url)) |
| A typed text that keeps nothing waits for the pause | The old results stay up for 300 ms before *nothing matches* | The pause is the one that writes the URL, and Enter, leaving the box and a paste apply at once |
| `path:` folds case | In a repository holding `Docs/x.md` beside `docs/x.md`, a value keeps both | The notice counts the kept paths; a planning tree that tells two paths apart by case alone is rare |
| A short word matches far more than meant | `or` keeps every title holding *for* or *order* | The notice counts what it keeps; quoting a phrase or adding a word narrows it |
| `Path:x` or `IS:open` is searched as text, with no hint | The page empties or barely narrows, without saying why | The notice's counts; the keys are lowercase everywhere they are taught |
| The human's viewer and the agent's checker are different releases | They may disagree on what a text keeps, now that nothing freezes it | The page's notice states its own counts, and the agent hands over the counts it saw; a 0.8.x viewer shows every entry, as before |
| The human's viewer is a 0.8.x and the agent's checker is newer | The link shows every entry, without saying so | The agent states the counts, and the human looks for the *Filtered by* notice. A request copied there has no `Filter:` line. The checker cautions when `target` predates the filter |
| The agent picks the wrong documents | The human answers too few | Exit 2 on an unmatched term, the *Waits on* clause, and a rerun after the answers |
| The agent runs the checker in another checkout, such as a worktree | The link opens the served checkout's documents, which may lack the questions or hold older ones | Agents are taught to run it in the served checkout, and the checker cautions in a linked worktree |
| The work's questions sit on another roadmap | They are in no section, only counted | The notice names each roadmap and its count, the link carries `roadmap=`, and agents hand over one link per roadmap |
| A blocker the filter leaves out holds questions | Those questions are not shown | The *Waits on* clause, on the page and in the checker, whether or not an `is:` term dropped the Blocked row |
| `is:open` leaves 🔒 questions out | The human thinks the round is the last | The *Blocked* clause counts them |
| An agent writes the URL by hand | A raw `+`, `#` or `&` cuts the filter short | The checker prints the link, and agents are taught never to hand-encode one |
| The link is not clickable where it is handed over | The human has a line, not a link | *Press `/`, paste* is two keys on a page they already have open; the checker's hint line and the agent both say so |
| Copy answers leaves pending answers out | An answer is not handed over | The tooltip counts what the filter leaves out, and clearing the filter copies everything |
| A card whose diagram is not drawn yet comes into the results | That keystroke's results wait up to the Mermaid deadline, 1 s | No card on this repository or the scale fixture holds a diagram today; a diagram drawn later draws into its fixed frame |

## 14. Costs, and what is unmeasured

**What it costs at run time:** a layout per keystroke that changes the filter, and the cards it shows rendered, held to [§16](#16-typing-targets-and-how-they-are-read). Lowercasing the searched fields once per index takes 1 to 12 ms at 20,000 questions ([§12.1](#121-the-search-libraries-measured)).

**What stays between releases** ([§10.3](#103-later-releases)): the names `filter=` and `--filter`, the join of a repeated one, the JSON `filter` key and the meaning of each subkey, and `link` being root-relative. Nothing about what a text keeps.

**What it forecloses:** ranking, which P5 rules out, and searching anything the index does not hold, which S1 and S2 do. Fuzzy matching is not foreclosed, only not built.

**What it costs to build**, at component level (the file map belongs in the sketch):

- **The planning module:** the text terms, exclusions and the colon rule in the parser, the searched fields and their lowercased copies, the predicate's four tests, the unknown-key clause, the notices' new words, and the fixture of forms rewritten without its cross-release rule.
- **The page:** applying on change, the idle write, Enter, ✕, paste and leaving the box as writes, composition, the hint, the live region's timing, the cache bounds, and the review request sent early.
- **The checker:** text terms and exclusions through the shared parser, `unknownKeys` in the JSON, the unmatched rule for `-path:`, and the help.
- **The harness:** a typing flow for [§16](#16-typing-targets-and-how-they-are-read)'s targets.
- **Docs:** the user guide's *Filtering the page* and *Writing a filter*, `vantage-check.md`'s filtering and exit codes, the checker's help, and `CHANGELOG.md`'s unreleased entry. At graduation, the planning reference's terms, its [§6](../reference/planning-index.md#6-the-planning-page) subsections, a [§12.2](../reference/planning-index.md#122-every-late-datum-and-where-its-space-comes-from) row, [§13.2](../reference/planning-index.md#132-vantage-check-index), [§15](../reference/planning-index.md#15-failure-modes), [§17](../reference/planning-index.md#17-non-goals) and [§18](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured), where T1 to T4 join its table.
- **Tests:**
  - the fixture-driven grammar, matching and canonical-text tests, with the not-understood cases they now hold;
  - page tests for typing: a narrowing per keystroke, no history entry, one write after the idle pause and at once on Enter, ✕, paste and leaving, the box never rewritten while typing, a not-understood text keeping the page, composition, Esc, the hint and the live region;
  - page tests that typing evicts no other history entry's set and makes no third review request;
  - checker tests for text terms, exclusions, an unknown key's hint and `unknownKeys`, and exit 2 for an unmatched `-path:` term;
  - an e2e flow that types into the box, asserting zero layout shift, an unchanged `history.length` and the URL after the pause.

**What it does not cost:** a Go change, a scan-cache schema bump or a JSON version bump. Any edit to the planning module changes the scanner id, so each visitor pays one cold build. Most releases already pay that ([`planning.md`, What this browser keeps](../../userguide/guides/planning.md#what-this-browser-keeps)).

**UNMEASURED:**

- T1 to T4 ([§16](#16-typing-targets-and-how-they-are-read)) on a machine that stays quiet through a batch: the one batch that could be judged began at a load average of 3.83 and rose to about 18, and it met T2 at 60 documents by 1.2 ms. No batch after `8995acb` began below 4.
- T1 to T4 at 20,000 questions, and while the index is still building: [§16](#16-typing-targets-and-how-they-are-read) sets no target for either.
- D6's no-long-task half of [criterion 8](#15-success-criteria): a cold dev-server load showed 2 to 5 long tasks of up to about 180 ms that no run could pin on the filter.
- D6 and D12 on a large index.
- 0.8.x's handling of a planning link. It is read from the code, not run.
- T1 to T4 since the rulings of 2026-10-06. The default query keeps entries at every keystroke on both trees, so no key of it is held back.
- How accurately agents write this grammar. No benchmark exists for any filter syntax.
- The filter line with assistive technology, and with an input method composing.

## 15. Success criteria

The tree is a copy of the e2e fixture [`frontend/e2e/fixtures/test_repo/`](../../frontend/e2e/fixtures/test_repo/), checked and served as its own root. Its roadmap routes `plans/design.md`'s two open questions, [OQ-E1](../../frontend/e2e/fixtures/test_repo/plans/design.md#OQ-E1) and [OQ-E2](../../frontend/e2e/fixtures/test_repo/plans/design.md#OQ-E2), and nothing in it depends on this design's own questions.

1. `vantage-check index --filter 'path:/plans/design.md is:open'` exits 0. It prints the notice, the line `Planning page: /.vantage/planning?filter=path:/plans/design.md+is:open` and its hint line, with exactly [OQ-E1](../../frontend/e2e/fixtures/test_repo/plans/design.md#OQ-E1) and [OQ-E2](../../frontend/e2e/fixtures/test_repo/plans/design.md#OQ-E2) under *Needs you*.
2. Opening that link shows those two cards and nothing else. The section bar counts them, the box holds the text, and the notice says what is hidden.
3. Typing the same text into the box on the unfiltered page gives the same page without an Enter, and once the idle pause has passed, the same `filter` value and the same address.
4. Copy agent request on a filtered page is byte-equal to `--request --filter` with its `Filter:` line's text, for every understood text in the fixture of forms whose request is not empty.
5. With no filter, the page, the text output, the JSON and `--request` are byte-identical to today's. With one, the JSON's `index`, `sections` and `roadmaps` are too.
6. `path:plans/desing` exits 2 naming the term. On the page, it keeps nothing and names the term.
7. `path:plans/design.md is:closed`, entered with Enter, shows every entry under *Not filtered* on the page, and exits 2 before scanning.
8. A filtered link opened cold, and Enter on the box, shift nothing that is painted, and `history.length` is unchanged. Opening a filtered link and then clearing the filter makes at most two review requests in the visit, and no long task runs over 50 ms.
9. `g p` from a filtered page opens the bare page with an empty box, and Back returns to the filtered one with the box holding its text.
10. In daemon mode, a root-relative link reaches the filtered page in one click from *Choose a project*, and *Repository not found* lists the projects with the filter kept.
11. On the unfiltered page, `/` and then pasting the checker's whole output for criterion 1 shows the page of criterion 2, in single-repository and daemon mode alike.
12. `plans/design.md` in the viewer shows *its questions on the planning page* in its Referenced by line with zero layout shift as the index lands, and following it shows that document's entries, with the box holding `path:plans/design.md`.
13. Typing `oq-e` into the box on the unfiltered page, one key at a time, narrows the page at each key until it shows exactly [OQ-E1](../../frontend/e2e/fixtures/test_repo/plans/design.md#OQ-E1) and [OQ-E2](../../frontend/e2e/fixtures/test_repo/plans/design.md#OQ-E2), with no Enter. `history.length` is unchanged, nothing painted shifts, the address holds `filter=oq-e` once the idle pause has passed, the visit makes at most two review requests, and the caret stays where the reader typed.
14. Typing `path:plans/design.md "is` keeps the page of `path:plans/design.md` on screen while the quote is open, with the hint saying the text is not applied. Enter then shows every entry under *Not filtered*, naming the unclosed quote.
15. `vantage-check index --filter 'stage:ready'` exits 0 with the notice saying `stage:` is not a filter key, `--filter 'nosuchword'` exits 0 keeping no entry, and `--filter '-path:plans/desing'` exits 2 naming the term.
16. T1 to T4 are met on both trees ([§16](#16-typing-targets-and-how-they-are-read)), or the Status says which are not, by how much, and on what machine load.

## 16. Typing targets, and how they are read

The targets are numbered T1 to T4 *(coined here)*. They are requirements, not measurements, and when this design graduates they join the planning reference's [§18](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured) table under the same names.

| # | Target | This repository | Scale fixture at 60 documents |
| :--- | :--- | :--- | :--- |
| T1 | A keystroke's own echo: the Event Timing duration of its interaction, from the keydown to the next paint, the measure [INP](https://web.dev/articles/inp) uses | p95 ≤ 32 ms, none over 50 | p95 ≤ 32 ms, none over 50 |
| T2 | Keystroke to results painted: from the keydown's `timeStamp` to the first frame that paints the sections of the text it made, for each keystroke that changes the applied filter. One whose results never paint, because a later text superseded them, counts as over | p95 ≤ 100 ms | p95 ≤ 100 ms |
| T3 | Main-thread long tasks from a keystroke until its results are painted | none over 50 ms | none over 50 ms |
| T4 | Layout shift while typing, as [D12](../reference/planning-index.md#18-scale-targets-and-what-has-been-measured) reads CLS | 0 | 0 |

**How they are read:**

- **The harness** is the reference's: `just planning-perf`, the production bundle in headless Chromium at 1440×900, on this repository and on the scale fixture the reference defines. A typing flow of its own reads T1 to T4 ([`planning-filter-plan.md`, WP-8](planning-filter-plan.md#wp-8-harness-the-typing-flow)).
- **The flow.** The planning page is open with its index ready, its first pages painted and the visit's second review request answered, with no filter. The harness presses `/`, then types `generator is:open` one key every 150 ms through the browser's own input pipeline, so Event Timing sees real key events. It waits a second, presses ✕, and the next run begins. 150 ms a key is 400 characters a minute, a fast typist's pace.
- **Which keystrokes count.** All 17 count for T1. For T2, 12 change the applied filter: each letter of *generator*, the `i` and `s` of *is*, and the final `n`. The space changes nothing, and `:`, `o`, `p` and `e` make a text that is not understood, which keeps the page as it is. A key whose text keeps no entry is held back until the idle pause ([§6.4](#64-typing-and-the-url)), so it changes nothing while the reader types, and T2 does not count it either, at any pace. On both trees every text the query makes keeps an entry, so none is held; the harness finds those a `--query` holds before its runs, and reports how many keys they were.
- **Painted** means what the harness already means: an element present in an animation-frame callback is drawn in that frame. For T2 the sections carry the shown filter's canonical text where the harness can read it, and the moment is the first frame in which it is the keystroke's.
- **T3** is read with Long Animation Frames, every task from the first keydown to the last results painted, attributed as D6's tasks are.
- **Runs.** At least ten runs a cell, interleaved across the two trees as the harness orders them. The p95s are over the pooled keystrokes: 170 or more for T1, and 120 or more for T2.
- **A quiet machine.** Each batch records its one-minute load average when it begins. One that began above 4, the line the reference's 2026-10-01 runs kept, is reported and never judged. A comparison between two builds is paired: their runs alternate in one batch.
- **What it cannot see:** a typist's irregular rhythm, typing on a page whose index is still building, and an input method composing.

## Decision Ledger

| ID | Ruling / Decision | Date | Settled in | Built |
| :--- | :--- | :--- | :--- | :--- |
| OQ-PF1 | Overturned, in conversation: a word without a colon is free text, searched Google-style over index facts alone, in planning documents alone. A question matches by its id, title, leaning or its document's path; a document row by its path, stage or `next`; a Too large or Unreadable entry by its path. Every word must match, in any case and any order; a quoted phrase is one substring; a leading `-` excludes; a term is a qualifier only when the word before its first `:` is `path` or `is`, and an unknown lowercase word there is searched as text with a hint. `is:open` stays the one `is:` value. Amended in conversation on 2026-10-06: a `path:` value is found anywhere in the path, case-insensitively, `*` within one name and `**` across folders, a leading `/` or `./` pinning it to the start; quoted, every character is literal; the not-understood forms that served only the gitignore port go | 2026-10-05, 2026-10-06 | [§5.2](#52-grammar), [§5.3](#53-what-a-term-matches-and-how-terms-combine), [§5.4](#54-path-patterns), [§5.5](#55-what-is-not-understood) | ✅ words, phrases, exclusions and the colon rule in `parsePlanningFilter`, the searched fields in `filterKeepsQuestion` and `applyPlanningFilter` (`packages/vantage-md/src/planning/filter.ts`); `path:` values in `readPathValue` and `pathMatcher` there; the *Not a key* line in `PLANNING_NOTICES.filtered` (`sections.ts`); `unknownKeys` in the checker's JSON (`packages/vantage-check/src/commands/index.ts`) |
| OQ-PF2 | Copy answers follows the filter: its payload and count cover kept questions only, and its tooltip says how many pending answers the filter leaves out | 2026-10-05 | [§6.6](#66-copy-agent-request-and-copy-answers) | ✅ `pendingAnswers` in `frontend/src/lib/planningAnswers.ts`; the button's name and tooltip in `PlanningPage.tsx` |
| OQ-PF3 | No address is stored or printed, so no `VANTAGE_PLANNING_URL`: it is a fact about a machine with no right home, and a machine may open one repository at several. The checker prints a root-relative link, and pasting it into the Filter box, alone or with the lines around it, applies its filter | 2026-10-05 | [§9.3](#93-no-address-is-kept), [§7](#7-the-filter-line) | ✅ `planningLink` and `readPastedPlanningLink` in `filter.ts`; the paste in `PlanningFilterLine.tsx`; no address read or kept anywhere |
| OQ-PF4 | Besides typing, `/` focuses the box, and a document's Referenced by line links to the page filtered to that document. No per-card toggle | 2026-10-05 | [§7](#7-the-filter-line) | ✅ `/` in `useKeyboardShortcuts.ts`; the link in `ReferencedBy.tsx`; no toggle on a card |
| OQ-PF5 | The filter line is always on the page: one fixed-height row in every state, from first paint | 2026-10-05 | [§7](#7-the-filter-line) | ✅ `PlanningFilterLine` drawn first in `PlanningPage.tsx`'s `<main>`, every state but a static export |
| OQ-PF6 | Ruled in conversation: the page applies the filter as you type, basically instantly. Typing never adds a history entry; the URL follows after an idle pause and at once on Enter, ✕ or a paste; the box is never rewritten while the reader types; a text not understood mid-typing keeps the results on screen; and "instant" is measured against targets. Amended in conversation on 2026-10-06: a typed text that keeps no entry at all applies only when the idle pause ends, the last results staying until then; Enter, ✕, a paste and leaving the box apply at once, empty or not | 2026-10-05, 2026-10-06 | [§6.4](#64-typing-and-the-url), [§6.5](#65-identities-and-what-typing-must-not-churn), [§7](#7-the-filter-line), [§16](#16-typing-targets-and-how-they-are-read) | ✅ `onType` in `PlanningFilterLine.tsx`; the applied filter set in a transition, held back while it keeps no entry (`held`), and written after `filterIdleMs` (`frontend/src/planningScan/limits.ts`), in `PlanningPage.tsx`, its notice spoken after `filterSpeechMs`; the typing slot, and the newest text's guard (`follow`, and the shown set's reducer), in `usePlanningPageInputs.ts`; T1 to T4 read by `just planning-perf --targets typing` (`frontend/perf/planning/`) |
| OQ-PF7 | Ruled in conversation: no freeze across releases. A filter text may match differently in a later release, so the permanence rules, the fixture's append-only rule and its comparison with the previous release's tag go, and "not understood" no longer keeps forms free for later. P0 still governs what lives in files or feeds scripts, roadmap order never changes, and the page and the checker agree within one release | 2026-10-05 | [§10.3](#103-later-releases), [§10.4](#104-how-it-is-checked) | ✅ nothing compares `filterForms.json` with an earlier release's: the test is gone from `frontend/src/lib/planningFilter.test.ts`, and `filter.ts` states no freeze |
