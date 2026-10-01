/**
 * The directive grammar and the closed vocabulary — one parser, no renderer.
 *
 * A Vantage directive is an ordinary HTML comment carrying a `vantage:`
 * sentinel: `<!-- vantage: section tone=warning -->`. GitHub drops it, every
 * other Markdown renderer drops it, and Vantage compiles it into
 * `data-vantage-*` attributes on the block that follows
 * (`rehypeVantageDirectives`). See `docs/reference/inline-markup.md`, "The carrier and the grammar".
 *
 * This module is deliberately **zero-dependency — not even a type import**, and
 * it knows nothing about hast. Two callers need it and only one of them has a
 * tree: the rehype plugin stamps attributes, and the `vantage-check` CLI
 * validates directives with no rendering at all, importing this file by
 * relative path. A checker with its own copy of the grammar is a checker that
 * disagrees with the renderer, which is the failure D5 names.
 *
 * Everything here is a pure function of a string. Nothing throws, nothing logs
 * (P3): a comment that is not a directive is `null`, and a comment that carries
 * the sentinel but does not parse is `malformed` with a reason only the checker
 * reads.
 */

/**
 * The mandatory sentinel — the full word, never a terser `v:`.
 *
 * It is what keeps an ordinary `<!-- TODO: rewrite this -->` from being parsed
 * as markup, and it makes the common case a prefix test rather than a grammar
 * attempt (Ledger OQ-1).
 */
export const VANTAGE_SENTINEL = "vantage:";

/**
 * The closed name set. An unknown name drops the **whole** directive: there is
 * no target semantics without a name. An unknown key or value drops only that
 * pair (D2 is per-key).
 *
 * Position picks the target; the name picks the extent. `section` before a
 * heading reaches the heading's whole section, `block` reaches one block, and
 * `question` declares one question in any state, as `oq`, the name it
 * replaces, still does (`VANTAGE_QUESTION_NAMES`). The name cannot disagree
 * with position — it only says how far the stamp reaches — so §4.2's refusal
 * of a `scope=` key stands.
 *
 * `fallback` is the one name that stamps nothing: it withholds the block after
 * it, which is written for the renderers that cannot show something Vantage
 * shows — an inline `<svg>`, today. Every renderer that does not know the name
 * drops the comment and shows the block, a 0.7.x Vantage included, which is
 * the whole mechanism: the name is new, so no older reader gives it a meaning
 * (`docs/reference/inline-markup.md`, "Fallback blocks").
 */
export const DIRECTIVE_NAMES = [
  "section",
  "block",
  "oq",
  "question",
  "fallback",
] as const;

/**
 * The two names that declare a question: `question`, the one to write, and
 * `oq`, which it replaces and which every Vantage keeps reading.
 *
 * - **`question`** declares a question in any state: open (💬, 💬 🤷 or no
 *   marker at all), 🔒 blocked or ✅ answered. The state comes from the marker
 *   and never from the name, so a question that changes state changes its
 *   marker and nothing else. A viewer from 0.8 on offers Take this leaning on
 *   an open one, and never on a 🔒 or ✅ one.
 * - **`oq`** is deprecated, never removed. It keeps the meaning it shipped
 *   with in 0.7, an open question to answer in one click, because documents
 *   outlive releases and a release never gives existing notation a new
 *   meaning (`docs/design/checker-version-skew.md`, P0). Every viewer before
 *   0.8 offers the button on every `oq` it meets, whatever its marker says,
 *   so `vantage-check` reports one on a 🔒 or ✅ question as an error and any
 *   other as a warning that names the `question` to write.
 *
 * The two take the same keys, `id` and `leaning`, with one grammar. A viewer
 * that predates `question` drops it whole, as it drops every name it does not
 * know, so on a question written with it that viewer offers no button and no
 * anchor: it does less, and misreads nothing. A run holding both names is one
 * question, read as such a viewer reads it: where both set a key, the `oq`'s
 * value wins.
 */
