/**
 * The planning filter (`docs/reference/planning-index.md` §6.11): its
 * grammar, its canonical text, what it keeps, what it does to the sections,
 * its notices, the request's `Filter:` line, and the link the checker prints
 * and the page reads back.
 *
 * Most of it is held to the fixture of forms,
 * `packages/vantage-md/src/planning/filterForms.json`, which the checker's
 * suite reads too. Its `documents` did not come from this code: a matcher
 * written apart from it, from §6.13's one sentence and sharing nothing with
 * the filter module, gave each `path:` term's answer over the fixture's
 * paths, and the module was then held to those answers. The fixture is one
 * release's: nothing compares it with an earlier release's, since a later
 * release may read a text differently (§6.19).
 */
import { describe, expect, it } from "vitest";
import {
  PLANNING_FILTER_LIMITS,
  PLANNING_FILTER_PARAM,
  PLANNING_NOTICES,
  PLANNING_PAGE_PATH,
  PLANNING_ROADMAP_PARAM,
  applyPlanningFilter,
  codeSpan,
  derivePlanningSections,
  documentFilter,
  encodePlanningQueryValue,
  filterKeepsDocument,
  filterKeepsQuestion,
  noticeText,
  parsePlanningFilter,
  planningAgentRequest,
  planningLink,
  readPastedPlanningLink,
  type PlanningFilter,
  type PlanningFilterQuestion,
  type PlanningFilterSummary,
  type PlanningIndex,
  type PlanningSections,
  type UnderstoodPlanningFilter,
} from "vantage-md/planning";
import { planningPath } from "./planningRoute";
import {
  filterForms,
  filterFormsIndex,
  indexOf,
  sectionEntryKeys,
} from "../test/planning";

const FORMS = filterForms();
const INDEX = filterFormsIndex(FORMS);
const SECTIONS = derivePlanningSections(INDEX);
/** Every path the fixture's index lists. */
const LISTED = [...INDEX.documents, ...INDEX.skipped, ...INDEX.unreadable]
  .map((entry) => entry.path)
  .sort();

/** `text` parsed, which the caller knows this release understands. */
function understood(text: string): UnderstoodPlanningFilter {
  const parsed = parsePlanningFilter(text);
  if (parsed.kind !== "understood") {
    throw new Error(`not understood: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

const apply = (
  text: string,
  index: PlanningIndex = INDEX,
  sections: PlanningSections = SECTIONS,
) => applyPlanningFilter(index, sections, understood(text));

/** The documents `filter` keeps: what its `path:` and `-path:` terms keep. */
const keptDocuments = (filter: UnderstoodPlanningFilter): string[] =>
  LISTED.filter((path) => filterKeepsDocument(filter, path));

/** Every question the fixture's index holds. */
const QUESTIONS = INDEX.documents.flatMap((doc) => doc.questions);

/** A question at `path` in `state`, with no id, title or leaning to search. */
const at = (
  path: string,
  state: PlanningFilterQuestion["state"] = "open",
): PlanningFilterQuestion => ({
  path,
  state,
  id: null,
  title: "",
  leaning: null,
});

/** What `URLSearchParams` reads back from a link's query. */
const queryOf = (link: string) =>
  new URLSearchParams(link.slice(link.indexOf("?") + 1));

describe("the fixture of forms (§6.19)", () => {
  it("holds the cases §6.19 lists", () => {
    const paths = Object.keys(FORMS.index.files);
    expect(paths).toEqual(
      expect.arrayContaining(["roadmap.md", "x/roadmap.md"]),
    );
    expect(paths).toContain("docs/my notes.md");
    // A trailing `/` (§6.13) is told from none only by a folder named like a
    // file elsewhere, and a quoted leading `/` only by a root path that needs
    // quoting, as `documentFilter` writes it for Referenced by (§7.1). A path
    // that holds another's whole text tells a value found anywhere from one
    // pinned to the start: `x/docs/design/a.md` and `docs/design/a.md`.
    expect(paths).toEqual(
      expect.arrayContaining([
        "a.md",
        "y/a.md/inner.md",
        "my notes.md",
        "y/my notes.md/inner.md",
        "x/docs/design/a.md",
        "docs/design/a.md",
      ]),
    );
    const canonicals = FORMS.read.map((entry) => entry.canonical);
    expect(canonicals).toEqual(
      expect.arrayContaining([
        "path:a.md/",
        "path:docs/design/a.md/",
        'path:"/my notes.md"',
        'path:"my notes.md/"',
        'path:"docs/my notes.md/"',
      ]),
    );
    // NFC, kept as escapes so no editor can normalize it.
    expect(paths).toContain("docs/caf\u00e9.md");
    expect(paths.every((path) => path === path.normalize("NFC"))).toBe(true);
    const questions = INDEX.documents.flatMap((doc) => doc.questions);
    const a2 = questions.find((q) => q.id === "OQ-A2");
    expect(a2).toMatchObject({ marker: "\u{1F512} \u23f8", state: "blocked" });
    const outer = questions.find((q) => q.id === "OQ-A3")!;
    const inner = questions.find((q) => q.id === "OQ-A4")!;
    expect(inner.state).toBe("answered");
    expect(inner.unitLine).toBeGreaterThan(outer.unitLine);
    expect(inner.unitEndLine).toBeLessThanOrEqual(outer.unitEndLine);
    // Every open marker is:open reads (§6.12): 💬 🤷 on a routed path, and
    // no marker on an unrouted one, so both Needs you and Not on a roadmap
    // hold one.
    expect(questions.find((q) => q.id === "OQ-A5")).toMatchObject({
      marker: "\u{1F4AC} \u{1F937}",
      state: "open",
    });
    expect(questions.find((q) => q.id === "OQ-N2")).toMatchObject({
      marker: "",
      state: "open",
    });
    expect(SECTIONS.needsYou.map((q) => q.id)).toContain("OQ-A5");
    expect(SECTIONS.unrouted?.map((q) => q.id)).toContain("OQ-N2");
    // A routing roadmap, a question it does not route, and declared stages,
    // so the page's parity test has requests to compare.
    expect(SECTIONS.chosenRoadmap).toBe("roadmap.md");
    expect(SECTIONS.unrouted?.length).toBeGreaterThan(0);
    expect(SECTIONS.stagesDeclared).toBe(true);
    expect(SECTIONS.skipped).toEqual(FORMS.index.skipped);
    expect(SECTIONS.unreadable.map((entry) => entry.path)).toEqual([
      "notes/broken.md",
    ]);
    // Every file but the Too large one fits under its limit.
    for (const content of Object.values(FORMS.index.files)) {
      expect(new TextEncoder().encode(content).length).toBeLessThan(
        FORMS.index.maxFileBytes,
      );
    }
    expect(FORMS.index.skipped[0]!.size).toBeGreaterThan(
      FORMS.index.maxFileBytes,
    );
  });

  // Each pinned to the searched field or the rule of §6.12 it shows.
  it("holds a text case for each searched field and each rule of §6.12", () => {
    const read = (text: string) => {
      const entry = FORMS.read.find((e) => e.text === text);
      if (entry === undefined) throw new Error(`no read entry ${text}`);
      return entry;
    };
    const question = (id: string) => QUESTIONS.find((q) => q.id === id)!;
    const lower = (text: string | null) => (text ?? "").toLowerCase();
    // A question by each of its fields alone: its id, which its title does
    // not hold; its title; its leaning; its document's path.
    expect(lower(question("OQ-X1").title)).not.toContain("oq-x1");
    expect(read("oq-x1").questions).toEqual(["x/docs/design/a.md#OQ-X1"]);
    expect(read("outer").questions).toEqual(["docs/design/a.md#OQ-A3"]);
    expect(question("OQ-C2").leaning).toBe("Quietly.");
    expect(lower(question("OQ-C2").title)).not.toContain("quietly");
    expect(read("quietly").questions).toEqual(["docs/design/sub/c.md#OQ-C2"]);
    expect(read("caf\u00e9").questions).toEqual(["docs/caf\u00e9.md#OQ-K1"]);
    // A row by its stage, and by its next.
    expect(read("built").keeps).toEqual(["graduate notes/e.md"]);
    const built = INDEX.documents.find((doc) => doc.path === "notes/e.md");
    expect(built?.next).toBe("Graduate into the reference");
    expect(read('"graduate into"').keeps).toEqual(["graduate notes/e.md"]);
    // A Too large and an Unreadable path.
    expect(read("big.md").keeps).toEqual(["skipped docs/big.md"]);
    expect(read("broken").keeps).toEqual(["could-not-read notes/broken.md"]);
    // A match only in case, NFC against NFD, a phrase against its words apart.
    expect(read("oq-a1").keeps).toEqual(["needs-you docs/design/a.md#OQ-A1"]);
    expect(read("CAF\u00c9").questions).toEqual(read("caf\u00e9").questions);
    expect(read("cafe\u0301").keeps).toEqual([]);
    expect(read("inner ruled").questions).toEqual(["docs/design/a.md#OQ-A4"]);
    expect(read('"inner ruled"').questions).toEqual([]);
    // An exclusion of each kind, and an unknown key's hint.
    expect(read("path:docs/design/a.md -outer").questions).not.toContain(
      "docs/design/a.md#OQ-A3",
    );
    expect(read("-path:docs/design").documents).not.toContain(
      "docs/design/a.md",
    );
    expect(read("path:notes -is:open").questions).toEqual(["notes/b.md#OQ-B1"]);
    expect(read("stage:decided").unknownKeys).toEqual(["stage"]);
    expect(read("http://x").unknownKeys).toEqual([]);
  });

  it("never lists a text both as read and as not understood", () => {
    const read = new Set(FORMS.read.map((entry) => entry.text));
    for (const entry of FORMS.notUnderstood) {
      expect(read.has(entry.text)).toBe(false);
    }
    expect(read.size).toBe(FORMS.read.length);
  });

  describe.each(FORMS.read)("reads $text", (entry) => {
    const filter = understood(entry.text);

    it("to its canonical text, which reads back to itself", () => {
      expect(filter.canonical).toBe(entry.canonical);
      const again = understood(entry.canonical);
      expect(again.canonical).toBe(entry.canonical);
      expect(again.terms).toEqual(filter.terms);
      expect(filter.unknownKeys).toEqual(entry.unknownKeys);
      expect(again.unknownKeys).toEqual(entry.unknownKeys);
    });

    it("keeping the questions it reads as kept, wherever the sections put them", () => {
      const kept = INDEX.documents
        .flatMap((doc) => doc.questions)
        .filter((q) => filterKeepsQuestion(filter, q))
        .map((q) => `${q.path}#${q.id}`)
        .sort();
      expect(kept).toEqual(entry.questions);
    });

    it("keeping the documents §6.13 keeps, and the entries they hold", () => {
      expect(keptDocuments(filter)).toEqual(entry.documents);
      const { sections, summary } = applyPlanningFilter(
        INDEX,
        SECTIONS,
        filter,
      );
      expect(sectionEntryKeys(sections)).toEqual(entry.keeps);
      expect(summary.unmatched).toEqual(entry.unmatched);
      expect(summary.unknownKeys.map(({ key }) => key)).toEqual(
        entry.unknownKeys,
      );
      expect(summary.documents).toEqual({
        kept: entry.documents.length,
        of: LISTED.length,
      });
      expect(summary.entries.shown).toBe(entry.keeps.length);
    });

    it("through a link that URLSearchParams reads back unchanged", () => {
      const link = planningLink(entry.canonical);
      expect(link.startsWith(`${PLANNING_PAGE_PATH}?filter=`)).toBe(true);
      expect(queryOf(link).getAll(PLANNING_FILTER_PARAM)).toEqual([
        entry.canonical,
      ]);
      expect(readPastedPlanningLink(link)).toEqual({
        filter: entry.canonical,
        roadmap: null,
      });
      // Nothing a chat client or Markdown reads as markup, or that cuts the
      // value short, and `:` and `/` as they are, to be read, but for a last
      // character a pasted link's end drops (§13.5).
      expect(link).not.toMatch(/[*#&"` ]/);
      expect(link.replace(/%(2E|5F|7E|3A)$/, "")).not.toMatch(/%3A|%2F/i);
    });
  });

  // The keeps are only as right as the rule they were drawn with (§6.12), so
  // it is written here a second time, plainly: an entry is kept when its path
  // is a kept document (§6.13's answer, in `documents`), it passes the is: and
  // -is: terms, every text term is a substring of one of its searched fields
  // whatever the case, and no -text term is.
  it("keeps exactly the questions and entries the four tests of §6.12 keep", () => {
    const all = sectionEntryKeys(SECTIONS);
    const passes = (
      filter: UnderstoodPlanningFilter,
      state: string | null,
      fields: readonly (string | null)[],
    ) =>
      filter.terms.every((term) => {
        if (term.key === "path") return true;
        const matches =
          term.key === "is"
            ? state === "open"
            : fields.some((field) =>
                (field ?? "").toLowerCase().includes(term.value.toLowerCase()),
              );
        return matches !== term.exclude;
      });
    for (const entry of FORMS.read) {
      const filter = understood(entry.text);
      const questions = QUESTIONS.filter(
        (q) =>
          entry.documents.includes(q.path) &&
          passes(filter, q.state, [q.id, q.title, q.leaning, q.path]),
      )
        .map((q) => `${q.path}#${q.id}`)
        .sort();
      expect(entry.questions, entry.text).toEqual(questions);
      const allowed = all.filter((key) => {
        const section = key.slice(0, key.indexOf(" "));
        const target = key.slice(key.indexOf(" ") + 1);
        const hash = target.lastIndexOf("#");
        const path = hash === -1 ? target : target.slice(0, hash);
        if (!entry.documents.includes(path)) return false;
        if (hash !== -1) return questions.includes(target);
        // A row has no state; a Too large or Unreadable one only a path.
        const doc = INDEX.documents.find((d) => d.path === path);
        const fields =
          section === "skipped" || section === "could-not-read"
            ? [path]
            : [path, doc?.stage ?? null, doc?.next ?? null];
        return passes(filter, null, fields);
      });
      expect(entry.keeps, entry.text).toEqual(allowed);
    }
  });

  describe.each(FORMS.notUnderstood)("does not understand $text", (entry) => {
    it("and names its term, or its reason", () => {
      const parsed = parsePlanningFilter(entry.text);
      expect(parsed).toEqual({
        kind: "not-understood",
        text: entry.text,
        term: "term" in entry ? entry.term : null,
        reason: "reason" in entry ? entry.reason : null,
      });
    });
  });
});

