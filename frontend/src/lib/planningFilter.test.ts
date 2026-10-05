/**
 * The planning filter (`docs/design/planning-filter.md`): its grammar, its
 * canonical text, what it keeps, what it does to the sections, its notices,
 * the request's `Filter:` line, and the link the checker prints and the page
 * reads back.
 *
 * Most of it is held to the fixture of forms,
 * `packages/vantage-md/src/planning/filterForms.json`, which the checker's
 * suite reads too. Its `documents` came from git, not from this code: for
 * each `path:` term, the scratch repository of the fixture's paths was asked
 *
 *   git -c core.excludesFile=/dev/null check-ignore --no-index -z --stdin
 *
 * with the term as the one line of `.git/info/exclude`: written with a
 * leading `/` when it anchors, as the filter gives it to the port, and with
 * every glob character escaped when it is a quoted literal. Nothing here runs
 * git for that. The one test that does reads the fixture at the previous
 * release's tag, and skips where the tag or the file is absent.
 */
import { execFileSync } from "node:child_process";
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
  filterKeepsQuestion,
  noticeText,
  parsePlanningFilter,
  planningAgentRequest,
  planningLink,
  readPastedPlanningLink,
  type PlanningFilter,
  type PlanningFilterSummary,
  type PlanningIndex,
  type PlanningSections,
  type UnderstoodPlanningFilter,
} from "vantage-md/planning";
import { pickPreviousRelease } from "../compat/previousRelease";
import {
  FILTER_FORMS_PATH,
  filterForms,
  filterFormsIndex,
  indexOf,
  repoPath,
  sectionEntryKeys,
  type PlanningFilterForms,
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

/** The documents `filter` keeps: what its `path:` terms keep, alone. */
function keptDocuments(filter: UnderstoodPlanningFilter): string[] {
  const paths: UnderstoodPlanningFilter = {
    ...filter,
    terms: filter.terms.filter((term) => term.key === "path"),
  };
  return LISTED.filter((path) =>
    filterKeepsQuestion(paths, { path, state: "open" }),
  );
}

/** What `URLSearchParams` reads back from a link's query. */
const queryOf = (link: string) =>
  new URLSearchParams(link.slice(link.indexOf("?") + 1));

describe("the fixture of forms (§10.4)", () => {
  it("holds the cases the design lists", () => {
    const paths = Object.keys(FORMS.index.files);
    expect(paths).toEqual(
      expect.arrayContaining(["roadmap.md", "x/roadmap.md"]),
    );
    expect(paths).toContain("docs/my notes.md");
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
    });

    it("keeping the documents git keeps, and the entries they hold", () => {
      expect(keptDocuments(filter)).toEqual(entry.documents);
      const { sections, summary } = applyPlanningFilter(
        INDEX,
        SECTIONS,
        filter,
      );
      expect(sectionEntryKeys(sections)).toEqual(entry.keeps);
      expect(summary.unmatched).toEqual(entry.unmatched);
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
      // value short, and `:` and `/` as they are, to be read.
      expect(link).not.toMatch(/[*#&"` ]/);
      expect(link).not.toMatch(/%3A|%2F/i);
    });
  });

  // The keeps are only as right as the rule they were drawn with: an entry is
  // kept when its path is a kept document and, under an `is:` term, it is an
  // open question (§5.3).
  it("keeps exactly the entries of kept documents an is: term allows", () => {
    const all = sectionEntryKeys(SECTIONS);
    for (const entry of FORMS.read) {
      const filter = understood(entry.text);
      const hasIs = filter.terms.some((term) => term.key === "is");
      const allowed = all.filter((key) => {
        const target = key.slice(key.indexOf(" ") + 1);
        const path = target.includes("#")
          ? target.slice(0, target.lastIndexOf("#"))
          : target;
        if (!entry.documents.includes(path)) return false;
        if (!hasIs) return true;
        if (!target.includes("#")) return false;
        const id = target.slice(target.lastIndexOf("#") + 1);
        const q = INDEX.documents
          .flatMap((doc) => doc.questions)
          .find((question) => question.path === path && question.id === id);
        return q?.state === "open";
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

/**
 * The fixture of forms at the previous release's tag, or why there is none
 * to compare with: no git, no release tag, or no fixture at it.
 */
function previousForms():
  | { kind: "found"; tag: string; forms: PlanningFilterForms }
  | { kind: "absent"; reason: string } {
  const root = repoPath("");
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  let tags: string[];
  try {
    tags = git("tag", "--list", "v[0-9]*").split("\n").filter(Boolean);
  } catch {
    return { kind: "absent", reason: "git cannot list this checkout's tags" };
  }
  const previous = pickPreviousRelease({
    tags,
    changelog: "",
    published: tags.map((tag) => tag.replace(/^v/, "")),
  });
  if (previous.kind === "none") {
    return { kind: "absent", reason: previous.reason };
  }
  const tag = `v${previous.version}`;
  try {
    const text = git("show", `${tag}:${FILTER_FORMS_PATH}`);
    return { kind: "found", tag, forms: JSON.parse(text) };
  } catch {
    return { kind: "absent", reason: `${tag} has no ${FILTER_FORMS_PATH}` };
  }
}

describe("the fixture of forms against the previous release", () => {
  const previous = previousForms();
  if (previous.kind === "absent") {
    it.skip(`skipped, because ${previous.reason}`, () => {});
    return;
  }
  it(`edits and removes no read entry of ${previous.tag}`, () => {
    for (const entry of previous.forms.read) {
      expect(
        FORMS.read.find((now) => now.text === entry.text),
        entry.text,
      ).toEqual(entry);
    }
  });
  it(`removes no not-understood entry of ${previous.tag}, except by reading it`, () => {
    const now = new Set(
      [...FORMS.read, ...FORMS.notUnderstood].map((entry) => entry.text),
    );
    for (const entry of previous.forms.notUnderstood) {
      expect(now.has(entry.text), entry.text).toBe(true);
    }
  });
});

describe("the grammar (§5.2, §5.5)", () => {
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
    for (const cp of others) {
      const text = `path:a.md${String.fromCodePoint(cp)}is:open`;
      expect(parsePlanningFilter(text), cp.toString(16)).toEqual({
        kind: "not-understood",
        text,
        term: text,
        reason: null,
      });
    }
  });

  it("names the first term it cannot read, as written", () => {
    expect(parsePlanningFilter('path:docs "a b" OR')).toMatchObject({
      term: '"a b"',
    });
    expect(parsePlanningFilter("is:open path:x Path:y -z")).toMatchObject({
      term: "Path:y",
    });
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
      { key: "is", text: "is:open", value: "open" },
    ]);
    // `is:"open"` is left free (the sketch's risk 1): a later release may
    // move a form to `read`, and never back.
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

  it("stops at its limits, configured down, before it reads a term", () => {
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
    // Before any term is read, so it is the reason a bad term gives too.
    expect(parsePlanningFilter("OR AND NOT", terms)).toMatchObject({
      reason: "too-many-terms",
    });

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
    expect(parsePlanningFilter("OR is:open", length)).toMatchObject({
      reason: "too-long",
    });
    // White space counts, but white space alone is still no filter.
    expect(parsePlanningFilter("   is:open", length)).toMatchObject({
      reason: "too-long",
    });
    expect(parsePlanningFilter(" ".repeat(9), length)).toEqual({
      kind: "none",
    });
    expect(PLANNING_FILTER_LIMITS).toEqual({ terms: 64, codePoints: 2048 });
  });

  it("refuses each end of each excluded range inside quotes, and what lies just outside none", () => {
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
    const quoted = (cp: number) => `path:"a${String.fromCodePoint(cp)}b.md"`;
    for (const [lo, hi] of ranges) {
      for (const cp of [lo, hi]) {
        expect(parsePlanningFilter(quoted(cp)).kind, cp.toString(16)).toBe(
          "not-understood",
        );
      }
      for (const cp of [lo - 1, hi + 1]) {
        if (cp < 0 || ranges.some(([a, b]) => cp >= a && cp <= b)) continue;
        expect(parsePlanningFilter(quoted(cp)).kind, cp.toString(16)).toBe(
          "understood",
        );
      }
    }
  });

  it("refuses a lone surrogate (the sketch's risk 2)", () => {
    for (const unit of ["\ud800", "\udbff", "\udc00", "\udfff"]) {
      expect(parsePlanningFilter(`path:"a${unit}b"`).kind).toBe(
        "not-understood",
      );
    }
    // A pair is one code point, and a path may hold it.
    expect(understood('path:"a\u{1F4AC}b"').canonical).toBe(
      'path:"a\u{1F4AC}b"',
    );
  });

  it("is case-sensitive, and does not normalize", () => {
    expect(apply("path:Docs/design").summary.unmatched).toEqual([
      "path:Docs/design",
    ]);
    const nfd = 'path:"docs/cafe\u0301.md"';
    expect(apply(nfd).summary.unmatched).toEqual([nfd]);
    expect(apply('path:"docs/caf\u00e9.md"').summary.unmatched).toEqual([]);
  });
});

describe("canonical text (§5.6)", () => {
  it("1: joins the terms with one space, in order, and drops a repeat", () => {
    expect(
      understood(" is:open\n\npath:b  path:a is:open path:b ").canonical,
    ).toBe("is:open path:b path:a");
  });

  it("2: reads one leading ./ as /, and drops a / that does not anchor", () => {
    expect(understood("path:./docs/x.md").canonical).toBe("path:docs/x.md");
    expect(understood("path:/docs/x.md").canonical).toBe("path:docs/x.md");
    expect(understood("path:./roadmap.md").canonical).toBe("path:/roadmap.md");
    expect(understood("path:/docs/").canonical).toBe("path:/docs/");
    expect(understood("path:./docs/").canonical).toBe("path:/docs/");
    expect(understood('path:"./my notes.md"').canonical).toBe(
      'path:"/my notes.md"',
    );
    expect(understood('path:"/docs/my notes.md"').canonical).toBe(
      'path:"docs/my notes.md"',
    );
  });

  it("3: writes a quoted value bare where it can", () => {
    expect(understood('path:"docs/x.md"').canonical).toBe("path:docs/x.md");
    // Not with a `*`, which bare would be a wildcard, nor with any other
    // character a bare pattern may not hold.
    expect(understood('path:"docs/*.md"').canonical).toBe('path:"docs/*.md"');
    expect(understood('path:"docs/c++.md"').canonical).toBe(
      'path:"docs/c++.md"',
    );
  });

  it('4: escapes only " and \\ inside quotes', () => {
    expect(understood('path:"a\\\\b \\"c\\" #?.md"').canonical).toBe(
      'path:"a\\\\b \\"c\\" #?.md"',
    );
    expect(understood('path:"a\\\\b \\"c\\" #?.md"').terms).toEqual([
      {
        key: "path",
        text: 'path:"a\\\\b \\"c\\" #?.md"',
        value: 'a\\b "c" #?.md',
        quoted: true,
      },
    ]);
  });

  it("5: no terms is no filter", () => {
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

describe("matching (§5.3, §5.4)", () => {
  const keeps = (text: string, path: string, state = "open" as const) =>
    filterKeepsQuestion(understood(text), { path, state });

  it("ORs terms of one key and ANDs different keys", () => {
    const filter = understood("path:docs/a.md path:docs/b.md is:open");
    const at = (path: string, state: "open" | "blocked" | "answered") =>
      filterKeepsQuestion(filter, { path, state });
    expect(at("docs/a.md", "open")).toBe(true);
    expect(at("docs/b.md", "open")).toBe(true);
    expect(at("docs/c.md", "open")).toBe(false);
    expect(at("docs/a.md", "blocked")).toBe(false);
    expect(at("docs/a.md", "answered")).toBe(false);
    expect(keeps("is:open", "anything/at/all.md")).toBe(true);
  });

  it("anchors a pattern with an inner slash, as git does and the port does not", () => {
    expect(keeps("path:docs/design/a.md", "x/docs/design/a.md")).toBe(false);
    expect(keeps("path:a.md", "x/docs/design/a.md")).toBe(true);
    expect(keeps("path:docs/", "x/docs/a.md")).toBe(true);
    expect(keeps("path:/docs/", "x/docs/a.md")).toBe(false);
  });

  // §5.4: wherever rule 3 writes a quoted value bare, the literal comparator
  // and the port must agree, or the canonical text would mean something
  // other than what was typed.
  it("gives a quoted value written bare the answers the literal comparator gives", () => {
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
          filterKeepsQuestion(literal, { path, state: "open" }),
          `${entry.text} on ${path}`,
        ).toBe(filterKeepsQuestion(bare, { path, state: "open" }));
      }
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(4);
  });

  it("compares a quoted value code point for code point", () => {
    // The port would trim the spaces, and read `[ab]` as a class.
    expect(keeps('path:" a.md"', "a.md")).toBe(false);
    expect(keeps('path:" a.md"', "x/ a.md")).toBe(true);
    expect(keeps('path:"[ab].md"', "a.md")).toBe(false);
    expect(keeps('path:"[ab].md"', "x/[ab].md")).toBe(true);
    expect(keeps('path:"docs/[ab]/"', "docs/[ab]")).toBe(false);
    expect(keeps('path:"docs/[ab]/"', "docs/[ab]/x.md")).toBe(true);
    expect(keeps('path:"my dir/"', "a/my dir/x.md")).toBe(true);
    expect(keeps('path:"my dir/"', "a/my dir")).toBe(false);
  });
});

describe("applying a filter to the sections (§6.1, §6.2)", () => {
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
    expect(counts(SECTIONS)).toEqual({ "roadmap.md": 3, "x/roadmap.md": 1 });
    expect(counts(apply("is:open").sections)).toEqual({
      "roadmap.md": 2,
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
  });

  it("counts entries, kept documents and open questions", () => {
    const all = sectionEntryKeys(SECTIONS).length;
    expect(all).toBe(18);
    expect(apply("path:docs/design/a.md is:open").summary).toMatchObject({
      canonical: "path:docs/design/a.md is:open",
      entries: { shown: 2, of: all },
      documents: { kept: 1, of: 16 },
      openQuestions: 2,
    });
    // A ✅ question is an entry and not an open question.
    expect(apply("path:docs/design/a.md").summary).toMatchObject({
      entries: { shown: 4, of: all },
      openQuestions: 2,
    });
    expect(apply("is:open").summary).toMatchObject({
      entries: { shown: 8, of: all },
      documents: { kept: 16, of: 16 },
      openQuestions: 8,
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
});

describe("the agent request under a filter (§6.3, §6.6)", () => {
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
    const { sections, summary } = apply("path:notes");
    const request = planningAgentRequest(INDEX, sections, {
      repository,
      filter: { text: summary.requestText!, unfiltered: SECTIONS },
    })!;
    expect(request).toContain(
      "Filter: `path:notes`. Only the entries it keeps are listed.",
    );
    expect(request).toContain("- notes/f.md:");
    expect(request).not.toMatch(/^- docs\//m);
    expect(request).not.toMatch(/^- x\//m);
    // Nothing to ask for: no request.
    const nothing = apply("path:docs/design/a.md");
    expect(
      planningAgentRequest(INDEX, nothing.sections, {
        repository,
        filter: { text: nothing.summary.requestText!, unfiltered: SECTIONS },
      }),
    ).toBeNull();
  });

  it("fences a filter text holding a backtick", () => {
    const text = 'path:"a`b.md" path:notes';
    const { sections } = apply(text);
    expect(
      planningAgentRequest(INDEX, sections, {
        repository,
        filter: { text, unfiltered: SECTIONS },
      }),
    ).toContain(
      'Filter: ``path:"a`b.md" path:notes``. Only the entries it keeps are listed.',
    );
  });

  // No key this release reads keeps a Ready row and drops what Blocked holds
  // it for, so the case is built by hand (§6.3).
  it("reads what a row is blocked on from the unfiltered sections", () => {
    const kept: PlanningSections = { ...SECTIONS, waiting: [] };
    const blocked =
      "- notes/b.md  (stage DECIDED; blocked on docs/design/sub/c.md#OQ-C1, \u{1F512} OQ-B1)";
    const filtered = planningAgentRequest(INDEX, kept, {
      repository,
      ids: ["ready"],
      filter: { text: "path:notes", unfiltered: SECTIONS },
    })!;
    expect(filtered).toContain(blocked);
    expect(filtered).toContain("Skip any entry marked blocked");
    // Without it, the hand-built sections would erase the annotation.
    const erased = planningAgentRequest(INDEX, kept, {
      repository,
      ids: ["ready"],
    })!;
    expect(erased).toContain("- notes/b.md  (stage DECIDED)");
    expect(erased).not.toContain("Skip any entry marked blocked");
  });
});

describe("the link (§9.2)", () => {
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

  it("names one document as path:/<path>, in canonical text", () => {
    expect(documentFilter("roadmap.md")).toBe("path:/roadmap.md");
    expect(documentFilter("plans/design.md")).toBe("path:plans/design.md");
    expect(documentFilter("docs/my notes.md")).toBe('path:"docs/my notes.md"');
    expect(documentFilter("my notes.md")).toBe('path:"/my notes.md"');
    expect(documentFilter("docs/*.md")).toBe('path:"docs/*.md"');
    expect(documentFilter('docs/a"b\\.md')).toBe('path:"docs/a\\"b\\\\.md"');
    expect(documentFilter("docs/caf\u00e9.md")).toBe(
      'path:"docs/caf\u00e9.md"',
    );
    expect(documentFilter("docs/a\u0007.md")).toBeNull();
    // Each keeps its document and nothing else the index lists.
    for (const path of LISTED) {
      const filter = understood(documentFilter(path)!);
      expect(keptDocuments(filter), path).toEqual([path]);
    }
  });
});

describe("a pasted link (§7)", () => {
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

  it("takes the first link, and reads it up to white space only", () => {
    expect(
      readPastedPlanningLink(
        "see /.vantage/planning?filter=path:a /.vantage/planning?filter=path:b",
      ),
    ).toEqual({ filter: "path:a", roadmap: null });
    // A run ends at white space alone, so a period or a backtick stays (the
    // sketch's risk 3): the filter then reads as written.
    expect(
      readPastedPlanningLink("`/.vantage/planning?filter=path:a.md`"),
    ).toEqual({ filter: "path:a.md`", roadmap: null });
  });

  it("finds none where no run holds the page's path", () => {
    expect(readPastedPlanningLink("path:plans/design.md is:open")).toBeNull();
    expect(readPastedPlanningLink("/.vantage/planningx?filter=a")).toBeNull();
    expect(readPastedPlanningLink("/vantage/planning?filter=a")).toBeNull();
    expect(readPastedPlanningLink("")).toBeNull();
  });
});

describe("the filter notice (§6.7)", () => {
  const checker = (summary: PlanningFilterSummary) =>
    PLANNING_NOTICES.filtered(summary, "checker").map(noticeText);
  const page = (summary: PlanningFilterSummary) =>
    PLANNING_NOTICES.filtered(summary, "page").map(noticeText);

  it("opens with the canonical text as code, then the counts", () => {
    const { summary } = apply("path:/docs/design/a.md is:open");
    const [first] = PLANNING_NOTICES.filtered(summary, "page");
    expect(first).toEqual([
      "Filtered by ",
      { code: "path:docs/design/a.md is:open" },
      ": 2 of 18 entries, in 1 of 16 paths, 2 of them open questions.",
    ]);
    expect(checker(summary)).toEqual([
      "Filtered by `path:docs/design/a.md is:open`: 2 of 18 entries, in 1 of 16 paths, 2 of them open questions.",
      "1 of its questions is blocked and will need you later.",
      "Run without --filter to see the other 16.",
    ]);
    expect(page(summary).at(-1)).toBe("Clear the filter to see the other 16.");
  });

  it("names each unmatched term on a line of its own", () => {
    expect(
      checker(apply("path:docs/desing path:notes/e.md path:x/y").summary),
    ).toEqual([
      "Filtered by `path:docs/desing path:notes/e.md path:x/y`: 1 of 18 entries, in 1 of 16 paths, none of them open questions.",
      "`path:docs/desing` matches no path the index lists.",
      "`path:x/y` matches no path the index lists.",
      "Run without --filter to see the other 17.",
    ]);
  });

  it("names the other roadmaps holding kept questions, in each reader's words", () => {
    const { summary } = apply("path:docs/design/sub/c.md is:open");
    expect(checker(summary)).toEqual([
      "Filtered by `path:docs/design/sub/c.md is:open`: 1 of 18 entries, in 1 of 16 paths, 1 of them an open question.",
      "1 more question it keeps is on another roadmap: `x/roadmap.md` (1). Rerun with --roadmap naming it.",
      "Run without --filter to see the other 17.",
    ]);
    expect(page(summary)[1]).toBe(
      "1 more question it keeps is on another roadmap: `x/roadmap.md` (1). Choose that roadmap to see it; the filter stays.",
    );
    const two: PlanningFilterSummary = {
      ...summary,
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
  });

  it("says what waits on a document the filter leaves out, and when nothing is kept", () => {
    const { summary, sections } = apply("path:notes/b.md is:open");
    expect(sections.nothingNeedsYou).toBe(true);
    expect(checker(summary)).toEqual([
      "Filtered by `path:notes/b.md is:open`: 0 of 18 entries, in 1 of 16 paths, none of them open questions.",
      "1 of its questions is blocked and will need you later.",
      "notes/b.md waits on docs/design/sub/c.md#OQ-C1, which this filter leaves out.",
      "Run without --filter to see the other 18.",
    ]);
    expect(PLANNING_NOTICES.nothingFilteredNeedsYou).toBe(
      "Nothing this filter keeps needs you.",
    );
  });

  it("puts the clauses in the design's order, one line per waiting document", () => {
    const summary: PlanningFilterSummary = {
      canonical: "path:a is:open",
      requestText: "path:a is:open",
      entries: { shown: 1234, of: 5678 },
      documents: { kept: 1, of: 1 },
      openQuestions: 1234,
      blockedLeftOut: 3,
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
    };
    expect(checker(summary)).toEqual([
      "Filtered by `path:a is:open`: 1,234 of 5,678 entries, in 1 of 1 path, 1,234 of them open questions.",
      "`path:z` matches no path the index lists.",
      "2 more questions it keeps are on another roadmap: `b/roadmap.md` (2). Rerun with --roadmap naming it.",
      "3 of its questions are blocked and will need you later.",
      "a/x.md waits on c.md and d.md#OQ-D1, which this filter leaves out.",
      "a/y.md waits on c.md, which this filter leaves out.",
      "a/z.md waits on c.md, d.md, and e.md, which this filter leaves out.",
      "Run without --filter to see the other 4,444.",
    ]);
    expect(page(summary)[2]).toBe(
      "2 more questions it keeps are on another roadmap: `b/roadmap.md` (2). Choose that roadmap to see them; the filter stays.",
    );
  });

  it("says when it hides nothing", () => {
    expect(checker(apply("path:*.md").summary).at(-1)).toBe(
      "It hides no entry.",
    );
    expect(page(apply("path:*.md").summary).at(-1)).toBe("It hides no entry.");
  });

  it("fences a canonical text holding a backtick", () => {
    expect(checker(apply('path:"a`b.md"').summary)[0]).toMatch(
      /^Filtered by ``path:"a`b\.md"``: /,
    );
  });

  const notUnderstood = (text: string) => {
    const parsed: PlanningFilter = parsePlanningFilter(text);
    if (parsed.kind !== "not-understood") throw new Error(text);
    return parsed;
  };

  it("says a filter it does not understand is not applied, naming its term or reason", () => {
    expect(
      PLANNING_NOTICES.notFiltered(
        notUnderstood("path:docs/design/*.md OR is:open"),
      ),
    ).toEqual([
      "Not filtered: this Vantage does not understand ",
      { code: "OR" },
      ". It reads path: and is: terms, such as ",
      { code: "path:docs/design/*.md is:open" },
      ". Every entry is shown.",
    ]);
    expect(
      noticeText(PLANNING_NOTICES.notFiltered(notUnderstood('path:"a b'))),
    ).toBe(
      "Not filtered: this Vantage does not understand an unclosed quote. It reads path: and is: terms, such as `path:docs/design/*.md is:open`. Every entry is shown.",
    );
    // Its example is a filter this release reads.
    expect(parsePlanningFilter("path:docs/design/*.md is:open").kind).toBe(
      "understood",
    );
  });

  it("gives the checker's exit 2 a message of its own, unprefixed", () => {
    expect(
      PLANNING_NOTICES.filterNotUnderstood(notUnderstood("Path:docs/x.md")),
    ).toBe(
      "this checker does not understand `Path:docs/x.md`; it reads path: and is: terms",
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
        `this checker does not understand ${words}; it reads path: and is: terms`,
      );
      expect(noticeText(PLANNING_NOTICES.notFiltered(filter))).toContain(
        `does not understand ${words}. It reads`,
      );
    }
  });
});