export const VANTAGE_QUESTION_NAMES = ["oq", "question"] as const;

/** `oq` or `question`: a directive that declares a question. */
export type VantageQuestionName = (typeof VANTAGE_QUESTION_NAMES)[number];

/** Whether `name` declares a question, `question` or the deprecated `oq`. */
export function isQuestionDirective(name: string): name is VantageQuestionName {
  return name === "oq" || name === "question";
}

/**
 * The attribute every question carries in the rendered page, whichever name
 * declared it, with the value `"true"`. It is how a reader of this package's
 * markup finds every question: `[data-vantage-question]`
 * (`VANTAGE_QUESTION_SELECTOR`).
 */
export const VANTAGE_QUESTION_ATTRIBUTE = "data-vantage-question";

/** `[data-vantage-question]`: every question in a rendered page. */
export const VANTAGE_QUESTION_SELECTOR = `[${VANTAGE_QUESTION_ATTRIBUTE}]`;

/**
 * The attribute a question declared with `oq` carries besides
 * `VANTAGE_QUESTION_ATTRIBUTE`, with the value `"true"`. It means what it has
 * meant since 0.7, "declared with `oq`", and nothing more: whether a question
 * offers Take this leaning is read from its state (`questionOffersTake`),
 * never from this attribute.
 */
export const VANTAGE_OQ_ATTRIBUTE = "data-vantage-oq";

/**
 * The attribute that carries a question's `leaning=`, normalized
 * (`normalizeLeaning`), on the element `VANTAGE_QUESTION_ATTRIBUTE` is on,
 * whichever name declared it. Absent when the directive states none.
 */
export const VANTAGE_LEANING_ATTRIBUTE = "data-vantage-leaning";

/**
 * The `tone` vocabulary: GitHub's alert words plus `muted`.
 *
 * Semantic, never chromatic (P2, Ledger OQ-3). A document says what a section
 * *is*; the theme decides what that looks like, which is what lets one document
 * render correctly in light, in dark, and in themes that do not exist yet.
 */
export const VANTAGE_TONES = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
  "muted",
] as const;

/** How much the block should pull the eye — separate from `tone` on purpose. */
export const VANTAGE_EMPHASIS = ["strong", "normal", "quiet"] as const;

/** A small chip beside the heading. */
export const VANTAGE_BADGES = [
  "draft",
  "stale",
  "blocked",
  "done",
  "wip",
] as const;

/**
 * `collapsed` is a token, not a flag: `false` is the default written down.
 *
 * It stamps nothing on its own. Its one real effect is overriding a
 * `collapsed=true` earlier in the same merged directive run — last key wins — so
 * it is in the vocabulary rather than being an unknown value that drops. It
 * cannot cancel an *enclosing* collapsed section: a nested heading is a hidden
 * member of the outer group by design (A3), and the outer run is stamped before
 * any inner directive has been resolved.
 */
export const VANTAGE_COLLAPSED = ["true", "false"] as const;

/**
 * Where a block sits in a stamped run, so section-wide CSS can join its members
 * without an adjacent-sibling combinator.
 *
 * Not cosmetic. Review mode inserts comment cards as siblings *inside* a
 * stamped run (`useReviewHighlights`), so `[tone] + [tone]` severs at every
 * commented paragraph and bleeds across the boundary between two adjacent runs
 * of different tone. An attribute survives both.
 */
export const VANTAGE_RUNS = ["start", "middle", "end", "only"] as const;

