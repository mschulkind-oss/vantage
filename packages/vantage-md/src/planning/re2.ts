/**
 * RE2 → JavaScript, for the one expression dialect a planning pattern is
 * written in.
 *
 * The server matches `[planning] include` and `exclude` with
 * `sabhiram/go-gitignore`, which rewrites each line into a Go `regexp` — RE2 —
 * and passes `[`, `(`, `\`, `{` and `+` straight through into it (design §3.1).
 * A JavaScript `RegExp` is not RE2: `[[:upper:]]` is a POSIX class to Go and a
 * set of eight characters to JavaScript, `\q` is an error to Go and the letter
 * `q` to JavaScript, `{01}` is a literal to Go and a quantifier to JavaScript.
 * So the port in `patterns.ts` does not hand the rewritten line to `RegExp`: it
 * hands it to this translator, which parses it the way Go's `regexp/syntax`
 * does and writes out an equivalent expression for a `u`-flag `RegExp`.
 *
 * `null` means Go would refuse to compile the expression, and the caller drops
 * the line, as `getPatternFromLine` does when `regexp.Compile` fails.
 *
 * The parse follows `regexp/syntax/parse.go` of Go 1.26 under `syntax.Perl`
 * flags, which is what `regexp.Compile` uses: `^` and `$` match at the ends of
 * the text only, `.` does not match `\n`, and a negated class does. What it
 * does not model is Go's size limits (an expression compiling to more than
 * about three million instructions, or nested more than 1,000 deep), which no
 * pattern a person writes comes near; the repetition-count limits, which a
 * person can reach, are modeled.
 *
 * Only match/no-match is preserved. Captures are dropped and laziness does not
 * change whether a match exists, so every group is written non-capturing.
 */

/** An inclusive range of code points. */
type Range = readonly [number, number];

/** A class as Go builds it: ranges, plus the JS property escapes it stands for. */
interface ClassItems {
  ranges: Range[];
  /** `\p{…}` / `\P{…}` texts, already in JavaScript spelling. */
  properties: string[];
}

const MAX_RUNE = 0x10ffff;

/** `\d`, `\s`, `\w` — ASCII only in RE2, and `\s` has no `\v`. */
const PERL_GROUPS: Record<string, Range[]> = {
  d: [[0x30, 0x39]],
  s: [
    [0x09, 0x0a],
    [0x0c, 0x0d],
    [0x20, 0x20],
  ],
  w: [
    [0x30, 0x39],
    [0x41, 0x5a],
    [0x5f, 0x5f],
    [0x61, 0x7a],
  ],
};

/** `[:name:]` inside a class, from Go's `perl_groups.go`. */
const POSIX_GROUPS: Record<string, Range[]> = {
  alnum: [
    [0x30, 0x39],
    [0x41, 0x5a],
    [0x61, 0x7a],
  ],
  alpha: [
    [0x41, 0x5a],
    [0x61, 0x7a],
  ],
  ascii: [[0x00, 0x7f]],
  blank: [
    [0x09, 0x09],
    [0x20, 0x20],
  ],
  cntrl: [
    [0x00, 0x1f],
    [0x7f, 0x7f],
  ],
  digit: [[0x30, 0x39]],
  graph: [[0x21, 0x7e]],
  lower: [[0x61, 0x7a]],
  print: [[0x20, 0x7e]],
  punct: [
    [0x21, 0x2f],
    [0x3a, 0x40],
    [0x5b, 0x60],
    [0x7b, 0x7e],
  ],
  space: [
    [0x09, 0x0d],
    [0x20, 0x20],
  ],
  upper: [[0x41, 0x5a]],
  word: [
    [0x30, 0x39],
    [0x41, 0x5a],
    [0x5f, 0x5f],
    [0x61, 0x7a],
  ],
  xdigit: [
    [0x30, 0x39],
    [0x41, 0x46],
    [0x61, 0x66],
  ],
};

/** Go's `unicode.Categories` keys, every one already in canonical form. */
const CATEGORIES = new Set(
  (
    "C Cc Cf Cn Co Cs L Ll Lm Lo Lt Lu M Mc Me Mn N Nd Nl No " +
    "P Pc Pd Pe Pf Pi Po Ps S Sc Sk Sm So Z Zl Zp Zs"
  ).split(" "),
);

