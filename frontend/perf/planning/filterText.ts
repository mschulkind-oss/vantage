/**
 * How the harness reads a typed text: with the planning filter's own parser
 * (`vantage-md`'s planning module), the one the page and the checker run, so
 * the canonical text a keystroke makes is exactly the page's (P7), and the
 * typing flow can tell which keystrokes change the applied filter (T2): not
 * one whose text is not understood, nor one whose text keeps no entry, which
 * the page holds back until the idle pause (planning-filter.md §6.4).
 *
 * Node runs a `.ts` module by stripping its types and resolves nothing else,
 * while the module imports its siblings as `./x.js`, as a bundler resolves
 * them. The hook registered here gives such an import the `.ts` file beside
 * it, and only when nothing else answers it.
 */
import { register } from "node:module";

const RESOLVE_TS = `export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && specifier.endsWith(".js")) {
      return next(specifier.slice(0, -3) + ".ts", context);
    }
    throw error;
  }
}`;

register(`data:text/javascript,${encodeURIComponent(RESOLVE_TS)}`);

const { applyPlanningFilter, parsePlanningFilter } =
  await import("../../../packages/vantage-md/src/planning/filter.ts");
const { derivePlanningSections } =
  await import("../../../packages/vantage-md/src/planning/sections.ts");

/**
 * What `text` makes the applied filter: its canonical text, `""` for no
 * filter, or `null` when it is not understood, which applies nothing while
 * the reader types (planning-filter.md §6.4).
 */
export function appliedBy(text: string): string | null {
  const filter = parsePlanningFilter(text);
  if (filter.kind === "not-understood") return null;
  return filter.kind === "understood" ? filter.canonical : "";
}

/**
 * Of `texts`, each an applied filter's canonical text, those that keep no
 * entry of `index`'s planning page under its default roadmap, which a typing
 * run's new profile chooses. While the reader types, the page holds such a
 * text back until the idle pause, so a key that makes one changes nothing
 * then, and T2 does not count it (planning-filter.md §6.4, §16).
 */
export function keepingNothing(
  index: Parameters<typeof derivePlanningSections>[0],
  texts: readonly string[],
): string[] {
  const sections = derivePlanningSections(index);
  return [...new Set(texts)].filter((text) => {
    const filter = parsePlanningFilter(text);
    return (
      filter.kind === "understood" &&
      applyPlanningFilter(index, sections, filter).summary.entries.shown === 0
    );
  });
}