/**
 * The tags a `section`/`block` directive may **target**.
 *
 * Deliberately `rehypeSourceLines`'s `BLOCK_TAGS`: a directive's target should
 * also be a block with a `data-source-line`, so the styling surface and the
 * anchor surface coincide. It also keeps an inline directive from stamping the
 * `<em>` that happens to follow it inside a paragraph.
 *
 * It does **not** bound a `section`'s range. Every element in the span is
 * stamped, on the tag list or not, because a member only has to be a box in the
 * flow for the section's vertical rule to cross it — see `styleRange` in
 * `rehypeVantageDirectives.ts` for the hole that restricting the range left.
 *
 * It lives here rather than in the plugin because the CLI checker has to answer
 * "will this directive stamp anything?" from an mdast tree with no hast in
 * sight. A checker with its own copy of this list is a checker that calls a
 * working directive an orphan, or stays silent about a dead one (D5).
 */
export const VANTAGE_STYLE_TARGETS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "table",
  "tr",
  "ul",
  "ol",
  "hr",
  "div",
] as const;

/**
 * The tags a `fallback` directive may **withhold**: `VANTAGE_STYLE_TARGETS`
 * minus the six headings, written as a subtraction so the narrowing stays
 * visible.
 *
 * A heading is refused because it is the document's structure rather than a
 * stand-in for anything: the contents column lists it, other documents link to
 * its slug, and the planning index reads sections under it. A fallback heading
 * would be an anchor that exists on GitHub and nowhere in Vantage. What a
 * fallback holds — a sentence naming the release a drawing needs, a link to
 * the drawing as a file, an ASCII sketch in a fence — is a paragraph, a list,
 * a quote, a code block, a table or a `<div>`, and those are all here.
 *
 * Three callers read it, and they must agree: `rehypeVantageDirectives`, which
 * withholds the block; the planning index's scan, which must not read a
 * question or a link from a block the page never shows; and the checker's
 * `vantage/orphan`, which reports a fallback that withholds nothing.
 */
export const VANTAGE_FALLBACK_TARGETS = VANTAGE_STYLE_TARGETS.filter(
  (tag) => !/^h[1-6]$/.test(tag),
);

/**
 * The tags a question directive, `oq` or `question`, may stamp — strictly the
 * tags the review system can resolve an anchor on (`ANCHOR_TAGS` in the app's
 * `MarkdownViewer`, and the block map in `useReviewHighlights`). `ul`, `ol`,
 * `tr`, `hr` and `div` are in neither, so a button on one of them would build
 * an anchor no review pass can find — the "mis-wired button" D6 forbids.
 *
 * The gap between this list and `VANTAGE_STYLE_TARGETS` is why a question
 * directive at column 0 above a list silently does nothing: the target is the
 * `<ul>`, not the `<li>`. The checker says so.
 */
export const VANTAGE_ANCHOR_TARGETS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "table",
] as const;

/**
 * The tags a question directive declares a question on, and so the only ones
 * an open question's *button* can sit on — `VANTAGE_ANCHOR_TARGETS` minus `pre`
 * and `table`, written as an explicit subtraction so the narrowing stays
 * visible. One list for both names and every state, so a question that changes
 * state is declared in exactly the same place.
 *
 * Anchorable and button-hosting are different questions, and this is the second
 * one. A comment *can* be anchored on a `<pre>` or a `<table>` — both are in
 * `ANCHOR_TAGS` — but neither can hold the affordance: inside a `<pre>` the
 * button renders as part of the code, and a `<button>` child of `<table>` is not
 * valid HTML at all, so the parser hoists it out.
 *
 * Every consumer reads it from here: `OQ_HOST_TAGS` in the app's
 * `useOpenQuestionButtons`, the planning index's scan, and the question branch
 * of the checker's `vantage/orphan`. They were two hand-written lists that
 * disagreed — the checker called an `oq` above a fence fine while the app
 * rendered no button and said nothing, which is the D5 break this module
 * exists to prevent.
 */
export const VANTAGE_OQ_HOST_TARGETS = VANTAGE_ANCHOR_TARGETS.filter(
  (tag) => tag !== "pre" && tag !== "table",
);

