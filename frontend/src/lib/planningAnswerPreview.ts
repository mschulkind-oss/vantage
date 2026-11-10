import { createContext } from "react";

/** Inspector-only experiments. A null provider is the production handoff. */
export type AnswerPreview =
  | "crossfade-roll"
  | "crossfade-after"
  | "slide-up"
  | "title-glide"
  | "shrink-dissolve";
export const PlanningAnswerPreview = createContext<AnswerPreview | null>(null);

export const answerPreviews: readonly {
  value: AnswerPreview;
  label: string;
  description: string;
}[] = [
  {
    value: "crossfade-roll",
    label: "Crossfade during roll-up",
    description:
      "The original card fades out while the compact text fades in during the collapse.",
  },
  {
    value: "crossfade-after",
    label: "Crossfade after roll-up",
    description:
      "Keep the collapse, then gently blend the remaining card into the compact row.",
  },
  {
    value: "slide-up",
    label: "Slide and crossfade",
    description:
      "The old content drifts upward while the compact text rises into place and fades in.",
  },
  {
    value: "title-glide",
    label: "Title glide",
    description:
      "The question title moves toward its compact-row position and size while the rest dissolves.",
  },
  {
    value: "shrink-dissolve",
    label: "Shrink and dissolve",
    description:
      "The old card subtly scales down and fades away as the compact row grows into place.",
  },
];

export function answerPreviewOf(value: string | null): AnswerPreview | null {
  return (
    answerPreviews.find((preview) => preview.value === value)?.value ?? null
  );
}

/**
 * Experimental text layers over the real production height/tint effects.
 * All times are on that same native animation clock. Offsets hold the initial
 * appearance until the blend starts; fill keeps a finished layer from flashing
 * back before the row completes its handoff. No copied animation or timer.
 */
export function previewAnswerText(
  kind: AnswerPreview,
  copy: HTMLElement,
  compact: HTMLElement,
  onComplete: () => void,
): Animation[] {
  const start =
    kind === "crossfade-after" ? 320 : kind === "crossfade-roll" ? 64 : 96;
  const end =
    kind === "crossfade-after"
      ? 500
      : kind === "crossfade-roll"
        ? 320
        : kind === "shrink-dissolve"
          ? 360
          : 400;
  const animate = (
    element: HTMLElement,
    keyframes: Keyframe[],
    duration = end,
    easing = "ease-in-out",
  ) => element.animate(keyframes, { duration, easing, fill: "both" });
  const blend = (
    element: HTMLElement,
    from: number,
    to: number,
    extra: Keyframe[] = [],
  ) =>
    animate(element, [
      { opacity: from, ...extra[0], offset: 0 },
      { opacity: from, ...extra[0], offset: start / end },
      { opacity: to, ...extra[1], offset: 1 },
    ]);
  const animations: Animation[] = [];
  let outgoing: Animation;
  if (kind === "slide-up") {
    outgoing = blend(copy, 1, 0, [
      { transform: "translateY(0px)" },
      { transform: "translateY(-24px)" },
    ]);
    animations.push(
      blend(compact, 0, 1, [
        { transform: "translateY(10px)" },
        { transform: "translateY(0px)" },
      ]),
    );
  } else if (kind === "shrink-dissolve") {
    copy.style.transformOrigin = "top center";
    compact.style.transformOrigin = "top center";
    outgoing = blend(copy, 1, 0, [
      { transform: "scale(1)" },
      { transform: "scale(0.94)" },
    ]);
    animations.push(
      blend(compact, 0, 1, [
        { transform: "translateY(4px) scale(0.96)" },
        { transform: "translateY(0px) scale(1)" },
      ]),
    );
  } else if (kind === "title-glide") {
    const target = compact.querySelector<HTMLElement>(
      "[data-planning-row-title]",
    );
    let source: HTMLElement | undefined;
    let sourceRect: DOMRect | undefined;
    for (const element of copy.querySelectorAll<HTMLElement>(
      "[data-planning-card-headline], strong, h1, h2, h3, h4",
    )) {
      // The real headline has a separate aria-hidden status marker; match
      // only the question words, not that marker or the hidden source bold.
      const nodes = Array.from(element.childNodes).filter(
        (node) =>
          node.nodeType !== Node.ELEMENT_NODE ||
          (node as Element).getAttribute("aria-hidden") !== "true",
      );
      if (
        nodes
          .map((node) => node.textContent)
          .join("")
          .trim() !== target?.textContent?.trim()
      )
        continue;
      let rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (
        element.hasAttribute("data-planning-card-headline") &&
        nodes.length > 0
      ) {
        const children = Array.from(element.childNodes);
        const range = document.createRange();
        range.setStart(element, children.indexOf(nodes[0]));
        range.setEnd(element, children.indexOf(nodes[nodes.length - 1]) + 1);
        if (typeof range.getBoundingClientRect === "function")
          rect = range.getBoundingClientRect();
      }
      if (rect.width <= 0 || rect.height <= 0) continue;
      source = element;
      sourceRect = rect;
      break;
    }
    if (source !== undefined && sourceRect !== undefined && target !== null) {
      const from = sourceRect;
      const to = target.getBoundingClientRect();
      const parent = copy.parentElement!;
      const origin = parent.getBoundingClientRect();
      const font = getComputedStyle(source);
      const size =
        parseFloat(getComputedStyle(target).fontSize) /
          (parseFloat(font.fontSize) || 16) || 1;
      const title = document.createElement("span");
      title.dataset.planningGlidingTitle = "";
      title.setAttribute("aria-hidden", "true");
      title.textContent = target.textContent;
      Object.assign(title.style, {
        position: "absolute",
        left: `${from.left - origin.left}px`,
        top: `${from.top - origin.top}px`,
        width: `${from.width}px`,
        font: font.font,
        color: font.color,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        transformOrigin: "top left",
      });
      parent.appendChild(title);
      // At time zero the original wrapped title still paints. Its moving
      // single-line counterpart enters gradually, not in a frame-one swap.
      animations.push(
        animate(title, [
          { opacity: 0, offset: 0 },
          { opacity: 1, offset: 0.16 },
          { opacity: 1, offset: 0.8 },
          { opacity: 0, offset: 1 },
        ]),
      );
      animations.push(
        animate(
          title,
          [
            {
              transform: "translate(0px, 0px) scale(1)",
              width: `${from.width}px`,
              fontWeight: font.fontWeight,
            },
            {
              transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${size})`,
              width: `${to.width / size}px`,
              fontWeight: getComputedStyle(target).fontWeight,
            },
          ],
          320,
          "cubic-bezier(0.2, 0, 0, 1)",
        ),
      );
    }
    // Clear the stationary title and metadata before the gliding title reaches
    // them, but keep the outgoing completion at the full handoff duration.
    outgoing = animate(copy, [
      { opacity: 1 },
      { opacity: 0, offset: 0.3 },
      { opacity: 0 },
    ]);
    animations.push(
      animate(compact, [
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: 0.7 },
        { opacity: 1, offset: 1 },
      ]),
    );
  } else {
    outgoing = blend(copy, 1, 0);
    animations.push(blend(compact, 0, 1));
  }
  outgoing.onfinish = onComplete;
  outgoing.oncancel = onComplete;
  // Capture the completion effect last, so a direct seek first applies all
  // the incoming/title poses before releasing the outgoing copied DOM.
  animations.push(outgoing);
  return animations;
}