/** Go's `unicode.CategoryAliases`, keyed by canonical name as Go 1.26 looks them up. */
const CATEGORY_ALIASES: Record<string, string> = {
  Casedletter: "LC",
  Closepunctuation: "Pe",
  Combiningmark: "M",
  Connectorpunctuation: "Pc",
  Control: "Cc",
  Currencysymbol: "Sc",
  Dashpunctuation: "Pd",
  Decimalnumber: "Nd",
  Enclosingmark: "Me",
  Finalpunctuation: "Pf",
  Format: "Cf",
  Initialpunctuation: "Pi",
  Letter: "L",
  Letternumber: "Nl",
  Lineseparator: "Zl",
  Lowercaseletter: "Ll",
  Mark: "M",
  Mathsymbol: "Sm",
  Modifierletter: "Lm",
  Modifiersymbol: "Sk",
  Nonspacingmark: "Mn",
  Number: "N",
  Openpunctuation: "Ps",
  Other: "C",
  Otherletter: "Lo",
  Othernumber: "No",
  Otherpunctuation: "Po",
  Othersymbol: "So",
  Paragraphseparator: "Zp",
  Privateuse: "Co",
  Punctuation: "P",
  Separator: "Z",
  Spaceseparator: "Zs",
  Spacingmark: "Mc",
  Surrogate: "Cs",
  Symbol: "S",
  Titlecaseletter: "Lt",
  Unassigned: "Cn",
  Uppercaseletter: "Lu",
  Cntrl: "Cc",
  Digit: "Nd",
  Punct: "P",
};

/**
 * The scripts Go 1.26 can find. It canonicalizes a name before looking it up in
 * `unicode.Scripts`, whose keys keep their underscores, so `\p{Old_Italic}` is
 * an error in Go and only these single-word names resolve.
 */
const SCRIPTS = new Set(
  (
    "Adlam Ahom Arabic Armenian Avestan Balinese Bamum Batak Bengali " +
    "Bhaiksuki Bopomofo Brahmi Braille Buginese Buhid Carian Chakma Cham " +
    "Cherokee Chorasmian Common Coptic Cuneiform Cypriot Cyrillic Deseret " +
    "Devanagari Dogra Duployan Elbasan Elymaic Ethiopic Georgian Glagolitic " +
    "Gothic Grantha Greek Gujarati Gurmukhi Han Hangul Hanunoo Hatran Hebrew " +
    "Hiragana Inherited Javanese Kaithi Kannada Katakana Kawi Kharoshthi " +
    "Khmer Khojki Khudawadi Lao Latin Lepcha Limbu Lisu Lycian Lydian " +
    "Mahajani Makasar Malayalam Mandaic Manichaean Marchen Medefaidrin Miao " +
    "Modi Mongolian Mro Multani Myanmar Nabataean Nandinagari Newa Nko Nushu " +
    "Ogham Oriya Osage Osmanya Palmyrene Phoenician Rejang Runic Samaritan " +
    "Saurashtra Sharada Shavian Siddham Sinhala Sogdian Soyombo Sundanese " +
    "Syriac Tagalog Tagbanwa Takri Tamil Tangsa Tangut Telugu Thaana Thai " +
    "Tibetan Tifinagh Tirhuta Toto Ugaritic Vai Vithkuqi Wancho Yezidi Yi"
  ).split(" "),
);

/** Thrown inside the parse for any expression Go would refuse. */
class Refused extends Error {}

/** One emitted piece of the expression, as Go's parse stack would hold it. */
interface Part {
  text: string;
  /**
   * `open` and `bar` are Go's pseudo-operators `(` and `|`: nothing may be
   * repeated right after them. An `assertion` (`^`, `$`, `\b`) may be repeated
   * in Go but not in JavaScript, so it is wrapped in a group first.
   */
  kind: "atom" | "assertion" | "open" | "bar";
  /** The largest product of repetition counts on any path below this part. */
  product: number;
}