/**
 * The shape of a question directive's `id`, on `oq` and `question` alike:
 * `OQ-` then an optional short uppercase prefix then digits. `OQ-9`, `OQ-TP6`
 * and `OQ-A03` are ids; `OQ-foo`, `OQ-tp6` and a bare `OQ6` are not.
 *
 * The prefix is what keeps ids distinct once one document references another's
 * questions — `trust-paths.md`'s `OQ-4` and a design sketch's `OQ-4` are
 * different questions, and a bare number cannot say which one a cross-document
 * reference means. It is optional because most documents never leave their own
 * file, and requiring it everywhere would fire on every single-doc sketch.
 *
 * Read from here, never re-spelled, by the sanitizer that allowlists the value,
 * by the checker's `collectOqIds` (which feeds `vantage/oq-id-format` and the
 * anchors the checker accepts) and by the planning index. The directive plugin
 * that stamps the anchor deliberately does not test it: it stamps any non-empty
 * id and leaves refusing a malformed one to the sanitizer. A re-spelled copy is
 * how the checker starts calling a working anchor malformed — and the patterns
 * that look for an id in text (`OQ_REFERENCE` and `OQ_EXACT` in the checker's
 * `rules/references.ts`, `OQ_TOKEN` in `planning/scan.ts` and in
 * `FrontmatterDisplay.tsx`) restate this shape, so they change with it.
 */
export const VANTAGE_OQ_ID = /^OQ-(?:[A-Z][A-Z0-9]{0,5})?[0-9]+$/;

/**
 * The status emoji the documentation convention marks an Open Question with, and
 * what each one means to a reader deciding whether the question wants them.
 *
 * These are *prose* — ordinary characters in the question's title, not part of
 * any directive — which is exactly why they need a home that both readers of
 * them can import. Two consumers ask what a marker means and they must not
 * answer differently: the checker's `vantage/oq-missing`, which demands a
 * directive on an open question and must never demand one on a blocked one, and
 * the viewer's contents column, which shows the marker and needs a word for it
 * that a screen reader can say. They were private constants in the checker until
 * the second consumer arrived.
 *
 * `open` is the only state that wants a one-click answer, so it is the only one
 * a viewer offers Take this leaning on (`questionOffersTake`). A `settled` or
 * `blocked` question carries no control — a control offering to answer a
 * question that is already decided, or that cannot be answered yet, is a lie.
 * The checker keys on the distinction rather than on the word "Leaning:"
 * alone. Either non-open marker wins when both appear on one item.
 */
export const VANTAGE_OQ_STATUS = {
  /** 💬 — an active decision awaiting a ruling. */
  open: "\u{1F4AC}",
  /** ✅ — decided, awaiting compaction into a Decision Ledger. */
  settled: "\u2705",
  /** 🔒 — blocked on an upstream decision or experiment. */
  blocked: "\u{1F512}",
} as const;

/** One of the convention's three states, as [VANTAGE_OQ_STATUS] names them. */
export type VantageOqStatus = keyof typeof VANTAGE_OQ_STATUS;

/**
 * What a marker says, in words, for somewhere an emoji cannot go.
 *
 * An accessible name is the reason this exists: a contents entry whose whole
 * status is one glyph says nothing to a screen reader, and "speech bubble" —
 * which is what it would otherwise read out — is worse than nothing.
 */
export const VANTAGE_OQ_STATUS_LABEL: Readonly<
  Record<VantageOqStatus, string>
> = {
  open: "Open question",
  settled: "Answered question",
  blocked: "Blocked question",
};

/**
 * The state `text` is marked with, or `null` when it carries no marker.
 *
 * Non-open wins over open, the resolution `vantage/oq-missing` has always made:
 * a question marked both 💬 and ✅ has been answered and the stale marker simply
 * has not been cleared yet, so treating it as open would re-open a ruling.
 */
export function vantageOqStatus(text: string): VantageOqStatus | null {
  if (text.includes(VANTAGE_OQ_STATUS.settled)) return "settled";
  if (text.includes(VANTAGE_OQ_STATUS.blocked)) return "blocked";
  if (text.includes(VANTAGE_OQ_STATUS.open)) return "open";
  return null;
}

