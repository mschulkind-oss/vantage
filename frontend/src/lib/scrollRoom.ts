/**
 * Room held at the end of a scroll pane, so content getting shorter near the
 * end does not move what the reader sees.
 *
 * A browser keeps a pane's scroll within what it holds: when the content gets
 * shorter while the reader is near its end, it pulls the scroll back, and
 * everything on screen slides down. A planning card answered near the end of
 * the list shrinking to its row is that (`docs/reference/planning-index.md`
 * §6.4). `holdScrollRoom` adds the padding that keeps the scroll where it is,
 * and gives it back as the reader scrolls away from the end: only what is on
 * screen is kept, so giving it back never moves anything either.
 */

interface Held {
  /** The pane's own inline padding-bottom, put back once nothing is held. */
  inline: string;
  /** Its computed padding-bottom without the room, in px. */
  base: number;
  /** The room held now, in px. */
  room: number;
  onScroll: () => void;
}

const held = new WeakMap<HTMLElement, Held>();

function setRoom(pane: HTMLElement, h: Held, room: number): void {
  h.room = room;
  if (room > 0) {
    pane.style.paddingBottom = `${h.base + room}px`;
    return;
  }
  pane.style.paddingBottom = h.inline;
  pane.removeEventListener("scroll", h.onScroll);
  held.delete(pane);
}

/**
 * Hold the room `pane` needs to keep its scroll where it is once what it
 * holds is `lost` px shorter. Call it before the content shrinks, while it
 * still lays out at its old height.
 */
export function holdScrollRoom(pane: HTMLElement, lost: number): void {
  const below = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
  const need = Math.ceil(lost - below);
  if (need <= 0) return;
  let h = held.get(pane);
  if (h === undefined) {
    const made: Held = {
      inline: pane.style.paddingBottom,
      base: parseFloat(getComputedStyle(pane).paddingBottom) || 0,
      room: 0,
      onScroll: () => {
        // The room still on screen; what scrolled out of view goes.
        const end = pane.scrollHeight - made.room;
        const shown = pane.scrollTop + pane.clientHeight - end;
        const keep = Math.max(0, Math.min(made.room, Math.ceil(shown)));
        if (keep !== made.room) setRoom(pane, made, keep);
      },
    };
    h = made;
    held.set(pane, h);
    pane.addEventListener("scroll", h.onScroll, { passive: true });
  }
  setRoom(pane, h, h.room + need);
}

/** The room held at the end of `pane` now, in px. */
export function heldScrollRoom(pane: HTMLElement): number {
  return held.get(pane)?.room ?? 0;
}
