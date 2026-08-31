import type { Code, Root } from "mdast";
import { visit } from "unist-util-visit";
import type { Collector } from "../core/collector.js";

const RULE = "mermaid/parse";

/**
 * A diagram that must parse if the environment is sound: the style guide's own
 * flowchart example, quoted labels and all. See `ensureMermaid`.
 */
const CANARY = [
  "flowchart TD",
  '    client["Client (React SPA)"] -->|WebSocket| srv["Vantage Server (Go)"]',
].join("\n");

interface MermaidModule {
  parse(text: string): Promise<unknown>;
}

type Loaded =
  { ok: true; mermaid: MermaidModule } | { ok: false; message: string };

let loaded: Promise<Loaded> | undefined;

/** Every ```mermaid fence in the document, in source order. */
export function collectDiagrams(tree: Root): Code[] {
  const diagrams: Code[] = [];
  visit(tree, "code", (node) => {
    if ((node.lang ?? "").toLowerCase() === "mermaid") diagrams.push(node);
  });
  return diagrams;
}

export async function checkMermaid(collector: Collector): Promise<void> {
  const diagrams = collectDiagrams(collector.doc.mdast);
  if (diagrams.length === 0 || !collector.enabled(RULE)) return;

  const mermaid = await ensureMermaid();
  if (!mermaid.ok) {
    collector.fail(RULE, mermaid.message);
    return;
  }

  for (const node of diagrams) {
    try {
      await mermaid.mermaid.parse(node.value);
    } catch (error) {
      const classified = classify(error, node.value);
      if (classified.kind === "environment") {
        collector.fail(RULE, classified.message);
        continue;
      }

      const fence = collector.at(node);
      collector.report(
        RULE,
        {
          // The diagram's first line is the one after the opening fence.
          line: fence.line + (classified.line ?? 0),
          column: fence.column,
        },
        "Mermaid cannot parse this diagram, so Vantage renders an error box in its place.",
        classified.message,
      );
    }
  }
}

/**
 * Load mermaid so it can parse without a browser, and prove it worked.
 *
 * Two measured facts drive all of this (mermaid 11.12.2, Node 22):
 *
 * 1. A *valid* flowchart throws `TypeError: DOMPurify.addHook is not a
 *    function`. Mermaid's grammar layer is fine headless; the sanitisation step
 *    it runs over labels is not, because with no DOM the `dompurify` module
 *    exports its factory function rather than a configured instance. Treating
 *    that throw as a finding would report every valid flowchart in a repository
 *    as broken, which is the fastest possible way to make an agent stop running
 *    the tool.
 * 2. `@mermaid-js/parser` is not the escape hatch it looks like: it covers only
 *    the newer Langium grammars and answers `Unknown diagram type: flowchart`.
 *
 * The fix is four no-op methods on the dompurify export, installed *before*
 * mermaid is imported, since mermaid calls `addHook` at module-init time. That
 * is why both imports are dynamic and ordered. Sanitisation output does not
 * matter to a parse check — only that the call exists.
 *
 * Then the canary: a diagram we know is valid is parsed before any of the
 * document's are. If that fails, the shim did not take (a hoisted second copy
 * of dompurify, a mermaid release that needs more of a DOM) and the rule
 * reports *nothing* about anybody's document — it fails the run instead.
 */
async function ensureMermaid(): Promise<Loaded> {
  loaded ??= (async (): Promise<Loaded> => {
    try {
      const dompurify = (await import("dompurify"))
        .default as unknown as Record<string, unknown>;
      for (const method of [
        "addHook",
        "removeHook",
        "setConfig",
        "clearConfig",
      ]) {
        if (typeof dompurify[method] !== "function") {
          dompurify[method] = () => {};
        }
      }
      if (typeof dompurify["sanitize"] !== "function") {
        dompurify["sanitize"] = (value: unknown) => String(value);
      }

      const mermaid = (await import("mermaid"))
        .default as unknown as MermaidModule;
      await mermaid.parse(CANARY);
      return { ok: true, mermaid };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `mermaid cannot parse in this environment (${message}), so no diagram was checked`,
      };
    }
  })();

  return loaded;
}

/** Reset the memoised loader. Tests only. */
export function resetMermaid(): void {
  loaded = undefined;
}

interface Classified {
  kind: "document" | "environment";
  message: string;
  /** 1-based line within the diagram source, when the error gave one. */
  line?: number;
}

/**
 * Is mermaid rejecting the *diagram*, or failing to run?
 *
 * Only shapes mermaid produces deliberately count as a verdict on the
 * document: a jison parse error (which carries a `hash`), a Langium parse
 * error ("Parsing failed: …"), and an unrecognised diagram type. Everything
 * else — TypeError, ReferenceError, anything reaching for a browser — means we
 * did not manage to check, and says so.
 */
export function classify(error: unknown, source: string): Classified {
  const message = error instanceof Error ? error.message : String(error);
  const name = (error as { name?: string } | undefined)?.name;
  const hasJisonHash =
    typeof error === "object" && error !== null && "hash" in error;

  if (hasJisonHash || /^Parse error(?: on line (\d+))?/.test(message)) {
    const line = /Parse error on line (\d+)/.exec(message)?.[1];
    return {
      kind: "document",
      message,
      ...(line ? { line: Number(line) } : {}),
    };
  }

  if (
    name === "UnknownDiagramError" ||
    /^No diagram type detected/.test(message)
  ) {
    return { kind: "document", message };
  }

  if (/^Parsing failed:/.test(message)) {
    const offset = /at offset: (\d+)/.exec(message)?.[1];
    return {
      kind: "document",
      message,
      ...(offset ? { line: lineOfOffset(source, Number(offset)) } : {}),
    };
  }

  return { kind: "environment", message };
}

/** 1-based line containing a character offset. */
function lineOfOffset(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < Math.min(offset, source.length); index++) {
    if (source[index] === "\n") line++;
  }
  return line;
}