/**
 * Whether a question in this state offers Take this leaning in review mode: an
 * open one, marked 💬 or 💬 🤷, or one carrying no marker, which counts as
 * open. A 🔒 question cannot be answered yet and a ✅ one has been ruled, so
 * neither has a leaning left to take, whatever its directive's name.
 *
 * One home for the rule, because every surface that answers it must agree:
 * the page's button and the planning card, the counts of questions waiting on
 * a human, and `vantage-check`, which reports an `oq` on a question this says
 * no to, since every viewer before 0.8 offers the button there anyway.
 */
export function questionOffersTake(status: VantageOqStatus | null): boolean {
  return status === null || status === "open";
}

/** `null` for a key the grammar accepts but no closed set covers. */
export type KeyVocabulary = readonly string[] | null;

/** The keys one directive name accepts. `undefined` for an unknown key. */
export type KeyTable = Readonly<Record<string, KeyVocabulary | undefined>>;

/** The whole vocabulary. `undefined` for an unknown directive name. */
export type DirectiveVocabulary = Readonly<
  Record<string, KeyTable | undefined>
>;

const STYLE_KEYS: KeyTable = {
  tone: VANTAGE_TONES,
  emphasis: VANTAGE_EMPHASIS,
  badge: VANTAGE_BADGES,
  collapsed: VANTAGE_COLLAPSED,
};

/**
 * Name → key → the closed value set for that key.
 *
 * `section` and `block` share their keys: they differ in *extent*, not in what
 * they can say. The two question names share theirs too, and they are the
 * design's only values with no closed set — `id` is a token an author chose
 * and `leaning` is a sentence (§8.3) — so neither can be value-allowlisted,
 * which is recorded here as `null` rather than left to a caller to guess.
 *
 * `question` takes exactly `oq`'s keys and nothing more. Starting narrow is
 * the forward-compatible choice: a key added later is one older viewers drop
 * pair by pair, while a key accepted now could never be given a meaning (P0).
 * A `leaning` on a 🔒 or ✅ question is allowed and simply not offered
 * (`questionOffersTake`), so changing a question's state changes only its
 * marker.
 *
 * `fallback` takes no keys: whether a block is withheld is the whole of what
 * it says, and a key added later is dropped pair by pair by this release, as
 * D2 drops any other.
 */
export const DIRECTIVE_VOCABULARY: DirectiveVocabulary = {
  section: STYLE_KEYS,
  block: STYLE_KEYS,
  oq: { id: null, leaning: null },
  question: { id: null, leaning: null },
  fallback: {},
};

/**
 * The one question a run of directives declares, merged: the name that won,
 * and its keys.
 */
export interface QuestionRun {
  /** `oq` when the run holds one, otherwise `question`. */
  name: VantageQuestionName;
  /** Every key the winning name's directives set that it accepts, merged. */
  keys: Map<string, string>;
  /** Which directive of the run, by index, each merged key's value came from. */
  sources: Map<string, number>;
}

/**
 * Merge the question directives of one run — the comments up to the block they
 * land on — into the one question they declare, or `undefined` when the run
 * holds none. Directives of any other name are skipped.
 *
 * A run holding an `oq` is read exactly as a viewer that predates `question`
 * reads it: that viewer drops every `question` and reads the `oq` alone, so
 * the `oq` wins wherever it appears in the run, and only its keys apply — a
 * key only a `question` in the same run sets applies nowhere, in no release.
 * That is the one reading every viewer agrees on (`VANTAGE_QUESTION_NAMES`),
 * so the same bytes file the same Take in 0.7 and in 0.8. Within one name, the
 * last value of a key wins, as `section` and `block` resolve theirs. A pair
 * its name does not accept, or a value outside a closed set, is dropped (D2).
 *
 * One function for every reader of a run: the plugin that stamps the question
 * and the planning index that reads it, which the checker reads a question
 * through, so none can disagree about which leaning or which id a run carries
 * (D5).
 */