describe("the grammar (§6.12, §6.14)", () => {
  it("reads empty text and white space alone as no filter", () => {
    for (const text of ["", " ", "\t\r\n ", "\n\n"]) {
      expect(parsePlanningFilter(text)).toEqual({ kind: "none" });
    }
  });

  it("splits at space, tab, CR and LF, and at no other white space", () => {
    expect(understood("path:a.md\tis:open").canonical).toBe(
      "path:a.md is:open",
    );
    const others = [
      0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
      0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
      0x000b, 0x000c, 0x0085, 0xfeff,
    ];
    // Any other is a character of the term it sits in, or an excluded code
    // point, which no term may hold.
    const excluded = [0x000b, 0x000c, 0x0085, 0xfeff];
    for (const cp of others) {
      const c = String.fromCodePoint(cp);
      const text = `path:a.md${c}is:open`;
      if (excluded.includes(cp)) {
        expect(parsePlanningFilter(text), cp.toString(16)).toEqual({
          kind: "not-understood",
          text,
          term: text,
          reason: null,
        });
        continue;
      }
      expect(understood(text).terms, cp.toString(16)).toEqual([
        {
          key: "path",
          text,
          value: `a.md${c}is:open`,
          quoted: false,
          exclude: false,
        },
      ]);
    }
  });

  it("names the first term it cannot read, as written", () => {
    expect(parsePlanningFilter('path:docs "a b" a"b" is:x')).toMatchObject({
      term: 'a"b"',
    });
    expect(
      parsePlanningFilter("is:open path:x Path:y is:Open -z"),
    ).toMatchObject({ term: "is:Open" });
  });

  // The colon rule (§6.12): a qualifier exactly when the part before the
  // first `:` is a key, which must then read as one; any other term is text.
  it("reads a term as a qualifier only when the part before its first colon is a key", () => {
    const keys = (text: string) => understood(text).terms.map((t) => t.key);
    expect(keys("path:a is:open")).toEqual(["path", "is"]);
    for (const text of [
      "word",
      "stage:ready",
      "Path:a",
      "PATH:a",
      "IS:open",
      "http://x",
      "Note:",
      ":x",
      ":",
      '"path:a"',
      "(path:a)",
      "!path:a",
      "pathx:a",
    ]) {
      expect(keys(text), text).toEqual(["text"]);
    }
    // A key's term that does not read as one is not understood, never text.
    for (const text of [
      "path:",
      "is:",
      "is:closed",
      'path:a"b"',
      "is:open:x",
    ]) {
      expect(parsePlanningFilter(text).kind, text).toBe("not-understood");
    }
  });

  it("reads a word or a quoted phrase as a text term, in its own case", () => {
    expect(understood("Generator").terms).toEqual([
      {
        key: "text",
        text: "Generator",
        value: "Generator",
        quoted: false,
        exclude: false,
        unknownKey: null,
      },
    ]);
    expect(understood('"command surface"').terms).toEqual([
      {
        key: "text",
        text: '"command surface"',
        value: "command surface",
        quoted: true,
        exclude: false,
        unknownKey: null,
      },
    ]);
    // A word may hold what a pattern may not: `*`, `?`, `#`, a no-break space.
    expect(understood("a*b?c#\u00a0d").terms[0]).toMatchObject({
      key: "text",
      value: "a*b?c#\u00a0d",
    });
  });

  it("reads one leading - as an exclusion of the term after it", () => {
    expect(understood("-path:a -is:open -word").terms).toEqual([
      {
        key: "path",
        text: "-path:a",
        value: "a",
        quoted: false,
        exclude: true,
      },
      { key: "is", text: "-is:open", value: "open", exclude: true },
      {
        key: "text",
        text: "-word",
        value: "word",
        quoted: false,
        exclude: true,
        unknownKey: null,
      },
    ]);
    // Only one: `--x` excludes the text `-x`, and `-"-x"` does too.
    expect(understood("--x").terms[0]).toMatchObject({
      key: "text",
      value: "-x",
      exclude: true,
    });
    expect(understood('-"-x"').terms[0]).toMatchObject({
      value: "-x",
      exclude: true,
    });
    // A lone `-` excludes nothing, and is not understood.
    for (const text of ["-", "a - b", "-path:", "-is:", '-""']) {
      expect(parsePlanningFilter(text).kind, text).toBe("not-understood");
    }
    expect(parsePlanningFilter("a - b")).toMatchObject({ term: "-" });
  });

  it("refuses a quote that does not wrap a whole value, and an empty one", () => {
    for (const [text, term] of [
      ['a"b"', 'a"b"'],
      ['"a"b', '"a"b'],
      ['stage:"ready"', 'stage:"ready"'],
      ['x a"b c"', 'a"b c"'],
      ['""', '""'],
      ['path:""', 'path:""'],
      ['"a\\x"', '"a\\x"'],
    ]) {
      expect(parsePlanningFilter(text), text).toMatchObject({
        kind: "not-understood",
        term,
      });
    }
  });

  // §6.12: the hint's rule is exact.
  it("notes an unknown key: lowercase letters before the colon, no key, and no / after it", () => {
    expect(understood("stage:ready").unknownKeys).toEqual(["stage"]);
    expect(understood("-title:x").unknownKeys).toEqual(["title"]);
    expect(understood("title:").unknownKeys).toEqual(["title"]);
    expect(understood("a:b").unknownKeys).toEqual(["a"]);
    // Once each, in the order written, with the term that opened it.
    const filter = understood("stage:a title:b stage:c");
    expect(filter.unknownKeys).toEqual(["stage", "title"]);
    expect(
      filter.terms.map((t) => (t.key === "text" ? t.unknownKey : null)),
    ).toEqual(["stage", "title", "stage"]);
    for (const text of [
      "http://x",
      "Note:",
      "Path:x",
      "IS:open",
      "oq-pf1:",
      "x1:y",
      ":x",
      '"stage:ready"',
      '-"title:x"',
      "word",
    ]) {
      expect(understood(text).unknownKeys, text).toEqual([]);
    }
  });

  it("runs an unclosed quote to the end of the text, and names the reason", () => {
    expect(parsePlanningFilter('path:"docs/a b.md is:open')).toEqual({
      kind: "not-understood",
      text: 'path:"docs/a b.md is:open',
      term: null,
      reason: "unclosed-quote",
    });
    // An escaped quote does not close it.
    expect(parsePlanningFilter('path:"a\\" b')).toMatchObject({
      reason: "unclosed-quote",
    });
  });

  it("reads is: only with the value open, bare", () => {
    expect(understood("is:open").terms).toEqual([
      { key: "is", text: "is:open", value: "open", exclude: false },
    ]);
    // `is:"open"` is not understood (§6.14): a quote may wrap
    // a `path:` value, and `open` is the one value `is:` reads.
    for (const text of [
      'is:"open"',
      "is:Open",
      "is:closed",
      "is:",
      "is:open:x",
    ]) {
      expect(parsePlanningFilter(text).kind, text).toBe("not-understood");
    }
  });

  it("stops at its limits, configured down, with the reason where it has no term to name", () => {
    const terms = { terms: 2, codePoints: 2048 };
    // Counted as written, repeats included.
    expect(parsePlanningFilter("is:open is:open is:open", terms)).toMatchObject(
      {
        term: null,
        reason: "too-many-terms",
      },
    );
    expect(parsePlanningFilter("is:open is:open", terms).kind).toBe(
      "understood",
    );

    const length = { terms: 64, codePoints: 8 };
    expect(parsePlanningFilter("path:abcd", length)).toMatchObject({
      term: null,
      reason: "too-long",
    });
    expect(parsePlanningFilter("path:abc", length).kind).toBe("understood");
    // Code points, not UTF-16 units: eight code points, nine units.
    const emoji = 'path:"\u{1F4AC}"';
    expect(emoji.length).toBe(9);
    expect(parsePlanningFilter(emoji, length).kind).toBe("understood");
    // White space counts, but white space alone is still no filter.
    expect(parsePlanningFilter("   is:open", length)).toMatchObject({
      reason: "too-long",
    });
    expect(parsePlanningFilter(" ".repeat(9), length)).toEqual({
      kind: "none",
    });
    // Past the code-point limit before past the term limit, and both before
    // an unclosed quote.
    const both = { terms: 1, codePoints: 16 };
    expect(parsePlanningFilter("is:open is:open is:open", both)).toMatchObject({
      term: null,
      reason: "too-long",
    });
    expect(
      parsePlanningFilter('is:open path:"a', { terms: 1, codePoints: 64 }),
    ).toMatchObject({ reason: "too-many-terms" });
    expect(PLANNING_FILTER_LIMITS).toEqual({ terms: 64, codePoints: 2048 });
  });

  // §6.14 and §6.18: the notice names the first term it cannot read, and the
  // reason stands in only where there is no term to name.
  it("names the first term it cannot read in a filter past a limit", () => {
    const terms = { terms: 2, codePoints: 2048 };
    expect(parsePlanningFilter("is:x is:y is:z", terms)).toMatchObject({
      term: "is:x",
      reason: null,
    });
    // Past the term limit too: every term is read.
    expect(
      parsePlanningFilter("is:open is:open is:open is:x", terms),
    ).toMatchObject({ term: "is:x", reason: null });
    // Words count as terms.
    expect(parsePlanningFilter("a b c", terms)).toMatchObject({
      term: null,
      reason: "too-many-terms",
    });

    const length = { terms: 64, codePoints: 10 };
    expect(parsePlanningFilter("is:x xxxxxxxxxxxxxxxxxxxx", length)).toEqual({
      kind: "not-understood",
      text: "is:x xxxxxxxxxxxxxxxxxxxx",
      term: "is:x",
      reason: null,
    });
    expect(parsePlanningFilter('x a"b" is:open', length)).toMatchObject({
      term: 'a"b"',
    });
    // A term that ends exactly at the limit is read whole: the one code
    // point after it says it ends there.
    expect(parsePlanningFilter('is:open "" path:abc', length)).toMatchObject({
      term: '""',
    });
    // A term the limit cuts off is never named, even where what is read of
    // it is not understood, since nothing past the limit is read.
    expect(parsePlanningFilter("is:open is:x", length)).toMatchObject({
      term: null,
      reason: "too-long",
    });
    expect(parsePlanningFilter('is:open a"b"', length)).toMatchObject({
      term: null,
      reason: "too-long",
    });
    // Before an unclosed quote, a term is named too.
    expect(parsePlanningFilter('is:x path:"a b', terms)).toMatchObject({
      term: "is:x",
    });
  });

  it("refuses each end of each excluded range inside quotes and in a word, and what lies just outside none", () => {
    const ranges: [number, number][] = [
      [0x0000, 0x001f],
      [0x007f, 0x009f],
      [0x00ad, 0x00ad],
      [0x061c, 0x061c],
      [0x180e, 0x180e],
      [0x200b, 0x200f],
      [0x202a, 0x202e],
      [0x2060, 0x206f],
      [0xfeff, 0xfeff],
    ];
    const forms = [
      (c: string) => `path:"a${c}b.md"`,
      (c: string) => `"a${c}b"`,
      (c: string) => `a${c}b`,
      (c: string) => `-a${c}b`,
    ];
    // Space, tab, CR and LF split a word, so they lie outside one.
    const splits = (cp: number) => [0x20, 0x09, 0x0d, 0x0a].includes(cp);
    for (const form of forms) {
      for (const [lo, hi] of ranges) {
        for (const cp of [lo, hi]) {
          const text = form(String.fromCodePoint(cp));
          if (splits(cp) && !text.includes('"')) continue;
          expect(parsePlanningFilter(text).kind, text).toBe("not-understood");
        }
        for (const cp of [lo - 1, hi + 1]) {
          if (cp < 0 || ranges.some(([a, b]) => cp >= a && cp <= b)) continue;
          if (splits(cp)) continue;
          const text = form(String.fromCodePoint(cp));
          expect(parsePlanningFilter(text).kind, text).toBe("understood");
        }
      }
    }
  });

  it("refuses a lone surrogate (§6.14)", () => {
    for (const unit of ["\ud800", "\udbff", "\udc00", "\udfff"]) {
      for (const text of [`path:"a${unit}b"`, `a${unit}b`, `"a${unit}b"`]) {
        expect(parsePlanningFilter(text).kind).toBe("not-understood");
      }
    }
    expect(understood("a\u{1F4AC}b").canonical).toBe("a\u{1F4AC}b");
    // A pair is one code point, and a path may hold it, bare or quoted.
    expect(understood('path:"a\u{1F4AC}b"').canonical).toBe("path:a\u{1F4AC}b");
  });

  it("folds case, and does not normalize", () => {
    expect(apply("path:Docs/design").summary.unmatched).toEqual([]);
    expect(apply("path:DOCS/CAF\u00c9.MD").summary.documents.kept).toBe(1);
    const nfd = "path:docs/cafe\u0301.md";
    expect(apply(nfd).summary.unmatched).toEqual([nfd]);
    expect(apply('path:"docs/caf\u00e9.md"').summary.unmatched).toEqual([]);
  });
});