/** Go's `isalnum`: ASCII letters and digits only. */
function isAlnum(c: number): boolean {
  return (
    (c >= 0x30 && c <= 0x39) ||
    (c >= 0x41 && c <= 0x5a) ||
    (c >= 0x61 && c <= 0x7a)
  );
}

function unhex(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  return -1;
}

function isOctal(c: number | undefined): c is number {
  return c !== undefined && c >= 0x30 && c <= 0x37;
}

/** A code point, written so a `u`-flag `RegExp` reads it as itself, anywhere. */
function codePoint(c: number): string {
  return `\\u{${c.toString(16)}}`;
}

/**
 * A literal code point outside a class. Only syntax characters and `/` are
 * escaped: a `u`-flag `RegExp` refuses any other identity escape, `\-`
 * included.
 */
function literal(c: number): string {
  const ch = String.fromCodePoint(c);
  if ("^$\\.*+?()[]{}|/".includes(ch)) return `\\${ch}`;
  if (c < 0x20 || c >= 0x7f) return codePoint(c);
  return ch;
}

function complement(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  let next = 0;
  for (const [lo, hi] of sorted) {
    if (lo > next) out.push([next, lo - 1]);
    next = Math.max(next, hi + 1);
  }
  if (next <= MAX_RUNE) out.push([next, MAX_RUNE]);
  return out;
}

function classText(items: ClassItems, negated: boolean): string {
  const body =
    items.ranges
      .map(([lo, hi]) =>
        lo === hi ? codePoint(lo) : `${codePoint(lo)}-${codePoint(hi)}`,
      )
      .join("") + items.properties.join("");
  return `[${negated ? "^" : ""}${body}]`;
}

/** Go's `canonicalName`: separators dropped, first letter up, the rest down. */
function canonicalName(name: string): string {
  let out = "";
  let first = true;
  for (const ch of name) {
    if (ch === "_" || ch === "-" || ch === " ") continue;
    if (first) {
      out += ch >= "a" && ch <= "z" ? ch.toUpperCase() : ch;
      first = false;
    } else {
      out += ch >= "A" && ch <= "Z" ? ch.toLowerCase() : ch;
    }
  }
  return out;
}

/**
 * A Unicode class name as Go 1.26 resolves it, in JavaScript's spelling, or
 * `undefined` when Go knows no such class.
 */
function unicodeClass(name: string, positive: boolean): ClassItems | undefined {
  const canonical = canonicalName(name);
  const property = (value: string, sign: boolean): ClassItems => ({
    ranges: [],
    properties: [`\\${sign ? "p" : "P"}{${value}}`],
  });
  const ranges = (r: Range[]): ClassItems => ({
    ranges: positive ? r : complement(r),
    properties: [],
  });
  switch (canonical) {
    case "Any":
      return ranges([[0, MAX_RUNE]]);
    case "Assigned":
      return property("Cn", !positive);
    case "Ascii":
      return ranges([[0, 0x7f]]);
    case "Lc":
      return property("LC", positive);
  }
  if (CATEGORIES.has(canonical)) return property(canonical, positive);
  if (SCRIPTS.has(canonical)) return property(`Script=${canonical}`, positive);
  const alias = CATEGORY_ALIASES[canonical];
  if (alias !== undefined) return property(alias, positive);
  return undefined;
}

/**
 * Translate one RE2 expression, or `null` when Go's `regexp.Compile` would
 * refuse it.
 */
export function translateRe2(expr: string): string | null {
  try {
    return new Translator(expr).run();
  } catch (error) {
    if (error instanceof Refused) return null;
    throw error;
  }
}

class Translator {
  private readonly cps: number[];
  private at = 0;
  private readonly parts: Part[] = [];
  private depth = 0;

  constructor(expr: string) {
    this.cps = Array.from(expr, (ch) => ch.codePointAt(0) ?? 0);
  }

  private peek(offset = 0): number | undefined {
    return this.cps[this.at + offset];
  }

  private ch(offset = 0): string {
    const c = this.peek(offset);
    return c === undefined ? "" : String.fromCodePoint(c);
  }

  private push(text: string, kind: Part["kind"] = "atom"): void {
    this.parts.push({ text, kind, product: 1 });
  }

