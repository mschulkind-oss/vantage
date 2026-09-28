/**
 * The server's gitignore-style matcher, ported line for line.
 *
 * `[planning] include` and `exclude` use the matcher `[starred] promote`
 * already uses — `sabhiram/go-gitignore`'s `CompileIgnoreLines` — so that a
 * pattern means the same thing to the server, the checker and `promote`
 * (design §3.1, Plan Q1). That matcher is not git's, and its quirks are part of
 * what is being matched, so this is a port rather than a library:
 *
 * - `?` is a literal character, not a one-character wildcard.
 * - A pattern with a slash inside it is not anchored to the root:
 *   `docs/gallery/**` also matches `x/docs/gallery/a.md`. Only a leading `/`,
 *   or a `dir/…*.ext` shape the library anchors for itself, anchors.
 * - `[`, `(`, `\`, `{`, `+`, `|`, `^` and `$` pass through into a Go regular
 *   expression, so they keep their RE2 meaning, and a line RE2 cannot compile
 *   is ignored. `re2.ts` is what makes a JavaScript `RegExp` read them the way
 *   Go does.
 * - The last matching line wins, and a `!` line clears only a match an earlier
 *   line made.
 *
 * `internal/repoconfig/testdata/planning-patterns.json` holds the answers Go
 * gives for a set of lines and paths, and both readers' suites are held to it.
 */

import { translateRe2 } from "./re2.js";

/** The library's placeholder for a `*` that must survive the `*` rewrite. */
const MAGIC_STAR = "#$~";

interface CompiledLine {
  regex: RegExp;
  negate: boolean;
}

/** `strings.Trim(s, " ")`: spaces only, both ends. */
function trimSpaces(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === " ") start++;
  while (end > start && s[end - 1] === " ") end--;
  return s.slice(start, end);
}

/**
 * `getPatternFromLine`, one step per statement of the Go original and in the
 * same order, since each rewrite reads the output of the one before it.
 */
function compileLine(raw: string): CompiledLine | null {
  let line = raw.replace(/\r+$/, "");
  if (line.startsWith("#")) return null;
  line = trimSpaces(line);
  if (line === "") return null;

  let negate = false;
  if (line.startsWith("!")) {
    negate = true;
    line = line.slice(1);
  }
  // `\#` and `\!` were meant to be escapes, but the library's test is for a
  // bare leading `#` or `!`, which it then drops.
  if (/^[#!]/.test(line)) line = line.slice(1);

  // `foo/*.blah` anchors to the root. `[^\n]` stands for Go's `.`, which,
  // unlike JavaScript's, matches `\r`.
  if (/[^/+]\/[^\n]*\*\./u.test(line) && !line.startsWith("/")) {
    line = `/${line}`;
  }

  line = line.replace(/\./g, "\\.");
  if (line.startsWith("/**/")) line = line.slice(1);
  // Function replacements throughout: Go's `ReplaceAllString` leaves `$~`
  // alone, and a string replacement here would give `$` a meaning of its own.
  line = line.replace(/\/\*\*\//g, () => "(/|/.+/)");
  line = line.replace(/\*\*\//g, () => `(|.${MAGIC_STAR}/)`);
  line = line.replace(/\/\*\*/g, () => `(|/.${MAGIC_STAR})`);
  line = line.replace(/\\\*/g, () => `\\${MAGIC_STAR}`);
  line = line.replace(/\*/g, () => "([^/]*)");
  line = line.split("?").join("\\?");
  line = line.split(MAGIC_STAR).join("*");

  let expr = line.endsWith("/") ? `${line}(|.*)$` : `${line}(|/.*)$`;
  expr = expr.startsWith("/") ? `^(|/)${expr.slice(1)}` : `^(|.*/)${expr}`;

  const translated = translateRe2(expr);
  if (translated === null) return null;
  try {
    return { regex: new RegExp(translated, "u"), negate };
  } catch {
    // A class this engine's Unicode tables do not know. Go knew it, so this is
    // a disagreement, but dropping the line is the one answer that cannot
    // match something Go would not.
    return null;
  }
}

/**
 * Compile gitignore-style lines into a matcher for repo-relative,
 * slash-separated paths: `CompileIgnoreLines(lines...).MatchesPath`.
 *
 * Blank lines and `#` comments are skipped, and so is a line whose expression
 * Go would refuse to compile.
 */
export function compileIgnorePatterns(
  lines: readonly string[],
): (path: string) => boolean {
  const compiled: CompiledLine[] = [];
  for (const line of lines) {
    const pattern = compileLine(line);
    if (pattern !== null) compiled.push(pattern);
  }
  return (path) => {
    let matched = false;
    for (const { regex, negate } of compiled) {
      if (!regex.test(path)) continue;
      if (!negate) matched = true;
      else if (matched) matched = false;
    }
    return matched;
  };
}