describe("canonical text (§6.14)", () => {
  it("1: joins the terms with one space, in order, and drops a repeat", () => {
    expect(
      understood(" is:open\n\npath:b  path:a is:open path:b ").canonical,
    ).toBe("is:open path:b path:a");
    // A repeat is one of the same canonical text: a word's case is its own.
    expect(understood('word "word" Word -word -"word"').canonical).toBe(
      "word Word -word",
    );
    expect(understood("is:open -is:open path:a -path:a").canonical).toBe(
      "is:open -is:open path:a -path:a",
    );
  });

  it("2: reads one leading ./ as /, and keeps a leading /, which pins the value to the start", () => {
    expect(understood("path:./docs/x.md").canonical).toBe("path:/docs/x.md");
    expect(understood("path:/docs/x.md").canonical).toBe("path:/docs/x.md");
    expect(understood("path:docs/x.md").canonical).toBe("path:docs/x.md");
    expect(understood("path:./roadmap.md").canonical).toBe("path:/roadmap.md");
    expect(understood("path:./docs/").canonical).toBe("path:/docs/");
    expect(understood("path:./").canonical).toBe("path:/");
    // Only one, and only leading: the rest is the value's own text.
    expect(understood("path:././x.md").canonical).toBe("path:/./x.md");
    expect(understood("path:docs/./x.md").canonical).toBe("path:docs/./x.md");
    expect(understood('path:"./my notes.md"').canonical).toBe(
      'path:"/my notes.md"',
    );
    expect(understood('path:"/docs/my notes.md"').canonical).toBe(
      'path:"/docs/my notes.md"',
    );
    // In its own case, which matching folds.
    expect(understood("path:Docs/X.md").canonical).toBe("path:Docs/X.md");
  });

  it("3: writes a quoted value bare where it reads the same so", () => {
    expect(understood('path:"docs/x.md"').canonical).toBe("path:docs/x.md");
    expect(understood('path:"docs/c++.md"').canonical).toBe("path:docs/c++.md");
    expect(understood('path:"a\\\\b.md"').canonical).toBe("path:a\\b.md");
    expect(understood('path:"a\\\\b.md"').terms).toEqual(
      understood("path:a\\b.md").terms,
    );
    // Not with a `*`, which bare is a wildcard, a space, which bare would
    // split it, or a `"`, which bare would open a quote.
    expect(understood('path:"docs/*.md"').canonical).toBe('path:"docs/*.md"');
    expect(understood('path:"my notes"').canonical).toBe('path:"my notes"');
    expect(understood('path:"a\\"b"').canonical).toBe('path:"a\\"b"');
  });

  it("4: writes a word as typed, and a phrase bare where it reads the same so", () => {
    expect(understood("Generator").canonical).toBe("Generator");
    expect(understood('"Generator"').canonical).toBe("Generator");
    expect(understood('"a\\\\b"').canonical).toBe("a\\b");
    expect(understood("a\\b").terms).toEqual(understood('"a\\\\b"').terms);
    // Quoted where bare it would split, quote, draw a hint or be a qualifier,
    // or exclude.
    for (const phrase of [
      '"command surface"',
      '"a\\"b"',
      '"stage:ready"',
      '"path:a"',
      '"-x"',
    ]) {
      expect(understood(phrase).canonical, phrase).toBe(phrase);
    }
  });

  it("5: writes an exclusion as a - before its term's canonical text", () => {
    expect(understood('-path:"./docs/x.md" -"Word" -is:open').canonical).toBe(
      "-path:/docs/x.md -Word -is:open",
    );
    expect(understood('-path:"my notes.md" -"a b"').canonical).toBe(
      '-path:"my notes.md" -"a b"',
    );
    expect(understood("--x").canonical).toBe("--x");
    expect(understood('-"-x"').canonical).toBe('-"-x"');
  });

  it('6: escapes only " and \\ inside quotes', () => {
    expect(understood('path:"a\\\\b \\"c\\" #?.md"').canonical).toBe(
      'path:"a\\\\b \\"c\\" #?.md"',
    );
    expect(understood('path:"a\\\\b \\"c\\" #?.md"').terms).toEqual([
      {
        key: "path",
        text: 'path:"a\\\\b \\"c\\" #?.md"',
        value: 'a\\b "c" #?.md',
        quoted: true,
        exclude: false,
      },
    ]);
    expect(understood('"a\\\\b \\"c\\""').canonical).toBe('"a\\\\b \\"c\\""');
  });

  it("7: no terms is no filter", () => {
    expect(parsePlanningFilter("   ")).toEqual({ kind: "none" });
    expect(planningLink("")).toBe(PLANNING_PAGE_PATH);
  });

  it("holds no control character, so it can sit in a newline-joined key", () => {
    for (const entry of FORMS.read) {
      // eslint-disable-next-line no-control-regex
      expect(entry.canonical).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    }
  });
});