  run(): string {
    let lastWasRepeat = false;
    while (this.at < this.cps.length) {
      const c = this.ch();
      let repeated = false;
      switch (c) {
        case "(":
          // `(?` cannot reach here from a planning pattern — `patterns.ts`
          // escapes every `?` — but Go reads it as flags or a named group, and
          // nothing below models either, so refusing is the honest answer.
          if (this.ch(1) === "?") throw new Refused();
          this.parts.push({ text: "(", kind: "open", product: 1 });
          this.depth++;
          this.at++;
          break;
        case "|":
          this.parts.push({ text: "|", kind: "bar", product: 1 });
          this.at++;
          break;
        case ")":
          this.closeGroup();
          this.at++;
          break;
        case "^":
          this.push("^", "assertion");
          this.at++;
          break;
        case "$":
          this.push("$", "assertion");
          this.at++;
          break;
        case ".":
          this.push("[^\\n]");
          this.at++;
          break;
        case "[":
          this.push(this.parseClass());
          break;
        case "*":
        case "+":
        case "?":
          this.at++;
          this.repeat(c, 0, 0, lastWasRepeat);
          repeated = true;
          break;
        case "{": {
          const parsed = this.parseRepeat();
          if (parsed === undefined) {
            // Not a well-formed `{n}`, `{n,}` or `{n,m}`: a literal brace.
            this.push(literal(0x7b));
            this.at++;
            break;
          }
          const { min, max, end } = parsed;
          if (min < 0 || min > 1000 || max > 1000 || (max >= 0 && min > max)) {
            throw new Refused();
          }
          const text = this.cps
            .slice(this.at, end)
            .map((x) => String.fromCodePoint(x))
            .join("");
          this.at = end;
          this.repeat(text, min, max, lastWasRepeat);
          repeated = true;
          break;
        }
        case "\\":
          this.escapeOutsideClass();
          break;
        default:
          this.push(literal(this.peek() ?? 0));
          this.at++;
      }
      lastWasRepeat = repeated;
    }
    if (this.depth !== 0) throw new Refused();
    return this.parts.map((part) => part.text).join("");
  }

  /** Go's `parseRightParen`: fold everything since the matching `(` into one atom. */
  private closeGroup(): void {
    if (this.depth === 0) throw new Refused();
    let product = 1;
    const inner: string[] = [];
    for (;;) {
      const part = this.parts.pop();
      if (part === undefined) throw new Refused();
      if (part.kind === "open") break;
      inner.unshift(part.text);
      product = Math.max(product, part.product);
    }
    this.depth--;
    this.parts.push({ text: `(?:${inner.join("")})`, kind: "atom", product });
  }

  /**
   * Go's `repeat`: stacked repetition is an error in Perl mode, there must be
   * something to repeat, and a counted repetition may not multiply out past
   * 1,000 copies of its innermost operand (`repeatIsValid`).
   */
  private repeat(
    operator: string,
    min: number,
    max: number,
    lastWasRepeat: boolean,
  ): void {
    let lazy = "";
    if (this.ch() === "?") {
      lazy = "?";
      this.at++;
    }
    if (lastWasRepeat) throw new Refused();
    const top = this.parts[this.parts.length - 1];
    if (top === undefined || top.kind === "open" || top.kind === "bar") {
      throw new Refused();
    }
    const counted = operator.startsWith("{");
    let product = top.product;
    if (counted) {
      const m = max === -1 ? min : max;
      product = m === 0 ? 1 : m * top.product;
      if ((min >= 2 || max >= 2) && product > 1000) throw new Refused();
    }
    const base = top.kind === "assertion" ? `(?:${top.text})` : top.text;
    this.parts[this.parts.length - 1] = {
      text: `${base}${operator}${lazy}`,
      kind: "atom",
      product,
    };
  }

