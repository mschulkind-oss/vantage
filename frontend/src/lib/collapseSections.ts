/**
 * The DOM half of `collapsed` — `docs/design/inline-markup.md` §4.3.
 *
 * `rehypeVantageDirectives` compiles `<!-- vantage: section collapsed=true -->`
 * into a flat stamp over siblings: `data-vantage-collapse-toggle="N"` on the
 * heading, and `data-vantage-collapsed="true"` plus
 * `data-vantage-collapse-group="N"` on each block it hides. There is no
 * `<details>` and no wrapper, so collapsing a section is one attribute write per
 * block and expanding it is the same — which is what lets a line anchor or a
 * review comment force a section open without restructuring anything.
 *
 * Nothing here hides anything by itself. The CSS that does is gated on
 * `data-vantage-collapse-ready`, which `useCollapseSections` sets on the prose
 * container only after it has attached its handlers: a renderer with no JS shows
 * the whole document rather than hiding blocks nobody can reveal (P1/D8).
 *
 * Split out of the hook because three unrelated callers need to force a section
 * open — the hook, the `#L42` line anchor, and the review highlighter — and only
 * one of them is a React hook.
 */

export const COLLAPSE_READY_ATTR = "data-vantage-collapse-ready";
export const COLLAPSE_TOGGLE_ATTR = "data-vantage-collapse-toggle";
export const COLLAPSE_GROUP_ATTR = "data-vantage-collapse-group";
export const COLLAPSED_ATTR = "data-vantage-collapsed";

/**
 * Marks the caret the hook injects. Two jobs, the same two as the Open Question
 * button's marker: the sweep at the top of each pass finds them, and
 * `REVIEW_UI_SELECTOR` excludes them from block hashes.
 *
 * A document cannot forge it — `data-vantage-collapse-caret` is not on the
 * sanitiser's allowlist and `button` is not an allowed tag name.
 */
export const COLLAPSE_CARET_ATTR = "data-vantage-collapse-caret";

/**
 * A group id, as the plugin mints them: digits only.
 *
 * Checked on the way out of the DOM and not merely on the way in, because these
 * values are interpolated into selectors. The sanitiser already refuses anything
 * else, so this is the second gate rather than the first.
 */
const GROUP_ID = /^[0-9]+$/;

/** The validated group id in `attribute`, or `null` — never a selector input. */
export function collapseGroupOf(
  element: Element,
  attribute: string,
): string | null {
  const value = element.getAttribute(attribute);
  return value !== null && GROUP_ID.test(value) ? value : null;
}

/** Every block group `group` hides, in document order. */
export function groupMembers(root: Element, group: string): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(`[${COLLAPSE_GROUP_ATTR}="${group}"]`),
  );
}

/** The heading that toggles `group`. */
export function groupToggle(root: Element, group: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `[${COLLAPSE_TOGGLE_ATTR}="${group}"]`,
  );
}

/** Whether `group` is currently showing. A group with no members reads open. */
export function isGroupExpanded(root: Element, group: string): boolean {
  return groupMembers(root, group).every(
    (member) => member.getAttribute(COLLAPSED_ATTR) !== "true",
  );
}

/** Point the group's caret, if the hook has injected one, at the new state. */
function syncCaret(root: Element, group: string, expanded: boolean): void {
  const caret = groupToggle(root, group)?.querySelector(
    `[${COLLAPSE_CARET_ATTR}]`,
  );
  caret?.setAttribute("aria-expanded", String(expanded));
}

/**
 * Show or hide every member of `group`.
 *
 * `"false"` rather than removing the attribute: the group id stays, so the same
 * toggle can close what it opened, and a live content update that re-renders the
 * markup does not silently forget which sections the reader had opened.
 *
 * Collapsing recurses into nested groups; expanding deliberately does not. A
 * `###` inside a collapsed `##` is both a member of the outer group and the
 * toggle for its own, so closing the outer section has to close the inner one
 * too — otherwise its blocks stay on screen with their heading gone. Opening the
 * outer section, by contrast, leaves the inner one as the reader left it.
 */
export function setGroupCollapsed(
  root: Element,
  group: string,
  collapsed: boolean,
  seen: Set<string> = new Set(),
): void {
  if (seen.has(group)) return;
  seen.add(group);

  for (const member of groupMembers(root, group)) {
    member.setAttribute(COLLAPSED_ATTR, collapsed ? "true" : "false");
    const nested = collapseGroupOf(member, COLLAPSE_TOGGLE_ATTR);
    if (collapsed && nested !== null) {
      setGroupCollapsed(root, nested, true, seen);
    }
  }
  syncCaret(root, group, !collapsed);
}

/**
 * Force every collapsed section around `node` open, and say whether anything
 * was.
 *
 * This is why the design stamps an attribute instead of wrapping the section in
 * `<details>`: a `#L42` link, a heading anchor or a review comment that lands
 * inside a closed section has to open it, or the scroll targets a zero-height
 * box and the reader is looking at nothing. Here that is an attribute write.
 *
 * The walk goes up by *group*, not by DOM ancestry, because the run is flat: the
 * heading that toggles the group may itself be a hidden member of the group
 * around it, and only closing that loop reveals a nested section's blocks
 * together with the heading that explains them.
 */
export function revealCollapsedBlock(node: Element | null): boolean {
  if (!node) return false;
  // The marker the hiding CSS is gated on. Without it nothing is hidden, so
  // there is nothing to reveal and no container to resolve the group against.
  const root = node.closest(`[${COLLAPSE_READY_ATTR}]`);
  if (!root) return false;

  const seen = new Set<string>();
  let hidden = node.closest(`[${COLLAPSED_ATTR}="true"]`);
  let revealed = false;
  while (hidden) {
    const group = collapseGroupOf(hidden, COLLAPSE_GROUP_ATTR);
    if (group === null || seen.has(group)) break;
    seen.add(group);
    setGroupCollapsed(root, group, false);
    revealed = true;
    const toggle = groupToggle(root, group);
    hidden = toggle?.closest(`[${COLLAPSED_ATTR}="true"]`) ?? null;
  }
  return revealed;
}
