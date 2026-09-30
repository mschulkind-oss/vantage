/**
 * Where the reader is on the planning page, for the planning outline to mark
 * (`components/PlanningOutline.tsx`): the section, and the document whose
 * card or row is being read, measured as the pane scrolls.
 */
import { useEffect, useState } from "react";
import type { SectionId } from "../lib/planningPages";

/** Where the reader is, as the outline marks it. */
export interface OutlineActive {
  section: SectionId | null;
  /** The document whose card or row is being read, in `section`. */
  path: string | null;
}

export const NOWHERE: OutlineActive = { section: null, path: null };

/**
 * One thing on screen the outline can mark: a section's heading, whose `id`
 * is the section's, or a document's card or row, by the id it carries.
 */
export interface OutlineTarget {
  section: SectionId;
  path: string | null;
  id: string;
}

/**
 * How far below the top of the scroll container a target may be and still
 * be the one being read: the table of contents' own band
 * (`hooks/useDocumentOutline.ts`).
 */
const ACTIVE_BAND = 96;

/**
 * The target being read, given each one's offset from the top of the scroll
 * container, in page order: the last at or above the band, or the first
 * when the reader is above them all.
 *
 * Scrolled to the end, `bottom` gives the container's height, and it is the
 * last target on screen instead: the page's last section can be too short to
 * ever reach the band, and an outline entry that brought it into view would
 * otherwise mark the section above it.
 */
export function activeTarget(
  offsets: readonly { target: OutlineTarget; top: number }[],
  bottom: number | null = null,
): OutlineTarget | null {
  let active = offsets[0]?.target ?? null;
  for (const { target, top } of offsets) {
    if (top > (bottom ?? ACTIVE_BAND)) break;
    active = target;
  }
  return active;
}

/** The container's height when it is scrolled to its end, else `null`. */
function heightAtEnd(container: HTMLElement): number | null {
  const { scrollTop, clientHeight, scrollHeight } = container;
  return scrollHeight > clientHeight &&
    scrollTop + clientHeight >= scrollHeight - 1
    ? clientHeight
    : null;
}

/**
 * Where the reader is among `targets`, measured in `container` as it
 * scrolls, resizes and changes what it shows. A target not on screen, a card
 * of a page not shown, is left out. Measures nothing while `enabled` is off.
 */
export function usePlanningOutlineActive(
  container: HTMLElement | null,
  targets: readonly OutlineTarget[],
  enabled: boolean,
): OutlineActive {
  const [active, setActive] = useState<OutlineActive>(NOWHERE);

  useEffect(() => {
    if (!enabled || container === null || targets.length === 0) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const top = container.getBoundingClientRect().top;
      const offsets = targets.flatMap((target) => {
        const el = document.getElementById(target.id);
        return el === null || !container.contains(el)
          ? []
          : [{ target, top: el.getBoundingClientRect().top - top }];
      });
      const found = activeTarget(offsets, heightAtEnd(container));
      const next =
        found === null ? NOWHERE : { section: found.section, path: found.path };
      setActive((prev) =>
        prev.section === next.section && prev.path === next.path ? prev : next,
      );
    };
    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(measure);
    };
    measure();
    container.addEventListener("scroll", onScroll, { passive: true });
    // A resize reflows the page without scrolling it.
    window.addEventListener("resize", onScroll);
    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [container, targets, enabled]);

  return enabled ? active : NOWHERE;
}