export function mergeQuestionRun(
  run: readonly {
    name: string;
    pairs: readonly { key: string; value: string }[];
  }[],
): QuestionRun | undefined {
  let name: VantageQuestionName | undefined;
  for (const directive of run) {
    if (!isQuestionDirective(directive.name)) continue;
    if (name !== "oq") name = directive.name;
  }
  if (name === undefined) return undefined;
  const accepted = DIRECTIVE_VOCABULARY[name] ?? {};
  const keys = new Map<string, string>();
  const sources = new Map<string, number>();
  run.forEach((directive, index) => {
    if (directive.name !== name) return;
    for (const pair of directive.pairs) {
      const values = accepted[pair.key];
      if (values === undefined) continue;
      if (values !== null && !values.includes(pair.value)) continue;
      keys.set(pair.key, pair.value);
      sources.set(pair.key, index);
    }
  });
  return { name, keys, sources };
}

export interface DirectivePair {
  key: string;
  /** The value with quotes stripped, if it was quoted. */
  value: string;
  /** Offset of `key` within the comment's inner text. */
  keyOffset: number;
  /** Offset of the value token — opening quote included — within it. */
  valueOffset: number;
  quoted: boolean;
}

export interface ParsedDirective {
  kind: "directive";
  name: string;
  /** Offset of `name` within the comment's inner text. */
  nameOffset: number;
  /** In written order, duplicates included: a checker reports them, the
   * renderer resolves them last-one-wins. */
  pairs: DirectivePair[];
}

/** Sentinel present, grammar not satisfied. The renderer ignores `reason`. */
export interface MalformedDirective {
  kind: "malformed";
  /** One clause a checker can quote verbatim, lowercase and unpunctuated. */
  reason: string;
  /** Offset of the first character the parse could not use. */
  offset: number;
}

export type DirectiveParse = ParsedDirective | MalformedDirective | null;

/**
 * `ws` is `[ \t\r\n]` — the design's grammar leaves it undefined, and `\n` has
 * to be in the set because a directive may legally wrap: a multi-line comment
 * is one node whose value contains the newlines.
 */
const WS = /[ \t\r\n]*/y;
const SENTINEL_PREFIX = /^[ \t\r\n]*vantage:/;
const NAME = /[a-z][a-z0-9-]*/y;
const UNQUOTED = /[A-Za-z0-9_.:#-]+/y;
/**
 * A quoted value holds anything but a `"`, `--` included: measured through the
 * real chain, `leaning="a--b"` reaches the tree intact, because HTML5 closes a
 * comment on `-->` or `--!>` and on nothing else. There is deliberately **no**
 * `--` restriction here. What a quoted value cannot hold is a terminator: a
 * `-->` inside one ends the comment early and spills the tail into the document
 * as literal text, which is a finding for the checker rather than a rule here —
 * by the time this function runs, the truncation has already happened.
 */
const QUOTED = /"[^"]*"/y;

/**
 * The cheap prefix test. Runs first on every comment in every document, so an
 * ordinary editorial comment never reaches the tokenizer.
 *
 * Note `<!--- vantage: x -->` is *not* a directive: its inner text begins with
 * the extra `-`, and the sentinel must be the first thing in the comment.
 */
export function hasVantageSentinel(comment: string): boolean {
  return SENTINEL_PREFIX.test(comment);
}

/** The whole non-whitespace run at `offset`, capped, for a quotable message. */
function token(comment: string, offset: number): string {
  const rest = comment.slice(offset);
  const end = rest.search(/[ \t\r\n]/);
  const word = end === -1 ? rest : rest.slice(0, end);
  return word.length > 24 ? `${word.slice(0, 24)}…` : word;
}

