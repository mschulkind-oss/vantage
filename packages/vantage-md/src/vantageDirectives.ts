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
 * `oq` marks one answerable question. The name cannot disagree with position —
 * it only says how far the stamp reaches — so §4.2's refusal of a `scope=` key
 * stands.
 */
export const DIRECTIVE_NAMES = ["section", "block", "oq"] as const;

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
 * The tags an `oq` directive may stamp — strictly the tags the review system
 * can resolve an anchor on (`ANCHOR_TAGS` in the app's `MarkdownViewer`, and the
 * block map in `useReviewHighlights`). `ul`, `ol`, `tr`, `hr` and `div` are in
 * neither, so a button on one of them would build an anchor no review pass can
 * find — the "mis-wired button" D6 forbids.
 *
 * The gap between this list and `VANTAGE_STYLE_TARGETS` is why an `oq`
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
 * The tags a `<!-- vantage: oq … -->` directive actually yields a *button* on —
 * `VANTAGE_ANCHOR_TARGETS` minus `pre` and `table`, written as an explicit
 * subtraction so the narrowing stays visible.
 *
 * Anchorable and button-hosting are different questions, and this is the second
 * one. A comment *can* be anchored on a `<pre>` or a `<table>` — both are in
 * `ANCHOR_TAGS` — but neither can hold the affordance: inside a `<pre>` the
 * button renders as part of the code, and a `<button>` child of `<table>` is not
 * valid HTML at all, so the parser hoists it out.
 *
 * Both consumers read it from here: `OQ_HOST_TAGS` in the app's
 * `useOpenQuestionButtons`, and the `oq` branch of the checker's
 * `vantage/orphan`. They were two hand-written lists that disagreed — the
 * checker called an `oq` above a fence fine while the app rendered no button
 * and said nothing, which is the D5 break this module exists to prevent.
 */
export const VANTAGE_OQ_HOST_TARGETS = VANTAGE_ANCHOR_TARGETS.filter(
  (tag) => tag !== "pre" && tag !== "table",
);

/**
 * The shape of an `oq` directive's `id`: `OQ-` then an optional short uppercase
 * prefix then digits. `OQ-9`, `OQ-TP6` and `OQ-A03` are ids; `OQ-foo`, `OQ-tp6`
 * and a bare `OQ6` are not.
 *
 * The prefix is what keeps ids distinct once one document references another's
 * questions — `trust-paths.md`'s `OQ-4` and a design sketch's `OQ-4` are
 * different questions, and a bare number cannot say which one a cross-document
 * reference means. It is optional because most documents never leave their own
 * file, and requiring it everywhere would fire on every single-doc sketch.
 *
 * Three consumers read it from here and none of them may re-spell it: the
 * plugin that stamps the anchor, the sanitiser that allowlists the value, and
 * the checker's `vantage/oq-id-format`. A fourth copy is how the checker starts
 * calling a working anchor malformed.
 */
export const VANTAGE_OQ_ID = /^OQ-(?:[A-Z][A-Z0-9]{0,5})?[0-9]+$/;

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
 * they can say. `oq`'s two keys are the design's only values with no closed set
 * — `id` is a token an author chose and `leaning` is a sentence (§8.3) — so
 * neither can be value-allowlisted, which is recorded here as `null` rather
 * than left to a caller to guess.
 */
export const DIRECTIVE_VOCABULARY: DirectiveVocabulary = {
  section: STYLE_KEYS,
  block: STYLE_KEYS,
  oq: { id: null, leaning: null },
};

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