  /**
   * Go's `parseRepeat`: `{n}`, `{n,}` or `{n,m}` with no leading zeros, or
   * `undefined` when the text is not of that form. A number too large to read
   * comes back as `min: -1`, which the caller refuses.
   */
  private parseRepeat(): { min: number; max: number; end: number } | undefined {
    let i = this.at + 1;
    const int = (): number | undefined => {
      const start = i;
      const first = this.cps[i];
      if (first === undefined || first < 0x30 || first > 0x39) return undefined;
      const second = this.cps[i + 1];
      if (
        first === 0x30 &&
        second !== undefined &&
        second >= 0x30 &&
        second <= 0x39
      ) {
        return undefined;
      }
      let n = 0;
      while (i < this.cps.length) {
        const d = this.cps[i];
        if (d === undefined || d < 0x30 || d > 0x39) break;
        if (n !== -1) n = n >= 1e8 ? -1 : n * 10 + (d - 0x30);
        i++;
      }
      return i === start ? undefined : n;
    };
    let min = int();
    if (min === undefined) return undefined;
    let max: number;
    const sep = this.cps[i];
    if (sep === undefined) return undefined;
    if (sep !== 0x2c) {
      max = min;
    } else {
      i++;
      const next = this.cps[i];
      if (next === undefined) return undefined;
      if (next === 0x7d) {
        max = -1;
      } else {
        const parsed = int();
        if (parsed === undefined) return undefined;
        max = parsed;
        if (max < 0) min = -1;
      }
    }
    if (this.cps[i] !== 0x7d) return undefined;
    return { min, max, end: i + 1 };
  }

  /** A backslash outside a class, in the order Go's main loop tries them. */
  private escapeOutsideClass(): void {
    const next = this.ch(1);
    switch (next) {
      case "A":
        this.push("^", "assertion");
        this.at += 2;
        return;
      case "z":
        this.push("$", "assertion");
        this.at += 2;
        return;
      case "b":
        this.push("\\b", "assertion");
        this.at += 2;
        return;
      case "B":
        this.push("\\B", "assertion");
        this.at += 2;
        return;
      case "C":
        throw new Refused();
      case "Q": {
        // `\Q…\E` is literal text, to `\E` or to the end.
        this.at += 2;
        while (this.at < this.cps.length) {
          if (this.ch() === "\\" && this.ch(1) === "E") {
            this.at += 2;
            break;
          }
          this.push(literal(this.peek() ?? 0));
          this.at++;
        }
        return;
      }
    }
    const unicode = this.parseUnicodeClass();
    if (unicode !== undefined) {
      this.push(
        unicode.ranges.length === 0 && unicode.properties.length === 1
          ? (unicode.properties[0] ?? "")
          : classText(unicode, false),
      );
      return;
    }
    const perl = this.parsePerlClass();
    if (perl !== undefined) {
      this.push(classText(perl, false));
      return;
    }
    this.push(literal(this.parseEscape()));
  }

  /** `\d`, `\D`, `\s`, `\S`, `\w`, `\W`, as ranges; `undefined` for anything else. */
  private parsePerlClass(): ClassItems | undefined {
    if (this.ch() !== "\\") return undefined;
    const letter = this.ch(1);
    const group = PERL_GROUPS[letter.toLowerCase()];
    if (group === undefined || !/^[dswDSW]$/.test(letter)) return undefined;
    this.at += 2;
    return {
      ranges: letter === letter.toLowerCase() ? [...group] : complement(group),
      properties: [],
    };
  }

  /** Go's `parseUnicodeClass`: `\pL`, `\p{Name}`, `\p{^Name}`, `\P…`. */
  private parseUnicodeClass(): ClassItems | undefined {
    if (this.ch() !== "\\") return undefined;
    const p = this.ch(1);
    if (p !== "p" && p !== "P") return undefined;
    let positive = p === "p";
    const first = this.peek(2);
    if (first === undefined) return undefined;
    let name: string;
    if (first !== 0x7b) {
      name = String.fromCodePoint(first);
      this.at += 3;
    } else {
      let end = this.at + 3;
      while (end < this.cps.length && this.cps[end] !== 0x7d) end++;
      if (end >= this.cps.length) throw new Refused();
      name = this.cps
        .slice(this.at + 3, end)
        .map((x) => String.fromCodePoint(x))
        .join("");
      this.at = end + 1;
    }
    if (name.startsWith("^")) {
      positive = !positive;
      name = name.slice(1);
    }
    const items = unicodeClass(name, positive);
    if (items === undefined) throw new Refused();
    return items;
  }

