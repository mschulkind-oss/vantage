import type React from "react";

import { cn } from "../lib/utils";

/**
 * The size, in pixels, at which to draw the icon given to a `ReservedLabel`.
 * Each ghost leaves a space this wide before its label, so an icon drawn at
 * any other size would be centered off by half the difference and could
 * change the button's width on a click.
 */
export const RESERVED_ICON_SIZE = 14;

/**
 * A button's icon and label, kept as wide as the longest label the button can
 * show and centered in that room.
 *
 * Some labels change on a click: "Path" turns to "Copied!", "Review" to "End
 * review?". A button that grew with its label could change the viewer
 * header's fit under the pointer (`lib/headerFit.ts`), and a two-step confirm
 * moved out from under the click meant to confirm it. So the button keeps the
 * room of every label in `reserve`: beside the icon and label it draws, it lays
 * out in the same grid cell an invisible copy of each other label, which this
 * component calls a **ghost** (a term it coins): a space as wide as the icon,
 * then the label, then a copy of `trailing` if there is one. The widest sets
 * the width, and each is centered in it, so a shorter label leaves the same
 * room before its icon as after the last thing drawn — which shows wherever
 * the button has a background, a ring or a hover — rather than all of it at
 * the end ("A button whose label changes on click" in `index.css`).
 *
 * A ghost's text is drawn by the stylesheet from `data-reserve`, so it adds no
 * text to the page: nothing to select or copy, nothing in the button's name or
 * its text content. It is `aria-hidden` and invisible, and holds nothing
 * focusable.
 */
export const ReservedLabel: React.FC<{
  /** The icon before the label, drawn at `iconSize`. */
  icon: React.ReactNode;
  /** The label drawn now. */
  label: string;
  /** Every label the button can show, `label` among them. */
  reserve: readonly string[];
  /**
   * Given to the label and to each ghost's label alike: `hdr-label` in the
   * viewer header, so the `labels` yield step leaves each button its icon
   * alone and reserves nothing beside it.
   */
  labelClassName?: string;
  /**
   * Drawn after the label in every state, and so copied into every ghost with
   * the same class and style: Copy answers' count. Inside the room, it is
   * centered with the icon and label; outside it, a label shorter than the
   * room left all of the difference between its text and the count.
   */
  trailing?: {
    text: string;
    className?: string;
    style?: React.CSSProperties;
    /** For the drawn one only: a ghost's copy is no element to find. */
    testId?: string;
  };
  /** The icon's width in pixels, which each ghost leaves before its label. */
  iconSize?: number;
}> = ({
  icon,
  label,
  reserve,
  labelClassName,
  trailing,
  iconSize = RESERVED_ICON_SIZE,
}) => {
  const trailingClass = trailing && cn("hdr-reserve-after", trailing.className);
  return (
    <span className="hdr-reserve">
      <span className="hdr-reserve-face">
        {icon}
        <span className={labelClassName}>{label}</span>
        {trailing && (
          <span
            className={trailingClass}
            style={trailing.style}
            data-testid={trailing.testId}
          >
            {trailing.text}
          </span>
        )}
      </span>
      {reserve
        .filter((other, i) => other !== label && reserve.indexOf(other) === i)
        .map((other) => (
          <span key={other} className="hdr-reserve-ghost" aria-hidden="true">
            <span className="hdr-reserve-icon" style={{ width: iconSize }} />
            <span className={labelClassName} data-reserve={other} />
            {trailing && (
              <span
                className={trailingClass}
                style={trailing.style}
                data-reserve={trailing.text}
              />
            )}
          </span>
        ))}
    </span>
  );
};
