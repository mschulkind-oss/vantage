/**
 * A visual-only copy of the painted card, made before React removes it. It
 * never owns review state or handlers. Preserve descendant IDs (SVG markers
 * and math can reference them), but not the item's navigable identity.
 */
export function copyCardForCollapse(
  article: HTMLElement | null,
): HTMLElement | null {
  if (article === null) return null;
  const copy = article.cloneNode(true) as HTMLElement;
  const painted = [article, ...article.querySelectorAll("*")];
  const copied = [copy, ...copy.querySelectorAll("*")];
  // Font shorthand serializes line-height to pixels. Freezing only the root
  // would make small controls inherit its 24px line box instead of their own
  // 16.5px box. Preserve every element's already-painted metrics, not just the
  // question text, so frame one never reflows the controls or diagram labels.
  painted.forEach((element, index) => {
    const font = getComputedStyle(element).font;
    if (font !== "") (copied[index] as HTMLElement).style.font = font;
  });
  copy.removeAttribute("id");
  copy.removeAttribute("data-planning-item");
  copy.setAttribute("data-planning-departing-card", "");
  copy.setAttribute("inert", "");
  copy.setAttribute("aria-hidden", "true");
  // The compact row inherits a smaller font; the departing text must not.
  copy.style.height = "auto";
  copy.style.width = "100%";
  copy.style.margin = "0";
  // The carrier supplies the same paper color and the production green tint.
  copy.style.background = "transparent";
  return copy;
}
