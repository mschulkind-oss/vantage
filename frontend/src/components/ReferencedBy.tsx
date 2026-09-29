/**
 * Referenced by: the planning documents that link to this one or to one of its
 * questions (`docs/design/planning-index.md` §7), one entry per linking
 * document and heading, as `referencedBy` derives them.
 *
 * It sits inside the prose container, directly after the frontmatter card, so
 * it is built from elements nothing there reads as the document: no heading,
 * which the contents column would list; no `[data-vantage-oq]`; no `p` or `li`,
 * which review mode's hover would offer to comment on; and no `data-source-line`,
 * so no review anchor can land on it. `not-prose` keeps typography's list and
 * paragraph styles off it, as they are off the frontmatter card.
 */
import type { Reference } from "vantage-md/planning";
import { AppLink } from "./AppLink";

interface ReferencedByProps {
  references: readonly Reference[];
  /** The viewer URL of a repository path, `/{repo}/…` in daemon mode. */
  hrefFor: (path: string) => string;
}

/** Marks the list, for tests and for any pass that must step around it. */
export const REFERENCED_BY_ATTR = "data-vantage-referenced-by";

export function ReferencedBy({ references, hrefFor }: ReferencedByProps) {
  if (references.length === 0) return null;
  return (
    <nav
      aria-label="Referenced by"
      {...{ [REFERENCED_BY_ATTR]: "" }}
      className="not-prose mb-6 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400"
    >
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider">
        Referenced by
      </div>
      <div role="list" className="flex flex-col gap-0.5">
        {references.map((ref) => (
          <div role="listitem" key={`${ref.from}\n${ref.heading ?? ""}`}>
            {/* To the linking line itself, which `#L…` scrolls to and marks. */}
            <AppLink
              to={`${hrefFor(ref.from)}#L${ref.line}`}
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              {ref.from}
            </AppLink>
            {ref.heading !== null && (
              <span className="text-slate-500 dark:text-slate-400">
                {" · "}
                {ref.heading}
              </span>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}