describe("matching (§6.12, §6.13)", () => {
  const keeps = (text: string, path: string) =>
    filterKeepsQuestion(understood(text), at(path));

  it("ORs path: terms and ANDs the tests", () => {
    const filter = understood("path:docs/a.md path:docs/b.md is:open");
    const kept = (path: string, state: PlanningFilterQuestion["state"]) =>
      filterKeepsQuestion(filter, at(path, state));
    expect(kept("docs/a.md", "open")).toBe(true);
    expect(kept("docs/b.md", "open")).toBe(true);
    expect(kept("docs/c.md", "open")).toBe(false);
    expect(kept("docs/a.md", "blocked")).toBe(false);
    expect(kept("docs/a.md", "answered")).toBe(false);
    expect(keeps("is:open", "anything/at/all.md")).toBe(true);
  });

  it("keeps a document by its path: terms, less its -path: terms, whatever else the filter says", () => {
    const filter = understood("path:docs -path:docs/x is:open word -other");
    expect(filterKeepsDocument(filter, "docs/a.md")).toBe(true);
    expect(filterKeepsDocument(filter, "docs/x/a.md")).toBe(false);
    expect(filterKeepsDocument(filter, "notes/a.md")).toBe(false);
    expect(filterKeepsDocument(understood("-path:docs"), "a.md")).toBe(true);
    expect(filterKeepsDocument(understood("-path:docs"), "docs/a.md")).toBe(
      false,
    );
    expect(filterKeepsDocument(understood("word"), "anything.md")).toBe(true);
  });

  const question = (fields: Partial<PlanningFilterQuestion>) => ({
    ...at("docs/a.md"),
    ...fields,
  });
  const keepsQuestion = (text: string, q: PlanningFilterQuestion) =>
    filterKeepsQuestion(understood(text), q);

  it("matches a text term as a substring of any one field, whatever the case", () => {
    const q = question({
      id: "OQ-PF1",
      title: "OQ-PF1: Which keys does the first release read?",
      leaning: "Path and is",
      path: "docs/design/planning-filter.md",
    });
    for (const text of [
      "oq-pf",
      "PF1",
      "KEYS",
      "release read",
      "first",
      '"keys does"',
      "path and",
      "planning-filter",
      "DESIGN/PLAN",
      ".md",
      "?",
      ":",
    ]) {
      expect(keepsQuestion(text, q), text).toBe(true);
    }
    for (const text of [
      "keyz",
      '"does keys"',
      "planning-filter nothere",
      '"read? path"',
      '"filter.md oq"',
    ]) {
      expect(keepsQuestion(text, q), text).toBe(false);
    }
  });

  it("ANDs text terms in any order, each in a field of its own choosing", () => {
    const q = question({ id: "OQ-A1", title: "The first?", leaning: "Yes." });
    expect(keepsQuestion("first yes", q)).toBe(true);
    expect(keepsQuestion("yes first oq-a1 docs", q)).toBe(true);
    expect(keepsQuestion("first nope", q)).toBe(false);
    // A phrase is one substring, spaces included, and never spans two fields.
    expect(keepsQuestion('"the first"', q)).toBe(true);
    expect(keepsQuestion('"first the"', q)).toBe(false);
    expect(keepsQuestion('"first? yes"', q)).toBe(false);
  });

  it("reads nothing as a wildcard, folds only case, and normalizes nothing", () => {
    const q = question({ title: "Caf\u00e9 au lait, stra\u00dfe" });
    expect(keepsQuestion("caf*", q)).toBe(false);
    expect(keepsQuestion("ca?", q)).toBe(false);
    expect(keepsQuestion("CAF\u00c9", q)).toBe(true);
    expect(keepsQuestion("cafe\u0301", q)).toBe(false);
    expect(keepsQuestion("strasse", q)).toBe(false);
    expect(keepsQuestion("STRA\u00dfE", q)).toBe(true);
    expect(keepsQuestion("*", question({ title: "a * b" }))).toBe(true);
  });

  it("matches nothing with a field the index holds as null", () => {
    const q = question({ id: null, title: "T", leaning: null });
    expect(keepsQuestion("null", q)).toBe(false);
    expect(keepsQuestion("-null", q)).toBe(true);
  });

  it("drops what an exclusion would keep, and nothing else", () => {
    const open = question({ title: "Alpha beta" });
    const blocked = question({ title: "Alpha", state: "blocked" });
    expect(keepsQuestion("-beta", open)).toBe(false);
    expect(keepsQuestion("-beta", blocked)).toBe(true);
    expect(keepsQuestion("alpha -beta", blocked)).toBe(true);
    expect(keepsQuestion("-is:open", open)).toBe(false);
    expect(keepsQuestion("-is:open", blocked)).toBe(true);
    expect(keepsQuestion("-path:docs", open)).toBe(false);
    expect(keepsQuestion("-path:notes", open)).toBe(true);
    // Excluding the text a term keeps leaves nothing.
    expect(keepsQuestion("alpha -alpha", open)).toBe(false);
    // `--x` excludes the text `-x`.
    expect(keepsQuestion("--x", question({ title: "a-x" }))).toBe(false);
    expect(keepsQuestion("--x", question({ title: "x" }))).toBe(true);
  });

  // §6.13's one sentence, a clause at a time.
  it("finds a path: value anywhere in the path", () => {
    expect(keeps("path:docs/des", "docs/design/a.md")).toBe(true);
    expect(keeps("path:docs/des", "x/docs/design/a.md")).toBe(true);
    expect(keeps("path:filter", "docs/design/planning-filter.md")).toBe(true);
    expect(keeps("path:filter", "frontend/filters/x.md")).toBe(true);
    expect(keeps("path:filter", "docs/design/a.md")).toBe(false);
    expect(keeps("path:sign/a.m", "docs/design/a.md")).toBe(true);
    // A path a value is a prefix of, as every keystroke of one is.
    for (const typed of ["d", "do", "docs/", "docs/d", "docs/desig"]) {
      expect(keeps(`path:${typed}`, "docs/design/a.md"), typed).toBe(true);
    }
    // Every character is its own: no `?`, class, comment or negation.
    expect(keeps("path:c++", "docs/c++.md")).toBe(true);
    expect(keeps("path:a?.md", "docs/a?.md")).toBe(true);
    expect(keeps("path:a?.md", "docs/ab.md")).toBe(false);
    expect(keeps("path:[ab].md", "docs/a.md")).toBe(false);
    expect(keeps("path:#docs", "x/#docs/a.md")).toBe(true);
    expect(keeps("path:!docs", "docs/a.md")).toBe(false);
    expect(keeps("path:docs//a", "docs/a.md")).toBe(false);
  });

  it("folds case on both sides, as a text term does", () => {
    expect(keeps("path:DOCS/Design", "docs/design/a.md")).toBe(true);
    expect(keeps("path:docs/design", "Docs/DESIGN/A.md")).toBe(true);
    expect(keeps('path:"MY NOTES"', "docs/my notes.md")).toBe(true);
    expect(keeps("path:/ROADMAP.MD", "roadmap.md")).toBe(true);
    expect(keeps("path:*.MD", "a.md")).toBe(true);
    expect(keeps("path:CAF\u00c9", "docs/caf\u00e9.md")).toBe(true);
    // Only case: an NFD spelling does not keep an NFC path.
    expect(keeps("path:cafe\u0301", "docs/caf\u00e9.md")).toBe(false);
  });

  it("pins a value with a leading / or ./ to the start of the path", () => {
    expect(keeps("path:/roadmap.md", "roadmap.md")).toBe(true);
    expect(keeps("path:/roadmap.md", "x/roadmap.md")).toBe(false);
    expect(keeps("path:roadmap.md", "x/roadmap.md")).toBe(true);
    // Any path that starts with its text, a longer name included.
    expect(keeps("path:/roadmap.md", "roadmap.md/x.md")).toBe(true);
    expect(keeps("path:/roadmap", "roadmap-2.md")).toBe(true);
    expect(keeps("path:./roadmap.md", "roadmap.md")).toBe(true);
    expect(keeps("path:./roadmap.md", "x/roadmap.md")).toBe(false);
    // An agent's exact link keeps its document, and not one a folder down.
    expect(keeps("path:/docs/design/x.md", "docs/design/x.md")).toBe(true);
    expect(keeps("path:/docs/design/x.md", "y/docs/design/x.md")).toBe(false);
    // `/` alone pins nothing to the start, and keeps every path.
    expect(keeps("path:/", "a.md")).toBe(true);
    expect(keeps("path:/", "x/y.md")).toBe(true);
  });

  it("reads a * as any characters within one folder or file name, and ** as any across folders", () => {
    expect(keeps("path:*.md", "a.md")).toBe(true);
    expect(keeps("path:*.md", "docs/design/a.md")).toBe(true);
    expect(keeps("path:*.md", "docs/a.txt")).toBe(false);
    expect(keeps("path:docs/*.md", "docs/a.md")).toBe(true);
    expect(keeps("path:docs/*.md", "x/docs/a.md")).toBe(true);
    expect(keeps("path:docs/*.md", "docs/design/a.md")).toBe(false);
    expect(keeps("path:/docs/*.md", "x/docs/a.md")).toBe(false);
    expect(keeps("path:docs/*/a.md", "docs/design/a.md")).toBe(true);
    expect(keeps("path:docs/*/a.md", "docs/design/sub/a.md")).toBe(false);
    expect(keeps("path:a*", "docs/a-plan.md")).toBe(true);
    // `*` may stand for no character at all.
    expect(keeps("path:a*.md", "docs/a.md")).toBe(true);
    expect(keeps("path:docs/**.md", "docs/design/sub/a.md")).toBe(true);
    expect(keeps("path:/docs/**.md", "docs/a.md")).toBe(true);
    expect(keeps("path:/docs/**.md", "x/docs/a.md")).toBe(false);
    // Three or more are two.
    expect(keeps("path:docs/***a.md", "docs/x/y/a.md")).toBe(true);
    // A value need not reach the path's end, so a trailing `*` adds nothing,
    // and a `*` stays within one name only where text follows it.
    for (const path of [
      "docs/design/search.md",
      "docs/design/search/old.md",
      "docs/design/searchlight/x.md",
    ]) {
      expect(keeps("path:/docs/design/search*", path), path).toBe(true);
      expect(keeps("path:/docs/design/search", path), path).toBe(true);
    }
    expect(
      keeps("path:/docs/design/search*.md", "docs/design/search-plan.md"),
    ).toBe(true);
    expect(
      keeps("path:/docs/design/search*.md", "docs/design/search/old.md"),
    ).toBe(false);
    expect(keeps("path:/docs/*.md", "docs/a.md/inner.md")).toBe(true);
  });

  // As gitignore and GitHub read it: a `**` that is a whole folder name
  // stands for any number of folders, none included.
  it("reads a /**/ as zero or more folders, and a leading **/ as zero or more leading folders", () => {
    expect(keeps("path:docs/**/a.md", "docs/a.md")).toBe(true);
    expect(keeps("path:docs/**/a.md", "docs/design/a.md")).toBe(true);
    expect(keeps("path:docs/**/a.md", "docs/design/sub/a.md")).toBe(true);
    expect(keeps("path:docs/**/a.md", "x/docs/a.md")).toBe(true);
    // Whole folders, their `/` included: what follows starts a name.
    expect(keeps("path:docs/**/a.md", "docs/data.md")).toBe(false);
    expect(keeps("path:docs/**/a.md", "docs/x/data.md")).toBe(false);
    expect(keeps("path:/docs/**/a.md", "x/docs/a.md")).toBe(false);
    expect(keeps("path:/docs/**/*.md", "docs/a.md")).toBe(true);
    expect(keeps("path:/docs/**/*.md", "docs/x/y/a.md")).toBe(true);
    // A leading `**/`: what follows starts the path, or a name in it.
    expect(keeps("path:**/a.md", "a.md")).toBe(true);
    expect(keeps("path:**/a.md", "docs/x/a.md")).toBe(true);
    expect(keeps("path:**/a.md", "data.md")).toBe(false);
    expect(keeps("path:**/a.md", "docs/data.md")).toBe(false);
    expect(keeps("path:/**/a.md", "a.md")).toBe(true);
    expect(keeps("path:/**/a.md", "x/y/a.md")).toBe(true);
    expect(keeps("path:/**/a.md", "x/data.md")).toBe(false);
    // Each of several may stand for none, and three or more `*` are two.
    expect(keeps("path:**/**/a.md", "a.md")).toBe(true);
    expect(keeps("path:docs/**/**/a.md", "docs/a.md")).toBe(true);
    expect(keeps("path:docs/***/a.md", "docs/a.md")).toBe(true);
    expect(keeps("path:***/a.md", "a.md")).toBe(true);
    // At its least it is none, so a trailing `/**/` adds nothing, and
    // `**/` alone keeps every path.
    expect(keeps("path:docs/**/", "docs/a.md")).toBe(true);
    expect(keeps("path:**/", "a.md")).toBe(true);
    // Anywhere else, `**` is still any characters: beside other characters
    // in a name, or with no `/` after it.
    expect(keeps("path:de**/c.md", "docs/design/sub/c.md")).toBe(true);
    expect(keeps("path:de**/c.md", "docs/de/c.md")).toBe(true);
    expect(keeps("path:docs**/a.md", "docs/a.md")).toBe(true);
    expect(keeps("path:docs/**x", "docs/designx/d.md")).toBe(true);
    expect(keeps("path:docs/**", "docs/a.md")).toBe(true);
    expect(keeps("path:docs/**.md", "docs/a.md")).toBe(true);
    // Quoted, it is two characters.
    expect(keeps('path:"docs/**/a.md"', "docs/a.md")).toBe(false);
    expect(keeps('path:"docs/**/a.md"', "docs/**/a.md")).toBe(true);
  });

  // §6.13's rules written apart from the module, as one regular expression
  // per value, held against the module's matcher over every value of up to
  // five characters from `a`, `/` and `*`, and every path of up to five from
  // `a`, `b` and `/`. The module does not match with a regular expression,
  // which backtracks (below).
  it("keeps what §6.13's rules, written as a regular expression, keep", () => {
    const expression = (value: string): RegExp => {
      const pinned = value.startsWith("/");
      const text = pinned ? value.slice(1) : value;
      let source = "";
      let anchored = pinned;
      for (let i = 0; i < text.length;) {
        if (text[i] !== "*") {
          source += text[i] === "/" ? "\\/" : text[i];
          i++;
          continue;
        }
        let end = i;
        while (text[end] === "*") end++;
        const startsName = i === 0 || text[i - 1] === "/";
        if (end - i >= 2 && startsName && text[end] === "/") {
          // `/**/`, or a leading `**/`: zero or more folders, each with its
          // `/`. Leading, the folders it stands for lead the path.
          source += "(?:[\\s\\S]*\\/)?";
          if (i === 0) anchored = true;
          i = end + 1;
        } else {
          source += end - i === 1 ? "[^/]*" : "[\\s\\S]*";
          i = end;
        }
      }
      return new RegExp(`${anchored ? "^" : ""}${source}`);
    };
    const strings = (alphabet: string, longest: number): string[] => {
      const out = [""];
      for (let at = 0; out[at].length < longest; at++) {
        for (const c of alphabet) out.push(out[at] + c);
      }
      return out;
    };
    const paths = strings("ab/", 5);
    let compared = 0;
    for (const value of strings("a/*", 5)) {
      if (value === "") continue;
      const filter = understood(`path:${value}`);
      const pattern = expression(value);
      for (const path of paths) {
        if (filterKeepsDocument(filter, path) !== pattern.test(path)) {
          expect(filterKeepsDocument(filter, path), `${value} on ${path}`).toBe(
            pattern.test(path),
          );
        }
        compared++;
      }
    }
    expect(compared).toBe(363 * 364);
  });

  // A value's wildcards are matched without backtracking, so no short value
  // stalls the page, which tests every path against each text typed, or the
  // checker, on a path that repeats a character the value holds. As a
  // regular expression, each of these took seconds on the one path.
  it("matches a value of many wildcards in time that grows with the path, not its matches", () => {
    const path = `docs/${"a".repeat(30)}.md`;
    const slashes = `${"a/".repeat(30)}x.md`;
    for (const [value, on] of [
      [`${"*a".repeat(12)}*b`, path],
      [`${"**a".repeat(12)}**b`, path],
      [`${"a/**/".repeat(12)}b`, slashes],
      [`${"**/a".repeat(12)}/b`, slashes],
    ]) {
      const filter = understood(`path:${value}`);
      const started = performance.now();
      expect(filterKeepsDocument(filter, on), value).toBe(false);
      expect(performance.now() - started, value).toBeLessThan(250);
    }
  });

  it("matches a quoted value with every character literal, * included, and spaces allowed", () => {
    expect(keeps('path:"*.md"', "docs/a.md")).toBe(false);
    expect(keeps('path:"*.md"', "docs/*.md")).toBe(true);
    expect(keeps('path:"my notes"', "docs/my notes.md")).toBe(true);
    expect(keeps('path:"/my notes.md"', "my notes.md")).toBe(true);
    expect(keeps('path:"/my notes.md"', "y/my notes.md")).toBe(false);
    expect(keeps('path:"./my notes.md"', "my notes.md")).toBe(true);
    expect(keeps('path:"a\\"b"', 'x/a"b.md')).toBe(true);
  });

  it("drops with -path: what path: with the same value would keep", () => {
    const keepsDoc = (text: string, path: string) =>
      filterKeepsDocument(understood(text), path);
    for (const path of [
      "docs/design/a.md",
      "x/docs/design/a.md",
      "roadmap.md",
      "Docs/My Notes.md",
    ]) {
      for (const value of [
        "docs/des",
        "/docs",
        "*.md",
        "/**/a.md",
        '"my notes"',
        "DESIGN",
      ]) {
        expect(keepsDoc(`-path:${value}`, path), `${value} ${path}`).toBe(
          !keepsDoc(`path:${value}`, path),
        );
      }
    }
    expect(keepsDoc("path:docs -path:/docs/design", "docs/a.md")).toBe(true);
    expect(keepsDoc("path:docs -path:/docs/design", "docs/design/a.md")).toBe(
      false,
    );
    expect(keepsDoc("path:docs -path:/docs/design", "x/docs/design/a.md")).toBe(
      true,
    );
  });

  // §6.14 rule 3: wherever a quoted value is written bare, the bare form must
  // keep what the quoted one does, or the canonical text would mean
  // something other than what was typed.
  it("gives a quoted value written bare the answers the quoted form gives", () => {
    const paths = [
      ...LISTED,
      "docs/design/a.md/inner.md",
      "design",
      "docs/design",
      "x/design/y.md",
      "my/docs/design/a.md",
    ];
    let compared = 0;
    for (const entry of FORMS.read) {
      if (!entry.text.includes('"')) continue;
      const bare = understood(entry.text);
      if (!bare.terms.some((term) => term.key === "path")) continue;
      if (bare.terms.some((term) => term.key === "path" && term.quoted)) {
        continue;
      }
      const literal: UnderstoodPlanningFilter = {
        ...bare,
        terms: bare.terms.map((term) =>
          term.key === "path" ? { ...term, quoted: true } : term,
        ),
      };
      for (const path of paths) {
        expect(
          filterKeepsDocument(literal, path),
          `${entry.text} on ${path}`,
        ).toBe(filterKeepsDocument(bare, path));
      }
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(4);
  });

  // §6.13: a trailing `/` is a character of the value like any other, so it
  // keeps only paths under a folder of that name, bare and quoted.
  it("keeps only what is under a folder with a value's trailing /", () => {
    const documents = (text: string) =>
      FORMS.read.find((entry) => entry.text === text)?.documents;
    // With the `/`, what is kept; without it, a file it keeps as well.
    const pairs: [string, string[], string][] = [
      ["path:a.md/", ["y/a.md/inner.md"], "a.md"],
      ["path:docs/design/a.md/", [], "docs/design/a.md"],
      ['path:"my notes.md/"', ["y/my notes.md/inner.md"], "my notes.md"],
      ['path:"docs/my notes.md/"', [], "docs/my notes.md"],
    ];
    for (const [under, kept, file] of pairs) {
      const plain = under.replace(/\/("?)$/, "$1");
      expect(documents(under), under).toEqual(kept);
      expect(documents(plain), plain).toEqual(
        expect.arrayContaining([...kept, file]),
      );
    }
    // And a quoted leading `/` from none: only the root's file.
    expect(documents('path:"/my notes.md"')).toEqual(["my notes.md"]);
    expect(documents('path:"my notes.md"')).toEqual([
      "docs/my notes.md",
      "my notes.md",
      "y/my notes.md/inner.md",
    ]);
  });

  it("compares a quoted value character for character, spaces and brackets included", () => {
    expect(keeps('path:" a.md"', "a.md")).toBe(false);
    expect(keeps('path:" a.md"', "x/ a.md")).toBe(true);
    expect(keeps('path:"[ab].md"', "a.md")).toBe(false);
    expect(keeps('path:"[ab].md"', "x/[ab].md")).toBe(true);
    expect(keeps('path:"docs/[ab]/"', "docs/[ab]")).toBe(false);
    expect(keeps('path:"docs/[ab]/"', "docs/[ab]/x.md")).toBe(true);
    expect(keeps('path:"my dir/"', "a/my dir/x.md")).toBe(true);
    expect(keeps('path:"my dir/"', "a/my dir")).toBe(false);
  });

  // Ruling 1's own examples, over the fixture.
  it("keeps what §6.13 says of the ruling's examples, over the fixture's paths", () => {
    const docs = (text: string) => keptDocuments(understood(text));
    expect(docs("path:docs/des")).toEqual([
      "docs/design/a-plan.md",
      "docs/design/a.md",
      "docs/design/sub/c.md",
      "docs/designx/d.md",
      "x/docs/design/a.md",
    ]);
    expect(docs("path:/roadmap.md")).toEqual(["roadmap.md"]);
    expect(docs("path:*.md")).toEqual(LISTED);
    expect(docs("path:notes")).toEqual([
      "docs/my notes.md",
      "my notes.md",
      "notes/b.md",
      "notes/broken.md",
      "notes/e.md",
      "notes/f.md",
      "y/my notes.md/inner.md",
    ]);
    expect(docs("path:/docs/design/a.md")).toEqual(["docs/design/a.md"]);
  });
});

describe("applying a filter to the sections (§6.11, §6.15)", () => {
  it("keeps the entries' order and drops a section it empties", () => {
    const all = sectionEntryKeys(SECTIONS);
    for (const entry of FORMS.read) {
      // A subsequence of the unfiltered entries, in their order.
      let at = 0;
      for (const key of entry.keeps) {
        at = all.indexOf(key, at);
        expect(at, `${entry.text}: ${key}`).toBeGreaterThanOrEqual(0);
        at++;
      }
    }
    const { sections } = apply("path:notes/b.md is:open");
    expect(sectionEntryKeys(sections)).toEqual([]);
    // Empty, not null: null still means a section that does not exist.
    expect(sections.unrouted).toEqual([]);
    expect(sections.ready).toEqual([]);
  });

  it("leaves a section that does not exist as it is", () => {
    const index = indexOf({
      "docs/a.md": "---\nstatus: draft\n---\n\n# A\n",
    });
    const sections = derivePlanningSections(index);
    const filtered = apply("path:docs", index, sections).sections;
    expect(filtered.unrouted).toBeNull();
    expect(filtered.ready).toBeNull();
    expect(filtered.graduate).toBeNull();
    expect(filtered.disagrees).toBeNull();
  });

  it("changes neither the index nor the sections it is given", () => {
    const index = structuredClone(INDEX);
    const sections = structuredClone(SECTIONS);
    for (const entry of FORMS.read) apply(entry.text, index, sections);
    expect(index).toEqual(INDEX);
    expect(sections).toEqual(SECTIONS);
  });

  // Sections derived from the index always resolve; a hand-built or stale
  // reference has only its path and id to be read by, and no state.
  it("judges a reference the index cannot resolve by its path and id alone", () => {
    const real = SECTIONS.unrouted![0]!;
    const stale = { ...real, id: "OQ-STALE9" };
    const sections: PlanningSections = { ...SECTIONS, unrouted: [stale, real] };
    const kept = (text: string) =>
      apply(text, INDEX, sections).sections.unrouted?.map((ref) => ref.id);
    expect(kept("oq-stale")).toEqual(["OQ-STALE9"]);
    expect(kept(documentFilter(real.path)!)).toEqual(["OQ-STALE9", real.id]);
    expect(kept("is:open")).toEqual([real.id]);
    expect(kept("-is:open")).toEqual(["OQ-STALE9"]);
  });

  it("keeps the roadmaps, their states, the chosen one and stagesDeclared", () => {
    const { sections } = apply("path:notes");
    expect(sections.chosenRoadmap).toBe(SECTIONS.chosenRoadmap);
    expect(sections.stagesDeclared).toBe(SECTIONS.stagesDeclared);
    expect(
      sections.roadmaps.map(({ path, state }) => ({ path, state })),
    ).toEqual(SECTIONS.roadmaps.map(({ path, state }) => ({ path, state })));
  });

  it("counts each roadmap's needsYouCount over kept questions", () => {
    const counts = (sections: PlanningSections) =>
      Object.fromEntries(
        sections.roadmaps.map((r) => [r.path, r.needsYouCount]),
      );
    expect(counts(SECTIONS)).toEqual({ "roadmap.md": 4, "x/roadmap.md": 1 });
    // The 💬 🤷 question is open; the nested ✅ one is not.
    expect(counts(apply("is:open").sections)).toEqual({
      "roadmap.md": 3,
      "x/roadmap.md": 1,
    });
    expect(counts(apply("path:docs/design/sub").sections)).toEqual({
      "roadmap.md": 0,
      "x/roadmap.md": 1,
    });
  });

  it("keeps only kept questions on other roadmaps, and counts them by roadmap", () => {
    expect(SECTIONS.onOtherRoadmaps.map((q) => q.id)).toEqual(["OQ-C1"]);
    expect(apply("path:docs/design/a.md").sections.onOtherRoadmaps).toEqual([]);
    const { sections, summary } = apply("path:docs/design/sub/c.md is:open");
    expect(sections.onOtherRoadmaps.map((q) => q.id)).toEqual(["OQ-C1"]);
    expect(summary.otherRoadmaps).toEqual([{ path: "x/roadmap.md", count: 1 }]);
  });

  it("names other roadmaps in roadmap order", () => {
    const index = indexOf({
      "roadmap.md": "# R\n\n- [A](docs/a.md)\n",
      "b/roadmap.md": "# B\n\n- [B](../docs/b.md)\n",
      "c/roadmap.md": "# C\n\n- [C](../docs/c.md)\n",
      ...Object.fromEntries(
        ["A", "B", "C"].map((id) => [
          `docs/${id.toLowerCase()}.md`,
          `---\nstatus: draft\n---\n\n# ${id}\n\n1. \u{1F4AC} **OQ-${id}1: ${id}?**\n\n   <!-- vantage: question id=OQ-${id}1 leaning="Yes." -->\n\n   _Leaning:_ yes.\n`,
        ]),
      ),
    });
    const sections = derivePlanningSections(index);
    expect(apply("path:docs", index, sections).summary.otherRoadmaps).toEqual([
      { path: "b/roadmap.md", count: 1 },
      { path: "c/roadmap.md", count: 1 },
    ]);
  });

  // §6.15 and §6.12: the notice names each roadmap that holds a kept question,
  // as each roadmap's needsYouCount counts it, though `onOtherRoadmaps` keeps
  // the question once, under the first.
  it("names every other roadmap that routes a kept question, counting the question once", () => {
    const question = (id: string) =>
      `---\nstatus: draft\n---\n\n# ${id}\n\n1. \u{1F4AC} **OQ-${id}1: ${id}?**\n\n   <!-- vantage: question id=OQ-${id}1 leaning="Yes." -->\n\n   _Leaning:_ yes.\n`;
    const index = indexOf({
      "roadmap.md": "# R\n\n- [A](docs/a.md)\n",
      "b/roadmap.md": "# B\n\n- [C](../docs/c.md)\n- [D](../docs/d.md)\n",
      "c/roadmap.md": "# C\n\n- [C](../docs/c.md)\n",
      "docs/a.md": question("A"),
      "docs/c.md": question("C"),
      "docs/d.md": question("D"),
    });
    const sections = derivePlanningSections(index);
    expect(sections.onOtherRoadmaps.map((q) => [q.id, q.roadmap])).toEqual([
      ["OQ-C1", "b/roadmap.md"],
      ["OQ-D1", "b/roadmap.md"],
    ]);

    const one = apply("path:docs/c.md is:open", index, sections);
    expect(one.summary.onOtherRoadmaps).toBe(1);
    expect(one.summary.otherRoadmaps).toEqual([
      { path: "b/roadmap.md", count: 1 },
      { path: "c/roadmap.md", count: 1 },
    ]);
    const counts = Object.fromEntries(
      one.sections.roadmaps.map((r) => [r.path, r.needsYouCount]),
    );
    expect(counts).toEqual({
      "roadmap.md": 0,
      "b/roadmap.md": 1,
      "c/roadmap.md": 1,
    });
    expect(
      PLANNING_NOTICES.filtered(one.summary, "checker").map(noticeText)[1],
    ).toBe(
      "1 more question it keeps is on other roadmaps: `b/roadmap.md` (1), `c/roadmap.md` (1). Rerun with --roadmap naming one.",
    );

    const both = apply("path:docs/c.md path:docs/d.md", index, sections);
    expect(both.summary.onOtherRoadmaps).toBe(2);
    expect(both.summary.otherRoadmaps).toEqual([
      { path: "b/roadmap.md", count: 2 },
      { path: "c/roadmap.md", count: 1 },
    ]);
    // The chosen roadmap is never named, though it routes kept questions.
    const onB = derivePlanningSections(index, { roadmap: "b/roadmap.md" });
    expect(apply("path:docs", index, onB).summary.otherRoadmaps).toEqual([
      { path: "roadmap.md", count: 1 },
    ]);
  });

  it("reads nothingNeedsYou as no open question it keeps in a live document", () => {
    expect(SECTIONS.nothingNeedsYou).toBe(false);
    expect(apply("path:notes/b.md is:open").sections.nothingNeedsYou).toBe(
      true,
    );
    // A done document's open question needs nobody.
    expect(apply("path:ref").sections.nothingNeedsYou).toBe(true);
    expect(apply("path:docs/design/a.md").sections.nothingNeedsYou).toBe(false);
    // A kept question on another roadmap counts, though no section lists it.
    const onX = derivePlanningSections(INDEX, { roadmap: "x/roadmap.md" });
    const { sections } = apply("path:docs/design/a.md is:open", INDEX, onX);
    expect(sections.needsYou).toEqual([]);
    expect(sections.onOtherRoadmaps.map((q) => q.id)).toEqual([
      "OQ-A1",
      "OQ-A3",
      "OQ-A5",
    ]);
    expect(sections.nothingNeedsYou).toBe(false);
  });

  it("keeps a Blocked row by its path with every blocker, and drops it under is:open", () => {
    const row = (sections: PlanningSections) =>
      sections.waiting.find(
        (entry) => entry.kind === "document" && entry.path === "notes/b.md",
      );
    expect(row(apply("path:notes/b.md").sections)).toEqual(row(SECTIONS));
    expect(row(SECTIONS)).toMatchObject({
      waitingOn: [{ target: "docs/design/sub/c.md", fragment: "OQ-C1" }],
    });
    expect(row(apply("path:notes/b.md is:open").sections)).toBeUndefined();
  });

  it("names each target a kept document waits on that it leaves out, fragment included", () => {
    const expected = [
      { path: "notes/b.md", target: "docs/design/sub/c.md#OQ-C1" },
    ];
    expect(apply("path:notes/b.md").summary.waitsOutside).toEqual(expected);
    // Whether or not an `is:` term dropped the row.
    expect(apply("path:notes/b.md is:open").summary.waitsOutside).toEqual(
      expected,
    );
    expect(apply("path:docs/design/a-plan.md").summary.waitsOutside).toEqual([
      { path: "docs/design/a-plan.md", target: "docs/design/a.md" },
    ]);
    // Kept, the target is not outside; and with no `path:` term every
    // document is kept.
    expect(apply("path:docs/design").summary.waitsOutside).toEqual([]);
    expect(
      apply("path:notes path:docs/design/sub").summary.waitsOutside,
    ).toEqual([]);
    expect(apply("is:open").summary.waitsOutside).toEqual([]);
  });

  it("counts the blocked questions of kept documents an is: term leaves out", () => {
    expect(apply("is:open").summary.blockedLeftOut).toBe(2);
    expect(apply("path:docs/design/a.md is:open").summary.blockedLeftOut).toBe(
      1,
    );
    expect(apply("path:docs/design/a.md").summary.blockedLeftOut).toBe(0);
    expect(apply("path:notes/e.md is:open").summary.blockedLeftOut).toBe(0);
    // Only those every other term keeps: OQ-A2 is "Paused on an outside
    // event?", and OQ-B1 "Waits on something?".
    expect(apply("paused is:open").summary.blockedLeftOut).toBe(1);
    expect(apply("outer is:open").summary.blockedLeftOut).toBe(0);
    expect(apply("is:open -paused").summary.blockedLeftOut).toBe(1);
    expect(apply("is:open -path:notes").summary.blockedLeftOut).toBe(1);
    // `-is:open` leaves no 🔒 question out, and neither does a text term.
    expect(apply("-is:open").summary.blockedLeftOut).toBe(0);
    expect(apply("outer").summary.blockedLeftOut).toBe(0);
  });

  it("keeps a row by its path, stage or next, never by an is: term, and whatever -is:open says", () => {
    const keys = (text: string) => sectionEntryKeys(apply(text).sections);
    expect(keys("decided")).toEqual([
      "waiting notes/b.md",
      "ready notes/b.md",
      "disagrees notes/f.md",
    ]);
    expect(keys('"the reference"')).toEqual(["graduate notes/e.md"]);
    expect(keys("notes/e")).toEqual(["graduate notes/e.md"]);
    expect(keys("decided is:open")).toEqual([]);
    expect(keys("decided -is:open")).toEqual(keys("decided"));
    // A text term reads a row's fields, not its document's questions'.
    expect(keys("still")).toEqual(["unrouted notes/f.md#OQ-F1"]);
  });

  it("recounts needsYouCount and nothingNeedsYou over the questions text terms keep", () => {
    const counts = (text: string) =>
      Object.fromEntries(
        apply(text).sections.roadmaps.map((r) => [r.path, r.needsYouCount]),
      );
    expect(counts("oq-c1")).toEqual({ "roadmap.md": 0, "x/roadmap.md": 1 });
    expect(counts("outer")).toEqual({ "roadmap.md": 1, "x/roadmap.md": 0 });
    expect(counts("-outer")).toEqual({ "roadmap.md": 3, "x/roadmap.md": 1 });
    expect(apply("outer").sections.nothingNeedsYou).toBe(false);
    expect(apply("inner").sections.nothingNeedsYou).toBe(true);
    expect(apply("nothing-holds-this").sections.nothingNeedsYou).toBe(true);
  });

  it("names what waits outside the documents -path: leaves", () => {
    expect(apply("-path:docs/design/sub").summary.waitsOutside).toEqual([
      { path: "notes/b.md", target: "docs/design/sub/c.md#OQ-C1" },
    ]);
    // Text and is: terms never change which documents are kept.
    expect(apply("decided is:open").summary.waitsOutside).toEqual([]);
  });

  it("counts entries, kept documents and open questions", () => {
    const all = sectionEntryKeys(SECTIONS).length;
    expect(all).toBe(20);
    expect(apply("path:/docs/design/a.md is:open").summary).toMatchObject({
      canonical: "path:/docs/design/a.md is:open",
      entries: { shown: 3, of: all },
      documents: { kept: 1, of: 19 },
      openQuestions: 3,
    });
    // Not pinned to the start, the same value keeps x/docs/design/a.md too.
    expect(apply("path:docs/design/a.md is:open").summary).toMatchObject({
      entries: { shown: 4, of: all },
      documents: { kept: 2, of: 19 },
      openQuestions: 4,
    });
    // A ✅ question is an entry and not an open question.
    expect(apply("path:/docs/design/a.md").summary).toMatchObject({
      entries: { shown: 5, of: all },
      openQuestions: 3,
    });
    expect(apply("is:open").summary).toMatchObject({
      entries: { shown: 10, of: all },
      documents: { kept: 19, of: 19 },
      openQuestions: 10,
    });
  });

  it("leaves unmatched terms out of the request's text, and has none when every path: term is unmatched", () => {
    expect(apply("path:docs/desing").summary).toMatchObject({
      unmatched: ["path:docs/desing"],
      requestText: null,
    });
    // Dropping them all would leave `is:open`, which keeps every open question.
    expect(apply("path:docs/desing is:open").summary.requestText).toBeNull();
    expect(
      apply("path:docs/desing is:open path:notes/f.md").summary.requestText,
    ).toBe("is:open path:notes/f.md");
    expect(apply("path:notes/e.md is:open").summary.requestText).toBe(
      "path:notes/e.md is:open",
    );
    expect(apply("is:open").summary.requestText).toBe("is:open");
  });

  it("leaves an unmatched -path: term out of the request's text, which may leave none", () => {
    expect(apply("-path:docs/desing").summary).toMatchObject({
      unmatched: ["-path:docs/desing"],
      requestText: "",
    });
    expect(apply("outer -path:docs/desing is:open").summary).toMatchObject({
      unmatched: ["-path:docs/desing"],
      requestText: "outer is:open",
    });
    // A matched -path: term stays, and an unmatched one beside a kept
    // path: term goes.
    expect(
      apply("path:docs/design -path:docs/design/sub -path:docs/desing").summary
        .requestText,
    ).toBe("path:docs/design -path:docs/design/sub");
    // Every path: term unmatched: nothing is kept, whatever -path: says.
    expect(
      apply("path:docs/desing -path:docs/design").summary.requestText,
    ).toBeNull();
    // A text term that matches nothing is no unmatched term.
    expect(apply("nothing-holds-this").summary).toMatchObject({
      unmatched: [],
      requestText: "nothing-holds-this",
      entries: { shown: 0 },
    });
  });
});

describe("the agent request under a filter (§6.15, §6.2)", () => {
  const repository = "/repo";

  it("fences a code span one backtick longer than any run inside, padded where it must be", () => {
    expect(codeSpan("path:docs/x.md")).toBe("`path:docs/x.md`");
    expect(codeSpan("a`b")).toBe("``a`b``");
    expect(codeSpan("a``b`c")).toBe("```a``b`c```");
    expect(codeSpan("`a")).toBe("`` `a ``");
    expect(codeSpan("a`")).toBe("`` a` ``");
    // CommonMark strips one space from each end of a span with both.
    expect(codeSpan(" a ")).toBe("`  a  `");
    expect(codeSpan(" a")).toBe("` a`");
  });

  it("adds a Filter: line after Repository:, and changes nothing else", () => {
    const { sections, summary } = apply("path:*.md");
    const plain = planningAgentRequest(INDEX, SECTIONS, { repository })!;
    const filtered = planningAgentRequest(INDEX, sections, {
      repository,
      filter: { text: summary.requestText!, unfiltered: SECTIONS },
    })!;
    expect(filtered).toBe(
      plain.replace(
        `Repository: ${repository}\n`,
        `Repository: ${repository}\nFilter: \`path:*.md\`. Only the entries it keeps are listed.\n`,
      ),
    );
    expect(filtered).not.toBe(plain);
  });

  it("lists only the entries the filter keeps", () => {
    const { sections, summary } = apply("path:/notes");
    const request = planningAgentRequest(INDEX, sections, {
      repository,
      filter: { text: summary.requestText!, unfiltered: SECTIONS },
    })!;
    expect(request).toContain(
      "Filter: `path:/notes`. Only the entries it keeps are listed.",
    );
    expect(request).toContain("- notes/f.md:");
    expect(request).not.toMatch(/^- docs\//m);
    expect(request).not.toMatch(/^- x\//m);
    // Nothing to ask for: no request.
    const nothing = apply("path:/docs/design/a.md");
    expect(
      planningAgentRequest(INDEX, nothing.sections, {
        repository,
        filter: { text: nothing.summary.requestText!, unfiltered: SECTIONS },
      }),
    ).toBeNull();
  });

  it("fences a filter text holding a backtick", () => {
    const text = 'path:"a`b.md" path:/notes';
    const { sections } = apply(text);
    expect(
      planningAgentRequest(INDEX, sections, {
        repository,
        filter: { text, unfiltered: SECTIONS },
      }),
    ).toContain(
      'Filter: ``path:"a`b.md" path:/notes``. Only the entries it keeps are listed.',
    );
  });

  // `decided` keeps notes/b.md's Ready row by its stage, and drops its 🔒
  // OQ-B1, whose fields do not hold the word, and the Blocked row's own
  // waiting entry with it: the case §6.15 reads the unfiltered sections for.
  it("reads what a row is blocked on from the unfiltered sections", () => {
    const { sections, summary } = apply("decided");
    expect(sectionEntryKeys(sections)).toContain("ready notes/b.md");
    expect(sectionEntryKeys(sections)).not.toContain(
      "waiting notes/b.md#OQ-B1",
    );
    const blocked =
      "- notes/b.md  (stage DECIDED; blocked on docs/design/sub/c.md#OQ-C1, \u{1F512} OQ-B1)";
    const filtered = planningAgentRequest(INDEX, sections, {
      repository,
      ids: ["ready"],
      filter: { text: summary.requestText!, unfiltered: SECTIONS },
    })!;
    expect(filtered).toContain(blocked);
    expect(filtered).toContain("Skip any entry marked blocked");
    // Read from the filtered sections, the annotation would lose OQ-B1.
    const wrong = planningAgentRequest(INDEX, sections, {
      repository,
      ids: ["ready"],
    })!;
    expect(wrong).not.toContain(blocked);
  });

  it("has no Filter: line when every term was an unmatched -path: term", () => {
    const { sections, summary } = apply("-path:docs/desing");
    expect(summary.requestText).toBe("");
    expect(
      planningAgentRequest(INDEX, sections, {
        repository,
        filter: { text: summary.requestText!, unfiltered: SECTIONS },
      }),
    ).toBe(planningAgentRequest(INDEX, SECTIONS, { repository }));
  });
});

describe("the link (§13.5)", () => {
  it("percent-encodes all but A-Z a-z 0-9 - . _ ~ : /, and writes a space as +", () => {
    expect(encodePlanningQueryValue("path:docs/design/*.md is:open")).toBe(
      "path:docs/design/%2A.md+is:open",
    );
    expect(encodePlanningQueryValue("AZaz09-._~:/")).toBe("AZaz09-._~:/");
    expect(encodePlanningQueryValue('#&+"=?%')).toBe("%23%26%2B%22%3D%3F%25");
    expect(encodePlanningQueryValue("!'()*`\\")).toBe("%21%27%28%29%2A%60%5C");
    expect(encodePlanningQueryValue("caf\u00e9 \u{1F4AC}")).toBe(
      "caf%C3%A9+%F0%9F%92%AC",
    );
    expect(encodePlanningQueryValue("a\ud800b")).toBe("a%EF%BF%BDb");
    const every = Array.from({ length: 0x80 }, (_, i) =>
      String.fromCharCode(i),
    ).join("");
    expect(
      new URLSearchParams(`x=${encodePlanningQueryValue(every)}`).get("x"),
    ).toBe(every);
  });

  it("is root-relative, with the roadmap after the filter when given", () => {
    expect(planningLink("path:plans/design.md is:open")).toBe(
      "/.vantage/planning?filter=path:plans/design.md+is:open",
    );
    expect(planningLink("path:docs/design/planning-filter.md is:open")).toBe(
      "/.vantage/planning?filter=path:docs/design/planning-filter.md+is:open",
    );
    expect(planningLink("is:open", { roadmap: "docs/my roadmap.md" })).toBe(
      "/.vantage/planning?filter=is:open&roadmap=docs/my+roadmap.md",
    );
    expect(planningLink("is:open", { roadmap: null })).toBe(
      "/.vantage/planning?filter=is:open",
    );
    expect(
      planningLink("is:open", { path: "/.vantage/planning/my%20repo" }),
    ).toBe("/.vantage/planning/my%20repo?filter=is:open");
    expect(PLANNING_FILTER_PARAM).toBe("filter");
    expect(PLANNING_ROADMAP_PARAM).toBe("roadmap");
  });

  it("never ends with a character a pasted link's end drops (§6.17)", () => {
    // `.`, `_`, `~` and `:` are written bare, and the paste reader drops them
    // from a link's end as a sentence's punctuation, so the last one is
    // escaped instead, which `URLSearchParams` reads back the same.
    for (const canonical of [
      "path:docs/x_",
      "path:docs/v1.",
      "path:d/_",
      "is:open path:a_",
      "path:docs/v1._",
    ]) {
      expect(understood(canonical).canonical).toBe(canonical);
      for (const options of [{}, { path: planningPath(true, "repo.") }]) {
        const link = planningLink(canonical, options);
        expect(link).toMatch(/%(2E|5F)$/);
        expect(queryOf(link).get(PLANNING_FILTER_PARAM)).toBe(canonical);
        for (const pasted of [
          link,
          `${link}.`,
          `Planning page: ${link}\n  Press / on the planning page`,
          `(${link})`,
        ]) {
          expect(readPastedPlanningLink(pasted), pasted).toEqual({
            filter: canonical,
            roadmap: null,
          });
        }
      }
      // A roadmap after it ends the link instead, and the filter is bare.
      expect(planningLink(canonical, { roadmap: "roadmap.md" })).toBe(
        `/.vantage/planning?filter=${canonical.replace(" ", "+")}&roadmap=roadmap.md`,
      );
    }
    expect(planningLink("path:a.md")).toBe(
      "/.vantage/planning?filter=path:a.md",
    );
  });

  it("names one document as path:/<path>, in canonical text", () => {
    expect(documentFilter("roadmap.md")).toBe("path:/roadmap.md");
    expect(documentFilter("plans/design.md")).toBe("path:/plans/design.md");
    expect(documentFilter("docs/my notes.md")).toBe('path:"/docs/my notes.md"');
    expect(documentFilter("my notes.md")).toBe('path:"/my notes.md"');
    expect(documentFilter("docs/*.md")).toBe('path:"/docs/*.md"');
    expect(documentFilter('docs/a"b\\.md')).toBe('path:"/docs/a\\"b\\\\.md"');
    expect(documentFilter("docs/c++.md")).toBe("path:/docs/c++.md");
    expect(documentFilter("docs/caf\u00e9.md")).toBe("path:/docs/caf\u00e9.md");
    expect(documentFilter("docs/a\u0007.md")).toBeNull();
    // Each keeps its document and nothing else the index lists: no path of
    // the fixture starts with another's whole text.
    for (const path of LISTED) {
      const filter = understood(documentFilter(path)!);
      expect(keptDocuments(filter), path).toEqual([path]);
    }
    // Pinned to the start, it keeps every path that starts with its text.
    const filter = understood(documentFilter("docs/x.md")!);
    expect(filterKeepsDocument(filter, "docs/x.md")).toBe(true);
    expect(filterKeepsDocument(filter, "docs/x.mdx")).toBe(true);
    expect(filterKeepsDocument(filter, "y/docs/x.md")).toBe(false);
  });
});

describe("a pasted link (§6.17)", () => {
  const link = "/.vantage/planning?filter=path:plans/design.md+is:open";
  const read = { filter: "path:plans/design.md is:open", roadmap: null };

  it("reads a bare link, and a whole one from any origin", () => {
    expect(readPastedPlanningLink(link)).toEqual(read);
    expect(readPastedPlanningLink(`https://example.com:9000${link}`)).toEqual(
      read,
    );
    expect(readPastedPlanningLink(`http://localhost:8000${link}`)).toEqual(
      read,
    );
    // `new URL` would take `localhost:` for a scheme.
    expect(readPastedPlanningLink(`localhost:8000${link}`)).toEqual(read);
  });

  it("ignores the repository segment, page parameters and the fragment", () => {
    expect(
      readPastedPlanningLink(
        "http://h/.vantage/planning/my%20repo?needs-you=2&filter=is:open&unrouted=3#pq-x",
      ),
    ).toEqual({ filter: "is:open", roadmap: null });
  });

  it("reads the checker's whole block", () => {
    const block = [
      "Filtered by `path:plans/design.md is:open`: 2 of 9 entries, in 1 of 12 paths, 2 of them open questions.",
      "Run without --filter to see the other 7.",
      `Planning page: ${link}`,
      "  Press / on the planning page and paste this line, or put the scheme, host and port you open Vantage at in front of the link.",
      "",
    ].join("\n");
    expect(readPastedPlanningLink(block)).toEqual(read);
  });

  it("leaves out what a chat wraps the link in, and a sentence's punctuation after it", () => {
    for (const pasted of [
      `\`${link}\``,
      `(${link})`,
      `<http://localhost:8000${link}>`,
      `"${link}"`,
      `Open ${link}.`,
      `${link}, then answer.`,
      `\`Planning page: ${link}\``,
    ]) {
      expect(readPastedPlanningLink(pasted), pasted).toEqual(read);
    }
    // What the link writes bare is kept: `.` inside it, an escape, a `+`.
    expect(
      readPastedPlanningLink(
        "/.vantage/planning?filter=path:a.md+path:%22b+c%22.",
      ),
    ).toEqual({ filter: 'path:a.md path:"b c"', roadmap: null });
  });

  it("reads the roadmap it names, every filter value, and no filter as none", () => {
    expect(
      readPastedPlanningLink(
        "/.vantage/planning?filter=is:open&roadmap=docs%2Fplans%2Froadmap.md",
      ),
    ).toEqual({ filter: "is:open", roadmap: "docs/plans/roadmap.md" });
    expect(
      readPastedPlanningLink(
        "/.vantage/planning?filter=path:a&filter=is:open&roadmap=",
      ),
    ).toEqual({ filter: "path:a is:open", roadmap: null });
    expect(readPastedPlanningLink("/.vantage/planning")).toEqual({
      filter: "",
      roadmap: null,
    });
    expect(readPastedPlanningLink("/.vantage/planning/alpha#x")).toEqual({
      filter: "",
      roadmap: null,
    });
  });

  it("takes the first link", () => {
    expect(
      readPastedPlanningLink(
        "see /.vantage/planning?filter=path:a /.vantage/planning?filter=path:b",
      ),
    ).toEqual({ filter: "path:a", roadmap: null });
  });

  it("reads the page's own form encoding, which writes `*` bare (§13.5)", () => {
    // As a flip wrote the address before the page wrote one encoding, and
    // as a reader may still type it: `URLSearchParams` leaves `*` bare.
    for (const entry of FORMS.read) {
      const form = new URLSearchParams([
        [PLANNING_FILTER_PARAM, entry.canonical],
      ]).toString();
      for (const pasted of [
        `http://localhost:8000${PLANNING_PAGE_PATH}?${form}&needs-you=2`,
        `${PLANNING_PAGE_PATH}?needs-you=2&${form}#pq-docs%2Fx.md--OQ-1`,
        `Open ${PLANNING_PAGE_PATH}?${form}&roadmap=roadmap.md.`,
      ]) {
        expect(readPastedPlanningLink(pasted), pasted).toEqual({
          filter: entry.canonical,
          roadmap: pasted.includes("roadmap=") ? "roadmap.md" : null,
        });
      }
    }
    expect(
      readPastedPlanningLink(
        "/.vantage/planning?filter=path%3Adocs%2Fdesign%2F*.md+is%3Aopen",
      ),
    ).toEqual({ filter: "path:docs/design/*.md is:open", roadmap: null });
    expect(
      readPastedPlanningLink("/.vantage/planning?filter=path:docs/color-*"),
    ).toEqual({ filter: "path:docs/color-*", roadmap: null });
  });

  it("leaves out the `*` of emphasis a link is wrapped in", () => {
    for (const pasted of [
      `*${link}*`,
      `**${link}**.`,
      `See *http://localhost:8000${link}*, then answer.`,
    ]) {
      expect(readPastedPlanningLink(pasted), pasted).toEqual(read);
    }
    expect(
      readPastedPlanningLink("*/.vantage/planning?filter=path:docs/a-**"),
    ).toEqual({ filter: "path:docs/a-*", roadmap: null });
  });

  it("ignores a repository segment as the page and the server write it", () => {
    const filter = "path:plans/x.md";
    const segments = [
      // `planningPath`, which leaves `! ' ( ) *` bare.
      ...[
        "notes (old)",
        "matt's-repo",
        "a!b",
        "x*y",
        "a#b?c",
        "my repo",
        "café",
      ].map((repo) => planningPath(true, repo)),
      // Go's `url.PathEscape`, the startup tip's, which leaves `$ & + : = @`
      // bare.
      "/.vantage/planning/a$b%2Cc%3Bd=e@f:g+h&i",
    ];
    for (const path of segments) {
      const link = planningLink(filter, { path });
      for (const pasted of [
        `http://localhost:8000${link}`,
        `(${link})`,
        `${link}.`,
      ]) {
        expect(readPastedPlanningLink(pasted), pasted).toEqual({
          filter,
          roadmap: null,
        });
      }
    }
  });

  it("finds none where no run holds the page's path", () => {
    expect(readPastedPlanningLink("path:plans/design.md is:open")).toBeNull();
    expect(readPastedPlanningLink("/.vantage/planningx?filter=a")).toBeNull();
    expect(readPastedPlanningLink("/vantage/planning?filter=a")).toBeNull();
    expect(readPastedPlanningLink("")).toBeNull();
  });
});

describe("the filter notice (§6.18)", () => {
  const checker = (summary: PlanningFilterSummary) =>
    PLANNING_NOTICES.filtered(summary, "checker").map(noticeText);
  const page = (summary: PlanningFilterSummary) =>
    PLANNING_NOTICES.filtered(summary, "page").map(noticeText);

  it("opens with the canonical text as code, then the counts", () => {
    const { summary } = apply("path:./docs/design/a.md is:open");
    const [first] = PLANNING_NOTICES.filtered(summary, "page");
    expect(first).toEqual([
      "Filtered by ",
      { code: "path:/docs/design/a.md is:open" },
      ": 3 of 20 entries, in 1 of 19 paths, 3 of them open questions.",
    ]);
    expect(checker(summary)).toEqual([
      "Filtered by `path:/docs/design/a.md is:open`: 3 of 20 entries, in 1 of 19 paths, 3 of them open questions.",
      "1 of its questions is blocked and will need you later.",
      "Run without --filter to see the other 17.",
    ]);
    expect(page(summary).at(-1)).toBe("Clear the filter to see the other 17.");
  });

  it("names each unmatched term on a line of its own", () => {
    expect(
      checker(apply("path:docs/desing path:notes/e.md path:x/y").summary),
    ).toEqual([
      "Filtered by `path:docs/desing path:notes/e.md path:x/y`: 1 of 20 entries, in 1 of 19 paths, none of them open questions.",
      "`path:docs/desing` matches no path the index lists.",
      "`path:x/y` matches no path the index lists.",
      "Run without --filter to see the other 19.",
    ]);
  });

  it("names the other roadmaps holding kept questions, in each reader's words", () => {
    const { summary } = apply("path:docs/design/sub/c.md is:open");
    expect(checker(summary)).toEqual([
      "Filtered by `path:docs/design/sub/c.md is:open`: 1 of 20 entries, in 1 of 19 paths, 1 of them an open question.",
      "1 more question it keeps is on another roadmap: `x/roadmap.md` (1). Rerun with --roadmap naming it.",
      "Run without --filter to see the other 19.",
    ]);
    expect(page(summary)[1]).toBe(
      "1 more question it keeps is on another roadmap: `x/roadmap.md` (1). Choose that roadmap to see it; the filter stays.",
    );
    const two: PlanningFilterSummary = {
      ...summary,
      onOtherRoadmaps: 2,
      otherRoadmaps: [
        { path: "docs/a/roadmap.md", count: 1 },
        { path: "docs/b/roadmap.md", count: 1 },
      ],
    };
    expect(checker(two)[1]).toBe(
      "2 more questions it keeps are on other roadmaps: `docs/a/roadmap.md` (1), `docs/b/roadmap.md` (1). Rerun with --roadmap naming one.",
    );
    expect(page(two)[1]).toBe(
      "2 more questions it keeps are on other roadmaps: `docs/a/roadmap.md` (1), `docs/b/roadmap.md` (1). Choose one to see them; the filter stays.",
    );
    // One question both roadmaps route: counted once, and under each.
    const shared: PlanningFilterSummary = { ...two, onOtherRoadmaps: 1 };
    expect(checker(shared)[1]).toBe(
      "1 more question it keeps is on other roadmaps: `docs/a/roadmap.md` (1), `docs/b/roadmap.md` (1). Rerun with --roadmap naming one.",
    );
    expect(page(shared)[1]).toBe(
      "1 more question it keeps is on other roadmaps: `docs/a/roadmap.md` (1), `docs/b/roadmap.md` (1). Choose one to see it; the filter stays.",
    );
  });

  it("says what waits on a document the filter leaves out, and when nothing is kept", () => {
    const { summary, sections } = apply("path:notes/b.md is:open");
    expect(sections.nothingNeedsYou).toBe(true);
    expect(checker(summary)).toEqual([
      "Filtered by `path:notes/b.md is:open`: 0 of 20 entries, in 1 of 19 paths, none of them open questions.",
      "1 of its questions is blocked and will need you later.",
      "notes/b.md waits on docs/design/sub/c.md#OQ-C1, which this filter leaves out.",
      "Run without --filter to see the other 20.",
    ]);
    expect(PLANNING_NOTICES.nothingFilteredNeedsYou).toBe(
      "Nothing this filter keeps needs you.",
    );
  });

  it("puts the clauses in §6.18's order, one line per waiting document", () => {
    const summary: PlanningFilterSummary = {
      canonical: "path:a is:open",
      requestText: "path:a is:open",
      entries: { shown: 1234, of: 5678 },
      documents: { kept: 1, of: 2 },
      openQuestions: 1234,
      blockedLeftOut: 3,
      onOtherRoadmaps: 2,
      otherRoadmaps: [{ path: "b/roadmap.md", count: 2 }],
      waitsOutside: [
        { path: "a/x.md", target: "c.md" },
        { path: "a/x.md", target: "d.md#OQ-D1" },
        { path: "a/y.md", target: "c.md" },
        { path: "a/z.md", target: "c.md" },
        { path: "a/z.md", target: "d.md" },
        { path: "a/z.md", target: "e.md" },
      ],
      unmatched: ["path:z"],
      unknownKeys: [{ key: "stage", terms: ["stage:x"] }],
    };
    expect(checker(summary)).toEqual([
      "Filtered by `path:a is:open`: 1,234 of 5,678 entries, in 1 of 2 paths, 1,234 of them open questions.",
      "`path:z` matches no path the index lists.",
      "`stage:` is not a filter key, so `stage:x` is searched as text. The keys are `path:` and `is:`.",
      "2 more questions it keeps are on another roadmap: `b/roadmap.md` (2). Rerun with --roadmap naming it.",
      "3 of its questions are blocked and will need you later.",
      "a/x.md waits on c.md and d.md#OQ-D1, which this filter leaves out.",
      "a/y.md waits on c.md, which this filter leaves out.",
      "a/z.md waits on c.md, d.md, and e.md, which this filter leaves out.",
      "Run without --filter to see the other 4,444.",
    ]);
    expect(page(summary)[3]).toBe(
      "2 more questions it keeps are on another roadmap: `b/roadmap.md` (2). Choose that roadmap to see them; the filter stays.",
    );
  });

  it("says each unknown key is not a filter key, naming the terms it opens", () => {
    const { summary } = apply(
      "stage:decided -title:x path:docs/desing stage:built Path:x http://y",
    );
    expect(summary.unknownKeys).toEqual([
      { key: "stage", terms: ["stage:decided", "stage:built"] },
      { key: "title", terms: ["-title:x"] },
    ]);
    expect(checker(summary).slice(1, 4)).toEqual([
      "`path:docs/desing` matches no path the index lists.",
      "`stage:` is not a filter key, so `stage:decided` and `stage:built` are searched as text. The keys are `path:` and `is:`.",
      "`title:` is not a filter key, so `-title:x` is searched as text. The keys are `path:` and `is:`.",
    ]);
    const [, , line] = PLANNING_NOTICES.filtered(summary, "page");
    expect(line).toEqual([
      { code: "stage:" },
      " is not a filter key, so ",
      { code: "stage:decided" },
      " and ",
      { code: "stage:built" },
      " are searched as text.",
      " The keys are ",
      { code: "path:" },
      " and ",
      { code: "is:" },
      ".",
    ]);
    expect(checker(apply("a:1 a:2 a:3").summary)[1]).toBe(
      "`a:` is not a filter key, so `a:1`, `a:2` and `a:3` are searched as text. The keys are `path:` and `is:`.",
    );
    // A text term that matches nothing is counted, and named nowhere; with
    // no path term leaving a path out, the notice counts no paths, which
    // would read as every one kept.
    expect(checker(apply("nothing-holds-this").summary)).toEqual([
      "Filtered by `nothing-holds-this`: 0 of 20 entries, none of them open questions.",
      "Run without --filter to see the other 20.",
    ]);
    expect(apply("nothing-holds-this").summary.documents).toEqual({
      kept: 19,
      of: 19,
    });
  });

  it("says when it hides nothing", () => {
    expect(checker(apply("path:*.md").summary).at(-1)).toBe(
      "It hides no entry.",
    );
    expect(page(apply("path:*.md").summary).at(-1)).toBe("It hides no entry.");
  });

  it("fences a canonical text holding a backtick", () => {
    expect(checker(apply("path:a`b.md").summary)[0]).toMatch(
      /^Filtered by ``path:a`b\.md``: /,
    );
  });

  const notUnderstood = (text: string) => {
    const parsed: PlanningFilter = parsePlanningFilter(text);
    if (parsed.kind !== "not-understood") throw new Error(text);
    return parsed;
  };

  it("says a filter it cannot read is not applied, naming its term or reason", () => {
    expect(
      PLANNING_NOTICES.notFiltered(
        notUnderstood("path:docs/design/*.md is:closed"),
      ),
    ).toEqual([
      "Not filtered: this Vantage cannot read ",
      { code: "is:closed" },
      '. It reads words, "quoted phrases", path: and is:open terms, and a - before any of them to leave out what it matches, such as ',
      { code: "generator path:docs/design/*.md is:open" },
      ". Every entry is shown.",
    ]);
    expect(
      noticeText(PLANNING_NOTICES.notFiltered(notUnderstood('path:"a b'))),
    ).toBe(
      'Not filtered: this Vantage cannot read an unclosed quote. It reads words, "quoted phrases", path: and is:open terms, and a - before any of them to leave out what it matches, such as `generator path:docs/design/*.md is:open`. Every entry is shown.',
    );
    // Its example is a filter the language reads, with a term of each kind
    // it names but the -.
    const example = understood("generator path:docs/design/*.md is:open");
    expect(example.terms.map((term) => term.key)).toEqual([
      "text",
      "path",
      "is",
    ]);
  });

  // §13.4: the checker exits 2 on an unmatched term, in the notice's words
  // for it, so the page and the checker cannot word it two ways (§6.18).
  it("words exit 2 for an unmatched term as the notice's line for it", () => {
    expect(PLANNING_NOTICES.filterUnmatched("path:docs/desing")).toBe(
      "`path:docs/desing` matches no path the index lists",
    );
    // A term holding a backtick still reads as one code span.
    expect(PLANNING_NOTICES.filterUnmatched('path:"a`b"')).toBe(
      '``path:"a`b"`` matches no path the index lists',
    );
    const { summary } = apply("path:docs/desing path:notes/e.md path:x/y");
    expect(summary.unmatched).toEqual(["path:docs/desing", "path:x/y"]);
    const lines = checker(summary);
    for (const term of summary.unmatched) {
      expect(lines).toContain(`${PLANNING_NOTICES.filterUnmatched(term)}.`);
    }
  });

  it("gives the checker's exit 2 a message of its own, unprefixed", () => {
    expect(
      PLANNING_NOTICES.filterNotUnderstood(notUnderstood('Path:"docs/x.md"')),
    ).toBe(
      'this checker cannot read `Path:"docs/x.md"`; it reads words, "quoted phrases", path: and is:open terms, and a - before any of them to leave out what it matches',
    );
    const reasons = {
      "unclosed-quote": "an unclosed quote",
      "too-many-terms": "a filter past 64 terms",
      "too-long": "a filter past 2,048 code points",
    } as const;
    for (const [reason, words] of Object.entries(reasons)) {
      const filter = {
        kind: "not-understood" as const,
        text: "x",
        term: null,
        reason: reason as keyof typeof reasons,
      };
      expect(PLANNING_NOTICES.filterNotUnderstood(filter)).toBe(
        `this checker cannot read ${words}; it reads words, "quoted phrases", path: and is:open terms, and a - before any of them to leave out what it matches`,
      );
      expect(noticeText(PLANNING_NOTICES.notFiltered(filter))).toContain(
        `cannot read ${words}. It reads`,
      );
    }
  });
});