/** The sticky match at `offset`, or `null` if the pattern does not apply. */
function matchAt(
  pattern: RegExp,
  comment: string,
  offset: number,
): string | null {
  pattern.lastIndex = offset;
  const match = pattern.exec(comment);
  return match === null ? null : match[0];
}

/** How much whitespace sits at `offset`. `WS` matches everywhere, empty. */
function skipWhitespace(comment: string, offset: number): number {
  return matchAt(WS, comment, offset)?.length ?? 0;
}

function malformed(reason: string, offset: number): MalformedDirective {
  return { kind: "malformed", reason, offset };
}

/**
 * Parse one comment's **inner** text — the value of a hast `comment` node, with
 * `<!--` and `-->` already stripped. `null` means "no sentinel, not ours".
 *
 * Hand-rolled rather than one regular expression, because a repeated capture
 * group keeps only its last match and the checker needs an offset per token to
 * point at the character that broke.
 */
export function parseVantageDirective(comment: string): DirectiveParse {
  const sentinel = SENTINEL_PREFIX.exec(comment);
  if (sentinel === null) return null;

  let at = sentinel[0].length;
  at += skipWhitespace(comment, at);

  const nameOffset = at;
  const name = matchAt(NAME, comment, at);
  if (name === null) {
    return malformed("no directive name after `vantage:`", at);
  }
  at += name.length;

  const pairs: DirectivePair[] = [];
  while (at < comment.length) {
    const gap = skipWhitespace(comment, at);
    at += gap;
    if (at >= comment.length) break;
    if (gap === 0) {
      return malformed(`\`${token(comment, at)}\` needs a space before it`, at);
    }

    const keyOffset = at;
    const key = matchAt(NAME, comment, at);
    if (key === null) {
      return malformed(
        `\`${token(comment, at)}\` is not a \`key=value\` pair`,
        at,
      );
    }
    at += key.length;

    if (comment[at] !== "=") {
      return malformed(`\`${key}\` is not followed by \`=value\``, at);
    }
    at += 1;

    const valueOffset = at;
    const quoted = matchAt(QUOTED, comment, at);
    if (quoted !== null) {
      at += quoted.length;
      pairs.push({
        key,
        value: quoted.slice(1, -1),
        keyOffset,
        valueOffset,
        quoted: true,
      });
      continue;
    }

    const unquoted = matchAt(UNQUOTED, comment, at);
    if (unquoted === null) {
      const found = token(comment, at);
      return malformed(
        found === ""
          ? `\`${key}=\` has no value`
          : `\`${found}\` is not a valid value for \`${key}\``,
        at,
      );
    }
    at += unquoted.length;
    pairs.push({ key, value: unquoted, keyOffset, valueOffset, quoted: false });
  }

  return { kind: "directive", name, nameOffset, pairs };
}

/**
 * 🤷 — the second glyph of `💬 🤷`, which marks an open question the author
 * flags as a matter of preference rather than a decision with stakes.
 *
 * Not a state: a question marked `💬 🤷` is open, and `vantageOqStatus` says so.
 * The planning index records the flag beside the state, so this lives with the
 * three state glyphs rather than in the index, where a second spelling of the
 * convention's markers would start.
 */
export const VANTAGE_OQ_PREFERENCE = "\u{1F937}";

/**
 * The longest leaning a question directive carries into the page, in
 * characters.
 *
 * A leaning becomes the body of a review comment, not prose, so it is bounded;
 * 500 is generous for the one sentence the convention asks for.
 */
export const MAX_LEANING = 500;

/**
 * A question directive's `leaning=` value as the page carries it: whitespace
 * runs collapsed to one space, trimmed, and capped at `MAX_LEANING`.
 *
 * A wrapped directive puts newlines and indentation into the value. Two readers
 * need the result and must agree on it: `rehypeVantageDirectives`, which stamps
 * it as `data-vantage-leaning` for the one-click answer, and the planning index,
 * which reports the leaning a question carries. An empty result means the
 * question states no leaning.
 */
export function normalizeLeaning(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_LEANING);
}
