// The viewer's own reader for the `vantage:` frontmatter key, imported from
// source by relative path — the way this package consumes `vantage-md`
// everywhere (`core/document.ts`, `core/workspace.ts`), because a package-name
// import does not resolve under `bun build --compile`. A checker with its own
// copy of the vocabulary is a checker that disagrees with the viewer about what
// a document says, and neither side would ever say so (D5).
import {
  DOC_STATUSES,
  VANTAGE_FRONTMATTER_KEYS,
  readVantageFrontmatter,
} from "../../../vantage-md/src/vantageFrontmatter.js";
import type { Collector } from "../core/collector.js";
import { orList } from "./directives.js";

/**
 * Vantage's own `vantage:` frontmatter key — file-scoped chrome, checked with
 * the viewer's reader.
 *
 * Same silence as the directive family and the same reason for existing: the
 * viewer drops an unknown key, a wrong-case token or a non-table `vantage:`
 * without a word (P3/D2), so a typo means the chip simply is not there. Nothing
 * else in this tool notices — the frontmatter parsed, the document renders, and
 * every other rule reports green.
 *
 * Every finding points at line 1, column 1, exactly as `frontmatter/unterminated`
 * and `frontmatter/not-a-mapping` do. `parseFrontmatter` returns no per-key
 * positions, and a text scan of the source would break this tool's own rule that
 * findings come from a parser and never from a search — which is what keeps a
 * `vantage:` inside a fenced code sample from being a finding. The message names
 * the key, and the block it is in is a handful of lines.
 */
export function checkVantageFrontmatter(collector: Collector): void {
  const { issues } = readVantageFrontmatter(
    collector.doc.frontmatter.frontmatter,
  );

  for (const issue of issues) {
    const at = { line: 1, column: 1 };

    switch (issue.kind) {
      case "not-a-table":
        collector.report(
          "vantage/frontmatter-shape",
          at,
          `\`vantage:\` is Vantage's own reserved frontmatter key and has to be a table of keys, so ${describe(issue.value)} there configures nothing. Write it as \`vantage:\` with indented \`key: value\` pairs beneath it.`,
        );
        break;

      case "unknown-key":
        // A warning, not an error, and deliberately: a document written for a
        // newer build must not fail an older checker's gate (D3).
        collector.report(
          "vantage/frontmatter-key",
          at,
          `\`${issue.key}\` is not a key \`vantage:\` accepts, so it does nothing at all — no chrome, and no effect on the other keys beside it. This build knows ${orList([...VANTAGE_FRONTMATTER_KEYS])}.`,
        );
        break;

      case "bad-value": {
        const suggestion = nearMiss(issue.value, issue.legal);
        collector.report(
          "vantage/frontmatter-value",
          at,
          `${describe(issue.value)} is not a value \`${issue.key}\` accepts, so no chip is rendered.${suggestion === undefined ? "" : ` Did you mean \`${suggestion}\`?`}`,
          `\`${issue.key}\` accepts ${orList([...issue.legal])}. \`true\` shows the document's own \`status:\` and is the form that cannot disagree with it.`,
        );
        break;
      }

      case "status-chip-orphan":
        collector.report(
          "vantage/status-chip-stale",
          at,
          `\`status-chip: true\` shows the document's own \`status:\`, and ${
            issue.status === undefined
              ? "this document has no `status:` key"
              : `this document's \`status: ${String(issue.status)}\` is not one of ${orList([...DOC_STATUSES])}`
          }, so no chip is rendered.`,
        );
        break;

      case "status-chip-disagrees":
        // Both values are legal, so the chip does render — saying something the
        // document's own metadata contradicts. That is R3's markup rot at file
        // scope, and the reason `status-chip: true` is the recommended form.
        collector.report(
          "vantage/status-chip-stale",
          at,
          `The chip says \`${issue.chip}\` but this document's \`status:\` says \`${String(issue.status)}\`. The chip is what a reader sees, so one of the two is wrong; \`status-chip: true\` inherits \`status:\` and cannot drift from it.`,
        );
        break;
    }
  }
}

/** A legal token this value differs from only in case. */
function nearMiss(
  value: unknown,
  legal: readonly string[],
): string | undefined {
  if (typeof value !== "string") return undefined;
  const folded = value.toLowerCase();
  return legal.find((token) => token.toLowerCase() === folded);
}

/**
 * A value as a reader can recognise it, without printing a whole nested table.
 *
 * `yaml` hands back real JavaScript values — a `Date` for `2026-08-31`, a
 * boolean for `true` — so `String(value)` alone would report a date as a full
 * timestamp and an object as `[object Object]`.
 */
function describe(value: unknown): string {
  if (value === null) return "an empty value";
  if (value === undefined) return "nothing";
  if (Array.isArray(value)) return "a list";
  if (value instanceof Date) return "a date";
  if (typeof value === "object") return "a table";
  return `\`${String(value)}\``;
}