  /** Go's `parseEscape`: one escaped character, or a refusal. */
  private parseEscape(): number {
    this.at++; // the backslash
    const c = this.peek();
    if (c === undefined) throw new Refused();
    this.at++;
    const ch = String.fromCodePoint(c);
    if (c >= 0x31 && c <= 0x37 && !isOctal(this.peek())) {
      // A lone `\1`–`\7` is a backreference, which RE2 does not support.
      throw new Refused();
    }
    if (c >= 0x30 && c <= 0x37) {
      let r = c - 0x30;
      for (let i = 1; i < 3; i++) {
        const d = this.peek();
        if (!isOctal(d)) break;
        r = r * 8 + (d - 0x30);
        this.at++;
      }
      return r;
    }
    switch (ch) {
      case "x": {
        const next = this.peek();
        if (next === undefined) throw new Refused();
        this.at++;
        if (next === 0x7b) {
          let r = 0;
          let digits = 0;
          for (;;) {
            const d = this.peek();
            if (d === undefined) throw new Refused();
            this.at++;
            if (d === 0x7d) break;
            const v = unhex(d);
            if (v < 0) throw new Refused();
            r = r * 16 + v;
            if (r > MAX_RUNE) throw new Refused();
            digits++;
          }
          if (digits === 0) throw new Refused();
          return r;
        }
        const x = unhex(next);
        const second = this.peek();
        this.at++;
        const y = second === undefined ? -1 : unhex(second);
        if (x < 0 || y < 0) throw new Refused();
        return x * 16 + y;
      }
      case "a":
        return 0x07;
      case "f":
        return 0x0c;
      case "n":
        return 0x0a;
      case "r":
        return 0x0d;
      case "t":
        return 0x09;
      case "v":
        return 0x0b;
    }
    // Escaped punctuation is itself; `\q`, `\é` and the like are errors.
    if (c < 0x80 && !isAlnum(c)) return c;
    throw new Refused();
  }

  /** Go's `parseClass`, from `[` through its closing `]`. */
  private parseClass(): string {
    this.at++; // [
    let negated = false;
    if (this.ch() === "^") {
      negated = true;
      this.at++;
    }
    const items: ClassItems = { ranges: [], properties: [] };
    let first = true;
    while (this.at >= this.cps.length || this.ch() !== "]" || first) {
      first = false;
      if (this.at >= this.cps.length) throw new Refused();

      // `[:name:]`, when a `:]` follows; a lone `[` is a literal.
      if (this.ch() === "[" && this.ch(1) === ":") {
        const rest = this.cps
          .slice(this.at + 2)
          .map((x) => String.fromCodePoint(x))
          .join("");
        const close = rest.indexOf(":]");
        if (close >= 0) {
          let name = rest.slice(0, close);
          let positive = true;
          if (name.startsWith("^")) {
            positive = false;
            name = name.slice(1);
          }
          const group = Object.hasOwn(POSIX_GROUPS, name)
            ? POSIX_GROUPS[name]
            : undefined;
          if (group === undefined) throw new Refused();
          items.ranges.push(...(positive ? group : complement(group)));
          this.at += 2 + Array.from(rest.slice(0, close + 2)).length;
          continue;
        }
      }

      const unicode = this.parseUnicodeClass();
      if (unicode !== undefined) {
        items.ranges.push(...unicode.ranges);
        items.properties.push(...unicode.properties);
        continue;
      }
      const perl = this.parsePerlClass();
      if (perl !== undefined) {
        items.ranges.push(...perl.ranges);
        continue;
      }

      const lo = this.classChar();
      let hi = lo;
      if (
        this.ch() === "-" &&
        this.peek(1) !== undefined &&
        this.ch(1) !== "]"
      ) {
        this.at++;
        hi = this.classChar();
        if (hi < lo) throw new Refused();
      }
      items.ranges.push([lo, hi]);
    }
    this.at++; // ]
    return classText(items, negated);
  }

  /** Go's `parseClassChar`: an escape, or one literal code point. */
  private classChar(): number {
    const c = this.peek();
    if (c === undefined) throw new Refused();
    if (c === 0x5c) return this.parseEscape();
    this.at++;
    return c;
  }
}
