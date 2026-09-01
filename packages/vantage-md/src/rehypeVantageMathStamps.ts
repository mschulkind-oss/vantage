/**
 * The two halves of one repair: carry a display-math block's own attributes
 * across the element swap `rehype-katex` performs.
 *
 * `$$…$$` (and a ` ```math ` fence) reaches rehype as `<pre><code
 * class="language-math">`. `pre` is in `VANTAGE_STYLE_TARGETS`, so
 * `rehypeVantageDirectives` stamps it like any other block — it becomes a real
 * member of a toned section's run, and `rehypeSourceLines` has already given it
 * a `data-source-line`. Then `rehype-katex` reaches the same node, and for a
 * `code.language-math` inside a `pre` it takes the **`pre`** as its scope and
 * does `parent.children.splice(index, 1, …result)`: the stamped element is
 * *replaced* by a fresh `<span class="katex-display">`, and every attribute on
 * it dies with it.
 *
 * Measured consequences, all three of them silent:
 *
 *   - the section's vertical rule breaks across the formula. The rule is drawn
 *     per member and bled upward by a fixed 40px, so the void is about the
 *     formula's own height — 58px for a one-line fraction over the real
 *     Tailwind build, more for a matrix — and the section reads as two;
 *   - `#L` line anchors and review highlights stop resolving to the formula,
 *     because `data-source-line` went with it;
 *   - `collapsed=true` over a heading whose body includes a formula hides the
 *     prose and leaves the formula on screen, since `data-vantage-collapsed`
 *     never reached the span the toggle JS can see.
 *
 * The fix is to snapshot before and re-apply after, which is why this is a pair
 * and why the pair must bracket `rehype-katex` in `pipeline.ts`. Registering
 * only one half is inert, not wrong: capture alone writes to `file.data` and
 * nothing reads it, restore alone finds nothing to restore.
 *
 * Both halves run *after* `rehype-sanitize` — which is not a detail, twice
 * over. `rehype-sanitize` rebuilds the tree, so node identities taken before it
 * would all be stale; and every attribute carried here is one the sanitiser
 * already passed on the node it came from, so nothing here can reintroduce
 * markup the schema rejects.
 */

import type { Element, Parents, Properties, Root, RootContent } from "hast";
import type { Plugin } from "unified";

/**
 * Where the snapshot lives between the two halves.
 *
 * `file.data` rather than a closure or a module-level map: `buildPipeline` is
 * allowed to be built once and run over many documents, and per-file state is
 * the only kind that cannot leak from one of those to the next.
 */
const CARRIED_KEY = "vantageDisplayMathStamps";

/** The narrowest shape of the VFile these two need. */
interface StampFile {
  data: Record<string, unknown>;
}

interface CarriedStamp {
  /** The stamped `<pre>`'s parent, which `rehype-katex` never replaces. */
  parent: Parents;
  /**
   * The sibling immediately before the `<pre>`, or `undefined` when it was the
   * first child. This is how the replacement is found again: surviving nodes
   * keep their identity across the splice, so the node one past the anchor is
   * whatever took the `<pre>`'s place, however many other blocks were rewritten
   * elsewhere in the tree.
   */
  anchor: RootContent | undefined;
  properties: Properties;
}

function classNames(node: Element): string[] {
  const value = node.properties?.className;
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * A `<pre>` `rehype-katex` will replace — its own condition, restated.
 *
 * `language-math` is the only class to test: `rehype-katex` keys the
 * pre-as-scope branch on it, and the sanitiser strips the `math-display` that
 * `remark-math` also emits (measured — a stamped fence arrives here with
 * `className: ["language-math"]` alone).
 */
function isDisplayMath(node: RootContent): node is Element {
  if (node.type !== "element" || node.tagName !== "pre") return false;
  return node.children.some(
    (child) =>
      child.type === "element" &&
      child.tagName === "code" &&
      classNames(child).includes("language-math"),
  );
}

/**
 * What is worth carrying: everything this pipeline stamped itself.
 *
 * Deliberately not the whole property bag. `className`, `style` and `id` belong
 * to the element KaTeX is about to build, and copying a `<pre>`'s onto a
 * `<span class="katex-display">` would fight it.
 */
function carriedProperties(properties: Properties | undefined): Properties {
  const carried: Properties = {};
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (key === "dataSourceLine" || key.startsWith("dataVantage")) {
      carried[key] = value;
    }
  }
  return carried;
}

function collect(parent: Parents, out: CarriedStamp[]) {
  const children: RootContent[] = parent.children;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type !== "element") continue;
    if (isDisplayMath(node)) {
      const properties = carriedProperties(node.properties);
      // An unstamped formula needs nothing carried, and recording it would only
      // give the restore pass a node to touch for no reason.
      if (Object.keys(properties).length > 0) {
        out.push({
          parent,
          anchor: i === 0 ? undefined : children[i - 1],
          properties,
        });
      }
      continue;
    }
    collect(node, out);
  }
}

function reapply(carried: CarriedStamp[]) {
  for (const { parent, anchor, properties } of carried) {
    // One annotation, because `Parents["children"]` is a union of two array
    // types and `indexOf` on a union has no callable signature.
    const siblings: RootContent[] = parent.children;
    let index = 0;
    if (anchor !== undefined) {
      const at = siblings.indexOf(anchor);
      // The anchor was itself rewritten — two formulae with no node between
      // them, which mdast-to-hast does not produce (it separates siblings with
      // newline text nodes) but raw HTML could. Give up on this one rather than
      // guess: the result is the unrepaired gap, never a stamp on the wrong
      // block.
      if (at === -1) continue;
      index = at + 1;
    }
    const replacement = siblings[index];
    if (replacement === undefined || replacement.type !== "element") continue;
    // KaTeX emits `katex-display` normally and `katex-error` when the formula
    // does not parse; both are the block that took the `<pre>`'s place, and
    // anything else means the tree is not the shape this assumed.
    if (!classNames(replacement).some((name) => name.startsWith("katex"))) {
      continue;
    }
    replacement.properties ??= {};
    for (const [key, value] of Object.entries(properties)) {
      replacement.properties[key] ??= value;
    }
  }
}

/** Snapshot every stamped display-math block. Register before `rehypeKatex`. */
export const rehypeCaptureMathStamps: Plugin<[], Root> = () => {
  return (tree: Root, file: StampFile) => {
    const carried: CarriedStamp[] = [];
    collect(tree, carried);
    file.data[CARRIED_KEY] = carried;
  };
};

/** Re-apply the snapshot. Register immediately after `rehypeKatex`. */
export const rehypeRestoreMathStamps: Plugin<[], Root> = () => {
  return (_tree: Root, file: StampFile) => {
    const carried = file.data[CARRIED_KEY];
    delete file.data[CARRIED_KEY];
    if (Array.isArray(carried)) reapply(carried as CarriedStamp[]);
  };
};
